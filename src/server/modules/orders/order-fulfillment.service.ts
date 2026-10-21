import { randomUUID } from "crypto"
import { pgQuery, pgTx } from "@/src/server/db/pg"
import { getOrderById, latestLifecycleStatus, updateOrderStatus } from "./orders.service"
import { getOrderByIdSupabaseBasic, upsertOrderShipmentSnapshotSupabase } from "@/src/lib/db/orders"
import { isManualShipment, manualOrderStatusSteps, type ManualOrderStatus } from "@/src/lib/orders/manual-order-status"

const SHIPMENT_STATUSES = ["shipped", "in_transit", "out_for_delivery", "delivered", "cancelled"] as const
export type AdminShipmentStatus = (typeof SHIPMENT_STATUSES)[number]

const latestHistoryStatus = async (orderId: string) => {
  const order = await getOrderById(orderId)
  if (!order) throw new Error("Order not found")
  return { order, status: latestLifecycleStatus(order) }
}

export const advanceOrderToShipped = async (orderId: string, actorId: string) => {
  let { status } = await latestHistoryStatus(orderId)
  if (status === "confirmed") {
    await updateOrderStatus(orderId, "packed", actorId, { reasonCode: "ship_now", note: "Packed for shipment" })
    status = "packed"
  }
  if (status === "packed") {
    await updateOrderStatus(orderId, "shipped", actorId, { reasonCode: "ship_now", note: "Shipment created in Shiprocket" })
  }
  await pgQuery(
    `UPDATE "Shipment" SET "shipmentStatus" = 'shipped', "shippedAt" = COALESCE("shippedAt", now()), "updatedAt" = now() WHERE "orderId" = $1 AND COALESCE(lower("shipmentStatus"), '') <> 'cancelled'`,
    [orderId],
  ).catch(() => null)
  return { status: "shipped" }
}

export const markShipmentInTransit = async (orderId: string, _actorId: string, _note: string) => {
  await pgQuery(
    `UPDATE "Shipment" SET "shipmentStatus" = 'in_transit', "shippingStatus" = 'in_transit', "updatedAt" = now() WHERE "orderId" = $1 AND COALESCE(lower("shipmentStatus"), '') <> 'cancelled'`,
    [orderId],
  )
  return { status: "in_transit" }
}

const reconcileCodPayment = async (orderId: string) => {
  await pgQuery(
    `UPDATE "Order" SET "paymentStatus" = 'SUCCESS', "paymentMethod" = 'cod', "updatedAt" = now()
     WHERE id = $1 AND lower(COALESCE("paymentMethod", '')) = 'cod'`,
    [orderId],
  ).catch(() => null)
}

export const setAdminShipmentStatus = async (orderId: string, shipmentStatus: string, actorId: string) => {
  const normalizedStatus = shipmentStatus.toLowerCase()

  const rows = await pgQuery<Array<{ id: string }>>(
    `SELECT id FROM "Shipment" WHERE "orderId" = $1 AND COALESCE(lower("shipmentStatus"), '') <> 'cancelled' ORDER BY "createdAt" DESC LIMIT 1`,
    [orderId],
  )
  if (rows.length > 0) {
    await pgQuery(
      `UPDATE "Shipment" SET "shipmentStatus" = $2, "shippingStatus" = $2,
        "shippedAt" = CASE WHEN $2 IN ('shipped', 'in_transit', 'out_for_delivery', 'delivered') THEN COALESCE("shippedAt", now()) ELSE "shippedAt" END,
        "deliveredAt" = CASE WHEN $2 = 'delivered' THEN COALESCE("deliveredAt", now()) ELSE "deliveredAt" END,
        "updatedAt" = now()
       WHERE id = $1`,
      [rows[0].id, normalizedStatus],
    ).catch(() => null)
  } else {
    const id = randomUUID()
    await pgQuery(
      `INSERT INTO "Shipment" (id, "orderId", "shipmentNo", carrier, "shipmentStatus", "shippingStatus", "shippedAt", "deliveredAt", "createdAt", "updatedAt")
       VALUES ($1, $2, $3, 'Manual', $4, $4, CASE WHEN $4 IN ('shipped', 'in_transit', 'out_for_delivery', 'delivered') THEN now() ELSE null END, CASE WHEN $4 = 'delivered' THEN now() ELSE null END, now(), now())`,
      [id, orderId, `shipment-${id.slice(0, 8)}`, normalizedStatus],
    ).catch(() => null)
  }

  await upsertOrderShipmentSnapshotSupabase(orderId, {
    shipmentStatus: normalizedStatus,
    shippingStatus: normalizedStatus,
    shipmentDeliveredAt: normalizedStatus === "delivered" ? new Date() : undefined,
  }).catch(() => null)

  if (normalizedStatus === "delivered") {
    await updateOrderStatus(orderId, "delivered", actorId, {
      reasonCode: "admin_shipment_status",
      note: "Marked delivered by admin",
      force: true,
    }).catch(() => null)
    await reconcileCodPayment(orderId)
  } else if (normalizedStatus === "shipped") {
    await updateOrderStatus(orderId, "shipped", actorId, {
      reasonCode: "admin_shipment_shipped",
      note: "Shipment marked shipped by admin",
      force: true,
    }).catch(() => null)
  } else if (normalizedStatus === "in_transit") {
    await updateOrderStatus(orderId, "in_transit", actorId, {
      reasonCode: "admin_shipment_in_transit",
      note: "Shipment marked in transit by admin",
      force: true,
    }).catch(() => null)
  } else if (normalizedStatus === "out_for_delivery") {
    await updateOrderStatus(orderId, "out_for_delivery", actorId, {
      reasonCode: "admin_shipment_out_for_delivery",
      note: "Shipment marked out for delivery by admin",
      force: true,
    }).catch(() => null)
  }

  return { shipmentStatus: normalizedStatus }
}

export const createManualShipment = async (input: {
  orderId: string
  actorId: string
  trackingId: string
  trackingUrl: string
  courierName?: string
  slipUrl?: string
}) => {
  const trackingId = input.trackingId.trim()
  const trackingUrl = input.trackingUrl.trim()
  if (!trackingId || !trackingUrl) throw new Error("Tracking ID and tracking URL are required")
  const courier = input.courierName?.trim() || "Manual courier"

  const shipment = await pgTx(async (client) => {
    const id = randomUUID()
    const rows = await client.query(
      `INSERT INTO "Shipment" (id, "orderId", "shipmentNo", carrier, "trackingNo", "shipmentStatus", "shippedAt", "createdAt", "updatedAt")
       VALUES ($1,$2,$3,$4,$5,'shipped',now(),now(),now()) RETURNING *`,
      [id, input.orderId, `manual-${id.slice(0, 8)}`, courier, trackingId],
    )
    return rows.rows[0]
  })

  await pgQuery(
    `UPDATE "Shipment" SET "trackingUrl" = $2, "labelUrl" = $3, "shippingStatus" = 'shipped', "courierName" = $4, "updatedAt" = now() WHERE id = $1`,
    [shipment.id, trackingUrl, input.slipUrl ?? null, courier],
  ).catch(() => null)

  const { status } = await latestHistoryStatus(input.orderId)
  if (status === "confirmed") {
    await updateOrderStatus(input.orderId, "packed", input.actorId, { reasonCode: "manual_shipment", note: "Manual shipment packed" }).catch(() => null)
  }
  const packed = await latestHistoryStatus(input.orderId)
  if (packed.status === "packed") {
    await updateOrderStatus(input.orderId, "shipped", input.actorId, { reasonCode: "manual_shipment", note: "Manual shipment created" }).catch(() => null)
  }
  await pgQuery(
    `UPDATE "Shipment" SET "shipmentStatus" = 'shipped', "shippingStatus" = 'shipped', "shippedAt" = COALESCE("shippedAt", now()), "updatedAt" = now() WHERE id = $1`,
    [shipment.id],
  ).catch(() => null)
  await upsertOrderShipmentSnapshotSupabase(input.orderId, {
    shipmentId: String(shipment.shipmentNo ?? shipment.id),
    shipmentStatus: "shipped",
    shippingStatus: "shipped",
    shippingMethod: "manual",
    courierName: courier,
    trackingNumber: trackingId,
    trackingUrl,
    labelUrl: input.slipUrl ?? null,
    isShipmentCreated: true,
  }).catch(() => null)
  return { shipmentId: shipment.id, trackingId, trackingUrl, slipUrl: input.slipUrl ?? null }
}

export const setManualOrderStatus = async (orderId: string, orderStatus: string, actorId: string) => {
  const normalizedStatus = orderStatus.toLowerCase() === "new" ? "pending" : orderStatus.toLowerCase()

  const existing = await getOrderByIdSupabaseBasic(orderId)
  if (!existing) throw new Error("Order not found")
  const fromStatus = (existing.status ?? "pending").toLowerCase()

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

  const currentRank = ORDER_STATUS_PROGRESSION[fromStatus] ?? 0
  const nextRank = ORDER_STATUS_PROGRESSION[normalizedStatus]

  if (fromStatus === "cancelled" || fromStatus === "rejected") {
    throw new Error(`Cannot change status of a ${fromStatus} order`)
  }
  if (normalizedStatus !== "cancelled" && normalizedStatus !== "returned" && nextRank !== undefined && nextRank < currentRank) {
    throw new Error(`Order status cannot go backward. Current status: "${fromStatus}", attempted: "${normalizedStatus}".`)
  }
  if (normalizedStatus === "cancelled" && currentRank >= (ORDER_STATUS_PROGRESSION["shipped"] ?? 3)) {
    throw new Error("Cannot cancel an order that has already shipped or delivered")
  }

  // Update order status directly in orders service with force: true so any valid admin transition is permitted
  await updateOrderStatus(orderId, normalizedStatus as any, actorId, {
    reasonCode: "admin_manual_update",
    note: `Order status set to ${orderStatus.replaceAll("_", " ")} by admin`,
    force: true,
  })

  // Also update Shipment record if it exists
  const rows = await pgQuery<Array<{ id: string; shipmentNo: string | null }>>(
    `SELECT id, "shipmentNo" FROM "Shipment"
     WHERE "orderId" = $1 AND COALESCE(lower("shipmentStatus"), '') <> 'cancelled' AND "cancelledAt" IS NULL
     ORDER BY "createdAt" DESC LIMIT 1`,
    [orderId],
  )
  const shipment = rows[0]
  if (shipment) {
    await pgQuery(
      `UPDATE "Shipment" SET "shipmentStatus" = $2, "shippingStatus" = $2,
        "shippedAt" = CASE WHEN $2 IN ('shipped','in_transit','out_for_delivery','delivered') THEN COALESCE("shippedAt", now()) ELSE "shippedAt" END,
        "deliveredAt" = CASE WHEN $2 = 'delivered' THEN COALESCE("deliveredAt", now()) ELSE "deliveredAt" END,
        "updatedAt" = now()
       WHERE id = $1`,
      [shipment.id, normalizedStatus],
    ).catch(() => null)
  }

  // Update Supabase snapshot if shipment exists or moving to a shipping status
  if (shipment || ["shipped", "in_transit", "out_for_delivery", "delivered"].includes(normalizedStatus)) {
    await upsertOrderShipmentSnapshotSupabase(orderId, {
      shipmentStatus: normalizedStatus,
      shippingStatus: normalizedStatus,
    }).catch(() => null)
  }

  if (normalizedStatus === "delivered") {
    await reconcileCodPayment(orderId)
  }

  return { orderStatus: normalizedStatus, shipmentStatus: normalizedStatus }
}
