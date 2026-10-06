import { logActivity } from "@/src/server/modules/activity/activity.service"
import { emailTemplates, enqueueEmail } from "@/src/server/modules/notifications/email.service"
import { smsService } from "@/src/server/modules/sms/sms.service"
import { env } from "@/src/server/core/config/env"
import { markCartConverted } from "@/src/server/modules/abandoned-carts/recovery.service"
import {
  appendOrderStatusHistorySupabase,
  createOrderWithItemsSupabase,
  createOrderNoteSupabase,
  createTransactionSupabase,
  createShipmentSupabase,
  countCouponUsageByUserSupabase,
  countNonCancelledOrdersByUserSupabase,
  findOrderByPaymentRefSupabase,
  getCodSettlementSupabase,
  getCheckoutProductsSupabase,
  getCouponByCodeSupabase,
  getCouponByIdSupabase,
  getOrderByIdSupabaseBasic,
  getOrderAutoApproveSettingSupabase,
  getOrderWithOpsRelationsSupabase,
  getUserEmailSupabase,
  listOrderShipmentsSupabase,
  listOrdersSupabaseBasic,
  mirrorOrderStatusSupabase,
  orderExistsByIdSupabase,
  releaseInventorySupabase,
  reserveInventorySupabase,
  setOrderCancelReasonSupabase,
  setOrderReturnReasonSupabase,
  upsertCodSettlementSupabase,
  markShipmentDeliveredSupabase,
  upsertOrderFulfillmentSupabase,
} from "@/src/lib/db/orders"
import { logger } from "@/lib/logger"
import { enqueueOutboxEvent } from "@/src/server/modules/integrations/outbox.service"
import { assertMasterValueExists } from "@/src/server/modules/master/master.service"
import { syncOrderStatusFromShiprocket } from "@/src/server/modules/integrations/shiprocket.service"
import { safeSyncOrderShipmentToShiprocket } from "@/src/server/modules/shipping/shiprocket.orders"
import {
  totalPacksFromCheckoutLines,
} from "@/src/lib/shipping/ziply5-shipping"
import { calculateAuthoritativeShipping } from "@/src/server/modules/shipping/shipping-settings"
import { calculateOffers } from "@/src/server/modules/offers/offers.service"
import { getLatestTrackingSummariesForOrderIds } from "@/src/server/modules/orders/order-tracking.service"
import { pgQuery } from "@/src/server/db/pg"

export type OrderLifecycleStatus =
  | "pending"
  | "pending_payment"
  | "payment_success"
  | "admin_approval_pending"
  | "failed"
  | "confirmed"
  | "packed"
  | "shipped"
  | "delivered"
  | "cancel_requested"
  | "returned"
  | "return_requested"
  | "return_approved"
  | "refund_initiated"
  | "cancelled"

const allowedTransitions: Record<OrderLifecycleStatus, OrderLifecycleStatus[]> = {
  pending_payment: ["payment_success", "failed", "cancelled"],
  payment_success: ["admin_approval_pending", "confirmed", "cancelled"],
  admin_approval_pending: ["confirmed", "cancelled"],
  failed: ["payment_success", "cancelled"],
  pending: ["payment_success", "confirmed", "cancelled"],
  confirmed: ["packed", "cancel_requested", "cancelled"],
  packed: ["shipped", "cancel_requested", "cancelled"],
  shipped: ["delivered", "returned"],
  delivered: ["returned", "return_requested"],
  cancel_requested: ["cancelled", "confirmed"],
  returned: [],
  return_requested: ["return_approved", "returned", "delivered"],
  return_approved: ["refund_initiated", "returned"],
  refund_initiated: ["returned"],
  cancelled: [],
}

const internalOrderLifecycleStatuses = new Set<OrderLifecycleStatus>([
  "pending",
  "pending_payment",
  "payment_success",
  "admin_approval_pending",
  "failed",
  "confirmed",
  "packed",
  "shipped",
  "delivered",
  "cancel_requested",
  "returned",
  "return_requested",
  "return_approved",
  "refund_initiated",
  "cancelled",
])

const persistedOrderStatus = (status: OrderLifecycleStatus): "pending" | "confirmed" | "shipped" | "delivered" | "cancelled" => {
  if (status === "pending_payment" || status === "payment_success" || status === "admin_approval_pending" || status === "failed") return "pending"
  if (status === "cancel_requested") return "confirmed"
  if (status === "packed") return "confirmed"
  if (status === "returned" || status === "return_requested" || status === "return_approved" || status === "refund_initiated") return "delivered"
  return status
}

export const isAutoApproveOrdersEnabled = async () => {
  const value = await getOrderAutoApproveSettingSupabase()
  if (value == null) return false
  if (typeof value === "boolean") return value
  if (typeof value === "string") return value.toLowerCase() === "true"
  if (typeof value === "object" && value && "enabled" in value) {
    return Boolean((value as { enabled?: unknown }).enabled)
  }
  return false
}

const normalizePaymentStatus = (status?: string | null) => {
  const value = (status ?? "").toUpperCase()
  if (value === "PAID") return "SUCCESS"
  if (value === "PENDING") return "PENDING"
  if (value === "FAILED") return "FAILED"
  if (value === "REFUNDED") return "REFUNDED"
  if (value === "SUCCESS") return "SUCCESS"
  return "PENDING"
}

const deriveEffectivePaymentStatus = (order: { paymentStatus?: string | null; transactions?: Array<{ status?: string | null }> }) => {
  const normalized = normalizePaymentStatus(order.paymentStatus)
  const txStatuses = (order.transactions ?? []).map((tx) => (tx.status ?? "").toUpperCase())
  if (txStatuses.some((s) => ["PAID", "CAPTURED", "SUCCESS"].includes(s))) return "SUCCESS"
  if (txStatuses.some((s) => ["FAILED", "FAILURE"].includes(s))) return "FAILED"
  return normalized
}

const deriveLifecycleFromPayment = (status: string) => {
  if (status === "SUCCESS") return "confirmed" as const
  if (status === "FAILED") return "failed" as const
  return null
}

const orderCheckoutSelect = {
  id: true,
  userId: true,
  status: true,
  currency: true,
  subtotal: true,
  shipping: true,
  total: true,
  createdAt: true,
  updatedAt: true,
  createdById: true,
  managedById: true,
  customerAddress: true,
  customerName: true,
  customerPhone: true,
  paymentId: true,
  paymentMethod: true,
  paymentStatus: true,
  items: {
    select: {
      id: true,
      orderId: true,
      productId: true,
      quantity: true,
      unitPrice: true,
      lineTotal: true,
      product: { select: { id: true, name: true, slug: true } },
    },
  },
  transactions: true,
} as const

const orderListSelect = {
  id: true,
  userId: true,
  status: true,
  currency: true,
  subtotal: true,
  shipping: true,
  total: true,
  createdAt: true,
  updatedAt: true,
  customerAddress: true,
  customerName: true,
  customerPhone: true,
  paymentId: true,
  paymentMethod: true,
  paymentStatus: true,
  items: {
    select: {
      id: true,
      orderId: true,
      productId: true,
      quantity: true,
      unitPrice: true,
      lineTotal: true,
      product: { select: { id: true, name: true, slug: true } },
    },
  },
  transactions: true,
  shipments: { orderBy: { createdAt: "desc" as const }, take: 3, select: { id: true, carrier: true, trackingNo: true, shipmentStatus: true, shippedAt: true } },
  fulfillment: { select: { fulfillmentStatus: true, deliveredAt: true, shippedAt: true } },
  user: { select: { id: true, name: true, email: true } },
  returnRequests: { select: { id: true, status: true } },
  refunds: { select: { id: true, status: true, amount: true } },
  statusHistory: { orderBy: { changedAt: "desc" as const }, take: 6, select: { toStatus: true, changedAt: true } },
} as const

const orderDetailSelect = {
  id: true,
  userId: true,
  status: true,
  currency: true,
  subtotal: true,
  shipping: true,
  total: true,
  createdAt: true,
  updatedAt: true,
  createdById: true,
  managedById: true,
  customerAddress: true,
  customerName: true,
  customerPhone: true,
  paymentId: true,
  paymentMethod: true,
  paymentStatus: true,
  user: { select: { id: true, name: true, email: true } },
  items: {
    select: {
      id: true,
      orderId: true,
      productId: true,
      quantity: true,
      unitPrice: true,
      lineTotal: true,
      product: true,
    },
  },
  transactions: true,
  statusHistory: { orderBy: { changedAt: "desc" as const } },
  notes: { orderBy: { createdAt: "desc" as const } },
  fulfillment: true,
  shipments: { orderBy: { createdAt: "desc" as const } },
  returnRequests: { orderBy: { createdAt: "desc" as const }, include: { pickup: true, items: true } },
  refunds: { orderBy: { createdAt: "desc" as const } },
  invoice: true,
} as const

const getInitialLifecycleStatus = (_gateway: string, _paymentStatus?: string | null): OrderLifecycleStatus => {
  return "admin_approval_pending"
}

export const shouldAutoSyncOrders = () => process.env.ORDER_AUTO_SYNC_ENABLED === "true"

export const latestLifecycleStatus = (order: { status?: string | null; statusHistory?: Array<{ toStatus?: string | null }> }) =>
  (((order.statusHistory ?? [])[0]?.toStatus ?? order.status ?? "pending") as OrderLifecycleStatus)

export const triggerShiprocketAutoSync = async (input: {
  orderId: string
  actorId?: string
  source: "order_created" | "status_confirmed" | "payment_success" | "admin_approval"
}) => {
  if (!shouldAutoSyncOrders()) {
    console.log("[shiprocket][auto_sync.disabled]", {
      orderId: input.orderId,
      source: input.source,
    })
    return
  }
  const actorId = input.actorId ?? "system"
  console.log("[shiprocket][auto_sync.triggered]", {
    orderId: input.orderId,
    actorId,
    source: input.source,
  })
  try {
    const result = await safeSyncOrderShipmentToShiprocket(input.orderId, actorId)
    if (result.status === "skipped") {
      console.log("[shiprocket][auto_sync.skipped]", {
        orderId: input.orderId,
        source: input.source,
        reason: (result as { reason?: string }).reason ?? "skipped",
        skippedReason: (result as { skippedReason?: string }).skippedReason ?? "unknown",
      })
      return
    }
    if (result.status === "failed") {
      console.error("[shiprocket][auto_sync.failed]", {
        orderId: input.orderId,
        source: input.source,
        reason: (result as { reason?: string }).reason ?? "failed",
      })
      return
    }
    console.log("[shiprocket][auto_sync.success]", {
      orderId: input.orderId,
      source: input.source,
      status: result.status,
    })
  } catch (error) {
    console.error("[shiprocket][auto_sync.failed]", {
      orderId: input.orderId,
      source: input.source,
      reason: error instanceof Error ? error.message : "unknown",
    })
  }
}

export const releaseOrderInventory = async (orderId: string) => {
  const order = await getOrderByIdSupabaseBasic(orderId)
  if (!order || !Array.isArray(order.items) || !order.items.length) return
  await releaseInventorySupabase(
    order.items.map((line: any) => ({
      productId: String(line.productId ?? line.product?.id ?? ""),
      variantId: line.variantId ? String(line.variantId) : null,
      quantity: Number(line.quantity ?? 0),
    }))
  )
}

type ComboChildResolved = {
  productId: string
  variantId: string | null
  unitPrice: number
  stock: number
}

const resolveComboChildrenForCheckout = async (input: {
  comboRef: string
  quantity: number
  comboUnitPriceHint: number
}) => {
  const bundleRows = await pgQuery<Array<{ id: string; slug: string; isActive: boolean }>>(
    `SELECT id, slug, "isActive" as "isActive" FROM "Bundle" WHERE id = $1 OR slug = $1 LIMIT 1`,
    [input.comboRef],
  )
  const bundle = bundleRows[0]
  if (!bundle || bundle.isActive !== true) {
    throw new Error("Combo product is no longer available.")
  }
  const childRows = await pgQuery<
    Array<{
      productId: string
      productName: string
      productStatus: string
      productIsActive: boolean | null
      variantId: string | null
      variantPrice: number | null
      variantStock: number | null
      variantName: string | null
      variantIsDefault: boolean | null
      productPrice: number | null
      productTotalStock: number | null
    }>
  >(
    `
      SELECT
        bp."productId" as "productId",
        p.name as "productName",
        p.status as "productStatus",
        p."isActive" as "productIsActive",
        pv.id as "variantId",
        pv.price as "variantPrice",
        pv.stock as "variantStock",
        pv.name as "variantName",
        pv."isDefault" as "variantIsDefault",
        p.price as "productPrice",
        p."totalStock" as "productTotalStock"
      FROM "BundleProduct" bp
      LEFT JOIN "Product" p ON p.id = bp."productId"
      LEFT JOIN "ProductVariant" pv ON pv."productId" = p.id
      WHERE bp."bundleId" = $1
      ORDER BY bp."createdAt" ASC, COALESCE(pv."isDefault", false) DESC, pv."createdAt" ASC
    `,
    [bundle.id],
  )
  const grouped = new Map<string, typeof childRows>()
  for (const row of childRows) {
    const key = String(row.productId ?? "").trim()
    if (!key) continue
    const list = grouped.get(key) ?? []
    list.push(row)
    grouped.set(key, list)
  }
  const childProductIds = [...grouped.keys()]
  if (childProductIds.length < 1 || childProductIds.length > 3) {
    console.error("[combo][validation.failed]", {
      comboId: bundle.id,
      comboSlug: bundle.slug,
      childProductIds,
      reason: "combo_child_count_invalid",
    })
    throw new Error("Combo product is no longer available.")
  }
  const children: ComboChildResolved[] = []
  const stockCaps: number[] = []
  for (const productId of childProductIds) {
    const rows = grouped.get(productId) ?? []
    const first = rows[0]
    if (!first) throw new Error("One of the combo products is unavailable.")
    if (!first.productName) {
      console.error("[combo][validation.failed]", { comboId: bundle.id, productId, reason: "product_deleted_or_missing" })
      throw new Error("Product has been removed.")
    }
    const productStatus = String(first.productStatus ?? "").toLowerCase()
    if (productStatus !== "published" || first.productIsActive === false) {
      console.error("[combo][validation.failed]", { comboId: bundle.id, productId, reason: "product_inactive" })
      throw new Error("One of the combo products is unavailable.")
    }
    const validVariants = rows.filter(
      (row) => Boolean(row.variantId) && Number(row.variantStock ?? 0) > 0,
    )
    if (validVariants.length > 0) {
      const chosen = validVariants.find((v) => v.variantIsDefault) ?? validVariants[0]
      const available = Math.floor(Number(chosen.variantStock ?? 0))
      if (available <= 0) {
        throw new Error("Product is out of stock.")
      }
      children.push({
        productId,
        variantId: chosen.variantId,
        unitPrice: Number(chosen.variantPrice ?? 0),
        stock: available,
      })
      stockCaps.push(available)
      continue
    }
    const variantStock = Math.floor(Number(first.variantStock ?? 0))
    const productTotalStock = Math.floor(Number(first.productTotalStock ?? 0))
    const fallbackStock = variantStock > 0 ? variantStock : productTotalStock
    const productPrice = Number(first.productPrice ?? 0)
    if (fallbackStock <= 0) {
      console.error("[combo][validation.failed]", { comboId: bundle.id, productId, reason: "no_variant_stock" })
      throw new Error("Selected variant is unavailable.")
    }
    children.push({
      productId,
      variantId: null,
      unitPrice: productPrice,
      stock: fallbackStock,
    })
    stockCaps.push(fallbackStock)
  }
  const maxComboQty = Math.min(...stockCaps)
  if (!Number.isFinite(maxComboQty) || maxComboQty <= 0 || maxComboQty < input.quantity) {
    console.error("[combo][validation.failed]", {
      comboId: bundle.id,
      comboSlug: bundle.slug,
      requestedQty: input.quantity,
      maxComboQty,
      childProductIds,
      reason: "combo_insufficient_stock",
    })
    throw new Error("Combo product is no longer available.")
  }
  const comboUnit = Math.max(0, Number(input.comboUnitPriceHint ?? 0))
  if (children.length > 0 && comboUnit > 0) {
    const even = Number((comboUnit / children.length).toFixed(2))
    let allocated = 0
    for (let idx = 0; idx < children.length; idx += 1) {
      if (idx === children.length - 1) {
        children[idx].unitPrice = Number((comboUnit - allocated).toFixed(2))
      } else {
        children[idx].unitPrice = even
        allocated += even
      }
    }
  }
  return { bundleId: bundle.id, bundleSlug: bundle.slug, children, maxComboQty }
}

export async function validatePromoCode(input: { code?: string, id?: string }, subtotal: number, userId?: string) {
  let coupon = null;
  if (input.id) {
    coupon = await getCouponByIdSupabase(input.id);
  } else if (input.code) {
    coupon = await getCouponByCodeSupabase(input.code);
  }

  console.log(`[orders.service.validatePromoCode] Validating ${input.id ? `id=${input.id}` : `code=${input.code}`} for subtotal=${subtotal}, userId=${userId}`);

  if (!coupon) {
    console.log(`[orders.service.validatePromoCode] Coupon not found`);
    return { valid: false, error: 'Coupon not found' };
  }

  if (!coupon.active) {
    console.log(`[orders.service.validatePromoCode] Coupon is inactive`);
    return { valid: false, error: 'This coupon is no longer active' };
  }

  if (coupon.endsAt && new Date() > coupon.endsAt) {
    console.log(`[orders.service.validatePromoCode] Coupon expired at ${coupon.endsAt}`);
    return { valid: false, error: 'This coupon has expired' };
  }

  if (coupon.minOrderAmount && subtotal < Number(coupon.minOrderAmount)) {
    console.log(`[orders.service.validatePromoCode] Subtotal ${subtotal} is less than minOrderAmount ${coupon.minOrderAmount}`);
    return { valid: false, error: `Minimum order amount for this coupon is ₹${coupon.minOrderAmount}` };
  }

  if (coupon.firstOrderOnly && userId) {
    const priorOrders = await countNonCancelledOrdersByUserSupabase(userId)
    if (priorOrders > 0) {
      console.log(`[orders.service.validatePromoCode] User ${userId} has prior orders, coupon is first-order only`);
      return { valid: false, error: 'This promo code is for first-time orders only' };
    }
  }

  if (coupon.usageLimitPerUser && userId) {
    const userUsages = await countCouponUsageByUserSupabase({ userId, couponId: coupon.id })
    if (userUsages >= coupon.usageLimitPerUser) {
      console.log(`[orders.service.validatePromoCode] User ${userId} reached usage limit ${coupon.usageLimitPerUser}`);
      return { valid: false, error: 'Usage limit reached for this promo code' };
    }
  }

  const discount = coupon.discountType === 'percentage'
    ? subtotal * (Number(coupon.discountValue) / 100)
    : Number(coupon.discountValue);
  const finalDiscount = Math.min(discount, Number(coupon.maxDiscountAmount ?? Infinity));

  return {
    valid: true,
    discountAmount: finalDiscount,
    coupon,
    appliedCouponId: coupon.id
  };
}

export const createOrderFromCheckout = async (input: {
  items: { productId: string; variantId?: string | null; sku?: string | null; quantity: number; price?: number; subtotal?: number; tax?: number }[]
  userId?: string | null
  shipping?: number
  currency?: string
  couponCode?: string
  gateway: string
  subtotal?: number
  discount?: number
  tax?: number
  total?: number
  appliedCouponId?: string | null
  savingAmount?: number

  // 🔥 ADD THIS
  billingAddress?: {
    fullName: string
    email?: string
    line1: string
    city: string
    state: string
    postalCode: string
    country: string
    phone?: string
  }

  paymentStatus?: string
  paymentId?: string
  sessionKey?: string | null
  totalItemsUsedForShipping?: number | null
}) => {
  console.log(`[Order Service Debug] Incoming createOrderFromCheckout payload:`, JSON.stringify(input, null, 2))
  if (input.paymentId?.trim()) {
    // For COD, paymentId is not provided initially, so this check should only apply to online payments
    // or if a paymentId is explicitly passed for a retry.
    const isCod = input.gateway.trim().toLowerCase() === "cod";

    // If it's a COD order, we don't expect a paymentId to find an existing order.
    // If it's an online payment and paymentId is present, check for existing order.
    if (!isCod) {
      const existingId = await findOrderByPaymentRefSupabase({
        paymentId: input.paymentId.trim(),
        userId: input.userId ?? null,
      })
      if (existingId) {
        const existing = await getOrderByIdSupabaseBasic(existingId)
        if (existing) return existing
      }
    }
  }

  const initialLifecycleStatus = getInitialLifecycleStatus(input.gateway, input.paymentStatus)
  const initialPersistedStatus = persistedOrderStatus(initialLifecycleStatus)
  const shipping = input.shipping ?? 0
  const totalItemsUsedForShipping = totalPacksFromCheckoutLines(input.items)
  if (input.totalItemsUsedForShipping != null && input.totalItemsUsedForShipping !== totalItemsUsedForShipping) {
    throw new Error("Declared item count for shipping does not match cart lines.")
  }
  const productIds = [...new Set(input.items.map((i) => i.productId).filter(Boolean))]
  const products = await getCheckoutProductsSupabase({ slugs: [], productIds })
  const byId = Object.fromEntries(products.map((p) => [p.id, p]))
  let subtotal = 0
  let taxTotal = 0
  const lines: { productId: string; variantId?: string | null; sku?: string | null; quantity: number; unitPrice: number; lineTotal: number; tax: number }[] = []

  for (const line of input.items) {
    const p = byId[line.productId]
    if (!p) {
      const combo = await resolveComboChildrenForCheckout({
        comboRef: line.productId,
        quantity: line.quantity,
        comboUnitPriceHint: Number(line.price ?? 0),
      }).catch(() => null)
      if (!combo) {
        throw new Error(`Product has been removed.`)
      }
      for (const child of combo.children) {
        const lineTotal = Number((child.unitPrice * line.quantity).toFixed(2))
        lines.push({
          productId: child.productId,
          variantId: child.variantId,
          sku: line.sku ?? null,
          quantity: line.quantity,
          unitPrice: child.unitPrice,
          lineTotal,
          tax: 0,
        })
        subtotal += lineTotal
      }
      continue
    }

    const variantId = line.variantId ?? null
    let unit = Number(p.price)
    if (p.type === "variant") {
      const fallback = p.variants.find((v) => v.isDefault) ?? p.variants[0]
      const chosen = variantId ? p.variants.find((v) => v.id === variantId) : fallback
      if (!chosen) {
        throw new Error(`Variant is required for product: ${p.slug}`)
      }
      if (chosen.stock < line.quantity) {
        throw new Error("Product is out of stock.")
      }
      unit = Number(chosen.price)
    }
    const lineTotal = Number((unit * line.quantity).toFixed(2))
    const lineTax = Math.max(0, Number(line.tax ?? 0))
    lines.push({
      productId: p.id,
      variantId,
      sku: line.sku ?? null,
      quantity: line.quantity,
      unitPrice: unit,
      lineTotal,
      tax: lineTax,
    })
    subtotal += lineTotal
    taxTotal += lineTax
  }

  let discount = Math.max(0, Number(input.discount ?? 0))
  let appliedCouponId: string | null = input.appliedCouponId ?? null

  if (appliedCouponId || input.couponCode?.trim()) {
    const validation = await validatePromoCode(
      { id: appliedCouponId ?? undefined, code: input.couponCode?.trim() },
      subtotal,
      input.userId ?? undefined
    )
    if (!validation.valid) throw new Error(validation.error)
    discount = Number(validation.discountAmount ?? 0)
    appliedCouponId = validation.appliedCouponId ?? null
  }

  const shippingRes = await calculateAuthoritativeShipping(subtotal)
  if (!shippingRes.ok) {
    throw new Error(shippingRes.error ?? "Failed to calculate shipping for order subtotal.")
  }

  let authoritativeShipping = shippingRes.shippingCharge

  // Check if an offer adjusts shipping (e.g. shipping_discount offers or free shipping promotions)
  try {
    const offerCalc = await calculateOffers({
      userId: input.userId ?? null,
      items: lines.map((l) => ({
        productId: l.productId,
        variantId: l.variantId,
        quantity: l.quantity,
        unitPrice: l.unitPrice,
      })),
      cartSubtotal: subtotal,
      shippingAmount: authoritativeShipping,
      couponCode: input.couponCode?.trim() || null,
    })
    if (offerCalc && typeof offerCalc.adjustedShipping === "number") {
      authoritativeShipping = offerCalc.adjustedShipping
    }
  } catch {
    // Keep base authoritative shipping if offers calculation fails
  }

  // Anti-tamper: reject client-tampered shipping charges
  if (input.shipping != null && Math.abs(Number(input.shipping) - authoritativeShipping) > 0.02) {
    throw new Error(
      `Shipping charge mismatch. Authoritative shipping is ₹${authoritativeShipping.toFixed(2)}, but received ₹${Number(input.shipping).toFixed(2)}. Please refresh checkout.`,
    )
  }

  const finalShipping = authoritativeShipping
  const total = Math.max(subtotal + finalShipping + taxTotal - discount, 0)

  await reserveInventorySupabase(lines.map((line) => ({ productId: line.productId, variantId: line.variantId, quantity: line.quantity })))

  const orderData = {
    userId: input.userId ?? null,
    customerName: input.billingAddress?.fullName ?? null,
    customerPhone: input.billingAddress?.phone ?? null,
    customerEmail: input.billingAddress?.email ?? null,
    customerAddress: input.billingAddress
      ? `${input.billingAddress.line1}, ${input.billingAddress.city}, ${input.billingAddress.state}, ${input.billingAddress.postalCode}, ${input.billingAddress.country}`
      : null,
    paymentStatus: normalizePaymentStatus(input.paymentStatus),
    paymentId: input.paymentId ?? null,
    paymentMethod: input.gateway,
    status: initialPersistedStatus,
    currency: input.currency ?? "INR",
    appliedCouponId,
    couponCode: input.couponCode?.trim() || null,
    subtotal,
    discount,
    tax: taxTotal,
    shippingCharge: finalShipping,
    shipping: finalShipping, // Keeping both for backward/forward compatibility
    total,
    totalItemsUsedForShipping,
    savingAmount: input.savingAmount ?? 0,
  };

  const itemRows = lines.map((l) => ({
    productId: l.productId,
    variantId: l.variantId ?? null,
    sku: l.sku ?? null,
    quantity: l.quantity,
    unitPrice: l.unitPrice,
    subtotal: l.lineTotal,
    tax: l.tax,
    lineTotal: l.lineTotal,
  }));

  console.log("[orders.service] Attempting to create order with Supabase payload:", JSON.stringify({ orderData, itemCount: itemRows.length }, null, 2));

  const created = await createOrderWithItemsSupabase({ orderData, itemRows })
  if (!created) throw new Error("Supabase order insert failed")

  // Use the data we already have instead of a heavy re-fetch to avoid timeouts
  const order = {
    ...orderData,
    id: created.id,
    user: (orderData as any).user || null
  } as any
  console.log("Creating order with data:")
  await appendOrderStatusHistorySupabase({
    orderId: created.id,
    fromStatus: initialLifecycleStatus,
    toStatus: initialLifecycleStatus,
    notes: "Order created; awaiting admin approval",
    changedById: input.userId ?? null,
  }).catch(() => null)
  console.log("Created order with ID:", created.id)
  const transactionStatus = input.paymentStatus === "paid" ? "paid" : input.paymentStatus === "failed" ? "failed" : "pending"
  console.log("Recording initial transaction with status:", transactionStatus)
  await createTransactionSupabase({
    orderId: String(order.id),
    gateway: input.gateway,
    amount: total,
    status: transactionStatus,
    externalId: input.paymentId ?? null,
  }).catch(() => null)
  console.log("Initial transaction recorded")
  console.log("Order creation process completed for order ID:", order.id, "with final status:", order.status, "and payment status:", order.paymentStatus)
  await logActivity({
    actorId: input.userId ?? undefined,
    action: "order.create",
    entityType: "Order",
    entityId: order.id,
    metadata: { itemCount: lines.length, total },
  })
  console.log("Activity logged for order creation", { orderId: order.id, userId: input.userId ?? null })
  console.log(`[Order Service] createOrderFromCheckout: order.status="${order.status}", order.paymentStatus="${order.paymentStatus}", phone="${order.customerPhone}"`)
  const normalizedStatus = String(order.status).toLowerCase()
  let customerEmailRaw = (order as any).customerEmail || input.billingAddress?.email || (order as any).user?.email
  if (!customerEmailRaw && input.userId) {
    customerEmailRaw = await getUserEmailSupabase(input.userId).catch(() => null)
  }
  const customerEmail = customerEmailRaw?.trim()
  const customerName = order.customerName || "Customer"

  if (normalizedStatus === "confirmed") {
    console.log(`[Order Service] Triggering ORDER_CONFIRM for order ${order.id}. Email: ${customerEmail}, Phone: ${order.customerPhone}`)

    // Send Confirmation SMS
    if (order.customerPhone) {
      await smsService.send({
        mobile: order.customerPhone,
        templateKey: "ORDER_CONFIRM",
        variables: [customerName, String(order.id)],
      }).catch(e => console.error("Order confirm SMS failed", e))
    }

    // Send Confirmation Email
    if (customerEmail && !customerEmail.endsWith("@ziply5.local")) {
      const mail = emailTemplates.orderPlaced(customerName, String(order.id), String(total))
      console.log(`[Order Service] Enqueuing orderPlaced email to ${customerEmail}`)
      await enqueueEmail({ to: customerEmail, ...mail }).catch(e => console.error("Order confirm email failed", e))
    } else {
      console.warn(`[Order Service] Skipping confirmation email: ${customerEmail ? 'Internal domain' : 'Missing email'}`)
    }
  }

  if (String(order.paymentStatus).toUpperCase() === "SUCCESS" || String(input.paymentStatus).toUpperCase() === "PAID") {
    console.log(`[Order Service] Triggering ORDER_PAID for order ${order.id}. Email: ${customerEmail}, Phone: ${order.customerPhone}`)

    // Send Payment Success SMS
    if (order.customerPhone) {
      await smsService.send({
        mobile: order.customerPhone,
        templateKey: "ORDER_PAID",
        variables: [String(total), String(order.id)],
      }).catch(e => console.error("Order payment SMS failed", e))
    }

    // Send Payment Success Email
    if (customerEmail && !customerEmail.endsWith("@ziply5.local")) {
      const mail = emailTemplates.orderPaid(customerName, String(order.id), String(total))
      console.log(`[Order Service] Enqueuing orderPaid email to ${customerEmail}`)
      await enqueueEmail({ to: customerEmail, ...mail }).catch(e => console.error("Order payment email failed", e))
    } else {
      console.warn(`[Order Service] Skipping payment email: ${customerEmail ? 'Internal domain' : 'Missing email'}`)
    }
  }
  console.log("Enqueuing outbox event for order.created")
  await enqueueOutboxEvent({
    eventType: "order.created",
    aggregateType: "order",
    aggregateId: order.id,
    payload: { orderId: order.id, total, currency: input.currency ?? "INR" },
  }).catch(() => null)
  setImmediate(() => {
    console.log("[shiprocket][auto_sync.skip_order_created]", {
      orderId: String(order.id),
      reason: "awaiting_admin_approval",
    })
  })
  console.log("Outbox event enqueued for order.created")
  await markCartConverted({
    sessionKey: input.sessionKey,
    email: input.billingAddress?.email ?? null,
    mobile: input.billingAddress?.phone ?? null,
    orderId: order.id,
    revenue: total,
    channel: "checkout",
  }).catch(() => null)

  console.log("Finished createOrderFromCheckout with order ID:", created.id)
  return order
}
const autoSyncFromPayment = async (orderId: string, currentStatus: string, paymentStatus: string) => {
  const lifecycle = currentStatus.toLowerCase() as OrderLifecycleStatus
  // Don't auto-sync or alter status if awaiting approval or already in terminal/advanced status
  if (["admin_approval_pending", "cancelled", "returned", "shipped", "delivered", "refund_initiated", "return_requested"].includes(lifecycle)) {
    return
  }
  const normalizedPayment = normalizePaymentStatus(paymentStatus)
  if (normalizedPayment === "SUCCESS") {
    if (lifecycle === "confirmed") {
      if (shouldAutoSyncOrders()) {
        void triggerShiprocketAutoSync({
          orderId,
          actorId: "system",
          source: "payment_success",
        })
      }
      return
    }
    return
  }
  const derived = deriveLifecycleFromPayment(normalizedPayment)
  if (!derived || lifecycle === derived) return
  await updateOrderStatus(orderId, derived, undefined, {
    reasonCode: "payment_status_sync",
    note: `Auto-updated from payment status ${paymentStatus}`,
  }).catch(() => null)
}

export const listOrders = async (
  page: number,
  limit: number,
  role: string,
  userId: string,
) => {
  if (process.env.SUPABASE_ORDERS_READ_ENABLED !== "true") {
    throw new Error("SUPABASE_ORDERS_READ_ENABLED must be true")
  }
  const result = await listOrdersSupabaseBasic({ page, limit, role, userId })
  const items = result.items
  const total = result.total

  let hydratedItems = items.map((order) => ({
    ...order,
    paymentStatus: deriveEffectivePaymentStatus(order),
  }))

  if (role === "customer" && hydratedItems.length) {
    const summaries = await getLatestTrackingSummariesForOrderIds(hydratedItems.map((o) => String(o.id)))
    const byId = new Map(summaries.map((s) => [s.orderId, s]))
    hydratedItems = hydratedItems.map((o) => ({
      ...o,
      trackingSummary: byId.get(String(o.id)) ?? null,
    }))
  }

  if (shouldAutoSyncOrders()) {
    await Promise.allSettled(
      hydratedItems.map(async (order) => {
        await autoSyncFromPayment(String(order.id), String(order.status), String(order.paymentStatus))
        await syncOrderStatusFromShiprocket(String(order.id))
      }),
    )
  }

  return { items: hydratedItems, total, page, limit }
}

export const getOrderById = async (id: string) => {
  if (process.env.SUPABASE_ORDERS_READ_ENABLED !== "true") {
    throw new Error("SUPABASE_ORDERS_READ_ENABLED must be true")
  }
  const exists = await orderExistsByIdSupabase(id)
  if (!exists) return null
  const order = await getOrderByIdSupabaseBasic(id)
  if (!order) return null
  const hydrated = {
    ...order,
    paymentStatus: deriveEffectivePaymentStatus(order as any),
  }
  if (shouldAutoSyncOrders()) {
    await autoSyncFromPayment(String(hydrated.id), String(hydrated.status), String(hydrated.paymentStatus))
    await syncOrderStatusFromShiprocket(String(hydrated.id))
  }
  return hydrated
}

export const getOrderForActor = async (id: string, role: string, userId: string) => {
  const order = await getOrderById(id)
  if (!order) return null
  if (role === "admin" || role === "super_admin") return order
  if (role === "customer" && order.userId === userId) return order
  return null
}

export const updateOrderStatus = async (
  id: string,
  status: OrderLifecycleStatus,
  actorId?: string,
  options?: { reasonCode?: string; note?: string },
) => {
  console.log(`[STATUS UPDATE DEBUG] Order ID: ${id}, New Status: ${status}, Options: ${JSON.stringify(options)}`)

  // SMS Notifications - Moved to top for reliability
  try {
    const order = await getOrderByIdSupabaseBasic(id)
    if (order && order.customerPhone) {
      console.log(`[Order Service] Checking SMS for status: "${status}" on order ${order.id}. Customer phone: ${order.customerPhone}`)
      const normalizedStatus = String(status).toLowerCase()
      if (normalizedStatus === "confirmed") {
        console.log(`[Order Service] Triggering ORDER_CONFIRM SMS for order ${order.id}`)
        await smsService.send({
          mobile: order.customerPhone,
          templateKey: "ORDER_CONFIRM",
          variables: [order.customerName || "Customer", String(order.id)],
        }).catch(e => console.error("Order confirm SMS failed", e))
      } else if (normalizedStatus === "cancelled") {
        console.log(`[Order Service] Triggering ORDER_CANCEL SMS for order ${order.id}`)
        await smsService.send({
          mobile: order.customerPhone,
          templateKey: "ORDER_CANCEL",
          variables: [String(order.id)],
        }).catch(e => console.error("Order cancel SMS failed", e))
      } else if (normalizedStatus === "payment_success") {
        console.log(`[Order Service] Triggering ORDER_PAID SMS for order ${order.id}`)
        await smsService.send({
          mobile: order.customerPhone,
          templateKey: "ORDER_PAID",
          variables: [String(order.total), String(order.id)],
        }).catch(e => console.error("Order payment SMS failed", e))
      }
    }
  } catch (err) {
    console.error("[SMS Trigger Error]", err)
  }

  console.log(`[STATUS UPDATE DEBUG] Order ID: ${id}, New Status: ${status}`)

  const allowed = internalOrderLifecycleStatuses.has(status) || await assertMasterValueExists("ORDER_STATUS", status)
  if (!allowed) {
    console.warn(`[STATUS UPDATE WARNING] Status "${status}" not found in ORDER_STATUS master values. Continuing anyway to ensure notifications and flow consistency.`);
  }

  const existing = await getOrderByIdSupabaseBasic(id)
  if (!existing) {
    console.error(`[STATUS UPDATE ERROR] Order not found for ID: ${id}`)
    throw new Error("Order not found")
  }

  const fromStatus = latestLifecycleStatus(existing)
  const paymentStatus = normalizePaymentStatus((existing as any).paymentStatus)
  const paymentMethod = String((existing as any).paymentMethod ?? "").toLowerCase()

  if (status === "confirmed" && paymentStatus !== "SUCCESS" && paymentMethod !== "cod" && fromStatus !== "admin_approval_pending") {
    console.error(`[STATUS UPDATE ERROR] Cannot move to CONFIRMED without SUCCESS payment status. Current: ${paymentStatus}`)
    throw new Error("Order cannot move to CONFIRMED unless payment_status = SUCCESS")
  }
  if (status !== fromStatus && !allowedTransitions[fromStatus]?.includes(status)) {
    console.error(`[STATUS UPDATE ERROR] Invalid transition: ${fromStatus} -> ${status}`)
    throw new Error(`Invalid status transition: ${fromStatus} -> ${status}`)
  }

  const targetPersistedStatus = persistedOrderStatus(status)
  console.log(`[STATUS UPDATE DEBUG] From: ${fromStatus}, To: ${status}, Persisting As: ${targetPersistedStatus}`)

  const statusApplied = await mirrorOrderStatusSupabase(id, targetPersistedStatus)
  if (!statusApplied) {
    console.error(`[STATUS UPDATE ERROR] Supabase update failed for Order ID: ${id} to status: ${targetPersistedStatus}`)
    throw new Error("Supabase order status update failed")
  }

  console.log(`[STATUS UPDATE DEBUG] Successfully mirrored status to Supabase for Order ${id}`)

  await appendOrderStatusHistorySupabase({
    orderId: id,
    fromStatus,
    toStatus: status,
    reasonCode: options?.reasonCode ?? null,
    notes: options?.note ?? null,
    changedById: actorId ?? null,
  })
  const fulfillmentStatusMap: Partial<Record<OrderLifecycleStatus, string>> = {
    pending: "pending",
    confirmed: "confirmed",
    packed: "packed",
    shipped: "shipped",
    delivered: "delivered",
    returned: "returned",
    cancelled: "cancelled",
  }
  await upsertOrderFulfillmentSupabase({
    orderId: id,
    fulfillmentStatus: fulfillmentStatusMap[status] ?? status,
    packedAt: status === "packed" ? new Date() : undefined,
    shippedAt: status === "shipped" ? new Date() : undefined,
    deliveredAt: status === "delivered" ? new Date() : undefined,
  })
  const order = await getOrderByIdSupabaseBasic(id)
  if (!order) throw new Error("Order not found after status update")
  console.log(`[STATUS UPDATE SUCCESS] Order ID: ${order.id}, Final Persisted Status: ${order.status}`)

  await logActivity({
    actorId: actorId ?? undefined,
    action: "order.status",
    entityType: "Order",
    entityId: id,
    metadata: { status },
  })

  await enqueueOutboxEvent({
    eventType: "order.status.updated",
    aggregateType: "order",
    aggregateId: id,
    payload: { orderId: id, fromStatus, toStatus: status, reasonCode: options?.reasonCode ?? null },
  }).catch(() => null)

  let customerEmailRaw = (order as any).customerEmail || (order as any).user?.email
  if (!customerEmailRaw && order.userId) {
    customerEmailRaw = await getUserEmailSupabase(order.userId).catch(() => null)
  }
  const customerEmail = customerEmailRaw?.trim()
  const customerName = order.customerName || "Customer"

  if (customerEmail && !customerEmail.endsWith("@ziply5.local")) {
    let mail;
    if (status === "confirmed") {
      mail = emailTemplates.orderPlaced(customerName, id, String(order.total || 0));
    } else if (status === "payment_success") {
      mail = emailTemplates.orderPaid(customerName, id, String(order.total || 0));
    } else {
      mail = emailTemplates.orderStatus(customerName, id, status);
    }

    console.log(`[Email] Sending ${status} update for ${customerEmail}`)
    await enqueueEmail({ to: customerEmail, ...mail }).catch(e => console.error("Order status email failed", e))
  } else {
    console.warn(`[Order Service] Skipping status email for order ${id} (status: ${status}): ${customerEmail ? 'Internal domain' : 'Missing email'}`)
  }

  const maybePhone = (order as any).customerPhone
  if (maybePhone) {
    let smsBody = ""

    if (status === "shipped") {
      smsBody = `Hi, your Ziply5 order #${id} has been shipped. Track your package here: ${env.CDN_BASE_URL}/orders/${id}`
    } else if (status === "delivered") {
      smsBody = `Hi, your Ziply5 order #${id} has been delivered. We hope you enjoy your delicious meal!`
    }

    if (smsBody) {
      smsService.send({
        mobile: maybePhone,
        templateKey: status === "shipped" ? "ORDER_CONFIRM" : "ORDER_CONFIRM", // Fallback or add keys
        variables: [order.customerName || "Customer", String(order.id)],
        body: smsBody,
      }).catch(err => console.error("Order status SMS failed", err))
    }
  }

  if (status === "confirmed") {
    setImmediate(() => {
      void triggerShiprocketAutoSync({
        orderId: id,
        actorId: actorId ?? "system",
        source: "status_confirmed",
      })
    })
  }

  return order
}

export const setOrderCancelReason = async (orderId: string, reason: string) => {
  if (process.env.SUPABASE_ORDERS_WRITE_ENABLED !== "true") {
    throw new Error("SUPABASE_ORDERS_WRITE_ENABLED must be true")
  }
  const updated = await setOrderCancelReasonSupabase(orderId, reason)
  if (!updated) throw new Error("Supabase order cancel reason update failed")
}

export const setOrderReturnReason = async (orderId: string, reason: string) => {
  if (process.env.SUPABASE_ORDERS_WRITE_ENABLED !== "true") {
    throw new Error("SUPABASE_ORDERS_WRITE_ENABLED must be true")
  }
  const updated = await setOrderReturnReasonSupabase(orderId, reason)
  if (!updated) throw new Error("Supabase order return reason update failed")
}

export const addOrderNote = async (input: {
  orderId: string
  note: string
  actorId: string
  isInternal?: boolean
}) => {
  const order = await getOrderByIdSupabaseBasic(input.orderId)
  if (!order) throw new Error("Order not found")
  const cleanedNote = input.note.trim()
  const internal = input.isInternal ?? true
  if (process.env.SUPABASE_ORDERS_WRITE_ENABLED !== "true") {
    throw new Error("SUPABASE_ORDERS_WRITE_ENABLED must be true")
  }
  const created = await createOrderNoteSupabase({
    orderId: input.orderId,
    note: cleanedNote,
    actorId: input.actorId,
    isInternal: internal,
  })
  if (!created) throw new Error("Supabase order note create failed")
  await logActivity({
    actorId: input.actorId,
    action: "order.note.create",
    entityType: "Order",
    entityId: input.orderId,
    metadata: { noteId: created.id, isInternal: created.isInternal },
  })
  return created
}

export const listOrderShipments = async (orderId: string) => {
  const order = await getOrderByIdSupabaseBasic(orderId)
  if (!order) throw new Error("Order not found")
  return listOrderShipmentsSupabase(orderId)
}

export const createOrderShipment = async (input: {
  orderId: string
  actorId: string
  carrier: string
  shipmentNo?: string
  trackingNo?: string
  itemAllocations: Array<{ orderItemId: string; quantity: number }>
}) => {
  const order = await getOrderWithOpsRelationsSupabase(input.orderId)
  if (!order) throw new Error("Order not found")
  const paymentStatus = normalizePaymentStatus(order.paymentStatus)
  const fromStatus = ((order.statusHistory?.[0] as any)?.toStatus as OrderLifecycleStatus | undefined) ??
    (order.status as OrderLifecycleStatus)
  if (["cancelled", "returned", "delivered"].includes(fromStatus)) {
    throw new Error("Shipment cannot be created for cancelled/returned/delivered order")
  }
  if (paymentStatus !== "SUCCESS" && (order.paymentMethod ?? "").toLowerCase() !== "cod") {
    throw new Error("Shipment can be created only after payment success for prepaid orders")
  }
  if (!["confirmed", "packed", "shipped"].includes(fromStatus)) {
    throw new Error(`Invalid status transition: ${fromStatus} -> shipped`)
  }
  const itemById = new Map(order.items.map((item) => [item.id, item]))
  for (const allocation of input.itemAllocations) {
    const item = itemById.get(allocation.orderItemId)
    if (!item) throw new Error(`Invalid order item: ${allocation.orderItemId}`)
    if (allocation.quantity > Number((item as any).quantity ?? 0)) {
      throw new Error(`Allocated quantity exceeds ordered quantity for ${allocation.orderItemId}`)
    }
  }

  const useSupabaseWrites = process.env.SUPABASE_ORDERS_WRITE_ENABLED === "true"
  let shipment: any = null
  if (useSupabaseWrites) {
    try {
      const now = new Date()
      const supabaseShipment = await createShipmentSupabase({
        orderId: input.orderId,
        shipmentNo: input.shipmentNo?.trim() || null,
        carrier: input.carrier.trim(),
        trackingNo: input.trackingNo?.trim() || null,
        itemAllocations: input.itemAllocations,
      })
      if (!supabaseShipment) throw new Error("supabase_shipment_create_failed")
      const statusApplied = await mirrorOrderStatusSupabase(input.orderId, "shipped")
      if (!statusApplied) throw new Error("supabase_order_status_write_failed")
      const historyApplied = await appendOrderStatusHistorySupabase({
        orderId: input.orderId,
        fromStatus,
        toStatus: "shipped",
        notes: `Shipment created via ${input.carrier.trim()}`,
        changedById: input.actorId,
      })
      if (!historyApplied) throw new Error("supabase_status_history_write_failed")
      const fulfillmentApplied = await upsertOrderFulfillmentSupabase({
        orderId: input.orderId,
        fulfillmentStatus: "shipped",
        shippedAt: now,
      })
      if (!fulfillmentApplied) throw new Error("supabase_fulfillment_write_failed")
      shipment = {
        id: supabaseShipment.id,
        carrier: supabaseShipment.carrier,
        trackingNo: supabaseShipment.trackingNo,
        items: input.itemAllocations.map((item) => ({
          orderItemId: item.orderItemId,
          quantity: item.quantity,
        })),
      }
    } catch (error) {
      logger.warn("orders.shipment.supabase_pg_fallback", {
        orderId: input.orderId,
        error: error instanceof Error ? error.message : "unknown",
      })
    }
  }
  if (!shipment) throw new Error("Supabase shipment create failed")

  await logActivity({
    actorId: input.actorId,
    action: "order.shipment.create",
    entityType: "Order",
    entityId: input.orderId,
    metadata: { shipmentId: shipment.id, carrier: shipment.carrier },
  })
  await enqueueOutboxEvent({
    eventType: "order.shipped",
    aggregateType: "order",
    aggregateId: input.orderId,
    payload: { orderId: input.orderId, shipmentId: shipment.id, carrier: shipment.carrier, trackingNo: shipment.trackingNo },
  }).catch(() => null)

  return shipment
}

export const getCodSettlement = async (orderId: string) => {
  const order = await getOrderByIdSupabaseBasic(orderId)
  if (!order) throw new Error("Order not found")
  return getCodSettlementSupabase(orderId)
}

export const reconcileCodSettlement = async (input: {
  orderId: string
  actorId: string
  collectedAmount: number
  settledAmount?: number
  status?: "pending" | "partial" | "settled" | "failed"
  notes?: string
}) => {
  const order = await getOrderByIdSupabaseBasic(input.orderId)
  if (!order) throw new Error("Order not found")

  const expectedAmount = Number(order.total)
  const settledAmount = input.settledAmount ?? input.collectedAmount
  const varianceAmount = Number((input.collectedAmount - expectedAmount).toFixed(2))
  const status =
    input.status ??
    (settledAmount >= expectedAmount ? "settled" : settledAmount > 0 ? "partial" : "pending")

  const reconciledAt = new Date()
  const normalizedNotes = input.notes?.trim() || null
  const useSupabaseWrites = process.env.SUPABASE_ORDERS_WRITE_ENABLED === "true"
  if (!useSupabaseWrites) throw new Error("SUPABASE_ORDERS_WRITE_ENABLED must be true")
  const settlement = await upsertCodSettlementSupabase({
    orderId: input.orderId,
    expectedAmount,
    collectedAmount: input.collectedAmount,
    settledAmount,
    varianceAmount,
    status,
    notes: normalizedNotes,
    reconciledById: input.actorId,
    reconciledAt,
  })
  if (!settlement) throw new Error("Supabase COD settlement update failed")

  await logActivity({
    actorId: input.actorId,
    action: "order.cod.reconcile",
    entityType: "Order",
    entityId: input.orderId,
    metadata: { status, collectedAmount: input.collectedAmount, settledAmount, varianceAmount },
  })
  await enqueueOutboxEvent({
    eventType: "order.cod.reconciled",
    aggregateType: "order",
    aggregateId: input.orderId,
    payload: {
      orderId: input.orderId,
      settlementId: settlement.id,
      status,
      collectedAmount: settlement.collectedAmount,
      settledAmount: settlement.settledAmount,
    },
  }).catch(() => null)

  return settlement
}

export const confirmOrderDelivery = async (input: {
  orderId: string
  actorId: string
  shipmentId?: string
  note?: string
}) => {
  const order = await getOrderWithOpsRelationsSupabase(input.orderId)
  if (!order) throw new Error("Order not found")

  const fromStatus = (order.statusHistory[0]?.toStatus as OrderLifecycleStatus | undefined) ??
    (order.status as OrderLifecycleStatus)
  if (!["shipped", "delivered"].includes(fromStatus)) {
    throw new Error(`Invalid status transition: ${fromStatus} -> delivered`)
  }

  const shipmentToUpdate =
    input.shipmentId ?? order.shipments.find((s) => s.shipmentStatus !== "delivered")?.id ?? order.shipments[0]?.id

  const useSupabaseWrites = process.env.SUPABASE_ORDERS_WRITE_ENABLED === "true"
  let persisted = false
  if (useSupabaseWrites) {
    try {
      const now = new Date()
      if (shipmentToUpdate) {
        const delivered = await markShipmentDeliveredSupabase(shipmentToUpdate)
        if (!delivered) throw new Error("supabase_shipment_delivery_write_failed")
      }
      const statusApplied = await mirrorOrderStatusSupabase(input.orderId, "delivered")
      if (!statusApplied) throw new Error("supabase_order_status_write_failed")
      const historyApplied = await appendOrderStatusHistorySupabase({
        orderId: input.orderId,
        fromStatus,
        toStatus: "delivered",
        notes: input.note?.trim() || "Delivered confirmation",
        changedById: input.actorId,
      })
      if (!historyApplied) throw new Error("supabase_status_history_write_failed")
      const fulfillmentApplied = await upsertOrderFulfillmentSupabase({
        orderId: input.orderId,
        fulfillmentStatus: "delivered",
        deliveredAt: now,
      })
      if (!fulfillmentApplied) throw new Error("supabase_fulfillment_write_failed")
      persisted = true
    } catch (error) {
      logger.warn("orders.delivery.supabase_pg_fallback", {
        orderId: input.orderId,
        shipmentId: shipmentToUpdate ?? null,
        error: error instanceof Error ? error.message : "unknown",
      })
    }
  }
  if (!persisted) throw new Error("Supabase delivery update failed")

  await logActivity({
    actorId: input.actorId,
    action: "order.delivery.confirm",
    entityType: "Order",
    entityId: input.orderId,
    metadata: { shipmentId: shipmentToUpdate ?? null },
  })
  await enqueueOutboxEvent({
    eventType: "order.delivered",
    aggregateType: "order",
    aggregateId: input.orderId,
    payload: { orderId: input.orderId, shipmentId: shipmentToUpdate ?? null },
  }).catch(() => null)

  return getOrderById(input.orderId)
}
