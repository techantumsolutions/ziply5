"use client"

import { useEffect, useMemo, useRef, useState } from "react"
import Image from "next/image"
import { useParams, useRouter } from "next/navigation"
import { ArrowLeft, ChevronLeft, ChevronRight, Play, X } from "lucide-react"
import { getFavoriteSlugs, toggleFavoriteSlug } from "@/lib/favorites"
import { addToCart, getCartItems, getCartQuantity, setCartItemQuantity } from "@/lib/cart"
import { FALLBACK_PRODUCT_IMAGE, toStorefrontProduct, type StorefrontProduct } from "@/lib/storefront-products"
import { isVideoUrl } from "@/lib/media-utils"
import Link from "next/link"
import { toast } from "@/lib/toast"
import { Skeleton } from "@/components/ui/skeleton"
import { ModalAnimation } from "@/components/animations"

export default function ProductPage() {
  const params = useParams()
  const router = useRouter()
  const slugParam = params?.slug
  const slug = Array.isArray(slugParam) ? slugParam[0] : slugParam
  const [product, setProduct] = useState<StorefrontProduct | null>(null)
  const [relatedProducts, setRelatedProducts] = useState<StorefrontProduct[]>([])
  const [error, setError] = useState("")
  const [loading, setLoading] = useState(true)
  const [cartQtyBySlug, setCartQtyBySlug] = useState<Record<string, number>>({})
  const [quantity, setQuantity] = useState(0)
  const [selectedSize, setSelectedSize] = useState("")
  const [openSection, setOpenSection] = useState<string | null>(null)
  const [favorite, setFavorite] = useState(false)
  const [relatedStart, setRelatedStart] = useState(0)
  const [selectedImage, setSelectedImage] = useState("")
  const [isMainVideoPlaying, setIsMainVideoPlaying] = useState(false)
  const mainVideoRef = useRef<HTMLVideoElement | null>(null)
  const [thumbStart, setThumbStart] = useState(0)
  const [reviews, setReviews] = useState<Array<{ id: string; rating: number; body?: string | null; user?: { name?: string | null } | null }>>([])
  const [selectedRelatedProduct, setSelectedRelatedProduct] = useState<StorefrontProduct | null>(null)

  const updateVariantQty = (prod: StorefrontProduct, variant: any, nextQty: number) => {
    const vId = variant.id ? String(variant.id) : (variant.sku || variant.weight || variant.name);
    setCartItemQuantity({
      productId: String(prod.id),
      variantId: vId,
      slug: prod.slug,
      name: prod.name,
      price: variant.price,
      image: prod.image,
      weight: variant.weight || variant.name,
      sku: variant.sku
    }, nextQty)
  }

  const galleryImages = useMemo(() => {
    if (!product) return []
    const cleaned = (product.gallery ?? []).map((img) => img.trim()).filter(Boolean)
    const fallback = product.image.trim()
    return cleaned.length ? cleaned : fallback ? [fallback] : []
  }, [product])

  const displayImage = useMemo(() => {
    const current = selectedImage.trim()
    if (current) return current
    return galleryImages[0] ?? null
  }, [galleryImages, selectedImage])

  const visibleThumbs = useMemo(() => {
    if (galleryImages.length <= 4) return galleryImages
    return Array.from({ length: 4 }).map((_, idx) => galleryImages[(thumbStart + idx) % galleryImages.length])
  }, [galleryImages, thumbStart])

  useEffect(() => {
    if (!slug) return
    let cancelled = false
    setLoading(true)
    setError("")
    Promise.all([
      fetch(`/api/v1/products/by-slug/${encodeURIComponent(slug)}`).then((r) => r.json()),
      fetch("/api/v1/products?page=1&limit=20").then((r) => r.json()),
    ])
      .then(([single, list]: Array<{ success?: boolean; data?: unknown; message?: string }>) => {
        if (cancelled) return
        if (single.success === false || !single.data) {
          setError(single.message ?? "Product not found")
          return
        }
        console.log("products from api", single.data)
        const item = toStorefrontProduct(single.data as never)
        setProduct(item)
        const rel =
          list.success === false
            ? []
            : ((list.data as { items?: unknown[] } | undefined)?.items ?? [])
              .map((x) => toStorefrontProduct(x as never))
              .filter((x) => x.id !== item.id)
        const related = rel.filter((p) => p.status === "published")
        setRelatedProducts(related)
      })
      .catch(() => {
        if (!cancelled) setError("Could not load product")
      })
      .finally(() => {
        if (!cancelled) setLoading(false)
      })
    return () => {
      cancelled = true
    }
  }, [slug])

  useEffect(() => {
    if (!product?.id) return
    let cancelled = false
    fetch(`/api/v1/reviews?public=1&productId=${encodeURIComponent(String(product.id))}`)
      .then((r) => r.json())
      .then((payload: { success?: boolean; data?: Array<{ id: string; rating: number; body?: string | null; user?: { name?: string | null } | null }> }) => {
        if (!cancelled && payload.success && Array.isArray(payload.data)) {
          setReviews(payload.data)
        }
      })
      .catch(() => null)
    return () => {
      cancelled = true
    }
  }, [product?.id])

  console.log("Fetched  Product details are::::", product);

  const visibleRelated = useMemo(() => {
    if (relatedProducts.length === 0) return []
    return Array.from({ length: 4 }).map((_, index) => {
      const item = relatedProducts[(relatedStart + index) % relatedProducts.length]
      return item
    })
  }, [relatedProducts, relatedStart])

  const activeVariant = useMemo(() => {
    if (!product) return null
    return product.variants.find((v) => v.name === selectedSize || v.weight === selectedSize) ?? product.variants[0] ?? null
  }, [product, selectedSize])
  const allVariantsOutOfStock = useMemo(
    () => Boolean(product?.variants.length) && product?.variants.every((v) => v.stock <= 0),
    [product],
  )

  const currentOldPrice = (activeVariant ? activeVariant.mrp : product?.oldPrice) || 0
  const currentPrice = (activeVariant ? activeVariant.price : product?.price) || currentOldPrice
  const hasDiscount = currentOldPrice > currentPrice && currentPrice > 0
  const sku = `SKU:${activeVariant?.sku ?? (product ? product.sku.toUpperCase() : "")}`

  const salePercent = hasDiscount ? Math.round((1 - currentPrice / currentOldPrice) * 100) : null

  useEffect(() => {
    if (!product) return
    setSelectedImage((product.gallery[0] ?? product.image ?? "").trim())
    setIsMainVideoPlaying(false)
    const defaultVariant = product.variants.find((v) => v.isDefault) ?? product.variants[0]
    setSelectedSize(defaultVariant?.weight || defaultVariant?.name || product.weight)
    const initialQty = getCartQuantity(product.id, defaultVariant?.id ?? null)
    setQuantity(initialQty)
    setOpenSection(null)
    setRelatedStart(0)
    setThumbStart(0)
    setFavorite(getFavoriteSlugs().includes(product.slug))
  }, [product])

  useEffect(() => {
    setIsMainVideoPlaying(false)
  }, [selectedImage])

  useEffect(() => {
    if (!product) return
    const syncCartQty = () => {
      const items = getCartItems()
      const qtyMap = items.reduce<Record<string, number>>((acc, item) => {
        acc[item.slug] = item.quantity
        return acc
      }, {})
      setCartQtyBySlug(qtyMap)
    }
    const syncQty = () => {
      const qty = getCartQuantity(product.id, activeVariant?.id ?? null)
      setQuantity(qty)
    }

    syncCartQty()
    syncQty()

    const handleUpdate = () => {
      syncCartQty()
      syncQty()
    }
    window.addEventListener("ziply5:cart-updated", handleUpdate)
    window.addEventListener("storage", handleUpdate)
    return () => {
      window.removeEventListener("ziply5:cart-updated", handleUpdate)
      window.removeEventListener("storage", handleUpdate)
    }
  }, [activeVariant?.id, product])

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
            if (product && payload.data.includes(product.slug)) setFavorite(true);
          }
        } catch (e) { /* silent fail */ }
      }
    };
    fetchDbFavorites();
  }, [product]);

  const handleToggleFavorite = async (e: React.MouseEvent, slug: string) => {
    e.stopPropagation();
    const token = window.localStorage.getItem("ziply5_access_token");
    if (!token) {
      window.localStorage.setItem("ziply5_pending_wishlist_slug", slug);
      router.push(`/login?next=${encodeURIComponent(window.location.pathname + window.location.search)}`);
      return;
    }
    const isNowFav = await toggleFavoriteSlug(slug);
    if (isNowFav) {
      toast.success("Added to favorites", "The product is now in your favorites.");
    } else {
      toast.info("Removed from favorites", "The product has been removed from your favorites.");
    }
    setFavorite(isNowFav);
  }

  if (loading) {
    return (
      <section className="w-full bg-[#F3F3F3] py-8 md:py-10">
        <div className="mx-auto w-full max-w-7xl px-4 sm:px-6 lg:px-8">
          <div className="grid grid-cols-1 gap-10 lg:grid-cols-[420px_1fr]">
            {/* Image skeleton */}
            <div className="space-y-4">
              <Skeleton className="h-[400px] w-full rounded-xl" />
              <div className="flex items-center justify-center gap-2">
                <Skeleton className="h-16 w-16 rounded-md" />
                <Skeleton className="h-16 w-16 rounded-md" />
                <Skeleton className="h-16 w-16 rounded-md" />
                <Skeleton className="h-16 w-16 rounded-md" />
              </div>
            </div>
            {/* Details skeleton */}
            <div className="space-y-4">
              <Skeleton className="h-8 w-32 rounded-full" />
              <Skeleton className="h-10 w-3/4" />
              <div className="flex items-center gap-2">
                <Skeleton className="h-6 w-24 rounded-full" />
                <Skeleton className="h-6 w-32 rounded-full" />
                <Skeleton className="h-6 w-16 rounded-md" />
              </div>
              <div className="flex items-end gap-2">
                <Skeleton className="h-8 w-28" />
                <Skeleton className="h-5 w-20" />
              </div>
              <Skeleton className="h-4 w-full" />
              <Skeleton className="h-4 w-5/6" />
              <Skeleton className="h-4 w-4/6" />
              <div className="flex items-center gap-2 pt-2">
                <Skeleton className="h-8 w-16 rounded-md" />
                <Skeleton className="h-8 w-16 rounded-md" />
                <Skeleton className="h-8 w-16 rounded-md" />
              </div>
              <div className="flex items-center gap-4 pt-2">
                <Skeleton className="h-10 w-24 rounded-2xl" />
                <Skeleton className="h-10 w-10 rounded-md" />
              </div>
              <div className="mt-4 grid grid-cols-3 gap-4 border-t border-[#DEDEDE] pt-5">
                <div className="flex flex-col items-center gap-2">
                  <Skeleton className="h-10 w-10 rounded-full" />
                  <Skeleton className="h-3 w-20" />
                </div>
                <div className="flex flex-col items-center gap-2">
                  <Skeleton className="h-10 w-10 rounded-full" />
                  <Skeleton className="h-3 w-20" />
                </div>
                <div className="flex flex-col items-center gap-2">
                  <Skeleton className="h-10 w-10 rounded-full" />
                  <Skeleton className="h-3 w-20" />
                </div>
              </div>
            </div>
          </div>
          <div className="mt-10 space-y-4 border-t border-[#DFDFDF]">
            <Skeleton className="h-12 w-full" />
            <Skeleton className="h-12 w-full" />
            <Skeleton className="h-12 w-full" />
          </div>
          <div className="mt-10 rounded-2xl bg-[#ECECEC] p-5 sm:p-7">
            <Skeleton className="h-10 w-64" />
            <div className="mt-5 grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-4">
              <Skeleton className="h-[280px] rounded-2xl" />
              <Skeleton className="h-[280px] rounded-2xl" />
              <Skeleton className="h-[280px] rounded-2xl" />
              <Skeleton className="h-[280px] rounded-2xl" />
            </div>
          </div>
        </div>
      </section>
    )
  }
  if (error || !product) {
    return (
      <section className="flex min-h-[60vh] items-center justify-center bg-[#F3F3F3]">
        <p className="rounded-lg bg-red-50 px-4 py-3 text-sm text-red-800">{error || "Product not found"}</p>
      </section>
    )
  }

  return (
    <section className="w-full bg-[#F3F3F3] py-8 md:py-10">
      <div className="mx-auto w-full max-w-7xl px-4 sm:px-6 lg:px-8">
        <div className="grid grid-cols-1 gap-10 lg:grid-cols-[420px_1fr]">
          <div>
            <div className="rounded-xl border border-[#E2E2E2] bg-[#ECECEC]">
              <div className="relative bg-white/70 mx-auto rounded-xl h-100 w-full stretch overflow-hidden">
                {displayImage ? (
                  isVideoUrl(displayImage) ? (
                    <div className="relative h-full w-full bg-black">
                      <video
                        key={displayImage}
                        ref={mainVideoRef}
                        src={displayImage}
                        controls={isMainVideoPlaying}
                        playsInline
                        className="h-full w-full object-contain"
                        onPlay={() => setIsMainVideoPlaying(true)}
                        onPause={() => setIsMainVideoPlaying(false)}
                        onEnded={() => setIsMainVideoPlaying(false)}
                      />
                      {!isMainVideoPlaying ? (
                        <button
                          type="button"
                          aria-label="Play video"
                          onClick={() => {
                            setIsMainVideoPlaying(true)
                            void mainVideoRef.current?.play()
                          }}
                          className="absolute inset-0 flex cursor-pointer items-center justify-center bg-black/25"
                        >
                          <span className="inline-flex h-14 w-14 items-center justify-center rounded-full bg-white/95 text-[#4A1D1F] shadow-lg">
                            <Play className="h-7 w-7 fill-current" />
                          </span>
                        </button>
                      ) : null}
                    </div>
                  ) : (
                    <Image src={displayImage || FALLBACK_PRODUCT_IMAGE} alt={product.name} fill className="object-contain" />
                  )
                ) : (
                  <div className="flex h-full items-center justify-center text-xs text-[#666]">No image</div>
                )}
              </div>
            </div>

            <div className="flex items-center justify-center gap-2">
              <button
                type="button"
                disabled={galleryImages.length <= 4}
                onClick={() => setThumbStart((prev) => (prev - 1 + galleryImages.length) % galleryImages.length)}
                className={`h-8 w-8 items-center justify-center rounded-full border ${galleryImages.length <= 4 ? "hidden" : "flex"} border-[#D4D4D4] bg-white text-[#555] disabled:opacity-40`}
              >
                <ChevronLeft size={14} />
              </button>
              <div className="flex items-center gap-1 overflow-x-auto pb-1">
                {visibleThumbs.map((thumb, idx) => {
                  const thumbIsVideo = isVideoUrl(thumb)
                  return (
                    <button
                      type="button"
                      key={`${thumb || "thumb"}-${idx}`}
                      onClick={() => setSelectedImage(thumb)}
                      className={`relative h-30 w-30 flex-shrink-0 mt-8 overflow-hidden rounded-md border ${selectedImage === thumb ? "border-[#50272A]" : "border-[#E0E0E0]"
                        }`}
                    >
                      {thumbIsVideo ? (
                        <>
                          <video src={thumb} muted preload="metadata" className="h-full w-full object-cover bg-black" />
                          <span className="pointer-events-none absolute inset-0 flex items-center justify-center bg-black/35">
                            <span className="inline-flex h-8 w-8 items-center justify-center rounded-full bg-white/95 text-[#4A1D1F] shadow">
                              <Play className="h-4 w-4 fill-current" />
                            </span>
                          </span>
                        </>
                      ) : (
                        <Image src={thumb || FALLBACK_PRODUCT_IMAGE} alt={`${product.name} preview`} fill className="object-cover" />
                      )}
                    </button>
                  )
                })}
              </div>
              <button
                type="button"
                disabled={galleryImages.length <= 4}
                onClick={() => setThumbStart((prev) => (prev + 1) % galleryImages.length)}
                className={`flex h-8 w-8 items-center justify-center rounded-full border ${galleryImages.length <= 4 ? "hidden" : "flex"} border-[#D4D4D4] bg-white text-[#555] disabled:opacity-40`}
              >
                <ChevronRight size={14} />
              </button>
            </div>
            {product.videoUrl && (
              <div className="mt-4 overflow-hidden rounded-xl border border-[#E2E2E2] bg-black">
                <video src={product.videoUrl} controls className="w-full" />
              </div>
            )}
          </div>

          <div className="">
            <button
              type="button"
              onClick={() => router.push("/products")}
              className="inline-flex items-center gap-1 cursor-pointer rounded-full border border-[#D6D6D6] bg-white px-3 py-1 text-[11px] font-semibold text-[#6B6B6B]"
            >
              <ArrowLeft size={14} />
              Back To Products List
            </button>

            <h1 className="font-heading mt-3 text-4xl leading-none text-[#201A1A]">{product.name}</h1>

            <div className="mt-2 grid grid-cols-2 gap-2 md:flex md:items-center md:gap-2">
              <span className="rounded-full bg-[#F0ECE2] px-3 py-1 text-[12px] font-medium text-[#8D8D8D] text-center">{sku}</span>
              <span className="rounded-full bg-[#DFE8D8] px-3 py-1 text-[12px] font-medium text-[#86917B] capitalize text-center">
                {((product.productKind === "simple" ? (product.stock ?? 0) : (activeVariant?.stock ?? 0)) > 5) ? (
                  product.stockStatus?.replace("_", " ") + ":"
                ) : (
                  (product.productKind === "simple" ? (product.stock ?? 0) : (activeVariant?.stock ?? 0)) <= 0 ? (
                    product.stockStatus?.replace("_", " ")
                  ) : null
                )}
                {product.productKind === "simple" && product.stock && product?.stock > 0 && (
                  <span className="ml-1">
                    {product.stock < 5 ? `Hurry up only ${product.stock} left` : `${product.stock} available`}
                  </span>
                )}
                {activeVariant && activeVariant.stock > 0 && (
                  <> {activeVariant.stock <= 5 ? "Hurry, only a few left!" : `${activeVariant.stock} available`}</>
                )}
              </span>
              {salePercent && salePercent > 0 && (
                <span className="rounded-md bg-[#2E84CF] px-2 py-1 text-[11px] font-semibold text-white text-center">SALE {salePercent}% Off</span>
              )}
              {product.labels.slice(0, 2).map((label, idx) => (
                <span key={`${label.label || "label"}-${idx}`} className="rounded-md px-2 py-1 text-[11px] font-semibold text-white text-center" style={{ backgroundColor: label.color ?? "#A32424" }}>
                  {label.label}
                </span>
              ))}
              <span
                className={`rounded-md px-2 py-1 text-[11px] font-semibold text-white text-center ${product.type === "veg" ? "bg-[#2EA852]" : "bg-[#A32424]"
                  }`}
              >
                {product.type === "veg" ? "Vegetarian" : "Non-Vegetarian"}
              </span>
            </div>

            <div className="mt-3 flex items-end gap-2">
              <p className="text-[28px] font-extrabold text-[#B44444]">₹{currentPrice.toFixed(2)}</p>
              {hasDiscount ? (
                <p className="pb-1 text-sm font-semibold text-[#B8B8B8] line-through">₹{currentOldPrice.toFixed(2)}</p>
              ) : null}
            </div>
            <p className="text-sm text-[#8A8A8A]">Taxes included. Shipping calculated at checkout.</p>

            {product.description ? (
              <div
                className="prose prose-sm mt-2 max-w-2xl text-sm leading-6 text-[#595959] [&_p]:mb-2 [&_ul]:mb-2 [&_ul]:list-disc [&_ul]:pl-5 [&_ol]:list-decimal [&_ol]:pl-5"
                dangerouslySetInnerHTML={{ __html: product.description }}
              />
            ) : null}

            <div className="mt-5 flex items-center gap-2">
              <span className="text-xs font-light font-melon tracking-wide text-[#272727]">Size (Wt)</span>
              {(product.variants.length ? product.variants.map((v) => v.weight || v.name) : [product.weight]).map((size, idx) => {
                const variant = product.variants.find((v) => (v.weight || v.name) === size)
                const outOfStock = variant ? variant.stock <= 0 : false
                return (
                  <button
                    type="button"
                    key={`${size || "size"}-${idx}`}
                    onClick={() => setSelectedSize(size)}
                    disabled={outOfStock}
                    className={`rounded-md border px-3 py-1 text-xs font-semibold ${selectedSize === size
                      ? "border-[#A33838] bg-[#A33838] text-white"
                      : "border-[#D8D8D8] bg-white text-[#696969] hover:border-[#A33838]"
                      } disabled:cursor-not-allowed disabled:opacity-40`}
                  >
                    {size}
                  </button>
                )
              })}
            </div>
            {allVariantsOutOfStock && <p className="mt-2 text-sm font-semibold text-red-700">Out of Stock</p>}

            <div className="mt-4 flex items-center gap-4">
              <span className="text-xs font-light font-melon tracking-wide text-[#272727]" title="Quantity Add to Cart">Add to cart</span>
              <div className="flex items-center overflow-hidden rounded-2xl border border-[#FF8A00]">
                <button
                  type="button"
                  onClick={() => {
                    const nextQty = Math.max(0, quantity - 1)
                    setCartItemQuantity({
                      productId: product.id,
                      variantId: activeVariant?.id ?? null,
                      slug: product.slug,
                      name: product.name,
                      variantLabel: selectedSize,
                      variantOptions: selectedSize ? [selectedSize] : [],
                      price: currentPrice,
                      comparePrice: currentOldPrice,
                      stock: activeVariant?.stock ?? product.stock ?? null,
                      image: product.image,
                      weight: selectedSize,
                      sku: activeVariant?.sku,
                    }, nextQty)
                    setQuantity(nextQty)
                  }}
                  className="h-10 w-9 text-lg cursor-pointer font-bold transition hover:bg-[#6A3033]"
                >
                  -
                </button>
                <span className="w-8 text-center text-sm font-semibold">{quantity}</span>
                <button
                  type="button"
                  onClick={() => {
                    const nextQty = quantity + 1
                    setCartItemQuantity({
                      productId: product.id,
                      variantId: activeVariant?.id ?? null,
                      slug: product.slug,
                      name: product.name,
                      variantLabel: selectedSize,
                      variantOptions: selectedSize ? [selectedSize] : [],
                      price: currentPrice,
                      comparePrice: currentOldPrice,
                      stock: activeVariant?.stock ?? product.stock ?? null,
                      image: product.image,
                      weight: selectedSize,
                      sku: activeVariant?.sku,
                    }, nextQty)
                    setQuantity(nextQty)
                  }}
                  className="h-10 w-9 text-lg cursor-pointer font-bold transition hover:bg-[#6A3033]"
                >
                  +
                </button>
              </div>
            </div>
            {/* <p className="mt-4 text-sm font-bold text-[#272727]"><span className="font-light font-melon tracking-wide">Variant:</span> <span>{selectedSize}</span></p> */}

            <div className="mt-5 flex items-center gap-3">
              <button
                type="button"
                onClick={() => {
                  addToCart({
                    productId: product.id,
                    variantId: activeVariant?.id ?? null,
                    slug: product.slug,
                    name: product.name,
                    variantLabel: selectedSize,
                    variantOptions: selectedSize ? [selectedSize] : [],
                    price: currentPrice,
                    comparePrice: currentOldPrice,
                    stock: activeVariant?.stock ?? product.stock ?? null,
                    image: product.image,
                    weight: selectedSize,
                    sku: activeVariant?.sku,
                  }, Math.max(1, quantity))
                  router.push("/cart")
                }}
                disabled={allVariantsOutOfStock}
                className="font-medium font-melon cursor-pointer tracking-wide rounded-2xl border border-[#FF8A00] bg-primary flex items-center px-6 py-2.5 text-xl leading-none text-white transition hover:bg-[#e97819]"
              >
                Buy now
                <img src="/assets/Productdetails/rightArrow.png" alt="Buy Now" className="inline-block h-4 w-4 ml-2 object-contain" />
              </button>

              {(product as any).amazonLink && (
                <a
                  href={(product as any).amazonLink}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="font-sm font-melon cursor-pointer tracking-wide rounded-2xl border border-primary flex items-center px-6 py-2.5 text-xl leading-none text-primary transition hover:bg-[#e68a00]"
                >
                  Buy @Amazon
                </a>
              )}

              <button
                type="button"
                onClick={(e) => handleToggleFavorite(e, product.slug)}
                className="flex h-10 w-10 cursor-pointer items-center justify-center rounded-md border border-[#E5E5E5] text-xl text-[#4C4C4C] hover:text-[#5A272A]"
              >
                {favorite ? "♥" : "♡"}
              </button>
            </div>
            {/* box features with image */}
            <div className="mt-8 grid grid-cols-3 gap-4 border-t border-[#DEDEDE] pt-5">
              {(product.features.length ? product.features : [{ title: "Home Made", icon: null }]).map((item, idx) => (
                <div key={`${item.title || "feature"}-${idx}`} className="flex flex-col items-center gap-2 text-center">
                  {item.icon ? (
                    <div className="relative h-10 w-10">
                      <Image src={item.icon} alt={item.title} fill className="object-contain" />
                    </div>
                  ) : (
                    <div className="flex h-10 w-10 items-center justify-center rounded-full bg-[#F0ECE2] text-[10px] font-semibold text-[#5A272A]">
                      *
                    </div>
                  )}
                  <p className="text-[11px] font-semibold text-[#333]">{item.title}</p>
                </div>
              ))}
            </div>
          </div>
        </div>
        {/* <div className="mt-8 xl:hidden grid-cols-6 gap-4 hidden lg:grid border-t border-[#DEDEDE] pt-5">
              {product?.features?.length  && (product?.features?.map((item) => (
                <div key={item.title} className="flex flex-col border rounded-2xl py-2 border-[#DEDEDE]] items-center gap-2 text-center">
                  <div className="relative h-10 w-10">
                    <Image src={item.icon || ""} alt={item.title} fill className="object-contain" />
                  </div>
                  <p className="text-[11px] font-semibold text-[#333]">{item.title}</p>
                </div>
              )))}
            </div> */}
        <div className="mt-10 border-t border-[#DFDFDF]">
          {/* Product Details */}
          {product?.details?.length > 0 &&
            product.details.map((section: any, idx: number) => {
              const sectionId = `detail-${section.id || idx}`
              const isOpen = openSection === sectionId
              const content = section.description || section.content

              return (
                <div key={sectionId} className="border-b border-[#DFDFDF]">
                  <button
                    type="button"
                    onClick={() => setOpenSection(isOpen ? null : sectionId)}
                    className="flex w-full items-center justify-between py-5 text-left"
                  >
                    <span className="font-melon text-sm font-light tracking-wide text-[#262626]">
                      {section.title}
                    </span>

                    <span className="inline-flex h-5 w-5 items-center justify-center rounded-full bg-[#F58B2E] text-sm font-bold text-white">
                      {isOpen ? "-" : "+"}
                    </span>
                  </button>

                  {isOpen && (
                    <div
                      className="pb-5 pr-10 text-sm leading-6 text-[#606060]"
                      dangerouslySetInnerHTML={{ __html: content }}
                    />
                  )}
                </div>
              )
            })}

          {/* Product Sections details*/}
          {(!product?.details || product.details.length === 0) &&
            product?.sections?.length > 0 &&
            product.sections.map((section: any, idx: number) => {
              const sectionId = `section-${section.id || idx}`
              const isOpen = openSection === sectionId
              const content = section.description || section.content

              return (
                <div key={sectionId} className="border-b border-[#DFDFDF]">
                  <button
                    type="button"
                    onClick={() => setOpenSection(isOpen ? null : sectionId)}
                    className="flex w-full items-center cursor-pointer justify-between py-5 text-left"
                  >
                    <span className="font-melon text-sm font-light tracking-wide text-[#262626]">
                      {section.title}
                    </span>

                    <span className="inline-flex h-5 w-5 cursor-pointer items-center justify-center rounded-full bg-[#F58B2E] text-sm font-bold text-white">
                      {isOpen ? "-" : "+"}
                    </span>
                  </button>

                  {isOpen && (
                    <div
                      className="pb-5 pr-10 text-sm leading-6 text-[#606060]"
                      dangerouslySetInnerHTML={{ __html: content }}
                    />
                  )}
                </div>
              )
            })}

          {/* Fallback Description */}
          {(!product?.details || product.details.length === 0) &&
            (!product?.sections || product.sections.length === 0) && (
              <div className="border-b border-[#DFDFDF]">
                <button
                  type="button"
                  onClick={() =>
                    setOpenSection(
                      openSection === "description" ? null : "description"
                    )
                  }
                  className="flex w-full items-center justify-between py-5 text-left"
                >
                  <span className="font-melon text-sm font-light tracking-wide text-[#262626]">
                    Description
                  </span>

                  <span className="inline-flex h-5 w-5 items-center justify-center rounded-full bg-[#F58B2E] text-sm font-bold text-white">
                    {openSection === "description" ? "-" : "+"}
                  </span>
                </button>

                {openSection === "description" && (
                  <div
                    className="pb-5 pr-10 text-sm leading-6 text-[#606060]"
                    dangerouslySetInnerHTML={{
                      __html: product.description || "",
                    }}
                  />
                )}
              </div>
            )}
        </div>

        {reviews.length > 0 && (<div className="mt-10 rounded-2xl border border-[#E8DCC8] bg-white p-5 sm:p-7">
          <h2 className="font-heading text-3xl uppercase text-[#4A1E1F]">Customer Reviews</h2>
          {reviews.length === 0 ? (
            <p className="mt-3 text-sm text-[#646464]">No reviews yet.</p>
          ) : (
            <div className="mt-4 space-y-3">
              {reviews.map((review) => (
                <div key={review.id} className="rounded-xl border border-[#F2E6DD] bg-[#FFFBF7] p-3">
                  <div className="flex items-center justify-between gap-2">
                    <p className="text-sm font-semibold text-[#2A1810]">{review.user?.name ?? "Customer"}</p>
                    <p className="text-sm text-[#F59E0B]">{"★".repeat(Math.max(1, Math.min(5, Number(review.rating || 0))))}</p>
                  </div>
                  <p className="mt-1 text-sm text-[#646464]">{review.body ?? ""}</p>
                </div>
              ))}
            </div>
          )}
        </div>)}

        <div className="mt-10 rounded-2xl bg-[#ECECEC] p-5 sm:p-7 font-melon tracking-wide font-medium">
          <h2 className="font-heading text-3xl uppercase text-[#4A1E1F]">Related Products</h2>
          <div className="mt-5 grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-4">
            {visibleRelated.map((item, idx) => (
              <div
                key={`${item.id}-${item.slug}-${idx}`}
                onClick={() => router.push(`/product/${item.slug}`)}
                className="block text-left h-full cursor-pointer"
              >
                <article
                  className="group flex flex-col h-full rounded-2xl border-2 border-transparent p-3 transition-all duration-300 hover:border-[#F0E4A3]"
                  style={{ backgroundColor: "#3EA6CF" }}
                >
                  <div className="relative mx-auto h-[220px] w-full max-w-[140px]">
                    <Image src={item.image} alt={item.name} fill className="object-contain" />
                  </div>
                  <h3 className="mt-2 text-center text-[22px] font-black uppercase leading-tight text-white">{item.name}</h3>
                  <p className="mt-1 text-center text-[10px] font-semibold uppercase text-white/90">
                    Home style meal | Net wt. {item.weight}
                  </p>
                  <p className="mt-2 text-sm text-center font-medium text-[#FFF5C5]">Rs. {item.price.toFixed(2)}</p>
                  <div className="mt-auto pt-3 flex items-center justify-between gap-2">
                    {(cartQtyBySlug[item.slug] ?? 0) > 0 && item.productKind === "simple" ? (
                      <div className="flex items-center rounded-md border border-[#d5c4b8] bg-white/95 px-1 py-0.5">
                        <button
                          type="button"
                          onClick={(e) => {
                            e.stopPropagation()
                            const qty = cartQtyBySlug[item.slug] ?? 0
                            const nextQty = Math.max(0, qty - 1)
                            const defaultVariant = item.variants.find((v) => v.isDefault) ?? item.variants[0]
                            setCartItemQuantity({
                              productId: item.id,
                              variantId: defaultVariant?.id ?? null,
                              slug: item.slug,
                              name: item.name,
                              price: item.price,
                              comparePrice: item.oldPrice,
                              image: item.image,
                              weight: item.weight,
                              sku: item.sku,
                              stock: item.stock,
                            }, nextQty)
                          }}
                          className="h-6 w-6 rounded cursor-pointer text-sm font-light text-[#5A272A] hover:bg-[#f4efec]"
                        >
                          -
                        </button>
                        <span className="min-w-5 text-center text-xs font-light text-[#5A272A]">
                          {cartQtyBySlug[item.slug] ?? 0}
                        </span>
                        <button
                          type="button"
                          onClick={(e) => {
                            e.stopPropagation()
                            const qty = cartQtyBySlug[item.slug] ?? 0
                            const nextQty = qty + 1
                            const defaultVariant = item.variants.find((v) => v.isDefault) ?? item.variants[0]
                            setCartItemQuantity({
                              productId: item.id,
                              variantId: defaultVariant?.id ?? null,
                              slug: item.slug,
                              name: item.name,
                              price: item.price,
                              comparePrice: item.oldPrice,
                              image: item.image,
                              weight: item.weight,
                              sku: item.sku,
                              stock: item.stock,
                            }, nextQty)
                          }}
                          className="h-6 w-6 rounded text-sm cursor-pointer font-light text-[#5A272A] hover:bg-[#f4efec]"
                        >
                          +
                        </button>
                      </div>
                    ) : (
                      <button
                        type="button"
                        onClick={(e) => {
                          e.stopPropagation()
                          if (item.productKind === "variant") {
                            setSelectedRelatedProduct(item)
                          } else {
                            const defaultVariant = item.variants.find((v) => v.isDefault) ?? item.variants[0]
                            setCartItemQuantity({
                              productId: item.id,
                              variantId: defaultVariant?.id ?? null,
                              slug: item.slug,
                              name: item.name,
                              price: item.price,
                              comparePrice: item.oldPrice,
                              image: item.image,
                              weight: item.weight,
                              sku: item.sku,
                              stock: item.stock,
                            }, 1)
                          }
                        }}
                        className="rounded-lg border cursor-pointer border-white tracking-wide px-4 py-1.5 text-[12px] font-light text-white hover:bg-primary hover:text-white transition-all "
                      >
                        {item.productKind === "variant" ? "Select Options" : "Add to Cart"}
                      </button>
                    )}
                    <button
                      onClick={(e) => {
                        e.stopPropagation()
                        if (item.productKind === "variant") {
                          setSelectedRelatedProduct(item)
                        } else {
                          if ((cartQtyBySlug[item.slug] ?? 0) === 0) {
                            const defaultVariant = item.variants.find((v) => v.isDefault) ?? item.variants[0]
                            setCartItemQuantity({
                              productId: item.id,
                              variantId: defaultVariant?.id ?? null,
                              slug: item.slug,
                              name: item.name,
                              price: item.price,
                              comparePrice: item.oldPrice,
                              image: item.image,
                              weight: item.weight,
                              sku: item.sku,
                              stock: item.stock,
                            }, 1)
                          }
                          router.push("/checkout")
                        }
                      }}
                      className="rounded-lg bg-primary cursor-pointer tracking-wide px-3 py-1.5 text-[12px] font-light text-white hover:bg-[#2d1011]"
                    >
                      Buy Now
                    </button>
                  </div>

                  {/* <p className="mt-2 text-sm font-medium text-[#FFF5C5]">Rs. {product.price.toFixed(2)}</p> */}
                </article>
              </div>
            ))}
          </div>
          <div className="mt-6 flex justify-end gap-2">
            <button
              type="button"
              disabled={relatedProducts.length === 0}
              onClick={() => setRelatedStart((prev) => (prev - 4 + relatedProducts.length) % relatedProducts.length)}
              className="flex h-9 w-9 items-center justify-center rounded-full border border-[#D4D4D4] bg-white text-[#555] disabled:opacity-40"
            >
              <ChevronLeft size={16} />
            </button>
            <button
              type="button"
              disabled={relatedProducts.length === 0}
              onClick={() => setRelatedStart((prev) => (prev + 4) % relatedProducts.length)}
              className="flex h-9 w-9 items-center justify-center rounded-full border border-[#D4D4D4] bg-white text-[#555] disabled:opacity-40"
            >
              <ChevronRight size={16} />
            </button>
          </div>
        </div>
      </div>

      {/* VARIANT SELECTION MODAL FOR RELATED PRODUCTS */}
      <ModalAnimation open={Boolean(selectedRelatedProduct)} className="fixed inset-0 z-[200] flex items-center justify-center bg-black/60 p-4 backdrop-blur-sm">
        {selectedRelatedProduct ? (
          <div onClick={() => setSelectedRelatedProduct(null)} className="fixed inset-0 flex items-center justify-center p-4">
            <div className="w-full max-w-md overflow-hidden rounded-3xl bg-white shadow-2xl" onClick={(e) => e.stopPropagation()}>
              <div className="flex items-center justify-between bg-primary p-5 text-white">
                <h3 className="font-melon text-lg font-bold uppercase tracking-wider">Select Options</h3>
                <button onClick={() => setSelectedRelatedProduct(null)} className="rounded-full cursor-pointer bg-white/20 p-1 hover:bg-white/30 transition-colors">
                  <X size={20} />
                </button>
              </div>

              <div className="p-6">
                <div className="mb-4 flex gap-4">
                  <div className="relative h-20 w-20 shrink-0 rounded-xl bg-gray-100 p-2">
                    <Image src={selectedRelatedProduct.image} alt={selectedRelatedProduct.name} fill className="object-contain" />
                  </div>
                  <div>
                    <h4 className="font-melon text-base font-medium text-[#4A1D1F]">{selectedRelatedProduct.name}</h4>
                    <p className="text-xs text-gray-500 line-clamp-2">
                      {(selectedRelatedProduct.description || "").replace(/<[^>]*>/g, " ").replace(/\s+/g, " ").trim()}
                    </p>
                  </div>
                </div>

                <div className="space-y-3 max-h-[40vh] overflow-y-auto pr-1">
                  {selectedRelatedProduct.variants.map((v: any) => {
                    const vId = v.id ? String(v.id) : (v.sku || v.weight || v.name);
                    const qty = getCartQuantity(String(selectedRelatedProduct.id), vId)
                    return (
                      <div key={vId} className="flex items-center justify-between rounded-2xl border border-gray-100 bg-gray-50/50 p-4 transition-all hover:border-orange-200">
                        <div>
                          <p className="font-melon text-sm font-medium text-[#4A1D1F]">{v.weight || v.name}</p>
                          <p className="text-sm font-medium text-orange-500">Rs. {v.price.toFixed(2)}</p>
                        </div>

                        <div className="flex items-center gap-3">
                          {qty > 0 ? (
                            <div className="flex items-center rounded-lg border border-orange-200 bg-white px-2 py-1 shadow-sm">
                              <button onClick={(e) => { e.stopPropagation(); updateVariantQty(selectedRelatedProduct, v, qty - 1); }} className="h-6 w-6 font-bold text-primary hover:scale-110 cursor-pointer transition-transform">-</button>
                              <span className="min-w-6 text-center text-xs font-bold text-gray-700">{qty}</span>
                              <button onClick={(e) => { e.stopPropagation(); updateVariantQty(selectedRelatedProduct, v, qty + 1); }} className="h-6 w-6 font-bold text-primary hover:scale-110 cursor-pointer transition-transform">+</button>
                            </div>
                          ) : (
                            <button
                              onClick={(e) => { e.stopPropagation(); updateVariantQty(selectedRelatedProduct, v, 1); }}
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
                  onClick={() => setSelectedRelatedProduct(null)}
                  className="flex-1 rounded-full border-2 cursor-pointer border-primary py-2.5 text-[11px] font-bold uppercase tracking-widest text-primary hover:bg-primary/10 transition-colors"
                >
                  Continue Shopping
                </button>
                <button
                  onClick={() => {
                    setSelectedRelatedProduct(null);
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
