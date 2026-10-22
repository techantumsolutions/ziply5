import crypto, { randomUUID } from "node:crypto"
import Stripe from "stripe"
import { env } from "@/src/server/core/config/env"
import {
  latestLifecycleStatus,
  triggerShiprocketAutoSync,
  updateOrderStatus,
} from "@/src/server/modules/orders/orders.service"
import { createRefund } from "@/src/server/modules/extended/extended.service"
import {
  appendOrderStatusHistorySupabase,
  createTransactionSupabase,
  getOrderByIdSupabaseBasic,
  markOrderPaymentSuccessSupabase,
  setOrderRefundAndPaymentStatusSupabase,
  setTransactionRefundIdSupabase,
  upsertPendingTransactionSupabase,
  updateTransactionStatusSupabase,
  updateRefundRecordStatusSupabase,
  upsertPaidTransactionSupabase,
} from "@/src/lib/db/orders"
import { getSupabaseAdmin } from "@/src/lib/supabase/admin"
import { pgQuery } from "@/src/server/db/pg"
import { codAmountsMatch } from "@/src/server/modules/payments/cod-payment-link"
import { refundRazorpayPayment } from "@/src/server/modules/payments/cod-payment-link.service"

const getOrderById = async (orderId: string) => {
  const client = getSupabaseAdmin()

  const { data, error } = await client
    .from("Order")
    .select("*")
    .eq("id", orderId)
    .single()

  if (error || !data) {
    throw new Error("Order not found")
  }

  return data
}

export type PaymentProvider = "razorpay" | "stripe" | "mock"

const normalizeProvider = (provider?: string): PaymentProvider => {
  const p = (provider ?? env.PAYMENT_PROVIDER_DEFAULT ?? "mock").toLowerCase()
  if (p === "razorpay" || p === "stripe" || p === "mock") return p
  return "mock"
}

const randomId = (prefix: string) => `${prefix}_${crypto.randomBytes(10).toString("hex")}`

const amountToMinor = (amount: number) => Math.max(0, Math.round(amount * 100))

const stripeClient = env.STRIPE_SECRET_KEY
  ? new Stripe(env.STRIPE_SECRET_KEY, { apiVersion: "2025-08-27.basil" })
  : null

const upsertTransaction = async (
  orderId: string,
  provider: string,
  externalId: string,
  amount: number,
) => {
  const client = getSupabaseAdmin()

  // 1. Find existing transaction
  const { data: existing, error: findError } = await client
    .from("Transaction")
    .select("id")
    .eq("orderId", orderId)
    .eq("gateway", provider)
    .order("createdAt", { ascending: false })
    .limit(1)
    .maybeSingle()

  if (findError) {
    throw new Error(`Failed to find transaction: ${findError.message}`)
  }

  // 2. If exists → update
  if (existing?.id) {
    const { error: updateError } = await client
      .from("Transaction")
      .update({
        externalId,
        status: "pending",
        amount,
        gateway: provider,
      })
      .eq("id", existing.id)

    if (updateError) {
      throw new Error(`Failed to update transaction: ${updateError.message}`)
    }

    return existing.id
  }

  // 3. Else → create new
  const { data: created, error: insertError } = await client
    .from("Transaction")
    .insert([
      {
        id: randomUUID(),
        orderId,
        gateway: provider,
        amount,
        status: "pending",
        externalId,
      },
    ])
    .select("id")
    .single()

  if (insertError || !created?.id) {
    throw new Error(`Failed to create transaction: ${insertError?.message}`)
  }

  return created.id
}

const createRazorpayOrder = async (input: { orderId: string; amount: number; currency: string }) => {
  if (!env.RAZORPAY_KEY_ID || !env.RAZORPAY_KEY_SECRET) {
    throw new Error("Razorpay keys are not configured")
  }
  console.log("amount in razorpay", amountToMinor(input.amount))
  const auth = Buffer.from(`${env.RAZORPAY_KEY_ID}:${env.RAZORPAY_KEY_SECRET}`).toString("base64")
  const res = await fetch("https://api.razorpay.com/v1/orders", {
    method: "POST",
    headers: {
      Authorization: `Basic ${auth}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      amount: amountToMinor(input.amount),
      currency: input.currency,
      receipt: input.orderId,
      notes: { orderId: input.orderId },
    }),
  })
  if (!res.ok) {
    const text = await res.text()
    throw new Error(`Razorpay order creation failed: ${res.status} ${text.slice(0, 160)}`)
  }
  const json = (await res.json()) as { id: string }
  return json.id
}

const createStripeIntent = async (input: { orderId: string; amount: number; currency: string }) => {
  if (!stripeClient) throw new Error("Stripe secret key is not configured")
  const intent = await stripeClient.paymentIntents.create({
    amount: amountToMinor(input.amount),
    currency: input.currency.toLowerCase(),
    metadata: { orderId: input.orderId },
  })
  return {
    id: intent.id,
    clientSecret: intent.client_secret ?? undefined,
  }
}

export const createPaymentIntent = async (input: {
  orderId: string
  provider?: string
  actorRole: string
  actorUserId: string
}) => {
  const provider = normalizeProvider(input.provider)

  const order = await getOrderById(input.orderId)

  if (input.actorRole === "customer" && order.userId && order.userId !== input.actorUserId) {
    throw new Error("Forbidden")
  }

  const amount = Number(order.total)

  let externalId = randomId(provider)
  console.log("oder amount = ", amount, input.orderId)
  if (provider === "razorpay") {
    externalId = await createRazorpayOrder({
      orderId: input.orderId,
      amount,
      currency: order.currency,
    })
  }

  await upsertTransaction(input.orderId, provider, externalId, amount)

  await setOrderRefundAndPaymentStatusSupabase({
    orderId: input.orderId,
    paymentStatus: "PENDING",
  })

  return {
    provider,
    orderId: input.orderId,
    amount,
    currency: order.currency,
    externalId,
    publicKey: process.env.RAZORPAY_KEY_ID,
    status: "pending",
  }
}

const constantTimeEqual = (a: string, b: string) => {
  const ab = Buffer.from(a)
  const bb = Buffer.from(b)
  if (ab.length !== bb.length) return false
  return crypto.timingSafeEqual(ab, bb)
}

export const verifyRazorpayCheckoutSignature = (input: {
  razorpayOrderId: string
  razorpayPaymentId: string
  razorpaySignature: string
}) => {
  if (!env.RAZORPAY_KEY_SECRET) throw new Error("Razorpay key secret is not configured")
  const payload = `${input.razorpayOrderId}|${input.razorpayPaymentId}`
  const expected = crypto.createHmac("sha256", env.RAZORPAY_KEY_SECRET).update(payload).digest("hex")
  return constantTimeEqual(expected, input.razorpaySignature)
}

export const verifyRazorpayPayment = async (input: {
  orderId: string
  razorpayOrderId: string
  razorpayPaymentId: string
  razorpaySignature: string
}) => {
  const valid = verifyRazorpayCheckoutSignature(input)
  if (!valid) throw new Error("Invalid Razorpay signature")

  const txId = await upsertPaidTransactionSupabase({
    orderId: input.orderId,
    razorpayOrderId: input.razorpayOrderId,
    razorpayPaymentId: input.razorpayPaymentId,
  })
  if (!txId) throw new Error("Supabase verify payment transaction upsert failed")

  const paymentUpdated = await markOrderPaymentSuccessSupabase(input.orderId, input.razorpayPaymentId)
  if (!paymentUpdated) throw new Error("Supabase verify payment order update failed")

  const order = await getOrderByIdSupabaseBasic(input.orderId)
  const lifecycle = latestLifecycleStatus(order as any)

  if (lifecycle === "cancelled") {
    // Late payment on cancelled order: DO NOT resurrect order or trigger shipment!
    await appendOrderStatusHistorySupabase({
      orderId: input.orderId,
      fromStatus: "cancelled",
      toStatus: "cancelled",
      notes: "Late payment verified after cancellation; refund required",
      changedById: "system",
    }).catch(() => null)
    try {
      const amount = Number(order?.total ?? 0)
      const refund = await createRefund(input.orderId, amount, "Late payment after cancellation")
      await triggerRazorpayRefund({ refundRecordId: refund.id })
    } catch (e) {
      console.error("[verifyRazorpayPayment] Auto-refund for cancelled order failed", e)
    }
  } else if (lifecycle === "confirmed") {
    // Order already approved by admin: trigger auto-sync if enabled
    await appendOrderStatusHistorySupabase({
      orderId: input.orderId,
      fromStatus: "confirmed",
      toStatus: "confirmed",
      notes: "Payment verified for approved order",
      changedById: "system",
    }).catch(() => null)
    void triggerShiprocketAutoSync({
      orderId: input.orderId,
      actorId: "system",
      source: "payment_success",
    })
  } else if (lifecycle === "admin_approval_pending") {
    // Awaiting admin approval: keep lifecycle status as admin_approval_pending!
    await appendOrderStatusHistorySupabase({
      orderId: input.orderId,
      fromStatus: "admin_approval_pending",
      toStatus: "admin_approval_pending",
      notes: "Payment verified; awaiting admin approval",
      changedById: "system",
    }).catch(() => null)
  }

  return { verified: true, orderId: input.orderId, transactionId: txId }
}

export const triggerRazorpayRefund = async (input: {
  refundRecordId: string
}) => {
  if (!env.RAZORPAY_KEY_ID || !env.RAZORPAY_KEY_SECRET) {
    throw new Error("Razorpay keys are not configured")
  }
  const client = getSupabaseAdmin()
  const { data: refund, error: refundError } = await client
    .from("RefundRecord")
    .select("*")
    .eq("id", input.refundRecordId)
    .maybeSingle()
  if (refundError || !refund) throw new Error("Refund record not found")
  const { data: order, error: orderError } = await client
    .from("Order")
    .select("id,paymentId")
    .eq("id", String(refund.orderId ?? ""))
    .maybeSingle()
  if (orderError || !order) throw new Error("Order not found")
  if (!refund) throw new Error("Refund record not found")
  if (!order.paymentId) throw new Error("Order has no Razorpay payment_id")
  if (["initiated", "completed"].includes(String(refund.status ?? ""))) throw new Error("Refund already initiated")

  const amount = Math.max(1, Math.round(Number(refund.amount ?? 0) * 100))
  const auth = Buffer.from(`${env.RAZORPAY_KEY_ID}:${env.RAZORPAY_KEY_SECRET}`).toString("base64")
  const res = await fetch(`https://api.razorpay.com/v1/payments/${order.paymentId}/refund`, {
    method: "POST",
    headers: {
      Authorization: `Basic ${auth}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      amount,
      notes: { refundRecordId: refund.id, orderId: refund.orderId },
    }),
  })
  if (!res.ok) {
    const text = await res.text()
    throw new Error(`Razorpay refund failed: ${res.status} ${text.slice(0, 180)}`)
  }

  const payload = (await res.json()) as { id?: string }
  const refundId = payload.id ?? null

  const refundUpdated = await updateRefundRecordStatusSupabase(String(refund.id), "initiated")
  if (!refundUpdated) throw new Error("supabase_refund_record_write_failed")
  const orderUpdated = await setOrderRefundAndPaymentStatusSupabase({
    orderId: String(refund.orderId),
    refundStatus: "INITIATED",
    paymentStatus: "REFUNDED",
  })
  if (!orderUpdated) throw new Error("supabase_order_refund_status_write_failed")
  if (refundId) {
    const txUpdated = await setTransactionRefundIdSupabase(String(refund.orderId), refundId)
    if (!txUpdated) throw new Error("supabase_transaction_refund_id_write_failed")
  }

  return { refundId, refundRecordId: String(refund.id), status: "initiated" as const }
}

export const parseAndVerifyWebhook = (input: {
  providerRaw: string
  payload: string
  signature: string | null
}) => {
  const provider = normalizeProvider(input.providerRaw)
  if (provider === "stripe") {
    if (!stripeClient) throw new Error("Stripe secret key is not configured")
    if (!input.signature) throw new Error("Missing stripe signature")
    if (!env.PAYMENT_WEBHOOK_SECRET) throw new Error("Missing PAYMENT_WEBHOOK_SECRET")
    return stripeClient.webhooks.constructEvent(input.payload, input.signature, env.PAYMENT_WEBHOOK_SECRET)
  }
  if (provider === "razorpay") {
    if (!input.signature) throw new Error("Missing razorpay signature")
    const secret =
      env.RAZORPAY_WEBHOOK_SECRET ||
      process.env.RAZORPAY_WEBHOOK_SECRET ||
      env.PAYMENT_WEBHOOK_SECRET ||
      process.env.PAYMENT_WEBHOOK_SECRET
    if (!secret) throw new Error("Razorpay webhook secret is not configured")
    const expected = crypto.createHmac("sha256", secret).update(input.payload).digest("hex")
    if (!constantTimeEqual(expected, input.signature)) throw new Error("Invalid Razorpay signature")
    try {
      return JSON.parse(input.payload) as unknown
    } catch {
      throw new Error("Malformed webhook payload")
    }
  }
  try {
    return JSON.parse(input.payload) as unknown
  } catch {
    throw new Error("Malformed webhook payload")
  }
}

export type WebhookEventDeps = {
  getOrderById?: (orderId: string) => Promise<any>
  markOrderPaymentSuccess?: (orderId: string, paymentId: string) => Promise<boolean>
  setOrderRefundAndPaymentStatus?: (input: {
    orderId: string
    paymentStatus?: "PENDING" | "SUCCESS" | "FAILED" | "REFUNDED"
    refundStatus?: string
  }) => Promise<boolean>
  updateTransactionStatus?: (input: {
    transactionId: string
    status: string
    gateway?: string
    externalId?: string | null
  }) => Promise<boolean>
  createTransaction?: (input: {
    orderId: string
    gateway: string
    amount: number
    status: string
    externalId?: string | null
  }) => Promise<{ id: string } | null>
  appendOrderStatusHistory?: (input: any) => Promise<any>
  findOrderIdByRazorpayOrder?: (razorpayOrderId: string) => Promise<string | null>
  findOrderIdByPaymentId?: (paymentId: string) => Promise<string | null>
  findTransactionByExternalId?: (orderId: string, externalId: string) => Promise<{ id: string; status: string } | null>
  refundPayment?: (paymentId: string) => Promise<boolean>
}

export const processWebhookEvent = async (
  providerRaw: string,
  event: unknown,
  externalIdHint?: string | null,
  deps?: WebhookEventDeps,
) => {
  const provider = normalizeProvider(providerRaw)
  if (!event || typeof event !== "object") {
    return { applied: false, reason: "invalid_event_payload" }
  }

  const obj = event as Record<string, unknown>
  const type = String(obj.type ?? obj.event ?? "")

  let orderId: string | null = null
  let externalId: string | null = externalIdHint ?? null
  let paid = false
  let isAuthorizedOnly = false
  let isFailed = false

  let paidMinor = 0
  let incomingCurrency: string | null = null
  let incomingPaymentId: string | null = null
  let failureReason: string | null = null
  let isCodLinkPayment = false

  if (provider === "razorpay") {
    const payload = obj.payload as Record<string, unknown> | undefined
    const payment = payload?.payment as Record<string, unknown> | undefined
    const paymentLink = payload?.payment_link as Record<string, unknown> | undefined
    const refund = payload?.refund as Record<string, unknown> | undefined
    const orderPayload = payload?.order as Record<string, unknown> | undefined

    const entity = (payment?.entity ?? payload?.entity ?? {}) as Record<string, unknown>
    const orderEntity = (orderPayload?.entity ?? {}) as Record<string, unknown>
    const linkEntity = (paymentLink?.entity ?? {}) as Record<string, unknown>
    const refundEntity = (refund?.entity ?? {}) as Record<string, unknown>

    const refundNotes = refundEntity.notes && typeof refundEntity.notes === "object" ? refundEntity.notes as Record<string, unknown> : {}
    const entityNotes = entity.notes && typeof entity.notes === "object" ? entity.notes as Record<string, unknown> : {}
    const orderNotes = orderEntity.notes && typeof orderEntity.notes === "object" ? orderEntity.notes as Record<string, unknown> : {}
    const linkNotes = linkEntity.notes && typeof linkEntity.notes === "object" ? linkEntity.notes as Record<string, unknown> : {}
    const notes = { ...linkNotes, ...orderNotes, ...refundNotes, ...entityNotes }

    // 1. Resolve from notes.orderId
    orderId = typeof notes.orderId === "string" && notes.orderId.trim() ? notes.orderId.trim() : null

    // 2. Resolve from Razorpay order receipt (Ziply5 order ID)
    if (!orderId && typeof orderEntity.receipt === "string" && orderEntity.receipt.trim()) {
      orderId = orderEntity.receipt.trim()
    }

    // 3. Resolve from COD payment link ID
    if (!orderId && typeof linkEntity.id === "string") {
      const linked = await pgQuery<Array<{ id: string }>>(
        `SELECT id FROM "Order" WHERE "codPaymentLinkId" = $1 LIMIT 1`,
        [linkEntity.id],
      ).catch(() => [])
      if (linked[0]?.id) {
        orderId = linked[0].id
        isCodLinkPayment = true
      }
    } else if (orderId && typeof linkEntity.id === "string") {
      isCodLinkPayment = true
    }

    if (notes.purpose === "cod_collection") {
      isCodLinkPayment = true
    }

    incomingPaymentId = typeof entity.id === "string" && entity.id.startsWith("pay_") ? entity.id : null
    paidMinor = Number(entity.amount ?? orderEntity.amount_paid ?? orderEntity.amount ?? linkEntity.amount_paid ?? linkEntity.amount ?? 0)
    incomingCurrency = typeof entity.currency === "string"
      ? entity.currency
      : typeof orderEntity.currency === "string"
        ? orderEntity.currency
        : typeof linkEntity.currency === "string"
          ? linkEntity.currency
          : null

    const razorpayOrderId = typeof entity.order_id === "string" && entity.order_id
      ? entity.order_id
      : typeof orderEntity.id === "string" && orderEntity.id
        ? orderEntity.id
        : null
    externalId = externalId ?? razorpayOrderId

    // 4. Resolve Ziply5 orderId by Razorpay order ID in Transaction.externalId
    if (!orderId && razorpayOrderId) {
      if (deps?.findOrderIdByRazorpayOrder) {
        orderId = await deps.findOrderIdByRazorpayOrder(razorpayOrderId)
      } else if (!deps) {
        const client = getSupabaseAdmin()
        const { data: txRow } = await client
          .from("Transaction")
          .select("orderId")
          .eq("externalId", razorpayOrderId)
          .order("createdAt", { ascending: false })
          .limit(1)
          .maybeSingle()
        if (txRow?.orderId) {
          orderId = String(txRow.orderId)
        } else {
          const linked = await pgQuery<Array<{ id: string }>>(
            `SELECT "orderId" as id FROM "Transaction" WHERE "externalId" = $1 LIMIT 1`,
            [razorpayOrderId],
          ).catch(() => [])
          orderId = linked[0]?.id ?? null
        }
      }
    }

    // 5. Resolve Ziply5 orderId by payment ID
    if (!orderId && (typeof refundEntity.payment_id === "string" || incomingPaymentId)) {
      const targetPayId = typeof refundEntity.payment_id === "string" ? refundEntity.payment_id : incomingPaymentId
      if (targetPayId) {
        if (deps?.findOrderIdByPaymentId) {
          orderId = await deps.findOrderIdByPaymentId(targetPayId)
        } else if (!deps) {
          const client = getSupabaseAdmin()
          const { data: orderByPayment } = await client
            .from("Order")
            .select("id")
            .eq("paymentId", targetPayId)
            .maybeSingle()
          if (orderByPayment?.id) {
            orderId = String(orderByPayment.id)
          } else {
            const linked = await pgQuery<Array<{ id: string }>>(
              `SELECT "orderId" as id FROM "Transaction" WHERE "externalId" = $1 LIMIT 1`,
              [targetPayId],
            ).catch(() => [])
            orderId = linked[0]?.id ?? null
          }
        }
      }
    }

    // Classify event
    if (type === "payment.authorized") {
      isAuthorizedOnly = true
      paid = false
    } else if (type === "payment.failed") {
      isFailed = true
      paid = false
      failureReason = String(entity.error_description ?? entity.error_reason ?? entity.error_code ?? "Payment failed")
    } else if (
      type === "payment.captured" ||
      type === "order.paid" ||
      type === "payment_link.paid"
    ) {
      paid = true
    } else if (type === "refund.processed") {
      paid = false
    } else {
      // Unhandled or informational event (e.g. payout, settlement) - ack without error
      return { applied: true, ignored: true, reason: "unhandled_razorpay_event", eventType: type }
    }
  } else if (provider === "stripe") {
    const data = obj.data as Record<string, unknown> | undefined
    const object = (data?.object ?? {}) as Record<string, unknown>
    const metadata = (object.metadata ?? {}) as Record<string, unknown>
    orderId = typeof metadata.orderId === "string" ? metadata.orderId : null
    externalId = externalId ?? (typeof object.id === "string" ? object.id : null)
    paid = type === "payment_intent.succeeded" || type.includes("checkout.session.completed")
  } else {
    const meta = obj as Record<string, unknown>
    orderId = typeof meta.orderId === "string" ? meta.orderId : null
    externalId = externalId ?? (typeof meta.externalId === "string" ? meta.externalId : null)
    paid = meta.status === "paid"
  }

  if (!orderId) {
    return { applied: false, reason: "orderId_missing" }
  }

  const getOrder = deps?.getOrderById ?? getOrderByIdSupabaseBasic
  const markPaymentSuccess = deps?.markOrderPaymentSuccess ?? markOrderPaymentSuccessSupabase
  const setPaymentStatus = deps?.setOrderRefundAndPaymentStatus ?? setOrderRefundAndPaymentStatusSupabase
  const updateTxStatus = deps?.updateTransactionStatus ?? updateTransactionStatusSupabase
  const createTx = deps?.createTransaction ?? createTransactionSupabase
  const appendStatusHistory = deps?.appendOrderStatusHistory ?? appendOrderStatusHistorySupabase
  const refundPayment = deps?.refundPayment ?? refundRazorpayPayment

  // Load authoritative Ziply5 order
  const currentOrder = await getOrder(orderId)
  if (!currentOrder) {
    return { applied: false, reason: "order_not_found", orderId }
  }

  const isCodOrder = String(currentOrder.paymentMethod ?? "").toLowerCase() === "cod"

  // COD Order Protection: Unrelated Razorpay events must NEVER mark a COD order as prepaid
  if (isCodOrder && !isCodLinkPayment) {
    return {
      applied: false,
      reason: "cod_order_unrelated_payment_ignored",
      orderId,
    }
  }

  // Find or create Transaction record
  let tx: { id: string; status: string; externalId?: string | null } | null = null
  let duplicateTx: { id: string; status: string; externalId?: string | null } | null = null

  if (incomingPaymentId && deps?.findTransactionByExternalId) {
    const found = await deps.findTransactionByExternalId(orderId, incomingPaymentId)
    if (found) {
      duplicateTx = { id: found.id, status: found.status, externalId: incomingPaymentId }
    }
  } else if (incomingPaymentId && !deps) {
    const client = getSupabaseAdmin()
    const { data: dRow } = await client
      .from("Transaction")
      .select("id,status,externalId")
      .eq("orderId", orderId)
      .eq("externalId", incomingPaymentId)
      .order("createdAt", { ascending: false })
      .limit(1)
      .maybeSingle()
    if (dRow?.id) {
      duplicateTx = {
        id: String(dRow.id),
        status: String(dRow.status ?? ""),
        externalId: dRow.externalId ? String(dRow.externalId) : null,
      }
    }
  }

  if (externalId && !deps) {
    const client = getSupabaseAdmin()
    const { data } = await client
      .from("Transaction")
      .select("id,status,externalId")
      .eq("orderId", orderId)
      .eq("externalId", externalId)
      .order("createdAt", { ascending: false })
      .limit(1)
      .maybeSingle()
    if (data?.id) {
      tx = {
        id: String(data.id),
        status: String(data.status ?? ""),
        externalId: data.externalId ? String(data.externalId) : null,
      }
    }
  }

  if (!tx && !deps) {
    const client = getSupabaseAdmin()
    const { data } = await client
      .from("Transaction")
      .select("id,status,externalId")
      .eq("orderId", orderId)
      .order("createdAt", { ascending: false })
      .limit(1)
      .maybeSingle()
    if (data?.id) {
      tx = {
        id: String(data.id),
        status: String(data.status ?? ""),
        externalId: data.externalId ? String(data.externalId) : null,
      }
    }
  }

  if (!tx) {
    // If no existing transaction was found, create one for tracking
    const createdTx = await createTx({
      orderId,
      gateway: provider,
      amount: Number(currentOrder.total ?? 0),
      status: isAuthorizedOnly ? "authorized" : isFailed ? "failed" : paid ? "paid" : "pending",
      externalId: incomingPaymentId ?? externalId ?? null,
    }).catch(() => null)
    if (createdTx?.id) {
      tx = {
        id: createdTx.id,
        status: isAuthorizedOnly ? "authorized" : isFailed ? "failed" : paid ? "paid" : "pending",
        externalId: incomingPaymentId ?? externalId ?? null,
      }
    } else {
      tx = {
        id: `tx_${orderId}`,
        status: isAuthorizedOnly ? "authorized" : isFailed ? "failed" : paid ? "paid" : "pending",
        externalId: incomingPaymentId ?? externalId ?? null,
      }
    }
  }

  const orderPaymentStatusUpper = String(currentOrder.paymentStatus ?? "").toUpperCase()
  const lifecycle = latestLifecycleStatus(currentOrder as any)

  // 1. Handle payment.authorized (authorized but NOT captured)
  if (isAuthorizedOnly) {
    if (orderPaymentStatusUpper === "SUCCESS") {
      return { applied: true, duplicate: true, status: "authorized", orderId, transactionId: tx?.id }
    }
    if (tx) {
      await updateTxStatus({
        transactionId: tx.id,
        status: "authorized",
        gateway: provider,
        externalId: incomingPaymentId ?? externalId ?? tx.externalId ?? undefined,
      })
    }
    await appendStatusHistory({
      orderId,
      fromStatus: lifecycle,
      toStatus: lifecycle,
      notes: `Payment authorized via webhook (${incomingPaymentId ?? "authorized"}); awaiting capture`,
      changedById: "system",
    }).catch(() => null)

    return { applied: true, status: "authorized", orderId, transactionId: tx?.id }
  }

  // 2. Handle payment.failed
  if (isFailed) {
    // Prevent out-of-order or duplicate failure from downgrading an already-paid order!
    if (orderPaymentStatusUpper === "SUCCESS") {
      return {
        applied: true,
        duplicate: true,
        stale: true,
        reason: "order_already_paid",
        orderId,
        transactionId: tx?.id,
      }
    }

    if (tx) {
      await updateTxStatus({
        transactionId: tx.id,
        status: "failed",
        gateway: provider,
        externalId: incomingPaymentId ?? externalId ?? tx.externalId ?? undefined,
      })
    }

    const orderUpdated = await setPaymentStatus({
      orderId,
      paymentStatus: "FAILED",
    })
    if (!orderUpdated) {
      throw new Error("DATABASE_ERROR: supabase_order_payment_status_write_failed")
    }

    await appendStatusHistory({
      orderId,
      fromStatus: lifecycle,
      toStatus: lifecycle,
      notes: `Payment failed via webhook: ${failureReason ?? "unknown"}`,
      changedById: "system",
    }).catch(() => null)

    return { applied: true, paid: false, status: "failed", orderId, transactionId: tx?.id }
  }

  // 3. Handle payment.captured / order.paid / paid
  if (paid) {
    // Validate amount
    if (paidMinor > 0 && !codAmountsMatch(Number(currentOrder.total ?? 0), paidMinor)) {
      return { applied: false, reason: "amount_mismatch", orderId }
    }

    // Validate currency
    if (
      incomingCurrency &&
      currentOrder.currency &&
      incomingCurrency.trim().toUpperCase() !== String(currentOrder.currency).trim().toUpperCase()
    ) {
      return { applied: false, reason: "currency_mismatch", orderId }
    }

    // Check if order is already paid
    if (orderPaymentStatusUpper === "SUCCESS") {
      // If customer paid again with a different payment ID, auto-refund the duplicate
      if (incomingPaymentId && currentOrder.paymentId && incomingPaymentId !== currentOrder.paymentId) {
        // Idempotency: if duplicate charge was already refunded on an earlier webhook delivery, avoid duplicate refund requests!
        if (duplicateTx?.status === "refunded") {
          return {
            applied: true,
            duplicate: true,
            duplicatePaymentRefunded: true,
            paid: true,
            orderId,
            transactionId: duplicateTx.id,
          }
        }

        await refundPayment(incomingPaymentId).catch(() => false)

        if (duplicateTx) {
          await updateTxStatus({
            transactionId: duplicateTx.id,
            status: "refunded",
            gateway: provider,
            externalId: incomingPaymentId,
          })
        } else {
          await createTx({
            orderId,
            gateway: provider,
            amount: paidMinor > 0 ? paidMinor / 100 : Number(currentOrder.total ?? 0),
            status: "refunded",
            externalId: incomingPaymentId,
          }).catch(() => null)
        }

        await appendStatusHistory({
          orderId,
          fromStatus: lifecycle,
          toStatus: lifecycle,
          notes: `Duplicate payment ${incomingPaymentId} automatically refunded`,
          changedById: "system",
        }).catch(() => null)

        return {
          applied: true,
          duplicate: true,
          duplicatePaymentRefunded: true,
          paid: true,
          orderId,
          transactionId: duplicateTx?.id ?? tx?.id,
        }
      }
      return { applied: true, duplicate: true, paid: true, orderId, transactionId: tx?.id }
    }

    if (tx) {
      await updateTxStatus({
        transactionId: tx.id,
        status: "paid",
        gateway: provider,
        externalId: incomingPaymentId ?? externalId ?? tx.externalId ?? undefined,
      })
    }

    const orderUpdated = incomingPaymentId
      ? await markPaymentSuccess(orderId, incomingPaymentId)
      : await setPaymentStatus({
          orderId,
          paymentStatus: "SUCCESS",
        })
    if (!orderUpdated) {
      throw new Error("DATABASE_ERROR: supabase_order_payment_status_write_failed")
    }

    if (lifecycle === "cancelled") {
      // Late payment on cancelled order: DO NOT resurrect order or trigger shipment!
      await appendStatusHistory({
        orderId,
        fromStatus: "cancelled",
        toStatus: "cancelled",
        notes: "Late payment webhook captured after cancellation; refund required",
        changedById: "system",
      }).catch(() => null)
      try {
        const amount = Number(currentOrder?.total ?? 0)
        const refund = await createRefund(orderId, amount, "Late payment after cancellation")
        await triggerRazorpayRefund({ refundRecordId: refund.id })
      } catch (e) {
        console.error("[processWebhookEvent] Auto-refund for cancelled order failed", e)
      }
    } else if (lifecycle === "confirmed") {
      // Order already approved by admin: trigger auto-sync if enabled
      await appendStatusHistory({
        orderId,
        fromStatus: "confirmed",
        toStatus: "confirmed",
        notes: "Payment captured via webhook for approved order",
        changedById: "system",
      }).catch(() => null)
      void triggerShiprocketAutoSync({
        orderId,
        actorId: "system",
        source: "payment_success",
      })
    } else if (lifecycle === "admin_approval_pending" || lifecycle === "pending") {
      // Order is awaiting admin approval: keep in admin_approval_pending
      await appendStatusHistory({
        orderId,
        fromStatus: lifecycle,
        toStatus: lifecycle,
        notes: "Payment captured via webhook; awaiting admin approval",
        changedById: "system",
      }).catch(() => null)
    }

    return { applied: true, paid: true, orderId, transactionId: tx?.id }
  }

  // 4. Handle refund.processed
  if (type === "refund.processed") {
    const payload = obj.payload as Record<string, unknown> | undefined
    const payment = payload?.payment as Record<string, unknown> | undefined
    const refund = payload?.refund as Record<string, unknown> | undefined
    const refundEntity = (refund?.entity ?? {}) as Record<string, unknown>
    const paymentEntity = (payment?.entity ?? {}) as Record<string, unknown>

    const refundAmountMinor = Number(refundEntity.amount ?? 0)
    const orderTotalMinor = Math.round(Number(currentOrder.total ?? 0) * 100)
    const paymentRefundStatus = String(paymentEntity.refund_status ?? "")
    const isPartial = paymentRefundStatus === "partial" || (orderTotalMinor > 0 && refundAmountMinor > 0 && refundAmountMinor < orderTotalMinor)

    // Idempotency: if full refund is already applied, don't repeat
    if (!isPartial && orderPaymentStatusUpper === "REFUNDED") {
      return { applied: true, duplicate: true, refunded: true, orderId, transactionId: tx?.id }
    }

    if (isPartial) {
      if (tx) {
        await updateTxStatus({
          transactionId: tx.id,
          status: "partially_refunded",
          gateway: provider,
          externalId: externalId ?? tx.externalId ?? undefined,
        })
      }

      const orderUpdated = await setPaymentStatus({
        orderId,
        refundStatus: "PARTIAL",
      })
      if (!orderUpdated) {
        throw new Error("DATABASE_ERROR: supabase_order_payment_status_write_failed")
      }

      await appendStatusHistory({
        orderId,
        fromStatus: lifecycle,
        toStatus: lifecycle,
        notes: `Partial refund processed via webhook: ₹${(refundAmountMinor / 100).toFixed(2)} (Refund ID: ${refundEntity.id ?? "unknown"})`,
        changedById: "system",
      }).catch(() => null)

      return { applied: true, partialRefund: true, refunded: false, orderId, transactionId: tx?.id }
    }

    if (tx) {
      await updateTxStatus({
        transactionId: tx.id,
        status: "refunded",
        gateway: provider,
        externalId: externalId ?? tx.externalId ?? undefined,
      })
    }

    const orderUpdated = await setPaymentStatus({
      orderId,
      paymentStatus: "REFUNDED",
      refundStatus: "COMPLETED",
    })
    if (!orderUpdated) {
      throw new Error("DATABASE_ERROR: supabase_order_payment_status_write_failed")
    }

    if (!deps?.updateTransactionStatus) {
      const client = getSupabaseAdmin()
      const { data: refundRows, error: refundFetchError } = await client
        .from("RefundRecord")
        .select("id,status")
        .eq("orderId", orderId)
        .in("status", ["pending", "initiated", "processing"])
      if (refundFetchError) {
        throw new Error("DATABASE_ERROR: supabase_refund_record_fetch_failed")
      }
      for (const row of refundRows ?? []) {
        const updated = await updateRefundRecordStatusSupabase(String((row as Record<string, unknown>).id), "completed")
        if (!updated) {
          throw new Error("DATABASE_ERROR: supabase_refund_record_status_write_failed")
        }
      }
    }

    await appendStatusHistory({
      orderId,
      fromStatus: lifecycle,
      toStatus: lifecycle,
      notes: `Full refund processed via webhook (Refund ID: ${refundEntity.id ?? "unknown"})`,
      changedById: "system",
    }).catch(() => null)

    return { applied: true, partialRefund: false, refunded: true, orderId, transactionId: tx?.id }
  }

  return { applied: true, ignored: true, reason: "unhandled_event", orderId }
}
