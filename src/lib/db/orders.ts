import { getSupabaseAdmin } from "@/src/lib/supabase/admin"
import { camelToSnakeObject, shouldRetryWithId, safeString, withId } from "@/src/lib/db/supabaseIntegrity"

const ORDER_TABLES = ["Order"]
const PRODUCT_TABLES = ["Product", "products"]
const PRODUCT_VARIANT_TABLES = ["ProductVariant", "product_variants"]
const INVENTORY_ITEM_TABLES = ["InventoryItem", "inventory_items"]
const COUPON_TABLES = ["Coupon", "coupons", "offers_v2"]
const USER_TABLES = ["User", "users"]
const SETTING_TABLES = ["Setting", "settings"]
const TRANSACTION_TABLES = ["Transaction", "transactions"]
const ORDER_NOTE_TABLES = ["OrderNote", "order_notes"]
const SHIPMENT_TABLES = ["Shipment", "shipments"]
const FULFILLMENT_TABLES = ["OrderFulfillment", "order_fulfillments"]
const ORDER_STATUS_HISTORY_TABLES = ["OrderStatusHistory", "order_status_history"]
const COD_SETTLEMENT_TABLES = ["CodSettlement", "cod_settlements"]
const REFUND_RECORD_TABLES = ["RefundRecord", "refund_records"]
const RETURN_REQUEST_TABLES = ["ReturnRequest", "return_requests"]
const RETURN_REQUEST_ITEM_TABLES = ["ReturnRequestItem", "return_request_items"]
const ORDER_ITEM_TABLES = ["OrderItem", "order_items"]
const SHIPMENT_ITEM_TABLES = ["ShipmentItem", "shipment_items"]
const CHECKOUT_PRODUCT_COLUMNS = "*"
const CHECKOUT_VARIANT_COLUMNS = "*"

type IdRow = { id: string }
export type SupabaseOrderRecord = {
  id: string
  userId?: string | null
  status?: string
  paymentStatus?: string
  total?: number | null
  updatedAt?: string | Date | null
  customerAddress?: string | null
  customerEmail?: string | null
  items: any[]
  statusHistory: Array<{ toStatus?: string; changedAt?: string | Date | null;[key: string]: unknown }>
  refunds: Array<{ id: string; status?: string; amount?: number }>
  notes?: any[]
  shiprocketOrderId?: string | null
  shipmentId?: string | null
  awbCode?: string | null
  courierName?: string | null
  courierCompanyId?: string | null
  trackingNumber?: string | null
  trackingUrl?: string | null
  shippingStatus?: string | null
  shipmentStatus?: string | null
  pickupStatus?: string | null
  shippingCharges?: number | null
  shippingMethod?: string | null
  estimatedDeliveryDate?: string | Date | null
  shiprocketRawResponse?: unknown
  shipmentCreatedAt?: string | Date | null
  shipmentSyncedAt?: string | Date | null
  shipmentDeliveredAt?: string | Date | null
  lastTrackingSyncAt?: string | Date | null
  isShipmentCreated?: boolean | null
  isPickupGenerated?: boolean | null
  isLabelGenerated?: boolean | null
  trackingData?: unknown
  shippingStatusCode?: number | null
  awbAssignedAt?: string | Date | null
  labelUrl?: string | null
  pickupGeneratedAt?: string | Date | null
  appliedCouponId?: string | null
  couponCode?: string | null
  discount?: number | null
  tax?: number | null
  shippingCharge?: number | null
  savingAmount?: number | null
  coupon?: { id: string; code: string; discountType: string; discountValue: number } | null
  [key: string]: unknown
}

export type CheckoutProductVariantRecord = {
  id: string
  productId: string
  price: number
  stock: number
  isDefault: boolean
  weight?: string | null
  name?: string | null
  sku?: string | null
}

export type CheckoutProductRecord = {
  id: string
  slug: string
  type: string
  price: number
  status: string
  totalStock: number
  variants: CheckoutProductVariantRecord[]
}

const safeNumber = (value: unknown, fallback = 0) => {
  const n = Number(value)
  return Number.isFinite(n) ? n : fallback
}

const normalizeIdRows = (rows: unknown[] | null | undefined) =>
  (rows ?? [])
    .map((row) => safeString((row as Record<string, unknown>)?.id))
    .filter(Boolean)

// Note: we intentionally re-use shared integrity helpers (id generation + snake case).

export const getCheckoutProductsSupabase = async (input: {
  slugs: string[]
  productIds: string[]
}) => {
  const client = getSupabaseAdmin()
  const rows: CheckoutProductRecord[] = []
  for (const table of PRODUCT_TABLES) {
    const attempts = [
      () => client.from(table).select(CHECKOUT_PRODUCT_COLUMNS).in("id", input.productIds.length ? input.productIds : ["__none__"]).eq("status", "published"),
      () => client.from(table).select(CHECKOUT_PRODUCT_COLUMNS).in("slug", input.slugs.length ? input.slugs : ["__none__"]).eq("status", "published"),
      () => client.from(table).select(CHECKOUT_PRODUCT_COLUMNS).in("id", input.productIds.length ? input.productIds : ["__none__"]).eq("status", "published"),
      () => client.from(table).select(CHECKOUT_PRODUCT_COLUMNS).in("slug", input.slugs.length ? input.slugs : ["__none__"]).eq("status", "published"),
    ]
    const productRows: Array<Record<string, unknown>> = []
    for (const run of attempts) {
      const { data, error } = await run()
      if (!error && Array.isArray(data)) {
        productRows.push(...(data as Array<Record<string, unknown>>))
      }
    }
    if (!productRows.length) continue
    const dedup = new Map<string, CheckoutProductRecord>()
    for (const row of productRows) {
      const id = safeString(row.id)
      if (!id || dedup.has(id)) continue
      dedup.set(id, {
        id,
        slug: safeString(row.slug),
        type: safeString(row.type),
        price: safeNumber(row.price),
        status: safeString(row.status),
        totalStock: safeNumber(row.totalStock ?? row.total_stock),
        variants: [],
      })
    }
    for (const variantTable of PRODUCT_VARIANT_TABLES) {
      const variantAttempts = [
        () => client.from(variantTable).select(CHECKOUT_VARIANT_COLUMNS).in("productId", Array.from(dedup.keys())),
        () => client.from(variantTable).select(CHECKOUT_VARIANT_COLUMNS).in("product_id", Array.from(dedup.keys())),
      ]
      for (const runVariants of variantAttempts) {
        const { data, error } = await runVariants()
        if (error || !Array.isArray(data)) continue
        for (const variant of data as Array<Record<string, unknown>>) {
          const productId = safeString(variant.productId ?? variant.product_id)
          const product = dedup.get(productId)
          if (!product) continue
          product.variants.push({
            id: safeString(variant.id),
            productId,
            price: safeNumber(variant.price),
            stock: safeNumber(variant.stock),
            isDefault: Boolean(variant.isDefault ?? variant.is_default),
            weight: safeString(variant.weight) || null,
            name: safeString(variant.name) || null,
            sku: safeString(variant.sku) || null,
          })
        }
      }
    }
    rows.push(...dedup.values())
  }
  return rows
}

export const reserveInventorySupabase = async (lines: Array<{ productId: string; variantId?: string | null; quantity: number }>) => {
  const client = getSupabaseAdmin()
  for (const line of lines) {
    let reserved = false
    for (const table of INVENTORY_ITEM_TABLES) {
      const readAttempts = [
        () => client.from(table).select("id,available,reserved").eq("productId", line.productId).gte("available", line.quantity).order("updatedAt", { ascending: true }).limit(1),
        () => client.from(table).select("id,available,reserved").eq("product_id", line.productId).gte("available", line.quantity).order("updated_at", { ascending: true }).limit(1),
      ]
      for (const read of readAttempts) {
        const { data, error } = await read()
        if (error || !Array.isArray(data) || !data[0]) continue
        const row = data[0] as Record<string, unknown>
        const id = safeString(row.id)
        const nextAvailable = safeNumber(row.available) - line.quantity
        const nextReserved = safeNumber(row.reserved) + line.quantity
        const updateAttempts = [
          () => client.from(table).update({ available: nextAvailable, reserved: nextReserved }).eq("id", id).gte("available", line.quantity).select("id").maybeSingle(),
          () => client.from(table).update({ available: nextAvailable, reserved: nextReserved }).eq("id", id).gte("available", line.quantity).select("id").maybeSingle(),
        ]
        for (const update of updateAttempts) {
          const updated = await update()
          if (!updated.error && updated.data) {
            reserved = true
            break
          }
        }
        if (reserved) break
      }
      if (reserved) break
    }
    if (reserved) continue
    if (line.variantId) {
      let variantReserved = false
      for (const table of PRODUCT_VARIANT_TABLES) {
        const attempts = [
          () => client.from(table).select("id,stock").eq("id", line.variantId).eq("productId", line.productId).maybeSingle(),
          () => client.from(table).select("id,stock").eq("id", line.variantId).eq("product_id", line.productId).maybeSingle(),
        ]
        for (const run of attempts) {
          const { data, error } = await run()
          if (error || !data) continue
          const stock = safeNumber((data as Record<string, unknown>).stock)
          if (stock < line.quantity) break
          const nextStock = stock - line.quantity
          const update = await client.from(table).update({ stock: nextStock }).eq("id", line.variantId).gte("stock", line.quantity).select("id").maybeSingle()
          if (!update.error && update.data) {
            variantReserved = true
            break
          }
        }
        if (variantReserved) break
      }
      if (!variantReserved) throw new Error("Insufficient variant inventory to reserve order")
      continue
    }
    let productReserved = false
    for (const table of PRODUCT_TABLES) {
      const attempts = [
        () => client.from(table).select("id,totalStock").eq("id", line.productId).maybeSingle(),
        () => client.from(table).select("id,total_stock").eq("id", line.productId).maybeSingle(),
      ]
      for (const run of attempts) {
        const { data, error } = await run()
        if (error || !data) continue
        const row = data as Record<string, unknown>
        const stock = safeNumber(row.totalStock ?? row.total_stock)
        if (stock < line.quantity) break
        const nextStock = stock - line.quantity
        const updateAttempts = [
          () =>
            client
              .from(table)
              .update({ totalStock: nextStock, stockStatus: nextStock > 0 ? "in_stock" : "out_of_stock" })
              .eq("id", line.productId)
              .gte("totalStock", line.quantity)
              .select("id")
              .maybeSingle(),
          () =>
            client
              .from(table)
              .update({ total_stock: nextStock, stock_status: nextStock > 0 ? "in_stock" : "out_of_stock" })
              .eq("id", line.productId)
              .gte("total_stock", line.quantity)
              .select("id")
              .maybeSingle(),
        ]
        for (const update of updateAttempts) {
          const result = await update()
          if (!result.error && result.data) {
            productReserved = true
            break
          }
        }
        if (productReserved) break
      }
      if (productReserved) break
    }
    if (!productReserved) throw new Error("Insufficient inventory to reserve order")
  }
}

export const releaseInventorySupabase = async (lines: Array<{ productId: string; variantId?: string | null; quantity: number }>) => {
  const client = getSupabaseAdmin()
  for (const line of lines) {
    if (!line.productId || line.quantity <= 0) continue
    let released = false
    for (const table of INVENTORY_ITEM_TABLES) {
      const readAttempts = [
        () => client.from(table).select("id,available,reserved").eq("productId", line.productId).order("updatedAt", { ascending: true }).limit(1),
        () => client.from(table).select("id,available,reserved").eq("product_id", line.productId).order("updated_at", { ascending: true }).limit(1),
      ]
      for (const read of readAttempts) {
        const { data, error } = await read()
        if (error || !Array.isArray(data) || !data[0]) continue
        const row = data[0] as Record<string, unknown>
        const id = safeString(row.id)
        const nextAvailable = safeNumber(row.available) + line.quantity
        const nextReserved = Math.max(0, safeNumber(row.reserved) - line.quantity)
        const updateAttempts = [
          () => client.from(table).update({ available: nextAvailable, reserved: nextReserved }).eq("id", id).select("id").maybeSingle(),
          () => client.from(table).update({ available: nextAvailable, reserved: nextReserved }).eq("id", id).select("id").maybeSingle(),
        ]
        for (const update of updateAttempts) {
          const updated = await update()
          if (!updated.error && updated.data) {
            released = true
            break
          }
        }
        if (released) break
      }
      if (released) break
    }
    if (released) continue

    if (line.variantId) {
      let variantReleased = false
      for (const table of PRODUCT_VARIANT_TABLES) {
        const attempts = [
          () => client.from(table).select("id,stock").eq("id", line.variantId).eq("productId", line.productId).maybeSingle(),
          () => client.from(table).select("id,stock").eq("id", line.variantId).eq("product_id", line.productId).maybeSingle(),
        ]
        for (const run of attempts) {
          const { data, error } = await run()
          if (error || !data) continue
          const stock = safeNumber((data as Record<string, unknown>).stock)
          const nextStock = stock + line.quantity
          const update = await client.from(table).update({ stock: nextStock }).eq("id", line.variantId).select("id").maybeSingle()
          if (!update.error && update.data) {
            variantReleased = true
            break
          }
        }
        if (variantReleased) break
      }
      if (variantReleased) continue
    }

    let productReleased = false
    for (const table of PRODUCT_TABLES) {
      const attempts = [
        () => client.from(table).select("id,totalStock").eq("id", line.productId).maybeSingle(),
        () => client.from(table).select("id,total_stock").eq("id", line.productId).maybeSingle(),
      ]
      for (const run of attempts) {
        const { data, error } = await run()
        if (error || !data) continue
        const row = data as Record<string, unknown>
        const stock = safeNumber(row.totalStock ?? row.total_stock)
        const nextStock = stock + line.quantity
        const updateAttempts = [
          () =>
            client
              .from(table)
              .update({ totalStock: nextStock, stockStatus: "in_stock" })
              .eq("id", line.productId)
              .select("id")
              .maybeSingle(),
          () =>
            client
              .from(table)
              .update({ total_stock: nextStock, stock_status: "in_stock" })
              .eq("id", line.productId)
              .select("id")
              .maybeSingle(),
        ]
        for (const update of updateAttempts) {
          const result = await update()
          if (!result.error && result.data) {
            productReleased = true
            break
          }
        }
        if (productReleased) break
      }
      if (productReleased) break
    }
  }
}


export type CouponCheckoutRecord = {
  id: string
  code: string
  active: boolean
  endsAt: Date | null
  minOrderAmount: number | null
  firstOrderOnly: boolean
  usageLimitPerUser: number | null
  discountType: "flat" | "percentage"
  discountValue: number
  maxDiscountAmount: number | null
}

export const getCouponByCodeSupabase = async (code: string): Promise<CouponCheckoutRecord | null> => {
  const client = getSupabaseAdmin()
  const upper = code.trim().toUpperCase()
  for (const table of COUPON_TABLES) {
    const attempts = [
      () => client.from(table).select("*").eq("code", upper).maybeSingle(),
      () => client.from(table).select("*").eq("code", upper).maybeSingle(),
    ]
    for (const run of attempts) {
      const { data, error } = await run()
      if (error || !data) continue
      const row = data as Record<string, unknown>
      return {
        id: safeString(row.id),
        code: safeString(row.code),
        active: Boolean(row.active) || row.status === "active",
        endsAt: row.endsAt ? new Date(String(row.endsAt)) : row.ends_at ? new Date(String(row.ends_at)) : null,
        minOrderAmount: row.minOrderAmount == null && row.min_order_amount == null && (row.config_json as any)?.minCartValue == null
          ? null
          : safeNumber(row.minOrderAmount ?? row.min_order_amount ?? (row.config_json as any)?.minCartValue),
        firstOrderOnly: Boolean(row.firstOrderOnly ?? row.first_order_only ?? (row.config_json as any)?.firstOrderOnly),
        usageLimitPerUser:
          row.usageLimitPerUser == null && row.usage_limit_per_user == null && (row.config_json as any)?.usageLimitPerUser == null
            ? null
            : safeNumber(row.usageLimitPerUser ?? row.usage_limit_per_user ?? (row.config_json as any)?.usageLimitPerUser),
        discountType: safeString(row.discountType ?? row.discount_type ?? (row.config_json as any)?.discountType) === "percentage" || (row.config_json as any)?.discountType === "percent" ? "percentage" : "flat",
        discountValue: safeNumber(row.discountValue ?? row.discount_value ?? (row.config_json as any)?.discountValue),
        maxDiscountAmount:
          row.maxDiscountAmount == null && row.max_discount_amount == null && (row.config_json as any)?.maxDiscountAmount == null
            ? null
            : safeNumber(row.maxDiscountAmount ?? row.max_discount_amount ?? (row.config_json as any)?.maxDiscountAmount),
      }
    }
  }
  return null
}

export const getCouponByIdSupabase = async (id: string): Promise<CouponCheckoutRecord | null> => {
  const client = getSupabaseAdmin()
  for (const table of COUPON_TABLES) {
    const { data, error } = await client.from(table).select("*").eq("id", id).maybeSingle()
    if (error || !data) continue
    const row = data as Record<string, unknown>
    return {
      id: safeString(row.id),
      code: safeString(row.code),
      active: Boolean(row.active) || row.status === "active",
      endsAt: row.endsAt ? new Date(String(row.endsAt)) : row.ends_at ? new Date(String(row.ends_at)) : null,
      minOrderAmount: row.minOrderAmount == null && row.min_order_amount == null && (row.config_json as any)?.minCartValue == null
        ? null
        : safeNumber(row.minOrderAmount ?? row.min_order_amount ?? (row.config_json as any)?.minCartValue),
      firstOrderOnly: Boolean(row.firstOrderOnly ?? row.first_order_only ?? (row.config_json as any)?.firstOrderOnly),
      usageLimitPerUser:
        row.usageLimitPerUser == null && row.usage_limit_per_user == null && (row.config_json as any)?.usageLimitPerUser == null
          ? null
          : safeNumber(row.usageLimitPerUser ?? row.usage_limit_per_user ?? (row.config_json as any)?.usageLimitPerUser),
      discountType: safeString(row.discountType ?? row.discount_type ?? (row.config_json as any)?.discountType) === "percentage" || (row.config_json as any)?.discountType === "percent" ? "percentage" : "flat",
      discountValue: safeNumber(row.discountValue ?? row.discount_value ?? (row.config_json as any)?.discountValue),
      maxDiscountAmount:
        row.maxDiscountAmount == null && row.max_discount_amount == null && (row.config_json as any)?.maxDiscountAmount == null
          ? null
          : safeNumber(row.maxDiscountAmount ?? row.max_discount_amount ?? (row.config_json as any)?.maxDiscountAmount),
    }
  }
  return null
}

export const countNonCancelledOrdersByUserSupabase = async (userId: string) => {
  const client = getSupabaseAdmin()
  for (const table of ORDER_TABLES) {
    const attempts = [
      () => client.from(table).select("status").eq("userId", userId),
      () => client.from(table).select("status").eq("user_id", userId),
    ]
    for (const run of attempts) {
      const { data, error } = await run()
      if (error || !Array.isArray(data)) continue
      return data.filter((row) => safeString((row as Record<string, unknown>).status).toLowerCase() !== "cancelled").length
    }
  }
  return 0
}

export const countCouponUsageByUserSupabase = async (input: { userId: string; couponId: string }) => {
  const client = getSupabaseAdmin()
  for (const table of ORDER_TABLES) {
    const attempts = [
      () => client.from(table).select("status,appliedCouponId").eq("userId", input.userId).eq("appliedCouponId", input.couponId),
    ]
    for (const run of attempts) {
      const { data, error } = await run()
      if (error || !Array.isArray(data)) continue
      return data.filter((row) => safeString((row as Record<string, unknown>).status).toLowerCase() !== "cancelled").length
    }
  }
  return 0
}

export const getUserEmailSupabase = async (userId: string) => {
  const client = getSupabaseAdmin()
  for (const table of USER_TABLES) {
    const { data, error } = await client.from(table).select("email").eq("id", userId).maybeSingle()
    if (!error && data) {
      const email = safeString((data as Record<string, unknown>).email)
      return email || null
    }
  }
  return null
}

export const findOrderByPaymentRefSupabase = async (input: { paymentId: string; userId?: string | null }) => {
  const client = getSupabaseAdmin()
  const paymentId = input.paymentId.trim()
  if (!paymentId) return null
  for (const table of ORDER_TABLES) {
    const attempts = [
      () => {
        let q = client.from(table).select("id").eq("paymentId", paymentId).limit(1)
        if (input.userId) q = q.eq("userId", input.userId)
        return q
      },
      () => {
        let q = client.from(table).select("id").eq("payment_id", paymentId).limit(1)
        if (input.userId) q = q.eq("user_id", input.userId)
        return q
      },
    ]
    for (const run of attempts) {
      const { data, error } = await run()
      if (!error && Array.isArray(data) && data[0]?.id) {
        return safeString(data[0].id)
      }
    }
  }
  return null
}

export const getOrderAutoApproveSettingSupabase = async () => {
  const client = getSupabaseAdmin()
  for (const table of SETTING_TABLES) {
    const attempts = [
      () => client.from(table).select("valueJson").eq("group", "orders").eq("key", "auto_approve_orders").maybeSingle(),
      () => client.from(table).select("value_json").eq("group", "orders").eq("key", "auto_approve_orders").maybeSingle(),
      () => client.from(table).select("value_json").eq("group_key", "orders:auto_approve_orders").maybeSingle(),
    ]
    for (const run of attempts) {
      const { data, error } = await run()
      if (!error && data) {
        const row = data as Record<string, unknown>
        return row.valueJson ?? row.value_json ?? null
      }
    }
  }
  return null
}

export const listOrderIdsSupabase = async (input: {
  page: number
  limit: number
  role: string
  userId: string
}) => {
  const client = getSupabaseAdmin()
  const page = Math.max(1, input.page)
  const limit = Math.min(200, Math.max(1, input.limit))
  const offset = (page - 1) * limit
  const errors: string[] = []

  for (const table of ORDER_TABLES) {
    // Try both camelCase and snake_case for compatibility
    const roleIsCustomer = input.role === "customer"
    const attempts: Array<() => any> = []

    attempts.push(() => {
      let q = client.from(table).select("id", { count: "exact" }).order("createdAt", { ascending: false }).range(offset, offset + limit - 1)
      if (roleIsCustomer) q = q.eq("userId", input.userId)
      return q
    })
    attempts.push(() => {
      let q = client.from(table).select("id", { count: "exact" }).order("created_at", { ascending: false }).range(offset, offset + limit - 1)
      if (roleIsCustomer) q = q.eq("user_id", input.userId)
      return q
    })

    for (const run of attempts) {
      const { data, error, count } = await run()
      if (!error) {
        return {
          ids: normalizeIdRows(data as unknown[]),
          total: count ?? 0,
          page,
          limit,
        }
      }
      if (error) errors.push(`${table}: ${error.message}`)
    }
  }
  for (const table of ORDER_TABLES) {
    const attempts = [
      () => {
        let q = client.from(table).select("id", { count: "exact" }).range(offset, offset + limit - 1)
        if (input.role === "customer") q = q.eq("userId", input.userId)
        return q
      },
      () => {
        let q = client.from(table).select("id", { count: "exact" }).range(offset, offset + limit - 1)
        if (input.role === "customer") q = q.eq("user_id", input.userId)
        return q
      },
    ]
    for (const run of attempts) {
      const { data, error, count } = await run()
      if (!error) {
        return {
          ids: normalizeIdRows(data as unknown[]),
          total: count ?? 0,
          page,
          limit,
        }
      }
      if (error) errors.push(`${table}: ${error.message}`)
    }
  }
  throw new Error(`Unable to list orders via Supabase${errors.length ? ` (${errors.slice(0, 3).join(" | ")})` : ""}`)
}

export const orderExistsByIdSupabase = async (orderId: string) => {
  const client = getSupabaseAdmin()
  for (const table of ORDER_TABLES) {
    const { data, error } = await client.from(table).select("id").eq("id", orderId).maybeSingle()
    if (!error) return Boolean(data?.id)
  }
  throw new Error("Unable to verify order by id via Supabase")
}

export const markOrderPaymentSuccessSupabase = async (orderId: string, paymentId: string) => {
  const client = getSupabaseAdmin()
  for (const table of ORDER_TABLES) {
    const attempts = [
      () => client.from(table).update({ paymentStatus: "SUCCESS", paymentId }).eq("id", orderId).select("id").maybeSingle(),
      () => client.from(table).update({ payment_status: "SUCCESS", payment_id: paymentId }).eq("id", orderId).select("id").maybeSingle(),
    ]
    for (const run of attempts) {
      const { data, error } = await run()
      if (!error && data) return true
    }
  }
  return false
}

export const upsertPaidTransactionSupabase = async (input: {
  orderId: string
  razorpayOrderId: string
  razorpayPaymentId: string
}) => {
  const client = getSupabaseAdmin()
  for (const table of TRANSACTION_TABLES) {
    const readAttempts = [
      () => client.from(table).select("id,status,externalId,orderId").eq("orderId", input.orderId),
      () => client.from(table).select("id,status,external_id,order_id").eq("order_id", input.orderId),
    ]
    for (const read of readAttempts) {
      const { data, error } = await read()
      if (error) continue
      const rows = (data ?? []) as Array<Record<string, unknown>>
      const existing = rows.find((row) => {
        const external = safeString(row.externalId ?? row.external_id)
        return external === input.razorpayOrderId || external === input.razorpayPaymentId
      })
      if (existing) {
        const id = safeString(existing.id)
        const updateAttempts = [
          () => client.from(table).update({ status: "paid", externalId: input.razorpayPaymentId }).eq("id", id).select("id").maybeSingle(),
          () => client.from(table).update({ status: "paid", external_id: input.razorpayPaymentId }).eq("id", id).select("id").maybeSingle(),
        ]
        for (const update of updateAttempts) {
          const result = await update()
          if (!result.error && result.data) return safeString((result.data as Record<string, unknown>).id)
        }
      } else {
        const insertAttempts = [
          () =>
            client
              .from(table)
              .insert({
                orderId: input.orderId,
                gateway: "razorpay",
                amount: 0,
                status: "paid",
                externalId: input.razorpayPaymentId,
              })
              .select("id")
              .single(),
          () =>
            client
              .from(table)
              .insert({
                order_id: input.orderId,
                gateway: "razorpay",
                amount: 0,
                status: "paid",
                external_id: input.razorpayPaymentId,
              })
              .select("id")
              .single(),
        ]
        for (const insert of insertAttempts) {
          const result = await insert()
          if (!result.error && result.data) return safeString((result.data as Record<string, unknown>).id)
        }
      }
    }
  }
  return null
}

export const upsertPendingTransactionSupabase = async (input: {
  orderId: string
  gateway: string
  externalId: string
  amount: number
}) => {
  const client = getSupabaseAdmin()
  for (const table of TRANSACTION_TABLES) {
    const readAttempts = [
      () => client.from(table).select("id").eq("orderId", input.orderId).eq("gateway", input.gateway),
      () => client.from(table).select("id").eq("order_id", input.orderId).eq("gateway", input.gateway),
    ]
    for (const read of readAttempts) {
      const { data, error } = await read()
      if (error) continue
      const row = (data?.[0] ?? null) as Record<string, unknown> | null
      if (row?.id) {
        const txId = safeString(row.id)
        const updated = await updateTransactionStatusSupabase({
          transactionId: txId,
          status: "pending",
          gateway: input.gateway,
          externalId: input.externalId,
        })
        if (!updated) return null
        return txId
      }
      const insertAttempts = [
        () =>
          client
            .from(table)
            .insert({
              orderId: input.orderId,
              gateway: input.gateway,
              amount: input.amount,
              status: "pending",
              externalId: input.externalId,
            })
            .select("id")
            .single(),
        () =>
          client
            .from(table)
            .insert({
              order_id: input.orderId,
              gateway: input.gateway,
              amount: input.amount,
              status: "pending",
              external_id: input.externalId,
            })
            .select("id")
            .single(),
      ]
      for (const insert of insertAttempts) {
        const result = await insert()
        if (!result.error && result.data) return safeString((result.data as Record<string, unknown>).id)
      }
    }
  }
  return null
}

export const setOrderCancelReasonSupabase = async (orderId: string, reason: string) => {
  const client = getSupabaseAdmin()
  for (const table of ORDER_TABLES) {
    const attempts = [
      () => client.from(table).update({ cancelReason: reason }).eq("id", orderId).select("id").maybeSingle(),
      () => client.from(table).update({ cancel_reason: reason }).eq("id", orderId).select("id").maybeSingle(),
    ]
    for (const run of attempts) {
      const { data, error } = await run()
      if (!error && data) return true
    }
  }
  return false
}

export const setOrderReturnReasonSupabase = async (orderId: string, reason: string) => {
  const client = getSupabaseAdmin()
  for (const table of ORDER_TABLES) {
    const attempts = [
      () => client.from(table).update({ returnReason: reason }).eq("id", orderId).select("id").maybeSingle(),
      () => client.from(table).update({ return_reason: reason }).eq("id", orderId).select("id").maybeSingle(),
    ]
    for (const run of attempts) {
      const { data, error } = await run()
      if (!error && data) return true
    }
  }
  return false
}

export const mirrorOrderStatusSupabase = async (orderId: string, status: string) => {
  const client = getSupabaseAdmin()
  for (const table of ORDER_TABLES) {
    const attempts = [
      () => client.from(table).update({ status }).eq("id", orderId).select("id").maybeSingle(),
      () => client.from(table).update({ status }).eq("id", orderId).select("id").maybeSingle(),
    ]
    for (const run of attempts) {
      const { data, error } = await run()
      if (!error && data) return true
    }
  }
  return false
}

export const createOrderNoteSupabase = async (input: {
  orderId: string
  note: string
  actorId: string
  isInternal: boolean
}) => {
  const client = getSupabaseAdmin()

  const camel = {
    orderId: input.orderId,
    note: input.note,
    isInternal: input.isInternal,
    createdById: input.actorId,
  }
  for (const table of ORDER_NOTE_TABLES) {
    for (const payload of [camel]) {
      const attempts = [
        () => client.from(table).insert(payload).select("id,isInternal").maybeSingle(),
        () => client.from(table).insert(withId(payload)).select("id,isInternal").maybeSingle(),
      ]
      for (const run of attempts) {
        const { data, error } = await run()
        if (!error && data) {
          const row = data as Record<string, unknown>
          return {
            id: safeString(row.id),
            isInternal: Boolean(row.isInternal ?? row.is_internal),
          }
        }
      }
    }
  }
  return null
}

export const upsertOrderFulfillmentSupabase = async (input: {
  orderId: string
  fulfillmentStatus: string
  packedAt?: Date | null
  shippedAt?: Date | null
  deliveredAt?: Date | null
}) => {
  const client = getSupabaseAdmin()
  for (const table of FULFILLMENT_TABLES) {
    const updateAttempts = [
      () =>
        client
          .from(table)
          .update({
            fulfillmentStatus: input.fulfillmentStatus,
            packedAt: input.packedAt ?? undefined,
            shippedAt: input.shippedAt ?? undefined,
            deliveredAt: input.deliveredAt ?? undefined,
          })
          .eq("orderId", input.orderId)
          .select("id")
          .maybeSingle(),
      () =>
        client
          .from(table)
          .update({
            fulfillment_status: input.fulfillmentStatus,
            packed_at: input.packedAt ?? undefined,
            shipped_at: input.shippedAt ?? undefined,
            delivered_at: input.deliveredAt ?? undefined,
          })
          .eq("order_id", input.orderId)
          .select("id")
          .maybeSingle(),
    ]
    for (const run of updateAttempts) {
      const { data, error } = await run()
      if (!error && data) return true
    }
    const insertAttempts = [
      () =>
        client
          .from(table)
          .insert({
            orderId: input.orderId,
            fulfillmentStatus: input.fulfillmentStatus,
            packedAt: input.packedAt ?? null,
            shippedAt: input.shippedAt ?? null,
            deliveredAt: input.deliveredAt ?? null,
          })
          .select("id")
          .single(),
      () =>
        client
          .from(table)
          .insert({
            order_id: input.orderId,
            fulfillment_status: input.fulfillmentStatus,
            packed_at: input.packedAt ?? null,
            shipped_at: input.shippedAt ?? null,
            delivered_at: input.deliveredAt ?? null,
          })
          .select("id")
          .single(),
    ]
    for (const run of insertAttempts) {
      const { data, error } = await run()
      if (!error && data) return true
    }
  }
  return false
}

export const createShipmentSupabase = async (input: {
  orderId: string
  shipmentNo: string | null
  carrier: string
  trackingNo: string | null
  itemAllocations: Array<{ orderItemId: string; quantity: number }>
}) => {
  const client = getSupabaseAdmin()
  for (const table of SHIPMENT_TABLES) {
    const insertAttempts = [
      () =>
        client
          .from(table)
          .insert({
            orderId: input.orderId,
            shipmentNo: input.shipmentNo,
            carrier: input.carrier,
            trackingNo: input.trackingNo,
            shipmentStatus: "shipped",
            shippedAt: new Date().toISOString(),
          })
          .select("id,carrier,trackingNo")
          .single(),
      () =>
        client
          .from(table)
          .insert({
            order_id: input.orderId,
            shipment_no: input.shipmentNo,
            carrier: input.carrier,
            tracking_no: input.trackingNo,
            shipment_status: "shipped",
            shipped_at: new Date().toISOString(),
          })
          .select("id,carrier,tracking_no")
          .single(),
    ]
    for (const run of insertAttempts) {
      const { data, error } = await run()
      if (error || !data) continue
      const row = data as Record<string, unknown>
      const shipmentId = safeString(row.id)
      if (!shipmentId) continue
      // Strict insert of shipment items; no partial saves.
      let itemsInserted = false
      for (const itemTable of SHIPMENT_ITEM_TABLES) {
        const camelRows = input.itemAllocations.map((item) => ({
          shipmentId,
          orderItemId: item.orderItemId,
          quantity: item.quantity,
        }))
        const snakeRows = input.itemAllocations.map((item) => ({
          shipment_id: shipmentId,
          order_item_id: item.orderItemId,
          quantity: item.quantity,
        }))
        const attemptInsert = async (rows: Array<Record<string, unknown>>) => {
          const result = await client.from(itemTable).insert(rows)
          if (!result.error) return true
          if (shouldRetryWithId(result.error.message)) {
            const retry = await client.from(itemTable).insert(rows.map(withId))
            if (!retry.error) return true
          }
          return false
        }
        if (await attemptInsert(camelRows)) {
          itemsInserted = true
          break
        }
        if (await attemptInsert(snakeRows)) {
          itemsInserted = true
          break
        }
      }
      if (!itemsInserted) {
        await client.from(table).delete().eq("id", shipmentId)
        throw new Error("Shipment items insert failed; shipment rolled back")
      }
      return {
        id: shipmentId,
        carrier: safeString(row.carrier),
        trackingNo: safeString(row.trackingNo ?? row.tracking_no) || null,
      }
    }
  }
  return null
}

export const markShipmentDeliveredSupabase = async (shipmentId: string) => {
  const client = getSupabaseAdmin()
  for (const table of SHIPMENT_TABLES) {
    const attempts = [
      () =>
        client
          .from(table)
          .update({ shipmentStatus: "delivered", deliveredAt: new Date().toISOString() })
          .eq("id", shipmentId)
          .select("id")
          .maybeSingle(),
      () =>
        client
          .from(table)
          .update({ shipment_status: "delivered", delivered_at: new Date().toISOString() })
          .eq("id", shipmentId)
          .select("id")
          .maybeSingle(),
    ]
    for (const run of attempts) {
      const { data, error } = await run()
      if (!error && data) return true
    }
  }
  return false
}

export const appendOrderStatusHistorySupabase = async (input: {
  orderId: string
  fromStatus: string
  toStatus: string
  notes: string | null
  changedById: string | null
  reasonCode?: string | null
}) => {
  const client = getSupabaseAdmin()
  for (const table of ORDER_STATUS_HISTORY_TABLES) {
    const attempts = [
      () =>
        client
          .from(table)
          .insert(withId({
            orderId: input.orderId,
            fromStatus: input.fromStatus,
            toStatus: input.toStatus,
            notes: input.notes,
            changedById: input.changedById,
            reasonCode: input.reasonCode ?? null,
          }))
          .select("id")
          .single(),
      () =>
        client
          .from(table)
          .insert(withId({
            order_id: input.orderId,
            from_status: input.fromStatus,
            to_status: input.toStatus,
            notes: input.notes,
            changed_by_id: input.changedById,
            reason_code: input.reasonCode ?? null,
          }))
          .select("id")
          .single(),
    ]
    for (const run of attempts) {
      const { data, error } = await run()
      if (!error && data) return true
    }
  }
  return false
}

export const upsertCodSettlementSupabase = async (input: {
  orderId: string
  expectedAmount: number
  collectedAmount: number
  settledAmount: number
  varianceAmount: number
  status: string
  notes: string | null
  reconciledById: string
  reconciledAt: Date
}) => {
  const client = getSupabaseAdmin()
  for (const table of COD_SETTLEMENT_TABLES) {
    const updateAttempts = [
      () =>
        client
          .from(table)
          .update({
            expectedAmount: input.expectedAmount,
            collectedAmount: input.collectedAmount,
            settledAmount: input.settledAmount,
            varianceAmount: input.varianceAmount,
            status: input.status,
            notes: input.notes,
            reconciledById: input.reconciledById,
            reconciledAt: input.reconciledAt.toISOString(),
          })
          .eq("orderId", input.orderId)
          .select("id,collectedAmount,settledAmount")
          .maybeSingle(),
      () =>
        client
          .from(table)
          .update({
            expected_amount: input.expectedAmount,
            collected_amount: input.collectedAmount,
            settled_amount: input.settledAmount,
            variance_amount: input.varianceAmount,
            status: input.status,
            notes: input.notes,
            reconciled_by_id: input.reconciledById,
            reconciled_at: input.reconciledAt.toISOString(),
          })
          .eq("order_id", input.orderId)
          .select("id,collected_amount,settled_amount")
          .maybeSingle(),
    ]
    for (const run of updateAttempts) {
      const { data, error } = await run()
      if (!error && data) {
        const row = data as Record<string, unknown>
        return {
          id: safeString(row.id),
          collectedAmount: Number(row.collectedAmount ?? row.collected_amount ?? input.collectedAmount),
          settledAmount: Number(row.settledAmount ?? row.settled_amount ?? input.settledAmount),
        }
      }
    }
    const insertAttempts = [
      () =>
        client
          .from(table)
          .insert({
            orderId: input.orderId,
            expectedAmount: input.expectedAmount,
            collectedAmount: input.collectedAmount,
            settledAmount: input.settledAmount,
            varianceAmount: input.varianceAmount,
            status: input.status,
            notes: input.notes,
            reconciledById: input.reconciledById,
            reconciledAt: input.reconciledAt.toISOString(),
          })
          .select("id,collectedAmount,settledAmount")
          .single(),
      () =>
        client
          .from(table)
          .insert({
            order_id: input.orderId,
            expected_amount: input.expectedAmount,
            collected_amount: input.collectedAmount,
            settled_amount: input.settledAmount,
            variance_amount: input.varianceAmount,
            status: input.status,
            notes: input.notes,
            reconciled_by_id: input.reconciledById,
            reconciled_at: input.reconciledAt.toISOString(),
          })
          .select("id,collected_amount,settled_amount")
          .single(),
    ]
    for (const run of insertAttempts) {
      const { data, error } = await run()
      if (!error && data) {
        const row = data as Record<string, unknown>
        return {
          id: safeString(row.id),
          collectedAmount: Number(row.collectedAmount ?? row.collected_amount ?? input.collectedAmount),
          settledAmount: Number(row.settledAmount ?? row.settled_amount ?? input.settledAmount),
        }
      }
    }
  }
  return null
}

export const setOrderRefundAndPaymentStatusSupabase = async (input: {
  orderId: string
  refundStatus?: string
  paymentStatus?: "PENDING" | "SUCCESS" | "FAILED" | "REFUNDED"
}) => {
  const client = getSupabaseAdmin()
  for (const table of ORDER_TABLES) {
    const camelPayload: Record<string, unknown> = {}
    const snakePayload: Record<string, unknown> = {}
    if (input.refundStatus !== undefined) {
      camelPayload.refundStatus = input.refundStatus
      snakePayload.refund_status = input.refundStatus
    }
    if (input.paymentStatus !== undefined) {
      camelPayload.paymentStatus = input.paymentStatus
      snakePayload.payment_status = input.paymentStatus
    }
    const attempts = [
      () => client.from(table).update(camelPayload).eq("id", input.orderId).select("id").maybeSingle(),
      () => client.from(table).update(snakePayload).eq("id", input.orderId).select("id").maybeSingle(),
    ]
    for (const run of attempts) {
      const { data, error } = await run()
      if (!error && data) return true
    }
  }
  return false
}

export const setTransactionRefundIdSupabase = async (orderId: string, refundId: string) => {
  const client = getSupabaseAdmin()
  for (const table of TRANSACTION_TABLES) {
    const attempts = [
      () => client.from(table).update({ refundId }).eq("orderId", orderId).select("id").limit(1),
      () => client.from(table).update({ refund_id: refundId }).eq("order_id", orderId).select("id").limit(1),
    ]
    for (const run of attempts) {
      const { data, error } = await run()
      if (!error && Array.isArray(data) && data.length > 0) return true
    }
  }
  return false
}

export const updateTransactionStatusSupabase = async (input: {
  transactionId: string
  status: string
  gateway?: string
  externalId?: string | null
}) => {
  const client = getSupabaseAdmin()
  for (const table of TRANSACTION_TABLES) {
    const camelPayload: Record<string, unknown> = {
      status: input.status,
    }
    const snakePayload: Record<string, unknown> = {
      status: input.status,
    }
    if (input.gateway !== undefined) {
      camelPayload.gateway = input.gateway
      snakePayload.gateway = input.gateway
    }
    if (input.externalId !== undefined) {
      camelPayload.externalId = input.externalId
      snakePayload.external_id = input.externalId
    }
    const attempts = [
      () => client.from(table).update(camelPayload).eq("id", input.transactionId).select("id").maybeSingle(),
      () => client.from(table).update(snakePayload).eq("id", input.transactionId).select("id").maybeSingle(),
    ]
    for (const run of attempts) {
      const { data, error } = await run()
      if (!error && data) return true
    }
  }
  return false
}

export const updateRefundRecordStatusSupabase = async (refundRecordId: string, status: string) => {
  const client = getSupabaseAdmin()
  for (const table of REFUND_RECORD_TABLES) {
    const { data, error } = await client
      .from(table)
      .update({ status })
      .eq("id", refundRecordId)
      .select("id")
      .maybeSingle()
    if (!error && data) return true
  }
  return false
}

export const completePendingRefundRecordsSupabase = async (orderId: string) => {
  const client = getSupabaseAdmin()
  for (const table of REFUND_RECORD_TABLES) {
    const attempts = [
      () =>
        client
          .from(table)
          .update({ status: "completed" })
          .eq("orderId", orderId)
          .in("status", ["pending", "initiated", "processing"]),
      () =>
        client
          .from(table)
          .update({ status: "completed" })
          .eq("order_id", orderId)
          .in("status", ["pending", "initiated", "processing"]),
    ]
    for (const run of attempts) {
      const { error } = await run()
      if (!error) return true
    }
  }
  return false
}

export const listOrdersSupabaseBasic = async (input: {
  page: number
  limit: number
  role: string
  userId: string
}) => {
  const payload = await listOrderIdsSupabase(input)
  const items: SupabaseOrderRecord[] = []
  for (const id of payload.ids) {
    const row = await getOrderByIdSupabaseBasic(id)
    if (row) items.push(row)
  }
  return { items, total: payload.total, page: payload.page, limit: payload.limit }
}

const fetchRowsByForeignKey = async (
  tables: string[],
  foreignKey: { camel: string; snake: string },
  value: string,
  options?: { orderBy?: { camel: string; snake: string; ascending?: boolean } },
): Promise<Array<Record<string, unknown>>> => {
  if (!value) return []
  const client = getSupabaseAdmin()
  for (const table of tables) {
    const attempts = [
      () => {
        let q = client.from(table).select("*").eq(foreignKey.camel, value)
        if (options?.orderBy) q = q.order(options.orderBy.camel, { ascending: options.orderBy.ascending ?? true })
        return q
      },
      () => {
        let q = client.from(table).select("*").eq(foreignKey.snake, value)
        if (options?.orderBy) q = q.order(options.orderBy.snake, { ascending: options.orderBy.ascending ?? true })
        return q
      },
    ]
    for (const run of attempts) {
      const { data, error } = await run()
      if (!error && Array.isArray(data)) return data as Array<Record<string, unknown>>
    }
  }
  return []
}

const fetchRowsByIds = async (
  tables: string[],
  idColumn: string,
  ids: string[],
  selectClause = "*",
): Promise<Array<Record<string, unknown>>> => {
  if (!ids.length) return []
  const unique = Array.from(new Set(ids.filter(Boolean)))
  if (!unique.length) return []
  const client = getSupabaseAdmin()
  for (const table of tables) {
    const { data, error } = await client.from(table).select(selectClause).in(idColumn, unique)
    if (!error && Array.isArray(data)) return data as unknown as Array<Record<string, unknown>>
  }
  return []
}

export const getOrderByIdSupabaseBasic = async (orderId: string) => {
  const client = getSupabaseAdmin()
  for (const table of ORDER_TABLES) {
    const { data, error } = await client.from(table).select("*").eq("id", orderId).maybeSingle()
    if (!error && data) {
      const row = data as Record<string, unknown>
      const itemRows = await fetchRowsByForeignKey(ORDER_ITEM_TABLES, { camel: "orderId", snake: "order_id" }, orderId)

      // Hydrate each order item with its related product (id, name, slug, sku, weight).
      const productIds = itemRows.map((row) => safeString(row.productId ?? row.product_id)).filter(Boolean)
      const productRows = await fetchRowsByIds(
        PRODUCT_TABLES,
        "id",
        productIds,
        "id,name,slug,sku,weight,thumbnail,price,totalStock,type,stockStatus",
      )
      const productById = new Map<string, Record<string, unknown>>()
      for (const product of productRows) {
        const id = safeString(product.id)
        if (id) productById.set(id, product)
      }

      const variantIds = itemRows
        .map((row) => safeString(row.variantId ?? row.variant_id))
        .filter(Boolean)
      const variantRows = await fetchRowsByIds(
        PRODUCT_VARIANT_TABLES,
        "id",
        variantIds,
        "id,name,sku,weight,price,stock",
      )
      const variantById = new Map<string, Record<string, unknown>>()
      for (const variant of variantRows) {
        const id = safeString(variant.id)
        if (id) variantById.set(id, variant)
      }

      const hydratedItems = itemRows.map((rowItem) => {
        const productId = safeString(rowItem.productId ?? rowItem.product_id)
        const product = productById.get(productId) ?? null
        const variantId = safeString(rowItem.variantId ?? rowItem.variant_id)
        const variant = variantId ? variantById.get(variantId) ?? null : null
        return {
          ...rowItem,
          id: safeString(rowItem.id),
          orderId: safeString(rowItem.orderId ?? rowItem.order_id) || orderId,
          productId,
          variantId: variantId || null,
          sku: safeString(rowItem.sku) || safeString(variant?.sku) || safeString(product?.sku) || null,
          quantity: safeNumber(rowItem.quantity, 0),
          unitPrice: safeNumber(rowItem.unitPrice ?? rowItem.unit_price, 0),
          subtotal: safeNumber(rowItem.subtotal ?? rowItem.lineTotal ?? rowItem.line_total, 0),
          tax: safeNumber(rowItem.tax, 0),
          lineTotal: safeNumber(rowItem.lineTotal ?? rowItem.line_total, 0),
          // Always present so the UI never NPEs on a missing/deleted product.
          product: product
            ? {
              id: safeString(product.id),
              name: safeString(product.name) || "Product",
              slug: safeString(product.slug) || safeString(product.id),
              sku: safeString(product.sku) || null,
              weight: safeString(product.weight) || null,
              thumbnail: safeString(product.thumbnail) || null,
              totalStock: safeNumber(product.totalStock, 0),
              type: safeString(product.type) || "simple",
              stockStatus: safeString(product.stockStatus) || "in_stock",
            }
            : {
              id: productId || "",
              name: "Deleted product",
              slug: productId || "",
              sku: null,
              weight: null,
              thumbnail: null,
              totalStock: 0,
              type: "simple",
              stockStatus: "out_of_stock",
            },
          variant: variant
            ? {
              id: safeString(variant.id),
              name: safeString(variant.name) || null,
              sku: safeString(variant.sku) || null,
              weight: safeString(variant.weight) || null,
              price: safeNumber(variant.price, 0),
              stock: safeNumber(variant.stock, 0),
            }
            : null,
        }
      })

      const appliedCouponId = safeString(row.appliedCouponId ?? row.applied_coupon_id)
      let coupon: any = null
      if (appliedCouponId) {
        const couponRows = await fetchRowsByIds(COUPON_TABLES, "id", [appliedCouponId])
        const c = couponRows[0]
        if (c) {
          coupon = {
            id: safeString(c.id),
            code: safeString(c.code),
            discountType: safeString(c.discountType ?? c.discount_type),
            discountValue: safeNumber(c.discountValue ?? c.discount_value),
          }
        }
      }

      const [transactionRows, noteRows, statusHistoryRows, refundRows, returnRequestRows] = await Promise.all([
        fetchRowsByForeignKey(TRANSACTION_TABLES, { camel: "orderId", snake: "order_id" }, orderId, {
          orderBy: { camel: "createdAt", snake: "created_at", ascending: false },
        }),
        fetchRowsByForeignKey(ORDER_NOTE_TABLES, { camel: "orderId", snake: "order_id" }, orderId, {
          orderBy: { camel: "createdAt", snake: "created_at", ascending: false },
        }),
        fetchRowsByForeignKey(
          ORDER_STATUS_HISTORY_TABLES,
          { camel: "orderId", snake: "order_id" },
          orderId,
          { orderBy: { camel: "changedAt", snake: "changed_at", ascending: false } },
        ),
        fetchRowsByForeignKey(REFUND_RECORD_TABLES, { camel: "orderId", snake: "order_id" }, orderId, {
          orderBy: { camel: "createdAt", snake: "created_at", ascending: false },
        }),
        fetchRowsByForeignKey(RETURN_REQUEST_TABLES, { camel: "orderId", snake: "order_id" }, orderId, {
          orderBy: { camel: "createdAt", snake: "created_at", ascending: false },
        }),
      ])
      const returnRequestItemRows: Array<Record<string, unknown>> = []
      for (const req of returnRequestRows) {
        const reqId = safeString((req as any).id)
        if (!reqId) continue
        const rows = await fetchRowsByForeignKey(
          RETURN_REQUEST_ITEM_TABLES,
          { camel: "returnRequestId", snake: "return_request_id" },
          reqId,
        )
        returnRequestItemRows.push(...rows)
      }

      const userId = safeString(row.userId ?? row.user_id) || null
      let user: Record<string, unknown> | null = null
      if (userId) {
        const userRows = await fetchRowsByIds(USER_TABLES, "id", [userId], "id,name,email")
        const found = userRows[0] ?? null
        if (found) {
          user = {
            id: safeString(found.id),
            name: safeString(found.name) || null,
            email: safeString(found.email) || null,
          }
        }
      }

      const transactions = transactionRows.map((tx) => ({
        id: safeString(tx.id),
        gateway: safeString(tx.gateway),
        amount: safeNumber(tx.amount, 0),
        status: safeString(tx.status),
        externalId: safeString(tx.externalId ?? tx.external_id) || null,
        createdAt: (tx.createdAt ?? tx.created_at ?? null) as string | Date | null,
      }))

      const notes = noteRows.map((note) => ({
        id: safeString(note.id),
        note: safeString(note.note),
        isInternal: Boolean(note.isInternal ?? note.is_internal),
        createdAt: (note.createdAt ?? note.created_at ?? null) as string | Date | null,
      }))

      const statusHistory = statusHistoryRows.map((entry) => ({
        id: safeString(entry.id),
        fromStatus: safeString(entry.fromStatus ?? entry.from_status) || null,
        toStatus: safeString(entry.toStatus ?? entry.to_status),
        notes: safeString(entry.notes) || null,
        reasonCode: safeString(entry.reasonCode ?? entry.reason_code) || null,
        changedById: safeString(entry.changedById ?? entry.changed_by_id) || null,
        changedAt: (entry.changedAt ?? entry.changed_at ?? null) as string | Date | null,
      }))

      const refunds = refundRows.map((refund) => ({
        id: safeString(refund.id),
        status: safeString(refund.status),
        amount: safeNumber(refund.amount, 0),
      }))

      const returnItemsByRequestId = new Map<string, Array<Record<string, unknown>>>()
      for (const item of returnRequestItemRows) {
        const requestId = safeString((item as any).returnRequestId ?? (item as any).return_request_id)
        if (!requestId) continue
        const list = returnItemsByRequestId.get(requestId) ?? []
        list.push(item)
        returnItemsByRequestId.set(requestId, list)
      }
      const returnRequests = returnRequestRows.map((req) => {
        const reqId = safeString((req as any).id)
        const items = (returnItemsByRequestId.get(reqId) ?? []).map((item) => ({
          id: safeString((item as any).id),
          orderItemId: safeString((item as any).orderItemId ?? (item as any).order_item_id),
          requestedQty: safeNumber((item as any).requestedQty ?? (item as any).requested_qty, 0),
        }))
        return {
          id: reqId,
          status: safeString((req as any).status),
          reason: safeString((req as any).reason) || null,
          productId: safeString((req as any).productId ?? (req as any).product_id) || null,
          imageUrl: safeString((req as any).imageUrl ?? (req as any).image_url) || null,
          description: safeString((req as any).description) || null,
          videoUrl: safeString((req as any).videoUrl ?? (req as any).video_url) || null,
          images: (req as any).images ?? (req as any).Images ?? null,
          returnType: safeString((req as any).returnType ?? (req as any).return_type) || null,
          refundMethod: safeString((req as any).refundMethod ?? (req as any).refund_method) || null,
          upiId: safeString((req as any).upiId ?? (req as any).upi_id) || null,
          bankDetails: (req as any).bankDetails ?? (req as any).bank_details ?? null,
          adminNote: safeString((req as any).adminNote ?? (req as any).admin_note) || null,
          rejectionReason: safeString((req as any).rejectionReason ?? (req as any).rejection_reason) || null,
          reverseAwb: safeString((req as any).reverseAwb ?? (req as any).reverse_awb) || null,
          reverseCourier: safeString((req as any).reverseCourier ?? (req as any).reverse_courier) || null,
          reverseTrackingUrl: safeString((req as any).reverseTrackingUrl ?? (req as any).reverse_tracking_url) || null,
          pickupScheduledAt: (req as any).pickupScheduledAt ?? (req as any).pickup_scheduled_at ?? null,
          createdAt: (req as any).createdAt ?? (req as any).created_at ?? null,
          items,
        }
      })

      return {
        ...row,
        id: safeString(row.id),
        userId,
        status: safeString(row.status) || "pending",
        paymentStatus: safeString(row.paymentStatus ?? row.payment_status) || "PENDING",
        total: Number(row.total ?? 0),
        subtotal: Number(row.subtotal ?? 0),
        discount: Number(row.discount ?? 0),
        tax: Number(row.tax ?? 0),
        shippingCharge: Number(row.shippingCharge ?? row.shipping_charge ?? row.shipping ?? 0),
        savingAmount: Number(row.savingAmount ?? row.saving_amount ?? 0),
        totalItemsUsedForShipping:
          row.totalItemsUsedForShipping != null || row.total_items_used_for_shipping != null
            ? Number(row.totalItemsUsedForShipping ?? row.total_items_used_for_shipping ?? 0)
            : null,
        shipping: Number(row.shipping ?? 0),
        currency: safeString(row.currency) || "INR",
        couponCode: safeString(row.couponCode ?? row.coupon_code) || null,
        paymentMethod: safeString(row.paymentMethod ?? row.payment_method) || null,
        paymentId: safeString(row.paymentId ?? row.payment_id) || null,
        customerName: (row.customerName ?? row.customer_name ?? null) as string | null,
        customerPhone: (row.customerPhone ?? row.customer_phone ?? null) as string | null,
        customerAddress: (row.customerAddress ?? row.customer_address ?? null) as string | null,
        customerEmail: (row.customerEmail ?? row.customer_email ?? null) as string | null,
        shiprocketOrderId: safeString((row as Record<string, unknown>).shiprocketOrderId ?? (row as Record<string, unknown>).shiprocket_order_id) || null,
        shipmentId: safeString((row as Record<string, unknown>).shipmentId ?? (row as Record<string, unknown>).shipment_id) || null,
        awbCode: safeString((row as Record<string, unknown>).awbCode ?? (row as Record<string, unknown>).awb_code) || null,
        courierName: safeString((row as Record<string, unknown>).courierName ?? (row as Record<string, unknown>).courier_name) || null,
        courierCompanyId: safeString((row as Record<string, unknown>).courierCompanyId ?? (row as Record<string, unknown>).courier_company_id) || null,
        trackingNumber: safeString((row as Record<string, unknown>).trackingNumber ?? (row as Record<string, unknown>).tracking_number) || null,
        trackingUrl: safeString((row as Record<string, unknown>).trackingUrl ?? (row as Record<string, unknown>).tracking_url) || null,
        shippingStatus: safeString((row as Record<string, unknown>).shippingStatus ?? (row as Record<string, unknown>).shipping_status) || null,
        shipmentStatus: safeString((row as Record<string, unknown>).shipmentStatus ?? (row as Record<string, unknown>).shipment_status) || null,
        pickupStatus: safeString((row as Record<string, unknown>).pickupStatus ?? (row as Record<string, unknown>).pickup_status) || null,
        shippingCharges: (row.shippingCharges ?? row.shipping_charges ?? null) as number | null,
        shippingMethod: safeString((row as Record<string, unknown>).shippingMethod ?? (row as Record<string, unknown>).shipping_method) || null,
        estimatedDeliveryDate: (row.estimatedDeliveryDate ?? row.estimated_delivery_date ?? null) as string | Date | null,
        shiprocketRawResponse: (row.shiprocketRawResponse ?? row.shiprocket_raw_response ?? null) as unknown,
        shipmentCreatedAt: (row.shipmentCreatedAt ?? row.shipment_created_at ?? null) as string | Date | null,
        shipmentSyncedAt: (row.shipmentSyncedAt ?? row.shipment_synced_at ?? null) as string | Date | null,
        shipmentDeliveredAt: (row.shipmentDeliveredAt ?? row.shipment_delivered_at ?? null) as string | Date | null,
        lastTrackingSyncAt: (row.lastTrackingSyncAt ?? row.last_tracking_sync_at ?? null) as string | Date | null,
        isShipmentCreated: (row.isShipmentCreated ?? row.is_shipment_created ?? null) as boolean | null,
        isPickupGenerated: (row.isPickupGenerated ?? row.is_pickup_generated ?? null) as boolean | null,
        isLabelGenerated: (row.isLabelGenerated ?? row.is_label_generated ?? null) as boolean | null,
        trackingData: (row.trackingData ?? row.tracking_data ?? null) as unknown,
        createdAt: (row.createdAt ?? row.created_at ?? null) as string | Date | null,
        updatedAt: (row.updatedAt ?? row.updated_at ?? null) as string | Date | null,
        items: hydratedItems,
        transactions,
        statusHistory,
        refunds,
        returnRequests,
        notes,
        user,
        appliedCouponId,
        coupon,
      } satisfies SupabaseOrderRecord
    }
  }
  return null
}

export const getOrderWithOpsRelationsSupabase = async (orderId: string) => {
  const base = await getOrderByIdSupabaseBasic(orderId)
  if (!base) return null
  const client = getSupabaseAdmin()
  const shipments: any[] = []
  for (const table of SHIPMENT_TABLES) {
    const attempts = [
      () => client.from(table).select("*").eq("orderId", orderId).order("createdAt", { ascending: false }),
      () => client.from(table).select("*").eq("order_id", orderId).order("created_at", { ascending: false }),
    ]
    for (const run of attempts) {
      const { data, error } = await run()
      if (!error && Array.isArray(data)) {
        shipments.push(...data)
        break
      }
    }
    if (shipments.length) break
  }
  const statusHistory: any[] = []
  for (const table of ORDER_STATUS_HISTORY_TABLES) {
    const attempts = [
      () => client.from(table).select("*").eq("orderId", orderId).order("changedAt", { ascending: false }),
      () => client.from(table).select("*").eq("order_id", orderId).order("changed_at", { ascending: false }),
    ]
    for (const run of attempts) {
      const { data, error } = await run()
      if (!error && Array.isArray(data)) {
        statusHistory.push(...data)
        break
      }
    }
    if (statusHistory.length) break
  }
  return {
    ...base,
    paymentMethod: safeString((base as Record<string, unknown>).paymentMethod ?? (base as Record<string, unknown>).payment_method) || null,
    shipments,
    statusHistory,
  }
}

export const listOrderShipmentsSupabase = async (orderId: string) => {
  const client = getSupabaseAdmin()
  for (const table of SHIPMENT_TABLES) {
    const attempts = [
      () => client.from(table).select("*").eq("orderId", orderId).order("createdAt", { ascending: false }),
      () => client.from(table).select("*").eq("order_id", orderId).order("created_at", { ascending: false }),
    ]
    for (const run of attempts) {
      const { data, error } = await run()
      if (error || !Array.isArray(data)) continue
      const rows = data as Array<Record<string, unknown>>
      const enriched = []
      for (const row of rows) {
        const shipmentId = safeString(row.id)
        const items: any[] = []
        for (const itemTable of SHIPMENT_ITEM_TABLES) {
          const itemAttempts = [
            () => client.from(itemTable).select("*").eq("shipmentId", shipmentId),
            () => client.from(itemTable).select("*").eq("shipment_id", shipmentId),
          ]
          for (const itemRun of itemAttempts) {
            const itemResult = await itemRun()
            if (!itemResult.error && Array.isArray(itemResult.data)) {
              items.push(...itemResult.data)
              break
            }
          }
          if (items.length) break
        }
        enriched.push({ ...row, items })
      }
      return enriched
    }
  }
  return []
}

export const getCodSettlementSupabase = async (orderId: string) => {
  const client = getSupabaseAdmin()
  for (const table of COD_SETTLEMENT_TABLES) {
    const attempts = [
      () => client.from(table).select("*").eq("orderId", orderId).maybeSingle(),
      () => client.from(table).select("*").eq("order_id", orderId).maybeSingle(),
    ]
    for (const run of attempts) {
      const { data, error } = await run()
      if (!error && data) return data as Record<string, unknown>
    }
  }
  return null
}

export const createOrderWithItemsSupabase = async (input: {
  orderData: Record<string, unknown>
  itemRows: Array<Record<string, unknown>>
}) => {
  const client = getSupabaseAdmin()

  const now = new Date().toISOString()
  const camelOrderData = withId({
    ...input.orderData,
    createdAt: input.orderData.createdAt ?? now,
    updatedAt: now,
  })
  const snakeOrderData = withId({
    ...camelToSnakeObject(input.orderData),
    created_at: input.orderData.createdAt ?? now,
    updated_at: now,
  })

  let orderId: string | null = null;
  let insertedTable = "";

  for (const table of ORDER_TABLES) {
    const insertAttempts = [
      () => client.from(table).insert(camelOrderData).select("id").single(),
      () => client.from(table).insert(snakeOrderData).select("id").single(),
    ]
    for (const attempt of insertAttempts) {
      const { data, error } = await attempt();
      if (error) {
        console.error(`[orders.createOrderWithItemsSupabase] Insert failed for table ${table}:`, error);
      }
      if (!error && data?.id) {
        orderId = safeString(data.id);
        insertedTable = table;
        break;
      }
    }
    if (orderId) break;
  }

  if (!orderId) {
    console.error("[orders.createOrderWithItemsSupabase] order insert failed in all attempts");
    return null;
  }

  // ✅ Insert order items
  let itemOk = false;
  for (const itemTable of ORDER_ITEM_TABLES) {
    let inserted = false

    const camelRows = input.itemRows.map((row) => withId({
      ...row,
      orderId,
    }))
    const snakeRows = input.itemRows.map((row) => withId({
      ...camelToSnakeObject(row),
      order_id: orderId,
    }))

    for (const rows of [camelRows, snakeRows]) {
      const result = await client.from(itemTable).insert(rows)
      if (result.error) console.error(`[orders.createOrderWithItemsSupabase] Item insert error table=${itemTable}:`, result.error);

      if (!result.error) {
        inserted = true;
        break;
      } else {
        if (shouldRetryWithId(result.error.message)) {
          const retry = await client.from(itemTable).insert(rows.map(withId))
          if (!retry.error) {
            inserted = true;
            break;
          }
        }
      }
    }

    if (inserted) {
      itemOk = true;
      break;
    }
  }

  if (!itemOk) {
    await client.from(insertedTable).delete().eq("id", orderId)
    throw new Error("Order items insert failed; order rolled back")
  }

  return { id: orderId }
}

export const createTransactionSupabase = async (input: {
  orderId: string
  gateway: string
  amount: number
  status: string
  externalId?: string | null
}) => {
  const client = getSupabaseAdmin()
  for (const table of TRANSACTION_TABLES) {
    const camel = {
      orderId: input.orderId,
      gateway: input.gateway,
      amount: input.amount,
      status: input.status,
      externalId: input.externalId ?? null,
    }
    const snake = {
      order_id: input.orderId,
      gateway: input.gateway,
      amount: input.amount,
      status: input.status,
      external_id: input.externalId ?? null,
    }
    for (const payload of [camel, snake]) {
      const inserted = await client.from(table).insert(payload).select("id").maybeSingle()
      if (!inserted.error && inserted.data?.id) return safeString((inserted.data as any).id)
      if (inserted.error && shouldRetryWithId(inserted.error.message)) {
        const retry = await client.from(table).insert(withId(payload)).select("id").maybeSingle()
        if (!retry.error && retry.data?.id) return safeString((retry.data as any).id)
      }
    }
  }
  return null
}

export const upsertOrderShipmentSnapshotSupabase = async (
  orderId: string,
  input: Partial<{
    shiprocketOrderId: string | null
    shipmentId: string | null
    awbCode: string | null
    courierName: string | null
    courierCompanyId: string | null
    trackingNumber: string | null
    trackingUrl: string | null
    shippingStatus: string | null
    shipmentStatus: string | null
    pickupStatus: string | null
    shippingCharges: number | null
    shippingMethod: string | null
    estimatedDeliveryDate: Date | null
    shiprocketRawResponse: unknown
    shipmentCreatedAt: Date | null
    shipmentSyncedAt: Date | null
    shipmentDeliveredAt: Date | null
    lastTrackingSyncAt: Date | null
    isShipmentCreated: boolean | null
    isPickupGenerated: boolean | null
    isLabelGenerated: boolean | null
    trackingData: unknown
    shippingStatusCode: number | null
    awbAssignedAt: Date | null
    labelUrl: string | null
    pickupGeneratedAt: Date | null
  }>,
) => {
  const client = getSupabaseAdmin()
  const now = new Date().toISOString()
  const payload = {
    ...input,
    updatedAt: now,
  }
  const snakePayload = camelToSnakeObject(payload)
  for (const table of ORDER_TABLES) {
    const attempts = [
      () => client.from(table).update(payload).eq("id", orderId).select("id").maybeSingle(),
      () => client.from(table).update(snakePayload).eq("id", orderId).select("id").maybeSingle(),
    ]
    for (const run of attempts) {
      const { data, error } = await run()
      if (!error && data?.id) return safeString((data as { id?: unknown }).id)
    }
  }
  return null
}

