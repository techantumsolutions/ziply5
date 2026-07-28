"use client"

import { useState, useEffect, useCallback } from "react"
import Link from "next/link"
import Image from "next/image"
import { Search, Video, ArrowRight, ChevronLeft, ChevronRight, PlayCircle, Sparkles } from "lucide-react"
import { Skeleton } from "@/components/ui/skeleton"
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";

export default function ProductUsageListingPage() {
  const [items, setItems] = useState<any[]>([])
  const [loading, setLoading] = useState(true)
  const [page, setPage] = useState(1)
  const [totalPages, setTotalPages] = useState(1)
  const [totalItems, setTotalItems] = useState(0)

  const [search, setSearch] = useState("")
  const [sort, setSort] = useState("order_asc")

  const fetchPublicItems = useCallback(async () => {
    setLoading(true)
    try {
      const queryParams = new URLSearchParams({
        page: String(page),
        limit: "12",
        sort,
      })
      if (search.trim()) queryParams.set("search", search.trim())

      const res = await fetch(`/api/v1/product-usage?${queryParams.toString()}`)
      const json = await res.json()
      if (json.success && json.data) {
        setItems(json.data.items || [])
        setTotalPages(json.data.pagination?.totalPages || 1)
        setTotalItems(json.data.pagination?.totalItems || 0)
      }
    } catch {
      setItems([])
    } finally {
      setLoading(false)
    }
  }, [page, search, sort])

  useEffect(() => {
    fetchPublicItems()
  }, [fetchPublicItems])

  return (
    <section className="w-full bg-[#F3F3F3] min-h-screen py-8 md:py-12">
      <div className="mx-auto max-w-7xl px-4 sm:px-6 lg:px-8 space-y-8">
        {/* Banner / Header */}
        {/*   <div className="rounded-3xl bg-[#7a1e0e] text-white p-8 md:p-12 shadow-xl relative overflow-hidden flex flex-col md:flex-row items-center justify-between gap-6">
          <div className="space-y-3 max-w-2xl relative z-10">
            <span className="inline-flex items-center gap-1.5 rounded-full bg-white/20 px-3.5 py-1 text-xs font-bold uppercase tracking-wider text-yellow-300 backdrop-blur-md">
              <Sparkles size={14} /> Product Guides & How-To Videos
            </span>
            <h1 className="font-heading text-4xl sm:text-5xl uppercase leading-tight tracking-wide">
              How To Use & Enjoy Ziply5
            </h1>
            <p className="text-sm sm:text-base text-white/90 leading-relaxed font-melon font-medium">
              Step-by-step preparation guides, cooking tips, and video tutorials for all your favorite authentic meal packages.
            </p>
          </div>
        </div> */}

        {/* Filter & Search Bar */}
        <div className="flex flex-col sm:flex-row items-center justify-between gap-4 rounded-2xl border border-[#E2E2E2] bg-white p-4 shadow-sm">
          <div className="relative w-full sm:w-80">
            <Search className="absolute left-3.5 top-3 h-4 w-4 text-[#888]" />
            <input
              type="text"
              placeholder="Search guides or meals..."
              value={search}
              onChange={(e) => {
                setSearch(e.target.value)
                setPage(1)
              }}
              className="w-full rounded-xl border border-[#D8D8D8] bg-[#FFFBF3] pl-10 pr-4 py-2 text-sm focus:border-[#7a1e0e] focus:outline-none font-medium"
            />
          </div>

          <div className="flex items-center gap-3 w-full sm:w-auto">
            <span className="text-xs font-bold text-[#646464] whitespace-nowrap">Sort by:</span>
            <Select
              value={sort}
              onValueChange={(value) => {
                setSort(value);
                setPage(1);
              }}
            >
              <SelectTrigger className="w-full sm:w-[180px] rounded-xl border border-[#D8D8D8] bg-[#FFFBF3] text-xs font-semibold focus:ring-0 focus:ring-offset-0">
                <SelectValue placeholder="Sort By" />
              </SelectTrigger>

              <SelectContent>
                <SelectItem value="order_asc">Featured Order</SelectItem>
                <SelectItem value="newest">Newest First</SelectItem>
                <SelectItem value="title_asc">Title A-Z</SelectItem>
              </SelectContent>
            </Select>
          </div>
        </div>

        {/* Listing Grid */}
        {loading ? (
          <div className="grid grid-cols-1 gap-6 sm:grid-cols-2 lg:grid-cols-3">
            {Array.from({ length: 6 }).map((_, idx) => (
              <div key={idx} className="rounded-2xl border border-[#E2E2E2] bg-white p-4 space-y-3">
                <Skeleton className="h-48 w-full rounded-xl" />
                <Skeleton className="h-6 w-3/4" />
                <Skeleton className="h-4 w-full" />
                <Skeleton className="h-4 w-2/3" />
                <Skeleton className="h-10 w-full rounded-xl mt-4" />
              </div>
            ))}
          </div>
        ) : items.length === 0 ? (
          <div className="rounded-2xl border border-[#E2E2E2] bg-white py-16 text-center space-y-3">
            <Video className="mx-auto h-12 w-12 text-[#AAA]" />
            <h3 className="text-lg font-bold text-[#4A1E1F]">No Guides Found</h3>
            <p className="text-xs text-[#646464]">Try searching for something else or check back soon!</p>
          </div>
        ) : (
          <div className="grid grid-cols-1 gap-6 sm:grid-cols-2 lg:grid-cols-3">
            {items.map((item) => (
              <Link
                key={item.id}
                href={`/product-usage/${item.slug}`}
                className="group flex flex-col justify-between rounded-2xl border border-[#E2E2E2] bg-white p-4 shadow-sm hover:shadow-xl transition-all duration-300 hover:-translate-y-1"
              >
                <div>
                  {/* Thumbnail / Video Badge */}
                  <div className="relative aspect-video w-full overflow-hidden rounded-xl bg-[#ECECEC]">
                    {item.thumbnail ? (
                      <Image
                        src={item.thumbnail}
                        alt={item.title}
                        fill
                        className="object-cover transition-transform duration-500 group-hover:scale-105"
                      />
                    ) : (
                      <div className="flex h-full w-full items-center justify-center text-xs text-[#888]">
                        Ziply5 Guide
                      </div>
                    )}

                    <div className="absolute inset-0 flex items-center justify-center bg-black/25 opacity-90 transition-opacity group-hover:bg-black/40">
                        <PlayCircle className="h-12 w-12 text-white drop-shadow-md transition-transform group-hover:scale-110" />
                      </div>

                    {item.relatedProductName && (
                      <span className="absolute top-2 left-2 rounded-full bg-[#7a1e0e] px-2.5 py-0.5 text-[10px] font-bold text-white shadow">
                        {item.relatedProductName}
                      </span>
                    )}
                  </div>

                  {/* Title & Description */}
                  <div className="mt-4 space-y-1.5">
                    <h2 className="font-bold text-lg text-[#201A1A] group-hover:text-[#7a1e0e] transition-colors leading-snug line-clamp-2">
                      {item.title}
                    </h2>
                    {item.shortDescription && (
                      <p className="text-xs text-[#606060] line-clamp-2 leading-relaxed">
                        {item.shortDescription}
                      </p>
                    )}
                  </div>
                </div>

                {/* Card Action */}
                <div className="mt-5 pt-3 border-t border-[#F0F0F0] flex items-center justify-between">
                  <span className="text-xs font-extrabold text-[#7a1e0e] flex items-center gap-1 group-hover:translate-x-1 transition-transform">
                    View Usage Guide <ArrowRight size={14} />
                  </span>
                </div>
              </Link>
            ))}
          </div>
        )}

        {/* Pagination */}
        {totalPages > 1 && (
          <div className="flex items-center justify-center gap-3 pt-6">
            <button
              type="button"
              disabled={page <= 1}
              onClick={() => setPage((p) => Math.max(1, p - 1))}
              className="flex h-10 w-10 items-center justify-center rounded-full border border-[#D8D8D8] bg-white text-[#555] disabled:opacity-40 hover:bg-[#FFFBF3]"
            >
              <ChevronLeft size={18} />
            </button>
            <span className="text-xs font-bold text-[#4A1E1F]">
              Page {page} of {totalPages}
            </span>
            <button
              type="button"
              disabled={page >= totalPages}
              onClick={() => setPage((p) => p + 1)}
              className="flex h-10 w-10 items-center justify-center rounded-full border border-[#D8D8D8] bg-white text-[#555] disabled:opacity-40 hover:bg-[#FFFBF3]"
            >
              <ChevronRight size={18} />
            </button>
          </div>
        )}
      </div>
    </section>
  )
}

function SelectOption({ value, label }: { value: string; label: string }) {
  return <option value={value}>{label}</option>
}
