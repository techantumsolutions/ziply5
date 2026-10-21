"use client"

import { useEffect, useState } from "react"
import { useParams, useRouter } from "next/navigation"
import { authedFetch, authedPost } from "@/lib/dashboard-fetch"
import { Button } from "@/components/ui/button"
import { TrackingTimeline } from "@/src/components/shipping/tracking-timeline"
import { AlertTriangle, Ban, Check, Download, Loader2, Mail, MapPin, Package, Phone, RefreshCw, Truck, XCircle } from "lucide-react"
import { generateAdminInvoicePDF } from "@/lib/invoice"
import { formatOrderDateTime } from "@/src/lib/datetime"
import { isConfirmedPickupRequest } from "@/src/server/modules/shipping/shiprocket-status"
import { orderStatusLabel } from "@/src/lib/orders/manual-order-status"
import { toast } from "@/lib/toast"

const ADMIN_ORDER_STATUS_OPTIONS = [
  "pending",
  "confirmed",
  "packed",
  "shipped",
  "in_transit",
  "out_for_delivery",
  "delivered",
  "cancelled",
  "returned",
] as const

const ADMIN_SHIPMENT_STATUS_OPTIONS = [
  "not_shipped",
  "shipped",
  "in_transit",
  "out_for_delivery",
  "delivered",
  "cancelled",
  "returned",
] as const

const ORDER_STATUS_PROGRESSION: Record<string, number> = {
  pending: 0,
  new: 0,
  pending_payment: 0,
  payment_success: 0,
  admin_approval_pending: 0,
  approval_pending: 0,
  confirmed: 1,
  packed: 2,
  shipped: 3,
  in_transit: 4,
  out_for_delivery: 5,
  delivered: 6,
  completed: 6,
}

const SHIPMENT_STATUS_PROGRESSION: Record<string, number> = {
  not_shipped: 0,
  pending: 0,
  ready_to_ship: 1,
  shipment_created: 1,
  manifest_generated: 1,
  pickup_generated: 2,
  shipped: 3,
  in_transit: 4,
  out_for_delivery: 5,
  delivered: 6,
}

const getForwardOrderStatusOptions = (currentStatus: string): string[] => {
  const normCurrent = currentStatus.toLowerCase().trim()
  const currentRank = ORDER_STATUS_PROGRESSION[normCurrent] ?? 0
  const isTerminal = normCurrent === "delivered" || normCurrent === "cancelled" || normCurrent === "rejected"

  return (ADMIN_ORDER_STATUS_OPTIONS as readonly string[]).filter((opt) => {
    const normOpt = opt.toLowerCase().trim()
    if (normOpt === normCurrent) return true
    if (isTerminal) {
      if (normCurrent === "delivered" && normOpt === "returned") return true
      return false
    }
    if (normOpt === "cancelled") {
      return currentRank < (ORDER_STATUS_PROGRESSION["shipped"] ?? 3)
    }
    if (normOpt === "returned") {
      return currentRank >= (ORDER_STATUS_PROGRESSION["delivered"] ?? 6)
    }
    const optRank = ORDER_STATUS_PROGRESSION[normOpt]
    if (optRank === undefined) return false
    return optRank > currentRank
  })
}

const getForwardShipmentStatusOptions = (currentStatus: string): string[] => {
  const normCurrent = currentStatus.toLowerCase().trim()
  const currentRank = SHIPMENT_STATUS_PROGRESSION[normCurrent] ?? 0
  const isTerminal = normCurrent === "delivered" || normCurrent === "cancelled"

  return (ADMIN_SHIPMENT_STATUS_OPTIONS as readonly string[]).filter((opt) => {
    const normOpt = opt.toLowerCase().trim()
    if (normOpt === normCurrent) return true
    if (isTerminal) {
      if (normCurrent === "delivered" && normOpt === "returned") return true
      return false
    }
    if (normOpt === "cancelled") {
      return currentRank < (SHIPMENT_STATUS_PROGRESSION["shipped"] ?? 3)
    }
    if (normOpt === "returned") {
      return currentRank >= (SHIPMENT_STATUS_PROGRESSION["delivered"] ?? 6)
    }
    const optRank = SHIPMENT_STATUS_PROGRESSION[normOpt]
    if (optRank === undefined) return false
    return optRank > currentRank
  })
}

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
  couponCode?: string | null
  paymentMethod?: string | null
  items: Array<{
    id?: string
    quantity: number
    sku?: string | null
    unitPrice?: string | number
    lineTotal?: string | number
    product?: { id: string; name: string; slug: string; sku?: string | null; weight?: string | null; thumbnail?: string | null } | null
    variant?: { id?: string; name?: string | null; sku?: string | null; weight?: string | null; hsnCode?: string | null } | null
    productId?: string | null
  }>
  transactions?: Array<{ id: string; gateway: string; amount: string | number; status: string; createdAt: string }>
  statusHistory?: Array<{ toStatus: string; changedAt: string; notes?: string | null; reasonCode?: string | null; changedById?: string | null }>
  notes?: Array<{ id: string; note: string; isInternal: boolean; createdAt: string }>
  user?: { id: string; name: string; email: string }
  shipments?: Array<{ id: string; carrier: string | null; trackingNo: string | null; shipmentStatus: string; awbCode?: string | null; trackingUrl?: string | null; pickupStatus?: string | null; courierName?: string | null; shipmentNo?: string | null; cancelledAt?: string | null }>
  awbCode?: string | null
  courierName?: string | null
  trackingNumber?: string | null
  trackingUrl?: string | null
  shipmentStatus?: string | null
  pickupStatus?: string | null
  isPickupGenerated?: boolean | null
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

const formatInr = (value: number) => {
  const amount = Number.isFinite(value) ? value : 0
  return `₹${amount.toLocaleString("en-IN", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`
}

const initials = (name?: string | null) => {
  const parts = String(name ?? "").trim().split(/\s+/).filter(Boolean)
  if (!parts.length) return "CU"
  return parts.slice(0, 2).map((part) => part[0]?.toUpperCase() ?? "").join("")
}

const progressRank = (status: string) => {
  const value = status.toLowerCase()
  if (["delivered", "completed"].includes(value)) return 4
  if (["shipped", "in_transit", "out_for_delivery", "dispatched"].includes(value)) return 3
  if (["processing", "packed"].includes(value)) return 2
  if (["confirmed", "approved"].includes(value)) return 1
  return 0
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
  const busy = (action: string) => shiprocketBusy === action
  const [serviceabilitySummary, setServiceabilitySummary] = useState<string>("")
  const [serviceable, setServiceable] = useState(false)
  const [downloadingInvoice, setDownloadingInvoice] = useState(false)
  const [syncingOrder, setSyncingOrder] = useState(false)
  const [showCancelModal, setShowCancelModal] = useState(false)
  const [cancelReason, setCancelReason] = useState("")
  const rawLifecycle = (order?.statusHistory?.[0]?.toStatus ?? order?.status ?? "").toLowerCase()
  const hasAdminRejected =
    rawLifecycle === "rejected" ||
    order?.statusHistory?.some((h) => (h.reasonCode ?? "").toLowerCase() === "admin_rejected" || (h.toStatus ?? "").toLowerCase() === "rejected")
  const lifecycleStatus = hasAdminRejected ? "rejected" : rawLifecycle
  const refundStatus = (order?.refunds?.[0]?.status ?? "pending").toLowerCase()
  const shipmentState = (order?.shipmentStatus ?? order?.shipments?.[0]?.shipmentStatus ?? "").toLowerCase()
  const orderShipped =
    progressRank(lifecycleStatus) >= 3 ||
    progressRank(order?.status ?? "") >= 3 ||
    ["shipped", "in_transit", "out_for_delivery", "dispatched", "delivered", "completed"].includes(shipmentState)
  const isOrderAccepted = ["confirmed", "packed", "shipped", "in_transit", "out_for_delivery", "delivered", "completed"].includes(lifecycleStatus.toLowerCase())

  const [manualModal, setManualModal] = useState<{ courier: string; trackingId: string; trackingUrl: string } | null>(null)
  const [savingManual, setSavingManual] = useState(false)

  const saveManualShipment = async () => {
    if (!manualModal || !order?.id) return
    const courier = manualModal.courier.trim()
    const trackingId = manualModal.trackingId.trim()
    const trackingUrl = manualModal.trackingUrl.trim()
    if (!courier || !trackingId) {
      toast.error("Manual shipment", "Courier name and tracking ID are required.")
      return
    }
    setSavingManual(true)
    try {
      await authedPost(`/api/v1/orders/${order.id}/fulfillment`, {
        action: "manual_shipment",
        courierName: courier,
        trackingId,
        trackingUrl,
      })
      setManualModal(null)
      toast.success("Manual shipment saved", "Order fulfillment updated.")
      await loadOrder({ silent: true })
    } catch (e) {
      toast.error("Manual shipment failed", e instanceof Error ? e.message : "Failed to save manual shipment")
    } finally {
      setSavingManual(false)
    }
  }

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

  const loadOrder = async (options?: { silent?: boolean }) => {
    if (!params.id) return
    if (!options?.silent) setLoading(true)
    if (!options?.silent) setError("")
    return authedFetch<OrderDetail>(`/api/v1/orders/${params.id}`)
      .then((data) => setOrder(data))
      .catch((e: Error) => setError(e.message))
      .finally(() => setLoading(false))
  }

  useEffect(() => {
    void loadOrder()
  }, [params.id])

  const [updatingStatus, setUpdatingStatus] = useState<"order" | "shipment" | null>(null)

  const handleUpdateOrderStatus = async (nextStatus: string) => {
    if (!order?.id || updatingStatus) return
    const currentStatus = lifecycleStatus.toLowerCase().trim()
    const normNext = nextStatus.toLowerCase().trim()
    if (normNext === currentStatus) return

    const currentRank = ORDER_STATUS_PROGRESSION[currentStatus] ?? 0
    const nextRank = ORDER_STATUS_PROGRESSION[normNext]

    if (currentStatus === "cancelled" || currentStatus === "rejected") {
      toast.error("Status update not allowed", `Cannot change status of a ${currentStatus} order.`)
      return
    }
    if (normNext !== "cancelled" && normNext !== "returned" && nextRank !== undefined && nextRank < currentRank) {
      toast.error("Invalid status transition", "Order status can only move forward, not backward.")
      return
    }
    if (normNext === "cancelled" && currentRank >= (ORDER_STATUS_PROGRESSION["shipped"] ?? 3)) {
      toast.error("Status update not allowed", "Cannot cancel an order that has already shipped or delivered.")
      return
    }

    setUpdatingStatus("order")
    try {
      await authedPost(`/api/v1/orders/${order.id}/fulfillment`, {
        action: "set_order_status",
        orderStatus: nextStatus,
      })
      toast.success("Order updated", `Order status set to ${orderStatusLabel(nextStatus)}.`)
      await loadOrder({ silent: true })
    } catch (err) {
      toast.error("Status update failed", err instanceof Error ? err.message : "Failed to update order status")
    } finally {
      setUpdatingStatus(null)
    }
  }

  const handleUpdateShipmentStatus = async (nextStatus: string) => {
    if (!order?.id || updatingStatus) return
    const currentStatus = (shipmentState || "not_shipped").toLowerCase().trim()
    const normNext = nextStatus.toLowerCase().trim()
    if (normNext === currentStatus) return

    const currentRank = SHIPMENT_STATUS_PROGRESSION[currentStatus] ?? 0
    const nextRank = SHIPMENT_STATUS_PROGRESSION[normNext]

    if (currentStatus === "cancelled") {
      toast.error("Status update not allowed", "Cannot change status of a cancelled shipment.")
      return
    }
    if (normNext !== "cancelled" && normNext !== "returned" && nextRank !== undefined && nextRank < currentRank) {
      toast.error("Invalid status transition", "Shipment status can only move forward, not backward.")
      return
    }

    setUpdatingStatus("shipment")
    try {
      await authedPost(`/api/v1/orders/${order.id}/fulfillment`, {
        action: "set_shipment_status",
        shipmentStatus: nextStatus,
      })
      toast.success("Shipment updated", `Shipment status set to ${orderStatusLabel(nextStatus)}.`)
      await loadOrder({ silent: true })
    } catch (err) {
      toast.error("Status update failed", err instanceof Error ? err.message : "Failed to update shipment status")
    } finally {
      setUpdatingStatus(null)
    }
  }

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
      | "sync_order"
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
        availableCouriers?: Array<{ name: string; eta_days: number; rate: number; charge_weight_kg?: number; min_weight_kg?: number }>
        weight?: number | null
        lengthCm?: number | null
        widthCm?: number | null
        heightCm?: number | null
        shipmentId?: string | null
        awbCode?: string | null
        courierName?: string | null
        pickup?: { pickup_status?: string | null }
      }>(`/api/v1/orders/${params.id}/shiprocket`, action === "sync_order" ? { action, panelSync: true, generatePickup: false } : { action })
      if (action === "serviceability") {
        const top = (result.availableCouriers ?? []).slice(0, 2)
        const packageLine = [
          result.weight != null ? `package ${result.weight} kg` : null,
          result.lengthCm && result.widthCm && result.heightCm ? `${result.lengthCm}×${result.widthCm}×${result.heightCm} cm` : null,
        ].filter(Boolean).join(", ")
        const summary = top.length
          ? `${packageLine ? `${packageLine}: ` : ""}${top.map((courier) => {
              const eta = courier.eta_days > 0 ? `${courier.eta_days}d` : "eta unavailable"
              const charge = courier.charge_weight_kg != null ? `, chargeable ${courier.charge_weight_kg} kg` : ""
              const minimum = courier.min_weight_kg != null ? `, courier minimum ${courier.min_weight_kg} kg` : ""
              return `${courier.name} (${eta}${charge}${minimum} • Rs.${courier.rate})`
            }).join(" | ")}`
          : "This order is not serviceable please proceed with manual shipment"
        setServiceabilitySummary(summary)
        setServiceable(top.length > 0)
        if (top.length > 0) {
          toast.success("Serviceability", summary)
        } else {
          toast.error("Not serviceable", summary)
        }
        return
      }
      const labels: Record<string, string> = {
        create_shipment: "Shipment created on Shiprocket",
        assign_awb: result.awbCode ? `AWB ${result.awbCode} assigned` : "AWB assigned",
        generate_pickup: "Pickup requested",
        refresh_tracking: "Tracking refreshed",
        retry_shipment_sync: "Shiprocket sync completed",
        sync_order: "Order and shipment status updated from Shiprocket",
        regenerate_tracking_data: "Tracking data regenerated",
        repair_shipment_state: "Shipment state repaired",
      }
      toast.success("Shiprocket", labels[action] ?? "Done")
      await loadOrder({ silent: true })
    } catch (e) {
      const message = e instanceof Error ? e.message : "Shiprocket action failed"
      setError(message)
      toast.error("Shiprocket", message)
    } finally {
      setShiprocketBusy(null)
    }
  }

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
    <section className="w-full space-y-4 py-4">
      <div>
        <p className="text-xs text-[#646464]">
          <button type="button" onClick={() => router.push("/admin/orders")} className="hover:text-[#166534]">Orders</button>
          <span className="mx-1.5">›</span>
          <span className="text-[#111827]">Order details</span>
        </p>
      </div>

      <div className="flex flex-wrap items-center justify-between gap-3">
        <div className="flex flex-wrap items-center gap-3">
          <h1 className="text-2xl font-bold tracking-tight text-[#111827]">
            Order #{order ? order.id.slice(0, 10).toUpperCase() : "--------"}
          </h1>
          {order ? getOrderStatusBadge(lifecycleStatus) : null}
          {order ? (
            <div className="flex items-center gap-1.5">
              <span className="text-xs text-[#6B7280]">Update Status:</span>
              <select
                value={lifecycleStatus}
                disabled={updatingStatus !== null || ["cancelled", "rejected"].includes(lifecycleStatus.toLowerCase())}
                onChange={(e) => void handleUpdateOrderStatus(e.target.value)}
                className="cursor-pointer rounded-lg border border-[#7B3010]/30 bg-[#FFF7ED] px-2.5 py-1 text-xs font-semibold text-[#7B3010] shadow-sm hover:border-[#7B3010] focus:outline-none focus:ring-1 focus:ring-[#7B3010] disabled:cursor-not-allowed disabled:opacity-50"
                title="Manually Change Order Status"
              >
                {getForwardOrderStatusOptions(lifecycleStatus).map((val) => (
                  <option key={val} value={val}>
                    {orderStatusLabel(val)}
                  </option>
                ))}
              </select>
              {updatingStatus === "order" && <Loader2 className="h-3.5 w-3.5 animate-spin text-[#7B3010]" />}
            </div>
          ) : null}
        </div>

        <Button
          variant="outline"
          onClick={() => void loadOrder()}
          disabled={!order || loading}
          className="ml-auto rounded-xl border-[#E5E7EB] bg-white px-3.5 py-1.5 text-xs font-semibold shadow-xs hover:bg-[#F9FAFB]"
        >
          {loading ? <Loader2 className="mr-1.5 h-4 w-4 animate-spin" /> : <RefreshCw className="mr-1.5 h-4 w-4" />}
          Refresh
        </Button>
      </div>

      <p className="-mt-2 text-xs text-[#6B7280]">
        {order
          ? `Placed on ${formatOrderDateTime(order.createdAt)}`
          : "Loading"}
        {order ? `  |  Channel: Online Store` : ""}
        {order?.paymentStatus ? `  |  Payment: ${order.paymentStatus}` : ""}
        {order?.paymentMethod ? ` (${order.paymentMethod.replaceAll("_", " ")})` : ""}
      </p>

      <div className="flex flex-wrap items-center gap-2">
        <Button
          className="bg-[#16803C] text-white hover:bg-[#146C33] disabled:opacity-50"
          disabled={isOrderAccepted || ["cancelled", "rejected"].includes(lifecycleStatus) || actionBusy === "approve_order"}
          onClick={() => void runAction("approve_order")}
        >
          <Check className="mr-1.5 h-4 w-4" />
          {actionBusy === "approve_order" ? "Working..." : isOrderAccepted ? "Order accepted" : "Accept order"}
        </Button>

        <Button
          variant="outline"
          disabled={!isOrderAccepted || ["cancelled", "rejected"].includes(lifecycleStatus) || Boolean(shiprocketBusy)}
          onClick={() => void runShiprocketAction("serviceability")}
          title={!isOrderAccepted ? "Accept order first to check serviceability" : "Check courier serviceability"}
        >
          {busy("serviceability") ? <Loader2 className="mr-1.5 h-4 w-4 animate-spin" /> : null}
          {busy("serviceability") ? "Checking..." : "Check serviceability"}
        </Button>

        <Button
          variant="outline"
          disabled={!isOrderAccepted || ["cancelled", "rejected"].includes(lifecycleStatus) || syncingOrder || Boolean(shiprocketBusy)}
          onClick={() => void handleSyncOrder()}
          title={!isOrderAccepted ? "Accept order first to sync" : "Sync order to Shiprocket"}
        >
          {syncingOrder ? <Loader2 className="mr-1.5 h-4 w-4 animate-spin" /> : <RefreshCw className="mr-1.5 h-4 w-4" />}
          Sync now
        </Button>

        <Button
          variant="outline"
          disabled={!isOrderAccepted || actionBusy === "reject_order" || ["cancelled", "rejected"].includes(lifecycleStatus)}
          onClick={() => void runAction("reject_order")}
          title={!isOrderAccepted ? "Accept order first to reject" : "Reject order"}
        >
          {actionBusy === "reject_order" ? "Working..." : "Reject order"}
        </Button>

        {serviceable === false && Boolean(serviceabilitySummary) && (
          <Button
            variant="outline"
            className="border-amber-300 bg-amber-50 text-amber-800 hover:bg-amber-100"
            onClick={() => setManualModal({ courier: "", trackingId: "", trackingUrl: "" })}
          >
            Manual shipment
          </Button>
        )}

        {lifecycleStatus === "cancel_requested" ? (
          <>
            <Button variant="outline" disabled={actionBusy === "approve_cancel"} onClick={() => void runAction("approve_cancel")}>{actionBusy === "approve_cancel" ? "Working..." : "Approve cancel"}</Button>
            <Button variant="outline" disabled={actionBusy === "reject_cancel"} onClick={() => void runAction("reject_cancel")}>{actionBusy === "reject_cancel" ? "Working..." : "Reject cancel"}</Button>
          </>
        ) : null}
        {lifecycleStatus === "return_requested" ? (
          <>
            <Button variant="outline" disabled={actionBusy === "approve_return"} onClick={() => void runAction("approve_return")}>{actionBusy === "approve_return" ? "Working..." : "Approve return"}</Button>
            <Button variant="outline" disabled={actionBusy === "reject_return"} onClick={() => void runAction("reject_return")}>{actionBusy === "reject_return" ? "Working..." : "Reject return"}</Button>
          </>
        ) : null}
        {refundStatus === "initiated" ? (
          <Button variant="outline" disabled={actionBusy === "trigger_refund"} onClick={() => void runAction("trigger_refund")}>{actionBusy === "trigger_refund" ? "Working..." : "Trigger refund"}</Button>
        ) : null}
        {["failed", "rejected"].includes(refundStatus) ? (
          <Button variant="outline" disabled={actionBusy === "retry_refund"} onClick={() => void runAction("retry_refund")}>{actionBusy === "retry_refund" ? "Working..." : "Retry refund"}</Button>
        ) : null}

        <Button
          variant="outline"
          onClick={() => void handleDownloadInvoice()}
          disabled={!isOrderAccepted || downloadingInvoice}
          title={!isOrderAccepted ? "Available after order is accepted" : "Download Ziply5 invoice"}
        >
          {downloadingInvoice ? <Loader2 className="mr-1.5 h-4 w-4 animate-spin" /> : <Download className="mr-1.5 h-4 w-4" />}
          Ziply5 invoice
        </Button>

        {order?.status !== "cancelled" && lifecycleStatus !== "cancelled" ? (
          <Button
            className="border border-red-300 bg-white text-red-600 hover:bg-red-50"
            onClick={() => setShowCancelModal(true)}
            disabled={!isOrderAccepted || actionBusy === "admin_cancel" || orderShipped}
            title={!isOrderAccepted ? "Available after order is accepted" : "Cancel order"}
          >
            <Ban className="mr-1.5 h-4 w-4" />
            Cancel order
          </Button>
        ) : null}
      </div>

      {error ? <p className="rounded-lg bg-red-50 px-3 py-2 text-sm text-red-800">{error}</p> : null}

      {loading ? (
        <p className="text-sm text-[#646464]">Loading order details…</p>
      ) : order ? (
        <div className="space-y-4">
          {lifecycleStatus === "rejected" ? (
            <div className="rounded-xl border border-red-200 bg-red-50 p-4">
              <p className="text-sm font-bold text-red-800">Order Rejected</p>
              <p className="mt-1 text-xs text-red-700">
                {order.statusHistory?.find((h) => (h.reasonCode ?? "").toLowerCase() === "admin_rejected" || (h.toStatus ?? "").toLowerCase() === "rejected")?.notes
                  || "This order was rejected by an administrator."}
              </p>
            </div>
          ) : null}

          <div className="grid items-start gap-4 xl:grid-cols-[minmax(0,1.7fr)_minmax(300px,0.85fr)]">
            <div className="space-y-4">
            <div className="grid items-stretch gap-4 md:grid-cols-2">
            <div className="flex h-full flex-col rounded-xl border border-[#E5E7EB] bg-white p-4 shadow-sm">
              <div className="mb-3 flex items-center justify-between">
                <h2 className="text-sm font-semibold text-[#111827]">Payment summary</h2>
                <span className={`rounded-full px-2 py-0.5 text-[11px] font-semibold ${String(order.paymentStatus).toLowerCase() === "paid" ? "bg-green-50 text-green-700" : "bg-amber-50 text-amber-700"}`}>
                  {order.paymentStatus ?? "Pending"}
                </span>
              </div>
              <div className="space-y-2 text-sm text-[#374151]">
                <div className="flex items-center justify-between gap-3">
                  <span className="text-[#6B7280]">Payment method</span>
                  <span className="font-medium capitalize">{(order.paymentMethod || "—").replaceAll("_", " ")}</span>
                </div>
                <div className="flex items-center justify-between gap-3">
                  <span className="text-[#6B7280]">Transaction ID</span>
                  <span className="max-w-[180px] truncate font-mono text-xs" title={order.paymentId ?? ""}>{order.paymentId || "—"}</span>
                </div>
                <div className="flex items-center justify-between gap-3">
                  <span className="text-[#6B7280]">Payment date</span>
                  <span>{order.transactions?.[0]?.createdAt ? formatOrderDateTime(order.transactions[0].createdAt) : "—"}</span>
                </div>
                <div className="flex items-center justify-between gap-3">
                  <span className="text-[#6B7280]">Amount paid</span>
                  <span className="text-base font-semibold text-[#111827]">{formatInr(Number(order.total))}</span>
                </div>
              </div>
            </div>

            <div className="flex h-full flex-col rounded-xl border border-[#E5E7EB] bg-white p-4 shadow-sm">
              <h2 className="mb-3 text-sm font-semibold text-[#111827]">Customer details</h2>
              <div className="flex items-start gap-3">
                <span className="flex h-10 w-10 shrink-0 items-center justify-center rounded-full bg-[#ECFDF3] text-sm font-semibold text-[#166534]">
                  {initials(order.customerName ?? order.user?.name)}
                </span>
                <div className="min-w-0 space-y-1 text-sm">
                  <p className="font-semibold text-[#111827]">{order.customerName ?? order.user?.name ?? "Guest customer"}</p>
                  <p className="flex items-center gap-1.5 text-[#4B5563]"><Mail className="h-3.5 w-3.5" />{order.customerEmail ?? order.user?.email ?? "No email"}</p>
                  <p className="flex items-center gap-1.5 text-[#4B5563]"><Phone className="h-3.5 w-3.5" />{order.customerPhone ?? "No phone"}</p>
                </div>
              </div>
              <div className="mt-4 border-t border-[#F3F4F6] pt-3">
                <p className="mb-1 flex items-center gap-1.5 text-xs font-semibold uppercase tracking-wide text-[#6B7280]">
                  <MapPin className="h-3.5 w-3.5" /> Shipping address
                </p>
                <p className="text-sm leading-relaxed text-[#111827]">{order.customerName ?? order.user?.name ?? "Customer"}</p>
                <p className="text-sm leading-relaxed text-[#4B5563]">{order.customerAddress ?? "No shipping address saved"}</p>
              </div>
            </div>
            </div>

            <div className="rounded-xl border border-[#E5E7EB] bg-white p-4 shadow-sm">
              <h2 className="mb-3 text-sm font-semibold text-[#111827]">Product details ({order.items?.length ?? 0} items)</h2>
              {(order.items ?? []).length === 0 ? (
                <p className="text-sm text-[#6B7280]">No items in this order.</p>
              ) : (
                <div className="overflow-x-auto">
                  <table className="w-full min-w-[720px] text-left text-sm">
                    <thead>
                      <tr className="border-b border-[#E5E7EB] text-xs text-[#6B7280]">
                        <th className="py-2 pr-3 font-medium">Product</th>
                        <th className="py-2 pr-3 font-medium">SKU code</th>
                        <th className="py-2 pr-3 font-medium">HSN Code</th>
                        <th className="py-2 pr-3 font-medium">Price</th>
                        <th className="py-2 pr-3 font-medium">Quantity</th>
                        <th className="py-2 font-medium">Total</th>
                      </tr>
                    </thead>
                    <tbody>
                      {(order.items ?? []).map((item, idx) => {
                        const productName = item.product?.name ?? "Deleted product"
                        const weightLabel = item.variant?.weight || item.product?.weight || ""
                        const variantName = item.variant?.name && item.variant.name !== weightLabel ? item.variant.name : ""
                        const subtitle = [variantName, weightLabel].filter(Boolean).join(" | ")
                        const sku = item.sku || item.variant?.sku || item.product?.sku || "—"
                        const hsn = item.variant?.hsnCode || "—"
                        const qty = Number(item.quantity || 0)
                        const total = Number(item.lineTotal ?? 0)
                        const unit = qty > 0 ? total / qty : Number(item.unitPrice ?? 0)
                        return (
                          <tr key={item.id ?? `${item.productId ?? "item"}-${idx}`} className="border-b border-[#F3F4F6] last:border-0">
                            <td className="py-3 pr-3">
                              <div className="flex items-center gap-3">
                                {item.product?.thumbnail ? (
                                  <img src={item.product.thumbnail} alt="" className="h-10 w-10 rounded-md border border-[#E5E7EB] object-cover" />
                                ) : (
                                  <span className="flex h-10 w-10 items-center justify-center rounded-md border border-[#E5E7EB] bg-[#F9FAFB] text-[#9CA3AF]">
                                    <Package className="h-4 w-4" />
                                  </span>
                                )}
                                <div>
                                  <p className="font-medium text-[#111827]">{productName}</p>
                                  {subtitle ? <p className="text-xs text-[#6B7280]">{subtitle}</p> : null}
                                </div>
                              </div>
                            </td>
                            <td className="py-3 pr-3 text-[#374151]">{sku}</td>
                            <td className="py-3 pr-3 text-[#374151]">{hsn}</td>
                            <td className="py-3 pr-3 text-[#111827]">{formatInr(unit)}</td>
                            <td className="py-3 pr-3 text-[#111827]">{qty}</td>
                            <td className="py-3 font-medium text-[#111827]">{formatInr(total || unit * qty)}</td>
                          </tr>
                        )
                      })}
                    </tbody>
                  </table>
                </div>
              )}
              <div className="mt-4 flex justify-end">
                <div className="w-full max-w-xs space-y-2 text-sm text-[#374151]">
                  <div className="flex items-center justify-between gap-6">
                    <span>Subtotal ({order.items?.length ?? 0} items)</span>
                    <span>{formatInr(Number(order.subtotal))}</span>
                  </div>
                  <div className="flex items-center justify-between gap-6">
                    <span>Shipping charge</span>
                    <span>{formatInr(Number(order.shipping))}</span>
                  </div>
                  <div className="flex items-center justify-between gap-6 text-green-700">
                    <span>Discount{order.couponCode ? ` (${order.couponCode})` : ""}</span>
                    <span>- {formatInr(Number(order.discount ?? 0))}</span>
                  </div>
                  <div className="flex items-center justify-between gap-6">
                    <span>Tax</span>
                    <span>{formatInr(Number(order.tax ?? 0))}</span>
                  </div>
                  <div className="flex items-center justify-between gap-6 border-t border-[#E5E7EB] pt-2 text-base font-semibold text-[#111827]">
                    <span>Total amount</span>
                    <span>{formatInr(Number(order.total))}</span>
                  </div>
                </div>
              </div>
            </div>
            </div>

            <div className="space-y-4">
            <div className="rounded-xl border border-[#E5E7EB] bg-white p-4 shadow-sm">
              {(() => {
                const activeShipment = (order.shipments ?? []).find((shipment) => String(shipment.shipmentStatus ?? "").toLowerCase() !== "cancelled" && !shipment.cancelledAt) ?? null
                const courier = order.courierName || activeShipment?.courierName || activeShipment?.carrier || null
                const trackingNumber = order.awbCode || order.trackingNumber || activeShipment?.awbCode || activeShipment?.trackingNo || null
                const trackingUrl = order.trackingUrl || activeShipment?.trackingUrl || null
                const linkedShipment = Boolean(activeShipment)
                const pickupStatusText = order.pickupStatus || activeShipment?.pickupStatus || activeShipment?.shipmentStatus || order.shipmentStatus || ""
                const pickupDone = Boolean(order.isPickupGenerated) && isConfirmedPickupRequest(pickupStatusText)
                const buttonClass = "cursor-pointer rounded-lg border border-[#7B3010] bg-[#FFF7ED] px-2.5 py-1.5 text-[11px] font-semibold text-[#7B3010] shadow-sm transition hover:bg-[#7B3010] hover:text-white disabled:cursor-not-allowed disabled:opacity-40 disabled:hover:bg-[#FFF7ED] disabled:hover:text-[#7B3010]"
                return (
                  <>
                    <div className="mb-3 flex flex-wrap items-center justify-between gap-2">
                      <h2 className="text-sm font-semibold text-[#111827]">Delivery details</h2>
                      <div className="flex items-center gap-1.5">
                        <span className="text-xs text-[#6B7280]">Shipment Status:</span>
                        <select
                          value={shipmentState || "not_shipped"}
                          disabled={updatingStatus !== null || shipmentState === "cancelled"}
                          onChange={(e) => void handleUpdateShipmentStatus(e.target.value)}
                          className="cursor-pointer rounded-lg border border-[#16803C]/30 bg-[#F0FDF4] px-2.5 py-1 text-xs font-semibold text-[#16803C] shadow-sm hover:border-[#16803C] focus:outline-none focus:ring-1 focus:ring-[#16803C] disabled:cursor-not-allowed disabled:opacity-50"
                          title="Manually Change Shipment Status"
                        >
                          {getForwardShipmentStatusOptions(shipmentState || "not_shipped").map((val) => (
                            <option key={val} value={val}>
                              {orderStatusLabel(val)}
                            </option>
                          ))}
                        </select>
                        {updatingStatus === "shipment" && <Loader2 className="h-3.5 w-3.5 animate-spin text-[#16803C]" />}
                      </div>
                    </div>
                    <div className="flex flex-wrap gap-2">
                      {shipmentState === "cancelled" ? null : (
                        <>
                          <button type="button" disabled={Boolean(shiprocketBusy)} onClick={() => void runShiprocketAction("serviceability")} className={buttonClass}>{busy("serviceability") ? "Checking..." : "Check Serviceability"}</button>
                          {(linkedShipment || serviceable) && (
                            <button type="button" disabled={Boolean(shiprocketBusy)} onClick={() => void runShiprocketAction("sync_order")} className={buttonClass}>
                              {busy("sync_order") ? (linkedShipment ? "Refreshing..." : "Syncing...") : (linkedShipment ? "Refresh" : "Sync")}
                            </button>
                          )}
                          {!linkedShipment && serviceable === false && Boolean(serviceabilitySummary) && (
                            <button type="button" onClick={() => setManualModal({ courier: "", trackingId: "", trackingUrl: "" })} className={buttonClass}>
                              Manual shipment
                            </button>
                          )}
                        </>
                      )}
                    </div>
                    {serviceabilitySummary ? <p className="mt-2 text-xs text-[#6B7280]">{serviceabilitySummary}</p> : null}
                    <div className="mt-3">
                      <TrackingTimeline
                        orderStatus={lifecycleStatus}
                        shipmentStatus={pickupDone ? (order.pickupStatus || activeShipment?.pickupStatus || "pickup_generated") : (activeShipment?.shipmentStatus ?? order.shipmentStatus ?? null)}
                        statusHistory={order.statusHistory}
                      />
                    </div>
                    <div className="mt-4 space-y-3 border-t border-[#F3F4F6] pt-3 text-sm">
                      <div className="flex items-start justify-between gap-3">
                        <span className="text-[#6B7280]">Delivery method</span>
                        <span className="inline-flex items-center gap-1.5 font-medium text-[#111827]">
                          <Truck className="h-4 w-4 text-[#166534]" />
                          {courier || "Not assigned"}
                        </span>
                      </div>
                      <div className="flex items-start justify-between gap-3">
                        <span className="text-[#6B7280]">Estimated delivery</span>
                        <span className="font-medium text-[#111827]">{order.estimatedDeliveryDate ? new Date(order.estimatedDeliveryDate).toLocaleDateString("en-IN", { day: "2-digit", month: "short", year: "numeric" }) : "Not scheduled"}</span>
                      </div>
                      <div className="flex items-start justify-between gap-3">
                        <span className="text-[#6B7280]">Tracking number</span>
                        <span className="font-medium text-[#111827]">{trackingNumber || "Not yet shipped"}</span>
                      </div>
                      <div className="flex items-start justify-between gap-3">
                        <span className="text-[#6B7280]">Tracking link</span>
                        {trackingUrl ? (
                          <a href={trackingUrl} target="_blank" rel="noopener noreferrer" className="cursor-pointer font-medium text-[#166534] hover:underline">Open tracking</a>
                        ) : (
                          <span className="text-[#111827]">—</span>
                        )}
                      </div>
                      <div className="flex items-start justify-between gap-3">
                        <span className="text-[#6B7280]">Shipment</span>
                        <span className="font-medium text-[#111827]">{activeShipment?.shipmentNo || activeShipment?.id || "Not created"}</span>
                      </div>
                    </div>
                  </>
                )
              })()}
            </div>
            <div className="rounded-xl border border-[#E5E7EB] bg-white p-4 shadow-sm">
              <h2 className="mb-3 text-sm font-semibold text-[#111827]">Notes</h2>
              <textarea value={note} onChange={(e) => setNote(e.target.value)} rows={3} placeholder="Write order notes..." className="w-full rounded-lg border border-[#E5E7EB] px-3 py-2 text-sm focus:border-[#166534] focus:outline-none" />
              <button type="button" onClick={() => void addNote()} disabled={!note.trim() || savingNote} className="mt-2 rounded-lg bg-[#166534] px-3 py-1.5 text-xs font-semibold text-white disabled:opacity-40">
                {savingNote ? "Saving..." : "Add note"}
              </button>
              <div className="mt-3 space-y-2">
                {(order.notes ?? []).length === 0 ? <p className="text-sm text-[#6B7280]">No notes added yet.</p> : (order.notes ?? []).map((entry) => (
                  <div key={entry.id} className="rounded-lg border border-[#F3F4F6] px-3 py-2">
                    <p className="text-sm text-[#111827]">{entry.note}</p>
                    <p className="mt-1 text-xs text-[#6B7280]">{formatOrderDateTime(entry.createdAt)}</p>
                  </div>
                ))}
              </div>
            </div>
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

      {manualModal && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4">
          <div className="w-full max-w-md rounded-2xl border border-[#E8DCC8] bg-white p-6 shadow-xl space-y-4">
            <h2 className="text-lg font-bold text-[#4A1D1F]">Manual shipment</h2>
            <label className="block text-xs font-semibold text-[#4A1D1F]">
              Courier
              <input
                value={manualModal.courier}
                onChange={(e) => setManualModal({ ...manualModal, courier: e.target.value })}
                placeholder="e.g. DTDC, BlueDart, Delhivery"
                className="mt-1 w-full rounded-lg border border-[#E8DCC8] px-3 py-2 text-sm focus:border-[#7B3010] focus:outline-none"
              />
            </label>
            <label className="block text-xs font-semibold text-[#4A1D1F]">
              Tracking id
              <input
                value={manualModal.trackingId}
                onChange={(e) => setManualModal({ ...manualModal, trackingId: e.target.value })}
                placeholder="e.g. TRK12345678"
                className="mt-1 w-full rounded-lg border border-[#E8DCC8] px-3 py-2 text-sm focus:border-[#7B3010] focus:outline-none"
              />
            </label>
            <label className="block text-xs font-semibold text-[#4A1D1F]">
              Tracking URL
              <input
                value={manualModal.trackingUrl}
                onChange={(e) => setManualModal({ ...manualModal, trackingUrl: e.target.value })}
                placeholder="https://..."
                className="mt-1 w-full rounded-lg border border-[#E8DCC8] px-3 py-2 text-sm focus:border-[#7B3010] focus:outline-none"
              />
            </label>
            <div className="flex justify-end gap-2 pt-2">
              <Button variant="outline" onClick={() => setManualModal(null)} disabled={savingManual}>
                Cancel
              </Button>
              <Button className="bg-[#7B3010] text-white hover:bg-[#5E230B] font-semibold" onClick={() => void saveManualShipment()} disabled={savingManual}>
                {savingManual ? (
                  <>
                    <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                    Saving...
                  </>
                ) : (
                  "Save shipment"
                )}
              </Button>
            </div>
          </div>
        </div>
      )}
    </section>
  )
}
