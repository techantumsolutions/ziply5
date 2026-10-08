"use client";

import { useCallback, useEffect, useState } from "react";
import { authedFetch } from "@/lib/dashboard-fetch";
import { ConsoleTable, ConsoleTd } from "@/components/dashboard/ConsoleTable";

type ReturnRow = {
  id: string;
  status: string;
  reason: string | null;
  createdAt: string;
  order: { id: string; total: string | number; status: string };
};

export default function SellerReturnsPage() {
  const [rows, setRows] = useState<ReturnRow[]>([]);
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(true);

  const load = useCallback(() => {
    setLoading(true);
    setError("");
    authedFetch<ReturnRow[]>("/api/v1/returns")
      .then(setRows)
      .catch((e: Error) => setError(e.message))
      .finally(() => setLoading(false));
  }, []);

  useEffect(() => {
    load();
  }, [load]);

  return (
    <section className="w-full space-y-4">
      <div>
        <h1 className="font-melon text-2xl font-bold text-[#4A1D1F]">Returns</h1>
        <p className="text-sm text-[#646464]">Return requests for orders that include your products.</p>
      </div>

      {error && <p className="rounded-lg bg-red-50 px-3 py-2 text-sm text-red-800">{error}</p>}
      {loading && <p className="text-sm text-[#646464]">Loading…</p>}

      {!loading && (
        <ConsoleTable headers={["Order", "Placed", "Reason", "Status"]}>
          {rows.length === 0 ? (
            <tr>
              <ConsoleTd className="py-8 text-center text-[#646464]" colSpan={4}>
                No return requests.
              </ConsoleTd>
            </tr>
          ) : (
            rows.map((r) => (
              <tr key={r.id} className="hover:bg-[#FFFBF3]/80">
                <ConsoleTd>
                  <span className="font-mono text-[11px]">{r.order.id.slice(0, 12)}…</span>
                  <div className="text-[11px] text-[#646464]">Rs.{Number(r.order.total).toFixed(2)}</div>
                </ConsoleTd>
                <ConsoleTd>{new Date(r.createdAt).toLocaleString()}</ConsoleTd>
                <ConsoleTd className="max-w-[240px] text-xs">{r.reason ?? "—"}</ConsoleTd>
                <ConsoleTd className="capitalize">{r.status}</ConsoleTd>
              </tr>
            ))
          )}
        </ConsoleTable>
      )}
    </section>
  );
}
