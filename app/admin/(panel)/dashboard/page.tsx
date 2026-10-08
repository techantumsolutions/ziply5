"use client"

import type React from "react"
import { useEffect, useMemo, useState } from "react"
import { authedFetch } from "@/lib/dashboard-fetch"
import { Package, ShoppingCart, Users, IndianRupee } from "lucide-react"
import { FadeIn, ScaleHover } from "@/components/animations"
import {
  Bar,
  BarChart,
  CartesianGrid,
  Line,
  LineChart,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from "recharts"

type AdminSummary = {
  scope: string
  totalCustomers: number
  totalProducts: number
  totalOrders: number
  totalSales: number
  pendingOrders: number
  salesTrend: Array<{ month: string; currentYear: number; lastYear: number }>
  productViews: Array<{ day: string; thisWeek: number; lastWeek: number }>
  topSoldItems: Array<{ productId: string; name: string; percent: number; units: number }>
  recentOrders: Array<{ id: string; status: string; total: number; createdAt: string; customerName?: string }>
}

const money = (n: number) => `Rs.${Number(n || 0).toFixed(2)}`

const AnimatedNumber = ({
  value,
  prefix = "",
  suffix = "",
}: {
  value: number
  prefix?: string
  suffix?: string
}) => {
  const [count, setCount] = useState(0)

  useEffect(() => {
    let start = 0
    const duration = 1200
    const startTime = performance.now()

    const animate = (currentTime: number) => {
      const elapsed = currentTime - startTime
      const progress = Math.min(elapsed / duration, 1)

      const current = Math.floor(progress * value)

      setCount(current)

      if (progress < 1) {
        requestAnimationFrame(animate)
      }
    }

    requestAnimationFrame(animate)
  }, [value])

  return (
    <span>
      {prefix}
      {count.toLocaleString()}
      {suffix}
    </span>
  )
}

const StatCard = ({
  label,
  value,
  icon: Icon,
  iconTone,
  isMoney = false,
}: {
  label: string
  value: number
  icon: React.ComponentType<{ className?: string }>
  iconTone: "primary" | "accent" | "neutral"
  isMoney?: boolean
}) => {
  const tone =
    iconTone === "accent"
      ? { icon: "bg-[#FDECEC] text-[#C03621]" }
      : iconTone === "neutral"
        ? { icon: "bg-[#FFFBF3] text-[#4A1D1F]" }
        : { icon: "bg-[#FFF3EA] text-[#7B3010]" }

  return (
    <ScaleHover className="h-full">
      <div className="flex h-full items-center gap-3 rounded-2xl border border-[#E8DCC8] bg-white p-4 shadow-sm transition-all duration-300 will-change-transform hover:shadow-md">
        <div
          className={`flex h-10 w-10 items-center justify-center rounded-xl ${tone.icon}`}
        >
          <Icon className="h-5 w-5" />
        </div>

        <div>
          <p className="text-xs font-semibold text-[#7A7A7A]">
            {label}
          </p>

          <p className="mt-0.5 font-melon text-xl font-medium text-[#4A1D1F]">
            <AnimatedNumber
              value={value}
              prefix={isMoney ? "₹" : ""}
              suffix="+"
            />
          </p>
        </div>
      </div>
    </ScaleHover>
  )
}

export default function AdminDashboardPage() {
  const [summary, setSummary] = useState<AdminSummary | null>(null)
  const [error, setError] = useState("")
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    let cancelled = false
    setLoading(true)
    authedFetch<AdminSummary>("/api/v1/dashboard/summary")
      .then((data) => {
        if (cancelled) return
        if (data.scope !== "admin") {
          setError("This dashboard is for admin or super-admin accounts.")
          return
        }
        setSummary(data)
        setError("")
      })
      .catch((e: Error) => {
        if (!cancelled) setError(e.message)
      })
      .finally(() => {
        if (!cancelled) setLoading(false)
      })
    return () => {
      cancelled = true
    }
  }, [])

  const recentRows = useMemo(() => summary?.recentOrders ?? [], [summary])

  return (
    <section className="w-full">
      <div className="rounded-3xl bg-transparent p-0 md:p-0">
        {error ? (
          <div className="mb-4 rounded-2xl border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-800">
            <p className="font-semibold">Could not load dashboard</p>
            <p className="mt-1 font-mono text-xs opacity-90">{error}</p>
          </div>
        ) : null}

        {summary ? (
          <FadeIn>
            <div className="grid gap-4 md:grid-cols-2 lg:grid-cols-4">
              <StatCard
                iconTone="neutral"
                icon={Users}
                label="Total Customers"
                value={summary.totalCustomers}
              />

              <StatCard
                iconTone="primary"
                icon={Package}
                label="Total Products"
                value={summary.totalProducts}
              />

              <StatCard
                iconTone="accent"
                icon={ShoppingCart}
                label="Total Orders"
                value={summary.totalOrders}
              />

              <StatCard
                iconTone="primary"
                icon={IndianRupee}
                label="Total Sales"
                value={summary.totalSales}
                isMoney
              />
            </div>
          </FadeIn>
        ) : loading ? (
          <div className="grid gap-4 md:grid-cols-2 lg:grid-cols-4">
            {Array.from({ length: 4 }).map((_, idx) => (
              <div key={idx} className="h-[74px] animate-pulse rounded-2xl border border-[#E8DCC8] bg-white p-4 shadow-sm" />
            ))}
          </div>
        ) : null}

        {summary ? (
          <div className="mt-3 grid gap-4 lg:grid-cols-3">
            <div className="rounded-2xl border border-[#E8DCC8] bg-white p-4 shadow-sm lg:col-span-2">
              <div className="mb-3 flex items-center justify-between">
                <p className="font-melon text-sm font-medium text-[#4A1D1F]">Sales Trend</p>
                <div className="flex items-center gap-3 text-xs text-[#6B6B6B]">
                  <span className="inline-flex items-center gap-1"><span className="h-2 w-2 rounded-full bg-[#7B3010]" />Current year</span>
                  <span className="inline-flex items-center gap-1"><span className="h-2 w-2 rounded-full bg-[#C03621]" />Last year</span>
                </div>
              </div>
              <div className="h-56 w-full">
                <ResponsiveContainer width="100%" height="100%">
                  <LineChart data={summary.salesTrend}>
                    <CartesianGrid strokeDasharray="3 3" stroke="#EEE" />
                    <XAxis dataKey="month" tick={{ fontSize: 11 }} />
                    <YAxis tick={{ fontSize: 11 }} />
                    <Tooltip formatter={(v: any) => money(Number(v))} />
                    <Line type="monotone" dataKey="currentYear" stroke="#7B3010" strokeWidth={2} dot={false} />
                    <Line type="monotone" dataKey="lastYear" stroke="#C03621" strokeWidth={2} dot={false} />
                  </LineChart>
                </ResponsiveContainer>
              </div>
            </div>

            <div className="rounded-2xl border border-[#E8DCC8] bg-white p-4 shadow-sm">
              <div className="mb-3 flex items-center justify-between">
                <p className="font-melon text-sm font-medium text-[#4A1D1F]">Product Views</p>
                <div className="flex items-center gap-3 text-xs text-[#6B6B6B]">
                  <span className="inline-flex items-center gap-1"><span className="h-2 w-2 rounded-full bg-[#7B3010]" />This Week</span>
                  <span className="inline-flex items-center gap-1"><span className="h-2 w-2 rounded-full bg-[#C03621]" />Last Week</span>
                </div>
              </div>
              <div className="h-56 w-full">
                <ResponsiveContainer width="100%" height="100%">
                  <BarChart data={summary.productViews}>
                    <CartesianGrid strokeDasharray="3 3" stroke="#EEE" />
                    <XAxis dataKey="day" tick={{ fontSize: 11 }} />
                    <YAxis tick={{ fontSize: 11 }} />
                    <Tooltip />
                    <Bar dataKey="thisWeek" fill="#7B3010" radius={[6, 6, 0, 0]} />
                    <Bar dataKey="lastWeek" fill="#C03621" radius={[6, 6, 0, 0]} />
                  </BarChart>
                </ResponsiveContainer>
              </div>
            </div>
          </div>
        ) : loading ? (
          <div className="mt-3 grid gap-4 lg:grid-cols-3">
            <div className="h-[280px] animate-pulse rounded-2xl border border-[#E8DCC8] bg-white shadow-sm lg:col-span-2" />
            <div className="h-[280px] animate-pulse rounded-2xl border border-[#E8DCC8] bg-white shadow-sm" />
          </div>
        ) : null}

        {summary ? (
          <div className="mt-3 grid gap-4 lg:grid-cols-3">
            <div className="rounded-2xl border border-[#E8DCC8] bg-white p-4 shadow-sm lg:col-span-2">
              <div className="mb-3 flex items-center justify-between">
                <p className="font-melon text-sm font-medium text-[#4A1D1F]">All Orders</p>
                <p className="text-xs text-[#6B6B6B]">Latest {recentRows.length}</p>
              </div>
              <div className="overflow-x-auto">
                <table className="min-w-full text-sm">
                  <thead>
                    <tr className="border-b text-left text-xs uppercase text-[#8A8A8A]">
                      <th className="px-2 py-2">Orders ID</th>
                      <th className="px-2 py-2">Customer Name</th>
                      <th className="px-2 py-2">Date</th>
                      <th className="px-2 py-2">Price</th>
                      <th className="px-2 py-2">Status</th>
                    </tr>
                  </thead>
                  <tbody>
                    {recentRows.map((o) => {
                      const status = String(o.status ?? "").toLowerCase()
                      const badge =
                        status === "completed" || status === "delivered"
                          ? "bg-emerald-50 text-emerald-700"
                          : status === "pending"
                            ? "bg-amber-50 text-amber-700"
                            : "bg-slate-50 text-slate-700"
                      return (
                        <tr key={o.id} className="border-b">
                          <td className="px-2 py-2 font-mono text-xs">{String(o.id).slice(0, 8)}</td>
                          <td className="px-2 py-2">{o.customerName || "-"}</td>
                          <td className="px-2 py-2 text-xs text-[#6B6B6B]">
                            {o.createdAt ? new Date(o.createdAt).toLocaleDateString("en-GB") : "-"}
                          </td>
                          <td className="px-2 py-2">{money(Number(o.total ?? 0))}</td>
                          <td className="px-2 py-2">
                            <span className={`inline-flex rounded-full px-2 py-1 text-[10px] font-semibold ${badge}`}>
                              {o.status}
                            </span>
                          </td>
                        </tr>
                      )
                    })}
                    {!recentRows.length ? (
                      <tr>
                        <td colSpan={5} className="px-3 py-6 text-center text-sm text-[#7A7A7A]">No orders yet.</td>
                      </tr>
                    ) : null}
                  </tbody>
                </table>
              </div>
            </div>

            <div className="rounded-2xl border border-[#E8DCC8] bg-white p-4 shadow-sm">
              <p className="font-melon text-sm font-medium text-[#4A1D1F]">Top Sold Items</p>
              <div className="mt-4 space-y-3">
                {summary.topSoldItems.map((row) => (
                  <div key={row.productId}>
                    <div className="flex items-center justify-between text-xs">
                      <span className="font-semibold text-[#4A1D1F]">{row.name}</span>
                      <span className="text-[#6B6B6B]">{row.percent}%</span>
                    </div>
                    <div className="mt-2 h-2 w-full rounded-full bg-[#FFFBF3]">
                      <div className="h-2 rounded-full bg-[#7B3010]" style={{ width: `${Math.min(100, Math.max(0, row.percent))}%` }} />
                    </div>
                  </div>
                ))}
                {!summary.topSoldItems.length ? <p className="text-xs text-[#6B6B6B]">No sales data yet.</p> : null}
              </div>
            </div>
          </div>
        ) : loading ? (
          <div className="mt-3 grid gap-4 lg:grid-cols-3">
            <div className="h-[320px] animate-pulse rounded-2xl border border-[#E8DCC8] bg-white shadow-sm lg:col-span-2" />
            <div className="h-[320px] animate-pulse rounded-2xl border border-[#E8DCC8] bg-white shadow-sm" />
          </div>
        ) : null}
      </div>
    </section>
  )
}
