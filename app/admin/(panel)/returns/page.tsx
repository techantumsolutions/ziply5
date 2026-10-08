"use client";

import { useCallback, useEffect, useState } from "react";
import { authedFetch, authedPatch } from "@/lib/dashboard-fetch";
import { ConsoleTable, ConsoleTd } from "@/components/dashboard/ConsoleTable";
import { useRealtimeTables } from "@/hooks/useRealtimeTables";
import { useMasterValues } from "@/hooks/useMasterData";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";

type ReturnRow = {
  id: string;
  status: string;
  reason: string | null;
  imageUrl?: string | null;
  description?: string | null;
  videoUrl?: string | null;
  returnType?: string | null;
  refundMethod?: string | null;
  upiId?: string | null;
  bankDetails?: unknown;
  adminNote?: string | null;
  rejectionReason?: string | null;
  reverseAwb?: string | null;
  reverseCourier?: string | null;
  reverseTrackingUrl?: string | null;
  createdAt: string;
  updatedAt?: string;
  productId: string;
  orderId: string;
  userId: string;
  user?: {
    id: string;
    name?: string;
    email?: string;
    phone?: string;
  };

  order: {
    id: string;
    total: string | number;
    status: string;
    createdAt?: string;
    customerName?: string;
    customerPhone?: string;
    customerAddress?: string;
    paymentMethod?: string | null;
  };

  items?: Array<{
    id: string;
    productId: string;
    productName?: string;
    productSlug?: string;
    quantity?: number;
    imageUrl?: string;
  }>;

  pickup?: {
    trackingRef: string | null;
    status: string;
  } | null;
};
export default function AdminReturnsPage() {
  const returnStatusMasterQuery = useMasterValues("RETURN_STATUS");
  const statuses = returnStatusMasterQuery.data?.length
    ? returnStatusMasterQuery.data.map((item) => item.value)
    : ["requested", "approved", "rejected", "received", "refunded", "cancelled"];
  const [rows, setRows] = useState<ReturnRow[]>([]);
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(true);
  const [draft, setDraft] = useState<Record<string, string>>({});
  const [updating, setUpdating] = useState<string | null>(null);
  const [filter, setFilter] = useState("all");
  const [selectedReturn, setSelectedReturn] = useState<ReturnRow | null>(null);
  const [returnProduct, setReturnProduct] = useState<any>(null);
  const [user, setUser] = useState<any>(null);

  const [actionNotes, setActionNotes] = useState("");
  const [rejectReason, setRejectReason] = useState("");

  useEffect(() => {
    setActionNotes("");
    setRejectReason("");
  }, [selectedReturn?.id]);

  const filteredRows = rows.filter((row) => {
    if (filter === "pending" && !["requested", "approved", "picked_up"].includes(row.status)) return false;
    return true;
  });

  const load = useCallback(() => {
    setLoading(true);
    setError("");
    authedFetch<ReturnRow[]>("/api/v1/returns")
      .then((r) => {
        setRows(r);
        console.log(r);
        const d: Record<string, string> = {};
        r.forEach((x) => {
          d[x.id] = x.status;
        });
        setDraft(d);
      })
      .catch((e: Error) => setError(e.message))
      .finally(() => setLoading(false));
  }, []);
  const loadProduct = useCallback(async (productId: string) => {
    try {
      setLoading(true);
      setError("");

      const product = await authedFetch(
        `/api/v1/products/${productId}`
      );

      console.log("PRODUCT:", product);

      setReturnProduct(product);

    } catch (e) {
      setError(
        e instanceof Error
          ? e.message
          : "Failed to load product"
      );
    } finally {
      setLoading(false);
    }
  }, []);
  useEffect(() => {
    load();
  }, [load]);

  const loadOrder = async (orderId: string) => {
    if (!orderId) return
    setLoading(true)
    setError("")
    return authedFetch(`/api/v1/orders/${orderId}`)
      .then((data) => setUser(data))
      .catch((e: Error) => setError(e.message))
      .finally(() => setLoading(false))
  }
  console.log("loaded order:", user);
  const save = async (id: string) => {
    const status = draft[id];
    if (!status) return;
    setUpdating(id);
    setError("");
    try {
      await authedPatch(`/api/v1/returns/${id}`, { status });
      await load();
    } catch (e) {
      setError(e instanceof Error ? e.message : "Update failed");
    } finally {
      setUpdating(null);
    }
  };

  const runAction = async (
    id: string,
    action: "approve" | "reject" | "mark_picked" | "mark_received",
    extra?: { notes?: string; rejectionReason?: string },
  ) => {
    setUpdating(`${id}:${action}`);
    setError("");
    try {
      await authedFetch(`/api/v1/returns/${id}/actions`, {
        method: "POST",
        body: JSON.stringify({
          action,
          notes: extra?.notes?.trim() || undefined,
          rejectionReason: extra?.rejectionReason?.trim() || undefined,
        }),
      });
      await load();
      setSelectedReturn(null);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Action failed");
    } finally {
      setUpdating(null);
    }
  };

  return (
    <section className="w-full space-y-4">
      <div>
        <h1 className="font-melon text-2xl font-bold text-[#4A1D1F]">Returns</h1>
        {/* <p className="text-sm text-[#646464]">Return requests tied to orders.</p> */}
        <div className="mt-3">
          <Select value={filter} onValueChange={setFilter}>
            <SelectTrigger className="w-[180px] border-[#D9D9D1] text-xs text-[#4A1D1F]">
              <SelectValue placeholder="Filter returns" />
            </SelectTrigger>

            <SelectContent>
              <SelectItem value="all">
                All returns
              </SelectItem>

              <SelectItem value="pending">
                Pending returns
              </SelectItem>
            </SelectContent>
          </Select>
        </div>
      </div>

      {error && <p className="rounded-lg bg-red-50 px-3 py-2 text-sm text-red-800">{error}</p>}
      {loading && <p className="text-sm text-[#646464]">Loading…</p>}

      {!loading && (
        <ConsoleTable headers={["Order", "Placed", "Reason", "Status", "Actions"]}>
          {rows.length === 0 ? (
            <tr>
              <ConsoleTd className="py-8 text-center text-[#646464]" colSpan={5}>
                No return requests.
              </ConsoleTd>
            </tr>
          ) : (
            filteredRows.map((r) => (
              <tr key={r.id} className="hover:bg-[#FFFBF3]/80">
                <ConsoleTd>
                  <span className="font-mono text-[11px]">{r.order.id.slice(0, 12)}…</span>
                  <div className="text-[11px] text-[#646464]">Rs.{Number(r.order.total).toFixed(2)}</div>
                </ConsoleTd>
                <ConsoleTd>{new Date(r.createdAt).toLocaleString()}</ConsoleTd>
                <ConsoleTd className="max-w-[200px] text-xs">{r.reason ?? "—"}</ConsoleTd>
                <ConsoleTd>
                  <Select
                    value={draft[r.id] ?? r.status}
                    onValueChange={(value) =>
                      setDraft((d) => ({
                        ...d,
                        [r.id]: value,
                      }))
                    }
                  >
                    <SelectTrigger className="w-full max-w-[140px] border-[#D9D9D1] text-xs capitalize">
                      <SelectValue placeholder="Select status" />
                    </SelectTrigger>

                    <SelectContent>
                      {statuses.map((s) => (
                        <SelectItem
                          key={s}
                          value={s}
                          className="capitalize"
                        >
                          {s}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </ConsoleTd>
                <ConsoleTd className="flex flex-row gap-2 h-full items-center py-4">
                  <div className="">
                  <button
                    type="button"
                    disabled={updating === r.id || (draft[r.id] ?? r.status) === r.status}
                    onClick={() => save(r.id)}
                    className="rounded-full bg-[#7B3010] px-3 py-1.5 text-[11px] font-semibold uppercase text-white disabled:opacity-40"
                  >
                    {updating === r.id ? "Saving…" : "Apply"}
                  </button>
                  </div>
                  {/* <div className="mt-2 flex flex-wrap gap-1">
                    <button
                      type="button"
                      disabled={Boolean(updating)}
                      onClick={() => runAction(r.id, "approve")}
                      className="rounded-full border border-[#E8DCC8] bg-white px-2 py-1 text-[10px] uppercase text-[#4A1D1F] disabled:opacity-40"
                    >
                      Approve
                    </button>
                    <button
                      type="button"
                      disabled={Boolean(updating)}
                      onClick={() => runAction(r.id, "reject")}
                      className="rounded-full border border-[#E8DCC8] bg-white px-2 py-1 text-[10px] uppercase text-[#4A1D1F] disabled:opacity-40"
                    >
                      Reject
                    </button>
                    <button
                      type="button"
                      disabled={Boolean(updating)}
                      onClick={() => runAction(r.id, "mark_picked")}
                      className="rounded-full border border-[#E8DCC8] bg-white px-2 py-1 text-[10px] uppercase text-[#4A1D1F] disabled:opacity-40"
                    >
                      Mark picked
                    </button>
                    <button
                      type="button"
                      disabled={Boolean(updating)}
                      onClick={() => runAction(r.id, "mark_received")}
                      className="rounded-full border border-[#E8DCC8] bg-white px-2 py-1 text-[10px] uppercase text-[#4A1D1F] disabled:opacity-40"
                    >
                      Mark received
                    </button>
                  </div> */}
                  <div>
                  <button
                    type="button"
                    onClick={() => {
                      setSelectedReturn(r);
                      loadProduct(r.productId);
                      loadOrder(r.orderId);
                    }}
                    className=" rounded-full border border-[#7B3010] px-3 py-1.5 text-[11px] font-semibold text-[#7B3010]"
                  >
                    View Details
                  </button></div>
                </ConsoleTd>
              </tr>
            ))
          )}
        </ConsoleTable>

      )}
      {selectedReturn && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4">
          <div className="w-full max-w-3xl rounded-2xl bg-white p-6 shadow-xl overflow-y-auto max-h-[90vh]">

            <div className="flex items-center justify-between mb-6">
              <h2 className="text-xl font-bold text-[#4A1D1F]">
                Return Details
              </h2>

              <button
                onClick={() => setSelectedReturn(null)}
                className="text-sm text-[#646464]"
              >
                Close
              </button>
            </div>

            {/* RETURN INFO */}
            <div className="grid grid-cols-2 gap-4 mb-6">
              <div>
                <p className="text-xs text-[#646464]">Return ID</p>
                <p className="font-medium">{selectedReturn.id}</p>
              </div>

              <div>
                <p className="text-xs text-[#646464]">Status</p>
                <p className="capitalize font-medium">
                  {selectedReturn.status}
                </p>
              </div>

              <div>
                <p className="text-xs text-[#646464]">Created At</p>
                <p>
                  {new Date(selectedReturn.createdAt).toLocaleString()}
                </p>
              </div>

              <div>
                <p className="text-xs text-[#646464]">Updated At</p>
                <p>
                  {selectedReturn.updatedAt
                    ? new Date(selectedReturn.updatedAt).toLocaleString()
                    : "—"}
                </p>
              </div>
            </div>

            {/* USER DETAILS */}
            <div className="mb-6 rounded-xl border p-4">
              <h3 className="mb-3 font-semibold text-[#4A1D1F]">
                Customer Details
              </h3>

              <div className="space-y-2 text-sm">
                <p><span className="font-medium">Name:</span> {user?.customerName ?? "—"}</p>
                <p><span className="font-medium">Phone:</span> {user?.customerPhone ?? "—"}</p>
                <p><span className="font-medium">Delivery Address:</span> {user?.customerAddress ?? "—"}</p>
              </div>
            </div>

            {/* ORDER DETAILS */}
            <div className="mb-6 rounded-xl border p-4">
              <h3 className="mb-3 font-semibold text-[#4A1D1F]">
                Order Details
              </h3>

              <div className="space-y-2 text-sm">
                <p>Order ID: {selectedReturn.order.id}</p>
                <p>Status: {selectedReturn.order.status}</p>
                <p>
                  Total: Rs.
                  {Number(selectedReturn.order.total).toFixed(2)}
                </p>
              </div>
            </div>

            <div className="mb-6 rounded-xl border p-4">
              <h3 className="mb-3 font-semibold text-[#4A1D1F]">
                Return details
              </h3>
              <div className="grid gap-2 text-sm sm:grid-cols-2">
                {selectedReturn.returnType ? (
                  <p><span className="font-medium">Type:</span> {selectedReturn.returnType}</p>
                ) : null}
                {selectedReturn.description ? (
                  <p className="sm:col-span-2"><span className="font-medium">Description:</span> {selectedReturn.description}</p>
                ) : null}
                {selectedReturn.videoUrl ? (
                  <p className="sm:col-span-2">
                    <span className="font-medium">Video:</span>{" "}
                    <a href={selectedReturn.videoUrl} className="text-[#7B3010] underline" target="_blank" rel="noreferrer">
                      {selectedReturn.videoUrl}
                    </a>
                  </p>
                ) : null}
                {String(selectedReturn.order?.paymentMethod ?? "").toLowerCase() === "cod" && selectedReturn.returnType === "refund" ? (
                  <>
                    {selectedReturn.refundMethod ? (
                      <p><span className="font-medium">Refund method:</span> {selectedReturn.refundMethod}</p>
                    ) : null}
                    {selectedReturn.upiId ? (
                      <p><span className="font-medium">UPI:</span> {selectedReturn.upiId}</p>
                    ) : null}
                    {selectedReturn.bankDetails != null ? (
                      <p className="sm:col-span-2 font-mono text-xs">
                        <span className="font-medium font-sans">Bank:</span> {JSON.stringify(selectedReturn.bankDetails)}
                      </p>
                    ) : null}
                  </>
                ) : null}
                {selectedReturn.adminNote ? (
                  <p className="sm:col-span-2"><span className="font-medium">Admin note:</span> {selectedReturn.adminNote}</p>
                ) : null}
                {selectedReturn.rejectionReason ? (
                  <p className="sm:col-span-2 text-red-700"><span className="font-medium">Rejection:</span> {selectedReturn.rejectionReason}</p>
                ) : null}
              </div>
            </div>

            {(selectedReturn.reverseAwb || selectedReturn.reverseTrackingUrl) && (
              <div className="mb-6 rounded-xl border p-4">
                <h3 className="mb-3 font-semibold text-[#4A1D1F]">Reverse shipment</h3>
                {selectedReturn.reverseAwb ? (
                  <p className="text-sm">
                    <span className="font-medium">AWB:</span>{" "}
                    <span className="font-mono">{selectedReturn.reverseAwb}</span>
                    {selectedReturn.reverseCourier ? ` — ${selectedReturn.reverseCourier}` : ""}
                  </p>
                ) : null}
                {selectedReturn.reverseTrackingUrl ? (
                  <p className="mt-2 text-sm">
                    <a href={selectedReturn.reverseTrackingUrl} className="text-[#7B3010] underline" target="_blank" rel="noreferrer">
                      Open carrier tracking
                    </a>
                  </p>
                ) : null}
                <button
                  type="button"
                  className="mt-3 rounded-md border border-[#E8DCC8] px-3 py-1.5 text-xs font-semibold uppercase text-[#4A1D1F] disabled:opacity-40"
                  disabled={Boolean(updating)}
                  onClick={() => {
                    void (async () => {
                      setUpdating(`${selectedReturn.id}:refresh_rev`);
                      setError("");
                      try {
                        await authedFetch(`/api/v1/returns/${selectedReturn.id}/reverse-tracking/refresh`, {
                          method: "POST",
                        });
                        await load();
                        const fresh = (await authedFetch<ReturnRow[]>("/api/v1/returns")).find((r) => r.id === selectedReturn.id);
                        if (fresh) setSelectedReturn(fresh);
                      } catch (e) {
                        setError(e instanceof Error ? e.message : "Refresh failed");
                      } finally {
                        setUpdating(null);
                      }
                    })();
                  }}
                >
                  Refresh reverse tracking
                </button>
              </div>
            )}

            {/* RETURN REASON */}
            <div className="mb-6 rounded-xl border p-4">
              <h3 className="mb-3 font-semibold text-[#4A1D1F]">
                Return Reason
              </h3>

              <p className="text-sm">
                {selectedReturn.reason ?? "No reason provided"}
              </p>
            </div>

            {/* RETURN IMAGE */}
            {selectedReturn.imageUrl && (
              <div className="mb-6 rounded-xl border p-4">
                <h3 className="mb-3 font-semibold text-[#4A1D1F]">
                  Return Image
                </h3>

                <img
                  src={selectedReturn.imageUrl}
                  alt="Return"
                  className="max-h-72 rounded-xl border object-cover"
                />
              </div>
            )}

            {/* ITEMS */}
            <div className="rounded-xl border p-4">
              <h3 className="mb-4 font-semibold text-[#4A1D1F]">
                Returned Items
              </h3>

              <div className="space-y-4">

                <div
                  className="flex items-center gap-4 border-b pb-3"
                >
                  {returnProduct?.thumbnail ? (
                    <img
                      src={returnProduct?.thumbnail}
                      alt={returnProduct?.name ?? "Product"}
                      className="h-16 w-16 rounded-lg object-cover border"
                    />
                  ) : null}

                  <div>
                    <p className="font-medium">
                      {returnProduct?.name ?? returnProduct?.id}
                    </p>

                    <p className="text-sm text-[#646464]">
                      Qty: {returnProduct?.quantity ?? 1}
                    </p>
                  </div>
                </div>

              </div>
            </div>

            <div className="mb-6 rounded-xl border border-amber-100 bg-amber-50/40 p-4">
              <h3 className="mb-3 font-semibold text-[#4A1D1F]">Admin actions</h3>
              <label className="block text-xs font-medium text-[#646464]">Note (optional, stored on approve / reject)</label>
              <textarea
                className="mt-1 w-full rounded-lg border border-[#E8DCC8] px-2 py-2 text-sm"
                rows={2}
                value={actionNotes}
                onChange={(e) => setActionNotes(e.target.value)}
              />
              <label className="mt-3 block text-xs font-medium text-[#646464]">Rejection reason (required to reject)</label>
              <textarea
                className="mt-1 w-full rounded-lg border border-[#E8DCC8] px-2 py-2 text-sm"
                rows={2}
                value={rejectReason}
                onChange={(e) => setRejectReason(e.target.value)}
                placeholder="Shown to the customer when the return is rejected."
              />
              <div className="mt-3 flex flex-wrap gap-2">
                <button
                  type="button"
                  disabled={Boolean(updating)}
                  onClick={() => void runAction(selectedReturn.id, "approve", { notes: actionNotes })}
                  className="rounded-full bg-[#7B3010] px-4 py-2 text-xs font-semibold uppercase text-white disabled:opacity-40"
                >
                  Approve &amp; create reverse pickup
                </button>
                <button
                  type="button"
                  disabled={Boolean(updating)}
                  onClick={() => {
                    if (!rejectReason.trim()) {
                      setError("Enter a rejection reason.");
                      return;
                    }
                    void runAction(selectedReturn.id, "reject", { notes: actionNotes, rejectionReason: rejectReason });
                  }}
                  className="rounded-full border border-red-300 bg-white px-4 py-2 text-xs font-semibold uppercase text-red-800 disabled:opacity-40"
                >
                  Reject return
                </button>
                <button
                  type="button"
                  disabled={Boolean(updating)}
                  onClick={() => void runAction(selectedReturn.id, "mark_picked")}
                  className="rounded-full border border-[#E8DCC8] bg-white px-4 py-2 text-xs font-semibold uppercase text-[#4A1D1F] disabled:opacity-40"
                >
                  Mark picked up
                </button>
                <button
                  type="button"
                  disabled={Boolean(updating)}
                  onClick={() => void runAction(selectedReturn.id, "mark_received")}
                  className="rounded-full border border-[#E8DCC8] bg-white px-4 py-2 text-xs font-semibold uppercase text-[#4A1D1F] disabled:opacity-40"
                >
                  Mark received
                </button>
              </div>
            </div>

          </div>
        </div>
      )}
    </section>
  );
}
