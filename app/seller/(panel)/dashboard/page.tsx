"use client";

import { useEffect, useState } from "react";
import { authedFetch } from "@/lib/dashboard-fetch";

type SellerSummary = {
  scope: string;
  myProducts: number;
  ordersTouchingMyProducts: number;
  revenueFromMyLines: string | number;
};

export default function SellerDashboardPage() {
  const [summary, setSummary] = useState<SellerSummary | null>(null);
  const [error, setError] = useState("");

  useEffect(() => {
    let cancelled = false;
    authedFetch<SellerSummary>("/api/v1/dashboard/summary")
      .then((data) => {
        if (cancelled) return;
        if (data.scope !== "seller") {
          setError("This dashboard is for seller accounts.");
          return;
        }
        setSummary(data);
        setError("");
      })
      .catch((e: Error) => {
        if (!cancelled) setError(e.message);
      });
    return () => {
      cancelled = true;
    };
  }, []);

  return (
    <section className="w-full">
      <h1 className="font-melon text-2xl font-bold tracking-wide text-[#4A1D1F] md:text-3xl">Seller Dashboard</h1>
      <p className="mt-2 text-sm text-[#646464]">Your catalog and orders that include your products.</p>

      {error && (
        <div className="mt-6 rounded-xl border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-800">
          <p className="font-semibold">Could not load dashboard</p>
          <p className="mt-1 font-mono text-xs opacity-90">{error}</p>
        </div>
      )}

      {summary && (
        <div className="mt-8 grid gap-4 sm:grid-cols-3">
          <div className="rounded-2xl border border-[#E8DCC8] bg-white p-5 shadow-sm">
            <p className="text-xs font-semibold uppercase tracking-wide text-[#646464]">My products</p>
            <p className="mt-2 text-2xl font-bold text-[#4A1D1F]">{summary.myProducts}</p>
          </div>
          <div className="rounded-2xl border border-[#E8DCC8] bg-white p-5 shadow-sm">
            <p className="text-xs font-semibold uppercase tracking-wide text-[#646464]">Orders with my items</p>
            <p className="mt-2 text-2xl font-bold text-[#4A1D1F]">{summary.ordersTouchingMyProducts}</p>
          </div>
          <div className="rounded-2xl border border-[#E8DCC8] bg-white p-5 shadow-sm">
            <p className="text-xs font-semibold uppercase tracking-wide text-[#646464]">Revenue (my lines)</p>
            <p className="mt-2 text-2xl font-bold text-[#4A1D1F]">Rs.{Number(summary.revenueFromMyLines).toFixed(2)}</p>
          </div>
        </div>
      )}
    </section>
  );
}
