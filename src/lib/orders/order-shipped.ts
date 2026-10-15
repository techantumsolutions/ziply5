const SHIPPED_STATES = ["shipped", "in_transit", "out_for_delivery", "dispatched", "delivered", "completed"]

export function orderProgressRank(status: string) {
  const value = status.toLowerCase()
  if (["delivered", "completed"].includes(value)) return 4
  if (["shipped", "in_transit", "out_for_delivery", "dispatched"].includes(value)) return 3
  if (["processing", "packed"].includes(value)) return 2
  if (["confirmed", "approved"].includes(value)) return 1
  return 0
}

export function isZiplyInvoiceReady(order: {
  status?: string | null
  statusHistory?: Array<{ toStatus?: string | null; reasonCode?: string | null }> | null
}) {
  const history = order.statusHistory ?? []
  const rejected = history.some((row) => (row.reasonCode ?? "").toLowerCase() === "admin_rejected" || (row.toStatus ?? "").toLowerCase() === "rejected")
  if (rejected) return false
  const lifecycle = String(history[0]?.toStatus ?? order.status ?? "").toLowerCase()
  if (["cancelled", "rejected", "failed", "pending", "pending_payment", "payment_success", "admin_approval_pending", ""].includes(lifecycle)) return false
  return orderProgressRank(lifecycle) >= 1 || ["confirmed", "packed", "shipped", "in_transit", "out_for_delivery", "delivered", "completed"].includes(lifecycle)
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
