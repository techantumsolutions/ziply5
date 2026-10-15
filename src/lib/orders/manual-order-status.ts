export const MANUAL_ORDER_STATUSES = [
  "confirmed",
  "packed",
  "shipped",
  "in_transit",
  "out_for_delivery",
  "delivered",
] as const

export type ManualOrderStatus = (typeof MANUAL_ORDER_STATUSES)[number]

export const MANUAL_ORDER_STATUS_LABELS: Record<ManualOrderStatus, string> = {
  confirmed: "Accepted",
  packed: "Packed",
  shipped: "Shipped",
  in_transit: "In Transit",
  out_for_delivery: "Out for delivery",
  delivered: "Delivered",
}

export const orderStatusLabel = (status: string) => {
  const key = status.toLowerCase()
  if (key in MANUAL_ORDER_STATUS_LABELS) return MANUAL_ORDER_STATUS_LABELS[key as ManualOrderStatus]
  return key.replaceAll("_", " ").replace(/\b\w/g, (char) => char.toUpperCase())
}

export const isManualShipment = (input: { shipmentNo?: string | null; shippingMethod?: string | null }) => {
  if (String(input.shippingMethod ?? "").toLowerCase() === "manual") return true
  return String(input.shipmentNo ?? "").toLowerCase().startsWith("manual-")
}

/** Forward steps from the current lifecycle status to the admin's chosen status. */
export const manualOrderStatusSteps = (from: string, to: string) => {
  const start = MANUAL_ORDER_STATUSES.indexOf(from as ManualOrderStatus)
  const end = MANUAL_ORDER_STATUSES.indexOf(to as ManualOrderStatus)
  if (start < 0) throw new Error("This order cannot be updated from its current status")
  if (end < 0) throw new Error("Choose accepted, packed, shipped, in transit, out for delivery, or delivered")
  if (end < start) throw new Error("Order status cannot move backward")
  return MANUAL_ORDER_STATUSES.slice(start + 1, end + 1)
}
