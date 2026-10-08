"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import { authedFetch, authedPost } from "@/lib/dashboard-fetch";
import { useRealtimeTables } from "@/hooks/useRealtimeTables";
import { Download, Copy, Check, X, Eye, RefreshCw, Loader2, Search, ShoppingCart, Clock, XCircle } from "lucide-react";
import { toast } from "@/lib/toast";
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
  paymentId?: string | null;
  transactionId?: string | null;
  refNo?: string | null;
  total: string | number;
  createdAt: string;
  customerName?: string | null;
  customerPhone?: string | null;
  items: Array<{ quantity: number; product: { name: string; slug: string } }>;
  transactions?: Array<{ id?: string; status?: string; gateway?: string; paymentMethod?: string; transactionId?: string; refNo?: string }>;
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
  const [statusTab, setStatusTab] = useState<"all" | "new" | "confirmed" | "shipped" | "in_transit" | "delivered">("all");
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
  const [copiedTxId, setCopiedTxId] = useState<string | null>(null);

  const copyToClipboard = (text: string) => {
    if (!text) return;
    navigator.clipboard.writeText(text);
    setCopiedTxId(text);
    toast.success("Transaction No. copied!");
    setTimeout(() => setCopiedTxId(null), 2000);
  };

  const getPaymentMethodLabel = (method?: string | null) => {
    if (!method) return "Online Payment";
    const m = method.trim().toLowerCase();
    if (m === "cod") return "Cash on Delivery (COD)";
    if (m === "upi") return "UPI";
    if (m === "card" || m === "credit_card" || m === "debit_card") return "Card";
    if (m === "qr" || m === "qr_code") return "QR Code";
    if (m === "netbanking") return "Netbanking";
    if (m === "razorpay") return "Razorpay";
    if (m === "wallet") return "Wallet";
    return method.charAt(0).toUpperCase() + method.slice(1);
  };

  const getTransactionRefNo = (o: OrderRow) => {
    if (o.paymentId) return o.paymentId;
    if (o.transactionId) return o.transactionId;
    if (o.refNo) return o.refNo;
    const tx = o.transactions?.[0];
    if (tx) {
      if (tx.transactionId) return tx.transactionId;
      if (tx.refNo) return tx.refNo;
      if (tx.id) return tx.id;
    }
    return o.id;
  };

  const getOrderStatusBadge = (status: string) => {
    const s = status.toLowerCase().trim();

    if (s === "cancelled" || s === "rejected" || s === "failed") {
      return (
        <span className="inline-flex items-center gap-1.5 rounded-full border border-red-200 bg-red-50 px-2.5 py-0.5 text-xs font-semibold text-red-700 capitalize">
          <span className="h-1.5 w-1.5 rounded-full bg-red-500" />
          {s.replaceAll("_", " ")}
        </span>
      );
    }

    if (s === "delivered" || s === "completed") {
      return (
        <span className="inline-flex items-center gap-1.5 rounded-full border border-emerald-200 bg-emerald-50 px-2.5 py-0.5 text-xs font-semibold text-emerald-700 capitalize">
          <span className="h-1.5 w-1.5 rounded-full bg-emerald-500" />
          {s.replaceAll("_", " ")}
        </span>
      );
    }

    if (s === "shipped") {
      return (
        <span className="inline-flex items-center gap-1.5 rounded-full border border-blue-200 bg-blue-50 px-2.5 py-0.5 text-xs font-semibold text-blue-700 capitalize">
          <span className="h-1.5 w-1.5 rounded-full bg-blue-500" />
          Shipped
        </span>
      );
    }

    if (s === "in_transit" || s === "out_for_delivery" || s === "dispatched") {
      return (
        <span className="inline-flex items-center gap-1.5 rounded-full border border-indigo-200 bg-indigo-50 px-2.5 py-0.5 text-xs font-semibold text-indigo-700 capitalize">
          <span className="h-1.5 w-1.5 rounded-full bg-indigo-500" />
          {s.replaceAll("_", " ")}
        </span>
      );
    }

    if (s === "confirmed" || s === "packed" || s === "processing") {
      return (
        <span className="inline-flex items-center gap-1.5 rounded-full border border-cyan-200 bg-cyan-50 px-2.5 py-0.5 text-xs font-semibold text-cyan-700 capitalize">
          <span className="h-1.5 w-1.5 rounded-full bg-cyan-500" />
          {s.replaceAll("_", " ")}
        </span>
      );
    }

    if (s === "admin_approval_pending" || s === "approval_pending") {
      return (
        <span className="inline-flex items-center gap-1.5 rounded-full border border-amber-300 bg-amber-50 px-2.5 py-0.5 text-xs font-semibold text-amber-800">
          <span className="h-1.5 w-1.5 rounded-full bg-amber-500" />
          Pending
        </span>
      );
    }

    if (s === "new" || s === "pending" || s === "pending_payment" || s === "payment_success") {
      return (
        <span className="inline-flex items-center gap-1.5 rounded-full border border-sky-200 bg-sky-50 px-2.5 py-0.5 text-xs font-semibold text-sky-700 capitalize">
          <span className="h-1.5 w-1.5 rounded-full bg-sky-500" />
          {s === "new" ? "New Order" : s.replaceAll("_", " ")}
        </span>
      );
    }

    return (
      <span className="inline-flex items-center gap-1.5 rounded-full border border-slate-200 bg-slate-100 px-2.5 py-0.5 text-xs font-semibold text-slate-700 capitalize">
        <span className="h-1.5 w-1.5 rounded-full bg-slate-400" />
        {s.replaceAll("_", " ")}
      </span>
    );
  };

  const getShipmentStatusBadge = (status: string) => {
    const s = status.toLowerCase().trim();

    if (s === "delivered") {
      return (
        <span className="inline-flex items-center gap-1 rounded-full border border-emerald-200 bg-emerald-50 px-2 py-0.5 text-xs font-semibold capitalize text-emerald-700">
          <span className="h-1.5 w-1.5 rounded-full bg-emerald-500" />
          Delivered
        </span>
      );
    }

    if (s === "shipped") {
      return (
        <span className="inline-flex items-center gap-1 rounded-full border border-blue-200 bg-blue-50 px-2 py-0.5 text-xs font-semibold capitalize text-blue-700">
          <span className="h-1.5 w-1.5 rounded-full bg-blue-500" />
          Shipped
        </span>
      );
    }

    if (s === "in_transit" || s === "out_for_delivery") {
      return (
        <span className="inline-flex items-center gap-1 rounded-full border border-indigo-200 bg-indigo-50 px-2 py-0.5 text-xs font-semibold capitalize text-indigo-700">
          <span className="h-1.5 w-1.5 rounded-full bg-indigo-500" />
          {s.replaceAll("_", " ")}
        </span>
      );
    }

    if (s === "cancelled" || s === "returned" || s === "rto") {
      return (
        <span className="inline-flex items-center gap-1 rounded-full border border-rose-200 bg-rose-50 px-2 py-0.5 text-xs font-semibold capitalize text-rose-700">
          <span className="h-1.5 w-1.5 rounded-full bg-rose-500" />
          {s.replaceAll("_", " ")}
        </span>
      );
    }

    return (
      <span className="inline-flex items-center gap-1 rounded-full border border-slate-200 bg-slate-100 px-2 py-0.5 text-xs font-medium capitalize text-slate-700">
        {s.replaceAll("_", " ")}
      </span>
    );
  };

  const toPaymentStatus = useCallback((o: OrderRow) => {
    if (o.transactions?.some((t) => /paid|captured|success/i.test(t.status ?? "")) || (o.paymentStatus ?? "").toUpperCase() === "SUCCESS") return "success";
    if (o.transactions?.some((t) => /fail/i.test(t.status ?? "")) || (o.paymentStatus ?? "").toUpperCase() === "FAILED") return "failed";
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

  const statusTabCounts = useMemo(() => {
    const counts = {
      all: rows.length,
      new: 0,
      confirmed: 0,
      shipped: 0,
      in_transit: 0,
      delivered: 0,
    };
    rows.forEach((o) => {
      const lc = lifecycleStatus(o);
      const sh = latestShipmentStatus(o);
      if (["pending", "pending_payment", "payment_success", "admin_approval_pending", "new"].includes(lc)) {
        counts.new++;
      }
      if (["confirmed", "packed"].includes(lc)) {
        counts.confirmed++;
      }
      if (lc === "shipped" || sh === "shipped") {
        counts.shipped++;
      }
      if (lc === "in_transit" || ["in_transit", "out_for_delivery"].includes(sh)) {
        counts.in_transit++;
      }
      if (lc === "delivered" || sh === "delivered" || Boolean(o.fulfillment?.deliveredAt)) {
        counts.delivered++;
      }
    });
    return counts;
  }, [rows, lifecycleStatus, latestShipmentStatus]);

  const filteredRows = useMemo(() => {
    const term = searchTerm.trim().toLowerCase();
    let list = rows.filter((o) => {
      const payment = toPaymentStatus(o);
      const lifecycle = lifecycleStatus(o);
      const ship = latestShipmentStatus(o);
      const date = new Date(o.createdAt);

      // Status Tab filter
      if (statusTab !== "all") {
        if (statusTab === "new" && !["pending", "pending_payment", "payment_success", "admin_approval_pending", "new"].includes(lifecycle)) return false;
        if (statusTab === "confirmed" && !["confirmed", "packed"].includes(lifecycle)) return false;
        if (statusTab === "shipped" && lifecycle !== "shipped" && ship !== "shipped") return false;
        if (statusTab === "in_transit" && lifecycle !== "in_transit" && !["in_transit", "out_for_delivery"].includes(ship)) return false;
        if (statusTab === "delivered" && lifecycle !== "delivered" && ship !== "delivered" && !o.fulfillment?.deliveredAt) return false;
      }

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
  }, [rows, searchTerm, statusTab, paymentFilter, orderFilter, shipmentFilter, dateFrom, dateTo, sortBy, toPaymentStatus, lifecycleStatus, latestShipmentStatus]);

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
    <section className="w-full space-y-5">
      <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
        {/* Card 1: Total Orders */}
        <article className="flex items-center gap-3.5 rounded-2xl border border-[#E8DCC8] bg-white p-4 shadow-sm">
          <div className="flex h-12 w-12 shrink-0 items-center justify-center rounded-2xl bg-[#FFF0F2]">
            <ShoppingCart className="h-5 w-5 text-[#C84B5F]" />
          </div>
          <div>
            <p className="text-[10px] font-bold uppercase tracking-wider text-[#7A7A7A]">TOTAL ORDERS</p>
            <p className="mt-0.5 text-2xl font-bold text-[#2A1810]">{rows.length.toLocaleString()}</p>
          </div>
        </article>

        {/* Card 2: Pending Approval */}
        <article className="flex items-center gap-3.5 rounded-2xl border border-[#E8DCC8] bg-white p-4 shadow-sm">
          <div className="flex h-12 w-12 shrink-0 items-center justify-center rounded-2xl bg-[#FFF8E7]">
            <Clock className="h-5 w-5 text-[#B87D1E]" />
          </div>
          <div>
            <p className="text-[10px] font-bold uppercase tracking-wider text-[#7A7A7A]">PENDING APPROVAL</p>
            <p className="mt-0.5 text-2xl font-bold text-[#2A1810]">{pendingApprovalsCount.toLocaleString()}</p>
          </div>
        </article>

        {/* Card 3: Orders Completed */}
        <article className="flex items-center gap-3.5 rounded-2xl border border-[#E8DCC8] bg-white p-4 shadow-sm">
          <div className="flex h-12 w-12 shrink-0 items-center justify-center rounded-2xl bg-[#E8F8F0]">
            <Check className="h-5 w-5 text-[#2DA66D]" />
          </div>
          <div>
            <p className="text-[10px] font-bold uppercase tracking-wider text-[#7A7A7A]">ORDERS COMPLETED</p>
            <p className="mt-0.5 text-2xl font-bold text-[#2A1810]">{completedOrdersCount.toLocaleString()}</p>
          </div>
        </article>

        {/* Card 4: Orders Cancelled */}
        <article className="flex items-center gap-3.5 rounded-2xl border border-[#E8DCC8] bg-white p-4 shadow-sm">
          <div className="flex h-12 w-12 shrink-0 items-center justify-center rounded-2xl bg-[#FDE8E8]">
            <XCircle className="h-5 w-5 text-[#A32A2A]" />
          </div>
          <div>
            <p className="text-[10px] font-bold uppercase tracking-wider text-[#7A7A7A]">ORDERS CANCELLED</p>
            <p className="mt-0.5 text-2xl font-bold text-[#2A1810]">{cancelledOrdersCount.toLocaleString()}</p>
          </div>
        </article>
      </div>

      <div className="rounded-2xl border border-[#E8DCC8] bg-white p-5 shadow-sm">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div>
            <h1 className="font-melon text-2xl font-bold text-[#4A1D1F]">Orders List</h1>
            <p className="text-sm text-[#646464]">Production order feed with payment, lifecycle, and shipment visibility.</p>
          </div>
          <div className="flex flex-wrap items-center gap-2">
            <button type="button" onClick={() => load()} disabled={!canFetch} className="rounded-full bg-[#2DA66D] px-5 py-2 text-xs font-bold uppercase tracking-wider text-white hover:brightness-95 disabled:opacity-50">REFRESH</button>
            <button type="button" onClick={() => void runBulkSync(filteredRows.map((row) => row.id))} disabled={bulkSyncBusy || filteredRows.length === 0} className="rounded-full bg-[#7B3010] px-5 py-2 text-xs font-bold uppercase tracking-wider text-white hover:brightness-95 disabled:opacity-50">
              {bulkSyncBusy ? "SYNCING..." : "SYNC ORDERS TO SHIPROCKET"}
            </button>
            <button type="button" onClick={exportCsv} className="inline-flex items-center gap-1.5 rounded-full border border-[#E8DCC8] bg-white px-4 py-2 text-xs font-bold uppercase tracking-wider text-[#7B3010] hover:bg-[#FFFBF3]">
              <Download className="h-4 w-4" /> EXPORT CSV
            </button>
          </div>
        </div>

        {/* Status Filter Tabs */}
        <div className="mt-4 flex flex-wrap items-center gap-2 border-b border-[#E8DCC8] pb-3">
          {[
            { id: "all" as const, label: "All Orders", count: statusTabCounts.all },
            { id: "new" as const, label: "New Orders", count: statusTabCounts.new },
            { id: "confirmed" as const, label: "Confirmed", count: statusTabCounts.confirmed },
            { id: "shipped" as const, label: "Shipped", count: statusTabCounts.shipped },
            { id: "in_transit" as const, label: "In Transit", count: statusTabCounts.in_transit },
            { id: "delivered" as const, label: "Delivered", count: statusTabCounts.delivered },
          ].map((tab) => {
            const active = statusTab === tab.id;
            return (
              <button
                key={tab.id}
                type="button"
                onClick={() => {
                  setStatusTab(tab.id);
                  setPage(1);
                }}
                className={`inline-flex items-center gap-2 rounded-xl px-3.5 py-2 text-xs font-semibold transition ${
                  active
                    ? "bg-[#7B3010] text-white shadow-sm"
                    : "border border-[#E8DCC8] bg-white text-[#4A1D1F] hover:bg-[#FFFBF3]"
                }`}
              >
                <span>{tab.label}</span>
                <span
                  className={`rounded-full px-2 py-0.5 text-[10px] font-bold ${
                    active
                      ? "bg-white/20 text-white"
                      : "bg-[#FFF7EA] text-[#7B3010]"
                  }`}
                >
                  {tab.count}
                </span>
              </button>
            );
          })}
        </div>

        {/* 8-Column Horizontal Filter Grid with Labels Above */}
        <div className="mt-4 grid grid-cols-1 gap-3 sm:grid-cols-2 md:grid-cols-4 xl:grid-cols-8 items-end">
          <div>
            <label className="text-xs font-semibold text-[#646464]">Search</label>
            <div className="relative mt-1">
              <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-3.5 w-3.5 text-[#8A8A8A]" />
              <input
                type="text"
                placeholder="Search by order, customer, mobile..."
                value={searchTerm}
                onChange={(e) => setSearchTerm(e.target.value)}
                className="!h-9 !py-0 box-border w-full rounded-2xl border border-[#E3E3DA] bg-white pl-8 pr-3 text-xs text-[#4A1D1F] placeholder-[#8A8A8A] focus:border-[#7B3010] focus:outline-none"
              />
            </div>
          </div>

          <div>
            <label className="text-xs font-semibold text-[#646464]">Payment Status</label>
            <div className="mt-1">
              <Select value={paymentFilter} onValueChange={setPaymentFilter}>
                <SelectTrigger className="!h-9 !py-0 box-border w-full rounded-2xl border border-[#E3E3DA] bg-white px-3 text-xs text-[#4A1D1F] shadow-none focus:border-[#7B3010] focus:outline-none focus:ring-0 focus-visible:ring-0">
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
            </div>
          </div>

          <div>
            <label className="text-xs font-semibold text-[#646464]">Order Status</label>
            <div className="mt-1">
              <Select value={orderFilter} onValueChange={setOrderFilter}>
                <SelectTrigger className="!h-9 !py-0 box-border w-full rounded-2xl border border-[#E3E3DA] bg-white px-3 text-xs text-[#4A1D1F] shadow-none focus:border-[#7B3010] focus:outline-none focus:ring-0 focus-visible:ring-0">
                  <SelectValue placeholder="All order statuses" />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="all">All order statuses</SelectItem>
                  {Array.from(new Set(rows.map((o) => lifecycleStatus(o)))).map((status) => (
                    <SelectItem key={status} value={status}>{status === "admin_approval_pending" || status === "approval_pending" ? "Pending" : status.replaceAll("_", " ")}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
          </div>

          <div>
            <label className="text-xs font-semibold text-[#646464]">Shipment Status</label>
            <div className="mt-1">
              <Select value={shipmentFilter} onValueChange={setShipmentFilter}>
                <SelectTrigger className="!h-9 !py-0 box-border w-full rounded-2xl border border-[#E3E3DA] bg-white px-3 text-xs text-[#4A1D1F] shadow-none focus:border-[#7B3010] focus:outline-none focus:ring-0 focus-visible:ring-0">
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
          </div>

          <div>
            <label className="text-xs font-semibold text-[#646464]">Date From</label>
            <input
              type="date"
              value={dateFrom}
              onChange={(e) => setDateFrom(e.target.value)}
              className="mt-1 !h-9 !py-0 leading-[36px] box-border w-full rounded-2xl border border-[#E3E3DA] bg-white px-3 text-xs text-[#4A1D1F] focus:border-[#7B3010] focus:outline-none [&::-webkit-date-and-time-value]:min-h-0 [&::-webkit-date-and-time-value]:m-0"
            />
          </div>

          <div>
            <label className="text-xs font-semibold text-[#646464]">Date To</label>
            <input
              type="date"
              value={dateTo}
              onChange={(e) => setDateTo(e.target.value)}
              className="mt-1 !h-9 !py-0 leading-[36px] box-border w-full rounded-2xl border border-[#E3E3DA] bg-white px-3 text-xs text-[#4A1D1F] focus:border-[#7B3010] focus:outline-none [&::-webkit-date-and-time-value]:min-h-0 [&::-webkit-date-and-time-value]:m-0"
            />
          </div>

          <div>
            <label className="text-xs font-semibold text-[#646464]">Sort By</label>
            <div className="mt-1">
              <Select value={sortBy} onValueChange={(v) => setSortBy(v as "latest" | "oldest" | "amount_desc" | "amount_asc")}>
                <SelectTrigger className="!h-9 !py-0 box-border w-full rounded-2xl border border-[#E3E3DA] bg-white px-3 text-xs text-[#4A1D1F] shadow-none focus:border-[#7B3010] focus:outline-none focus:ring-0 focus-visible:ring-0">
                  <SelectValue placeholder="Sort by" />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="latest">Latest first</SelectItem>
                  <SelectItem value="oldest">Oldest first</SelectItem>
                  <SelectItem value="amount_desc">Amount high to low</SelectItem>
                  <SelectItem value="amount_asc">Amount low to high</SelectItem>
                </SelectContent>
              </Select>
            </div>
          </div>

          <div>
            <label className="text-xs font-semibold text-[#646464]">Per Page</label>
            <div className="mt-1">
              <Select value={String(pageSize)} onValueChange={(v) => setPageSize(Number(v))}>
                <SelectTrigger className="!h-9 !py-0 box-border w-full rounded-2xl border border-[#E3E3DA] bg-white px-3 text-xs text-[#4A1D1F] shadow-none focus:border-[#7B3010] focus:outline-none focus:ring-0 focus-visible:ring-0">
                  <SelectValue placeholder="Page size" />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="10">10 / page</SelectItem>
                  <SelectItem value="20">20 / page</SelectItem>
                  <SelectItem value="50">50 / page</SelectItem>
                </SelectContent>
              </Select>
            </div>
          </div>
        </div>

        {/* Bottom Actions Row */}
        <div className="mt-4 flex flex-wrap items-center gap-3">
          <input
            type="checkbox"
            checked={pagedRows.length > 0 && pagedRows.every((r) => selectedIds.includes(r.id))}
            onChange={(e) => setSelectedIds(e.target.checked ? pagedRows.map((r) => r.id) : [])}
            className="h-4 w-4 rounded border-[#D9D9D1] text-[#7B3010] focus:ring-[#7B3010]"
          />
          <button
            type="button"
            disabled={bulkSyncBusy || selectedIds.length === 0}
            onClick={() => void runBulkSync(selectedIds)}
            className="rounded-full bg-[#82C3A6] px-5 py-2 text-xs font-bold uppercase tracking-wider text-white hover:brightness-95 disabled:opacity-40 transition"
          >
            SYNC SELECTED ORDERS
          </button>
          <button
            type="button"
            disabled={bulkSyncBusy || selectedIds.length === 0}
            onClick={() => void runBulkSync(selectedIds, true)}
            className="rounded-full bg-[#C79386] px-5 py-2 text-xs font-bold uppercase tracking-wider text-white hover:brightness-95 disabled:opacity-40 transition"
          >
            RETRY FAILED SYNCS
          </button>
          <span className="text-xs font-medium text-[#646464]">{selectedIds.length} selected • Paid {paidOrdersCount}</span>
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
          <table className="w-full text-sm">
            <thead className="sticky top-0 z-10 bg-[#FFFBF3] text-[#4A1D1F] text-[10px] font-semibold uppercase tracking-wider border-b border-[#E8DCC8]">
              <tr>
                <th className="w-8 px-2 py-2.5 text-center"><input type="checkbox" checked={pagedRows.length > 0 && pagedRows.every((r) => selectedIds.includes(r.id))} onChange={(e) => setSelectedIds(e.target.checked ? pagedRows.map((r) => r.id) : [])} /></th>
                <th className="w-28 px-2 py-2.5 text-left whitespace-nowrap">Order ID</th>
                <th className="w-28 px-2 py-2.5 text-left whitespace-nowrap">Date & Time</th>
                <th className="w-48 px-2 py-2.5 text-left">Customer</th>
                <th className="w-44 px-2 py-2.5 text-left">Payment</th>
                <th className="w-36 px-2 py-2.5 text-left whitespace-nowrap">Order Status</th>
                <th className="w-40 px-2 py-2.5 text-left whitespace-nowrap">Shipment Status</th>
                <th className="w-28 px-2 py-2.5 text-left whitespace-nowrap">Total Amount</th>
                <th className="w-20 px-2 py-2.5 text-center whitespace-nowrap">Items Count</th>
                <th className="w-28 px-3 py-2.5 text-right whitespace-nowrap">Actions</th>
              </tr>
            </thead>
            <tbody>
              {pagedRows.length === 0 ? (
                <tr><td className="px-3 py-8 text-center text-[#646464]" colSpan={10}>{rows.length === 0 ? "No orders in the database yet." : "No orders match the selected filters."}</td></tr>
              ) : (
                pagedRows.map((o) => (
                  <tr key={o.id} className="border-t border-[#F0E9DC] hover:bg-[#FFFBF3]/50">
                    <td className="px-2 py-2"><input type="checkbox" checked={selectedIds.includes(o.id)} onChange={() => toggleSelect(o.id)} /></td>
                    <td className="px-2 py-2 font-mono text-[11px]">#{o.id.slice(0, 10).toUpperCase()}</td>
                    <td className="px-2 py-2 text-xs text-[#7A7A7A]">
                      <div>{new Date(o.createdAt).toLocaleDateString()}</div>
                      <div>{new Date(o.createdAt).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" })}</div>
                    </td>
                    <td className="px-2 py-2">
                      <p className="text-sm font-semibold text-[#2A1810]">{o.customerName ?? o.user?.name ?? "Guest Customer"}</p>
                      <p className="break-all text-xs text-[#6F6F6F]">{o.customerPhone ?? "No phone"}</p>
                      <p className="break-all text-xs text-[#6F6F6F]">{o.user?.email ?? "No email"}</p>
                    </td>
                    <td className="px-2 py-2">
                      <div className="space-y-1.5">
                        <div>
                          {toPaymentStatus(o) === "success" ? (
                            <span className="inline-flex items-center gap-1.5 rounded-full border border-emerald-200 bg-emerald-50 px-2.5 py-0.5 text-xs font-semibold text-emerald-800">
                              <span className="h-1.5 w-1.5 rounded-full bg-emerald-500" />
                              Success
                            </span>
                          ) : toPaymentStatus(o) === "initiated" ? (
                            <span className="inline-flex items-center gap-1.5 rounded-full border border-blue-200 bg-blue-50 px-2.5 py-0.5 text-xs font-semibold text-blue-800">
                              <span className="h-1.5 w-1.5 rounded-full bg-blue-500" />
                              Initiated
                            </span>
                          ) : toPaymentStatus(o) === "failed" ? (
                            <span className="inline-flex items-center gap-1.5 rounded-full border border-red-200 bg-red-50 px-2.5 py-0.5 text-xs font-semibold text-red-800">
                              <span className="h-1.5 w-1.5 rounded-full bg-red-500" />
                              Failed
                            </span>
                          ) : (
                            <span className="inline-flex items-center gap-1.5 rounded-full border border-amber-200 bg-amber-50 px-2.5 py-0.5 text-xs font-semibold text-amber-800">
                              <span className="h-1.5 w-1.5 rounded-full bg-amber-500" />
                              Pending
                            </span>
                          )}
                        </div>
                        <div className="text-xs font-semibold text-[#2A1810]">
                          {getPaymentMethodLabel(o.paymentMethod)}
                        </div>
                        {(() => {
                          const refNo = getTransactionRefNo(o);
                          const isCopied = copiedTxId === refNo;
                          return (
                            <div className="flex items-center gap-1 text-[11px] font-mono text-[#646464]">
                              <span className="truncate max-w-[130px]" title={refNo}>
                                Ref: {refNo}
                              </span>
                              <button
                                type="button"
                                onClick={() => copyToClipboard(refNo)}
                                title="Copy Transaction / Ref No."
                                className="inline-flex shrink-0 items-center justify-center rounded p-1 text-[#7B3010] hover:bg-[#FFF7EA] hover:text-[#4A1D1F] transition cursor-pointer"
                              >
                                {isCopied ? (
                                  <Check className="h-3.5 w-3.5 text-emerald-600" />
                                ) : (
                                  <Copy className="h-3.5 w-3.5" />
                                )}
                              </button>
                            </div>
                          );
                        })()}
                      </div>
                    </td>
                    <td className="px-2 py-2">
                      {getOrderStatusBadge(lifecycleStatus(o))}
                    </td>
                    <td className="px-2 py-2">
                      {getShipmentStatusBadge(latestShipmentStatus(o))}
                      <p className="mt-1 text-[11px] text-[#646464]">{o.courierName ?? o.shipments?.[0]?.carrier ?? "Courier TBD"}</p>
                      <p className="text-[11px] text-[#646464]">AWB: {o.awbCode ?? o.shipments?.[0]?.trackingNo ?? "Pending"}</p>
                    </td>
                    <td className="px-2 py-2 font-semibold">Rs.{Number(o.total).toFixed(2)}</td>
                    <td className="px-2 py-2 text-center font-medium">{itemsCount(o)}</td>
                    <td className="px-3 py-2 text-right">
                      <div className="flex items-center justify-end gap-1.5">
                        {lifecycleStatus(o) === "admin_approval_pending" && (
                          <>
                            <button
                              type="button"
                              disabled={Boolean(rowActionBusy[o.id])}
                              onClick={() => void handleApprovalAction(o.id, "approve_order")}
                              title="Accept Order"
                              className="inline-flex items-center justify-center rounded-full bg-[#2DA66D] p-1.5 text-white shadow-sm hover:brightness-95 disabled:cursor-not-allowed disabled:opacity-50 transition cursor-pointer"
                            >
                              {rowActionBusy[o.id] === "approve_order" ? (
                                <Loader2 className="h-3.5 w-3.5 animate-spin" />
                              ) : (
                                <Check className="h-3.5 w-3.5" />
                              )}
                            </button>
                            <button
                              type="button"
                              disabled={Boolean(rowActionBusy[o.id])}
                              onClick={() => void handleApprovalAction(o.id, "reject_order")}
                              title="Reject Order"
                              className="inline-flex items-center justify-center rounded-full bg-[#A32A2A] p-1.5 text-white shadow-sm hover:brightness-95 disabled:cursor-not-allowed disabled:opacity-50 transition cursor-pointer"
                            >
                              {rowActionBusy[o.id] === "reject_order" ? (
                                <Loader2 className="h-3.5 w-3.5 animate-spin" />
                              ) : (
                                <X className="h-3.5 w-3.5" />
                              )}
                            </button>
                          </>
                        )}
                        <button
                          type="button"
                          onClick={() => router.push(`/admin/orders/${o.id}`)}
                          title="View Order Details"
                          className="inline-flex items-center justify-center rounded-full border border-[#7B3010] bg-[#FFF7EA] p-1.5 text-[#7B3010] shadow-sm hover:bg-[#7B3010] hover:text-white transition cursor-pointer"
                        >
                          <Eye className="h-3.5 w-3.5" />
                        </button>
                      </div>
                      {rowActionError[o.id] && (
                        <p className="mt-1 text-[10px] text-red-600">{rowActionError[o.id]}</p>
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
