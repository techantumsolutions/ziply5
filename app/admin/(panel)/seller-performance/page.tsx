"use client";

import { useCallback, useEffect, useState } from "react";
import { authedFetch } from "@/lib/dashboard-fetch";
import { ConsoleTable, ConsoleTd } from "@/components/dashboard/ConsoleTable";

type Row = {
  sellerId: string;
  name: string;
  email: string;
  revenue: number;
  lines: number;
};

export default function AdminSellerPerformancePage() {
  const [rows, setRows] = useState<Row[]>([]);
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(true);

  const load = useCallback(() => {
    setLoading(true);
    setError("");
    authedFetch<Row[]>("/api/v1/reports/sellers")
      .then(setRows)
      .catch((e: Error) => setError(e.message))
      .finally(() => setLoading(false));
  }, []);

  useEffect(() => {
    load();
  }, [load]);

  return (
    <section className="w-full space-y-4">
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <h1 className="font-melon text-2xl font-bold text-[#4A1D1F]">Platform performance</h1>
          <p className="text-sm text-[#646464]">Aggregated revenue view for admin-owned order lines.</p>
        </div>
        <button
          type="button"
          onClick={() => load()}
          className="rounded-full border border-[#E8DCC8] bg-white px-4 py-2 text-xs font-semibold uppercase tracking-wide text-[#4A1D1F] hover:bg-[#FFFBF3]"
        >
          Refresh
        </button>
      </div>

      {error && <p className="rounded-lg bg-red-50 px-3 py-2 text-sm text-red-800">{error}</p>}
      {loading && <p className="text-sm text-[#646464]">Loading…</p>}

      {!loading && (
        <ConsoleTable headers={["Seller", "Email", "Distinct lines", "Revenue"]}>
          {rows.length === 0 ? (
            <tr>
              <ConsoleTd className="py-8 text-center text-[#646464]" colSpan={4}>
                No performance rows yet.
              </ConsoleTd>
            </tr>
          ) : (
            rows.map((r) => (
              <tr key={r.sellerId} className="hover:bg-[#FFFBF3]/80">
                <ConsoleTd className="font-medium">{r.name}</ConsoleTd>
                <ConsoleTd className="text-xs">{r.email}</ConsoleTd>
                <ConsoleTd>{r.lines}</ConsoleTd>
                <ConsoleTd className="font-semibold">Rs.{Number(r.revenue).toFixed(2)}</ConsoleTd>
              </tr>
            ))
          )}
        </ConsoleTable>
      )}
    </section>
  );
}
