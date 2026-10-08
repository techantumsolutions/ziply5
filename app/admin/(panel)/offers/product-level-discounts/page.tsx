"use client"

import { useCallback, useEffect, useMemo, useState } from "react"
import Link from "next/link"
import { authedFetch } from "@/lib/dashboard-fetch"
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select"

type ProductRow = {
  id: string
  name?: string | null
  title?: string | null
  sku?: string | null
  status?: string | null
  price?: number | string | null
  oldPrice?: number | string | null
  discountPercent?: number | string | null
}

function toNum(v: unknown) {
  const n = typeof v === "number" ? v : typeof v === "string" ? Number(v) : NaN
  return Number.isFinite(n) ? n : null
}

function ProductDiscountsReadOnly() {
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState("")
  const [query, setQuery] = useState("")
  const [page, setPage] = useState(1)
  const [pageSize, setPageSize] = useState(20)
  const [rows, setRows] = useState<ProductRow[]>([])
  const [total, setTotal] = useState(0)

  const load = useCallback(async () => {
    setBusy(true)
    setError("")
    try {
      // Admin scope is inferred from auth token on the API.
      const data = await authedFetch<any>(`/api/v1/products?page=${page}&limit=${pageSize}&q=${encodeURIComponent(query)}`)
      const products: ProductRow[] = Array.isArray(data?.products) ? data.products : Array.isArray(data?.items) ? data.items : []
      setRows(products)
      setTotal(Number(data?.total ?? products.length ?? 0))
    } catch (e) {
      setError(e instanceof Error ? e.message : "Unable to load products")
      setRows([])
      setTotal(0)
    } finally {
      setBusy(false)
    }
  }, [page, pageSize, query])

  useEffect(() => {
    void load()
  }, [load])

  const discounted = useMemo(() => {
    return rows
      .map((p) => {
        const price = toNum(p.price)
        const oldPrice = toNum(p.oldPrice)
        const dp = toNum(p.discountPercent)
        const hasDiscount = (dp != null && dp > 0) || (oldPrice != null && price != null && oldPrice > price)
        const discountLabel =
          dp != null && dp > 0 ? `${Math.round(dp)}%` : oldPrice != null && price != null && oldPrice > price ? `₹${Math.round(oldPrice - price)} off` : "-"
        return {
          id: p.id,
          name: (p.name ?? p.title ?? "").toString(),
          sku: p.sku ?? "-",
          status: p.status ?? "-",
          mrp: oldPrice ?? price,
          finalPrice: price ?? 0,
          discountLabel,
          hasDiscount,
        }
      })
      .filter((p) => p.hasDiscount)
  }, [rows])

  return (
    <section className="w-full space-y-4">
      <div>
        <h1 className="font-melon text-2xl font-bold text-[#4A1D1F]">Product Discounts</h1>
        <p className="text-sm text-[#646464]">Read-only view of products that currently have a discount. Discounts are managed in the Product edit screen.</p>
      </div>

      <div className="rounded-2xl border border-[#E8DCC8] bg-white p-4 shadow-sm">
        <div className="mb-3 flex flex-col gap-2 md:flex-row md:items-center md:justify-between">
          <input
            className="w-full max-w-md rounded-full border px-4 py-2 text-sm"
            placeholder="Search products"
            value={query}
            onChange={(e) => {
              setQuery(e.target.value)
              setPage(1)
            }}
          />
          <button type="button" className="rounded-full border border-[#7B3010] px-3 py-1.5 text-xs font-semibold uppercase text-[#7B3010]" onClick={() => void load()} disabled={busy}>
            Refresh
          </button>
        </div>

        <div className="overflow-x-auto">
          <table className="min-w-full text-sm">
            <thead>
              <tr className="border-b text-left text-xs uppercase text-[#7A7A7A]">
                <th className="px-2 py-2">Product</th>
                <th className="px-2 py-2">SKU</th>
                <th className="px-2 py-2">MRP</th>
                <th className="px-2 py-2">Discount</th>
                <th className="px-2 py-2">Final Price</th>
                <th className="px-2 py-2">Status</th>
                <th className="px-2 py-2">Action</th>
              </tr>
            </thead>
            <tbody>
              {discounted.map((p) => (
                <tr key={p.id} className="border-b">
                  <td className="px-2 py-2 font-semibold text-[#2A1810]">{p.name || "-"}</td>
                  <td className="px-2 py-2 text-xs">{p.sku}</td>
                  <td className="px-2 py-2">₹{Math.round(p.mrp ?? 0)}</td>
                  <td className="px-2 py-2 text-xs">{p.discountLabel}</td>
                  <td className="px-2 py-2">₹{Math.round(p.finalPrice ?? 0)}</td>
                  <td className="px-2 py-2 text-xs">{p.status}</td>
                  <td className="px-2 py-2">
                    <Link className="rounded-full border px-3 py-1 text-[10px]" href={`/admin/products/${p.id}/edit`}>
                      Edit product
                    </Link>
                  </td>
                </tr>
              ))}
              {discounted.length === 0 ? (
                <tr>
                  <td colSpan={7} className="px-3 py-6 text-center text-sm text-[#7A7A7A]">
                    {busy ? "Loading products..." : "No discounted products found"}
                  </td>
                </tr>
              ) : null}
            </tbody>
          </table>
        </div>

        <div className="mt-3 flex items-center justify-between text-xs text-[#7A7A7A]">
          <span>Showing {discounted.length} discounted products (of {total} loaded)</span>
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
            <button type="button" className="rounded-full border px-2 py-1 disabled:opacity-40" disabled={page <= 1} onClick={() => setPage((p) => Math.max(1, p - 1))}>
              Prev
            </button>
            <span>Page {page}</span>
            <button type="button" className="rounded-full border px-2 py-1 disabled:opacity-40" disabled={page * pageSize >= total} onClick={() => setPage((p) => p + 1)}>
              Next
            </button>
          </div>
        </div>

        {error ? <p className="mt-3 text-xs text-red-600">{error}</p> : null}
      </div>
    </section>
  )
}

export default function AdminOffersProductDiscountsPage() {
  return <ProductDiscountsReadOnly />
}
