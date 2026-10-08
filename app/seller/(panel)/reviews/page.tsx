"use client";

import { useCallback, useEffect, useState } from "react";
import { authedFetch } from "@/lib/dashboard-fetch";
import { ConsoleTable, ConsoleTd } from "@/components/dashboard/ConsoleTable";

type ReviewRow = {
  id: string;
  rating: number;
  status: string;
  title: string | null;
  body: string | null;
  createdAt: string;
  product: { name: string; slug: string };
  user: { email: string | null; name: string | null } | null;
};

export default function SellerReviewsPage() {
  const [rows, setRows] = useState<ReviewRow[]>([]);
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(true);

  const load = useCallback(() => {
    setLoading(true);
    setError("");
    authedFetch<ReviewRow[]>("/api/v1/reviews")
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
        <h1 className="font-melon text-2xl font-bold text-[#4A1D1F]">Reviews</h1>
        <p className="text-sm text-[#646464]">Reviews on your products (moderation is handled in admin).</p>
      </div>

      {error && <p className="rounded-lg bg-red-50 px-3 py-2 text-sm text-red-800">{error}</p>}
      {loading && <p className="text-sm text-[#646464]">Loading…</p>}

      {!loading && (
        <ConsoleTable headers={["Product", "Rating", "Status", "Author", "Submitted"]}>
          {rows.length === 0 ? (
            <tr>
              <ConsoleTd className="py-8 text-center text-[#646464]" colSpan={5}>
                No reviews for your products yet.
              </ConsoleTd>
            </tr>
          ) : (
            rows.map((r) => (
              <tr key={r.id} className="hover:bg-[#FFFBF3]/80">
                <ConsoleTd className="font-medium">{r.product.name}</ConsoleTd>
                <ConsoleTd>{r.rating}★</ConsoleTd>
                <ConsoleTd className="capitalize">{r.status}</ConsoleTd>
                <ConsoleTd className="text-xs">{r.user?.email ?? "Guest"}</ConsoleTd>
                <ConsoleTd className="text-xs">{new Date(r.createdAt).toLocaleString()}</ConsoleTd>
              </tr>
            ))
          )}
        </ConsoleTable>
      )}
    </section>
  );
}
