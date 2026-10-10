const SHIPPED_STATES = ["shipped", "in_transit", "out_for_delivery", "dispatched", "delivered", "completed"]

export function orderProgressRank(status: string) {
  const value = status.toLowerCase()
  if (["delivered", "completed"].includes(value)) return 4
  if (["shipped", "in_transit", "out_for_delivery", "dispatched"].includes(value)) return 3
  if (["processing", "packed"].includes(value)) return 2
  if (["confirmed", "approved"].includes(value)) return 1
  return 0
}

export function isOrderShipped(order: {
  status?: string | null
  shipmentStatus?: string | null
  statusHistory?: Array<{ toStatus?: string | null }> | null
  shipments?: Array<{ shipmentStatus?: string | null }> | null
}) {
  const lifecycle = String(order.statusHistory?.[0]?.toStatus ?? order.status ?? "")
  const shipmentState = String(order.shipmentStatus ?? order.shipments?.[0]?.shipmentStatus ?? "").toLowerCase()
  return orderProgressRank(lifecycle) >= 3 || orderProgressRank(String(order.status ?? "")) >= 3 || SHIPPED_STATES.includes(shipmentState)
}
