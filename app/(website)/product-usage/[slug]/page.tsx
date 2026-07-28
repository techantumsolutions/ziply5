import type { Metadata } from "next"
import Link from "next/link"
import Image from "next/image"
import { notFound } from "next/navigation"
import { ChevronRight, Home, ArrowLeft, ArrowRight, Share2, ShoppingCart } from "lucide-react"
import { getProductUsageBySlugPublic } from "@/src/server/modules/product-usage/product-usage.service"
import VideoPlayer from "@/components/common/VideoPlayer"

interface ProductUsageDetailPageProps {
  params: Promise<{ slug: string }>
}

/** Next.js Dynamic Metadata Generator */
export async function generateMetadata({ params }: ProductUsageDetailPageProps): Promise<Metadata> {
  const { slug } = await params
  const data = await getProductUsageBySlugPublic(slug)
  if (!data || !data.item) {
    return { title: "Guide Not Found - Ziply5" }
  }

  const { item } = data
  const title = item.seoTitle || `${item.title} | Ziply5`
  const description = item.metaDescription || item.shortDescription || "Learn how to prepare and enjoy Ziply5 home-style meals with easy step-by-step instructions."

  const robotsObj: Metadata["robots"] = {}
  if (item.robots) {
    if (item.robots.includes("noindex")) robotsObj.index = false
    if (item.robots.includes("nofollow")) robotsObj.follow = false
  }

  return {
    title,
    description,
    keywords: item.metaKeywords ? item.metaKeywords.split(",").map((k) => k.trim()) : undefined,
    alternates: item.canonicalUrl ? { canonical: item.canonicalUrl } : undefined,
    robots: robotsObj,
    openGraph: {
      title: item.ogTitle || title,
      description: item.ogDescription || description,
      images: item.ogImage || item.thumbnail ? [{ url: item.ogImage || item.thumbnail! }] : undefined,
    },
  }
}

export default async function ProductUsageDetailPage({ params }: ProductUsageDetailPageProps) {
  const { slug } = await params
  const data = await getProductUsageBySlugPublic(slug)

  if (!data || !data.item) {
    notFound()
  }

  const { item, prevItem, nextItem, relatedUsages } = data

  return (
    <section className="w-full bg-[#F3F3F3] py-8 md:py-12 min-h-screen">
      <div className="mx-auto w-full max-w-5xl px-4 sm:px-6 lg:px-8 space-y-8">

        {/* Breadcrumb Navigation */}
        {/* <nav className="flex items-center gap-2 text-xs font-semibold text-[#646464] overflow-x-auto pb-1">
          <Link href="/" className="flex items-center gap-1 hover:text-[#7a1e0e] transition-colors">
            <Home size={14} /> Home
          </Link>
          <ChevronRight size={14} className="text-[#AAA]" />
          <Link href="/product-usage" className="hover:text-[#7a1e0e] transition-colors">
            Product Usage
          </Link>
          <ChevronRight size={14} className="text-[#AAA]" />
          <span className="text-[#201A1A] truncate max-w-[200px] sm:max-w-none">{item.title}</span>
        </nav> */}
        {/* Video Player or Thumbnail */}
        {item.videoType && item.videoType !== "none" && (item.videoUrl || item.uploadedVideo) ? (
          <VideoPlayer
            videoType={item.videoType}
            videoUrl={item.videoUrl}
            uploadedVideo={item.uploadedVideo}
            thumbnail={item.thumbnail}
            title={item.title}
          />
        ) : item.thumbnail ? (
          <div className="relative aspect-video w-full overflow-hidden rounded-2xl border border-[#E2E2E2] bg-black/5 shadow-md">
            <Image src={item.thumbnail} alt={item.title} fill className="object-cover" />
          </div>
        ) : null}

        {/* Usage Process & Detailed Description */}
        <div className="grid grid-cols-1 gap-8 lg:grid-cols-3">

          {/* Main Content Area */}
          <div className="lg:col-span-2 space-y-8">
            {/* Header Block */}
            <div className="space-y-3 border-b border-[#DEDEDE] pb-6">
              <h1 className="font-heading text-3xl sm:text-4xl text-[#201A1A] leading-tight">
                {item.title}
              </h1>
              {item.shortDescription && (
                <p className="text-sm sm:text-base text-[#606060] leading-relaxed font-melon font-medium">
                  {item.shortDescription}
                </p>
              )}
            </div>
            {/* Step-by-Step Usage Process */}
            {item.usageProcess && item.usageProcess.trim() !== "" && (
              <div className="rounded-2xl border border-[#E8DCC8] bg-[#FFFBF3] p-6 sm:p-8 space-y-4 shadow-sm">
                <h2 className="font-heading text-2xl uppercase text-[#4A1E1F]">
                  Step-by-Step Preparation
                </h2>
                <div
                  className="prose max-w-none text-sm text-[#404040] leading-relaxed"
                  dangerouslySetInnerHTML={{ __html: item.usageProcess }}
                />
              </div>
            )}

            {/* Detailed Description */}
            {item.description && item.description.trim() !== "" && (
              <div className="rounded-2xl border border-[#E2E2E2] bg-white p-6 sm:p-8 space-y-4 shadow-sm">
                <h2 className="font-heading text-2xl uppercase text-[#4A1E1F]">
                  Detailed Instructions & Tips
                </h2>
                <div
                  className="prose max-w-none text-sm text-[#404040] leading-relaxed"
                  dangerouslySetInnerHTML={{ __html: item.description }}
                />
              </div>
            )}
          </div>

          {/* Right Sidebar: Related Product Card */}
          <div className="space-y-6">
            {item.relatedProductId && item.relatedProductName && (
              <div className="rounded-2xl border border-[#E8DCC8] bg-white p-5 shadow-sm space-y-4">
                <span className="text-[11px] font-bold uppercase tracking-wider text-[#7a1e0e]">
                  Featured Product
                </span>
                {item.relatedProductImage && (
                  <div className="relative h-40 w-full overflow-hidden rounded-xl bg-[#F9F9F9]">
                    <Image
                      src={item.relatedProductImage}
                      alt={item.relatedProductName}
                      fill
                      className="object-contain"
                    />
                  </div>
                )}
                <div>
                  <h3 className="font-bold text-base text-[#201A1A]">{item.relatedProductName}</h3>
                  {item.relatedProductPrice != null && (
                    <p className="mt-1 text-lg font-extrabold text-[#B44444]">
                      ₹{item.relatedProductPrice.toFixed(2)}
                    </p>
                  )}
                </div>
                {item.relatedProductSlug && (
                  <Link
                    href={`/product/${item.relatedProductSlug}`}
                    className="inline-flex w-full items-center justify-center gap-2 rounded-xl bg-[#7a1e0e] px-4 py-2.5 text-xs font-bold text-white transition hover:bg-[#601c10]"
                  >
                    <ShoppingCart size={16} /> View & Buy Product
                  </Link>
                )}
              </div>
            )}

            {/* Social Share Card */}
            <div className="rounded-2xl border border-[#E2E2E2] bg-white p-5 shadow-sm space-y-3">
              <h4 className="text-xs font-bold uppercase text-[#4A1E1F] flex items-center gap-1.5">
                <Share2 size={14} /> Share This Guide
              </h4>
              <div className="flex flex-wrap items-center gap-2">
                <a
                  href={`https://api.whatsapp.com/send?text=${encodeURIComponent(`${item.title} - ${item.shortDescription || ""}`)}`}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="rounded-lg bg-emerald-50 px-3 py-1.5 text-xs font-bold text-emerald-700 hover:bg-emerald-100"
                >
                  WhatsApp
                </a>
                <a
                  href={`https://twitter.com/intent/tweet?text=${encodeURIComponent(item.title)}`}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="rounded-lg bg-sky-50 px-3 py-1.5 text-xs font-bold text-sky-700 hover:bg-sky-100"
                >
                  Twitter / X
                </a>
              </div>
            </div>
          </div>
        </div>

        {/* Prev / Next Navigation Bar */}
        <div className="flex flex-col sm:flex-row items-center justify-between gap-4 border-t border-b border-[#DEDEDE] py-4">
          {prevItem ? (
            <Link
              href={`/product-usage/${prevItem.slug}`}
              className="flex items-center gap-2 text-xs font-bold text-[#7a1e0e] hover:underline"
            >
              <ArrowLeft size={16} /> Previous: {prevItem.title}
            </Link>
          ) : (
            <span />
          )}

          {nextItem ? (
            <Link
              href={`/product-usage/${nextItem.slug}`}
              className="flex items-center gap-2 text-xs font-bold text-[#7a1e0e] hover:underline"
            >
              Next: {nextItem.title} <ArrowRight size={16} />
            </Link>
          ) : (
            <span />
          )}
        </div>

        {/* More Related Usage Guides */}
        {relatedUsages && relatedUsages.length > 0 && (
          <div className="space-y-4 pt-4">
            <h3 className="font-heading text-2xl uppercase text-[#4A1E1F]">
              More Usage Guides
            </h3>
            <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-4">
              {relatedUsages.map((rel: any) => (
                <Link
                  key={rel.id}
                  href={`/product-usage/${rel.slug}`}
                  className="group rounded-xl border border-[#E2E2E2] bg-white p-3 shadow-sm hover:shadow-md transition"
                >
                  <div className="relative aspect-video w-full overflow-hidden rounded-lg bg-[#ECECEC]">
                    {rel.thumbnail ? (
                      <Image src={rel.thumbnail} alt={rel.title} fill className="object-cover group-hover:scale-105 transition-transform" />
                    ) : (
                      <div className="flex h-full w-full items-center justify-center text-[10px] text-[#AAA]">Guide</div>
                    )}
                  </div>
                  <h4 className="mt-2 font-bold text-xs text-[#201A1A] group-hover:text-[#7a1e0e] line-clamp-2">
                    {rel.title}
                  </h4>
                </Link>
              ))}
            </div>
          </div>
        )}

      </div>
    </section>
  )
}
