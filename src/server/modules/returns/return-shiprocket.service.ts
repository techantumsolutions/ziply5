import { randomUUID } from "crypto"
import { shiprocketClient, ShiprocketApiError } from "@/lib/integrations/shiprocket"
import { env } from "@/src/server/core/config/env"
import { pgQuery } from "@/src/server/db/pg"
import { parseShiprocketAddress } from "@/src/server/modules/shipping/shiprocket.utils"

const parseCustomerAddress = (address?: string | null) => {
  const parsed = parseShiprocketAddress(address)
  return { ...parsed, pincode: parsed.pincode ?? "110001" }
}

const warehouseShipping = () => ({
  name: env.SHIPROCKET_RETURN_SHIPPING_NAME?.trim() || env.SHIPROCKET_PICKUP_LOCATION?.trim() || "Warehouse",
  address: env.SHIPROCKET_RETURN_SHIPPING_ADDRESS?.trim() || "Return warehouse address not configured",
  city: env.SHIPROCKET_RETURN_SHIPPING_CITY?.trim() || "Delhi",
  state: env.SHIPROCKET_RETURN_SHIPPING_STATE?.trim() || "DL",
  pincode: env.SHIPROCKET_RETURN_SHIPPING_PINCODE?.trim() || env.SHIPROCKET_PICKUP_POSTCODE?.trim() || "110001",
  country: env.SHIPROCKET_RETURN_SHIPPING_COUNTRY?.trim() || "India",
  phone: env.SHIPROCKET_RETURN_SHIPPING_PHONE?.trim() || "9999999999",
  email: env.SHIPROCKET_RETURN_SHIPPING_EMAIL?.trim() || "returns@example.com",
})

const extractReturnAwb = (res: Record<string, unknown>) => {
  const payload = res.payload && typeof res.payload === "object" ? (res.payload as Record<string, unknown>) : null
  const awb = String(res.awb_code ?? res.awb_code_data ?? payload?.awb_code ?? payload?.awb ?? "").trim()
  return awb || null
}

const extractShipmentId = (res: Record<string, unknown>) => {
  const payload = res.payload && typeof res.payload === "object" ? (res.payload as Record<string, unknown>) : null
  const sid = Number(res.shipment_id ?? payload?.shipment_id ?? 0)
  return Number.isFinite(sid) && sid > 0 ? String(sid) : null
}

/**
 * After admin approval: create a single Shiprocket reverse return for all open line-level
 * `ReturnRequest` rows on the same order, then persist reverse AWB on each row.
 */
export const createShiprocketReturnAfterAdminApproval = async (params: { seedReturnRequestId: string; actorId: string }) => {
  const { seedReturnRequestId } = params
  console.log("[return-shiprocket] approve.create_start", { seedReturnRequestId })

  const seedRows = await pgQuery<
    Array<{
      id: string
      orderId: string
      status: string
      reverseAwb: string | null
    }>
  >(`SELECT id, "orderId", status, "reverseAwb" FROM "ReturnRequest" WHERE id = $1 LIMIT 1`, [seedReturnRequestId])
  const seed = seedRows[0]
  if (!seed) throw new Error("Return request not found")
  if (seed.reverseAwb) {
    console.log("[return-shiprocket] approve.skip_already_has_reverse", { seedReturnRequestId: seed.id })
    return { skipped: true as const, reason: "reverse_already_created" }
  }
  const st = String(seed.status ?? "").toLowerCase()
  if (!["requested", "under_review", "pending"].includes(st)) {
    throw new Error(`Return cannot be approved from status ${seed.status}`)
  }

  const orderRows = await pgQuery<
    Array<{
      id: string
      customerName: string | null
      customerPhone: string | null
      customerAddress: string | null
      customerEmail: string | null
      createdAt: Date
      total: string | number
    }>
  >(
    `
    SELECT o.id, o."customerName", o."customerPhone", o."customerAddress",
      u.email as "customerEmail", o."createdAt", o.total
    FROM "Order" o
    LEFT JOIN "User" u ON u.id = o."userId"
    WHERE o.id = $1
    LIMIT 1
    `,
    [seed.orderId],
  )
  const order = orderRows[0]
  if (!order) throw new Error("Order not found")

  const openReturns = await pgQuery<Array<{ id: string }>>(
    `
    SELECT id FROM "ReturnRequest"
    WHERE "orderId" = $1
      AND LOWER(status) IN ('requested', 'under_review', 'pending')
      AND "reverseAwb" IS NULL
    `,
    [seed.orderId],
  )
  const returnIds = openReturns.map((r) => r.id)
  if (!returnIds.length) throw new Error("No open return requests to approve for this order")

  const itemRows = await pgQuery<
    Array<{
      returnRequestId: string
      orderItemId: string
      requestedQty: number
      productName: string
      sku: string | null
      lineTotal: string | number
      orderQty: number
    }>
  >(
    `
    SELECT
      rri."returnRequestId",
      rri."orderItemId",
      rri."requestedQty",
      p.name as "productName",
      p.sku,
      oi."lineTotal",
      oi.quantity as "orderQty"
    FROM "ReturnRequestItem" rri
    INNER JOIN "ReturnRequest" rr ON rr.id = rri."returnRequestId"
    INNER JOIN "OrderItem" oi ON oi.id = rri."orderItemId"
    INNER JOIN "Product" p ON p.id = oi."productId"
    WHERE rr.id = ANY($1::text[])
    `,
    [returnIds],
  )
  if (!itemRows.length) throw new Error("Return line items missing")

  const pickup = parseCustomerAddress(order.customerAddress)
  const wh = warehouseShipping()
  const channelId = Number.parseInt(String(env.SHIPROCKET_CHANNEL_ID ?? "0"), 10)
  if (!Number.isFinite(channelId) || channelId <= 0) {
    throw new Error("Set SHIPROCKET_CHANNEL_ID (numeric) to enable Shiprocket return creation")
  }

  const orderDate = order.createdAt instanceof Date ? order.createdAt.toISOString().slice(0, 10) : String(order.createdAt).slice(0, 10)
  const orderIdForSr = `R-${String(order.id).replace(/-/g, "").slice(0, 24)}`

  const orderItems = itemRows.map((row) => {
    const unit = Number(row.lineTotal ?? 0) / Math.max(Number(row.orderQty ?? 1), 1)
    const selling = Number((unit * Number(row.requestedQty ?? 1)).toFixed(2))
    return {
      name: row.productName,
      sku: row.sku || row.orderItemId,
      units: row.requestedQty,
      selling_price: selling,
    }
  })

  const body: Record<string, unknown> = {
    order_id: orderIdForSr,
    order_date: orderDate,
    channel_id: channelId,
    pickup_customer_name: order.customerName ?? "Customer",
    pickup_address: pickup.line1,
    pickup_city: pickup.city,
    pickup_state: pickup.state,
    pickup_country: "India",
    pickup_pincode: pickup.pincode,
    pickup_phone: String(order.customerPhone ?? "").replace(/\D/g, "").slice(0, 15) || "9999999999",
    pickup_email: order.customerEmail ?? "customer@example.com",
    shipping_customer_name: wh.name,
    shipping_address: wh.address,
    shipping_city: wh.city,
    shipping_state: wh.state,
    shipping_country: wh.country,
    shipping_pincode: wh.pincode,
    shipping_phone: wh.phone,
    shipping_email: wh.email,
    order_items: orderItems,
  }

  let srResponse: Record<string, unknown>
  try {
    console.log("[return-shiprocket] shiprocket.request", { orderId: order.id, orderIdForSr, itemCount: orderItems.length })
    srResponse = (await shiprocketClient.createReturnOrder(body)) as Record<string, unknown>
    console.log("[return-shiprocket] shiprocket.response", { orderId: order.id, keys: Object.keys(srResponse) })
  } catch (e) {
    const msg =
      e instanceof ShiprocketApiError ? `${e.message} — ${e.body.slice(0, 400)}` : e instanceof Error ? e.message : "Shiprocket return failed"
    console.error("[return-shiprocket] shiprocket.failed", { orderId: order.id, msg })
    throw new Error(msg)
  }

  const reverseAwb = extractReturnAwb(srResponse)
  const reverseShipmentId = extractShipmentId(srResponse)
  const reverseCourier = String(srResponse.courier_name ?? srResponse.courier ?? "") || null
  const reverseTrackingUrl =
    String(srResponse.tracking_url ?? srResponse.track_url ?? (srResponse.payload as Record<string, unknown>)?.track_url ?? "") || null

  if (!reverseAwb) {
    console.error("[return-shiprocket] missing_awb_in_response", srResponse)
    throw new Error("Shiprocket return response did not include an AWB code")
  }

  const trackingRef = reverseAwb
  const pickupDate = new Date()

  for (const rid of returnIds) {
    await pgQuery(
      `
      UPDATE "ReturnRequest"
      SET status = 'pickup_scheduled',
          "reverseAwb" = $2,
          "reverseShipmentId" = $3,
          "reverseCourier" = $4,
          "reverseTrackingUrl" = $5,
          "reverseRawResponse" = $6::jsonb,
          "pickupScheduledAt" = now(),
          "approvedAt" = COALESCE("approvedAt", now()),
          "updatedAt" = now()
      WHERE id = $1
      `,
      [rid, reverseAwb, reverseShipmentId, reverseCourier, reverseTrackingUrl, JSON.stringify(srResponse)],
    )

    await pgQuery(
      `
      INSERT INTO "ReturnPickup" (id, "returnRequestId", "pickupDate", "timeSlot", carrier, "trackingRef", status, notes, "reverseAwb", "reverseShiprocketResponse", "createdAt", "updatedAt")
      VALUES ($1, $2, $3, NULL, $4, $5, 'scheduled', NULL, $5, $6::jsonb, now(), now())
      ON CONFLICT ("returnRequestId") DO UPDATE SET
        "pickupDate" = EXCLUDED."pickupDate",
        carrier = EXCLUDED.carrier,
        "trackingRef" = EXCLUDED."trackingRef",
        "reverseAwb" = EXCLUDED."reverseAwb",
        "reverseShiprocketResponse" = EXCLUDED."reverseShiprocketResponse",
        status = 'scheduled',
        "updatedAt" = now()
      `,
      [randomUUID(), rid, pickupDate, reverseCourier ?? "Shiprocket", trackingRef, JSON.stringify(srResponse)],
    )
  }

  console.log("[return-shiprocket] approve.persisted", { orderId: order.id, returnIds, reverseAwb })
  return { reverseAwb, reverseShipmentId, reverseCourier, reverseTrackingUrl, returnIds, raw: srResponse }
}
