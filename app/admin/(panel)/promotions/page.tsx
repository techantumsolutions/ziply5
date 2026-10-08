"use client";

import { useCallback, useEffect, useState, useRef } from "react";
import { authedFetch, authedPost, authedPatch } from "@/lib/dashboard-fetch";
import {
  ConsoleTable,
  ConsoleTd,
} from "@/components/dashboard/ConsoleTable";

/* ---------------- TYPES ---------------- */

type Variant = {
  id: string;
  name: string;
};

type Product = {
  id: string;
  name: string;
  variants?: Variant[];
  status?:string;
};

type Promo = {
  id: string;
  kind: string;
  name: string;
  active: boolean;
  startsAt: string | null;
  endsAt: string | null;
  products?: SelectedProduct[];
};

type SelectedProduct = {
  productId: string;
  discountPercent?: number;
  variants?: {
    variantId: string;
    discountPercent: number;
  }[];
};

const KINDS = [
  "flash_sale",
  "featured",
  "clearance",
  "custom",
] as const;

/* ---------------- COMPONENT ---------------- */

export default function AdminPromotionsPage() {

  /* ---------- Promotion list ---------- */

  const [rows, setRows] =
    useState<Promo[]>([]);

  const [loading, setLoading] =
    useState(true);

  const [error, setError] =
    useState("");

  /* ---------- Form ---------- */

  const [kind, setKind] =
    useState<(typeof KINDS)[number]>(
      "featured"
    );

  const [name, setName] =
    useState("");

  const [active, setActive] =
    useState(true);

  const [startsAt, setStartsAt] =
    useState("");

  const [endsAt, setEndsAt] =
    useState("");

  const [saving, setSaving] =
    useState(false);

  const [togglingId, setTogglingId] =
    useState<string | null>(null);

  const [viewPromo, setViewPromo] =
    useState<Promo | null>(null);

  /* ---------- Products ---------- */

  const [products, setProducts] =
    useState<Product[]>([]);

  const [selectedProducts, setSelectedProducts] =
    useState<SelectedProduct[]>([]);

  const [productSearch, setProductSearch] =
    useState("");

  const [productDropdownOpen, setProductDropdownOpen] =
    useState(false);

  const dropdownRef = useRef<HTMLDivElement>(null);

  const filteredProducts = products.filter((p) =>
    p.name.toLowerCase().includes(productSearch.toLowerCase())
  );

  /* ---------------- LOAD PROMOTIONS ---------------- */

  const load = useCallback(() => {

    setLoading(true);

    setError("");

    authedFetch<Promo[]>(
      "/api/v1/promotions"
    )
      .then(setRows)
      .catch((e: Error) =>
        setError(e.message)
      )
      .finally(() =>
        setLoading(false)
      );

  }, []);

  /* ---------------- LOAD PRODUCTS ---------------- */

  const loadProducts = useCallback(() => {

  authedFetch<{ items: Product[] }>(
    "/api/v1/products"
  )
    .then((res) => {

      // ✅ extract items
      setProducts((res.items || []).filter(p=>p?.status=="published"));

    })
    .catch((e: Error) =>
      setError(e.message)
    );

}, []);

  console.log("fetched promottions are::::",rows);

  useEffect(() => {

    load();

    loadProducts();

  }, [load, loadProducts]);

  useEffect(() => {
    const handleClickOutside = (event: MouseEvent) => {
      if (dropdownRef.current && !dropdownRef.current.contains(event.target as Node)) {
        setProductDropdownOpen(false);
      }
    };

    if (productDropdownOpen) {
      document.addEventListener("mousedown", handleClickOutside);
    }

    return () => {
      document.removeEventListener("mousedown", handleClickOutside);
    };
  }, [productDropdownOpen]);

  /* ---------------- PRODUCT SELECT ---------------- */

  const toggleProduct = (productId: string) => {
    const isSelected = selectedProducts.some(sp => sp.productId === productId);

    if (isSelected) {
      setSelectedProducts(prev => prev.filter(sp => sp.productId !== productId));
    } else {
      const product = products.find(p => p.id === productId);
      setSelectedProducts(prev => [
        ...prev,
        {
          productId,
          discountPercent: 0,
          variants: product?.variants?.map(v => ({
            variantId: v.id,
            discountPercent: 0,
          })),
        }
      ]);
    }
  };

  /* ---------------- TOGGLE STATUS ---------------- */

  const toggleStatus = async (id: string, currentActive: boolean) => {
    setTogglingId(id);
    setError("");
    try {
      await authedPatch(`/api/v1/promotions/${id}`, { active: !currentActive });
      setRows((prev) =>
        prev.map((r) => (r.id === id ? { ...r, active: !currentActive } : r))
      );
    } catch (e) {
      setError(
        e instanceof Error
          ? e.message
          : "Toggle failed"
      );
    } finally {
      setTogglingId(null);
    }
  };

  /* ---------------- SUBMIT / EDIT ---------------- */

  const [editingId, setEditingId] = useState<string | null>(null);

  const handleEdit = (promo: Promo) => {
    setEditingId(promo.id);
    setName(promo.name);

    const lowerKind = promo.kind.toLowerCase();
    setKind(KINDS.includes(lowerKind as any) ? (lowerKind as any) : "featured");

    setActive(promo.active);

    const toLocalDatetime = (isoString: string | null) => {
      if (!isoString) return "";
      const date = new Date(isoString);
      const local = new Date(date.getTime() - date.getTimezoneOffset() * 60000);
      return local.toISOString().slice(0, 16);
    };

    setStartsAt(toLocalDatetime(promo.startsAt));
    setEndsAt(toLocalDatetime(promo.endsAt));

    // Normalize products to ensure discount values and IDs match our SelectedProduct type
    const mappedProducts = (promo.products || []).map((sp: any) => {
      const variants = sp.variants || sp.productVariants || [];
      return {
        productId: sp.productId || sp.product?.id || sp.id,
        discountPercent: sp.discountPercent ?? sp.discountPercentage ?? sp.discount ?? sp.discountValue ?? 0,
        variants: variants.map((sv: any) => ({
          variantId: sv.variantId || sv.variant?.id || sv.id,
          discountPercent: sv.discountPercent ?? sv.discountPercentage ?? sv.discount ?? sv.discountValue ?? 0,
        })),
      };
    });
    setSelectedProducts(mappedProducts as SelectedProduct[]);

    window.scrollTo({ top: 0, behavior: "smooth" });
  };

  const handleSubmit = async (
    e: React.FormEvent
  ) => {

    e.preventDefault();

    if (!name.trim()) return;

    setSaving(true);

    setError("");

    try {

      const payload: any = {
        kind: kind.toUpperCase(),
        name: name.trim(),
        active,
        startsAt: startsAt ? new Date(startsAt).toISOString() : null,
        endsAt: endsAt ? new Date(endsAt).toISOString() : null,
      };

      if (selectedProducts.length > 0) {
        payload.products = selectedProducts;
      }

      if (editingId) {
        await authedPatch(`/api/v1/promotions/${editingId}`, payload);
      } else {
        payload.products = selectedProducts;
        await authedPost("/api/v1/promotions", payload);
      }

      /* reset */

      setEditingId(null);

      setName("");

      setStartsAt("");

      setEndsAt("");

      setSelectedProducts([]);

      await load();

    } catch (e) {

      setError(
        e instanceof Error
          ? e.message
          : "Save failed"
      );

    } finally {

      setSaving(false);

    }
  };

  /* ---------------- UI ---------------- */

  return (

    <section className="w-full space-y-4">

      {/* HEADER */}

      <div>

        <h1 className="font-melon text-2xl font-bold text-[#4A1D1F]">

          Promotions

        </h1>

        <p className="text-sm text-[#646464]">

          Campaigns and featured placements.

        </p>

      </div>

      {/* FORM */}

      <form
        onSubmit={handleSubmit}
        className="grid gap-3 rounded-2xl border border-[#E8DCC8] bg-white p-4 shadow-sm md:grid-cols-2"
      >

        {/* KIND */}

        <label className="text-xs font-semibold uppercase text-[#646464]">

          Kind

          <select
            value={kind}
            onChange={(e) =>
              setKind(
                e.target.value as
                (typeof KINDS)[number]
              )
            }
            className="mt-1 block w-full rounded-lg border border-[#D9D9D1] px-3 py-2 text-sm"
          >

            {KINDS.map(k => (

              <option
                key={k}
                value={k}
              >

                {k}

              </option>

            ))}

          </select>

        </label>

        {/* NAME */}

        <label className="text-xs font-semibold uppercase text-[#646464]">

          Name

          <input
            value={name}
            placeholder="Enter sale name"
            onChange={(e) =>
              setName(e.target.value)
            }
            className="mt-1 block w-full rounded-lg border border-[#D9D9D1] px-3 py-2 text-sm"
          />

        </label>

        {/* ACTIVE */}
{/* 
        <label className="flex items-center gap-2 text-xs font-semibold uppercase text-[#646464]">

          <input
            type="checkbox"
            checked={active}
            onChange={(e) =>
              setActive(e.target.checked)
            }
          />

          Active

        </label> */}

        {/* START */}

        <label className="text-xs font-semibold uppercase text-[#646464]">

          Starts

          <input
            type="datetime-local"
            value={startsAt}
            onChange={(e) =>
              setStartsAt(e.target.value)
            }
            className="mt-1 block w-full rounded-lg border border-[#D9D9D1] px-3 py-2 text-sm"
          />

        </label>

        {/* END */}

        <label className="text-xs font-semibold uppercase text-[#646464]">

          Ends

          <input
            type="datetime-local"
            value={endsAt}
            onChange={(e) =>
              setEndsAt(e.target.value)
            }
            className="mt-1 block w-full rounded-lg border border-[#D9D9D1] px-3 py-2 text-sm"
          />

        </label>

        {/* PRODUCT MULTISELECT */}

        <div className="md:col-span-2 text-xs font-semibold uppercase text-[#646464]">

          Select Products

          <div className="relative mt-1" ref={dropdownRef}>
            {/* Display / Toggle button */}
            <div
              className="flex min-h-[38px] w-full cursor-pointer flex-wrap items-center gap-1 rounded-lg border border-[#D9D9D1] bg-white px-3 py-1.5 text-sm normal-case"
              onClick={() => setProductDropdownOpen(!productDropdownOpen)}
            >
              {selectedProducts.length === 0 ? (
                <span className="text-[#646464]">Select products...</span>
              ) : (
                selectedProducts.map((sp) => {
                  const p = products.find((p) => p.id === sp.productId);
                  return (
                    <span
                      key={sp.productId}
                      className="flex items-center gap-1 rounded border border-[#E8DCC8] bg-[#FFFBF3] px-2 py-0.5 text-xs text-[#4A1D1F]"
                    >
                      {p?.name}
                      <button
                        type="button"
                        onClick={(e) => {
                          e.stopPropagation();
                          toggleProduct(sp.productId);
                        }}
                        className="text-[#7B3010] hover:text-red-700"
                      >
                        &times;
                      </button>
                    </span>
                  );
                })
              )}
            </div>

            {/* Dropdown Menu */}
            {productDropdownOpen && (
              <div className="absolute z-10 mt-1 w-full rounded-lg border border-[#D9D9D1] bg-white shadow-lg">
                <div className="border-b border-[#D9D9D1] p-2">
                  <input
                    type="text"
                    placeholder="Search products..."
                    value={productSearch}
                    onChange={(e) => setProductSearch(e.target.value)}
                    onClick={(e) => e.stopPropagation()}
                    className="w-full rounded-md border border-[#D9D9D1] px-3 py-1.5 text-xs normal-case focus:border-[#7B3010] focus:outline-none"
                  />
                </div>
                <div className="max-h-40 overflow-y-auto rounded-b-lg bg-gray-50 p-2">
                  {filteredProducts.length === 0 ? (
                    <span className="normal-case text-[#646464]">
                      {products.length === 0 ? "No products available." : "No matching products."}
                    </span>
                  ) : (
                    filteredProducts.map((p) => (
                      <label
                        key={p.id}
                        className="mb-1 flex cursor-pointer items-center gap-2 rounded p-1 text-sm font-normal normal-case hover:bg-gray-100"
                      >
                        <input
                          type="checkbox"
                          checked={selectedProducts.some((sp) => sp.productId === p.id)}
                          onChange={() => toggleProduct(p.id)}
                        />
                        {p.name}
                      </label>
                    ))
                  )}
                </div>
              </div>
            )}
          </div>

        </div>

        {/* VARIANT UI */}

        <div className="md:col-span-2 grid grid-cols-1 gap-4 md:grid-cols-2 lg:grid-cols-3">

          {selectedProducts.map(
            (sp, i) => {

              const product =
                products.find(
                  p =>
                    p.id ===
                    sp.productId
                );

              return (

                <div
                  key={sp.productId}
                  className="border rounded-lg p-3"
                >

                  <p className="font-semibold">

                    {product?.name}

                  </p>

                  {product?.variants
                    ?.length ? (

                    product.variants.map(
                      (v, vi) => (

                        <div
                          key={v.id}
                          className="flex gap-2 items-center mt-2"
                        >

                          <span>

                            {v.name}

                          </span>

                          <input
                            type="number"
                            placeholder="Discount %"
                            className="border px-2 py-1 rounded"
                            value={sp.variants?.find(sv => sv.variantId === v.id)?.discountPercent ?? ""}

                            onChange={(e) => {
                              const updated = [...selectedProducts];
                              const currentProduct = { ...updated[i] };
                              const variants = [...(currentProduct.variants || [])];
                              
                              const targetIndex = variants.findIndex(sv => sv.variantId === v.id);
                              if (targetIndex >= 0) {
                                variants[targetIndex] = { ...variants[targetIndex], discountPercent: Number(e.target.value) };
                              } else {
                                variants.push({ variantId: v.id, discountPercent: Number(e.target.value) });
                              }
                              
                              currentProduct.variants = variants;
                              updated[i] = currentProduct;

                              setSelectedProducts(
                                updated
                              );

                            }}

                          />

                        </div>

                      )
                    )

                  ) : (

                    <input
                      type="number"
                      placeholder="Discount %"
                      className="border px-2 py-1 rounded mt-2"
                      value={sp.discountPercent ?? ""}

                      onChange={(e) => {
                        const updated = [...selectedProducts];
                        updated[i] = { 
                          ...updated[i], 
                          discountPercent: Number(e.target.value) 
                        };

                        setSelectedProducts(
                          updated
                        );

                      }}
                    />

                  )}

                </div>

              );

            }
          )}

        </div>

        {/* SUBMIT */}

        <div className="md:col-span-2 flex gap-3">

          <button
            type="submit"
            disabled={saving}
            className="rounded-full bg-[#7B3010] px-5 py-2.5 text-xs font-semibold uppercase tracking-wide text-white disabled:opacity-50"
          >

            {saving
              ? "Saving…"
              : editingId
              ? "Update promotion"
              : "Create promotion"}

          </button>

          {editingId && (
            <button
              type="button"
              disabled={saving}
              onClick={() => {
                setEditingId(null);
                setName("");
                setStartsAt("");
                setEndsAt("");
                setSelectedProducts([]);
              }}
              className="rounded-full border border-[#E8DCC8] bg-white px-5 py-2.5 text-xs font-semibold uppercase tracking-wide text-[#4A1D1F] hover:bg-[#FFFBF3] disabled:opacity-50"
            >
              Cancel
            </button>
          )}

        </div>

      </form>

      {/* ERRORS */}

      {error && (

        <p className="rounded-lg bg-red-50 px-3 py-2 text-sm text-red-800">

          {error}

        </p>

      )}

      {/* TABLE */}

      {!loading && (

        <ConsoleTable
          headers={[
            "Name",
            "Kind",
            "Status",
            "Window",
            "Actions",
          ]}
        >

          {rows.map(r => {
            const now = new Date();
            const isExpired = r.endsAt ? new Date(r.endsAt) < now : false;

            return (
            <tr
              key={r.id}
              className="hover:bg-[#FFFBF3]/80"
            >

              <ConsoleTd className="font-medium">

                {r.name}

              </ConsoleTd>

              <ConsoleTd className="text-xs capitalize">

                {r.kind.replace("_", " ")}

              </ConsoleTd>

              <ConsoleTd className="text-xs uppercase">
                {isExpired ? (
                  <span className="rounded-full bg-gray-200 px-2 py-1 text-[10px] font-semibold text-gray-600">Expired</span>
                ) : r.active ? (
                  <span className="rounded-full bg-green-100 px-2 py-1 text-[10px] font-semibold text-green-700">Active</span>
                ) : (
                  <span className="rounded-full bg-yellow-100 px-2 py-1 text-[10px] font-semibold text-yellow-700">Inactive</span>
                )}
              </ConsoleTd>

              <ConsoleTd className="text-[11px] text-[#646464]">

                {r.startsAt
                  ? new Date(
                      r.startsAt
                    ).toLocaleString()
                  : "—"}

                →

                {r.endsAt
                  ? new Date(
                      r.endsAt
                    ).toLocaleString()
                  : "—"}

              </ConsoleTd>

              <ConsoleTd>
                <div className="flex items-center gap-2">
                  <button
                    type="button"
                    onClick={() => setViewPromo(r)}
                    className="flex items-center justify-center rounded-full border border-[#646464] p-1.5 text-[#646464] hover:bg-gray-50"
                    title="View Details"
                  >
                    <svg xmlns="http://www.w3.org/2000/svg" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                      <path d="M2 12s3-7 10-7 10 7 10 7-3 7-10 7-10-7-10-7Z" />
                      <circle cx="12" cy="12" r="3" />
                    </svg>
                  </button>
                  {!isExpired && (
                    <>
                    <button
                      type="button"
                      onClick={() => handleEdit(r)}
                      className="flex items-center justify-center rounded-full border border-[#7B3010] p-1.5 text-[#7B3010] hover:bg-[#FFFBF3]"
                      title="Edit"
                    >
                      <svg xmlns="http://www.w3.org/2000/svg" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                        <path d="M12 20h9"></path>
                        <path d="M16.5 3.5a2.12 2.12 0 0 1 3 3L7 19l-4 1 1-4Z"></path>
                      </svg>
                    </button>
                    <button
                      type="button"
                      role="switch"
                      aria-checked={r.active}
                      disabled={saving}
                      onClick={() => toggleStatus(r.id, r.active)}
                      className={`relative inline-flex h-5 w-9 shrink-0 cursor-pointer items-center rounded-full border-2 border-transparent transition-colors duration-200 ease-in-out focus:outline-none focus-visible:ring-2 focus-visible:ring-[#7B3010] focus-visible:ring-offset-2 ${
                        r.active ? "bg-green-500" : "bg-gray-300"
                      }`}
                      title={r.active ? "Deactivate" : "Activate"}
                    >
                      <span className="sr-only">Toggle Status</span>
                      <span
                        aria-hidden="true"
                        className={`pointer-events-none inline-block h-4 w-4 transform rounded-full bg-white shadow ring-0 transition duration-200 ease-in-out ${
                          r.active ? "translate-x-4" : "translate-x-0"
                        }`}
                      />
                    </button>
                    </>
                  )}
                </div>
              </ConsoleTd>

            </tr>
            );
          })}

          {!rows.length && (
            <tr>
              <td
                className="px-3 py-6 text-center text-sm text-[#646464]"
                colSpan={5}
              >
                No promotions yet.
              </td>
            </tr>
          )}

        </ConsoleTable>

      )}

      {/* VIEW PROMO MODAL */}
      {viewPromo && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4 backdrop-blur-sm">
          <div className="w-full max-w-2xl max-h-[90vh] overflow-y-auto rounded-2xl bg-white p-6 shadow-xl">
            <div className="flex items-center justify-between border-b border-[#E8DCC8] pb-4">
              <h2 className="font-melon text-xl font-bold text-[#4A1D1F]">Promotion Details</h2>
              <button
                onClick={() => setViewPromo(null)}
                className="text-[#646464] hover:text-red-700 transition-colors"
                title="Close"
              >
                <svg xmlns="http://www.w3.org/2000/svg" width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                  <path d="M18 6 6 18" />
                  <path d="m6 6 12 12" />
                </svg>
              </button>
            </div>
            
            <div className="mt-5 space-y-6">
              <div className="grid grid-cols-2 gap-4 rounded-xl bg-[#FFFBF3] p-4 border border-[#E8DCC8]">
                <div>
                  <p className="text-[10px] font-semibold uppercase tracking-wider text-[#646464]">Name</p>
                  <p className="mt-1 font-medium text-[#4A1D1F]">{viewPromo.name}</p>
                </div>
                <div>
                  <p className="text-[10px] font-semibold uppercase tracking-wider text-[#646464]">Kind</p>
                  <p className="mt-1 font-medium capitalize text-[#4A1D1F]">{viewPromo.kind.replace("_", " ")}</p>
                </div>
                <div>
                  <p className="text-[10px] font-semibold uppercase tracking-wider text-[#646464]">Status</p>
                  <p className="mt-1 font-medium text-[#4A1D1F]">
                    {viewPromo.endsAt && new Date(viewPromo.endsAt) < new Date() 
                      ? "Expired" 
                      : viewPromo.active ? "Active" : "Inactive"}
                  </p>
                </div>
                <div>
                  <p className="text-[10px] font-semibold uppercase tracking-wider text-[#646464]">Window</p>
                  <p className="mt-1 text-sm text-[#4A1D1F]">
                    {viewPromo.startsAt ? new Date(viewPromo.startsAt).toLocaleString() : "—"} <br/>
                    to <br/>
                    {viewPromo.endsAt ? new Date(viewPromo.endsAt).toLocaleString() : "—"}
                  </p>
                </div>
              </div>
  
              <div>
                <p className="text-xs font-semibold uppercase tracking-wide text-[#646464] mb-3">Included Products</p>
                <div className="space-y-3">
                  {(() => {
                    const mappedProducts = (viewPromo.products || []).map((sp: any) => {
                      const variants = sp.variants || sp.productVariants || [];
                      return {
                        productId: sp.productId || sp.product?.id || sp.id,
                        discountPercent: sp.discountPercent ?? sp.discountPercentage ?? sp.discount ?? sp.discountValue ?? 0,
                        variants: variants.map((sv: any) => ({
                          variantId: sv.variantId || sv.variant?.id || sv.id,
                          discountPercent: sv.discountPercent ?? sv.discountPercentage ?? sv.discount ?? sv.discountValue ?? 0,
                        })),
                      };
                    });
  
                    if (mappedProducts.length === 0) {
                      return <p className="text-sm text-[#646464] italic">No products selected for this promotion.</p>;
                    }
  
                    return mappedProducts.map((sp: any, idx: number) => {
                      const product = products.find((p) => p.id === sp.productId);
                      return (
                        <div key={idx} className="rounded-lg border border-[#D9D9D1] p-3">
                          <div className="flex items-center justify-between">
                            <span className="font-semibold text-[#4A1D1F]">{product?.name || "Unknown Product"}</span>
                            {(!product?.variants?.length || sp.variants?.length === 0) && (
                              <span className="rounded bg-green-100 px-2 py-0.5 text-xs font-semibold text-green-800">
                                {sp.discountPercent}% OFF
                              </span>
                            )}
                          </div>
                          {product?.variants && product.variants.length > 0 && sp.variants && sp.variants.length > 0 && (
                            <div className="mt-3 space-y-2 border-t border-[#E8DCC8] pt-2">
                              {sp.variants.map((sv: any, vIdx: number) => {
                                const variant = product.variants?.find((v) => v.id === sv.variantId);
                                return (
                                  <div key={vIdx} className="flex justify-between items-center text-sm pl-2">
                                    <span className="text-[#646464]">{variant?.name || "Unknown Variant"}</span>
                                    <span className="font-medium text-[#7B3010]">{sv.discountPercent}% OFF</span>
                                  </div>
                                );
                              })}
                            </div>
                          )}
                        </div>
                      );
                    });
                  })()}
                </div>
              </div>
            </div>
          </div>
        </div>
      )}

    </section>

  );

}