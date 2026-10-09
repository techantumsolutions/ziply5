import { createProduct } from "@/src/server/modules/products/products.service"
import { createProductSchema } from "@/src/server/modules/products/products.validator"
import { listCategoriesSupabase } from "@/src/lib/db/categories"
import { listTags } from "@/src/server/modules/extended/extended.service"
import { readWorkbookBuffer, getCell } from "@/src/server/modules/products/bulk-upload/excel-workbook"
import { buildZipImageMap } from "@/src/server/modules/products/bulk-upload/zip-entries"
import {
  isHttpUrl,
  parseGalleryRefs,
  resolveImageFromZip,
} from "@/src/server/modules/products/bulk-upload/image-resolve"
import { uploadProductImage, uploadVariantAsset } from "@/src/server/modules/products/bulk-upload/product-images-storage"
import { loadExistingSkus } from "@/src/server/modules/products/bulk-upload/db-skus"
import type {
  BulkImportReport,
  BulkImportRowResult,
  BulkRowError,
  BulkUploadType,
  BulkValidationSummary,
} from "@/src/server/modules/products/bulk-upload/bulk-upload.types"
import { BULK_IMPORT_BATCH_SIZE } from "@/src/server/modules/products/bulk-upload/bulk-upload.constants"
import { getSupabaseAdmin } from "@/src/lib/supabase/admin"
import { randomUUID } from "node:crypto"
import { invalidateProductCache } from "@/src/server/modules/products/products.cache"
import { logActivity } from "@/src/server/modules/activity/activity.service"

const str = (v: unknown) => String(v ?? "").trim()

const parseNum = (v: unknown): number | null => {
  if (v === "" || v === null || v === undefined) return null
  const n = typeof v === "number" ? v : Number(String(v).replace(/,/g, ""))
  if (!Number.isFinite(n)) return null
  return n
}

const parseInt0 = (v: unknown): number | null => {
  const n = parseNum(v)
  if (n === null) return null
  return Math.floor(n)
}

const parseBool = (v: unknown): boolean | undefined => {
  if (v === "" || v === null || v === undefined) return undefined
  if (typeof v === "boolean") return v
  const s = String(v).trim().toLowerCase()
  if (["true", "1", "yes", "y"].includes(s)) return true
  if (["false", "0", "no", "n"].includes(s)) return false
  return undefined
}

const splitMulti = (raw: unknown) =>
  String(raw ?? "")
    .split("|")
    .map((x) => x.trim())
    .filter(Boolean)

const toSafeSkuFragment = (raw: string) =>
  raw
    .trim()
    .toUpperCase()
    .replace(/[^A-Z0-9]+/g, "-")
    .replace(/-+/g, "-")
    .replace(/^-|-$/g, "")

const parseDetailsCell = (raw: unknown): Array<{ title: string; content: string; sortOrder?: number }> => {
  const items = splitMulti(raw)
  const result: Array<{ title: string; content: string; sortOrder?: number }> = []
  for (let idx = 0; idx < items.length; idx++) {
    const entry = items[idx]
    const [title, content, sort] = entry.split("::").map((x) => x.trim())
    if (!title || !content) continue
    const sortOrder = sort ? Number(sort) : idx
    result.push({
      title,
      content,
      sortOrder: Number.isFinite(sortOrder) ? sortOrder : idx,
    })
  }
  return result
}

const parseFeaturesCell = (raw: unknown): Array<{ title: string; icon?: string | null }> => {
  const items = splitMulti(raw)
  const result: Array<{ title: string; icon?: string | null }> = []
  for (const entry of items) {
    const [title, icon] = entry.split("::").map((x) => x.trim())
    if (!title) continue
    result.push({ title, icon: icon || null })
  }
  return result
}

const parseSectionsCell = (raw: unknown): Array<{ title: string; description: string; sortOrder?: number; isActive?: boolean }> => {
  const items = splitMulti(raw)
  const result: Array<{ title: string; description: string; sortOrder?: number; isActive?: boolean }> = []
  for (let idx = 0; idx < items.length; idx++) {
    const entry = items[idx]
    const [title, description, sort, isActiveRaw] = entry.split("::").map((x) => x.trim())
    if (!title || !description) continue
    const sortOrder = sort ? Number(sort) : idx
    result.push({
      title,
      description,
      sortOrder: Number.isFinite(sortOrder) ? sortOrder : idx,
      isActive: parseBool(isActiveRaw) ?? true,
    })
  }
  return result
}

type CategoryLite = { id: string; name: string; slug: string }
type TagLite = { id: string; name: string; slug: string }

const loadCategoryMap = async (): Promise<CategoryLite[]> => {
  const rows = await listCategoriesSupabase()
  return rows.map((r) => ({
    id: r.id,
    name: String(r.name ?? "").trim(),
    slug: String(r.slug ?? "").trim(),
  }))
}

const resolveCategoryId = (cats: CategoryLite[], ref: string): string | null => {
  const q = ref.trim().toLowerCase()
  if (!q) return null
  const hit = cats.find((c) => c.slug.toLowerCase() === q || c.name.toLowerCase() === q)
  return hit?.id ?? null
}

const loadTagMap = async (): Promise<TagLite[]> => {
  const rows = (await listTags()) as unknown as Record<string, unknown>[]
  return rows
    .map((r) => ({
      id: String(r.id ?? ""),
      name: String(r.name ?? "").trim(),
      slug: String(r.slug ?? "").trim(),
    }))
    .filter((t) => Boolean(t.id))
}

const resolveTagIds = (tags: TagLite[], raw: string): { ids: string[]; missing: string[] } => {
  const parts = raw
    .split(/[,;]/g)
    .map((x) => x.trim())
    .filter(Boolean)
  const ids: string[] = []
  const missing: string[] = []
  for (const p of parts) {
    const pl = p.toLowerCase()
    const hit = tags.find((t) => t.slug.toLowerCase() === pl || t.name.toLowerCase() === pl)
    if (hit) ids.push(hit.id)
    else missing.push(p)
  }
  return { ids, missing }
}

const uniq = <T>(arr: T[]) => [...new Set(arr)]

type SimplePrepared = {
  excelRow: number
  sku: string
  slug: string
  raw: Record<string, unknown>
  errors: string[]
}

type VariantPrepared = {
  excelRow: number
  parentSku: string
  slug: string
  raw: Record<string, unknown>
  errors: string[]
}

type VariantLinePrepared = {
  excelRow: number
  parentSku: string
  parentProductSlug: string
  variantSku: string
  raw: Record<string, unknown>
  errors: string[]
}

const collectSimplePrepared = (
  rows: Record<string, unknown>[],
  startRow: number,
): SimplePrepared[] => {
  const out: SimplePrepared[] = []
  let i = 0
  for (const raw of rows) {
    const excelRow = startRow + i
    i++
    const errors: string[] = []
    const sku = str(getCell(raw, "sku"))
    const name = str(getCell(raw, "name"))
    const slug = str(getCell(raw, "slug"))
    const type = str(getCell(raw, "type")).toLowerCase()
    const price = parseNum(getCell(raw, "price"))
    const thumb = str(getCell(raw, "thumbnail"))
    if (!sku) errors.push("SKU is required")
    if (!name) errors.push("Name is required")
    if (!slug) errors.push("Slug is required")
    if (type && type !== "simple") errors.push(`Type must be simple, got "${type}"`)
    if (price === null || price < 0) errors.push("Invalid price")
    if (!thumb) errors.push("Thumbnail is required")
    const weight = str(getCell(raw, "weight"))
    if (!weight) errors.push("Weight is required for simple products")
    out.push({ excelRow, sku, slug, raw, errors })
  }
  return out
}

const collectVariantParents = (
  rows: Record<string, unknown>[],
  startRow: number,
): VariantPrepared[] => {
  const out: VariantPrepared[] = []
  let i = 0
  for (const raw of rows) {
    const excelRow = startRow + i
    i++
    const errors: string[] = []
    const parentSku = str(getCell(raw, "parentSku"))
    const name = str(getCell(raw, "name"))
    const slug = str(getCell(raw, "slug"))
    const type = str(getCell(raw, "type")).toLowerCase()
    const thumb = str(getCell(raw, "thumbnail"))
    if (!parentSku) errors.push("parentSku is required")
    if (!name) errors.push("Name is required")
    if (!slug) errors.push("Slug is required")
    if (type && type !== "variant") errors.push(`Type must be variant, got "${type}"`)
    if (!thumb) errors.push("Thumbnail is required")
    out.push({ excelRow, parentSku, slug, raw, errors })
  }
  return out
}

const collectVariantLines = (
  rows: Record<string, unknown>[],
  startRow: number,
): VariantLinePrepared[] => {
  const out: VariantLinePrepared[] = []
  let i = 0
  for (const raw of rows) {
    const excelRow = startRow + i
    i++
    const errors: string[] = []
    const parentSku = str(getCell(raw, "parentSku"))
    const parentProductSlug = str(getCell(raw, "parentProductSlug"))
    const weight = str(getCell(raw, "weight"))
    const variantName = str(getCell(raw, "variantName"))
    const linkKey = parentSku || parentProductSlug
    const variantSku =
      str(getCell(raw, "variantSku")) ||
      `${toSafeSkuFragment(linkKey)}-${toSafeSkuFragment(weight || variantName || `VAR${excelRow}`)}`
    const price = parseNum(getCell(raw, "price"))
    const stock = parseInt0(getCell(raw, "stock"))
    if (!parentSku && !parentProductSlug) errors.push("parentSku or parentProductSlug is required")
    if (price === null || price <= 0) errors.push("Variant price must be a positive number")
    if (stock === null || stock < 0) errors.push("Invalid stock")
    out.push({ excelRow, parentSku, parentProductSlug, variantSku, raw, errors })
  }
  return out
}

const aggregateSummary = (
  uploadType: BulkUploadType,
  totalRows: number,
  errors: BulkRowError[],
): BulkValidationSummary => {
  const dup = errors.filter((e) => e.message.toLowerCase().includes("duplicate")).length
  const exist = errors.filter((e) => e.message.toLowerCase().includes("already exists")).length
  const missImg = errors.filter((e) => e.message.toLowerCase().includes("image")).length
  const invVar = errors.filter((e) => e.sheet === "Variants" || e.message.includes("Variant")).length
  const invCat = errors.filter((e) => e.message.toLowerCase().includes("category")).length
  const invPrice = errors.filter((e) => e.message.toLowerCase().includes("price")).length
  const invalidRowCount = new Set(errors.map((e) => `${e.sheet ?? ""}:${e.row}`)).size
  return {
    uploadType,
    totalRows,
    validRows: Math.max(0, totalRows - invalidRowCount),
    invalidRows: invalidRowCount,
    duplicateSkuInFile: dup,
    existingSkuConflicts: exist,
    missingImages: missImg,
    invalidVariants: invVar,
    invalidCategories: invCat,
    invalidPrices: invPrice,
  }
}

const tryWriteBulkLog = async (input: {
  fileName: string
  uploadType: BulkUploadType
  totalRows: number
  successCount: number
  failedCount: number
  status: string
  createdBy: string | null
}) => {
  try {
    const client = getSupabaseAdmin()
    const id = randomUUID()
    await client.from("bulk_import_logs").insert({
      id,
      file_name: input.fileName,
      upload_type: input.uploadType,
      total_rows: input.totalRows,
      success_count: input.successCount,
      failed_count: input.failedCount,
      status: input.status,
      created_by: input.createdBy,
    })
  } catch {
    // optional table
  }
}

export const runBulkValidate = async (input: {
  uploadType: BulkUploadType
  excelBuffer: Buffer
  zipBuffer: Buffer | null
}): Promise<BulkImportReport> => {
  const wb = readWorkbookBuffer(input.excelBuffer, input.uploadType)
  const zipMap = input.zipBuffer ? buildZipImageMap(input.zipBuffer) : new Map<string, Uint8Array>()
  const cats = await loadCategoryMap()
  const tags = await loadTagMap()
  const dbSkus = await loadExistingSkus()
  const errors: BulkRowError[] = []

  const HEADER_ROW = 2
  const simpleStart = HEADER_ROW

  if (input.uploadType === "simple") {
    const prepared = collectSimplePrepared(wb.simpleRows, simpleStart)
    const skuCounts = new Map<string, number[]>()
    for (const p of prepared) {
      if (!p.sku) continue
      const k = p.sku.toLowerCase()
      const list = skuCounts.get(k) ?? []
      list.push(p.excelRow)
      skuCounts.set(k, list)
    }
    for (const p of prepared) {
      const rowErrors: string[] = [...p.errors]
      if (p.sku) {
        const list = skuCounts.get(p.sku.toLowerCase()) ?? []
        if (list.length > 1) rowErrors.push("Duplicate SKU in file")
        if (dbSkus.has(p.sku.toLowerCase())) rowErrors.push("SKU already exists in database")
      }
      const catRef = str(getCell(p.raw, "categories", "category"))
      if (catRef && !resolveCategoryId(cats, catRef)) rowErrors.push(`category not found: ${catRef}`)
      const tagsRaw = str(getCell(p.raw, "tags"))
      if (tagsRaw) {
        const { missing } = resolveTagIds(tags, tagsRaw)
        if (missing.length) rowErrors.push(`tags not found: ${missing.join(", ")}`)
      }
      const thumb = str(getCell(p.raw, "thumbnail"))
      if (thumb && !isHttpUrl(thumb)) {
        const hit = resolveImageFromZip(zipMap, thumb, p.sku, "thumb")
        if (!hit && !input.zipBuffer) rowErrors.push("thumbnail image missing (upload ZIP)")
        if (!hit && input.zipBuffer) rowErrors.push("thumbnail image missing in ZIP")
      }
      const gals = parseGalleryRefs(getCell(p.raw, "galleryImages"))
      let gi = 1
      for (const g of gals) {
        if (!isHttpUrl(g)) {
          const hit = resolveImageFromZip(zipMap, g, p.sku, "gallery", gi)
          if (!hit && !input.zipBuffer) rowErrors.push(`gallery image missing: ${g}`)
          if (!hit && input.zipBuffer) rowErrors.push(`gallery image missing in ZIP: ${g}`)
        }
        gi++
      }
      for (const msg of rowErrors) {
        errors.push({ row: p.excelRow, sku: p.sku || undefined, message: msg })
      }
    }
    const summary = aggregateSummary("simple", prepared.length, errors)
    return {
      summary,
      errors,
      results: [],
      failedRowsForCsv: errors.map((e) => ({ row: e.row, sku: e.sku ?? "", error: e.message })),
    }
  }

  const parents = collectVariantParents(wb.parentRows, HEADER_ROW)
  const variants = collectVariantLines(wb.variantRows, HEADER_ROW)
  const parentSkuSet = new Set(parents.map((p) => p.parentSku.toLowerCase()).filter(Boolean))
  const parentSlugSet = new Set(parents.map((p) => p.slug.toLowerCase()).filter(Boolean))
  const variantByParent = new Map<string, VariantLinePrepared[]>()
  const variantSkuRows = new Map<string, number[]>()

  for (const v of variants) {
    if (!v.variantSku) continue
    const k = v.variantSku.toLowerCase()
    const list = variantSkuRows.get(k) ?? []
    list.push(v.excelRow)
    variantSkuRows.set(k, list)
    const parentKey = (v.parentSku || v.parentProductSlug).toLowerCase()
    const listP = variantByParent.get(parentKey) ?? []
    listP.push(v)
    variantByParent.set(parentKey, listP)
  }

  for (const p of parents) {
    const rowErrors: string[] = [...p.errors]
    if (p.parentSku) {
      if (dbSkus.has(p.parentSku.toLowerCase())) rowErrors.push("Parent SKU already exists in database")
    }
    const kids = variantByParent.get(p.parentSku.toLowerCase()) ?? []
    if (p.parentSku && kids.length === 0) rowErrors.push("No variants for this parent")
    const catRef = str(getCell(p.raw, "categories", "category"))
    if (catRef && !resolveCategoryId(cats, catRef)) rowErrors.push(`category not found: ${catRef}`)
    const tagsRaw = str(getCell(p.raw, "tags"))
    if (tagsRaw) {
      const { missing } = resolveTagIds(tags, tagsRaw)
      if (missing.length) rowErrors.push(`tags not found: ${missing.join(", ")}`)
    }
    const thumb = str(getCell(p.raw, "thumbnail"))
    if (thumb && !isHttpUrl(thumb)) {
      const hit = resolveImageFromZip(zipMap, thumb, p.parentSku, "thumb")
      if (!hit) rowErrors.push(input.zipBuffer ? "thumbnail image missing in ZIP" : "thumbnail image missing (upload ZIP)")
    }
    const gals = parseGalleryRefs(getCell(p.raw, "galleryImages"))
    let gi = 1
    for (const g of gals) {
      if (!isHttpUrl(g)) {
        const hit = resolveImageFromZip(zipMap, g, p.parentSku, "gallery", gi)
        if (!hit) rowErrors.push(input.zipBuffer ? `gallery image missing in ZIP: ${g}` : `gallery image missing: ${g}`)
      }
      gi++
    }
    for (const msg of rowErrors) {
      errors.push({ row: p.excelRow, sku: p.parentSku || undefined, message: msg })
    }
  }

  for (const v of variants) {
    const rowErrors: string[] = [...v.errors]
    const hasParentBySku = v.parentSku ? parentSkuSet.has(v.parentSku.toLowerCase()) : false
    const hasParentBySlug = v.parentProductSlug ? parentSlugSet.has(v.parentProductSlug.toLowerCase()) : false
    if (!hasParentBySku && !hasParentBySlug) {
      rowErrors.push("parentSku/parentProductSlug not found in parent sheet")
    }
    if (v.variantSku) {
      const list = variantSkuRows.get(v.variantSku.toLowerCase()) ?? []
      if (list.length > 1) rowErrors.push("Duplicate variant SKU in file")
      if (dbSkus.has(v.variantSku.toLowerCase())) rowErrors.push("Variant SKU already exists in database")
      if (v.parentSku && v.variantSku.toLowerCase() === v.parentSku.toLowerCase()) {
        rowErrors.push("Variant SKU must differ from parent SKU")
      }
    }
    for (const msg of rowErrors) {
      errors.push({
        row: v.excelRow,
        sheet: "Variants",
        sku: v.variantSku || undefined,
        message: msg,
      })
    }
  }

  const summary = aggregateSummary("variant", parents.length + variants.length, errors)
  return {
    summary,
    errors,
    results: [],
    failedRowsForCsv: errors.map((e) => ({
      row: e.row,
      sheet: e.sheet ?? "",
      sku: e.sku ?? "",
      error: e.message,
    })),
  }
}

const buildSimpleCreateInput = async (opts: {
  raw: Record<string, unknown>
  sku: string
  slug: string
  zipMap: Map<string, Uint8Array>
  categoryId: string | null
  tagIds: string[]
}) => {
  const { raw, sku, slug, zipMap, categoryId, tagIds } = opts
  const thumbRef = str(getCell(raw, "thumbnail"))
  let thumbUrl = thumbRef
  if (!isHttpUrl(thumbRef)) {
    const hit = resolveImageFromZip(zipMap, thumbRef, sku, "thumb")
    if (!hit) throw new Error("thumbnail missing")
    thumbUrl = await uploadProductImage({
      slug,
      relativePath: `thumbnail${hit.sourceName.includes(".") ? hit.sourceName.slice(hit.sourceName.lastIndexOf(".")) : ".jpg"}`,
      bytes: hit.bytes,
      sourceFileName: hit.sourceName,
    })
  }
  const galleryRefs = parseGalleryRefs(getCell(raw, "galleryImages"))
  const galleryUrls: string[] = []
  let idx = 1
  for (const g of galleryRefs) {
    if (isHttpUrl(g)) {
      galleryUrls.push(g.trim())
    } else {
      const hit = resolveImageFromZip(zipMap, g, sku, "gallery", idx)
      if (!hit) throw new Error(`gallery missing: ${g}`)
      const ext = hit.sourceName.includes(".") ? hit.sourceName.slice(hit.sourceName.lastIndexOf(".")) : ".jpg"
      galleryUrls.push(
        await uploadProductImage({
          slug,
          relativePath: `gallery-${idx}${ext}`,
          bytes: hit.bytes,
          sourceFileName: hit.sourceName,
        }),
      )
    }
    idx++
  }
  const images = uniq([thumbUrl, ...galleryUrls].filter(Boolean))
  const price = parseNum(getCell(raw, "price")) ?? 0
  const basePrice = parseNum(getCell(raw, "basePrice"))
  const discountPercent = parseNum(getCell(raw, "discountPercent"))
  const totalStock = parseInt0(getCell(raw, "totalStock")) ?? 0
  const stockStatusRaw = str(getCell(raw, "stockStatus")).toLowerCase()
  const stockStatus = stockStatusRaw === "out_of_stock" ? "out_of_stock" : "in_stock"
  const preparationRaw = str(getCell(raw, "preparationType")).toLowerCase()
  const preparationType =
    preparationRaw === "ready_to_cook" || preparationRaw === "ready_to_eat" ? preparationRaw : null
  const spiceRaw = str(getCell(raw, "spiceLevel")).toLowerCase()
  const spiceLevel =
    spiceRaw === "mild" || spiceRaw === "medium" || spiceRaw === "hot" || spiceRaw === "extra_hot" ? spiceRaw : null
  const statusRaw = str(getCell(raw, "status")).toLowerCase()
  const status =
    statusRaw === "published" || statusRaw === "archived" || statusRaw === "draft" ? statusRaw : "draft"
  const details = parseDetailsCell(getCell(raw, "details"))
  const features = parseFeaturesCell(getCell(raw, "features"))
  const sections = parseSectionsCell(getCell(raw, "sections"))
  const hsnCode = str(getCell(raw, "hsnCode", "hsn", "hsn_code")) || null
  const barcode = str(getCell(raw, "barcode", "eanCode", "ean_code", "ean", "gtin", "upc")) || null

  return {
    name: str(getCell(raw, "name")),
    slug,
    sku,
    type: "simple" as const,
    description: str(getCell(raw, "description")) || undefined,
    price,
    basePrice: basePrice != null && basePrice > 0 ? basePrice : null,
    salePrice: (() => {
      const s = parseNum(getCell(raw, "salePrice"))
      return s != null && s >= 0 ? s : null
    })(),
    discountPercent: discountPercent != null && discountPercent >= 0 ? discountPercent : null,
    weight: str(getCell(raw, "weight")) || null,
    stockStatus,
    totalStock,
    shelfLife: str(getCell(raw, "shelfLife")) || null,
    preparationType,
    spiceLevel,
    taxIncluded: parseBool(getCell(raw, "taxIncluded")) ?? true,
    isActive: parseBool(getCell(raw, "isActive")) ?? true,
    isFeatured: parseBool(getCell(raw, "isFeatured")) ?? false,
    isBestSeller: parseBool(getCell(raw, "isBestSeller")) ?? false,
    allowReturn: parseBool(getCell(raw, "allowReturn")) ?? true,
    thumbnail: thumbUrl,
    metaTitle: str(getCell(raw, "metaTitle")) || null,
    metaDescription: str(getCell(raw, "metaDescription", "metaDesciption")) || null,
    amazonLink: str(getCell(raw, "amazonLink")) || null,
    status,
    categoryId,
    tagIds,
    images,
    details,
    sections,
    features,
    variants: [
      {
        name: str(getCell(raw, "name")),
        weight: str(getCell(raw, "weight")) || null,
        sku,
        price,
        mrp: basePrice != null && basePrice > 0 ? basePrice : null,
        discountPercent: discountPercent != null && discountPercent >= 0 ? discountPercent : null,
        stock: totalStock,
        isDefault: true,
        hsnCode,
        eanCode: barcode,
      },
    ],
  }
}

const buildVariantCreateInput = async (opts: {
  parentRaw: Record<string, unknown>
  lines: VariantLinePrepared[]
  zipMap: Map<string, Uint8Array>
  categoryId: string | null
  tagIds: string[]
  parentSku: string
  slug: string
}) => {
  const { parentRaw, lines, zipMap, categoryId, tagIds, parentSku, slug } = opts
  const thumbRef = str(getCell(parentRaw, "thumbnail"))
  let thumbUrl = thumbRef
  if (!isHttpUrl(thumbRef)) {
    const hit = resolveImageFromZip(zipMap, thumbRef, parentSku, "thumb")
    if (!hit) throw new Error("thumbnail missing")
    thumbUrl = await uploadProductImage({
      slug,
      relativePath: `thumbnail${hit.sourceName.includes(".") ? hit.sourceName.slice(hit.sourceName.lastIndexOf(".")) : ".jpg"}`,
      bytes: hit.bytes,
      sourceFileName: hit.sourceName,
    })
  }
  const galleryRefs = parseGalleryRefs(getCell(parentRaw, "galleryImages"))
  const galleryUrls: string[] = []
  let gi = 1
  for (const g of galleryRefs) {
    if (isHttpUrl(g)) galleryUrls.push(g.trim())
    else {
      const hit = resolveImageFromZip(zipMap, g, parentSku, "gallery", gi)
      if (!hit) throw new Error(`gallery missing: ${g}`)
      const ext = hit.sourceName.includes(".") ? hit.sourceName.slice(hit.sourceName.lastIndexOf(".")) : ".jpg"
      galleryUrls.push(
        await uploadProductImage({
          slug,
          relativePath: `gallery-${gi}${ext}`,
          bytes: hit.bytes,
          sourceFileName: hit.sourceName,
        }),
      )
    }
    gi++
  }
  const images = uniq([thumbUrl, ...galleryUrls].filter(Boolean))

  const normalizedVariants = lines.map((line) => {
    const nm = str(getCell(line.raw, "variantName")) || str(getCell(line.raw, "variantSku"))
    const def = parseBool(getCell(line.raw, "isDefault"))
    const hsnCode =
      str(getCell(line.raw, "hsnCode", "hsn", "hsn_code")) ||
      str(getCell(parentRaw, "hsnCode", "hsn", "hsn_code")) ||
      null
    const barcode =
      str(getCell(line.raw, "barcode", "eanCode", "ean_code", "ean", "gtin", "upc")) ||
      str(getCell(parentRaw, "barcode", "eanCode", "ean_code", "ean", "gtin", "upc")) ||
      null

    return {
      name: nm,
      weight: str(getCell(line.raw, "weight")) || null,
      sku: line.variantSku,
      price: parseNum(getCell(line.raw, "price")) ?? 0,
      mrp: (() => {
        const m = parseNum(getCell(line.raw, "mrp", "basePrice"))
        return m != null && m > 0 ? m : null
      })(),
      discountPercent: (() => {
        const d = parseNum(getCell(line.raw, "discountPercent"))
        return d != null && d >= 0 ? d : null
      })(),
      stock: parseInt0(getCell(line.raw, "stock")) ?? 0,
      isDefault: Boolean(def),
      hsnCode,
      eanCode: barcode,
    }
  })
  if (!normalizedVariants.some((v) => v.isDefault)) {
    normalizedVariants[0].isDefault = true
  } else {
    let seen = false
    for (const v of normalizedVariants) {
      if (v.isDefault) {
        if (seen) v.isDefault = false
        else seen = true
      }
    }
    if (!normalizedVariants.some((v) => v.isDefault)) normalizedVariants[0].isDefault = true
  }
  const defaultVariant = normalizedVariants.find((v) => v.isDefault) ?? normalizedVariants[0]

  for (const line of lines) {
    const sku = str(getCell(line.raw, "variantSku"))
    const candidates = [`${sku}.jpg`, `${sku}.jpeg`, `${sku}.png`]
    for (const c of candidates) {
      const bytes = zipMap.get(c.toLowerCase())
      if (bytes) {
        try {
          await uploadVariantAsset({ parentSlug: slug, variantSku: sku, bytes, sourceFileName: c })
        } catch {
          // optional asset
        }
        break
      }
    }
  }

  const statusRaw = str(getCell(parentRaw, "status")).toLowerCase()
  const status =
    statusRaw === "published" || statusRaw === "archived" || statusRaw === "draft" ? statusRaw : "draft"
  const stockStatusRaw = str(getCell(parentRaw, "stockStatus")).toLowerCase()
  const stockStatus = stockStatusRaw === "out_of_stock" ? "out_of_stock" : "in_stock"
  const details = parseDetailsCell(getCell(parentRaw, "details"))
  const features = parseFeaturesCell(getCell(parentRaw, "features"))
  const sections = parseSectionsCell(getCell(parentRaw, "sections"))
  const totalStockFromSheet = parseInt0(getCell(parentRaw, "totalStock"))
  const shelfLife = str(getCell(parentRaw, "shelfLife")) || null
  const preparationRaw = str(getCell(parentRaw, "preparationType")).toLowerCase()
  const preparationType =
    preparationRaw === "ready_to_cook" || preparationRaw === "ready_to_eat" ? preparationRaw : null
  const spiceRaw = str(getCell(parentRaw, "spiceLevel")).toLowerCase()
  const spiceLevel =
    spiceRaw === "mild" || spiceRaw === "medium" || spiceRaw === "hot" || spiceRaw === "extra_hot" ? spiceRaw : null

  return {
    name: str(getCell(parentRaw, "name")),
    slug,
    sku: parentSku,
    type: "variant" as const,
    description: str(getCell(parentRaw, "description")) || undefined,
    price: defaultVariant.price,
    basePrice: defaultVariant.mrp,
    salePrice: (() => {
      const s = parseNum(getCell(parentRaw, "salePrice"))
      return s != null && s >= 0 ? s : null
    })(),
    discountPercent: defaultVariant.discountPercent,
    weight: null,
    stockStatus,
    totalStock: totalStockFromSheet ?? normalizedVariants.reduce((s, v) => s + v.stock, 0),
    shelfLife,
    preparationType,
    spiceLevel,
    taxIncluded: parseBool(getCell(parentRaw, "taxIncluded")) ?? true,
    isActive: parseBool(getCell(parentRaw, "isActive")) ?? true,
    isFeatured: parseBool(getCell(parentRaw, "isFeatured")) ?? false,
    isBestSeller: parseBool(getCell(parentRaw, "isBestSeller")) ?? false,
    allowReturn: parseBool(getCell(parentRaw, "allowReturn")) ?? true,
    thumbnail: thumbUrl,
    metaTitle: str(getCell(parentRaw, "metaTitle")) || null,
    metaDescription: str(getCell(parentRaw, "metaDescription", "metaDesciption")) || null,
    amazonLink: str(getCell(parentRaw, "amazonLink")) || null,
    status,
    categoryId,
    tagIds,
    images,
    details,
    sections,
    features,
    variants: normalizedVariants.map((v) => ({
      name: v.name,
      weight: v.weight,
      sku: v.sku,
      price: v.price,
      mrp: v.mrp,
      discountPercent: v.discountPercent,
      stock: v.stock,
      isDefault: v.isDefault,
      hsnCode: v.hsnCode,
      eanCode: v.eanCode,
    })),
  }
}

export const runBulkImport = async (input: {
  uploadType: BulkUploadType
  excelBuffer: Buffer
  zipBuffer: Buffer | null
  createdById: string
  fileName: string
}): Promise<BulkImportReport> => {
  const wb = readWorkbookBuffer(input.excelBuffer, input.uploadType)
  const zipMap = input.zipBuffer ? buildZipImageMap(input.zipBuffer) : new Map<string, Uint8Array>()
  const cats = await loadCategoryMap()
  const tags = await loadTagMap()
  let dbSkus = await loadExistingSkus()
  const errors: BulkRowError[] = []
  const results: BulkImportRowResult[] = []
  const failedRowsForCsv: Record<string, string | number | boolean | null>[] = []
  const HEADER_ROW = 2

  const processInChunks = async <T>(items: T[], fn: (item: T) => Promise<void>) => {
    for (let i = 0; i < items.length; i += BULK_IMPORT_BATCH_SIZE) {
      const slice = items.slice(i, i + BULK_IMPORT_BATCH_SIZE)
      for (const item of slice) {
        await fn(item)
      }
    }
  }

  if (input.uploadType === "simple") {
    const prepared = collectSimplePrepared(wb.simpleRows, HEADER_ROW)
    await processInChunks(prepared, async (p) => {
      if (p.errors.length) {
        const msg = p.errors.join("; ")
        errors.push({ row: p.excelRow, sku: p.sku || undefined, message: msg })
        results.push({ row: p.excelRow, sku: p.sku, success: false, message: msg })
        failedRowsForCsv.push({
          ...Object.fromEntries(Object.entries(p.raw).map(([k, v]) => [k, String(v)])),
          error: msg,
        })
        return
      }
      try {
        if (dbSkus.has(p.sku.toLowerCase())) throw new Error("SKU already exists")
        const catRef = str(getCell(p.raw, "categories", "category"))
        const categoryId = catRef ? resolveCategoryId(cats, catRef) : null
        const tagsRaw = str(getCell(p.raw, "tags"))
        const tagIds = tagsRaw ? resolveTagIds(tags, tagsRaw).ids : []
        const built = await buildSimpleCreateInput({
          raw: p.raw,
          sku: p.sku,
          slug: p.slug,
          zipMap,
          categoryId,
          tagIds,
        })
        const parsed = createProductSchema.safeParse(built)
        if (!parsed.success) {
          throw new Error(parsed.error.issues.map((e) => e.message).join("; "))
        }
        const product = await createProduct({
          ...parsed.data,
          createdById: input.createdById,
          managedById: input.createdById,
        })
        dbSkus.add(p.sku.toLowerCase())
        results.push({ row: p.excelRow, sku: p.sku, success: true, productId: product.id })
      } catch (e) {
        const msg = e instanceof Error ? e.message : "Import failed"
        errors.push({ row: p.excelRow, sku: p.sku, message: msg })
        results.push({ row: p.excelRow, sku: p.sku, success: false, message: msg })
        failedRowsForCsv.push({ ...Object.fromEntries(Object.entries(p.raw).map(([k, v]) => [k, String(v)])), error: msg })
      }
    })
  } else {
    const parents = collectVariantParents(wb.parentRows, HEADER_ROW)
    const variants = collectVariantLines(wb.variantRows, HEADER_ROW)
    const variantByParent = new Map<string, VariantLinePrepared[]>()
    for (const v of variants) {
      const k = (v.parentSku || v.parentProductSlug).toLowerCase()
      const list = variantByParent.get(k) ?? []
      list.push(v)
      variantByParent.set(k, list)
    }
    await processInChunks(parents, async (p) => {
      if (p.errors.length) {
        const msg = p.errors.join("; ")
        errors.push({ row: p.excelRow, sku: p.parentSku || undefined, message: msg })
        results.push({ row: p.excelRow, sku: p.parentSku, success: false, message: msg })
        failedRowsForCsv.push({ parentSku: p.parentSku, slug: p.slug, error: msg })
        return
      }
      const lines = variantByParent.get(p.parentSku.toLowerCase()) ?? variantByParent.get(p.slug.toLowerCase()) ?? []
      if (!lines.length) {
        const msg = "No variants for this parent"
        errors.push({ row: p.excelRow, sku: p.parentSku, message: msg })
        results.push({ row: p.excelRow, sku: p.parentSku, success: false, message: msg })
        failedRowsForCsv.push({ parentSku: p.parentSku, slug: p.slug, error: msg })
        return
      }
      try {
        if (dbSkus.has(p.parentSku.toLowerCase())) throw new Error("Parent SKU already exists")
        for (const line of lines) {
          if (dbSkus.has(line.variantSku.toLowerCase())) throw new Error(`Variant SKU exists: ${line.variantSku}`)
        }
        const catRef = str(getCell(p.raw, "categories", "category"))
        const categoryId = catRef ? resolveCategoryId(cats, catRef) : null
        const tagsRaw = str(getCell(p.raw, "tags"))
        const tagIds = tagsRaw ? resolveTagIds(tags, tagsRaw).ids : []
        const built = await buildVariantCreateInput({
          parentRaw: p.raw,
          lines,
          zipMap,
          categoryId,
          tagIds,
          parentSku: p.parentSku,
          slug: p.slug,
        })
        const parsed = createProductSchema.safeParse(built)
        if (!parsed.success) {
          throw new Error(parsed.error.issues.map((e) => e.message).join("; "))
        }
        const product = await createProduct({
          ...parsed.data,
          createdById: input.createdById,
          managedById: input.createdById,
        })
        dbSkus.add(p.parentSku.toLowerCase())
        for (const line of lines) {
          dbSkus.add(line.variantSku.toLowerCase())
        }
        results.push({ row: p.excelRow, sku: p.parentSku, success: true, productId: product.id })
      } catch (e) {
        const msg = e instanceof Error ? e.message : "Import failed"
        errors.push({ row: p.excelRow, sku: p.parentSku, message: msg })
        results.push({ row: p.excelRow, sku: p.parentSku, success: false, message: msg })
        failedRowsForCsv.push({
          parentSku: p.parentSku,
          slug: p.slug,
          error: msg,
        })
      }
    })
  }

  const successCount = results.filter((r) => r.success).length
  const failedCount = results.filter((r) => !r.success).length
  await tryWriteBulkLog({
    fileName: input.fileName,
    uploadType: input.uploadType,
    totalRows: results.length,
    successCount,
    failedCount,
    status: failedCount ? "partial" : "completed",
    createdBy: input.createdById,
  })
  await invalidateProductCache().catch(() => null)
  try {
    await logActivity({
      actorId: input.createdById,
      action: "product.bulk_import",
      entityType: "BulkImport",
      entityId: null,
      metadata: { uploadType: input.uploadType, successCount, failedCount, fileName: input.fileName },
    })
  } catch {
    // optional activity log
  }

  const totalRows = results.length
  const summary: BulkValidationSummary = {
    uploadType: input.uploadType,
    totalRows,
    validRows: successCount,
    invalidRows: failedCount,
    duplicateSkuInFile: 0,
    existingSkuConflicts: errors.filter((x) => x.message.includes("exists")).length,
    missingImages: errors.filter((x) => x.message.toLowerCase().includes("missing")).length,
    invalidVariants: 0,
    invalidCategories: 0,
    invalidPrices: 0,
  }

  return { summary, errors, results, failedRowsForCsv }
}
