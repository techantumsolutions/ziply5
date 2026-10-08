"use client"

import { useCallback, useEffect, useState } from "react"
import { authedDelete, authedFetch, authedPatch, authedPost, authedPut } from "@/lib/dashboard-fetch"
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select"

type OfferType = "coupon" | "automatic" | "product_discount" | "cart_discount" | "shipping_discount" | "bogo"
type OfferStatus = "draft" | "active" | "inactive" | "expired"

type Offer = {
  id: string
  type: OfferType
  name: string
  code: string | null
  description: string | null
  status: OfferStatus
  priority: number
  stackable: boolean
  starts_at: string | null
  ends_at: string | null
  config: Record<string, unknown>
  usageCount?: number
  totalSavings?: number
}

const getStatusBadge = (row: Offer) => {
  const now = Date.now()
  if (row.status !== "active") return { label: "Disabled", tone: "gray" as const }
  const starts = row.starts_at ? new Date(row.starts_at).getTime() : null
  const ends = row.ends_at ? new Date(row.ends_at).getTime() : null
  if (starts != null && starts > now) return { label: "Scheduled", tone: "blue" as const }
  if (ends != null && ends < now) return { label: "Expired", tone: "amber" as const }
  return { label: "Active", tone: "green" as const }
}

export default function OffersModulePage({ type, title, subtitle }: { type: OfferType; title: string; subtitle: string }) {
  const [rows, setRows] = useState<Offer[]>([])
  const [total, setTotal] = useState(0)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState("")
  const [query, setQuery] = useState("")
  const [statusFilter, setStatusFilter] = useState<"all" | OfferStatus>("all")
  const [sortBy, setSortBy] = useState<"priority" | "created_at" | "name">("priority")
  const [sortDir, setSortDir] = useState<"asc" | "desc">("asc")
  const [page, setPage] = useState(1)
  const [pageSize, setPageSize] = useState(10)
  const [selectedIds, setSelectedIds] = useState<string[]>([])
  const [selectedLogOfferId, setSelectedLogOfferId] = useState<string>("")
  const [logs, setLogs] = useState<Array<{ id: string; user_id: string | null; order_id: string | null; savings: number; status: string; used_at: string }>>([])
  const [draft, setDraft] = useState({
    id: "",
    name: "",
    code: "",
    description: "",
    enabled: true,
    priority: 100,
    stackable: false,
    startsAt: "",
    endsAt: "",
    discountType: "percentage",
    discountValue: "0",
    maxDiscountCap: "",
    minCartValue: "",
    usageLimitTotal: "",
    usageLimitPerUser: "",
    firstOrderOnly: false,
    buyQty: "2",
    getQty: "1",
    rewardType: "free",
    rewardValue: "0",
    repeatable: true,
    maxFreeUnits: "",
    shippingMode: "flat",
    shippingDiscountValue: "0",
    targetProductIds: "",
    targetCategoryIds: "",
  })

  const load = useCallback(async () => {
    setBusy(true)
    setError("")
    try {
      const data = await authedFetch<{ items: Offer[]; total: number; page: number; pageSize: number }>(
        `/api/v1/offers?type=${encodeURIComponent(type)}&status=${statusFilter === "all" ? "" : statusFilter}&q=${encodeURIComponent(query)}&sortBy=${sortBy}&sortDir=${sortDir}&page=${page}&pageSize=${pageSize}`,
      )
      setRows(data.items ?? [])
      setTotal(data.total ?? 0)
      setSelectedIds([])
    } catch (e) {
      setError(e instanceof Error ? e.message : "Unable to load offers")
    } finally {
      setBusy(false)
    }
  }, [page, pageSize, query, sortBy, sortDir, statusFilter, type])

  useEffect(() => {
    void load()
  }, [load])

  useEffect(() => {
    if (!selectedLogOfferId) return
    void authedFetch<Array<{ id: string; user_id: string | null; order_id: string | null; savings: number; status: string; used_at: string }>>(
      `/api/v1/offers?logsForOfferId=${selectedLogOfferId}&page=1&pageSize=20`,
    )
      .then(setLogs)
      .catch(() => setLogs([]))
  }, [selectedLogOfferId])

  const resetDraft = () =>
    setDraft({
      id: "",
      name: "",
      code: "",
      description: "",
      enabled: true,
      priority: 100,
      stackable: false,
      startsAt: "",
      endsAt: "",
      discountType: "percentage",
      discountValue: "0",
      maxDiscountCap: "",
      minCartValue: "",
      usageLimitTotal: "",
      usageLimitPerUser: "",
      firstOrderOnly: false,
      buyQty: "2",
      getQty: "1",
      rewardType: "free",
      rewardValue: "0",
      repeatable: true,
      maxFreeUnits: "",
      shippingMode: "flat",
      shippingDiscountValue: "0",
      targetProductIds: "",
      targetCategoryIds: "",
    })

  const buildConfig = () => {
    const common = {
      discountType: draft.discountType,
      discountValue: Number(draft.discountValue || 0),
      maxDiscountCap: draft.maxDiscountCap ? Number(draft.maxDiscountCap) : null,
      minCartValue: draft.minCartValue ? Number(draft.minCartValue) : 0,
    }
    if (type === "coupon") {
      return {
        ...common,
        usageLimitTotal: draft.usageLimitTotal ? Number(draft.usageLimitTotal) : null,
        usageLimitPerUser: draft.usageLimitPerUser ? Number(draft.usageLimitPerUser) : null,
        firstOrderOnly: draft.firstOrderOnly,
      }
    }
    if (type === "automatic") return common
    if (type === "product_discount") return common
    if (type === "cart_discount") return common
    if (type === "shipping_discount") {
      return {
        minCartValue: draft.minCartValue ? Number(draft.minCartValue) : 0,
        mode: draft.shippingMode,
        discountValue: Number(draft.shippingDiscountValue || 0),
      }
    }
    return {
      buyQty: Number(draft.buyQty || 2),
      getQty: Number(draft.getQty || 1),
      repeatable: draft.repeatable,
      maxFreeUnits: draft.maxFreeUnits ? Number(draft.maxFreeUnits) : null,
      rewardType: draft.rewardType,
      rewardValue: Number(draft.rewardValue || 0),
    }
  }

  const upsert = async () => {
    setBusy(true)
    setError("")
    try {
      const discountValueNum = Number(draft.discountValue || 0)
      const payload = {
        type,
        name: draft.name.trim(),
        code: draft.code.trim() || null,
        description: draft.description.trim() || null,
        priority: Number(draft.priority),
        stackable: draft.stackable,
        status: draft.enabled ? ("active" as const) : ("inactive" as const),
        startsAt: draft.startsAt || null,
        endsAt: draft.endsAt || null,
        config: buildConfig(),
        targets: [
          ...draft.targetProductIds
            .split(",")
            .map((v) => v.trim())
            .filter(Boolean)
            .map((id) => ({ targetType: "product" as const, targetId: id })),
          ...draft.targetCategoryIds
            .split(",")
            .map((v) => v.trim())
            .filter(Boolean)
            .map((id) => ({ targetType: "category" as const, targetId: id })),
        ],
      }
      if (!payload.name) throw new Error("Offer name is required")
      if (type === "coupon" && !payload.code) throw new Error("Coupon code is required")
      if ((type === "coupon" || type === "cart_discount") && discountValueNum <= 0) {
        throw new Error("Discount value must be greater than 0")
      }
      if (draft.id) {
        await authedPut<{ id: string }>("/api/v1/offers", { id: draft.id, ...payload })
      } else {
        await authedPost<{ id: string }>("/api/v1/offers", payload)
      }
      resetDraft()
      await load()
    } catch (e) {
      setError(e instanceof Error ? e.message : "Unable to save offer")
    } finally {
      setBusy(false)
    }
  }

  const renderTypeSpecificFields = () => {
    if (type === "coupon") {
      return (
        <>
          <input className="rounded-xl border px-3 py-2 text-sm" placeholder="Usage limit total" value={draft.usageLimitTotal} onChange={(e) => setDraft((p) => ({ ...p, usageLimitTotal: e.target.value }))} />
          <input className="rounded-xl border px-3 py-2 text-sm" placeholder="Usage per user" value={draft.usageLimitPerUser} onChange={(e) => setDraft((p) => ({ ...p, usageLimitPerUser: e.target.value }))} />
          <label className="flex items-center gap-2 rounded-xl border px-3 py-2 text-sm"><input type="checkbox" checked={draft.firstOrderOnly} onChange={(e) => setDraft((p) => ({ ...p, firstOrderOnly: e.target.checked }))} />First order only</label>
        </>
      )
    }
    if (type === "automatic" || type === "cart_discount") return null
    if (type === "shipping_discount") {
      return (
        <>
          <Select value={draft.shippingMode} onValueChange={(v) => setDraft((p) => ({ ...p, shippingMode: v }))}>
            <SelectTrigger className="!h-[38px] w-full rounded-xl border px-3 py-2 text-sm shadow-none focus:ring-0">
              <SelectValue placeholder="Shipping Mode" />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="free">Free Shipping</SelectItem>
              <SelectItem value="flat">Reduced Shipping (flat)</SelectItem>
              <SelectItem value="percentage">Reduced Shipping (%)</SelectItem>
            </SelectContent>
          </Select>
          <input className="rounded-xl border px-3 py-2 text-sm" placeholder="Shipping discount value" value={draft.shippingDiscountValue} onChange={(e) => setDraft((p) => ({ ...p, shippingDiscountValue: e.target.value }))} />
        </>
      )
    }
    if (type === "bogo") {
      return (
        <>
          <input className="rounded-xl border px-3 py-2 text-sm" placeholder="Buy qty" value={draft.buyQty} onChange={(e) => setDraft((p) => ({ ...p, buyQty: e.target.value }))} />
          <input className="rounded-xl border px-3 py-2 text-sm" placeholder="Get qty" value={draft.getQty} onChange={(e) => setDraft((p) => ({ ...p, getQty: e.target.value }))} />
          <Select value={draft.rewardType} onValueChange={(v) => setDraft((p) => ({ ...p, rewardType: v }))}>
            <SelectTrigger className="!h-[28px] w-full rounded-xl border px-3 py-2 text-sm shadow-none focus:ring-0">
              <SelectValue placeholder="Reward Type" />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="free">Free</SelectItem>
              <SelectItem value="percentage_off">% Off</SelectItem>
            </SelectContent>
          </Select>
          <input className="rounded-xl border px-3 py-2 text-sm" placeholder="Reward value (for % off)" value={draft.rewardValue} onChange={(e) => setDraft((p) => ({ ...p, rewardValue: e.target.value }))} />
          <label className="flex items-center gap-2 rounded-xl border px-3 py-2 text-sm"><input type="checkbox" checked={draft.repeatable} onChange={(e) => setDraft((p) => ({ ...p, repeatable: e.target.checked }))} />Repeatable</label>
          <input className="rounded-xl border px-3 py-2 text-sm" placeholder="Max free units" value={draft.maxFreeUnits} onChange={(e) => setDraft((p) => ({ ...p, maxFreeUnits: e.target.value }))} />
          <input className="rounded-xl border px-3 py-2 text-sm md:col-span-2" placeholder="Eligible product IDs (comma, optional)" value={draft.targetProductIds} onChange={(e) => setDraft((p) => ({ ...p, targetProductIds: e.target.value }))} />
          <input className="rounded-xl border px-3 py-2 text-sm md:col-span-2" placeholder="Eligible category IDs (comma, optional)" value={draft.targetCategoryIds} onChange={(e) => setDraft((p) => ({ ...p, targetCategoryIds: e.target.value }))} />
        </>
      )
    }
    return null
  }

  return (
    <section className="w-full space-y-4">
      <div>
        <h1 className="font-melon text-2xl font-bold text-[#4A1D1F]">{title}</h1>
        <p className="text-sm text-[#646464]">{subtitle}</p>
      </div>

      <div className="grid gap-3 rounded-2xl border border-[#E8DCC8] bg-white p-4 shadow-sm md:grid-cols-4">
        <input className="rounded-xl border px-3 py-2 text-sm" placeholder="Offer name" value={draft.name} onChange={(e) => setDraft((p) => ({ ...p, name: e.target.value }))} />
        <input className="rounded-xl border px-3 py-2 text-sm" placeholder={type === "coupon" ? "Coupon code (required)" : "Coupon code (optional)"} value={draft.code} onChange={(e) => setDraft((p) => ({ ...p, code: e.target.value.toUpperCase() }))} />
        <input className="rounded-xl border px-3 py-2 text-sm" placeholder="Description" value={draft.description} onChange={(e) => setDraft((p) => ({ ...p, description: e.target.value }))} />
        <label className="flex items-center justify-between gap-3 rounded-xl border px-3 py-2 text-sm">
          <span>Enabled</span>
          <input type="checkbox" checked={draft.enabled} onChange={(e) => setDraft((p) => ({ ...p, enabled: e.target.checked }))} />
        </label>
        <input type="number" className="rounded-xl border px-3 py-2 text-sm" placeholder="Priority" value={draft.priority} onChange={(e) => setDraft((p) => ({ ...p, priority: Number(e.target.value) }))} />
        <Select value={draft.discountType} onValueChange={(v) => setDraft((p) => ({ ...p, discountType: v }))}>
          <SelectTrigger className="!h-[38px] w-full rounded-xl border px-3 py-2 text-sm shadow-none focus:ring-0">
            <SelectValue placeholder="Discount Type" />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="percentage">Percentage</SelectItem>
            <SelectItem value="flat">Flat</SelectItem>
          </SelectContent>
        </Select>
        <input className="rounded-xl border px-3 py-2 text-sm" placeholder="Discount value" value={draft.discountValue} onChange={(e) => setDraft((p) => ({ ...p, discountValue: e.target.value }))} />
        <input className="rounded-xl border px-3 py-2 text-sm" placeholder="Max discount cap (optional)" value={draft.maxDiscountCap} onChange={(e) => setDraft((p) => ({ ...p, maxDiscountCap: e.target.value }))} />
        <input className="rounded-xl border px-3 py-2 text-sm" placeholder="Min cart value (optional)" value={draft.minCartValue} onChange={(e) => setDraft((p) => ({ ...p, minCartValue: e.target.value }))} />
        <input type="datetime-local" className="rounded-xl border px-3 py-2 text-sm" value={draft.startsAt} onChange={(e) => setDraft((p) => ({ ...p, startsAt: e.target.value }))} />
        <input type="datetime-local" className="rounded-xl border px-3 py-2 text-sm" value={draft.endsAt} onChange={(e) => setDraft((p) => ({ ...p, endsAt: e.target.value }))} />
        <label className="flex items-center gap-2 rounded-xl border px-3 py-2 text-sm">
          <input type="checkbox" checked={draft.stackable} onChange={(e) => setDraft((p) => ({ ...p, stackable: e.target.checked }))} />
          Stackable
        </label>
        {renderTypeSpecificFields()}
        <div className="md:col-span-4 flex gap-2">
          <button type="button" onClick={() => void upsert()} disabled={busy} className="rounded-full bg-[#7B3010] px-4 py-2 text-xs font-semibold uppercase tracking-wide text-white disabled:opacity-50">
            {draft.id ? "Update Offer" : "Create Offer"}
          </button>
          {draft.id ? (
            <button type="button" onClick={resetDraft} className="rounded-full border border-[#7B3010] px-4 py-2 text-xs font-semibold uppercase tracking-wide text-[#7B3010]">
              Cancel Edit
            </button>
          ) : null}
        </div>
      </div>

      <div className="rounded-2xl border border-[#E8DCC8] bg-white p-4 shadow-sm">
        <div className="mb-3 flex items-center justify-between gap-3">
          <input className="w-full max-w-sm rounded-full border px-4 py-2 text-sm" placeholder="Search by offer/coupon code" value={query} onChange={(e) => { setQuery(e.target.value); setPage(1) }} />
          <Select value={statusFilter} onValueChange={(v: any) => { setStatusFilter(v); setPage(1) }}>
            <SelectTrigger className="!h-[37px] w-[140px] rounded-full border px-4 py-2 text-sm shadow-none focus:ring-0">
              <SelectValue placeholder="All statuses" />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="all">All statuses</SelectItem>
              <SelectItem value="draft">Draft</SelectItem>
              <SelectItem value="active">Active</SelectItem>
              <SelectItem value="inactive">Inactive</SelectItem>
              <SelectItem value="expired">Expired</SelectItem>
            </SelectContent>
          </Select>
          <Select value={sortBy} onValueChange={(v: any) => setSortBy(v)}>
            <SelectTrigger className="!h-[37px] w-[140px] rounded-full border px-4 py-2 text-sm shadow-none focus:ring-0">
              <SelectValue placeholder="Sort By" />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="priority">Sort: Priority</SelectItem>
              <SelectItem value="created_at">Sort: Created</SelectItem>
              <SelectItem value="name">Sort: Name</SelectItem>
            </SelectContent>
          </Select>
          <Select value={sortDir} onValueChange={(v: any) => setSortDir(v)}>
            <SelectTrigger className="!h-[37px] w-[90px] rounded-full border px-4 py-2 text-sm shadow-none focus:ring-0">
              <SelectValue placeholder="Dir" />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="asc">Asc</SelectItem>
              <SelectItem value="desc">Desc</SelectItem>
            </SelectContent>
          </Select>
          <button type="button" className="rounded-full border border-[#7B3010] px-3 py-1.5 text-xs font-semibold uppercase text-[#7B3010]" onClick={() => void load()} disabled={busy}>
            Refresh
          </button>
        </div>
        {!!selectedIds.length && (
          <div className="mb-3 flex items-center gap-2">
            <span className="text-xs text-[#7A7A7A]">{selectedIds.length} selected</span>
            <button type="button" className="rounded-full border px-3 py-1 text-[10px]" onClick={() => void authedPatch("/api/v1/offers", { action: "bulk_toggle", ids: selectedIds, status: "active" }).then(() => load())}>Bulk Enable</button>
            <button type="button" className="rounded-full border px-3 py-1 text-[10px]" onClick={() => void authedPatch("/api/v1/offers", { action: "bulk_toggle", ids: selectedIds, status: "inactive" }).then(() => load())}>Bulk Disable</button>
          </div>
        )}
        <div className="overflow-x-auto">
          <table className="min-w-full text-sm">
            <thead>
              <tr className="border-b text-left text-xs uppercase text-[#7A7A7A]">
                <th className="px-2 py-2"><input type="checkbox" checked={rows.length > 0 && selectedIds.length === rows.length} onChange={(e) => setSelectedIds(e.target.checked ? rows.map((r) => r.id) : [])} /></th>
                <th className="px-2 py-2">Name</th>
                <th className="px-2 py-2">Code</th>
                <th className="px-2 py-2">Status</th>
                <th className="px-2 py-2">Priority</th>
                <th className="px-2 py-2">Usage</th>
                <th className="px-2 py-2">Schedule</th>
                <th className="px-2 py-2">Actions</th>
              </tr>
            </thead>
            <tbody>
              {rows.map((row) => (
                <tr key={row.id} className="border-b align-top">
                  <td className="px-2 py-2"><input type="checkbox" checked={selectedIds.includes(row.id)} onChange={(e) => setSelectedIds((prev) => e.target.checked ? [...new Set([...prev, row.id])] : prev.filter((id) => id !== row.id))} /></td>
                  <td className="px-2 py-2">
                    <div className="font-semibold text-[#2A1810]">{row.name}</div>
                    <div className="text-xs text-[#7A7A7A]">{row.description || "-"}</div>
                  </td>
                  <td className="px-2 py-2 text-xs">{row.code || "-"}</td>
                  <td className="px-2 py-2">
                    {(() => {
                      const badge = getStatusBadge(row)
                      const tone =
                        badge.tone === "green"
                          ? "bg-green-50 text-green-700 border-green-200"
                          : badge.tone === "blue"
                            ? "bg-blue-50 text-blue-700 border-blue-200"
                            : badge.tone === "amber"
                              ? "bg-amber-50 text-amber-700 border-amber-200"
                              : "bg-gray-50 text-gray-700 border-gray-200"
                      return <span className={`inline-flex items-center rounded-full border px-2 py-0.5 text-[10px] font-semibold uppercase ${tone}`}>{badge.label}</span>
                    })()}
                  </td>
                  <td className="px-2 py-2">{row.priority}</td>
                  <td className="px-2 py-2 text-xs text-[#7A7A7A]">
                    {row.usageCount ?? 0} uses / Rs.{Number(row.totalSavings ?? 0).toFixed(0)}
                  </td>
                  <td className="px-2 py-2 text-xs text-[#7A7A7A]">{row.starts_at ? new Date(row.starts_at).toLocaleDateString() : "Any"} - {row.ends_at ? new Date(row.ends_at).toLocaleDateString() : "No end"}</td>
                  <td className="px-2 py-2">
                    <div className="flex flex-wrap gap-1">
                      <button
                        type="button"
                        className="rounded-full border px-2 py-1 text-[10px]"
                        onClick={() => {
                          const cfg = (row.config ?? {}) as Record<string, unknown>
                          setDraft({
                            id: row.id,
                            name: row.name,
                            code: row.code ?? "",
                            description: row.description ?? "",
                            enabled: row.status === "active",
                            priority: row.priority,
                            stackable: row.stackable,
                            startsAt: row.starts_at ? row.starts_at.slice(0, 16) : "",
                            endsAt: row.ends_at ? row.ends_at.slice(0, 16) : "",
                            discountType: String(cfg.discountType ?? "percentage"),
                            discountValue: String(cfg.discountValue ?? "0"),
                            maxDiscountCap: cfg.maxDiscountCap == null ? "" : String(cfg.maxDiscountCap),
                            minCartValue: cfg.minCartValue == null ? "" : String(cfg.minCartValue),
                            usageLimitTotal: cfg.usageLimitTotal == null ? "" : String(cfg.usageLimitTotal),
                            usageLimitPerUser: cfg.usageLimitPerUser == null ? "" : String(cfg.usageLimitPerUser),
                            firstOrderOnly: Boolean(cfg.firstOrderOnly ?? false),
                            buyQty: String(cfg.buyQty ?? "2"),
                            getQty: String(cfg.getQty ?? "1"),
                            rewardType: String(cfg.rewardType ?? "free"),
                            rewardValue: String(cfg.rewardValue ?? "0"),
                            repeatable: Boolean(cfg.repeatable ?? true),
                            maxFreeUnits: cfg.maxFreeUnits == null ? "" : String(cfg.maxFreeUnits),
                            shippingMode: String(cfg.mode ?? "flat"),
                            shippingDiscountValue: String(cfg.discountValue ?? "0"),
                            targetProductIds: "",
                            targetCategoryIds: "",
                          })
                        }}
                      >
                        Edit
                      </button>
                      <button type="button" className="rounded-full border px-2 py-1 text-[10px]" onClick={() => void authedPatch("/api/v1/offers", { id: row.id, action: "duplicate" }).then(() => load())}>Duplicate</button>
                      <button
                        type="button"
                        className="rounded-full border px-2 py-1 text-[10px]"
                        onClick={() => {
                          const next = row.status === "active" ? ("inactive" as const) : ("active" as const)
                          void authedPatch("/api/v1/offers", { id: row.id, action: "toggle", status: next }).then(() => load())
                        }}
                      >
                        {row.status === "active" ? "Disable" : "Enable"}
                      </button>
                      <button type="button" className="rounded-full border px-2 py-1 text-[10px]" onClick={() => setSelectedLogOfferId(row.id)}>Logs</button>
                      <button type="button" className="rounded-full border border-red-300 px-2 py-1 text-[10px] text-red-700" onClick={() => void authedDelete(`/api/v1/offers?id=${row.id}`).then(() => load())}>Delete</button>
                    </div>
                  </td>
                </tr>
              ))}
              {rows.length === 0 ? (
                <tr>
                  <td colSpan={8} className="px-3 py-6 text-center text-sm text-[#7A7A7A]">
                    {busy ? "Loading offers..." : "No offers found"}
                  </td>
                </tr>
              ) : null}
            </tbody>
          </table>
        </div>
        <div className="mt-3 flex items-center justify-between text-xs text-[#7A7A7A]">
          <span>Total {total}</span>
          <div className="flex items-center gap-2">
            <Select value={String(pageSize)} onValueChange={(v) => { setPageSize(Number(v)); setPage(1) }}>
              <SelectTrigger className="!h-[28px] w-[65px] rounded-full border px-2 py-1 text-xs shadow-none focus:ring-0">
                <SelectValue placeholder="Size" />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="10">10</SelectItem>
                <SelectItem value="20">20</SelectItem>
                <SelectItem value="50">50</SelectItem>
              </SelectContent>
            </Select>
            <button type="button" className="rounded-full border px-2 py-1 disabled:opacity-40" disabled={page <= 1} onClick={() => setPage((p) => Math.max(1, p - 1))}>Prev</button>
            <span>Page {page}</span>
            <button type="button" className="rounded-full border px-2 py-1 disabled:opacity-40" disabled={page * pageSize >= total} onClick={() => setPage((p) => p + 1)}>Next</button>
          </div>
        </div>
        {error ? <p className="mt-3 text-xs text-red-600">{error}</p> : null}
      </div>
      {selectedLogOfferId ? (
        <div className="rounded-2xl border border-[#E8DCC8] bg-white p-4 shadow-sm">
          <div className="mb-2 flex items-center justify-between">
            <h2 className="text-sm font-semibold text-[#2A1810]">Offer Logs</h2>
            <button type="button" className="rounded-full border px-3 py-1 text-[10px]" onClick={() => setSelectedLogOfferId("")}>Close</button>
          </div>
          <div className="space-y-1 text-xs text-[#646464]">
            {logs.map((log) => (
              <div key={log.id} className="rounded border p-2">
                <span>{new Date(log.used_at).toLocaleString()}</span> - <span>{log.status}</span> - <span>Rs.{Number(log.savings).toFixed(2)}</span> - <span>User: {log.user_id ?? "guest"}</span> - <span>Order: {log.order_id ?? "-"}</span>
              </div>
            ))}
            {!logs.length ? <p>No usage logs yet.</p> : null}
          </div>
        </div>
      ) : null}
    </section>
  )
}
