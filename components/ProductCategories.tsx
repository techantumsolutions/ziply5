"use client";

import Link from "next/link";
import Image from "next/image";
import { useMemo, useState } from "react";
import { Swiper, SwiperSlide } from "swiper/react";
import { Navigation } from "swiper/modules";
import { useStorefrontProducts } from "@/hooks/useStorefrontProducts";
import "swiper/css";
import "swiper/css/navigation";

export default function ProductCategories({ cmsData }: { cmsData?: any }) {
  const { products, loading } = useStorefrontProducts(20);
  const [navLocked, setNavLocked] = useState(false);

  const displayItems = useMemo(() => products.filter((p: any) => !p.isCombo).slice(0, 15), [products]);
  const sectionTitle = cmsData?.title || "OUR PRODUCTS";

  if (!loading && displayItems.length === 0) return null;

  return (
    <section className="w-full bg-[#F97316] py-12 relative">
      <div className="max-w-7xl mx-auto px-12 relative">

        <h2 className="text-center font-melon text-white text-3xl font-extrabold mb-8 whitespace-pre-line uppercase">
          {sectionTitle}
        </h2>

        {/* Swiper */}
        <Swiper
          modules={[Navigation]}
          spaceBetween={16}
          slidesPerView={7}
          centerInsufficientSlides={true}
          navigation={{
            nextEl: ".custom-next",
            prevEl: ".custom-prev",
          }}
          onInit={(swiper) => setNavLocked(swiper.isLocked)}
          onUpdate={(swiper) => setNavLocked(swiper.isLocked)}
          onBreakpoint={(swiper) => setNavLocked(swiper.isLocked)}
          breakpoints={{
            320: { slidesPerView: 1 },
            480: { slidesPerView: 3 },
            768: { slidesPerView: 4 },
            1024: { slidesPerView: 4 },
            1280: { slidesPerView: 7 },
          }}
          style={{ padding: "10px 15px" }}
        >
          {loading
            ? Array.from({ length: 7 }).map((_, i) => (
              <SwiperSlide key={`cat-skeleton-${i}`}>
                <div className="bg-white/50 animate-pulse rounded-full overflow-hidden h-75 flex flex-col items-center justify-center px-3 shadow-sm border border-white/20 mx-auto max-w-[200px] md:max-w-none w-full">
                  <div className="w-[100px] h-[100px] md:w-[120px] md:h-[120px] shrink-0 rounded-full overflow-hidden bg-white/40 mb-4" />
                  <div className="h-4 w-24 bg-white/40 rounded mb-2" />
                  <div className="h-3 w-32 bg-white/40 rounded" />
                </div>
              </SwiperSlide>
            ))
            : displayItems.map((product: any, i: number) => (
              <SwiperSlide key={product.id || i}>
                <Link
                  href={`/product/${product.slug}`}
                  className="group block mx-auto max-w-[200px] md:max-w-none w-full"
                >
                  <div className="card-smooth bg-white rounded-full overflow-hidden h-75 flex flex-col items-center justify-center px-3 shadow-md hover:shadow-lg">

                    <div className="w-[100px] h-[100px] md:w-[120px] md:h-[120px] shrink-0 rounded-full overflow-hidden mb-4 bg-white flex items-center justify-center">
                      {product.image ? (
                        <Image
                          src={product.image}
                          alt={product.name}
                          width={120}
                          height={120}
                          className="object-contain p-2 w-full h-full max-h-full"
                        />
                      ) : null}
                    </div>
                    <div className="mb-0 flex flex-col items-center w-full px-2">
                      <h3 className="text-[#6F2C2A] text-center font-semibold text-sm line-clamp-2 min-h-[40px] leading-tight w-full">
                        {product.name}
                      </h3>

                      <p className="text-[#656565] text-[10px] text-center mt-1 line-clamp-2 min-h-[28px] w-full">
                        {product.description}
                      </p>
                    </div>
                  </div>
                </Link>
              </SwiperSlide>
            ))}
        </Swiper>

        {/* Custom Arrows - Hidden if navigation is locked (insufficient slides) */}
        {/* {!navLocked && (
          <> */}
        <button className="custom-prev cursor-pointer absolute left-2 xl:-left-2 mt-8 top-1/2 -translate-y-1/2 z-10 w-10 h-10 bg-white rounded-full shadow flex items-center justify-center">
          <svg className="w-4 h-4 text-zinc-700" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15 19l-7-7 7-7" /></svg>
        </button>

        <button className="custom-next cursor-pointer absolute right-2 xl:-right-2 mt-8 top-1/2 -translate-y-1/2 z-10 w-10 h-10 bg-white rounded-full shadow flex items-center justify-center">
          <svg className="w-4 h-4 text-zinc-700" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 5l7 7-7 7" /></svg>
        </button>
        {/* </>
        )} */}
      </div>
    </section >
  );
}