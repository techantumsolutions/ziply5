"use client"

import Link from "next/link"
import Image from "next/image"

const trendingProducts = [
  { id: 1, name: "ZIPLY5 PLAIN WHITE RICE", subtitle: "loream ipsum dummy text", price: 299, originalPrice: null, image: "https://hebbkx1anhila5yf.public.blob.vercel-storage.com/image%2069-Wad13TxQUuVaYNy0jtfCIdXuusTAP5.png", badge: null, gradient: "from-[#5B9BD5] to-[#3A7FC2]", featured: false },
  { id: 2, name: "SPCL DAL MAKHANI RICE", subtitle: "All Dressed Up", price: 349, originalPrice: null, image: "https://hebbkx1anhila5yf.public.blob.vercel-storage.com/image%2069-Wad13TxQUuVaYNy0jtfCIdXuusTAP5.png", badge: null, gradient: "from-[#A78BDA] to-[#8B6FC0]", featured: false },
  { id: 3, name: "ZIPLY5 SPCL VEG RICE", subtitle: "Jalapeo Cheddar Blaze", price: 229, originalPrice: 290, discount: "5% off", image: "https://hebbkx1anhila5yf.public.blob.vercel-storage.com/image%2069-Wad13TxQUuVaYNy0jtfCIdXuusTAP5.png", badge: null, gradient: "from-[#8BC34A] to-[#689F38]", featured: true },
  { id: 4, name: "ZIPLY5 PONGAL", subtitle: "Rockin' Ranch", price: 279, originalPrice: null, image: "https://hebbkx1anhila5yf.public.blob.vercel-storage.com/image%2069-Wad13TxQUuVaYNy0jtfCIdXuusTAP5.png", badge: null, gradient: "from-[#4A90D9] to-[#2E6EB5]", featured: false },
]

export default function Trending() {
  return (
    <section id="trending" className="bg-[#F3F4F6] py-[70px]">
      <div className="max-w-[1200px] mx-auto px-4">
        <div className="flex items-center justify-between mb-8">
          <h2 className="font-heading text-[24px] md:text-[36px] font-extrabold text-[#4A1D1F] tracking-[0.5px]">
            FOOD THAT&apos;S TRENDING
          </h2>
          <Link href="/#trending" className="flex items-center gap-2 bg-[#4A1D1F] text-white px-4 py-2 rounded-full font-semibold text-[14px] hover:bg-[#3a1517] transition-colors">
            view all
            <span className="w-5 h-5 rounded-full border border-white flex items-center justify-center">
              <svg className="w-3 h-3" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 5l7 7-7 7" /></svg>
            </span>
          </Link>
        </div>

        <div className="grid grid-cols-2 lg:grid-cols-4 gap-6">
          {trendingProducts.map((product) => (
            <div key={product.id} className={`group bg-white rounded-[16px] overflow-hidden transition-all duration-300 hover:-translate-y-1.5 ${product.featured ? 'ring-2 ring-[#EF4444] shadow-lg' : 'shadow-[0_10px_25px_rgba(0,0,0,0.08)]'} hover:shadow-[0_15px_35px_rgba(0,0,0,0.12)]`}>
              <div className={`relative h-[180px] bg-gradient-to-b ${product.gradient} rounded-t-[16px] flex items-center justify-center`}>
                <div className="absolute top-3 right-3 w-5 h-5 bg-white rounded-sm flex items-center justify-center">
                  <div className="w-3 h-3 border-2 border-green-600 rounded-sm flex items-center justify-center">
                    <div className="w-1.5 h-1.5 bg-green-600 rounded-full"></div>
                  </div>
                </div>
                {product.image ? <Image src={product.image} alt={product.name} width={120} height={140} className="w-[100px] md:w-[120px] h-auto object-contain drop-shadow-lg group-hover:scale-105 transition-transform duration-300" /> : null}
              </div>

              <div className="p-[14px] flex flex-col">
                <div className="flex items-start justify-between gap-2">
                  <div className="flex-1 min-w-0">
                    <h3 className="font-semibold text-[#4A1D1F] text-[14px] leading-tight mb-1 truncate">{product.name}</h3>
                    <p className="text-[#6B7280] text-[12px] mb-1.5 truncate">{product.subtitle}</p>
                    {product.originalPrice ? (
                      <div className="flex flex-col">
                        <span className="text-[#9CA3AF] line-through text-[11px]">Rs. {product.originalPrice}</span>
                        <div className="flex items-center gap-1.5">
                          <span className="font-bold text-[#F97316] text-[16px]">Rs. {product.price}</span>
                          {product.discount && <span className="text-green-600 text-[10px] font-medium">{product.discount}</span>}
                        </div>
                      </div>
                    ) : (<span className="text-[#6B7280] text-[12px]">{product.subtitle}</span>)}
                  </div>
                  <button onClick={(e) => e.preventDefault()} className="flex-shrink-0 border border-[#EF4444] text-[#EF4444] bg-transparent px-3 py-1 rounded-full text-[12px] font-semibold hover:bg-[#EF4444] hover:text-white transition-colors self-end">ADD</button>
                </div>
              </div>
            </div>
          ))}
        </div>
      </div>
    </section>
  )
}