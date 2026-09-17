"use client"

import Link from "next/link"
import { useCallback, useEffect, useMemo, useRef, useState } from "react"
import { useRouter } from "next/navigation"
import { authedFetch, authedPatch, authedPost } from "@/lib/dashboard-fetch"
import { ConsoleTable, ConsoleTd } from "@/components/dashboard/ConsoleTable"
import { RichTextEditor } from "@/components/dashboard/RichTextEditor"
import { Button } from "@/components/ui/button"
import { Checkbox } from "@/components/ui/checkbox"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select"
import { Textarea } from "@/components/ui/textarea"
import { Accordion, AccordionContent, AccordionItem, AccordionTrigger } from "@/components/ui/accordion"
import { Eye, ImagePlus, Pencil, Save, Trash2, X } from "lucide-react"
import { toast } from "@/lib/toast"
import { useMasterValues } from "@/hooks/useMasterData"

type Mode = "list" | "add" | "edit" | "view"

type ProductRow = {
  id: string
  name: string
  slug: string
  sku: string
  status: string
  price: string | number
  isActive?: boolean
  // seller?: { email: string; name: string } | null
}

type ProductDetail = {
  id: string
  name: string
  slug: string
  sku: string
  price: string | number
  status: "draft" | "published" | "archived"
  description?: string | null
  type?: "simple" | "variant"
  basePrice?: string | number | null
  salePrice?: string | number | null
  discountPercent?: string | number | null
  weight?: string | null
  stockStatus?: "in_stock" | "out_of_stock"
  totalStock?: number
  shelfLife?: string | null
  preparationType?: "ready_to_eat" | "ready_to_cook" | null
  spiceLevel?: "mild" | "medium" | "hot" | "extra_hot" | null
  taxIncluded?: boolean
  isActive?: boolean
  foodType?: string | null
  amazonLink?: string | null
  allowReturn?: boolean
  thumbnail?: string | null
  videoUrl?: string | null
  metaTitle?: string | null
  metaDescription?: string | null
  categories?: Array<{ categoryId: string }>
  tags?: Array<{ tag: { name: string; id: string } }>
  variants?: Array<{
    id?: string
    name: string
    weight?: string | null
    sku: string
    price: string | number
    mrp?: string | number | null
    discountPercent?: string | number | null
    stock: number
    isDefault?: boolean
  }>
  images?: Array<{ url: string }>
  details?: Array<{ title: string; content: string; sortOrder?: number }>
  sections?: Array<{ id: string; title: string; description: string; sortOrder: number; isActive: boolean }>
  features?: Array<{ title: string; icon?: string | null }>
  createdById?: string | null
  createdAt?: string | Date | null
  updatedAt?: string | Date | null
}

const ViewField = ({ label, value, className = "" }: { label: string; value: React.ReactNode; className?: string }) => (
  <div className={`flex flex-col gap-1 rounded-lg w-full border border-[#D9D9D1] bg-[#FDFDFD] px-3 py-2 text-sm ${className}`}>
    <span className="text-[10px] font-bold uppercase text-[#646464]">{label}</span>
    <div className="font-medium text-[#2A1810] break-words">
      {value || <span className="text-gray-400 italic">No data</span>}
    </div>
  </div>
)

type CategoryRow = { id: string; name: string }
type Tags = { id: string; name: string; isActive?: boolean }
const statuses = ["draft", "published", "archived"] as const
const foodTypes = ["veg", "non-veg"] as const
const preparationTypes = ["ready_to_eat", "ready_to_cook"] as const
const spiceLevels = ["mild", "medium", "hot", "extra_hot"] as const
const fallbackWeightOptions = ["250g", "500g", "1kg"] as const
const MAX_SECTIONS = 10
const LIST_PAGE_SIZE = 10
const uniq = (list: string[]) => [...new Set(list.map((x) => x.trim()).filter(Boolean))]
const formatCreatedAt = (value?: string | Date | null) => {
  if (!value) return "—"
  const date = value instanceof Date ? value : new Date(value)
  if (Number.isNaN(date.getTime())) return "—"
  return date.toLocaleDateString("en-GB", { day: "2-digit", month: "short", year: "numeric" })
}
const formatUpdatedAt = (value?: string | Date | null) => {
  if (!value) return "—"
  const date = value instanceof Date ? value : new Date(value)
  if (Number.isNaN(date.getTime())) return "—"
  return date.toLocaleString("en-GB", {
    day: "2-digit",
    month: "short",
    year: "numeric",
    hour: "2-digit",
    minute: "2-digit",
  })
}
const getProductSortPrice = (p: ProductDetail, mode: "min" | "max") => {
  if (p.type === "variant" && p.variants?.length) {
    const prices = p.variants.map((v) => Number(v.price)).filter((n) => Number.isFinite(n))
    if (prices.length) return mode === "max" ? Math.max(...prices) : Math.min(...prices)
  }
  const n = Number(p.price)
  return Number.isFinite(n) ? n : 0
}
const toNumOrNull = (value: string) => {
  const trimmed = value.trim()
  if (!trimmed) return null
  const n = Number(trimmed)
  return Number.isFinite(n) ? n : null
}

const parseWeight = (w: string | null | undefined) => {
  if (!w) return { value: "", unit: "gm" };
  const val = w.match(/[\d.]+/)?.[0] || "";
  const unitStr = w.replace(/[\d.]/g, "").toLowerCase().trim();
  let unit = "gm";
  if (unitStr.includes("kg") || unitStr.includes("kilo")) unit = "kg";
  else if (unitStr.includes("mg") || unitStr.includes("milli")) unit = "mg";
  else if (unitStr.includes("g")) unit = "gm";
  return { value: val, unit };
};

const Card = ({ title, children }: any) => (
  <div className="bg-white rounded-2xl p-4 border border-[#E5E5DC] shadow-sm">
    <p className="font-semibold mb-3 text-[#4A1D1F]">{title}</p>
    <div className="space-y-2 text-sm">{children}</div>
  </div>
)

const Info = ({ label, value }: any) => (
  <div className="flex justify-between">
    <span className="text-gray-500">{label}</span>
    <span className="font-medium text-[#2A1810]">{value || "—"}</span>
  </div>
)

const Badge = ({ label }: any) => (
  <span className="text-xs bg-[#F5F1E6] px-2 py-1 rounded-full border capitalize">
    {label}
  </span>
)

const Field = ({
  label,
  required,
  children,
}: {
  label: string
  required?: boolean
  children: React.ReactNode
}) => (
  <div className="space-y-2">
    <Label className="text-xs font-semibold uppercase text-[#4A1D1F]">
      {label}
      {required ? <span className="ml-1 text-red-500">*</span> : null}
    </Label>
    {children}
  </div>
)

const ImageUploadPicker = ({
  label,
  hint,
  required,
  urls,
  coverBadge,
  emptyTitle,
  uploading,
  onPick,
  onRemove,
}: {
  label: string
  hint: string
  required?: boolean
  urls: string[]
  coverBadge?: boolean
  emptyTitle: string
  uploading: boolean
  onPick: (files: FileList | null) => void
  onRemove: (url: string) => void
}) => {
  const inputRef = useRef<HTMLInputElement>(null)
  const [dragOver, setDragOver] = useState(false)

  const takeFiles = (files: FileList | null) => {
    onPick(files)
    if (inputRef.current) inputRef.current.value = ""
  }

  return (
    <Field label={label} required={required}>
      <p className="-mt-1 mb-2 text-[11px] leading-snug text-[#646464]">{hint}</p>
      <div
        onDragOver={(e) => {
          e.preventDefault()
          setDragOver(true)
        }}
        onDragLeave={() => setDragOver(false)}
        onDrop={(e) => {
          e.preventDefault()
          setDragOver(false)
          takeFiles(e.dataTransfer.files)
        }}
        className={`rounded-xl border border-dashed p-3 transition-colors ${
          dragOver ? "border-[#7B3010] bg-[#FFF6EC]" : "border-[#D9D9D1] bg-[#FFFBF3]/40"
        }`}
      >
        <input
          ref={inputRef}
          type="file"
          multiple
          accept="image/*"
          className="sr-only"
          onChange={(e) => takeFiles(e.target.files)}
        />
        <button
          type="button"
          disabled={uploading}
          onClick={() => inputRef.current?.click()}
          className="flex w-full flex-col items-center justify-center gap-1 rounded-lg px-3 py-4 text-center hover:bg-white/80 disabled:opacity-60"
        >
          <ImagePlus className="h-6 w-6 text-[#7B3010]" strokeWidth={1.75} />
          <span className="text-sm font-medium text-[#4A1D1F]">
            {uploading ? "Uploading…" : emptyTitle}
          </span>
          <span className="text-[11px] text-[#646464]">PNG, JPG, or WEBP. You can add more later.</span>
        </button>
        {urls.length > 0 ? (
          <div className="mt-3 grid grid-cols-3 gap-2 sm:grid-cols-4">
            {urls.map((url, idx) => (
              <div key={`${url}-${idx}`} className="group relative overflow-hidden rounded-lg border border-[#E8DCC8] bg-white">
                <img src={url} alt="" className="h-20 w-full object-cover" />
                {coverBadge && idx === 0 ? (
                  <span className="absolute left-1 top-1 rounded bg-[#7B3010] px-1.5 py-0.5 text-[9px] font-semibold uppercase tracking-wide text-white">
                    Cover
                  </span>
                ) : null}
                <button
                  type="button"
                  aria-label="Remove image"
                  onClick={() => onRemove(url)}
                  className="absolute right-1 top-1 inline-flex h-6 w-6 items-center justify-center rounded-full bg-white/95 text-[#4A1D1F] shadow-sm hover:bg-white"
                >
                  <X className="h-3.5 w-3.5" />
                </button>
              </div>
            ))}
          </div>
        ) : null}
        {urls.length > 0 ? (
          <p className="mt-2 text-[11px] text-[#646464]">
            {urls.length} image{urls.length === 1 ? "" : "s"} added
            {coverBadge ? ". The first image is used as the product cover." : "."}
          </p>
        ) : null}
      </div>
    </Field>
  )
}

export function ProductConsolePage({
  adminView,
  mode,
  productId,
}: {
  adminView: boolean
  mode: Mode
  productId?: string
}) {
  const router = useRouter()
  const [rows, setRows] = useState<ProductDetail[]>([])
  const [categories, setCategories] = useState<CategoryRow[]>([])
  const [total, setTotal] = useState(0)
  const [loading, setLoading] = useState(true)
  const [saving, setSaving] = useState(false)
  const [uploadingThumbnails, setUploadingThumbnails] = useState(false)
  const [uploadingGallery, setUploadingGallery] = useState(false)
  const [uploadingIcon, setUploadingIcon] = useState(false)
  const [error, setErrorState] = useState("")
  const setError = (message: string) => {
    setErrorState(message)
    if (message && (mode === "add" || mode === "edit")) {
      toast.error(message)
    }
  }
  const [rowStatus, setRowStatus] = useState<Record<string, string>>({})
  const [features, setFeatures] = useState<Array<{ title: string; icon?: string | null }>>([])
  const [name, setName] = useState("")
  const [slug, setSlug] = useState("")
  const [sku, setSku] = useState("")
  const [description, setDescription] = useState("")
  const [status, setStatus] = useState<(typeof statuses)[number]>("published")
  const [type, setType] = useState<"simple" | "variant">("variant")
  const [price, setPrice] = useState("")
  const [basePrice, setBasePrice] = useState("")
  const [salePrice, setSalePrice] = useState("")
  const [costPrice, setCostPrice] = useState("")
  const [amazonLink, setAmazonLink] = useState("")
  const [discountPercent, setDiscountPercent] = useState("")
  const [discountRecordId, setDiscountRecordId] = useState<string | null>(null)
  const [discountEnabled, setDiscountEnabled] = useState(false)
  const [discountType, setDiscountType] = useState<"percentage" | "flat">("percentage")
  const [discountValue, setDiscountValue] = useState("")
  const [discountStartDate, setDiscountStartDate] = useState("")
  const [discountEndDate, setDiscountEndDate] = useState("")
  const [autoExpireDiscount, setAutoExpireDiscount] = useState(true)
  const [showStrikeThroughPrice, setShowStrikeThroughPrice] = useState(true)
  const [discountStackable, setDiscountStackable] = useState(false)
  const [simpleProductWeight, setSimpleProductWeight] = useState(""); // New state for simple product weight
  const [stockStatus, setStockStatus] = useState<"in_stock" | "out_of_stock">("in_stock")
  const [totalStock, setTotalStock] = useState("0")
  const [variants, setVariants] = useState<Array<{ id?: string; name: string; weight: string; sku: string; price: string; mrp: string; discountPercent: string; stock: string; isDefault: boolean }>>([
    { name: "250g", weight: "250g", sku: "", price: "", mrp: "", discountPercent: "", stock: "0", isDefault: true },
  ])
  const [variantMode, setVariantMode] = useState<"single" | "multiple">("single")
  const [updatedAt, setUpdatedAt] = useState<string | Date | null>(null)
  const [shelfLife, setShelfLife] = useState("")
  const [preparationType, setPreparationType] = useState<"" | "ready_to_eat" | "ready_to_cook">("")
  const [spiceLevel, setSpiceLevel] = useState<"" | "mild" | "medium" | "hot" | "extra_hot">("")
  const [taxIncluded, setTaxIncluded] = useState(false)
  const [isActive, setIsActive] = useState(true)
  const [allowReturn, setAllowReturn] = useState(true)
  const [thumbnailUrls, setThumbnailUrls] = useState<string[]>([])
  const [metaTitle, setMetaTitle] = useState("")
  const [metaDescription, setMetaDescription] = useState("")
  const [categoryId, setCategoryId] = useState("")
  const [selectedTagIds, setSelectedTagIds] = useState<string[]>([])
  const [tagsDropdownOpen, setTagsDropdownOpen] = useState(false)
  const tagsDropdownRef = useRef<HTMLDivElement>(null)
  const [foodType, setFoodType] = useState<"" | "veg" | "non-veg">("")
  const [tags, setTags] = useState<Array<{ id: string; name: string }>>([])
  const [imageUrls, setImageUrls] = useState<string[]>([])
  const [createdBy, setCreatedBy] = useState("user_admin_ziply5")
  const [sections, setSections] = useState<Array<{ id?: string; title: string; description: string; sortOrder: number; isActive: boolean }>>([
    { title: "Key Features", description: "<ul><li></li></ul>", sortOrder: 0, isActive: true },
  ])
  const [searchQuery, setSearchQuery] = useState("")
  const [catalog, setCatalog] = useState<"products" | "combos">("products")
  const [comboRows, setComboRows] = useState<
    Array<{
      id: string
      name: string
      slug: string
      pricingMode?: string
      comboPrice?: number | null
      isActive?: boolean
      items?: Array<{ id: string; quantity: number; product?: { name?: string } | null }>
    }>
  >([])
  const [activeCombo, setActiveCombo] = useState<any | null>(null)
  const [filterStatus, setFilterStatus] = useState<"all" | "draft" | "published" | "archived">("all")
  const [filterCategory, setFilterCategory] = useState<"all" | string>("all")
  const [filterPreparationType, setFilterPreparationType] = useState<"all" | "ready_to_eat" | "ready_to_cook">("all")
  const [filterStockStatus, setFilterStockStatus] = useState<"all" | "in_stock" | "out_of_stock">("all")
  const [filterFoodType, setFilterFoodType] = useState<"all" | "veg" | "non-veg">("all")
  const [filterType, setFilterType] = useState<"all" | "simple" | "variant">("all")
  const [sortPrice, setSortPrice] = useState<"" | "low_to_high" | "high_to_low">("")
  const [listPage, setListPage] = useState(1)
  const productWeightMasterQuery = useMasterValues("PRODUCT_WEIGHT")
  const weightOptions = fallbackWeightOptions

  const orderedSections = useMemo(
    () => [...sections].sort((a, b) => a.sortOrder - b.sortOrder),
    [sections],
  )

  const resetFilters = () => {
    setSearchQuery("")
    setFilterStatus("all")
    setFilterType("all")
    setFilterCategory("all")
    setFilterPreparationType("all")
    setFilterStockStatus("all")
    setFilterFoodType("all")
    setSortPrice("")
    setListPage(1)
  }

  const loadCombos = useCallback(async () => {
    setLoading(true)
    setError("")
    try {
      const data = await authedFetch<any[]>("/api/v1/bundles")
      const rows = (Array.isArray(data) ? data : []).filter((b) => b?.isCombo !== false)
      setComboRows(rows as any)
      setTotal(rows.length)
    } catch (e) {
      setError(e instanceof Error ? e.message : "Failed to load combos")
    } finally {
      setLoading(false)
    }
  }, [])

  const filteredRows = useMemo(() => {
    let result = rows

    // Apply search filter
    if (searchQuery.trim()) {
      const query = searchQuery.toLowerCase().trim()
      result = result.filter((p) => {
        const nameMatch = (p.name ?? "").toLowerCase().includes(query)
        const priceValues = p.type === "variant" && p.variants?.length
          ? p.variants.map((v) => v.price)
          : [p.price]
        const priceMatch = priceValues.some((value) => {
          if (value == null || value === "") return false
          const raw = String(value).toLowerCase()
          const numeric = Number(value)
          const formatted = Number.isFinite(numeric) ? numeric.toFixed(2) : ""
          return raw.includes(query) || formatted.includes(query)
        })
        return nameMatch || priceMatch
      })
    }

    // Apply status filter
    if (filterStatus !== 'all') {
      result = result.filter(p => p.status === filterStatus)
    }

    // Apply type filter
    if (filterType !== 'all') {
      result = result.filter(p => p.type === filterType)
    }

    // Apply category filter
    if (filterCategory !== 'all') {
      result = result.filter(p => p.categories?.some(c => c.categoryId === filterCategory))
    }

    // Apply preparation type filter
    if (filterPreparationType !== 'all') {
      result = result.filter(p => p.preparationType === filterPreparationType)
    }

    // Apply stock status filter
    if (filterStockStatus !== 'all') {
      result = result.filter(p => p.stockStatus === filterStockStatus)
    }

    // Apply food type filter
    if (filterFoodType !== 'all') {
      result = result.filter(p => {
        const tagNames = (p.tags ?? []).map((x) => x.tag.name.toLowerCase())
        return filterFoodType === 'veg'
          ? tagNames.includes('veg') || tagNames.includes('vegetarian')
          : tagNames.includes('non-veg') || tagNames.includes('non vegetarian')
      })
    }

    if (sortPrice) {
      const mode = sortPrice === "high_to_low" ? "max" : "min"
      result = [...result].sort((a, b) => {
        const diff = getProductSortPrice(a, mode) - getProductSortPrice(b, mode)
        return sortPrice === "high_to_low" ? -diff : diff
      })
    }

    return result
  }, [rows, searchQuery, filterStatus, filterType, filterCategory, filterPreparationType, filterStockStatus, filterFoodType, sortPrice])

  useEffect(() => {
    setListPage(1)
  }, [searchQuery, filterStatus, filterType, filterCategory, filterPreparationType, filterStockStatus, filterFoodType, sortPrice])

  const listPageCount = Math.max(1, Math.ceil(filteredRows.length / LIST_PAGE_SIZE))
  const currentListPage = Math.min(listPage, listPageCount)
  const pagedRows = filteredRows.slice((currentListPage - 1) * LIST_PAGE_SIZE, currentListPage * LIST_PAGE_SIZE)
  const listStart = filteredRows.length === 0 ? 0 : (currentListPage - 1) * LIST_PAGE_SIZE + 1
  const listEnd = Math.min(currentListPage * LIST_PAGE_SIZE, filteredRows.length)

  const basePath = adminView ? "/admin/products" : "/admin/products"

  const loadList = useCallback(() => {
    setLoading(true)
    setError("")
    Promise.all([
      authedFetch<{ items: ProductDetail[]; total: number }>("/api/v1/products?page=1&limit=100"),
      authedFetch<CategoryRow[]>("/api/v1/categories").catch(() => []),
      authedFetch<Tags[]>("/api/v1/tags").catch(() => [])
    ])
      .then(([products, cats, tags]) => {
        setRows(products.items as ProductDetail[])
        setTotal(products.total)
        setCategories(cats.filter((c) => Boolean(c.id)))
        setTags(tags.filter((t) => t.isActive !== false))
        const map: Record<string, string> = {}
        products.items.forEach((p) => {
          map[p.id] = p.status
        })
        setRowStatus(map)
      })
      .catch((e: Error) => setError(e.message))
      .finally(() => setLoading(false))
  }, [])

  const loadEdit = useCallback(async () => {
    if (!productId) return
    setLoading(true)
    setError("")
    try {
      const [p, cats, discountRows, tagsRows] = await Promise.all([
        authedFetch<ProductDetail>(`/api/v1/products/${productId}`),
        authedFetch<CategoryRow[]>("/api/v1/categories").catch(() => []),
        authedFetch<Array<{
          id: string
          discount_type: "percentage" | "flat"
          discount_value: number
          start_date: string | null
          end_date: string | null
          is_stackable: boolean
        }>>(`/api/admin/product-discounts?productId=${productId}`).catch(() => []),
        authedFetch<Tags[]>("/api/v1/tags").catch(() => []),
      ])
      const v = p.variants?.find((item) => item.isDefault) ?? p.variants?.[0]
      setCategories(cats.filter((c) => Boolean(c.id)))
      setTags(tagsRows.filter((t) => t.isActive !== false))
      setName(p.name)
      setSlug(p.slug)
      setSku(p.sku)
      setDescription(p.description ?? "")
      setStatus(p.status)
      setType(p.type ?? "variant")
      setPrice(String(Number(v?.price ?? p.price ?? 0)))
      setBasePrice(p.basePrice != null ? String(Number(p.basePrice)) : "")
      setSalePrice(p.salePrice != null ? String(Number(p.salePrice)) : "")
      setCostPrice("")
      setAmazonLink(p.amazonLink ?? "")
      setDiscountPercent(p.discountPercent != null ? String(Number(p.discountPercent)) : "")
      setSimpleProductWeight(p.weight ?? ""); // Populate new weight field
      setStockStatus(p.stockStatus ?? "in_stock")
      setTotalStock(String(p.totalStock ?? 0))
      setShelfLife(p.shelfLife ?? "")
      setPreparationType((p.preparationType ?? "") as "" | "ready_to_eat" | "ready_to_cook")
      setSpiceLevel((p.spiceLevel ?? "") as "" | "mild" | "medium" | "hot" | "extra_hot")
      setTaxIncluded(p.taxIncluded ?? false)
      setIsActive(p.isActive ?? true)
      setAllowReturn(p.allowReturn ?? true)
      setThumbnailUrls(uniq([p.thumbnail ?? ""]))
      setMetaTitle(p.metaTitle ?? "")
      setMetaDescription(p.metaDescription ?? "")
      setCreatedBy(p.createdById ?? "user_admin_ziply5")
      setUpdatedAt(p.updatedAt ?? (p as { updated_at?: string | Date | null }).updated_at ?? null)
      setFeatures(p.features ?? [])
      setCategoryId(p.categories?.[0]?.categoryId ?? "")
      setSelectedTagIds((p.tags ?? []).map((x) => x.tag.id).filter(Boolean).slice(0, 1))
      const tagNames = (p.tags ?? []).map((x) => x.tag.name.toLowerCase())
      setFoodType(tagNames.includes("veg") || tagNames.includes("vegetarian") ? "veg" : tagNames.includes("non-veg") || tagNames.includes("non vegetarian") ? "non-veg" : "")
      setImageUrls(uniq((p.images ?? []).map((img) => img.url)))
      setVariants(
        p.variants?.length
          ? p.variants.map((item, idx) => ({
            id: item.id,
            name: item.weight ?? item.name ?? `Variant ${idx + 1}`,
            weight: item.weight ?? item.name ?? "",
            sku: item.sku ?? "",
            price: String(Number(item.price ?? 0)),
            mrp: item.mrp != null ? String(Number(item.mrp)) : "",
            discountPercent: item.discountPercent != null ? String(Number(item.discountPercent)) : "",
            stock: String(item.stock ?? 0),
            isDefault: Boolean(item.isDefault) || idx === 0,
          }))
          : [{ name: "250g", weight: "250g", sku: "", price: "", mrp: "", discountPercent: "", stock: "0", isDefault: true }],
      )
      setVariantMode((p.variants?.length ?? 0) > 1 ? "multiple" : "single")
      const nextSections =
        (p.sections?.length
          ? p.sections.map((s) => ({
            id: s.id,
            title: s.title,
            description: s.description,
            sortOrder: s.sortOrder ?? 0,
            isActive: s.isActive ?? true,
          }))
          : (p.details ?? []).map((d, idx) => ({
            title: d.title,
            description: d.content,
            sortOrder: d.sortOrder ?? idx,
            isActive: true,
          }))) ?? []
      setSections(
        nextSections.length
          ? nextSections.sort((a, b) => a.sortOrder - b.sortOrder)
          : [{ title: "Key Features", description: "<ul><li></li></ul>", sortOrder: 0, isActive: true }],
      )
      const existingDiscount = discountRows?.[0]
      if (existingDiscount) {
        setDiscountRecordId(existingDiscount.id)
        setDiscountEnabled(true)
        setDiscountType(existingDiscount.discount_type)
        setDiscountValue(String(Number(existingDiscount.discount_value)))
        setDiscountStartDate(existingDiscount.start_date ? new Date(existingDiscount.start_date).toISOString().slice(0, 16) : "")
        setDiscountEndDate(existingDiscount.end_date ? new Date(existingDiscount.end_date).toISOString().slice(0, 16) : "")
        setDiscountStackable(Boolean(existingDiscount.is_stackable))
      } else {
        setDiscountRecordId(null)
        setDiscountEnabled(false)
        setDiscountType("percentage")
        setDiscountValue("")
        setDiscountStartDate("")
        setDiscountEndDate("")
        setDiscountStackable(false)
      }
    } catch (e) {
      setError(e instanceof Error ? e.message : "Could not load product")
    } finally {
      setLoading(false)
    }
  }, [productId])

  useEffect(() => {
    if (mode === "list" || mode === "add") {
      if (catalog === "combos") {
        void loadCombos()
      } else {
        loadList()
      }
    }
    if (mode === "edit" || mode === "view") void loadEdit()
  }, [catalog, loadCombos, loadEdit, loadList, mode])

  useEffect(() => {
    if (mode !== "list") return
    // Read query param client-side to avoid Suspense requirement from useSearchParams().
    const params = new URLSearchParams(window.location.search)
    const next = params.get("catalog") === "combos" ? "combos" : "products"
    setCatalog(next)
    if (next === "combos") void loadCombos()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [mode])

  useEffect(() => {
    if (!tagsDropdownOpen) return
    const onPointerDown = (event: MouseEvent) => {
      if (!tagsDropdownRef.current?.contains(event.target as Node)) {
        setTagsDropdownOpen(false)
      }
    }
    document.addEventListener("mousedown", onPointerDown)
    return () => document.removeEventListener("mousedown", onPointerDown)
  }, [tagsDropdownOpen])

  // Auto-calculate Sale Price for Simple Product
  useEffect(() => {
    if (type === "simple") {
      const base = parseFloat(basePrice) || 0
      const discount = parseFloat(discountPercent) || 0
      const sale = base - (base * discount) / 100
      const res = sale > 0 ? sale.toFixed(2) : (base > 0 ? base.toFixed(2) : "")
      if (res !== price) {
        setPrice(res)
        setSalePrice(res)
      }
    }
  }, [basePrice, discountPercent, type, price])

  const payload = useMemo(() => {
    const sourceVariants = variantMode === "single" ? variants.slice(0, 1) : variants
    const normalizedVariants = sourceVariants
      .map((v, idx) => ({
        id: v.id,
        name: (v.weight || v.name || `Variant ${idx + 1}`).trim(),
        weight: (v.weight || v.name || "").trim(),
        sku: v.sku.trim(),
        price: Number(v.price || 0),
        mrp: toNumOrNull(v.mrp),
        discountPercent: toNumOrNull(v.discountPercent),
        stock: Math.max(0, Number(v.stock || 0)),
        isDefault: Boolean(v.isDefault),
      }))
      .filter((v) => v.name && v.sku)
    if (normalizedVariants.length > 0 && !normalizedVariants.some((v) => v.isDefault)) {
      normalizedVariants[0].isDefault = true
    }
    const defaultVariant = normalizedVariants.find((v) => v.isDefault) ?? normalizedVariants[0]
    const parsedPrice =
      type === "variant"
        ? Number(defaultVariant?.price ?? 0)
        : (toNumOrNull(price) ?? toNumOrNull(salePrice) ?? toNumOrNull(basePrice) ?? 0)
    const derivedSku = type === "variant" ? (defaultVariant?.sku ?? sku.trim()) : sku.trim()
    const derivedStock = type === "variant"
      ? normalizedVariants.reduce((sum, v) => sum + v.stock, 0)
      : (totalStock.trim() ? Number(totalStock) : 0)
    return {
      name: name.trim(),
      slug: slug.trim(),
      sku: derivedSku,
      description: description.trim() || undefined,
      status: status,
      type: type,
      price: parsedPrice,
      variants: type === "variant" ? normalizedVariants : [],
      basePrice: toNumOrNull(basePrice),
      salePrice: toNumOrNull(salePrice),
      discountPercent: toNumOrNull(discountPercent),
      weight: type === "simple" ? (parseWeight(simpleProductWeight).value ? simpleProductWeight.trim() : null) : null, // Include new weight field
      stockStatus,
      totalStock: derivedStock,
      shelfLife: shelfLife.trim() || null,
      spiceLevel: spiceLevel || null,
      taxIncluded,
      isActive,
      allowReturn,
      amazonLink: amazonLink.trim() || null,
      thumbnail: uniq(thumbnailUrls)[0] ?? null,
      metaTitle: metaTitle.trim() || null,
      metaDescription: metaDescription.trim() || null,
      categoryId: categoryId || undefined,
      tagIds: selectedTagIds,
      images: uniq([...thumbnailUrls, ...imageUrls]),
      sections: sections
        .map((s, idx) => ({
          id: s.id,
          title: s.title.trim(),
          description: s.description.trim(),
          sortOrder: Number.isFinite(s.sortOrder) ? s.sortOrder : idx,
          isActive: s.isActive,
        }))
        .filter((s) => s.title && s.description)
        .slice(0, MAX_SECTIONS),
      features: features
        .map((f) => ({ title: f.title.trim(), icon: f.icon }))
        .filter((f) => f.title)
        .slice(0, 10),
    }
  }, [
    basePrice,
    categoryId,
    selectedTagIds,
    description,
    discountPercent,
    imageUrls,
    isActive,
    allowReturn,
    metaDescription,
    metaTitle,
    simpleProductWeight, // Add to dependencies
    features,
    name,
    price,
    salePrice,
    shelfLife,
    sku,
    slug,
    amazonLink,
    status,
    stockStatus,
    taxIncluded,
    thumbnailUrls,
    totalStock,
    type,
    variants,
    variantMode,
    spiceLevel,
    sections,
  ])

  const onSubmit = async (e: React.FormEvent) => {
    e.preventDefault()
    const isDraft = status === "draft"

    if (!payload.name || !payload.slug || !payload.sku) {
      setError("Name, slug and SKU are required")
      return
    }
    if (payload.type === "variant") {
      if (!payload.variants.length) {
        setError("At least 1 variant is required for variant products")
        return
      }
      if (payload.variants.filter((v) => v.isDefault).length !== 1) {
        setError("Exactly one default variant is required")
        return
      }
      const skuSet = new Set<string>()
      for (const variant of payload.variants) {
        if (variant.price <= 0) {
          setError("Variant price must be greater than 0")
          return
        }
        if (variant.stock < 0) {
          setError("Variant stock cannot be negative")
          return
        }
        const key = variant.sku.toLowerCase()
        if (skuSet.has(key)) {
          setError("Variant SKUs must be unique")
          return
        }
        skuSet.add(key)
      }
    }

    if (!isDraft) {
      const baseMrp = toNumOrNull(basePrice)
      const selling = toNumOrNull(price)
      if (baseMrp != null && selling != null && selling > baseMrp) {
        setError("Selling price cannot exceed MRP")
        return
      }
      if (discountEnabled) {
        const startAt = discountStartDate ? new Date(discountStartDate).getTime() : null
        const endAt = discountEndDate ? new Date(discountEndDate).getTime() : null
        if (startAt != null && endAt != null && endAt <= startAt) {
          setError("Discount end date must be after start date")
          return
        }
        const rawDiscount = Number(discountValue || 0)
        if (!Number.isFinite(rawDiscount) || rawDiscount <= 0) {
          setError("Discount value must be greater than zero")
          return
        }
        const effectiveBase = baseMrp ?? selling ?? 0
        const discounted =
          discountType === "percentage"
            ? effectiveBase - (effectiveBase * rawDiscount) / 100
            : effectiveBase - rawDiscount
        if (discounted < 0) {
          setError("Discounted price cannot go below zero")
          return
        }
      }
      if (payload.type === "simple" && !payload.price && !payload.basePrice) {
        setError("Price is required")
        return
      }
      if (status === "published") {
        if (payload.price <= 0) {
          setError("Sale Price must be greater than 0 to publish")
          return
        }
        if (!payload.shelfLife) {
          setError("Shelf Life is required to publish")
          return
        }
      }
      if (payload.type === "simple" && payload.discountPercent == null) {
        setError("Discount percentage is required")
        return
      }
      if (payload.type === "simple" && !payload.weight) { // New validation for simple product weight
        setError("Weight is required for simple products.");
        return;
      }
      if (!payload.type) {
        setError("Product type is required")
        return
      }
      if (!payload.stockStatus) {
        setError("Stock status is required")
        return
      }
      if (!payload.shelfLife) {
        setError("Shelf life is required")
        return
      }
      if (!payload.thumbnail) {
        setError("Thumbnail image is required")
        return
      }
      if (!payload.description) {
        setError("Description is required")
        return
      }
      if (payload.sections.length < 2) {
        setError("At least 2 product details/sections are required")
        return
      }
    }

    const isPublishing = status === "published"

    if (isPublishing) {
      if (!payload.price || payload.price <= 0) {
        setError("Provide at least one valid price to publish the product")
        return
      }
      if (payload.features.length === 0) {
        setError("At least one product feature is required to publish")
        return
      }
    }
    setSaving(true)
    setError("")
    try {
      let resolvedProductId = productId ?? ""
      if (mode === "edit" && productId) {
        await authedPatch(`/api/v1/products/${productId}`, payload)
        resolvedProductId = productId
        // toast({ title: "Product updated successfully", variant: "default"})
        alert("Product updated successfully")
      } else {
        const created = await authedPost<ProductDetail>("/api/v1/products", payload)
        resolvedProductId = created.id
        alert("Product created successfully")
        // toast({ title: "Product created successfully", variant: "default" })
      }
      if (resolvedProductId && discountEnabled) {
        const discountPayload = {
          productId: resolvedProductId,
          discountType,
          discountValue: Number(discountValue || 0),
          startDate: discountStartDate ? new Date(discountStartDate).toISOString() : null,
          endDate: discountEndDate ? new Date(discountEndDate).toISOString() : null,
          isStackable: discountStackable,
        }
        if (discountRecordId) {
          await authedFetch("/api/admin/product-discounts", {
            method: "PUT",
            body: JSON.stringify({ id: discountRecordId, ...discountPayload }),
          })
        } else {
          await authedFetch("/api/admin/product-discounts", {
            method: "POST",
            body: JSON.stringify(discountPayload),
          })
        }
      }
      if (resolvedProductId && !discountEnabled && discountRecordId) {
        await authedFetch("/api/admin/product-discounts", {
          method: "PUT",
          body: JSON.stringify({
            id: discountRecordId,
            endDate: new Date().toISOString(),
          }),
        })
      }
      router.push(mode === "edit" ? `${basePath}/${resolvedProductId}` : `${basePath}`)
    } catch (e) {
      setError(e instanceof Error ? e.message : "Save failed")
    } finally {
      setSaving(false)
    }
  }

  const uploadMany = async (
    files: FileList | null | undefined,
    kind: "thumbnail" | "image",
  ) => {
    const selected = files ? Array.from(files) : []
    if (selected.length === 0) return
    if (kind === "thumbnail") setUploadingThumbnails(true)
    else setUploadingGallery(true)
    setError("")
    try {
      const token = window.localStorage.getItem("ziply5_access_token")
      const form = new FormData()
      selected.forEach((file) => form.append("files", file))
      form.append("folder", `products/${kind}`)
      const res = await fetch("/api/v1/uploads", {
        method: "POST",
        headers: token ? { Authorization: `Bearer ${token}` } : undefined,
        body: form,
      })
      const json = (await res.json()) as {
        success?: boolean
        message?: string
        data?: { files?: Array<{ url: string }> }
      }
      if (!res.ok || json.success === false) {
        setError(json.message ?? "Upload failed")
        return
      }
      const urls = uniq((json.data?.files ?? []).map((f) => f.url))
      if (urls.length === 0) {
        setError("Upload failed")
        return
      }
      if (kind === "thumbnail") {
        setThumbnailUrls((prev) => uniq([...prev, ...urls]))
      }
      if (kind === "image") {
        setImageUrls((prev) => uniq([...prev, ...urls]))
      }
    } catch {
      setError("Upload failed")
    } finally {
      if (kind === "thumbnail") setUploadingThumbnails(false)
      else setUploadingGallery(false)
    }
  }

  const uploadIcon = async (files: FileList | null | undefined, idx: number) => {
    const selected = files ? Array.from(files).slice(0, 1) : []
    if (selected.length === 0) return
    setUploadingIcon(true)
    setError("")
    try {
      const token = window.localStorage.getItem("ziply5_access_token")
      const form = new FormData()
      selected.forEach((file) => form.append("files", file))
      form.append("folder", `products/icon`)
      const res = await fetch("/api/v1/uploads", {
        method: "POST",
        headers: token ? { Authorization: `Bearer ${token}` } : undefined,
        body: form,
      })
      const json = (await res.json()) as {
        success?: boolean
        message?: string
        data?: { files?: Array<{ url: string }> }
      }
      console.log("after upload api response ", json)
      if (!res.ok || json.success === false) {
        setError(json.message ?? "Upload failed")
        return
      }
      const urls = uniq((json.data?.files ?? []).map((f) => f.url))
      if (urls.length === 0) {
        setError("Upload failed")
        return
      }
      setFeatures((prev) =>
        prev.map((item, itemIdx) =>
          itemIdx === idx ? { ...item, icon: urls[0] } : item,
        ),
      )
    } catch {
      setError("Upload failed")
    } finally {
      setUploadingIcon(false)
    }
  }

  const validatePublishable = (product: ProductDetail) => {
    const hasPrice = Number(product.price) > 0
    const hasDiscount = product.discountPercent != null
    const hasWeight = product.type === "simple" ? Boolean(product.weight && parseWeight(product.weight).value) : true; // New validation
    const hasType = Boolean(product.type)
    const tagNames = (product.tags ?? []).map((x) => x.tag.name.toLowerCase())
    // const hasFoodType = product.foodType === "veg" || product.foodType === "non-veg"
    const hasStockStatus = Boolean(product.stockStatus)
    const hasShelfLife = Boolean(product.shelfLife?.trim())
    const hasThumbnail = Boolean(product.thumbnail?.trim())
    const hasDescription = Boolean(product.description?.trim())
    const sectionCount = (product.sections?.filter((s) => Boolean(s.title) && Boolean(s.description)).length ?? 0) || (product.details?.filter((d) => Boolean(d.title) && Boolean(d.content)).length ?? 0)
    const hasSections = sectionCount >= 2
    const hasFeatures = (product.features?.filter((f) => Boolean(f.title)).length ?? 0) > 0

    if (!hasPrice) return "Provide at least one valid price to publish the product."
    if (!hasDiscount) return "Discount percentage is required to publish the product."
    if (!hasWeight) return "Weight is required for simple products to publish." // New error message
    if (!hasType) return "Product type is required to publish the product."
    // if (!hasFoodType) return "Food type (veg/non-veg) is required to publish the product."
    if (!hasStockStatus) return "Stock status is required to publish the product."
    if (!hasShelfLife) return "Shelf life is required to publish the product."
    if (!hasThumbnail) return "Thumbnail image is required to publish the product."
    if (!hasDescription) return "Description is required to publish the product."
    if (!hasSections) return "At least 2 product details/sections are required to publish the product."
    if (!hasFeatures) return "At least one product feature is required to publish the product."
    return null
  }

  const saveRowStatus = async (id: string) => {
    const next = rowStatus[id]
    if (!next) return
    setSaving(true)
    setError("")
    try {
      if (next === "published") {
        const product = await authedFetch<ProductDetail>(`/api/v1/products/${id}`)
        const validationError = validatePublishable(product)
        if (validationError) {
          setError(`${validationError} Update mandatory fields First.`)
          return
        }
      }
      await authedPatch(`/api/v1/products/${id}`, { status: next })
      await loadList()
      alert("Status updated successfully")
    } catch (e) {
      setError(e instanceof Error ? e.message : "Status update failed")
    } finally {
      setSaving(false)
    }
  }

  const toggleRowActive = async (id: string, current: boolean) => {
    setSaving(true)
    setError("")
    try {
      await authedPatch(`/api/v1/products/${id}`, { isActive: !current })
      await loadList()
      alert("Active status toggled successfully")
    } catch (e) {
      setError(e instanceof Error ? e.message : "Active toggle failed")
    } finally {
      setSaving(false)
    }
  }

  if (mode === "list") {
    if (catalog === "combos") {
      const q = searchQuery.trim().toLowerCase()
      const filteredCombos = q ? comboRows.filter((b) => `${b.name} ${b.slug}`.toLowerCase().includes(q)) : comboRows
      return (
        <section className="mx-auto max-w-7xl space-y-4">
          <div className="flex flex-wrap items-end justify-between gap-3">
            <div>
              <h1 className="font-melon text-2xl font-bold text-[#4A1D1F]">Products</h1>
              {/* <p className="text-sm text-[#646464]">
                <span className="font-semibold">Combos</span>{filteredCombos.length} combos.
              </p> */}
            </div>
            <div className="flex gap-2">
              <Link
                href={`${basePath}?catalog=products`}
                className="rounded-full border border-[#E8DCC8] bg-white px-4 py-2 text-xs font-semibold uppercase tracking-wide text-[#4A1D1F] hover:bg-[#FFFBF3]"
              >
                View Products
              </Link>
              <Link
                href="/admin/products/combos/add"
                className="rounded-full bg-[#7B3010] px-4 py-2 text-xs font-semibold uppercase tracking-wide text-white"
              >
                Create combo
              </Link>
              <button
                type="button"
                onClick={() => void loadCombos()}
                className="rounded-full border border-[#E8DCC8] bg-white px-4 py-2 text-xs font-semibold uppercase tracking-wide text-[#4A1D1F] hover:bg-[#FFFBF3]"
              >
                Refresh
              </button>
            </div>
          </div>

          <div className="flex gap-2 w-full">
            <Input
              type="text"
              placeholder="Search combos..."
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
              className="max-w-sm bg-white rounded-lg"
            />
          </div>

          {error && <p className="rounded-lg bg-red-50 px-3 py-2 text-sm text-red-800">{error}</p>}
          {loading && <p className="text-sm text-[#646464]">Loading...</p>}

          {!loading && (
            <ConsoleTable headers={["Combo", "Slug", "Items", "Price", "Mode", "Active", "Actions"]}>
              {filteredCombos.length === 0 ? (
                <tr>
                  <ConsoleTd colSpan={7} className="py-8 text-center text-[#646464]">
                    No combos yet.
                  </ConsoleTd>
                </tr>
              ) : (
                filteredCombos.map((b) => (
                  <tr key={b.id} className="hover:bg-[#FFFBF3]/80">
                    <ConsoleTd className="align-middle">
                      <span className="font-semibold text-[#4A1D1F]">{b.name}</span>
                    </ConsoleTd>
                    <ConsoleTd className="align-middle">
                      <code className="text-[11px]">{b.slug}</code>
                    </ConsoleTd>
                    <ConsoleTd className="align-middle">
                      <span className="text-[12px] font-semibold text-[#2A1810]">{b.items?.length ?? 0}</span>
                    </ConsoleTd>
                    <ConsoleTd className="align-middle font-semibold text-[11px]">
                      {b.pricingMode === "fixed"
                        ? b.comboPrice != null
                          ? `Rs.${Number(b.comboPrice).toFixed(2)}`
                          : "—"
                        : "Dynamic"}
                    </ConsoleTd>
                    <ConsoleTd className="align-middle text-[11px] text-[#646464]">{b.pricingMode ?? "fixed"}</ConsoleTd>
                    <ConsoleTd className="align-middle text-[11px] text-[#646464]">{b.isActive === false ? "No" : "Yes"}</ConsoleTd>
                    <ConsoleTd className="align-middle">
                      <div className="flex items-center gap-2">
                        <button
                          type="button"
                          title="View"
                          aria-label="View combo"
                          onClick={() => setActiveCombo(b)}
                          className="inline-flex h-8 w-8 items-center justify-center rounded-lg border border-[#D9D9D1] text-[#4A1D1F] hover:bg-[#FFFBF3]"
                        >
                          <Eye className="h-4 w-4" />
                        </button>
                        <button
                          type="button"
                          title="Edit (coming soon)"
                          aria-label="Edit combo"
                          disabled
                          className="inline-flex h-8 w-8 items-center justify-center rounded-lg border border-[#D9D9D1] text-[#4A1D1F] opacity-50"
                        >
                          <Pencil className="h-4 w-4" />
                        </button>
                        <button
                          type="button"
                          title="Delete (coming soon)"
                          aria-label="Delete combo"
                          disabled
                          className="inline-flex h-8 w-8 items-center justify-center rounded-lg border border-[#D9D9D1] text-[#C03621] opacity-50"
                        >
                          <Trash2 className="h-4 w-4" />
                        </button>
                      </div>
                    </ConsoleTd>
                  </tr>
                ))
              )}
            </ConsoleTable>
          )}

          {activeCombo ? (
            <div
              className="fixed inset-0 z-[120] flex items-center justify-center bg-black/50 p-4"
              role="dialog"
              aria-modal="true"
              onClick={() => setActiveCombo(null)}
            >
              <div
                className="w-full max-w-xl rounded-2xl border border-[#E8DCC8] bg-white p-5 shadow-xl"
                onClick={(e) => e.stopPropagation()}
              >
                <div className="flex items-start justify-between gap-3">
                  <div>
                    <p className="font-melon text-lg font-bold text-[#4A1D1F]">{activeCombo.name}</p>
                    <p className="mt-0.5 font-mono text-xs text-[#646464]">{activeCombo.slug}</p>
                  </div>
                  <button
                    type="button"
                    onClick={() => setActiveCombo(null)}
                    className="rounded-lg px-3 py-1.5 text-xs font-semibold uppercase tracking-wide text-[#4A1D1F] hover:bg-[#FFFBF3]"
                  >
                    Close
                  </button>
                </div>

                <div className="mt-4 grid gap-3 md:grid-cols-2">
                  <div className="rounded-xl border border-[#E8DCC8] bg-[#FFFBF3] p-3 text-sm">
                    <p className="text-[11px] font-bold uppercase tracking-wide text-[#7A7A7A]">Pricing</p>
                    <p className="mt-1 text-[#2A1810]">
                      {activeCombo.pricingMode === "fixed"
                        ? activeCombo.comboPrice != null
                          ? `Rs.${Number(activeCombo.comboPrice).toFixed(2)}`
                          : "—"
                        : "Dynamic"}
                    </p>
                  </div>
                  <div className="rounded-xl border border-[#E8DCC8] bg-[#FFFBF3] p-3 text-sm">
                    <p className="text-[11px] font-bold uppercase tracking-wide text-[#7A7A7A]">Items</p>
                    <p className="mt-1 text-[#2A1810]">{activeCombo.items?.length ?? 0}</p>
                  </div>
                </div>

                <div className="mt-3 rounded-xl border border-[#E8DCC8] bg-white p-3">
                  <p className="text-[11px] font-bold uppercase tracking-wide text-[#7A7A7A]">Composition</p>
                  <div className="mt-2 space-y-1 text-sm text-[#2A1810]">
                    {(activeCombo.items ?? []).length ? (
                      (activeCombo.items as any[]).slice(0, 12).map((it, idx) => (
                        <div key={idx} className="flex items-center justify-between gap-3">
                          <span className="truncate">{it.product?.name ?? it.productId}</span>
                          <span className="font-mono text-xs text-[#646464]">x{it.quantity}</span>
                        </div>
                      ))
                    ) : (
                      <p className="text-sm text-[#646464]">No items found.</p>
                    )}
                  </div>
                </div>
              </div>
            </div>
          ) : null}
        </section>
      )
    }

    return (
      <section className="mx-auto max-w-7xl space-y-4">
        <div className="flex flex-wrap items-end justify-between gap-3">
          <div>
            <h1 className="font-melon text-2xl font-bold text-[#4A1D1F]">{adminView ? "Products" : "My products"}</h1>
            <p className="text-sm text-[#646464]">
              {filteredRows.length} of {total} items
              {filteredRows.length > 0 ? ` · showing ${listStart}–${listEnd}` : ""}. Published products appear on website.
            </p>
          </div>
          <div className="flex flex-wrap gap-2">
            <Link href={`${basePath}/add`} className="rounded-full bg-[#7B3010] px-4 py-2 text-xs font-semibold uppercase tracking-wide text-white">
              Add Product
            </Link>
            <Link
              href={`${basePath}/bulk-upload`}
              className="rounded-full border border-[#E8DCC8] bg-white px-4 py-2 text-xs font-semibold uppercase tracking-wide text-[#4A1D1F] hover:bg-[#FFFBF3]"
            >
              Bulk Upload
            </Link>
            <Link
              href={`${basePath}/combos`}
              className="rounded-full border border-[#E8DCC8] bg-white px-4 py-2 text-xs font-semibold uppercase tracking-wide text-[#4A1D1F] hover:bg-[#FFFBF3]"
            >
              View Combos
            </Link>
            <button type="button" onClick={() => loadList()} className="rounded-full border border-[#E8DCC8] bg-white px-4 py-2 text-xs font-semibold uppercase tracking-wide text-[#4A1D1F] hover:bg-[#FFFBF3]">
              Refresh
            </button>
          </div>
        </div>
        <div className="flex gap-2 w-full flex-wrap lg:flex-nowrap">
          <div className="flex gap-2 w-full">
            <Input
              type="text"
              placeholder="Search by name or price..."
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
              className="max-w-sm bg-white rounded-lg"
            />
          </div>
          <div className="flex flex-wrap lg:flex-nowrap gap-2 w-full">
            <Select value={filterStatus} onValueChange={(value) => setFilterStatus(value as "all" | "draft" | "published" | "archived")}>
              <SelectTrigger className="w-40 rounded-lg border border-[#D9D9D1] bg-white px-3 py-2 text-sm">
                <SelectValue placeholder="Filter by Status" />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="all">All Status</SelectItem>
                {statuses.map((s) => (
                  <SelectItem key={s} value={s}>
                    {s}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>

            <Select value={filterType} onValueChange={(value) => setFilterType(value as "all" | "simple" | "variant")}>
              <SelectTrigger className="w-40 rounded-lg border border-[#D9D9D1] bg-white px-3 py-2 text-sm">
                <SelectValue placeholder="Product Type" />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="all">All Types</SelectItem>
                <SelectItem value="simple">Simple</SelectItem>
                <SelectItem value="variant">Variant</SelectItem>
              </SelectContent>
            </Select>

            <Select value={filterCategory} onValueChange={(value) => setFilterCategory(value)}>
              <SelectTrigger className="w-40 rounded-lg border border-[#D9D9D1] bg-white px-3 py-2 text-sm">
                <SelectValue placeholder="Filter by Category" />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="all">All Categories</SelectItem>
                {categories.map((c) => (
                  <SelectItem key={c.id} value={c.id}>
                    {c.name}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>

            {/* Prep Type filter hidden: all catalog products are Ready To Cook */}
            {/* <Select value={filterPreparationType} onValueChange={(value) => setFilterPreparationType(value as "all" | "ready_to_eat" | "ready_to_cook")}>
              <SelectTrigger className="w-40 rounded-lg border border-[#D9D9D1] bg-white px-3 py-2 text-sm">
                <SelectValue placeholder="Filter by Prep Type" />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="all">All Prep Types</SelectItem>
                {preparationTypes.map((t) => (
                  <SelectItem key={t} value={t}>
                    {t.replace(/_/g, " ")}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select> */}

            <Select value={filterStockStatus} onValueChange={(value) => setFilterStockStatus(value as "all" | "in_stock" | "out_of_stock")}>
              <SelectTrigger className="w-40 rounded-lg border border-[#D9D9D1] bg-white px-3 py-2 text-sm">
                <SelectValue placeholder="Filter by Stock Status" />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="all">All Stock</SelectItem>
                <SelectItem value="in_stock">In Stock</SelectItem>
                <SelectItem value="out_of_stock">Out of Stock</SelectItem>
              </SelectContent>
            </Select>

            <Select value={sortPrice || undefined} onValueChange={(value) => setSortPrice(value as "low_to_high" | "high_to_low")}>
              <SelectTrigger className="w-40 rounded-lg border border-[#D9D9D1] bg-white px-3 py-2 text-sm">
                <SelectValue placeholder="Price" />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="low_to_high">Low to High</SelectItem>
                <SelectItem value="high_to_low">High to Low</SelectItem>
              </SelectContent>
            </Select>

            {/* <Select value={filterFoodType} onValueChange={(value) => setFilterFoodType(value as "all" | "veg" | "non-veg")}>
            <SelectTrigger className="w-40 rounded-lg border border-[#D9D9D1] bg-white px-3 py-2 text-sm">
              <SelectValue placeholder="Filter by Food Type" />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="all">All Food Types</SelectItem>
              {foodTypes.map((t) => (
                <SelectItem key={t} value={t}>
                  {t}
                </SelectItem>
              ))}
            </SelectContent>
          </Select> */}
          </div>
        </div>
        <div className="flex justify-end">
          <button
            type="button"
            onClick={resetFilters}
            className="text-[11px] font-bold uppercase tracking-wide text-[#7B3010] hover:underline"
          >
            Reset all filters
          </button>
        </div>
        {error && <p className="rounded-lg bg-red-50 px-3 py-2 text-sm text-red-800">{error}</p>}
        {loading && <p className="text-sm text-[#646464]">Loading...</p>}
        {!loading && (
          <>
          <ConsoleTable headers={["S.No", "Product", "SKU", "Stock Available", "Status", "Sale Price", "Created", "Actions"]}>
            {filteredRows.length === 0 ? (
              <tr>
                <ConsoleTd colSpan={8} className="py-8 text-center text-[#646464]">
                  No products yet.
                </ConsoleTd>
              </tr>
            ) : (
              pagedRows.map((p, idx) => (
                <tr key={p.id} className="hover:bg-[#FFFBF3]/80">
                  <ConsoleTd className="align-middle w-14 text-[#646464]">
                    {(currentListPage - 1) * LIST_PAGE_SIZE + idx + 1}
                  </ConsoleTd>
                  <ConsoleTd className="align-middle">
                    <Link href={`${basePath}/${p.id}`} className="text-[#7B3010] font-semibold hover:underline">
                      {p.name}
                    </Link>
                  </ConsoleTd>
                  <ConsoleTd className="align-middle">
                    <code className="text-[11px]">{p.sku}</code>
                  </ConsoleTd>
                  <ConsoleTd className="align-middle">
                    <span className="text-[12px] font-semibold text-[#2A1810]">
                      {p.type === "variant"
                        ? (p.variants ?? []).reduce((sum, v) => sum + Number(v.stock ?? 0), 0)
                        : Number(p.totalStock ?? 0)}
                    </span>
                  </ConsoleTd>
                  <ConsoleTd className="align-middle">
                    <Select value={rowStatus[p.id] ?? p.status} onValueChange={(value) => setRowStatus((prev) => ({ ...prev, [p.id]: value }))}>
                      <SelectTrigger className="rounded-lg border border-[#D9D9D1] bg-white px-2 text-xs w-auto capitalize" size="sm">
                        <SelectValue />
                      </SelectTrigger>
                      <SelectContent>
                        {statuses.map((s) => (
                          <SelectItem key={s} value={s}>
                            {s}
                          </SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                  </ConsoleTd>
                  <ConsoleTd className="align-middle font-semibold text-[11px]">
                    {p.type === "variant"
                      ? p.variants?.map(v => `Rs.${Number(v.price).toFixed(2)}`).join(", ") || "—"
                      : p.price
                        ? `Rs.${Number(p.price).toFixed(2)}`
                        : "—"}
                  </ConsoleTd>
                  <ConsoleTd className="align-middle whitespace-nowrap text-[12px] text-[#646464]">
                    {formatCreatedAt(p.createdAt)}
                  </ConsoleTd>
                  <ConsoleTd className="align-middle">
                    <div className="flex flex-wrap items-center gap-2">
                      <Link
                        href={`${basePath}/${p.id}`}
                        aria-label={`View ${p.name}`}
                        title="View"
                        className="inline-flex h-8 w-8 items-center justify-center rounded-lg border border-[#D9D9D1] text-[#4A1D1F] hover:bg-[#FFFBF3]"
                      >
                        <Eye className="h-4 w-4" />
                      </Link>
                      <Link
                        href={`${basePath}/${p.id}/edit`}
                        aria-label={`Edit ${p.name}`}
                        title="Edit"
                        className="inline-flex h-8 w-8 items-center justify-center rounded-lg border border-[#D9D9D1] text-[#4A1D1F] hover:bg-[#FFFBF3]"
                      >
                        <Pencil className="h-4 w-4" />
                      </Link>
                      <button
                        type="button"
                        onClick={() => saveRowStatus(p.id)}
                        disabled={saving || (rowStatus[p.id] ?? p.status) === p.status}
                        aria-label={`Save ${p.name}`}
                        title="Save"
                        className="inline-flex h-8 w-8 items-center justify-center rounded-lg bg-[#7B3010] text-white disabled:opacity-40"
                      >
                        <Save className="h-4 w-4" />
                      </button>
                    </div>
                  </ConsoleTd>
                </tr>
              ))
            )}
          </ConsoleTable>
          {filteredRows.length > 0 ? (
            <div className="flex items-center justify-between gap-3">
              <button
                type="button"
                onClick={() => setListPage((prev) => Math.max(1, prev - 1))}
                disabled={currentListPage <= 1}
                className="rounded-full border border-[#E8DCC8] bg-white px-3 py-1.5 text-xs font-semibold text-[#4A1D1F] disabled:opacity-40"
              >
                Previous
              </button>
              <p className="text-xs text-[#646464]">
                Page {currentListPage} / {listPageCount}
              </p>
              <button
                type="button"
                onClick={() => setListPage((prev) => Math.min(listPageCount, prev + 1))}
                disabled={currentListPage >= listPageCount}
                className="rounded-full border border-[#E8DCC8] bg-white px-3 py-1.5 text-xs font-semibold text-[#4A1D1F] disabled:opacity-40"
              >
                Next
              </button>
            </div>
          ) : null}
        </>
        )}
      </section>
    )
  }

  return (
    <section className="mx-auto max-w-7xl space-y-4 pb-2">
      <div className="flex flex-col gap-3 md:flex-row md:items-center md:justify-between">
        <div>
          <h1 className="font-melon text-2xl font-bold text-[#4A1D1F]">{mode === "view" ? "View product" : mode === "edit" ? "Edit product" : "Add product"}</h1>
          {mode === "view" ? (
            <p className="text-sm text-[#646464]">Last updated: {formatUpdatedAt(updatedAt)}</p>
          ) : null}
        </div>
        <Link href={basePath} className="text-xs font-semibold uppercase text-[#7B3010] underline">
          Back to list
        </Link>
      </div>
      {mode !== "view" && (
        <p className="text-xs text-[#646464]">Draft/archive saves can be partial. Publishing requires valid name, slug, SKU, food type, price, and at least one section.</p>
      )}

      {mode === "view" && error && <p className="rounded-lg bg-red-50 px-3 py-2 text-sm text-red-800">{error}</p>}
      {loading && (mode === "edit" || mode === "view") && <p className="text-sm text-[#646464]">Loading product...</p>}

      <form onSubmit={onSubmit} className="flex flex-col gap-3 rounded-2xl border border-[#E8DCC8] bg-white p-4 shadow-sm">
        {/* Product info, images and description and seo meta data */}
        {mode === "view" ?
          // product info for view mode
          (
            <div className="space-y-6 w-full md:col-span-3">

              {/* 🔥 TOP SECTION */}
              <div className="grid md:grid-cols-2 gap-6">
                {/* Basic Info */}
                <div className="bg-white rounded-2xl p-4 border border-[#E5E5DC] space-y-3 shadow-sm">
                  <div className="flex justify-between items-center ">
                    <h2 className="text-xl font-bold text-[#4A1D1F]">{name}</h2>

                    {type === "simple" && (
                      <div className="flex items-center gap-3">
                        {simpleProductWeight && <span className="text-sm text-gray-600">Weight: {simpleProductWeight}</span>}
                        <span className="text-lg font-semibold text-green-600">
                          ₹{price}
                        </span>
                        {basePrice && (
                          <span className="line-through text-gray-400">
                            ₹{basePrice}
                          </span>
                        )}
                        {discountPercent && (
                          <span className="text-sm bg-green-100 text-green-700 px-2 py-1 rounded">
                            {discountPercent}% OFF
                          </span>
                        )}
                      </div>
                    )}
                  </div>
                  {type === "simple" && (
                    <div className="text-sm text-gray-600">
                      SKU: {sku}
                    </div>
                  )}

                  <div className="flex gap-2 flex-wrap">
                    <Badge label={foodType} />
                    <Badge label={status} />
                    <Badge label={type} />
                    {preparationType ? <Badge label={preparationType.replace(/_/g, " ")} /> : null}
                    {spiceLevel ? <Badge label={`Spice Level: ${spiceLevel.replace(/_/g, " ")}`} /> : null}
                  </div>

                  <p className="text-sm text-gray-600">
                    Category: {categories.find((c) => c.id === categoryId)?.name || "—"}
                  </p>
                </div>

                {/* 💰 PRICING (Only for Simple) */}
                {type === "simple" && (
                  <Card title="Pricing">
                    <Info label="Sale Price" value={`₹${price}`} />
                    <Info label="MRP" value={basePrice ? `₹${basePrice}` : "—"} />
                    <Info label="Discount" value={discountPercent ? `${discountPercent}%` : "—"} />
                  </Card>
                )}

                <Card title="Inventory">
                  <Info label={type === "variant" ? "Total Stock" : "Stock"} value={totalStock} />
                  <Info label="Stock Status" value={stockStatus} />
                  <Info label="Shelf Life" value={shelfLife ? `${shelfLife} months` : "—"} />
                  <Info label="Last Updated" value={formatUpdatedAt(updatedAt)} />
                </Card>

                {/* 🧾 META */}
                <Card title="SEO & Metadata">
                  <Info label="Slug" value={slug} />
                  <Info label="Meta Title" value={metaTitle} />
                  <Info label="Meta Description" value={metaDescription} />
                </Card>
              </div>

              {/* 📋 VARIANTS SECTION */}
              {type === "variant" && (
                <div className="bg-white rounded-2xl p-4 border border-[#E5E5DC] shadow-sm">
                  <p className="font-semibold mb-3 text-[#4A1D1F]">Product Variants</p>
                  <ConsoleTable headers={["Weight", "SKU", "Sale Price", "MRP", "Discount", "Stock", "Default"]}>
                    {variants.map((v, idx) => (
                      <tr key={`${v.id}-${idx}`} className="hover:bg-[#FFFBF3]/50">
                        <ConsoleTd>{v.weight || v.name}</ConsoleTd>
                        <ConsoleTd><code className="text-[11px]">{v.sku}</code></ConsoleTd>
                        <ConsoleTd className="font-semibold text-green-600">₹{Number(v.price).toFixed(2)}</ConsoleTd>
                        <ConsoleTd className="text-gray-400 line-through">
                          {v.mrp ? `₹${Number(v.mrp).toFixed(2)}` : "—"}
                        </ConsoleTd>
                        <ConsoleTd>
                          {v.discountPercent ? (
                            <span className="text-xs bg-green-100 text-green-700 px-2 py-0.5 rounded">
                              {v.discountPercent}%
                            </span>
                          ) : "—"}
                        </ConsoleTd>
                        <ConsoleTd>{v.stock}</ConsoleTd>
                        <ConsoleTd>
                          {v.isDefault ? (
                            <span className="text-[10px] bg-[#FFC222] text-[#4A1D1F] px-2 py-0.5 rounded-full font-bold uppercase">Default</span>
                          ) : "—"}
                        </ConsoleTd>
                      </tr>
                    ))}
                  </ConsoleTable>
                </div>
              )}

              {/* 📝 DESCRIPTION */}
              <Card title="Description">
                <p className="text-sm text-gray-700 whitespace-pre-line">
                  {description}
                </p>
              </Card>

            </div>
          )
          :
          //  product info for edit and add mode
          (
            <>
            <div className="grid auto-rows-max items-start gap-3 md:grid-cols-3">
              {/* product name */}
              <Field label="Name" required>
                <Input
                  placeholder="Name"
                  value={name}
                  onChange={(e) => {
                    const newName = e.target.value
                    setName(newName)
                    // Automatically generate slug from name only in Add mode
                    if (mode === "add") {
                      const autoSlug = newName
                        .toLowerCase()
                        .replace(/\s+/g, "-") // Replace spaces with hyphens
                        .replace(/[^a-z0-9-_]/g, "") // Remove invalid characters
                        .replace(/[-_]{2,}/g, "-") // Prevent multiple consecutive separators
                        .replace(/^[-_]+|[-_]+$/g, "") // Trim separators from start/end
                      setSlug(autoSlug)
                    }
                  }}
                  required
                  className="rounded-lg border border-[#D9D9D1] px-3 py-2 text-sm"
                />
              </Field>
              {/* Slug for product to search and verify on readable mode */}
              <Field label="Slug" required>
                <Input
                  placeholder="Slug"
                  value={slug}
                  onChange={(e) => {
                    let value = e.target.value

                    // convert to lowercase
                    value = value.toLowerCase()

                    // replace spaces with -
                    value = value.replace(/\s+/g, "-")

                    // allow only a-z, 0-9, - and _
                    value = value.replace(/[^a-z0-9-_]/g, "")

                    // prevent multiple separators together
                    value = value.replace(/[-_]{2,}/g, "-")

                    setSlug(value)
                  }}
                  required
                  pattern="^[a-z0-9]+(?:[-_][a-z0-9]+)*$"
                  title="Only lowercase letters, numbers, hyphens (-), and underscores (_) are allowed. No spaces."
                  className="rounded-lg border border-[#D9D9D1] px-3 py-2 text-sm"
                />

                <p className="mt-1 text-xs text-[#7A7A72]">
                  Use lowercase letters, numbers, hyphens (-), or underscores (_). No spaces allowed.
                </p>
              </Field>
              {/* sku for simple type of product */}
              <Field label="SKU" required>
                {type === "simple" ? (
                  <Input
                    placeholder="SKU"
                    value={sku}
                    onChange={(e) => setSku(e.target.value)}
                    required
                    className="rounded-lg border border-[#D9D9D1] px-3 py-2 text-sm"
                  />
                ) : (
                  <p className="rounded-lg border border-[#D9D9D1] bg-[#FFFBF3] px-3 py-2 text-xs text-[#646464]">
                    Derived from default variant SKU.
                  </p>
                )}
              </Field>
              {/* prdouct price and weight details for simple type */}

              {/* Product status published, draft and archived */}
              <Field label="Status" required>
                <Select value={status} onValueChange={(value) => setStatus(value as (typeof statuses)[number])}>
                  <SelectTrigger className="rounded-lg border border-[#D9D9D1] px-3 py-2 text-sm">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    {statuses.map((s) => (
                      <SelectItem key={s} value={s}>
                        {s}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </Field>
              {status === "draft" ? (
                <p className="text-xs text-yellow-700 bg-yellow-50 rounded-lg border border-yellow-200 px-3 py-2">
                  Draft products are not visible on the website until published.
                </p>
              ) : null}
              {/* Type: single vs multiple variant (payload still uses type=variant) */}
              <Field label="Type" required={status !== "draft"}>
                {mode === "add" || type === "variant" ? (
                  <Select
                    value={variantMode}
                    onValueChange={(value) => {
                      const next = value as "single" | "multiple"
                      setType("variant")
                      setVariantMode(next)
                      if (next === "single") {
                        setVariants((prev) => {
                          const keep = prev.find((v) => v.isDefault) ?? prev[0]
                          return keep
                            ? [{ ...keep, isDefault: true }]
                            : [{ name: "250g", weight: "250g", sku: "", price: "", mrp: "", discountPercent: "", stock: "0", isDefault: true }]
                        })
                      }
                    }}
                  >
                    <SelectTrigger className="rounded-lg border border-[#D9D9D1] px-3 py-2 text-sm" disabled={mode === "edit"}>
                      <SelectValue placeholder="Select type" />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value="single">Single variant</SelectItem>
                      <SelectItem value="multiple">Multiple Variant</SelectItem>
                    </SelectContent>
                  </Select>
                ) : (
                  <Select value={type} onValueChange={(value) => setType(value as "simple" | "variant")}>
                    <SelectTrigger className="rounded-lg border border-[#D9D9D1] px-3 py-2 text-sm" disabled={mode === "edit"}>
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value="variant">variant</SelectItem>
                      <SelectItem value="simple">simple</SelectItem>
                    </SelectContent>
                  </Select>
                )}
              </Field>
              {mode === "edit" ? (
                <p className="text-xs text-[#646464]">Type cannot be changed after product creation.</p>
              ) : null}
              {/* Food Type */}
              {type === "simple" ? (
                <>
                  {/* mrp/baseprice for simple product  */}
                  <Field label="Base Price" required={status !== "draft"}>
                    <Input
                      placeholder="Base Price"
                      type="number"
                      step="0.01"
                      value={basePrice}
                      onChange={(e) => setBasePrice(e.target.value)}
                      className="rounded-lg border border-[#D9D9D1] px-3 py-2 text-sm"
                    />
                  </Field>
                  {/* discount percent for simple product */}
                  <Field label="Discount %" required={status !== "draft"}>
                    <Input
                      placeholder="Discount %"
                      type="number"
                      step="0.01"
                      value={discountPercent}
                      onChange={(e) => setDiscountPercent(e.target.value)}
                      className="rounded-lg border border-[#D9D9D1] px-3 py-2 text-sm"
                    />
                  </Field>
                  {/* sale price for simple product */}
                  <Field label="Sale Price" required={status !== "draft"}>
                    <Input
                      placeholder="Sale Price"
                      type="number"
                      step="0.01"
                      value={price}
                      readOnly
                      className="rounded-lg border border-[#D9D9D1] bg-[#F5F5F5] px-3 py-2 text-sm cursor-not-allowed"
                    />
                  </Field>
                  {/* New Weight field for simple products */}
                  <Field label="Weight" required={status !== "draft"}>
                    <div className="flex gap-2">
                      <Input
                        type="number"
                        placeholder="0"
                        value={parseWeight(simpleProductWeight).value}
                        onChange={(e) => {
                          const { unit } = parseWeight(simpleProductWeight);
                          setSimpleProductWeight(e.target.value + unit);
                        }}
                        className="flex-1 rounded-lg border border-[#D9D9D1] px-3 py-2 text-sm"
                      />
                      <Select
                        value={parseWeight(simpleProductWeight).unit}
                        onValueChange={(unit) => {
                          const { value } = parseWeight(simpleProductWeight);
                          setSimpleProductWeight(value + unit);
                        }}
                      >
                        <SelectTrigger className="w-[120px] rounded-lg border border-[#D9D9D1] px-3 py-2 text-sm">
                          <SelectValue placeholder="Unit" />
                        </SelectTrigger>
                        <SelectContent>
                          <SelectItem value="gm">gm</SelectItem>
                          <SelectItem value="mg">milligrams</SelectItem>
                          <SelectItem value="kg">kilos</SelectItem>
                        </SelectContent>
                      </Select>
                    </div>
                  </Field>
                </>
              ) : null}
              {/* No. of stock for simple  */}
              {type === "simple" ? (
                <Field label="Total Stock">
                  <Input placeholder="Total Stock" type="number" value={totalStock} onChange={(e) => setTotalStock(e.target.value)} className="rounded-lg border border-[#D9D9D1] px-3 py-2 text-sm" />
                </Field>
              ) : (
                <Field label="Total Stock">
                  <p className="rounded-lg border border-[#D9D9D1] bg-[#FFFBF3] px-3 py-2 text-xs text-[#646464]">
                    Automatically calculated from variants.
                  </p>
                </Field>
              )}
              {/* Stock Status  */}
              <Field label="Stock Status" required={status !== "draft"}>
                <Select value={stockStatus} onValueChange={(value) => setStockStatus(value as "in_stock" | "out_of_stock")}>
                  <SelectTrigger className="rounded-lg border border-[#D9D9D1] px-3 py-2 text-sm">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="in_stock">in_stock</SelectItem>
                    <SelectItem value="out_of_stock">out_of_stock</SelectItem>
                  </SelectContent>
                </Select>
              </Field>
              {/* Food Type dropdown removed */}
              {/* Category breakfast, lunch and other */}
              <Field label="Category">
                <Select value={categoryId || "none"} onValueChange={(value) => setCategoryId(value === "none" ? "" : value)}>
                  <SelectTrigger className="rounded-lg border border-[#D9D9D1] px-3 py-2 text-sm">
                    <SelectValue placeholder="No category" />
                  </SelectTrigger>
                  <SelectContent>

                    <SelectItem value="none">
                      {categories.length === 0 ? "No categories" : "None"}
                    </SelectItem>
                    {categories.map((c) => (
                      <SelectItem key={c.id} value={c.id}>
                        {c.name}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </Field>
              {/* <Field label="Tags">
              <div className="space-y-2">
                <select
                  multiple
                  value={selectedTagIds}
                  onChange={(e) => {
                    const values = Array.from(e.target.selectedOptions).map((option) => option.value)
                    setSelectedTagIds(values)
                  }}
                  className="min-h-[112px] w-full rounded-lg border border-[#D9D9D1] px-3 py-2 text-sm"
                >
                  {tags.map((t) => (
                    <option key={t.id} value={t.id}>
                      {t.name}
                    </option>
                  ))}
                </select>
                <div className="flex flex-wrap gap-1">
                  {selectedTagIds.map((selectedId) => {
                    const tag = tags.find((t) => t.id === selectedId)
                    if (!tag) return null
                    return (
                      <span key={tag.id} className="rounded-full border border-[#D9D9D1] bg-white px-2 py-1 text-[10px]">
                        {tag.name}
                      </span>
                    )
                  })}
                </div>
              </div>
            </Field> */}
              <Field label="Tags">
                <div className="relative" ref={tagsDropdownRef}>
                  <button
                    type="button"
                    aria-haspopup="listbox"
                    aria-expanded={tagsDropdownOpen}
                    onClick={() => setTagsDropdownOpen((open) => !open)}
                    className="flex min-h-[44px] w-full cursor-pointer items-center justify-between rounded-lg border border-[#D9D9D1] bg-white px-3 py-2 text-left text-sm text-[#1F1F1F]"
                  >
                    <div className="flex flex-wrap gap-1">
                      {selectedTagIds[0] ? (
                        (() => {
                          const tag = tags.find((t) => t.id === selectedTagIds[0])
                          return tag ? (
                            <span className="rounded-full border border-[#D9D9D1] bg-[#F7F7F5] px-2 py-1 text-[11px]">
                              {tag.name}
                            </span>
                          ) : (
                            <span className="text-[#7A7A72]">Select tags</span>
                          )
                        })()
                      ) : (
                        <span className="text-[#7A7A72]">Select tags</span>
                      )}
                    </div>
                    <svg
                      className={`ml-2 h-4 w-4 shrink-0 transition-transform ${tagsDropdownOpen ? "rotate-180" : ""}`}
                      fill="none"
                      stroke="currentColor"
                      strokeWidth="2"
                      viewBox="0 0 24 24"
                    >
                      <path strokeLinecap="round" strokeLinejoin="round" d="M19 9l-7 7-7-7" />
                    </svg>
                  </button>

                  {tagsDropdownOpen ? (
                    <div className="absolute z-20 mt-2 max-h-64 w-full overflow-y-auto rounded-xl border border-[#D9D9D1] bg-white p-2 shadow-lg">
                      <div className="space-y-1" role="listbox" aria-label="Tags">
                        {tags.map((tag) => {
                          const selected = selectedTagIds[0] === tag.id
                          return (
                            <label
                              key={tag.id}
                              className="flex cursor-pointer items-center gap-3 rounded-lg px-3 py-2 transition hover:bg-[#F7F7F5]"
                            >
                              <input
                                type="radio"
                                name="product-tag"
                                checked={selected}
                                onChange={() => {
                                  setSelectedTagIds([tag.id])
                                  setTagsDropdownOpen(false)
                                }}
                                className="h-4 w-4 border-[#D9D9D1] accent-[#4A1D1F]"
                              />
                              <span className="text-sm text-[#1F1F1F]">{tag.name}</span>
                            </label>
                          )
                        })}
                      </div>
                    </div>
                  ) : null}
                </div>
              </Field>
              {/* shelf life in months */}
              <Field label="Shelf Life" required={status !== "draft"}>
                <Input
                  placeholder="Shelf Life in Months"
                  type="number"
                  value={shelfLife}
                  onChange={(e) => setShelfLife(e.target.value)}
                  className="rounded-lg border border-[#D9D9D1] px-3 py-2 text-sm"
                  title="Shelf life in months"
                />
              </Field>
              {/* Preparation Type dropdown removed */}
              {/* spice level */}
              <Field label="Spice Level" required={status !== "draft"}>
                <Select value={spiceLevel} onValueChange={(value) => setSpiceLevel(value as "" | "mild" | "medium" | "hot" | "extra_hot")}>
                  <SelectTrigger className="rounded-lg border border-[#D9D9D1] px-3 py-2 text-sm">
                    <SelectValue placeholder="Select spice level" />
                  </SelectTrigger>
                  <SelectContent>
                    {spiceLevels.map((item) => (
                      <SelectItem key={item} value={item}>
                        {item.replace(/_/g, " ")}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </Field>
              <div className="md:col-span-3 grid gap-3 md:grid-cols-2">
                <ImageUploadPicker
                  label="Thumbnails"
                  required={status !== "draft"}
                  hint="Shown on product cards and as the main cover. Add one or more; the first image is the cover."
                  emptyTitle="Click or drop thumbnail images"
                  urls={thumbnailUrls}
                  coverBadge
                  uploading={uploadingThumbnails}
                  onPick={(files) => void uploadMany(files, "thumbnail")}
                  onRemove={(url) => setThumbnailUrls((prev) => prev.filter((x) => x !== url))}
                />
                <ImageUploadPicker
                  label="Gallery images"
                  hint="Extra photos on the product page (angles, pack shots, details). Optional."
                  emptyTitle="Click or drop gallery images"
                  urls={imageUrls}
                  uploading={uploadingGallery}
                  onPick={(files) => void uploadMany(files, "image")}
                  onRemove={(url) => setImageUrls((prev) => prev.filter((x) => x !== url))}
                />
              </div>
              <div className="md:col-span-3 space-y-4 rounded-lg border border-[#E8DCC8] bg-[#FFFBF3]/30 p-4">
                <div>
                  <p className="text-xs font-semibold uppercase tracking-wide text-[#4A1D1F]">Page SEO</p>
                  <p className="mt-1 text-xs text-[#646464]">
                    Override how this product appears in search and link previews. Leave blank to fall back to the product name and description.
                  </p>
                </div>
                <div className="grid grid-cols-1 gap-3 md:grid-cols-3">
                  <div className="md:col-span-1">
                    <Field label="Meta title">
                      <Input
                        placeholder="e.g. Jar Honey — Buy online"
                        value={metaTitle}
                        onChange={(e) => setMetaTitle(e.target.value)}
                        className="rounded-lg border border-[#D9D9D1] px-3 py-2 text-sm"
                      />
                    </Field>
                  </div>
                  <div className="md:col-span-2">
                    <Field label="Meta description">
                      <Textarea
                        placeholder="Short compelling summary for SERPs and social cards (~155 characters)."
                        value={metaDescription}
                        onChange={(e) => setMetaDescription(e.target.value)}
                        rows={3}
                        className="rounded-lg border border-[#D9D9D1] px-3 py-2 text-sm"
                      />
                    </Field>
                  </div>
                </div>
              </div>
              <Field label="Amazon Link">
                <Input placeholder="Amazon Link" value={amazonLink} onChange={(e) => setAmazonLink(e.target.value)} className="rounded-lg border border-[#D9D9D1] px-3 py-2 text-sm md:col-span-2" />
              </Field>
            </div>
              {/* for product type as varient then specify the variant */}
              {type === "variant" && (
                <div className="md:col-span-3 space-y-3 rounded-lg border border-[#E8DCC8] p-3">
                  <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
                    <div>
                      <p className="text-xs font-semibold uppercase tracking-wide text-[#4A1D1F]">Variants</p>
                      <p className="mt-1 text-[11px] text-[#646464]">
                        {variantMode === "single"
                          ? "Enter one weight, price, SKU, and stock."
                          : "Add several weights with their own price and stock."}
                      </p>
                    </div>
                    {variantMode === "multiple" ? (
                      <button
                        type="button"
                        onClick={() =>
                          setVariants((prev) => [...prev, { name: "", weight: "", sku: "", price: "", mrp: "", discountPercent: "", stock: "0", isDefault: prev.length === 0 }])
                        }
                        className="shrink-0 rounded-full border border-[#7B3010] px-3 py-1 text-[11px] font-semibold uppercase text-[#7B3010]"
                      >
                        Add Variant
                      </button>
                    ) : null}
                  </div>
                  {(variantMode === "single" ? variants.slice(0, 1) : variants).map((variant, idx) => (
                    <div key={`${variant.id ?? "new"}-${idx}`} className="space-y-4 rounded-lg border border-[#E8DCC8] bg-[#FFFBF3]/20 p-4">
                      <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 md:grid-cols-3 lg:grid-cols-6">
                        <div className="space-y-1.5">
                          <Label className="text-[10px] font-bold uppercase text-[#646464]">Weight</Label>
                          <div className="flex gap-1">
                            <Input
                              type="number"
                              placeholder="0"
                              value={parseWeight(variant.weight).value}
                              onChange={(e) => {
                                const newVal = e.target.value + parseWeight(variant.weight).unit;
                                setVariants((prev) =>
                                  prev.map((x, i) => i === idx ? { ...x, weight: newVal, name: newVal } : x),
                                );
                              }}
                              className="w-full bg-white h-9 rounded border border-[#D9D9D1] px-2 text-sm"
                            />
                            <Select
                              value={parseWeight(variant.weight).unit}
                              onValueChange={(unit) => {
                                const newVal = parseWeight(variant.weight).value + unit;
                                setVariants((prev) =>
                                  prev.map((x, i) => i === idx ? { ...x, weight: newVal, name: newVal } : x),
                                );
                              }}
                            >
                              <SelectTrigger className="w-[80px] rounded border border-[#D9D9D1] bg-white px-2 py-2 text-xs h-9 max-h-[35px]">
                                <SelectValue />
                              </SelectTrigger>
                              <SelectContent>
                                <SelectItem value="gm">gm</SelectItem>
                                <SelectItem value="mg">mg</SelectItem>
                                <SelectItem value="kg">kg</SelectItem>
                              </SelectContent>
                            </Select>
                          </div>
                        </div>

                        <div className="space-y-1.5">
                          <Label className="text-[10px] font-bold uppercase text-[#646464]">Sale Price</Label>
                          <Input
                            placeholder="Sale Price"
                            type="number"
                            value={variant.price}
                            readOnly
                            className="bg-[#F5F5F5] h-9 cursor-not-allowed"
                          />
                        </div>

                        <div className="space-y-1.5">
                          <Label className="text-[10px] font-bold uppercase text-[#646464]">Base Price</Label>
                          <Input
                            placeholder="Base Price"
                            type="number"
                            value={variant.mrp}
                            onChange={(e) => {
                              const val = e.target.value
                              const base = parseFloat(val) || 0
                              const disc = parseFloat(variant.discountPercent) || 0
                              const sale = base - (base * disc) / 100
                              const res = sale > 0 ? sale.toFixed(2) : (base > 0 ? base.toFixed(2) : "")
                              setVariants((prev) => prev.map((x, i) => i === idx ? { ...x, mrp: val, price: res } : x))
                            }}
                            className="bg-white h-9"
                          />
                        </div>

                        <div className="space-y-1.5">
                          <Label className="text-[10px] font-bold uppercase text-[#646464]">Discount %</Label>
                          <Input
                            placeholder="%"
                            type="number"
                            value={variant.discountPercent}
                            onChange={(e) => {
                              const val = e.target.value
                              const base = parseFloat(variant.mrp) || 0
                              const disc = parseFloat(val) || 0
                              const sale = base - (base * disc) / 100
                              const res = sale > 0 ? sale.toFixed(2) : (base > 0 ? base.toFixed(2) : "")
                              setVariants((prev) => prev.map((x, i) => i === idx ? { ...x, discountPercent: val, price: res } : x))
                            }}
                            className="bg-white h-9"
                          />
                        </div>

                        <div className="space-y-1.5">
                          <Label className="text-[10px] font-bold uppercase text-[#646464]">Stock</Label>
                          <Input
                            placeholder="Stock"
                            type="number"
                            value={variant.stock}
                            onChange={(e) => setVariants((prev) => prev.map((x, i) => i === idx ? { ...x, stock: e.target.value } : x))}
                            className="bg-white h-9"
                          />
                        </div>

                        <div className="space-y-1.5">
                          <Label className="text-[10px] font-bold uppercase text-[#646464]">SKU</Label>
                          <Input
                            placeholder="SKU"
                            value={variant.sku}
                            onChange={(e) => setVariants((prev) => prev.map((x, i) => i === idx ? { ...x, sku: e.target.value } : x))}
                            className="bg-white h-9"
                          />
                        </div>
                      </div>

                      <div className="flex items-center justify-between pt-2 border-t border-[#E8DCC8]/50">
                        {variantMode === "multiple" ? (
                          <label className="flex items-center gap-2 text-[11px] font-semibold uppercase text-[#4A1D1F] cursor-pointer">
                            <Checkbox
                              checked={variant.isDefault}
                              onCheckedChange={() => setVariants((prev) => prev.map((x, i) => ({ ...x, isDefault: i === idx })))}
                            />
                            Default Variant
                          </label>
                        ) : (
                          <p className="text-[11px] font-semibold uppercase text-[#646464]">This is the product variant</p>
                        )}
                        {variantMode === "multiple" && variants.length > 1 ? (
                          <button
                            type="button"
                            onClick={() => setVariants((prev) => prev.filter((_, i) => i !== idx))}
                            className="rounded-full border border-red-200 px-3 py-1 text-[10px] font-semibold uppercase text-red-700 hover:bg-red-50 transition-colors"
                          >
                            Remove
                          </button>
                        ) : (
                          <span />
                        )}
                      </div>
                    </div>
                  ))}
                </div>
              )}
              <Field label="Description" required={status !== "draft"}>
                <Textarea placeholder="Description" value={description} onChange={(e) => setDescription(e.target.value)} rows={2} className="rounded-lg border border-[#D9D9D1] px-3 py-2 text-sm md:col-span-3" />
              </Field>
              <Field label="Pricing & Discounts">
                <div className="space-y-3 rounded-lg border border-[#E8DCC8] bg-[#FFFBF3] p-3">
                  {/* <p className="text-[11px] font-semibold uppercase tracking-wide text-[#646464]">Pricing</p> */}
                  {/* <div className="grid gap-2 md:grid-cols-4">
                  <Input
                    placeholder="Base Price"
                    type="number"
                    step="0.01"
                    value={basePrice}
                    onChange={(e) => setBasePrice(e.target.value)}
                    className="rounded-lg border border-[#D9D9D1] bg-white px-3 py-2 text-sm"
                  />
                  <Input
                    placeholder="MRP"
                    type="number"
                    step="0.01"
                    value={basePrice}
                    onChange={(e) => setBasePrice(e.target.value)}
                    className="rounded-lg border border-[#D9D9D1] bg-white px-3 py-2 text-sm"
                  />
                  <Input
                    placeholder="Selling Price"
                    type="number"
                    step="0.01"
                    value={price}
                    onChange={(e) => setPrice(e.target.value)}
                    className="rounded-lg border border-[#D9D9D1] bg-white px-3 py-2 text-sm"
                  />
                  <Input
                    placeholder="Cost Price"
                    type="number"
                    step="0.01"
                    value={costPrice}
                    onChange={(e) => setCostPrice(e.target.value)}
                    className="rounded-lg border border-[#D9D9D1] bg-white px-3 py-2 text-sm"
                  />
                </div> */}

                  <div className="grid gap-2 md:grid-cols-2">
                    <label className="flex items-center gap-2 text-xs font-semibold uppercase text-[#4A1D1F]">
                      <Checkbox checked={discountEnabled} onCheckedChange={(checked) => setDiscountEnabled(Boolean(checked))} />
                      Enable discount
                    </label>
                    <label className="flex items-center gap-2 text-xs font-semibold uppercase text-[#4A1D1F]">
                      <Checkbox checked={discountStackable} onCheckedChange={(checked) => setDiscountStackable(Boolean(checked))} />
                      Stackable with offers
                    </label>
                  </div>

                  {discountEnabled && (
                    <div className="grid gap-2 md:grid-cols-4">
                      <Select value={discountType} onValueChange={(value) => setDiscountType(value as "percentage" | "flat")}>
                        <SelectTrigger className="rounded-lg border border-[#D9D9D1] bg-white px-3 py-2 text-sm">
                          <SelectValue />
                        </SelectTrigger>
                        <SelectContent>
                          <SelectItem value="percentage">Percentage</SelectItem>
                          <SelectItem value="flat">Flat Amount</SelectItem>
                        </SelectContent>
                      </Select>
                      <Input
                        placeholder="Discount Value"
                        type="number"
                        step="0.01"
                        value={discountValue}
                        onChange={(e) => setDiscountValue(e.target.value)}
                        className="rounded-lg border border-[#D9D9D1] bg-white px-3 py-2 text-sm"
                      />
                      <Input
                        type="datetime-local"
                        value={discountStartDate}
                        onChange={(e) => setDiscountStartDate(e.target.value)}
                        className="rounded-lg border border-[#D9D9D1] bg-white px-3 py-2 text-sm"
                      />
                      <Input
                        type="datetime-local"
                        value={discountEndDate}
                        onChange={(e) => setDiscountEndDate(e.target.value)}
                        className="rounded-lg border border-[#D9D9D1] bg-white px-3 py-2 text-sm"
                      />
                    </div>
                  )}

                  <div className="grid gap-2 md:grid-cols-2">
                    <label className="flex items-center gap-2 text-xs font-semibold uppercase text-[#4A1D1F]">
                      <Checkbox checked={autoExpireDiscount} onCheckedChange={(checked) => setAutoExpireDiscount(Boolean(checked))} />
                      Auto-expire after date
                    </label>
                    <label className="flex items-center gap-2 text-xs font-semibold uppercase text-[#4A1D1F]">
                      <Checkbox checked={showStrikeThroughPrice} onCheckedChange={(checked) => setShowStrikeThroughPrice(Boolean(checked))} />
                      Show strike-through price on storefront
                    </label>
                  </div>
                  <p className="text-[11px] text-[#646464]">
                    Variant-level discount is supported via each variant row&apos;s discount %. Product-level discount is used as fallback.
                  </p>
                </div>
              </Field>
            </>
          )}
        {/* Product Specifications and Details */}
        <div className="md:col-span-3 space-y-3 shadow-sm rounded-xl border border-[#E8DCC8] p-3">
          <div className="flex items-center justify-between">
            <p className="text-xs font-semibold uppercase tracking-wide text-[#4A1D1F]">Product Details</p>
            {mode !== "view" ? (
              <button
                type="button"
                onClick={() =>
                  setSections((prev) =>
                    prev.length >= MAX_SECTIONS
                      ? prev
                      : [...prev, { title: "", description: "<p></p>", sortOrder: prev.length, isActive: true }],
                  )
                }
                className="rounded-full border border-[#7B3010] px-3 py-1 text-[11px] font-semibold uppercase text-[#7B3010]"
              >
                Add Section
              </button>
            ) : null}
          </div>
          {mode === "view" ? (
            <Accordion type="single" collapsible className="space-y-2">
              {orderedSections.map((section, idx) => (
                <AccordionItem
                  key={`${section.id ?? "new"}-${idx}`}
                  value={`section-${section.id ?? idx}`}
                  className={section.isActive ? "rounded-lg border opacity-70 border-[#D9D9D1] bg-[#FFFBF3]" : "rounded-lg border border-[#D9D9D1] bg-[#FFFBF3] opacity-60"}
                >
                  <AccordionTrigger className="px-3 py-4">
                    <div className="flex items-center justify-between gap-4 w-full">
                      <div>
                        <p className="font-semibold text-sm text-[#2A1810]">
                          {idx + 1}. {section.title || "Untitled section"}
                        </p>
                        {/* <p className="text-[11px] text-[#646464]">Order {section.sortOrder}</p> */}
                      </div>
                      {/* <span className={`rounded-full px-2 py-1 text-[11px] font-semibold uppercase ${section.isActive ? "bg-green-100 text-green-700" : "bg-gray-100 text-gray-600"}`}>
                        {section.isActive ? "Active" : "Inactive"}
                      </span> */}
                    </div>
                  </AccordionTrigger>
                  <AccordionContent className={section.isActive ? "px-3" : "px-3 opacity-60"}>
                    <div className="rounded-lg border border-[#D9D9D1] bg-white px-3 py-2 text-sm" dangerouslySetInnerHTML={{ __html: section.description }} />
                  </AccordionContent>
                </AccordionItem>
              ))}
            </Accordion>
          ) : (
            sections.map((section, idx) => (
              <div key={`${section.id ?? "new"}-${idx}`} className="bg-white shadow-sm space-y-2 rounded-lg border border-[#D9D9D1] bg-[#FFFBF3] p-3">
                <div className="grid gap-2 md:grid-cols-3">
                  <div className="md:col-span-2">
                    <Label className="text-xs font-semibold text-[#4A1D1F]">Section Title</Label>
                    <Input
                      placeholder="Section title"
                      value={section.title}
                      onChange={(e) =>
                        setSections((prev) =>
                          prev.map((item, itemIdx) =>
                            itemIdx === idx ? { ...item, title: e.target.value } : item,
                          ),
                        )
                      }
                      className="rounded-lg border border-[#D9D9D1] bg-white px-3 py-2 text-sm"
                    />
                  </div>
                  <div className="space-y-2">
                    <Label className="text-xs font-semibold text-[#4A1D1F]">Sort Order</Label>
                    <div className="flex items-center gap-2">
                      <Input
                        placeholder="Order"
                        type="number"
                        value={section.sortOrder}
                        onChange={(e) =>
                          setSections((prev) =>
                            prev.map((item, itemIdx) =>
                              itemIdx === idx ? { ...item, sortOrder: Number(e.target.value || 0) } : item,
                            ),
                          )
                        }
                        className="w-20 rounded-lg border border-[#D9D9D1] bg-white px-2 py-2 text-sm"
                      />
                      <label className="flex items-center gap-1 text-[11px] font-semibold uppercase">
                        <Checkbox
                          checked={section.isActive}
                          onCheckedChange={(checked) =>
                            setSections((prev) =>
                              prev.map((item, itemIdx) =>
                                itemIdx === idx ? { ...item, isActive: !!checked } : item,
                              ),
                            )
                          }
                        />
                        active
                      </label>
                      <button
                        type="button"
                        onClick={() =>
                          setSections((prev) =>
                            prev.length === 1 ? prev : prev.filter((_, itemIdx) => itemIdx !== idx),
                          )
                        }
                        className="rounded-full border border-red-300 px-2 py-1 text-[10px] font-semibold uppercase text-red-700"
                      >
                        Remove
                      </button>
                    </div>
                  </div>
                </div>
                <div>
                  <Label className="text-xs font-semibold text-[#4A1D1F]">Description</Label>
                  <RichTextEditor
                    value={section.description}
                    onChange={(html) =>
                      setSections((prev) =>
                        prev.map((item, itemIdx) =>
                          itemIdx === idx ? { ...item, description: html } : item,
                        ),
                      )
                    }
                  />
                </div>
              </div>
            ))
          )}
          <p className="text-[11px] text-[#646464]">
            {status === "draft"
              ? `Draft products can save partial details. At least 2 sections are required to publish.`
              : `Up to ${MAX_SECTIONS} sections. Title and description are required.`}
          </p>
        </div>
        {/* Product Features */}
        <div className="md:col-span-3 space-y-3 shadow-sm rounded-xl border border-[#E8DCC8] p-3">
          <div className="flex items-center justify-between">
            <p className="text-xs font-semibold uppercase tracking-wide text-[#4A1D1F]">Product Features</p>
            {mode !== "view" ? (
              <button
                type="button"
                onClick={() => setFeatures((prev) => [...prev, { title: "", icon: null }])}
                className="rounded-full border border-[#7B3010] px-2 py-1 text-[10px] font-semibold uppercase text-[#7B3010]"
              >
                Add Feature
              </button>
            ) : null}
          </div>
          {features.map((feature, idx) => (
            <div key={idx} className="space-y-2">
              <div className="grid gap-2 md:grid-cols-2">
                <div>
                  <Label className="text-xs font-semibold text-[#4A1D1F]">Feature Title</Label>
                  <input
                    type="text"
                    placeholder="Feature title"
                    value={feature.title}
                    onChange={(e) =>
                      setFeatures((prev) =>
                        prev.map((item, itemIdx) =>
                          itemIdx === idx ? { ...item, title: e.target.value } : item,
                        ),
                      )
                    }
                    className="w-full rounded-lg border border-[#D9D9D1] bg-white px-2 py-2 text-sm"
                  />
                </div>
                <div>
                  <Label className="text-xs font-semibold text-[#4A1D1F]">Icon (optional)</Label>
                  <input type="file" accept="image/*" onChange={(e) => void uploadIcon(e.target.files, idx)} className="w-full rounded-lg border border-[#D9D9D1] bg-white px-2 py-2 text-sm" />
                  {feature.icon && (
                    <div className="mt-2 flex items-center gap-2">
                      <img src={feature.icon} alt="Icon preview" className="w-8 h-8 object-cover rounded" />
                      <button type="button" onClick={(e) => setFeatures((prev) => prev.map((item, itemIdx) => itemIdx === idx ? { ...item, icon: null } : item))} className="text-xs text-red-500 hover:text-red-700">Remove</button>
                    </div>
                  )}
                </div>
              </div>
              <button
                type="button"
                onClick={() =>
                  setFeatures((prev) =>
                    prev.length === 1 ? prev : prev.filter((_, itemIdx) => itemIdx !== idx),
                  )
                }
                className="rounded-full border border-red-300 px-2 py-1 text-[10px] font-semibold uppercase text-red-700"
              >
                Remove
              </button>
            </div>
          ))}
        </div>
        {/* Badge Fields */}
        <div className="md:col-span-3 flex flex-wrap gap-4 text-xs uppercase">
          {mode !== "view" ?
            (
              <>
                <label className="flex items-center gap-2">
                  <Checkbox checked={taxIncluded} onCheckedChange={(checked) => setTaxIncluded(!!checked)} /> tax included
                </label>
                <label className="flex items-center gap-2">
                  <Checkbox checked={isActive} onCheckedChange={(checked) => setIsActive(!!checked)} /> active
                </label>
                {isActive ? null : (
                  <p className="w-full text-xs text-yellow-700 bg-yellow-50 rounded-lg border border-yellow-200 px-3 py-2">
                    Inactive products are not visible on the website until activated.
                  </p>
                )}
                <label className="flex items-center gap-2">
                  <Checkbox checked={allowReturn} onCheckedChange={(checked) => setAllowReturn(!!checked)} /> allow return
                </label>
              </>
            ) : (
              <div className="flex gap-2 w-full">
                <ViewField label="Tax Included" value={taxIncluded ? "Yes" : "No"} />
                <ViewField label="Active" value={isActive ? "Yes" : "No"} />
              </div>
            )}
        </div>
        {/* Images */}
        {mode === "view" && (
          <div className="bg-white md:col-span-3 rounded-2xl p-4 border border-[#E5E5DC] shadow-sm w-full justify-center flex flex-col text-start items-center">
            <div className="w-full"> <p className="font-semibold mb-3 text-[#4A1D1F]">Product Images</p></div>

            <div className="flex flex-wrap gap-4">
              {[...thumbnailUrls, ...imageUrls].map((url, idx) => (
                <img
                  key={idx}
                  src={url}
                  className="h-40 w-auto object-cover rounded-lg border"
                />
              ))}
            </div>
          </div>
        )}
        {/* Save or update button */}
        {mode !== "view" && (
          <div className="md:col-span-3">
            <Button type="submit" disabled={saving || uploadingThumbnails || uploadingGallery || uploadingIcon} className="rounded-full bg-[#7B3010] px-5 py-2.5 text-xs font-semibold uppercase tracking-wide text-white disabled:opacity-50">
              {saving ? "Saving..." : mode === "edit" ? "Update product" : "Create product"}
            </Button>
          </div>
        )}
      </form>
    </section>
  )
}
