"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import { authedFetch } from "@/lib/dashboard-fetch";
import { useRealtimeTables } from "@/hooks/useRealtimeTables";
import { generateAdminInvoicePDF } from "@/lib/invoice";
import { toast } from "@/lib/toast";
import {
  Coins,
  Tag,
  FileText,
  RotateCcw,
  RefreshCw,
  Download,
  Eye,
  Search,
  Calendar,
  ChevronDown,
  ChevronLeft,
  ChevronRight,
  CreditCard,
  Loader2,
} from "lucide-react";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";

type Summary = {
  grossSales: string | number;
  netRevenue: string | number;
  orderCount: number;
  refundsTotal: string | number;
};

type OrderRow = {
  id: string;
  status: string;
  currency?: string;
  subtotal?: string | number;
  tax?: string | number;
  shipping?: string | number;
  discount?: string | number;
  paymentStatus?: string | null;
  paymentMethod?: string | null;
  paymentId?: string | null;
  transactionId?: string | null;
  refNo?: string | null;
  total: string | number;
  createdAt: string;
  customerName?: string | null;
  customerPhone?: string | null;
  customerEmail?: string | null;
  customerAddress?: string | null;
  items?: Array<any>;
  transactions?: Array<any>;
  invoiceNo?: string;
  invoiceNumber?: string;
};

type TransactionItem = {
  id: string;
  orderId: string;
  date: string;
  rawDate: string;
  reference: string;
  type: "COD" | "Razorpay" | string;
  amount: number;
  status: "Paid" | "Pending" | "Failed" | string;
  orderNumber: string;
};

type InvoiceItem = {
  id: string;
  orderId: string;
  date: string;
  rawDate: string;
  invoiceNumber: string;
  orderNumber: string;
  amount: number;
  order: OrderRow;
};

function formatCurrency(amount: number | string): string {
  const num = Number(amount) || 0;
  return `Rs.${num.toLocaleString("en-IN", {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  })}`;
}

function formatTableDate(dateInput: string | Date | number): string {
  if (!dateInput) return "—";
  try {
    const d = new Date(dateInput);
    if (isNaN(d.getTime())) return "—";
    return new Intl.DateTimeFormat("en-GB", {
      day: "2-digit",
      month: "short",
      year: "numeric",
      timeZone: "Asia/Kolkata",
    }).format(d);
  } catch {
    return "—";
  }
}

function parseDateInput(str: string): Date | null {
  if (!str) return null;
  const trimmed = str.trim();
  if (trimmed.includes("/")) {
    const parts = trimmed.split("/");
    if (parts.length === 3) {
      const d = parseInt(parts[0], 10);
      const m = parseInt(parts[1], 10) - 1;
      const y = parseInt(parts[2], 10);
      const date = new Date(y, m, d);
      if (!isNaN(date.getTime())) return date;
    }
  }
  const d = new Date(trimmed);
  return isNaN(d.getTime()) ? null : d;
}

function formatDateToInput(d: Date): string {
  const day = String(d.getDate()).padStart(2, "0");
  const month = String(d.getMonth() + 1).padStart(2, "0");
  const year = d.getFullYear();
  return `${day}/${month}/${year}`;
}

function formatOrderDisplayNumber(orderId: string): string {
  if (!orderId) return "#ORD00000";
  const clean = String(orderId).replace(/^#/, "");
  if (clean.toUpperCase().startsWith("ORD")) {
    return `#${clean.toUpperCase()}`;
  }
  const digits = clean.replace(/\D/g, "");
  if (digits.length >= 5) {
    return `#ORD${digits.slice(-5)}`;
  }
  return `#ORD${clean.slice(0, 6).toUpperCase()}`;
}

function getInvoiceNumber(order: OrderRow, fallbackSeq: number): string {
  if (order.invoiceNo) return order.invoiceNo;
  if (order.invoiceNumber) return order.invoiceNumber;
  const year = order.createdAt ? new Date(order.createdAt).getFullYear() : 2026;
  const digits = String(order.id).replace(/\D/g, "");
  if (digits.length >= 6) {
    return `INV-${year}-${digits.slice(-6)}`;
  }
  const seq = String(fallbackSeq).padStart(6, "0");
  return `INV-${year}-${seq}`;
}

const PAGE_SIZE = 8;

export default function AdminFinancePage() {
  const router = useRouter();
  const [activeTab, setActiveTab] = useState<"transactions" | "invoices">("invoices");

  const [summary, setSummary] = useState<Summary | null>(null);
  const [orders, setOrders] = useState<OrderRow[]>([]);
  const [apiTransactions, setApiTransactions] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [error, setError] = useState("");

  // Filters State
  const [fromDate, setFromDate] = useState("");
  const [toDate, setToDate] = useState("");
  const [searchQuery, setSearchQuery] = useState("");
  const [typeFilter, setTypeFilter] = useState("all");
  const [statusFilter, setStatusFilter] = useState("all");

  // Applied Filters State (committed on Search click)
  const [appliedFilters, setAppliedFilters] = useState({
    fromDate: "",
    toDate: "",
    search: "",
    type: "all",
    status: "all",
  });

  // Date Range Quick Preset Dropdown
  const [datePresetOpen, setDatePresetOpen] = useState(false);
  const [datePresetLabel, setDatePresetLabel] = useState("");

  // Invoices Selection & Downloading
  const [selectedInvoices, setSelectedInvoices] = useState<string[]>([]);
  const [downloadingId, setDownloadingId] = useState<string | null>(null);
  const [isBulkDownloading, setIsBulkDownloading] = useState(false);

  // Pagination
  const [invoicePage, setInvoicePage] = useState(1);
  const [transactionPage, setTransactionPage] = useState(1);

  // Set default initial date range (past 30 days up to today)
  useEffect(() => {
    const end = new Date();
    const start = new Date();
    start.setDate(end.getDate() - 30);
    const startStr = formatDateToInput(start);
    const endStr = formatDateToInput(end);
    setFromDate(startStr);
    setToDate(endStr);
    setDatePresetLabel(`${startStr} - ${endStr}`);
    // Note: initially we don't restrict appliedFilters unless user searches,
    // or we can allow all orders to be visible until filtered.
  }, []);

  const loadData = useCallback(async (isRefresh = false) => {
    if (isRefresh) setRefreshing(true);
    else setLoading(true);
    setError("");

    try {
      const [sumRes, ordRes, txRes] = await Promise.all([
        authedFetch<Summary>("/api/v1/finance/summary").catch(() => null),
        authedFetch<{ items: OrderRow[] } | OrderRow[]>("/api/v1/orders?page=1&limit=1000").catch(() => null),
        authedFetch<any[]>("/api/v1/finance/transactions").catch(() => []),
      ]);

      if (sumRes) {
        setSummary(sumRes);
      }

      const orderList: OrderRow[] = ordRes
        ? Array.isArray(ordRes)
          ? ordRes
          : Array.isArray((ordRes as any).items)
          ? (ordRes as any).items
          : []
        : [];

      setOrders(orderList);
      setApiTransactions(Array.isArray(txRes) ? txRes : []);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Failed to load finance data");
    } finally {
      setLoading(false);
      setRefreshing(false);
    }
  }, []);

  useEffect(() => {
    loadData();
  }, [loadData]);

  useRealtimeTables({
    tables: ["orders", "transactions", "refunds"],
    onChange: () => {
      void loadData(true);
    },
  });

  // Build Invoices list from orders
  const invoicesList: InvoiceItem[] = useMemo(() => {
    return orders.map((order, idx) => {
      const seq = 1256 - idx; // graceful sequence
      return {
        id: order.id,
        orderId: order.id,
        date: formatTableDate(order.createdAt),
        rawDate: order.createdAt,
        invoiceNumber: getInvoiceNumber(order, seq > 0 ? seq : 1000 + idx),
        orderNumber: formatOrderDisplayNumber(order.id),
        amount: Number(order.total ?? 0),
        order,
      };
    });
  }, [orders]);

  // Build Transactions list (merged from API transactions & orders)
  const transactionsList: TransactionItem[] = useMemo(() => {
    const list: TransactionItem[] = [];
    const seenOrderIds = new Set<string>();

    // 1. From API transactions
    if (apiTransactions.length > 0) {
      apiTransactions.forEach((tx) => {
        const orderId = tx.orderId || tx.id;
        if (orderId) seenOrderIds.add(orderId);
        list.push({
          id: tx.id,
          orderId: tx.orderId || "",
          date: formatTableDate(tx.createdAt),
          rawDate: tx.createdAt,
          reference: tx.referenceId || tx.id,
          type: tx.type || "Razorpay",
          amount: Number(tx.amount ?? 0),
          status: tx.status || "Pending",
          orderNumber: formatOrderDisplayNumber(tx.orderId || tx.id),
        });
      });
    }

    // 2. From orders not yet represented in transactions
    orders.forEach((order) => {
      if (seenOrderIds.has(order.id)) return;
      seenOrderIds.add(order.id);

      const rawMethod = String(order.paymentMethod ?? (order as any).gateway ?? "").toLowerCase();
      const isCod = rawMethod.includes("cod") || rawMethod.includes("cash");
      const rawStatus = String(order.paymentStatus ?? "").toLowerCase();
      const isPaid = rawStatus === "success" || rawStatus === "paid";
      const status: "Paid" | "Pending" | "Failed" = isPaid
        ? "Paid"
        : rawStatus === "failed"
        ? "Failed"
        : "Pending";

      const ref =
        order.paymentId ||
        order.refNo ||
        order.transactionId ||
        (isCod ? `plink_${order.id.slice(0, 14)}` : `order_${order.id.slice(0, 14)}`);

      list.push({
        id: `tx_${order.id}`,
        orderId: order.id,
        date: formatTableDate(order.createdAt),
        rawDate: order.createdAt,
        reference: ref,
        type: isCod ? "COD" : "Razorpay",
        amount: Number(order.total ?? 0),
        status,
        orderNumber: formatOrderDisplayNumber(order.id),
      });
    });

    return list;
  }, [apiTransactions, orders]);

  // Filtered Invoices
  const filteredInvoices = useMemo(() => {
    return invoicesList.filter((inv) => {
      // Date filter
      if (appliedFilters.fromDate) {
        const fromD = parseDateInput(appliedFilters.fromDate);
        if (fromD && inv.rawDate && new Date(inv.rawDate) < fromD) return false;
      }
      if (appliedFilters.toDate) {
        const toD = parseDateInput(appliedFilters.toDate);
        if (toD && inv.rawDate) {
          const endOfDay = new Date(toD);
          endOfDay.setHours(23, 59, 59, 999);
          if (new Date(inv.rawDate) > endOfDay) return false;
        }
      }

      // Search query
      if (appliedFilters.search) {
        const query = appliedFilters.search.toLowerCase().trim();
        const matchInvoice = inv.invoiceNumber.toLowerCase().includes(query);
        const matchOrder = inv.orderNumber.toLowerCase().includes(query) || inv.orderId.toLowerCase().includes(query);
        const matchCust =
          (inv.order.customerName ?? "").toLowerCase().includes(query) ||
          (inv.order.customerEmail ?? "").toLowerCase().includes(query);
        if (!matchInvoice && !matchOrder && !matchCust) return false;
      }

      return true;
    });
  }, [invoicesList, appliedFilters]);

  // Filtered Transactions
  const filteredTransactions = useMemo(() => {
    return transactionsList.filter((tx) => {
      // Date filter
      if (appliedFilters.fromDate) {
        const fromD = parseDateInput(appliedFilters.fromDate);
        if (fromD && tx.rawDate && new Date(tx.rawDate) < fromD) return false;
      }
      if (appliedFilters.toDate) {
        const toD = parseDateInput(appliedFilters.toDate);
        if (toD && tx.rawDate) {
          const endOfDay = new Date(toD);
          endOfDay.setHours(23, 59, 59, 999);
          if (new Date(tx.rawDate) > endOfDay) return false;
        }
      }

      // Type filter
      if (appliedFilters.type && appliedFilters.type !== "all") {
        if (tx.type.toLowerCase() !== appliedFilters.type.toLowerCase()) return false;
      }

      // Status filter
      if (appliedFilters.status && appliedFilters.status !== "all") {
        if (tx.status.toLowerCase() !== appliedFilters.status.toLowerCase()) return false;
      }

      // Search query
      if (appliedFilters.search) {
        const query = appliedFilters.search.toLowerCase().trim();
        const matchOrder = tx.orderNumber.toLowerCase().includes(query) || tx.orderId.toLowerCase().includes(query);
        const matchRef = tx.reference.toLowerCase().includes(query);
        if (!matchOrder && !matchRef) return false;
      }

      return true;
    });
  }, [transactionsList, appliedFilters]);

  // Pagination Slicing
  const totalInvoicePages = Math.ceil(filteredInvoices.length / PAGE_SIZE) || 1;
  const paginatedInvoices = useMemo(() => {
    const start = (invoicePage - 1) * PAGE_SIZE;
    return filteredInvoices.slice(start, start + PAGE_SIZE);
  }, [filteredInvoices, invoicePage]);

  const totalTransactionPages = Math.ceil(filteredTransactions.length / PAGE_SIZE) || 1;
  const paginatedTransactions = useMemo(() => {
    const start = (transactionPage - 1) * PAGE_SIZE;
    return filteredTransactions.slice(start, start + PAGE_SIZE);
  }, [filteredTransactions, transactionPage]);

  // Handle Search Click
  const handleApplySearch = () => {
    setAppliedFilters({
      fromDate,
      toDate,
      search: searchQuery,
      type: typeFilter,
      status: statusFilter,
    });
    setInvoicePage(1);
    setTransactionPage(1);
  };

  // Handle Clear Click
  const handleClear = () => {
    setFromDate("");
    setToDate("");
    setSearchQuery("");
    setTypeFilter("all");
    setStatusFilter("all");
    setAppliedFilters({
      fromDate: "",
      toDate: "",
      search: "",
      type: "all",
      status: "all",
    });
    setDatePresetLabel("Select Date Range");
    setInvoicePage(1);
    setTransactionPage(1);
  };

  // Preset Date Range Picker Helper
  const applyPreset = (preset: "all" | "today" | "7d" | "30d" | "this_month" | "last_month") => {
    setDatePresetOpen(false);
    const now = new Date();
    if (preset === "all") {
      setFromDate("");
      setToDate("");
      setDatePresetLabel("All Time");
      setAppliedFilters((prev) => ({ ...prev, fromDate: "", toDate: "" }));
      return;
    }
    if (preset === "today") {
      const todayStr = formatDateToInput(now);
      setFromDate(todayStr);
      setToDate(todayStr);
      setDatePresetLabel(todayStr);
      setAppliedFilters((prev) => ({ ...prev, fromDate: todayStr, toDate: todayStr }));
      return;
    }
    if (preset === "7d") {
      const start = new Date();
      start.setDate(now.getDate() - 7);
      const s = formatDateToInput(start);
      const e = formatDateToInput(now);
      setFromDate(s);
      setToDate(e);
      setDatePresetLabel(`${s} - ${e}`);
      setAppliedFilters((prev) => ({ ...prev, fromDate: s, toDate: e }));
      return;
    }
    if (preset === "30d") {
      const start = new Date();
      start.setDate(now.getDate() - 30);
      const s = formatDateToInput(start);
      const e = formatDateToInput(now);
      setFromDate(s);
      setToDate(e);
      setDatePresetLabel(`${s} - ${e}`);
      setAppliedFilters((prev) => ({ ...prev, fromDate: s, toDate: e }));
      return;
    }
    if (preset === "this_month") {
      const start = new Date(now.getFullYear(), now.getMonth(), 1);
      const s = formatDateToInput(start);
      const e = formatDateToInput(now);
      setFromDate(s);
      setToDate(e);
      setDatePresetLabel(`${s} - ${e}`);
      setAppliedFilters((prev) => ({ ...prev, fromDate: s, toDate: e }));
      return;
    }
    if (preset === "last_month") {
      const start = new Date(now.getFullYear(), now.getMonth() - 1, 1);
      const end = new Date(now.getFullYear(), now.getMonth(), 0);
      const s = formatDateToInput(start);
      const e = formatDateToInput(end);
      setFromDate(s);
      setToDate(e);
      setDatePresetLabel(`${s} - ${e}`);
      setAppliedFilters((prev) => ({ ...prev, fromDate: s, toDate: e }));
      return;
    }
  };

  // Single Invoice Download
  const handleDownloadInvoice = async (order: OrderRow) => {
    setDownloadingId(order.id);
    try {
      let orderToPrint = order;
      if (!order.items || order.items.length === 0) {
        try {
          const full = await authedFetch<any>(`/api/v1/orders/${order.id}`);
          if (full) orderToPrint = full;
        } catch {
          // ignore
        }
      }
      await generateAdminInvoicePDF(orderToPrint as any);
      toast.success("Invoice downloaded", `Invoice for order #${order.id.slice(0, 8)} downloaded.`);
    } catch (err) {
      toast.error("Download failed", "Failed to generate invoice PDF.");
    } finally {
      setDownloadingId(null);
    }
  };

  // Bulk Invoice Download
  const handleBulkDownload = async () => {
    if (selectedInvoices.length === 0) return;
    setIsBulkDownloading(true);
    toast.info("Downloading invoices", `Starting download of ${selectedInvoices.length} invoices...`);

    try {
      for (const orderId of selectedInvoices) {
        const found = orders.find((o) => o.id === orderId);
        if (found) {
          let orderToPrint = found;
          if (!found.items || found.items.length === 0) {
            try {
              const full = await authedFetch<any>(`/api/v1/orders/${found.id}`);
              if (full) orderToPrint = full;
            } catch {
              // fallback
            }
          }
          await generateAdminInvoicePDF(orderToPrint as any);
          await new Promise((res) => setTimeout(res, 400));
        }
      }
      toast.success("Completed", `Downloaded ${selectedInvoices.length} invoices.`);
      setSelectedInvoices([]);
    } catch (err) {
      toast.error("Bulk download error", "Could not complete bulk download.");
    } finally {
      setIsBulkDownloading(false);
    }
  };

  // Select all checkbox logic on current page
  const allCurrentPageSelected =
    paginatedInvoices.length > 0 &&
    paginatedInvoices.every((inv) => selectedInvoices.includes(inv.orderId));

  const toggleSelectAllCurrentPage = () => {
    if (allCurrentPageSelected) {
      const pageIds = new Set(paginatedInvoices.map((inv) => inv.orderId));
      setSelectedInvoices((prev) => prev.filter((id) => !pageIds.has(id)));
    } else {
      const pageIds = paginatedInvoices.map((inv) => inv.orderId);
      setSelectedInvoices((prev) => Array.from(new Set([...prev, ...pageIds])));
    }
  };

  const toggleSelectOne = (orderId: string) => {
    setSelectedInvoices((prev) =>
      prev.includes(orderId) ? prev.filter((id) => id !== orderId) : [...prev, orderId]
    );
  };

  // Computed summary values (with fallback from orders if summary endpoint returns 0)
  const computedGrossSales = useMemo(() => {
    if (summary && Number(summary.grossSales) > 0) return Number(summary.grossSales);
    return orders.reduce((sum, o) => sum + Number(o.total ?? 0), 0);
  }, [summary, orders]);

  const computedRefunds = useMemo(() => {
    return Number(summary?.refundsTotal ?? 0);
  }, [summary]);

  const computedNetRevenue = useMemo(() => {
    if (summary && Number(summary.netRevenue) > 0) return Number(summary.netRevenue);
    return Math.max(0, computedGrossSales - computedRefunds);
  }, [summary, computedGrossSales, computedRefunds]);

  const invoicesCount = filteredInvoices.length || invoicesList.length;
  const transactionsCount = filteredTransactions.length || transactionsList.length;

  return (
    <div className="w-full space-y-6 pb-12">
      {/* Top Header */}
      <div className="flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
        <div>
          <h1 className="font-melon text-2xl sm:text-3xl font-bold text-[#4A1D1F]">Finance</h1>
          <p className="mt-1 text-xs sm:text-sm text-[#7D7068]">
            {activeTab === "invoices"
              ? "Manage and download invoices for all completed orders."
              : "Track all financial transactions, payments and refunds."}
          </p>
        </div>

        {/* Date Range Selector & Refresh Button */}
        <div className="flex items-center gap-3">
          {/* Preset Date Range Button */}
          <div className="relative">
            <button
              type="button"
              onClick={() => setDatePresetOpen((v) => !v)}
              className="flex items-center gap-2 rounded-xl border border-[#E8DCC8] bg-white px-3.5 py-2 text-xs font-semibold text-[#4A1D1F] shadow-sm hover:border-[#4A1D1F] transition-colors"
            >
              <Calendar className="h-4 w-4 text-[#7D7068]" />
              <span>{datePresetLabel || "22/09/2026 - 22/10/2026"}</span>
              <ChevronDown className="h-3.5 w-3.5 text-[#7D7068]" />
            </button>

            {datePresetOpen && (
              <div className="absolute right-0 top-full z-30 mt-1.5 w-48 rounded-xl border border-[#E8DCC8] bg-white py-1.5 shadow-lg">
                {[
                  { label: "Today", value: "today" },
                  { label: "Last 7 Days", value: "7d" },
                  { label: "Last 30 Days", value: "30d" },
                  { label: "This Month", value: "this_month" },
                  { label: "Last Month", value: "last_month" },
                  { label: "All Time", value: "all" },
                ].map((p) => (
                  <button
                    key={p.value}
                    type="button"
                    onClick={() => applyPreset(p.value as any)}
                    className="w-full px-4 py-2 text-left text-xs font-medium text-[#4A1D1F] hover:bg-[#FFF7EA] transition-colors"
                  >
                    {p.label}
                  </button>
                ))}
              </div>
            )}
          </div>

          {/* Refresh Button */}
          <button
            type="button"
            onClick={() => loadData(true)}
            disabled={refreshing}
            className="flex items-center gap-2 rounded-xl bg-[#8B2E1D] px-4 py-2 text-xs font-semibold text-white shadow-sm hover:bg-[#782319] transition-colors disabled:opacity-60"
          >
            <RefreshCw className={`h-3.5 w-3.5 ${refreshing ? "animate-spin" : ""}`} />
            <span>Refresh</span>
          </button>
        </div>
      </div>

      {error && (
        <div className="rounded-xl border border-red-200 bg-red-50 px-4 py-3 text-xs text-red-800">
          {error}
        </div>
      )}

      {/* 4 Metric Cards */}
      <div className="grid gap-3.5 sm:grid-cols-2 lg:grid-cols-4">
        {/* Card 1: Gross Sales */}
        <div className="flex items-center gap-3.5 rounded-2xl border border-[#EFE8E0] bg-white p-4 shadow-sm">
          <div className="flex h-12 w-12 shrink-0 items-center justify-center rounded-xl border border-[#FCDAD6] bg-[#FDF2F0] text-[#C0392B]">
            <Coins className="h-6 w-6" />
          </div>
          <div>
            <p className="text-[10px] sm:text-[11px] font-semibold uppercase tracking-wider text-[#8C8C8C]">
              Gross Sales
            </p>
            <p className="font-melon text-lg sm:text-xl font-bold text-[#3B1214]">
              {formatCurrency(computedGrossSales)}
            </p>
          </div>
        </div>

        {/* Card 2: Net Revenue */}
        <div className="flex items-center gap-3.5 rounded-2xl border border-[#EFE8E0] bg-white p-4 shadow-sm">
          <div className="flex h-12 w-12 shrink-0 items-center justify-center rounded-xl border border-[#FCDAD6] bg-[#FDF2F0] text-[#C0392B]">
            <Tag className="h-6 w-6" />
          </div>
          <div>
            <p className="text-[10px] sm:text-[11px] font-semibold uppercase tracking-wider text-[#8C8C8C]">
              Net Revenue
            </p>
            <p className="font-melon text-lg sm:text-xl font-bold text-[#3B1214]">
              {formatCurrency(computedNetRevenue)}
            </p>
          </div>
        </div>

        {/* Card 3: Invoices or Transactions count */}
        <div className="flex items-center gap-3.5 rounded-2xl border border-[#EFE8E0] bg-white p-4 shadow-sm">
          <div className="flex h-12 w-12 shrink-0 items-center justify-center rounded-xl border border-[#FCDAD6] bg-[#FDF2F0] text-[#C0392B]">
            <FileText className="h-6 w-6" />
          </div>
          <div>
            <p className="text-[10px] sm:text-[11px] font-semibold uppercase tracking-wider text-[#8C8C8C]">
              {activeTab === "invoices" ? "Invoices" : "Transactions"}
            </p>
            <p className="font-melon text-lg sm:text-xl font-bold text-[#3B1214]">
              {activeTab === "invoices" ? invoicesCount : transactionsCount}
            </p>
          </div>
        </div>

        {/* Card 4: Refunded Amount */}
        <div className="flex items-center gap-3.5 rounded-2xl border border-[#EFE8E0] bg-white p-4 shadow-sm">
          <div className="flex h-12 w-12 shrink-0 items-center justify-center rounded-xl border border-[#FCDAD6] bg-[#FDF2F0] text-[#C0392B]">
            <RotateCcw className="h-6 w-6" />
          </div>
          <div>
            <p className="text-[10px] sm:text-[11px] font-semibold uppercase tracking-wider text-[#8C8C8C]">
              Refunded Amount
            </p>
            <p className="font-melon text-lg sm:text-xl font-bold text-[#3B1214]">
              {formatCurrency(computedRefunds)}
            </p>
          </div>
        </div>
      </div>

      {/* Tabs Bar */}
      <div>
        <div className="flex items-center gap-1 border-b border-[#E8DCC8]">
          <button
            type="button"
            onClick={() => setActiveTab("transactions")}
            className={`flex items-center gap-2 rounded-t-xl px-6 py-3 text-xs sm:text-sm font-semibold transition-colors ${
              activeTab === "transactions"
                ? "bg-[#4A1D1F] text-white"
                : "bg-transparent text-[#4A1D1F] hover:bg-[#F3EFEA]"
            }`}
          >
            <CreditCard className="h-4 w-4" />
            <span>Transactions</span>
          </button>

          <button
            type="button"
            onClick={() => setActiveTab("invoices")}
            className={`flex items-center gap-2 rounded-t-xl px-6 py-3 text-xs sm:text-sm font-semibold transition-colors ${
              activeTab === "invoices"
                ? "bg-[#4A1D1F] text-white"
                : "bg-transparent text-[#4A1D1F] hover:bg-[#F3EFEA]"
            }`}
          >
            <FileText className="h-4 w-4" />
            <span>Invoices</span>
          </button>
        </div>

        {/* Content Panel */}
        <div className="rounded-b-2xl rounded-tr-2xl border border-[#EFE8E0] bg-white p-5 shadow-sm space-y-5">
          {/* ===================== INVOICES TAB ===================== */}
          {activeTab === "invoices" && (
            <>
              {/* Invoices Filters */}
              <div className="flex flex-wrap items-end gap-3">
                <div className="w-full sm:w-36">
                  <label className="block text-[11px] font-semibold text-[#646464] mb-1">
                    From Date
                  </label>
                  <div className="relative">
                    <input
                      type="text"
                      placeholder="DD/MM/YYYY"
                      value={fromDate}
                      onChange={(e) => setFromDate(e.target.value)}
                      className="w-full rounded-xl border border-[#E5E7EB] bg-white px-3 py-2 text-xs text-[#4A1D1F] focus:border-[#4A1D1F] focus:outline-none"
                    />
                    <Calendar className="pointer-events-none absolute right-3 top-2.5 h-3.5 w-3.5 text-[#9CA3AF]" />
                  </div>
                </div>

                <div className="w-full sm:w-36">
                  <label className="block text-[11px] font-semibold text-[#646464] mb-1">
                    To Date
                  </label>
                  <div className="relative">
                    <input
                      type="text"
                      placeholder="DD/MM/YYYY"
                      value={toDate}
                      onChange={(e) => setToDate(e.target.value)}
                      className="w-full rounded-xl border border-[#E5E7EB] bg-white px-3 py-2 text-xs text-[#4A1D1F] focus:border-[#4A1D1F] focus:outline-none"
                    />
                    <Calendar className="pointer-events-none absolute right-3 top-2.5 h-3.5 w-3.5 text-[#9CA3AF]" />
                  </div>
                </div>

                <div className="flex-1 min-w-[240px]">
                  <div className="relative">
                    <Search className="pointer-events-none absolute left-3 top-2.5 h-4 w-4 text-[#9CA3AF]" />
                    <input
                      type="text"
                      placeholder="Search by Invoice No., Order ID, Customer..."
                      value={searchQuery}
                      onChange={(e) => setSearchQuery(e.target.value)}
                      onKeyDown={(e) => {
                        if (e.key === "Enter") handleApplySearch();
                      }}
                      className="w-full rounded-xl border border-[#E5E7EB] bg-white pl-9 pr-3 py-2 text-xs text-[#4A1D1F] focus:border-[#4A1D1F] focus:outline-none placeholder:text-[#9CA3AF]"
                    />
                  </div>
                </div>

                <button
                  type="button"
                  onClick={handleApplySearch}
                  className="rounded-xl bg-[#8B2E1D] px-6 py-2 text-xs font-semibold text-white shadow-sm hover:bg-[#782319] transition-colors"
                >
                  Search
                </button>

                <button
                  type="button"
                  onClick={handleClear}
                  className="rounded-xl bg-[#E8EDF5] px-6 py-2 text-xs font-semibold text-[#334155] hover:bg-[#DDE5F0] transition-colors"
                >
                  Clear
                </button>
              </div>

              {/* Selection / Bulk Action Row */}
              <div className="flex items-center gap-3 pt-1">
                <label className="flex items-center gap-2 cursor-pointer select-none">
                  <input
                    type="checkbox"
                    checked={allCurrentPageSelected}
                    onChange={toggleSelectAllCurrentPage}
                    className="h-4 w-4 rounded border-[#D1D5DB] text-[#8B2E1D] focus:ring-[#8B2E1D]"
                  />
                  <span className="text-xs text-[#4B5563] font-medium">
                    {selectedInvoices.length} selected
                  </span>
                </label>

                <button
                  type="button"
                  disabled={selectedInvoices.length === 0 || isBulkDownloading}
                  onClick={handleBulkDownload}
                  className={`flex items-center gap-1.5 rounded-xl px-4 py-1.5 text-xs font-semibold transition-colors ${
                    selectedInvoices.length > 0 && !isBulkDownloading
                      ? "bg-[#8B2E1D] text-white hover:bg-[#782319] shadow-sm cursor-pointer"
                      : "bg-[#C49B90] text-white/80 cursor-not-allowed opacity-75"
                  }`}
                >
                  {isBulkDownloading ? (
                    <Loader2 className="h-3.5 w-3.5 animate-spin" />
                  ) : (
                    <Download className="h-3.5 w-3.5" />
                  )}
                  <span>Download Selected ({selectedInvoices.length})</span>
                </button>
              </div>

              {/* Invoices Table */}
              <div className="overflow-x-auto rounded-xl border border-[#E5E7EB]">
                <table className="w-full text-left text-xs border-collapse">
                  <thead>
                    <tr className="bg-[#4A1D1F] text-white uppercase text-[11px] font-semibold tracking-wider">
                      <th className="py-3 px-4 w-12 text-center">
                        <input
                          type="checkbox"
                          checked={allCurrentPageSelected}
                          onChange={toggleSelectAllCurrentPage}
                          className="h-4 w-4 rounded border-white/50 text-[#8B2E1D] focus:ring-0 focus:ring-offset-0"
                        />
                      </th>
                      <th className="py-3 px-4">Invoice Date</th>
                      <th className="py-3 px-4">Invoice Number</th>
                      <th className="py-3 px-4">Order Number</th>
                      <th className="py-3 px-4">Amount</th>
                      <th className="py-3 px-4 text-center">Actions</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-[#F0ECE6] bg-white">
                    {loading ? (
                      <tr>
                        <td colSpan={6} className="py-12 text-center text-[#646464]">
                          <Loader2 className="mx-auto h-6 w-6 animate-spin text-[#8B2E1D]" />
                          <p className="mt-2 text-xs">Loading invoices…</p>
                        </td>
                      </tr>
                    ) : paginatedInvoices.length === 0 ? (
                      <tr>
                        <td colSpan={6} className="py-12 text-center text-[#646464]">
                          No invoices found.
                        </td>
                      </tr>
                    ) : (
                      paginatedInvoices.map((inv) => {
                        const isSelected = selectedInvoices.includes(inv.orderId);
                        const isDownloading = downloadingId === inv.orderId;

                        return (
                          <tr
                            key={inv.id}
                            className={`transition-colors hover:bg-[#FFFBF3]/70 ${
                              isSelected ? "bg-[#FFF8F0]" : ""
                            }`}
                          >
                            <td className="py-3.5 px-4 text-center">
                              <input
                                type="checkbox"
                                checked={isSelected}
                                onChange={() => toggleSelectOne(inv.orderId)}
                                className="h-4 w-4 rounded border-[#D1D5DB] text-[#8B2E1D] focus:ring-[#8B2E1D]"
                              />
                            </td>
                            <td className="py-3.5 px-4 font-medium text-[#4A1D1F]">
                              {inv.date}
                            </td>
                            <td className="py-3.5 px-4 font-mono text-[#374151]">
                              {inv.invoiceNumber}
                            </td>
                            <td className="py-3.5 px-4 font-mono font-medium text-[#4A1D1F]">
                              {inv.orderNumber}
                            </td>
                            <td className="py-3.5 px-4 font-semibold text-[#111827]">
                              {formatCurrency(inv.amount)}
                            </td>
                            <td className="py-3.5 px-4 text-center">
                              <button
                                type="button"
                                disabled={isDownloading}
                                onClick={() => handleDownloadInvoice(inv.order)}
                                className="inline-flex items-center gap-1.5 rounded-lg border border-[#8B2E1D] px-3.5 py-1 text-xs font-semibold text-[#8B2E1D] hover:bg-[#8B2E1D] hover:text-white transition-colors disabled:opacity-50"
                              >
                                {isDownloading ? (
                                  <Loader2 className="h-3.5 w-3.5 animate-spin" />
                                ) : (
                                  <Download className="h-3.5 w-3.5" />
                                )}
                                <span>Download</span>
                              </button>
                            </td>
                          </tr>
                        );
                      })
                    )}
                  </tbody>
                </table>
              </div>

              {/* Invoices Pagination */}
              {totalInvoicePages > 0 && (
                <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between pt-2">
                  <p className="text-xs text-[#6B7280]">
                    Showing {(invoicePage - 1) * PAGE_SIZE + (filteredInvoices.length ? 1 : 0)} to{" "}
                    {Math.min(invoicePage * PAGE_SIZE, filteredInvoices.length)} of{" "}
                    {filteredInvoices.length} invoices
                  </p>

                  <div className="flex items-center gap-1">
                    <button
                      type="button"
                      disabled={invoicePage === 1}
                      onClick={() => setInvoicePage((p) => Math.max(1, p - 1))}
                      className="flex h-7 w-7 items-center justify-center rounded-md border border-[#E5E7EB] text-[#4A1D1F] hover:bg-slate-50 disabled:opacity-40"
                    >
                      <ChevronLeft className="h-4 w-4" />
                    </button>

                    {Array.from({ length: totalInvoicePages }, (_, i) => i + 1).map((page) => (
                      <button
                        key={page}
                        type="button"
                        onClick={() => setInvoicePage(page)}
                        className={`flex h-7 w-7 items-center justify-center rounded-md text-xs font-semibold transition-colors ${
                          page === invoicePage
                            ? "bg-[#4A1D1F] text-white"
                            : "border border-[#E5E7EB] text-[#4A1D1F] hover:bg-slate-50"
                        }`}
                      >
                        {page}
                      </button>
                    ))}

                    <button
                      type="button"
                      disabled={invoicePage === totalInvoicePages}
                      onClick={() => setInvoicePage((p) => Math.min(totalInvoicePages, p + 1))}
                      className="flex h-7 w-7 items-center justify-center rounded-md border border-[#E5E7EB] text-[#4A1D1F] hover:bg-slate-50 disabled:opacity-40"
                    >
                      <ChevronRight className="h-4 w-4" />
                    </button>
                  </div>
                </div>
              )}
            </>
          )}

          {/* ===================== TRANSACTIONS TAB ===================== */}
          {activeTab === "transactions" && (
            <>
              {/* Transactions Filters */}
              <div className="flex flex-wrap items-end gap-3">
                <div className="w-full sm:w-32">
                  <label className="block text-[11px] font-semibold text-[#646464] mb-1">
                    From Date
                  </label>
                  <div className="relative">
                    <input
                      type="text"
                      placeholder="DD/MM/YYYY"
                      value={fromDate}
                      onChange={(e) => setFromDate(e.target.value)}
                      className="w-full rounded-xl border border-[#E5E7EB] bg-white px-3 py-2 text-xs text-[#4A1D1F] focus:border-[#4A1D1F] focus:outline-none"
                    />
                    <Calendar className="pointer-events-none absolute right-3 top-2.5 h-3.5 w-3.5 text-[#9CA3AF]" />
                  </div>
                </div>

                <div className="w-full sm:w-32">
                  <label className="block text-[11px] font-semibold text-[#646464] mb-1">
                    To Date
                  </label>
                  <div className="relative">
                    <input
                      type="text"
                      placeholder="DD/MM/YYYY"
                      value={toDate}
                      onChange={(e) => setToDate(e.target.value)}
                      className="w-full rounded-xl border border-[#E5E7EB] bg-white px-3 py-2 text-xs text-[#4A1D1F] focus:border-[#4A1D1F] focus:outline-none"
                    />
                    <Calendar className="pointer-events-none absolute right-3 top-2.5 h-3.5 w-3.5 text-[#9CA3AF]" />
                  </div>
                </div>

                <div className="w-full sm:w-32">
                  <label className="block text-[11px] font-semibold text-[#646464] mb-1">
                    Type
                  </label>
                  <Select value={typeFilter} onValueChange={setTypeFilter}>
                    <SelectTrigger className="!h-[36px] w-full rounded-xl border border-[#E5E7EB] bg-white px-3 py-2 text-xs text-[#4A1D1F] focus:border-[#4A1D1F] focus:outline-none">
                      <SelectValue placeholder="All Types" />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value="all">All Types</SelectItem>
                      <SelectItem value="Razorpay">Razorpay</SelectItem>
                      <SelectItem value="COD">COD</SelectItem>
                    </SelectContent>
                  </Select>
                </div>

                <div className="w-full sm:w-32">
                  <label className="block text-[11px] font-semibold text-[#646464] mb-1">
                    Status
                  </label>
                  <Select value={statusFilter} onValueChange={setStatusFilter}>
                    <SelectTrigger className="!h-[36px] w-full rounded-xl border border-[#E5E7EB] bg-white px-3 py-2 text-xs text-[#4A1D1F] focus:border-[#4A1D1F] focus:outline-none">
                      <SelectValue placeholder="All Statuses" />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value="all">All Statuses</SelectItem>
                      <SelectItem value="Paid">Paid</SelectItem>
                      <SelectItem value="Pending">Pending</SelectItem>
                      <SelectItem value="Failed">Failed</SelectItem>
                    </SelectContent>
                  </Select>
                </div>

                <div className="flex-1 min-w-[200px]">
                  <div className="relative">
                    <Search className="pointer-events-none absolute left-3 top-2.5 h-4 w-4 text-[#9CA3AF]" />
                    <input
                      type="text"
                      placeholder="Search by Order No., Reference, ..."
                      value={searchQuery}
                      onChange={(e) => setSearchQuery(e.target.value)}
                      onKeyDown={(e) => {
                        if (e.key === "Enter") handleApplySearch();
                      }}
                      className="w-full rounded-xl border border-[#E5E7EB] bg-white pl-9 pr-3 py-2 text-xs text-[#4A1D1F] focus:border-[#4A1D1F] focus:outline-none placeholder:text-[#9CA3AF]"
                    />
                  </div>
                </div>

                <button
                  type="button"
                  onClick={handleApplySearch}
                  className="rounded-xl bg-[#8B2E1D] px-6 py-2 text-xs font-semibold text-white shadow-sm hover:bg-[#782319] transition-colors"
                >
                  Search
                </button>

                <button
                  type="button"
                  onClick={handleClear}
                  className="rounded-xl bg-[#E8EDF5] px-6 py-2 text-xs font-semibold text-[#334155] hover:bg-[#DDE5F0] transition-colors"
                >
                  Clear
                </button>
              </div>

              {/* Transactions Table */}
              <div className="overflow-x-auto rounded-xl border border-[#E5E7EB]">
                <table className="w-full text-left text-xs border-collapse">
                  <thead>
                    <tr className="bg-[#4A1D1F] text-white uppercase text-[11px] font-semibold tracking-wider">
                      <th className="py-3 px-4">Date</th>
                      <th className="py-3 px-4">Reference</th>
                      <th className="py-3 px-4">Type</th>
                      <th className="py-3 px-4">Amount</th>
                      <th className="py-3 px-4">Status</th>
                      <th className="py-3 px-4">Order Number</th>
                      <th className="py-3 px-4 text-center">Actions</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-[#F0ECE6] bg-white">
                    {loading ? (
                      <tr>
                        <td colSpan={7} className="py-12 text-center text-[#646464]">
                          <Loader2 className="mx-auto h-6 w-6 animate-spin text-[#8B2E1D]" />
                          <p className="mt-2 text-xs">Loading transactions…</p>
                        </td>
                      </tr>
                    ) : paginatedTransactions.length === 0 ? (
                      <tr>
                        <td colSpan={7} className="py-12 text-center text-[#646464]">
                          No transactions found.
                        </td>
                      </tr>
                    ) : (
                      paginatedTransactions.map((tx) => {
                        const isCod = tx.type.toLowerCase() === "cod";
                        const isPaid = tx.status.toLowerCase() === "paid" || tx.status.toLowerCase() === "success";
                        const isFailed = tx.status.toLowerCase() === "failed";

                        return (
                          <tr
                            key={tx.id}
                            className="transition-colors hover:bg-[#FFFBF3]/70"
                          >
                            <td className="py-3.5 px-4 font-medium text-[#4A1D1F]">
                              {tx.date}
                            </td>
                            <td className="py-3.5 px-4 font-mono text-[#4B5563]">
                              {tx.reference}
                            </td>
                            <td className="py-3.5 px-4">
                              <span
                                className={`inline-flex items-center px-2.5 py-0.5 rounded-full text-[11px] font-medium ${
                                  isCod
                                    ? "bg-[#FEF3C7] text-[#D97706]"
                                    : "bg-[#E0F2FE] text-[#0284C7]"
                                }`}
                              >
                                {tx.type}
                              </span>
                            </td>
                            <td className="py-3.5 px-4 font-semibold text-[#111827]">
                              {formatCurrency(tx.amount)}
                            </td>
                            <td className="py-3.5 px-4">
                              <span
                                className={`inline-flex items-center px-2.5 py-0.5 rounded-full text-[11px] font-medium ${
                                  isPaid
                                    ? "bg-[#DCFCE7] text-[#16A34A]"
                                    : isFailed
                                    ? "bg-[#FEE2E2] text-[#DC2626]"
                                    : "bg-[#FEF3C7] text-[#D97706]"
                                }`}
                              >
                                {tx.status}
                              </span>
                            </td>
                            <td className="py-3.5 px-4 font-mono font-medium text-[#4A1D1F]">
                              {tx.orderNumber}
                            </td>
                            <td className="py-3.5 px-4 text-center">
                              <button
                                type="button"
                                onClick={() => {
                                  if (tx.orderId) {
                                    router.push(`/admin/orders/${tx.orderId}`);
                                  } else {
                                    toast.error("Not available", "Order ID missing for this transaction.");
                                  }
                                }}
                                className="inline-flex items-center gap-1.5 rounded-lg border border-[#8B2E1D] px-3.5 py-1 text-xs font-semibold text-[#8B2E1D] hover:bg-[#8B2E1D] hover:text-white transition-colors"
                              >
                                <Eye className="h-3.5 w-3.5" />
                                <span>View Order</span>
                              </button>
                            </td>
                          </tr>
                        );
                      })
                    )}
                  </tbody>
                </table>
              </div>

              {/* Transactions Pagination */}
              {totalTransactionPages > 0 && (
                <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between pt-2">
                  <p className="text-xs text-[#6B7280]">
                    Showing {(transactionPage - 1) * PAGE_SIZE + (filteredTransactions.length ? 1 : 0)} to{" "}
                    {Math.min(transactionPage * PAGE_SIZE, filteredTransactions.length)} of{" "}
                    {filteredTransactions.length} transactions
                  </p>

                  <div className="flex items-center gap-1">
                    <button
                      type="button"
                      disabled={transactionPage === 1}
                      onClick={() => setTransactionPage((p) => Math.max(1, p - 1))}
                      className="flex h-7 w-7 items-center justify-center rounded-md border border-[#E5E7EB] text-[#4A1D1F] hover:bg-slate-50 disabled:opacity-40"
                    >
                      <ChevronLeft className="h-4 w-4" />
                    </button>

                    {Array.from({ length: totalTransactionPages }, (_, i) => i + 1).map((page) => (
                      <button
                        key={page}
                        type="button"
                        onClick={() => setTransactionPage(page)}
                        className={`flex h-7 w-7 items-center justify-center rounded-md text-xs font-semibold transition-colors ${
                          page === transactionPage
                            ? "bg-[#4A1D1F] text-white"
                            : "border border-[#E5E7EB] text-[#4A1D1F] hover:bg-slate-50"
                        }`}
                      >
                        {page}
                      </button>
                    ))}

                    <button
                      type="button"
                      disabled={transactionPage === totalTransactionPages}
                      onClick={() => setTransactionPage((p) => Math.min(totalTransactionPages, p + 1))}
                      className="flex h-7 w-7 items-center justify-center rounded-md border border-[#E5E7EB] text-[#4A1D1F] hover:bg-slate-50 disabled:opacity-40"
                    >
                      <ChevronRight className="h-4 w-4" />
                    </button>
                  </div>
                </div>
              )}
            </>
          )}
        </div>
      </div>
    </div>
  );
}
