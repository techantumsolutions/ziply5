import { randomUUID } from "crypto"
import { pgQuery, pgTx } from "@/src/server/db/pg"
import { getOrderById, latestLifecycleStatus, updateOrderStatus } from "./orders.service"
import { upsertOrderShipmentSnapshotSupabase } from "@/src/lib/db/orders"
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

export const setAdminShipmentStatus = async (orderId: string, shipmentStatus: AdminShipmentStatus, actorId: string) => {
  if (!SHIPMENT_STATUSES.includes(shipmentStatus)) throw new Error("Unsupported shipment status")
  await pgQuery(
    `UPDATE "Shipment" SET "shipmentStatus" = $2, "shippingStatus" = $2,
      "shippedAt" = CASE WHEN $2 = 'shipped' THEN COALESCE("shippedAt", now()) ELSE "shippedAt" END,
      "deliveredAt" = CASE WHEN $2 = 'delivered' THEN COALESCE("deliveredAt", now()) ELSE "deliveredAt" END,
      "updatedAt" = now()
     WHERE "orderId" = $1 AND COALESCE(lower("shipmentStatus"), '') <> 'cancelled'`,
    [orderId, shipmentStatus],
  )
  if (shipmentStatus === "delivered") {
    const { status } = await latestHistoryStatus(orderId)
    if (status === "confirmed") {
      await updateOrderStatus(orderId, "packed", actorId, { reasonCode: "admin_shipment_status", note: "Packed before delivery" }).catch(() => null)
    }
    const again = await latestHistoryStatus(orderId)
    if (again.status === "packed") {
      await updateOrderStatus(orderId, "shipped", actorId, { reasonCode: "admin_shipment_status", note: "Shipped before delivery" }).catch(() => null)
    }
    const ready = await latestHistoryStatus(orderId)
    if (ready.status === "shipped") {
      await updateOrderStatus(orderId, "delivered", actorId, { reasonCode: "admin_shipment_status", note: "Marked delivered by admin" })
    }
    await reconcileCodPayment(orderId)
  }
  if (shipmentStatus === "in_transit" || shipmentStatus === "out_for_delivery") {
    return { shipmentStatus }
  }
  return { shipmentStatus }
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
    isShipmentCreated: true,
  }).catch(() => null)
  return { shipmentId: shipment.id, trackingId, trackingUrl }
}

export const setManualOrderStatus = async (orderId: string, orderStatus: ManualOrderStatus, actorId: string) => {
  const rows = await pgQuery<Array<{ id: string; shipmentNo: string | null }>>(
    `SELECT id, "shipmentNo" FROM "Shipment"
     WHERE "orderId" = $1 AND COALESCE(lower("shipmentStatus"), '') <> 'cancelled' AND "cancelledAt" IS NULL
     ORDER BY "createdAt" DESC LIMIT 1`,
    [orderId],
  )
  const shipment = rows[0]
  if (!shipment || !isManualShipment({ shipmentNo: shipment.shipmentNo })) {
    throw new Error("Order status can be updated here only for a manual shipment")
  }
  const { status } = await latestHistoryStatus(orderId)
  const steps = manualOrderStatusSteps(status, orderStatus)
  for (const step of steps) {
    await updateOrderStatus(orderId, step, actorId, {
      reasonCode: "manual_order_status",
      note: `Manual shipment status set to ${step.replaceAll("_", " ")}`,
    })
  }
  await pgQuery(
    `UPDATE "Shipment" SET "shipmentStatus" = $2, "shippingStatus" = $2,
      "shippedAt" = CASE WHEN $2 IN ('shipped','in_transit','out_for_delivery','delivered') THEN COALESCE("shippedAt", now()) ELSE "shippedAt" END,
      "deliveredAt" = CASE WHEN $2 = 'delivered' THEN COALESCE("deliveredAt", now()) ELSE "deliveredAt" END,
      "updatedAt" = now()
     WHERE id = $1`,
    [shipment.id, orderStatus],
  )
  await upsertOrderShipmentSnapshotSupabase(orderId, {
    shipmentStatus: orderStatus,
    shippingStatus: orderStatus,
    shippingMethod: "manual",
  }).catch(() => null)
  if (orderStatus === "delivered") await reconcileCodPayment(orderId)
  return { orderStatus, shipmentStatus: orderStatus }
}
