"use client"
import { useRouter } from "next/navigation"
import Image from "next/image"
import { useEffect, useMemo, useState } from "react"
import SectionHeader from "./SectionHeader"
import { getCartItems, setCartItemQuantity, getCartQuantity } from "@/lib/cart" // utility functions for managing cart in localStorage
import { getFavoriteSlugs, toggleFavoriteSlug } from "@/lib/favorites" // utility functions for managing favorites in localStorage
import { useStorefrontProducts } from "@/hooks/useStorefrontProducts" // hook for getting api data for products
import { X } from "lucide-react"
import { toast } from "@/lib/toast"
import VegNonVegTag from "./VegNonVegTag"

export default function BestSellers({ cmsData }: { cmsData?: any }) {
  const { products } = useStorefrontProducts(200)
  const [favoriteSlugs, setFavoriteSlugs] = useState<string[]>([])
  const [cartQtyBySlug, setCartQtyBySlug] = useState<Record<string, number>>({})
  const best = products.filter((p) => p.isBestSeller === true)
  const bestSellers = useMemo(() => best.slice(0, 3), [best])
  const router = useRouter()
  const sectionTitle = cmsData?.title || "BEST SELLERS"
  const buttonText = cmsData?.buttonText || "view all"
  const buttonUrl = cmsData?.url || "/#best-sellers"

  const bgPalette = useMemo(
    () => ["#3EA6CF", "#F36E21", "#10B981", "#7C3AED", "#F59E0B", "#EC4899"],
    [],
  )
  const pickBg = (product: any) => {
    const key = String(product?.id ?? product?.slug ?? product?.name ?? "")
    let hash = 0
    for (let i = 0; i < key.length; i++) hash = (hash * 31 + key.charCodeAt(i)) >>> 0
    return bgPalette[hash % bgPalette.length]
  }
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
            // Update local storage and state
            window.localStorage.setItem("ziply5-favorites", JSON.stringify(payload.data));
            setFavoriteSlugs(payload.data);
          }
        } catch (e) { /* silent fail */ }
      }
    };
    fetchDbFavorites();
  }, []);

  const handleToggleFavorite = async (e: React.MouseEvent, slug: string) => {
    e.stopPropagation();
    const token = window.localStorage.getItem("ziply5_access_token");

    if (!token) {
      window.localStorage.setItem("ziply5_pending_wishlist_slug", slug);
      router.push(`/login?next=${encodeURIComponent(window.location.pathname + window.location.search)}`);
      return;
    }

    const isAdded = await toggleFavoriteSlug(slug);
    if (isAdded) {
      toast.success("Added to favorites", "This product has been saved to your list.");
    } else {
      toast.info("Removed from favorites", "This product has been removed from your list.");
    }
    setFavoriteSlugs(getFavoriteSlugs());
  }

  const [selectedProduct, setSelectedProduct] = useState<any | null>(null)

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
  if (bestSellers.length === 0) return null;
  return (
    <section id="best-sellers" className="bg-[#FFF5C5] py-12 md:py-16 lg:py-20">
      <div className="max-w-7xl mx-auto px-4">
        <SectionHeader title={sectionTitle} linkHref={buttonUrl} linkText={buttonText} />

        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-6 md:gap-8 justify-items-center">
          {bestSellers.map((product) => {
            const vegNonVegTag = product.tags?.find((t: any) => t?.tag?.name === "veg" || t?.tag?.name === "non-veg")
            const tagName = vegNonVegTag?.tag?.name
            return (
              <div key={product.id} className="w-full max-w-sm group cursor-pointer font-melon" onClick={() =>
                router.push(`/product/${product.slug}`)
              }>
                <div
                  className="card-smooth rounded-2xl px-8 relative overflow-hidden transition-all duration-300 ease-out group-hover:ring-4 group-hover:ring-[#F36E21] group-hover:shadow-xl h-full flex flex-col"
                  style={{ backgroundColor: pickBg(product) }}
                >
                  {tagName && (
                    <VegNonVegTag type={tagName} />
                  )}
                  {/* {product.type === "non-veg" && (
                  <span className="absolute top-4 right-0 bg-[#F97316] text-white text-[11px] font-medium px-3 py-1 rounded-l-sm border border-white z-10">
                    Non-veg
                  </span>
                )}
                {product.type === "veg" && (
                  <span className="absolute top-4 right-0 bg-[#10B981] text-white text-[11px] font-medium px-3 py-1 border border-white rounded-l-sm z-10">
                    Pure-Veg
                  </span>
                )} */}

                  <button
                    type="button"
                    onClick={(e) => handleToggleFavorite(e, product.slug)}
                    className="absolute left-4 top-4 pt-1 z-20 rounded-full bg-white/90 px-2 py-0.5 text-sm text-[#7a1e0e]"
                  >
                    {favoriteSlugs.includes(product.slug) ? "♥" : "♡"}
                  </button>

                  <div className="relative h-full flex items-center justify-center py-4">
                    {product.image ? <Image src={product.image} alt={product.name} width={180} height={220} className="w-auto h-full object-contain group-hover:scale-105 transition-transform duration-300 ease-out" /> : null}
                  </div>

                  <div className="text-center pb-4">
                    <h3 className="font-medium text-white text-[15px] md:text-xl leading-tight tracking-wide line-clamp-2 min-h-[44px] md:min-h-[56px]">
                      {product.name}
                    </h3>
                    <p className="text-[#FFF5C5] text-[11px] uppercase tracking-wide line-clamp-2 min-h-[30px]">
                      {product.description}
                    </p>

                    <div className="mt-3 flex items-center justify-between gap-2">
                      {(cartQtyBySlug[product.slug] ?? 0) > 0 && product.productKind === "simple" ? (
                        <div className="flex items-center rounded-md border border-[#d5c4b8] bg-white/95 px-1 py-0.5">
                          <button
                            type="button"
                            onClick={(e) => {
                              e.stopPropagation();
                              setCartItemQuantity(product, Math.max(0, (cartQtyBySlug[product.slug] ?? 0) - 1));
                            }}
                            className="h-6 w-6 rounded text-sm font-light text-[#5A272A] hover:bg-[#f4efec]"
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
                              setCartItemQuantity(product, (cartQtyBySlug[product.slug] ?? 0) + 1);
                            }}
                            className="h-6 w-6 rounded text-sm font-light text-[#5A272A] hover:bg-[#f4efec]"
                          >
                            +
                          </button>
                        </div>
                      ) : (
                        <button
                          type="button"
                          onClick={(e) => {
                            e.stopPropagation();
                            if (product.productKind === "variant") {
                              setSelectedProduct(product);
                            } else {
                              setCartItemQuantity(product, 1);
                            }
                          }}
                          className="rounded-lg border cursor-pointer border-white tracking-wide px-4 py-1.5 text-[12px] font-light text-white hover:bg-primary hover:text-white transition-all "
                        >
                          Add to Cart
                        </button>
                      )}
                      <button
                        onClick={(e) => {
                          e.stopPropagation()
                          if (product.productKind === "variant") {
                            setSelectedProduct(product);
                          } else {
                            if ((cartQtyBySlug[product.slug] ?? 0) === 0) {
                              setCartItemQuantity(product, 1);
                            }
                            router.push("/checkout");
                          }
                        }} className="rounded-lg cursor-pointer bg-primary tracking-wide px-3 py-1.5 text-[12px] font-light text-white hover:bg-[#2d1011]">
                        Buy Now
                      </button>
                    </div>

                    <p className="mt-2 text-sm font-medium text-[#FFF5C5]">Rs. {product.price.toFixed(2)}</p>
                  </div>
                </div>
              </div>
            )
          })}
        </div>
      </div>

      {/* VARIANT SELECTION MODAL */}
      {selectedProduct && (
        <div className="fixed inset-0 z-[200] flex items-center justify-center bg-black/60 p-4 backdrop-blur-sm" onClick={() => setSelectedProduct(null)}>
          <div className="w-full max-w-md overflow-hidden rounded-3xl bg-white shadow-2xl" onClick={(e) => e.stopPropagation()}>
            <div className="flex items-center justify-between bg-primary p-5 text-white">
              <h3 className="font-melon text-lg font-bold uppercase tracking-wider">Select Options</h3>
              <button onClick={() => setSelectedProduct(null)} className="rounded-full bg-white/20 p-1 cursor-pointer hover:bg-white/30 transition-colors">
                <X size={20} />
              </button>
            </div>

            <div className="p-6">
              <div className="mb-4 flex gap-4">
                <div className="relative h-20 w-20 shrink-0 rounded-xl bg-gray-100 p-2">
                  <Image src={selectedProduct.image} alt={selectedProduct.name} fill className="object-contain" />
                </div>
                <div>
                  <h4 className="font-melon text-base font-bold text-[#4A1D1F]">{selectedProduct.name}</h4>
                  <p className="text-xs text-gray-500 line-clamp-2">{selectedProduct.description}</p>
                </div>
              </div>

              <div className="space-y-3 max-h-[40vh] overflow-y-auto pr-1">
                {selectedProduct.variants.map((v: any) => {
                  const vId = v.id ? String(v.id) : (v.sku || v.weight || v.name);
                  const qty = getCartQuantity(String(selectedProduct.id), vId)
                  return (
                    <div key={v.id} className="flex items-center justify-between rounded-2xl border border-gray-100 bg-gray-50/50 p-4 transition-all hover:border-orange-200">
                      <div>
                        <p className="font-melon text-sm font-bold text-[#4A1D1F]">{v.weight || v.name}</p>
                        <p className="text-sm font-bold text-orange-500">Rs. {v.price.toFixed(2)}</p>
                      </div>

                      <div className="flex items-center gap-3">
                        {qty > 0 ? (
                          <div className="flex items-center rounded-lg border border-orange-200 bg-white px-2 py-1 shadow-sm">
                            <button onClick={(e) => { e.stopPropagation(); updateVariantQty(selectedProduct, v, qty - 1); }} className="h-6 w-6 font-bold text-primary cursor-pointer hover:scale-110 transition-transform">-</button>
                            <span className="min-w-6 text-center text-xs font-bold text-gray-700">{qty}</span>
                            <button onClick={(e) => { e.stopPropagation(); updateVariantQty(selectedProduct, v, qty + 1); }} className="h-6 w-6 font-bold text-primary hover:scale-110 cursor-pointer transition-transform">+</button>
                          </div>
                        ) : (
                          <button
                            onClick={(e) => { e.stopPropagation(); updateVariantQty(selectedProduct, v, 1); }}
                            className="rounded-full bg-primary cursor-pointer px-5 py-1.5 text-[11px] font-bold text-white shadow-md hover:bg-[#3a1517] transition-all"
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
                onClick={() => {
                  setSelectedProduct(null);
                  router.push("/products");
                }}
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
      )}
    </section>
  )
}