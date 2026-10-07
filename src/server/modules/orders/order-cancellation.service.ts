import { shiprocketClient, ShiprocketApiError } from "@/lib/integrations/shiprocket"
import {
  CUSTOMER_CANCEL_ALLOWED_LIFECYCLES,
  doesShipmentStatusBlockCustomerCancel,
} from "@/src/lib/orders/order-cancel-policy"
import { pgQuery } from "@/src/server/db/pg"
import { updateOrderStatus, releaseOrderInventory } from "./orders.service"

export class OrderCancellationError extends Error {
  constructor(
    message: string,
    public readonly httpStatus: number,
  ) {
    super(message)
    this.name = "OrderCancellationError"
  }
}

type CancelContextRow = {
  latestShipmentId: string | null
  shipmentStatus: string | null
  shippingStatus: string | null
  currentStatus: string | null
  shipmentShiprocketOrderId: string | null
  shiprocketShipmentId: string | null
  orderShiprocketOrderId: string | null
}

const loadCancelContext = async (orderId: string): Promise<CancelContextRow | null> => {
  const rows = await pgQuery<
    Array<{
      latestShipmentId: string | null
      shipmentStatus: string | null
      shippingStatus: string | null
      currentStatus: string | null
      shipmentShiprocketOrderId: string | null
      shiprocketShipmentId: string | null
      orderShiprocketOrderId: string | null
    }>
  >(
    `
    SELECT
      s.id AS "latestShipmentId",
      s."shipmentStatus" AS "shipmentStatus",
      s."shippingStatus" AS "shippingStatus",
      s."currentStatus" AS "currentStatus",
      s."shiprocketOrderId" AS "shipmentShiprocketOrderId",
      s."shiprocketShipmentId" AS "shiprocketShipmentId",
      o."shiprocketOrderId" AS "orderShiprocketOrderId"
    FROM "Order" o
    LEFT JOIN LATERAL (
      SELECT sh.*
      FROM "Shipment" sh
      WHERE sh."orderId" = o.id
      ORDER BY sh."createdAt" DESC NULLS LAST
      LIMIT 1
    ) s ON true
    WHERE o.id = $1
    LIMIT 1
    `,
    [orderId],
  )
  return rows[0] ?? null
}

const assertLifecycleAllowsCustomerCancel = (lifecycle: string) => {
  const normalized = lifecycle.toLowerCase()
  if (!CUSTOMER_CANCEL_ALLOWED_LIFECYCLES.has(normalized)) {
    throw new OrderCancellationError("Cannot cancel order in the current state.", 422)
  }
}

/**
 * Validates lifecycle + shipment, cancels on Shiprocket when linked, then marks order cancelled
 * and persists shipment cancellation metadata.
 */
export const cancelCustomerOrderWithShiprocketGate = async (params: {
  orderId: string
  actorId: string
  reasonCode: string
  note: string
  latestLifecycle: string
}) => {
  const { orderId, actorId, reasonCode, note, latestLifecycle } = params

  console.log("[order-cancel] request", { orderId, reasonCode, latestLifecycle })

  assertLifecycleAllowsCustomerCancel(latestLifecycle)

  const row = await loadCancelContext(orderId)
  if (!row) {
    console.log("[order-cancel] order_not_found", { orderId })
    throw new OrderCancellationError("Order not found", 404)
  }

  const shipmentBlocked = doesShipmentStatusBlockCustomerCancel(
    row.shipmentStatus,
    row.shippingStatus,
    row.currentStatus,
  )
  console.log("[order-cancel] shipment_gate", {
    orderId,
    shipmentStatus: row.shipmentStatus,
    shippingStatus: row.shippingStatus,
    currentStatus: row.currentStatus,
    blocked: shipmentBlocked,
  })
  if (shipmentBlocked) {
    throw new OrderCancellationError(
      "Cancellation is not allowed once the shipment has been picked up or is on the way.",
      422,
    )
  }

  const srOrderRaw = String(row.shipmentShiprocketOrderId ?? row.orderShiprocketOrderId ?? "").trim()
  const hasShiprocket = Boolean(srOrderRaw)
  let shiprocketResponse: unknown = null

  if (hasShiprocket) {
    const numericId = Number.parseInt(srOrderRaw, 10)
    if (!Number.isFinite(numericId)) {
      console.error("[order-cancel] invalid_shiprocket_order_id", { orderId, srOrderRaw })
      throw new OrderCancellationError("Stored Shiprocket order id is invalid.", 422)
    }
    console.log("[order-cancel] calling_shiprocket_cancel", {
      orderId,
      shiprocketOrderId: numericId,
      shipmentId: row.shiprocketShipmentId,
    })
    try {
      shiprocketResponse = await shiprocketClient.cancelOrders({ ids: [numericId] })
      console.log("[order-cancel] shiprocket_response", { orderId, shiprocketResponse })
    } catch (e) {
      const detail =
        e instanceof ShiprocketApiError
          ? `${e.message} — ${e.body.slice(0, 400)}`
          : e instanceof Error
            ? e.message
            : "Shiprocket cancel failed"
      console.error("[order-cancel] shiprocket_failed", { orderId, detail })
      throw new OrderCancellationError(detail, 502)
    }
  } else {
    console.log("[order-cancel] skip_shiprocket_not_linked", { orderId })
    shiprocketResponse = { skipped: true, reason: "no_shiprocket_order_id" }
  }

  const updated = await updateOrderStatus(orderId, "cancelled", actorId, { reasonCode, note })

  if (row.latestShipmentId) {
    await pgQuery(
      `
        UPDATE "Shipment"
        SET "shipmentStatus" = $2,
            "shippingStatus" = $3,
            "cancelledAt" = now(),
            "shiprocketCancelResponse" = $4::jsonb,
            "updatedAt" = now()
        WHERE "id" = $1
      `,
      [row.latestShipmentId, "cancelled", "cancelled", JSON.stringify(shiprocketResponse)],
    )
    console.log("[order-cancel] shipment_row_updated", { orderId, shipmentId: row.latestShipmentId })
  }

  return { updated, shiprocketResponse }
}

/**
 * Admin cancellation: Allows admin to cancel any order at any time.
 * Cancels on Shiprocket if linked, updates order status to cancelled, releases inventory,
 * and updates shipment row.
 */
export const cancelAdminOrderWithShiprocket = async (params: {
  orderId: string
  actorId: string
  reasonCode?: string
  note?: string
}) => {
  const { orderId, actorId, reasonCode = "admin_cancelled", note = "Admin cancelled order" } = params

  console.log("[admin-order-cancel] request", { orderId, reasonCode, note })

  const row = await loadCancelContext(orderId)
  if (!row) {
    console.log("[admin-order-cancel] order_not_found", { orderId })
    throw new OrderCancellationError("Order not found", 404)
  }

  const srOrderRaw = String(row.shipmentShiprocketOrderId ?? row.orderShiprocketOrderId ?? "").trim()
  const hasShiprocket = Boolean(srOrderRaw)
  let shiprocketResponse: unknown = null
  let shiprocketError: string | null = null

  if (hasShiprocket) {
    const numericId = Number.parseInt(srOrderRaw, 10)
    if (!Number.isFinite(numericId)) {
      console.error("[admin-order-cancel] invalid_shiprocket_order_id", { orderId, srOrderRaw })
      shiprocketError = "Stored Shiprocket order ID is invalid."
    } else {
      console.log("[admin-order-cancel] calling_shiprocket_cancel", {
        orderId,
        shiprocketOrderId: numericId,
        shipmentId: row.shiprocketShipmentId,
      })
      try {
        shiprocketResponse = await shiprocketClient.cancelOrders({ ids: [numericId] })
        console.log("[admin-order-cancel] shiprocket_response", { orderId, shiprocketResponse })
      } catch (e) {
        const detail =
          e instanceof ShiprocketApiError
            ? `${e.message} — ${e.body.slice(0, 400)}`
            : e instanceof Error
              ? e.message
              : "Shiprocket cancel failed"
        console.error("[admin-order-cancel] shiprocket_failed", { orderId, detail })
        shiprocketError = detail
      }
    }
  } else {
    console.log("[admin-order-cancel] skip_shiprocket_not_linked", { orderId })
    shiprocketResponse = { skipped: true, reason: "no_shiprocket_order_id" }
  }

  const updated = await updateOrderStatus(orderId, "cancelled", actorId, { reasonCode, note })

  // Release inventory
  try {
    await releaseOrderInventory(orderId)
  } catch (invErr) {
    console.error("[admin-order-cancel] Failed to release inventory:", invErr)
  }

  if (row.latestShipmentId) {
    await pgQuery(
      `
        UPDATE "Shipment"
        SET "shipmentStatus" = $2,
            "shippingStatus" = $3,
            "cancelledAt" = now(),
            "shiprocketCancelResponse" = $4::jsonb,
            "updatedAt" = now()
        WHERE "id" = $1
      `,
      [row.latestShipmentId, "cancelled", "cancelled", JSON.stringify(shiprocketResponse ?? { error: shiprocketError })],
    )
    console.log("[admin-order-cancel] shipment_row_updated", { orderId, shipmentId: row.latestShipmentId })
  }

  return { updated, shiprocketResponse, shiprocketError }
}
