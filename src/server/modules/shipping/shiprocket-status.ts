export type ZiplyShipmentStage =
  | "ready"
  | "pickup"
  | "pickup_exception"
  | "pickup_error"
  | "shipped"
  | "in_transit"
  | "out_for_delivery"
  | "delivered"
  | "rto"
  | "cancelled"
  | "unknown"

/** Shiprocket shipment `current_status_id` values from their tracking payload. */
const STATUS_CODE_STAGE: Record<number, ZiplyShipmentStage> = {
  1: "ready",
  2: "ready",
  3: "pickup",
  4: "pickup",
  5: "pickup",
  6: "shipped",
  7: "delivered",
  8: "cancelled",
  9: "rto",
  10: "rto",
  12: "cancelled",
  13: "pickup",
  14: "rto",
  15: "pickup",
  16: "cancelled",
  17: "out_for_delivery",
  18: "in_transit",
  19: "pickup",
  20: "pickup_exception",
  21: "in_transit",
  22: "in_transit",
  38: "in_transit",
  42: "shipped",
}

const STAGE_RANK: Record<ZiplyShipmentStage, number> = {
  unknown: 0,
  ready: 1,
  pickup: 2,
  pickup_error: 2,
  pickup_exception: 2,
  shipped: 3,
  in_transit: 4,
  out_for_delivery: 5,
  delivered: 6,
  rto: 6,
  cancelled: 7,
}

export const shipmentStageRank = (stage: ZiplyShipmentStage) => STAGE_RANK[stage]

export const stageToShipmentStatus = (stage: ZiplyShipmentStage) => {
  if (stage === "ready") return "ready_to_ship"
  if (stage === "pickup") return "pickup_requested"
  if (stage === "unknown") return null
  return stage
}

const normalize = (value?: string | null) => String(value ?? "").trim().toLowerCase().replace(/\s+/g, "_")

export const orderStatusFromShiprocketPanel = (statusText: string | null, statusCode: number | null): "confirmed" | "packed" | "shipped" | "in_transit" | "out_for_delivery" | "delivered" | "cancelled" | null => {
  const text = String(statusText ?? "").toLowerCase()
  if (text.includes("cancel")) return "cancelled"
  if (text.includes("out for") || text.includes("out_for")) return "out_for_delivery"
  if (text.includes("deliver")) return "delivered"
  if (text.includes("transit")) return "in_transit"
  if (text.includes("shipped") || text.includes("dispatch") || text.includes("picked")) return "shipped"
  if (text.includes("pickup")) return "shipped"
  if (text.includes("ready") || text.includes("awb") || statusCode === 2 || statusCode === 3) return "packed"
  return null
}

export const stageFromStatusText = (statusText?: string | null): ZiplyShipmentStage => {
  const normalized = normalize(statusText)
  if (!normalized) return "unknown"
  if (normalized.includes("rto")) return "rto"
  if (normalized.includes("cancel")) return "cancelled"
  if (normalized.includes("out_for_delivery") || normalized.includes("ofd")) return "out_for_delivery"
  if (normalized.includes("deliver")) return "delivered"
  if (normalized.includes("in_transit") || normalized.includes("reached")) return "in_transit"
  if (normalized.includes("picked") || normalized === "shipped" || normalized.includes("dispatched")) return "shipped"
  if (normalized.includes("pickup_exception") || normalized.includes("exception")) return "pickup_exception"
  if (normalized.includes("pickup_error") || (normalized.includes("pickup") && normalized.includes("error"))) return "pickup_error"
  if (normalized.includes("invalid_status")) return "pickup_exception"
  if (normalized.includes("pickup")) return "pickup"
  if (normalized.includes("awb") || normalized.includes("label") || normalized.includes("manifest")) return "ready"
  return "unknown"
}

export const stageFromShiprocket = (statusCode: number | null, statusText?: string | null): ZiplyShipmentStage => {
  const fromText = stageFromStatusText(statusText)
  if (fromText === "pickup_exception" || fromText === "pickup_error") return fromText
  if (statusCode != null && STATUS_CODE_STAGE[statusCode]) return STATUS_CODE_STAGE[statusCode]
  return fromText
}

export type PickupDecision = "eligible" | "already_requested" | "ineligible"

/** Order status codes from Shiprocket GET /orders/show. */
const PICKUP_ALREADY_REQUESTED = new Set([4, 12, 13, 34, 70])
const PICKUP_ELIGIBLE = new Set([2, 3])

export const classifyShiprocketPickup = (statusCode: number | null, statusText?: string | null): {
  decision: PickupDecision
  reason: string
  nextAction: string
} => {
  const textStage = stageFromStatusText(statusText)
  const label = String(statusText ?? "").trim() || (statusCode != null ? `status ${statusCode}` : "unknown status")
  if (textStage === "pickup_exception" || statusCode === 35) {
    return {
      decision: "ineligible",
      reason: `Shiprocket status is ${label}${statusCode ? ` (${statusCode})` : ""}.`,
      nextAction: "Pickup generation is invalid in this state. Refresh tracking, or reschedule the pickup in the Shiprocket panel. A new AWB or shipment was not created.",
    }
  }
  if (textStage === "pickup_error" || statusCode === 14) {
    return {
      decision: "ineligible",
      reason: `Shiprocket status is ${label}${statusCode ? ` (${statusCode})` : ""}.`,
      nextAction: "This is a pickup error, not a queued pickup. Review it in Shiprocket before any retry. A new AWB or shipment was not created.",
    }
  }
  if (textStage === "shipped" || textStage === "in_transit" || textStage === "out_for_delivery" || textStage === "delivered" || textStage === "cancelled" || textStage === "rto" || (statusCode != null && [5, 6, 7, 9, 15, 16, 18, 19, 20, 51].includes(statusCode))) {
    return {
      decision: "ineligible",
      reason: `Shiprocket status is ${label}${statusCode ? ` (${statusCode})` : ""}.`,
      nextAction: "Pickup can no longer be generated for this shipment. Refresh tracking for the current state. A new AWB or shipment was not created.",
    }
  }
  if ((statusCode != null && PICKUP_ALREADY_REQUESTED.has(statusCode)) || textStage === "pickup" || isPickupAlreadyQueued(statusText)) {
    return {
      decision: "already_requested",
      reason: `Shiprocket already has this shipment as ${label}${statusCode ? ` (${statusCode})` : ""}.`,
      nextAction: "No further pickup request is needed.",
    }
  }
  if (statusCode != null && PICKUP_ELIGIBLE.has(statusCode)) {
    return {
      decision: "eligible",
      reason: `Shiprocket status is ${label} (${statusCode}).`,
      nextAction: "Pickup can be requested.",
    }
  }
  return {
    decision: "ineligible",
    reason: `Shiprocket status is ${label}${statusCode ? ` (${statusCode})` : ""}.`,
    nextAction: "Pickup was not requested because this status is not Ready to Ship. Refresh tracking and try again only when Shiprocket shows Ready to Ship with this AWB.",
  }
}

/** A real pickup request recorded from Shiprocket, not a warehouse pincode or an exception label. */
export const isConfirmedPickupRequest = (status?: string | null) => {
  const normalized = normalize(status)
  if (!normalized || /^\d{5,6}$/.test(normalized)) return false
  if (normalized.includes("exception") || normalized.includes("error") || normalized.includes("invalid")) return false
  return normalized.includes("queue") || normalized.includes("scheduled") || normalized.includes("booked") || normalized === "pickup_requested" || normalized.includes("out_for_pickup")
}

export const rankOfStoredStatus = (value?: string | null) => shipmentStageRank(stageFromStatusText(value))

export const isPickupAlreadyQueued = (message?: string | null) => /already in pickup queue/i.test(String(message ?? ""))
