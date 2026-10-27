export type StorefrontPack = {
  id?: string
  variantId?: string | null
  variantWeight?: string | null
  name: string
  quantity: number
  mrp: number
  price: number
  discountPercent?: number | null
  sku?: string | null
  hsnCode?: string | null
  isActive?: boolean
}

export type StorefrontProduct = {
  id: string
  name: string
  slug: string
  sku: string
  productKind: "simple" | "variant"
  price: number
  oldPrice: number
  stockStatus?: string
  stock?: number
  description: string
  image: string
  status: string
  gallery: string[]
  amazonLink: string | null
  videoUrl: string | null
  weight: string
  type: "veg" | "non-veg"
  saleName?: string | null
  isFeatured?: boolean
  spiceLevel: string | null
  preparationType: string | null
  isBestSeller?: boolean
  tags?: Array<{ tag: { name: string } }>
  category: string
  categoryName?: string | null
  categorySlugs?: string[]
  labels: Array<{ label: string; color: string | null }>
  features: Array<{ title: string; icon: string | null }>
  details: Array<{ title: string; content: string }>
  sections: Array<{ id: string; title: string; description: string; sort_order: number; is_active: boolean }>
  variants: Array<{ id: string; name: string; weight: string; price: number; sku: string; stock: number; isDefault: boolean; discountPercent?: number | null; mrp?: number | null; promotion?: { name: string; kind: string } | null }>
  packs?: StorefrontPack[]
  discountPercent?: number | null
  finalPrice?: number | null
  promotion?: { name: string; kind: string } | null
}

type ApiProduct = {
  id: string
  name: string
  slug: string
  sku: string
  description?: string
  stockStatus?: string
  totalStock?: number
  price: string | number
  basePrice?: string | number | null
  salePrice?: string | number | null
  discountPercent?: string | number | null
  finalPrice?: string | number | null
  promotion?: { name: string; kind: string } | null
  thumbnail?: string | null
  videoUrl?: string | null
  isBestSeller?: boolean
  amazonLink?: string | null
  isFeatured?: boolean
  status?: string
  images?: Array<{ url: string }>
  type?: "simple" | "variant"
  saleName?: string | null
  weight?: string | null
    spiceLevel: string | null
  preparationType: string | null
  variants?: Array<{ id: string; name: string; weight?: string | null; price: string | number; sku: string; stock: number; isDefault?: boolean; discountPercent?: number | null; mrp?: number | null; promotion?: { name: string; kind: string } | null }>
  tags?: Array<{ tag: { name: string } }>
  labels?: Array<{ label: string; color: string | null }>
  features?: Array<{ title: string; icon: string | null }>
  details?: Array<{ title: string; content: string }>
  sections?: Array<{ id: string; title: string; description: string; sort_order: number; is_active: boolean }>
  packs?: any[]
  categories?: Array<{ category: { slug: string } }>
}

/** Old placeholder path. Product cards must not display this when a thumbnail is missing. */
export const FALLBACK_PRODUCT_IMAGE = "/fallback-product.png"

export const productImageSrc = (value: string | null | undefined) => {
  const raw = (value ?? "").trim()
  if (!raw || raw === FALLBACK_PRODUCT_IMAGE) return ""
  return raw
}

const toLocalUploadsPath = (value: string) => {
  const clean = value.replace(/^\/+/, "")
  return clean ? `/api/v1/uploads/${clean}` : null
}

export const normalizeMediaUrl = (value: string | null | undefined) => {
  const raw = (value ?? "").trim()
  if (!raw) return null
  // Keep local upload-proxy URLs as-is in local/dev.
  if (raw.startsWith("/api/v1/uploads/")) {
    return raw
  }
  // Local assets (or already-local paths) should be returned as-is.
  if (raw.startsWith("/")) return raw
  if (/^https?:\/\//i.test(raw)) {
    try {
      const parsed = new URL(raw)
      if (parsed.hostname === "cdn.ziply5.com") {
        // CDN may be unavailable in local/dev; rewrite to local uploads route.
        return toLocalUploadsPath(parsed.pathname)
      }
      return raw
    } catch {
      return null
    }
  }
  // Handle plain relative media keys/paths coming from legacy rows.
  return toLocalUploadsPath(raw)
}

export const toStorefrontProduct = (p: ApiProduct): StorefrontProduct => {
  const variants = p.variants ?? []
  const firstVariant = variants[0]
  const id = String((p as any).id ?? "").trim() || "0"
  const name = String((p as any).name ?? "").trim() || "Unknown Product"
  const slug =
    String((p as any).slug ?? "")
      .trim()
      .toLowerCase() || `product-${id}`
  const rawSku = String((p as any).sku ?? "").trim()
  const sku = rawSku || slug.replace(/-/g, "").slice(0, 12).toUpperCase() || `SKU${id.slice(0, 6).toUpperCase()}`

  const defaultVariant = variants.find((v) => v.isDefault) ?? firstVariant
  const sale = Number(p.price ?? defaultVariant?.price ?? 0)
  const oldPrice = Number(p.basePrice ?? defaultVariant?.mrp ?? sale)
  const tags = (p.tags ?? [])
    .map((t: any) => String(t?.tag?.name ?? t?.name ?? "").trim().toLowerCase())
    .filter(Boolean)
  const isVeg = tags.some((t) => t === "veg" || t === "vegetarian")
  const sections =
    (p.sections ?? [])
      .filter((s) => s.is_active)
      .sort((a, b) => a.sort_order - b.sort_order) ??
    []
  const fallbackDetails = p.details ?? []
  const normalizedThumb = normalizeMediaUrl(p.thumbnail)
  const normalizedGallery = (p.images ?? [])
    .map((i) => normalizeMediaUrl(i.url))
    .filter((url): url is string => Boolean(url))

  const categoryNames = (p.categories ?? [])
    .map((c: any) => String(c?.name ?? c?.category?.name ?? "").trim())
    .filter(Boolean)
  const categorySlugs = (p.categories ?? [])
    .map((c: any) => String(c?.slug ?? c?.category?.slug ?? "").trim().toLowerCase())
    .filter(Boolean)
  const categorySlug = categorySlugs[0] || (() => {
    const c0: any = (p as any).categories?.[0]
    if (!c0) return "all"
    const direct = String(c0.slug ?? "").trim()
    if (direct) return direct
    const nested = String(c0.category?.slug ?? "").trim()
    if (nested) return nested
    return "all"
  })()
  const rawCategoryName = categoryNames[0] || null
  const formattedSlugName =
    categorySlug && categorySlug !== "all"
      ? categorySlug
          .split("-")
          .map((word) => word.charAt(0).toUpperCase() + word.slice(1))
          .join(" ")
      : null
  const categoryName = rawCategoryName || formattedSlugName || null

  return {
    id,
    name,
    slug,
    status: p.status ?? "published",
    sku,
    productKind: p.type ?? (variants.length ? "variant" : "simple"),
    price: sale || 0,
    stockStatus: p.stockStatus ?? "out_of_stock",
    stock: p.type === "variant" ? 0 : p.totalStock || 0,
    oldPrice: oldPrice || 0,
    discountPercent: p.discountPercent ? Number(p.discountPercent) : null,
    finalPrice: p.finalPrice ? Number(p.finalPrice) : null,
    promotion: p.promotion ?? null,
    description: p.description ?? "Delicious ready meal.",
    image: normalizedThumb ?? "",
    gallery: normalizedGallery,
    videoUrl: p.videoUrl ?? null,
    weight: (p.type ?? (variants.length ? "variant" : "simple")) === "variant"
      ? (firstVariant?.weight ?? firstVariant?.name ?? "")
      : (p.weight ?? ""),
    type: isVeg ? "veg" : "non-veg",
    category: categorySlug,
    categoryName,
    categorySlugs: categorySlugs.length ? categorySlugs : [categorySlug],
    labels: p.labels ?? [],
    isBestSeller: p.isBestSeller ?? false,
    tags: p.tags ?? [],
    amazonLink: p.amazonLink ?? null,
    isFeatured: p.isFeatured ?? false,
      spiceLevel: p.spiceLevel ?? null,
  preparationType: p.preparationType ?? null,
    features: p.features ?? [],
    saleName:p?.saleName ?? null,
    details:
      sections.length > 0
        ? sections.map((s) => ({ title: s.title, content: s.description }))
        : fallbackDetails,
    sections,
    variants: variants.map((v) => ({
      id: String((v as any).id ?? "").trim() || crypto.randomUUID(),
      name: String((v as any).name ?? "").trim() || "",
      weight: v.weight ?? v.name ?? "",
      mrp: Number(v.mrp) || 0,
      sku: String((v as any).sku ?? "").trim() || sku,
      stock: v.stock ?? 0,
      isDefault: Boolean(v.isDefault),
      discountPercent: v.discountPercent ? Number(v.discountPercent) : null,
      price: v.price ? Number(v.price) : 0,
      promotion: v.promotion ?? null,
    })) || [],
    packs: (Array.isArray((p as any).packs)
      ? (p as any).packs
      : typeof (p as any).packs === "string"
        ? (() => {
            try {
              const parsed = JSON.parse((p as any).packs)
              return Array.isArray(parsed) ? parsed : []
            } catch {
              return []
            }
          })()
        : []
    ).map((pk: any) => ({
      id: String(pk.id || ""),
      variantId: pk.variantId ? String(pk.variantId) : null,
      variantWeight: pk.variantWeight ? String(pk.variantWeight).trim() : null,
      name: String(pk.name || `Pack of ${pk.quantity || 1}`).trim(),
      quantity: Number(pk.quantity) || 1,
      mrp: Number(pk.mrp) || 0,
      price: Number(pk.price) || 0,
      discountPercent: pk.discountPercent != null ? Number(pk.discountPercent) : null,
      sku: pk.sku ? String(pk.sku).replace(/-PACK-\d+/i, "") : null,
      hsnCode: pk.hsnCode || pk.hsn_code || null,
      isActive: pk.isActive !== false,
    })),
  } 
}
