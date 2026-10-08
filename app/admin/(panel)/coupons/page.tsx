"use client";

import { useCallback, useEffect, useState } from "react";
import { authedFetch } from "@/lib/dashboard-fetch";
import { ConsoleTable, ConsoleTd } from "@/components/dashboard/ConsoleTable";

type CouponRow = {
  id: string;
  code: string;
  discountType: string;
  discountValue: string | number;
  active: boolean;
  startsAt: string | null;
  endsAt: string | null;
};

export default function AdminCouponsPage() {
  const [rows, setRows] = useState<CouponRow[]>([]);
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(true);

  const load = useCallback(() => {
    setLoading(true);
    setError("");
    authedFetch<CouponRow[]>("/api/v1/coupons")
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
          <h1 className="font-melon text-2xl font-bold text-[#4A1D1F]">Coupons</h1>
          <p className="text-sm text-[#646464]">Promotional codes (percent or fixed discount).</p>
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
        <ConsoleTable headers={["Code", "Type", "Value", "Active", "Window"]}>
          {rows.length === 0 ? (
            <tr>
              <ConsoleTd colSpan={5} className="py-8 text-center text-[#646464]">
                No coupons. Create via POST /api/v1/coupons.
              </ConsoleTd>
            </tr>
          ) : (
            rows.map((c) => (
              <tr key={c.id} className="hover:bg-[#FFFBF3]/80">
                <ConsoleTd>
                  <code className="font-semibold">{c.code}</code>
                </ConsoleTd>
                <ConsoleTd className="capitalize">{c.discountType}</ConsoleTd>
                <ConsoleTd>
                  {c.discountType === "percent" ? `${Number(c.discountValue)}%` : `Rs.${Number(c.discountValue).toFixed(2)}`}
                </ConsoleTd>
                <ConsoleTd>{c.active ? "Yes" : "No"}</ConsoleTd>
                <ConsoleTd className="text-[11px] text-[#646464]">
                  {c.startsAt ? new Date(c.startsAt).toLocaleDateString() : "—"} →{" "}
                  {c.endsAt ? new Date(c.endsAt).toLocaleDateString() : "—"}
                </ConsoleTd>
              </tr>
            ))
          )}
        </ConsoleTable>
      )}
    </section>
  );
}
