"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import { authedFetch, authedPost } from "@/lib/dashboard-fetch";
import { useRealtimeTables } from "@/hooks/useRealtimeTables";
import { Download, Copy, Check, X, Eye, RefreshCw, Loader2, Search, FileText } from "lucide-react";
import { toast } from "@/lib/toast";
import { formatIstSqlDateTime, formatOrderDate, formatOrderTime, toUtcIso } from "@/src/lib/datetime";
import { isConfirmedPickupRequest } from "@/src/server/modules/shipping/shiprocket-status";
import { assessPackageMeasures, awbQuoteWarning } from "@/src/server/modules/shipping/package-measures";
import { isManualShipment, MANUAL_ORDER_STATUSES, orderStatusLabel, resolveCanonicalOrderStatus } from "@/src/lib/orders/manual-order-status";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import {
  Tooltip,
  TooltipContent,
  TooltipProvider,
  TooltipTrigger,
} from "@/components/ui/tooltip";

const STORAGE_KEY_SERVICEABLE = "ziply5_admin_serviceable_order_ids";
const STORAGE_KEY_UNSERVICEABLE = "ziply5_admin_unserviceable_order_ids";

const parseRawResponse = (raw: unknown): Record<string, any> | null => {
  if (!raw) return null;
  if (typeof raw === "object") return raw as Record<string, any>;
  if (typeof raw === "string") {
    try {
      return JSON.parse(raw);
    } catch {
      return null;
    }
  }
  return null;
};

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
  shiprocketOrderId?: string | null;
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
  shiprocketRawResponse?: {
    serviceability?: {
      isServiceable?: boolean;
      serviceable?: boolean;
      availableCouriers?: number;
      courierCount?: number;
      checkedAt?: string;
      reason?: string;
    } | null;
    [key: string]: unknown;
  } | null;
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
  const [statusTab, setStatusTab] = useState<"all" | "new" | "confirmed" | "packed" | "shipped" | "in_transit" | "delivered" | "rejected" | "cancelled">("all");
  const [paymentFilter, setPaymentFilter] = useState("all");
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
  const [serviceableIds, setServiceableIds] = useState<Record<string, boolean>>(() => {
    if (typeof window === "undefined") return {};
    try {
      const stored = localStorage.getItem(STORAGE_KEY_SERVICEABLE);
      return stored ? JSON.parse(stored) : {};
    } catch {
      return {};
    }
  });
  const [unserviceableIds, setUnserviceableIds] = useState<Record<string, boolean>>(() => {
    if (typeof window === "undefined") return {};
    try {
      const stored = localStorage.getItem(STORAGE_KEY_UNSERVICEABLE);
      return stored ? JSON.parse(stored) : {};
    } catch {
      return {};
    }
  });

  useEffect(() => {
    try {
      const storedS = localStorage.getItem(STORAGE_KEY_SERVICEABLE);
      if (storedS) {
        const parsed = JSON.parse(storedS);
        if (parsed && typeof parsed === "object") setServiceableIds((prev) => ({ ...prev, ...parsed }));
      }
      const storedU = localStorage.getItem(STORAGE_KEY_UNSERVICEABLE);
      if (storedU) {
        const parsed = JSON.parse(storedU);
        if (parsed && typeof parsed === "object") setUnserviceableIds((prev) => ({ ...prev, ...parsed }));
      }
    } catch {}
  }, []);

  const isOrderServiceable = useCallback((o: OrderRow) => {
    if (serviceableIds[o.id]) return true;
    const raw = parseRawResponse(o.shiprocketRawResponse ?? (o as any).shiprocket_raw_response);
    const s = raw?.serviceability ?? raw?.response?.serviceability ?? raw?.data?.serviceability;
    if (s) {
      if (s.isServiceable === true || s.serviceable === true || (Array.isArray(s.availableCouriers) && s.availableCouriers.length > 0) || (typeof s.availableCouriers === "number" && s.availableCouriers > 0) || (typeof s.courierCount === "number" && s.courierCount > 0)) {
        return true;
      }
    }
    if (raw?.isServiceable === true || raw?.serviceable === true) return true;
    return false;
  }, [serviceableIds]);

  const isOrderUnserviceable = useCallback((o: OrderRow) => {
    if (unserviceableIds[o.id]) return true;
    if (rowActionError[o.id] && /not serviceable|manual shipment|non-serviceable/i.test(rowActionError[o.id])) return true;
    if (o.statusHistory?.some((h) => /not serviceable|manual shipment|non-serviceable/i.test(h.notes || h.reasonCode || ""))) return true;
    const raw = parseRawResponse(o.shiprocketRawResponse ?? (o as any).shiprocket_raw_response);
    const s = raw?.serviceability ?? raw?.response?.serviceability ?? raw?.data?.serviceability;
    if (s) {
      if (s.isServiceable === false || s.serviceable === false || (Array.isArray(s.availableCouriers) && s.availableCouriers.length === 0) || s.availableCouriers === 0 || s.courierCount === 0) {
        return true;
      }
    }
    if (raw?.isServiceable === false || raw?.serviceable === false) return true;
    return false;
  }, [unserviceableIds, rowActionError]);
  const [manualModal, setManualModal] = useState<{
    orderId: string;
    courier: string;
    trackingId: string;
    trackingUrl: string;
    slipUrl?: string;
    slipName?: string;
  } | null>(null);
  const [uploadingSlip, setUploadingSlip] = useState(false);

  const handleSlipUpload = async (file: File) => {
    const MAX_FILE_SIZE = 2 * 1024 * 1024; // 2MB
    if (file.size > MAX_FILE_SIZE) {
      toast.error("File too large", "File size must be 2MB or less.");
      return;
    }
    const isPdf = file.type === "application/pdf" || file.name.toLowerCase().endsWith(".pdf");
    const isImage = file.type.startsWith("image/") || /\.(jpg|jpeg|png|webp|gif|svg)$/i.test(file.name);
    if (!isPdf && !isImage) {
      toast.error("Invalid file format", "Only image files (JPG, PNG, WEBP) and PDF are allowed.");
      return;
    }

    setUploadingSlip(true);
    try {
      const token = typeof window !== "undefined" ? window.localStorage.getItem("ziply5_access_token") : null;
      const formData = new FormData();
      formData.append("file", file);
      formData.append("folder", "orders/manual-shipments");
      const res = await fetch("/api/v1/uploads", {
        method: "POST",
        headers: token ? { Authorization: `Bearer ${token}` } : undefined,
        body: formData,
      });
      const data = await res.json();
      if (!res.ok || data.success === false) {
        throw new Error(data.message || "Failed to upload shipment slip");
      }
      const url = data.data?.files?.[0]?.url;
      if (!url) throw new Error("No URL returned from upload");
      setManualModal((prev) => (prev ? { ...prev, slipUrl: url, slipName: file.name } : null));
      toast.success("Shipment slip uploaded");
    } catch (err) {
      toast.error("Upload failed", err instanceof Error ? err.message : "Failed to upload shipment slip");
    } finally {
      setUploadingSlip(false);
    }
  };
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
    if (m === "cod") return "COD";
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

  const getOrderStatusBadge = (status: string, statusHistory?: OrderRow["statusHistory"]) => {
    const canonical = resolveCanonicalOrderStatus(status, statusHistory);

    if (canonical === "rejected") {
      return (
        <span className="inline-flex items-center gap-1.5 rounded-full border border-red-200 bg-red-50 px-2.5 py-0.5 text-xs font-semibold text-red-700 capitalize">
          <span className="h-1.5 w-1.5 rounded-full bg-red-500" />
          Rejected
        </span>
      );
    }

    if (canonical === "cancelled") {
      return (
        <span className="inline-flex items-center gap-1.5 rounded-full border border-gray-200 bg-gray-50 px-2.5 py-0.5 text-xs font-semibold text-gray-700 capitalize">
          <span className="h-1.5 w-1.5 rounded-full bg-gray-500" />
          Cancelled
        </span>
      );
    }

    if (canonical === "accepted") {
      return (
        <span className="inline-flex items-center gap-1.5 rounded-full border border-emerald-200 bg-emerald-50 px-2.5 py-0.5 text-xs font-semibold text-emerald-700 capitalize">
          <span className="h-1.5 w-1.5 rounded-full bg-emerald-500" />
          Accepted
        </span>
      );
    }

    return (
      <span className="inline-flex items-center gap-1.5 rounded-full border border-amber-300 bg-amber-50 px-2.5 py-0.5 text-xs font-semibold text-amber-800 capitalize">
        <span className="h-1.5 w-1.5 rounded-full bg-amber-500" />
        Pending
      </span>
    );
  };

  const getShipmentStatusBadge = (status: string) => {
    const s = status.toLowerCase().trim();

    if (s === "delivered") {
      return (
        <span className="inline-flex items-center gap-1.5 rounded-full border border-emerald-200 bg-emerald-50 px-2.5 py-0.5 text-xs font-semibold capitalize text-emerald-700">
          <span className="h-1.5 w-1.5 rounded-full bg-emerald-500" />
          Delivered
        </span>
      );
    }

    if (s === "shipped") {
      return (
        <span className="inline-flex items-center gap-1.5 rounded-full border border-blue-200 bg-blue-50 px-2.5 py-0.5 text-xs font-semibold capitalize text-blue-700">
          <span className="h-1.5 w-1.5 rounded-full bg-blue-500" />
          Shipped
        </span>
      );
    }

    if (s === "in_transit" || s === "out_for_delivery") {
      return (
        <span className="inline-flex items-center gap-1.5 rounded-full border border-indigo-200 bg-indigo-50 px-2.5 py-0.5 text-xs font-semibold capitalize text-indigo-700">
          <span className="h-1.5 w-1.5 rounded-full bg-indigo-500" />
          {orderStatusLabel(s)}
        </span>
      );
    }

    if (s === "cancelled" || s === "returned" || s === "rto") {
      return (
        <span className="inline-flex items-center gap-1.5 rounded-full border border-rose-200 bg-rose-50 px-2.5 py-0.5 text-xs font-semibold capitalize text-rose-700">
          <span className="h-1.5 w-1.5 rounded-full bg-rose-500" />
          {orderStatusLabel(s)}
        </span>
      );
    }

    if (s === "shipment_created" || s === "manifest_generated" || s === "pickup_generated" || s === "ready_to_ship") {
      return (
        <span className="inline-flex items-center gap-1.5 rounded-full border border-cyan-200 bg-cyan-50 px-2.5 py-0.5 text-xs font-semibold capitalize text-cyan-700">
          <span className="h-1.5 w-1.5 rounded-full bg-cyan-500" />
          {orderStatusLabel(s)}
        </span>
      );
    }

    return (
      <span className="inline-flex items-center gap-1.5 rounded-full border border-slate-200 bg-slate-100 px-2.5 py-0.5 text-xs font-medium capitalize text-slate-700">
        <span className="h-1.5 w-1.5 rounded-full bg-slate-400" />
        {!s || s === "not_shipped" ? "Not Shipped" : orderStatusLabel(s)}
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
    const isPaid =
      o.transactions?.some((t) => /paid|captured|success|settled/i.test(t.status ?? "")) ||
      (o.paymentStatus ?? "").toUpperCase() === "SUCCESS" ||
      (o.paymentStatus ?? "").toUpperCase() === "PAID";
    if (isPaid) return "success";
    const isCod = String(o.paymentMethod ?? (o as any).gateway ?? "").trim().toLowerCase() === "cod";
    if (isCod) return "cod";
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
      packed: 0,
      shipped: 0,
      in_transit: 0,
      delivered: 0,
      rejected: 0,
      cancelled: 0,
    };
    rows.forEach((o) => {
      const isCod = String(o.paymentMethod ?? (o as any).gateway ?? "").trim().toLowerCase() === "cod";
      const isPaid = toPaymentStatus(o) === "success" || String(o.paymentStatus ?? "").toUpperCase() === "SUCCESS" || String(o.paymentStatus ?? "").toUpperCase() === "PAID";
      if (!isCod && !isPaid) return;

      const lc = lifecycleStatus(o);
      const sh = latestShipmentStatus(o);
      if (sh === "cancelled") {
        counts.cancelled++;
        return;
      }
      if (["pending", "pending_payment", "payment_success", "admin_approval_pending", "new"].includes(lc)) {
        counts.new++;
      }
      if (lc === "confirmed" && sh !== "packed") {
        counts.confirmed++;
      }
      if (lc === "packed" || sh === "packed") {
        counts.packed++;
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
  }, [rows, lifecycleStatus, latestShipmentStatus, toPaymentStatus]);

  const filteredRows = useMemo(() => {
    const rawTerm = searchTerm.trim();
    const term = rawTerm.toLowerCase();
    const cleanTerm = term.replace(/^#+/, "").trim();
    const alphaNumTerm = cleanTerm.replace(/[^a-z0-9]/g, "");

    let list = rows.filter((o) => {
      const isCod = String(o.paymentMethod ?? (o as any).gateway ?? "").trim().toLowerCase() === "cod";
      const isPaid = toPaymentStatus(o) === "success" || String(o.paymentStatus ?? "").toUpperCase() === "SUCCESS" || String(o.paymentStatus ?? "").toUpperCase() === "PAID";
      if (!isCod && !isPaid) return false;

      const payment = toPaymentStatus(o);
      const lifecycle = lifecycleStatus(o);
      const ship = latestShipmentStatus(o);
      const date = new Date(toUtcIso(o.createdAt) ?? o.createdAt);

      if (ship === "cancelled") {
        if (statusTab !== "all" && statusTab !== "cancelled") return false;
      } else if (statusTab !== "all") {
        if (statusTab === "new" && !["pending", "pending_payment", "payment_success", "admin_approval_pending", "new"].includes(lifecycle)) return false;
        if (statusTab === "confirmed" && (lifecycle !== "confirmed" || ship === "packed")) return false;
        if (statusTab === "packed" && lifecycle !== "packed" && ship !== "packed") return false;
        if (statusTab === "shipped" && (lifecycle !== "shipped" && ship !== "shipped" || ["in_transit", "out_for_delivery", "delivered"].includes(ship) || ["in_transit", "delivered"].includes(lifecycle))) return false;
        if (statusTab === "in_transit" && lifecycle !== "in_transit" && !["in_transit", "out_for_delivery"].includes(ship)) return false;
        if (statusTab === "delivered" && lifecycle !== "delivered" && ship !== "delivered" && !o.fulfillment?.deliveredAt) return false;
        if (statusTab === "rejected" && lifecycle !== "rejected") return false;
        if (statusTab === "cancelled" && lifecycle !== "cancelled") return false;
      }

      if (paymentFilter !== "all" && payment !== paymentFilter) return false;
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
  }, [rows, searchTerm, statusTab, paymentFilter, dateFrom, dateTo, sortBy, toPaymentStatus, lifecycleStatus, latestShipmentStatus]);

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
      .then((d) => {
        setRows(d.items);
        const newServiceable: Record<string, boolean> = {};
        const newUnserviceable: Record<string, boolean> = {};
        for (const item of d.items) {
          const raw = parseRawResponse(item.shiprocketRawResponse ?? (item as any).shiprocket_raw_response);
          const s = raw?.serviceability ?? raw?.response?.serviceability ?? raw?.data?.serviceability;
          if (s) {
            if (s.isServiceable === true || s.serviceable === true || (Array.isArray(s.availableCouriers) && s.availableCouriers.length > 0) || (typeof s.availableCouriers === "number" && s.availableCouriers > 0) || (typeof s.courierCount === "number" && s.courierCount > 0)) {
              newServiceable[item.id] = true;
            } else if (s.isServiceable === false || s.serviceable === false || (Array.isArray(s.availableCouriers) && s.availableCouriers.length === 0) || s.availableCouriers === 0 || s.courierCount === 0) {
              newUnserviceable[item.id] = true;
            }
          }
          if (raw?.isServiceable === true || raw?.serviceable === true) {
            newServiceable[item.id] = true;
          } else if (raw?.isServiceable === false || raw?.serviceable === false) {
            newUnserviceable[item.id] = true;
          }
        }
        if (Object.keys(newServiceable).length > 0) {
          setServiceableIds((prev) => {
            const merged = { ...prev, ...newServiceable };
            try { localStorage.setItem(STORAGE_KEY_SERVICEABLE, JSON.stringify(merged)); } catch {}
            return merged;
          });
        }
        if (Object.keys(newUnserviceable).length > 0) {
          setUnserviceableIds((prev) => {
            const merged = { ...prev, ...newUnserviceable };
            try { localStorage.setItem(STORAGE_KEY_UNSERVICEABLE, JSON.stringify(merged)); } catch {}
            return merged;
          });
        }
      })
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
  }, [searchTerm, paymentFilter, dateFrom, dateTo, sortBy, pageSize]);

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
        results?: Array<{ orderId: string; status: string; reason?: string; isUnserviceable?: boolean }>
      }>("/api/v1/orders/shiprocket/sync", {
        orderIds,
        generatePickup: false,
        retryFailedOnly,
      });
      setSyncProgress({ total: data.total, synced: data.synced, failed: data.failed, skipped: data.skipped });
      if (Array.isArray(data.results)) {
        for (const res of data.results) {
          if (res.status === "failed") {
            const reason = res.reason ?? "";
            if (/not serviceable|manual shipment|non-serviceable/i.test(reason) || res.isUnserviceable) {
              setUnserviceableIds((prev) => {
                const next = { ...prev, [res.orderId]: true };
                try { localStorage.setItem(STORAGE_KEY_UNSERVICEABLE, JSON.stringify(next)); } catch {}
                return next;
              });
              setServiceableIds((prev) => {
                const next = { ...prev };
                delete next[res.orderId];
                try { localStorage.setItem(STORAGE_KEY_SERVICEABLE, JSON.stringify(next)); } catch {}
                return next;
              });
              setRowActionError((prev) => ({ ...prev, [res.orderId]: "This order is not serviceable please proceed with manual shipment" }));
            } else if (/firstly accept|not accepted|not confirmed|approval/i.test(reason)) {
              setRowActionError((prev) => ({ ...prev, [res.orderId]: "Firstly accept order and check for serviceability" }));
            } else if (reason) {
              setRowActionError((prev) => ({ ...prev, [res.orderId]: reason }));
            }
          }
        }
      }
      setSelectedIds([]);
      await load();
    } catch (e) {
      const msg = e instanceof Error ? e.message : "Bulk sync failed";
      setError(msg);
      toast.error("Bulk sync failed", msg);
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
          setServiceableIds((prev) => {
            const next = { ...prev, [orderId]: true };
            try { localStorage.setItem(STORAGE_KEY_SERVICEABLE, JSON.stringify(next)); } catch {}
            return next;
          });
          setUnserviceableIds((prev) => {
            const next = { ...prev };
            delete next[orderId];
            try { localStorage.setItem(STORAGE_KEY_UNSERVICEABLE, JSON.stringify(next)); } catch {}
            return next;
          });
          setRows((prev) =>
            prev.map((r) =>
              r.id === orderId
                ? {
                    ...r,
                    shiprocketRawResponse: {
                      ...(typeof r.shiprocketRawResponse === "object" && r.shiprocketRawResponse ? r.shiprocketRawResponse : {}),
                      serviceability: { isServiceable: true, serviceable: true, courierCount: count },
                    },
                  }
                : r
            )
          );
          setUnserviceable(null);
          toast.success("Serviceable", `${count} courier${count === 1 ? "" : "s"} can deliver this order.`);
        } else {
          setServiceableIds((prev) => {
            const next = { ...prev };
            delete next[orderId];
            try { localStorage.setItem(STORAGE_KEY_SERVICEABLE, JSON.stringify(next)); } catch {}
            return next;
          });
          setUnserviceableIds((prev) => {
            const next = { ...prev, [orderId]: true };
            try { localStorage.setItem(STORAGE_KEY_UNSERVICEABLE, JSON.stringify(next)); } catch {}
            return next;
          });
          setRows((prev) =>
            prev.map((r) =>
              r.id === orderId
                ? {
                    ...r,
                    shiprocketRawResponse: {
                      ...(typeof r.shiprocketRawResponse === "object" && r.shiprocketRawResponse ? r.shiprocketRawResponse : {}),
                      serviceability: { isServiceable: false, serviceable: false, courierCount: 0 },
                    },
                  }
                : r
            )
          );
          const userMsg = "This order is not serviceable please proceed with manual shipment";
          setUnserviceable({ orderId, reason: userMsg });
          setRowActionError((prev) => ({ ...prev, [orderId]: userMsg }));
          toast.error("Not serviceable", userMsg);
        }
      } catch (e) {
        setServiceableIds((prev) => {
          const next = { ...prev };
          delete next[orderId];
          try { localStorage.setItem(STORAGE_KEY_SERVICEABLE, JSON.stringify(next)); } catch {}
          return next;
        });
        setUnserviceableIds((prev) => {
          const next = { ...prev, [orderId]: true };
          try { localStorage.setItem(STORAGE_KEY_UNSERVICEABLE, JSON.stringify(next)); } catch {}
          return next;
        });
        setRows((prev) =>
          prev.map((r) =>
            r.id === orderId
              ? {
                  ...r,
                  shiprocketRawResponse: {
                    ...(typeof r.shiprocketRawResponse === "object" && r.shiprocketRawResponse ? r.shiprocketRawResponse : {}),
                    serviceability: { isServiceable: false, serviceable: false, courierCount: 0 },
                  },
                }
              : r
          )
        );
        const userMsg = "This order is not serviceable please proceed with manual shipment";
        setUnserviceable({ orderId, reason: userMsg });
        setRowActionError((prev) => ({ ...prev, [orderId]: userMsg }));
        toast.error("Not serviceable", userMsg);
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
      try {
        await authedPost(`/api/v1/orders/${orderId}/shiprocket`, { action: "sync_order", panelSync: true, generatePickup: false });
        setServiceableIds((prev) => {
          const next = { ...prev };
          delete next[orderId];
          try { localStorage.setItem(STORAGE_KEY_SERVICEABLE, JSON.stringify(next)); } catch {}
          return next;
        });
        toast.success("Synced from Shiprocket", "Order status and shipment status now match Shiprocket. Finish AWB, pickup, and label in the Shiprocket panel, then sync again.");
      } catch (e) {
        const msg = e instanceof Error ? e.message : "Sync failed";
        if (/firstly accept|not accepted|not confirmed|approval/i.test(msg)) {
          const userMsg = "Firstly accept order and check for serviceability";
          setRowActionError((prev) => ({ ...prev, [orderId]: userMsg }));
          toast.error("Order not accepted", userMsg);
          throw new Error(userMsg);
        } else if (/not serviceable|manual shipment|non-serviceable/i.test(msg)) {
          const userMsg = "This order is not serviceable please proceed with manual shipment";
          setServiceableIds((prev) => {
            const next = { ...prev };
            delete next[orderId];
            try { localStorage.setItem(STORAGE_KEY_SERVICEABLE, JSON.stringify(next)); } catch {}
            return next;
          });
          setUnserviceableIds((prev) => {
            const next = { ...prev, [orderId]: true };
            try { localStorage.setItem(STORAGE_KEY_UNSERVICEABLE, JSON.stringify(next)); } catch {}
            return next;
          });
          setRowActionError((prev) => ({ ...prev, [orderId]: userMsg }));
          setUnserviceable({ orderId, reason: userMsg });
          toast.error("Not serviceable", userMsg);
          throw new Error(userMsg);
        } else {
          setRowActionError((prev) => ({ ...prev, [orderId]: msg }));
          toast.error("Sync failed", msg);
          throw e;
        }
      }
    });

  const saveManualShipment = () => {
    if (!manualModal) return;
    const courier = manualModal.courier.trim();
    const trackingId = manualModal.trackingId.trim();
    const trackingUrl = manualModal.trackingUrl.trim();
    const slipUrl = manualModal.slipUrl?.trim() || undefined;
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
        slipUrl,
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
      getPaymentMethodLabel(o.paymentMethod),
      toPaymentStatus(o) === "success" ? "Payment Success" : toPaymentStatus(o) === "cod" ? "COD" : toPaymentStatus(o),
      resolveCanonicalOrderStatus(lifecycleStatus(o), o.statusHistory),
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
    <TooltipProvider delayDuration={150}>
      <section className="w-full space-y-5">
      <div className="rounded-2xl border border-[#E8DCC8] bg-white p-5 shadow-sm">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div>
            <h1 className="font-melon text-2xl font-bold text-[#4A1D1F]">Orders List</h1>
            <p className="text-sm text-[#646464]">Production order feed with payment, lifecycle, and shipment visibility.</p>
          </div>
          <div className="flex flex-wrap items-center gap-2">
            <button type="button" onClick={() => load()} disabled={!canFetch} className="rounded-full bg-[#2DA66D] px-5 py-2 text-xs font-bold uppercase tracking-wider text-white hover:brightness-95 disabled:opacity-50">REFRESH</button>
            <button type="button" onClick={exportCsv} className="inline-flex items-center gap-1.5 rounded-full border border-[#E8DCC8] bg-white px-4 py-2 text-xs font-bold uppercase tracking-wider text-[#7B3010] hover:bg-[#FFFBF3]">
              <Download className="h-4 w-4" /> EXPORT CSV
            </button>
          </div>
        </div>

        {/* Status Filter Tabs */}
        <div className="mt-4 flex flex-nowrap items-center gap-2 overflow-x-auto rounded-2xl border border-[#E8DCC8] bg-[#FFFBF3] p-2.5 shadow-xs scrollbar-hide scroll-smooth">
          {[
            { id: "all" as const, label: "All Orders", count: statusTabCounts.all },
            { id: "new" as const, label: "New Orders", count: statusTabCounts.new },
            { id: "confirmed" as const, label: "Confirmed Orders", count: statusTabCounts.confirmed },
            { id: "packed" as const, label: "Packed Orders", count: statusTabCounts.packed },
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
                className={`inline-flex shrink-0 whitespace-nowrap items-center gap-2 rounded-xl px-3.5 py-2 text-xs font-semibold transition cursor-pointer ${
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

        {/* Horizontal Filters Bar with Proportional Sizing */}
        <div className="mt-4 flex flex-wrap items-end gap-3">
          <div className="flex-1 min-w-[260px]">
            <label className="text-xs font-semibold text-[#646464]">Search</label>
            <div className="relative mt-1">
              <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-3.5 w-3.5 text-[#8A8A8A]" />
              <input
                type="text"
                placeholder="Search by order ID, #ID, customer, phone..."
                value={searchTerm}
                onChange={(e) => setSearchTerm(e.target.value)}
                className="!h-9 !py-0 box-border w-full rounded-2xl border border-[#E3E3DA] bg-white pl-8 pr-8 text-xs text-[#4A1D1F] placeholder-[#8A8A8A] focus:border-[#7B3010] focus:outline-none"
              />
              {searchTerm && (
                <button
                  type="button"
                  onClick={() => setSearchTerm("")}
                  className="absolute right-2.5 top-1/2 -translate-y-1/2 rounded-full p-0.5 text-[#8A8A8A] hover:bg-[#F3F4F6] hover:text-[#4A1D1F]"
                  title="Clear search"
                >
                  <X className="h-3.5 w-3.5" />
                </button>
              )}
            </div>
          </div>

          <div className="w-full sm:w-[130px]">
            <label className="text-xs font-semibold text-[#646464]">Payment Status</label>
            <div className="mt-1">
              <Select value={paymentFilter} onValueChange={setPaymentFilter}>
                <SelectTrigger className="!h-9 !py-0 box-border w-full rounded-2xl border border-[#E3E3DA] bg-white px-3 text-xs text-[#4A1D1F] shadow-none focus:border-[#7B3010] focus:outline-none focus:ring-0 focus-visible:ring-0">
                  <SelectValue placeholder="All" />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="all">All</SelectItem>
                  <SelectItem value="cod">COD</SelectItem>
                  <SelectItem value="success">Success</SelectItem>
                </SelectContent>
              </Select>
            </div>
          </div>

          <div className="w-full sm:w-[145px]">
            <label className="text-xs font-semibold text-[#646464]">Date From</label>
            <input
              type="date"
              value={dateFrom}
              onChange={(e) => setDateFrom(e.target.value)}
              className="mt-1 !h-9 !py-0 leading-[36px] box-border w-full rounded-2xl border border-[#E3E3DA] bg-white px-3 text-xs text-[#4A1D1F] focus:border-[#7B3010] focus:outline-none [&::-webkit-date-and-time-value]:min-h-0 [&::-webkit-date-and-time-value]:m-0"
            />
          </div>

          <div className="w-full sm:w-[145px]">
            <label className="text-xs font-semibold text-[#646464]">Date To</label>
            <input
              type="date"
              value={dateTo}
              onChange={(e) => setDateTo(e.target.value)}
              className="mt-1 !h-9 !py-0 leading-[36px] box-border w-full rounded-2xl border border-[#E3E3DA] bg-white px-3 text-xs text-[#4A1D1F] focus:border-[#7B3010] focus:outline-none [&::-webkit-date-and-time-value]:min-h-0 [&::-webkit-date-and-time-value]:m-0"
            />
          </div>

          <div className="w-full sm:w-[145px]">
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

          <div className="w-full sm:w-[115px]">
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
                              Payment Success
                            </span>
                          ) : toPaymentStatus(o) === "cod" ? (
                            <span className="inline-flex items-center gap-1.5 rounded-full border border-amber-200 bg-amber-50 px-2.5 py-0.5 text-xs font-semibold text-amber-800">
                              <span className="h-1.5 w-1.5 rounded-full bg-amber-500" />
                              COD
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
                        {getOrderStatusBadge(lifecycleStatus(o), o.statusHistory)}
                      </div>
                    </td>
                    <td className="px-2 py-2">
                      <div className="min-w-[130px]">
                        {getShipmentStatusBadge(latestShipmentStatus(o))}
                      </div>
                    </td>
                    <td className="px-2 py-2 font-semibold">Rs.{Number(o.total).toFixed(2)}</td>
                    <td className="px-2 py-2 text-center font-medium">{itemsCount(o)}</td>
                    <td className="px-3 py-2 text-right">
                      <div className="flex items-center justify-end gap-1.5">
                        <Tooltip>
                          <TooltipTrigger asChild>
                            <button
                              type="button"
                              onClick={() => router.push(`/admin/orders/${o.id}`)}
                              title="View Order Details"
                              aria-label="View Order Details"
                              className="inline-flex items-center justify-center rounded-full border border-[#7B3010] bg-[#FFF7EA] p-1.5 text-[#7B3010] shadow-sm hover:bg-[#7B3010] hover:text-white transition cursor-pointer"
                            >
                              <Eye className="h-3.5 w-3.5" />
                            </button>
                          </TooltipTrigger>
                          <TooltipContent side="top">
                            <p className="text-xs font-semibold">View Order Details</p>
                          </TooltipContent>
                        </Tooltip>
                        {(() => {
                          const shipCancelled = latestShipmentStatus(o) === "cancelled";
                          const lc = lifecycleStatus(o);
                          const manual = isManualShipment({ shipmentNo: o.shipmentNo ?? o.shipments?.[0]?.shipmentNo, shippingMethod: o.shippingMethod });
                          if (shipCancelled || lc === "cancelled" || lc === "rejected" || manual) {
                            return null;
                          }

                          // 1. Flow stage: ACCEPT (order not yet accepted by admin)
                          const isNewOrder = ["pending", "pending_payment", "payment_success", "admin_approval_pending", "new"].includes(lc);
                          if (isNewOrder) {
                            return (
                              <div className="inline-flex items-center gap-1.5 justify-end">
                                <button
                                  type="button"
                                  disabled={Boolean(rowActionBusy[o.id])}
                                  onClick={() => void handleApprovalAction(o.id, "approve_order")}
                                  title="Accept Order"
                                  aria-label="Accept Order"
                                  className="h-7 w-7 inline-flex items-center justify-center rounded-full bg-[#2DA66D] text-white shadow-sm hover:brightness-95 disabled:cursor-not-allowed disabled:opacity-50 transition cursor-pointer shrink-0"
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
                                  aria-label="Reject Order"
                                  className="h-7 w-7 inline-flex items-center justify-center rounded-full bg-[#A32A2A] text-white shadow-sm hover:brightness-95 disabled:cursor-not-allowed disabled:opacity-50 transition cursor-pointer shrink-0"
                                >
                                  {rowActionBusy[o.id] === "reject_order" ? (
                                    <Loader2 className="h-3.5 w-3.5 animate-spin" />
                                  ) : (
                                    <X className="h-3.5 w-3.5" />
                                  )}
                                </button>
                              </div>
                            );
                          }

                          // 4. Flow stage: REFRESH (shipment exists or order already synced/shipped)
                          const hasExistingShipment = hasShipment(o) || ["shipped", "in_transit", "out_for_delivery", "delivered"].includes(lc);
                          if (hasExistingShipment) {
                            return (
                              <button
                                type="button"
                                disabled={Boolean(rowActionBusy[o.id])}
                                onClick={() => void syncFromShiprocket(o.id)}
                                title="Refresh tracking & shipment status from Shiprocket"
                                className="cursor-pointer rounded-full border border-[#16803C] bg-[#F0FDF4] px-2.5 py-1 text-[10px] font-bold uppercase text-[#16803C] hover:bg-[#16803C] hover:text-white disabled:cursor-not-allowed disabled:opacity-50 transition inline-flex items-center gap-1"
                              >
                                {rowActionBusy[o.id] === "sync" ? (
                                  <>
                                    <Loader2 className="h-3 w-3 animate-spin" />
                                    <span>Refreshing...</span>
                                  </>
                                ) : (
                                  <>
                                    <RefreshCw className="h-3 w-3" />
                                    <span>Refresh</span>
                                  </>
                                )}
                              </button>
                            );
                          }

                          // If unserviceable -> MANUAL SHIPMENT button
                          if (isOrderUnserviceable(o)) {
                            return (
                              <button
                                type="button"
                                disabled={Boolean(rowActionBusy[o.id])}
                                onClick={() => setManualModal({ orderId: o.id, courier: "", trackingId: "", trackingUrl: "", slipUrl: "", slipName: "" })}
                                title="Order is not serviceable via Shiprocket. Proceed with manual shipment."
                                className="cursor-pointer rounded-full border border-[#7B3010] bg-[#FFF7ED] px-2.5 py-1 text-[10px] font-bold uppercase text-[#7B3010] hover:bg-[#7B3010] hover:text-white disabled:cursor-not-allowed disabled:opacity-50 transition"
                              >
                                Manual shipment
                              </button>
                            );
                          }

                          // 3. Flow stage: SYNC (serviceable verified, ready to sync to Shiprocket)
                          if (isOrderServiceable(o)) {
                            return (
                              <button
                                type="button"
                                disabled={Boolean(rowActionBusy[o.id])}
                                onClick={() => void syncFromShiprocket(o.id)}
                                title="Sync order to Shiprocket"
                                className="cursor-pointer rounded-full bg-[#16803C] px-2.5 py-1 text-[10px] font-bold uppercase text-white hover:brightness-95 disabled:cursor-not-allowed disabled:opacity-50 transition inline-flex items-center gap-1 shadow-sm"
                              >
                                {rowActionBusy[o.id] === "sync" ? (
                                  <>
                                    <Loader2 className="h-3 w-3 animate-spin" />
                                    <span>Syncing...</span>
                                  </>
                                ) : (
                                  <>
                                    <RefreshCw className="h-3 w-3" />
                                    <span>Sync now</span>
                                  </>
                                )}
                              </button>
                            );
                          }

                          // 2. Flow stage: CHECK SERVICEABILITY (accepted order, serviceability not checked yet)
                          if (["confirmed", "packed"].includes(lc)) {
                            return (
                              <button
                                type="button"
                                disabled={Boolean(rowActionBusy[o.id])}
                                onClick={() => void checkServiceability(o.id)}
                                title="Check courier serviceability with Shiprocket"
                                className="cursor-pointer rounded-full border border-[#7B3010] bg-[#FFF7ED] px-2.5 py-1 text-[10px] font-bold uppercase text-[#7B3010] hover:bg-[#7B3010] hover:text-white disabled:cursor-not-allowed disabled:opacity-50 transition"
                              >
                                {rowActionBusy[o.id] === "serviceability" ? (
                                  <span className="inline-flex items-center gap-1">
                                    <Loader2 className="h-3 w-3 animate-spin" />
                                    <span>Checking...</span>
                                  </span>
                                ) : (
                                  "Check serviceability"
                                )}
                              </button>
                            );
                          }

                          return null;
                        })()}
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
              <button type="button" onClick={() => { setManualModal({ orderId: unserviceable.orderId, courier: "", trackingId: "", trackingUrl: "", slipUrl: "", slipName: "" }); setUnserviceable(null); }} className="cursor-pointer rounded-full bg-[#7B3010] px-4 py-2 text-xs font-semibold text-white">Manual shipment</button>
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
            <div>
              <label className="block text-xs font-semibold text-[#4A1D1F] mb-1">
                Upload Shipment Slip
              </label>
              {manualModal.slipUrl ? (
                <div className="flex items-center justify-between rounded-lg border border-[#E8DCC8] bg-[#FFFBF3] p-2.5">
                  <div className="flex items-center gap-2 overflow-hidden">
                    <FileText className="h-4 w-4 shrink-0 text-[#7B3010]" />
                    <a
                      href={manualModal.slipUrl}
                      target="_blank"
                      rel="noopener noreferrer"
                      className="truncate text-xs font-medium text-[#7B3010] hover:underline"
                    >
                      {manualModal.slipName || "View uploaded slip"}
                    </a>
                  </div>
                  <button
                    type="button"
                    onClick={() => setManualModal({ ...manualModal, slipUrl: "", slipName: "" })}
                    className="ml-2 text-xs font-semibold text-red-600 hover:text-red-700 cursor-pointer"
                  >
                    Remove
                  </button>
                </div>
              ) : (
                <div className="relative">
                  <div className="flex items-center justify-between rounded-lg border border-[#E8DCC8] bg-white px-3 py-2 text-xs hover:border-[#7B3010] transition-colors cursor-pointer">
                    <div className="flex items-center gap-2.5">
                      <span className="rounded-full bg-[#7B3010] px-3 py-1 font-semibold text-white shadow-xs">
                        Choose file
                      </span>
                      <span className="text-[#787878] text-[11px]">
                        Image (JPG, PNG) or PDF • Max 2MB
                      </span>
                    </div>
                  </div>
                  <input
                    type="file"
                    accept="image/*,application/pdf,.pdf"
                    disabled={uploadingSlip}
                    onChange={(e) => {
                      const file = e.target.files?.[0];
                      if (file) void handleSlipUpload(file);
                      e.target.value = "";
                    }}
                    className="absolute inset-0 cursor-pointer opacity-0"
                  />
                  {uploadingSlip && (
                    <div className="mt-1 flex items-center gap-1.5 text-xs text-[#7B3010]">
                      <Loader2 className="h-3.5 w-3.5 animate-spin" />
                      <span>Uploading shipment slip...</span>
                    </div>
                  )}
                </div>
              )}
            </div>
            <div className="flex justify-end gap-2">
              <button type="button" onClick={() => setManualModal(null)} className="cursor-pointer rounded-full border px-4 py-2 text-xs font-semibold">Cancel</button>
              <button type="button" disabled={Boolean(rowActionBusy[manualModal.orderId]) || uploadingSlip} onClick={saveManualShipment} className="cursor-pointer rounded-full bg-[#7B3010] px-4 py-2 text-xs font-semibold text-white disabled:opacity-50">
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
    </TooltipProvider>
  );
}
