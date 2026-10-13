"use client"

import { useEffect, useState } from "react"
import { productImageSrc, toStorefrontProduct, type StorefrontProduct } from "@/lib/storefront-products"

const CACHE_TTL_MS = 5 * 60 * 1000 // 5 minutes
const storefrontProductsCache = new Map<number, { at: number; products: StorefrontProduct[] }>()
const inFlightFetches = new Map<number, Promise<StorefrontProduct[]>>()

export function useStorefrontProducts(limit = 200) {
  const cached = storefrontProductsCache.get(limit)
  const cachedValid = cached && Date.now() - cached.at <= CACHE_TTL_MS

  const [products, setProducts] = useState<StorefrontProduct[]>(cachedValid ? cached!.products : [])
  const [loading, setLoading] = useState<boolean>(() => !cachedValid)
  const [error, setError] = useState("")

  useEffect(() => {
    let cancelled = false

    const cachedNow = storefrontProductsCache.get(limit)
    const cachedValidNow = cachedNow && Date.now() - cachedNow.at <= CACHE_TTL_MS
    if (cachedValidNow) {
      setProducts(cachedNow!.products)
      setLoading(false)
      setError("")
      return
    }

    const existing = inFlightFetches.get(limit)
    if (existing) {
      setLoading(true)
      setError("")
      existing
        .then((next) => {
          if (cancelled) return
          setProducts(next)
          setError("")
        })
        .catch(() => {
          if (!cancelled) setError("Unable to load products")
        })
        .finally(() => {
          if (!cancelled) setLoading(false)
        })
      return
    }

    setLoading(true)
    setError("")

    const fetchProducts = (async (): Promise<StorefrontProduct[]> => {
      const [productsRes, bundlesRes] = await Promise.all([
        fetch(`/api/v1/products?page=1&limit=${limit}`),
        fetch(`/api/v1/bundles?page=1&limit=${Math.max(20, Math.min(100, limit))}`),
      ])
      const productsJson = await productsRes.json()
      if (!productsRes.ok) throw new Error(productsJson.message || "Failed")
      const bundlesJson = await bundlesRes.json().catch(() => ({ data: { items: [] } }))
      const rows = productsJson.data?.items?.filter(
        (item:any) => item.status === "published"
      ) ?? []
      const base = rows.map((x: unknown) => toStorefrontProduct(x as never))
      const bundles = bundlesJson?.data?.items ?? []
      const mappedBundles = (Array.isArray(bundles) ? bundles : []).map((b: any) => {
        const effectivePrice = Number(b?.effectivePrice ?? b?.comboPrice ?? 0)
        const image = productImageSrc(b?.image)
        const maxPurchasableQty = Number(b?.maxPurchasableQty ?? 0)
        const isAvailable = Boolean(b?.isAvailable) && maxPurchasableQty > 0
        return {
          id: String(b.id),
          name: String(b.name),
          slug: String(b.slug),
          sku: `BUNDLE-${String(b.id).slice(0, 8).toUpperCase()}`,
          productKind: "simple",
          price: effectivePrice,
          oldPrice: Number(b?.dynamicPrice ?? effectivePrice),
          stockStatus: isAvailable ? "in_stock" : "out_of_stock",
          stock: isAvailable ? maxPurchasableQty : 0,
          description: String(b?.description ?? "Combo bundle"),
          image,
          gallery: [image],
          amazonLink: null,
          videoUrl: null,
          weight: `${Number(b?.includedProductsCount ?? 0)} items`,
          type: "veg",
          category: "all",
          labels: [],
          features: [],
          details: [],
          sections: [],
          variants: [],
          tags: [],
          isBestSeller: false,
          isFeatured: false,
          spiceLevel: null,
          preparationType: null,
          discountPercent: null,
          finalPrice: effectivePrice,
          promotion: null,
          isCombo: true,
          bundleProducts: b?.products ?? [],
          bundleSavings: Number(b?.savings ?? 0),
          comboSlug: String(b.slug),
          maxPurchasableQty,
          isAvailable,
          unavailableReason: b?.unavailableReason ?? null,
        } as StorefrontProduct
      })
      return [...mappedBundles, ...base]
    })()

    inFlightFetches.set(limit, fetchProducts)

    fetchProducts
      .then((next) => {
        if (cancelled) return
        storefrontProductsCache.set(limit, { at: Date.now(), products: next })
        setProducts(next)
        setError("")
      })
      .catch(() => {
        if (!cancelled) {
          const lastCached = storefrontProductsCache.get(limit)
          if (lastCached?.products?.length) {
            setProducts(lastCached.products)
          }
          setError("Unable to load products")
        }
      })
      .finally(() => {
        inFlightFetches.delete(limit)
        if (!cancelled) setLoading(false)
      })

    return () => {
      cancelled = true
    }
  }, [limit])

  return { products, loading, error }
}
