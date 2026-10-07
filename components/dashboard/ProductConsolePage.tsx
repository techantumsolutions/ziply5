"use client"

import Link from "next/link"
import { useCallback, useEffect, useMemo, useRef, useState } from "react"
import { useRouter } from "next/navigation"
import { authedFetch, authedPatch, authedPost } from "@/lib/dashboard-fetch"
import { ConsoleTable, ConsoleTd } from "@/components/dashboard/ConsoleTable"
import { RichTextEditor } from "@/components/dashboard/RichTextEditor"
import { ProductFormStepper, type ProductFormStepId } from "@/components/dashboard/ProductFormStepper"
import { Button } from "@/components/ui/button"
import { Checkbox } from "@/components/ui/checkbox"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select"
import { Textarea } from "@/components/ui/textarea"
import { Accordion, AccordionContent, AccordionItem, AccordionTrigger } from "@/components/ui/accordion"
import {
  AlertTriangle,
  Check,
  ChevronLeft,
  ChevronRight,
  ExternalLink,
  Loader2,
  Percent,
  Eye,
  Image as ImageIcon,
  ImagePlus,
  Info as InfoIcon,
  Leaf,
  Package,
  Pencil,
  Play,
  Rocket,
  Save,
  Search,
  Tag,
  Trash2,
  X,
} from "lucide-react"
import { toast } from "@/lib/toast"
import { useMasterValues } from "@/hooks/useMasterData"
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip"
import { isVideoUrl } from "@/lib/media-utils"
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from "@/components/ui/dialog"

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
  tags?: Array<{ tag: { name: string; id: string; slug?: string | null } }>
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
    hsnCode?: string | null
    eanCode?: string | null
    hsn_code?: string | null
    ean_code?: string | null
    updatedAt?: string | Date | null
    priceUpdatedAt?: string | Date | null
  }>
  images?: Array<{ url: string }>
  details?: Array<{ title: string; content: string; sortOrder?: number }>
  sections?: Array<{ id: string; title: string; description: string; sortOrder: number; isActive: boolean }>
  features?: Array<{ title: string; icon?: string | null; featureDefinitionId?: string | null }>
  createdById?: string | null
  createdAt?: string | Date | null
  updatedAt?: string | Date | null
  priceUpdatedAt?: string | Date | null
}

type CategoryRow = { id: string; name: string }
type Tags = { id: string; name: string; slug?: string | null; isActive?: boolean }
const statuses = ["draft", "published", "archived"] as const
const foodTypes = ["veg", "non-veg"] as const

const FOOD_TYPE_TAG_KEYS: Record<"veg" | "non-veg", string[]> = {
  veg: ["veg", "vegetarian"],
  "non-veg": ["non-veg", "non veg", "nonveg", "non-vegetarian", "non vegetarian"],
}
const FOOD_TYPE_TAG_DEFAULTS: Record<"veg" | "non-veg", { name: string; slug: string }> = {
  veg: { name: "Veg", slug: "veg" },
  "non-veg": { name: "Non-Veg", slug: "non-veg" },
}
const foodTypeOfTag = (tag: { name?: string | null; slug?: string | null }): "veg" | "non-veg" | null => {
  const keys = [tag.name, tag.slug].map((x) => String(x ?? "").trim().toLowerCase()).filter(Boolean)
  if (keys.some((k) => FOOD_TYPE_TAG_KEYS["non-veg"].includes(k))) return "non-veg"
  if (keys.some((k) => FOOD_TYPE_TAG_KEYS.veg.includes(k))) return "veg"
  return null
}
const preparationTypes = ["ready_to_eat", "ready_to_cook"] as const
const spiceLevels = ["mild", "medium", "hot", "extra_hot"] as const
const fallbackWeightOptions = ["250g", "500g", "1kg"] as const
const MAX_SECTIONS = 10
const MAX_PRODUCT_FEATURES = 5
const MAX_IMAGE_BYTES = 1 * 1024 * 1024
const MAX_VIDEO_BYTES = 10 * 1024 * 1024
const DESCRIPTION_MAX_CHARS = 250
const LIST_PAGE_SIZE = 10
const ADD_PENDING_ID_KEY = "ziply5:product-add-pending-id"
const ADD_DRAFT_ID_KEY = "ziply5:product-add-draft-id"
const productStepStorageKey = (id: string) => `ziply5:product-form-step:${id}`
const uniq = (list: string[]) => [...new Set(list.map((x) => x.trim()).filter(Boolean))]
const formatFileSizeMb = (bytes: number) => `${(bytes / (1024 * 1024)).toFixed(0)} MB`
const readStepFromLocation = (): ProductFormStepId => {
  if (typeof window === "undefined") return 1
  const fromUrl = Number(new URLSearchParams(window.location.search).get("step"))
  if (fromUrl >= 1 && fromUrl <= 5) return fromUrl as ProductFormStepId
  return 1
}
const createFallbackId = () => `pending-${Date.now().toString(36)}-${Math.random().toString(16).slice(2)}`

const resolveOrCreatePendingProductId = () => {
  if (typeof window === "undefined") {
    return typeof crypto !== "undefined" && typeof crypto.randomUUID === "function"
      ? crypto.randomUUID()
      : createFallbackId()
  }
  const existing = window.sessionStorage.getItem(ADD_PENDING_ID_KEY)?.trim()
  if (existing) return existing
  const created =
    typeof crypto !== "undefined" && typeof crypto.randomUUID === "function"
      ? crypto.randomUUID()
      : createFallbackId()
  window.sessionStorage.setItem(ADD_PENDING_ID_KEY, created)
  return created
}
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

const stripHtmlText = (html: string) =>
  html.replace(/<[^>]*>/g, " ").replace(/&nbsp;/gi, " ").replace(/\s+/g, " ").trim()

const isEmptyRichText = (html: string) => !stripHtmlText(html)

/** Hide number spinners; shared by add/edit product numeric fields only. */
const NUMBER_INPUT_CLASS =
  "[appearance:textfield] [&::-webkit-outer-spin-button]:appearance-none [&::-webkit-inner-spin-button]:appearance-none"

const sanitizeNonNegativeInput = (raw: string) => {
  let next = raw.replace(/[^\d.]/g, "")
  const parts = next.split(".")
  if (parts.length > 2) next = `${parts[0]}.${parts.slice(1).join("")}`
  return next
}

const blockNumberFieldKeys = (e: React.KeyboardEvent<HTMLInputElement>) => {
  if (
    e.key === "ArrowUp" ||
    e.key === "ArrowDown" ||
    e.key === "-" ||
    e.key === "+" ||
    e.key === "e" ||
    e.key === "E"
  ) {
    e.preventDefault()
  }
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

/** Sale price for a variant: MRP minus its discount % only while product discount is enabled. */
const withSingleDefault = <T extends { isDefault: boolean }>(list: T[]): T[] => {
  if (list.length === 0) return list
  const defaultIdx = Math.max(0, list.findIndex((v) => v.isDefault))
  return list.map((v, i) => (v.isDefault === (i === defaultIdx) ? v : { ...v, isDefault: i === defaultIdx }))
}

const variantSalePrice = (
  v: { mrp: string; discountPercent: string; price: string },
  discountEnabled: boolean,
) => {
  const mrp = parseFloat(v.mrp) || 0
  if (mrp <= 0) return parseFloat(v.price) || 0
  const disc = discountEnabled ? Math.min(Math.max(parseFloat(v.discountPercent) || 0, 0), 100) : 0
  return Number((mrp - (mrp * disc) / 100).toFixed(2))
}

const ReviewRow = ({ label, children }: { label: string; children: React.ReactNode }) => (
  <div className="grid grid-cols-[140px_12px_1fr] items-start gap-1 py-1 text-sm">
    <span className="text-[#646464]">{label}</span>
    <span className="text-[#8A8A82]">:</span>
    <div className="min-w-0 break-words font-medium text-[#2A1810]">{children}</div>
  </div>
)

const ReviewMissing = () => <span className="font-normal italic text-[#B44444]">Not provided</span>

const ReviewSectionHeader = ({
  icon,
  title,
  subtitle,
  missing,
  onEdit,
  readOnly = false,
}: {
  icon: React.ReactNode
  title: string
  subtitle: string
  missing: string[]
  onEdit: () => void
  readOnly?: boolean
}) => (
  <div className="mb-3 flex items-start justify-between gap-3">
    <div className="flex items-start gap-2.5">
      <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-lg bg-[#7B3010]/10 text-[#7B3010]">{icon}</span>
      <div>
        <div className="flex flex-wrap items-center gap-2">
          <p className="text-sm font-semibold text-[#4A1D1F]">{title}</p>
          {missing.length ? (
            <span
              title={`Missing: ${missing.join(", ")}`}
              className="rounded-full border border-[#F0C7C7] bg-[#FFF5F5] px-2 py-0.5 text-[10px] font-semibold text-[#B44444]"
            >
              {missing.length} missing
            </span>
          ) : readOnly ? null : (
            <span className="inline-flex items-center gap-1 rounded-full border border-green-200 bg-green-50 px-2 py-0.5 text-[10px] font-semibold text-green-700">
              <Check className="h-3 w-3" />
              Complete
            </span>
          )}
        </div>
        <p className="mt-0.5 text-[11px] text-[#646464]">{subtitle}</p>
      </div>
    </div>
    {readOnly ? null : (
      <button
        type="button"
        onClick={onEdit}
        className="inline-flex shrink-0 items-center gap-1 rounded-lg border border-[#E8DCC8] bg-[#FFF7EA] px-3 py-1.5 text-[11px] font-semibold text-[#7B3010] hover:bg-[#FFEFD6]"
      >
        <Pencil className="h-3 w-3" />
        Edit
      </button>
    )}
  </div>
)

const Field = ({
  label,
  required,
  info,
  children,
}: {
  label: string
  required?: boolean
  info?: string
  children: React.ReactNode
}) => (
  <div className="space-y-2">
    <Label className="inline-flex items-center gap-1.5 text-xs font-semibold uppercase text-[#4A1D1F]">
      <span>
        {label}
        {required ? <span className="ml-1 text-red-500">*</span> : null}
      </span>
      {info ? (
        <Tooltip>
          <TooltipTrigger asChild>
            <button
              type="button"
              className="inline-flex shrink-0 text-[#7B3010] hover:text-[#4A1D1F]"
              aria-label={`About ${label}`}
            >
              <InfoIcon className="h-3.5 w-3.5" />
            </button>
          </TooltipTrigger>
          <TooltipContent side="top" className="max-w-xs text-left normal-case tracking-normal">
            {info}
          </TooltipContent>
        </Tooltip>
      ) : null}
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
  onSetCover,
  resolutionHint,
  maxSizeLabel = "Max 1 MB each",
  allowVideo = false,
  videoMaxSizeLabel,
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
  onSetCover?: (url: string) => void
  resolutionHint?: string
  maxSizeLabel?: string
  allowVideo?: boolean
  videoMaxSizeLabel?: string
}) => {
  const inputRef = useRef<HTMLInputElement>(null)
  const [dragOver, setDragOver] = useState(false)

  const takeFiles = (files: FileList | null) => {
    onPick(files)
    if (inputRef.current) inputRef.current.value = ""
  }

  return (
    <div className="flex h-full flex-col space-y-2">
      <Label className="inline-flex items-center gap-1.5 text-xs font-semibold uppercase text-[#4A1D1F]">
        <span>
          {label}
          {required ? <span className="ml-1 text-red-500">*</span> : null}
        </span>
        <Tooltip>
          <TooltipTrigger asChild>
            <button
              type="button"
              className="inline-flex shrink-0 text-[#7B3010] hover:text-[#4A1D1F]"
              aria-label={`About ${label}`}
            >
              <InfoIcon className="h-3.5 w-3.5" />
            </button>
          </TooltipTrigger>
          <TooltipContent side="top" className="max-w-xs space-y-1 text-left normal-case tracking-normal">
            <p>{hint}</p>
            {resolutionHint ? <p>Recommended image size: {resolutionHint}</p> : null}
            <p>Images: {maxSizeLabel}</p>
            {allowVideo ? <p>Videos (MP4, WEBM, MOV): {videoMaxSizeLabel ?? "Max 10 MB each"}</p> : null}
          </TooltipContent>
        </Tooltip>
      </Label>
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
        className={`flex flex-1 flex-col rounded-xl border border-dashed p-3 transition-colors ${
          dragOver ? "border-[#7B3010] bg-[#FFF6EC]" : "border-[#D9D9D1] bg-[#FFFBF3]/40"
        }`}
      >
        <input
          ref={inputRef}
          type="file"
          multiple
          accept={
            allowVideo
              ? "image/png,image/jpeg,image/webp,video/mp4,video/webm,video/quicktime"
              : "image/png,image/jpeg,image/webp"
          }
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
          <span className="text-[11px] text-[#646464]">
            {allowVideo
              ? `Images ${maxSizeLabel} · Videos ${videoMaxSizeLabel ?? "Max 10 MB each"}`
              : `PNG, JPG, or WEBP · ${maxSizeLabel}`}
          </span>
        </button>
        {urls.length > 0 ? (
          <div className="mt-3 grid grid-cols-3 gap-2 sm:grid-cols-4">
            {urls.map((url, idx) => {
              const isCover = coverBadge && idx === 0
              const canSetCover = Boolean(coverBadge && onSetCover && idx !== 0)
              const isVideo = isVideoUrl(url)
              return (
                <div
                  key={`${url}-${idx}`}
                  className={`group relative overflow-hidden rounded-lg border bg-white ${
                    isCover ? "border-[#7B3010] ring-1 ring-[#7B3010]/40" : "border-[#E8DCC8]"
                  }`}
                >
                  <button
                    type="button"
                    disabled={!canSetCover}
                    onClick={() => {
                      if (canSetCover) onSetCover?.(url)
                    }}
                    title={canSetCover ? "Set as cover image" : isCover ? "Current cover image" : undefined}
                    className={`relative block w-full ${canSetCover ? "cursor-pointer" : "cursor-default"}`}
                  >
                    {isVideo ? (
                      <>
                        <video src={url} muted preload="metadata" className="h-20 w-full object-cover bg-black" />
                        <span className="pointer-events-none absolute inset-0 flex items-center justify-center bg-black/35">
                          <span className="inline-flex h-8 w-8 items-center justify-center rounded-full bg-white/95 text-[#4A1D1F] shadow">
                            <Play className="h-4 w-4 fill-current" />
                          </span>
                        </span>
                      </>
                    ) : (
                      <img src={url} alt="" className="h-20 w-full object-cover" />
                    )}
                    {canSetCover ? (
                      <span className="pointer-events-none absolute inset-0 flex items-center justify-center bg-black/0 text-[10px] font-semibold uppercase tracking-wide text-white opacity-0 transition group-hover:bg-black/45 group-hover:opacity-100">
                        Set as cover
                      </span>
                    ) : null}
                  </button>
                  {isCover ? (
                    <span className="absolute left-1 top-1 rounded bg-[#7B3010] px-1.5 py-0.5 text-[9px] font-semibold uppercase tracking-wide text-white">
                      Cover
                    </span>
                  ) : null}
                  {isVideo ? (
                    <span className="absolute left-1 bottom-1 rounded bg-black/75 px-1.5 py-0.5 text-[9px] font-semibold uppercase tracking-wide text-white">
                      Video
                    </span>
                  ) : null}
                  <button
                    type="button"
                    aria-label="Remove media"
                    onClick={(e) => {
                      e.stopPropagation()
                      onRemove(url)
                    }}
                    className="absolute right-1 top-1 inline-flex h-6 w-6 items-center justify-center rounded-full bg-white/95 text-[#4A1D1F] shadow-sm hover:bg-white"
                  >
                    <X className="h-3.5 w-3.5" />
                  </button>
                </div>
              )
            })}
          </div>
        ) : null}
        {urls.length > 0 ? (
          <p className="mt-2 text-[11px] text-[#646464]">
            {urls.length} file{urls.length === 1 ? "" : "s"} added
            {coverBadge
              ? ". First image is the cover by default — click another image to make it cover."
              : "."}
          </p>
        ) : null}
      </div>
    </div>
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
  const [productLoaded, setProductLoaded] = useState(false)
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
  const [featureCatalog, setFeatureCatalog] = useState<Array<{ id: string; title: string; icon: string | null; isActive: boolean }>>([])
  const [selectedFeatureDefinitionIds, setSelectedFeatureDefinitionIds] = useState<string[]>([])
  const [currentStep, setCurrentStep] = useState<ProductFormStepId>(() => readStepFromLocation())
  const [reviewConfirmed, setReviewConfirmed] = useState(false)
  const [mediaViewerIndex, setMediaViewerIndex] = useState<number | null>(null)
  const [pendingProductId] = useState(() => resolveOrCreatePendingProductId())
  const [editHydrated, setEditHydrated] = useState(mode !== "edit")
  const currentStepRef = useRef<ProductFormStepId>(currentStep)
  const draftProductIdRef = useRef<string | null>(mode === "edit" && productId ? productId : null)
  const skipAutosaveRef = useRef(false)
  const autosaveLockRef = useRef<Promise<void> | null>(null)
  const lastAutosavedHashRef = useRef("")
  const draftSkuSeedRef = useRef(`DRAFT-${Date.now().toString(36).toUpperCase()}`)
  const [autosavedDraftId, setAutosavedDraftId] = useState<string | null>(mode === "edit" && productId ? productId : null)
  const [draftSaveStatus, setDraftSaveStatus] = useState<"idle" | "saving" | "saved">(mode === "edit" ? "saved" : "idle")
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
  const [variants, setVariants] = useState<Array<{ id?: string; name: string; weight: string; sku: string; price: string; mrp: string; discountPercent: string; stock: string; isDefault: boolean; hsnCode: string; eanCode: string; updatedAt?: string | Date | null; priceUpdatedAt?: string | Date | null }>>([
    { name: "250g", weight: "250g", sku: "", price: "", mrp: "", discountPercent: "", stock: "0", isDefault: true, hsnCode: "", eanCode: "" },
  ])
  const [variantMode, setVariantMode] = useState<"single" | "multiple">("single")
  const [updatedAt, setUpdatedAt] = useState<string | Date | null>(null)
  const [createdAt, setCreatedAt] = useState<string | Date | null>(null)
  const [priceUpdatedAt, setPriceUpdatedAt] = useState<string | Date | null>(null)
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
    { title: "", description: "<p></p>", sortOrder: 0, isActive: true },
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
  const [filterType, setFilterType] = useState<"all" | "single" | "multiple">("all")
  const [sortPrice, setSortPrice] = useState<"" | "low_to_high" | "high_to_low">("")
  const [listPage, setListPage] = useState(1)
  const [openDetailSections, setOpenDetailSections] = useState<string[]>([])
  const productWeightMasterQuery = useMasterValues("PRODUCT_WEIGHT")
  const weightOptions = fallbackWeightOptions

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
      result = result.filter((p) => {
        const isMulti = (p.variants?.length ?? 0) > 1
        return filterType === "multiple" ? isMulti : !isMulti
      })
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

  const goToEditStep = (step: ProductFormStepId) => {
    if (mode === "view") {
      if (productId) router.push(`${basePath}/${productId}/edit?step=${step}`)
      return
    }
    setCurrentStep(step)
  }

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
        setTags(tags.filter((t) => t.isActive !== false || foodTypeOfTag(t)))
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
      const [p, cats, discountRows, tagsRows, featureDefs] = await Promise.all([
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
        authedFetch<Array<{ id: string; title: string; icon: string | null; isActive: boolean }>>("/api/v1/feature-definitions?activeOnly=false").catch(() => []),
      ])
      const v = p.variants?.find((item) => item.isDefault) ?? p.variants?.[0]
      setCategories(cats.filter((c) => Boolean(c.id)))
      setTags(tagsRows.filter((t) => t.isActive !== false || foodTypeOfTag(t)))
      setFeatureCatalog(featureDefs.filter((f) => f.isActive !== false))
      setName(p.name)
      setSlug(p.slug)
      setSku(p.sku)
      setDescription(p.description ?? "")
      setStatus(p.status)
      setType(mode === "view" ? (p.type ?? "variant") : "variant")
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
      setCreatedAt(p.createdAt ?? (p as { created_at?: string | Date | null }).created_at ?? null)
      setPriceUpdatedAt(p.priceUpdatedAt ?? (p as { price_updated_at?: string | Date | null }).price_updated_at ?? null)
      setFeatures(p.features ?? [])
      {
        const byId = new Set(
          (p.features ?? [])
            .map((f) => f.featureDefinitionId)
            .filter((id): id is string => Boolean(id)),
        )
        if (byId.size === 0 && featureDefs.length) {
          const titleMap = new Map(featureDefs.map((f) => [f.title.trim().toLowerCase(), f.id]))
          for (const f of p.features ?? []) {
            const matched = titleMap.get(String(f.title ?? "").trim().toLowerCase())
            if (matched) byId.add(matched)
          }
        }
        setSelectedFeatureDefinitionIds([...byId].slice(0, MAX_PRODUCT_FEATURES))
      }
      setCategoryId(p.categories?.[0]?.categoryId ?? "")
      const productTags = (p.tags ?? []).map((x) => x.tag).filter(Boolean)
      setSelectedTagIds(
        productTags.filter((t) => !foodTypeOfTag(t)).map((t) => t.id).filter(Boolean).slice(0, 1),
      )
      const loadedFoodType =
        (p.foodType === "veg" || p.foodType === "non-veg" ? p.foodType : null) ??
        productTags.map((t) => foodTypeOfTag(t)).find(Boolean) ??
        ""
      setFoodType(loadedFoodType)
      setImageUrls(uniq((p.images ?? []).map((img) => img.url)))
      const loadedVariants = p.variants ?? []
      setVariants(
        loadedVariants.length
          ? withSingleDefault(loadedVariants.map((item, idx) => ({
            id: item.id,
            name: item.weight ?? item.name ?? `Variant ${idx + 1}`,
            weight: item.weight ?? item.name ?? "",
            sku: item.sku ?? "",
            price: String(Number(item.price ?? 0)),
            mrp: item.mrp != null ? String(Number(item.mrp)) : "",
            discountPercent: item.discountPercent != null ? String(Number(item.discountPercent)) : "",
            stock: String(item.stock ?? 0),
            isDefault: Boolean(item.isDefault),
            hsnCode: String(item.hsnCode ?? item.hsn_code ?? ""),
            eanCode: String(item.eanCode ?? item.ean_code ?? ""),
            updatedAt: item.updatedAt ?? (item as { updated_at?: string | Date | null }).updated_at ?? null,
            priceUpdatedAt: item.priceUpdatedAt ?? (item as { price_updated_at?: string | Date | null }).price_updated_at ?? null,
          })))
          : [{
            name: p.weight || "250g",
            weight: p.weight || "250g",
            sku: p.sku?.startsWith("DRAFT-") ? "" : (p.sku ?? ""),
            price: Number(p.price) > 0 ? String(Number(p.price)) : "",
            mrp: p.basePrice != null && Number(p.basePrice) > 0 ? String(Number(p.basePrice)) : "",
            discountPercent: p.discountPercent != null ? String(Number(p.discountPercent)) : "",
            stock: String(p.totalStock ?? 0),
            isDefault: true,
            hsnCode: "",
            eanCode: "",
          }],
      )
      // Reflect original weight option on edit: multi when 2+ variants, otherwise single.
      setVariantMode(
        (p.type === "variant" || loadedVariants.length > 0) && loadedVariants.length > 1
          ? "multiple"
          : "single",
      )
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
          : [{ title: "", description: "<p></p>", sortOrder: 0, isActive: true }],
      )
      const existingDiscount = discountRows?.[0]
      if (existingDiscount) {
        setDiscountRecordId(existingDiscount.id)
        setDiscountEnabled(!existingDiscount.end_date || new Date(existingDiscount.end_date).getTime() > Date.now())
        setDiscountType(existingDiscount.discount_type)
        setDiscountValue(String(Number(existingDiscount.discount_value)))
        setDiscountStartDate(existingDiscount.start_date ? new Date(existingDiscount.start_date).toISOString().slice(0, 16) : "")
        setDiscountEndDate(
          existingDiscount.end_date && new Date(existingDiscount.end_date).getTime() > Date.now()
            ? new Date(existingDiscount.end_date).toISOString().slice(0, 16)
            : "",
        )
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
      setProductLoaded(true)
    } catch (e) {
      setError(e instanceof Error ? e.message : "Could not load product")
    } finally {
      setLoading(false)
      if (productId) {
        draftProductIdRef.current = productId
      }
      // Allow autosave after the form is hydrated from the server.
      window.setTimeout(() => {
        skipAutosaveRef.current = false
        setEditHydrated(true)
        setDraftSaveStatus("saved")
      }, 0)
    }
  }, [productId, mode])

  useEffect(() => {
    if (mode === "edit") {
      setEditHydrated(false)
      skipAutosaveRef.current = true
    }
  }, [mode, productId])

  useEffect(() => {
    if (mode === "list" || (mode === "add" && catalog === "combos")) {
      if (catalog === "combos") {
        void loadCombos()
      } else {
        loadList()
      }
    }
    if (mode === "add" && catalog !== "combos") {
      Promise.all([
        authedFetch<CategoryRow[]>("/api/v1/categories").catch(() => []),
        authedFetch<Tags[]>("/api/v1/tags").catch(() => []),
      ]).then(([cats, tagRows]) => {
        setCategories(cats.filter((c) => Boolean(c.id)))
        setTags(tagRows.filter((t) => t.isActive !== false || foodTypeOfTag(t)))
      })
    }
    if (mode === "edit" || mode === "view") void loadEdit()
    if (mode === "add") {
      setReviewConfirmed(false)
      const existingDraftId = window.sessionStorage.getItem(ADD_DRAFT_ID_KEY)?.trim()
      if (existingDraftId) {
        const step = readStepFromLocation()
        const storedStep = Number(window.sessionStorage.getItem(productStepStorageKey(existingDraftId)) || "")
        const nextStep = step !== 1 ? step : storedStep >= 1 && storedStep <= 5 ? storedStep : 1
        skipAutosaveRef.current = true
        router.replace(`/admin/products/${existingDraftId}/edit?step=${nextStep}`)
        return
      }
      void authedFetch<Array<{ id: string; title: string; icon: string | null; isActive: boolean }>>(
        "/api/v1/feature-definitions?activeOnly=true",
      )
        .then((rows) => setFeatureCatalog(rows.filter((f) => f.isActive !== false)))
        .catch(() => setFeatureCatalog([]))
    }
  }, [catalog, loadCombos, loadEdit, loadList, mode, router])

  // Keep wizard step in the URL + sessionStorage so refresh stays on the same step.
  useEffect(() => {
    if (mode !== "add" && mode !== "edit") return
    currentStepRef.current = currentStep
    const params = new URLSearchParams(window.location.search)
    if (params.get("step") !== String(currentStep)) {
      params.set("step", String(currentStep))
      const nextUrl = `${window.location.pathname}?${params.toString()}`
      window.history.replaceState(window.history.state, "", nextUrl)
    }
    const persistId = productId ?? (mode === "add" ? pendingProductId : null)
    if (persistId) {
      window.sessionStorage.setItem(productStepStorageKey(persistId), String(currentStep))
    }
  }, [currentStep, mode, pendingProductId, productId])

  useEffect(() => {
    if (mode !== "add" && mode !== "edit") return
    const fromUrl = readStepFromLocation()
    if (fromUrl !== currentStepRef.current) {
      setCurrentStep(fromUrl)
      return
    }
    const persistId = productId ?? (mode === "add" ? pendingProductId : null)
    if (!persistId) return
    const stored = Number(window.sessionStorage.getItem(productStepStorageKey(persistId)) || "")
    if (stored >= 1 && stored <= 5 && stored !== currentStepRef.current && !window.location.search.includes("step=")) {
      setCurrentStep(stored as ProductFormStepId)
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [mode, pendingProductId, productId])

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
    const normalizedVariants = withSingleDefault(sourceVariants
      .map((v, idx) => ({
        id: v.id,
        name: (v.weight || v.name || `Variant ${idx + 1}`).trim(),
        weight: (v.weight || v.name || "").trim(),
        sku: v.sku.trim(),
        price: variantSalePrice(v, discountEnabled),
        mrp: toNumOrNull(v.mrp),
        discountPercent: toNumOrNull(v.discountPercent),
        stock: Math.max(0, Number(v.stock || 0)),
        isDefault: Boolean(v.isDefault),
        hsnCode: v.hsnCode.trim() || null,
        eanCode: v.eanCode.trim() || null,
      }))
      .filter((v) => v.name && v.sku))
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
      ...(mode === "add" ? { id: pendingProductId } : {}),
      name: name.trim(),
      slug: slug.trim(),
      sku: derivedSku,
      description: isEmptyRichText(description) ? undefined : description.trim(),
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
      tagIds: (() => {
        const foodTagIds = new Set(tags.filter((t) => foodTypeOfTag(t)).map((t) => t.id))
        const others = selectedTagIds.filter((id) => !foodTagIds.has(id))
        const foodTag = foodType ? tags.find((t) => foodTypeOfTag(t) === foodType) : undefined
        return foodTag ? [...others, foodTag.id] : others
      })(),
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
      featureDefinitionIds: selectedFeatureDefinitionIds,
      features: selectedFeatureDefinitionIds
        .map((id) => {
          const def = featureCatalog.find((f) => f.id === id)
          if (!def) return null
          return { featureDefinitionId: def.id, title: def.title, icon: def.icon }
        })
        .filter(Boolean) as Array<{ featureDefinitionId: string; title: string; icon: string | null }>,
    }
  }, [
    basePrice,
    discountEnabled,
    categoryId,
    selectedTagIds,
    tags,
    foodType,
    description,
    discountPercent,
    imageUrls,
    isActive,
    allowReturn,
    metaDescription,
    metaTitle,
    mode,
    pendingProductId,
    simpleProductWeight, // Add to dependencies
    selectedFeatureDefinitionIds,
    featureCatalog,
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

  const payloadRef = useRef(payload)
  const variantsRef = useRef(variants)
  const variantModeRef = useRef(variantMode)
  const discountEnabledRef = useRef(discountEnabled)
  discountEnabledRef.current = discountEnabled
  const displayProductId = mode === "edit" && productId ? productId : autosavedDraftId ?? pendingProductId

  const foodTagCreateAttemptedRef = useRef<Set<string>>(new Set())
  useEffect(() => {
    if (mode === "view" || mode === "list" || !foodType) return
    if (tags.some((t) => foodTypeOfTag(t) === foodType)) return
    if (foodTagCreateAttemptedRef.current.has(foodType)) return
    foodTagCreateAttemptedRef.current.add(foodType)
    const def = FOOD_TYPE_TAG_DEFAULTS[foodType]
    authedPost<Tags>("/api/v1/tags", def)
      .then((created) => {
        if (created?.id) setTags((prev) => [...prev, { ...def, ...created }])
      })
      .catch(() =>
        authedFetch<Tags[]>("/api/v1/tags")
          .then((rows) => setTags(rows.filter((t) => t.isActive !== false || foodTypeOfTag(t))))
          .catch(() => null),
      )
  }, [foodType, mode, tags])

  const reviewMissing = useMemo(() => {
    const step1: string[] = []
    if (!name.trim()) step1.push("Product name")
    if (!slug.trim()) step1.push("Product slug")
    if (!categoryId) step1.push("Category")
    if (!foodType) step1.push("Food type")
    if (!spiceLevel) step1.push("Spice level")
    if (!shelfLife.trim()) step1.push("Shelf life")

    const step2: string[] = []
    if (!thumbnailUrls.some(Boolean)) step2.push("Thumbnail image")
    if (isEmptyRichText(description)) step2.push("Description")
    if (selectedFeatureDefinitionIds.length === 0) step2.push("Product features")

    const step3: string[] = []
    const reviewVariants = variantMode === "single" ? variants.slice(0, 1) : variants
    reviewVariants.forEach((v, idx) => {
      const gaps: string[] = []
      if (!parseWeight(v.weight).value) gaps.push("weight")
      if (!(Number(v.mrp) > 0)) gaps.push("MRP")
      if (!(variantSalePrice(v, discountEnabled) > 0)) gaps.push("sale price")
      if (!v.sku.trim()) gaps.push("SKU")
      if (gaps.length) step3.push(`Variant ${idx + 1}: ${gaps.join(", ")}`)
    })
    const step4: string[] = []
    if (!metaTitle.trim()) step4.push("Meta title")
    if (!metaDescription.trim()) step4.push("Meta description")

    return { 1: step1, 2: step2, 3: step3, 4: step4 } as Record<1 | 2 | 3 | 4, string[]>
  }, [
    name, slug, categoryId, foodType, spiceLevel, shelfLife, thumbnailUrls, description,
    selectedFeatureDefinitionIds, variantMode, variants, discountEnabled, metaTitle, metaDescription,
  ])
  const reviewMissingCount = Object.values(reviewMissing).reduce((n, list) => n + list.length, 0)

  useEffect(() => {
    payloadRef.current = payload
  }, [payload])
  useEffect(() => {
    variantsRef.current = variants
  }, [variants])
  useEffect(() => {
    variantModeRef.current = variantMode
  }, [variantMode])

  const makeSlug = (value: string) =>
    value
      .toLowerCase()
      .replace(/\s+/g, "-")
      .replace(/[^a-z0-9-_]/g, "")
      .replace(/[-_]{2,}/g, "-")
      .replace(/^[-_]+|[-_]+$/g, "")

  const hasDraftWorthyContent = useCallback(() => {
    const p = payloadRef.current
    if (p.name.length >= 2) return true
    if (p.slug.length >= 2) return true
    if (p.sku.length >= 2) return true
    if (p.description && !isEmptyRichText(p.description)) return true
    if (p.thumbnail || (p.images?.length ?? 0) > 0) return true
    if (p.categoryId) return true
    if ((p.featureDefinitionIds?.length ?? 0) > 0) return true
    if ((p.sections?.length ?? 0) > 0) return true
    if (p.metaTitle || p.metaDescription) return true
    if (p.amazonLink) return true
    if (p.shelfLife) return true
    if (p.basePrice != null || (p.salePrice != null && p.salePrice > 0) || p.price > 0) return true
    const source = variantModeRef.current === "single" ? variantsRef.current.slice(0, 1) : variantsRef.current
    return source.some(
      (v) =>
        Boolean(v.sku.trim()) ||
        Boolean(v.price.trim()) ||
        Boolean(v.mrp.trim()) ||
        Boolean(v.hsnCode.trim()) ||
        Boolean(v.eanCode.trim()) ||
        (Boolean(v.weight.trim()) && v.weight.trim() !== "250g"),
    )
  }, [])

  const buildSoftDraftPayload = useCallback(() => {
    const base = { ...payloadRef.current, status: "draft" as const }
    const draftName = base.name || "Untitled draft"
    const draftSlug =
      base.slug ||
      makeSlug(draftName) ||
      `draft-${draftSkuSeedRef.current.toLowerCase()}`
    const tempSku = draftSkuSeedRef.current

    const source = variantModeRef.current === "single" ? variantsRef.current.slice(0, 1) : variantsRef.current
    let softVariants = source
      .map((v, idx) => {
        const weight = (v.weight || v.name || "").trim()
        const touched =
          Boolean(v.sku.trim()) ||
          Boolean(v.price.trim()) ||
          Boolean(v.mrp.trim()) ||
          Boolean(v.hsnCode.trim()) ||
          Boolean(v.eanCode.trim()) ||
          (Boolean(weight) && weight !== "250g")
        if (!touched) return null
        const name = weight || `Variant ${idx + 1}`
        const sku =
          v.sku.trim() ||
          `${draftSlug}-${makeSlug(name) || idx + 1}`.toUpperCase().slice(0, 40) ||
          `${tempSku}-${idx + 1}`
        return {
          id: v.id,
          name,
          weight: weight || null,
          sku,
          price: Math.max(0.01, variantSalePrice(v, discountEnabledRef.current)),
          mrp: toNumOrNull(v.mrp),
          discountPercent: toNumOrNull(v.discountPercent),
          stock: Math.max(0, Number(v.stock || 0)),
          isDefault: Boolean(v.isDefault),
          hsnCode: v.hsnCode.trim() || null,
          eanCode: v.eanCode.trim() || null,
        }
      })
      .filter(Boolean) as Array<{
      id?: string
      name: string
      weight: string | null
      sku: string
      price: number
      mrp: number | null
      discountPercent: number | null
      stock: number
      isDefault: boolean
      hsnCode: string | null
      eanCode: string | null
    }>

    softVariants = withSingleDefault(softVariants)

    let type: "simple" | "variant" = base.type
    let variants = softVariants
    let sku = base.sku
    let price = base.price

    if (type === "variant") {
      if (variants.length === 0) {
        type = "simple"
        sku = sku || tempSku
        price = Math.max(0, price)
      } else {
        const def = variants.find((v) => v.isDefault) ?? variants[0]
        sku = sku || def.sku
        price = Math.max(0.01, Number(def.price || 0))
      }
    } else {
      sku = sku || tempSku
      price = Math.max(0, price)
      variants = []
    }

    return {
      ...base,
      name: draftName,
      slug: draftSlug.length >= 2 ? draftSlug : `draft-${draftSkuSeedRef.current.toLowerCase()}`,
      sku: sku.length >= 2 ? sku : tempSku,
      type,
      variants,
      price,
      status: "draft" as const,
    }
  }, [])

  // Autosave only while creating a product (including its draft continued on /edit after the first autosave);
  // editing an existing product saves only when the admin clicks Save Draft / Publish.
  const [autosaveEnabled, setAutosaveEnabled] = useState(mode === "add")
  useEffect(() => {
    if (mode === "add") {
      setAutosaveEnabled(true)
      return
    }
    if (mode === "edit" && productId) {
      setAutosaveEnabled(window.sessionStorage.getItem(ADD_DRAFT_ID_KEY)?.trim() === productId)
      return
    }
    setAutosaveEnabled(false)
  }, [mode, productId])

  const flushAutosaveDraft = useCallback(
    async (opts?: { keepalive?: boolean; navigateToEdit?: boolean }) => {
      if (!autosaveEnabled) return
      if (mode === "edit" && !editHydrated) return
      if (skipAutosaveRef.current) return
      if (!hasDraftWorthyContent()) return

      const body = buildSoftDraftPayload()
      // Autosave always stores draft status as requested.
      const hash = JSON.stringify(body)
      const existingId =
        mode === "edit" && productId
          ? productId
          : draftProductIdRef.current

      if (hash === lastAutosavedHashRef.current && existingId) {
        setDraftSaveStatus("saved")
        return
      }

      const run = async () => {
        if (!opts?.keepalive) setDraftSaveStatus("saving")
        if (opts?.keepalive) {
          const token = typeof window !== "undefined" ? window.localStorage.getItem("ziply5_access_token") : null
          const url = existingId ? `/api/v1/products/${existingId}` : "/api/v1/products"
          try {
            const res = await fetch(url, {
              method: existingId ? "PATCH" : "POST",
              headers: {
                "Content-Type": "application/json",
                ...(token ? { Authorization: `Bearer ${token}` } : {}),
              },
              body: JSON.stringify(body),
              keepalive: true,
            })
            if (!existingId && res.ok) {
              try {
                const json = (await res.json()) as { data?: { id?: string } }
                if (json.data?.id) {
                  draftProductIdRef.current = json.data.id
                  setAutosavedDraftId(json.data.id)
                }
              } catch {
                // Keepalive responses may be unavailable during unload.
              }
            }
            lastAutosavedHashRef.current = hash
            setDraftSaveStatus("saved")
          } catch {
            // Best-effort on unload / tab hide.
          }
          return
        }

        try {
          if (existingId) {
            await authedPatch(`/api/v1/products/${existingId}`, body)
            draftProductIdRef.current = existingId
            setAutosavedDraftId(existingId)
            lastAutosavedHashRef.current = hash
            setDraftSaveStatus("saved")
          } else {
            const created = await authedPost<ProductDetail>("/api/v1/products", body)
            draftProductIdRef.current = created.id
            setAutosavedDraftId(created.id)
            lastAutosavedHashRef.current = hash
            setDraftSaveStatus("saved")
            window.sessionStorage.removeItem(ADD_PENDING_ID_KEY)
            window.sessionStorage.setItem(ADD_DRAFT_ID_KEY, created.id)
            window.sessionStorage.setItem(
              productStepStorageKey(created.id),
              String(currentStepRef.current),
            )
            if (opts?.navigateToEdit !== false && mode === "add") {
              skipAutosaveRef.current = true
              router.replace(`/admin/products/${created.id}/edit?step=${currentStepRef.current}`)
            }
          }
        } catch {
          setDraftSaveStatus("idle")
          // Silent autosave — manual Save Draft still surfaces errors.
        }
      }

      if (autosaveLockRef.current) {
        try {
          await autosaveLockRef.current
        } catch {
          // continue
        }
        if (hash === lastAutosavedHashRef.current && (draftProductIdRef.current || existingId)) {
          setDraftSaveStatus("saved")
          return
        }
      }

      const pending = run().finally(() => {
        if (autosaveLockRef.current === pending) autosaveLockRef.current = null
      })
      autosaveLockRef.current = pending
      await pending
    },
    [autosaveEnabled, buildSoftDraftPayload, editHydrated, hasDraftWorthyContent, mode, productId, router],
  )

  // When form changes after a save, mark draft as not yet saved again.
  useEffect(() => {
    if (mode !== "add" && mode !== "edit") return
    if (mode === "edit" && !editHydrated) return
    if (draftSaveStatus !== "saved") return
    if (!hasDraftWorthyContent()) return
    const hash = JSON.stringify(buildSoftDraftPayload())
    if (hash !== lastAutosavedHashRef.current) {
      setDraftSaveStatus("idle")
    }
  }, [buildSoftDraftPayload, draftSaveStatus, editHydrated, hasDraftWorthyContent, mode, payload])

  // After edit hydration, baseline the autosave hash so we don't PATCH immediately.
  useEffect(() => {
    if (mode !== "edit" || !editHydrated || loading) return
    lastAutosavedHashRef.current = JSON.stringify(buildSoftDraftPayload())
    setDraftSaveStatus("saved")
  }, [buildSoftDraftPayload, editHydrated, loading, mode])

  // Debounced autosave while filling fields on every step.
  useEffect(() => {
    if (!autosaveEnabled) return
    if (mode === "edit" && !editHydrated) return
    if (skipAutosaveRef.current) return
    if (!hasDraftWorthyContent()) return
    const timer = window.setTimeout(() => {
      void flushAutosaveDraft()
    }, 1200)
    return () => window.clearTimeout(timer)
  }, [autosaveEnabled, editHydrated, flushAutosaveDraft, hasDraftWorthyContent, mode, payload])

  // Flush instantly when leaving the page / switching tabs / closing.
  useEffect(() => {
    if (!autosaveEnabled) return
    if (mode === "edit" && !editHydrated) return

    const onHidden = () => {
      if (document.visibilityState === "hidden") {
        void flushAutosaveDraft({ keepalive: true, navigateToEdit: false })
      }
    }
    const onLeave = () => {
      void flushAutosaveDraft({ keepalive: true, navigateToEdit: false })
    }

    document.addEventListener("visibilitychange", onHidden)
    window.addEventListener("pagehide", onLeave)
    window.addEventListener("beforeunload", onLeave)
    return () => {
      document.removeEventListener("visibilitychange", onHidden)
      window.removeEventListener("pagehide", onLeave)
      window.removeEventListener("beforeunload", onLeave)
      if (!skipAutosaveRef.current) {
        void flushAutosaveDraft({ keepalive: true, navigateToEdit: false })
      }
    }
  }, [autosaveEnabled, editHydrated, flushAutosaveDraft, mode])

  // Intercept in-app link navigation away from product form.
  useEffect(() => {
    if (!autosaveEnabled) return

    const onClickCapture = (event: MouseEvent) => {
      if (event.defaultPrevented) return
      if (event.button !== 0) return
      if (event.metaKey || event.ctrlKey || event.shiftKey || event.altKey) return
      const target = event.target as Element | null
      const anchor = target?.closest?.("a[href]") as HTMLAnchorElement | null
      if (!anchor) return
      const href = anchor.getAttribute("href")
      if (!href || href.startsWith("#") || href.startsWith("mailto:") || href.startsWith("tel:")) return
      let url: URL
      try {
        url = new URL(href, window.location.origin)
      } catch {
        return
      }
      if (url.origin !== window.location.origin) return
      if (url.pathname === window.location.pathname) return
      if (!hasDraftWorthyContent()) return

      event.preventDefault()
      event.stopPropagation()
      void (async () => {
        await flushAutosaveDraft({ navigateToEdit: false })
        skipAutosaveRef.current = true
        router.push(`${url.pathname}${url.search}${url.hash}`)
      })()
    }

    document.addEventListener("click", onClickCapture, true)
    return () => document.removeEventListener("click", onClickCapture, true)
  }, [autosaveEnabled, flushAutosaveDraft, hasDraftWorthyContent, mode, router])

  const onSubmit = async (e: React.FormEvent, statusOverride?: (typeof statuses)[number]) => {
    e.preventDefault()
    const effectiveStatus = statusOverride ?? status
    const submitPayload = { ...payload, status: effectiveStatus }
    const isDraft = effectiveStatus === "draft"

    if (!submitPayload.name || !submitPayload.slug || !submitPayload.sku) {
      setError("Name, slug and SKU are required")
      return
    }
    if (submitPayload.type === "variant") {
      if (!submitPayload.variants.length) {
        setError("At least 1 variant is required for variant products")
        return
      }
      if (submitPayload.variants.filter((v) => v.isDefault).length !== 1) {
        setError("Exactly one default variant is required")
        return
      }
      const skuSet = new Set<string>()
      for (const variant of submitPayload.variants) {
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
      if (submitPayload.type === "simple" && !submitPayload.price && !submitPayload.basePrice) {
        setError("Price is required")
        return
      }
      if (effectiveStatus === "published") {
        if (submitPayload.price <= 0) {
          setError("Sale Price must be greater than 0 to publish")
          return
        }
        if (!submitPayload.shelfLife) {
          setError("Shelf Life is required to publish")
          return
        }
      }
      if (submitPayload.type === "simple" && submitPayload.discountPercent == null) {
        setError("Discount percentage is required")
        return
      }
      if (submitPayload.type === "simple" && !submitPayload.weight) { // New validation for simple product weight
        setError("Weight is required for simple products.");
        return;
      }
      if (!submitPayload.type) {
        setError("Product type is required")
        return
      }
      if (!submitPayload.stockStatus) {
        setError("Stock status is required")
        return
      }
      if (!submitPayload.shelfLife) {
        setError("Shelf life is required")
        return
      }
      if (!submitPayload.thumbnail) {
        setError("Thumbnail image is required")
        return
      }
      if (!submitPayload.description || isEmptyRichText(submitPayload.description)) {
        setError("Description is required")
        return
      }
      if (stripHtmlText(submitPayload.description).length > DESCRIPTION_MAX_CHARS) {
        setError(`Description must be ${DESCRIPTION_MAX_CHARS} characters or less`)
        return
      }
    }

    const isPublishing = effectiveStatus === "published"

    if (isPublishing) {
      if (!submitPayload.price || submitPayload.price <= 0) {
        setError("Provide at least one valid price to publish the product")
        return
      }
      if (submitPayload.features.length === 0 && selectedFeatureDefinitionIds.length === 0) {
        setError("At least one product feature is required to publish")
        return
      }
    }
    setStatus(effectiveStatus)
    setSaving(true)
    setError("")
    skipAutosaveRef.current = true
    if (isDraft) setDraftSaveStatus("saving")
    try {
      let resolvedProductId = productId ?? draftProductIdRef.current ?? ""
      if ((mode === "edit" && productId) || (mode === "add" && draftProductIdRef.current)) {
        const id = productId ?? draftProductIdRef.current!
        await authedPatch(`/api/v1/products/${id}`, submitPayload)
        resolvedProductId = id
        alert(mode === "edit" ? "Product updated successfully" : "Product created successfully")
      } else {
        const created = await authedPost<ProductDetail>("/api/v1/products", submitPayload)
        resolvedProductId = created.id
        draftProductIdRef.current = created.id
        setAutosavedDraftId(created.id)
        alert("Product created successfully")
      }
      if (isDraft) {
        lastAutosavedHashRef.current = JSON.stringify(buildSoftDraftPayload())
        setDraftSaveStatus("saved")
      }
      if (resolvedProductId && discountEnabled) {
        const discountPayload = {
          productId: resolvedProductId,
          discountType: "percentage" as const,
          discountValue: 0,
          startDate: null,
          endDate: null,
          isStackable: false,
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
      window.sessionStorage.removeItem(ADD_PENDING_ID_KEY)
      window.sessionStorage.removeItem(ADD_DRAFT_ID_KEY)
      router.push(mode === "edit" ? `${basePath}/${resolvedProductId}` : `${basePath}`)
    } catch (e) {
      skipAutosaveRef.current = false
      if (isDraft) setDraftSaveStatus("idle")
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

    const invalidType = selected.filter((file) => {
      const isImage = file.type.startsWith("image/")
      const isVideo = file.type.startsWith("video/")
      if (kind === "thumbnail") return !isImage
      return !(isImage || isVideo)
    })
    if (invalidType.length > 0) {
      setError(
        kind === "thumbnail"
          ? "Thumbnails only accept image files (PNG, JPG, WEBP)."
          : "Gallery accepts images (PNG, JPG, WEBP) and videos (MP4, WEBM, MOV).",
      )
      return
    }

    const oversized = selected.filter((file) => {
      if (file.type.startsWith("video/")) return file.size > MAX_VIDEO_BYTES
      return file.size > MAX_IMAGE_BYTES
    })
    if (oversized.length > 0) {
      setError(
        `File size limit exceeded. Images max ${formatFileSizeMb(MAX_IMAGE_BYTES)}; videos max ${formatFileSizeMb(MAX_VIDEO_BYTES)}. Oversized: ${oversized
          .map((file) => `${file.name} (${(file.size / (1024 * 1024)).toFixed(2)} MB)`)
          .join(", ")}`,
      )
      return
    }

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
    const hasDescription = Boolean(product.description && !isEmptyRichText(product.description))
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

            <Select value={filterType} onValueChange={(value) => setFilterType(value as "all" | "single" | "multiple")}>
              <SelectTrigger className="w-44 rounded-lg border border-[#D9D9D1] bg-white px-3 py-2 text-sm">
                <SelectValue placeholder="All Variant Types" />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="all">All Variant Types</SelectItem>
                <SelectItem value="single">Single Variant</SelectItem>
                <SelectItem value="multiple">Multi Variant</SelectItem>
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
          <ConsoleTable headers={["S.No", "Created At", "SKU", "Product Name", "Stock", "Sale Price", "Status", "Actions"]}>
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
                  <ConsoleTd className="align-middle whitespace-nowrap text-[12px] text-[#646464]">
                    {formatCreatedAt(p.createdAt)}
                  </ConsoleTd>
                  <ConsoleTd className="align-middle">
                    <code className="text-[11px]">{p.sku}</code>
                  </ConsoleTd>
                  <ConsoleTd className="align-middle">
                    <Link href={`${basePath}/${p.id}`} className="text-[#7B3010] font-semibold hover:underline">
                      {p.name}
                    </Link>
                  </ConsoleTd>
                  <ConsoleTd className="align-middle">
                    <span className="text-[12px] font-semibold text-[#2A1810]">
                      {p.type === "variant"
                        ? (p.variants ?? []).reduce((sum, v) => sum + Number(v.stock ?? 0), 0)
                        : Number(p.totalStock ?? 0)}
                    </span>
                  </ConsoleTd>
                  <ConsoleTd className="align-middle font-semibold text-[11px]">
                    {p.type === "variant"
                      ? p.variants?.map(v => `Rs.${Number(v.price).toFixed(2)}`).join(", ") || "—"
                      : p.price
                        ? `Rs.${Number(p.price).toFixed(2)}`
                        : "—"}
                  </ConsoleTd>
                  <ConsoleTd className="align-middle">
                    <Select value={rowStatus[p.id] ?? p.status} onValueChange={(value) => setRowStatus((prev) => ({ ...prev, [p.id]: value }))}>
                      <SelectTrigger className="w-[112px] justify-between rounded-lg border border-[#D9D9D1] bg-white px-2 text-xs capitalize" size="sm">
                        <SelectValue />
                      </SelectTrigger>
                      <SelectContent>
                        {(p.status === "draft" ? (["draft", "published"] as const) : (["published", "archived"] as const)).map((s) => (
                          <SelectItem key={s} value={s} className="capitalize">
                            {s}
                          </SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
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
      <div className="flex flex-col gap-3 md:flex-row md:items-start md:justify-between">
        <div>
          <Link href={basePath} className="text-xs font-semibold uppercase text-[#7B3010] underline">
            ← Back to Products
          </Link>
          <h1 className="mt-2 font-melon text-2xl font-bold text-[#4A1D1F]">
            {mode === "view"
              ? "Product Details"
              : mode === "edit"
                ? currentStep === 5
                  ? "Review & Publish"
                  : "Edit product"
                : currentStep === 5
                  ? "Review & Publish"
                  : "Add Product"}
          </h1>
          {mode === "view" ? (
            <div className={`space-y-0.5 ${productLoaded ? "" : "invisible"}`}>
              <p className="text-sm text-[#646464]">Last updated: {formatUpdatedAt(updatedAt)}</p>
              <p className="text-sm text-[#646464]">Last price update: {formatUpdatedAt(priceUpdatedAt)}</p>
            </div>
          ) : currentStep === 5 ? (
            <p className="text-sm text-[#646464]">
              Review all details before publishing your product. You can go back and edit any section.
            </p>
          ) : (
            <p className="text-sm text-[#646464]">
              {autosaveEnabled
                ? "Add product details to list it on Ziply5. Progress is auto-saved as a draft if you leave this page."
                : "Edit product details. Changes are saved only when you click Save Draft or Publish."}
            </p>
          )}
        </div>
        {mode !== "view" ? (
          <div className="flex flex-wrap gap-2">
            {currentStep === 5 ? null : (
              <>
                <Button
                  type="button"
                  variant="outline"
                  disabled={saving || uploadingThumbnails || uploadingGallery || uploadingIcon || draftSaveStatus === "saving"}
                  onClick={() => {
                    void onSubmit({ preventDefault() {} } as React.FormEvent, "draft")
                  }}
                  className={`rounded-full border-[#E8DCC8] px-4 text-xs font-semibold uppercase ${
                    draftSaveStatus === "saved"
                      ? "bg-[#E8F5E9] text-[#1B5E20] border-[#A5D6A7]"
                      : "bg-[#FFF7EA] text-[#4A1D1F]"
                  }`}
                >
                  {draftSaveStatus === "saving" || (saving && status === "draft")
                    ? "Saving Draft..."
                    : draftSaveStatus === "saved"
                      ? "Draft Saved"
                      : "Save Draft"}
                </Button>
                <Button
                  type="button"
                  onClick={() => {
                    if (currentStep === 1 && (!name.trim() || !slug.trim())) {
                      setError("Name and slug are required before continuing")
                      return
                    }
                    setError("")
                    setCurrentStep((prev) => Math.min(5, (prev + 1) as ProductFormStepId) as ProductFormStepId)
                  }}
                  className="rounded-full bg-[#7B3010] px-4 text-xs font-semibold uppercase text-white"
                >
                  Next Step →
                </Button>
              </>
            )}
          </div>
        ) : (
          <div className="flex flex-wrap gap-2">
            <Link
              href={slug ? `/product/${encodeURIComponent(slug)}` : "#"}
              target={slug ? "_blank" : undefined}
              rel={slug ? "noopener noreferrer" : undefined}
              onClick={(e) => {
                if (!slug) e.preventDefault()
              }}
              className={`inline-flex items-center gap-1.5 rounded-full border border-[#E8DCC8] bg-white px-4 py-2 text-xs font-semibold uppercase text-[#4A1D1F] ${
                slug ? "hover:bg-[#FFF7EA]" : "pointer-events-none opacity-50"
              }`}
            >
              View on Store
              <ExternalLink className="h-3.5 w-3.5" />
            </Link>
            <Link
              href={productId ? `${basePath}/${productId}/edit?step=1` : basePath}
              className="inline-flex items-center gap-1.5 rounded-full bg-[#7B3010] px-4 py-2 text-xs font-semibold uppercase text-white hover:bg-[#6A280D]"
            >
              <Pencil className="h-3.5 w-3.5" />
              Edit Product
            </Link>
          </div>
        )}
      </div>
      {mode !== "view" && (
        <>
          <ProductFormStepper
            currentStep={currentStep}
            onStepClick={(step) => {
              if (step <= currentStep) setCurrentStep(step)
            }}
          />
          <p className="text-xs text-[#646464]">Draft saves can be partial. Publishing requires complete pricing, media, features, and content.</p>
        </>
      )}

      {mode === "view" && error && <p className="rounded-lg bg-red-50 px-3 py-2 text-sm text-red-800">{error}</p>}
      {mode !== "view" && error && <p className="rounded-lg bg-red-50 px-3 py-2 text-sm text-red-800">{error}</p>}
      {loading && mode === "edit" && <p className="text-sm text-[#646464]">Loading product...</p>}

      {mode === "view" && !productLoaded ? (
        loading ? (
          <div className="flex min-h-[320px] flex-col items-center justify-center gap-3 rounded-2xl border border-[#E8DCC8] bg-white p-4 text-sm text-[#646464] shadow-sm">
            <Loader2 className="h-7 w-7 animate-spin text-[#7B3010]" />
            Loading product details...
          </div>
        ) : null
      ) : (
      <form onSubmit={onSubmit} className="flex flex-col gap-3 rounded-2xl border border-[#E8DCC8] bg-white p-4 shadow-sm">
        {/* Product info, images and description and seo meta data */}
        {mode === "view" ? null : (
            <>
            <div className={`space-y-4 ${currentStep === 1 ? "" : "hidden"}`}>
              <div className="rounded-2xl border border-[#E8DCC8] bg-white p-5 shadow-sm space-y-5">
                <div>
                  <h2 className="text-base font-semibold text-[#4A1D1F]">Basic Information</h2>
                </div>

                <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
                  {/* Row 1 */}
                  <Field label="Category" required>
                    <Select value={categoryId || undefined} onValueChange={setCategoryId}>
                      <SelectTrigger className="rounded-lg border border-[#D9D9D1] px-3 py-2 text-sm">
                        <SelectValue placeholder="Select category" />
                      </SelectTrigger>
                      <SelectContent>
                        {categories.length === 0 ? (
                          <div className="px-2 py-1.5 text-sm text-[#646464]">No categories available</div>
                        ) : (
                          categories.map((c) => (
                            <SelectItem key={c.id} value={c.id}>
                              {c.name}
                            </SelectItem>
                          ))
                        )}
                      </SelectContent>
                    </Select>
                  </Field>

                  <Field label="Product Name" required>
                    <Input
                      placeholder="Enter product name"
                      value={name}
                      onChange={(e) => {
                        const newName = e.target.value
                        setName(newName)
                        if (mode === "add") {
                          const autoSlug = newName
                            .toLowerCase()
                            .replace(/\s+/g, "-")
                            .replace(/[^a-z0-9-_]/g, "")
                            .replace(/[-_]{2,}/g, "-")
                            .replace(/^[-_]+|[-_]+$/g, "")
                          setSlug(autoSlug)
                        }
                      }}
                      required
                      className="rounded-lg border border-[#D9D9D1] px-3 py-2 text-sm"
                    />
                  </Field>

                  <Field label="Product ID">
                    <Input
                      value={displayProductId}
                      readOnly
                      disabled
                      className="rounded-lg border border-[#D9D9D1] bg-[#F5F5F5] px-3 py-2 text-sm text-[#646464] cursor-not-allowed"
                      title="Auto-generated product ID"
                    />
                    <p className="mt-1 text-[11px] text-[#646464]">
                      {mode === "edit" ? "Product ID (auto-generated)" : "Auto-generated ID for this product"}
                    </p>
                  </Field>

                  {/* Row 2 */}
                  <Field label="Product Slug" required>
                    <div className="relative">
                      <Input
                        placeholder="Enter product slug"
                        value={slug}
                        onChange={(e) => {
                          let value = e.target.value.toLowerCase()
                          value = value.replace(/\s+/g, "-")
                          value = value.replace(/[^a-z0-9-_]/g, "")
                          value = value.replace(/[-_]{2,}/g, "-")
                          setSlug(value)
                        }}
                        required
                        pattern="^[a-z0-9]+(?:[-_][a-z0-9]+)*$"
                        title="Only lowercase letters, numbers, hyphens (-), and underscores (_) are allowed. No spaces."
                        className="rounded-lg border border-[#D9D9D1] px-3 py-2 pr-10 text-sm"
                      />
                      <button
                        type="button"
                        title="Regenerate from name"
                        onClick={() => {
                          const autoSlug = name
                            .toLowerCase()
                            .replace(/\s+/g, "-")
                            .replace(/[^a-z0-9-_]/g, "")
                            .replace(/[-_]{2,}/g, "-")
                            .replace(/^[-_]+|[-_]+$/g, "")
                          setSlug(autoSlug)
                        }}
                        className="absolute right-2 top-1/2 -translate-y-1/2 rounded p-1 text-[#7B3010] hover:bg-[#FFF7EA]"
                      >
                        <svg className="h-4 w-4" fill="none" stroke="currentColor" strokeWidth="2" viewBox="0 0 24 24">
                          <path strokeLinecap="round" strokeLinejoin="round" d="M4 4v5h.582m15.356 2A8.001 8.001 0 004.582 9m0 0H9m11 11v-5h-.581m0 0a8.003 8.003 0 01-15.357-2m15.357 2H15" />
                        </svg>
                      </button>
                    </div>
                  </Field>

                  <Field label="Food Type" required={status !== "draft"}>
                    <div className="grid grid-cols-2 gap-2">
                      {([
                        { value: "veg" as const, label: "Vegetarian" },
                        { value: "non-veg" as const, label: "Non-Veg" },
                      ]).map((option) => (
                        <button
                          key={option.value}
                          type="button"
                          onClick={() => setFoodType(option.value)}
                          className={`rounded-xl border px-2 py-2.5 text-center text-xs font-semibold transition sm:text-sm ${
                            foodType === option.value
                              ? "border-[#7B3010] bg-[#FFF7EA] text-[#4A1D1F] ring-1 ring-[#7B3010]/30"
                              : "border-[#E8DCC8] bg-white text-[#646464] hover:bg-[#FFFBF3]"
                          }`}
                        >
                          {option.label}
                        </button>
                      ))}
                    </div>
                  </Field>

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

                  {/* Row 3 */}
                  <Field
                    label="Shelf Life"
                    required={status !== "draft"}
                    info="Shelf life is counted in months. Enter how many months this product stays good to use from the manufacturing or packing date."
                  >
                    <Input
                      placeholder="Enter shelf life in months"
                      type="number"
                      min={0}
                      inputMode="decimal"
                      value={shelfLife}
                      onKeyDown={blockNumberFieldKeys}
                      onChange={(e) => setShelfLife(sanitizeNonNegativeInput(e.target.value))}
                      className={`rounded-lg border border-[#D9D9D1] px-3 py-2 text-sm ${NUMBER_INPUT_CLASS}`}
                      title="Shelf life in months"
                    />
                  </Field>

                  <div className="sm:col-span-2 lg:col-span-2">
                    <Field
                      label="Select Weight Options"
                      required
                      info="Select variant based on weight. Example: if a product has both 250 gm and 500 gm packs, choose Multi variant. If it has only one weight (for example only 250 gm), choose Single variant."
                    >
                      <div className="grid gap-3 sm:grid-cols-2">
                        {([
                          { value: "single" as const, label: "Single variant", hint: "One weight only (e.g. 250 gm)" },
                          { value: "multiple" as const, label: "Multi variant", hint: "Multiple weights (e.g. 250 gm & 500 gm)" },
                        ]).map((option) => {
                          const selected = variantMode === option.value
                          return (
                            <button
                              key={option.value}
                              type="button"
                              aria-pressed={selected}
                              onClick={() => {
                                setType("variant")
                                setVariantMode(option.value)
                                if (option.value === "single") {
                                  setVariants((prev) => {
                                    const keep = prev.find((v) => v.isDefault) ?? prev[0]
                                    return keep
                                      ? [{ ...keep, isDefault: true }]
                                      : [{ name: "250g", weight: "250g", sku: "", price: "", mrp: "", discountPercent: "", stock: "0", isDefault: true, hsnCode: "", eanCode: "" }]
                                  })
                                } else {
                                  setVariants((prev) =>
                                    prev.length > 0
                                      ? prev
                                      : [{ name: "250g", weight: "250g", sku: "", price: "", mrp: "", discountPercent: "", stock: "0", isDefault: true, hsnCode: "", eanCode: "" }],
                                  )
                                }
                              }}
                              className={`rounded-xl border px-4 py-3 text-left transition ${
                                selected
                                  ? "border-[#7B3010] bg-[#FFF7EA] text-[#4A1D1F] ring-1 ring-[#7B3010]/30"
                                  : "border-[#E8DCC8] bg-white text-[#646464] hover:bg-[#FFFBF3]"
                              }`}
                            >
                              <div className="flex items-start justify-between gap-2">
                                <div>
                                  <p className="text-sm font-semibold">{option.label}</p>
                                  <p className="mt-0.5 text-xs text-[#7A7A72]">{option.hint}</p>
                                </div>
                                <span
                                  className={`mt-0.5 flex h-4 w-4 shrink-0 items-center justify-center rounded-full border ${
                                    selected ? "border-[#7B3010] bg-[#7B3010]" : "border-[#D9D9D1] bg-white"
                                  }`}
                                >
                                  {selected ? <span className="h-1.5 w-1.5 rounded-full bg-white" /> : null}
                                </span>
                              </div>
                            </button>
                          )
                        })}
                      </div>
                    </Field>
                  </div>
                </div>

                <div className="flex items-start gap-3 rounded-xl border border-[#F0E0D0] bg-[#FFF5F0] px-4 py-3">
                  <span className="mt-0.5 flex h-5 w-5 shrink-0 items-center justify-center rounded-full bg-[#7B3010] text-[11px] font-bold leading-none text-white">
                    i
                  </span>
                  <p className="text-sm text-[#7B3010]">
                    You can add images, pricing, variants, and more in the next steps.
                  </p>
                </div>
              </div>
            </div>
              <div className={`md:col-span-3 grid gap-3 md:grid-cols-2 md:items-stretch ${currentStep === 2 ? "" : "hidden"}`}>
                <ImageUploadPicker
                  label="Thumbnails"
                  required={status !== "draft"}
                  hint="Shown on product cards and as the main cover. First image is cover by default — click any other image to make it cover."
                  resolutionHint="800 × 800 px (square)"
                  maxSizeLabel="Max 1 MB each"
                  emptyTitle="Click or drop thumbnail images"
                  urls={thumbnailUrls}
                  coverBadge
                  uploading={uploadingThumbnails}
                  onPick={(files) => void uploadMany(files, "thumbnail")}
                  onRemove={(url) => setThumbnailUrls((prev) => prev.filter((x) => x !== url))}
                  onSetCover={(url) =>
                    setThumbnailUrls((prev) => {
                      if (!prev.includes(url) || prev[0] === url) return prev
                      return [url, ...prev.filter((item) => item !== url)]
                    })
                  }
                />
                <ImageUploadPicker
                  label="Gallery media"
                  hint="Extra photos and short videos on the product page (angles, pack shots, details). Optional."
                  resolutionHint="1200 × 1200 px (square)"
                  maxSizeLabel="Max 1 MB each"
                  videoMaxSizeLabel="Max 10 MB each"
                  allowVideo
                  emptyTitle="Click or drop images or videos"
                  urls={imageUrls}
                  uploading={uploadingGallery}
                  onPick={(files) => void uploadMany(files, "image")}
                  onRemove={(url) => setImageUrls((prev) => prev.filter((x) => x !== url))}
                />
              </div>
              <div className={`space-y-4 rounded-lg border border-[#E8DCC8] bg-[#FFFBF3]/30 p-4 ${currentStep === 4 ? "" : "hidden"}`}>
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
                        placeholder="Enter meta title"
                        value={metaTitle}
                        onChange={(e) => setMetaTitle(e.target.value)}
                        maxLength={60}
                        className="rounded-lg border border-[#D9D9D1] px-3 py-2 text-sm"
                      />
                      <p className="mt-1 text-[11px] text-[#646464]">{metaTitle.length} / 60</p>
                    </Field>
                  </div>
                  <div className="md:col-span-2">
                    <Field label="Meta description">
                      <Textarea
                        placeholder="Enter meta description"
                        value={metaDescription}
                        onChange={(e) => setMetaDescription(e.target.value)}
                        rows={3}
                        className="rounded-lg border border-[#D9D9D1] px-3 py-2 text-sm"
                      />
                    </Field>
                  </div>
                </div>
              <Field label="Amazon Link">
                <Input placeholder="Enter Amazon link" value={amazonLink} onChange={(e) => setAmazonLink(e.target.value)} className="rounded-lg border border-[#D9D9D1] px-3 py-2 text-sm md:col-span-2" />
              </Field>
              <p className="text-[11px] text-[#646464]">Product URL preview: https://www.ziply5.com/products/{slug || "your-product-slug"}</p>
              </div>
              {/* Step 3 — Pricing & Inventory (variants table) */}
              <div className={`space-y-3 rounded-2xl border border-[#E8DCC8] bg-white p-4 shadow-sm ${currentStep === 3 ? "" : "hidden"}`}>
                  <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
                    <div className="flex items-start gap-2.5">
                      <span className="mt-0.5 flex h-8 w-8 shrink-0 items-center justify-center rounded-lg bg-[#7B3010]/10 text-[#7B3010]">
                        <Package className="h-4 w-4" />
                      </span>
                      <div>
                        <p className="text-sm font-semibold text-[#4A1D1F]">Product Variants</p>
                        <p className="mt-1 text-[11px] text-[#646464]">
                          Add different sizes or packs with their own price and stock.
                        </p>
                      </div>
                    </div>
                    <button
                      type="button"
                      onClick={() => {
                        setType("variant")
                        setVariantMode("multiple")
                        setVariants((prev) => [
                          ...prev,
                          {
                            name: "",
                            weight: "",
                            sku: "",
                            price: "",
                            mrp: "",
                            discountPercent: "",
                            stock: "0",
                            isDefault: prev.length === 0,
                            hsnCode: "",
                            eanCode: "",
                          },
                        ])
                      }}
                      className="shrink-0 rounded-full border border-[#7B3010] bg-white px-3 py-1.5 text-[11px] font-semibold uppercase text-[#7B3010] hover:bg-[#FFF7EA]"
                    >
                      + Add Variant
                    </button>
                  </div>

                  <div className="overflow-x-auto rounded-xl border border-[#E8DCC8]">
                    <table className="min-w-[1140px] w-full border-collapse text-left text-sm">
                      <thead>
                        <tr className="border-b border-[#E8DCC8] bg-[#FFFBF3] text-[10px] font-semibold uppercase tracking-wide text-[#646464]">
                          <th className="px-2 py-2.5">#</th>
                          <th className="px-2 py-2.5">Weight / Size</th>
                          <th className="px-2 py-2.5">Unit</th>
                          <th className="px-2 py-2.5">
                            <span className="inline-flex items-center gap-1">
                              MRP (₹)
                              <span title="Maximum retail price before discount" className="text-[#7B3010]"><InfoIcon className="h-3 w-3" /></span>
                            </span>
                          </th>
                          <th className="px-2 py-2.5">
                            <span className="inline-flex items-center gap-1">
                              Discount %
                              <span title="Percent off MRP; sale price updates automatically" className="text-[#7B3010]"><InfoIcon className="h-3 w-3" /></span>
                            </span>
                          </th>
                          <th className="px-2 py-2.5">
                            <span className="inline-flex items-center gap-1">
                              Sale Price (₹)
                              <span title="Calculated from MRP and discount %" className="text-[#7B3010]"><InfoIcon className="h-3 w-3" /></span>
                            </span>
                          </th>
                          <th className="px-2 py-2.5">
                            <span className="inline-flex items-center gap-1">
                              Stock
                              <span title="Available inventory for this variant" className="text-[#7B3010]"><InfoIcon className="h-3 w-3" /></span>
                            </span>
                          </th>
                          <th className="px-2 py-2.5">
                            <span className="inline-flex items-center gap-1">
                              SKU
                              <span title="Unique stock keeping unit for this variant" className="text-[#7B3010]"><InfoIcon className="h-3 w-3" /></span>
                            </span>
                          </th>
                          <th className="px-2 py-2.5">
                            <span className="inline-flex items-center gap-1">
                              HSN Code
                              <span title="HSN / tax classification code" className="text-[#7B3010]"><InfoIcon className="h-3 w-3" /></span>
                            </span>
                          </th>
                          <th className="px-2 py-2.5">
                            <span className="inline-flex items-center gap-1">
                              EAN / GTIN Code / Barcode
                              <span title="Barcode / GTIN for this variant" className="text-[#7B3010]"><InfoIcon className="h-3 w-3" /></span>
                            </span>
                          </th>
                          <th className="px-2 py-2.5 text-center">Default</th>
                          <th className="px-2 py-2.5 text-center">Remove</th>
                        </tr>
                      </thead>
                      <tbody>
                        {(variantMode === "single" ? variants.slice(0, 1) : variants).map((variant, idx) => {
                          const weightParts = parseWeight(variant.weight)
                          const discNum = Number(variant.discountPercent || 0)
                          return (
                            <tr key={`${variant.id ?? "new"}-${idx}`} className="border-b border-[#F0E8DC] bg-white last:border-b-0">
                              <td className="px-2 py-2 align-middle text-xs font-semibold text-[#646464]">{idx + 1}</td>
                              <td className="px-2 py-2 align-middle">
                                <Input
                                  type="number"
                                  min={0}
                                  inputMode="decimal"
                                  placeholder="250"
                                  value={weightParts.value}
                                  onKeyDown={blockNumberFieldKeys}
                                  onChange={(e) => {
                                    const newVal = sanitizeNonNegativeInput(e.target.value) + weightParts.unit
                                    setVariants((prev) =>
                                      prev.map((x, i) => (i === idx ? { ...x, weight: newVal, name: newVal } : x)),
                                    )
                                  }}
                                  className={`h-9 w-20 rounded border border-[#D9D9D1] bg-white px-2 text-sm ${NUMBER_INPUT_CLASS}`}
                                />
                              </td>
                              <td className="px-2 py-2 align-middle">
                                <Select
                                  value={weightParts.unit || "gm"}
                                  onValueChange={(unit) => {
                                    const newVal = weightParts.value + unit
                                    setVariants((prev) =>
                                      prev.map((x, i) => (i === idx ? { ...x, weight: newVal, name: newVal } : x)),
                                    )
                                  }}
                                >
                                  <SelectTrigger className="h-9 w-[72px] rounded border border-[#D9D9D1] bg-white px-2 text-xs">
                                    <SelectValue />
                                  </SelectTrigger>
                                  <SelectContent>
                                    <SelectItem value="gm">gm</SelectItem>
                                    <SelectItem value="mg">mg</SelectItem>
                                    <SelectItem value="kg">kg</SelectItem>
                                  </SelectContent>
                                </Select>
                              </td>
                              <td className="px-2 py-2 align-middle">
                                <Input
                                  type="number"
                                  min={0}
                                  inputMode="decimal"
                                  placeholder="0"
                                  value={variant.mrp}
                                  onKeyDown={blockNumberFieldKeys}
                                  onChange={(e) => {
                                    const val = sanitizeNonNegativeInput(e.target.value)
                                    const base = parseFloat(val) || 0
                                    const disc = parseFloat(variant.discountPercent) || 0
                                    const sale = base - (base * disc) / 100
                                    const res = sale > 0 ? sale.toFixed(2) : base > 0 ? base.toFixed(2) : ""
                                    setVariants((prev) => prev.map((x, i) => (i === idx ? { ...x, mrp: val, price: res } : x)))
                                  }}
                                  className={`h-9 w-24 rounded border border-[#D9D9D1] bg-white px-2 text-sm ${NUMBER_INPUT_CLASS}`}
                                />
                              </td>
                              <td className="px-2 py-2 align-middle">
                                <div className="flex items-center gap-1.5">
                                  <Input
                                    type="number"
                                    min={0}
                                    inputMode="decimal"
                                    placeholder="0"
                                    value={variant.discountPercent}
                                    onKeyDown={blockNumberFieldKeys}
                                    onChange={(e) => {
                                      const val = sanitizeNonNegativeInput(e.target.value)
                                      const base = parseFloat(variant.mrp) || 0
                                      const disc = parseFloat(val) || 0
                                      const sale = base - (base * disc) / 100
                                      const res = sale > 0 ? sale.toFixed(2) : base > 0 ? base.toFixed(2) : ""
                                      setVariants((prev) =>
                                        prev.map((x, i) => (i === idx ? { ...x, discountPercent: val, price: res } : x)),
                                      )
                                    }}
                                    className={`h-9 w-16 rounded border border-[#D9D9D1] bg-white px-2 text-sm ${NUMBER_INPUT_CLASS}`}
                                  />
                                  {discNum > 0 ? (
                                    <span
                                      title={discountEnabled ? undefined : "Turn on Enable Discount to apply this"}
                                      className={`shrink-0 rounded px-1.5 py-0.5 text-[10px] font-semibold ${
                                        discountEnabled ? "bg-[#E8F5E9] text-[#2E7D32]" : "bg-[#F0F0EC] text-[#8A8A82] line-through"
                                      }`}
                                    >
                                      {discNum}% OFF
                                    </span>
                                  ) : null}
                                </div>
                              </td>
                              <td className="px-2 py-2 align-middle">
                                <Input
                                  type="number"
                                  min={0}
                                  inputMode="decimal"
                                  placeholder="0"
                                  value={variant.mrp || variant.price ? String(variantSalePrice(variant, discountEnabled)) : ""}
                                  readOnly
                                  className={`h-9 w-24 cursor-not-allowed rounded border border-[#D9D9D1] bg-[#F5F5F5] px-2 text-sm ${NUMBER_INPUT_CLASS}`}
                                />
                              </td>
                              <td className="px-2 py-2 align-middle">
                                <Input
                                  type="number"
                                  min={0}
                                  inputMode="numeric"
                                  placeholder="0"
                                  value={variant.stock}
                                  onKeyDown={blockNumberFieldKeys}
                                  onChange={(e) =>
                                    setVariants((prev) =>
                                      prev.map((x, i) =>
                                        i === idx ? { ...x, stock: sanitizeNonNegativeInput(e.target.value) } : x,
                                      ),
                                    )
                                  }
                                  className={`h-9 w-20 rounded border border-[#D9D9D1] bg-white px-2 text-sm ${NUMBER_INPUT_CLASS}`}
                                />
                              </td>
                              <td className="px-2 py-2 align-middle">
                                <Input
                                  placeholder="SKU"
                                  value={variant.sku}
                                  onChange={(e) =>
                                    setVariants((prev) => prev.map((x, i) => (i === idx ? { ...x, sku: e.target.value } : x)))
                                  }
                                  className="h-9 w-28 rounded border border-[#D9D9D1] bg-white px-2 text-sm"
                                />
                              </td>
                              <td className="px-2 py-2 align-middle">
                                <Input
                                  placeholder="HSN"
                                  value={variant.hsnCode}
                                  onChange={(e) =>
                                    setVariants((prev) =>
                                      prev.map((x, i) => (i === idx ? { ...x, hsnCode: e.target.value } : x)),
                                    )
                                  }
                                  className="h-9 w-24 rounded border border-[#D9D9D1] bg-white px-2 text-sm"
                                />
                              </td>
                              <td className="px-2 py-2 align-middle">
                                <Input
                                  placeholder="Barcode"
                                  value={variant.eanCode}
                                  onChange={(e) =>
                                    setVariants((prev) =>
                                      prev.map((x, i) => (i === idx ? { ...x, eanCode: e.target.value } : x)),
                                    )
                                  }
                                  className="h-9 w-32 rounded border border-[#D9D9D1] bg-white px-2 text-sm"
                                />
                              </td>
                              <td className="px-2 py-2 align-middle text-center">
                                <input
                                  type="radio"
                                  name="default-variant"
                                  checked={variant.isDefault || (variantMode === "single" && idx === 0)}
                                  onChange={() =>
                                    setVariants((prev) => prev.map((x, i) => ({ ...x, isDefault: i === idx })))
                                  }
                                  className="h-4 w-4 accent-[#7B3010]"
                                  title="Set as default variant"
                                />
                              </td>
                              <td className="px-2 py-2 align-middle text-center">
                                <button
                                  type="button"
                                  disabled={variantMode === "single" || variants.length <= 1}
                                  onClick={() => {
                                    const label = variant.weight || `Variant ${idx + 1}`
                                    if (!window.confirm(`Remove variant "${label}"?`)) return
                                    setVariants((prev) => {
                                      const next = prev.filter((_, i) => i !== idx)
                                      if (next.length > 0 && !next.some((x) => x.isDefault)) {
                                        next[0] = { ...next[0], isDefault: true }
                                      }
                                      return next
                                    })
                                  }}
                                  className="inline-flex h-8 w-8 items-center justify-center rounded-full border border-[#F0C7C7] text-[#B44444] transition hover:bg-[#FFF5F5] disabled:cursor-not-allowed disabled:border-[#E8E8E2] disabled:text-[#BDBDB5] disabled:hover:bg-transparent"
                                  title={
                                    variantMode === "single" || variants.length <= 1
                                      ? "At least one variant is required"
                                      : "Remove this variant"
                                  }
                                  aria-label={`Remove variant ${idx + 1}`}
                                >
                                  <Trash2 className="h-4 w-4" />
                                </button>
                              </td>
                            </tr>
                          )
                        })}
                      </tbody>
                    </table>
                  </div>

                  <div className="flex items-start gap-3 rounded-xl border border-[#F0C7C7] bg-[#FFF5F5] px-4 py-3">
                    <span className="mt-0.5 flex h-5 w-5 shrink-0 items-center justify-center rounded-full bg-[#B44444] text-[11px] font-bold leading-none text-white">
                      i
                    </span>
                    <p className="text-sm text-[#8A2E2E]">The default variant will be selected on the product page.</p>
                  </div>

                  <div className="flex flex-wrap items-center gap-3 border-t border-[#E8DCC8] pt-3">
                    <span className="text-xs font-semibold uppercase text-[#4A1D1F]">Enable Discount:</span>
                    <button
                      type="button"
                      role="switch"
                      aria-checked={discountEnabled}
                      onClick={() => setDiscountEnabled((prev) => !prev)}
                      className={`relative h-7 w-12 rounded-full transition ${
                        discountEnabled ? "bg-[#7B3010]" : "bg-[#D9D9D1]"
                      }`}
                    >
                      <span
                        className={`absolute top-0.5 h-6 w-6 rounded-full bg-white shadow transition ${
                          discountEnabled ? "left-5" : "left-0.5"
                        }`}
                      />
                    </button>
                    <span className="text-xs font-semibold text-[#646464]">{discountEnabled ? "ON" : "OFF"}</span>
                    <span className="text-[11px] text-[#646464]">
                      {discountEnabled
                        ? "Website shows the sale price (MRP minus each variant's discount %) with MRP struck through."
                        : "Website shows the MRP as the product price. Variant discount % is not applied."}
                    </span>
                  </div>
                </div>
              <div className={currentStep === 2 ? "" : "hidden"}>
              <Field label="Description" required={status !== "draft"}>
                <RichTextEditor
                  value={description}
                  onChange={setDescription}
                  placeholder="Enter product description"
                  maxLength={DESCRIPTION_MAX_CHARS}
                  compact
                />
              </Field></div>
            </>
          )}
        {/* Product Specifications and Details */}
        <div className={`md:col-span-3 space-y-3 shadow-sm rounded-xl border border-[#E8DCC8] p-3 ${mode !== "view" && currentStep === 2 ? "" : "hidden"}`}>
          <div className="flex items-center justify-between">
            <p className="text-xs font-semibold uppercase tracking-wide text-[#4A1D1F]">Product Details</p>
            {mode !== "view" ? (
              <button
                type="button"
                onClick={() => {
                  if (sections.length >= MAX_SECTIONS) return
                  setSections((prev) => [
                    ...prev,
                    { title: "", description: "<p></p>", sortOrder: prev.length, isActive: true },
                  ])
                }}
                className="rounded-full border border-[#7B3010] px-3 py-1 text-[11px] font-semibold uppercase text-[#7B3010]"
              >
                Add Section
              </button>
            ) : null}
          </div>
            <Accordion
              type="multiple"
              value={openDetailSections}
              onValueChange={setOpenDetailSections}
              className="space-y-2"
            >
              {sections.map((section, idx) => {
                const sectionKey = `section-${section.id ?? idx}`
                const subtitle = stripHtmlText(section.description)
                return (
                  <AccordionItem
                    key={sectionKey}
                    value={sectionKey}
                    className="overflow-hidden rounded-lg border border-[#D9D9D1] bg-[#FFFBF3] shadow-sm"
                  >
                    <div className="flex items-center gap-2 pr-2">
                      <AccordionTrigger className="flex-1 px-3 py-3 hover:no-underline">
                        <div className="min-w-0 flex-1 pr-2 text-left">
                          <p className="truncate text-sm font-semibold text-[#2A1810]">
                            {idx + 1}. {section.title.trim() || "Untitled section"}
                          </p>
                          <p className="mt-0.5 truncate text-[11px] font-normal normal-case tracking-normal text-[#646464]">
                            {subtitle || "No description yet"}
                          </p>
                        </div>
                      </AccordionTrigger>
                      <button
                        type="button"
                        disabled={sections.length <= 1}
                        onClick={(e) => {
                          e.preventDefault()
                          e.stopPropagation()
                          if (sections.length <= 1) return
                          setSections((prev) => prev.filter((_, itemIdx) => itemIdx !== idx))
                          setOpenDetailSections((open) => open.filter((key) => key !== sectionKey))
                        }}
                        className="shrink-0 rounded-full border border-red-300 px-2 py-1 text-[10px] font-semibold uppercase text-red-700 disabled:cursor-not-allowed disabled:opacity-40"
                      >
                        Remove
                      </button>
                    </div>
                    <AccordionContent className="space-y-3 border-t border-[#E8DCC8] bg-white px-3 pb-3 pt-3">
                      <div className="grid gap-2 md:grid-cols-3">
                        <div className="md:col-span-2">
                          <Label className="text-xs font-semibold text-[#4A1D1F]">Section Title</Label>
                          <Input
                            placeholder="Enter section title"
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
                              placeholder="Enter sort order"
                              type="number"
                              min={0}
                              inputMode="numeric"
                              value={section.sortOrder}
                              onKeyDown={blockNumberFieldKeys}
                              onChange={(e) => {
                                const raw = sanitizeNonNegativeInput(e.target.value)
                                setSections((prev) =>
                                  prev.map((item, itemIdx) =>
                                    itemIdx === idx ? { ...item, sortOrder: Number(raw || 0) } : item,
                                  ),
                                )
                              }}
                              className={`w-20 rounded-lg border border-[#D9D9D1] bg-white px-2 py-2 text-sm ${NUMBER_INPUT_CLASS}`}
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
                    </AccordionContent>
                  </AccordionItem>
                )
              })}
            </Accordion>
          <p className="text-[11px] text-[#646464]">
            {status === "draft"
              ? `Draft products can save partial details. At least 2 sections are required to publish.`
              : `Up to ${MAX_SECTIONS} sections. Title and description are required.`}
          </p>
        </div>
        {/* Product Features (from shared catalog) */}
        <div className={`md:col-span-3 space-y-3 shadow-sm rounded-xl border border-[#E8DCC8] p-3 ${mode !== "view" && currentStep === 2 ? "" : "hidden"}`}>
          <div className="flex items-center justify-between gap-3">
            <div>
              <p className="text-xs font-semibold uppercase tracking-wide text-[#4A1D1F]">Product Features</p>
              <p className="mt-1 text-[11px] text-[#646464]">
                Select up to {MAX_PRODUCT_FEATURES} features from Settings → Product Features.
              </p>
            </div>
            <div className="flex items-center gap-3">
              <span className="text-[11px] font-semibold text-[#646464]">
                {selectedFeatureDefinitionIds.length}/{MAX_PRODUCT_FEATURES}
              </span>
              <Link href="/admin/product-features" className="text-[10px] font-semibold uppercase text-[#7B3010] underline">
                Manage features
              </Link>
            </div>
          </div>
          {featureCatalog.length === 0 ? (
            <p className="rounded-lg border border-dashed border-[#E8DCC8] bg-[#FFFBF3] px-3 py-4 text-sm text-[#646464]">
              No active features yet. Create feature icons and titles in Product Features first.
            </p>
          ) : (
            <div className="grid gap-2 sm:grid-cols-2 lg:grid-cols-3">
              {featureCatalog.map((feature) => {
                const checked = selectedFeatureDefinitionIds.includes(feature.id)
                const atLimit = !checked && selectedFeatureDefinitionIds.length >= MAX_PRODUCT_FEATURES
                return (
                  <label
                    key={feature.id}
                    className={`flex items-center gap-3 rounded-xl border px-3 py-3 transition ${
                      checked ? "border-[#7B3010] bg-[#FFF7EA]" : "border-[#E8DCC8] bg-white"
                    } ${atLimit ? "cursor-not-allowed opacity-50" : "cursor-pointer hover:bg-[#FFFBF3]"}`}
                  >
                    <Checkbox
                      checked={checked}
                      disabled={atLimit}
                      onCheckedChange={(value) => {
                        const next = Boolean(value)
                        setSelectedFeatureDefinitionIds((prev) => {
                          if (!next) return prev.filter((id) => id !== feature.id)
                          if (prev.includes(feature.id)) return prev
                          if (prev.length >= MAX_PRODUCT_FEATURES) {
                            setError(`You can select up to ${MAX_PRODUCT_FEATURES} product features`)
                            return prev
                          }
                          return [...prev, feature.id]
                        })
                      }}
                    />
                    {feature.icon ? (
                      <img src={feature.icon} alt="" className="h-8 w-8 rounded object-cover border border-[#E8DCC8]" />
                    ) : (
                      <span className="flex h-8 w-8 items-center justify-center rounded bg-[#FFFBF3] text-[10px] text-[#7A7A72]">N/A</span>
                    )}
                    <span className="text-sm font-medium text-[#2A1810]">{feature.title}</span>
                  </label>
                )
              })}
            </div>
          )}
        </div>
        {/* Step 5 — Review & Publish (also used as the read-only product view) */}
        {mode === "view" || currentStep === 5 ? (
          <div className="md:col-span-3 space-y-4">
            {reviewMissingCount > 0 ? (
              <div className="flex items-start gap-3 rounded-xl border border-[#F0C7C7] bg-[#FFF5F5] px-4 py-3">
                <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0 text-[#B44444]" />
                <div className="space-y-1 text-sm text-[#8A2E2E]">
                  <p className="font-semibold">
                    {reviewMissingCount} detail{reviewMissingCount === 1 ? "" : "s"} still missing.{" "}
                    {mode === "view" ? "Use Edit to complete them." : "Complete them before publishing."}
                  </p>
                  {([1, 2, 3, 4] as const).map((stepId) =>
                    reviewMissing[stepId].length ? (
                      <p key={stepId} className="text-xs">
                        <button
                          type="button"
                          onClick={() => goToEditStep(stepId)}
                          className="font-semibold underline underline-offset-2"
                        >
                          Step {stepId}
                        </button>
                        : {reviewMissing[stepId].join(", ")}
                      </p>
                    ) : null,
                  )}
                </div>
              </div>
            ) : mode === "view" ? null : (
              <div className="flex items-center gap-3 rounded-xl border border-green-200 bg-green-50 px-4 py-3 text-sm font-medium text-green-800">
                <Check className="h-4 w-4 shrink-0" />
                All required details are filled. Review below and publish when ready.
              </div>
            )}

            {/* Basic Information */}
            <div className="rounded-2xl border border-[#E8DCC8] bg-white p-4 shadow-sm">
              <ReviewSectionHeader
                icon={<Package className="h-4 w-4" />}
                title="Basic Information"
                subtitle="Core details about your product."
                missing={reviewMissing[1]}
                readOnly={mode === "view"}
                onEdit={() => goToEditStep(1)}
              />
              <div className="grid gap-x-10 md:grid-cols-2">
                <div>
                  <ReviewRow label="Product Name">{name.trim() || <ReviewMissing />}</ReviewRow>
                  <ReviewRow label="Category">
                    {categories.find((c) => c.id === categoryId)?.name || <ReviewMissing />}
                  </ReviewRow>
                  <ReviewRow label="Product ID">
                    <span className="font-mono text-xs">{displayProductId || "Generated on first save"}</span>
                  </ReviewRow>
                  <ReviewRow label="Product Slug">{slug.trim() || <ReviewMissing />}</ReviewRow>
                  <ReviewRow label="Spice Level">
                    {spiceLevel ? <span className="capitalize">{spiceLevel.replace(/_/g, " ")}</span> : <ReviewMissing />}
                  </ReviewRow>
                </div>
                <div>
                  <ReviewRow label="Food Type">
                    {foodType === "veg" ? (
                      <span className="inline-flex items-center gap-1 rounded-full border border-green-200 bg-green-50 px-2 py-0.5 text-xs font-semibold text-green-800">
                        <Leaf className="h-3 w-3" />
                        Vegetarian
                      </span>
                    ) : foodType === "non-veg" ? (
                      <span className="inline-flex items-center gap-1 rounded-full border border-red-200 bg-red-50 px-2 py-0.5 text-xs font-semibold text-red-800">
                        Non-Vegetarian
                      </span>
                    ) : (
                      <ReviewMissing />
                    )}
                  </ReviewRow>
                  <ReviewRow label="Variant Type">
                    {variantMode === "multiple" ? "Multi Variant" : "Single Variant"}
                  </ReviewRow>
                  <ReviewRow label="Created On">{createdAt ? formatUpdatedAt(createdAt) : "—"}</ReviewRow>
                  <ReviewRow label="Status">
                    <span className="inline-flex items-center gap-1.5">
                      <span className={`h-2 w-2 rounded-full ${isActive ? "bg-green-500" : "bg-gray-400"}`} />
                      {isActive ? "Active" : "Inactive"}
                      <span className="text-[#8A8A82]">·</span>
                      <span className="capitalize text-[#646464]">{status}</span>
                    </span>
                  </ReviewRow>
                  <ReviewRow label="Shelf Life">
                    {shelfLife.trim() ? `${shelfLife} months` : <ReviewMissing />}
                  </ReviewRow>
                  {preparationType ? (
                    <ReviewRow label="Preparation">
                      <span className="capitalize">{preparationType.replace(/_/g, " ")}</span>
                    </ReviewRow>
                  ) : null}
                </div>
              </div>
            </div>

            {/* Media & Content */}
            <div className="rounded-2xl border border-[#E8DCC8] bg-white p-4 shadow-sm">
              <ReviewSectionHeader
                icon={<ImageIcon className="h-4 w-4" />}
                title="Media & Content"
                subtitle="Product images and description."
                missing={reviewMissing[2]}
                readOnly={mode === "view"}
                onEdit={() => goToEditStep(2)}
              />
              {(() => {
                const mediaUrls = uniq([...thumbnailUrls, ...imageUrls].filter(Boolean))
                const preview = mediaUrls.slice(0, 4)
                const extra = mediaUrls.length - preview.length
                const thumbCount = thumbnailUrls.filter(Boolean).length
                const galleryVideos = imageUrls.filter((u) => isVideoUrl(u)).length
                const galleryImages = imageUrls.length - galleryVideos
                const selectedFeatures = featureCatalog.filter((f) => selectedFeatureDefinitionIds.includes(f.id))
                const filledSections = sections.filter((s) => s.title.trim() || !isEmptyRichText(s.description))
                return (
                  <div className="space-y-4">
                    <div className="grid gap-4 lg:grid-cols-[auto_1fr] lg:items-center">
                      <div className="flex flex-wrap gap-2">
                        {preview.length ? (
                          preview.map((url, idx) => (
                            <button
                              type="button"
                              key={url}
                              onClick={() => setMediaViewerIndex(idx)}
                              title="View media"
                              className="relative h-20 w-20 overflow-hidden rounded-lg border border-[#E8DCC8] bg-[#FFFBF3] transition hover:ring-2 hover:ring-[#7B3010]/40"
                            >
                              {isVideoUrl(url) ? (
                                <div className="flex h-full w-full items-center justify-center bg-[#2A1810]/10 text-[#7B3010]">
                                  <Play className="h-5 w-5" />
                                </div>
                              ) : (
                                // eslint-disable-next-line @next/next/no-img-element
                                <img src={url} alt="" className="h-full w-full object-cover" />
                              )}
                            </button>
                          ))
                        ) : (
                          <p className="text-sm italic text-[#B44444]">No media uploaded yet.</p>
                        )}
                        {extra > 0 ? (
                          <button
                            type="button"
                            onClick={() => setMediaViewerIndex(preview.length)}
                            title="View more media"
                            className="flex h-20 w-20 flex-col items-center justify-center rounded-lg border border-[#E8DCC8] bg-[#F5F1E6] text-[#4A1D1F] transition hover:bg-[#FFEFD6]"
                          >
                            <span className="text-base font-semibold">+{extra}</span>
                            <span className="text-[10px]">View more</span>
                          </button>
                        ) : null}
                        {mediaUrls.length ? (
                          <button
                            type="button"
                            onClick={() => setMediaViewerIndex(0)}
                            className="inline-flex h-8 items-center gap-1.5 self-center rounded-full border border-[#7B3010] px-3 text-[11px] font-semibold uppercase text-[#7B3010] hover:bg-[#FFF7EA]"
                          >
                            <Eye className="h-3.5 w-3.5" />
                            View all ({mediaUrls.length})
                          </button>
                        ) : null}
                      </div>
                      <Dialog
                        open={mediaViewerIndex !== null && mediaUrls.length > 0}
                        onOpenChange={(open) => {
                          if (!open) setMediaViewerIndex(null)
                        }}
                      >
                        <DialogContent className="max-w-4xl">
                          {(() => {
                            const total = mediaUrls.length
                            const current = Math.min(Math.max(mediaViewerIndex ?? 0, 0), Math.max(total - 1, 0))
                            const url = mediaUrls[current]
                            if (!url) return null
                            const isThumb = thumbnailUrls.includes(url)
                            const step = (delta: number) => setMediaViewerIndex((current + delta + total) % total)
                            return (
                              <div className="space-y-3">
                                <DialogHeader>
                                  <DialogTitle className="text-[#4A1D1F]">Product Media</DialogTitle>
                                  <DialogDescription>
                                    {current + 1} of {total} · {isThumb ? "Thumbnail" : "Gallery"} {isVideoUrl(url) ? "video" : "image"}
                                  </DialogDescription>
                                </DialogHeader>
                                <div className="relative flex h-[55vh] items-center justify-center overflow-hidden rounded-xl bg-[#FFFBF3]">
                                  {isVideoUrl(url) ? (
                                    <video key={url} src={url} controls className="max-h-full max-w-full" />
                                  ) : (
                                    // eslint-disable-next-line @next/next/no-img-element
                                    <img src={url} alt="" className="max-h-full max-w-full object-contain" />
                                  )}
                                  {total > 1 ? (
                                    <>
                                      <button
                                        type="button"
                                        onClick={() => step(-1)}
                                        aria-label="Previous media"
                                        className="absolute left-2 top-1/2 flex h-9 w-9 -translate-y-1/2 items-center justify-center rounded-full bg-white/90 text-[#4A1D1F] shadow hover:bg-white"
                                      >
                                        <ChevronLeft className="h-5 w-5" />
                                      </button>
                                      <button
                                        type="button"
                                        onClick={() => step(1)}
                                        aria-label="Next media"
                                        className="absolute right-2 top-1/2 flex h-9 w-9 -translate-y-1/2 items-center justify-center rounded-full bg-white/90 text-[#4A1D1F] shadow hover:bg-white"
                                      >
                                        <ChevronRight className="h-5 w-5" />
                                      </button>
                                    </>
                                  ) : null}
                                </div>
                                <div className="flex gap-2 overflow-x-auto pb-1">
                                  {mediaUrls.map((thumbUrl, idx) => (
                                    <button
                                      type="button"
                                      key={thumbUrl}
                                      onClick={() => setMediaViewerIndex(idx)}
                                      className={`relative h-16 w-16 shrink-0 overflow-hidden rounded-lg border-2 ${
                                        idx === current ? "border-[#7B3010]" : "border-transparent opacity-70 hover:opacity-100"
                                      }`}
                                    >
                                      {isVideoUrl(thumbUrl) ? (
                                        <div className="flex h-full w-full items-center justify-center bg-[#2A1810]/10 text-[#7B3010]">
                                          <Play className="h-4 w-4" />
                                        </div>
                                      ) : (
                                        // eslint-disable-next-line @next/next/no-img-element
                                        <img src={thumbUrl} alt="" className="h-full w-full object-cover" />
                                      )}
                                    </button>
                                  ))}
                                </div>
                              </div>
                            )
                          })()}
                        </DialogContent>
                      </Dialog>
                      <div>
                        <ReviewRow label="Thumbnail Images">
                          {thumbCount ? `${thumbCount} image${thumbCount === 1 ? "" : "s"}` : <ReviewMissing />}
                        </ReviewRow>
                        <ReviewRow label="Gallery Images / Video">
                          {imageUrls.length
                            ? `${imageUrls.length} item${imageUrls.length === 1 ? "" : "s"} (${galleryImages} image${galleryImages === 1 ? "" : "s"}${galleryVideos ? `, ${galleryVideos} video${galleryVideos === 1 ? "" : "s"}` : ""})`
                            : "—"}
                        </ReviewRow>
                      </div>
                    </div>
                    <div className="grid gap-x-10 border-t border-[#F0E8DC] pt-3 md:grid-cols-2">
                      <div>
                        <ReviewRow label="Description">
                          {isEmptyRichText(description) ? (
                            <ReviewMissing />
                          ) : (
                            <div
                              className="prose prose-sm max-w-none font-normal text-[#2A1810] [&_ol]:list-decimal [&_ol]:pl-5 [&_p]:mb-1 [&_ul]:list-disc [&_ul]:pl-5"
                              dangerouslySetInnerHTML={{ __html: description }}
                            />
                          )}
                        </ReviewRow>
                      </div>
                      <div>
                        <ReviewRow label="Features">
                          {selectedFeatures.length ? (
                            <div className="flex flex-wrap gap-1.5">
                              {selectedFeatures.map((f) => (
                                <span
                                  key={f.id}
                                  className="inline-flex items-center gap-1.5 rounded-full border border-[#E8DCC8] bg-[#FFFBF3] px-2 py-0.5 text-xs"
                                >
                                  {f.icon ? (
                                    // eslint-disable-next-line @next/next/no-img-element
                                    <img src={f.icon} alt="" className="h-4 w-4 rounded object-cover" />
                                  ) : null}
                                  {f.title}
                                </span>
                              ))}
                            </div>
                          ) : (
                            <ReviewMissing />
                          )}
                        </ReviewRow>
                        <ReviewRow label="Detail Sections">
                          {filledSections.length ? (
                            <ul className="space-y-0.5">
                              {filledSections.map((s, idx) => (
                                <li key={`${s.id ?? "sec"}-${idx}`} className="text-sm">
                                  {idx + 1}. {s.title.trim() || "Untitled section"}
                                  {!s.isActive ? <span className="ml-1 text-[11px] text-[#8A8A82]">(hidden)</span> : null}
                                </li>
                              ))}
                            </ul>
                          ) : (
                            "—"
                          )}
                        </ReviewRow>
                      </div>
                    </div>
                  </div>
                )
              })()}
            </div>

            {/* Pricing & Inventory */}
            <div className="rounded-2xl border border-[#E8DCC8] bg-white p-4 shadow-sm">
              <ReviewSectionHeader
                icon={<Tag className="h-4 w-4" />}
                title="Pricing & Inventory"
                subtitle="Variants, pricing and stock details."
                missing={reviewMissing[3]}
                readOnly={mode === "view"}
                onEdit={() => goToEditStep(3)}
              />
              <div className="overflow-x-auto rounded-xl border border-[#E8DCC8]">
                <table className="min-w-[980px] w-full border-collapse text-center text-sm">
                  <thead>
                    <tr className="border-b border-[#E8DCC8] bg-[#FFFBF3] text-[11px] font-semibold text-[#4A1D1F]">
                      <th className="px-2 py-2.5">#</th>
                      <th className="px-2 py-2.5">Weight / Size</th>
                      <th className="px-2 py-2.5">Unit</th>
                      <th className="px-2 py-2.5">MRP (₹)</th>
                      <th className="px-2 py-2.5">Discount %</th>
                      <th className="px-2 py-2.5">Sale Price (₹)</th>
                      <th className="px-2 py-2.5">Stock</th>
                      <th className="px-2 py-2.5">SKU</th>
                      <th className="px-2 py-2.5">HSN Code</th>
                      <th className="px-2 py-2.5">EAN / GTIN / Barcode</th>
                      <th className="px-2 py-2.5">Default</th>
                    </tr>
                  </thead>
                  <tbody>
                    {(variantMode === "single" ? variants.slice(0, 1) : variants).map((variant, idx) => {
                      const weightParts = parseWeight(variant.weight)
                      const discNum = Number(variant.discountPercent || 0)
                      const salePrice = variantSalePrice(variant, discountEnabled)
                      const missingCell = <span className="italic text-[#B44444]">—</span>
                      return (
                        <tr key={`${variant.id ?? "rev"}-${idx}`} className="border-b border-[#F0E8DC] last:border-b-0">
                          <td className="px-2 py-2.5 text-xs text-[#646464]">{idx + 1}</td>
                          <td className="px-2 py-2.5 text-[#2A1810]">{weightParts.value || missingCell}</td>
                          <td className="px-2 py-2.5 text-[#2A1810]">{weightParts.unit || "gm"}</td>
                          <td className="px-2 py-2.5 text-[#2A1810]">{Number(variant.mrp) > 0 ? variant.mrp : missingCell}</td>
                          <td className="px-2 py-2.5">
                            {discNum > 0 ? (
                              <span
                                title={discountEnabled ? undefined : "Discount is turned off — not applied"}
                                className={`rounded px-2 py-0.5 text-xs font-semibold ${
                                  discountEnabled ? "bg-[#E8F5E9] text-[#2E7D32]" : "bg-[#F0F0EC] text-[#8A8A82] line-through"
                                }`}
                              >
                                {discNum}%
                              </span>
                            ) : (
                              "—"
                            )}
                          </td>
                          <td className="px-2 py-2.5 text-[#2A1810]">{salePrice > 0 ? salePrice.toFixed(2) : missingCell}</td>
                          <td className="px-2 py-2.5 text-[#2A1810]">{variant.stock || "0"}</td>
                          <td className="px-2 py-2.5 text-[#2A1810]">{variant.sku.trim() || missingCell}</td>
                          <td className="px-2 py-2.5 text-[#2A1810]">{variant.hsnCode || "—"}</td>
                          <td className="px-2 py-2.5 text-[#2A1810]">{variant.eanCode || "—"}</td>
                          <td className="px-2 py-2.5">
                            <span
                              className={`inline-flex h-4 w-4 items-center justify-center rounded-full border-2 ${
                                variant.isDefault || (variantMode === "single" && idx === 0)
                                  ? "border-[#7B3010]"
                                  : "border-[#D9D9D1]"
                              }`}
                            >
                              {variant.isDefault || (variantMode === "single" && idx === 0) ? (
                                <span className="h-2 w-2 rounded-full bg-[#7B3010]" />
                              ) : null}
                            </span>
                          </td>
                        </tr>
                      )
                    })}
                  </tbody>
                </table>
              </div>
              <div className="mt-3 flex flex-wrap items-center gap-x-5 gap-y-2 rounded-xl bg-[#FFF1E8] px-4 py-3 text-xs text-[#4A1D1F]">
                <span className="inline-flex items-center gap-2 font-semibold text-[#7B3010]">
                  <span className="flex h-6 w-6 items-center justify-center rounded-md bg-[#7B3010]/10">
                    <Percent className="h-3.5 w-3.5" />
                  </span>
                  Product Discount
                </span>
                <span className="inline-flex items-center gap-2">
                  Enable Discount
                  <span className={`relative inline-flex h-5 w-9 rounded-full ${discountEnabled ? "bg-[#7B3010]" : "bg-[#D9D9D1]"}`}>
                    <span
                      className={`absolute top-0.5 h-4 w-4 rounded-full bg-white shadow ${discountEnabled ? "right-0.5" : "left-0.5"}`}
                    />
                  </span>
                  <span className="font-semibold">{discountEnabled ? "ON" : "OFF"}</span>
                </span>
                <span className="h-4 w-px bg-[#E8DCC8]" />
                <span>
                  Website price{" "}
                  <strong className="ml-2 font-semibold">
                    {discountEnabled ? "Sale price (MRP struck through)" : "MRP (no discount)"}
                  </strong>
                </span>
              </div>
            </div>

            {/* SEO & Channels */}
            <div className="rounded-2xl border border-[#E8DCC8] bg-white p-4 shadow-sm">
              <ReviewSectionHeader
                icon={<Search className="h-4 w-4" />}
                title="SEO & Channels"
                subtitle="Search engine optimization and external links."
                missing={reviewMissing[4]}
                readOnly={mode === "view"}
                onEdit={() => goToEditStep(4)}
              />
              <div className="grid gap-6 md:grid-cols-[1.4fr_1fr]">
                <div>
                  <ReviewRow label="Meta Title">{metaTitle.trim() || <ReviewMissing />}</ReviewRow>
                  <ReviewRow label="Meta Description">
                    {metaDescription.trim() ? (
                      <span className="font-normal leading-relaxed">{metaDescription}</span>
                    ) : (
                      <ReviewMissing />
                    )}
                  </ReviewRow>
                  <ReviewRow label="Product URL (Slug)">
                    <span className="break-all font-normal">
                      https://www.ziply5.com/products/{slug || "your-product-slug"}
                    </span>
                  </ReviewRow>
                </div>
                <div>
                  <p className="mb-2 text-xs font-semibold text-[#4A1D1F]">External Marketplace Links</p>
                  <div className="flex items-center gap-3 rounded-lg border border-[#E8DCC8] px-3 py-2 text-sm">
                    <span className="w-24 shrink-0 font-medium text-[#2A1810]">Amazon Link</span>
                    <span className="text-[#8A8A82]">:</span>
                    {amazonLink.trim() ? (
                      <a
                        href={amazonLink}
                        target="_blank"
                        rel="noopener noreferrer"
                        className="min-w-0 truncate text-[#7B3010] hover:underline"
                        title={amazonLink}
                      >
                        {amazonLink}
                      </a>
                    ) : (
                      <span className="text-[#8A8A82]">Not added</span>
                    )}
                  </div>
                </div>
              </div>
            </div>
          </div>
        ) : null}

        {/* Wizard footer */}
        {mode !== "view" && (
          <div className="md:col-span-3 flex flex-col gap-3 border-t border-[#E8DCC8] pt-4 sm:flex-row sm:items-center sm:justify-between">
            <div className="space-y-3">
              {currentStep === 5 ? (
                <label className="flex max-w-md cursor-pointer items-start gap-2.5 text-sm text-[#2A1810]">
                  <Checkbox
                    checked={reviewConfirmed}
                    onCheckedChange={(v) => setReviewConfirmed(Boolean(v))}
                    className="mt-0.5"
                  />
                  <span>
                    I confirm that all product information is accurate and complies with Ziply5&apos;s policies.
                    <span className="block text-xs text-[#646464]">
                      By publishing, you agree to our content and product guidelines.
                    </span>
                  </span>
                </label>
              ) : null}
              <Button
                type="button"
                variant="outline"
                disabled={currentStep <= 1}
                onClick={() => setCurrentStep((prev) => Math.max(1, (prev - 1) as ProductFormStepId) as ProductFormStepId)}
                className="rounded-full border-[#7B3010] px-4 text-xs font-semibold uppercase text-[#7B3010]"
              >
                ← Previous
              </Button>
            </div>
            <div className="flex flex-wrap gap-2">
              <Button
                type="button"
                variant="outline"
                disabled={saving || uploadingThumbnails || uploadingGallery || uploadingIcon || draftSaveStatus === "saving"}
                onClick={() => void onSubmit({ preventDefault() {} } as React.FormEvent, "draft")}
                className={`inline-flex items-center gap-1.5 rounded-full border-[#E8DCC8] px-4 text-xs font-semibold uppercase ${
                  draftSaveStatus === "saved"
                    ? "bg-[#E8F5E9] text-[#1B5E20] border-[#A5D6A7]"
                    : "bg-[#FFF7EA] text-[#4A1D1F]"
                }`}
              >
                <Save className="h-3.5 w-3.5" />
                {draftSaveStatus === "saving" || (saving && status === "draft")
                  ? "Saving Draft..."
                  : draftSaveStatus === "saved"
                    ? "Draft Saved"
                    : "Save Draft"}
              </Button>
              {currentStep < 5 ? (
                <Button
                  type="button"
                  onClick={() => {
                    if (currentStep === 1 && (!name.trim() || !slug.trim())) {
                      setError("Name and slug are required before continuing")
                      return
                    }
                    setError("")
                    setCurrentStep((prev) => Math.min(5, (prev + 1) as ProductFormStepId) as ProductFormStepId)
                  }}
                  className="rounded-full bg-[#7B3010] px-4 text-xs font-semibold uppercase text-white"
                >
                  Next Step →
                </Button>
              ) : (
                <Button
                  type="button"
                  disabled={saving || !reviewConfirmed || reviewMissingCount > 0 || uploadingThumbnails || uploadingGallery || uploadingIcon}
                  title={reviewMissingCount > 0 ? "Complete the missing details before publishing" : undefined}
                  onClick={() => {
                    if (reviewMissingCount > 0) {
                      setError("Complete the missing details before publishing")
                      return
                    }
                    if (!reviewConfirmed) {
                      setError("Please confirm the product details before publishing")
                      return
                    }
                    void onSubmit({ preventDefault() {} } as React.FormEvent, "published")
                  }}
                  className="inline-flex items-center gap-1.5 rounded-full bg-[#7B3010] px-4 text-xs font-semibold uppercase text-white disabled:opacity-50"
                >
                  <Rocket className="h-3.5 w-3.5" />
                  {saving ? "Publishing..." : "Publish Product"}
                </Button>
              )}
            </div>
          </div>
        )}
      </form>
      )}
    </section>
  )
}
