"use client"

import { useEffect, useState } from "react"
import { useParams, useRouter } from "next/navigation"
import { authedFetch, authedPost } from "@/lib/dashboard-fetch"
import { Button } from "@/components/ui/button"
import { TrackingTimeline } from "@/src/components/shipping/tracking-timeline"
import { AlertTriangle, Ban, Download, Loader2, RefreshCw, XCircle } from "lucide-react"
import { formatInvoiceNumber, generateAdminInvoicePDF } from "@/lib/invoice"
import { toast } from "@/lib/toast"

type OrderDetail = {
  id: string
  status: string
  total: string | number
  subtotal: string | number
  shipping: string | number
  tax?: string | number
  discount?: string | number
  currency: string
  createdAt: string
  items: Array<{
    id?: string
    quantity: number
    unitPrice?: string | number
    lineTotal?: string | number
    product?: { id: string; name: string; slug: string } | null
    productId?: string | null
  }>
  transactions?: Array<{ id: string; gateway: string; amount: string | number; status: string; createdAt: string }>
  statusHistory?: Array<{ toStatus: string; changedAt: string; notes?: string | null; reasonCode?: string | null; changedById?: string | null }>
  notes?: Array<{ id: string; note: string; isInternal: boolean; createdAt: string }>
  user?: { id: string; name: string; email: string }
  shipments?: Array<{ id: string; carrier: string | null; trackingNo: string | null; shipmentStatus: string; awbCode?: string | null; trackingUrl?: string | null; pickupStatus?: string | null }>
  awbCode?: string | null
  courierName?: string | null
  trackingNumber?: string | null
  trackingUrl?: string | null
  shipmentStatus?: string | null
  estimatedDeliveryDate?: string | null
  lastTrackingSyncAt?: string | null
  returnRequests?: Array<{ id: string; status: string; reason: string | null }>
  refunds?: Array<{ id: string; status: string; amount: string | number }>
  paymentStatus?: string | null
  paymentId?: string | null
  customerName?: string | null
  customerPhone?: string | null
  customerEmail?: string | null
  customerAddress?: string | null
}

export default function AdminOrderDetailPage() {
  const params = useParams() as { id?: string }
  const router = useRouter()
  const [order, setOrder] = useState<OrderDetail | null>(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState("")
  const [actionBusy, setActionBusy] = useState<string | null>(null)
  const [note, setNote] = useState("")
  const [savingNote, setSavingNote] = useState(false)
  const [shiprocketBusy, setShiprocketBusy] = useState<string | null>(null)
  const [serviceabilitySummary, setServiceabilitySummary] = useState<string>("")
  const [downloadingInvoice, setDownloadingInvoice] = useState(false)
  const [syncingOrder, setSyncingOrder] = useState(false)
  const [showCancelModal, setShowCancelModal] = useState(false)
  const [cancelReason, setCancelReason] = useState("")
  const lifecycleStatus = (order?.statusHistory?.[0]?.toStatus ?? order?.status ?? "").toLowerCase()
  const refundStatus = (order?.refunds?.[0]?.status ?? "pending").toLowerCase()

  // Generates and downloads the PDF invoice matching the admin commercial/dispatch template.
  const handleDownloadInvoice = async () => {
    if (!order) return
    setDownloadingInvoice(true)
    try {
      await generateAdminInvoicePDF(order)
    } catch (err) {
      console.error("Failed to generate invoice PDF:", err)
    } finally {
      setDownloadingInvoice(false)
    }
  }

  const handleSyncOrder = async () => {
    if (!order) return
    setSyncingOrder(true)
    try {
      await authedPost(`/api/v1/orders/${order.id}/shiprocket`, {
        action: "resync_order",
        forceResync: true,
      })
      toast.success("Success", "Order and shipment synced successfully")
      await loadOrder()
    } catch (err) {
      toast.error("Sync Error", err instanceof Error ? err.message : "Failed to sync order")
    } finally {
      setSyncingOrder(false)
    }
  }

  const loadOrder = async () => {
    if (!params.id) return
    setLoading(true)
    setError("")
    return authedFetch<OrderDetail>(`/api/v1/orders/${params.id}`)
      .then((data) => setOrder(data))
      .catch((e: Error) => setError(e.message))
      .finally(() => setLoading(false))
  }

  useEffect(() => {
    void loadOrder()
  }, [params.id])

  const runAction = async (
    action:
      | "approve_order"
      | "reject_order"
      | "approve_cancel"
      | "reject_cancel"
      | "approve_return"
      | "reject_return"
      | "trigger_refund"
      | "retry_refund"
      | "admin_cancel",
    reasonArg?: string,
  ) => {
    if (!params.id) return
    setActionBusy(action)
    setError("")
    try {
      const res = await authedFetch<{ message?: string }>(`/api/v1/orders/${params.id}/actions`, {
        method: "POST",
        body: JSON.stringify({ action, reason: reasonArg }),
      })
      toast.success(res?.message || "Order updated successfully")
      setShowCancelModal(false)
      setCancelReason("")
      await loadOrder()
    } catch (e) {
      const msg = e instanceof Error ? e.message : "Action failed"
      setError(msg)
      toast.error(msg)
    } finally {
      setActionBusy(null)
    }
  }

  const addNote = async () => {
    if (!params.id || !note.trim()) return
    setSavingNote(true)
    setError("")
    try {
      await authedPost(`/api/v1/orders/${params.id}/notes`, { note: note.trim(), isInternal: true })
      setNote("")
      await loadOrder()
    } catch (e) {
      setError(e instanceof Error ? e.message : "Could not save note")
    } finally {
      setSavingNote(false)
    }
  }

  const runShiprocketAction = async (
    action:
      | "serviceability"
      | "create_shipment"
      | "assign_awb"
      | "generate_pickup"
      | "retry_shipment_sync"
      | "refresh_tracking"
      | "regenerate_tracking_data"
      | "repair_shipment_state",
  ) => {
    if (!params.id) return
    setShiprocketBusy(action)
    setError("")
    try {
      const result = await authedPost<{
        availableCouriers?: Array<{ name: string; eta_days: number; rate: number }>
      }>(`/api/v1/orders/${params.id}/shiprocket`, { action })
      if (action === "serviceability") {
        const top = (result.availableCouriers ?? []).slice(0, 2)
        setServiceabilitySummary(
          top.length
            ? top.map((courier) => `${courier.name} (${courier.eta_days}d • Rs.${courier.rate})`).join(" | ")
            : "No courier serviceability found",
        )
      }
      await loadOrder()
    } catch (e) {
      setError(e instanceof Error ? e.message : "Shiprocket action failed")
    } finally {
      setShiprocketBusy(null)
    }
  }

  const activity = [
    ...(order?.statusHistory ?? []).map((entry) => ({
      id: `status-${entry.changedAt}-${entry.toStatus}`,
      title: `Status changed to ${entry.toStatus.replace(/_/g, " ")}`,
      at: entry.changedAt,
      detail: `${entry.notes ?? "Order lifecycle update"}${entry.changedById ? ` • by ${entry.changedById.slice(0, 8)}` : ""}`,
    })),
    ...(order?.transactions ?? []).map((tx) => ({
      id: `tx-${tx.id}`,
      title: `Payment ${tx.status}`,
      at: tx.createdAt,
      detail: `${tx.gateway} • ${order?.currency ?? "INR"} ${Number(tx.amount).toFixed(2)}`,
    })),
  ].sort((a, b) => +new Date(b.at) - +new Date(a.at))

  const getOrderStatusBadge = (status: string) => {
    const s = status.toLowerCase().trim();

    if (s === "cancelled" || s === "rejected" || s === "failed") {
      return (
        <span className="inline-flex items-center gap-1.5 rounded-full border border-red-200 bg-red-50 px-2.5 py-0.5 text-xs font-semibold text-red-700 capitalize">
          <span className="h-1.5 w-1.5 rounded-full bg-red-500" />
          {s.replaceAll("_", " ")}
        </span>
      );
    }

    if (s === "delivered" || s === "completed") {
      return (
        <span className="inline-flex items-center gap-1.5 rounded-full border border-emerald-200 bg-emerald-50 px-2.5 py-0.5 text-xs font-semibold text-emerald-700 capitalize">
          <span className="h-1.5 w-1.5 rounded-full bg-emerald-500" />
          {s.replaceAll("_", " ")}
        </span>
      );
    }

    if (s === "shipped") {
      return (
        <span className="inline-flex items-center gap-1.5 rounded-full border border-blue-200 bg-blue-50 px-2.5 py-0.5 text-xs font-semibold text-blue-700 capitalize">
          <span className="h-1.5 w-1.5 rounded-full bg-blue-500" />
          Shipped
        </span>
      );
    }

    if (s === "in_transit" || s === "out_for_delivery" || s === "dispatched") {
      return (
        <span className="inline-flex items-center gap-1.5 rounded-full border border-indigo-200 bg-indigo-50 px-2.5 py-0.5 text-xs font-semibold text-indigo-700 capitalize">
          <span className="h-1.5 w-1.5 rounded-full bg-indigo-500" />
          {s.replaceAll("_", " ")}
        </span>
      );
    }

    if (s === "confirmed" || s === "packed" || s === "processing") {
      return (
        <span className="inline-flex items-center gap-1.5 rounded-full border border-cyan-200 bg-cyan-50 px-2.5 py-0.5 text-xs font-semibold text-cyan-700 capitalize">
          <span className="h-1.5 w-1.5 rounded-full bg-cyan-500" />
          {s.replaceAll("_", " ")}
        </span>
      );
    }

    if (s === "admin_approval_pending" || s === "approval_pending") {
      return (
        <span className="inline-flex items-center gap-1.5 rounded-full border border-amber-300 bg-amber-50 px-2.5 py-0.5 text-xs font-semibold text-amber-800">
          <span className="h-1.5 w-1.5 rounded-full bg-amber-500" />
          Pending
        </span>
      );
    }

    if (s === "new" || s === "pending" || s === "pending_payment" || s === "payment_success") {
      return (
        <span className="inline-flex items-center gap-1.5 rounded-full border border-sky-200 bg-sky-50 px-2.5 py-0.5 text-xs font-semibold text-sky-700 capitalize">
          <span className="h-1.5 w-1.5 rounded-full bg-sky-500" />
          {s === "new" ? "New Order" : s.replaceAll("_", " ")}
        </span>
      );
    }

    return (
      <span className="inline-flex items-center gap-1.5 rounded-full border border-slate-200 bg-slate-100 px-2.5 py-0.5 text-xs font-semibold text-slate-700 capitalize">
        <span className="h-1.5 w-1.5 rounded-full bg-slate-400" />
        {s.replaceAll("_", " ")}
      </span>
    );
  };

  return (
    <section className="w-full space-y-5 py-6">
      <div className="flex flex-wrap items-center justify-between gap-3 rounded-2xl border border-[#E8DCC8] bg-white p-4 shadow-sm">
        <div>
          <h1 className="font-melon text-2xl font-bold text-[#4A1D1F]">Order details</h1>
          <div className="mt-1 flex flex-wrap items-center gap-x-3 gap-y-1 text-xs text-[#646464]">
            <span>Order ID: <code className="font-mono font-bold text-[#7B3010]">{order?.id ?? "----"}</code></span>
            <span>•</span>
            <span>Invoice No: <code className="font-mono font-bold text-[#2A1810]">{order ? formatInvoiceNumber(order.id, order.createdAt) : "----"}</code></span>
            <span>•</span>
            <span>{order ? new Date(order.createdAt).toLocaleString() : "Loading"}</span>
          </div>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          {order?.status !== "cancelled" && (
            <Button
              className="bg-red-600 text-white hover:bg-red-700 font-semibold"
              onClick={() => setShowCancelModal(true)}
              disabled={actionBusy === "admin_cancel"}
            >
              <Ban className="mr-1.5 h-4 w-4" />
              Cancel Order
            </Button>
          )}
          <Button
            variant="outline"
            onClick={() => void handleSyncOrder()}
            disabled={!order || syncingOrder}
            className="border-[#7B3010] text-[#7B3010] hover:bg-[#FFF7EA]"
          >
            {syncingOrder ? (
              <Loader2 className="mr-1.5 h-4 w-4 animate-spin" />
            ) : (
              <RefreshCw className="mr-1.5 h-4 w-4" />
            )}
            Sync Order
          </Button>
          <Button
            variant="outline"
            onClick={() => void handleDownloadInvoice()}
            disabled={!order || downloadingInvoice}
          >
            {downloadingInvoice ? (
              <Loader2 className="mr-1.5 h-4 w-4 animate-spin" />
            ) : (
              <Download className="mr-1.5 h-4 w-4" />
            )}
            Download invoice
          </Button>
          <Button variant="outline" onClick={() => void loadOrder()}>
            Refresh
          </Button>
          <Button variant="outline" onClick={() => router.back()}>
            Back to orders
          </Button>
        </div>
      </div>

      {error ? (
        <p className="rounded-lg bg-red-50 px-3 py-2 text-sm text-red-800">{error}</p>
      ) : loading ? (
        <p className="text-sm text-[#646464]">Loading order details…</p>
      ) : order ? (
        <div className="grid gap-5 lg:grid-cols-3">
          <div className="space-y-5 lg:col-span-2">
            <div className="grid gap-4 rounded-2xl border border-[#E8DCC8] bg-white p-4 shadow-sm sm:grid-cols-2 md:grid-cols-3 lg:grid-cols-6">
              <div>
                <p className="text-xs uppercase tracking-[0.15em] text-[#646464]">Order ID</p>
                <code className="mt-1 block font-mono text-xs font-bold text-[#7B3010] truncate" title={order.id}>{order.id}</code>
              </div>
              <div>
                <p className="text-xs uppercase tracking-[0.15em] text-[#646464]">Invoice No</p>
                <code className="mt-1 block font-mono text-xs font-bold text-[#2A1810]">{formatInvoiceNumber(order.id, order.createdAt)}</code>
              </div>
              <div>
                <p className="text-xs uppercase tracking-[0.15em] text-[#646464]">Status</p>
                <div className="mt-1">{getOrderStatusBadge(order.status)}</div>
              </div>
              <div>
                <p className="text-xs uppercase tracking-[0.15em] text-[#646464]">Payment</p>
                <p className="mt-1 font-semibold uppercase text-[#2A1810]">{order.paymentStatus ?? "PENDING"}</p>
              </div>
              <div>
                <p className="text-xs uppercase tracking-[0.15em] text-[#646464]">Total</p>
                <p className="mt-1 font-semibold text-[#2A1810]">
                  {order.currency} {Number(order.total).toFixed(2)}
                </p>
              </div>
              <div>
                <p className="text-xs uppercase tracking-[0.15em] text-[#646464]">Payment Ref</p>
                <p className="mt-1 font-mono text-xs text-[#2A1810] truncate" title={order.paymentId ?? "—"}>{order.paymentId ?? "—"}</p>
              </div>
            </div>

            <div className="rounded-2xl border border-[#E8DCC8] bg-white p-4 shadow-sm">
              <h2 className="mb-3 text-base font-semibold text-[#4A1D1F]">Order items</h2>
              {(order.items ?? []).length === 0 ? (
                <p className="text-sm text-[#646464]">No items in this order.</p>
              ) : (
                <ul className="space-y-2">
                  {(order.items ?? []).map((item, idx) => {
                    const productName = item.product?.name ?? "Deleted product"
                    const key = item.id ?? `${item.product?.id ?? item.productId ?? "unknown"}-${idx}`
                    return (
                      <li key={key} className="rounded-xl border border-[#EFE3D5] bg-[#FFFBF7] px-3 py-2">
                        <div className="flex items-center justify-between gap-3 text-sm text-[#2A1810]">
                          <span>{productName}</span>
                          <span className="font-semibold">x{item.quantity}</span>
                        </div>
                      </li>
                    )
                  })}
                </ul>
              )}
            </div>

            <div className="rounded-2xl border border-[#E8DCC8] bg-white p-4 shadow-sm">
              <h2 className="mb-3 text-base font-semibold text-[#4A1D1F]">Payment</h2>
              <div className="grid gap-3 text-sm md:grid-cols-2">
                <div className="rounded-lg bg-[#FFFBF3] px-3 py-2">
                  <p className="text-xs uppercase text-[#646464]">Subtotal</p>
                  <p className="font-semibold text-[#2A1810]">
                    {order.currency} {Number(order.subtotal).toFixed(2)}
                  </p>
                </div>
                <div className="rounded-lg bg-[#FFFBF3] px-3 py-2">
                  <p className="text-xs uppercase text-[#646464]">Shipping</p>
                  <p className="font-semibold text-[#2A1810]">
                    {order.currency} {Number(order.shipping).toFixed(2)}
                  </p>
                </div>
                <div className="rounded-lg bg-[#FFFBF3] px-3 py-2 md:col-span-2">
                  <p className="text-xs uppercase text-[#646464]">Net payment</p>
                  <p className="font-semibold text-[#2A1810]">
                    {order.currency} {Number(order.total).toFixed(2)}
                  </p>
                </div>
              </div>
            </div>

            <div className="rounded-2xl border border-[#E8DCC8] bg-white p-4 shadow-sm">
              <h2 className="mb-3 text-base font-semibold text-[#4A1D1F]">Transaction details</h2>
              {!order.transactions?.length ? (
                <p className="text-sm text-[#646464]">No transaction records found.</p>
              ) : (
                <div className="space-y-2">
                  {order.transactions.map((tx) => (
                    <div key={tx.id} className="grid grid-cols-4 rounded-lg border border-[#EFE3D5] bg-[#FFFBF7] px-3 py-2 text-xs text-[#2A1810]">
                      <span>{new Date(tx.createdAt).toLocaleDateString()}</span>
                      <span className="truncate">{tx.gateway}</span>
                      <span>
                        {order.currency} {Number(tx.amount).toFixed(2)}
                      </span>
                      <span className="uppercase">{tx.status}</span>
                    </div>
                  ))}
                </div>
              )}
            </div>

            <div className="rounded-2xl border border-[#E8DCC8] bg-white p-4 shadow-sm">
              <h2 className="mb-3 text-base font-semibold text-[#4A1D1F]">Activity</h2>
              <div className="space-y-2">
                {activity.length === 0 ? (
                  <p className="text-sm text-[#646464]">No activity yet.</p>
                ) : (
                  activity.slice(0, 12).map((event) => (
                    <div key={event.id} className="rounded-lg border border-[#EFE3D5] bg-[#FFFBF7] px-3 py-2">
                      <div className="flex items-center justify-between gap-3 text-sm">
                        <p className="font-medium text-[#2A1810]">{event.title}</p>
                        <p className="text-xs text-[#646464]">{new Date(event.at).toLocaleString()}</p>
                      </div>
                      <p className="mt-1 text-xs text-[#646464]">{event.detail}</p>
                    </div>
                  ))
                )}
              </div>
            </div>
          </div>

          <div className="space-y-5">
            <div className="rounded-2xl border border-[#E8DCC8] bg-white p-4 shadow-sm">
              <h2 className="mb-3 text-base font-semibold text-[#4A1D1F]">Customer information</h2>
              <div className="space-y-2 text-sm text-[#2A1810]">
                <p className="font-semibold">{order.customerName ?? order.user?.name ?? "Guest customer"}</p>
                <p className="text-[#646464]">{order.user?.email ?? "No email available"}</p>
                <p className="text-[#646464]">{order.customerPhone ?? "No phone available"}</p>
                <p className="text-[#646464]">{order.customerAddress ?? "No billing address saved"}</p>
              </div>
            </div>

            <div className="rounded-2xl border border-[#E8DCC8] bg-white p-4 shadow-sm">
              <h2 className="mb-3 text-base font-semibold text-[#4A1D1F]">Notes</h2>
              <textarea
                value={note}
                onChange={(e) => setNote(e.target.value)}
                rows={4}
                placeholder="Write order notes..."
                className="w-full rounded-lg border border-[#D9D9D1] px-3 py-2 text-sm focus:border-[#7B3010] focus:outline-none"
              />
              <button
                type="button"
                onClick={() => void addNote()}
                disabled={!note.trim() || savingNote}
                className="mt-2 rounded-lg bg-[#7B3010] px-3 py-1.5 text-xs font-semibold uppercase tracking-wide text-white disabled:opacity-40"
              >
                {savingNote ? "Saving..." : "Add note"}
              </button>
              <div className="mt-3 space-y-2">
                {(order.notes ?? []).length === 0 ? (
                  <p className="text-sm text-[#646464]">No notes added yet.</p>
                ) : (
                  (order.notes ?? []).map((entry) => (
                    <div key={entry.id} className="rounded-lg border border-[#EFE3D5] bg-[#FFFBF7] px-3 py-2">
                      <p className="text-sm text-[#2A1810]">{entry.note}</p>
                      <p className="mt-1 text-xs text-[#646464]">{new Date(entry.createdAt).toLocaleString()}</p>
                    </div>
                  ))
                )}
              </div>
            </div>

            <div className="rounded-2xl border border-[#E8DCC8] bg-white p-4 shadow-sm">
              <h2 className="mb-3 text-base font-semibold text-[#4A1D1F]">Shipping</h2>
              <div className="mb-3 flex flex-wrap gap-2">
                <button
                  type="button"
                  disabled={shiprocketBusy === "serviceability"}
                  onClick={() => void runShiprocketAction("serviceability")}
                  className="rounded-lg border border-[#E8DCC8] bg-white px-3 py-1.5 text-[11px] font-semibold uppercase tracking-wide text-[#4A1D1F] hover:bg-[#FFFBF3] disabled:opacity-40"
                >
                  {shiprocketBusy === "serviceability" ? "Checking..." : "Check Serviceability"}
                </button>
                <button
                  type="button"
                  disabled={shiprocketBusy === "create_shipment" || Boolean(order.shipments?.length)}
                  onClick={() => void runShiprocketAction("create_shipment")}
                  className="rounded-lg border border-[#E8DCC8] bg-white px-3 py-1.5 text-[11px] font-semibold uppercase tracking-wide text-[#4A1D1F] hover:bg-[#FFFBF3] disabled:opacity-40"
                >
                  {shiprocketBusy === "create_shipment" ? "Creating..." : "Create Shipment"}
                </button>
                <button
                  type="button"
                  disabled={shiprocketBusy === "assign_awb" || !order.shipments?.length || Boolean(order.shipments?.[0]?.trackingNo)}
                  onClick={() => void runShiprocketAction("assign_awb")}
                  className="rounded-lg border border-[#E8DCC8] bg-white px-3 py-1.5 text-[11px] font-semibold uppercase tracking-wide text-[#4A1D1F] hover:bg-[#FFFBF3] disabled:opacity-40"
                >
                  {shiprocketBusy === "assign_awb" ? "Assigning..." : "Assign AWB"}
                </button>
                <button
                  type="button"
                  disabled={shiprocketBusy === "generate_pickup" || !order.shipments?.length}
                  onClick={() => void runShiprocketAction("generate_pickup")}
                  className="rounded-lg border border-[#E8DCC8] bg-white px-3 py-1.5 text-[11px] font-semibold uppercase tracking-wide text-[#4A1D1F] hover:bg-[#FFFBF3] disabled:opacity-40"
                >
                  {shiprocketBusy === "generate_pickup" ? "Generating..." : "Generate Pickup"}
                </button>
                <button
                  type="button"
                  disabled={shiprocketBusy === "retry_shipment_sync"}
                  onClick={() => void runShiprocketAction("retry_shipment_sync")}
                  className="rounded-lg border border-[#E8DCC8] bg-white px-3 py-1.5 text-[11px] font-semibold uppercase tracking-wide text-[#4A1D1F] hover:bg-[#FFFBF3] disabled:opacity-40"
                >
                  {shiprocketBusy === "retry_shipment_sync" ? "Retrying..." : "Retry Shipment Sync"}
                </button>
                <button
                  type="button"
                  disabled={shiprocketBusy === "refresh_tracking" || !order.shipments?.length}
                  onClick={() => void runShiprocketAction("refresh_tracking")}
                  className="rounded-lg border border-[#E8DCC8] bg-white px-3 py-1.5 text-[11px] font-semibold uppercase tracking-wide text-[#4A1D1F] hover:bg-[#FFFBF3] disabled:opacity-40"
                >
                  {shiprocketBusy === "refresh_tracking" ? "Refreshing..." : "Refresh Tracking"}
                </button>
                <button
                  type="button"
                  disabled={shiprocketBusy === "regenerate_tracking_data" || !order.shipments?.length}
                  onClick={() => void runShiprocketAction("regenerate_tracking_data")}
                  className="rounded-lg border border-[#E8DCC8] bg-white px-3 py-1.5 text-[11px] font-semibold uppercase tracking-wide text-[#4A1D1F] hover:bg-[#FFFBF3] disabled:opacity-40"
                >
                  {shiprocketBusy === "regenerate_tracking_data" ? "Working..." : "Regenerate Tracking Data"}
                </button>
                <button
                  type="button"
                  disabled={shiprocketBusy === "repair_shipment_state"}
                  onClick={() => void runShiprocketAction("repair_shipment_state")}
                  className="rounded-lg border border-[#E8DCC8] bg-white px-3 py-1.5 text-[11px] font-semibold uppercase tracking-wide text-[#4A1D1F] hover:bg-[#FFFBF3] disabled:opacity-40"
                >
                  {shiprocketBusy === "repair_shipment_state" ? "Repairing..." : "Repair Shipment State"}
                </button>
              </div>
              {serviceabilitySummary && <p className="mb-3 rounded-lg bg-[#FFFBF3] px-3 py-2 text-xs text-[#646464]">{serviceabilitySummary}</p>}
              <TrackingTimeline
                orderStatus={order.status}
                shipmentStatus={order.shipmentStatus ?? order.shipments?.[0]?.shipmentStatus ?? null}
                statusHistory={order.statusHistory}
              />
              <div className="mt-3 grid gap-1 text-xs text-[#646464]">
                <p><span className="font-semibold text-[#2A1810]">Courier:</span> {order.courierName ?? order.shipments?.[0]?.carrier ?? "—"}</p>
                <p><span className="font-semibold text-[#2A1810]">AWB:</span> {order.awbCode ?? order.trackingNumber ?? order.shipments?.[0]?.trackingNo ?? "—"}</p>
                <p><span className="font-semibold text-[#2A1810]">Last Tracking Sync:</span> {order.lastTrackingSyncAt ? new Date(order.lastTrackingSyncAt).toLocaleString() : "—"}</p>
                <p><span className="font-semibold text-[#2A1810]">ETA:</span> {order.estimatedDeliveryDate ? new Date(order.estimatedDeliveryDate).toLocaleDateString() : "—"}</p>
              </div>
              {!order.shipments?.length ? (
                <p className="text-sm text-[#646464]">No shipment records found yet.</p>
              ) : (
                <div className="space-y-2 text-sm">
                  {order.shipments.map((shipment) => (
                    <div key={shipment.id} className="rounded-lg border border-[#EFE3D5] bg-[#FFFBF7] px-3 py-2">
                      <p className="font-medium text-[#2A1810]">{shipment.carrier ?? "Carrier not set"}</p>
                      <p className="font-mono text-xs text-[#646464]">{shipment.trackingNo ?? "No tracking number"}</p>
                      <p className="mt-1 text-xs uppercase text-[#646464]">{shipment.shipmentStatus}</p>
                    </div>
                  ))}
                </div>
              )}
            </div>
          </div>

          <div className="lg:col-span-3 rounded-2xl border border-[#E8DCC8] bg-white p-4 shadow-sm">
            <div>
              <h2 className="mb-3 text-sm font-semibold uppercase tracking-[0.15em] text-[#4A1D1F]">Lifecycle actions</h2>
            </div>
            <p className="text-xs uppercase text-[#646464]">
              {(order.statusHistory ?? [])
                .map((entry) => entry.toStatus.toUpperCase())
                .slice(0, 7)
                .reverse()
                .join(" → ") || "CREATED"}
            </p>
            <div className="mt-3 flex flex-wrap gap-2">
              {lifecycleStatus === "admin_approval_pending" && (
                <>
                  <Button variant="outline" disabled={actionBusy === "approve_order"} onClick={() => void runAction("approve_order")}>
                    {actionBusy === "approve_order" ? "Working..." : "Approve Order"}
                  </Button>
                  <Button variant="outline" disabled={actionBusy === "reject_order"} onClick={() => void runAction("reject_order")}>
                    {actionBusy === "reject_order" ? "Working..." : "Reject Order"}
                  </Button>
                </>
              )}
              {lifecycleStatus === "cancel_requested" && (
                <>
                  <Button variant="outline" disabled={actionBusy === "approve_cancel"} onClick={() => void runAction("approve_cancel")}>
                    {actionBusy === "approve_cancel" ? "Working..." : "Approve Cancel"}
                  </Button>
                  <Button variant="outline" disabled={actionBusy === "reject_cancel"} onClick={() => void runAction("reject_cancel")}>
                    {actionBusy === "reject_cancel" ? "Working..." : "Reject Cancel"}
                  </Button>
                </>
              )}
              {lifecycleStatus === "return_requested" && (
                <>
                  <Button variant="outline" disabled={actionBusy === "approve_return"} onClick={() => void runAction("approve_return")}>
                    {actionBusy === "approve_return" ? "Working..." : "Approve Return"}
                  </Button>
                  <Button variant="outline" disabled={actionBusy === "reject_return"} onClick={() => void runAction("reject_return")}>
                    {actionBusy === "reject_return" ? "Working..." : "Reject Return"}
                  </Button>
                </>
              )}
              {refundStatus === "initiated" && (
                <>
                  <Button variant="outline" disabled={actionBusy === "trigger_refund"} onClick={() => void runAction("trigger_refund")}>
                    {actionBusy === "trigger_refund" ? "Working..." : "Trigger Refund"}
                  </Button>
                </>
              )}
              {["failed", "rejected"].includes(refundStatus) && (
                <>
                  <Button variant="outline" disabled={actionBusy === "retry_refund"} onClick={() => void runAction("retry_refund")}>
                    {actionBusy === "retry_refund" ? "Working..." : "Retry Refund"}
                  </Button>
                </>
              )}
              {order.status !== "cancelled" && (
                <Button
                  className="bg-red-600 text-white hover:bg-red-700 font-semibold"
                  disabled={actionBusy === "admin_cancel"}
                  onClick={() => setShowCancelModal(true)}
                >
                  <Ban className="mr-1.5 h-4 w-4" />
                  {actionBusy === "admin_cancel" ? "Cancelling..." : "Cancel Order (Admin)"}
                </Button>
              )}
            </div>
          </div>
        </div>
      ) : null}

      {/* CANCEL ORDER MODAL */}
      {showCancelModal && order && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4">
          <div className="w-full max-w-md rounded-2xl bg-white p-6 shadow-xl border border-[#E8DCC8] space-y-4 animate-in fade-in zoom-in-95">
            <div className="flex items-center justify-between">
              <div className="flex items-center gap-2.5 text-red-600">
                <AlertTriangle className="h-6 w-6" />
                <h3 className="text-lg font-bold text-[#4A1D1F]">Cancel Order</h3>
              </div>
              <button
                type="button"
                onClick={() => setShowCancelModal(false)}
                className="text-gray-400 hover:text-gray-600"
              >
                <XCircle className="h-5 w-5" />
              </button>
            </div>
            <p className="text-sm text-[#646464]">
              Are you sure you want to cancel order <span className="font-semibold text-[#2A1810]">#{order.id.slice(0, 8)}</span>?
              This will update the order status to <span className="font-semibold text-red-600">cancelled</span> in Ziply5 and cancel the order on Shiprocket as well.
            </p>
            <div>
              <label className="block text-xs font-semibold uppercase tracking-wide text-[#4A1D1F] mb-1">
                Reason for Cancellation (Optional)
              </label>
              <textarea
                value={cancelReason}
                onChange={(e) => setCancelReason(e.target.value)}
                placeholder="Enter cancellation reason..."
                rows={3}
                className="w-full rounded-xl border border-[#D9D9D1] px-3 py-2 text-sm focus:border-[#7B3010] focus:outline-none"
              />
            </div>
            <div className="flex justify-end gap-2 pt-2">
              <Button
                variant="outline"
                onClick={() => setShowCancelModal(false)}
                disabled={actionBusy === "admin_cancel"}
              >
                Keep Order
              </Button>
              <Button
                className="bg-red-600 text-white hover:bg-red-700 font-semibold"
                disabled={actionBusy === "admin_cancel"}
                onClick={() => void runAction("admin_cancel", cancelReason.trim() || "Cancelled by admin")}
              >
                {actionBusy === "admin_cancel" ? (
                  <>
                    <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                    Cancelling...
                  </>
                ) : (
                  "Confirm Cancel"
                )}
              </Button>
            </div>
          </div>
        </div>
      )}
    </section>
  )
}
