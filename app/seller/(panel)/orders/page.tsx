"use client";

import { useCallback, useEffect, useState } from "react";
import { authedFetch } from "@/lib/dashboard-fetch";
import { ConsoleTable, ConsoleTd } from "@/components/dashboard/ConsoleTable";

type OrderRow = {
  id: string;
  status: string;
  total: string | number;
  createdAt: string;
  items?: Array<{ quantity: number; product: { name: string; slug: string; sellerId?: string | null } }>;
};

export default function SellerOrdersPage() {
  const [rows, setRows] = useState<OrderRow[]>([]);
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(true);

  const load = useCallback(() => {
    setLoading(true);
    setError("");
    authedFetch<{ items: OrderRow[] }>("/api/v1/orders?page=1&limit=1000")
      .then((d) => setRows(d.items))
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
          <h1 className="font-melon text-2xl font-bold text-[#4A1D1F]">Orders</h1>
          <p className="text-sm text-[#646464]">Orders that include at least one of your products (read-only).</p>
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
        <ConsoleTable headers={["Order", "Placed", "Your lines", "Total", "Status"]}>
          {rows.length === 0 ? (
            <tr>
              <ConsoleTd colSpan={5} className="py-8 text-center text-[#646464]">
                No orders yet containing your products.
              </ConsoleTd>
            </tr>
          ) : (
            rows.map((o) => (
              <tr key={o.id} className="hover:bg-[#FFFBF3]/80">
                <ConsoleTd>
                  <span className="font-mono text-[11px]">{o.id.slice(0, 12)}…</span>
                </ConsoleTd>
                <ConsoleTd className="text-[12px]">{new Date(o.createdAt).toLocaleString()}</ConsoleTd>
                <ConsoleTd>
                  <ul className="max-w-[220px] space-y-0.5 text-[11px]">
                    {(o.items ?? []).map((l, i) => (
                      <li key={i}>
                        {l.product.name} ×{l.quantity}
                      </li>
                    ))}
                  </ul>
                </ConsoleTd>
                <ConsoleTd className="font-semibold">Rs.{Number(o.total).toFixed(2)}</ConsoleTd>
                <ConsoleTd className="capitalize">{o.status}</ConsoleTd>
              </tr>
            ))
          )}
        </ConsoleTable>
      )}
    </section>
  );
}
