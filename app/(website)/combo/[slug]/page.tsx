"use client"

import { use, useEffect, useMemo, useState } from "react"
import Image from "next/image"
import Link from "next/link"
import { useRouter } from "next/navigation"
import { ArrowLeft } from "lucide-react"
import { getCartItems, getCartQuantity, setCartItemQuantity } from "@/lib/cart"
import { productImageSrc } from "@/lib/storefront-products"
import { toast } from "@/lib/toast"
import { getFavoriteSlugs, toggleFavoriteSlug } from "@/lib/favorites"

type BundleProduct = {
  productId: string
  name: string
  slug: string
  price: number
  basePrice?: number | null
  thumbnail?: string | null
  variantName?: string | null
  variantWeight?: string | null
}

type BundleDetail = {
  id: string
  name: string
  slug: string
  image?: string | null
  description?: string | null
  pricingMode: "fixed" | "dynamic"
  comboPrice?: number | null
  effectivePrice: number
  dynamicPrice: number
  savings: number
  products: BundleProduct[]
  isAvailable?: boolean
  maxPurchasableQty?: number
  unavailableReason?: string | null
}

export default function ComboDetailPage({ params }: { params: Promise<{ slug: string }> }) {
  const { slug } = use(params)
  const router = useRouter()
  const [bundle, setBundle] = useState<BundleDetail | null>(null)
  const [error, setError] = useState("")
  const [loading, setLoading] = useState(true)
  const [quantity, setQuantity] = useState(0)
  const [favorite, setFavorite] = useState(false)

  useEffect(() => {
    let cancelled = false
    setLoading(true)
    fetch(`/api/v1/bundles/by-slug/${encodeURIComponent(slug)}`)
      .then((r) => r.json().then((j) => ({ ok: r.ok, j })))
      .then(({ ok, j }) => {
        if (cancelled) return
        if (!ok) throw new Error(j?.message ?? "Unable to load combo")
        setBundle(j?.data ?? null)
      })
      .catch((e) => {
        if (!cancelled) setError(e instanceof Error ? e.message : "Unable to load combo")
      })
      .finally(() => {
        if (!cancelled) setLoading(false)
      })
    return () => {
      cancelled = true
    }
  }, [slug])

  useEffect(() => {
    if (!bundle) return
    const syncQty = () => {
      const q =
        getCartQuantity(bundle.id, null) ||
        getCartItems()
          .filter((x) => x.slug === bundle.slug && !x.variantId)
          .reduce((sum, x) => sum + x.quantity, 0)
      setQuantity(q)
    }
    syncQty()
    setFavorite(getFavoriteSlugs().includes(bundle.slug))

    const handleUpdate = () => {
      syncQty()
    }
    window.addEventListener("ziply5:cart-updated", handleUpdate)
    window.addEventListener("storage", handleUpdate)
    return () => {
      window.removeEventListener("ziply5:cart-updated", handleUpdate)
      window.removeEventListener("storage", handleUpdate)
    }
  }, [bundle])

  const comboCartItem = useMemo(() => {
    if (!bundle) return null
    return {
      productId: bundle.id,
      variantId: null,
      slug: bundle.slug,
      name: bundle.name,
      variantLabel: `${bundle.products.length} items`,
      variantOptions: [`${bundle.products.length} items`],
      price: Number(bundle.effectivePrice || 0),
      comparePrice: Number(bundle.dynamicPrice || bundle.effectivePrice || 0),
      stock: bundle.maxPurchasableQty ?? null,
      image: productImageSrc(bundle.image) || productImageSrc(bundle.products[0]?.thumbnail) || "/placeholder.svg",
      weight: `${bundle.products.length} items`,
    }
  }, [bundle])

  const handleDecrement = () => {
    if (!comboCartItem) return
    const nextQty = Math.max(0, quantity - 1)
    setCartItemQuantity(comboCartItem, nextQty)
    setQuantity(nextQty)
  }

  const handleIncrement = () => {
    if (!bundle || !comboCartItem) return
    if (!bundle.isAvailable || Number(bundle.maxPurchasableQty ?? 0) <= 0) {
      toast.error("Combo product is no longer available.")
      return
    }
    if (quantity + 1 > Number(bundle.maxPurchasableQty ?? 0)) {
      toast.error("Product is out of stock.", "Requested quantity is not available for this combo.")
      return
    }
    const nextQty = quantity + 1
    setCartItemQuantity(comboCartItem, nextQty)
    setQuantity(nextQty)
  }

  const handleBuyNow = () => {
    if (!bundle || !comboCartItem) return
    if (!bundle.isAvailable || Number(bundle.maxPurchasableQty ?? 0) <= 0) {
      toast.error("Combo product is no longer available.")
      return
    }
    const existingQty =
      getCartQuantity(bundle.id, null) ||
      getCartItems()
        .filter((x) => x.slug === bundle.slug && !x.variantId)
        .reduce((sum, x) => sum + x.quantity, 0)
    if (existingQty <= 0) {
      setCartItemQuantity(comboCartItem, 1)
      setQuantity(1)
    }
    router.push("/cart")
  }

  const handleToggleFavorite = async (e: React.MouseEvent, comboSlug: string) => {
    e.stopPropagation()
    const token = typeof window !== "undefined" ? window.localStorage.getItem("ziply5_access_token") : null
    if (!token) {
      if (typeof window !== "undefined") {
        window.localStorage.setItem("ziply5_pending_wishlist_slug", comboSlug)
      }
      router.push(`/login?next=${encodeURIComponent(window.location.pathname + window.location.search)}`)
      return
    }
    const isNowFav = await toggleFavoriteSlug(comboSlug)
    if (isNowFav) {
      toast.success("Added to favorites", "The combo is now in your favorites.")
    } else {
      toast.info("Removed from favorites", "The combo has been removed from your favorites.")
    }
    setFavorite(isNowFav)
  }

  if (loading) return <section className="mx-auto max-w-5xl px-4 py-10 text-sm text-[#646464]">Loading combo...</section>
  if (!bundle || error) return <section className="mx-auto max-w-5xl px-4 py-10 text-sm text-red-700">{error || "Combo not found"}</section>

  const isOutOfStock = !bundle.isAvailable || Number(bundle.maxPurchasableQty ?? 0) <= 0
  const hasDiscount = bundle.dynamicPrice > bundle.effectivePrice
  const discountPercent = hasDiscount && bundle.dynamicPrice > 0
    ? Math.round((1 - bundle.effectivePrice / bundle.dynamicPrice) * 100)
    : null

  return (
    <section className="mx-auto max-w-5xl space-y-6 px-4 py-8">
      <Link
        href="/products"
        className="inline-flex items-center gap-1 cursor-pointer rounded-full border border-[#D6D6D6] bg-white px-3 py-1 text-[11px] font-semibold text-[#6B6B6B] hover:bg-[#F0ECE2] transition-colors"
      >
        <ArrowLeft size={14} />
        Back To Products List
      </Link>

      <div className="grid gap-8 rounded-2xl border border-[#E8DCC8] bg-white p-6 md:grid-cols-[340px_1fr]">
        {/* Left: Combo Image */}
        <div className="relative h-80 overflow-hidden rounded-xl bg-[#FFFBF3] border border-[#E8DCC8]/60">
          {bundle.image ? (
            <Image src={bundle.image} alt={bundle.name} fill className="object-contain p-4" />
          ) : (
            <div className="flex h-full w-full items-center justify-center gap-3 p-4">
              {bundle.products.map((p) => (
                <div key={p.productId} className="relative h-full w-full flex-1">
                  {productImageSrc(p.thumbnail) ? (
                    <Image src={productImageSrc(p.thumbnail)} alt={p.name} fill className="object-contain drop-shadow-sm" />
                  ) : null}
                </div>
              ))}
            </div>
          )}
        </div>

        {/* Right: Combo Details */}
        <div className="space-y-4">
          <h1 className="font-heading text-3xl md:text-4xl leading-none text-[#201A1A]">{bundle.name}</h1>

          {/* Badges */}
          <div className="flex flex-wrap items-center gap-2">
            <span className="rounded-md bg-[#7B3010] px-2.5 py-1 text-[11px] font-semibold text-white text-center">
              Combo Pack ({bundle.products.length} Items)
            </span>
            {discountPercent && discountPercent > 0 && (
              <span className="rounded-md bg-[#2E84CF] px-2 py-1 text-[11px] font-semibold text-white text-center">
                SALE {discountPercent}% Off
              </span>
            )}
            {bundle.maxPurchasableQty !== undefined && bundle.maxPurchasableQty > 0 && bundle.maxPurchasableQty < 5 && (
              <span className="rounded-full border border-[#C2410C] bg-[#FFF1E8] px-3 py-1 text-[12px] font-semibold text-[#C2410C] text-center">
                Only few items left
              </span>
            )}
          </div>

          {/* Pricing */}
          <div className="flex items-end gap-3 pt-1">
            <p className="text-[28px] font-extrabold text-[#B44444]">₹{Number(bundle.effectivePrice).toFixed(2)}</p>
            {hasDiscount && (
              <p className="pb-1 text-sm font-semibold text-[#B8B8B8] line-through">
                ₹{Number(bundle.dynamicPrice).toFixed(2)}
              </p>
            )}
            {hasDiscount && (
              <span className="pb-1 text-xs font-bold text-[#16A34A]">
                Save ₹{Number(bundle.dynamicPrice - bundle.effectivePrice).toFixed(2)}
              </span>
            )}
          </div>
          <p className="text-sm text-[#8A8A8A]">Taxes included. Shipping calculated at checkout.</p>

          {/* Description */}
          {bundle.description ? (
            <p className="text-sm leading-6 text-[#595959]">{bundle.description}</p>
          ) : (
            <p className="text-sm leading-6 text-[#595959]">Special combo offer bundle including {bundle.products.length} selected products.</p>
          )}

          {isOutOfStock && <p className="text-sm font-semibold text-red-700">Out of Stock</p>}

          {/* Quantity Selection Option (matching products detail page) */}
          <div className="mt-4 flex items-center gap-4 pt-1">
            <span className="text-xs font-light font-melon tracking-wide text-[#272727]" title="Quantity Add to Cart">
              Add to cart
            </span>
            <div className="flex items-center overflow-hidden rounded-2xl border border-[#FF8A00]">
              <button
                type="button"
                onClick={handleDecrement}
                className="h-10 w-9 text-lg cursor-pointer font-bold transition hover:bg-[#6A3033] hover:text-white"
              >
                -
              </button>
              <span className="w-8 text-center text-sm font-semibold">{quantity}</span>
              <button
                type="button"
                onClick={handleIncrement}
                className="h-10 w-9 text-lg cursor-pointer font-bold transition hover:bg-[#6A3033] hover:text-white"
              >
                +
              </button>
            </div>
          </div>

          {/* Buy Now Button & Favorite (matching products detail page) */}
          <div className="mt-5 flex items-center gap-3 pt-1">
            <button
              type="button"
              onClick={handleBuyNow}
              disabled={isOutOfStock}
              className="font-medium font-melon cursor-pointer tracking-wide rounded-2xl border border-[#FF8A00] bg-primary flex items-center px-6 py-2.5 text-xl leading-none text-white transition hover:bg-[#e97819] disabled:cursor-not-allowed disabled:opacity-40"
            >
              Buy now
              <img src="/assets/Productdetails/rightArrow.png" alt="Buy Now" className="inline-block h-4 w-4 ml-2 object-contain" />
            </button>

            <button
              type="button"
              onClick={(e) => handleToggleFavorite(e, bundle.slug)}
              className="flex h-10 w-10 cursor-pointer items-center justify-center rounded-md border border-[#E5E5E5] text-xl text-[#4C4C4C] hover:text-[#5A272A]"
            >
              {favorite ? "♥" : "♡"}
            </button>
          </div>
        </div>
      </div>

      {/* Included products */}
      <div className="rounded-2xl border border-[#E8DCC8] bg-white p-6">
        <h2 className="mb-4 text-sm font-semibold uppercase tracking-wide text-[#7A7A7A]">Included Products ({bundle.products.length})</h2>
        <div className="grid gap-3 sm:grid-cols-2 md:grid-cols-3">
          {bundle.products.map((p) => (
            <Link
              key={p.productId}
              href={`/product/${p.slug}`}
              className="rounded-xl border border-[#E8DCC8] p-3.5 hover:border-[#7B3010]/60 hover:bg-[#FFFBF3]/50 transition-all flex items-center gap-3.5 group"
            >
              <div className="relative h-14 w-14 shrink-0 overflow-hidden rounded-lg bg-white border border-[#E8DCC8] group-hover:scale-105 transition-transform">
                {productImageSrc(p.thumbnail) ? (
                  <Image src={productImageSrc(p.thumbnail)} alt={p.name} fill className="object-contain p-1" />
                ) : null}
              </div>
              <div className="min-w-0">
                <p className="font-semibold text-sm text-[#4A1D1F] truncate group-hover:text-[#7B3010] transition-colors">
                  {p.name}
                </p>
                {(p.variantWeight || p.variantName) && (
                  <span className="inline-block mt-0.5 rounded bg-[#7B3010]/10 px-1.5 py-0.2 text-[10px] font-semibold text-[#7B3010]">
                    {p.variantWeight || p.variantName}
                  </span>
                )}
                <p className="text-xs font-bold text-[#7B3010] mt-1">₹{Number(p.price).toFixed(2)}</p>
              </div>
            </Link>
          ))}
        </div>
      </div>
    </section>
  )
}
