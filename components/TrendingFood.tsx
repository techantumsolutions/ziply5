"use client"

import Link from "next/link"
import Image from "next/image"
import SectionHeader from "./SectionHeader"
import { useEffect, useMemo, useState } from "react"
import { getCartItems, setCartItemQuantity, getCartQuantity } from "@/lib/cart" // utility functions for managing cart in localStorage
import { getFavoriteSlugs, toggleFavoriteSlug } from "@/lib/favorites" // utility functions for managing favorites in localStorage
import { useStorefrontProducts } from "@/hooks/useStorefrontProducts" // hook for getting api data for products
import { useRouter } from "next/navigation"
import { X } from "lucide-react"
import { toast } from "@/lib/toast"
import VegNonVegTag from "./VegNonVegTag"

function useIsLg() {
  const [isLg, setIsLg] = useState(false)

  useEffect(() => {
    const check = () => {
      setIsLg(window.innerWidth >= 1024 && window.innerWidth < 1280)
    }

    check()
    window.addEventListener("resize", check)
    return () => window.removeEventListener("resize", check)
  }, [])

  return isLg
}

const cardGradients = [
  "from-[#5B9BD5] to-[#3A7FC2]",
  "from-[#A78BDA] to-[#8B6FC0]",
  "from-[#8BC34A] to-[#689F38]",
  "from-[#4A90D9] to-[#2E6EB5]",
]

export default function TrendingFood({ cmsData }: { cmsData?: any }) {
  const isLg = useIsLg()
  const router = useRouter()
  const { products } = useStorefrontProducts(200)
  const [favoriteSlugs, setFavoriteSlugs] = useState<string[]>([])
  const [cartQtyBySlug, setCartQtyBySlug] = useState<Record<string, number>>({})
  const trending = products.filter((p) => p.isFeatured === true)
  const trendingProducts = useMemo(() => trending.slice(0, 4), [trending])
  const sectionTitle = cmsData?.title || "FOOD THAT'S TRENDING"
  const buttonText = cmsData?.buttonText || "view all"
  const buttonUrl = cmsData?.url || "/#trending"
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

  const visibleProducts = isLg ? trendingProducts.slice(0, 3) : trendingProducts
  if (trendingProducts.length === 0) return null;
  return (
    <section id="trending" className="py-12 md:py-16 lg:py-20">
      <div className="max-w-7xl mx-auto px-4">
        <SectionHeader title={sectionTitle} linkHref={buttonUrl} linkText={buttonText} />

        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 gap-6 md:gap-8 justify-items-center">
          {visibleProducts.map((product, index) => {
            const vegNonVegTag = product.tags?.find((t: any) => t?.tag?.name === "veg" || t?.tag?.name === "non-veg")
            const tagName = vegNonVegTag?.tag?.name
            return (
              <div
                key={product.id}
                className="card-smooth w-full cursor-pointer max-w-sm group bg-white rounded-[16px] overflow-hidden 
                h-85
                shadow-[0_10px_25px_rgba(0,0,0,0.08)] 
                hover:shadow-[0_15px_35px_rgba(0,0,0,0.12)]
                hover:ring-2 hover:ring-[#EF4444]"
                onClick={() =>
                  router.push(`/product/${product.slug}`)}
              >
                {/* FLEX CONTAINER */}
                <div className="flex flex-col h-full">

                  {/* IMAGE SECTION */}
                  <div
                    className={`relative bg-gradient-to-b ${cardGradients[index % cardGradients.length]} 
                  flex items-center justify-center 
                  h-[280px] `}
                  >
                    {/* veg icon */}
                    {/* <div className="absolute top-2 z-20 right-0 w-10 h-10 flex items-center justify-center">
                    {product.tags[0]?.tag?.name && (
                      product.tags[0].tag.name === "veg" ? (
                        <span className="block">
                          <span style={{ display: 'inline-block', border: '2px solid #16A34A', borderRadius: 4, background: '#fff', width: 15, height: 15,  display: 'flex',
                              flexDirection: 'row',
                              justifyContent: 'center',
                              alignItems: 'center', }}>
                            <span style={{
                             
                              background: '#16A34A',
                              borderRadius: '50%',
                              width: 8,
                              height: 8,
                              
                              
                            }} />
                          </span>
                        </span>
                      ) : (
                        <span className="block">
                          <span style={{ display: 'inline-block', border: '2px solid #DC2626', borderRadius: 4, background: '#fff', width: 20, height: 20,  display: 'flex',
                              flexDirection: 'row',
                              justifyContent: 'center',
                              alignItems: 'center' }}>
                            <span style={{
                              
                              background: '#DC2626',
                              borderRadius: '50%',
                              width: 8,
                              height: 8,
                             
                            }} />
                          </span>
                        </span>
                      )
                    )}
                  </div> */}
                    {
                      product.tags[0]?.tag?.name && (
                        <VegNonVegTag type={product.tags[0].tag.name} />
                      )
                    }
                    <div className="relative h-full w-full transition-transform duration-300 hover:scale-90 ">
                      {product.image ? (
                        <Image
                          src={product.image}
                          alt={product.name}
                          fill
                          className="object-contain p-4"
                          sizes="(max-width: 768px) 100vw, 320px"
                        />
                      ) : null}
                    </div>
                  </div>

                  {/* CONTENT SECTION */}
                  <div className="flex flex-col px-4 font-melon  py-4">
                    <div className="flex flex-row justify-between items-center">

                      <div className="px-2 overflow-hidden">
                        {/* TITLE */}
                        <h3 className="font-medium uppercase text-primary  text-[14px] mb-1 truncate">
                          {product.name}
                        </h3>

                        {/* SUBTITLE */}
                        <p
                          className={`text-[12px] font-medium capitalize truncate bg-gradient-to-r ${cardGradients[index % cardGradients.length]} bg-clip-text text-transparent`}
                        >
                          {product.description}
                        </p>
                      </div>
                      <button
                        type="button"
                        onClick={(e) => handleToggleFavorite(e, product.slug)}
                        className="border-2 border-[#EF4444] cursor-pointer px-2.5 py-1 rounded-lg text-[12px] font-medium hover:bg-[#EF4444] hover:text-white transition-colors"
                      >
                        {favoriteSlugs.includes(product.slug) ? "♥" : "♡"}
                      </button>
                    </div>

                    <div className="mt-2 flex max-h-0 flex-col gap-2 overflow-hidden opacity-0 transition-all duration-300 group-hover:max-h-24 group-hover:opacity-100">
                      <span className="font-medium text-[#F97316] text-[16px]">Rs. {product.price.toFixed(2)}</span>
                      <div className="flex items-center justify-between gap-2">

                        {(cartQtyBySlug[product.slug] ?? 0) > 0 && product.productKind === "simple" ? (
                          <div className="flex items-center rounded-md border border-[#d5c4b8] px-1 py-0.5">
                            <button
                              type="button"
                              onClick={() => setCartItemQuantity(product, Math.max(0, (cartQtyBySlug[product.slug] ?? 0) - 1))}
                              className="h-6 w-6 rounded text-sm font-bold text-[#5A272A] hover:bg-[#f4efec]"
                            >
                              -
                            </button>
                            <span className="min-w-5 text-center text-xs font-bold text-[#5A272A]">{cartQtyBySlug[product.slug] ?? 0}</span>
                            <button
                              type="button"
                              onClick={() => setCartItemQuantity(product, (cartQtyBySlug[product.slug] ?? 0) + 1)}
                              className="h-6 w-6 rounded text-sm font-bold text-[#5A272A] hover:bg-[#f4efec]"
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
                            className="rounded-lg border cursor-pointer border-primary tracking-wide px-4 py-1.5 text-[12px] font-light text-primary hover:bg-primary hover:text-white transition-all "
                          >
                            Add to Cart
                          </button>
                        )}
                        <button
                          onClick={(e) => {
                            e.stopPropagation();
                            if (product.productKind === "variant") {
                              setSelectedProduct(product);
                            } else {
                              if ((cartQtyBySlug[product.slug] ?? 0) === 0) {
                                setCartItemQuantity(product, 1);
                              }
                              router.push("/checkout");
                            }
                          }}
                          className="rounded-md bg-primary px-3 cursor-pointer tracking-wide py-1.5 text-[12px] font-light text-white hover:bg-[#3a1517]"
                        >
                          Buy Now
                        </button>
                      </div>
                    </div>
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
                            <button onClick={(e) => { e.stopPropagation(); updateVariantQty(selectedProduct, v, qty - 1); }} className="h-6 w-6 font-bold text-primary hover:scale-110 cursor-pointer transition-transform">-</button>
                            <span className="min-w-6 text-center text-xs font-bold text-gray-700">{qty}</span>
                            <button onClick={(e) => { e.stopPropagation(); updateVariantQty(selectedProduct, v, qty + 1); }} className="h-6 w-6 font-bold text-primary hover:scale-110 cursor-pointer transition-transform">+</button>
                          </div>
                        ) : (
                          <button
                            onClick={(e) => { e.stopPropagation(); updateVariantQty(selectedProduct, v, 1); }}
                            className="rounded-full bg-primary px-5 cursor-pointer py-1.5 text-[11px] font-bold text-white shadow-md hover:bg-[#3a1517] transition-all"
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