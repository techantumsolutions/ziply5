"use client"

import { useEffect, useMemo, useState } from "react"
import Image from "next/image"
import Link from "next/link"
import { getFavoriteSlugs } from "@/lib/favorites"
import { useStorefrontProducts } from "@/hooks/useStorefrontProducts"

export default function FavoritesPage() {
  const { products } = useStorefrontProducts(200)
  const [favoriteSlugs, setFavoriteSlugs] = useState<string[]>([])

  useEffect(() => {
    setFavoriteSlugs(getFavoriteSlugs())
  }, [])

  const favoriteProducts = useMemo(() => {
    return favoriteSlugs.map((slug) => {
      const existing = products.find((item) => item.slug === slug)
      if (existing) return existing

      const fallbackName = slug
        .split("-")
        .map((part) => part.charAt(0).toUpperCase() + part.slice(1))
        .join(" ")

      return {
        id: Number(`9${Math.abs(slug.length)}`),
        name: fallbackName,
        slug,
        price: 229.25,
        oldPrice: 310,
        serving: "440 calories serving",
        weight: "95 g",
        description: "Favourite product",
        type: "non-veg" as const,
        category: "all",
        image: "/assets/product listing/Ziply5 - Pouch - Butter Chk Rice 3.png",
        gallery: [],
        labels: [],
        features: [],
        details: [],
        variants: [],
      }
    })
  }, [favoriteSlugs, products])

  return (
    <section className="w-full bg-[#F3F0DC] py-10">
      <div className="mx-auto w-full max-w-7xl px-4 sm:px-6 lg:px-8">
        <h1 className="font-heading text-5xl text-[#4A1E1F]">Favourite Products</h1>

        {favoriteProducts.length === 0 ? (
          <div className="mt-8 rounded-2xl border border-[#E6DFC4] bg-white p-8 text-center">
            <p className="text-lg font-semibold text-[#5D5D58]">No favourite products added yet.</p>
            <Link href="/products" className="mt-4 inline-block rounded-full bg-[#5A272A] px-6 py-2 text-white">
              Browse Products
            </Link>
          </div>
        ) : (
          <div className="mt-6 grid grid-cols-1 gap-5 sm:grid-cols-2 lg:grid-cols-4">
            {favoriteProducts.map((product) => (
              <Link key={product.id} href={`/product/${product.slug}`} className="block">
                <article
                  className="rounded-2xl border-2 border-transparent p-4 transition-all duration-300 hover:border-[#F0E4A3]"
                  style={{ backgroundColor: "#3EA6CF" }}
                >
                  <div className="relative mx-auto h-[240px] w-full max-w-[150px]">
                    {product.image ? <Image src={product.image} alt={product.name} fill className="object-contain" /> : null}
                  </div>
                  <h3 className="mt-2 text-center text-[22px] font-black uppercase leading-tight text-white">{product.name}</h3>
                  <p className="mt-1 text-center text-[10px] font-semibold uppercase text-white/90">Home style meal | Net wt. {product.weight}</p>
                </article>
              </Link>
            ))}
          </div>
        )}
      </div>
    </section>
  )
}
