"use client"

import Link from "next/link"
import { useCallback, useEffect, useMemo, useState } from "react"
import { authedDelete, authedFetch, authedPatch } from "@/lib/dashboard-fetch"
import { ComboForm } from "@/components/dashboard/ComboForm"
import {
  Package,
  PlayCircle,
  PauseCircle,
  Layers,
  Search,
  RotateCcw,
  Plus,
  X,
  MoreHorizontal,
  Pencil,
} from "lucide-react"
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu"

type BundleProductItem = {
  productId: string
  name: string
  slug: string
  price: number
  basePrice: number | null
  thumbnail: string | null
}

type BundleRow = {
  id: string
  name: string
  slug: string
  isActive: boolean
  pricingMode: "fixed" | "dynamic"
  comboPrice?: number | null
  description?: string | null
  image?: string | null
  effectivePrice: number
  savings: number
  includedProductsCount: number
  products?: BundleProductItem[]
  createdAt: string
}

export default function AdminCombosPage() {
  const [rows, setRows] = useState<BundleRow[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState("")
  const [search, setSearch] = useState("")
  const [status, setStatus] = useState<"all" | "true" | "false">("all")
  const [page, setPage] = useState(1)
  const [total, setTotal] = useState(0)
  const [isCreateOpen, setIsCreateOpen] = useState(false)
  const [editingBundleId, setEditingBundleId] = useState<string | null>(null)
  const isPanelOpen = isCreateOpen || !!editingBundleId
  const limit = 20

  const loadBundles = useCallback(async () => {
    setLoading(true)
    setError("")
    try {
      const params = new URLSearchParams({
        page: String(page),
        limit: String(limit),
        sort: "created_desc",
      })
      if (search.trim()) params.set("q", search.trim())
      if (status !== "all") params.set("isActive", status)
      const data = await authedFetch<{ items: BundleRow[]; total: number }>(`/api/admin/bundles?${params.toString()}`)
      setRows(Array.isArray(data?.items) ? data.items : [])
      setTotal(Number(data?.total ?? 0))
    } catch (e: any) {
      setError(e instanceof Error ? e.message : "Failed to load combos")
    } finally {
      setLoading(false)
    }
  }, [page, search, status])

  useEffect(() => {
    void loadBundles()
  }, [loadBundles])

  const handleClosePanel = () => {
    setIsCreateOpen(false)
    setEditingBundleId(null)
  }

  const handleComboSaved = () => {
    handleClosePanel()
    void loadBundles()
  }

  const totalPages = Math.max(1, Math.ceil(total / limit))

  const toggleActive = async (row: BundleRow) => {
    try {
      await authedPatch(`/api/admin/bundles/${row.id}`, { isActive: !row.isActive })
      setRows((prev) => prev.map((x) => (x.id === row.id ? { ...x, isActive: !x.isActive } : x)))
    } catch (e) {
      setError(e instanceof Error ? e.message : "Failed to update status")
    }
  }

  const handleResetFilters = () => {
    setSearch("")
    setStatus("all")
    setPage(1)
  }

  const activeCount = rows.filter((r) => r.isActive !== false).length
  const inactiveCount = rows.filter((r) => r.isActive === false).length
  const uniqueItemsCount = useMemo(() => {
    const uniqueIds = new Set<string>()
    for (const r of rows) {
      if (Array.isArray(r.products)) {
        for (const p of r.products) {
          const id = p.productId || (p as any).id
          if (id) uniqueIds.add(String(id))
        }
      }
    }
    return uniqueIds.size
  }, [rows])

  return (
    <section className="mx-auto max-w-400 px-2 sm:px-0">
      {/* Top Split Container: Panel spans entire height from top */}
      <div className="flex flex-col xl:flex-row gap-4 items-start w-full">
        {/* Left Side: Header, Stats, Filters, Table, Pagination */}
        <div className={`transition-all duration-300 ease-in-out min-w-0 space-y-5 ${isPanelOpen ? "w-full xl:w-[56%] 2xl:w-[58%]" : "w-full"}`}>
          {/* Header */}
          <div className="flex flex-wrap items-center justify-between gap-3">
            <div>
              <h1 className="font-melon text-2xl font-bold text-[#4A1D1F]">Combo Offers</h1>
              <p className="text-xs sm:text-sm text-[#646464]">Create and manage combo offers to boost your sales.</p>
            </div>
            <div className="flex items-center gap-2">
              <Link
                href="/admin/products"
                className="rounded-xl border border-[#E8DCC8] bg-white px-4 py-2 text-xs font-semibold uppercase tracking-wide text-[#4A1D1F] hover:bg-[#FFFBF3] transition-colors"
              >
                Back to Products
              </Link>
              {!isPanelOpen && (
                <button
                  type="button"
                  onClick={() => {
                    setEditingBundleId(null)
                    setIsCreateOpen(true)
                  }}
                  className="inline-flex items-center gap-1.5 rounded-xl bg-[#7B3010] px-4 py-2 text-xs font-semibold uppercase tracking-wide text-white hover:bg-[#5c2410] transition-colors shadow-sm"
                >
                  <Plus className="h-4 w-4" />
                  Add New Combo
                </button>
              )}
            </div>
          </div>

          {/* Summary Stat Cards */}
          <div className={`grid gap-3 ${isPanelOpen ? "grid-cols-2 sm:grid-cols-4 xl:grid-cols-2 2xl:grid-cols-4" : "grid-cols-2 sm:grid-cols-4"}`}>
            <div className="flex items-center gap-3 rounded-2xl border border-[#E8DCC8] bg-white p-3.5 sm:p-4 shadow-xs">
              <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl bg-amber-100 text-amber-700">
                <Package className="h-5 w-5" />
              </div>
              <div>
                <div className="text-xl font-bold text-[#4A1D1F]">{total}</div>
                <div className="text-xs text-[#7A7A7A]">Total Combos</div>
              </div>
            </div>

            <div className="flex items-center gap-3 rounded-2xl border border-[#E8DCC8] bg-white p-3.5 sm:p-4 shadow-xs">
              <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl bg-emerald-100 text-emerald-700">
                <PlayCircle className="h-5 w-5" />
              </div>
              <div>
                <div className="text-xl font-bold text-[#4A1D1F]">{activeCount}</div>
                <div className="text-xs text-[#7A7A7A]">Active</div>
              </div>
            </div>

            <div className="flex items-center gap-3 rounded-2xl border border-[#E8DCC8] bg-white p-3.5 sm:p-4 shadow-xs">
              <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl bg-red-100 text-red-700">
                <PauseCircle className="h-5 w-5" />
              </div>
              <div>
                <div className="text-xl font-bold text-[#4A1D1F]">{inactiveCount}</div>
                <div className="text-xs text-[#7A7A7A]">Inactive</div>
              </div>
            </div>

            <div className="flex items-center gap-3 rounded-2xl border border-[#E8DCC8] bg-white p-3.5 sm:p-4 shadow-xs">
              <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl bg-blue-100 text-blue-700">
                <Layers className="h-5 w-5" />
              </div>
              <div>
                <div className="text-xl font-bold text-[#4A1D1F]">{uniqueItemsCount}</div>
                <div className="text-xs text-[#7A7A7A]">Items Linked</div>
              </div>
            </div>
          </div>

          {error ? <p className="rounded-xl border border-red-200 bg-red-50 px-4 py-2.5 text-sm text-red-800">{error}</p> : null}

          {/* Filters Bar */}
          <div className="flex flex-wrap items-center gap-3 rounded-2xl border border-[#E8DCC8] bg-white p-3.5">
            <div className="relative min-w-[200px] flex-1">
              <Search className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-[#7A7A7A]" />
              <input
                value={search}
                onChange={(e) => {
                  setSearch(e.target.value)
                  setPage(1)
                }}
                placeholder="Search combo offers..."
                className="w-full rounded-lg border border-[#E8DCC8] pl-9 pr-3 py-1.5 text-sm focus:border-[#7B3010] focus:outline-none"
              />
            </div>
            <select
              value={status}
              onChange={(e) => {
                setStatus(e.target.value as "all" | "true" | "false")
                setPage(1)
              }}
              className="rounded-lg border border-[#E8DCC8] bg-white px-3 py-1.5 text-sm focus:border-[#7B3010] focus:outline-none text-[#4A1D1F]"
            >
              <option value="all">All Status</option>
              <option value="true">Active</option>
              <option value="false">Inactive</option>
            </select>
            <button
              type="button"
              onClick={handleResetFilters}
              className="inline-flex items-center gap-1 rounded-lg border border-[#E8DCC8] px-3 py-1.5 text-xs font-semibold text-[#7A7A7A] hover:bg-[#FFFBF3] hover:text-[#4A1D1F] transition-colors"
            >
              <RotateCcw className="h-3.5 w-3.5" />
              Reset
            </button>
          </div>

          {/* Combos Table */}
          {loading ? (
            <p className="text-sm text-[#646464] py-4 text-center">Loading combos…</p>
          ) : (
            <div className="overflow-hidden rounded-2xl border border-[#E8DCC8] bg-white shadow-xs">
              <div className="overflow-x-auto">
                <table className="w-full text-left text-sm whitespace-nowrap">
                  <thead className="bg-[#FFFBF3] text-xs font-semibold uppercase tracking-wide text-[#7A7A7A] border-b border-[#E8DCC8]">
                    <tr>
                      <th className="px-4 py-3">Combo</th>
                      <th className="px-4 py-3">Included Items</th>
                      <th className="px-4 py-3">Price</th>
                      <th className="px-4 py-3">Status</th>
                      <th className="px-4 py-3 text-center">Actions</th>
                    </tr>
                  </thead>
                  <tbody>
                    {rows.length === 0 ? (
                      <tr>
                        <td className="px-4 py-8 text-center text-[#646464]" colSpan={5}>
                          No combo offers found.
                        </td>
                      </tr>
                    ) : (
                      rows.map((r) => (
                        <tr key={r.id} className="border-t border-[#E8DCC8]/60 hover:bg-[#FFFBF3]/40 transition-colors">
                          {/* Combo Info */}
                          <td className="px-4 py-3">
                            <div className="flex items-center gap-3">
                              {r.image ? (
                                <img
                                  src={r.image}
                                  alt={r.name}
                                  className="h-12 w-12 rounded-xl object-cover  shrink-0"
                                />
                              ) : (
                                <div className="flex h-12 w-12 items-center justify-center rounded-xl bg-amber-50  text-[#7B3010] shrink-0">
                                  <Package className="h-5 w-5" />
                                </div>
                              )}
                              <div className="min-w-0">
                                <p className="font-semibold text-sm text-[#4A1D1F] truncate">{r.name}</p>
                                <p className="text-xs text-[#7A7A7A] text-wrap max-w-100">
                                  {r.products && r.products.length > 0
                                    ? r.products.map((p) => p.name).join(" + ")
                                    : r.description || r.slug}
                                </p>
                              </div>
                            </div>
                          </td>

                          {/* Included Product Mini Thumbnails */}
                          <td className="px-2 py-3">
                            <div className="flex items-center gap-1.5">
                              {r.products && r.products.length > 0 ? (
                                r.products.map((p, idx) => (
                                  <div
                                    key={idx}
                                    className="h-10 w-10 overflow-hidden bg-white shrink-0"
                                    title={`${p.name} (Rs.${p.price})`}
                                  >
                                    {p.thumbnail ? (
                                      <img src={p.thumbnail} alt={p.name} className="h-full w-full object-cover" />
                                    ) : (
                                      <div className="h-full w-full flex items-center justify-center text-[10px] bg-[#FFFBF3] text-[#7B3010] font-bold">
                                        {p.name.charAt(0)}
                                      </div>
                                    )}
                                  </div>
                                ))
                              ) : (
                                <span className="text-xs text-[#7A7A7A]">{r.includedProductsCount} items</span>
                              )}
                            </div>
                          </td>

                          {/* Price */}
                          <td className="px-2 py-3 text-wrap">
                            <div>
                              <span className="font-bold text-[#4A1D1F]">
                                ₹{Number(r.effectivePrice ?? 0).toFixed(0)}
                              </span>
                              {Number(r.savings ?? 0) > 0 && (
                                <span className="ml-1.5 text-xs text-[#7A7A7A] line-through">
                                  ₹{(Number(r.effectivePrice ?? 0) + Number(r.savings ?? 0)).toFixed(0)}
                                </span>
                              )}
                            </div>
                          </td>

                          {/* Status */}
                          <td className="px-2 py-3">
                            {r.isActive === false ? (
                              <span className="inline-flex items-center rounded-full bg-red-50 border border-red-200 px-2.5 py-0.5 text-xs font-semibold text-red-700">
                                Inactive
                              </span>
                            ) : (
                              <span className="inline-flex items-center rounded-full bg-emerald-50 border border-emerald-200 px-2.5 py-0.5 text-xs font-semibold text-emerald-700">
                                Active
                              </span>
                            )}
                          </td>

                          {/* Actions */}
                          <td className="px-4 py-3 text-right">
                            {/* When squeezed (panel is open, or on mobile/tablet): show three dots dropdown */}
                            <div className={isPanelOpen ? "flex items-center justify-end" : "lg:hidden flex items-center justify-end"}>
                              <DropdownMenu>
                                <DropdownMenuTrigger asChild>
                                  <button
                                    type="button"
                                    className="inline-flex h-8 w-8 items-center justify-center rounded-lg  bg-white text-[#7A7A7A] hover:border-[#7B3010]/60 hover:bg-[#FFFBF3] hover:text-[#4A1D1F] transition-colors focus:outline-none"
                                    title="More actions"
                                  >
                                    <MoreHorizontal className="h-4 w-4" />
                                    <span className="sr-only">Actions</span>
                                  </button>
                                </DropdownMenuTrigger>
                                <DropdownMenuContent align="end" className="w-36 rounded-xl border border-[#E8DCC8] bg-white p-1 shadow-lg z-50">
                                  <DropdownMenuItem
                                    onClick={() => {
                                      setIsCreateOpen(false)
                                      setEditingBundleId(r.id)
                                    }}
                                    className="flex w-full cursor-pointer items-center gap-2 rounded-lg px-2.5 py-1.5 text-xs font-semibold text-[#4A1D1F] hover:bg-[#FFFBF3] transition-colors"
                                  >
                                    <Pencil className="h-3.5 w-3.5 text-[#7B3010]" />
                                    Edit
                                  </DropdownMenuItem>
                                  <DropdownMenuItem
                                    onClick={() => void toggleActive(r)}
                                    className="flex w-full cursor-pointer items-center gap-2 rounded-lg px-2.5 py-1.5 text-xs font-semibold text-[#4A1D1F] hover:bg-[#FFFBF3] transition-colors"
                                  >
                                    {r.isActive ? (
                                      <>
                                        <PauseCircle className="h-3.5 w-3.5 text-amber-600" />
                                        Disable
                                      </>
                                    ) : (
                                      <>
                                        <PlayCircle className="h-3.5 w-3.5 text-emerald-600" />
                                        Enable
                                      </>
                                    )}
                                  </DropdownMenuItem>
                                </DropdownMenuContent>
                              </DropdownMenu>
                            </div>

                            {/* When expanded on large desktop (panel closed): show side-by-side buttons */}
                            {!isPanelOpen && (
                              <div className="hidden lg:flex items-center justify-end gap-1.5">
                                <button
                                  type="button"
                                  onClick={() => {
                                    setIsCreateOpen(false)
                                    setEditingBundleId(r.id)
                                  }}
                                  className="rounded-lg border border-[#E8DCC8] bg-white px-2.5 py-1 text-xs font-semibold text-[#4A1D1F] hover:bg-[#FFFBF3] transition-colors"
                                >
                                  Edit
                                </button>
                                <button
                                  type="button"
                                  onClick={() => void toggleActive(r)}
                                  className="rounded-lg border border-[#E8DCC8] bg-white px-2.5 py-1 text-xs font-semibold text-[#7A7A7A] hover:bg-[#FFFBF3] transition-colors"
                                >
                                  {r.isActive ? "Disable" : "Enable"}
                                </button>
                              </div>
                            )}
                          </td>
                        </tr>
                      ))
                    )}
                  </tbody>
                </table>
              </div>
            </div>
          )}

          {/* Pagination */}
          <div className="flex items-center justify-between text-xs text-[#646464] px-1">
            <span>
              Showing {rows.length === 0 ? 0 : (page - 1) * limit + 1} to{" "}
              {Math.min(page * limit, total)} of {total} combos
            </span>
            <div className="flex items-center gap-1.5">
              <button
                type="button"
                className="rounded-lg border border-[#E8DCC8] bg-white px-3 py-1 text-xs disabled:opacity-40 hover:bg-[#FFFBF3]"
                disabled={page <= 1}
                onClick={() => setPage((p) => Math.max(1, p - 1))}
              >
                Prev
              </button>
              <span className="px-2">
                Page {page} / {totalPages}
              </span>
              <button
                type="button"
                className="rounded-lg border border-[#E8DCC8] bg-white px-3 py-1 text-xs disabled:opacity-40 hover:bg-[#FFFBF3]"
                disabled={page >= totalPages}
                onClick={() => setPage((p) => Math.min(totalPages, p + 1))}
              >
                Next
              </button>
            </div>
          </div>
        </div>

        {/* Right Side: Split-Screen Form Panel starting from the very top */}
        {isPanelOpen && (
          <div className="w-full xl:w-[44%] 2xl:w-[42%] shrink-0 transition-all duration-300 ease-in-out">
            <div className="rounded-3xl border border-[#E8DCC8] bg-white p-5 sm:p-6 shadow-xs sticky top-4">
              <div className="flex items-center justify-between pb-3.5 border-b border-[#E8DCC8] mb-4">
                <div>
                  <h2 className="font-melon text-xl font-bold text-[#4A1D1F]">
                    {editingBundleId ? "Edit Combo Offer" : "Create Combo Offer"}
                  </h2>
                  <p className="text-xs text-[#646464]">
                    {editingBundleId
                      ? "Update this combo offer and its products."
                      : "Create a combo product from existing products."}
                  </p>
                </div>
                <button
                  type="button"
                  onClick={handleClosePanel}
                  className="rounded-lg p-2 text-[#7A7A7A] hover:bg-white hover:text-[#4A1D1F] transition-colors border border-transparent hover:border-[#E8DCC8]"
                  title="Close panel"
                >
                  <X className="h-5 w-5" />
                </button>
              </div>
              <ComboForm
                key={editingBundleId || "new"}
                bundleId={editingBundleId || undefined}
                onSaved={handleComboSaved}
                onCancel={handleClosePanel}
              />
            </div>
          </div>
        )}
      </div>
    </section>
  )
}
