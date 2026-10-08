"use client";

import { useCallback, useEffect, useState } from "react";
import { authedFetch, authedPost, authedPut } from "@/lib/dashboard-fetch";
import { ConsoleTable, ConsoleTd } from "@/components/dashboard/ConsoleTable";

type TagRow = { id: string; name: string; slug: string; isActive: boolean };

export default function AdminTagsPage() {
  const [rows, setRows] = useState<TagRow[]>([]);
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(true);
  const [isModalOpen, setIsModalOpen] = useState(false);
  const [editingTag, setEditingTag] = useState<TagRow | null>(null);
  const [name, setName] = useState("");
  const [slug, setSlug] = useState("");
  const [saving, setSaving] = useState(false);

  const load = useCallback(() => {
    setLoading(true);
    setError("");
    authedFetch<TagRow[]>("/api/v1/tags")
      .then(setRows)
      .catch((e: Error) => setError(e.message))
      .finally(() => setLoading(false));
  }, []);

  useEffect(() => {
    load();
  }, [load]);

  const openAdd = () => {
    setEditingTag(null);
    setName("");
    setSlug("");
    setIsModalOpen(true);
    setError("");
  };

  const openEdit = (tag: TagRow) => {
    setEditingTag(tag);
    setName(tag.name);
    setSlug(tag.slug);
    setIsModalOpen(true);
    setError("");
  };

  const handleSave = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!name.trim() || !slug.trim()) return;
    setSaving(true);
    setError("");
    try {
      console.log("Saving tag", { id: editingTag?.id, name, slug, isActive: editingTag?.isActive });
      if (editingTag) {
        await authedPut(`/api/v1/tags/${editingTag.id}`, { name: name.trim(), slug: slug.trim(), isActive: editingTag.isActive });
      } else {
        await authedPost("/api/v1/tags", { name: name.trim(), slug: slug.trim(), isActive: true });
      }
      setIsModalOpen(false);
      setName("");
      setSlug("");
      setEditingTag(null);
      await load();
    } catch (e) {
      setError(e instanceof Error ? e.message : "Save failed");
    } finally {
      setSaving(false);
    }
  };

  const toggleActive = async (tag: TagRow) => {
    try {
      setError("");
      await authedPut(`/api/v1/tags/${tag.id}`, { ...tag, isActive: !tag.isActive });
      await load();
    } catch (e) {
      setError(e instanceof Error ? e.message : "Update failed");
    }
  };

  return (
    <section className="w-full space-y-4">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="font-melon text-2xl font-bold text-[#4A1D1F]">Tags</h1>
          <p className="text-sm text-[#646464]">Product tags for discovery and filters.</p>
        </div>
        <button
          onClick={openAdd}
          className="rounded-full bg-[#7B3010] px-5 py-2.5 text-xs font-semibold uppercase tracking-wide text-white"
        >
          Add Tag
        </button>
      </div>

      {isModalOpen && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4">
          <div className="w-full max-w-md rounded-2xl border border-[#E8DCC8] bg-white p-6 shadow-xl">
            <h2 className="mb-4 text-xl font-bold text-[#4A1D1F]">
              {editingTag ? "Edit Tag" : "Add New Tag"}
            </h2>
            <form onSubmit={handleSave} className="space-y-4">
              <label className="block text-xs font-semibold uppercase text-[#646464]">
                Name
                <input
                  value={name}
                  onChange={(e) => setName(e.target.value)}
                  className="mt-1 block w-full rounded-lg border border-[#D9D9D1] px-3 py-2 text-sm"
                  required
                />
              </label>
              <label className="block text-xs font-semibold uppercase text-[#646464]">
                Slug
                <input
                  value={slug}
                  onChange={(e) => setSlug(e.target.value)}
                  className="mt-1 block w-full rounded-lg border border-[#D9D9D1] px-3 py-2 text-sm"
                  required
                />
              </label>
              <div className="flex justify-end gap-3 pt-2">
                <button
                  type="button"
                  onClick={() => setIsModalOpen(false)}
                  className="rounded-full px-5 py-2.5 text-xs font-semibold uppercase tracking-wide text-[#646464] hover:bg-gray-50"
                >
                  Cancel
                </button>
                <button
                  type="submit"
                  disabled={saving}
                  className="rounded-full bg-[#7B3010] px-5 py-2.5 text-xs font-semibold uppercase tracking-wide text-white disabled:opacity-50"
                >
                  {saving ? "Saving…" : editingTag ? "Update" : "Add tag"}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      {error && <p className="rounded-lg bg-red-50 px-3 py-2 text-sm text-red-800">{error}</p>}
      {loading && <p className="text-sm text-[#646464]">Loading…</p>}

      {!loading && (
        <ConsoleTable headers={["Name", "Slug", "Actions"]}>
          {rows.length === 0 ? (
            <tr>
              <ConsoleTd className="py-8 text-center text-[#646464]" colSpan={3}>
                No tags yet.
              </ConsoleTd>
            </tr>
          ) : (
            rows.map((b) => (
              <tr key={b.id} className="hover:bg-[#FFFBF3]/80">
                <ConsoleTd className="font-medium">{b.name}</ConsoleTd>
                <ConsoleTd className="font-mono text-xs">{b.slug}</ConsoleTd>
                <ConsoleTd className="flex gap-4">
                  <button 
                    onClick={() => openEdit(b)} 
                    className="text-xs font-semibold uppercase text-[#7B3010] px-2 py-1 border border-[#D9D9D1] text-[11px] font-semibold rounded-full hover:underline"
                  >
                    Edit
                  </button>
                  <button 
                    onClick={() => toggleActive(b)} 
                    className={`text-xs font-semibold border rounded-full px-3 py-1 border-[#D9D9D1] text-[11px] font-semibold uppercase hover:underline ${b.isActive ? "text-red-600" : "text-green-600"}`}
                  >
                    {b.isActive ? "Deactivate" : "Activate"}
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
