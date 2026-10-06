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
    if (!env.PAYMENT_WEBHOOK_SECRET) throw new Error("Missing PAYMENT_WEBHOOK_SECRET")
    const expected = crypto.createHmac("sha256", env.PAYMENT_WEBHOOK_SECRET).update(input.payload).digest("hex")
    if (!constantTimeEqual(expected, input.signature)) throw new Error("Invalid signature")
    return JSON.parse(input.payload) as unknown
  }
  return JSON.parse(input.payload) as unknown
}

export const processWebhookEvent = async (
  providerRaw: string,
  event: unknown,
  externalIdHint?: string | null,
) => {
  const provider = normalizeProvider(providerRaw)
  const obj = event as Record<string, unknown>
  const type = String(obj.type ?? obj.event ?? "")

  let orderId: string | null = null
  let externalId: string | null = externalIdHint ?? null
  let paid = false

  if (provider === "razorpay") {
    const payload = obj.payload as Record<string, unknown> | undefined
    const payment = payload?.payment as Record<string, unknown> | undefined
    const refund = payload?.refund as Record<string, unknown> | undefined
    const entity = (payment?.entity ?? payload?.entity ?? {}) as Record<string, unknown>
    const refundEntity = (refund?.entity ?? {}) as Record<string, unknown>
    const notes = (entity.notes ?? {}) as Record<string, unknown>
    orderId = typeof notes.orderId === "string" ? notes.orderId : null
    externalId = externalId ?? (typeof entity.order_id === "string" ? entity.order_id : null)
    if (!orderId && typeof refundEntity.payment_id === "string") {
      const client = getSupabaseAdmin()
      const { data: orderByPayment } = await client
        .from("Order")
        .select("id")
        .eq("paymentId", refundEntity.payment_id)
        .maybeSingle()
      orderId = typeof orderByPayment?.id === "string" ? orderByPayment.id : null
    }
    paid = type.includes("captured") || type.includes("paid")
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

  if (!orderId) return { applied: false, reason: "orderId_missing" }
  const client = getSupabaseAdmin()
  let tx: { id: string; status: string; externalId?: string | null } | null = null
  {
    let query = client
      .from("Transaction")
      .select("id,status,externalId")
      .eq("orderId", orderId)
      .order("createdAt", { ascending: false })
      .limit(1)
    if (externalId) {
      query = query.eq("externalId", externalId)
    }
    const { data, error } = await query.maybeSingle()
    if (!error && data?.id) {
      tx = {
        id: String(data.id),
        status: String(data.status ?? ""),
        externalId: data.externalId ? String(data.externalId) : null,
      }
    }
  }
  if (!tx) return { applied: false, reason: "transaction_not_found" }

  const nextTxStatus =
    type === "refund.processed" ? "refunded" : type === "payment.failed" ? "failed" : paid ? "paid" : "failed"
  if (tx.status === nextTxStatus) {
    return { applied: true, duplicate: true, paid, orderId, transactionId: tx.id }
  }

  const txUpdated = await updateTransactionStatusSupabase({
    transactionId: tx.id,
    status: nextTxStatus,
    gateway: provider,
    externalId: externalId ?? tx.externalId ?? undefined,
  })
  if (!txUpdated) throw new Error("supabase_transaction_status_write_failed")

  const orderUpdated = await setOrderRefundAndPaymentStatusSupabase({
    orderId,
    paymentStatus: type === "refund.processed" ? "REFUNDED" : paid ? "SUCCESS" : "FAILED",
    refundStatus: type === "refund.processed" ? "COMPLETED" : undefined,
  })
  if (!orderUpdated) throw new Error("supabase_order_payment_status_write_failed")

  if (type === "refund.processed") {
    const { data: refundRows, error: refundFetchError } = await client
      .from("RefundRecord")
      .select("id,status")
      .eq("orderId", orderId)
      .in("status", ["pending", "initiated", "processing"])
    if (refundFetchError) throw new Error("supabase_refund_record_fetch_failed")
    for (const row of refundRows ?? []) {
      const updated = await updateRefundRecordStatusSupabase(String((row as Record<string, unknown>).id), "completed")
      if (!updated) throw new Error("supabase_refund_record_status_write_failed")
    }
  }
  const order = await getOrderByIdSupabaseBasic(orderId)
  const lifecycle = latestLifecycleStatus(order as any)

  if (paid) {
    if (lifecycle === "cancelled") {
      // Late payment on cancelled order: DO NOT resurrect order or trigger shipment!
      await appendOrderStatusHistorySupabase({
        orderId,
        fromStatus: "cancelled",
        toStatus: "cancelled",
        notes: "Late payment webhook captured after cancellation; refund required",
        changedById: "system",
      }).catch(() => null)
      try {
        const amount = Number(order?.total ?? 0)
        const refund = await createRefund(orderId, amount, "Late payment after cancellation")
        await triggerRazorpayRefund({ refundRecordId: refund.id })
      } catch (e) {
        console.error("[processWebhookEvent] Auto-refund for cancelled order failed", e)
      }
    } else if (lifecycle === "confirmed") {
      // Order already approved by admin: trigger auto-sync if enabled
      await appendOrderStatusHistorySupabase({
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
    } else if (lifecycle === "admin_approval_pending") {
      // Order is awaiting admin approval: keep in admin_approval_pending!
      await appendOrderStatusHistorySupabase({
        orderId,
        fromStatus: "admin_approval_pending",
        toStatus: "admin_approval_pending",
        notes: "Payment captured via webhook; awaiting admin approval",
        changedById: "system",
      }).catch(() => null)
    }
  } else if (type === "payment.failed") {
    if (lifecycle !== "cancelled") {
      await appendOrderStatusHistorySupabase({
        orderId,
        fromStatus: lifecycle,
        toStatus: lifecycle,
        notes: "Payment failed via webhook",
        changedById: "system",
      }).catch(() => null)
    }
  }
  return { applied: true, paid, orderId, transactionId: tx.id }
}
