"use client";

import { useCallback, useEffect, useState } from "react";
import { authedFetch } from "@/lib/dashboard-fetch";

type FinancePayload = {
  summary: {
    grossSales: string | number;
    netRevenue: string | number;
    orderCount: number;
    refundsTotal: string | number;
  };
};

export default function SellerFinancePage() {
  const [data, setData] = useState<FinancePayload | null>(null);
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(true);

  const load = useCallback(() => {
    setLoading(true);
    setError("");
    authedFetch<FinancePayload>("/api/v1/finance/my")
      .then(setData)
      .catch((e: Error) => setError(e.message))
      .finally(() => setLoading(false));
  }, []);

  useEffect(() => {
    load();
  }, [load]);

  return (
    <section className="w-full space-y-6">
      <div>
        <h1 className="font-melon text-2xl font-bold text-[#4A1D1F]">Finance</h1>
        <p className="text-sm text-[#646464]">Single-vendor financial overview and refunds.</p>
      </div>

      {error && <p className="rounded-lg bg-red-50 px-3 py-2 text-sm text-red-800">{error}</p>}
      {loading && <p className="text-sm text-[#646464]">Loading…</p>}

      {!loading && data && (
        <>
          <div className="grid gap-3 sm:grid-cols-3">
            {[
              { label: "Gross sales", v: `Rs.${Number(data.summary.grossSales).toFixed(2)}` },
              { label: "Net revenue", v: `Rs.${Number(data.summary.netRevenue).toFixed(2)}` },
              { label: "Orders", v: String(data.summary.orderCount) },
              { label: "Refunded", v: `Rs.${Number(data.summary.refundsTotal).toFixed(2)}` },
            ].map((c) => (
              <div key={c.label} className="rounded-2xl border border-[#E8DCC8] bg-white p-4 shadow-sm">
                <p className="text-xs font-semibold uppercase text-[#646464]">{c.label}</p>
                <p className="mt-1 font-melon text-xl font-bold text-[#4A1D1F]">{c.v}</p>
              </div>
            ))}
          </div>

          <div className="rounded-2xl border border-[#E8DCC8] bg-white p-4 shadow-sm">
            <h2 className="font-melon text-lg font-semibold text-[#4A1D1F]">Withdrawals removed</h2>
            <p className="mt-2 text-sm text-[#646464]">Withdrawals are disabled in single-vendor mode. Use refunds and transactions only.</p>
          </div>
        </>
      )}
    </section>
  );
}
