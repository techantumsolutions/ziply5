/** Customer shipment progress steps (shared server + client). */
export const SHIPMENT_UI_STEPS = [
  { key: "confirmed", label: "Order Confirmed" },
  { key: "awb_assigned", label: "AWB Assigned" },
  { key: "picked_up", label: "Picked Up" },
  { key: "in_transit", label: "In Transit" },
  { key: "out_for_delivery", label: "Out For Delivery" },
  { key: "delivered", label: "Delivered" },
] as const

export type ShipmentUiStepKey = (typeof SHIPMENT_UI_STEPS)[number]["key"]

/** Index of highest completed step (0..5), or 0 for pre-shipment / confirmed */
export const resolveShipmentProgressIndex = (shipmentStatusRaw: string | null | undefined): number => {
  const s = String(shipmentStatusRaw ?? "").trim().toLowerCase().replace(/\s+/g, "_")
  if (!s) return 0
  if (s.includes("delivered")) return 5
  if (s.includes("out_for") || s.includes("ofd")) return 4
  if (s.includes("transit") || s.includes("in_transit") || s.includes("shipped") || s.includes("manifest")) return 3
  if (s.includes("picked") || s.includes("pickup")) return 2
  if (s.includes("awb") || s.includes("label")) return 1
  if (s.includes("new") || s.includes("processing") || s.includes("pending") || s.includes("confirmed") || s.includes("accepted")) return 0
  return 0
}
