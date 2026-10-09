/**
 * Shared rules for whether a customer may cancel before Shiprocket / local cancel.
 * Uses shipment + shipping + current status strings from DB or tracking DTOs.
 */

const normalize = (value?: string | null) =>
  (value ?? "")
    .toLowerCase()
    .replace(/[\s-]+/g, "_")
    .trim()

const containsBlockedShipmentPhase = (haystack: string) => {
  if (!haystack) return false
  if (haystack.includes("unshipped") || haystack.includes("not_shipped")) return false
  if (haystack.includes("ready_to_ship") && !haystack.includes("picked")) return false

  const blocked = [
    "picked_up",
    "pickedup",
    "pickup_done",
    "in_transit",
    "intransit",
    "out_for_delivery",
    "outfordelivery",
    "ofd",
    "shipped",
    "dispatched",
    "delivered",
    "handover",
    "handed_over",
    "rto",
  ]
  return blocked.some((token) => haystack.includes(token))
}

/** True when shipment pipeline has progressed past customer-cancel window. */
export const doesShipmentStatusBlockCustomerCancel = (
  shipmentStatus?: string | null,
  shippingStatus?: string | null,
  currentStatus?: string | null,
) => {
  const haystack = [normalize(shipmentStatus), normalize(shippingStatus), normalize(currentStatus)].filter(Boolean).join("_")
  return containsBlockedShipmentPhase(haystack)
}

/** Matches server checks for customer-initiated cancel (cancel_request / cancel_pending). */
export const CUSTOMER_CANCEL_ALLOWED_LIFECYCLES = new Set([
  "pending",
  "pending_payment",
  "payment_success",
  "admin_approval_pending",
  "confirmed",
  "packed",
])

export const deriveLatestLifecycleToStatus = (
  statusHistory: Array<{ toStatus: string; reasonCode?: string | null }> | undefined | null,
  fallbackOrderStatus: string,
) => {
  const rawStatus = String(statusHistory?.[0]?.toStatus ?? fallbackOrderStatus).toLowerCase()
  const reasonCode = String(statusHistory?.[0]?.reasonCode ?? "").toLowerCase()
  const isRejected =
    rawStatus === "rejected" ||
    reasonCode === "admin_rejected" ||
    Boolean(statusHistory?.some((h) => String(h.reasonCode ?? "").toLowerCase() === "admin_rejected" || String(h.toStatus ?? "").toLowerCase() === "rejected"))
  if (isRejected) return "rejected"
  return rawStatus
}

export const orderHistoryHasCancelRequested = (statusHistory: Array<{ toStatus: string }> | undefined | null) =>
  Boolean(statusHistory?.some((e) => String(e.toStatus).toLowerCase() === "cancel_requested"))

export const shouldRenderCustomerCancelOrderButton = (input: {
  latestLifecycle: string
  shipmentStatus?: string | null
  shippingStatus?: string | null
  orderStatusLower: string
  cancelRequested: boolean
}) => {
  if (input.orderStatusLower === "cancelled") return false
  if (input.cancelRequested) return false
  if (doesShipmentStatusBlockCustomerCancel(input.shipmentStatus, input.shippingStatus, null)) return false
  return CUSTOMER_CANCEL_ALLOWED_LIFECYCLES.has(input.latestLifecycle)
}
