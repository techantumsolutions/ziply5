import crypto from "node:crypto"
import { pgQuery, pgTx } from "@/src/server/db/pg"

type BundlePricingMode = "fixed" | "dynamic"
type BundleProductLite = {
  productId: string
  name: string
  slug: string
  price: number
  basePrice: number | null
  thumbnail: string | null
  status?: string | null
  isActive?: boolean | null
  comboPrice?: number | null
}

type BundleAvailability = {
  isAvailable: boolean
  maxPurchasableQty: number
  unavailableReason: string | null
}

type BundleRow = {
  id: string
  name: string
  slug: string
  pricingMode: string
  comboPrice: number | null
  description: string | null
  image: string | null
  isActive: boolean
  createdAt: Date
  updatedAt: Date
}

const MAX_BUNDLE_PRODUCTS = 3
const slugPattern = /^[a-z0-9_-]+$/

const slugify = (value: string) =>
  value
    .trim()
    .toLowerCase()
    .replace(/\s+/g, "-")
    .replace(/[^a-z0-9_-]/g, "")

const computeDynamicPrice = (products: BundleProductLite[]) =>
  products.reduce((sum, p) => sum + Number(p.price || 0), 0)

const computeSavings = (products: BundleProductLite[], effectivePrice: number) => {
  const listPrice = products.reduce((sum, p) => sum + Number(p.basePrice ?? p.price), 0)
  return Math.max(0, Number((listPrice - effectivePrice).toFixed(2)))
}

async function hydrateBundles(baseRows: BundleRow[]) {
  const ids = baseRows.map((x) => x.id)
  const products = ids.length
    ? await pgQuery<{
        bundleId: string
        productId: string
        name: string
        slug: string
        price: number
        basePrice: number | null
        thumbnail: string | null
        status: string | null
        isActive: boolean | null
        comboPrice: number | null
      }>(
        `
          SELECT
            bp."bundleId" as "bundleId",
            p.id as "productId",
            p.name,
            p.slug,
            p.price,
            p."basePrice" as "basePrice",
            p.thumbnail,
            p.status,
            p."isActive" as "isActive",
            bp."comboPrice" as "comboPrice"
          FROM "BundleProduct" bp
          JOIN "Product" p ON p.id = bp."productId"
          WHERE bp."bundleId" = ANY($1::text[])
          ORDER BY bp."createdAt" ASC
        `,
        [ids],
      )
    : []

  const byBundle = new Map<string, BundleProductLite[]>()
  for (const p of products) {
    const arr = byBundle.get(p.bundleId) ?? []
      arr.push({
        productId: p.productId,
        name: p.name,
        slug: p.slug,
        price: Number(p.price),
        basePrice: p.basePrice == null ? null : Number(p.basePrice),
        thumbnail: p.thumbnail,
        status: p.status,
        isActive: p.isActive,
        comboPrice: p.comboPrice == null ? null : Number(p.comboPrice),
      })
    byBundle.set(p.bundleId, arr)
  }

  const availabilityRows = ids.length
    ? await pgQuery<{
        bundleId: string
        productId: string
        productStatus: string
        productIsActive: boolean | null
        productType: string | null
        productStock: number | null
        variantId: string | null
        variantStock: number | null
      }>(
        `
          SELECT
            bp."bundleId" as "bundleId",
            bp."productId" as "productId",
            p.status as "productStatus",
            p."isActive" as "productIsActive",
            p.type as "productType",
            p."totalStock" as "productStock",
            pv.id as "variantId",
            pv.stock as "variantStock"
          FROM "BundleProduct" bp
          LEFT JOIN "Product" p ON p.id = bp."productId"
          LEFT JOIN "ProductVariant" pv ON pv."productId" = p.id
          WHERE bp."bundleId" = ANY($1::text[])
        `,
        [ids],
      )
    : []
  const availabilityByBundle = new Map<string, BundleAvailability>()
  for (const bundleId of ids) {
    const rows = availabilityRows.filter((row) => row.bundleId === bundleId)
    const grouped = new Map<string, typeof rows>()
    for (const row of rows) {
      const key = String(row.productId ?? "").trim()
      if (!key) continue
      const list = grouped.get(key) ?? []
      list.push(row)
      grouped.set(key, list)
    }
    const productIds = [...grouped.keys()]
    if (productIds.length < 1 || productIds.length > MAX_BUNDLE_PRODUCTS) {
      availabilityByBundle.set(bundleId, { isAvailable: false, maxPurchasableQty: 0, unavailableReason: "invalid_combo_children" })
      continue
    }
    const stockCaps: number[] = []
    let blockedReason: string | null = null
    for (const productId of productIds) {
      const productRows = grouped.get(productId) ?? []
      const first = productRows[0]
      if (!first) {
        blockedReason = "product_not_found"
        break
      }
      if (String(first.productStatus ?? "").toLowerCase() !== "published" || first.productIsActive === false) {
        blockedReason = "product_inactive"
        break
      }
      const hasVariants = productRows.some((row) => Boolean(row.variantId))
      const isSimple = first.productType === "simple" || (!hasVariants && first.productType !== "variant")
      if (isSimple) {
        const stock = Math.floor(Number(first.productStock ?? 0))
        if (stock <= 0) {
          blockedReason = "variant_unavailable"
          break
        }
        stockCaps.push(stock)
      } else {
        const validVariant = productRows
          .filter((row) => Boolean(row.variantId) && Number(row.variantStock ?? 0) > 0)
          .sort((a, b) => Number(b.variantStock ?? 0) - Number(a.variantStock ?? 0))[0]
        if (!validVariant) {
          blockedReason = "variant_unavailable"
          break
        }
        stockCaps.push(Math.floor(Number(validVariant.variantStock ?? 0)))
      }
    }
    const maxPurchasableQty = blockedReason ? 0 : Math.min(...stockCaps)
    availabilityByBundle.set(bundleId, {
      isAvailable: !blockedReason && Number.isFinite(maxPurchasableQty) && maxPurchasableQty > 0,
      maxPurchasableQty: !blockedReason && Number.isFinite(maxPurchasableQty) ? maxPurchasableQty : 0,
      unavailableReason: blockedReason,
    })
  }

  return baseRows.map((b) => {
    const bundleProducts = byBundle.get(b.id) ?? []
    const dynamicPrice = computeDynamicPrice(bundleProducts)
    const effectivePrice = b.pricingMode === "fixed" ? Number(b.comboPrice ?? dynamicPrice) : dynamicPrice
    const availability = availabilityByBundle.get(b.id) ?? { isAvailable: false, maxPurchasableQty: 0, unavailableReason: "unavailable" }
    return {
      ...b,
      products: bundleProducts,
      includedProductsCount: bundleProducts.length,
      dynamicPrice,
      effectivePrice,
      savings: computeSavings(bundleProducts, effectivePrice),
      isAvailable: availability.isAvailable,
      maxPurchasableQty: availability.maxPurchasableQty,
      unavailableReason: availability.unavailableReason,
    }
  })
}

const isPublishedProduct = (status: unknown) =>
  String(status ?? "").toLowerCase() === "published"

/** Keep published products and drop the rest. A combo stays active only with at least two. */
async function loadEligibleProducts(productIds: string[]) {
  const unique = [...new Set(productIds.map((x) => x.trim()).filter(Boolean))]
  if (unique.length === 0) return []

  const rows = await pgQuery<{ id: string; name: string; status: string; isActive: boolean }>(
    `SELECT id, name, status, "isActive" as "isActive" FROM "Product" WHERE id = ANY($1::text[])`,
    [unique],
  )

  const byId = new Map(rows.map((r) => [r.id, r]))
  const eligible = unique.filter((id) => {
    const row = byId.get(id)
    return Boolean(row && isPublishedProduct(row.status))
  })
  if (eligible.length > MAX_BUNDLE_PRODUCTS) {
    throw new Error(`Select 1 to ${MAX_BUNDLE_PRODUCTS} products`)
  }
  return eligible
}

const comboIsActive = (productCount: number, requested?: boolean) =>
  productCount >= 2 && requested !== false

const storedProductComboPrice = (productId: string, productPrices?: Array<{ productId: string; comboPrice: number }>) => {
  const match = productPrices?.find((row) => row.productId === productId)
  const value = Number(match?.comboPrice)
  return Number.isFinite(value) && value >= 0 ? Number(value.toFixed(2)) : null
}

function validateInput(input: {
  name: string
  slug?: string
  pricingMode: BundlePricingMode
  comboPrice?: number | null
}) {
  const name = input.name.trim()
  const slug = slugify(input.slug ?? input.name)
  if (name.length < 2) throw new Error("Bundle name is too short")
  if (!slugPattern.test(slug)) throw new Error("Invalid slug format")
  if (input.pricingMode === "fixed") {
    const comboPrice = Number(input.comboPrice)
    if (!Number.isFinite(comboPrice) || comboPrice <= 0) {
      throw new Error("Fixed pricing requires comboPrice")
    }
  }
  return { name, slug }
}

export type ActiveComboRef = { id: string; name: string; slug: string }

export const listActiveCombosForProduct = async (productId: string): Promise<ActiveComboRef[]> => {
  const id = productId.trim()
  if (!id) return []
  return pgQuery<ActiveComboRef>(
    `
      SELECT b.id, b.name, b.slug
      FROM "Bundle" b
      INNER JOIN "BundleProduct" bp ON bp."bundleId" = b.id
      WHERE bp."productId" = $1
        AND b."isActive" = true
        AND b."isCombo" = true
      ORDER BY b.name ASC
    `,
    [id],
  )
}

/** Drop an unpublished product from its combos, retotal the remaining prices, and deactivate a combo that no longer has 2 products. */
export const syncCombosAfterProductUnpublished = async (productId: string) => {
  const id = productId.trim()
  if (!id) return []

  const bundles = await pgQuery<{ bundleId: string }>(
    `SELECT DISTINCT "bundleId" as "bundleId" FROM "BundleProduct" WHERE "productId" = $1`,
    [id],
  )

  const updated: Array<{ id: string; productCount: number; comboPrice: number | null; isActive: boolean }> = []
  for (const bundle of bundles) {
    const bundleId = bundle.bundleId
    await pgQuery(
      `
        DELETE FROM "BundleProduct" bp
        USING "Product" p
        WHERE bp."bundleId" = $1
          AND bp."productId" = p.id
          AND lower(p.status::text) <> 'published'
      `,
      [bundleId],
    )
    await pgQuery(
      `DELETE FROM "BundleProduct" WHERE "bundleId" = $1 AND "productId" = $2`,
      [bundleId, id],
    )

    const totals = await pgQuery<{ total: string; count: string }>(
      `
        SELECT
          COALESCE(SUM(COALESCE(bp."comboPrice", NULLIF(p.price, 0), p."basePrice", 0)), 0)::text as total,
          COUNT(*)::text as count
        FROM "BundleProduct" bp
        JOIN "Product" p ON p.id = bp."productId"
        WHERE bp."bundleId" = $1
          AND lower(p.status::text) = 'published'
      `,
      [bundleId],
    )
    const productCount = Number(totals[0]?.count ?? 0)
    const comboPrice = productCount > 0 ? Number(Number(totals[0]?.total ?? 0).toFixed(2)) : null
    const rows = await pgQuery<{ id: string; isActive: boolean }>(
      `
        UPDATE "Bundle"
        SET
          "comboPrice" = $2,
          "isActive" = CASE WHEN $3 < 2 THEN false ELSE "isActive" END,
          "updatedAt" = now()
        WHERE id = $1
        RETURNING id, "isActive" as "isActive"
      `,
      [bundleId, comboPrice, productCount],
    )
    if (rows[0]) {
      updated.push({ id: rows[0].id, productCount, comboPrice, isActive: productCount >= 2 ? rows[0].isActive : false })
    }
  }
  return updated
}

export const deactivateActiveCombosForProduct = async (productId: string): Promise<ActiveComboRef[]> => {
  const id = productId.trim()
  if (!id) return []
  return pgQuery<ActiveComboRef>(
    `
      UPDATE "Bundle" b
      SET "isActive" = false, "updatedAt" = now()
      WHERE b."isActive" = true
        AND b."isCombo" = true
        AND EXISTS (
          SELECT 1 FROM "BundleProduct" bp
          WHERE bp."bundleId" = b.id AND bp."productId" = $1
        )
      RETURNING b.id, b.name, b.slug
    `,
    [id],
  )
}

export const listBundlesAdmin = async (input?: {
  page?: number
  limit?: number
  q?: string
  isActive?: boolean
  sort?: "created_desc" | "created_asc"
}) => {
  const page = Math.max(1, Number(input?.page ?? 1))
  const limit = Math.min(100, Math.max(1, Number(input?.limit ?? 20)))
  const offset = (page - 1) * limit
  const values: unknown[] = []
  const where: string[] = []

  if (input?.q?.trim()) {
    values.push(`%${input.q.trim()}%`)
    where.push(`(name ILIKE $${values.length} OR slug ILIKE $${values.length})`)
  }
  if (typeof input?.isActive === "boolean") {
    values.push(input.isActive)
    where.push(`"isActive" = $${values.length}`)
  }

  const whereSql = where.length ? `WHERE ${where.join(" AND ")}` : ""
  const countRows = await pgQuery<{ total: string }>(
    `SELECT count(*)::text as total FROM "Bundle" ${whereSql}`,
    values as any[],
  )

  values.push(limit, offset)
  const sortDir = input?.sort === "created_asc" ? "ASC" : "DESC"
  const baseRows = await pgQuery<BundleRow>(
    `
      SELECT
        id,
        name,
        slug,
        "pricingMode" as "pricingMode",
        "comboPrice" as "comboPrice",
        description,
        image,
        "isActive" as "isActive",
        "createdAt" as "createdAt",
        "updatedAt" as "updatedAt"
      FROM "Bundle"
      ${whereSql}
      ORDER BY "createdAt" ${sortDir}
      LIMIT $${values.length - 1}
      OFFSET $${values.length}
    `,
    values as any[],
  )

  return {
    items: await hydrateBundles(baseRows),
    total: Number(countRows[0]?.total ?? 0),
    page,
    limit,
  }
}

export const getBundleAdminById = async (id: string) => {
  const rows = await pgQuery<BundleRow>(
    `
      SELECT
        id,
        name,
        slug,
        "pricingMode" as "pricingMode",
        "comboPrice" as "comboPrice",
        description,
        image,
        "isActive" as "isActive",
        "createdAt" as "createdAt",
        "updatedAt" as "updatedAt"
      FROM "Bundle"
      WHERE id = $1
      LIMIT 1
    `,
    [id],
  )
  if (!rows[0]) return null
  return (await hydrateBundles(rows))[0]
}

export const createBundleV2 = async (input: {
  name: string
  slug?: string
  pricingMode: BundlePricingMode
  comboPrice?: number | null
  description?: string | null
  image?: string | null
  isActive?: boolean
  productIds: string[]
  productPrices?: Array<{ productId: string; comboPrice: number }>
}) => {
  const { name, slug } = validateInput(input)
  const productIds = await loadEligibleProducts(input.productIds)
  const existing = await pgQuery<{ id: string }>(
    `SELECT id FROM "Bundle" WHERE slug = $1 LIMIT 1`,
    [slug],
  )
  if (existing[0]) throw new Error("Bundle slug already exists")

  const id = crypto.randomUUID()
  await pgTx(async (client) => {
    await client.query(
      `
        INSERT INTO "Bundle" (
          id, name, slug, "pricingMode", "comboPrice", description, image, "isActive", "createdAt", "updatedAt"
        ) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,now(),now())
      `,
      [
        id,
        name,
        slug,
        input.pricingMode,
        input.pricingMode === "fixed" ? Number(input.comboPrice) : null,
        input.description?.trim() || null,
        input.image?.trim() || null,
        comboIsActive(productIds.length, input.isActive),
      ],
    )
    for (const productId of productIds) {
      await client.query(
        `INSERT INTO "BundleProduct" (id, "bundleId", "productId", "comboPrice", "createdAt", "updatedAt") VALUES ($1,$2,$3,$4,now(),now())`,
        [crypto.randomUUID(), id, productId, storedProductComboPrice(productId, input.productPrices)],
      )
    }
  })
  return (await getBundleAdminById(id))!
}

export const updateBundleV2 = async (
  id: string,
  input: {
    name: string
    slug?: string
    pricingMode: BundlePricingMode
    comboPrice?: number | null
    description?: string | null
    image?: string | null
    isActive?: boolean
    productIds: string[]
    productPrices?: Array<{ productId: string; comboPrice: number }>
  },
) => {
  const { name, slug } = validateInput(input)
  const current = await getBundleAdminById(id)
  if (!current) throw new Error("Bundle not found")
  const productIds = await loadEligibleProducts(input.productIds)
  const existing = await pgQuery<{ id: string }>(
    `SELECT id FROM "Bundle" WHERE slug = $1 AND id <> $2 LIMIT 1`,
    [slug, id],
  )
  if (existing[0]) throw new Error("Bundle slug already exists")

  await pgTx(async (client) => {
    await client.query(
      `
        UPDATE "Bundle"
        SET
          name = $2,
          slug = $3,
          "pricingMode" = $4,
          "comboPrice" = $5,
          description = $6,
          image = $7,
          "isActive" = $8,
          "updatedAt" = now()
        WHERE id = $1
      `,
      [
        id,
        name,
        slug,
        input.pricingMode,
        input.pricingMode === "fixed" ? Number(input.comboPrice) : null,
        input.description?.trim() || null,
        input.image?.trim() || null,
        comboIsActive(productIds.length, input.isActive),
      ],
    )
    await client.query(`DELETE FROM "BundleProduct" WHERE "bundleId" = $1`, [id])
    for (const productId of productIds) {
      await client.query(
        `INSERT INTO "BundleProduct" (id, "bundleId", "productId", "comboPrice", "createdAt", "updatedAt") VALUES ($1,$2,$3,$4,now(),now())`,
        [crypto.randomUUID(), id, productId, storedProductComboPrice(productId, input.productPrices)],
      )
    }
  })
  return (await getBundleAdminById(id))!
}

export const toggleBundleActive = async (id: string, isActive: boolean) => {
  const rows = await pgQuery<{ id: string }>(
    `UPDATE "Bundle" SET "isActive" = $2, "updatedAt" = now() WHERE id = $1 RETURNING id`,
    [id, isActive],
  )
  if (!rows[0]) throw new Error("Bundle not found")
  return (await getBundleAdminById(id))!
}

export const deleteBundleSoft = async (id: string) => {
  const rows = await pgQuery<{ id: string }>(
    `UPDATE "Bundle" SET "isActive" = false, "updatedAt" = now() WHERE id = $1 RETURNING id`,
    [id],
  )
  if (!rows[0]) throw new Error("Bundle not found")
  return { id, isActive: false }
}

export const listBundlesPublic = async (input?: { q?: string; page?: number; limit?: number }) => {
  return listBundlesAdmin({
    page: input?.page,
    limit: input?.limit,
    q: input?.q,
    isActive: true,
    sort: "created_desc",
  })
}

export const getBundlePublicBySlug = async (slug: string) => {
  const rows = await pgQuery<{ id: string }>(
    `SELECT id FROM "Bundle" WHERE slug = $1 AND "isActive" = true LIMIT 1`,
    [slug],
  )
  if (!rows[0]) return null
  return getBundleAdminById(rows[0].id)
}

// Backward-compatible exports for existing callers.
export const listBundles = listBundlesPublic
export const createBundle = async (input: {
  name: string
  slug?: string
  pricingMode?: "fixed" | "dynamic"
  isActive?: boolean
  comboPrice?: number | null
  items: Array<{ productId: string }>
}) =>
  createBundleV2({
    name: input.name,
    slug: input.slug,
    pricingMode: input.pricingMode ?? "fixed",
    comboPrice: input.comboPrice ?? null,
    isActive: input.isActive ?? true,
    productIds: [...new Set(input.items.map((x) => x.productId))],
  })
