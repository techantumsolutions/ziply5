"use client";

import { useCallback, useEffect, useState } from "react";
import { authedFetch, authedPost } from "@/lib/dashboard-fetch";
import { ConsoleTable, ConsoleTd } from "@/components/dashboard/ConsoleTable";

type Brand = { id: string; name: string; slug: string };

export default function AdminBrandsPage() {
  const [rows, setRows] = useState<Brand[]>([]);
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(true);
  const [name, setName] = useState("");
  const [slug, setSlug] = useState("");
  const [saving, setSaving] = useState(false);

  const load = useCallback(() => {
    setLoading(true);
    setError("");
    authedFetch<Brand[]>("/api/v1/brands")
      .then(setRows)
      .catch((e: Error) => setError(e.message))
      .finally(() => setLoading(false));
  }, []);

  useEffect(() => {
    load();
  }, [load]);

  const create = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!name.trim() || !slug.trim()) return;
    setSaving(true);
    setError("");
    try {
      await authedPost("/api/v1/brands", { name: name.trim(), slug: slug.trim() });
      setName("");
      setSlug("");
      await load();
    } catch (e) {
      setError(e instanceof Error ? e.message : "Create failed");
    } finally {
      setSaving(false);
    }
  };

  return (
    <section className="w-full space-y-4">
      <div>
        <h1 className="font-melon text-2xl font-bold text-[#4A1D1F]">Brands</h1>
        <p className="text-sm text-[#646464]">Catalog brands (linked from products).</p>
      </div>

      <form
        onSubmit={create}
        className="flex flex-wrap items-end gap-3 rounded-2xl border border-[#E8DCC8] bg-white p-4 shadow-sm"
      >
        <label className="text-xs font-semibold uppercase text-[#646464]">
          Name
          <input
            value={name}
            onChange={(e) => setName(e.target.value)}
            className="mt-1 block rounded-lg border border-[#D9D9D1] px-3 py-2 text-sm"
          />
        </label>
        <label className="text-xs font-semibold uppercase text-[#646464]">
          Slug
          <input
            value={slug}
            onChange={(e) => setSlug(e.target.value)}
            className="mt-1 block rounded-lg border border-[#D9D9D1] px-3 py-2 text-sm"
          />
        </label>
        <button
          type="submit"
          disabled={saving}
          className="rounded-full bg-[#7B3010] px-5 py-2.5 text-xs font-semibold uppercase tracking-wide text-white disabled:opacity-50"
        >
          {saving ? "Saving…" : "Add brand"}
        </button>
      </form>

      {error && <p className="rounded-lg bg-red-50 px-3 py-2 text-sm text-red-800">{error}</p>}
      {loading && <p className="text-sm text-[#646464]">Loading…</p>}

      {!loading && (
        <ConsoleTable headers={["Name", "Slug"]}>
          {rows.length === 0 ? (
            <tr>
              <ConsoleTd className="py-8 text-center text-[#646464]" colSpan={2}>
                No brands yet.
              </ConsoleTd>
            </tr>
          ) : (
            rows.map((b) => (
              <tr key={b.id} className="hover:bg-[#FFFBF3]/80">
                <ConsoleTd className="font-medium">{b.name}</ConsoleTd>
                <ConsoleTd className="font-mono text-xs">{b.slug}</ConsoleTd>
              </tr>
            ))
          )}
        </ConsoleTable>
      )}
    </section>
  );
}
