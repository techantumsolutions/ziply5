"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import { authedFetch, authedPost } from "@/lib/dashboard-fetch";
import { useRealtimeTables } from "@/hooks/useRealtimeTables";
import { Download } from "lucide-react";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";

type OrderRow = {
  id: string;
  status: string;
  paymentStatus?: string | null;
  paymentMethod?: string | null;
  total: string | number;
  createdAt: string;
  customerName?: string | null;
  customerPhone?: string | null;
  items: Array<{ quantity: number; product: { name: string; slug: string } }>;
  transactions?: Array<{ status: string }>;
  shipments?: Array<{ id: string; carrier: string | null; trackingNo: string | null; shipmentStatus: string; shippedAt?: string | null }>;
  courierName?: string | null;
  awbCode?: string | null;
  trackingUrl?: string | null;
  shipmentStatus?: string | null;
  fulfillment?: { fulfillmentStatus: string; deliveredAt?: string | null; shippedAt?: string | null } | null;
  statusHistory?: Array<{ toStatus: string; changedAt: string }>;
  user?: { id: string; name: string; email: string };
};

export default function AdminOrdersPage() {
  const router = useRouter();
  const [rows, setRows] = useState<OrderRow[]>([]);
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(true);
  const [canFetch, setCanFetch] = useState(false);
  const [searchTerm, setSearchTerm] = useState("");
  const [paymentFilter, setPaymentFilter] = useState("all");
  const [orderFilter, setOrderFilter] = useState("all");
  const [shipmentFilter, setShipmentFilter] = useState("all");
  const [dateFrom, setDateFrom] = useState("");
  const [dateTo, setDateTo] = useState("");
  const [sortBy, setSortBy] = useState<"latest" | "oldest" | "amount_desc" | "amount_asc">("latest");
  const [page, setPage] = useState(1);
  const [pageSize, setPageSize] = useState(20);
  const [selectedIds, setSelectedIds] = useState<string[]>([]);
  const [bulkSyncBusy, setBulkSyncBusy] = useState(false);
  const [syncProgress, setSyncProgress] = useState<{ total: number; synced: number; failed: number; skipped: number } | null>(null);
  const [rowActionBusy, setRowActionBusy] = useState<Record<string, string>>({});
  const [rowActionError, setRowActionError] = useState<Record<string, string>>({});

  const toPaymentStatus = useCallback((o: OrderRow) => {
    if (o.transactions?.some((t) => /paid|captured|success/i.test(t.status)) || (o.paymentStatus ?? "").toUpperCase() === "SUCCESS") return "success";
    if (o.transactions?.some((t) => /fail/i.test(t.status)) || (o.paymentStatus ?? "").toUpperCase() === "FAILED") return "failed";
    if ((o.paymentStatus ?? "").toUpperCase() === "INITIATED") return "initiated";
    return "pending";
  }, []);
  const lifecycleStatus = useCallback((o: OrderRow) => (o.statusHistory?.[0]?.toStatus ?? o.status ?? "pending").toLowerCase(), []);
  const latestShipmentStatus = useCallback((o: OrderRow) => (o.shipmentStatus ?? o.shipments?.[0]?.shipmentStatus ?? "not_shipped").toLowerCase(), []);
  const itemsCount = useCallback((o: OrderRow) => o.items.reduce((sum, item) => sum + Number(item.quantity ?? 0), 0), []);
  const deliveryEta = useCallback((o: OrderRow) => {
    if (o.fulfillment?.deliveredAt) return "Delivered";
    const shippedAt = o.shipments?.[0]?.shippedAt ?? o.fulfillment?.shippedAt;
    if (!shippedAt) return "—";
    const eta = new Date(shippedAt);
    eta.setDate(eta.getDate() + 3);
    return eta.toLocaleDateString();
  }, []);

  const filteredRows = useMemo(() => {
    const term = searchTerm.trim().toLowerCase();
    let list = rows.filter((o) => {
      const payment = toPaymentStatus(o);
      const lifecycle = lifecycleStatus(o);
      const ship = latestShipmentStatus(o);
      const date = new Date(o.createdAt);
      if (paymentFilter !== "all" && payment !== paymentFilter) return false;
      if (orderFilter !== "all" && lifecycle !== orderFilter) return false;
      if (shipmentFilter !== "all" && ship !== shipmentFilter) return false;
      if (dateFrom && date < new Date(`${dateFrom}T00:00:00`)) return false;
      if (dateTo && date > new Date(`${dateTo}T23:59:59`)) return false;
      if (!term) return true;
      return (
        o.id.toLowerCase().includes(term) ||
        (o.customerName ?? o.user?.name ?? "").toLowerCase().includes(term) ||
        (o.customerPhone ?? "").toLowerCase().includes(term) ||
        (o.user?.email ?? "").toLowerCase().includes(term)
      );
    });
    list = list.sort((a, b) => {
      if (sortBy === "oldest") return +new Date(a.createdAt) - +new Date(b.createdAt);
      if (sortBy === "amount_desc") return Number(b.total) - Number(a.total);
      if (sortBy === "amount_asc") return Number(a.total) - Number(b.total);
      return +new Date(b.createdAt) - +new Date(a.createdAt);
    });
    return list;
  }, [rows, searchTerm, paymentFilter, orderFilter, shipmentFilter, dateFrom, dateTo, sortBy, toPaymentStatus, lifecycleStatus, latestShipmentStatus]);

  const pagedRows = useMemo(() => {
    const start = (page - 1) * pageSize;
    return filteredRows.slice(start, start + pageSize);
  }, [filteredRows, page, pageSize]);
  const pageCount = Math.max(1, Math.ceil(filteredRows.length / pageSize));

  const paidOrdersCount = useMemo(() => rows.filter((o) => toPaymentStatus(o) === "success").length, [rows, toPaymentStatus]);
  const pendingApprovalsCount = useMemo(() => rows.filter((o) => lifecycleStatus(o) === "admin_approval_pending").length, [rows, lifecycleStatus]);
  const pendingOrdersCount = useMemo(() => rows.filter((o) => ["pending", "pending_payment", "payment_success", "admin_approval_pending", "confirmed", "packed"].includes(lifecycleStatus(o))).length, [rows, lifecycleStatus]);
  const completedOrdersCount = useMemo(() => rows.filter((o) => lifecycleStatus(o) === "delivered").length, [rows, lifecycleStatus]);
  const cancelledOrdersCount = useMemo(() => rows.filter((o) => ["cancelled", "returned"].includes(lifecycleStatus(o))).length, [rows, lifecycleStatus]);

  const load = useCallback(() => {
    if (!canFetch) {
      setRows([]);
      setLoading(false);
      setError("Login as admin to load orders.");
      return;
    }
    setLoading(true);
    setError("");
    authedFetch<{ items: OrderRow[] }>("/api/v1/orders?page=1&limit=20")
      .then((d) => setRows(d.items))
      .catch((e: Error) => setError(e.message))
      .finally(() => setLoading(false));
  }, [canFetch]);

  useEffect(() => {
    const syncAuth = () => {
      const token = window.localStorage.getItem("ziply5_access_token");
      const role = window.localStorage.getItem("ziply5_user_role");
      setCanFetch(Boolean(token) && (role === "admin" || role === "super_admin"));
    };
    syncAuth();
    window.addEventListener("storage", syncAuth);
    return () => window.removeEventListener("storage", syncAuth);
  }, []);

  useEffect(() => {
    if (canFetch) load();
    else setLoading(false);
  }, [canFetch, load]);

  useEffect(() => {
    setPage(1);
  }, [searchTerm, paymentFilter, orderFilter, shipmentFilter, dateFrom, dateTo, sortBy, pageSize]);

  // useRealtimeTables({
  //   tables: ["orders", "returns", "refunds", "shipments", "transactions"],
  //   onChange: () => {
  //     if (canFetch) void load();
  //   },
  // });
  // useRealtimeTables({
  //   tables: ["orders"], // 
  //   onChange: () => {
  //     if (canFetch) void load();
  //   },
  // });

  const toggleSelect = (id: string) => {
    setSelectedIds((prev) => (prev.includes(id) ? prev.filter((x) => x !== id) : [...prev, id]));
  };

  const runBulkSync = async (orderIds: string[], retryFailedOnly = false) => {
    if (orderIds.length === 0) return;
    setBulkSyncBusy(true);
    setError("");
    try {
      const data = await authedPost<{
        total: number
        synced: number
        failed: number
        skipped: number
      }>("/api/v1/orders/shiprocket/sync", {
        orderIds,
        generatePickup: true,
        retryFailedOnly,
      });
      setSyncProgress({ total: data.total, synced: data.synced, failed: data.failed, skipped: data.skipped });
      setSelectedIds([]);
      await load();
    } catch (e) {
      setError(e instanceof Error ? e.message : "Bulk sync failed");
    } finally {
      setBulkSyncBusy(false);
    }
  };

  const handleApprovalAction = async (orderId: string, action: "approve_order" | "reject_order") => {
    if (rowActionBusy[orderId]) return;
    setRowActionBusy((prev) => ({ ...prev, [orderId]: action }));
    setRowActionError((prev) => ({ ...prev, [orderId]: "" }));
    try {
      await authedPost(`/api/v1/orders/${orderId}/actions`, { action });
      const nextStatus = action === "approve_order" ? "confirmed" : "cancelled";
      setRows((prev) =>
        prev.map((row) =>
          row.id === orderId
            ? {
                ...row,
                status: nextStatus,
                statusHistory: [{ toStatus: nextStatus, changedAt: new Date().toISOString() }, ...(row.statusHistory ?? [])],
              }
            : row
        )
      );
    } catch (e) {
      const msg = e instanceof Error ? e.message : "Action failed";
      setRowActionError((prev) => ({ ...prev, [orderId]: msg }));
      setError(`Order #${orderId.slice(0, 8)}: ${msg}`);
    } finally {
      setRowActionBusy((prev) => {
        const next = { ...prev };
        delete next[orderId];
        return next;
      });
    }
  };

  const exportCsv = () => {
    const header = ["order_id", "date_time", "customer_name", "mobile", "email", "payment_method", "payment_status", "order_status", "shipment_status", "total_amount", "items_count", "warehouse", "delivery_eta"];
    const body = filteredRows.map((o) => [
      o.id,
      new Date(o.createdAt).toISOString(),
      o.customerName ?? o.user?.name ?? "",
      o.customerPhone ?? "",
      o.user?.email ?? "",
      o.paymentMethod ?? "",
      toPaymentStatus(o),
      lifecycleStatus(o),
      latestShipmentStatus(o),
      Number(o.total).toFixed(2),
      itemsCount(o),
      "—",
      deliveryEta(o),
    ]);
    const csv = [header, ...body].map((row) => row.map((cell) => `"${String(cell ?? "").replaceAll('"', '""')}"`).join(",")).join("\n");
    const blob = new Blob([csv], { type: "text/csv;charset=utf-8;" });
    const link = document.createElement("a");
    link.href = URL.createObjectURL(blob);
    link.download = `orders-export-${new Date().toISOString().slice(0, 10)}.csv`;
    link.click();
    URL.revokeObjectURL(link.href);
  };

  return (
    <section className="mx-auto max-w-7xl space-y-5">
      <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
        <article className="rounded-2xl border border-[#E8DCC8] bg-white p-4 shadow-sm"><p className="text-xs font-semibold uppercase tracking-wide text-[#646464]">Total orders</p><p className="mt-2 text-3xl font-bold text-[#2A1810]">{rows.length.toLocaleString()}</p></article>
        <article className="rounded-2xl border border-[#E8DCC8] bg-white p-4 shadow-sm"><p className="text-xs font-semibold uppercase tracking-wide text-[#646464]">Pending approval</p><p className="mt-2 text-3xl font-bold text-[#2A1810]">{pendingApprovalsCount.toLocaleString()}</p></article>
        <article className="rounded-2xl border border-[#E8DCC8] bg-white p-4 shadow-sm"><p className="text-xs font-semibold uppercase tracking-wide text-[#646464]">Orders completed</p><p className="mt-2 text-3xl font-bold text-[#2A1810]">{completedOrdersCount.toLocaleString()}</p></article>
        <article className="rounded-2xl border border-[#E8DCC8] bg-white p-4 shadow-sm"><p className="text-xs font-semibold uppercase tracking-wide text-[#646464]">Orders cancelled</p><p className="mt-2 text-3xl font-bold text-[#2A1810]">{cancelledOrdersCount.toLocaleString()}</p></article>
      </div>

      <div className="rounded-2xl border border-[#E8DCC8] bg-white p-5 shadow-sm">
        <div className="flex flex-wrap items-end justify-between gap-3">
          <div>
            <h1 className="font-melon text-2xl font-bold text-[#4A1D1F]">Orders List</h1>
            <p className="text-sm text-[#646464]">Production order feed with payment, lifecycle, and shipment visibility.</p>
          </div>
          <div className="flex gap-2">
            <button type="button" onClick={() => load()} disabled={!canFetch} className="rounded-full bg-[#2DA66D] px-4 py-2 text-xs font-semibold uppercase tracking-wide text-white hover:brightness-95 disabled:opacity-50">Refresh</button>
            <button type="button" onClick={() => void runBulkSync(filteredRows.map((row) => row.id))} disabled={bulkSyncBusy || filteredRows.length === 0} className="rounded-full bg-[#7B3010] px-4 py-2 text-xs font-semibold uppercase tracking-wide text-white hover:brightness-95 disabled:opacity-50">
              {bulkSyncBusy ? "Syncing..." : "Sync Orders to Shiprocket"}
            </button>
            <button type="button" onClick={exportCsv} className="inline-flex items-center gap-2 rounded-full border border-[#E8DCC8] bg-white px-4 py-2 text-xs font-semibold uppercase tracking-wide text-[#4A1D1F] hover:bg-[#FFFBF3]"><Download className="h-4 w-4" /> Export CSV</button>
          </div>
        </div>

        <div className="mt-4 grid gap-3 md:grid-cols-2 xl:grid-cols-4">
          <input type="text" placeholder="Search by order, customer, mobile..." value={searchTerm} onChange={(e) => setSearchTerm(e.target.value)} className="w-full rounded-full border border-[#E3E3DA] bg-[#FAFBF9] px-4 py-2.5 text-sm placeholder-[#8A8A8A] focus:border-[#7B3010] focus:outline-none" />
          <Select value={paymentFilter} onValueChange={setPaymentFilter}>
            <SelectTrigger className="h-auto w-full rounded-full border border-[#E3E3DA] bg-white px-4 py-2.5 text-sm text-[#4A1D1F] shadow-none focus:border-[#7B3010] focus:outline-none focus:ring-0 focus-visible:ring-0">
              <SelectValue placeholder="All payment statuses" />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="all">All payment statuses</SelectItem>
              <SelectItem value="success">Success</SelectItem>
              <SelectItem value="pending">Pending</SelectItem>
              <SelectItem value="initiated">Initiated</SelectItem>
              <SelectItem value="failed">Failed</SelectItem>
            </SelectContent>
          </Select>
          <Select value={orderFilter} onValueChange={setOrderFilter}>
            <SelectTrigger className="h-auto w-full rounded-full border border-[#E3E3DA] bg-white px-4 py-2.5 text-sm text-[#4A1D1F] shadow-none focus:border-[#7B3010] focus:outline-none focus:ring-0 focus-visible:ring-0">
              <SelectValue placeholder="All order statuses" />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="all">All order statuses</SelectItem>
              {Array.from(new Set(rows.map((o) => lifecycleStatus(o)))).map((status) => (
                <SelectItem key={status} value={status}>{status.replaceAll("_", " ")}</SelectItem>
              ))}
            </SelectContent>
          </Select>
          <Select value={shipmentFilter} onValueChange={setShipmentFilter}>
            <SelectTrigger className="h-auto w-full rounded-full border border-[#E3E3DA] bg-white px-4 py-2.5 text-sm text-[#4A1D1F] shadow-none focus:border-[#7B3010] focus:outline-none focus:ring-0 focus-visible:ring-0">
              <SelectValue placeholder="All shipment statuses" />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="all">All shipment statuses</SelectItem>
              {Array.from(new Set(rows.map((o) => latestShipmentStatus(o)))).map((status) => (
                <SelectItem key={status} value={status}>{status.replaceAll("_", " ")}</SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>
        <div className="mt-3 grid gap-3 md:grid-cols-2 xl:grid-cols-4">
          <input type="date" value={dateFrom} onChange={(e) => setDateFrom(e.target.value)} className="rounded-full border border-[#E3E3DA] bg-white px-4 py-2.5 text-sm text-[#4A1D1F] focus:border-[#7B3010] focus:outline-none" />
          <input type="date" value={dateTo} onChange={(e) => setDateTo(e.target.value)} className="rounded-full border border-[#E3E3DA] bg-white px-4 py-2.5 text-sm text-[#4A1D1F] focus:border-[#7B3010] focus:outline-none" />
          <Select value={sortBy} onValueChange={(v) => setSortBy(v as "latest" | "oldest" | "amount_desc" | "amount_asc")}>
            <SelectTrigger className="h-auto w-full rounded-full border border-[#E3E3DA] bg-white px-4 py-2.5 text-sm text-[#4A1D1F] shadow-none focus:border-[#7B3010] focus:outline-none focus:ring-0 focus-visible:ring-0">
              <SelectValue placeholder="Sort by" />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="latest">Latest first</SelectItem>
              <SelectItem value="oldest">Oldest first</SelectItem>
              <SelectItem value="amount_desc">Amount high to low</SelectItem>
              <SelectItem value="amount_asc">Amount low to high</SelectItem>
            </SelectContent>
          </Select>
          <Select value={String(pageSize)} onValueChange={(v) => setPageSize(Number(v))}>
            <SelectTrigger className="h-auto w-full rounded-full border border-[#E3E3DA] bg-white px-4 py-2.5 text-sm text-[#4A1D1F] shadow-none focus:border-[#7B3010] focus:outline-none focus:ring-0 focus-visible:ring-0">
              <SelectValue placeholder="Page size" />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="10">10 / page</SelectItem>
              <SelectItem value="20">20 / page</SelectItem>
              <SelectItem value="50">50 / page</SelectItem>
            </SelectContent>
          </Select>
        </div>

        <div className="mt-3 flex flex-wrap items-center gap-2">
          <button type="button" disabled={bulkSyncBusy || selectedIds.length === 0} onClick={() => void runBulkSync(selectedIds)} className="rounded-full bg-[#2DA66D] px-3 py-1.5 text-xs font-semibold uppercase text-white disabled:opacity-40">
            Sync Selected Orders
          </button>
          <button type="button" disabled={bulkSyncBusy || selectedIds.length === 0} onClick={() => void runBulkSync(selectedIds, true)} className="rounded-full bg-[#7B3010] px-3 py-1.5 text-xs font-semibold uppercase text-white disabled:opacity-40">
            Retry Failed Syncs
          </button>
          <span className="text-xs text-[#646464]">{selectedIds.length} selected • Paid {paidOrdersCount}</span>
        </div>
        {syncProgress && (
          <p className="mt-2 rounded-lg bg-[#FFFBF3] px-3 py-2 text-xs text-[#646464]">
            {syncProgress.total} Orders Processed • {syncProgress.synced} Synced • {syncProgress.failed} Failed • {syncProgress.skipped} Skipped
          </p>
        )}
      </div>

      {error && <p className="rounded-lg bg-red-50 px-3 py-2 text-sm text-red-800">{error}</p>}
      {loading && <p className="text-sm text-[#646464]">Loading…</p>}

      {!loading && (
        <div className="overflow-x-auto rounded-2xl border border-[#E8DCC8] bg-white shadow-sm">
          <table className="w-full min-w-[1500px] text-sm">
            <thead className="sticky top-0 z-10 bg-[#FFFBF3] text-[#4A1D1F]">
              <tr>
                <th className="px-3 py-3 text-left"><input type="checkbox" checked={pagedRows.length > 0 && pagedRows.every((r) => selectedIds.includes(r.id))} onChange={(e) => setSelectedIds(e.target.checked ? pagedRows.map((r) => r.id) : [])} /></th>
                <th className="px-3 py-3 text-left">Order ID</th>
                <th className="px-3 py-3 text-left">Date & Time</th>
                <th className="px-3 py-3 text-left">Customer</th>
                <th className="px-3 py-3 text-left">Payment Status</th>
                <th className="px-3 py-3 text-left">Order Status</th>
                <th className="px-3 py-3 text-left">Shipment Status</th>
                <th className="px-3 py-3 text-left">Total Amount</th>
                <th className="px-3 py-3 text-left">Items Count</th>
                <th className="px-3 py-3 text-left">Actions</th>
              </tr>
            </thead>
            <tbody>
              {pagedRows.length === 0 ? (
                <tr><td className="px-3 py-8 text-center text-[#646464]" colSpan={10}>{rows.length === 0 ? "No orders in the database yet." : "No orders match the selected filters."}</td></tr>
              ) : (
                pagedRows.map((o) => (
                  <tr key={o.id} className="border-t border-[#F0E9DC] hover:bg-[#FFFBF3]/50">
                    <td className="px-3 py-2"><input type="checkbox" checked={selectedIds.includes(o.id)} onChange={() => toggleSelect(o.id)} /></td>
                    <td className="px-3 py-2 font-mono text-[11px]">#{o.id.slice(0, 10).toUpperCase()}</td>
                    <td className="px-3 py-2 text-xs text-[#7A7A7A]">
                      <div>{new Date(o.createdAt).toLocaleDateString()}</div>
                      <div>{new Date(o.createdAt).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" })}</div>
                    </td>
                    <td className="px-3 py-2">
                      <p className="text-sm font-semibold text-[#2A1810]">{o.customerName ?? o.user?.name ?? "Guest Customer"}</p>
                      <p className="break-all text-xs text-[#6F6F6F]">{o.customerPhone ?? "No phone"}</p>
                      <p className="break-all text-xs text-[#6F6F6F]">{o.user?.email ?? "No email"}</p>
                    </td>
                    <td className="px-3 py-2"><span className="inline-flex rounded-full bg-slate-100 px-2 py-0.5 text-xs capitalize">{toPaymentStatus(o)}</span></td>
                    <td className="px-3 py-2">
                      {lifecycleStatus(o) === "admin_approval_pending" ? (
                        <span className="inline-flex items-center rounded-full border border-amber-300 bg-amber-50 px-2.5 py-0.5 text-xs font-semibold text-amber-800">
                          Approval Pending
                        </span>
                      ) : (
                        <span className="inline-flex rounded-full bg-slate-100 px-2 py-0.5 text-xs capitalize text-[#4A1D1F]">
                          {lifecycleStatus(o).replaceAll("_", " ")}
                        </span>
                      )}
                    </td>
                    <td className="px-3 py-2">
                      <span className="inline-flex rounded-full bg-indigo-50 px-2 py-0.5 text-xs capitalize text-indigo-700">{latestShipmentStatus(o).replaceAll("_", " ")}</span>
                      <p className="mt-1 text-[11px] text-[#646464]">{o.courierName ?? o.shipments?.[0]?.carrier ?? "Courier TBD"}</p>
                      <p className="text-[11px] text-[#646464]">AWB: {o.awbCode ?? o.shipments?.[0]?.trackingNo ?? "Pending"}</p>
                    </td>
                    <td className="px-3 py-2 font-semibold">Rs.{Number(o.total).toFixed(2)}</td>
                    <td className="px-3 py-2">{itemsCount(o)}</td>
                    <td className="px-3 py-2">
                      <div className="flex items-center gap-1.5">
                        {lifecycleStatus(o) === "admin_approval_pending" && (
                          <>
                            <button
                              type="button"
                              disabled={Boolean(rowActionBusy[o.id])}
                              onClick={() => void handleApprovalAction(o.id, "approve_order")}
                              className="rounded-full bg-[#2DA66D] px-2.5 py-1 text-xs font-semibold text-white shadow-sm hover:brightness-95 disabled:cursor-not-allowed disabled:opacity-50"
                            >
                              {rowActionBusy[o.id] === "approve_order" ? "Approving..." : "Approve"}
                            </button>
                            <button
                              type="button"
                              disabled={Boolean(rowActionBusy[o.id])}
                              onClick={() => void handleApprovalAction(o.id, "reject_order")}
                              className="rounded-full bg-[#A32A2A] px-2.5 py-1 text-xs font-semibold text-white shadow-sm hover:brightness-95 disabled:cursor-not-allowed disabled:opacity-50"
                            >
                              {rowActionBusy[o.id] === "reject_order" ? "Rejecting..." : "Reject"}
                            </button>
                          </>
                        )}
                        <details className="relative">
                          <summary className="cursor-pointer rounded-full border border-[#E8DCC8] px-2.5 py-1 text-xs font-semibold text-[#4A1D1F] hover:bg-[#FFFBF3]">
                            Actions
                          </summary>
                          <div className="absolute right-0 z-20 mt-2 min-w-[180px] rounded-lg border border-[#E8DCC8] bg-white p-2 shadow-md">
                            <button type="button" onClick={() => router.push(`/admin/orders/${o.id}`)} className="block w-full rounded px-2 py-1.5 text-left text-xs hover:bg-[#FFFBF3]">View Details</button>
                            {latestShipmentStatus(o) === "not_shipped" && lifecycleStatus(o) !== "admin_approval_pending" && (
                              <button type="button" onClick={() => void authedPost(`/api/v1/orders/${o.id}/shiprocket`, { action: "sync_order", generatePickup: true }).then(() => load())} className="block w-full rounded px-2 py-1.5 text-left text-xs hover:bg-[#FFFBF3]">
                                Sync to Shiprocket
                              </button>
                            )}
                            {latestShipmentStatus(o) !== "not_shipped" && (
                              <>
                                <button type="button" onClick={() => void authedPost(`/api/v1/orders/${o.id}/shiprocket`, { action: "resync_order", generatePickup: true }).then(() => load())} className="block w-full rounded px-2 py-1.5 text-left text-xs hover:bg-[#FFFBF3]">
                                  Re-sync
                                </button>
                                <button type="button" onClick={() => router.push(`/admin/orders/${o.id}`)} className="block w-full rounded px-2 py-1.5 text-left text-xs hover:bg-[#FFFBF3]">
                                  View Shipment
                                </button>
                                <button type="button" onClick={() => router.push(`/admin/orders/${o.id}`)} className="block w-full rounded px-2 py-1.5 text-left text-xs hover:bg-[#FFFBF3]">
                                  Track Order
                                </button>
                                <button type="button" onClick={() => void authedPost(`/api/v1/orders/${o.id}/shiprocket`, { action: "refresh_tracking" }).then(() => load())} className="block w-full rounded px-2 py-1.5 text-left text-xs hover:bg-[#FFFBF3]">
                                  Refresh Tracking
                                </button>
                              </>
                            )}
                          </div>
                        </details>
                      </div>
                      {rowActionError[o.id] && (
                        <p className="mt-1 text-[11px] text-red-600">{rowActionError[o.id]}</p>
                      )}
                    </td>
                  </tr>
                ))
              )}
            </tbody>
          </table>
        </div>
      )}

      <div className="flex items-center justify-between">
        <button type="button" onClick={() => setPage((prev) => Math.max(1, prev - 1))} disabled={page <= 1} className="rounded-full border border-[#E8DCC8] bg-white px-3 py-1.5 text-xs font-semibold text-[#4A1D1F] disabled:opacity-40">Previous</button>
        <p className="text-xs text-[#646464]">Page {page} / {pageCount}</p>
        <button type="button" onClick={() => setPage((prev) => Math.min(pageCount, prev + 1))} disabled={page >= pageCount} className="rounded-full border border-[#E8DCC8] bg-white px-3 py-1.5 text-xs font-semibold text-[#4A1D1F] disabled:opacity-40">Next</button>
      </div>
    </section>
  );
}
