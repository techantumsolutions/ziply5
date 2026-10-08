"use client";

import { useCallback, useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { ConsoleTable, ConsoleTd } from "@/components/dashboard/ConsoleTable";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";

type Cat = {
  id: string;
  name: string;
  slug: string;
  isActive: boolean;
};

type ProductRow = {
  id: string;
  name: string;
  slug: string;
  categories?: Array<{ category: { id: string } }>;
};

const slugify = (value: string) =>
  value
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "");

export default function AdminCategoriesPage() {
  const router = useRouter();
  const [rows, setRows] = useState<Cat[]>([]);
  const [products, setProducts] = useState<ProductRow[]>([]);
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [dialogOpen, setDialogOpen] = useState(false);
  const [isEditing, setIsEditing] = useState(false);
  const [editCategoryId, setEditCategoryId] = useState<string | null>(null);
  const [name, setName] = useState("");
  const [slug, setSlug] = useState("");
  const [moreOpenIds, setMoreOpenIds] = useState<Record<string, boolean>>({});

  const load = useCallback(() => {
    setLoading(true);
    setError("");
    Promise.all([
      fetch("/api/v1/categories").then((r) => r.json()),
      fetch("/api/v1/products?page=1&limit=500").then((r) => r.json()),
    ])
      .then(([catRes, prodRes]: Array<{ success?: boolean; data?: unknown; message?: string }>) => {
        const categories = catRes.data as Cat[] | undefined;
        if (!catRes.success || !categories) throw new Error(catRes.message ?? "Failed");
        setRows(categories);
        setProducts(((prodRes.data as { items?: ProductRow[] } | undefined)?.items ?? []));
      })
      .catch((e: Error) => setError(e.message))
      .finally(() => setLoading(false));
  }, []);

  useEffect(() => {
    load();
  }, [load]);

  const resetDialog = () => {
    setName("");
    setSlug("");
    setEditCategoryId(null);
    setIsEditing(false);
  };

  const openAddDialog = () => {
    resetDialog();
    setDialogOpen(true);
  };

  const openEditDialog = (category: Cat) => {
    setName(category.name);
    setSlug(category.slug);
    setEditCategoryId(category.id);
    setIsEditing(true);
    setDialogOpen(true);
  };

  const toggleMoreProducts = (categoryId: string) => {
    setMoreOpenIds((current) => ({
      ...current,
      [categoryId]: !current[categoryId],
    }));
  };

  const getAuthHeaders = (): HeadersInit => {
    const token = window.localStorage.getItem("ziply5_access_token");
    return token ? { Authorization: `Bearer ${token}` } : {};
  };

  const submitCategory = async (e: React.FormEvent) => {
    e.preventDefault();
    const finalName = name.trim();
    const finalSlug = slugify(slug || finalName);
    if (!finalName || !finalSlug) return;

    setSaving(true);
    setError("");

    try {
      const role = window.localStorage.getItem("ziply5_user_role");
      if (role !== "admin" && role !== "super_admin") {
        setError("Please login with an admin account to manage categories.");
        router.push("/admin/login");
        return;
      }

      const url = isEditing && editCategoryId ? `/api/v1/categories/${editCategoryId}` : "/api/v1/categories";
      const method = isEditing ? "PATCH" : "POST";
      const res = await fetch(url, {
        method,
        headers: {
          "Content-Type": "application/json",
          ...getAuthHeaders(),
        },
        body: JSON.stringify({ name: finalName, slug: finalSlug }),
      });

      const json = (await res.json()) as { success?: boolean; message?: string };
      if (res.status === 401 || res.status === 403) {
        setError("Admin session expired or insufficient permission. Please login again.");
        router.push("/admin/login");
        return;
      }
      if (!res.ok || json.success === false) {
        throw new Error(json.message ?? "Could not save category");
      }

      resetDialog();
      setDialogOpen(false);
      load();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Could not save category");
    } finally {
      setSaving(false);
    }
  };

  const toggleCategoryActive = async (category: Cat) => {
    setError("");
    try {
      const role = window.localStorage.getItem("ziply5_user_role");
      if (role !== "admin" && role !== "super_admin") {
        setError("Please login with an admin account to manage categories.");
        router.push("/admin/login");
        return;
      }

      const res = await fetch(`/api/v1/categories/${category.id}`, {
        method: "PATCH",
        headers: {
          "Content-Type": "application/json",
          ...getAuthHeaders(),
        },
        body: JSON.stringify({ isActive: !category.isActive }),
      });

      const json = (await res.json()) as { success?: boolean; message?: string };
      if (!res.ok || json.success === false) {
        throw new Error(json.message ?? "Could not update category status");
      }
      load();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Could not update category status");
    }
  };

  return (
    <section className="w-full space-y-4">
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <h1 className="font-melon text-2xl font-bold text-[#4A1D1F]">Categories</h1>
          <p className="text-sm text-[#646464]">Categories are menu headers. Items under each category are assigned products.</p>
        </div>

        <div className="flex flex-wrap items-center gap-3">
          <button
            type="button"
            onClick={() => load()}
            className="rounded-full border border-[#E8DCC8] bg-white px-4 py-2 text-xs font-semibold uppercase tracking-wide text-[#4A1D1F] hover:bg-[#FFFBF3]"
          >
            Refresh
          </button>
          <button
            type="button"
            onClick={openAddDialog}
            className="rounded-full bg-[#7B3010] px-4 py-2 text-xs font-semibold uppercase tracking-wide text-white hover:bg-[#613012]"
          >
            Add Category
          </button>
        </div>
      </div>

      <Dialog open={dialogOpen} onOpenChange={(open) => setDialogOpen(open)}>
        <DialogContent className="max-w-lg">
          <DialogHeader>
            <DialogTitle>{isEditing ? "Edit Category" : "Add Category"}</DialogTitle>
            <DialogDescription>
              {isEditing
                ? "Update the category name and slug, then save changes."
                : "Create a new category and keep the form ready for another entry after saving."}
            </DialogDescription>
          </DialogHeader>

          <form onSubmit={submitCategory} className="space-y-4">
            <div className="grid gap-3">
              <label className="text-sm font-semibold uppercase text-[#4A1D1F]">Category name</label>
              <input
                value={name}
                onChange={(e) => {
                  const next = e.target.value;
                  setName(next);
                  if (!slug.trim()) setSlug(slugify(next));
                }}
                className="rounded-lg border border-[#D9D9D1] px-3 py-2 text-sm w-full"
                placeholder="Enter category name"
              />
            </div>

            <div className="grid gap-3">
              <label className="text-sm font-semibold uppercase text-[#4A1D1F]">Slug</label>
              <input
                value={slug}
                onChange={(e) => setSlug(e.target.value)}
                className="rounded-lg border border-[#D9D9D1] px-3 py-2 text-sm w-full"
                placeholder="Enter slug"
              />
            </div>

            <DialogFooter>
              <button
                type="button"
                onClick={() => {
                  resetDialog();
                  setDialogOpen(false);
                }}
                className="rounded-full border border-[#E8DCC8] bg-white px-4 py-2 text-xs font-semibold uppercase tracking-wide text-[#4A1D1F] hover:bg-[#FFFBF3]"
              >
                Cancel
              </button>
              <button
                type="submit"
                disabled={saving}
                className="rounded-full bg-[#7B3010] px-4 py-2 text-xs font-semibold uppercase tracking-wide text-white disabled:opacity-50"
              >
                {saving ? (isEditing ? "Updating..." : "Creating...") : isEditing ? "Update" : "Create"}
              </button>
            </DialogFooter>
          </form>
        </DialogContent>
      </Dialog>

      {error && <p className="rounded-lg bg-red-50 px-3 py-2 text-sm text-red-800">{error}</p>}
      {loading && <p className="text-sm text-[#646464]">Loading…</p>}

      {!loading && (
        <ConsoleTable headers={["Name", "Slug", "Products", "Status", "Actions"]}>
          {rows.length === 0 ? (
            <tr>
              <ConsoleTd colSpan={5} className="py-8 text-center text-[#646464]">
                No categories yet.
              </ConsoleTd>
            </tr>
          ) : (
            rows.map((c) => {
              const productItems = products.filter((p) =>
                p.categories?.some((x) => x.category?.id === c.id),
              );
              const isExpanded = Boolean(moreOpenIds[c.id]);
              const visibleProducts = isExpanded ? productItems : productItems.slice(0, 6);

              return (
                <tr key={c.id} className="hover:bg-[#FFFBF3]/80">
                  <ConsoleTd className="font-medium">{c.name}</ConsoleTd>
                  <ConsoleTd>
                    <code className="text-[11px]">{c.slug}</code>
                  </ConsoleTd>
                  <ConsoleTd className="text-[#646464]">
                    {productItems.length === 0 ? (
                      "No products"
                    ) : (
                      <>
                        <span>{visibleProducts.map((p) => p.name).join(", ")}</span>
                        {productItems.length > 6 && (
                          <button
                            type="button"
                            onClick={() => toggleMoreProducts(c.id)}
                            className="ml-2 text-xs font-semibold uppercase text-[#7B3010] hover:underline"
                          >
                            {isExpanded ? "Show less" : `More +${productItems.length - 6}`}
                          </button>
                        )}
                      </>
                    )}
                  </ConsoleTd>
                  <ConsoleTd className="text-[#646464]">{c.isActive ? "Active" : "Inactive"}</ConsoleTd>
                  <ConsoleTd className="flex flex-wrap gap-2">
                    <button
                      type="button"
                      onClick={() => openEditDialog(c)}
                      className="rounded-full border border-[#E8DCC8] bg-white px-3 py-1 text-[11px] font-semibold uppercase tracking-wide text-[#4A1D1F] hover:bg-[#FFFBF3]"
                    >
                      Edit
                    </button>
                    <button
                      type="button"
                      onClick={() => toggleCategoryActive(c)}
                      className="rounded-full border border-[#E8DCC8] bg-white px-3 py-1 text-[11px] font-semibold uppercase tracking-wide text-[#4A1D1F] hover:bg-[#FFFBF3]"
                    >
                      {c.isActive ? "Deactivate" : "Activate"}
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
