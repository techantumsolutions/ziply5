"use client";

import { useMemo, useState,useEffect } from "react";
import { authedFetch } from "@/lib/dashboard-fetch";
import { ConsoleTable, ConsoleTd } from "@/components/dashboard/ConsoleTable";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Label } from "@/components/ui/label";
import { Button } from "@/components/ui/button";

type ReportData = {
  from: string;
  to: string;

  orderCount: number;

  revenueTotal: string | number;

  subtotalTotal: string | number;

  refundedAmount: string | number;
  netSale: string | number;

  byStatus: Array<{
    status: string;
    count: number;
    revenue: string | number;
  }>;

  //  NEW
  products: Array<{
    productId: string;
    productName: string;
    totalQuantity: number;
  }>;
};

type TagRow = {
  id: string;
  name: string;
};

export default function AdminReportsPage() {
  const defaultRange = useMemo(() => {
    const to = new Date();
    const from = new Date();
    from.setDate(from.getDate() - 30);
    return {
      from: from.toISOString().slice(0, 10),
      to: to.toISOString().slice(0, 10),
    };
  }, []);

  const [from, setFrom] = useState(defaultRange.from);
  const [prepType, setPrepType] = useState("");
  const [to, setTo] = useState(defaultRange.to);
  const [tags, setTags] = useState<TagRow[]>([]);
const [tagId, setTagId] = useState("");
  const [data, setData] = useState<ReportData | null>(null);
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(false);
  const [isSearching, setIsSearching] = useState(false);

 const run = () => {
  setLoading(true);
  setError("");

  const fromIso = `${from}T00:00:00.000Z`;
  const toIso = `${to}T23:59:59.999Z`;

  const params = new URLSearchParams({
    from: fromIso,
    to: toIso,
  });

  if (prepType && prepType !== "all") {
  params.append("preparationType", prepType);
}
  if (tagId) {
  params.append("tagId", tagId);
}

  authedFetch<ReportData>(
    `/api/v1/reports/sales?${params.toString()}`
  )
    .then(setData)
    .catch((e: Error) => {
      setData(null);
      setError(e.message);
    })
    .finally(() => {
      setLoading(false);
      setIsSearching(false);
    });
};



   useEffect(() => {
     authedFetch<TagRow[]>("/api/v1/tags")
    .then(setTags)
    .catch(() => setTags([]));
    run();
  }, []); // runs only once on mount

  console.log("Report data:", data);

  // if(loading){
  //   return(
  //     <div className="text-center py-20">
  //       <p className="text-lg font-medium text-gray-600">Loading report...</p>
  //     </div>
  //   )
  // }

  const handleReset = () => {
  // Reset dates
  setFrom(defaultRange.from);
  setTo(defaultRange.to);

  // Reset filters
  setPrepType("all");
  setTagId("all");

  // Reload with default values
  setTimeout(() => {
    run();
  }, 0);
};


  return (
    <section className="w-full space-y-6">
      <div>
        <h1 className="font-melon text-2xl font-bold text-[#4A1D1F]">Sales report</h1>
        <p className="text-sm text-[#646464]">Aggregated orders in a date range.</p>
      </div>

      <div className="flex flex-wrap items-end gap-4 rounded-2xl border border-[#E8DCC8] bg-white p-4 shadow-sm">
        <label className="text-xs font-semibold uppercase text-[#646464]">
          From
          <input
            type="date"
            value={from}
            max={to}
            onChange={(e) => setFrom(e.target.value)}
            className="mt-1 block rounded-lg border border-[#D9D9D1] px-3 py-2 text-sm"
          />
        </label>
        <label className="text-xs font-semibold uppercase text-[#646464]">
          To
          <input
            type="date"
            value={to}
            onChange={(e) => setTo(e.target.value)}
            min={from}
            className="mt-1 block rounded-lg border border-[#D9D9D1] px-3 py-2 text-sm"
          />
        </label>
           {/* Preparation Type */}
           <div>
            <Label className="text-xs font-semibold uppercase text-[#646464]">Preparation Type</Label>
              <Select
                value={prepType}
                onValueChange={(value) =>
                  setPrepType(value)
                }
              >
                <SelectTrigger className="w-[220px]  max-h-[35px]">
                  <SelectValue placeholder="All Preparation Types" />
                </SelectTrigger>

                <SelectContent>

                  <SelectItem value="all">
                    All Preparation Types
                  </SelectItem>

                  <SelectItem value="ready_to_eat">
                    Ready To Eat
                  </SelectItem>

                  <SelectItem value="ready_to_cook">
                    Ready To Cook
                  </SelectItem>

                </SelectContent>
              </Select>
            </div>

            {/* Tag Filter */}

            <div>
            <Label className="text-xs font-semibold uppercase text-[#646464]">Tag</Label>

            <Select
              value={tagId}
              onValueChange={(value) =>
                setTagId(value)
              }
            >

              <SelectTrigger className="w-[220px] max-h-[35px]">
                <SelectValue placeholder="All Tags" />
              </SelectTrigger>

              <SelectContent>

                <SelectItem value="all">
                  All Tags
                </SelectItem>

                {tags.map((tag) => (

                  <SelectItem
                    key={tag.id}
                    value={tag.id}
                  >
                    {tag.name}
                  </SelectItem>

                ))}

              </SelectContent>

            </Select>
            </div>
        <button
          type="button"
          onClick={() => {
            setIsSearching(true);
            run();
          }}
          disabled={isSearching}
          className="rounded-full bg-[#7B3010] px-5 py-2.5 text-xs font-semibold uppercase tracking-wide text-white disabled:opacity-50"
        >
          {isSearching ? "Loading…" : "Search"}
        </button>
        <Button
  variant="outline"
  onClick={handleReset}
  className="ml-2 rounded-full cursor-pointer bg-[#1a326d] text-xs text-white"
>
  Clear
</Button>
      </div>

      {error && <p className="rounded-lg bg-red-50 px-3 py-2 text-sm text-red-800">{error}</p>}

      {data && (
        <div className="grid gap-4 md:grid-cols-3">
          <div className="rounded-2xl border border-[#E8DCC8] bg-white p-5 shadow-sm">
            <p className="text-xs font-semibold uppercase text-[#646464]">Orders</p>
            <p className="mt-2 text-2xl font-bold text-[#4A1D1F]">{data.orderCount}</p>
          </div>
          <div className="rounded-2xl border border-[#E8DCC8] bg-white p-5 shadow-sm">
            <p className="text-xs font-semibold uppercase text-[#646464]">Revenue total</p>
            <p className="mt-2 text-2xl font-bold text-[#4A1D1F]">Rs.{Number(data.revenueTotal).toFixed(2)}</p>
          </div>
          <div className="rounded-2xl border border-[#E8DCC8] bg-white p-5 shadow-sm">
            <p className="text-xs font-semibold uppercase text-[#646464]">Subtotal total</p>
            <p className="mt-2 text-2xl font-bold text-[#4A1D1F]">Rs.{Number(data.subtotalTotal).toFixed(2)}</p>
          </div>
           
          <div className="rounded-2xl border border-[#E8DCC8] bg-white p-5 shadow-sm">
            <p className="text-xs font-semibold uppercase text-[#646464]">Refunded Amount</p>
            <p className="mt-2 text-2xl font-bold text-[#4A1D1F]">Rs.{Number(data.refundedAmount).toFixed(2)}</p>
          </div>
          <div className="rounded-2xl border border-[#E8DCC8] bg-white p-5 shadow-sm">
            <p className="text-xs font-semibold uppercase text-[#646464]">Net Sale</p>
            <p className="mt-2 text-2xl font-bold text-[#4A1D1F]">Rs.{Number(data.netSale).toFixed(2)}</p>
          </div>
        </div>
      )}

      {data && data.byStatus.length > 0 && (
        <div className="rounded-2xl border border-[#E8DCC8] bg-white p-5 shadow-sm">
          <h2 className="font-melon text-lg font-semibold text-[#4A1D1F]">By status</h2>
          <ul className="mt-3 space-y-2 text-sm">
            {data.byStatus.map((row) => (
              <li key={row.status} className="flex justify-between border-b border-[#F0E8DC] py-2 last:border-0">
                <span className="capitalize text-[#646464]">{row.status}</span>
                <span className="font-medium text-[#4A1D1F]">
                  {row.count} orders · Rs.{Number(row.revenue).toFixed(2)}
                </span>
              </li>
            ))}
          </ul>
        </div>
      )}

      {loading && (
         <div className="text-center py-20">
        <p className="text-lg font-medium text-gray-600">Loading report...</p>
      </div>
      )}

      {!loading && (
  <ConsoleTable
    headers={[
      "Product Name",
      "Total Quantity Sold"
    ]}
  >
    {!data?.products ||
    data.products.length === 0 ? (

      <tr>
        <ConsoleTd
          colSpan={2}
          className="py-8 text-center text-[#646464]"
        >
          No product sales found.
        </ConsoleTd>
      </tr>

    ) : (

      data.products.map((p) => (

        <tr
          key={p.productId}
          className="hover:bg-[#FFFBF3]/80"
        >

          {/* Product Name */}

          <ConsoleTd className="font-medium">
            {p.productName}
          </ConsoleTd>

          {/* Quantity Sold */}

          <ConsoleTd className="text-[12px] text-[#646464]">
            {p.totalQuantity}
          </ConsoleTd>

        </tr>

      ))

    )}
  </ConsoleTable>
      )}
    </section>
  );
}
