"use client";

import { useCallback, useEffect, useState } from "react";
import { authedFetch, authedPatch, authedPost } from "@/lib/dashboard-fetch";
import { ConsoleTable, ConsoleTd } from "@/components/dashboard/ConsoleTable";
import { useRealtimeTables } from "@/hooks/useRealtimeTables";
import { useMasterValues } from "@/hooks/useMasterData";
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

type Refund = {
  id: string;
  orderId: string;
  amount: string | number;
  status: string;
  reason: string | null;
  createdAt: string;
  order?: any;
};

type Transaction = {
  id: string;
  amount: string | number;
  type: string;
  status: string;
  referenceId?: string | null;
  createdAt: string;
};

export default function AdminFinancePage() {
  const refundStatusMasterQuery = useMasterValues("REFUND_STATUS")
  const transactionStatusMasterQuery = useMasterValues("TRANSACTION_STATUS")
  const [summary, setSummary] = useState<Summary | null>(null);
  const [refunds, setRefunds] = useState<Refund[]>([]);
  const [transactions, setTransactions] = useState<Transaction[]>([]);
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(true);
  const [rfDraft, setRfDraft] = useState<Record<string, string>>({});
  const [busy, setBusy] = useState<string | null>(null);
  const [refundFilter, setRefundFilter] = useState("all");
  const [orderId, setOrderId] = useState("");
  const [refundAmount, setRefundAmount] = useState("");
  const [refundReason, setRefundReason] = useState("");
  const [refundSearch, setRefundSearch] = useState("");
  const [refundStatusFilter, setRefundStatusFilter] = useState("all");
  const [refundPage, setRefundPage] = useState(1);
  const REFUNDS_PER_PAGE = 10;
  const [transactionSearch, setTransactionSearch] = useState("");
  const [transactionStatusFilter, setTransactionStatusFilter] = useState("all");
  const [transactionPage, setTransactionPage] = useState(1);
  const TRANSACTIONS_PER_PAGE = 10;
  const refundStatusOptions =
    refundStatusMasterQuery.data?.length
      ? refundStatusMasterQuery.data.map((item) => ({ label: item.label, value: item.value }))
      : [
          { label: "pending", value: "pending" },
          { label: "completed", value: "completed" },
          { label: "rejected", value: "rejected" },
        ]
  const transactionStatusOptions =
    transactionStatusMasterQuery.data?.length
      ? transactionStatusMasterQuery.data.map((item) => ({ label: item.label, value: item.value }))
      : Array.from(new Set(transactions.map((t) => t.status))).map((status) => ({ label: status, value: status }))

  const load = useCallback(() => {
    setLoading(true);
    setError("");
    Promise.all([
      authedFetch<Summary>("/api/v1/finance/summary"),
      authedFetch<Refund[]>("/api/v1/finance/refunds"),
      authedFetch<Transaction[]>("/api/v1/finance/transactions").catch(() => []), // Failsafe if endpoint isn't ready
    ])
      .then(([s, r, t]) => {
        setSummary(s);
        setRefunds(r);
        setTransactions(t || []); 
        const rf: Record<string, string> = {};
        r.forEach((x) => {
          rf[x.id] = x.status;
        });
        setRfDraft(rf);
      })
      .catch((e: Error) => setError(e.message))
      .finally(() => setLoading(false));
  }, []);

  useEffect(() => {
    load();
  }, [load]);

  useRealtimeTables({
    tables: ["refunds", "orders"],
    onChange: () => {
      void load();
    },
  });

  const saveRf = async (id: string) => {
    const status = rfDraft[id];
    if (!status) return;
    setBusy(`rf-${id}`);
    setError("");
    try {
      await authedPatch(`/api/v1/finance/refunds/${id}`, { status });
      await load();
    } catch (e) {
      setError(e instanceof Error ? e.message : "Update failed");
    } finally {
      setBusy(null);
    }
  };

  const markManualRefund = async (id: string) => {
    setBusy(`rfm-${id}`);
    setError("");
    try {
      await authedPatch(`/api/v1/finance/refunds/${id}`, { status: "manual_refunded" });
      await load();
    } catch (e) {
      setError(e instanceof Error ? e.message : "Update failed");
    } finally {
      setBusy(null);
    }
  };

  const triggerRefund = async (id: string) => {
    setBusy(`rft-${id}`);
    setError("");
    try {
      await authedFetch(`/api/v1/finance/refunds/${id}/trigger`, {
        method: "POST",
      });
      await load();
    } catch (e) {
      setError(e instanceof Error ? e.message : "Trigger failed");
    } finally {
      setBusy(null);
    }
  };

  const createRefund = async (e: React.FormEvent) => {
    e.preventDefault();
    const amt = Number(refundAmount);
    if (!orderId.trim() || !Number.isFinite(amt) || amt <= 0) return;
    setBusy("create-refund");
    setError("");
    try {
      await authedPost("/api/v1/finance/refunds", {
        orderId: orderId.trim(),
        amount: amt,
        reason: refundReason.trim() || undefined,
      });
      setOrderId("");
      setRefundAmount("");
      setRefundReason("");
      await load();
    } catch (e) {
      setError(e instanceof Error ? e.message : "Refund failed");
    } finally {
      setBusy(null);
    }
  };

  const filteredRefunds = refunds.filter((r) => {
    const matchesSearch = r.orderId.toLowerCase().includes(refundSearch.toLowerCase());
    const matchesStatus = refundStatusFilter === "all" || r.status === refundStatusFilter;
    return matchesSearch && matchesStatus;
  });

  const totalRefundPages = Math.ceil(filteredRefunds.length / REFUNDS_PER_PAGE) || 1;
  const paginatedRefunds = filteredRefunds.slice(
    (refundPage - 1) * REFUNDS_PER_PAGE,
    refundPage * REFUNDS_PER_PAGE
  );

  const filteredTransactions = transactions.filter((t) => {
    const matchesSearch = t.id.toLowerCase().includes(transactionSearch.toLowerCase());
    const matchesStatus = transactionStatusFilter === "all" || t.status === transactionStatusFilter;
    return matchesSearch && matchesStatus;
  });

  const totalTransactionPages = Math.ceil(filteredTransactions.length / TRANSACTIONS_PER_PAGE) || 1;
  const paginatedTransactions = filteredTransactions.slice(
    (transactionPage - 1) * TRANSACTIONS_PER_PAGE,
    transactionPage * TRANSACTIONS_PER_PAGE
  );

  return (
    <section className="w-full space-y-6">
      <div>
        <h1 className="font-melon text-2xl font-bold text-[#4A1D1F]">Finance</h1>
        <p className="text-sm text-[#646464]">Store totals, transactions, and order refunds.</p>
      </div>

      {error && <p className="rounded-lg bg-red-50 px-3 py-2 text-sm text-red-800">{error}</p>}
      {loading && <p className="text-sm text-[#646464]">Loading…</p>}

      {!loading && summary && (
        <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
          {[
            { label: "Gross sales", v: `Rs.${Number(summary.grossSales).toFixed(2)}` },
            { label: "Net revenue", v: `Rs.${Number(summary.netRevenue).toFixed(2)}` },
            { label: "Orders", v: String(summary.orderCount) },
            { label: "Refunded Amount", v: `Rs.${Number(summary.refundsTotal).toFixed(2)}` },
          ].map((c) => (
            <div key={c.label} className="rounded-2xl border border-[#E8DCC8] bg-white p-4 shadow-sm">
              <p className="text-xs font-semibold uppercase text-[#646464]">{c.label}</p>
              <p className="mt-1 font-melon text-xl font-bold text-[#4A1D1F]">{c.v}</p>
            </div>
          ))}
        </div>
      )}

      <div className="rounded-2xl border border-[#E8DCC8] bg-white p-4 shadow-sm">
        <h2 className="font-melon text-lg font-semibold text-[#4A1D1F]">Record refund</h2>
        <form onSubmit={createRefund} className="mt-3 flex flex-wrap items-end gap-3">
          <label className="text-xs font-semibold uppercase text-[#646464]">
            Order ID
            <input
              value={orderId}
              onChange={(e) => setOrderId(e.target.value)}
              className="mt-1 block rounded-lg border border-[#D9D9D1] px-3 py-2 text-sm font-mono"
            />
          </label>
          <label className="text-xs font-semibold uppercase text-[#646464]">
            Amount
            <input
              type="number"
              step="0.01"
              min="0"
              value={refundAmount}
              onChange={(e) => setRefundAmount(e.target.value)}
              className="mt-1 block w-32 rounded-lg border border-[#D9D9D1] px-3 py-2 text-sm"
            />
          </label>
          <label className="text-xs font-semibold uppercase text-[#646464]">
            Reason
            <input
              value={refundReason}
              onChange={(e) => setRefundReason(e.target.value)}
              className="mt-1 block rounded-lg border border-[#D9D9D1] px-3 py-2 text-sm"
            />
          </label>
          <button
            type="submit"
            disabled={busy === "create-refund"}
            className="rounded-full bg-[#7B3010] px-5 py-2.5 text-xs font-semibold uppercase tracking-wide text-white disabled:opacity-50"
          >
            {busy === "create-refund" ? "Saving…" : "Create refund"}
          </button>
        </form>
      </div>

      {!loading && (
        <>
          <div>
            <div className="mb-2 flex flex-wrap items-center justify-between gap-4">
              <h2 className="font-melon text-lg font-semibold text-[#4A1D1F]">Refunds</h2>
              <div className="flex flex-wrap items-center gap-2">
                <input
                  type="text"
                  placeholder="Search Order ID..."
                  value={refundSearch}
                onChange={(e) => {
                  setRefundSearch(e.target.value);
                  setRefundPage(1);
                }}
                  className="w-40 rounded-lg border border-[#D9D9D1] bg-white px-3 py-1.5 text-xs focus:border-[#7B3010] focus:outline-none"
                />
                <Select
                  value={refundStatusFilter}
                  onValueChange={(val) => {
                    setRefundStatusFilter(val);
                    setRefundPage(1);
                  }}
                >
                  <SelectTrigger className="!h-[30px] w-36 rounded-lg border border-[#D9D9D1] bg-white px-2 py-1 text-xs capitalize shadow-none focus:border-[#7B3010] focus:outline-none focus:ring-0 focus-visible:ring-0">
                    <SelectValue placeholder="All Statuses" />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="all">All Statuses</SelectItem>
                    {refundStatusOptions.map((option) => (
                      <SelectItem key={option.value} value={option.value} className="capitalize">
                        {option.label}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
                <button
                  type="button"
                  onClick={() => {
                    setRefundSearch("");
                    setRefundStatusFilter("all");
                  setRefundPage(1);
                  }}
                  className="rounded-full cursor-pointer bg-[#7B3010] px-4 py-1.5 text-xs font-semibold uppercase tracking-wide text-white"
                >
                  Clear
                </button>
              </div>
            </div>
            <ConsoleTable headers={["Order", "Amount", "Status", "Reason", ""]}>
            {paginatedRefunds.length === 0 ? (
                <tr>
                  <ConsoleTd className="py-6 text-center text-[#646464]" colSpan={5}>
                    {refunds.length === 0 ? "No refunds." : "No refunds match your filters."}
                  </ConsoleTd>
                </tr>
              ) : (
              paginatedRefunds.map((r) => (
                  <tr key={r.id} className="hover:bg-[#FFFBF3]/80">
                    <ConsoleTd className="font-mono text-[11px]">{(r.order?.id ?? r.orderId).slice(0, 14)}…</ConsoleTd>
                    <ConsoleTd className="text-[11px]">{r.id.slice(0, 10)}...</ConsoleTd>
                    <ConsoleTd>Rs.{Number(r.amount).toFixed(2)}</ConsoleTd>
                    <ConsoleTd>
                      <Select
                        value={rfDraft[r.id] ?? r.status}
                        onValueChange={(val) => setRfDraft((d) => ({ ...d, [r.id]: val }))}
                      >
                        <SelectTrigger className="!h-[26px] w-full max-w-[130px] rounded-lg border border-[#D9D9D1] bg-white px-2 py-1 text-xs capitalize shadow-none focus:border-[#7B3010] focus:outline-none focus:ring-0 focus-visible:ring-0">
                          <SelectValue placeholder="Status" />
                        </SelectTrigger>
                        <SelectContent>
                          {refundStatusOptions.map((option) => (
                            <SelectItem key={option.value} value={option.value} className="capitalize">
                              {option.label}
                            </SelectItem>
                          ))}
                        </SelectContent>
                      </Select>
                    </ConsoleTd>
                    <ConsoleTd className="text-xs">{r.reason || "—"}</ConsoleTd>

                    <ConsoleTd>
                      <button
                        type="button"
                        disabled={busy === `rf-${r.id}` || (rfDraft[r.id] ?? r.status) === r.status}
                        onClick={() => saveRf(r.id)}
                        className="rounded-full bg-[#7B3010] px-3 py-1.5 text-[11px] font-semibold uppercase text-white disabled:opacity-40"
                      >
                        {busy === `rf-${r.id}` ? "…" : "Apply"}
                      </button>
                      <button
                        type="button"
                        disabled={busy === `rfm-${r.id}`}
                        onClick={() => markManualRefund(r.id)}
                        className="ml-2 rounded-full border border-[#E8DCC8] bg-white px-3 py-1.5 text-[11px] font-semibold uppercase text-[#4A1D1F] disabled:opacity-40"
                      >
                        {busy === `rfm-${r.id}` ? "…" : "Mark manual"}
                      </button>
                      <button
                        type="button"
                        disabled={busy === `rft-${r.id}`}
                        onClick={() => triggerRefund(r.id)}
                        className="ml-2 rounded-full border border-[#E8DCC8] bg-white px-3 py-1.5 text-[11px] font-semibold uppercase text-[#4A1D1F] disabled:opacity-40"
                      >
                        {busy === `rft-${r.id}` ? "…" : "Trigger refund"}
                      </button>
                    </ConsoleTd>
                  </tr>
                ))
              )}
            </ConsoleTable>
          {totalRefundPages > 1 && (
            <div className="mt-4 flex items-center justify-between">
              <p className="text-xs text-[#646464]">
                Showing {(refundPage - 1) * REFUNDS_PER_PAGE + 1} to {Math.min(refundPage * REFUNDS_PER_PAGE, filteredRefunds.length)} of {filteredRefunds.length} entries
              </p>
              <div className="flex items-center gap-2">
                <button
                  type="button"
                  disabled={refundPage === 1}
                  onClick={() => setRefundPage((p) => Math.max(1, p - 1))}
                  className="rounded border border-[#D9D9D1] bg-white px-3 py-1 text-xs font-semibold text-[#4A1D1F] disabled:opacity-50"
                >
                  Previous
                </button>
                <span className="text-xs font-semibold text-[#646464]">
                  Page {refundPage} of {totalRefundPages}
                </span>
                <button
                  type="button"
                  disabled={refundPage === totalRefundPages}
                  onClick={() => setRefundPage((p) => Math.min(totalRefundPages, p + 1))}
                  className="rounded border border-[#D9D9D1] bg-white px-3 py-1 text-xs font-semibold text-[#4A1D1F] disabled:opacity-50"
                >
                  Next
                </button>
              </div>
            </div>
          )}
          </div>

        <div className="mt-8">
          <div className="mb-2 flex flex-wrap items-center justify-between gap-4">
            <h2 className="font-melon text-lg font-semibold text-[#4A1D1F]">Transactions</h2>
            <div className="flex flex-wrap items-center gap-2">
              <input
                type="text"
                placeholder="Search ID..."
                value={transactionSearch}
                onChange={(e) => {
                  setTransactionSearch(e.target.value);
                  setTransactionPage(1);
                }}
                className="w-40 rounded-lg border border-[#D9D9D1] bg-white px-3 py-1.5 text-xs focus:border-[#7B3010] focus:outline-none"
              />
              <Select
                value={transactionStatusFilter}
                onValueChange={(val) => {
                  setTransactionStatusFilter(val);
                  setTransactionPage(1);
                }}
              >
                <SelectTrigger className="!h-[30px] w-36 rounded-lg border border-[#D9D9D1] bg-white px-2 py-1 text-xs capitalize shadow-none focus:border-[#7B3010] focus:outline-none focus:ring-0 focus-visible:ring-0">
                  <SelectValue placeholder="All Statuses" />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="all">All Statuses</SelectItem>
                  {transactionStatusOptions.map((option) => (
                    <SelectItem key={option.value} value={option.value} className="capitalize">
                      {option.label}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
              <button
                type="button"
                onClick={() => {
                  setTransactionSearch("");
                  setTransactionStatusFilter("all");
                  setTransactionPage(1);
                }}
                className="rounded-full cursor-pointer bg-[#7B3010] px-4 py-1.5 text-xs font-semibold uppercase tracking-wide text-white"
              >
                Clear
              </button>
            </div>
          </div>
          <ConsoleTable headers={["ID", "Reference", "Type", "Amount", "Status", "Date"]}>
            {paginatedTransactions.length === 0 ? (
              <tr>
                <ConsoleTd className="py-6 text-center text-[#646464]" colSpan={6}>
                  {transactions.length === 0 ? "No transactions found." : "No transactions match your filters."}
                </ConsoleTd>
              </tr>
            ) : (
              paginatedTransactions.map((t) => (
                <tr key={t.id} className="hover:bg-[#FFFBF3]/80">
                  <ConsoleTd className="font-mono text-[11px]">{t.id.slice(0, 14)}…</ConsoleTd>
                  <ConsoleTd className="text-xs">{t.referenceId || "—"}</ConsoleTd>
                  <ConsoleTd className="text-xs capitalize">{t.type}</ConsoleTd>
                  <ConsoleTd>Rs.{Number(t.amount).toFixed(2)}</ConsoleTd>
                  <ConsoleTd className="text-xs capitalize">{t.status}</ConsoleTd>
                  <ConsoleTd className="text-xs">{new Date(t.createdAt).toLocaleString()}</ConsoleTd>
                </tr>
              ))
            )}
          </ConsoleTable>
          {totalTransactionPages > 1 && (
            <div className="mt-4 flex items-center justify-between">
              <p className="text-xs text-[#646464]">
                Showing {(transactionPage - 1) * TRANSACTIONS_PER_PAGE + 1} to {Math.min(transactionPage * TRANSACTIONS_PER_PAGE, filteredTransactions.length)} of {filteredTransactions.length} entries
              </p>
              <div className="flex items-center gap-2">
                <button
                  type="button"
                  disabled={transactionPage === 1}
                  onClick={() => setTransactionPage((p) => Math.max(1, p - 1))}
                  className="rounded border border-[#D9D9D1] bg-white px-3 py-1 text-xs font-semibold text-[#4A1D1F] disabled:opacity-50"
                >
                  Previous
                </button>
                <span className="text-xs font-semibold text-[#646464]">
                  Page {transactionPage} of {totalTransactionPages}
                </span>
                <button
                  type="button"
                  disabled={transactionPage === totalTransactionPages}
                  onClick={() => setTransactionPage((p) => Math.min(totalTransactionPages, p + 1))}
                  className="rounded border border-[#D9D9D1] bg-white px-3 py-1 text-xs font-semibold text-[#4A1D1F] disabled:opacity-50"
                >
                  Next
                </button>
              </div>
            </div>
          )}
        </div>
        </>
      )}
    </section>
  );
}
