"use client";

import { useEffect, useMemo, useState } from "react";
import Link from "next/link";
import {
  Area,
  CartesianGrid,
  ComposedChart,
  Line,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from "recharts";
import {
  BarChart3,
  Download,
  Eye,
  IndianRupee,
  Receipt,
  RefreshCw,
  RotateCcw,
  Search,
  ShoppingCart,
  TrendingDown,
  TrendingUp,
  Wallet,
} from "lucide-react";
import { authedFetch } from "@/lib/dashboard-fetch";
import { formatOrderDateTime } from "@/src/lib/datetime";
import { orderStatusLabel } from "@/src/lib/orders/manual-order-status";
import { Label } from "@/components/ui/label";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";

type ReportData = {
  from: string;
  to: string;
  orderCount: number;
  revenueTotal: number;
  subtotalTotal: number;
  refundedAmount: number;
  netSale: number;
  averageOrderValue: number;
  change: {
    orders: number;
    revenue: number;
    netSale: number;
    subtotal: number;
    refunds: number;
    averageOrderValue: number;
  };
  series: Array<{ date: string; orders: number; revenue: number }>;
  paymentBreakdown: { online: number; cod: number; refunds: number };
  products: Array<{
    productId: string;
    productName: string;
    totalQuantity: number;
    revenue: number;
  }>;
  recentOrders: Array<{
    id: string;
    createdAt: string;
    customerName: string;
    paymentMethod: string | null;
    shipmentStatus: string;
    total: number;
  }>;
};

type CategoryRow = { id: string; name: string };

const inr = new Intl.NumberFormat("en-IN", {
  style: "currency",
  currency: "INR",
  minimumFractionDigits: 2,
});

const money = (value: number) => inr.format(Number(value) || 0);

const isCod = (method: string | null | undefined) => {
  const value = String(method ?? "").toLowerCase();
  return value === "cod" || value === "cash_on_delivery" || value === "cash";
};

const shipmentTone = (status: string) => {
  const key = status.toLowerCase();
  if (key === "delivered") return "border-emerald-200 bg-emerald-50 text-emerald-800";
  if (key === "shipped") return "border-sky-200 bg-sky-50 text-sky-800";
  if (key === "in_transit" || key === "out_for_delivery") return "border-violet-200 bg-violet-50 text-violet-800";
  if (key === "cancelled" || key === "returned") return "border-red-200 bg-red-50 text-red-800";
  return "border-amber-200 bg-amber-50 text-amber-800";
};

const dayLabel = (iso: string) => {
  const date = new Date(`${iso}T00:00:00.000Z`);
  if (Number.isNaN(date.getTime())) return iso;
  return date.toLocaleDateString("en-IN", { day: "2-digit", month: "short", timeZone: "UTC" });
};

export default function AdminReportsPage() {
  const defaultRange = useMemo(() => {
    const to = new Date();
    const from = new Date();
    from.setDate(from.getDate() - 30);
    return {
      from: from.toISOString().slice(0, 10),
      to: to.toISOString().slice(0, 10),
    };
  }, []);

  const [from, setFrom] = useState(defaultRange.from);
  const [to, setTo] = useState(defaultRange.to);
  const [payment, setPayment] = useState("all");
  const [categoryId, setCategoryId] = useState("all");
  const [categories, setCategories] = useState<CategoryRow[]>([]);
  const [data, setData] = useState<ReportData | null>(null);
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(false);

  const run = (overrides?: { from?: string; to?: string; payment?: string; categoryId?: string }) => {
    const nextFrom = overrides?.from ?? from;
    const nextTo = overrides?.to ?? to;
    const nextPayment = overrides?.payment ?? payment;
    const nextCategory = overrides?.categoryId ?? categoryId;
    setLoading(true);
    setError("");

    const params = new URLSearchParams({
      from: `${nextFrom}T00:00:00.000Z`,
      to: `${nextTo}T23:59:59.999Z`,
    });
    if (nextPayment && nextPayment !== "all") params.append("payment", nextPayment);
    if (nextCategory && nextCategory !== "all") params.append("categoryId", nextCategory);

    authedFetch<ReportData>(`/api/v1/reports/sales?${params.toString()}`)
      .then(setData)
      .catch((e: Error) => {
        setData(null);
        setError(e.message);
      })
      .finally(() => setLoading(false));
  };

  useEffect(() => {
    authedFetch<CategoryRow[]>("/api/v1/categories")
      .then((rows) => setCategories(Array.isArray(rows) ? rows : []))
      .catch(() => setCategories([]));
    run();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const handleReset = () => {
    setFrom(defaultRange.from);
    setTo(defaultRange.to);
    setPayment("all");
    setCategoryId("all");
    run({ from: defaultRange.from, to: defaultRange.to, payment: "all", categoryId: "all" });
  };

  const exportCsv = () => {
    if (!data) return;
    const lines = [
      ["Sales report", from, to].join(","),
      ["Total orders", data.orderCount].join(","),
      ["Gross revenue", data.revenueTotal].join(","),
      ["Net sales", data.netSale].join(","),
      ["Subtotal", data.subtotalTotal].join(","),
      ["Refunds", data.refundedAmount].join(","),
      ["Average order value", data.averageOrderValue].join(","),
      "",
      ["Product", "Units sold", "Revenue"].join(","),
      ...data.products.map((row) => [csv(row.productName), row.totalQuantity, row.revenue].join(",")),
      "",
      ["Order ID", "Date", "Customer", "Payment", "Shipment status", "Total"].join(","),
      ...data.recentOrders.map((row) =>
        [
          row.id,
          formatOrderDateTime(row.createdAt),
          csv(row.customerName),
          isCod(row.paymentMethod) ? "Cash on Delivery" : "Online Payment",
          csv(orderStatusLabel(row.shipmentStatus)),
          row.total,
        ].join(","),
      ),
    ];
    const blob = new Blob([lines.join("\n")], { type: "text/csv;charset=utf-8" });
    const url = URL.createObjectURL(blob);
    const link = document.createElement("a");
    link.href = url;
    link.download = `sales-report-${from}-to-${to}.csv`;
    link.click();
    URL.revokeObjectURL(url);
  };

  const breakdownMax = Math.max(
    data?.paymentBreakdown.online ?? 0,
    data?.paymentBreakdown.cod ?? 0,
    data?.paymentBreakdown.refunds ?? 0,
    1,
  );

  const cards = data
    ? [
        { label: "Total Orders", value: String(data.orderCount), change: data.change.orders, icon: ShoppingCart },
        { label: "Gross Revenue", value: money(data.revenueTotal), change: data.change.revenue, icon: IndianRupee },
        { label: "Net Sales", value: money(data.netSale), change: data.change.netSale, icon: Wallet },
        { label: "Subtotal", value: money(data.subtotalTotal), change: data.change.subtotal, icon: Receipt },
        { label: "Refunds", value: money(data.refundedAmount), change: data.change.refunds, icon: RotateCcw },
        { label: "Average Order Value", value: money(data.averageOrderValue), change: data.change.averageOrderValue, icon: BarChart3 },
      ]
    : [];

  return (
    <section className="w-full space-y-5">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h1 className="font-melon text-2xl font-bold text-[#4A1D1F]">Sales Report</h1>
          <p className="text-sm text-[#646464]">Track revenue, orders, products and fulfilment performance.</p>
        </div>
        <div className="flex gap-2">
          <button
            type="button"
            onClick={exportCsv}
            disabled={!data}
            className="inline-flex cursor-pointer items-center gap-2 rounded-xl border border-[#E8DCC8] bg-white px-4 py-2.5 text-sm font-semibold text-[#4A1D1F] disabled:opacity-50"
          >
            <Download size={16} />
            Export CSV
          </button>
          <button
            type="button"
            onClick={() => run()}
            disabled={loading}
            className="inline-flex cursor-pointer items-center gap-2 rounded-xl bg-[#7B3010] px-4 py-2.5 text-sm font-semibold text-white disabled:opacity-60"
          >
            <RefreshCw size={16} className={loading ? "animate-spin" : ""} />
            Refresh
          </button>
        </div>
      </div>

      <div className="grid items-end gap-3 rounded-2xl border border-[#E8DCC8] bg-white p-4 shadow-sm md:grid-cols-2 xl:grid-cols-[1fr_1fr_1fr_1fr_auto_auto]">
        <label className="text-xs font-semibold text-[#646464]">
          From Date
          <input
            type="date"
            value={from}
            max={to}
            onChange={(e) => setFrom(e.target.value)}
            className="mt-1 block w-full rounded-xl border border-[#E8DCC8] bg-[#FFFcf7] px-3 py-2 text-sm text-[#4A1D1F]"
          />
        </label>
        <label className="text-xs font-semibold text-[#646464]">
          To Date
          <input
            type="date"
            value={to}
            min={from}
            onChange={(e) => setTo(e.target.value)}
            className="mt-1 block w-full rounded-xl border border-[#E8DCC8] bg-[#FFFcf7] px-3 py-2 text-sm text-[#4A1D1F]"
          />
        </label>
        <div>
          <Label className="text-xs font-semibold text-[#646464]">Payment Status</Label>
          <Select value={payment} onValueChange={setPayment}>
            <SelectTrigger className="mt-1 h-10 w-full rounded-xl border-[#E8DCC8] bg-[#FFFcf7]">
              <SelectValue placeholder="All" />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="all">All</SelectItem>
              <SelectItem value="online">Online Payment</SelectItem>
              <SelectItem value="cod">Cash on Delivery</SelectItem>
            </SelectContent>
          </Select>
        </div>
        <div>
          <Label className="text-xs font-semibold text-[#646464]">Product Category</Label>
          <Select value={categoryId} onValueChange={setCategoryId}>
            <SelectTrigger className="mt-1 h-10 w-full rounded-xl border-[#E8DCC8] bg-[#FFFcf7]">
              <SelectValue placeholder="All Categories" />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="all">All Categories</SelectItem>
              {categories.map((category) => (
                <SelectItem key={category.id} value={category.id}>
                  {category.name}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>
        <button
          type="button"
          onClick={() => run()}
          disabled={loading}
          className="inline-flex cursor-pointer items-center justify-center gap-2 rounded-xl bg-[#7B3010] px-5 py-2.5 text-sm font-semibold text-white disabled:opacity-60"
        >
          <Search size={16} />
          {loading ? "Loading…" : "Search"}
        </button>
        <button
          type="button"
          onClick={handleReset}
          className="cursor-pointer rounded-xl border border-[#E8DCC8] bg-[#F7F3EC] px-5 py-2.5 text-sm font-semibold text-[#4A1D1F]"
        >
          Clear
        </button>
      </div>

      {error ? <p className="rounded-lg bg-red-50 px-3 py-2 text-sm text-red-800">{error}</p> : null}

      <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-6">
        {(cards.length ? cards : PLACEHOLDER_CARDS).map((card) => (
          <article key={card.label} className="rounded-2xl border border-[#E8DCC8] bg-white p-4 shadow-sm">
            <div className="mb-3 flex h-9 w-9 items-center justify-center rounded-full bg-[#F8EFE6] text-[#7B3010]">
              <card.icon size={18} />
            </div>
            <p className="text-xs font-medium text-[#8A7568]">{card.label}</p>
            <p className="mt-1 font-melon text-xl font-bold text-[#4A1D1F]">{data ? card.value : "—"}</p>
            {data ? <ChangeLine value={card.change} /> : <p className="mt-1 text-[11px] text-[#8A7568]">vs previous period</p>}
          </article>
        ))}
      </div>

      <div className="grid gap-4 xl:grid-cols-5">
        <article className="rounded-2xl border border-[#E8DCC8] bg-white p-5 shadow-sm xl:col-span-3">
          <h2 className="font-melon text-lg font-semibold text-[#4A1D1F]">Sales Overview</h2>
          <p className="text-xs text-[#8A7568]">Daily revenue and orders in the selected date range.</p>
          <div className="mt-4 h-72">
            <ResponsiveContainer width="100%" height="100%">
              <ComposedChart data={data?.series ?? []} margin={{ top: 10, right: 8, left: 0, bottom: 0 }}>
                <CartesianGrid stroke="#F3EADF" vertical={false} />
                <XAxis dataKey="date" tickFormatter={dayLabel} tick={{ fontSize: 11, fill: "#8A7568" }} axisLine={false} tickLine={false} minTickGap={24} />
                <YAxis yAxisId="revenue" tick={{ fontSize: 11, fill: "#8A7568" }} axisLine={false} tickLine={false} width={48} />
                <YAxis yAxisId="orders" orientation="right" tick={{ fontSize: 11, fill: "#8A7568" }} axisLine={false} tickLine={false} width={32} allowDecimals={false} />
                <Tooltip
                  formatter={(value, name) => [name === "revenue" ? money(Number(value)) : value, name === "revenue" ? "Revenue" : "Orders"]}
                  labelFormatter={(label) => dayLabel(String(label))}
                />
                <Area yAxisId="revenue" type="monotone" dataKey="revenue" stroke="#7B3010" fill="#7B3010" fillOpacity={0.12} strokeWidth={2} name="revenue" />
                <Line yAxisId="orders" type="monotone" dataKey="orders" stroke="#E29A2D" strokeWidth={2} dot={{ r: 3, fill: "#E29A2D" }} name="orders" />
              </ComposedChart>
            </ResponsiveContainer>
          </div>
          <div className="mt-2 flex justify-center gap-5 text-xs text-[#646464]">
            <span className="inline-flex items-center gap-1.5"><span className="h-2 w-2 rounded-full bg-[#7B3010]" /> Revenue (₹)</span>
            <span className="inline-flex items-center gap-1.5"><span className="h-2 w-2 rounded-full bg-[#E29A2D]" /> Orders</span>
          </div>
        </article>

        <article className="overflow-hidden rounded-2xl border border-[#E8DCC8] bg-white shadow-sm xl:col-span-2">
          <div className="p-5 pb-3">
            <h2 className="font-melon text-lg font-semibold text-[#4A1D1F]">Top Selling Products</h2>
            <p className="text-xs text-[#8A7568]">Best performing products in the selected date range.</p>
          </div>
          <div className="overflow-x-auto">
            <table className="w-full min-w-[360px] text-left text-sm">
              <thead>
                <tr className="bg-[#6E2C16] text-[11px] uppercase tracking-wide text-white">
                  <th className="px-4 py-2.5 font-semibold">Product Name</th>
                  <th className="px-3 py-2.5 font-semibold">Units Sold</th>
                  <th className="px-4 py-2.5 text-right font-semibold">Revenue</th>
                </tr>
              </thead>
              <tbody>
                {!data?.products.length ? (
                  <tr>
                    <td colSpan={3} className="px-4 py-8 text-center text-[#8A7568]">No product sales found.</td>
                  </tr>
                ) : (
                  data.products.map((row) => (
                    <tr key={row.productId} className="border-t border-[#F3EADF]">
                      <td className="px-4 py-3 font-medium text-[#2A1810]">{row.productName}</td>
                      <td className="px-3 py-3 text-[#646464]">{row.totalQuantity}</td>
                      <td className="px-4 py-3 text-right font-semibold text-[#4A1D1F]">{money(row.revenue)}</td>
                    </tr>
                  ))
                )}
              </tbody>
            </table>
          </div>
        </article>
      </div>

      <article className="rounded-2xl border border-[#E8DCC8] bg-white p-5 shadow-sm">
        <h2 className="font-melon text-lg font-semibold text-[#4A1D1F]">Revenue Breakdown</h2>
        <p className="text-xs text-[#8A7568]">Payment method wise revenue distribution.</p>
        <div className="mt-5 space-y-4">
          <BarRow label="Online Payments" amount={data?.paymentBreakdown.online ?? 0} max={breakdownMax} bar="bg-[#6E2C16]" />
          <BarRow label="Cash on Delivery" amount={data?.paymentBreakdown.cod ?? 0} max={breakdownMax} bar="bg-[#C8C2BA]" />
          <BarRow label="Refunds" amount={data?.paymentBreakdown.refunds ?? 0} max={breakdownMax} bar="bg-[#E7A3B0]" />
        </div>
      </article>

      <article className="overflow-hidden rounded-2xl border border-[#E8DCC8] bg-white shadow-sm">
        <div className="p-5 pb-3">
          <h2 className="font-melon text-lg font-semibold text-[#4A1D1F]">Recent Orders</h2>
          <p className="text-xs text-[#8A7568]">Latest orders from the selected date range.</p>
        </div>
        <div className="overflow-x-auto">
          <table className="w-full min-w-[760px] text-left text-sm">
            <thead>
              <tr className="bg-[#6E2C16] text-[11px] uppercase tracking-wide text-white">
                <th className="px-4 py-2.5 font-semibold">Order ID</th>
                <th className="px-3 py-2.5 font-semibold">Date & Time</th>
                <th className="px-3 py-2.5 font-semibold">Customer</th>
                <th className="px-3 py-2.5 font-semibold">Payment</th>
                <th className="px-3 py-2.5 font-semibold">Shipment Status</th>
                <th className="px-3 py-2.5 font-semibold">Total Amount</th>
                <th className="px-4 py-2.5 text-center font-semibold">Actions</th>
              </tr>
            </thead>
            <tbody>
              {!data?.recentOrders.length ? (
                <tr>
                  <td colSpan={7} className="px-4 py-8 text-center text-[#8A7568]">No orders in this range.</td>
                </tr>
              ) : (
                data.recentOrders.map((row) => (
                  <tr key={row.id} className="border-t border-[#F3EADF]">
                    <td className="px-4 py-3 font-mono text-xs font-semibold text-[#7B3010]">#{row.id.slice(0, 10).toUpperCase()}</td>
                    <td className="px-3 py-3 text-xs text-[#646464]">{formatOrderDateTime(row.createdAt)}</td>
                    <td className="px-3 py-3 font-medium text-[#2A1810]">{row.customerName}</td>
                    <td className="px-3 py-3">
                      {isCod(row.paymentMethod) ? (
                        <span className="inline-flex items-center gap-1.5 rounded-full border border-amber-200 bg-amber-50 px-2.5 py-0.5 text-xs font-semibold text-amber-800">
                          <span className="h-1.5 w-1.5 rounded-full bg-amber-500" />
                          Cash on Delivery
                        </span>
                      ) : (
                        <span className="inline-flex items-center gap-1.5 rounded-full border border-emerald-200 bg-emerald-50 px-2.5 py-0.5 text-xs font-semibold text-emerald-800">
                          <span className="h-1.5 w-1.5 rounded-full bg-emerald-500" />
                          Online Payment
                        </span>
                      )}
                    </td>
                    <td className="px-3 py-3">
                      <span className={`inline-flex items-center gap-1.5 rounded-full border px-2.5 py-0.5 text-xs font-semibold ${shipmentTone(row.shipmentStatus)}`}>
                        <span className="h-1.5 w-1.5 rounded-full bg-current" />
                        {orderStatusLabel(row.shipmentStatus)}
                      </span>
                    </td>
                    <td className="px-3 py-3 font-semibold text-[#4A1D1F]">{money(row.total)}</td>
                    <td className="px-4 py-3 text-center">
                      <Link
                        href={`/admin/orders/${row.id}`}
                        className="inline-flex h-8 w-8 items-center justify-center rounded-full border border-[#E8DCC8] text-[#7B3010] hover:bg-[#FFFBF3]"
                        aria-label="View order"
                      >
                        <Eye size={15} />
                      </Link>
                    </td>
                  </tr>
                ))
              )}
            </tbody>
          </table>
        </div>
      </article>
    </section>
  );
}

const PLACEHOLDER_CARDS = [
  { label: "Total Orders", value: "—", change: 0, icon: ShoppingCart },
  { label: "Gross Revenue", value: "—", change: 0, icon: IndianRupee },
  { label: "Net Sales", value: "—", change: 0, icon: Wallet },
  { label: "Subtotal", value: "—", change: 0, icon: Receipt },
  { label: "Refunds", value: "—", change: 0, icon: RotateCcw },
  { label: "Average Order Value", value: "—", change: 0, icon: BarChart3 },
];

function ChangeLine({ value }: { value: number }) {
  const up = value >= 0;
  const Icon = up ? TrendingUp : TrendingDown;
  return (
    <p className={`mt-1 inline-flex items-center gap-1 text-[11px] font-semibold ${up ? "text-emerald-700" : "text-red-600"}`}>
      <Icon size={12} />
      {up ? "+" : ""}
      {value.toFixed(0)}% <span className="font-medium text-[#8A7568]">vs previous period</span>
    </p>
  );
}

function BarRow({ label, amount, max, bar }: { label: string; amount: number; max: number; bar: string }) {
  const width = Math.max(0, Math.min(100, (amount / max) * 100));
  return (
    <div className="grid items-center gap-3 sm:grid-cols-[160px_1fr_auto]">
      <p className="text-sm text-[#4A1D1F]">{label}</p>
      <div className="h-3 overflow-hidden rounded-full bg-[#F6F1EA]">
        <div className={`h-full rounded-full ${bar}`} style={{ width: `${width}%` }} />
      </div>
      <p className="text-sm font-semibold text-[#4A1D1F]">{money(amount)}</p>
    </div>
  );
}

function csv(value: string) {
  return `"${value.replaceAll('"', '""')}"`;
}
