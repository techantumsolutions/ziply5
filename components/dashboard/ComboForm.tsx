"use client"

import { useEffect, useMemo, useState } from "react"
import { createPortal } from "react-dom"
import { authedFetch, authedPost, authedPut } from "@/lib/dashboard-fetch"
import { uploadAdminImage } from "@/lib/admin-upload"
import { Loader2, Plus, X, Search } from "lucide-react"
import { cn } from "@/lib/utils"
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select"

type ProductLite = {
  id: string
  name: string
  slug: string
  sku?: string | null
  thumbnail?: string | null
  price: number
  categoryId?: string | null
  categoryName?: string | null
  categorySlug?: string | null
}

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
  const [pricingMode, setPricingMode] = useState<"fixed" | "dynamic">("fixed")
  const [comboPrice, setComboPrice] = useState("")
  const [description, setDescription] = useState("")
  const [image, setImage] = useState("")
  const [isActive, setIsActive] = useState(true)
  const [selectedProductIds, setSelectedProductIds] = useState<string[]>([])
  const [products, setProducts] = useState<ProductLite[]>([])
  const [categories, setCategories] = useState<Array<{ id: string; name: string; slug: string }>>(DEFAULT_CATEGORIES)
  const [selectedCategory, setSelectedCategory] = useState<string>("all")
  const [search, setSearch] = useState("")
  const [loading, setLoading] = useState(false)
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState("")
  const [imageUploading, setImageUploading] = useState(false)

  // Product Selection Modal state
  const [isProductModalOpen, setIsProductModalOpen] = useState(false)
  const [modalPage, setModalPage] = useState(1)
  const [mounted, setMounted] = useState(false)

  useEffect(() => {
    setMounted(true)
  }, [])

  useEffect(() => {
    if (!isProductModalOpen) return
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === "Escape") {
        setIsProductModalOpen(false)
      }
    }
    window.addEventListener("keydown", handleKeyDown)
    const prevOverflow = document.body.style.overflow
    document.body.style.overflow = "hidden"
    return () => {
      window.removeEventListener("keydown", handleKeyDown)
      document.body.style.overflow = prevOverflow
    }
  }, [isProductModalOpen])

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
        const lite = (Array.isArray(rows) ? rows : [])
          .filter((p) => p?.id && p?.name && p?.slug && p?.status === "published" && p?.isActive !== false)
          .map((p) => {
            const cat = Array.isArray(p.categories) && p.categories[0]
              ? p.categories[0].category || p.categories[0]
              : p.category || null
            return {
              id: String(p.id),
              name: String(p.name),
              slug: String(p.slug),
              sku: p.sku ? String(p.sku) : null,
              thumbnail: p.thumbnail ? String(p.thumbnail) : null,
              price: Number(p.price ?? 0),
              categoryId: cat?.id ? String(cat.id) : (p.categoryId ? String(p.categoryId) : null),
              categoryName: cat?.name ? String(cat.name) : null,
              categorySlug: cat?.slug ? String(cat.slug) : null,
            }
          })
        setProducts(lite)

        if (bundleRes) {
          setName(bundleRes.name ?? "")
          setSlug(bundleRes.slug ?? "")
          setPricingMode(bundleRes.pricingMode === "dynamic" ? "dynamic" : "fixed")
          setComboPrice(bundleRes.comboPrice != null ? String(bundleRes.comboPrice) : "")
          setDescription(bundleRes.description ?? "")
          setImage(bundleRes.image ?? "")
          setIsActive(bundleRes.isActive !== false)

          if (Array.isArray(bundleRes.products)) {
            const bundlePids = bundleRes.products.map((x: any) => String(x.productId || x.id))
            setSelectedProductIds(bundlePids)
            // Ensure products in bundle are also in products list so prices, names, and images are always available
            const extraLites: ProductLite[] = bundleRes.products.map((bp: any) => ({
              id: String(bp.productId || bp.id),
              name: String(bp.name),
              slug: String(bp.slug || ""),
              price: Number(bp.price ?? 0),
              thumbnail: bp.thumbnail ?? null,
            }))
            const existingIds = new Set(lite.map((x) => x.id))
            const missing = extraLites.filter((x) => !existingIds.has(x.id))
            if (missing.length > 0) {
              setProducts([...lite, ...missing])
            }
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

  useEffect(() => {
    if (!slug || slug.trim().length === 0 || slug === name) {
      const auto = name
        .trim()
        .toLowerCase()
        .replace(/\s+/g, "-")
        .replace(/[^a-z0-9_-]/g, "")
      setSlug(auto)
    }
  }, [name])

  const filteredProducts = useMemo(() => {
    const q = search.trim().toLowerCase()
    return products.filter((p) => {
      const matchesSearch =
        !q ||
        p.name.toLowerCase().includes(q) ||
        p.slug.toLowerCase().includes(q) ||
        (p.sku && p.sku.toLowerCase().includes(q))

      const matchesCategory =
        selectedCategory === "all" ||
        p.categorySlug?.toLowerCase() === selectedCategory.toLowerCase() ||
        p.categoryId?.toLowerCase() === selectedCategory.toLowerCase() ||
        p.categoryName?.toLowerCase() === selectedCategory.toLowerCase() ||
        p.categorySlug?.toLowerCase().includes(selectedCategory.toLowerCase()) ||
        p.categoryName?.toLowerCase().includes(selectedCategory.toLowerCase()) ||
        p.name.toLowerCase().includes(selectedCategory.toLowerCase()) ||
        p.slug.toLowerCase().includes(selectedCategory.toLowerCase())

      return matchesSearch && matchesCategory
    })
  }, [products, search, selectedCategory])

  const totalModalPages = Math.max(1, Math.ceil(filteredProducts.length / MODAL_PAGE_SIZE))
  const paginatedProducts = useMemo(() => {
    const start = (modalPage - 1) * MODAL_PAGE_SIZE
    return filteredProducts.slice(start, start + MODAL_PAGE_SIZE)
  }, [filteredProducts, modalPage])

  const sumOfSelectedPrices = useMemo(() => {
    return selectedProductIds.reduce((sum, id) => {
      const prod = products.find((p) => p.id === id)
      return sum + (prod?.price ?? 0)
    }, 0)
  }, [selectedProductIds, products])

  const isPriceTooHigh = useMemo(() => {
    if (pricingMode !== "fixed" || selectedProductIds.length === 0 || !comboPrice) return false
    const priceNum = Number(comboPrice)
    return sumOfSelectedPrices > 0 && priceNum >= sumOfSelectedPrices
  }, [pricingMode, selectedProductIds, comboPrice, sumOfSelectedPrices])

  const validateForm = (): string | null => {
    if (name.trim().length < 2) return "Please enter a combo name (at least 2 characters)."
    if (!slug || !/^[a-z0-9_-]+$/.test(slug)) return "Please enter a valid URL slug (lowercase letters, numbers, and hyphens)."
    if (selectedProductIds.length < 1) return "Please select at least 1 product."
    if (selectedProductIds.length > 3) return "You can select a maximum of 3 products."
    if (pricingMode === "fixed") {
      const n = Number(comboPrice)
      if (!Number.isFinite(n) || n <= 0) return "Please enter a valid combo price greater than ₹0."
      if (sumOfSelectedPrices > 0 && n >= sumOfSelectedPrices) {
        return `Combo price (₹${n.toFixed(2)}) must be less than the total price of all products (₹${sumOfSelectedPrices.toFixed(2)}).`
      }
    }
    return null
  }

  const toggleProduct = (productId: string) => {
    setSelectedProductIds((prev) => {
      if (prev.includes(productId)) return prev.filter((id) => id !== productId)
      if (prev.length >= 3) return prev
      return [...prev, productId]
    })
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
      comboPrice: pricingMode === "fixed" ? Number(comboPrice) : null,
      description: description.trim() || null,
      image: image.trim() || null,
      isActive,
      productIds: selectedProductIds,
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
              onChange={(e) => setName(e.target.value)}
            />
          </label>
          <label className="block text-sm">
            <span className="text-xs font-semibold text-[#7A7A7A]">Slug</span>
            <input
              className="mt-1 w-full rounded-lg border border-[#E8DCC8] bg-white px-3 py-2 text-sm font-mono text-[#4A1D1F] focus:border-[#7B3010] focus:outline-none"
              placeholder="e.g. breakfast-combo"
              value={slug}
              onChange={(e) => setSlug(e.target.value.toLowerCase().replace(/\s+/g, "-"))}
            />
          </label>
        </div>
      </div>

      {/* 2. Pricing & Status */}
      <div className="space-y-3">
        <div className="flex items-center gap-2">
          <span className="flex h-6 w-6 shrink-0 items-center justify-center rounded-full bg-[#7B3010] text-xs font-bold text-white">
            2
          </span>
          <h3 className="text-sm font-semibold text-[#4A1D1F]">Pricing & Status</h3>
        </div>
        <div className="grid gap-3 sm:grid-cols-2">
          <label className="block text-sm">
            <span className="text-xs font-semibold text-[#7A7A7A]">Pricing Mode</span>
            <select
              className="mt-1 w-full rounded-lg border border-[#E8DCC8] bg-white px-3 py-2 text-sm text-[#4A1D1F] focus:border-[#7B3010] focus:outline-none"
              value={pricingMode}
              onChange={(e) => setPricingMode(e.target.value as "fixed" | "dynamic")}
            >
              <option value="fixed">Fixed</option>
              <option value="dynamic">Dynamic</option>
            </select>
          </label>
          <div className="space-y-1">
            <label className="block text-sm">
              <span className="text-xs font-semibold text-[#7A7A7A]">
                Combo Price {pricingMode === "fixed" ? <span className="text-red-500">*</span> : null}
              </span>
              <div className="relative mt-1">
                <span className="absolute inset-y-0 left-0 flex items-center pl-3 text-sm text-[#7A7A7A]">₹</span>
                <input
                  className="w-full rounded-lg border border-[#E8DCC8] bg-white pl-7 pr-3 py-2 text-sm text-[#4A1D1F] focus:border-[#7B3010] focus:outline-none disabled:bg-gray-100"
                  type="number"
                  min={1}
                  step="0.01"
                  placeholder="0.00"
                  value={comboPrice}
                  disabled={pricingMode !== "fixed"}
                  onChange={(e) => setComboPrice(e.target.value)}
                />
              </div>
            </label>
            {pricingMode === "fixed" && selectedProductIds.length > 0 && (
              <p className="text-[11px] text-[#646464]">
                Total price of selected products: <span className="font-semibold text-[#4A1D1F]">₹{sumOfSelectedPrices.toFixed(2)}</span>
              </p>
            )}
            {isPriceTooHigh && (
              <p className="text-xs font-medium text-red-600">
                The price of the combo should be less than the total price of all products in that combo
              </p>
            )}
          </div>
        </div>
        <label className="flex items-center gap-2 pt-1 text-sm font-medium text-[#4A1D1F] cursor-pointer">
          <input
            type="checkbox"
            checked={isActive}
            onChange={(e) => setIsActive(e.target.checked)}
            className="h-4 w-4 rounded border-[#E8DCC8] text-[#7B3010] accent-[#7B3010]"
          />
          Active
        </label>
      </div>

      {/* 3. Image & Description */}
      <div className="space-y-3">
        <div className="flex items-center gap-2">
          <span className="flex h-6 w-6 shrink-0 items-center justify-center rounded-full bg-[#7B3010] text-xs font-bold text-white">
            3
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

      {/* 4. Select Products (Max 3) */}
      <div className="space-y-3">
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-2">
            <span className="flex h-6 w-6 shrink-0 items-center justify-center rounded-full bg-[#7B3010] text-xs font-bold text-white">
              4
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
              return (
                <div
                  key={id}
                  className="flex items-center justify-between gap-3 rounded-xl border border-[#E8DCC8] bg-[#FFFBF3]/40 p-2.5"
                >
                  <div className="flex items-center gap-2.5 min-w-0">
                    {p.thumbnail ? (
                      <img src={p.thumbnail} alt={p.name} className="h-9 w-9 shrink-0 rounded-lg object-cover border border-[#E8DCC8]" />
                    ) : (
                      <div className="h-9 w-9 shrink-0 rounded-lg bg-[#E8DCC8]/40 border border-[#E8DCC8]" />
                    )}
                    <div className="truncate">
                      <p className="truncate font-semibold text-xs text-[#4A1D1F]">{p.name}</p>
                      <p className="text-[11px] font-mono text-[#7A7A7A]">₹{p.price.toFixed(2)}</p>
                    </div>
                  </div>
                  <button
                    type="button"
                    onClick={() => toggleProduct(id)}
                    className="rounded-lg p-1 text-[#7A7A7A] hover:bg-red-50 hover:text-red-700 transition-colors"
                    title="Remove item"
                  >
                    <X className="h-4 w-4" />
                  </button>
                </div>
              )
            })}
          </div>
        )}
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
                  value={selectedCategory}
                  onValueChange={(val) => {
                    setSelectedCategory(val)
                    setModalPage(1)
                  }}
                >
                  <SelectTrigger className="h-10 sm:w-[190px] rounded-xl border border-[#E8DCC8] bg-white px-3.5 text-sm font-medium text-[#4A1D1F] shadow-xs hover:border-[#7B3010]/60 focus-visible:border-[#7B3010] focus-visible:ring-1 focus-visible:ring-[#7B3010]/20">
                    <SelectValue placeholder="All Categories" />
                  </SelectTrigger>
                  <SelectContent className="z-[150] rounded-xl border border-[#E8DCC8] bg-white p-1 shadow-xl">
                    <SelectItem
                      value="all"
                      className="cursor-pointer rounded-lg px-3 py-2 text-sm text-[#4A1D1F] hover:bg-[#FFFBF3] focus:bg-[#FFFBF3] focus:text-[#7B3010] data-[state=checked]:font-semibold data-[state=checked]:text-[#7B3010]"
                    >
                      All Categories
                    </SelectItem>
                    {categories.map((cat) => (
                      <SelectItem
                        key={cat.id}
                        value={cat.slug || cat.id}
                        className="cursor-pointer rounded-lg px-3 py-2 text-sm text-[#4A1D1F] hover:bg-[#FFFBF3] focus:bg-[#FFFBF3] focus:text-[#7B3010] data-[state=checked]:font-semibold data-[state=checked]:text-[#7B3010]"
                      >
                        {cat.name}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>

              {/* Category Pills Bar */}
              <div className="flex items-center gap-2 overflow-x-auto pb-1 pt-0.5 scrollbar-thin">
                <button
                  type="button"
                  onClick={() => {
                    setSelectedCategory("all")
                    setModalPage(1)
                  }}
                  className={`shrink-0 rounded-full px-4 py-1.5 text-xs font-semibold transition-colors ${
                    selectedCategory === "all"
                      ? "bg-[#7B3010] text-white shadow-xs"
                      : "bg-[#FFFBF3] border border-[#E8DCC8] text-[#4A1D1F] hover:bg-[#E8DCC8]/40"
                  }`}
                >
                  All
                </button>
                {categories.map((cat) => {
                  const isActive = selectedCategory === (cat.slug || cat.id)
                  return (
                    <button
                      key={cat.id}
                      type="button"
                      onClick={() => {
                        setSelectedCategory(cat.slug || cat.id)
                        setModalPage(1)
                      }}
                      className={`shrink-0 rounded-full px-4 py-1.5 text-xs transition-colors ${
                        isActive
                          ? "bg-[#7B3010] text-white font-semibold shadow-xs"
                          : "bg-[#FFFBF3] border border-[#E8DCC8] text-[#4A1D1F] hover:bg-[#E8DCC8]/40 font-medium"
                      }`}
                    >
                      {cat.name}
                    </button>
                  )
                })}
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
                    return (
                      <div
                        key={p.id}
                        onClick={() => {
                          if (!isBlocked || isSelected) toggleProduct(p.id)
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
                            <p className="truncate font-semibold text-xs text-[#4A1D1F]" title={p.name}>
                              {p.name}
                            </p>
                            <p className="truncate font-mono text-[10px] text-[#7A7A7A]">{p.sku || p.slug}</p>
                            <p className="text-xs font-bold text-[#7B3010] mt-0.5">₹{p.price.toFixed(2)}</p>
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
    </div>
  )
}
