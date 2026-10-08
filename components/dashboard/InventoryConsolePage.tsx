"use client";

import { useCallback, useEffect, useState } from "react";
import { authedFetch, authedPatch } from "@/lib/dashboard-fetch";
import { ConsoleTable, ConsoleTd } from "@/components/dashboard/ConsoleTable";

type InventoryRow =
  | {
      id: string;
      productId: string;
      warehouse: string | null;
      available: number;
      reserved: number;
      source: "warehouse";
      product: { name: string; slug: string };
    }
  | {
      id: string;
      productId: string;
      warehouse: null;
      available: number;
      reserved: number;
      source: "variant";
      variantName: string;
      product: { name: string; slug: string };
    };

export function InventoryConsolePage({
  title,
  subtitle,
}: {
  title: string;
  subtitle: string;
}) {
  const [rows, setRows] = useState<InventoryRow[]>([]);
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(true);
  const [updating, setUpdating] = useState<string | null>(null);
  const [draft, setDraft] = useState<Record<string, { available: number; reserved: number }>>({});

  const load = useCallback(() => {
    setLoading(true);
    setError("");
    authedFetch<InventoryRow[]>("/api/v1/inventory")
      .then((r) => {
        setRows(r);
        const next: Record<string, { available: number; reserved: number }> = {};
        r.forEach((row) => {
          next[row.id] = { available: row.available, reserved: row.reserved };
        });
        setDraft(next);
      })
      .catch((e: Error) => setError(e.message))
      .finally(() => setLoading(false));
  }, []);

  useEffect(() => {
    load();
  }, [load]);

  const saveRow = async (row: InventoryRow) => {
    const d = draft[row.id];
    if (!d) return;
    setUpdating(row.id);
    setError("");
    try {
      await authedPatch("/api/v1/inventory", {
        id: row.id,
        source: row.source,
        available: d.available,
        ...(row.source === "warehouse" ? { reserved: d.reserved } : {}),
      });
      await load();
    } catch (e) {
      setError(e instanceof Error ? e.message : "Update failed");
    } finally {
      setUpdating(null);
    }
  };

  return (
    <section className="w-full space-y-4">
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <h1 className="font-melon text-2xl font-bold text-[#4A1D1F]">{title}</h1>
          <p className="text-sm text-[#646464]">{subtitle}</p>
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
        <ConsoleTable headers={["Product", "Source", "Available", "Reserved", ""]}>
          {rows.length === 0 ? (
            <tr>
              <ConsoleTd className="py-8 text-center text-[#646464]" colSpan={5}>
                No inventory rows yet. Create warehouse rows in the database or add product variants with stock.
              </ConsoleTd>
            </tr>
          ) : (
            rows.map((row) => {
              const d = draft[row.id] ?? { available: row.available, reserved: row.reserved };
              const dirty =
                d.available !== row.available ||
                (row.source === "warehouse" && d.reserved !== row.reserved);
              return (
                <tr key={row.id} className="hover:bg-[#FFFBF3]/80">
                  <ConsoleTd>
                    <div className="font-medium">{row.product.name}</div>
                    <div className="text-[11px] text-[#646464]">
                      {row.source === "variant" ? `Variant: ${row.variantName}` : row.warehouse ?? "Default"}
                    </div>
                  </ConsoleTd>
                  <ConsoleTd className="capitalize">{row.source}</ConsoleTd>
                  <ConsoleTd>
                    <input
                      type="number"
                      min={0}
                      className="w-24 rounded-lg border border-[#D9D9D1] px-2 py-1 text-xs"
                      value={d.available}
                      onChange={(e) =>
                        setDraft((prev) => ({
                          ...prev,
                          [row.id]: {
                            ...d,
                            available: Number(e.target.value) || 0,
                          },
                        }))
                      }
                    />
                  </ConsoleTd>
                  <ConsoleTd>
                    {row.source === "warehouse" ? (
                      <input
                        type="number"
                        min={0}
                        className="w-24 rounded-lg border border-[#D9D9D1] px-2 py-1 text-xs"
                        value={d.reserved}
                        onChange={(e) =>
                          setDraft((prev) => ({
                            ...prev,
                            [row.id]: {
                              ...d,
                              reserved: Number(e.target.value) || 0,
                            },
                          }))
                        }
                      />
                    ) : (
                      <span className="text-xs text-[#646464]">—</span>
                    )}
                  </ConsoleTd>
                  <ConsoleTd>
                    <button
                      type="button"
                      disabled={!dirty || updating === row.id}
                      onClick={() => saveRow(row)}
                      className="rounded-full bg-[#7B3010] px-3 py-1.5 text-[11px] font-semibold uppercase text-white disabled:opacity-40"
                    >
                      {updating === row.id ? "Saving…" : "Save"}
                    </button>
                  </ConsoleTd>
                </tr>
              );
            })
          )}
        </ConsoleTable>
      )}
    </section>
  );
}
