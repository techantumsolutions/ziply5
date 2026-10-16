"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import { authedFetch, authedPost } from "@/lib/dashboard-fetch";
import { useRealtimeTables } from "@/hooks/useRealtimeTables";
import { Download, Copy, Check, X, Eye, RefreshCw, Loader2, Search } from "lucide-react";
import { toast } from "@/lib/toast";
import { formatIstSqlDateTime, formatOrderDate, formatOrderTime, toUtcIso } from "@/src/lib/datetime";
import { isConfirmedPickupRequest } from "@/src/server/modules/shipping/shiprocket-status";
import { assessPackageMeasures, awbQuoteWarning } from "@/src/server/modules/shipping/package-measures";
import { isManualShipment, MANUAL_ORDER_STATUSES, orderStatusLabel } from "@/src/lib/orders/manual-order-status";
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
  shipments?: Array<{ id: string; carrier: string | null; trackingNo: string | null; shipmentStatus: string; shipmentNo?: string | null; shippedAt?: string | null }>;
  courierName?: string | null;
  awbCode?: string | null;
  trackingNumber?: string | null;
  trackingUrl?: string | null;
  labelUrl?: string | null;
  shipmentId?: string | null;
  shipmentStatus?: string | null;
  shipmentNo?: string | null;
  shippingMethod?: string | null;
  pickupStatus?: string | null;
  isShipmentCreated?: boolean | null;
  isLabelGenerated?: boolean | null;
  isPickupGenerated?: boolean | null;
  fulfillment?: { fulfillmentStatus: string; deliveredAt?: string | null; shippedAt?: string | null } | null;
  statusHistory?: Array<{ toStatus: string; reasonCode?: string | null; notes?: string | null; changedAt: string }>;
  user?: { id: string; name: string; email: string };
};

const ADMIN_ORDER_STATUS_OPTIONS = [
  "pending",
  "confirmed",
  "packed",
  "shipped",
  "in_transit",
  "out_for_delivery",
  "delivered",
  "cancelled",
  "returned",
] as const;

const ADMIN_SHIPMENT_STATUS_OPTIONS = [
  "not_shipped",
  "shipped",
  "in_transit",
  "out_for_delivery",
  "delivered",
  "cancelled",
  "returned",
] as const;

export default function AdminOrdersPage() {
  const router = useRouter();
  const [rows, setRows] = useState<OrderRow[]>([]);
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(true);
  const [canFetch, setCanFetch] = useState(false);
  const [searchTerm, setSearchTerm] = useState("");
  const [statusTab, setStatusTab] = useState<"all" | "new" | "confirmed" | "shipped" | "in_transit" | "delivered" | "rejected" | "cancelled">("all");
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
  const [rejectModalOrderId, setRejectModalOrderId] = useState<string | null>(null);
  const [rejectReason, setRejectReason] = useState("");
  const [serviceableIds, setServiceableIds] = useState<Record<string, true>>({});
  const [unserviceableIds, setUnserviceableIds] = useState<Record<string, true>>({});
  const [manualModal, setManualModal] = useState<{ orderId: string; courier: string; trackingId: string; trackingUrl: string } | null>(null);
  const [courierModal, setCourierModal] = useState<{
    orderId: string;
    packageWeightKg: number | null;
    lengthCm: number | null;
    widthCm: number | null;
    heightCm: number | null;
    couriers: Array<{
      name: string;
      rate: number;
      eta_days: number;
      etd?: string;
      courier_company_id?: number;
      cod_available?: boolean;
      charge_weight_kg?: number;
      min_weight_kg?: number;
    }>;
    selectedId: number | null;
    confirmed: boolean;
  } | null>(null);
  const [packageConfirmed, setPackageConfirmed] = useState(false);
  const [unserviceable, setUnserviceable] = useState<{ orderId: string; reason: string } | null>(null);
  const [packageModal, setPackageModal] = useState<{ orderId: string; weightKg: string; lengthCm: string; widthCm: string; heightCm: string } | null>(null);

  const resetFilters = useCallback(() => {
    setSearchTerm("");
    setStatusTab("all");
    setPaymentFilter("all");
    setOrderFilter("all");
    setShipmentFilter("all");
    setDateFrom("");
    setDateTo("");
    setSortBy("latest");
    setPage(1);
  }, []);

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

    if (s === "confirmed") {
      return (
        <span className="inline-flex items-center gap-1.5 rounded-full border border-cyan-200 bg-cyan-50 px-2.5 py-0.5 text-xs font-semibold text-cyan-700">
          <span className="h-1.5 w-1.5 rounded-full bg-cyan-500" />
          Accepted
        </span>
      );
    }

    if (s === "packed" || s === "processing") {
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

  const getOrderStatusSelectClass = (status: string) => {
    const s = status.toLowerCase().trim();
    if (s === "cancelled" || s === "rejected" || s === "failed") {
      return "border-red-300 bg-red-50 text-red-700 hover:border-red-400 focus:ring-red-400";
    }
    if (s === "delivered" || s === "completed") {
      return "border-emerald-300 bg-emerald-50 text-emerald-700 hover:border-emerald-400 focus:ring-emerald-400";
    }
    if (s === "shipped") {
      return "border-blue-300 bg-blue-50 text-blue-700 hover:border-blue-400 focus:ring-blue-400";
    }
    if (s === "in_transit" || s === "out_for_delivery" || s === "dispatched") {
      return "border-indigo-300 bg-indigo-50 text-indigo-700 hover:border-indigo-400 focus:ring-indigo-400";
    }
    if (s === "confirmed" || s === "packed" || s === "processing") {
      return "border-cyan-300 bg-cyan-50 text-cyan-700 hover:border-cyan-400 focus:ring-cyan-400";
    }
    if (s === "admin_approval_pending" || s === "approval_pending") {
      return "border-amber-300 bg-amber-50 text-amber-800 hover:border-amber-400 focus:ring-amber-400";
    }
    if (s === "new" || s === "pending" || s === "pending_payment" || s === "payment_success") {
      return "border-sky-300 bg-sky-50 text-sky-700 hover:border-sky-400 focus:ring-sky-400";
    }
    return "border-slate-300 bg-slate-50 text-slate-700 hover:border-slate-400 focus:ring-slate-400";
  };

  const getShipmentStatusSelectClass = (status: string) => {
    const s = status.toLowerCase().trim();
    if (s === "delivered") {
      return "border-emerald-300 bg-emerald-50 text-emerald-700 hover:border-emerald-400 focus:ring-emerald-400";
    }
    if (s === "shipped") {
      return "border-blue-300 bg-blue-50 text-blue-700 hover:border-blue-400 focus:ring-blue-400";
    }
    if (s === "in_transit" || s === "out_for_delivery") {
      return "border-indigo-300 bg-indigo-50 text-indigo-700 hover:border-indigo-400 focus:ring-indigo-400";
    }
    if (s === "cancelled" || s === "returned" || s === "rto") {
      return "border-rose-300 bg-rose-50 text-rose-700 hover:border-rose-400 focus:ring-rose-400";
    }
    if (s === "shipment_created" || s === "manifest_generated" || s === "pickup_generated") {
      return "border-cyan-300 bg-cyan-50 text-cyan-700 hover:border-cyan-400 focus:ring-cyan-400";
    }
    return "border-slate-300 bg-slate-50 text-slate-700 hover:border-slate-400 focus:ring-slate-400";
  };

  const toPaymentStatus = useCallback((o: OrderRow) => {
    if (o.transactions?.some((t) => /paid|captured|success/i.test(t.status ?? "")) || (o.paymentStatus ?? "").toUpperCase() === "SUCCESS") return "success";
    if (o.transactions?.some((t) => /fail/i.test(t.status ?? "")) || (o.paymentStatus ?? "").toUpperCase() === "FAILED") return "failed";
    if ((o.paymentStatus ?? "").toUpperCase() === "INITIATED") return "initiated";
    return "pending";
  }, []);
  const lifecycleStatus = useCallback((o: OrderRow) => {
    const rawStatus = (o.statusHistory?.[0]?.toStatus ?? o.status ?? "pending").toLowerCase();
    const reasonCode = (o.statusHistory?.[0]?.reasonCode ?? "").toLowerCase();
    const isRejected =
      rawStatus === "rejected" ||
      reasonCode === "admin_rejected" ||
      o.statusHistory?.some((h) => (h.reasonCode ?? "").toLowerCase() === "admin_rejected" || (h.toStatus ?? "").toLowerCase() === "rejected");
    if (isRejected) return "rejected";
    return rawStatus;
  }, []);
  const latestShipmentStatus = useCallback((o: OrderRow) => (o.shipmentStatus ?? o.shipments?.[0]?.shipmentStatus ?? "not_shipped").toLowerCase(), []);
  const itemsCount = useCallback((o: OrderRow) => o.items.reduce((sum, item) => sum + Number(item.quantity ?? 0), 0), []);

  const statusTabCounts = useMemo(() => {
    const counts = {
      all: rows.length,
      new: 0,
      confirmed: 0,
      shipped: 0,
      in_transit: 0,
      delivered: 0,
      rejected: 0,
      cancelled: 0,
    };
    rows.forEach((o) => {
      const lc = lifecycleStatus(o);
      const sh = latestShipmentStatus(o);
      if (sh === "cancelled") {
        counts.cancelled++;
        return;
      }
      if (["pending", "pending_payment", "payment_success", "admin_approval_pending", "new"].includes(lc)) {
        counts.new++;
      }
      if (["confirmed", "packed"].includes(lc)) {
        counts.confirmed++;
      }
      if ((lc === "shipped" || sh === "shipped") && !["in_transit", "out_for_delivery", "delivered"].includes(sh) && lc !== "in_transit" && lc !== "delivered") {
        counts.shipped++;
      }
      if (lc === "in_transit" || ["in_transit", "out_for_delivery"].includes(sh)) {
        counts.in_transit++;
      }
      if (lc === "delivered" || sh === "delivered" || Boolean(o.fulfillment?.deliveredAt)) {
        counts.delivered++;
      }
      if (lc === "rejected") {
        counts.rejected++;
      }
      if (lc === "cancelled") {
        counts.cancelled++;
      }
    });
    return counts;
  }, [rows, lifecycleStatus, latestShipmentStatus]);

  const filteredRows = useMemo(() => {
    const rawTerm = searchTerm.trim();
    const term = rawTerm.toLowerCase();
    const cleanTerm = term.replace(/^#+/, "").trim();
    const alphaNumTerm = cleanTerm.replace(/[^a-z0-9]/g, "");

    let list = rows.filter((o) => {
      const payment = toPaymentStatus(o);
      const lifecycle = lifecycleStatus(o);
      const ship = latestShipmentStatus(o);
      const date = new Date(toUtcIso(o.createdAt) ?? o.createdAt);

      if (ship === "cancelled") {
        if (statusTab !== "all" && statusTab !== "cancelled") return false;
      } else if (statusTab !== "all") {
        if (statusTab === "new" && !["pending", "pending_payment", "payment_success", "admin_approval_pending", "new"].includes(lifecycle)) return false;
        if (statusTab === "confirmed" && !["confirmed", "packed"].includes(lifecycle)) return false;
        if (statusTab === "shipped" && (lifecycle !== "shipped" && ship !== "shipped" || ["in_transit", "out_for_delivery", "delivered"].includes(ship) || ["in_transit", "delivered"].includes(lifecycle))) return false;
        if (statusTab === "in_transit" && lifecycle !== "in_transit" && !["in_transit", "out_for_delivery"].includes(ship)) return false;
        if (statusTab === "delivered" && lifecycle !== "delivered" && ship !== "delivered" && !o.fulfillment?.deliveredAt) return false;
        if (statusTab === "rejected" && lifecycle !== "rejected") return false;
        if (statusTab === "cancelled" && lifecycle !== "cancelled") return false;
      }

      if (paymentFilter !== "all" && payment !== paymentFilter) return false;
      if (orderFilter !== "all" && lifecycle !== orderFilter) return false;
      if (shipmentFilter !== "all" && ship !== shipmentFilter) return false;
      if (dateFrom && date < new Date(`${dateFrom}T00:00:00`)) return false;
      if (dateTo && date > new Date(`${dateTo}T23:59:59`)) return false;
      if (!rawTerm) return true;

      const orderId = String(o.id ?? "").toLowerCase();
      const displayedId = `#${String(o.id ?? "").slice(0, 10).toUpperCase()}`.toLowerCase();
      const shortId10 = String(o.id ?? "").slice(0, 10).toLowerCase();
      const shortId8 = String(o.id ?? "").slice(0, 8).toLowerCase();
      const alphaNumOrderId = orderId.replace(/[^a-z0-9]/g, "");

      const matchesId =
        orderId.includes(term) ||
        (cleanTerm.length > 0 && orderId.includes(cleanTerm)) ||
        displayedId.includes(term) ||
        shortId10.includes(cleanTerm) ||
        shortId8.includes(cleanTerm) ||
        (alphaNumTerm.length >= 3 && alphaNumOrderId.includes(alphaNumTerm));

      const matchesCustomer =
        (o.customerName ?? o.user?.name ?? "").toLowerCase().includes(term) ||
        (o.customerPhone ?? "").toLowerCase().includes(term) ||
        (o.user?.email ?? "").toLowerCase().includes(term);

      const matchesOtherRef =
        (o.shiprocketOrderId ?? "").toLowerCase().includes(cleanTerm || term) ||
        (o.awbCode ?? "").toLowerCase().includes(cleanTerm || term) ||
        (o.trackingNumber ?? "").toLowerCase().includes(cleanTerm || term) ||
        (o.paymentId ?? "").toLowerCase().includes(cleanTerm || term) ||
        (o.transactionId ?? "").toLowerCase().includes(cleanTerm || term) ||
        (o.refNo ?? "").toLowerCase().includes(cleanTerm || term);

      const matchesItems = o.items?.some((it) =>
        (it.product?.name ?? "").toLowerCase().includes(term)
      );

      return matchesId || matchesCustomer || matchesOtherRef || matchesItems;
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

  const load = useCallback(() => {
    if (!canFetch) {
      setRows([]);
      setLoading(false);
      setError("Login as admin to load orders.");
      return;
    }
    setLoading(true);
    setError("");
    authedFetch<{ items: OrderRow[] }>("/api/v1/orders?page=1&limit=1000")
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
        generatePickup: false,
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

  const handleApprovalAction = async (orderId: string, action: "approve_order" | "reject_order", reason?: string) => {
    if (rowActionBusy[orderId]) return;
    setRowActionBusy((prev) => ({ ...prev, [orderId]: action }));
    setRowActionError((prev) => ({ ...prev, [orderId]: "" }));
    try {
      await authedPost(`/api/v1/orders/${orderId}/actions`, { action, reason });
      const nextStatus = action === "approve_order" ? "confirmed" : "rejected";
      setRows((prev) =>
        prev.map((row) =>
          row.id === orderId
            ? {
                ...row,
                status: nextStatus,
                statusHistory: [{ toStatus: nextStatus, reasonCode: action === "reject_order" ? "admin_rejected" : undefined, notes: reason || undefined, changedAt: new Date().toISOString() }, ...(row.statusHistory ?? [])],
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

  const runRow = async (orderId: string, key: string, task: () => Promise<void>) => {
    if (rowActionBusy[orderId]) return;
    setRowActionBusy((prev) => ({ ...prev, [orderId]: key }));
    setRowActionError((prev) => ({ ...prev, [orderId]: "" }));
    try {
      await task();
      await load();
    } catch (e) {
      const msg = e instanceof Error ? e.message : "Action failed";
      setRowActionError((prev) => ({ ...prev, [orderId]: msg }));
      await load();
    } finally {
      setRowActionBusy((prev) => {
        const next = { ...prev };
        delete next[orderId];
        return next;
      });
    }
  };

  const awbOf = (o: OrderRow) => o.awbCode || o.trackingNumber || o.shipments?.[0]?.trackingNo || "";
  const hasShipment = (o: OrderRow) => Boolean(o.isShipmentCreated || o.shipmentId) && latestShipmentStatus(o) !== "cancelled";
  const hasLabel = (o: OrderRow) => Boolean(o.labelUrl || o.isLabelGenerated);
  const hasPickup = (o: OrderRow) => Boolean(o.isPickupGenerated) && isConfirmedPickupRequest(o.pickupStatus || o.shipmentStatus);
  const displayShipmentStatus = (o: OrderRow) => {
    const status = latestShipmentStatus(o);
    if (/pickup generated/i.test(status) && !hasPickup(o)) return "not_picked_up";
    return status;
  };

  const checkServiceability = (orderId: string) =>
    runRow(orderId, "serviceability", async () => {
      try {
        const data = await authedPost<{ availableCouriers?: unknown[] }>(`/api/v1/orders/${orderId}/shiprocket`, { action: "serviceability" });
        const count = data.availableCouriers?.length ?? 0;
        if (count > 0) {
          setServiceableIds((prev) => ({ ...prev, [orderId]: true }));
          setUnserviceableIds((prev) => {
            const next = { ...prev };
            delete next[orderId];
            return next;
          });
          setUnserviceable(null);
          toast.success("Serviceable", `${count} courier${count === 1 ? "" : "s"} can deliver this order.`);
        } else {
          setServiceableIds((prev) => {
            const next = { ...prev };
            delete next[orderId];
            return next;
          });
          setUnserviceableIds((prev) => ({ ...prev, [orderId]: true }));
          setUnserviceable({ orderId, reason: "No courier can deliver this pincode for the current payment type and package." });
        }
      } catch (e) {
        const msg = e instanceof Error ? e.message : "Serviceability check failed";
        setServiceableIds((prev) => {
          const next = { ...prev };
          delete next[orderId];
          return next;
        });
        setUnserviceableIds((prev) => ({ ...prev, [orderId]: true }));
        setUnserviceable({ orderId, reason: msg });
      }
    });

  const submitPackage = () => {
    if (!packageModal) return;
    const weightKg = Number(packageModal.weightKg);
    const lengthCm = Number(packageModal.lengthCm);
    const widthCm = Number(packageModal.widthCm);
    const heightCm = Number(packageModal.heightCm);
    if (![weightKg, lengthCm, widthCm, heightCm].every((value) => Number.isFinite(value) && value > 0)) {
      toast.error("Package details", "Enter a positive weight and dimensions.");
      return;
    }
    if (weightKg > 30 || lengthCm > 200 || widthCm > 200 || heightCm > 200) {
      toast.error("Package details", "Weight must be at most 30 kg and each side at most 200 cm.");
      return;
    }
    const review = assessPackageMeasures({ weightKg, lengthCm, widthCm, heightCm });
    if (!review.ok) {
      toast.error("Package details", review.reason ?? "Enter the package weight and dimensions.");
      return;
    }
    if (review.requiresConfirmation && !packageConfirmed) {
      toast.error("Confirm dimensions", review.reason ?? "Confirm these centimetre measurements.");
      return;
    }
    const { orderId } = packageModal;
    setPackageModal(null);
    setPackageConfirmed(false);
    setCourierModal(null);
    setServiceableIds((prev) => {
      const next = { ...prev };
      delete next[orderId];
      return next;
    });
    void runRow(orderId, "ship_now", async () => {
      try {
        await authedPost(`/api/v1/orders/${orderId}/shiprocket`, {
          action: "create_shipment",
          package: { weightKg, lengthCm, widthCm, heightCm },
          confirmLargePackage: review.requiresConfirmation,
        });
        toast.success("Shipment created", "Assign an AWB when you are ready to choose a courier.");
      } catch (error) {
        const msg = error instanceof Error ? error.message : "";
        if (!/already exists|duplicate/i.test(msg)) throw error;
        toast.success("Shipment exists", "This order already has a Shiprocket shipment. Assign an AWB next.");
      }
    });
  };

  const openAwbPopup = (orderId: string) =>
    runRow(orderId, "assign_awb", async () => {
      const data = await authedPost<{
        availableCouriers?: Array<{
          name: string;
          rate: number;
          eta_days: number;
          etd?: string;
          courier_company_id?: number;
          cod_available?: boolean;
          charge_weight_kg?: number;
          min_weight_kg?: number;
        }>;
        weight?: number | null;
        lengthCm?: number | null;
        widthCm?: number | null;
        heightCm?: number | null;
      }>(
        `/api/v1/orders/${orderId}/shiprocket`,
        { action: "serviceability" },
      );
      const couriers = (data.availableCouriers ?? []).filter((courier) => courier.courier_company_id);
      if (!couriers.length) throw new Error("No couriers are available for this shipment.");
      setCourierModal({
        orderId,
        couriers,
        selectedId: couriers[0]?.courier_company_id ?? null,
        packageWeightKg: data.weight ?? null,
        lengthCm: data.lengthCm ?? null,
        widthCm: data.widthCm ?? null,
        heightCm: data.heightCm ?? null,
        confirmed: false,
      });
    });

  const confirmAwb = () => {
    if (!courierModal?.selectedId) return;
    const warning = awbQuoteWarning({
      weightKg: courierModal.packageWeightKg,
      lengthCm: courierModal.lengthCm,
      widthCm: courierModal.widthCm,
      heightCm: courierModal.heightCm,
      chargeableKg: courierModal.couriers.find((courier) => courier.courier_company_id === courierModal.selectedId)?.charge_weight_kg ?? null,
    });
    if (warning.block) {
      toast.error("Package details", warning.message ?? "Package details are incomplete.");
      return;
    }
    if (warning.confirm && !courierModal.confirmed) {
      toast.error("Confirm package", warning.message ?? "Confirm the saved package before assigning an AWB.");
      return;
    }
    const { orderId, selectedId } = courierModal;
    setCourierModal(null);
    void runRow(orderId, "assign_awb", async () => {
      await authedPost(`/api/v1/orders/${orderId}/shiprocket`, { action: "assign_awb", courierId: selectedId });
      toast.success("AWB assigned", "Download the shipping label next.");
    });
  };

  const downloadLabel = (orderId: string) =>
    runRow(orderId, "label", async () => {
      const data = await authedPost<{ labelUrl?: string }>(`/api/v1/orders/${orderId}/shiprocket`, { action: "generate_label" });
      if (!data.labelUrl) throw new Error("Shiprocket did not return a label.");
      window.open(data.labelUrl, "_blank", "noopener,noreferrer");
      toast.success("Label ready", "The shipping label opened in a new tab.");
    });

  const requestPickup = (orderId: string) =>
    runRow(orderId, "generate_pickup", async () => {
      await authedPost(`/api/v1/orders/${orderId}/shiprocket`, { action: "generate_pickup" });
      toast.success("Pickup requested", "Shiprocket has the pickup request. Tracking will move the order when the courier ships it.");
    });

  const refreshTracking = (orderId: string) =>
    runRow(orderId, "tracking", async () => {
      await authedPost(`/api/v1/orders/${orderId}/shiprocket`, { action: "refresh_tracking" });
      toast.success("Tracking refreshed", "Shipment status was synced from Shiprocket.");
    });

  const syncFromShiprocket = (orderId: string) =>
    runRow(orderId, "sync", async () => {
      await authedPost(`/api/v1/orders/${orderId}/shiprocket`, { action: "sync_order", panelSync: true, generatePickup: false });
      toast.success("Synced from Shiprocket", "Order status and shipment status now match Shiprocket. Finish AWB, pickup, and label in the Shiprocket panel, then sync again.");
    });

  const saveManualShipment = () => {
    if (!manualModal) return;
    const courier = manualModal.courier.trim();
    const trackingId = manualModal.trackingId.trim();
    const trackingUrl = manualModal.trackingUrl.trim();
    if (!courier || !trackingId) {
      toast.error("Manual shipment", "Courier name and tracking id are required.");
      return;
    }
    const orderId = manualModal.orderId;
    void runRow(orderId, "manual", async () => {
      await authedPost(`/api/v1/orders/${orderId}/fulfillment`, {
        action: "manual_shipment",
        courierName: courier,
        trackingId,
        trackingUrl,
      });
      setManualModal(null);
      setUnserviceable(null);
      toast.success("Manual shipment saved", "Update the order status as the parcel moves.");
    });
  };

  const changeOrderStatus = (orderId: string, orderStatus: string) =>
    runRow(orderId, "order_status", async () => {
      await authedPost(`/api/v1/orders/${orderId}/fulfillment`, { action: "set_order_status", orderStatus });
      toast.success("Order updated", `Status set to ${orderStatusLabel(orderStatus)}.`);
    });

  const changeShipmentStatus = (orderId: string, shipmentStatus: string) =>
    runRow(orderId, "shipment_status", async () => {
      await authedPost(`/api/v1/orders/${orderId}/fulfillment`, { action: "set_shipment_status", shipmentStatus });
      toast.success("Shipment updated", `Shipment status set to ${orderStatusLabel(shipmentStatus)}.`);
    });

  const confirmRejectOrder = async () => {
    if (!rejectModalOrderId) return;
    const targetId = rejectModalOrderId;
    const reason = rejectReason.trim();
    setRejectModalOrderId(null);
    setRejectReason("");
    await handleApprovalAction(targetId, "reject_order", reason);
  };

  const exportCsv = () => {
    const header = [
      "order_id",
      "date_time",
      "customer_name",
      "mobile",
      "email",
      "payment_method",
      "payment_status",
      "order_status",
      "shipment_status",
      "total_amount",
      "items_count",
    ];
    const body = filteredRows.map((o) => [
      o.id,
      formatIstSqlDateTime(o.createdAt) ?? "",
      o.customerName ?? o.user?.name ?? "",
      o.customerPhone ?? "",
      o.user?.email ?? "",
      o.paymentMethod ?? "",
      toPaymentStatus(o),
      lifecycleStatus(o),
      latestShipmentStatus(o),
      Number(o.total).toFixed(2),
      itemsCount(o),
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
      <div className="rounded-2xl border border-[#E8DCC8] bg-white p-5 shadow-sm">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div>
            <h1 className="font-melon text-2xl font-bold text-[#4A1D1F]">Orders List</h1>
            <p className="text-sm text-[#646464]">Production order feed with payment, lifecycle, and shipment visibility.</p>
          </div>
          <div className="flex flex-wrap items-center gap-2">
            <button type="button" onClick={() => load()} disabled={!canFetch} className="rounded-full bg-[#2DA66D] px-5 py-2 text-xs font-bold uppercase tracking-wider text-white hover:brightness-95 disabled:opacity-50">REFRESH</button>
            <button type="button" onClick={() => void runBulkSync(filteredRows.filter((row) => row.isShipmentCreated || row.awbCode).map((row) => row.id))} disabled={bulkSyncBusy || filteredRows.length === 0} className="rounded-full bg-[#7B3010] px-5 py-2 text-xs font-bold uppercase tracking-wider text-white hover:brightness-95 disabled:opacity-50">
              {bulkSyncBusy ? "SYNCING..." : "SYNC ORDERS TO SHIPROCKET"}
            </button>
            <button type="button" onClick={exportCsv} className="inline-flex items-center gap-1.5 rounded-full border border-[#E8DCC8] bg-white px-4 py-2 text-xs font-bold uppercase tracking-wider text-[#7B3010] hover:bg-[#FFFBF3]">
              <Download className="h-4 w-4" /> EXPORT CSV
            </button>
          </div>
        </div>

        {/* Status Filter Tabs */}
        <div className="mt-4 flex flex-wrap items-center gap-2 rounded-2xl border border-[#E8DCC8] bg-[#FFFBF3] p-2.5 shadow-xs">
          {[
            { id: "all" as const, label: "All Orders", count: statusTabCounts.all },
            { id: "new" as const, label: "New Orders", count: statusTabCounts.new },
            { id: "confirmed" as const, label: "Confirmed", count: statusTabCounts.confirmed },
            { id: "shipped" as const, label: "Shipped", count: statusTabCounts.shipped },
            { id: "in_transit" as const, label: "In Transit", count: statusTabCounts.in_transit },
            { id: "delivered" as const, label: "Delivered", count: statusTabCounts.delivered },
            { id: "rejected" as const, label: "Rejected", count: statusTabCounts.rejected },
            { id: "cancelled" as const, label: "Cancelled", count: statusTabCounts.cancelled },
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
                    ? "bg-[#7B3010] text-white shadow-md ring-1 ring-[#7B3010]"
                    : "border border-[#E8DCC8] bg-white text-[#4A1D1F] hover:bg-[#F9F5EC] hover:border-[#7B3010]/40 shadow-2xs"
                }`}
              >
                <span>{tab.label}</span>
                <span
                  className={`rounded-full px-2 py-0.5 text-[10px] font-bold ${
                    active
                      ? "bg-white/20 text-white"
                      : "bg-[#7B3010] text-white"
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
                placeholder="Search by order ID, #ID, customer, phone..."
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

        <div className="mt-2.5 flex justify-end">
          <button
            type="button"
            onClick={resetFilters}
            className="text-[11px] font-bold uppercase tracking-wide text-[#7B3010] hover:underline"
          >
            Reset All Filters
          </button>
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
                    <td className="px-2 py-2">
                      <button
                        type="button"
                        onClick={() => router.push(`/admin/orders/${o.id}`)}
                        className="font-mono text-[11px] font-semibold text-[#7B3010] hover:underline cursor-pointer text-left"
                        title={`Full Order ID: ${o.id}`}
                      >
                        #{o.id.slice(0, 10).toUpperCase()}
                      </button>
                    </td>
                    <td className="px-2 py-2 text-xs text-[#7A7A7A]">
                      <div>{formatOrderDate(o.createdAt)}</div>
                      <div>{formatOrderTime(o.createdAt)}</div>
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
                      <div className="min-w-[130px]">
                        {(() => {
                          const currentStatus = lifecycleStatus(o);
                          const options = (ADMIN_ORDER_STATUS_OPTIONS as readonly string[]).includes(currentStatus)
                            ? ADMIN_ORDER_STATUS_OPTIONS
                            : [currentStatus, ...ADMIN_ORDER_STATUS_OPTIONS];
                          return (
                            <select
                              value={currentStatus}
                              disabled={Boolean(rowActionBusy[o.id])}
                              onChange={(e) => void changeOrderStatus(o.id, e.target.value)}
                              className={`w-full cursor-pointer rounded-lg border px-2 py-1 text-[11px] font-semibold shadow-sm focus:outline-none focus:ring-1 disabled:cursor-not-allowed disabled:opacity-50 transition ${getOrderStatusSelectClass(currentStatus)}`}
                              title="Change Order Status"
                            >
                              {options.map((value) => (
                                <option key={value} value={value} className="bg-white text-[#2A1810]">
                                  {orderStatusLabel(value)}
                                </option>
                              ))}
                            </select>
                          );
                        })()}
                      </div>
                    </td>
                    <td className="px-2 py-2">
                      <div className="min-w-[130px] space-y-0.5">
                        {(() => {
                          const currentShipStatus = latestShipmentStatus(o);
                          const options = (ADMIN_SHIPMENT_STATUS_OPTIONS as readonly string[]).includes(currentShipStatus)
                            ? ADMIN_SHIPMENT_STATUS_OPTIONS
                            : [currentShipStatus, ...ADMIN_SHIPMENT_STATUS_OPTIONS];
                          return (
                            <select
                              value={currentShipStatus}
                              disabled={Boolean(rowActionBusy[o.id])}
                              onChange={(e) => void changeShipmentStatus(o.id, e.target.value)}
                              className={`w-full cursor-pointer rounded-lg border px-2 py-1 text-[11px] font-semibold shadow-sm focus:outline-none focus:ring-1 disabled:cursor-not-allowed disabled:opacity-50 transition ${getShipmentStatusSelectClass(currentShipStatus)}`}
                              title="Change Shipment Status"
                            >
                              {options.map((value) => (
                                <option key={value} value={value} className="bg-white text-[#2A1810]">
                                  {orderStatusLabel(value)}
                                </option>
                              ))}
                            </select>
                          );
                        })()}
                        <p className="mt-1 text-[11px] text-[#646464]">{o.courierName ?? o.shipments?.[0]?.carrier ?? "Courier TBD"}</p>
                        <p className="text-[11px] text-[#646464]">AWB: {o.awbCode ?? o.shipments?.[0]?.trackingNo ?? "Pending"}</p>
                      </div>
                    </td>
                    <td className="px-2 py-2 font-semibold">Rs.{Number(o.total).toFixed(2)}</td>
                    <td className="px-2 py-2 text-center font-medium">{itemsCount(o)}</td>
                    <td className="px-3 py-2 text-right">
                      <div className="flex items-center justify-end gap-1.5">
                        <button
                          type="button"
                          onClick={() => router.push(`/admin/orders/${o.id}`)}
                          title="View Order Details"
                          className="inline-flex items-center justify-center rounded-full border border-[#7B3010] bg-[#FFF7EA] p-1.5 text-[#7B3010] shadow-sm hover:bg-[#7B3010] hover:text-white transition cursor-pointer"
                        >
                          <Eye className="h-3.5 w-3.5" />
                        </button>
                        {latestShipmentStatus(o) !== "cancelled" && (
                          <>
                        {["confirmed", "packed"].includes(lifecycleStatus(o)) && !isManualShipment({ shipmentNo: o.shipmentNo ?? o.shipments?.[0]?.shipmentNo, shippingMethod: o.shippingMethod }) && !hasShipment(o) && !serviceableIds[o.id] && !unserviceableIds[o.id] && (
                          <button type="button" disabled={Boolean(rowActionBusy[o.id])} onClick={() => void checkServiceability(o.id)} className="cursor-pointer rounded-full border border-[#7B3010] bg-[#FFF7ED] px-2.5 py-1 text-[10px] font-bold uppercase text-[#7B3010] hover:bg-[#7B3010] hover:text-white disabled:cursor-not-allowed disabled:opacity-50">
                            {rowActionBusy[o.id] === "serviceability" ? "Checking..." : "Check serviceability"}
                          </button>
                        )}
                        {["confirmed", "packed", "shipped", "in_transit", "out_for_delivery"].includes(lifecycleStatus(o)) && !isManualShipment({ shipmentNo: o.shipmentNo ?? o.shipments?.[0]?.shipmentNo, shippingMethod: o.shippingMethod }) && (Boolean(serviceableIds[o.id]) || hasShipment(o)) && (
                          <button type="button" disabled={Boolean(rowActionBusy[o.id])} onClick={() => void syncFromShiprocket(o.id)} className="cursor-pointer rounded-full bg-[#16803C] px-2.5 py-1 text-[10px] font-bold uppercase text-white hover:brightness-95 disabled:cursor-not-allowed disabled:opacity-50">
                            {rowActionBusy[o.id] === "sync" ? "Syncing..." : "Sync"}
                          </button>
                        )}
                        {["confirmed", "packed"].includes(lifecycleStatus(o)) && !hasShipment(o) && Boolean(unserviceableIds[o.id]) && (
                          <button type="button" disabled={Boolean(rowActionBusy[o.id])} onClick={() => setManualModal({ orderId: o.id, courier: "", trackingId: "", trackingUrl: "" })} className="cursor-pointer rounded-full border border-[#7B3010] bg-[#FFF7ED] px-2.5 py-1 text-[10px] font-bold uppercase text-[#7B3010] hover:bg-[#7B3010] hover:text-white disabled:cursor-not-allowed disabled:opacity-50">
                            Manual shipment
                          </button>
                        )}
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
                              onClick={() => {
                                setRejectModalOrderId(o.id);
                                setRejectReason("");
                              }}
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
                          </>
                        )}
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

      {unserviceable && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4">
          <div className="w-full max-w-md rounded-2xl border border-[#E8DCC8] bg-white p-6 shadow-xl space-y-4">
            <h2 className="font-melon text-lg font-bold text-[#4A1D1F]">Not serviceable</h2>
            <p className="text-sm text-[#646464]">{unserviceable.reason}</p>
            <p className="text-sm text-[#646464]">Ship this order yourself, or recheck serviceability later.</p>
            <div className="flex justify-end gap-2">
              <button type="button" onClick={() => setUnserviceable(null)} className="cursor-pointer rounded-full border px-4 py-2 text-xs font-semibold">Close</button>
              <button type="button" onClick={() => { const id = unserviceable.orderId; setUnserviceable(null); void checkServiceability(id); }} className="cursor-pointer rounded-full border border-[#7B3010] px-4 py-2 text-xs font-semibold text-[#7B3010]">Recheck</button>
              <button type="button" onClick={() => { setManualModal({ orderId: unserviceable.orderId, courier: "", trackingId: "", trackingUrl: "" }); setUnserviceable(null); }} className="cursor-pointer rounded-full bg-[#7B3010] px-4 py-2 text-xs font-semibold text-white">Manual shipment</button>
            </div>
          </div>
        </div>
      )}

      {manualModal && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4">
          <div className="w-full max-w-md rounded-2xl border border-[#E8DCC8] bg-white p-6 shadow-xl space-y-4">
            <h2 className="font-melon text-lg font-bold text-[#4A1D1F]">Manual shipment</h2>
            <label className="block text-xs font-semibold text-[#4A1D1F]">
              Courier
              <input value={manualModal.courier} onChange={(e) => setManualModal({ ...manualModal, courier: e.target.value })} className="mt-1 w-full rounded-lg border border-[#E8DCC8] px-3 py-2 text-sm" />
            </label>
            <label className="block text-xs font-semibold text-[#4A1D1F]">
              Tracking id
              <input value={manualModal.trackingId} onChange={(e) => setManualModal({ ...manualModal, trackingId: e.target.value })} className="mt-1 w-full rounded-lg border border-[#E8DCC8] px-3 py-2 text-sm" />
            </label>
            <label className="block text-xs font-semibold text-[#4A1D1F]">
              Tracking URL
              <input value={manualModal.trackingUrl} onChange={(e) => setManualModal({ ...manualModal, trackingUrl: e.target.value })} className="mt-1 w-full rounded-lg border border-[#E8DCC8] px-3 py-2 text-sm" />
            </label>
            <div className="flex justify-end gap-2">
              <button type="button" onClick={() => setManualModal(null)} className="cursor-pointer rounded-full border px-4 py-2 text-xs font-semibold">Cancel</button>
              <button type="button" disabled={Boolean(rowActionBusy[manualModal.orderId])} onClick={saveManualShipment} className="cursor-pointer rounded-full bg-[#7B3010] px-4 py-2 text-xs font-semibold text-white disabled:opacity-50">
                {rowActionBusy[manualModal.orderId] === "manual" ? "Saving..." : "Save shipment"}
              </button>
            </div>
          </div>
        </div>
      )}

      {packageModal && (() => {
        const review = assessPackageMeasures({
          weightKg: Number(packageModal.weightKg),
          lengthCm: Number(packageModal.lengthCm),
          widthCm: Number(packageModal.widthCm),
          heightCm: Number(packageModal.heightCm),
        });
        const editPackage = (field: "weightKg" | "lengthCm" | "widthCm" | "heightCm", value: string) => {
          setPackageConfirmed(false);
          setCourierModal(null);
          setServiceableIds((prev) => {
            const next = { ...prev };
            delete next[packageModal.orderId];
            return next;
          });
          setPackageModal({ ...packageModal, [field]: value });
        };
        return (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4">
          <div className="w-full max-w-lg rounded-2xl border border-[#E8DCC8] bg-white p-6 shadow-xl space-y-3">
            <h2 className="text-base font-semibold text-[#111827]">Package details</h2>
            <p className="text-sm text-[#646464]">Enter the packed shipment size in kilograms and centimetres. These values are sent to Shiprocket when the shipment is created.</p>
            <label className="block text-xs font-semibold text-[#646464]">Weight (kg)
              <input inputMode="decimal" value={packageModal.weightKg} onChange={(e) => editPackage("weightKg", e.target.value)} className="mt-1 w-full rounded-full border px-3 py-2 text-sm" />
            </label>
            <div className="grid grid-cols-3 gap-2">
              <label className="block text-xs font-semibold text-[#646464]">Length (cm)
                <input inputMode="decimal" value={packageModal.lengthCm} onChange={(e) => editPackage("lengthCm", e.target.value)} className="mt-1 w-full rounded-full border px-3 py-2 text-sm" />
              </label>
              <label className="block text-xs font-semibold text-[#646464]">Width (cm)
                <input inputMode="decimal" value={packageModal.widthCm} onChange={(e) => editPackage("widthCm", e.target.value)} className="mt-1 w-full rounded-full border px-3 py-2 text-sm" />
              </label>
              <label className="block text-xs font-semibold text-[#646464]">Height (cm)
                <input inputMode="decimal" value={packageModal.heightCm} onChange={(e) => editPackage("heightCm", e.target.value)} className="mt-1 w-full rounded-full border px-3 py-2 text-sm" />
              </label>
            </div>
            {review.requiresConfirmation && review.reason ? (
              <label className="flex items-start gap-2 rounded-xl border border-amber-300 bg-amber-50 px-3 py-2 text-xs text-amber-900">
                <input type="checkbox" className="mt-0.5 cursor-pointer" checked={packageConfirmed} onChange={(e) => setPackageConfirmed(e.target.checked)} />
                <span>{review.reason}</span>
              </label>
            ) : null}
            <div className="flex justify-end gap-2">
              <button type="button" onClick={() => { setPackageModal(null); setPackageConfirmed(false); }} className="cursor-pointer rounded-full border px-4 py-2 text-xs font-semibold">Cancel</button>
              <button type="button" onClick={submitPackage} className="cursor-pointer rounded-full bg-[#16803C] px-4 py-2 text-xs font-semibold text-white">{review.requiresConfirmation ? "Confirm and create shipment" : "Create shipment"}</button>
            </div>
          </div>
        </div>
        );
      })()}

      {courierModal && (() => {
        const selected = courierModal.couriers.find((courier) => courier.courier_company_id === courierModal.selectedId);
        const warning = awbQuoteWarning({
          weightKg: courierModal.packageWeightKg,
          lengthCm: courierModal.lengthCm,
          widthCm: courierModal.widthCm,
          heightCm: courierModal.heightCm,
          chargeableKg: selected?.charge_weight_kg ?? courierModal.couriers.find((courier) => courier.charge_weight_kg != null)?.charge_weight_kg ?? null,
        });
        return (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4">
          <div className="w-full max-w-lg rounded-2xl border border-[#E8DCC8] bg-white p-6 shadow-xl space-y-3">
            <h2 className="text-base font-semibold text-[#111827]">Assign AWB</h2>
            <p className="text-sm text-[#646464]">
              {courierModal.packageWeightKg != null ? `Package weight ${courierModal.packageWeightKg} kg. ` : ""}
              {courierModal.lengthCm && courierModal.widthCm && courierModal.heightCm
                ? `Dimensions ${courierModal.lengthCm} × ${courierModal.widthCm} × ${courierModal.heightCm} cm. `
                : ""}
              Courier name, minimum weight, chargeable weight, and rate are the values Shiprocket returned for this package.
            </p>
            {warning.message ? (
              <label className="flex items-start gap-2 rounded-xl border border-amber-300 bg-amber-50 px-3 py-2 text-xs text-amber-900">
                {warning.confirm ? (
                  <input type="checkbox" className="mt-0.5 cursor-pointer" checked={courierModal.confirmed} onChange={(e) => setCourierModal({ ...courierModal, confirmed: e.target.checked })} />
                ) : null}
                <span>{warning.message}</span>
              </label>
            ) : null}
            <div className="max-h-72 space-y-2 overflow-y-auto">
              {courierModal.couriers.map((courier) => {
                const eta = courier.eta_days > 0 ? `${courier.eta_days} days` : courier.etd || "";
                return (
                <label key={`${courier.courier_company_id}-${courier.name}`} className="flex cursor-pointer items-start justify-between gap-3 rounded-xl border px-3 py-2 text-sm hover:bg-[#FFFBF3]">
                  <span className="flex items-start gap-2">
                    <input type="radio" className="mt-1 cursor-pointer" checked={courierModal.selectedId === courier.courier_company_id} onChange={() => setCourierModal({ ...courierModal, selectedId: courier.courier_company_id ?? null, confirmed: false })} />
                    <span>
                      <span className="block">{courier.name}</span>
                      {courier.min_weight_kg != null ? <span className="block text-xs text-[#646464]">Courier minimum weight {courier.min_weight_kg} kg</span> : null}
                      {courier.charge_weight_kg != null ? <span className="block text-xs text-[#646464]">Chargeable weight {courier.charge_weight_kg} kg</span> : null}
                    </span>
                  </span>
                  <span className="shrink-0 text-xs text-[#646464]">₹{Number(courier.rate).toFixed(2)}{eta ? ` · ${eta}` : ""}{courier.cod_available ? " · COD" : ""}</span>
                </label>
                );
              })}
            </div>
            <div className="flex justify-end gap-2">
              <button type="button" onClick={() => setCourierModal(null)} className="cursor-pointer rounded-full border px-4 py-2 text-xs font-semibold">Cancel</button>
              <button type="button" disabled={!courierModal.selectedId || warning.block || (warning.confirm && !courierModal.confirmed)} onClick={confirmAwb} className="cursor-pointer rounded-full bg-[#7B3010] px-4 py-2 text-xs font-semibold text-white disabled:cursor-not-allowed disabled:opacity-40">Assign AWB</button>
            </div>
          </div>
        </div>
        );
      })()}

      {/* Reject Order Modal Popup */}
      {rejectModalOrderId && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4 backdrop-blur-xs">
          <div className="w-full max-w-md rounded-2xl border border-[#E8DCC8] bg-white p-6 shadow-xl space-y-4">
            <div className="flex items-center justify-between border-b border-[#E8DCC8] pb-3">
              <h2 className="font-melon text-lg font-bold text-[#4A1D1F]">Reject Order</h2>
              <button
                type="button"
                onClick={() => setRejectModalOrderId(null)}
                className="rounded-full p-1 text-[#646464] hover:bg-[#FFF7EA] hover:text-[#4A1D1F] transition"
              >
                <X className="h-5 w-5" />
              </button>
            </div>
            <div>
              <p className="text-xs text-[#646464] mb-2">
                Please enter the reason for rejecting order <span className="font-mono font-bold text-[#7B3010]">#{rejectModalOrderId.slice(0, 10).toUpperCase()}</span>:
              </p>
              <textarea
                value={rejectReason}
                onChange={(e) => setRejectReason(e.target.value)}
                placeholder="Enter reason for rejection..."
                rows={3}
                className="w-full rounded-xl border border-[#E3E3DA] bg-white p-3 text-xs text-[#4A1D1F] placeholder-[#8A8A8A] focus:border-[#7B3010] focus:outline-none"
              />
            </div>
            <div className="flex items-center justify-end gap-2 pt-2 border-t border-[#E8DCC8]">
              <button
                type="button"
                onClick={() => setRejectModalOrderId(null)}
                className="rounded-full border border-[#E8DCC8] bg-white px-4 py-2 text-xs font-bold uppercase tracking-wider text-[#646464] hover:bg-[#FFFBF3] transition cursor-pointer"
              >
                Cancel
              </button>
              <button
                type="button"
                onClick={() => void confirmRejectOrder()}
                className="rounded-full bg-[#A32A2A] px-5 py-2 text-xs font-bold uppercase tracking-wider text-white hover:bg-red-700 transition cursor-pointer"
              >
                Reject
              </button>
            </div>
          </div>
        </div>
      )}
    </section>
  );
}
