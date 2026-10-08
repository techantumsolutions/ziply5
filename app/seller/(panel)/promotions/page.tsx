"use client";

import { useCallback, useEffect, useState } from "react";
import { authedFetch } from "@/lib/dashboard-fetch";
import { ConsoleTable, ConsoleTd } from "@/components/dashboard/ConsoleTable";

type Promo = {
  id: string;
  kind: string;
  name: string;
  active: boolean;
  startsAt: string | null;
  endsAt: string | null;
  productId: string | null;
};

export default function SellerPromotionsPage() {
  const [rows, setRows] = useState<Promo[]>([]);
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(true);

  const load = useCallback(() => {
    setLoading(true);
    setError("");
    authedFetch<Promo[]>("/api/v1/promotions")
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
        <h1 className="font-melon text-2xl font-bold text-[#4A1D1F]">Promotions</h1>
        <p className="text-sm text-[#646464]">Active campaigns (read-only; create in admin).</p>
      </div>

      {error && <p className="rounded-lg bg-red-50 px-3 py-2 text-sm text-red-800">{error}</p>}
      {loading && <p className="text-sm text-[#646464]">Loading…</p>}

      {!loading && (
        <ConsoleTable headers={["Name", "Kind", "Active", "Window"]}>
          {rows.length === 0 ? (
            <tr>
              <ConsoleTd className="py-8 text-center text-[#646464]" colSpan={4}>
                No promotions configured.
              </ConsoleTd>
            </tr>
          ) : (
            rows.map((r) => (
              <tr key={r.id} className="hover:bg-[#FFFBF3]/80">
                <ConsoleTd className="font-medium">{r.name}</ConsoleTd>
                <ConsoleTd className="text-xs capitalize">{r.kind.replace("_", " ")}</ConsoleTd>
                <ConsoleTd>{r.active ? "Yes" : "No"}</ConsoleTd>
                <ConsoleTd className="text-[11px] text-[#646464]">
                  {r.startsAt ? new Date(r.startsAt).toLocaleString() : "—"} →{" "}
                  {r.endsAt ? new Date(r.endsAt).toLocaleString() : "—"}
                </ConsoleTd>
              </tr>
            ))
          )}
        </ConsoleTable>
      )}
    </section>
  );
}
