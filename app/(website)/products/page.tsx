"use client"

import { Suspense, useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from "react"
import Image from "next/image"
import Link from "next/link"
import { useSearchParams, useRouter, usePathname } from "next/navigation"
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select"
import { getCartItems, setCartItemQuantity, getCartQuantity } from "@/lib/cart"
import { getFavoriteSlugs, toggleFavoriteSlug } from "@/lib/favorites"
import { FALLBACK_PRODUCT_IMAGE, type StorefrontProduct } from "@/lib/storefront-products"
import { useStorefrontProducts } from "@/hooks/useStorefrontProducts"
import { X, Heart } from "lucide-react"
import { toast } from "@/lib/toast"
import { SlideUp, ScaleHover, ModalAnimation } from "@/components/animations"
import VegNonVegTag from "@/components/VegNonVegTag"

type CategoryFilter = "all" | string
type SortType = "popular" | "name-asc" | "name-desc" | "newest" | "price-low-high" | "price-high-low"
type CategoryApi = { id: string; name: string; slug: string }
type SpiceLevelFilter = "all" | string

const PRODUCTS_PAGE_SIZE = 12

function mulberry32(seed: number) {
  let t = seed >>> 0
  return () => {
    t += 0x6d2b79f5
    let x = Math.imul(t ^ (t >>> 15), 1 | t)
    x ^= x + Math.imul(x ^ (x >>> 7), 61 | x)
    return ((x ^ (x >>> 14)) >>> 0) / 4294967296
  }
}

function inForbiddenHue(h: number) {
  // avoid brown/yellow/gold range (roughly orange→yellow)
  const hue = ((h % 360) + 360) % 360
  return hue >= 15 && hue <= 75
}

function clamp(n: number, min: number, max: number) {
  return Math.max(min, Math.min(max, n))
}

function ProductsPageContent() {
  const searchParams = useSearchParams()
  const { products, loading, error } = useStorefrontProducts(200)
  const [categoryOptions, setCategoryOptions] = useState<Array<{ slug: string; name: string }>>([])
  const [tagOptions, setTagOptions] = useState<Array<{ slug: string; name: string, id: string, isActive: boolean }>>([])
  const [categoryFilter, setCategoryFilter] = useState<CategoryFilter>("all")
  const [selectedTagIds, setSelectedTagIds] = useState<string[]>([])
  const [packFilter, setPackFilter] = useState<any>("all")
  const [mealTimeFilter, setMealTimeFilter] = useState<any>("all")
  const [bestSellerFilter, setBestSellerFilter] = useState<string>("all")
  const [featuredFilter, setFeaturedFilter] = useState<string>("all")
  const [spiceLevelFilter, setSpiceLevelFilter] = useState<SpiceLevelFilter>("all")
  const [sortBy, setSortBy] = useState<SortType>("popular")
  const [favoriteSlugs, setFavoriteSlugs] = useState<string[]>([])
  const [cartQtyBySlug, setCartQtyBySlug] = useState<Record<string, number>>({})
  const searchTerm = (searchParams.get("search") || "").trim().toLowerCase()
  const router = useRouter()
  const pathname = usePathname()
  const pageSeedRef = useState(() => {
    // Random per page load, stable for this mounted session
    if (typeof crypto !== "undefined" && "getRandomValues" in crypto) {
      const arr = new Uint32Array(1)
      crypto.getRandomValues(arr)
      return Number(arr[0] ?? Date.now())
    }
    return Date.now()
  })[0]
  const bestSellerParam = (searchParams.get("bestSeller") || "").trim().toLowerCase()
  const packParam = (searchParams.get("pack") || "").trim().toLowerCase()
  const typeParam = (searchParams.get("type") || "").trim().toLowerCase()
  const comboParam = (searchParams.get("combo") || "").trim().toLowerCase()
  const productTypeParam = (searchParams.get("productType") || "").trim().toLowerCase()
  const categoryParam = (searchParams.get("category") || "").trim().toLowerCase()
  const tagParam = (searchParams.get("tag") || "").trim().toLowerCase()
  const spiceLevelParam = (searchParams.get("spiceLevel") || "").trim().toLowerCase()
  useEffect(() => {
    let cancelled = false
    fetch("/api/v1/categories")
      .then((r) => r.json())
      .then((categoryRes: { success?: boolean; message?: string; data?: any }) => {
        if (cancelled) return
        const categories = ((categoryRes.data as CategoryApi[] | undefined) ?? [])
          .filter((c) => c.slug && c.slug !== "all")
          .map((c) => ({ slug: c.slug, name: c.name }))
        setCategoryOptions(categories)
      })
      .catch(() => null)

    fetch("/api/v1/tags")
      .then((r) => r.json())
      .then((tagRes: { success?: boolean; data?: any }) => {
        if (cancelled) return
        const tags = ((tagRes.data as any[] | undefined) ?? [])
          .map((t) => ({ slug: t.slug, name: t.name, id: t.id, isActive: t.isActive }))
        const activeTags = tags.filter((t: any) => t.isActive === true)
        setTagOptions(activeTags)
      })
      .catch(() => null)

    return () => {
      cancelled = true
    }
  }, [])

  useEffect(() => {
    if (bestSellerParam === "true") {
      setBestSellerFilter("true")
    } else {
      setBestSellerFilter("all")
    }
  }, [bestSellerParam])
  useEffect(() => {
    const wantsCombo =
      packParam === "combo-pack" ||
      typeParam === "combo" ||
      comboParam === "true" ||
      productTypeParam === "combo"
    if (wantsCombo) {
      setPackFilter("combo-pack")
    } else if (packParam === "limited-offers") {
      setPackFilter("limited-offers")
    } else {
      setPackFilter("all")
    }
  }, [packParam, typeParam, comboParam, productTypeParam])

  useEffect(() => {
    const normalizeMappedTag = (value: string) => {
      if (value === "nonveg") return "non-veg"
      return value
    }

    const queryFilterConfig = [
      {
        key: "category",
        value: categoryParam,
        apply: (value: string) => setCategoryFilter(value || "all"),
      },
      {
        key: "spiceLevel",
        value: spiceLevelParam,
        apply: (value: string) => {
          setSpiceLevelFilter(value || "all")
        },
      },
      {
        key: "tag",
        value: tagParam,
        apply: (value: string) => {
          if (!value) {
            setSelectedTagIds([])
            return
          }
          const wanted = normalizeMappedTag(value)
          const match = tagOptions.find((t) => t.slug === wanted || t.name.toLowerCase() === wanted)
          setSelectedTagIds(match ? [match.id] : [])
        },
      },
    ] as const

    queryFilterConfig.forEach((filter) => filter.apply(filter.value))
  }, [categoryParam, spiceLevelParam, tagParam, tagOptions])
  useEffect(() => {
    const syncFavorites = () => setFavoriteSlugs(getFavoriteSlugs())
    syncFavorites()
    window.addEventListener("ziply5:favorites-updated", syncFavorites)
    window.addEventListener("storage", syncFavorites)
    return () => {
      window.removeEventListener("ziply5:favorites-updated", syncFavorites)
      window.removeEventListener("storage", syncFavorites)
    }
  }, [])

  useEffect(() => {
    const syncCartQty = () => {
      const items = getCartItems()
      const qtyMap = items.reduce<Record<string, number>>((acc, item) => {
        acc[item.slug] = item.quantity
        return acc
      }, {})
      setCartQtyBySlug(qtyMap)
    }

    syncCartQty()
    window.addEventListener("ziply5:cart-updated", syncCartQty)
    window.addEventListener("storage", syncCartQty)
    return () => {
      window.removeEventListener("ziply5:cart-updated", syncCartQty)
      window.removeEventListener("storage", syncCartQty)
    }
  }, [])
  // Fetch DB Favorites on mount if logged in
  useEffect(() => {
    const fetchDbFavorites = async () => {
      const token = window.localStorage.getItem("ziply5_access_token");
      const userStr = window.localStorage.getItem("ziply5_user");
      const userId = userStr ? JSON.parse(userStr).id : null;

      if (token && userId) {
        try {
          const res = await fetch("/api/v1/favorites", {
            headers: {
              Authorization: `Bearer ${token}`,
              "x-user-id": userId
            },
          });
          const payload = await res.json();
          if (payload.success && Array.isArray(payload.data)) {
            window.localStorage.setItem("ziply5-favorites", JSON.stringify(payload.data));
            setFavoriteSlugs(payload.data);
          }
        } catch (e) { /* silent fail */ }
      }
    };
    fetchDbFavorites();
  }, []);

  const handleToggleFavorite = async (e: React.MouseEvent, slug: string) => {
    console.log("Toggling favorite for slug:", slug);
    e.stopPropagation();
    const token = window.localStorage.getItem("ziply5_access_token");
    if (!token) {
      window.localStorage.setItem("ziply5_pending_wishlist_slug", slug);
      router.push(`/login?next=${encodeURIComponent(window.location.pathname + window.location.search)}`);
      return;
    }
    const isAdded = await toggleFavoriteSlug(slug);
    if (isAdded) {
      toast.success("Added to favorites", "Product added to your wishlist.");
    } else {
      toast.info("Removed from favorites", "Product removed from your wishlist.");
    }
    setFavoriteSlugs(getFavoriteSlugs());
  }

  const categories = useMemo(() => {
    const base = categoryOptions.length > 0
      ? categoryOptions
      : Array.from(new Set(products.map((p) => p.category).filter((x) => x && x !== "all"))).map((slug) => ({
        slug,
        name: slug.replace(/-/g, " "),
      }));

    // Merge Meal Types into Category Options as they are conceptually same for filtering here
    return [...base]
  }, [categoryOptions, products])

  const spiceLevelOptions = useMemo(() => {
    const levels = new Set<string>()
    products.forEach((p) => {
      if (p.spiceLevel) {
        const trimmed = p.spiceLevel.trim()
        if (trimmed) {
          levels.add(trimmed)
        }
      }
    })
    return Array.from(levels).sort()
  }, [products])

  const formatSpiceLevel = (level: string) => {
    return level
      .replace(/_/g, " ")
      .split(" ")
      .map((word) => word.charAt(0).toUpperCase() + word.slice(1))
      .join(" ")
  }

  const filteredProducts = useMemo(() => {
    let items = products.filter((item) => {
      // Merged logic: filter matches either the category field OR the diet type field
      const categoryMatch = categoryFilter === "all" || item.category === categoryFilter || item.type === categoryFilter

      const packMatch =
        packFilter === "all" ||
        (packFilter === "combo-pack" && (item as any).isCombo) ||
        (packFilter === "limited-offers" && (item as any).isLimited)
      const mealTimeMatch = mealTimeFilter === "all" || (item as any).mealTime === mealTimeFilter

      const bestSellerMatch =
        bestSellerFilter === "all" || (item as any).isBestSeller === true
      const featuredMatch =
        featuredFilter === "all" || (item as any).isFeatured === true
      const spiceLevelMatch =
        spiceLevelFilter === "all" ||
        String((item as any).spiceLevel ?? "").trim().toLowerCase() === spiceLevelFilter.trim().toLowerCase()

      const tagMatch =
        selectedTagIds.length === 0 ||
        selectedTagIds.some((selectedId) =>
          (item as any).tags?.some((t: any) => t.tag.id === selectedId)
        );
      return categoryMatch && packMatch && mealTimeMatch &&
        bestSellerMatch && featuredMatch && spiceLevelMatch && tagMatch
    })

    if (searchTerm) {
      items = items.filter((item) => item.name.toLowerCase().includes(searchTerm))
    }

    // Applied enhanced sorting
    if (sortBy === "name-asc") {
      items.sort((a, b) => a.name.localeCompare(b.name))
    } else if (sortBy === "name-desc") {
      items.sort((a, b) => b.name.localeCompare(a.name))
    } else if (sortBy === "price-low-high") {
      items.sort((a, b) => Number(a.price) - Number(b.price))
    } else if (sortBy === "price-high-low") {
      items.sort((a, b) => Number(b.price) - Number(a.price))
    } else if (sortBy === "newest") {
      items.sort((a, b) => new Date((b as any).updatedAt || 0).getTime() - new Date((a as any).updatedAt || 0).getTime())
    } else if (sortBy === "popular") {
      items.sort((a, b) => ((b as any).reviews?.length || 0) - ((a as any).reviews?.length || 0))
    }

    return items
  }, [products, categoryFilter, packFilter, mealTimeFilter, bestSellerFilter, featuredFilter, spiceLevelFilter, selectedTagIds, sortBy, searchTerm])

  const totalPages = Math.max(1, Math.ceil(filteredProducts.length / PRODUCTS_PAGE_SIZE))
  const pageFromQuery = parseInt(searchParams.get("page") || "1", 10)
  const currentPage = Math.min(
    Math.max(1, Number.isFinite(pageFromQuery) && pageFromQuery > 0 ? pageFromQuery : 1),
    totalPages,
  )

  const paginatedProducts = useMemo(() => {
    const start = (currentPage - 1) * PRODUCTS_PAGE_SIZE
    return filteredProducts.slice(start, start + PRODUCTS_PAGE_SIZE)
  }, [filteredProducts, currentPage])

  const goToPage = useCallback(
    (p: number) => {
      const next = Math.min(Math.max(1, p), totalPages)
      const params = new URLSearchParams(searchParams.toString())
      if (next <= 1) params.delete("page")
      else params.set("page", String(next))
      const qs = params.toString()
      router.push(qs ? `${pathname}?${qs}` : pathname)
      if (typeof window !== "undefined") {
        window.scrollTo({ top: 0, behavior: "smooth" })
      }
    },
    [pathname, router, searchParams, totalPages],
  )

  useEffect(() => {
    const raw = parseInt(searchParams.get("page") || "1", 10)
    if (!Number.isFinite(raw) || raw < 1) return
    if (raw === currentPage) return
    const params = new URLSearchParams(searchParams.toString())
    if (currentPage <= 1) params.delete("page")
    else params.set("page", String(currentPage))
    const qs = params.toString()
    router.replace(qs ? `${pathname}?${qs}` : pathname)
  }, [currentPage, pathname, router, searchParams])

  const productBgBySlug = useMemo(() => {
    const rng = mulberry32(pageSeedRef)
    const GOLDEN_ANGLE = 137.50776405003785

    // mid-tone constraints: not too bright/dark
    const satBase = 38 + rng() * 12 // 38–50
    const lightBase = 52 + rng() * 10 // 52–62

    // random start hue, but not in forbidden range
    let startHue = rng() * 360
    for (let tries = 0; tries < 20 && inForbiddenHue(startHue); tries++) {
      startHue = (startHue + 23 + rng() * 37) % 360
    }

    const map: Record<string, string> = {}
    for (let i = 0; i < filteredProducts.length; i++) {
      const p = filteredProducts[i] as any
      const key = String(p.slug || p.id || i)

      let hue = (startHue + i * GOLDEN_ANGLE) % 360
      // if hue lands in forbidden band, walk forward until it doesn't
      for (let tries = 0; tries < 24 && inForbiddenHue(hue); tries++) hue = (hue + 9) % 360

      const s = clamp(satBase + (rng() - 0.5) * 8, 34, 52)
      const l = clamp(lightBase + (rng() - 0.5) * 8, 48, 66)
      map[key] = `hsl(${hue.toFixed(0)} ${s.toFixed(0)}% ${l.toFixed(0)}%)`
    }
    return map
  }, [filteredProducts, pageSeedRef])

  const toggleTag = (tagId: string) => {
    setSelectedTagIds(prev =>
      prev.includes(tagId)
        ? prev.filter(id => id !== tagId)
        : [...prev, tagId]
    )
  }

  const [selectedProduct, setSelectedProduct] = useState<any | null>(null)
  const filterBarRef = useRef<HTMLDivElement | null>(null)
  const [filterBarHeight, setFilterBarHeight] = useState(0)

  useLayoutEffect(() => {
    const el = filterBarRef.current
    if (!el) return
    const measure = () => setFilterBarHeight(el.getBoundingClientRect().height)
    measure()
    const ro = new ResizeObserver(measure)
    ro.observe(el)
    return () => ro.disconnect()
  }, [])

  const updateVariantQty = (product: any, variant: any, nextQty: number) => {
    const vId = variant.id ? String(variant.id) : (variant.sku || variant.weight || variant.name);
    setCartItemQuantity({
      productId: String(product.id),
      variantId: vId,
      slug: product.slug,
      name: product.name,
      price: variant.price,
      image: product.image,
      weight: variant.weight || variant.name,
      sku: variant.sku
    }, nextQty)
  }
  console.log("fetch products:::::::", filteredProducts)

  return (
    <section className="w-full bg-[#F3F0DC]">
      {/* Fixed below global header — Framer FadeIn was breaking sticky; fixed pins to viewport */}
      <div
        ref={filterBarRef}
        className="fixed left-0 right-0 z-[90] bg-[#F3F0DC]/75 backdrop-blur-sm py-2 pt-5"
      >
        <div className="mx-auto w-full max-w-7xl px-4">

          <div className="flex flex-col gap-4">
            {/* <div className="flex items-center justify-between">
                  <p className="text-xs font-bold uppercase tracking-wide text-[#1F1F1C]">Filtered Products By</p>
                  <button
                    type="button"
                    onClick={() => {
                      setCategoryFilter("all")
                      setPackFilter("all")
                      setMealTimeFilter("all")
                      setBestSellerFilter("all")
                      setFeaturedFilter("all")
                      setSpiceLevelFilter("all")
                      setSelectedTagIds([])
                      setSortBy("popular")
                      const params = new URLSearchParams(searchParams.toString())
                      params.delete("page")
                      params.delete("spiceLevel")
                      const qs = params.toString()
                      router.push(qs ? `${pathname}?${qs}` : pathname)
                    }}
                    className="text-[10px] font-bold uppercase tracking-widest text-[#7A2B19] hover:underline"
                  >
                    Reset Filters
                  </button>
                </div> */}

            <div className="grid grid-cols-2 items-center gap-3 md:grid-cols-3 lg:grid-cols-4">
              <Select value={categoryFilter} onValueChange={(value) => setCategoryFilter(value as CategoryFilter)}>
                <SelectTrigger className="!h-8 !py-1 cursor-pointer rounded-full border-[#D9D9D1] bg-white px-4 text-xs font-medium">
                  <SelectValue placeholder="Category & Type" />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem className="cursor-pointer" value="all">All Categories</SelectItem>
                  {categories.map((cat, idx) => (
                    <SelectItem className="cursor-pointer" key={`${cat.slug || "cat"}-${idx}`} value={cat.slug}>
                      {cat.name}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>

              <Select value={packFilter} onValueChange={(value) => setPackFilter(value as any)}>
                <SelectTrigger className="!h-8 !py-1 cursor-pointer rounded-full border-[#D9D9D1] bg-white px-4 text-xs font-medium">
                  <SelectValue placeholder="Packs & Deals" />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem className="cursor-pointer" value="all">All Packs</SelectItem>
                  <SelectItem className="cursor-pointer" value="combo-pack">Combo Pack</SelectItem>
                  <SelectItem className="cursor-pointer" value="limited-offers">Limited Deals</SelectItem>
                </SelectContent>
              </Select>

              <Select value={sortBy} onValueChange={(value) => setSortBy(value as SortType)}>
                <SelectTrigger className="!h-8 !py-1 cursor-pointer rounded-full border-[#D9D9D1] bg-white px-4 text-xs font-medium">
                  <SelectValue placeholder="Sort by" />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem className="cursor-pointer" value="popular">Popular</SelectItem>
                  <SelectItem className="cursor-pointer" value="newest">Newest</SelectItem>
                  <SelectItem className="cursor-pointer" value="price-low-high">Price: Low to High</SelectItem>
                  <SelectItem className="cursor-pointer" value="price-high-low">Price: High to Low</SelectItem>
                  <SelectItem className="cursor-pointer" value="name-asc">A to Z</SelectItem>
                  <SelectItem className="cursor-pointer" value="name-desc">Z to A</SelectItem>
                </SelectContent>
              </Select>
              <Select value={spiceLevelFilter} onValueChange={(value) => setSpiceLevelFilter(value)}>
                <SelectTrigger className="!h-8 !py-1 cursor-pointer rounded-full border-[#D9D9D1] bg-white px-4 text-xs font-medium">
                  <SelectValue placeholder="Spice Level" />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem className="cursor-pointer" value="all">All Spice Levels</SelectItem>
                  {spiceLevelOptions.map((level) => (
                    <SelectItem className="cursor-pointer" key={level} value={level}>
                      {formatSpiceLevel(level)}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
          </div>
        </div>
      </div>

      <div className="mx-auto w-full max-w-7xl px-4">
        {error && <p className="mb-4 rounded-lg bg-red-50 px-3 py-1 text-sm text-red-800">{error}</p>}
        <div className="mb-6 flex flex-col gap-4">
          {searchTerm && (
            <p className="text-sm font-medium text-[#5A272A]">
              Search results for "<span className="font-bold">{searchTerm}</span>" ({filteredProducts.length})
            </p>
          )}

          {/* Reserves layout space for the fixed filter bar (measured after paint) */}
          <div
            aria-hidden
            className={`shrink-0 ${filterBarHeight > 0 ? "" : "min-h-[7.5rem]"}`}
            style={{ height: filterBarHeight > 0 ? filterBarHeight : undefined }}
          />

          {/* Tags + highlights — scroll with page (not fixed) */}
          <div className="rounded-3xl">
            <div className="flex flex-wrap gap-2">
              {tagOptions
                .filter(tag => !["ready to cook", "ready to eat"].includes(tag.name.toLowerCase().trim()))
                .map((tag) => (
                  <button
                    key={tag.id}
                    type="button"
                    onClick={() => toggleTag(tag.id)}
                    className={`rounded-full border cursor-pointer px-3 py-1 text-[10px] font-bold uppercase transition-all ${selectedTagIds.includes(tag.id)
                      ? "border-primary bg-primary text-white shadow-sm"
                      : "border-gray-200 bg-white text-gray-500 hover:border-primary"
                      }`}
                  >
                    {tag.name}
                  </button>
                ))}
              <button
                type="button"
                onClick={() => setBestSellerFilter(bestSellerFilter === "all" ? "true" : "all")}
                className={`rounded-full border px-3 cursor-pointer py-1 text-[10px] font-bold uppercase transition-all ${bestSellerFilter === "true"
                  ? "border-primary bg-primary text-white shadow-sm"
                  : "border-gray-200 bg-white text-gray-500 hover:border-primary"
                  }`}
              >
                Best Sellers
              </button>
              <button
                type="button"
                onClick={() => setFeaturedFilter(featuredFilter === "all" ? "true" : "all")}
                className={`rounded-full border px-3 py-1 cursor-pointer text-[10px] font-bold uppercase transition-all ${featuredFilter === "true"
                  ? "border-primary bg-primary text-white shadow-sm"
                  : "border-gray-200 bg-white text-gray-500 hover:border-primary"
                  }`}
              >
                Featured
              </button>
            </div>
          </div>

        </div>

        {loading && (
          <div className="mb-4 grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-3">
            {Array.from({ length: 6 }).map((_, idx) => (
              <div key={idx} className="h-56 animate-pulse rounded-2xl bg-white/70" />
            ))}
          </div>
        )}
        {!loading && filteredProducts.length === 0 && (
          <div className="flex flex-col items-center justify-center py-20 bg-white/30 rounded-3xl border-2 border-dashed border-gray-200">
            <div className="text-6xl mb-4">🍽️</div>
            <h3 className="font-melon text-xl text-[#5A272A] font-bold uppercase">No Products Found</h3>
            <p className="text-sm text-gray-500 mt-2">Try adjusting your filters or search term to find what you're looking for.</p>
            <button
              onClick={() => {
                setCategoryFilter("all")
                setPackFilter("all")
                setMealTimeFilter("all")
                setSpiceLevelFilter("all")
                setBestSellerFilter("all")
                setFeaturedFilter("all")
                setSelectedTagIds([])
                const params = new URLSearchParams(searchParams.toString())
                params.delete("page")
                params.delete("spiceLevel")
                const qs = params.toString()
                router.push(qs ? `${pathname}?${qs}` : pathname)
              }}
              className="mt-6 rounded-full bg-primary px-6 py-2 text-xs font-bold text-white uppercase tracking-widest"
            >
              Clear All Filters
            </button>
          </div>
        )}
        <div className="grid grid-cols-1 gap-5 sm:grid-cols-2 lg:grid-cols-3 pb-5">
          {paginatedProducts.map((product, idx) => {
            const displayPrice = (product as any).variants?.length
              ? Number(
                (product as any).variants.find((v: any) => v.isDefault)?.price ||
                (product as any).variants[0].price
              )
              : Number(product.price || 0);
            const globalIdx = (currentPage - 1) * PRODUCTS_PAGE_SIZE + idx
            const cardBg = productBgBySlug[String(product.slug || product.id || globalIdx)] || "#3EA6CF"
            const comboProducts = ((product as any).bundleProducts ?? []) as Array<{ thumbnail?: string | null; name?: string }>
            const comboThumbs = comboProducts
              .map((x) => (x?.thumbnail ?? "").trim())
              .filter(Boolean)
              .slice(0, 3)
            const showComboThumbStrip =
              Boolean((product as any).isCombo) &&
              (product.image === FALLBACK_PRODUCT_IMAGE || !String(product.image ?? "").trim()) &&
              comboThumbs.length > 0

            const vegNonVegTag = product.tags?.find((t: any) => t?.tag?.name === "veg" || t?.tag?.name === "non-veg")
            const tagName = vegNonVegTag?.tag?.name

            return (
              <SlideUp key={`${product.id || product.slug || "product"}-${globalIdx}`} delay={Math.min(0.18, idx * 0.03)}>
                <ScaleHover>
                  <article
                    className="group relative rounded-2xl border-2 border-transparent p-4 transition-all duration-300 hover:ring-4 hover:ring-[#F36E21] hover:shadow-xl will-change-transform"
                    style={{ backgroundColor: cardBg }}
                  >


                    {tagName && (
                      <VegNonVegTag type={tagName} />
                    )}
                    <Link href={(product as any).isCombo ? `/combo/${product.slug}` : `/product/${product.slug}`} className="block">



                      <div className={`relative mx-auto min-h-[280px] h-full w-full transition-transform duration-300 hover:scale-90 ${showComboThumbStrip ? 'max-w-full' : 'max-w-[190px]'}`}>
                        {showComboThumbStrip ? (
                          <div className="h-full w-full flex flex-col sm:flex-row   items-center justify-center gap-2 px-1">
                            {comboThumbs.map((thumb, imageIdx) => (
                              <div key={`${product.slug}-combo-thumb-${imageIdx}`} className="flex mt-[0px] sm:mt-[100px]  mb-0 flex-col sm:flex-row justify-center items-center gap-2">
                                <div className="relative h-30 w-28">
                                  <Image
                                    src={thumb}
                                    alt={`${product.name} item ${imageIdx + 1}`}
                                    fill
                                    className="object-contain"
                                  />
                                </div>
                                {imageIdx < comboThumbs.length - 1 ? (
                                  <span className="text-xl font-bold text-white/95 ">+</span>
                                ) : null}
                              </div>
                            ))}
                          </div>
                        ) : (
                          <Image src={product.image} alt={product.name} fill className="object-contain" />
                        )}
                      </div>

                      <div className="mt-2 text-center tracking-wide font-light font-melon">
                        <h3 className="text-[18px] uppercase leading-tight text-white drop-shadow-[0_1px_0_rgba(0,0,0,0.2)]">
                          {product.name}
                        </h3>
                        <p className="mt-1 text-[10px] uppercase tracking-wide text-white/90">
                          Home style meal | Net wt. {product.weight}
                        </p>
                        {product.productKind === "simple" && typeof product.stock === "number" && product.stock > 0 && product.stock <= 5 ? (
                          <p className="mt-1 text-[11px] font-medium text-orange-200">
                            Hurry up only {product.stock} left
                          </p>
                        ) : null}
                        <p className="mt-1 text-sm font-melon text-[#FFF5C5]">Rs. {product.price.toFixed(2)}</p>
                      </div>
                    </Link>

                    <button
                      type="button"
                      onClick={(e) => {
                        e.preventDefault();
                        e.stopPropagation();
                        handleToggleFavorite(e, product.slug);
                      }}
                      className="absolute left-3 top-3 z-[60] p-2 text-white cursor-pointer hover:scale-110 transition-transform"
                    >
                      <Heart size={24} className={favoriteSlugs.includes(product.slug) ? "fill-white text-white" : "text-white"} />
                    </button>

                    <div className="mt-auto flex items-end justify-between gap-2 pt-2 font-melon tracking-wide font-light">
                      {(cartQtyBySlug[product.slug] ?? 0) > 0 && product.productKind === "simple" ? (
                        <div className="flex items-center rounded-md border border-[#d5c4b8] bg-white/95 px-1 py-0.5">
                          <button
                            type="button"
                            onClick={(e) => {
                              e.stopPropagation();
                              setCartItemQuantity(product as any, Math.max(0, (cartQtyBySlug[product.slug] ?? 0) - 1));
                            }}
                            className="h-6 w-6 rounded text-sm  text-[#5A272A] hover:bg-[#f4efec]"
                          >
                            -
                          </button>
                          <span className="min-w-5 text-center text-xs font-light text-[#5A272A]">
                            {cartQtyBySlug[product.slug] ?? 0}
                          </span>
                          <button
                            type="button"
                            onClick={(e) => {
                              e.stopPropagation();
                              setCartItemQuantity(product as any, (cartQtyBySlug[product.slug] ?? 0) + 1);
                            }}
                            className="h-6 w-6 rounded text-sm text-[#5A272A] hover:bg-[#f4efec]"
                          >
                            +
                          </button>
                        </div>
                      ) : (
                        <button
                          type="button"
                          onClick={(e) => {
                            e.stopPropagation();
                            if ((product as any).isCombo) {
                              window.location.href = `/combo/${product.slug}`
                            } else if (product.productKind === "variant") {
                              setSelectedProduct(product);
                            } else {
                              setCartItemQuantity(product as any, 1);
                            }
                          }}
                          className="rounded-lg border cursor-pointer border-white tracking-wide px-4 py-1.5 text-[12px] font-light text-white hover:bg-primary hover:text-white transition-all "
                        >
                          {(product as any).isCombo ? "View Combo" : "Add to Cart"}
                        </button>
                      )}
                      <button
                        onClick={(e) => {
                          e.stopPropagation();
                          if (product.productKind === "variant") {
                            setSelectedProduct(product);
                          } else {
                            if ((cartQtyBySlug[product.slug] ?? 0) === 0) {
                              setCartItemQuantity(product as any, 1);
                            }
                            router.push("/checkout");
                          }
                        }} className="rounded-lg bg-primary cursor-pointer tracking-wide px-3 py-1.5 text-[12px] font-light text-white hover:bg-[#2d1011]">
                        Buy Now
                      </button>
                    </div>
                  </article>
                </ScaleHover>
              </SlideUp>
            );
          })}
        </div>

        {!loading && totalPages > 1 && (
          <nav
            className="mt-5 pb-4 flex flex-wrap items-center justify-center gap-3"
            aria-label="Product list pagination"
          >
            <button
              type="button"
              disabled={currentPage <= 1}
              onClick={() => goToPage(currentPage - 1)}
              className="rounded-full cursor-pointer border-2 border-primary bg-white px-4 py-2 text-xs font-bold uppercase tracking-widest text-primary transition-colors hover:bg-primary/10 disabled:pointer-events-none disabled:opacity-40"
            >
              Previous
            </button>
            <span className="min-w-[140px] text-center text-sm font-medium text-[#5A272A]">
              Page {currentPage} of {totalPages}
            </span>
            <button
              type="button"
              disabled={currentPage >= totalPages}
              onClick={() => goToPage(currentPage + 1)}
              className="rounded-full cursor-pointer border-2 border-primary bg-white px-4 py-2 text-xs font-bold uppercase tracking-widest text-primary transition-colors hover:bg-primary/10 disabled:pointer-events-none disabled:opacity-40"
            >
              Next
            </button>
          </nav>
        )}
      </div>

      {/* VARIANT SELECTION MODAL */}
      <ModalAnimation open={Boolean(selectedProduct)} className="fixed inset-0 z-[200] flex items-center justify-center bg-black/60 p-4 backdrop-blur-sm" >
        {selectedProduct ? (
          <div onClick={() => setSelectedProduct(null)} className="fixed inset-0 flex items-center justify-center p-4">
            <div className="w-full max-w-md overflow-hidden rounded-3xl bg-white shadow-2xl" onClick={(e) => e.stopPropagation()}>
              <div className="flex items-center justify-between bg-primary p-5 text-white">
                <h3 className="font-melon text-lg font-bold uppercase tracking-wider">Select Options</h3>
                <button onClick={() => setSelectedProduct(null)} className="rounded-full cursor-pointer bg-white/20 p-1 hover:bg-white/30 transition-colors">
                  <X size={20} />
                </button>
              </div>

              <div className="p-6">
                <div className="mb-4 flex gap-4">
                  <div className="relative h-20 w-20 shrink-0 rounded-xl bg-gray-100 p-2">
                    <Image src={selectedProduct.image} alt={selectedProduct.name} fill className="object-contain" />
                  </div>
                  <div>
                    <h4 className="font-melon text-base font-medium text-[#4A1D1F]">{selectedProduct.name}</h4>
                    <p className="text-xs text-gray-500 line-clamp-2">
                      {(selectedProduct.description || "").replace(/<[^>]*>/g, " ").replace(/\s+/g, " ").trim()}
                    </p>
                  </div>
                </div>

                <div className="space-y-3 max-h-[40vh] overflow-y-auto pr-1">
                  {selectedProduct.variants.map((v: any) => {
                    const vId = v.id ? String(v.id) : (v.sku || v.weight || v.name);
                    const qty = getCartQuantity(String(selectedProduct.id), vId)
                    return (
                      <div key={v.id} className="flex items-center justify-between rounded-2xl border border-gray-100 bg-gray-50/50 p-4 transition-all hover:border-orange-200">
                        <div>
                          <p className="font-melon text-sm font-medium text-[#4A1D1F]">{v.weight || v.name}</p>
                          <p className="text-sm font-medium text-orange-500">Rs. {v.price.toFixed(2)}</p>
                        </div>

                        <div className="flex items-center gap-3">
                          {qty > 0 ? (
                            <div className="flex items-center rounded-lg border border-orange-200 bg-white px-2 py-1 shadow-sm">
                              <button onClick={(e) => { e.stopPropagation(); updateVariantQty(selectedProduct, v, qty - 1); }} className="h-6 w-6 font-bold text-primary hover:scale-110 cursor-pointer transition-transform">-</button>
                              <span className="min-w-6 text-center text-xs font-bold text-gray-700">{qty}</span>
                              <button onClick={(e) => { e.stopPropagation(); updateVariantQty(selectedProduct, v, qty + 1); }} className="h-6 w-6 font-bold text-primary hover:scale-110 cursor-pointer transition-transform">+</button>
                            </div>
                          ) : (
                            <button
                              onClick={(e) => { e.stopPropagation(); updateVariantQty(selectedProduct, v, 1); }}
                              className="rounded-full cursor-pointer bg-primary px-5 py-1.5 text-[11px] font-bold text-white shadow-md hover:bg-[#3a1517] transition-all"
                            >
                              ADD
                            </button>
                          )}
                        </div>
                      </div>
                    )
                  })}
                </div>
              </div>

              <div className="border-t border-gray-100 p-5 flex items-center justify-between gap-3 bg-gray-50/50">
                <button
                  onClick={() => setSelectedProduct(null)}
                  className="flex-1 rounded-full border-2 cursor-pointer border-primary py-2.5 text-[11px] font-bold uppercase tracking-widest text-primary hover:bg-primary/10 transition-colors"
                >
                  Continue Shopping
                </button>
                <button
                  onClick={() => {
                    setSelectedProduct(null);
                    router.push("/cart");
                  }}
                  className="flex-1 rounded-full bg-primary cursor-pointer border-2 border-primary py-2.5 text-[11px] font-bold uppercase tracking-widest text-white hover:bg-[#3a1517] transition-colors"
                >
                  Go to Cart
                </button>
              </div>
            </div>
          </div>
        ) : null}
      </ModalAnimation>
    </section>
  )
}

export default function ProductsPage() {
  return (
    <Suspense
      fallback={
        <section className="flex min-h-[50vh] items-center justify-center bg-[#F3F0DC] text-[#5A272A]">
          Loading…
        </section>
      }
    >
      <ProductsPageContent />
    </Suspense>
  )
}
