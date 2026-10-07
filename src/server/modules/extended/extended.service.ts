import { pgQuery, pgTx } from "@/src/server/db/pg"
import { randomUUID } from "crypto"
import { createBrandSupabase, listBrandsSupabase } from "@/src/lib/db/brands"
import {
  createUserAddressSupabase,
  deleteUserAddressSupabase,
  listUserAddressesSupabase,
  updateUserAddressSupabase,
} from "@/src/lib/db/users"
import { getReturnIneligibilityReason } from "@/src/lib/returns/return-eligibility"
import { updateOrderStatus } from "@/src/server/modules/orders/orders.service"
import { env } from "@/src/server/core/config/env"
import { logger } from "@/lib/logger"
import { getSupabaseAdmin } from "@/src/lib/supabase/admin"

const supabase = () => getSupabaseAdmin()
const normalizeSlug = (slug: string) => slug.trim().toLowerCase().replace(/\s+/g, "-")

export const listBrands = async () => {
  try {
    return await listBrandsSupabase()
  } catch (error) {
    logger.warn("brands.list.supabase_pg_fallback", {
      error: error instanceof Error ? error.message : "unknown",
    })
    return pgQuery(`SELECT * FROM "Brand" ORDER BY name ASC`)
  }
}

export const createBrand = (name: string, slug: string) =>
  createBrandSupabase({ name, slug }).catch((error) => {
    logger.warn("brands.create.supabase_pg_fallback", {
      error: error instanceof Error ? error.message : "unknown",
    })
    return pgQuery(
      `INSERT INTO "Brand" (id, name, slug, "createdAt", "updatedAt") VALUES ($1, $2, $3, now(), now()) RETURNING *`,
      [randomUUID(), name, slug.trim().toLowerCase().replace(/\s+/g, "-")],
    ).then((rows) => rows[0])
  })

export const listTags = () => pgQuery(`SELECT * FROM "Tag" ORDER BY name ASC`)

export const createTag = (name: string, slug: string) =>
  pgQuery(
    `INSERT INTO "Tag" (id, name, slug, "createdAt", "updatedAt", "isActive") VALUES ($1, $2, $3, now(), now(), true) RETURNING *`,
    [randomUUID(), name, slug.trim().toLowerCase().replace(/\s+/g, "-")],
  ).then((rows) => rows[0])

export const updateTag = async (id: string, name: string, slug: string, isActive: boolean) => {
  const sets: string[] = []
  const values: any[] = []
  if (name !== undefined) {
    values.push(name)
    sets.push(`name = $${values.length}`)
  }
  if (slug !== undefined) {
    values.push(slug.trim().toLowerCase().replace(/\s+/g, "-"))
    sets.push(`slug = $${values.length}`)
  }
  if (isActive !== undefined) {
    values.push(isActive)
    sets.push(`"isActive" = $${values.length}`)
  }
  sets.push(`"updatedAt" = now()`)
  values.push(id)
  const rows = await pgQuery(`UPDATE "Tag" SET ${sets.join(", ")} WHERE id = $${values.length} RETURNING *`, values)
  return rows[0]
}

export const listAttributeDefs = () => pgQuery(`SELECT * FROM "AttributeDef" ORDER BY name ASC`)

export const createAttributeDef = (name: string, slug: string) =>
  pgQuery(
    `INSERT INTO "AttributeDef" (id, name, slug, "createdAt", "updatedAt", "isActive") VALUES ($1, $2, $3, now(), now(), true) RETURNING *`,
    [randomUUID(), name, slug.trim().toLowerCase().replace(/\s+/g, "-")],
  ).then((rows) => rows[0])

export type InventoryRow =
  | {
    id: string
    productId: string
    warehouse: string | null
    available: number
    reserved: number
    source: "warehouse"
    product: { name: string; slug: string }
  }
  | {
    id: string
    productId: string
    warehouse: null
    available: number
    reserved: number
    source: "variant"
    variantName: string
    product: { name: string; slug: string }
  }

export const listInventoryOverview = async (): Promise<InventoryRow[]> => {
  const rows = await pgQuery<
    Array<{
      id: string
      productId: string
      warehouse: string | null
      available: number
      reserved: number
      product_name: string
      product_slug: string
    }>
  >(
    `
      SELECT ii.id, ii."productId" as "productId", ii.warehouse, ii.available, ii.reserved,
             p.name as product_name, p.slug as product_slug
      FROM "InventoryItem" ii
      INNER JOIN "Product" p ON p.id = ii."productId"
      ORDER BY ii.available ASC
      LIMIT 200
    `,
  )
  const fromWarehouse: InventoryRow[] = rows.map((r) => ({
    id: r.id,
    productId: r.productId,
    warehouse: r.warehouse,
    available: Number(r.available ?? 0),
    reserved: Number(r.reserved ?? 0),
    source: "warehouse" as const,
    product: { name: r.product_name, slug: r.product_slug },
  }))

  const variants = await pgQuery<
    Array<{ id: string; productId: string; name: string; stock: number; product_name: string; product_slug: string }>
  >(
    `
      SELECT v.id, v."productId" as "productId", v.name, v.stock,
             p.name as product_name, p.slug as product_slug
      FROM "ProductVariant" v
      INNER JOIN "Product" p ON p.id = v."productId"
      ORDER BY v.stock ASC
      LIMIT 200
    `,
  )
  const fromVariant: InventoryRow[] = variants.map((v) => ({
    id: (v as any).id,
    productId: (v as any).productId,
    warehouse: null,
    available: Number(v.stock ?? 0),
    reserved: 0,
    source: "variant" as const,
    variantName: v.name,
    product: { name: v.product_name, slug: v.product_slug },
  }))
  if (fromWarehouse.length > 0) return fromWarehouse
  return fromVariant
}

export const updateInventoryItem = async (id: string, available: number, reserved?: number) => {
  const rows = await pgQuery<
    Array<{
      id: string
      productId: string
      warehouse: string | null
      available: number
      reserved: number
      product: { name: string; slug: string }
    }>
  >(
    `
      UPDATE "InventoryItem" ii
      SET available = $2, reserved = COALESCE($3, ii.reserved), "updatedAt" = now()
      WHERE ii.id = $1
      RETURNING ii.id, ii."productId" as "productId", ii.warehouse, ii.available, ii.reserved,
        (SELECT jsonb_build_object('name', p.name, 'slug', p.slug) FROM "Product" p WHERE p.id = ii."productId") as product
    `,
    [id, available, reserved ?? null],
  )
  return rows[0]
}

export const updateVariantStock = async (id: string, stock: number) => {
  const rows = await pgQuery<
    Array<{ id: string; productId: string; name: string; stock: number; product: { name: string; slug: string } }>
  >(
    `
      UPDATE "ProductVariant" v
      SET stock = $2, "updatedAt" = now()
      WHERE v.id = $1
      RETURNING v.id, v."productId" as "productId", v.name, v.stock,
        (SELECT jsonb_build_object('name', p.name, 'slug', p.slug) FROM "Product" p WHERE p.id = v."productId") as product
    `,
    [id, stock],
  )
  return rows[0]
}

export const listReviews = async (filters?: { status?: string; productId?: string; orderId?: string; userId?: string }) => {
  const params: any[] = []
  const where: string[] = []
  if (filters?.status) (params.push(filters.status), where.push(`r.status = $${params.length}`))
  if (filters?.productId) (params.push(filters.productId), where.push(`r."productId" = $${params.length}`))
  if (filters?.orderId) (params.push(filters.orderId), where.push(`r."orderId" = $${params.length}`))
  if (filters?.userId) (params.push(filters.userId), where.push(`r."userId" = $${params.length}`))
  const sql = `
    SELECT
      r.*,
      jsonb_build_object('name', p.name, 'slug', p.slug) as product,
      CASE WHEN u.id IS NULL THEN NULL ELSE jsonb_build_object('email', u.email, 'name', u.name) END as "user"
    FROM "ProductReview" r
    INNER JOIN "Product" p ON p.id = r."productId"
    LEFT JOIN "User" u ON u.id = r."userId"
    ${where.length ? `WHERE ${where.join(" AND ")}` : ""}
    ORDER BY r."createdAt" DESC
    LIMIT 200
  `
  return pgQuery(sql, params)
}

export const updateReviewStatus = async (id: string, status: string) => {
  const rows = await pgQuery(`UPDATE "ProductReview" SET status=$2, "updatedAt"=now() WHERE id=$1 RETURNING *`, [id, status])
  return rows[0]
}

export const createReview = async (input: {
  productId: string
  orderId?: string | null
  userId?: string | null
  guestName?: string | null
  guestEmail?: string | null
  rating: number
  title?: string
  body?: string
  status?: string
}) => {
  if (input.userId && input.orderId) {
    const existing = await pgQuery<Array<{ id: string }>>(
      `SELECT id FROM "ProductReview" WHERE "productId"=$1 AND "orderId"=$2 AND "userId"=$3 LIMIT 1`,
      [input.productId, input.orderId, input.userId],
    )
    if (existing[0]) throw new Error("Already reviewed")
  }
  const rows = await pgQuery(
    `
      INSERT INTO "ProductReview" (
        id, "productId", "orderId", "userId", "guestName", "guestEmail", rating, title, body, status, "createdAt", "updatedAt"
      )
      VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,now(),now())
      RETURNING *
    `,
    [
      randomUUID(),
      input.productId,
      input.orderId ?? null,
      input.userId ?? null,
      input.guestName ?? null,
      input.guestEmail ?? null,
      input.rating,
      input.title ?? null,
      input.body ?? null,
      input.status ?? "published",
    ],
  )
  return rows[0]
}

export const listReturnRequests = () =>
  pgQuery<Array<Record<string, unknown>>>(
    `
      SELECT
        rr.*,
        (
          SELECT jsonb_build_object(
            'id', o.id,
            'total', o.total,
            'status', o.status,
            'userId', o."userId",
            'paymentMethod', o."paymentMethod",
            'refunds', COALESCE((
              SELECT jsonb_agg(jsonb_build_object('id', r.id, 'amount', r.amount, 'status', r.status, 'createdAt', r."createdAt") ORDER BY r."createdAt" DESC)
              FROM "RefundRecord" r
              WHERE r."orderId" = o.id
            ), '[]'::jsonb)
          )
          FROM "Order" o
          WHERE o.id = rr."orderId"
        ) as "order",
        (
          SELECT to_jsonb(pu)
          FROM "ReturnPickup" pu
          WHERE pu."returnRequestId" = rr.id
          LIMIT 1
        ) as pickup,
        COALESCE((
          SELECT jsonb_agg(to_jsonb(it) ORDER BY it."createdAt" DESC)
          FROM "ReturnRequestItem" it
          WHERE it."returnRequestId" = rr.id
        ), '[]'::jsonb) as items
      FROM "ReturnRequest" rr
      ORDER BY rr."createdAt" DESC
      LIMIT 200
    `,
  )

export const updateReturnStatus = (id: string, status: string) =>
  pgQuery(`UPDATE "ReturnRequest" SET status=$2, "updatedAt"=now() WHERE id=$1 RETURNING *`, [id, status]).then((r) => r[0])

export type CreateReturnRequestMeta = {
  description?: string | null
  videoUrl?: string | null
  returnType: "refund" | "exchange"
  refundMethod?: "upi" | "bank" | null
  upiId?: string | null
  bankDetails?: Record<string, unknown> | null
  headerImages?: string[] | null
}

export const createReturnRequest = async (
  orderId: string,
  userId: string | null,
  reason: string | undefined,
  items: Array<{ orderItemId: string; productId: string; requestedQty: number; reasonCode?: string; notes?: string; imageUrl?: string }>,
  meta: CreateReturnRequestMeta,
) => {
  const cleanItems = (items ?? []).filter((item) => item.productId && item.orderItemId)
  if (cleanItems.length === 0) throw new Error("At least one return item is required")

  const orderRows = await pgQuery<
    Array<{
      id: string
      orderStatus: string
      paymentMethod: string | null
      latestLifecycle: string | null
      deliveredAt: Date | null
    }>
  >(
    `
    SELECT
      o.id,
      o.status::text as "orderStatus",
      o."paymentMethod",
      (
        SELECT h."toStatus"
        FROM "OrderStatusHistory" h
        WHERE h."orderId" = o.id
        ORDER BY h."changedAt" DESC NULLS LAST
        LIMIT 1
      ) as "latestLifecycle",
      COALESCE(
        (SELECT MAX(s."deliveredAt") FROM "Shipment" s WHERE s."orderId" = o.id AND s."deliveredAt" IS NOT NULL),
        (SELECT MAX(h."changedAt") FROM "OrderStatusHistory" h WHERE h."orderId" = o.id AND LOWER(TRIM(h."toStatus")) = 'delivered')
      ) AS "deliveredAt"
    FROM "Order" o
    WHERE o.id = $1
    LIMIT 1
    `,
    [orderId],
  )
  const order = orderRows[0]
  if (!order) throw new Error("Order not found")

  const windowDays = Number(env.RETURN_WINDOW_DAYS ?? "7")
  const ineligible = getReturnIneligibilityReason({
    orderStatus: String(order.orderStatus ?? "").toLowerCase(),
    latestLifecycle: order.latestLifecycle ? String(order.latestLifecycle).toLowerCase() : null,
    deliveredAt: order.deliveredAt,
    returnWindowDays: windowDays,
  })
  if (ineligible === "not_delivered") throw new Error("Returns are allowed only for delivered orders")
  if (ineligible === "missing_delivered_at") throw new Error("Delivery date is not available; contact support to request a return")
  if (ineligible === "return_window_expired") throw new Error(`Return window expired (${windowDays} days after delivery)`)

  const pm = String(order.paymentMethod ?? "").toLowerCase()
  if (meta.returnType === "refund" && pm === "cod") {
    const hasUpi = Boolean(meta.upiId?.trim())
    const hasBank = Boolean(meta.bankDetails && Object.keys(meta.bankDetails).length > 0)
    if (!hasUpi && !hasBank) {
      throw new Error("For COD refunds, provide a UPI ID or bank details")
    }
  }

  const active = await pgQuery<Array<{ id: string }>>(
    `
    SELECT id FROM "ReturnRequest"
    WHERE "orderId" = $1
      AND LOWER(status) NOT IN ('rejected', 'cancelled', 'completed', 'refunded')
    LIMIT 1
    `,
    [orderId],
  )
  if (active.length) throw new Error("An active return request already exists for this order")

  const shipmentRows = await pgQuery<Array<{ id: string }>>(
    `SELECT id FROM "Shipment" WHERE "orderId" = $1 ORDER BY "createdAt" DESC NULLS LAST LIMIT 1`,
    [orderId],
  )
  const shipmentId = shipmentRows[0]?.id ?? null

  const imageList = [...new Set([...(meta.headerImages ?? []), ...cleanItems.map((i) => i.imageUrl).filter(Boolean)])] as string[]

  const createdRows: Array<Record<string, unknown>> = []
  for (const item of cleanItems) {
    const rowId = randomUUID()
    const itemReason = [item.reasonCode?.trim(), item.notes?.trim(), item.imageUrl ? `Image: ${item.imageUrl}` : null]
      .filter(Boolean)
      .join(" | ")
    const combinedReason = [reason?.trim(), itemReason].filter(Boolean).join(" - ")

    const created = await pgQuery<Array<Record<string, unknown>>>(
      `
        INSERT INTO "ReturnRequest" (
          id, "orderId", "userId", "productId", reason, "imageUrl", description, "videoUrl", images,
          "returnType", "refundMethod", "upiId", "bankDetails", "shipmentId", status, "requestedAt", "createdAt", "updatedAt"
        )
        VALUES (
          $1, $2, $3, $4, $5, $6, $7, $8, $9::jsonb,
          $10, $11, $12, $13::jsonb, $14, 'requested', now(), now(), now()
        )
        RETURNING *
      `,
      [
        rowId,
        orderId,
        userId ?? null,
        item.productId,
        combinedReason || null,
        item.imageUrl ?? null,
        meta.description?.trim() || null,
        meta.videoUrl?.trim() || null,
        JSON.stringify(imageList),
        meta.returnType,
        meta.refundMethod ?? null,
        meta.upiId?.trim() || null,
        meta.bankDetails ? JSON.stringify(meta.bankDetails) : null,
        shipmentId,
      ],
    )
    createdRows.push(created[0])

    await pgQuery(
      `
        INSERT INTO "ReturnRequestItem" (
          id, "returnRequestId", "orderItemId", "requestedQty", "receivedQty", "reasonCode", notes, "createdAt", "updatedAt"
        )
        VALUES ($1, $2, $3, $4, 0, $5, $6, now(), now())
      `,
      [randomUUID(), rowId, item.orderItemId, item.requestedQty, item.reasonCode ?? null, item.notes?.trim() || null],
    )
  }

  await updateOrderStatus(orderId, "return_requested", userId ?? undefined, {
    reasonCode: "return_requested",
    note: "Customer submitted return request",
  }).catch(() => null)

  console.log("[returns] createReturnRequest.ok", { orderId, rows: createdRows.length })
  return createdRows[0]
}

export const listAbandonedCarts = () =>
  pgQuery<
    Array<{
      id: string
      sessionKey: string
      email: string | null
      itemsJson: unknown
      total: number | null
      updatedAt: Date
      createdAt: Date
    }>
  >(
    `SELECT id, "sessionKey", email, "itemsJson", total, "updatedAt", "createdAt"
     FROM "AbandonedCart"
     ORDER BY "updatedAt" DESC
     LIMIT 100`,
  )

export const upsertAbandonedCart = async (input: {
  sessionKey: string
  email?: string | null
  itemsJson: unknown
  total?: number | null
}) => {
  const rows = await pgQuery<
    Array<{
      id: string
      sessionKey: string
      email: string | null
      itemsJson: unknown
      total: number | null
      updatedAt: Date
      createdAt: Date
    }>
  >(
    `
      INSERT INTO "AbandonedCart" (id, "sessionKey", email, "itemsJson", total, "createdAt", "updatedAt")
      VALUES (gen_random_uuid()::text, $1, $2, $3::jsonb, $4, now(), now())
      ON CONFLICT ("sessionKey") DO UPDATE
      SET email = EXCLUDED.email,
          "itemsJson" = EXCLUDED."itemsJson",
          total = EXCLUDED.total,
          "updatedAt" = now()
      RETURNING id, "sessionKey", email, "itemsJson", total, "updatedAt", "createdAt"
    `,
    [input.sessionKey, input.email ?? null, JSON.stringify(input.itemsJson ?? []), input.total ?? null],
  )
  return rows[0]
}

export const listPromotions = () =>
  (async () => {
    const promos = await pgQuery<Array<any>>(`SELECT * FROM "Promotion" ORDER BY "updatedAt" DESC LIMIT 100`)
    const promoIds = promos.map((p) => p.id)
    if (promoIds.length === 0) return promos
    const products = await pgQuery<Array<any>>(
      `
        SELECT pp.*, to_jsonb(p) as product
        FROM "PromotionProduct" pp
        INNER JOIN "Product" p ON p.id = pp."productId"
        WHERE pp."promotionId" = ANY($1::text[])
      `,
      [promoIds],
    )
    const variants = await pgQuery<Array<any>>(
      `
        SELECT pv.*, to_jsonb(v) as variant
        FROM "PromotionVariant" pv
        INNER JOIN "ProductVariant" v ON v.id = pv."variantId"
        WHERE pv."promotionId" = ANY($1::text[])
      `,
      [promoIds],
    )
    const byPromoProducts = new Map<string, any[]>()
    for (const row of products) {
      const arr = byPromoProducts.get(row.promotionId) ?? []
      arr.push(row)
      byPromoProducts.set(row.promotionId, arr)
    }
    const byPromoVariants = new Map<string, any[]>()
    for (const row of variants) {
      const arr = byPromoVariants.get(row.promotionId) ?? []
      arr.push(row)
      byPromoVariants.set(row.promotionId, arr)
    }
    return promos.map((p) => ({
      ...p,
      products: byPromoProducts.get(p.id) ?? [],
      variants: byPromoVariants.get(p.id) ?? [],
    }))
  })()

export const createPromotion = async (input: {
  kind: string
  name: string
  active?: boolean
  startsAt?: Date | null
  endsAt?: Date | null

  products?: Array<{
    productId: string
    discountPercent?: number

    variants?: Array<{
      variantId: string
      discountPercent: number
    }>
  }>

  metadata?: unknown
}) => {
  return pgTx(async (client) => {
    const promoId = randomUUID()
    const metadata =
      input.products
        ? { products: input.products.map((p) => ({ productId: p.productId, discountPercent: p.discountPercent ?? null })) }
        : input.metadata ?? null
    await client.query(
      `INSERT INTO "Promotion" (id, name, active, "startsAt", "endsAt", metadata, kind, "createdAt", "updatedAt")
       VALUES ($1,$2,$3,$4,$5,$6::jsonb,$7,now(),now())`,
      [promoId, input.name, input.active ?? true, input.startsAt ?? null, input.endsAt ?? null, JSON.stringify(metadata), input.kind],
    )
    if (input.products?.length) {
      for (const p of input.products) {
        await client.query(
          `INSERT INTO "PromotionProduct" (id, "promotionId", "productId") VALUES ($1,$2,$3) ON CONFLICT ("promotionId","productId") DO NOTHING`,
          [randomUUID(), promoId, p.productId],
        )
        for (const v of p.variants ?? []) {
          await client.query(
            `INSERT INTO "PromotionVariant" (id, "promotionId", "variantId", metadata)
             VALUES ($1,$2,$3,$4::jsonb)
             ON CONFLICT ("promotionId","variantId") DO UPDATE SET metadata = EXCLUDED.metadata`,
            [randomUUID(), promoId, v.variantId, JSON.stringify({ discountPercent: v.discountPercent })],
          )
        }
      }
    }
    const rows = await client.query(`SELECT * FROM "Promotion" WHERE id=$1 LIMIT 1`, [promoId])
    return rows.rows[0]
  })
}

export const updatePromotion = async (
  id: string,
  input: Partial<{
    kind: string
    name: string
    active: boolean
    startsAt: Date | null
    endsAt: Date | null

    products: Array<{
      productId: string
      discountPercent?: number

      variants?: Array<{
        variantId: string
        discountPercent: number
      }>
    }>

    metadata: unknown
  }>
) => {
  return pgTx(async (client) => {
    const sets: string[] = []
    const params: any[] = []
    const push = (col: string, v: any, castJson = false) => {
      params.push(v)
      sets.push(`${col} = $${params.length}${castJson ? "::jsonb" : ""}`)
    }

    if (input.kind !== undefined) push(`kind`, input.kind)
    if (input.name !== undefined) push(`name`, input.name)
    if (input.active !== undefined) push(`active`, input.active)
    if (input.startsAt !== undefined) push(`"startsAt"`, input.startsAt)
    if (input.endsAt !== undefined) push(`"endsAt"`, input.endsAt)

    if (input.products !== undefined) {
      push(
        `metadata`,
        JSON.stringify({ products: input.products.map((p) => ({ productId: p.productId, discountPercent: p.discountPercent ?? null })) }),
        true,
      )
    } else if (input.metadata !== undefined) {
      push(`metadata`, JSON.stringify(input.metadata ?? null), true)
    }

    sets.push(`"updatedAt" = now()`)
    params.push(id)
    await client.query(`UPDATE "Promotion" SET ${sets.join(", ")} WHERE id = $${params.length}`, params)

    if (input.products !== undefined) {
      await client.query(`DELETE FROM "PromotionProduct" WHERE "promotionId" = $1`, [id])
      await client.query(`DELETE FROM "PromotionVariant" WHERE "promotionId" = $1`, [id])
      for (const p of input.products) {
        await client.query(
          `INSERT INTO "PromotionProduct" (id, "promotionId", "productId") VALUES ($1,$2,$3) ON CONFLICT ("promotionId","productId") DO NOTHING`,
          [randomUUID(), id, p.productId],
        )
        for (const v of p.variants ?? []) {
          await client.query(
            `INSERT INTO "PromotionVariant" (id, "promotionId", "variantId", metadata)
             VALUES ($1,$2,$3,$4::jsonb)
             ON CONFLICT ("promotionId","variantId") DO UPDATE SET metadata = EXCLUDED.metadata`,
            [randomUUID(), id, v.variantId, JSON.stringify({ discountPercent: v.discountPercent })],
          )
        }
      }
    }

    const rows = await client.query(`SELECT * FROM "Promotion" WHERE id=$1 LIMIT 1`, [id])
    return rows.rows[0]
  })
}

export const financeSummary = async () => {

  const salesRows = await pgQuery<Array<{ gross_sales: number; order_count: number }>>(
    `SELECT COALESCE(SUM(total),0)::numeric as gross_sales, COUNT(*)::int as order_count FROM "Order"`,
  )
  const refundRows = await pgQuery<Array<{ refunds_total: number }>>(
    `SELECT COALESCE(SUM(amount),0)::numeric as refunds_total FROM "RefundRecord" WHERE status='completed'`,
  )
  const grossSales = Number(salesRows[0]?.gross_sales ?? 0)
  const refundsTotal = Number(refundRows[0]?.refunds_total ?? 0)

  // ✅ Net Revenue Calculation
  const netRevenue =
    grossSales - refundsTotal;

  return {

    grossSales,

    netRevenue, // ⭐ NEW (Important)

    orderCount: Number(salesRows[0]?.order_count ?? 0),

    refundsTotal,

  };
};
export const listWithdrawals = () =>
  pgQuery(
    `
      SELECT
        wr.*,
        CASE WHEN u1.id IS NULL THEN NULL ELSE jsonb_build_object('id', u1.id, 'name', u1.name, 'email', u1.email) END as "createdBy",
        CASE WHEN u2.id IS NULL THEN NULL ELSE jsonb_build_object('id', u2.id, 'name', u2.name, 'email', u2.email) END as "managedBy"
      FROM "WithdrawalRequest" wr
      LEFT JOIN "User" u1 ON u1.id = wr."createdById"
      LEFT JOIN "User" u2 ON u2.id = wr."managedById"
      ORDER BY wr."createdAt" DESC
      LIMIT 100
    `,
  )

export const updateWithdrawalStatus = (id: string, status: string) =>
  pgQuery(`UPDATE "WithdrawalRequest" SET status=$2, "updatedAt"=now() WHERE id=$1 RETURNING *`, [id, status]).then((r) => r[0])

export const listRefunds = (page = 1, limit = 20) =>
  pgQuery(
    `
      SELECT
        r.*,
        (SELECT jsonb_build_object('id', o.id, 'total', o.total) FROM "Order" o WHERE o.id = r."orderId") as "order"
      FROM "RefundRecord" r
      ORDER BY r."createdAt" DESC
      OFFSET $1
      LIMIT $2
    `,
    [
      (Math.max(page, 1) - 1) * Math.min(Math.max(limit, 1), 100),
      Math.min(Math.max(limit, 1), 100),
    ],
  )

export const createRefund = (orderId: string, amount: number, reason?: string) =>
  pgTx(async (client) => {
    const orderRows = await client.query<{ total: any }>(`SELECT total FROM "Order" WHERE id=$1 LIMIT 1`, [orderId])
    const order = orderRows.rows[0]
    if (!order) throw new Error("Order not found")
    const refundAgg = await client.query<{ already: any }>(
      `SELECT COALESCE(SUM(amount),0)::numeric as already FROM "RefundRecord" WHERE "orderId"=$1 AND status NOT IN ('rejected','failed')`,
      [orderId],
    )
    const refundable = Number(order.total) - Number(refundAgg.rows[0]?.already ?? 0)
    if (refundable <= 0) throw new Error("Order already fully refunded")
    if (amount > refundable) throw new Error(`Amount exceeds refundable balance (${refundable.toFixed(2)})`)
    const created = await client.query(
      `INSERT INTO "RefundRecord" (id, "orderId", amount, reason, status, "createdAt", "updatedAt")
       VALUES ($1,$2,$3::numeric,$4,'pending',now(),now())
       RETURNING *`,
      [randomUUID(), orderId, amount, reason ?? null],
    )
    await client.query(`UPDATE "Order" SET "refundStatus" = 'PENDING', "updatedAt" = now() WHERE id = $1`, [orderId]).catch(() => null)
    return created.rows[0]
  })

export const updateRefundStatus = (id: string, status: string) =>
  pgQuery(`UPDATE "RefundRecord" SET status=$2, "updatedAt"=now() WHERE id=$1 RETURNING *`, [id, status]).then((r) => r[0])

export const reportTopProducts = async (limit = 20) => {
  const rows = await pgQuery<Array<{ productId: string; units: number; revenue: number }>>(
    `
      SELECT "productId" as "productId",
             COALESCE(SUM(quantity),0)::int as units,
             COALESCE(SUM("lineTotal"),0)::numeric as revenue
      FROM "OrderItem"
      GROUP BY "productId"
      ORDER BY COALESCE(SUM("lineTotal"),0) DESC
      LIMIT $1
    `,
    [limit],
  )
  const productIds = rows.map((r) => r.productId)
  const products = productIds.length
    ? await pgQuery<Array<{ id: string; name: string; slug: string }>>(`SELECT id, name, slug FROM "Product" WHERE id = ANY($1::text[])`, [
        productIds,
      ])
    : []
  const byId = Object.fromEntries(products.map((p) => [p.id, p]))
  return rows.map((r) => ({
    productId: r.productId,
    name: byId[r.productId]?.name ?? "—",
    slug: byId[r.productId]?.slug ?? "",
    units: Number(r.units ?? 0),
    revenue: Number((r as any).revenue ?? 0),
  }))
}

export const reportPlatformPerformance = async () => {
  const totals = await pgQuery<Array<{ revenue: number; lines: number }>>(
    `SELECT COALESCE(SUM("lineTotal"),0)::numeric as revenue, COUNT(*)::int as lines FROM "OrderItem"`,
  )
  return [
    {
      sellerId: "platform",
      name: "Platform",
      email: "",
      revenue: Number(totals[0]?.revenue ?? 0),
      lines: Number(totals[0]?.lines ?? 0),
    },
  ]
}

// Backward-compatible export for /api/v1/reports/sellers route name.
export const reportSellerPerformance = reportPlatformPerformance

export const listUserAddresses = (userId: string) =>
  listUserAddressesSupabase(userId).catch((error) => {
    logger.warn("addresses.list.supabase_pg_fallback", {
      error: error instanceof Error ? error.message : "unknown",
    })
    return pgQuery(`SELECT * FROM "UserAddress" WHERE "userId" = $1 ORDER BY "createdAt" DESC`, [userId])
  })

export const createUserAddress = (
  userId: string,
  data: {
    label?: string | null
    firstName?: string | null
    lastName?: string | null
    email?: string | null
    line1: string
    line2?: string | null
    city: string
    state: string
    postalCode: string
    country?: string
    phone?: string | null
    isDefault?: boolean
  },
) =>
  createUserAddressSupabase(userId, data).catch(async (error) => {
    logger.warn("addresses.create.supabase_pg_fallback", {
      error: error instanceof Error ? error.message : "unknown",
    })
    if (data.isDefault) {
      await pgQuery(`UPDATE "UserAddress" SET "isDefault" = false WHERE "userId" = $1`, [userId]).catch(() => null)
    }
    return pgQuery(
      `INSERT INTO "UserAddress" (id, "userId", label, "firstName", "lastName", email, line1, line2, city, state, "postalCode", country, phone, "isDefault", "createdAt", "updatedAt")
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,now(),now())
       RETURNING *`,
      [
        randomUUID(),
        userId,
        data.label ?? null,
        data.firstName ?? null,
        data.lastName ?? null,
        data.email ?? null,
        data.line1,
        data.line2 ?? null,
        data.city,
        data.state,
        data.postalCode,
        data.country ?? "IN",
        data.phone ?? null,
        data.isDefault ?? false,
      ],
    ).then((rows) => rows[0])
  })

export const updateUserAddress = async (
  id: string,
  userId: string,
  data: Partial<{
    firstName?: string | null
    lastName?: string | null
    email?: string | null
    label?: string | null
    line1?: string
    line2?: string | null
    city?: string
    state?: string
    postalCode?: string
    country?: string
    phone?: string | null
    isDefault?: boolean
  }>,
) => {
  try {
    const result = await updateUserAddressSupabase(id, userId, data)
    if (result.count > 0) return result
  } catch (error) {
    logger.warn("addresses.update.supabase_pg_fallback", {
      error: error instanceof Error ? error.message : "unknown",
    })
  }
  const found = await pgQuery<Array<{ id: string }>>(`SELECT id FROM "UserAddress" WHERE id=$1 AND "userId"=$2 LIMIT 1`, [id, userId])
  if (!found[0]) return { count: 0 }
  if (data.isDefault) {
    await pgQuery(`UPDATE "UserAddress" SET "isDefault" = false WHERE "userId" = $1`, [userId]).catch(() => null)
  }
  const sets: string[] = []
  const values: any[] = []
  for (const [k, v] of Object.entries(data)) {
    if (v === undefined) continue
    values.push(v)
    const col =
      k === "postalCode"
        ? `"postalCode"`
        : k === "firstName"
          ? `"firstName"`
          : k === "lastName"
            ? `"lastName"`
            : k === "isDefault"
              ? `"isDefault"`
              : k
    sets.push(`${col} = $${values.length}`)
  }
  sets.push(`"updatedAt" = now()`)
  values.push(id, userId)
  await pgQuery(`UPDATE "UserAddress" SET ${sets.join(", ")} WHERE id=$${values.length - 1} AND "userId"=$${values.length}`, values)
  return { count: 1 }
}

export const deleteUserAddress = (id: string, userId: string) =>
  deleteUserAddressSupabase(id, userId).catch((error) => {
    logger.warn("addresses.delete.supabase_pg_fallback", {
      error: error instanceof Error ? error.message : "unknown",
    })
    return pgQuery(`DELETE FROM "UserAddress" WHERE id=$1 AND "userId"=$2`, [id, userId]).then(() => ({ count: 1 }))
  })

export const listSavedPaymentMethods = (userId: string) =>
  pgQuery(`SELECT * FROM "SavedPaymentMethod" WHERE "userId"=$1 ORDER BY "createdAt" DESC`, [userId])

export const createSavedPaymentMethod = (
  userId: string,
  data: { provider: string; externalRef: string; last4?: string; brand?: string; isDefault?: boolean },
) =>
  pgQuery(
    `
      INSERT INTO "SavedPaymentMethod" (id, "userId", provider, "externalRef", last4, brand, "isDefault", "createdAt")
      VALUES ($1,$2,$3,$4,$5,$6,$7,now())
      RETURNING *
    `,
    [randomUUID(), userId, data.provider, data.externalRef, data.last4 ?? null, data.brand ?? null, data.isDefault ?? false],
  ).then((rows) => rows[0])

export async function deleteAbandonedCartBySession(sessionKey: string) {
  await pgQuery(`DELETE FROM "AbandonedCart" WHERE "sessionKey" = $1`, [sessionKey])
  return { deleted: true }
}
