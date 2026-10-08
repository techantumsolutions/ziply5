"use client";

import { useCallback, useEffect, useState, useMemo } from "react";
import { authedFetch, authedPatch } from "@/lib/dashboard-fetch";
import { ConsoleTable, ConsoleTd } from "@/components/dashboard/ConsoleTable";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";

type ReviewRow = {
  id: string;
  productId: string;
  orderId?: string | null;
  rating: number;
  status: string;
  title: string | null;
  body: string | null;
  createdAt: string;
  product: { name: string; slug: string };
  user: { email: string | null; name: string | null } | null;
};

const STATUSES = ["published", "archived"] as const;

export default function AdminReviewsPage() {
  const [rows, setRows] = useState<ReviewRow[]>([]);
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(true);
  const [draft, setDraft] = useState<Record<string, string>>({});
  const [updating, setUpdating] = useState<string | null>(null);

  // Search & Filter State
  const [searchTerm, setSearchTerm] = useState("");
  const [ratingFilter, setRatingFilter] = useState("all");
  const [statusFilter, setStatusFilter] = useState("all");

  const load = useCallback(() => {
    setLoading(true);
    setError("");
    authedFetch<ReviewRow[]>("/api/v1/reviews")
      .then((r) => {
        setRows(r);
        const d: Record<string, string> = {};
        r.forEach((x) => {
          d[x.id] = x.status;
        });
        setDraft(d);
      })
      .catch((e: Error) => setError(e.message))
      .finally(() => setLoading(false));
  }, []);

  useEffect(() => {
    load();
  }, [load]);

  const save = async (id: string) => {
    const status = draft[id];
    if (!status) return;
    setUpdating(id);
    setError("");
    try {
      await authedPatch(`/api/v1/reviews/${id}`, { status });
      await load();
    } catch (e) {
      setError(e instanceof Error ? e.message : "Update failed");
    } finally {
      setUpdating(null);
    }
  };

  const filteredRows = useMemo(() => {
    return rows.filter((r) => {
      const matchesSearch =
        !searchTerm ||
        (r.product?.name || "").toLowerCase().includes(searchTerm.toLowerCase()) ||
        (r.user?.name || "Guest").toLowerCase().includes(searchTerm.toLowerCase()) ||
        (r.user?.email || "").toLowerCase().includes(searchTerm.toLowerCase());

      const matchesRating = ratingFilter === "all" || r.rating === Number(ratingFilter);
      const matchesStatus = statusFilter === "all" || r.status === statusFilter;

      return matchesSearch && matchesRating && matchesStatus;
    });
  }, [rows, searchTerm, ratingFilter, statusFilter]);

  return (
    <section className="w-full space-y-4">
      <div>
        <h1 className="font-melon text-2xl font-bold text-[#4A1D1F]">Reviews</h1>
        <p className="text-sm text-[#646464]">Manage published and archived product reviews.</p>
      </div>

      <div className="mt-4 grid gap-3 md:grid-cols-2 xl:grid-cols-4">
        <input
          type="text"
          placeholder="Search product, user, email..."
          value={searchTerm}
          onChange={(e) => setSearchTerm(e.target.value)}
          className="w-full rounded-full border border-[#E3E3DA] bg-[#FAFBF9] px-4 py-2.5 text-sm placeholder-[#8A8A8A] focus:border-[#7B3010] focus:outline-none"
        />
        <Select value={ratingFilter} onValueChange={setRatingFilter}>
          <SelectTrigger className="h-auto w-full rounded-full border border-[#E3E3DA] bg-white px-4 py-2.5 text-sm text-[#4A1D1F] shadow-none focus:border-[#7B3010] focus:outline-none focus:ring-0 focus-visible:ring-0">
            <SelectValue placeholder="All ratings" />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="all">All ratings</SelectItem>
            <SelectItem value="5">5 Stars</SelectItem>
            <SelectItem value="4">4 Stars</SelectItem>
            <SelectItem value="3">3 Stars</SelectItem>
            <SelectItem value="2">2 Stars</SelectItem>
            <SelectItem value="1">1 Star</SelectItem>
          </SelectContent>
        </Select>
        <Select value={statusFilter} onValueChange={setStatusFilter}>
          <SelectTrigger className="h-auto w-full rounded-full border border-[#E3E3DA] bg-white px-4 py-2.5 text-sm text-[#4A1D1F] shadow-none focus:border-[#7B3010] focus:outline-none focus:ring-0 focus-visible:ring-0">
            <SelectValue placeholder="All statuses" />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="all">All statuses</SelectItem>
            <SelectItem value="published">Published</SelectItem>
            <SelectItem value="archived">Archived</SelectItem>
          </SelectContent>
        </Select>
      </div>

      {error && <p className="rounded-lg bg-red-50 px-3 py-2 text-sm text-red-800">{error}</p>}
      {loading && <p className="text-sm text-[#646464]">Loading…</p>}

      {!loading && (
        <ConsoleTable headers={["Product", "User", "Rating", "Content", "Status", ""]}>
          {filteredRows.length === 0 ? (
            <tr>
              <ConsoleTd className="py-8 text-center text-[#646464]" colSpan={6}>
                No reviews found.
              </ConsoleTd>
            </tr>
          ) : (
            filteredRows.map((r) => (
              <tr key={r.id} className="hover:bg-[#FFFBF3]/80">
                <ConsoleTd>
                  <div className="font-medium">{r.product.name}</div>
                  <div className="text-[11px] text-[#646464]">{r.productId}</div>
                </ConsoleTd>
                <ConsoleTd className="text-xs">
                  <div>{r.user?.name ?? "Guest"}</div>
                  <div className="text-[11px] text-[#646464]">{r.user?.email ?? "—"}</div>
                </ConsoleTd>
                <ConsoleTd>{r.rating}★</ConsoleTd>
                <ConsoleTd className="text-xs">
                  <div className="font-medium">{r.title ?? "—"}</div>
                  <div className="text-[11px] text-[#646464]">{r.body?.slice(0, 140) ?? "—"}</div>
                </ConsoleTd>
                <ConsoleTd>
                  <select
                    value={draft[r.id] ?? r.status}
                    onChange={(e) => setDraft((d) => ({ ...d, [r.id]: e.target.value }))}
                    className="rounded-lg border border-[#D9D9D1] bg-white px-2 py-1 text-xs capitalize"
                  >
                    {STATUSES.map((s) => (
                      <option key={s} value={s}>
                        {s}
                      </option>
                    ))}
                  </select>
                </ConsoleTd>
                <ConsoleTd>
                  <button
                    type="button"
                    disabled={updating === r.id || (draft[r.id] ?? r.status) === r.status}
                    onClick={() => save(r.id)}
                    className="rounded-full bg-[#7B3010] px-3 py-1.5 text-[11px] font-semibold uppercase text-white disabled:opacity-40"
                  >
                    {updating === r.id ? "Saving…" : "Apply"}
                  </button>
                </ConsoleTd>
              </tr>
            ))
          )}
        </ConsoleTable>
      )}
    </section>
  );
}
