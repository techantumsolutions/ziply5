"use client"

import { useState, useEffect, useCallback } from "react"
import Link from "next/link"
import Image from "next/image"
import { useRouter } from "next/navigation"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Badge } from "@/components/ui/badge"
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select"
import { Checkbox } from "@/components/ui/checkbox"
import {
  Plus, Search, Edit, Trash2, Eye, Video, CheckCircle, XCircle, Settings2,
  Loader2, RefreshCw, ChevronLeft, ChevronRight, Filter
} from "lucide-react"
import { authedFetch, authedPost } from "@/lib/dashboard-fetch"
import { toast } from "@/lib/toast"
import NavigationConfigModal from "./NavigationConfigModal"
import VideoPlayer from "@/components/common/VideoPlayer"

export default function ProductUsageList() {
  const router = useRouter()
  const [items, setItems] = useState<any[]>([])
  const [loading, setLoading] = useState(true)
  const [page, setPage] = useState(1)
  const [totalPages, setTotalPages] = useState(1)
  const [totalItems, setTotalItems] = useState(0)

  // Filters & Search
  const [search, setSearch] = useState("")
  const [publishStatus, setPublishStatus] = useState("all")
  const [videoType, setVideoType] = useState("all")
  const [sort, setSort] = useState("order_asc")

  // Selection for bulk actions
  const [selectedIds, setSelectedIds] = useState<string[]>([])
  const [bulkActionLoading, setBulkActionLoading] = useState(false)

  // Nav settings modal
  const [navModalOpen, setNavModalOpen] = useState(false)

  // Video preview modal
  const [previewVideo, setPreviewVideo] = useState<any | null>(null)

  const fetchItems = useCallback(async () => {
    setLoading(true)
    try {
      const queryParams = new URLSearchParams({
        page: String(page),
        limit: "15",
        sort,
      })
      if (search.trim()) queryParams.set("search", search.trim())
      if (publishStatus !== "all") queryParams.set("publishStatus", publishStatus)
      if (videoType !== "all") queryParams.set("videoType", videoType)

      const res = await authedFetch<any>(`/api/admin/product-usage?${queryParams.toString()}`)
      if (res) {
        setItems(res.items || [])
        setTotalPages(res.pagination?.totalPages || 1)
        setTotalItems(res.pagination?.totalItems || 0)
      }
    } catch (err) {
      toast.error("Failed to load product usage list")
    } finally {
      setLoading(false)
    }
  }, [page, search, publishStatus, videoType, sort])

  useEffect(() => {
    fetchItems()
  }, [fetchItems])

  // Select all checkbox handler
  const handleSelectAll = (checked: boolean) => {
    if (checked) {
      setSelectedIds(items.map((i) => i.id))
    } else {
      setSelectedIds([])
    }
  }

  // Toggle single item selection
  const handleToggleSelect = (id: string) => {
    setSelectedIds((prev) =>
      prev.includes(id) ? prev.filter((x) => x !== id) : [...prev, id]
    )
  }

  // Single Action Handlers
  const handleTogglePublish = async (id: string, currentStatus: string) => {
    const nextStatus = currentStatus === "published" ? "draft" : "published"
    try {
      await fetch(`/api/admin/product-usage/${id}/publish`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ publishStatus: nextStatus }),
      })
      toast.success(`Status changed to ${nextStatus}`)
      fetchItems()
    } catch {
      toast.error("Failed to update publish status")
    }
  }

  const handleToggleActive = async (id: string, currentActive: boolean) => {
    try {
      await fetch(`/api/admin/product-usage/${id}/activate`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ isActive: !currentActive }),
      })
      toast.success(`Entry ${!currentActive ? "activated" : "deactivated"}`)
      fetchItems()
    } catch {
      toast.error("Failed to update active status")
    }
  }

  const handleDelete = async (id: string, title: string) => {
    if (!window.confirm(`Are you sure you want to delete "${title}"?`)) return
    try {
      await fetch(`/api/admin/product-usage/${id}`, { method: "DELETE" })
      toast.success("Entry deleted")
      fetchItems()
    } catch {
      toast.error("Failed to delete entry")
    }
  }

  // Bulk Actions Handler
  const handleBulkAction = async (action: "publish" | "unpublish" | "activate" | "deactivate" | "delete") => {
    if (selectedIds.length === 0) return
    if (action === "delete" && !window.confirm(`Delete ${selectedIds.length} selected entries?`)) return

    setBulkActionLoading(true)
    try {
      await authedPost("/api/admin/product-usage/bulk", { ids: selectedIds, action })
      toast.success(`Bulk ${action} completed for ${selectedIds.length} items`)
      setSelectedIds([])
      fetchItems()
    } catch {
      toast.error(`Bulk ${action} failed`)
    } finally {
      setBulkActionLoading(false)
    }
  }

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex flex-wrap items-center justify-between gap-4">
        <div>
          <h1 className="font-melon text-2xl font-medium text-[#4A1D1F]">Product Usage CMS</h1>
          <p className="text-xs text-[#646464]">
            Manage step-by-step product usage guides, videos, and SEO metadata ({totalItems} entries).
          </p>
        </div>

        <div className="flex flex-wrap items-center gap-2">
          <Button
            variant="outline"
            onClick={() => setNavModalOpen(true)}
            className="gap-2 border-[#E8DCC8] hover:bg-[#FFFBF3] text-[#7B3010]"
          >
            <Settings2 className="h-4 w-4" />
            Navbar Settings
          </Button>
          <Button
            onClick={() => router.push("/admin/product-usage/add")}
            className="gap-2 bg-[#7B3010] text-white hover:bg-[#601c10]"
          >
            <Plus className="h-4 w-4" />
            Add Product Usage
          </Button>
        </div>
      </div>

      {/* Filters Bar */}
      <div className="rounded-2xl border border-[#E8DCC8] bg-white p-4 shadow-sm space-y-3">
        <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
          <div className="relative">
            <Search className="absolute left-3 top-3.5 h-4 w-4 text-[#888]" />
            <Input
              placeholder="Search title, slug..."
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              className="pl-9 text-xs"
            />
          </div>

          <div>
            <Select value={publishStatus} onValueChange={setPublishStatus}>
              <SelectTrigger className="text-xs">
                <SelectValue placeholder="Publish Status" />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="all">All Statuses</SelectItem>
                <SelectItem value="draft">Draft</SelectItem>
                <SelectItem value="published">Published</SelectItem>
                <SelectItem value="archived">Archived</SelectItem>
              </SelectContent>
            </Select>
          </div>

          <div>
            <Select value={videoType} onValueChange={setVideoType}>
              <SelectTrigger className="text-xs">
                <SelectValue placeholder="Video Type" />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="all">All Video Types</SelectItem>
                <SelectItem value="upload">Uploaded Video</SelectItem>
                <SelectItem value="youtube">YouTube</SelectItem>
                <SelectItem value="vimeo">Vimeo</SelectItem>
                <SelectItem value="cdn">CDN / URL</SelectItem>
              </SelectContent>
            </Select>
          </div>

          <div>
            <Select value={sort} onValueChange={setSort}>
              <SelectTrigger className="text-xs">
                <SelectValue placeholder="Sort Order" />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="order_asc">Display Order (Asc)</SelectItem>
                <SelectItem value="newest">Newest First</SelectItem>
                <SelectItem value="oldest">Oldest First</SelectItem>
                <SelectItem value="title_asc">Title A-Z</SelectItem>
              </SelectContent>
            </Select>
          </div>
        </div>

        {/* Bulk Action Controls */}
        {selectedIds.length > 0 && (
          <div className="flex flex-wrap items-center justify-between gap-2 rounded-xl bg-[#FFFBF3] p-2.5 border border-[#E8DCC8] animate-in fade-in duration-200">
            <span className="text-xs font-bold text-[#7B3010]">
              {selectedIds.length} item(s) selected
            </span>
            <div className="flex flex-wrap items-center gap-1.5">
              <Button size="sm" variant="outline" onClick={() => void handleBulkAction("publish")} disabled={bulkActionLoading} className="h-7 text-xs">
                Publish
              </Button>
              <Button size="sm" variant="outline" onClick={() => void handleBulkAction("unpublish")} disabled={bulkActionLoading} className="h-7 text-xs">
                Unpublish
              </Button>
              <Button size="sm" variant="outline" onClick={() => void handleBulkAction("activate")} disabled={bulkActionLoading} className="h-7 text-xs">
                Activate
              </Button>
              <Button size="sm" variant="outline" onClick={() => void handleBulkAction("deactivate")} disabled={bulkActionLoading} className="h-7 text-xs">
                Deactivate
              </Button>
              <Button size="sm" variant="destructive" onClick={() => void handleBulkAction("delete")} disabled={bulkActionLoading} className="h-7 text-xs">
                Delete
              </Button>
            </div>
          </div>
        )}
      </div>

      {/* Main Listing Table */}
      <div className="rounded-2xl border border-[#E8DCC8] bg-white shadow-sm overflow-hidden">
        {loading ? (
          <div className="flex h-64 items-center justify-center">
            <Loader2 className="h-8 w-8 animate-spin text-[#7B3010]" />
          </div>
        ) : items.length === 0 ? (
          <div className="py-16 text-center">
            <Video className="mx-auto h-12 w-12 text-[#CCC]" />
            <h3 className="mt-3 text-base font-bold text-[#4A1D1F]">No Product Usage entries found</h3>
            <p className="mt-1 text-xs text-[#888]">Create your first guide or try adjusting search filters.</p>
            <Button
              onClick={() => router.push("/admin/product-usage/add")}
              className="mt-4 bg-[#7B3010] text-white"
            >
              Add Entry Now
            </Button>
          </div>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-left text-xs">
              <thead className="bg-[#FFFBF3] border-b border-[#E8DCC8] text-[#4A1D1F] font-bold uppercase tracking-wider">
                <tr>
                  <th className="p-3 w-10">
                    <Checkbox
                      checked={items.length > 0 && selectedIds.length === items.length}
                      onCheckedChange={handleSelectAll}
                    />
                  </th>
                  <th className="p-3">Thumbnail</th>
                  <th className="p-3">Title & Slug</th>
                  <th className="p-3">Video</th>
                  <th className="p-3">Related Product</th>
                  <th className="p-3">Status</th>
                  <th className="p-3">Active</th>
                  <th className="p-3">Order</th>
                  <th className="p-3 text-right">Actions</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-[#F2E6DD]">
                {items.map((item) => (
                  <tr key={item.id} className="hover:bg-[#FFFDF9] transition-colors">
                    <td className="p-3">
                      <Checkbox
                        checked={selectedIds.includes(item.id)}
                        onCheckedChange={() => handleToggleSelect(item.id)}
                      />
                    </td>

                    <td className="p-3">
                      <div className="relative h-12 w-16 overflow-hidden rounded-lg border border-[#E8DCC8] bg-[#F9F9F9]">
                        {item.thumbnail ? (
                          <Image src={item.thumbnail} alt={item.title} fill className="object-cover" />
                        ) : (
                          <div className="flex h-full w-full items-center justify-center text-[10px] text-[#AAA]">No image</div>
                        )}
                      </div>
                    </td>

                    <td className="p-3 max-w-[220px]">
                      <p className="font-bold text-[#2A1810] truncate">{item.title}</p>
                      <p className="text-[11px] text-[#888] font-mono truncate">/{item.slug}</p>
                    </td>

                    <td className="p-3">
                      {item.videoType !== "none" ? (
                        <button
                          type="button"
                          onClick={() => setPreviewVideo(item)}
                          className="inline-flex items-center gap-1 rounded-md border border-[#E8DCC8] bg-[#FFFBF3] px-2 py-1 text-[11px] font-semibold text-[#7B3010] hover:bg-[#F5E6D3]"
                        >
                          <Video className="h-3 w-3" />
                          <span className="capitalize">{item.videoType}</span>
                        </button>
                      ) : (
                        <span className="text-[#AAA] italic">None</span>
                      )}
                    </td>

                    <td className="p-3 max-w-[180px]">
                      {item.relatedProductName ? (
                        <span className="font-medium text-[#2A1810] truncate block">
                          {item.relatedProductName}
                        </span>
                      ) : (
                        <span className="text-[#AAA] italic">None</span>
                      )}
                    </td>

                    <td className="p-3">
                      <Badge
                        variant="outline"
                        className={`capitalize cursor-pointer ${item.publishStatus === "published"
                          ? "bg-emerald-50 text-emerald-700 border-emerald-300"
                          : item.publishStatus === "archived"
                            ? "bg-gray-100 text-gray-700 border-gray-300"
                            : "bg-amber-50 text-amber-700 border-amber-300"
                          }`}
                        onClick={() => void handleTogglePublish(item.id, item.publishStatus)}
                      >
                        {item.publishStatus}
                      </Badge>
                    </td>

                    <td className="p-3">
                      <button
                        type="button"
                        onClick={() => void handleToggleActive(item.id, item.isActive)}
                        className="cursor-pointer"
                      >
                        {item.isActive ? (
                          <CheckCircle className="h-5 w-5 text-emerald-600" />
                        ) : (
                          <XCircle className="h-5 w-5 text-gray-300" />
                        )}
                      </button>
                    </td>

                    <td className="p-3 font-semibold text-[#4A1D1F]">
                      {item.displayOrder}
                    </td>

                    <td className="p-3 text-right">
                      <div className="flex items-center justify-end gap-1">
                        <Link href={`/product-usage/${item.slug}`} target="_blank">
                          <Button size="icon" variant="ghost" className="h-7 w-7 text-gray-500 hover:text-blue-600" title="View Public Page">
                            <Eye className="h-3.5 w-3.5" />
                          </Button>
                        </Link>
                        <Link href={`/admin/product-usage/${item.id}/edit`}>
                          <Button size="icon" variant="ghost" className="h-7 w-7 text-gray-500 hover:text-[#7B3010]" title="Edit">
                            <Edit className="h-3.5 w-3.5" />
                          </Button>
                        </Link>
                        <Button
                          size="icon"
                          variant="ghost"
                          onClick={() => void handleDelete(item.id, item.title)}
                          className="h-7 w-7 text-gray-500 hover:text-red-600"
                          title="Delete"
                        >
                          <Trash2 className="h-3.5 w-3.5" />
                        </Button>
                      </div>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}

        {/* Pagination Footer */}
        {totalPages > 1 && (
          <div className="flex items-center justify-between border-t border-[#E8DCC8] bg-[#FFFBF3] px-4 py-3 text-xs">
            <span className="text-[#646464]">
              Page {page} of {totalPages}
            </span>
            <div className="flex items-center gap-1">
              <Button
                variant="outline"
                size="sm"
                disabled={page <= 1}
                onClick={() => setPage((p) => p - 1)}
                className="h-7 px-2"
              >
                <ChevronLeft className="h-4 w-4" /> Previous
              </Button>
              <Button
                variant="outline"
                size="sm"
                disabled={page >= totalPages}
                onClick={() => setPage((p) => p + 1)}
                className="h-7 px-2"
              >
                Next <ChevronRight className="h-4 w-4" />
              </Button>
            </div>
          </div>
        )}
      </div>

      {/* Navigation Modal */}
      <NavigationConfigModal
        open={navModalOpen}
        onClose={() => setNavModalOpen(false)}
      />

      {/* Video Preview Modal */}
      {previewVideo && (
        <div
          className="fixed inset-0 z-50 flex items-center justify-center bg-black/70 p-4"
          onClick={() => setPreviewVideo(null)}
        >
          <div
            className="w-full max-w-2xl overflow-hidden rounded-2xl bg-white p-4 shadow-2xl space-y-3"
            onClick={(e) => e.stopPropagation()}
          >
            <div className="flex items-center justify-between border-b pb-2">
              <h3 className="font-bold text-[#4A1D1F]">{previewVideo.title} (Video Preview)</h3>
              <Button variant="ghost" size="sm" onClick={() => setPreviewVideo(null)}>✕</Button>
            </div>
            <VideoPlayer
              videoType={previewVideo.videoType}
              videoUrl={previewVideo.videoUrl}
              uploadedVideo={previewVideo.uploadedVideo}
              thumbnail={previewVideo.thumbnail}
              title={previewVideo.title}
              autoPlay
            />
          </div>
        </div>
      )}
    </div>
  )
}
