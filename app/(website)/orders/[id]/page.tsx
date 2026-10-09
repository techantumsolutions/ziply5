"use client"

import { FormEvent, useEffect, useMemo, useState } from "react"
import { useParams, useRouter } from "next/navigation"
import { useQueryClient, useMutation } from "@tanstack/react-query"
import { useRealtimeTables } from "@/hooks/useRealtimeTables"
import { useMasterValues } from "@/hooks/useMasterData"
import { Camera, X } from "lucide-react"
import { toast } from "@/lib/toast"
import { generateInvoicePDF } from "@/lib/invoice"
import { useOrderWithTracking } from "@/hooks/useOrderWithTracking"
import {
  deriveLatestLifecycleToStatus,
  orderHistoryHasCancelRequested,
  shouldRenderCustomerCancelOrderButton,
} from "@/src/lib/orders/order-cancel-policy"
import { getReturnIneligibilityReason } from "@/src/lib/returns/return-eligibility"
import { OrderShipmentPanel } from "@/src/components/shipping/order-shipment-panel"
import { OrderStatusHistoryCard } from "@/src/components/orders/order-status-history-card"
import { OrderSummaryHeroCard } from "@/src/components/orders/order-summary-hero-card"
import { OrderHelpFooter } from "@/src/components/orders/order-help-footer"

const FALLBACK_TIMELINE = [
  "pending_payment",
  "payment_success",
  "admin_approval_pending",
  "confirmed",
  "packed",
  "shipped",
  "delivered",
  "return_requested",
  "refund_initiated",
  "returned",
] as const
const CUSTOMER_RETURN_WINDOW_DAYS = 7

const FALLBACK_RETURN_REASONS = [
  "Damaged",
  "Wrong item",
  "Quality issue",
  "Late delivery",
  "Customer remorse",
  "Other",
] as const

export default function OrderDetailPage() {
  const params = useParams() as { id?: string }
  const router = useRouter()
  const queryClient = useQueryClient()
  const statusMasterQuery = useMasterValues("ORDER_STATUS")
  const returnReasonMasterQuery = useMasterValues("RETURN_REASONS")
  const timeline = statusMasterQuery.data?.map((item) => item.value) ?? FALLBACK_TIMELINE
  const returnReasons = returnReasonMasterQuery.data ?? []

  const { orderQuery, trackingQuery, refreshTrackingMutation } = useOrderWithTracking(params.id)

  const [isReturnModalOpen, setIsReturnModalOpen] = useState(false)
  const [selectedItemsForReturn, setSelectedItemsForReturn] = useState<Record<string, {
    selected: boolean;
    productId: string;
    reasonCode: string;
    notes: string;
    imageUrl: string;
    quantity: number;
    uploading: boolean;
  }>>({})

  const [returnMeta, setReturnMeta] = useState({
    returnType: "refund" as "refund" | "exchange",
    description: "",
    videoUrl: "",
    refundMethod: "" as "" | "upi" | "bank",
    upiId: "",
    bankAccountName: "",
    bankAccountNumber: "",
    bankIfsc: "",
    bankName: "",
  })

  const [actionBusy, setActionBusy] = useState<string | null>(null)
  const [reviewDrafts, setReviewDrafts] = useState<Record<string, { rating: number; content: string }>>({})
  const [existingReviewedProducts, setExistingReviewedProducts] = useState<Set<string>>(new Set())
  const [isCancelModalOpen, setIsCancelModalOpen] = useState(false)
  const [reviewBusyByProduct, setReviewBusyByProduct] = useState<Record<string, boolean>>({})

  const openReturnModal = () => {
    if (!order) return
    const initialItems: typeof selectedItemsForReturn = {}
    const selectableItems = order.items.filter((item) => !returnedProductIds.has(String(item.productId ?? "").trim()))
    const autoSelect = selectableItems.length === 1
    order.items.forEach(item => {
      const blocked = returnedProductIds.has(String(item.productId ?? "").trim())
      initialItems[item.id] = {
        selected: !blocked && autoSelect,
        productId: item.productId || "",
        reasonCode: "",
        notes: "",
        imageUrl: "",
        quantity: item.quantity,
        uploading: false,
      }
    })
    setSelectedItemsForReturn(initialItems)
    setReturnMeta({
      returnType: "refund",
      description: "",
      videoUrl: "",
      refundMethod: "",
      upiId: "",
      bankAccountName: "",
      bankAccountNumber: "",
      bankIfsc: "",
      bankName: "",
    })
    setIsReturnModalOpen(true)
  }

  const handleImageUpload = async (orderItemId: string, file: File) => {
    setSelectedItemsForReturn(prev => ({
      ...prev,
      [orderItemId]: { ...prev[orderItemId], uploading: true }
    }))
    try {
      const formData = new FormData()
      formData.append("file", file)
      const token = window.localStorage.getItem("ziply5_access_token")
      const res = await fetch("/api/v1/uploads", {
        method: "POST",
        headers: { Authorization: `Bearer ${token}` },
        body: formData
      })
      const payload = await res.json()
      if (!res.ok || !payload.success) throw new Error(payload.message || "Upload failed")

      setSelectedItemsForReturn(prev => ({
        ...prev,
        [orderItemId]: { ...prev[orderItemId], imageUrl: payload.data.url, uploading: false }
      }))
    } catch (error) {
      toast.error("Upload Failed", error instanceof Error ? error.message : "Failed to upload image")
      setSelectedItemsForReturn(prev => ({
        ...prev,
        [orderItemId]: { ...prev[orderItemId], uploading: false }
      }))
    }
  }

  const submitReturnRequest = async () => {
    if (!order) return

    const latestLifecycle = deriveLatestLifecycleToStatus(order.statusHistory, order.status)
    const deliveredAt = order.deliveredAt
      ? new Date(order.deliveredAt)
      : order.shipmentDeliveredAt
        ? new Date(order.shipmentDeliveredAt as string | Date)
        : (() => {
          const hit = order.statusHistory.find((h) => h.toStatus.toLowerCase() === "delivered")
          return hit?.changedAt ? new Date(hit.changedAt) : null
        })()
    const ineligible = getReturnIneligibilityReason({
      orderStatus: order.status.toLowerCase(),
      latestLifecycle,
      deliveredAt,
      returnWindowDays: CUSTOMER_RETURN_WINDOW_DAYS,
    })
    if (ineligible === "not_delivered") {
      toast.error("Not eligible", "Returns are only available for delivered orders.")
      return
    }
    if (ineligible === "missing_delivered_at") {
      toast.error("Not eligible", "Delivery date is not available yet.")
      return
    }
    if (ineligible === "return_window_expired") {
      toast.error("Not eligible", `Return window is ${CUSTOMER_RETURN_WINDOW_DAYS} days after delivery.`)
      return
    }
    if (
      order.returnRequests?.some((req) =>
        !["rejected", "cancelled", "completed", "refunded"].includes(String(req.status ?? "").toLowerCase()),
      )
    ) {
      toast.error("Not eligible", "This order already has an active return request.")
      return
    }

    const itemsToReturn = Object.entries(selectedItemsForReturn)
      .filter(([_, data]) => data.selected && !returnedProductIds.has(String(data.productId ?? "").trim()))
      .map(([id, data]) => ({
        orderItemId: id,
        productId: data.productId,
        quantity: data.quantity,
        reasonCode: data.reasonCode,
        notes: data.notes,
        imageUrl: data.imageUrl,
      }))

    if (itemsToReturn.length === 0) {
      toast.error("Validation Error", "Please select at least one return-eligible item.")
      return
    }

    for (const item of itemsToReturn) {
      if (!item.reasonCode) {
        toast.error("Validation Error", "Please select a reason for all selected items.")
        return
      }
    }

    if (returnMeta.returnType === "refund" && String(order.paymentMethod ?? "").toLowerCase() === "cod") {
      const hasUpi = Boolean(returnMeta.upiId.trim())
      const hasBank = Boolean(returnMeta.bankAccountNumber.trim() && returnMeta.bankIfsc.trim())
      if (!hasUpi && !hasBank) {
        toast.error("Validation Error", "For COD refunds, enter a UPI ID or complete bank details.")
        return
      }
    }

    const token = window.localStorage.getItem("ziply5_access_token")
    if (!token) return
    setActionBusy("return_request")
    try {
      const bankDetails =
        returnMeta.refundMethod === "bank" && returnMeta.bankAccountNumber.trim()
          ? {
            accountName: returnMeta.bankAccountName.trim() || undefined,
            accountNumber: returnMeta.bankAccountNumber.trim(),
            ifsc: returnMeta.bankIfsc.trim(),
            bankName: returnMeta.bankName.trim() || undefined,
          }
          : undefined

      const res = await fetch(`/api/v1/returns`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${token}`,
        },
        body: JSON.stringify({
          orderId: order.id,
          items: itemsToReturn,
          description: returnMeta.description.trim() || undefined,
          videoUrl: returnMeta.videoUrl.trim() || undefined,
          returnType: returnMeta.returnType,
          refundMethod: returnMeta.refundMethod || undefined,
          upiId: returnMeta.upiId.trim() || undefined,
          bankDetails,
          headerImages: itemsToReturn.map((i) => i.imageUrl).filter(Boolean),
        }),
      })
      const payload = await res.json()
      if (!res.ok || !payload.success) throw new Error(payload.message || "Failed to submit return request")

      toast.success("Return Requested", "Your return request has been submitted successfully.")
      setIsReturnModalOpen(false)
      void queryClient.invalidateQueries({ queryKey: ["order-detail", params.id] })
      void queryClient.invalidateQueries({ queryKey: ["order-tracking", params.id] })
    } catch (error) {
      toast.error("Error", error instanceof Error ? error.message : "Failed to submit return request")
    } finally {
      setActionBusy(null)
    }
  }

  const statusActionMutation = useMutation({
    mutationFn: async (action: "cancel_request") => {
      if (!params.id) throw new Error("Order missing")
      const token = window.localStorage.getItem("ziply5_access_token")
      if (!token) throw new Error("Please login to continue.")
      const res = await fetch(`/api/v1/orders/${params.id}/actions`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${token}`,
        },
        body: JSON.stringify({ action }),
      })
      const payload = (await res.json()) as { success?: boolean; message?: string }
      if (!res.ok || payload.success === false) throw new Error(payload.message ?? "Request failed")
    },
    onSuccess: async () => {
      await queryClient.invalidateQueries({ queryKey: ["order-detail", params.id] })
      await queryClient.invalidateQueries({ queryKey: ["order-tracking", params.id] })
    },
  })

  useRealtimeTables({
    tables: ["orders", "returns", "refunds", "shipments"],
    onChange: () => {
      if (params.id) {
        void queryClient.invalidateQueries({ queryKey: ["order-detail", params.id] })
        void queryClient.invalidateQueries({ queryKey: ["order-tracking", params.id] })
      }
    },
  })

  const order = orderQuery.data
  const historySet = useMemo(() => new Set(order?.statusHistory.map((entry) => entry.toStatus.toLowerCase())), [order?.statusHistory])
  const returnedProductIds = useMemo(
    () =>
      new Set(
        (order?.returnRequests ?? [])
          .filter((req) => !["rejected", "cancelled", "completed", "refunded"].includes(String(req.status ?? "").toLowerCase()))
          .map((req) => String(req.productId ?? "").trim())
          .filter(Boolean),
      ),
    [order?.returnRequests],
  )
  const hasReturnableItems = useMemo(
    () => (order?.items ?? []).some((item) => !returnedProductIds.has(String(item.productId ?? "").trim())),
    [order?.items, returnedProductIds],
  )
  const returnExists = Boolean(order?.returnRequests?.length)
  const hasActiveOpenReturn = useMemo(
    () =>
      Boolean(
        order?.returnRequests?.some((req) =>
          !["rejected", "cancelled", "completed", "refunded"].includes(String(req.status ?? "").toLowerCase()),
        ),
      ),
    [order?.returnRequests],
  )
  const derivedDeliveredAt = useMemo(() => {
    if (!order) return null
    if (order.deliveredAt) return new Date(order.deliveredAt)
    const shipAt = order.shipmentDeliveredAt
    if (shipAt) return new Date(shipAt as string | Date)
    const hit = order.statusHistory.find((h) => h.toStatus.toLowerCase() === "delivered")
    return hit?.changedAt ? new Date(hit.changedAt) : null
  }, [order])
  const returnEligibilityReason = useMemo(() => {
    if (!order) return "no_order" as const
    if (hasActiveOpenReturn) return "active_return" as const
    const latest = deriveLatestLifecycleToStatus(order.statusHistory, order.status)
    return (
      getReturnIneligibilityReason({
        orderStatus: order.status.toLowerCase(),
        latestLifecycle: latest,
        deliveredAt: derivedDeliveredAt,
        returnWindowDays: CUSTOMER_RETURN_WINDOW_DAYS,
      }) ?? null
    )
  }, [order, derivedDeliveredAt, hasActiveOpenReturn])
  const cancelRequested = orderHistoryHasCancelRequested(order?.statusHistory)
  const latestLifecycle = useMemo(
    () => deriveLatestLifecycleToStatus(order?.statusHistory, order?.status ?? ""),
    [order?.statusHistory, order?.status],
  )
  const trackingShipment = trackingQuery.data?.shipment
  const canShowCustomerCancel = Boolean(
    order &&
    shouldRenderCustomerCancelOrderButton({
      latestLifecycle,
      shipmentStatus:
        trackingShipment?.shipmentStatus ??
        order.shipmentStatus ??
        order.shipments?.[0]?.shipmentStatus ??
        null,
      shippingStatus: trackingShipment?.shippingStatus ?? null,
      orderStatusLower: order.status.toLowerCase(),
      cancelRequested,
    }),
  )
  const returnRequested = historySet.has("return_requested")
  const paymentStatus =
    order?.paymentStatus ??
    (order?.transactions.some((tx) => tx.status === "paid") ? "paid" : "pending")

  const confirmCancelFromModal = async () => {
    setActionBusy("cancel_request")
    try {
      await statusActionMutation.mutateAsync("cancel_request")
      toast.success("Order cancelled", "Your order has been cancelled.")
      setIsCancelModalOpen(false)
    } catch (e) {
      toast.error("Cancellation failed", e instanceof Error ? e.message : "Request failed")
    } finally {
      setActionBusy(null)
    }
  }

  useEffect(() => {
    if (!order || order.status.toLowerCase() !== "delivered") return
    const userId = JSON.parse(window.localStorage.getItem("ziply5_user") || "{}")?.id as string | undefined
    const token = window.localStorage.getItem("ziply5_access_token")
    if (!token || !userId) return
    void (async () => {
      const res = await fetch(`/api/v1/reviews?orderId=${encodeURIComponent(order.id)}&userId=${encodeURIComponent(userId)}`, {
        headers: { Authorization: `Bearer ${token}` },
      })
      const payload = (await res.json()) as { success?: boolean; data?: Array<{ productId: string }> }
      if (!res.ok || !payload.success || !Array.isArray(payload.data)) return
      setExistingReviewedProducts(new Set(payload.data.map((x) => String(x.productId))))
    })()
  }, [order])

  const submitReview = async (productId: string, fallbackTitle: string) => {
    if (!order) return
    const userId = JSON.parse(window.localStorage.getItem("ziply5_user") || "{}")?.id as string | undefined
    const token = window.localStorage.getItem("ziply5_access_token")
    if (!token || !userId) throw new Error("Please login to submit review.")
    if (existingReviewedProducts.has(productId)) return
    const draft = reviewDrafts[productId] ?? { rating: 5, content: "" }
    if (!draft.rating || draft.rating < 1 || draft.rating > 5) throw new Error("Rating is required.")
    if (!draft.content.trim()) throw new Error("Review content is required.")
    setReviewBusyByProduct((prev) => ({ ...prev, [productId]: true }))
    try {
      const createRes = await fetch("/api/v1/reviews", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${token}`,
        },
        body: JSON.stringify({
          productId,
          orderId: order.id,
          userId,
          rating: draft.rating,
          content: draft.content.trim(),
          title: fallbackTitle,
          sortOrder: 0,
          status: "published",
        }),
      })
      const createPayload = (await createRes.json()) as { success?: boolean; message?: string }
      if (!createRes.ok || createPayload.success === false) throw new Error(createPayload.message ?? "Unable to submit review.")
      setExistingReviewedProducts((prev) => new Set([...prev, productId]))
    } finally {
      setReviewBusyByProduct((prev) => ({ ...prev, [productId]: false }))
    }
  }

  const downloadInvoice = async () => {
    if (!order) return
    const success = await generateInvoicePDF(order as any)
    if (success) {
      toast.success("Success", "Invoice downloaded as PDF")
    } else {
      toast.error("Error", "Failed to generate PDF invoice")
    }
  }

  return (
    <section className="mx-auto max-w-7xl space-y-4 px-4 py-6 print:px-2">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h1 className="text-2xl font-bold text-[#111827]">Order details</h1>
          <p className="mt-1 text-sm text-[#6B7280]">View your order, shipment tracking, and delivery updates in one place.</p>
        </div>
        <button
          type="button"
          onClick={() => router.back()}
          className="rounded-md border border-[#D1D5DB] bg-white px-3 py-1.5 text-xs font-medium text-[#111827] hover:bg-[#F9FAFB]"
        >
          Back
        </button>
      </div>

      {orderQuery.isLoading && <p className="text-sm text-[#6B7280]">Loading order details…</p>}
      {orderQuery.error && (
        <p className="text-sm text-red-600">{orderQuery.error instanceof Error ? orderQuery.error.message : "Failed to load order."}</p>
      )}

      {order && (
        <>
          <OrderSummaryHeroCard
            order={order}
            paymentStatus={paymentStatus}
            onDownloadInvoice={() => void downloadInvoice()}
            onSyncOrder={() => refreshTrackingMutation.mutate()}
            syncingOrder={refreshTrackingMutation.isPending}
            extraActions={
              <>
                {canShowCustomerCancel && (
                  <button
                    type="button"
                    onClick={() => setIsCancelModalOpen(true)}
                    disabled={actionBusy === "cancel_request"}
                    className="rounded-md border border-[#D1D5DB] bg-white px-3 py-1.5 text-xs font-medium text-[#111827] hover:bg-[#F9FAFB] disabled:opacity-40"
                  >
                    {actionBusy === "cancel_request" ? "Submitting…" : "Cancel"}
                  </button>
                )}
                {paymentStatus.toLowerCase() === "pending" &&
                  order.status.toLowerCase() !== "delivered" &&
                  order.status.toLowerCase() !== "cancelled" && (
                    <button
                      type="button"
                      onClick={() =>
                        router.push(
                          `/payment?orderId=${encodeURIComponent(order.id)}&amount=${encodeURIComponent(String(order.total ?? ""))}&name=${encodeURIComponent(order.customerName ?? "")}&phone=${encodeURIComponent(order.customerPhone ?? "")}&address=${encodeURIComponent(order.customerAddress ?? "")}`,
                        )
                      }
                      className="rounded-md bg-[#111827] px-3 py-1.5 text-xs font-medium text-white hover:bg-[#1f2937]"
                    >
                      Pay now
                    </button>
                  )}
              </>
            }
          />

          {(() => {
            const rejectedEntry = order.statusHistory?.find((h: any) => h.reasonCode === "admin_rejected" || h.toStatus?.toLowerCase() === "rejected")
            const isRejected = latestLifecycle === "rejected" || Boolean(rejectedEntry)
            if (isRejected) {
              const reasonText = (rejectedEntry as any)?.notes || ((order.statusHistory?.[0] as any)?.notes ?? "")
              return (
                <div className="rounded-xl border border-red-200 bg-red-50 p-4 text-center">
                  <p className="text-sm font-bold uppercase tracking-wide text-red-600">This order was rejected</p>
                  {reasonText ? <p className="mt-1 text-xs font-semibold text-red-700">Reason: {reasonText}</p> : null}
                  <p className="mt-1 text-xs text-red-500">Tracking information may no longer update.</p>
                </div>
              )
            }
            if (order.status.toLowerCase() === "cancelled" || latestLifecycle === "cancelled") {
              return (
                <div className="rounded-xl border border-red-200 bg-red-50 p-4 text-center">
                  <p className="text-sm font-bold uppercase tracking-wide text-red-600">This order has been cancelled</p>
                  <p className="mt-1 text-xs text-red-500">Tracking information may no longer update.</p>
                </div>
              )
            }
            return null
          })()}

          {/* <div className="rounded-xl border border-[#E5E7EB] bg-white p-4 shadow-sm">
            <h2 className="mb-3 text-sm font-semibold text-[#111827]">Order lifecycle</h2>
            <div className="grid gap-2 sm:grid-cols-2 md:grid-cols-3">
              {timeline.map((step) => {
                const reached = historySet.has(step) || order.status.toLowerCase() === step
                return (
                  <div key={step} className="rounded-lg border border-[#F3F4F6] bg-[#FAFAFA] px-3 py-2 text-xs uppercase">
                    <span className={reached ? "font-semibold text-[#111827]" : "text-[#6B7280]"}>{step}</span>
                  </div>
                )
              })}
            </div>
          </div> */}

          <div id="shipment-tracking" className="scroll-mt-20">
            <OrderShipmentPanel
              tracking={trackingQuery.data}
              isLoading={Boolean(orderQuery.data) && trackingQuery.isLoading}
              error={
                trackingQuery.error instanceof Error
                  ? trackingQuery.error
                  : trackingQuery.error
                    ? new Error("Tracking failed")
                    : null
              }
              orderLifecycleStatus={order.status}
              onRefreshFromShiprocket={async () => {
                await refreshTrackingMutation.mutateAsync()
              }}
            />
          </div>

          <OrderStatusHistoryCard statusHistory={order.statusHistory} />

          {(order.returnRequests?.length > 0 || order?.refunds?.length > 0) && (
            <div className="rounded-xl border border-[#E5E7EB] bg-white p-4 shadow-sm">
              <h2 className="mb-3 text-sm font-semibold text-[#111827]">Return / refund status</h2>
              <div className="space-y-3">
                {order.returnRequests.map((req) => (
                  <div key={req.id} className="rounded-lg border border-[#F3F4F6] bg-[#FAFAFA] p-3 text-sm text-[#6B7280]">
                    <p>
                      Return: <span className="font-semibold uppercase text-[#111827]">{req.status}</span>
                      {req.productId ? ` — Product ${req.productId.slice(0, 8)}…` : ""}
                    </p>
                    {req.reason ? <p className="mt-1 text-xs">Reason: {req.reason}</p> : null}
                    {req.description ? <p className="mt-1 text-xs">Details: {req.description}</p> : null}
                    {req.videoUrl ? (
                      <p className="mt-1 text-xs">
                        Video:{" "}
                        <a href={req.videoUrl} className="text-[#7B3010] underline" target="_blank" rel="noreferrer">
                          link
                        </a>
                      </p>
                    ) : null}
                    {req.returnType ? <p className="mt-1 text-xs uppercase">Type: {req.returnType}</p> : null}
                    {req.reverseAwb ? (
                      <div className="mt-2 space-y-1 text-xs">
                        <p>
                          Reverse AWB: <span className="font-mono text-[#111827]">{req.reverseAwb}</span>
                          {req.reverseCourier ? ` — ${req.reverseCourier}` : ""}
                        </p>
                        {req.reverseTrackingUrl ? (
                          <a href={req.reverseTrackingUrl} className="text-[#7B3010] underline" target="_blank" rel="noreferrer">
                            Track return shipment
                          </a>
                        ) : null}
                        <div>
                          <button
                            type="button"
                            className="mt-1 rounded-md border border-[#E5E7EB] px-2 py-1 text-[10px] font-semibold uppercase text-[#111827]"
                            onClick={() => {
                              void (async () => {
                                const t = window.localStorage.getItem("ziply5_access_token")
                                if (!t) return
                                const r = await fetch(`/api/v1/returns/${req.id}/reverse-tracking/refresh`, {
                                  method: "POST",
                                  headers: { Authorization: `Bearer ${t}` },
                                })
                                const p = await r.json()
                                if (!r.ok || !p.success) toast.error("Refresh failed", p.message ?? "Could not refresh return tracking")
                                else {
                                  toast.success("Updated", "Return tracking refreshed.")
                                  void queryClient.invalidateQueries({ queryKey: ["order-detail", params.id] })
                                }
                              })()
                            }}
                          >
                            Refresh return tracking
                          </button>
                        </div>
                      </div>
                    ) : null}
                    {req.rejectionReason ? <p className="mt-1 text-xs text-red-700">Rejected: {req.rejectionReason}</p> : null}
                  </div>
                ))}
                {order.refunds?.map((ref) => (
                  <p key={ref.id} className="text-sm text-[#6B7280]">
                    Refund: <span className="font-semibold uppercase text-[#111827]">{ref.status}</span> — {order.currency}{" "}
                    {Number(ref.amount).toFixed(2)}
                  </p>
                ))}
              </div>
            </div>
          )}

          <div className="grid gap-3 sm:grid-cols-2">
            <div className="rounded-xl border border-[#E5E7EB] bg-white p-4 text-sm shadow-sm">
              <p className="mb-2 font-semibold text-[#111827]">Shipping & contact</p>
              <p className="text-[#111827]">{order.customerName ?? "—"}</p>
              <p className="text-[#6B7280]">{order.customerAddress ?? "—"}</p>
              <p className="text-[#6B7280]">{order.customerPhone ?? "—"}</p>
              <p className="mt-2 text-[#6B7280]">{order.user?.email ?? "—"}</p>
            </div>
            <div className="rounded-xl border border-[#E5E7EB] bg-white p-4 text-sm shadow-sm">
              <p className="mb-2 font-semibold text-[#111827]">Payment Mode :  <span className="text-[#6B7280]">{(order.paymentMethod ?? "Not specified").toUpperCase()}</span> </p>
              {/* <p className="text-[#111827]">{(order.paymentMethod ?? "Not specified").toUpperCase()}</p> */}
              <p className="text-[#111827] font-semibold">
                Payment Status: <span className=" text-[#6B7280] uppercase">{paymentStatus}</span>
              </p>
              <p className="mt-2 font-semibold text-[#111827]">
                Total: <span className="text-[#6B7280]">{order.currency} {Number(order.total).toFixed(2)}</span>
              </p>
            </div>
          </div>

          <div className="rounded-xl border border-[#E8DCC8] bg-white p-4 shadow-sm">
            <h2 className="mb-3 text-sm font-semibold text-[#111827]">Items</h2>
            <div className="space-y-2">
              {order.items.map((item) => (
                <div key={item.id} className="rounded-lg border border-[#F2E6DD] bg-[#FFFBF7] p-3 text-sm text-[#646464]">
                  <p className="font-semibold text-[#2A1810]">{item.product?.name ?? "Product"}</p>
                  <p>Quantity: {item.quantity}</p>
                  <p>Price: {order.currency} {Number(item.unitPrice ?? 0).toFixed(2)}</p>
                  <p>Subtotal: {order.currency} {Number(item.lineTotal ?? Number(item.unitPrice ?? 0) * Number(item.quantity ?? 0)).toFixed(2)}</p>
                  {order.status.toLowerCase() === "delivered" && item.productId && (
                    <div className="mt-3 rounded-lg border border-[#E8DCC8] bg-white p-3">
                      {existingReviewedProducts.has(item.productId) ? (
                        <p className="text-xs font-semibold uppercase text-[#5A272A]">Already reviewed</p>
                      ) : (
                        <>
                          <div className="mb-2 flex items-center gap-1">
                            {[1, 2, 3, 4, 5].map((star) => {
                              const rating = reviewDrafts[item.productId!]?.rating ?? 5
                              return (
                                <button
                                  key={`${item.id}-star-${star}`}
                                  type="button"
                                  onClick={() =>
                                    setReviewDrafts((prev) => ({
                                      ...prev,
                                      [item.productId!]: { rating: star, content: prev[item.productId!]?.content ?? "" },
                                    }))
                                  }
                                  className={`text-lg ${star <= rating ? "text-[#F59E0B]" : "text-[#D1D5DB]"}`}
                                >
                                  ★
                                </button>
                              )
                            })}
                          </div>
                          <textarea
                            value={reviewDrafts[item.productId]?.content ?? ""}
                            onChange={(event) =>
                              setReviewDrafts((prev) => ({
                                ...prev,
                                [item.productId!]: { rating: prev[item.productId!]?.rating ?? 5, content: event.target.value },
                              }))
                            }
                            placeholder="Write your review"
                            className="w-full rounded-md border border-[#D9D9D1] px-2 py-1.5 text-xs"
                            rows={3}
                          />
                          <button
                            type="button"
                            onClick={() => void submitReview(item.productId!, item.product?.name ?? "Product")}
                            disabled={Boolean(reviewBusyByProduct[item.productId])}
                            className="mt-2 rounded-md bg-[#7B3010] px-3 py-1.5 text-xs font-semibold uppercase text-white disabled:opacity-50"
                          >
                            {reviewBusyByProduct[item.productId] ? "Submitting..." : "Submit Review"}
                          </button>
                        </>
                      )}
                    </div>
                  )}
                </div>
              ))}
            </div>
          </div>

          <div className="rounded-xl border border-[#E5E7EB] bg-white p-4 shadow-sm">
            <h2 className="mb-3 text-sm font-semibold text-[#111827]">Billing summary</h2>
            <div className="space-y-1 text-sm text-[#6B7280]">
              <p>
                Subtotal: <span className="font-semibold text-[#111827]">{order.currency} {Number(order.subtotal ?? 0).toFixed(2)}</span>
              </p>
              <p>
                Tax: <span className="font-semibold text-[#111827]">{order.currency} {Number(order.tax ?? 0).toFixed(2)}</span>
              </p>
              <p>
                Total Saving: <span className="font-semibold text-red-600">- {order.currency} {Number(order.savingAmount ?? 0).toFixed(2)}</span>
              </p>
              <p>
                Shipping: <span className="font-semibold text-[#111827]">{order.currency} {Number(order.shipping ?? 0).toFixed(2)}</span>
              </p>
              <p>
                Total: <span className="font-semibold text-[#111827]">{order.currency} {Number(order.total).toFixed(2)}</span>
              </p>
            </div>
          </div>

          {order.status.toLowerCase() === "delivered" && (
            <div className="rounded-xl border border-[#E5E7EB] bg-white p-4 shadow-sm space-y-2">
              {returnEligibilityReason === null && hasReturnableItems ? (
                <button
                  type="button"
                  onClick={openReturnModal}
                  className="rounded-md bg-[#111827] px-4 py-2 text-xs font-semibold uppercase text-white hover:bg-[#1f2937]"
                >
                  Request return
                </button>
              ) : returnEligibilityReason === "active_return" ? (
                <div className="space-y-1">
                  <p className="text-sm font-semibold uppercase text-[#111827]">Return in progress</p>
                  <p className="text-xs text-[#6B7280]">We already have an open return for this order.</p>
                </div>
              ) : returnEligibilityReason === "return_window_expired" ? (
                <p className="text-xs text-[#6B7280]">The {CUSTOMER_RETURN_WINDOW_DAYS}-day return window for this order has ended.</p>
              ) : !hasReturnableItems ? (
                <div className="space-y-1">
                  <p className="text-sm font-semibold uppercase text-[#111827]">Return processing</p>
                  <p className="text-xs text-[#6B7280]">All products in this order already have active return requests.</p>
                </div>
              ) : (
                <p className="text-xs text-[#6B7280]">Returns are not available for this order state.</p>
              )}
            </div>
          )}

          <OrderHelpFooter orderId={order.id} />
          {isReturnModalOpen && (
            <div className="fixed inset-0 z-[200] flex items-center justify-center bg-black/60 p-4 backdrop-blur-sm" onClick={() => setIsReturnModalOpen(false)}>
              <div className="w-full max-w-2xl max-h-[90vh] overflow-y-auto rounded-3xl bg-white shadow-2xl" onClick={(e) => e.stopPropagation()}>
                <div className="flex items-center justify-between bg-[#7B3010] p-5 text-white sticky top-0 z-10">
                  <h3 className="font-melon text-lg font-bold uppercase tracking-wider">Return Request</h3>
                  <button onClick={() => setIsReturnModalOpen(false)} className="rounded-full bg-white/20 p-1 hover:bg-white/30 transition-colors">
                    <X size={20} />
                  </button>
                </div>

                <div className="p-6 space-y-6">
                  <p className="text-sm text-gray-600">Select the items you wish to return and provide a reason and photo for each.</p>

                  <div className="grid gap-3 sm:grid-cols-2">
                    <div>
                      <label className="block text-[10px] font-bold text-gray-400 uppercase tracking-widest mb-1">Return type</label>
                      <select
                        value={returnMeta.returnType}
                        onChange={(e) =>
                          setReturnMeta((m) => ({ ...m, returnType: e.target.value as "refund" | "exchange" }))
                        }
                        className="w-full rounded-xl border border-gray-200 px-3 py-2 text-sm"
                      >
                        <option value="refund">Refund</option>
                        <option value="exchange">Exchange</option>
                      </select>
                    </div>
                    <div>
                      <label className="block text-[10px] font-bold text-gray-400 uppercase tracking-widest mb-1">Video URL (optional)</label>
                      <input
                        value={returnMeta.videoUrl}
                        onChange={(e) => setReturnMeta((m) => ({ ...m, videoUrl: e.target.value }))}
                        className="w-full rounded-xl border border-gray-200 px-3 py-2 text-sm"
                        placeholder="https://…"
                      />
                    </div>
                  </div>

                  <div>
                    <label className="block text-[10px] font-bold text-gray-400 uppercase tracking-widest mb-1">Overall description</label>
                    <textarea
                      rows={2}
                      value={returnMeta.description}
                      onChange={(e) => setReturnMeta((m) => ({ ...m, description: e.target.value }))}
                      className="w-full rounded-xl border border-gray-200 px-3 py-2 text-sm resize-none"
                      placeholder="Describe the issue across items…"
                    />
                  </div>

                  {returnMeta.returnType === "refund" && String(order.paymentMethod ?? "").toLowerCase() === "cod" && (
                    <div className="rounded-xl border border-amber-200 bg-amber-50 p-4 space-y-3">
                      <p className="text-xs font-semibold text-amber-900 uppercase">COD refund details</p>
                      <div className="grid gap-2 sm:grid-cols-2">
                        <div>
                          <label className="block text-[10px] font-bold text-gray-500 uppercase mb-1">Refund via</label>
                          <select
                            value={returnMeta.refundMethod}
                            onChange={(e) =>
                              setReturnMeta((m) => ({ ...m, refundMethod: e.target.value as "" | "upi" | "bank" }))
                            }
                            className="w-full rounded-lg border border-gray-200 px-2 py-2 text-sm"
                          >
                            <option value="">Select</option>
                            <option value="upi">UPI</option>
                            <option value="bank">Bank transfer</option>
                          </select>
                        </div>
                        {returnMeta.refundMethod === "upi" && (
                          <div>
                            <label className="block text-[10px] font-bold text-gray-500 uppercase mb-1">UPI ID</label>
                            <input
                              value={returnMeta.upiId}
                              onChange={(e) => setReturnMeta((m) => ({ ...m, upiId: e.target.value }))}
                              className="w-full rounded-lg border border-gray-200 px-2 py-2 text-sm"
                            />
                          </div>
                        )}
                      </div>
                      {returnMeta.refundMethod === "bank" && (
                        <div className="grid gap-2 sm:grid-cols-2">
                          <input
                            placeholder="Account holder"
                            value={returnMeta.bankAccountName}
                            onChange={(e) => setReturnMeta((m) => ({ ...m, bankAccountName: e.target.value }))}
                            className="rounded-lg border border-gray-200 px-2 py-2 text-sm"
                          />
                          <input
                            placeholder="Account number"
                            value={returnMeta.bankAccountNumber}
                            onChange={(e) => setReturnMeta((m) => ({ ...m, bankAccountNumber: e.target.value }))}
                            className="rounded-lg border border-gray-200 px-2 py-2 text-sm"
                          />
                          <input
                            placeholder="IFSC"
                            value={returnMeta.bankIfsc}
                            onChange={(e) => setReturnMeta((m) => ({ ...m, bankIfsc: e.target.value }))}
                            className="rounded-lg border border-gray-200 px-2 py-2 text-sm"
                          />
                          <input
                            placeholder="Bank name"
                            value={returnMeta.bankName}
                            onChange={(e) => setReturnMeta((m) => ({ ...m, bankName: e.target.value }))}
                            className="rounded-lg border border-gray-200 px-2 py-2 text-sm"
                          />
                        </div>
                      )}
                    </div>
                  )}

                  <div className="space-y-4">
                    {order.items.map((item) => {
                      const itemState = selectedItemsForReturn[item.id]
                      if (!itemState) return null

                      return (
                        <div key={item.id} className="border border-gray-200 rounded-xl p-4 space-y-4">
                          <div className="flex items-start gap-3">
                            <input
                              type="checkbox"
                              className="mt-1 w-4 h-4 text-[#7B3010]"
                              checked={itemState.selected}
                              onChange={(e) => setSelectedItemsForReturn(prev => ({
                                ...prev,
                                [item.id]: { ...prev[item.id], selected: e.target.checked }
                              }))}
                            />
                            <div>
                              <p className="text-sm font-semibold text-gray-900">{item.product?.name ?? "Product"}</p>
                              <p className="text-xs text-gray-500">Qty: {item.quantity}</p>
                              {returnedProductIds.has(String(item.productId ?? "").trim()) ? (
                                <p className="text-[11px] font-semibold text-amber-700">Return already requested for this product.</p>
                              ) : null}
                            </div>
                          </div>

                          {itemState.selected && !returnedProductIds.has(String(item.productId ?? "").trim()) && (
                            <div className="pl-7 space-y-3">
                              <div>
                                <label className="block text-[10px] font-bold text-gray-400 uppercase tracking-widest mb-1">Reason</label>
                                <select
                                  value={itemState.reasonCode}
                                  onChange={(e) => setSelectedItemsForReturn(prev => ({
                                    ...prev,
                                    [item.id]: { ...prev[item.id], reasonCode: e.target.value }
                                  }))}
                                  className="w-full rounded-xl border border-gray-200 px-3 py-2 text-sm focus:border-orange-500 focus:ring-1 outline-none"
                                >
                                  <option value="">Select a reason</option>
                                  {returnReasons.map(r => (
                                    <option key={r.id} value={r.value}>{r.label ?? r.value}</option>
                                  ))}
                                </select>
                              </div>

                              <div>
                                <label className="block text-[10px] font-bold text-gray-400 uppercase tracking-widest mb-1">Details / Issue</label>
                                <textarea
                                  rows={2}
                                  value={itemState.notes}
                                  onChange={(e) => setSelectedItemsForReturn(prev => ({
                                    ...prev,
                                    [item.id]: { ...prev[item.id], notes: e.target.value }
                                  }))}
                                  placeholder="Describe the issue..."
                                  className="w-full rounded-xl border border-gray-200 px-3 py-2 text-sm focus:border-orange-500 focus:ring-1 outline-none resize-none"
                                />
                              </div>

                              <div>
                                <label className="block text-[10px] font-bold text-gray-400 uppercase tracking-widest mb-1">Photo Evidence</label>
                                <div className="flex items-center gap-3">
                                  <label className="cursor-pointer flex items-center gap-2 rounded-lg border border-gray-300 px-3 py-2 text-xs font-medium text-gray-700 hover:bg-gray-50">
                                    <Camera size={14} />
                                    <span>{itemState.uploading ? "Uploading..." : "Upload Photo"}</span>
                                    <input
                                      type="file"
                                      accept="image/*"
                                      className="hidden"
                                      disabled={itemState.uploading}
                                      onChange={(e) => {
                                        if (e.target.files && e.target.files[0]) {
                                          void handleImageUpload(item.id, e.target.files[0])
                                        }
                                      }}
                                    />
                                  </label>
                                  {itemState.imageUrl && (
                                    <span className="text-xs text-green-600 font-medium">Image attached ✓</span>
                                  )}
                                </div>
                              </div>
                            </div>
                          )}
                        </div>
                      )
                    })}
                  </div>

                  <div className="flex gap-3 pt-4 border-t border-gray-100">
                    <button
                      type="button"
                      onClick={() => setIsReturnModalOpen(false)}
                      className="flex-1 rounded-xl border border-gray-200 py-3 text-xs font-bold uppercase tracking-widest text-gray-600 hover:bg-gray-50 transition-all"
                    >
                      Cancel
                    </button>
                    <button
                      type="button"
                      onClick={() => void submitReturnRequest()}
                      disabled={actionBusy === "return_request"}
                      className="flex-1 rounded-xl bg-[#7B3010] py-3 text-xs font-bold uppercase tracking-widest text-white shadow-md hover:opacity-90 disabled:opacity-50 transition-all"
                    >
                      {actionBusy === "return_request" ? "Submitting..." : "Submit Return Request"}
                    </button>
                  </div>
                </div>
              </div>
            </div>
          )}
          {isCancelModalOpen && (
            <div className="fixed inset-0 z-[200] flex items-center justify-center bg-black/60 p-4 backdrop-blur-sm" onClick={() => setIsCancelModalOpen(false)}>
              <div className="w-full max-w-md rounded-3xl bg-white shadow-2xl overflow-hidden" onClick={(e) => e.stopPropagation()}>
                <div className="bg-[#7B3010] p-5 text-white flex items-center justify-between">
                  <h3 className="font-melon text-lg font-bold uppercase tracking-wider">Confirm Cancellation</h3>
                  <button onClick={() => setIsCancelModalOpen(false)} className="rounded-full bg-white/20 p-1 hover:bg-white/30 transition-colors">
                    <X size={20} />
                  </button>
                </div>
                <div className="p-6">
                  <p className="text-gray-600 mb-6 text-center">Are you sure you want to cancel this order? This action cannot be undone.</p>
                  <div className="flex gap-3">
                    <button
                      type="button"
                      onClick={() => setIsCancelModalOpen(false)}
                      className="flex-1 rounded-xl border border-gray-200 py-3 text-xs font-bold uppercase tracking-widest text-gray-600 hover:bg-gray-50 transition-all"
                    >
                      Go Back
                    </button>
                    <button
                      type="button"
                      onClick={() => void confirmCancelFromModal()}
                      disabled={actionBusy === "cancel_request"}
                      className="flex-1 rounded-xl bg-red-600 py-3 text-xs font-bold uppercase tracking-widest text-white shadow-md hover:bg-red-700 disabled:opacity-50 transition-all"
                    >
                      {actionBusy === "cancel_request" ? "Processing..." : "Confirm Cancellation"}
                    </button>
                  </div>
                </div>
              </div>
            </div>
          )}
        </>
      )}
    </section>
  )
}
