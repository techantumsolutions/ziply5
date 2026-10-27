"use client"

import { useEffect, useMemo, useState } from "react"
import { createPortal } from "react-dom"
import { authedFetch, authedPost, authedPut } from "@/lib/dashboard-fetch"
import { uploadAdminImage } from "@/lib/admin-upload"
import { Loader2, Plus, X, Search, RotateCw } from "lucide-react"
import { cn } from "@/lib/utils"
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select"

type ProductVariantLite = {
  id: string
  name: string
  weight?: string | null
  price: number
  mrp?: number | null
  sku?: string | null
  stock?: number
  isDefault?: boolean
}

type ProductLite = {
  id: string
  name: string
  slug: string
  type?: string
  sku?: string | null
  thumbnail?: string | null
  price: number
  basePrice?: number | null
  categoryId?: string | null
  categoryName?: string | null
  categorySlug?: string | null
  dietary: "veg" | "non-veg"
  variants?: ProductVariantLite[]
}

const generateSlug = (text: string) =>
  text
    .toLowerCase()
    .trim()
    .replace(/[^\w\s-]/g, "")
    .replace(/\s+/g, "-")
    .replace(/--+/g, "-")
    .replace(/^-+|-+$/g, "")

type ComboFormProps = {
  bundleId?: string
  onSaved?: (bundleId: string) => void
  onCancel?: () => void
  className?: string
}

type BundlePayload = {
  name: string
  slug: string
  pricingMode: "fixed" | "dynamic"
  comboPrice?: number | null
  description?: string | null
  image?: string | null
  isActive: boolean
  productIds: string[]
  productPrices: Array<{ productId: string; comboPrice: number; variantId?: string | null }>
}

const MODAL_PAGE_SIZE = 15

const DEFAULT_CATEGORIES = [
  { id: "breakfast", name: "Breakfast", slug: "breakfast" },
  { id: "lunch", name: "Lunch", slug: "lunch" },
  { id: "dinner", name: "Dinner", slug: "dinner" },
]

export function ComboForm({ bundleId, onSaved, onCancel, className }: ComboFormProps) {
  const [name, setName] = useState("")
  const [slug, setSlug] = useState("")
  const [slugEdited, setSlugEdited] = useState(false)
  const [pricingMode, setPricingMode] = useState<"fixed" | "dynamic">("fixed")
  const [comboPrice, setComboPrice] = useState("")
  const [description, setDescription] = useState("")
  const [image, setImage] = useState("")
  const [isActive, setIsActive] = useState(true)
  const [selectedProductIds, setSelectedProductIds] = useState<string[]>([])
  const [selectedVariants, setSelectedVariants] = useState<Record<string, string>>({})
  const [variantPromptProduct, setVariantPromptProduct] = useState<ProductLite | null>(null)
  const [products, setProducts] = useState<ProductLite[]>([])
  const [categories, setCategories] = useState<Array<{ id: string; name: string; slug: string }>>(DEFAULT_CATEGORIES)
  const [dietaryFilter, setDietaryFilter] = useState<"all" | "veg" | "non-veg">("all")
  const [search, setSearch] = useState("")
  const [loading, setLoading] = useState(false)
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState("")
  const [removedProductNames, setRemovedProductNames] = useState<string[]>([])
  const [imageUploading, setImageUploading] = useState(false)

  // Product Selection Modal state
  const [isProductModalOpen, setIsProductModalOpen] = useState(false)
  const [modalPage, setModalPage] = useState(1)
  const [mounted, setMounted] = useState(false)

  useEffect(() => {
    setMounted(true)
  }, [])

  useEffect(() => {
    if (!isProductModalOpen && !variantPromptProduct) return
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === "Escape") {
        if (variantPromptProduct) {
          setVariantPromptProduct(null)
        } else {
          setIsProductModalOpen(false)
        }
      }
    }
    window.addEventListener("keydown", handleKeyDown)
    const prevOverflow = document.body.style.overflow
    document.body.style.overflow = "hidden"
    return () => {
      window.removeEventListener("keydown", handleKeyDown)
      document.body.style.overflow = prevOverflow
    }
  }, [isProductModalOpen, variantPromptProduct])

  useEffect(() => {
    let cancelled = false
    setLoading(true)
    Promise.all([
      authedFetch<{ items?: any[] }>("/api/v1/products?page=1&limit=500"),
      authedFetch<{ data?: any[] } | any[]>("/api/v1/categories").catch(() => null),
      bundleId ? authedFetch<any>(`/api/admin/bundles/${bundleId}`) : Promise.resolve(null),
    ])
      .then(([productsRes, catsRes, bundleRes]) => {
        if (cancelled) return

        // Map categories if available, ensuring the 3 core categories Breakfast, Lunch, Dinner
        const catRows = Array.isArray(catsRes)
          ? catsRes
          : Array.isArray((catsRes as any)?.data)
          ? (catsRes as any).data
          : []
        if (catRows.length > 0) {
          const fetchedCats = catRows
            .map((c: any) => ({
              id: String(c.id || c.slug),
              name: String(c.name || c.title),
              slug: String(c.slug || c.id).toLowerCase(),
            }))
            .filter((c: any) => ["breakfast", "lunch", "dinner"].includes(c.slug.toLowerCase()) || ["breakfast", "lunch", "dinner"].includes(c.name.toLowerCase()))

          if (fetchedCats.length > 0) {
            const existingSlugs = new Set(fetchedCats.map((x: any) => x.slug.toLowerCase()))
            const extras = DEFAULT_CATEGORIES.filter((d) => !existingSlugs.has(d.slug.toLowerCase()))
            setCategories([...fetchedCats, ...extras])
          } else {
            setCategories(DEFAULT_CATEGORIES)
          }
        } else {
          setCategories(DEFAULT_CATEGORIES)
        }

        const rows = (productsRes as any)?.items ?? (productsRes as any)?.data?.items ?? []
        const lite: ProductLite[] = (Array.isArray(rows) ? rows : [])
          .filter((p) => p?.id && p?.name && p?.slug && p?.status === "published" && p?.isActive !== false)
          .map((p) => {
            const cat = Array.isArray(p.categories) && p.categories[0]
              ? p.categories[0].category || p.categories[0]
              : p.category || null

            const tagNames = (p.tags || [])
              .map((t: any) => (t.tag?.name || t.name || "").toLowerCase())
              .filter(Boolean)

            const isNonVeg =
              tagNames.includes("non-veg") ||
              tagNames.includes("nonveg") ||
              tagNames.includes("non-vegetarian") ||
              p.foodType === "non-veg" ||
              /\b(chicken|mutton|fish|prawn|egg|meat|seafood|keema)\b/i.test(p.name || "")

            const variants: ProductVariantLite[] = Array.isArray(p.variants)
              ? p.variants.map((v: any) => ({
                  id: String(v.id),
                  name: String(v.name || v.weight || "Variant"),
                  weight: v.weight ? String(v.weight) : null,
                  price: Number(v.price ?? 0),
                  mrp: v.mrp != null ? Number(v.mrp) : (v.price != null ? Number(v.price) : null),
                  sku: v.sku ? String(v.sku) : null,
                  stock: Number(v.stock ?? 0),
                  isDefault: Boolean(v.isDefault),
                }))
              : []

            return {
              id: String(p.id),
              name: String(p.name),
              slug: String(p.slug),
              type: String(p.type || "simple"),
              sku: p.sku ? String(p.sku) : null,
              thumbnail: p.thumbnail ? String(p.thumbnail) : null,
              price: Number(p.price ?? 0),
              basePrice: p.basePrice != null ? Number(p.basePrice) : Number(p.price ?? 0),
              categoryId: cat?.id ? String(cat.id) : (p.categoryId ? String(p.categoryId) : null),
              categoryName: cat?.name ? String(cat.name) : null,
              categorySlug: cat?.slug ? String(cat.slug) : null,
              dietary: isNonVeg ? "non-veg" : "veg",
              variants,
            }
          })
        setProducts(lite)

        if (bundleRes) {
          setName(bundleRes.name ?? "")
          setSlug(bundleRes.slug ?? "")
          if (bundleRes.slug) setSlugEdited(true)
          setPricingMode(bundleRes.pricingMode === "dynamic" ? "dynamic" : "fixed")
          setComboPrice(bundleRes.comboPrice != null ? String(bundleRes.comboPrice) : "")
          setDescription(bundleRes.description ?? "")
          setImage(bundleRes.image ?? "")
          const bundleProducts = Array.isArray(bundleRes.products) ? bundleRes.products : []
          const publishedIds = new Set(lite.map((x) => x.id))
          const kept = bundleProducts.filter((bp: any) => {
            const id = String(bp.productId || bp.id || "")
            const published = String(bp.status ?? "").toLowerCase() === "published"
            return id && (published || publishedIds.has(id))
          })
          const removed = bundleProducts.filter((bp: any) => !kept.includes(bp))
          setRemovedProductNames(removed.map((bp: any) => String(bp.name || "Unpublished product")))
          setSelectedProductIds(kept.map((bp: any) => String(bp.productId || bp.id)))

          const savedVariants: Record<string, string> = {}
          const savedPrices: Record<string, string> = {}
          for (const bp of kept) {
            const id = String(bp.productId || bp.id)
            if (bp.variantId) {
              savedVariants[id] = String(bp.variantId)
            }
            if (bp.comboPrice != null && bp.comboPrice !== "") {
              savedPrices[id] = String(bp.comboPrice)
            } else {
              const prod = lite.find((x) => x.id === id) || bp
              const chosenVariant = prod.variants?.find((v: any) => v.id === bp.variantId)
              const defaultPrice = chosenVariant
                ? (chosenVariant.mrp != null && chosenVariant.mrp > 0 ? chosenVariant.mrp : chosenVariant.price)
                : (prod.basePrice != null && prod.basePrice > 0 ? prod.basePrice : (prod.price ?? 0))
              savedPrices[id] = String(defaultPrice)
            }
          }
          setSelectedVariants(savedVariants)
          setItemComboPrices(savedPrices)
          setIsActive(kept.length >= 2 && bundleRes.isActive !== false)

          const extraLites: ProductLite[] = kept
            .filter((bp: any) => !publishedIds.has(String(bp.productId || bp.id)))
            .map((bp: any) => {
              const tagNames = (bp.tags || []).map((t: any) => (t.tag?.name || t.name || "").toLowerCase())
              const isNonVeg =
                tagNames.includes("non-veg") ||
                tagNames.includes("nonveg") ||
                tagNames.includes("non-vegetarian") ||
                bp.foodType === "non-veg" ||
                /\b(chicken|mutton|fish|prawn|egg|meat|seafood|keema)\b/i.test(bp.name || "")
              return {
                id: String(bp.productId || bp.id),
                name: String(bp.name),
                slug: String(bp.slug || ""),
                type: bp.variantId ? "variant" : "simple",
                price: Number(bp.price ?? 0),
                basePrice: bp.basePrice != null ? Number(bp.basePrice) : Number(bp.price ?? 0),
                thumbnail: bp.thumbnail ?? null,
                dietary: isNonVeg ? "non-veg" : "veg",
                variants: bp.variantId
                  ? [
                      {
                        id: String(bp.variantId),
                        name: String(bp.variantName || bp.variantWeight || "Variant"),
                        weight: bp.variantWeight ? String(bp.variantWeight) : null,
                        price: Number(bp.price ?? 0),
                        mrp: bp.basePrice != null ? Number(bp.basePrice) : Number(bp.price ?? 0),
                        sku: bp.variantSku ? String(bp.variantSku) : null,
                      },
                    ]
                  : [],
              }
            })
          if (extraLites.length > 0) {
            setProducts([...lite, ...extraLites])
          }
        }
      })
      .catch((e) => {
        if (!cancelled) setError(e instanceof Error ? e.message : "Failed to load combo data")
      })
      .finally(() => {
        if (!cancelled) setLoading(false)
      })
    return () => {
      cancelled = true
    }
  }, [bundleId])

  const filteredProducts = useMemo(() => {
    const q = search.trim().toLowerCase()
    return products.filter((p) => {
      const matchesSearch =
        !q ||
        (p.id && p.id.toLowerCase().includes(q)) ||
        p.name.toLowerCase().includes(q) ||
        p.slug.toLowerCase().includes(q) ||
        (p.sku && p.sku.toLowerCase().includes(q))

      const matchesDietary =
        dietaryFilter === "all" || p.dietary === dietaryFilter

      return matchesSearch && matchesDietary
    })
  }, [products, search, dietaryFilter])

  const totalModalPages = Math.max(1, Math.ceil(filteredProducts.length / MODAL_PAGE_SIZE))
  const paginatedProducts = useMemo(() => {
    const start = (modalPage - 1) * MODAL_PAGE_SIZE
    return filteredProducts.slice(start, start + MODAL_PAGE_SIZE)
  }, [filteredProducts, modalPage])

  const [itemComboPrices, setItemComboPrices] = useState<Record<string, string>>({})

  const getProductVariant = (p?: ProductLite) => {
    if (!p) return null
    const variantId = selectedVariants[p.id]
    if (!variantId) return null
    return p.variants?.find((v) => v.id === variantId) ?? null
  }

  const getProductEffectivePrice = (p?: ProductLite) => {
    if (!p) return 0
    const variant = getProductVariant(p)
    if (variant) {
      return variant.mrp != null && variant.mrp > 0 ? variant.mrp : variant.price
    }
    return p.basePrice != null && p.basePrice > 0 ? p.basePrice : p.price
  }

  const sumOfSelectedPrices = useMemo(() => {
    return selectedProductIds.reduce((sum, id) => {
      const prod = products.find((p) => p.id === id)
      const maxPrice = getProductEffectivePrice(prod)
      const customPriceStr = itemComboPrices[id]
      const customPrice = customPriceStr !== undefined && customPriceStr.trim() !== "" ? Number(customPriceStr) : maxPrice
      return sum + (Number.isFinite(customPrice) ? customPrice : 0)
    }, 0)
  }, [selectedProductIds, products, itemComboPrices, selectedVariants])

  const isPriceTooHigh = useMemo(() => {
    if (pricingMode !== "fixed" || selectedProductIds.length === 0 || !comboPrice) return false
    const priceNum = Number(comboPrice)
    return sumOfSelectedPrices > 0 && priceNum >= sumOfSelectedPrices
  }, [pricingMode, selectedProductIds, comboPrice, sumOfSelectedPrices])

  const validateForm = (): string | null => {
    if (name.trim().length < 2) return "Please enter a combo name (at least 2 characters)."
    if (!slug || !/^[a-z0-9_-]+$/.test(slug)) return "Please enter a valid URL slug (lowercase letters, numbers, and hyphens)."
    if (selectedProductIds.length > 3) return "You can select a maximum of 3 products."

    for (const id of selectedProductIds) {
      const p = products.find((x) => x.id === id)
      if (!p) continue
      const maxPrice = getProductEffectivePrice(p)
      const customPriceStr = itemComboPrices[id]
      if (customPriceStr !== undefined && customPriceStr.trim() !== "") {
        const val = Number(customPriceStr)
        if (!Number.isFinite(val) || val < 0) {
          return `Please enter a valid combo price for "${p.name}".`
        }
        if (val > maxPrice) {
          return `Combo price for "${p.name}" (₹${val.toFixed(2)}) cannot be greater than its base price (₹${maxPrice.toFixed(2)}).`
        }
      }
    }

    return null
  }

  const removeProduct = (productId: string) => {
    setSelectedProductIds((prev) => prev.filter((id) => id !== productId))
    setSelectedVariants((prev) => {
      const next = { ...prev }
      delete next[productId]
      return next
    })
    setItemComboPrices((prev) => {
      const next = { ...prev }
      delete next[productId]
      return next
    })
  }

  const selectSimpleProduct = (productId: string) => {
    if (selectedProductIds.includes(productId)) return
    if (selectedProductIds.length >= 3) return
    setSelectedProductIds((prev) => [...prev, productId])
    const prod = products.find((x) => x.id === productId)
    const defaultPrice = prod ? (prod.basePrice != null && prod.basePrice > 0 ? prod.basePrice : prod.price) : 0
    setItemComboPrices((prev) => ({
      ...prev,
      [productId]: String(defaultPrice),
    }))
  }

  const selectProductVariant = (product: ProductLite, variant: ProductVariantLite) => {
    setSelectedProductIds((prev) => {
      if (prev.includes(product.id)) return prev
      if (prev.length >= 3) return prev
      return [...prev, product.id]
    })
    setSelectedVariants((prev) => ({
      ...prev,
      [product.id]: variant.id,
    }))
    const variantBasePrice = variant.mrp != null && variant.mrp > 0 ? variant.mrp : variant.price
    setItemComboPrices((prev) => ({
      ...prev,
      [product.id]: String(variantBasePrice),
    }))
    setVariantPromptProduct(null)
  }

  const toggleProduct = (productId: string) => {
    if (selectedProductIds.includes(productId)) {
      removeProduct(productId)
    } else {
      const prod = products.find((x) => x.id === productId)
      if (prod?.type === "variant" && (prod.variants?.length ?? 0) > 0) {
        setVariantPromptProduct(prod)
      } else {
        selectSimpleProduct(productId)
      }
    }
  }

  const save = async () => {
    const validationError = validateForm()
    if (validationError) {
      setError(validationError)
      return
    }
    setSaving(true)
    setError("")
    const payload: BundlePayload = {
      name: name.trim(),
      slug: slug.trim(),
      pricingMode,
      comboPrice: Number(sumOfSelectedPrices.toFixed(2)),
      description: description.trim() || null,
      image: image.trim() || null,
      isActive: selectedProductIds.length >= 2 ? isActive : false,
      productIds: selectedProductIds,
      productPrices: selectedProductIds.map((id) => {
        const prod = products.find((item) => item.id === id)
        const maxPrice = getProductEffectivePrice(prod)
        const custom = itemComboPrices[id]
        const parsed = custom != null && custom.trim() !== "" ? Number(custom) : maxPrice
        return {
          productId: id,
          comboPrice: Number((Number.isFinite(parsed) ? parsed : maxPrice).toFixed(2)),
          variantId: selectedVariants[id] || null,
        }
      }),
    }
    try {
      const result = bundleId
        ? await authedPut<any>(`/api/admin/bundles/${bundleId}`, payload)
        : await authedPost<any>("/api/admin/bundles", payload)
      onSaved?.(String(result.id))
    } catch (e) {
      setError(e instanceof Error ? e.message : "Failed to save combo")
    } finally {
      setSaving(false)
    }
  }

  return (
    <div className={cn("space-y-6", className)}>
      {error ? <p className="rounded-xl border border-red-200 bg-red-50 p-3 text-sm text-red-800">{error}</p> : null}
      {loading ? <p className="text-sm text-[#646464]">Loading…</p> : null}

      {/* 1. Basic Details */}
      <div className="space-y-3">
        <div className="flex items-center gap-2">
          <span className="flex h-6 w-6 shrink-0 items-center justify-center rounded-full bg-[#7B3010] text-xs font-bold text-white">
            1
          </span>
          <h3 className="text-sm font-semibold text-[#4A1D1F]">Basic Details</h3>
        </div>
        <div className="grid gap-3 sm:grid-cols-2">
          <label className="block text-sm">
            <span className="text-xs font-semibold text-[#7A7A7A]">
              Combo Name <span className="text-red-500">*</span>
            </span>
            <input
              className="mt-1 w-full rounded-lg border border-[#E8DCC8] bg-white px-3 py-2 text-sm text-[#4A1D1F] focus:border-[#7B3010] focus:outline-none"
              placeholder="Enter combo name"
              value={name}
              onChange={(e) => {
                const newName = e.target.value
                setName(newName)
                if (!slugEdited) {
                  setSlug(generateSlug(newName))
                }
              }}
            />
          </label>
          <label className="block text-sm">
            <span className="text-xs font-semibold text-[#7A7A7A]">Slug</span>
            <div className="relative mt-1">
              <input
                className="w-full rounded-lg border border-[#E8DCC8] bg-white px-3 py-2 pr-9 text-sm font-mono text-[#4A1D1F] focus:border-[#7B3010] focus:outline-none"
                placeholder="e.g. breakfast-combo"
                value={slug}
                onChange={(e) => {
                  const val = e.target.value.toLowerCase().replace(/\s+/g, "-").replace(/[^a-z0-9_-]/g, "")
                  setSlug(val)
                  setSlugEdited(val.trim().length > 0)
                }}
              />
              <button
                type="button"
                title="Regenerate slug from name"
                onClick={() => {
                  setSlug(generateSlug(name))
                  setSlugEdited(false)
                }}
                className="absolute right-2 top-1/2 -translate-y-1/2 p-1 text-[#7A7A7A] hover:text-[#7B3010] rounded transition-colors"
              >
                <RotateCw className="h-3.5 w-3.5" />
              </button>
            </div>
          </label>
        </div>
      </div>

      {/* 2. Image & Description */}
      <div className="space-y-3">
        <div className="flex items-center gap-2">
          <span className="flex h-6 w-6 shrink-0 items-center justify-center rounded-full bg-[#7B3010] text-xs font-bold text-white">
            2
          </span>
          <h3 className="text-sm font-semibold text-[#4A1D1F]">Image & Description</h3>
        </div>
        <div className="grid gap-3 sm:grid-cols-2">
          <div>
            <label className="block text-sm">
              <span className="text-xs font-semibold text-[#7A7A7A]">
                Combo Image <span className="text-red-500">*</span>
              </span>
              <div className="mt-1 flex flex-wrap items-center gap-3 rounded-xl border border-dashed border-[#E8DCC8] bg-[#FFFBF3]/40 p-3">
                {image ? (
                  <img src={image} alt="" className="h-16 w-16 rounded-lg object-cover border border-[#E8DCC8]" />
                ) : null}
                <div className="space-y-1">
                  <span className="relative inline-flex items-center gap-2">
                    <input
                      type="file"
                      accept="image/*"
                      disabled={imageUploading}
                      className="max-w-[200px] cursor-pointer text-xs file:cursor-pointer file:rounded-md file:border-0 file:bg-[#7B3010] file:px-2.5 file:py-1 file:text-xs file:font-semibold file:text-white"
                      onChange={(e) => {
                        const f = e.target.files?.[0]
                        e.target.value = ""
                        if (!f || !f.type.startsWith("image/")) return
                        setImageUploading(true)
                        void uploadAdminImage(f, "bundles/cover")
                          .then((url) => {
                            if (url) setImage(url)
                          })
                          .catch(() => setError("Image upload failed"))
                          .finally(() => setImageUploading(false))
                      }}
                    />
                    {imageUploading ? <Loader2 className="h-4 w-4 animate-spin text-[#7B3010]" /> : null}
                  </span>
                  {image ? (
                    <button
                      type="button"
                      className="block text-xs font-semibold uppercase text-red-700 hover:underline"
                      onClick={() => setImage("")}
                    >
                      Clear
                    </button>
                  ) : null}
                </div>
              </div>
              <span className="mt-1 block text-[10px] text-[#9A9A92]">Upload only — stored on server.</span>
            </label>
          </div>
          <label className="block text-sm">
            <span className="text-xs font-semibold text-[#7A7A7A]">Description</span>
            <textarea
              rows={3}
              className="mt-1 w-full rounded-lg border border-[#E8DCC8] bg-white px-3 py-2 text-sm text-[#4A1D1F] focus:border-[#7B3010] focus:outline-none"
              value={description}
              onChange={(e) => setDescription(e.target.value)}
              placeholder="Write a short description..."
            />
          </label>
        </div>
      </div>

      {/* 3. Select Products (Max 3) */}
      <div className="space-y-3">
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-2">
            <span className="flex h-6 w-6 shrink-0 items-center justify-center rounded-full bg-[#7B3010] text-xs font-bold text-white">
              3
            </span>
            <h3 className="text-sm font-semibold text-[#4A1D1F]">Select Products (Max 3)</h3>
          </div>
          <span className="text-xs font-medium text-[#7A7A7A]">
            {selectedProductIds.length}/3 selected
          </span>
        </div>

        <button
          type="button"
          onClick={() => {
            setModalPage(1)
            setIsProductModalOpen(true)
          }}
          className="w-full flex items-center justify-center gap-2 rounded-xl border border-dashed border-[#7B3010] bg-[#FFFBF3]/60 py-2.5 px-4 text-xs font-semibold uppercase tracking-wide text-[#7B3010] hover:bg-[#FFFBF3] transition-colors"
        >
          <Plus className="h-4 w-4" />
          Select Products ({selectedProductIds.length}/3)
        </button>

        {/* Selected Products list preview */}
        {selectedProductIds.length === 0 ? (
          <p className="text-center text-xs text-[#9A9A92] py-2">
            No products selected yet. Click &quot;Select Products&quot; to choose up to 3 items.
          </p>
        ) : (
          <div className="space-y-2">
            {selectedProductIds.map((id) => {
              const p = products.find((x) => x.id === id)
              if (!p) return null
              const chosenVariant = getProductVariant(p)
              const maxPrice = getProductEffectivePrice(p)
              const itemVal = itemComboPrices[id] !== undefined ? itemComboPrices[id] : String(maxPrice)
              const numericVal = itemVal.trim() !== "" ? Number(itemVal) : null
              const isItemPriceExceeded = numericVal !== null && Number.isFinite(numericVal) && numericVal > maxPrice
              return (
                <div
                  key={id}
                  className={`flex flex-wrap items-center justify-between gap-3 rounded-xl border p-2.5 transition-colors ${
                    isItemPriceExceeded ? "border-red-300 bg-red-50/50" : "border-[#E8DCC8] bg-[#FFFBF3]/40"
                  }`}
                >
                  <div className="flex items-center gap-2.5 min-w-0 flex-1">
                    {p.thumbnail ? (
                      <img src={p.thumbnail} alt={p.name} className="h-9 w-9 shrink-0 rounded-lg object-cover border border-[#E8DCC8]" />
                    ) : (
                      <div className="h-9 w-9 shrink-0 rounded-lg bg-[#E8DCC8]/40 border border-[#E8DCC8]" />
                    )}
                    <div className="truncate min-w-0">
                      <div className="flex items-center gap-1.5 flex-wrap">
                        <span
                          className={`inline-flex shrink-0 items-center justify-center w-3 h-3 rounded-[2px] border ${
                            p.dietary === "veg" ? "border-[#16A34A]" : "border-[#DC2626]"
                          } bg-white shadow-2xs`}
                          title={p.dietary === "veg" ? "Vegetarian" : "Non-Vegetarian"}
                        >
                          <span
                            className={`w-1.5 h-1.5 rounded-full ${
                              p.dietary === "veg" ? "bg-[#16A34A]" : "bg-[#DC2626]"
                            }`}
                          />
                        </span>
                        <p className="truncate font-semibold text-xs text-[#4A1D1F]">{p.name}</p>
                        {chosenVariant && (
                          <span className="inline-flex items-center rounded-md bg-[#7B3010]/10 px-1.5 py-0.5 text-[10px] font-semibold text-[#7B3010]">
                            {chosenVariant.weight || chosenVariant.name}
                          </span>
                        )}
                      </div>
                      <div className="flex items-center gap-2 mt-0.5">
                        <p className="text-[11px] font-mono text-[#7A7A7A]">Base Price: ₹{maxPrice.toFixed(2)}</p>
                        {p.variants && p.variants.length > 0 && (
                          <button
                            type="button"
                            onClick={() => setVariantPromptProduct(p)}
                            className="text-[10px] font-semibold text-[#7B3010] hover:underline"
                          >
                            Change variant
                          </button>
                        )}
                      </div>
                      {isItemPriceExceeded && (
                        <p className="text-[10px] font-medium text-red-600">Cannot exceed ₹{maxPrice.toFixed(2)}</p>
                      )}
                    </div>
                  </div>

                  <div className="flex items-center gap-2">
                    <div className="relative w-28">
                      <span className="absolute inset-y-0 left-0 flex items-center pl-2 text-xs text-[#7A7A7A]">₹</span>
                      <input
                        type="number"
                        min="0"
                        max={maxPrice}
                        step="0.01"
                        placeholder={maxPrice.toFixed(0)}
                        value={itemVal}
                        onChange={(e) => {
                          const val = e.target.value
                          setItemComboPrices((prev) => ({ ...prev, [id]: val }))
                        }}
                        className={`w-full rounded-lg border pl-5 pr-2 py-1 text-xs font-semibold text-[#4A1D1F] focus:outline-none [appearance:textfield] [&::-webkit-outer-spin-button]:appearance-none [&::-webkit-inner-spin-button]:appearance-none ${
                          isItemPriceExceeded
                            ? "border-red-500 bg-red-50 focus:border-red-600"
                            : "border-[#E8DCC8] bg-white focus:border-[#7B3010]"
                        }`}
                      />
                    </div>
                    <button
                      type="button"
                      onClick={() => removeProduct(id)}
                      className="rounded-lg p-1 text-[#7A7A7A] hover:bg-red-50 hover:text-red-700 transition-colors"
                      title="Remove item"
                    >
                      <X className="h-4 w-4" />
                    </button>
                  </div>
                </div>
              )
            })}
          </div>
        )}

        {/* Total Price & Active Toggle section at the bottom of products */}
        <div className="mt-4 pt-4 border-t border-[#E8DCC8]/60 space-y-3">
          {selectedProductIds.length > 0 && (
            <div className="rounded-xl border border-[#E8DCC8] bg-[#FFFBF3] p-3 flex items-center justify-between">
              <span className="text-xs font-semibold text-[#7A7A7A]">Total Combo Price</span>
              <span className="text-sm font-bold text-[#4A1D1F]">₹{sumOfSelectedPrices.toFixed(2)}</span>
            </div>
          )}

          {removedProductNames.length > 0 ? (
            <p className="rounded-xl border border-amber-200 bg-amber-50 p-3 text-xs text-amber-900">
              Removed products that are not published: {removedProductNames.join(", ")}. The remaining products stay in this combo.
              {selectedProductIds.length < 2 ? " The combo is deactivated because fewer than 2 products remain." : ""}
            </p>
          ) : null}

          <label className={`flex items-center gap-2 pt-1 text-sm font-medium text-[#4A1D1F] ${selectedProductIds.length < 2 ? "cursor-not-allowed opacity-70" : "cursor-pointer"}`}>
            <input
              type="checkbox"
              checked={selectedProductIds.length >= 2 && isActive}
              disabled={selectedProductIds.length < 2}
              onChange={(e) => setIsActive(e.target.checked)}
              className="h-4 w-4 rounded border-[#E8DCC8] text-[#7B3010] accent-[#7B3010] disabled:cursor-not-allowed"
            />
            Active
            {selectedProductIds.length < 2 ? (
              <span className="text-xs font-normal text-[#7A7A7A]">A combo needs at least 2 published products to stay active.</span>
            ) : null}
          </label>
        </div>
      </div>

      {error ? (
        <p className="rounded-xl border border-red-200 bg-red-50 p-3 text-xs font-semibold text-red-800">
          {error}
        </p>
      ) : null}

      {/* Footer Actions */}
      <div className="flex items-center justify-end gap-3 pt-3 border-t border-[#E8DCC8]/60">
        {onCancel && (
          <button
            type="button"
            onClick={onCancel}
            disabled={saving}
            className="rounded-xl border border-[#E8DCC8] bg-white px-5 py-2.5 text-xs font-semibold uppercase tracking-wide text-[#4A1D1F] hover:bg-[#FFFBF3] disabled:opacity-50"
          >
            Cancel
          </button>
        )}
        <button
          type="button"
          onClick={() => void save()}
          disabled={saving}
          className="rounded-xl bg-[#7B3010] px-6 py-2.5 text-xs font-semibold uppercase tracking-wide text-white hover:bg-[#5c2410] disabled:opacity-50 shadow-sm transition-opacity"
        >
          {saving ? "Saving..." : bundleId ? "Update Combo Offer" : "Create Combo Offer"}
        </button>
      </div>

      {/* Product Selection Modal (3 columns x 5 rows = 15 items per page) */}
      {isProductModalOpen && mounted && createPortal(
        <div
          className="fixed inset-0 z-[100] flex items-center justify-center bg-black/60 backdrop-blur-xs p-4 sm:p-6"
          onClick={(e) => {
            if (e.target === e.currentTarget) setIsProductModalOpen(false)
          }}
        >
          <div className="relative w-full max-w-4xl max-h-[90vh] flex flex-col rounded-3xl border border-[#E8DCC8] bg-white shadow-2xl overflow-hidden animate-in fade-in zoom-in-95 duration-200">
            {/* Modal Header */}
            <div className="flex items-center justify-between px-6 py-4 border-b border-[#E8DCC8] bg-[#FFFBF3]/50">
              <div>
                <h3 className="font-melon text-lg font-bold text-[#4A1D1F]">
                  Select Products (Max 3)
                </h3>
                <p className="text-xs text-[#646464]">
                  Choose up to 3 products to include in this combo offer.
                </p>
              </div>
              <div className="flex items-center gap-3">
                <span className="rounded-full bg-[#F0ECE2] px-3 py-1 text-xs font-semibold text-[#7B3010]">
                  {selectedProductIds.length} / 3 selected
                </span>
                <button
                  type="button"
                  onClick={() => setIsProductModalOpen(false)}
                  className="rounded-lg p-1.5 text-[#7A7A7A] hover:bg-white hover:text-[#4A1D1F] transition-colors"
                >
                  <X className="h-5 w-5" />
                </button>
              </div>
            </div>

            {/* Search and Category Filter Row */}
            <div className="px-6 pt-4 pb-2 space-y-3">
              {/* Top Row: Search Input + Category Dropdown */}
              <div className="flex flex-col sm:flex-row items-stretch sm:items-center gap-3">
                <div className="relative flex-1">
                  <Search className="absolute left-3.5 top-1/2 h-4 w-4 -translate-y-1/2 text-[#7A7A7A]" />
                  <input
                    value={search}
                    onChange={(e) => {
                      setSearch(e.target.value)
                      setModalPage(1)
                    }}
                    placeholder="Search products by name or SKU..."
                    className="w-full rounded-xl border border-[#E8DCC8] bg-white pl-10 pr-3 py-2 text-sm text-[#4A1D1F] focus:border-[#7B3010] focus:outline-none placeholder:text-[#9A9A92]"
                  />
                </div>
                <Select
                  value={dietaryFilter}
                  onValueChange={(val) => {
                    setDietaryFilter(val as "all" | "veg" | "non-veg")
                    setModalPage(1)
                  }}
                >
                  <SelectTrigger className="h-10 sm:w-[190px] rounded-xl border border-[#E8DCC8] bg-white px-3.5 text-sm font-medium text-[#4A1D1F] shadow-xs hover:border-[#7B3010]/60 focus-visible:border-[#7B3010] focus-visible:ring-1 focus-visible:ring-[#7B3010]/20">
                    <SelectValue placeholder="All Dietary Tags" />
                  </SelectTrigger>
                  <SelectContent className="z-[150] rounded-xl border border-[#E8DCC8] bg-white p-1 shadow-xl">
                    <SelectItem
                      value="all"
                      className="cursor-pointer rounded-lg px-3 py-2 text-sm text-[#4A1D1F] hover:bg-[#FFFBF3] focus:bg-[#FFFBF3] focus:text-[#7B3010] data-[state=checked]:font-semibold data-[state=checked]:text-[#7B3010]"
                    >
                      All Tags
                    </SelectItem>
                    <SelectItem
                      value="veg"
                      className="cursor-pointer rounded-lg px-3 py-2 text-sm text-[#16A34A] hover:bg-[#FFFBF3] focus:bg-[#FFFBF3] focus:text-[#16A34A] data-[state=checked]:font-semibold data-[state=checked]:text-[#16A34A]"
                    >
                      Veg (Vegetarian)
                    </SelectItem>
                    <SelectItem
                      value="non-veg"
                      className="cursor-pointer rounded-lg px-3 py-2 text-sm text-[#DC2626] hover:bg-[#FFFBF3] focus:bg-[#FFFBF3] focus:text-[#DC2626] data-[state=checked]:font-semibold data-[state=checked]:text-[#DC2626]"
                    >
                      Non-Veg (Non-Vegetarian)
                    </SelectItem>
                  </SelectContent>
                </Select>
              </div>

              {/* Veg / Non-Veg Dietary Tabs Bar */}
              <div className="flex items-center gap-2 overflow-x-auto pb-1 pt-0.5 scrollbar-thin">
                <button
                  type="button"
                  onClick={() => {
                    setDietaryFilter("all")
                    setModalPage(1)
                  }}
                  className={`shrink-0 rounded-full px-4 py-1.5 text-xs font-semibold transition-colors ${
                    dietaryFilter === "all"
                      ? "bg-[#7B3010] text-white shadow-xs"
                      : "bg-[#FFFBF3] border border-[#E8DCC8] text-[#4A1D1F] hover:bg-[#E8DCC8]/40"
                  }`}
                >
                  All ({products.length})
                </button>

                <button
                  type="button"
                  onClick={() => {
                    setDietaryFilter("veg")
                    setModalPage(1)
                  }}
                  className={`shrink-0 rounded-full px-4 py-1.5 text-xs font-semibold transition-colors flex items-center gap-2 ${
                    dietaryFilter === "veg"
                      ? "bg-[#16A34A] text-white shadow-xs"
                      : "bg-[#FFFBF3] border border-[#E8DCC8] text-[#4A1D1F] hover:bg-[#E8DCC8]/40"
                  }`}
                >
                  <span className="flex h-3.5 w-3.5 items-center justify-center rounded-[3px] border border-current bg-white shadow-2xs">
                    <span className="h-1.5 w-1.5 rounded-full bg-[#16A34A]" />
                  </span>
                  Veg ({products.filter((p) => p.dietary === "veg").length})
                </button>

                <button
                  type="button"
                  onClick={() => {
                    setDietaryFilter("non-veg")
                    setModalPage(1)
                  }}
                  className={`shrink-0 rounded-full px-4 py-1.5 text-xs font-semibold transition-colors flex items-center gap-2 ${
                    dietaryFilter === "non-veg"
                      ? "bg-[#DC2626] text-white shadow-xs"
                      : "bg-[#FFFBF3] border border-[#E8DCC8] text-[#4A1D1F] hover:bg-[#E8DCC8]/40"
                  }`}
                >
                  <span className="flex h-3.5 w-3.5 items-center justify-center rounded-[3px] border border-current bg-white shadow-2xs">
                    <span className="h-1.5 w-1.5 rounded-full bg-[#DC2626]" />
                  </span>
                  Non-Veg ({products.filter((p) => p.dietary === "non-veg").length})
                </button>
              </div>
            </div>

            {/* Table / Grid: 3 columns x 5 rows */}
            <div className="flex-1 overflow-y-auto px-6 py-3">
              {filteredProducts.length === 0 ? (
                <p className="py-12 text-center text-sm text-[#7A7A7A]">No products found matching your search.</p>
              ) : (
                <div className="grid grid-cols-1 sm:grid-cols-2 md:grid-cols-3 gap-3">
                  {paginatedProducts.map((p) => {
                    const isSelected = selectedProductIds.includes(p.id)
                    const isBlocked = !isSelected && selectedProductIds.length >= 3
                    const hasVariants = p.type === "variant" && (p.variants?.length ?? 0) > 0
                    const chosenVariant = isSelected ? getProductVariant(p) : null

                    return (
                      <div
                        key={p.id}
                        onClick={() => {
                          if (isSelected) {
                            removeProduct(p.id)
                          } else if (!isBlocked) {
                            if (hasVariants) {
                              setVariantPromptProduct(p)
                            } else {
                              selectSimpleProduct(p.id)
                            }
                          }
                        }}
                        className={`cursor-pointer rounded-xl border p-2.5 flex items-center justify-between gap-2.5 transition-all ${
                          isSelected
                            ? "border-[#7B3010] bg-[#FFFBF3] ring-1 ring-[#7B3010]"
                            : isBlocked
                            ? "border-[#E8DCC8]/40 opacity-40 cursor-not-allowed"
                            : "border-[#E8DCC8] hover:border-[#7B3010]/60 hover:bg-[#FFFBF3]/30"
                        }`}
                      >
                        <div className="flex items-center gap-2.5 min-w-0">
                          {p.thumbnail ? (
                            <img
                              src={p.thumbnail}
                              alt={p.name}
                              className="h-11 w-11 shrink-0 rounded-lg object-cover border border-[#E8DCC8]"
                            />
                          ) : (
                            <div className="h-11 w-11 shrink-0 rounded-lg bg-[#E8DCC8]/40 border border-[#E8DCC8]" />
                          )}
                          <div className="min-w-0">
                            <div className="flex items-center gap-1.5">
                              <span
                                className={`inline-flex shrink-0 items-center justify-center w-3 h-3 rounded-[2px] border ${
                                  p.dietary === "veg" ? "border-[#16A34A]" : "border-[#DC2626]"
                                } bg-white shadow-2xs`}
                                title={p.dietary === "veg" ? "Vegetarian" : "Non-Vegetarian"}
                              >
                                <span
                                  className={`w-1.5 h-1.5 rounded-full ${
                                    p.dietary === "veg" ? "bg-[#16A34A]" : "bg-[#DC2626]"
                                  }`}
                                />
                              </span>
                              <p className="truncate font-semibold text-xs text-[#4A1D1F]" title={p.name}>
                                {p.name}
                              </p>
                            </div>
                            <p className="truncate font-mono text-[10px] text-[#7A7A7A]">{p.sku || p.slug}</p>
                            <div className="flex items-center gap-2 mt-0.5">
                              <p className="text-xs font-bold text-[#7B3010]">
                                {chosenVariant ? `₹${chosenVariant.price.toFixed(2)}` : `₹${p.price.toFixed(2)}`}
                              </p>
                              {hasVariants && !isSelected && (
                                <span className="rounded bg-[#E8DCC8]/50 px-1.5 py-0.2 text-[9px] font-semibold text-[#7B3010]">
                                  {p.variants?.length} variants
                                </span>
                              )}
                              {chosenVariant && (
                                <span className="rounded bg-[#7B3010]/10 px-1.5 py-0.2 text-[9px] font-bold text-[#7B3010]">
                                  {chosenVariant.weight || chosenVariant.name}
                                </span>
                              )}
                            </div>
                            {hasVariants && isSelected && (
                              <button
                                type="button"
                                onClick={(e) => {
                                  e.stopPropagation()
                                  setVariantPromptProduct(p)
                                }}
                                className="text-[10px] font-semibold text-[#7B3010] hover:underline mt-0.5 block"
                              >
                                Change variant
                              </button>
                            )}
                          </div>
                        </div>
                        <div className="shrink-0">
                          <div
                            className={`h-6 w-6 rounded-md flex items-center justify-center text-xs font-bold transition-colors ${
                              isSelected
                                ? "bg-[#7B3010] text-white"
                                : "border border-[#E8DCC8] text-[#7A7A7A]"
                            }`}
                          >
                            {isSelected ? "✓" : "+"}
                          </div>
                        </div>
                      </div>
                    )
                  })}
                </div>
              )}
            </div>

            {/* Pagination & Footer */}
            <div className="flex flex-wrap items-center justify-between gap-3 px-6 py-3.5 border-t border-[#E8DCC8] bg-[#FFFBF3]/30">
              {filteredProducts.length > 15 ? (
                <div className="flex items-center gap-2 text-xs text-[#646464]">
                  <button
                    type="button"
                    disabled={modalPage <= 1}
                    onClick={() => setModalPage((p) => Math.max(1, p - 1))}
                    className="rounded-lg border border-[#E8DCC8] bg-white px-3 py-1 text-xs disabled:opacity-40 hover:bg-[#FFFBF3]"
                  >
                    Prev
                  </button>
                  <span>
                    Page {modalPage} of {totalModalPages}
                  </span>
                  <button
                    type="button"
                    disabled={modalPage >= totalModalPages}
                    onClick={() => setModalPage((p) => Math.min(totalModalPages, p + 1))}
                    className="rounded-lg border border-[#E8DCC8] bg-white px-3 py-1 text-xs disabled:opacity-40 hover:bg-[#FFFBF3]"
                  >
                    Next
                  </button>
                </div>
              ) : (
                <div className="text-xs text-[#7A7A7A]">
                  Showing {filteredProducts.length} product{filteredProducts.length === 1 ? "" : "s"}
                </div>
              )}

              <button
                type="button"
                onClick={() => setIsProductModalOpen(false)}
                className="rounded-xl bg-[#7B3010] px-5 py-2 text-xs font-semibold uppercase tracking-wide text-white hover:bg-[#5c2410]"
              >
                Done
              </button>
            </div>
          </div>
        </div>,
        document.body
      )}

      {/* Variant Selection Prompt Modal */}
      {variantPromptProduct && mounted && createPortal(
        <div
          className="fixed inset-0 z-[120] flex items-center justify-center bg-black/60 backdrop-blur-xs p-4 sm:p-6"
          onClick={(e) => {
            if (e.target === e.currentTarget) setVariantPromptProduct(null)
          }}
        >
          <div className="relative w-full max-w-lg flex flex-col rounded-3xl border border-[#E8DCC8] bg-white shadow-2xl overflow-hidden animate-in fade-in zoom-in-95 duration-200">
            {/* Header */}
            <div className="flex items-start justify-between px-6 py-4 border-b border-[#E8DCC8] bg-[#FFFBF3]/50">
              <div className="min-w-0 pr-3">
                <span className="inline-block text-[10px] font-bold uppercase tracking-wider text-[#7B3010] bg-[#7B3010]/10 px-2 py-0.5 rounded-full mb-1">
                  Select Variant
                </span>
                <h3 className="font-melon text-base font-bold text-[#4A1D1F] truncate">
                  {variantPromptProduct.name}
                </h3>
                <p className="text-xs text-[#7A7A7A] mt-0.5">
                  This product has multiple variants. Choose which pack size to include:
                </p>
              </div>
              <button
                type="button"
                onClick={() => setVariantPromptProduct(null)}
                className="rounded-lg p-1 text-[#7A7A7A] hover:bg-white hover:text-[#4A1D1F] transition-colors"
              >
                <X className="h-5 w-5" />
              </button>
            </div>

            {/* Body: Variants List */}
            <div className="p-6 max-h-[60vh] overflow-y-auto space-y-2.5">
              {(variantPromptProduct.variants ?? []).map((v) => {
                const isCurrent = selectedVariants[variantPromptProduct.id] === v.id
                const isOutOfStock = v.stock !== undefined && v.stock <= 0

                return (
                  <div
                    key={v.id}
                    onClick={() => {
                      selectProductVariant(variantPromptProduct, v)
                    }}
                    className={`group cursor-pointer rounded-2xl border p-3.5 flex items-center justify-between gap-3 transition-all ${
                      isCurrent
                        ? "border-[#7B3010] bg-[#FFFBF3] ring-1 ring-[#7B3010]"
                        : "border-[#E8DCC8] hover:border-[#7B3010]/70 hover:bg-[#FFFBF3]/30"
                    }`}
                  >
                    <div className="flex items-center gap-3 min-w-0">
                      <div
                        className={`flex h-5 w-5 shrink-0 items-center justify-center rounded-full border transition-colors ${
                          isCurrent
                            ? "border-[#7B3010] bg-[#7B3010] text-white"
                            : "border-[#E8DCC8] bg-white group-hover:border-[#7B3010]"
                        }`}
                      >
                        {isCurrent && <div className="h-2 w-2 rounded-full bg-white" />}
                      </div>
                      <div className="min-w-0">
                        <div className="flex items-center gap-2 flex-wrap">
                          <p className="font-semibold text-sm text-[#4A1D1F]">
                            {v.weight || v.name}
                          </p>
                          {v.isDefault && (
                            <span className="text-[10px] font-medium text-[#7A7A7A] bg-[#E8DCC8]/50 px-1.5 py-0.2 rounded">
                              Default
                            </span>
                          )}
                          {isOutOfStock ? (
                            <span className="text-[10px] font-semibold text-red-600 bg-red-50 px-1.5 py-0.2 rounded">
                              Out of stock
                            </span>
                          ) : v.stock !== undefined ? (
                            <span className="text-[10px] font-medium text-[#16A34A] bg-green-50 px-1.5 py-0.2 rounded">
                              {v.stock} in stock
                            </span>
                          ) : null}
                        </div>
                        {v.sku && (
                          <p className="font-mono text-[11px] text-[#9A9A92] mt-0.5">
                            SKU: {v.sku}
                          </p>
                        )}
                      </div>
                    </div>

                    <div className="text-right shrink-0">
                      <div className="font-bold text-sm text-[#7B3010]">
                        ₹{v.price.toFixed(2)}
                      </div>
                      {v.mrp && v.mrp > v.price ? (
                        <div className="text-[11px] text-[#9A9A92] line-through font-mono">
                          MRP: ₹{v.mrp.toFixed(2)}
                        </div>
                      ) : null}
                    </div>
                  </div>
                )
              })}
            </div>

            {/* Footer */}
            <div className="flex items-center justify-end gap-3 px-6 py-3.5 border-t border-[#E8DCC8] bg-[#FFFBF3]/30">
              <button
                type="button"
                onClick={() => setVariantPromptProduct(null)}
                className="rounded-xl border border-[#E8DCC8] bg-white px-4 py-2 text-xs font-semibold uppercase tracking-wide text-[#4A1D1F] hover:bg-[#FFFBF3]"
              >
                Cancel
              </button>
            </div>
          </div>
        </div>,
        document.body
      )}
    </div>
  )
}
