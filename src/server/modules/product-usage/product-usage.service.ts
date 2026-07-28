import crypto from "node:crypto"
import { pgQuery, pgTx } from "@/src/server/db/pg"
import { sanitizeRichText } from "./product-usage.validator"
import { logActivity } from "@/src/server/modules/activity/activity.service"

export interface ProductUsageRecord {
  id: string
  title: string
  slug: string
  shortDescription: string | null
  description: string | null
  usageProcess: string | null
  thumbnail: string | null
  videoType: "none" | "upload" | "youtube" | "vimeo" | "cdn"
  videoUrl: string | null
  uploadedVideo: string | null
  relatedProductId: string | null
  relatedProductName?: string | null
  relatedProductSlug?: string | null
  relatedProductImage?: string | null
  relatedProductPrice?: number | null
  seoTitle: string | null
  metaDescription: string | null
  metaKeywords: string | null
  canonicalUrl: string | null
  ogTitle: string | null
  ogDescription: string | null
  ogImage: string | null
  robots: string
  includeInSitemap: boolean
  publishStatus: "draft" | "published" | "archived"
  isActive: boolean
  displayOrder: number
  createdBy: string | null
  updatedBy: string | null
  createdAt: Date
  updatedAt: Date
  deletedAt: Date | null
}

export interface NavigationConfig {
  title: string
  url: string
  enabled: boolean
  displayOrder: number
}

function mapRowToRecord(row: any): ProductUsageRecord {
  return {
    id: row.id,
    title: row.title,
    slug: row.slug,
    shortDescription: row.short_description ?? row.shortDescription ?? null,
    description: row.description ?? null,
    usageProcess: row.usage_process ?? row.usageProcess ?? null,
    thumbnail: row.thumbnail ?? null,
    videoType: row.video_type ?? row.videoType ?? "none",
    videoUrl: row.video_url ?? row.videoUrl ?? null,
    uploadedVideo: row.uploaded_video ?? row.uploadedVideo ?? null,
    relatedProductId: row.related_product_id ?? row.relatedProductId ?? null,
    relatedProductName: row.related_product_name ?? row.relatedProductName ?? null,
    relatedProductSlug: row.related_product_slug ?? row.relatedProductSlug ?? null,
    relatedProductImage: row.related_product_image ?? row.relatedProductImage ?? null,
    relatedProductPrice: row.related_product_price != null ? Number(row.related_product_price) : null,
    seoTitle: row.seo_title ?? row.seoTitle ?? null,
    metaDescription: row.meta_description ?? row.metaDescription ?? null,
    metaKeywords: row.meta_keywords ?? row.metaKeywords ?? null,
    canonicalUrl: row.canonical_url ?? row.canonicalUrl ?? null,
    ogTitle: row.og_title ?? row.ogTitle ?? null,
    ogDescription: row.og_description ?? row.ogDescription ?? null,
    ogImage: row.og_image ?? row.ogImage ?? null,
    robots: row.robots ?? "index,follow",
    includeInSitemap: row.include_in_sitemap ?? row.includeInSitemap ?? true,
    publishStatus: row.publish_status ?? row.publishStatus ?? "draft",
    isActive: row.is_active ?? row.isActive ?? true,
    displayOrder: row.display_order ?? row.displayOrder ?? 0,
    createdBy: row.created_by ?? row.createdBy ?? null,
    updatedBy: row.updated_by ?? row.updatedBy ?? null,
    createdAt: row.created_at ?? row.createdAt,
    updatedAt: row.updated_at ?? row.updatedAt,
    deletedAt: row.deleted_at ?? row.deletedAt ?? null,
  }
}

/** Check slug uniqueness */
export const checkSlugAvailable = async (slug: string, excludeId?: string): Promise<boolean> => {
  let query = `SELECT id FROM "ProductUsage" WHERE slug = $1 AND "deleted_at" IS NULL`
  const params: any[] = [slug]
  if (excludeId) {
    query += ` AND id != $2`
    params.push(excludeId)
  }
  const rows = await pgQuery(query, params)
  return rows.length === 0
}

/** PUBLIC Storefront Listing */
export const listProductUsagePublic = async (params: {
  page?: number
  limit?: number
  search?: string
  productId?: string
  sort?: string
}) => {
  const page = Math.max(1, params.page || 1)
  const limit = Math.min(50, Math.max(1, params.limit || 12))
  const offset = (page - 1) * limit

  const whereConditions: string[] = [
    `pu."deleted_at" IS NULL`,
    `pu."publish_status" = 'published'`,
    `pu."is_active" = true`,
  ]
  const values: any[] = []
  let paramIdx = 1

  if (params.search?.trim()) {
    whereConditions.push(`(pu.title ILIKE $${paramIdx} OR pu.short_description ILIKE $${paramIdx})`)
    values.push(`%${params.search.trim()}%`)
    paramIdx++
  }

  if (params.productId?.trim()) {
    whereConditions.push(`pu.related_product_id = $${paramIdx}`)
    values.push(params.productId.trim())
    paramIdx++
  }

  const whereClause = whereConditions.join(" AND ")

  let orderBy = `pu.display_order ASC, pu.created_at DESC`
  if (params.sort === "newest") orderBy = `pu.created_at DESC`
  if (params.sort === "oldest") orderBy = `pu.created_at ASC`
  if (params.sort === "title_asc") orderBy = `pu.title ASC`
  if (params.sort === "title_desc") orderBy = `pu.title DESC`

  const countRes = await pgQuery<{ count: string }>(
    `SELECT COUNT(*)::text as count FROM "ProductUsage" pu WHERE ${whereClause}`,
    values,
  )
  const totalItems = parseInt(countRes[0]?.count || "0", 10)
  const totalPages = Math.ceil(totalItems / limit)

  const items = await pgQuery(
    `
      SELECT pu.*, 
             p.name as related_product_name,
             p.slug as related_product_slug,
             p.thumbnail as related_product_image,
             p.price as related_product_price
      FROM "ProductUsage" pu
      LEFT JOIN "Product" p ON pu.related_product_id = p.id
      WHERE ${whereClause}
      ORDER BY ${orderBy}
      LIMIT $${paramIdx} OFFSET $${paramIdx + 1}
    `,
    [...values, limit, offset],
  )

  return {
    items: items.map(mapRowToRecord),
    pagination: {
      page,
      limit,
      totalItems,
      totalPages,
    },
  }
}

/** PUBLIC Storefront Details by Slug */
export const getProductUsageBySlugPublic = async (slug: string) => {
  const rows = await pgQuery(
    `
      SELECT pu.*, 
             p.name as related_product_name,
             p.slug as related_product_slug,
             p.thumbnail as related_product_image,
             p.price as related_product_price
      FROM "ProductUsage" pu
      LEFT JOIN "Product" p ON pu.related_product_id = p.id
      WHERE pu.slug = $1 AND pu."deleted_at" IS NULL AND pu."publish_status" = 'published' AND pu."is_active" = true
      LIMIT 1
    `,
    [slug],
  )

  if (!rows[0]) return null
  const record = mapRowToRecord(rows[0])

  // Get Next and Previous Product Usage items
  const [prevRows, nextRows, relatedRows] = await Promise.all([
    pgQuery(
      `SELECT title, slug FROM "ProductUsage" 
       WHERE "deleted_at" IS NULL AND "publish_status" = 'published' AND "is_active" = true 
         AND (display_order < $1 OR (display_order = $1 AND created_at < $2))
       ORDER BY display_order DESC, created_at DESC LIMIT 1`,
      [record.displayOrder, record.createdAt],
    ),
    pgQuery(
      `SELECT title, slug FROM "ProductUsage" 
       WHERE "deleted_at" IS NULL AND "publish_status" = 'published' AND "is_active" = true 
         AND (display_order > $1 OR (display_order = $1 AND created_at > $2))
       ORDER BY display_order ASC, created_at ASC LIMIT 1`,
      [record.displayOrder, record.createdAt],
    ),
    pgQuery(
      `SELECT pu.id, pu.title, pu.slug, pu.short_description, pu.thumbnail, pu.video_type
       FROM "ProductUsage" pu
       WHERE pu.id != $1 AND pu."deleted_at" IS NULL AND pu."publish_status" = 'published' AND pu."is_active" = true
       ORDER BY pu.display_order ASC, pu.created_at DESC
       LIMIT 4`,
      [record.id],
    ),
  ])

  return {
    item: record,
    prevItem: prevRows[0] ? { title: prevRows[0].title, slug: prevRows[0].slug } : null,
    nextItem: nextRows[0] ? { title: nextRows[0].title, slug: nextRows[0].slug } : null,
    relatedUsages: relatedRows.map((r: any) => ({
      id: r.id,
      title: r.title,
      slug: r.slug,
      shortDescription: r.short_description,
      thumbnail: r.thumbnail,
      videoType: r.video_type,
    })),
  }
}

/** ADMIN Listing */
export const listProductUsageAdmin = async (params: {
  page?: number
  limit?: number
  search?: string
  publishStatus?: string
  isActive?: boolean
  videoType?: string
  relatedProductId?: string
  sort?: string
}) => {
  const page = Math.max(1, params.page || 1)
  const limit = Math.min(100, Math.max(1, params.limit || 20))
  const offset = (page - 1) * limit

  const whereConditions: string[] = [`pu."deleted_at" IS NULL`]
  const values: any[] = []
  let paramIdx = 1

  if (params.search?.trim()) {
    whereConditions.push(`(pu.title ILIKE $${paramIdx} OR pu.slug ILIKE $${paramIdx} OR pu.short_description ILIKE $${paramIdx})`)
    values.push(`%${params.search.trim()}%`)
    paramIdx++
  }

  if (params.publishStatus?.trim() && params.publishStatus !== "all") {
    whereConditions.push(`pu.publish_status = $${paramIdx}`)
    values.push(params.publishStatus.trim())
    paramIdx++
  }

  if (typeof params.isActive === "boolean") {
    whereConditions.push(`pu.is_active = $${paramIdx}`)
    values.push(params.isActive)
    paramIdx++
  }

  if (params.videoType?.trim() && params.videoType !== "all") {
    whereConditions.push(`pu.video_type = $${paramIdx}`)
    values.push(params.videoType.trim())
    paramIdx++
  }

  if (params.relatedProductId?.trim()) {
    whereConditions.push(`pu.related_product_id = $${paramIdx}`)
    values.push(params.relatedProductId.trim())
    paramIdx++
  }

  const whereClause = whereConditions.join(" AND ")

  let orderBy = `pu.display_order ASC, pu.created_at DESC`
  if (params.sort === "newest") orderBy = `pu.created_at DESC`
  if (params.sort === "oldest") orderBy = `pu.created_at ASC`
  if (params.sort === "title_asc") orderBy = `pu.title ASC`
  if (params.sort === "title_desc") orderBy = `pu.title DESC`
  if (params.sort === "order_asc") orderBy = `pu.display_order ASC`

  const countRes = await pgQuery<{ count: string }>(
    `SELECT COUNT(*)::text as count FROM "ProductUsage" pu WHERE ${whereClause}`,
    values,
  )
  const totalItems = parseInt(countRes[0]?.count || "0", 10)
  const totalPages = Math.ceil(totalItems / limit)

  const items = await pgQuery(
    `
      SELECT pu.*, 
             p.name as related_product_name,
             p.slug as related_product_slug,
             p.thumbnail as related_product_image
      FROM "ProductUsage" pu
      LEFT JOIN "Product" p ON pu.related_product_id = p.id
      WHERE ${whereClause}
      ORDER BY ${orderBy}
      LIMIT $${paramIdx} OFFSET $${paramIdx + 1}
    `,
    [...values, limit, offset],
  )

  return {
    items: items.map(mapRowToRecord),
    pagination: {
      page,
      limit,
      totalItems,
      totalPages,
    },
  }
}

/** ADMIN Get single record by ID */
export const getProductUsageByIdAdmin = async (id: string) => {
  const rows = await pgQuery(
    `
      SELECT pu.*, 
             p.name as related_product_name,
             p.slug as related_product_slug
      FROM "ProductUsage" pu
      LEFT JOIN "Product" p ON pu.related_product_id = p.id
      WHERE pu.id = $1 AND pu."deleted_at" IS NULL
      LIMIT 1
    `,
    [id],
  )
  if (!rows[0]) return null
  return mapRowToRecord(rows[0])
}

/** CREATE Product Usage */
export const createProductUsage = async (input: any, actorId?: string) => {
  const id = crypto.randomUUID()
  const sanitizedDesc = sanitizeRichText(input.description)
  const sanitizedProcess = sanitizeRichText(input.usageProcess)

  await pgQuery(
    `
      INSERT INTO "ProductUsage" (
        id, title, slug, short_description, description, usage_process,
        thumbnail, video_type, video_url, uploaded_video, related_product_id,
        seo_title, meta_description, meta_keywords, canonical_url,
        og_title, og_description, og_image, robots, include_in_sitemap,
        publish_status, is_active, display_order, created_by, updated_by,
        created_at, updated_at
      ) VALUES (
        $1, $2, $3, $4, $5, $6,
        $7, $8, $9, $10, $11,
        $12, $13, $14, $15,
        $16, $17, $18, $19, $20,
        $21, $22, $23, $24, $25,
        now(), now()
      )
    `,
    [
      id,
      input.title,
      input.slug,
      input.shortDescription ?? null,
      sanitizedDesc,
      sanitizedProcess,
      input.thumbnail ?? null,
      input.videoType ?? "none",
      input.videoUrl ?? null,
      input.uploadedVideo ?? null,
      input.relatedProductId ?? null,
      input.seoTitle ?? null,
      input.metaDescription ?? null,
      input.metaKeywords ?? null,
      input.canonicalUrl ?? null,
      input.ogTitle ?? null,
      input.ogDescription ?? null,
      input.ogImage ?? null,
      input.robots ?? "index,follow",
      input.includeInSitemap ?? true,
      input.publishStatus ?? "draft",
      input.isActive ?? true,
      input.displayOrder ?? 0,
      actorId ?? null,
      actorId ?? null,
    ],
  )

  await logActivity({
    actorId,
    action: "PRODUCT_USAGE_CREATED",
    entityType: "PRODUCT_USAGE",
    entityId: id,
    metadata: { title: input.title, slug: input.slug },
  })

  return getProductUsageByIdAdmin(id)
}

/** UPDATE Product Usage */
export const updateProductUsage = async (id: string, input: any, actorId?: string) => {
  const existing = await getProductUsageByIdAdmin(id)
  if (!existing) throw new Error("Product Usage entry not found")

  const sanitizedDesc = input.description !== undefined ? sanitizeRichText(input.description) : existing.description
  const sanitizedProcess = input.usageProcess !== undefined ? sanitizeRichText(input.usageProcess) : existing.usageProcess

  await pgQuery(
    `
      UPDATE "ProductUsage" SET
        title = COALESCE($2, title),
        slug = COALESCE($3, slug),
        short_description = COALESCE($4, short_description),
        description = $5,
        usage_process = $6,
        thumbnail = COALESCE($7, thumbnail),
        video_type = COALESCE($8, video_type),
        video_url = $9,
        uploaded_video = $10,
        related_product_id = $11,
        seo_title = $12,
        meta_description = $13,
        meta_keywords = $14,
        canonical_url = $15,
        og_title = $16,
        og_description = $17,
        og_image = $18,
        robots = COALESCE($19, robots),
        include_in_sitemap = COALESCE($20, include_in_sitemap),
        publish_status = COALESCE($21, publish_status),
        is_active = COALESCE($22, is_active),
        display_order = COALESCE($23, display_order),
        updated_by = $24,
        updated_at = now()
      WHERE id = $1 AND "deleted_at" IS NULL
    `,
    [
      id,
      input.title ?? null,
      input.slug ?? null,
      input.shortDescription ?? null,
      sanitizedDesc,
      sanitizedProcess,
      input.thumbnail ?? null,
      input.videoType ?? null,
      input.videoUrl ?? null,
      input.uploadedVideo ?? null,
      input.relatedProductId ?? null,
      input.seoTitle ?? null,
      input.metaDescription ?? null,
      input.metaKeywords ?? null,
      input.canonicalUrl ?? null,
      input.ogTitle ?? null,
      input.ogDescription ?? null,
      input.ogImage ?? null,
      input.robots ?? null,
      input.includeInSitemap ?? null,
      input.publishStatus ?? null,
      input.isActive ?? null,
      input.displayOrder ?? null,
      actorId ?? null,
    ],
  )

  await logActivity({
    actorId,
    action: "PRODUCT_USAGE_UPDATED",
    entityType: "PRODUCT_USAGE",
    entityId: id,
    metadata: { id, title: input.title || existing.title },
  })

  return getProductUsageByIdAdmin(id)
}

/** SOFT DELETE Product Usage */
export const deleteProductUsage = async (id: string, actorId?: string) => {
  await pgQuery(
    `UPDATE "ProductUsage" SET "deleted_at" = now(), "updated_by" = $2 WHERE id = $1`,
    [id, actorId ?? null],
  )
  await logActivity({
    actorId,
    action: "PRODUCT_USAGE_DELETED",
    entityType: "PRODUCT_USAGE",
    entityId: id,
  })
}

/** TOGGLE PUBLISH STATUS */
export const setPublishStatus = async (id: string, publishStatus: "draft" | "published" | "archived", actorId?: string) => {
  await pgQuery(
    `UPDATE "ProductUsage" SET publish_status = $2, updated_by = $3, updated_at = now() WHERE id = $1 AND "deleted_at" IS NULL`,
    [id, publishStatus, actorId ?? null],
  )
  await logActivity({
    actorId,
    action: publishStatus === "published" ? "PRODUCT_USAGE_PUBLISHED" : "PRODUCT_USAGE_UNPUBLISHED",
    entityType: "PRODUCT_USAGE",
    entityId: id,
    metadata: { publishStatus },
  })
}

/** TOGGLE ACTIVE STATUS */
export const setActiveStatus = async (id: string, isActive: boolean, actorId?: string) => {
  await pgQuery(
    `UPDATE "ProductUsage" SET is_active = $2, updated_by = $3, updated_at = now() WHERE id = $1 AND "deleted_at" IS NULL`,
    [id, isActive, actorId ?? null],
  )
  await logActivity({
    actorId,
    action: isActive ? "PRODUCT_USAGE_ACTIVATED" : "PRODUCT_USAGE_DEACTIVATED",
    entityType: "PRODUCT_USAGE",
    entityId: id,
    metadata: { isActive },
  })
}

/** BULK ACTIONS */
export const bulkProductUsageAction = async (
  ids: string[],
  action: "publish" | "unpublish" | "activate" | "deactivate" | "delete",
  actorId?: string,
) => {
  if (!ids || ids.length === 0) return

  await pgTx(async (client) => {
    if (action === "publish") {
      await client.query(
        `UPDATE "ProductUsage" SET publish_status = 'published', updated_by = $2, updated_at = now() WHERE id = ANY($1::text[]) AND "deleted_at" IS NULL`,
        [ids, actorId ?? null],
      )
    } else if (action === "unpublish") {
      await client.query(
        `UPDATE "ProductUsage" SET publish_status = 'draft', updated_by = $2, updated_at = now() WHERE id = ANY($1::text[]) AND "deleted_at" IS NULL`,
        [ids, actorId ?? null],
      )
    } else if (action === "activate") {
      await client.query(
        `UPDATE "ProductUsage" SET is_active = true, updated_by = $2, updated_at = now() WHERE id = ANY($1::text[]) AND "deleted_at" IS NULL`,
        [ids, actorId ?? null],
      )
    } else if (action === "deactivate") {
      await client.query(
        `UPDATE "ProductUsage" SET is_active = false, updated_by = $2, updated_at = now() WHERE id = ANY($1::text[]) AND "deleted_at" IS NULL`,
        [ids, actorId ?? null],
      )
    } else if (action === "delete") {
      await client.query(
        `UPDATE "ProductUsage" SET "deleted_at" = now(), updated_by = $2, updated_at = now() WHERE id = ANY($1::text[])`,
        [ids, actorId ?? null],
      )
    }
  })

  await logActivity({
    actorId,
    action: `PRODUCT_USAGE_BULK_${action.toUpperCase()}`,
    entityType: "PRODUCT_USAGE",
    metadata: { count: ids.length, ids, action },
  })
}

/** NAVIGATION SETTINGS MANAGEMENT */
export const getNavigationConfig = async (): Promise<NavigationConfig> => {
  const rows = await pgQuery<{ valueJson: any }>(
    `SELECT "valueJson" FROM "Setting" WHERE "group" = 'navigation' AND key = 'product_usage' LIMIT 1`,
  )
  const defaultVal: NavigationConfig = {
    title: "How to Use",
    url: "/product-usage",
    enabled: true,
    displayOrder: 4,
  }
  if (!rows[0]?.valueJson) return defaultVal
  const json = rows[0].valueJson
  return {
    title: String(json.title || defaultVal.title),
    url: String(json.url || defaultVal.url),
    enabled: json.enabled !== undefined ? Boolean(json.enabled) : defaultVal.enabled,
    displayOrder: json.displayOrder !== undefined ? Number(json.displayOrder) : defaultVal.displayOrder,
  }
}

export const updateNavigationConfig = async (input: NavigationConfig, actorId?: string): Promise<NavigationConfig> => {
  const valueJson = {
    title: input.title,
    url: input.url,
    enabled: Boolean(input.enabled),
    displayOrder: Number(input.displayOrder),
  }

  await pgQuery(
    `
      INSERT INTO "Setting" (id, "group", key, "valueJson", "updatedAt")
      VALUES ($1, 'navigation', 'product_usage', $2::jsonb, now())
      ON CONFLICT ("group", key)
      DO UPDATE SET "valueJson" = EXCLUDED."valueJson", "updatedAt" = now()
    `,
    [crypto.randomUUID(), JSON.stringify(valueJson)],
  )

  await logActivity({
    actorId,
    action: "PRODUCT_USAGE_NAV_UPDATED",
    entityType: "SETTING",
    metadata: valueJson,
  })

  return valueJson
}

/** SITEMAP URL FETCHING */
export const getProductUsageSitemapUrls = async () => {
  const rows = await pgQuery<{ slug: string; updatedAt: Date }>(
    `SELECT slug, "updated_at" as "updatedAt" 
     FROM "ProductUsage" 
     WHERE "deleted_at" IS NULL AND "publish_status" = 'published' AND "is_active" = true AND "include_in_sitemap" = true
     ORDER BY "updated_at" DESC`,
  )
  return rows
}
