import { randomUUID } from "crypto"
import { pgQuery, pgTx } from "@/src/server/db/pg"
import { getShiprocketToken } from "@/lib/integrations/shiprocket"
import { upsertOrderShipmentSnapshotSupabase } from "@/src/lib/db/orders"
import { logger } from "@/lib/logger"
import { getOrderById, latestLifecycleStatus, updateOrderStatus } from "@/src/server/modules/orders/orders.service"
import { manualOrderStatusSteps } from "@/src/lib/orders/manual-order-status"
import { rankOfStoredStatus, shipmentStageRank, stageFromShiprocket, stageToShipmentStatus, type ZiplyShipmentStage } from "@/src/server/modules/shipping/shiprocket-status"

const trackingConsole = (step: string, details?: unknown) => {
  if (details === undefined) {
    console.log(`[shiprocket][${step}]`)
    return
  }
  console.log(`[shiprocket][${step}]`, details)
}

const isRecord = (v: unknown): v is Record<string, unknown> =>
  Boolean(v && typeof v === "object" && !Array.isArray(v))

/**
 * Normalize nested Shiprocket tracking payloads (data / response / tracking_data).
 */
const unwrapTrackingPayload = (payload: unknown): Record<string, unknown> => {
  if (!isRecord(payload)) return {}
  if (payload.tracking_data && isRecord(payload.tracking_data)) return payload
  const data = payload.data
  if (isRecord(data)) {
    if (data.tracking_data && isRecord(data.tracking_data)) {
      return { ...payload, tracking_data: data.tracking_data }
    }
    const inner = data.data
    if (isRecord(inner) && inner.tracking_data && isRecord(inner.tracking_data)) {
      return { ...payload, tracking_data: inner.tracking_data }
    }
  }
  const resp = payload.response
  if (isRecord(resp)) return unwrapTrackingPayload(resp)
  const nestedPayload = payload.payload
  if (isRecord(nestedPayload)) return unwrapTrackingPayload(nestedPayload)
  return payload
}

const TERMINAL_SHIPMENT_STATUSES = new Set([
  "delivered",
  "cancelled",
  "rto_delivered",
  "rto",
  "returned",
  "lost",
  "destroyed",
  "failed",
])

const normalizeStatus = (value?: string | null) => String(value ?? "").trim().toLowerCase().replace(/\s+/g, "_")

export const mapShiprocketToInternalStatus = (shiprocketStatus?: string | null) => {
  const normalized = normalizeStatus(shiprocketStatus)
  if (normalized.includes("awb_assigned")) return "PROCESSING"
  if (normalized.includes("picked_up")) return "SHIPPED"
  if (normalized.includes("in_transit")) return "IN_TRANSIT"
  if (normalized.includes("out_for_delivery")) return "OUT_FOR_DELIVERY"
  if (normalized.includes("delivered")) return "DELIVERED"
  if (normalized.includes("rto")) return "RETURNED"
  return "PROCESSING"
}

type ParsedTracking = {
  shiprocketStatus: string
  statusCode: number | null
  courierName: string | null
  awbCode: string | null
  trackUrl: string | null
  etd: string | null
  pickupStatus: string | null
  currentStatus: string | null
  activities: Array<Record<string, unknown>>
  raw: unknown
  trackSection: Record<string, unknown>
}

export const parseTrackingResponse = (payloadRaw: unknown): ParsedTracking => {
  const root = unwrapTrackingPayload(payloadRaw)
  const track = (isRecord(root.tracking_data) ? root.tracking_data : root) as Record<string, unknown>
  const shipmentTrack = Array.isArray(track.shipment_track)
    ? (track.shipment_track as Array<Record<string, unknown>>)
    : []
  const latest = shipmentTrack[0] ?? {}
  const shiprocketStatus = String(
    latest.current_status ?? latest.shipment_status ?? track.shipment_status ?? track.track_status ?? "",
  )
  const statusCodeRaw = Number(
    latest.current_status_id ?? latest.shipment_status_id ?? track.track_status ?? track.shipment_status ?? 0,
  )
  const statusCode = Number.isFinite(statusCodeRaw) && statusCodeRaw !== 0 ? statusCodeRaw : null
  const courierName = String(latest.courier_name ?? track.courier_name ?? "") || null
  const awbFromLatest = String(latest.awb_code ?? "") || null
  const awbFromTrack = String(track.awb_code ?? track.awb ?? "") || null
  const awbCode = awbFromLatest || awbFromTrack
  const trackUrl = track.track_url ? String(track.track_url) : null
  const etd =
    (track.etd ? String(track.etd) : null) ??
    (latest.edd ? String(latest.edd) : null) ??
    (latest.etd ? String(latest.etd) : null)
  const activities = Array.isArray(track.shipment_track_activities)
    ? (track.shipment_track_activities as Array<Record<string, unknown>>)
    : []
  const pickupStatus = track.pickup_status ? String(track.pickup_status) : null
  const currentStatus = shiprocketStatus || null
  const parsed: ParsedTracking = {
    shiprocketStatus,
    statusCode,
    courierName,
    awbCode,
    trackUrl,
    etd,
    pickupStatus,
    currentStatus,
    activities,
    raw: payloadRaw,
    trackSection: track,
  }
  trackingConsole("tracking.parse.response", parsed)
  return parsed
}

export const fetchTrackingByAwb = async (awbCode: string): Promise<unknown> => {
  trackingConsole("tracking.fetch.start", { awbCode })
  const token = await getShiprocketToken()
  const baseUrl = (process.env.SHIPROCKET_BASE_URL ?? "https://apiv2.shiprocket.in/v1/external").replace(/\/+$/, "")
  const res = await fetch(`${baseUrl}/courier/track/awb/${encodeURIComponent(awbCode)}`, {
    headers: {
      Authorization: `Bearer ${token}`,
      "Content-Type": "application/json",
    },
    cache: "no-store",
  })
  const rawText = await res.text()
  if (!res.ok) {
    trackingConsole("tracking.fetch.failed", { awbCode, status: res.status, body: rawText.slice(0, 500) })
    throw new Error(`Tracking API failed (${res.status}): ${rawText.slice(0, 500)}`)
  }
  try {
    const parsed = JSON.parse(rawText) as unknown
    trackingConsole("tracking.fetch.raw_response", { awbCode, response: parsed })
    return parsed
  } catch {
    throw new Error("Tracking API returned invalid JSON")
  }
}

const upsertTrackingEvents = async (shipmentId: string, awbCode: string, activities: Array<Record<string, unknown>>) => {
  trackingConsole("tracking.events.upsert.start", { shipmentId, awbCode, count: activities.length })
  for (const activity of activities) {
    const status = String(activity.status ?? activity.current_status ?? "")
    const statusCodeRaw = Number(activity.status_code ?? activity.current_status_id ?? 0)
    const statusCode = Number.isFinite(statusCodeRaw) ? statusCodeRaw : null
    const location = String(activity.location ?? activity.activity_location ?? "")
    const activityLabel = String(activity.activity ?? activity.current_status ?? status)
    const activityDateRaw = String(activity.date ?? activity.activity_date ?? activity.created_at ?? "")
    const activityDate = activityDateRaw ? new Date(activityDateRaw) : null
    await pgQuery(
      `
      INSERT INTO "ShipmentTrackingEvent" ("id","shipmentId","awbCode","status","statusCode","activity","location","activityDate","rawEvent","createdAt")
      VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9::jsonb,now())
      ON CONFLICT ("shipmentId","awbCode","statusCode","activityDate") DO NOTHING
      `,
      [
        randomUUID(),
        shipmentId,
        awbCode,
        status || null,
        statusCode,
        activityLabel || null,
        location || null,
        activityDate ? activityDate.toISOString() : null,
        JSON.stringify(activity ?? {}),
      ],
    )
  }
  trackingConsole("tracking.events.upsert.done", { shipmentId, awbCode })
}

const isTerminalCombined = (shippingStatus: string | null, shipmentStatus: string | null) => {
  const blob = `${normalizeStatus(shippingStatus)} ${normalizeStatus(shipmentStatus)}`
  if (!blob.trim()) return false
  for (const term of TERMINAL_SHIPMENT_STATUSES) {
    if (blob.includes(term)) return true
  }
  if (blob.includes("deliver") && blob.includes("delivered")) return true
  return false
}

const advanceOrderFromTracking = async (orderId: string, stage: ZiplyShipmentStage) => {
  const target =
    stage === "cancelled" ? "cancelled" :
    stage === "delivered" ? "delivered" :
    stage === "out_for_delivery" ? "out_for_delivery" :
    stage === "in_transit" ? "in_transit" :
    stage === "shipped" ? "shipped" : null
  if (!target) return
  const order = await getOrderById(orderId)
  if (!order) return
  const status = latestLifecycleStatus(order)
  const note = "Updated from Shiprocket tracking"
  let applied = status === target
  if (target === "cancelled") {
    if (!["cancelled", "rejected", "delivered", "returned"].includes(status)) {
      await updateOrderStatus(orderId, "cancelled", undefined, { reasonCode: "shiprocket_tracking", note }).catch(() => null)
      applied = true
    }
  } else {
    try {
      const steps = manualOrderStatusSteps(status, target)
      for (const step of steps) {
        await updateOrderStatus(orderId, step, undefined, { reasonCode: "shiprocket_tracking", note }).catch(() => null)
      }
      applied = true
    } catch {
      applied = false
    }
  }
  if (!applied) return
  await pgQuery(
    `UPDATE "Shipment"
     SET "shipmentStatus" = $2, "shippingStatus" = $2, "updatedAt" = now()
     WHERE "orderId" = $1 AND COALESCE(lower("shipmentStatus"), '') <> 'cancelled' AND "cancelledAt" IS NULL`,
    [orderId, target],
  )
  await upsertOrderShipmentSnapshotSupabase(orderId, { shipmentStatus: target, shippingStatus: target }).catch(() => null)
}

export const syncShipmentTrackingByAwb = async (awbCode: string) => {
  trackingConsole("tracking.sync_by_awb.start", { awbCode })
  logger.info("shiprocket.sync.start", { awbCode, mode: "tracking_by_awb" })
  const shipmentRows = await pgQuery<Array<{ id: string; orderId: string; shipmentNo: string | null; shipmentStatus: string | null; shippingStatus: string | null }>>(
    `SELECT id, "orderId", "shipmentNo", "shipmentStatus", "shippingStatus" FROM "Shipment" WHERE "trackingNo" = $1 OR "awbCode" = $1 ORDER BY "createdAt" DESC LIMIT 1`,
    [awbCode],
  )
  const shipment = shipmentRows[0]
  if (!shipment) throw new Error("Shipment not found for AWB")
  trackingConsole("tracking.sync_by_awb.shipment_lookup", { awbCode, shipment })
  const rawTracking = await fetchTrackingByAwb(awbCode)
  const parsed = parseTrackingResponse(rawTracking)
  const stage = stageFromShiprocket(parsed.statusCode, parsed.shiprocketStatus)
  const canonicalStatus = stageToShipmentStatus(stage)
  const storedRank = Math.max(rankOfStoredStatus(shipment.shipmentStatus), rankOfStoredStatus(shipment.shippingStatus))
  const incomingRank = shipmentStageRank(stage)
  const correctsPickupState = stage === "pickup_exception" || stage === "pickup_error"
  const applyStatus = Boolean(canonicalStatus) && (correctsPickupState || incomingRank >= storedRank)
  const internalStatus = applyStatus && canonicalStatus ? canonicalStatus : (shipment.shipmentStatus || mapShiprocketToInternalStatus(parsed.shiprocketStatus))
  const statusToStore = applyStatus && canonicalStatus
    ? canonicalStatus
    : (shipment.shipmentStatus || shipment.shippingStatus || internalStatus)
  const etdDate = parsed.etd ? new Date(parsed.etd) : null
  const etdValid = etdDate && !Number.isNaN(etdDate.getTime()) ? etdDate : null
  trackingConsole("tracking.sync_by_awb.mapped_status", { awbCode, shiprocketStatus: parsed.shiprocketStatus, internalStatus })
  logger.info("shiprocket.tracking.shipment_row_update.start", {
    shipmentId: shipment.id,
    orderId: shipment.orderId,
    awbCode,
    internalStatus,
    shiprocketStatus: parsed.shiprocketStatus,
    statusCode: parsed.statusCode,
    etdSet: Boolean(etdValid),
  })
  await pgTx(async (tx) => {
    try {
      const updateResult = await tx.query(
        `
      UPDATE "Shipment"
      SET "shippingStatus"=$2,
          "shipmentStatus"=COALESCE(NULLIF(trim($3), ''), $2),
          "shippingStatusCode"=$4,
          "currentStatus"=COALESCE(NULLIF(trim($5), ''), $2),
          "trackingUrl"=COALESCE($6,"trackingUrl"),
          "courierName"=COALESCE($7,"courierName"),
          "pickupStatus"=COALESCE($8,"pickupStatus"),
          "trackingData"=$9::jsonb,
          "rawShiprocketResponse"=$10::jsonb,
          "lastTrackingSyncAt"=now(),
          "estimatedDeliveryDate"=COALESCE($11,"estimatedDeliveryDate"),
          "deliveredAt"=CASE WHEN $2='delivered' THEN COALESCE("deliveredAt", now()) ELSE "deliveredAt" END,
          "shippedAt"=CASE WHEN $2 IN ('shipped','in_transit','out_for_delivery','delivered') THEN COALESCE("shippedAt", now()) ELSE "shippedAt" END,
          "updatedAt"=now()
      WHERE id=$1
      `,
        [
          shipment.id,
          statusToStore,
          statusToStore,
          parsed.statusCode,
          parsed.currentStatus,
          parsed.trackUrl,
          parsed.courierName,
          parsed.pickupStatus,
          JSON.stringify(parsed.trackSection ?? {}),
          JSON.stringify(parsed.raw ?? {}),
          etdValid,
        ],
      )
      logger.info("shiprocket.tracking.shipment_row_update.done", {
        shipmentId: shipment.id,
        awbCode,
        rowCount: updateResult.rowCount,
      })
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err)
      logger.error("shiprocket.tracking.shipment_row_update_failed", {
        shipmentId: shipment.id,
        orderId: shipment.orderId,
        awbCode,
        internalStatus,
        shiprocketStatus: parsed.shiprocketStatus,
        message,
      })
      throw err
    }
  })
  trackingConsole("tracking.sync_by_awb.shipment_updated", {
    orderId: shipment.orderId,
    shipmentId: shipment.id,
    awbCode,
    currentStatus: parsed.shiprocketStatus,
    statusCode: parsed.statusCode,
    trackingUrl: parsed.trackUrl,
  })
  await upsertTrackingEvents(shipment.id, awbCode, parsed.activities)

  const orderPatch: Parameters<typeof upsertOrderShipmentSnapshotSupabase>[1] = {
    awbCode,
    trackingNumber: awbCode,
    courierName: parsed.courierName ?? null,
    trackingUrl: parsed.trackUrl,
    estimatedDeliveryDate: etdValid,
    shippingStatus: statusToStore,
    shipmentStatus: statusToStore,
    pickupStatus: parsed.pickupStatus,
    lastTrackingSyncAt: new Date(),
    trackingData: parsed.trackSection,
    shiprocketRawResponse: parsed.raw,
    shippingStatusCode: parsed.statusCode,
  }
  if (statusToStore === "delivered") {
    orderPatch.shipmentDeliveredAt = new Date()
    await pgQuery(
      `UPDATE "Order" SET "paymentStatus" = 'SUCCESS', "paymentMethod" = 'cod', "updatedAt" = now()
       WHERE id = $1 AND lower(COALESCE("paymentMethod", '')) = 'cod'`,
      [shipment.orderId],
    ).catch(() => null)
  }
  await upsertOrderShipmentSnapshotSupabase(shipment.orderId, orderPatch)
  logger.info("shiprocket.snapshot.persisted", {
    orderId: shipment.orderId,
    shipmentId: shipment.id,
    awbCode,
    shippingStatus: internalStatus,
  })
  trackingConsole("tracking.sync_by_awb.order_snapshot_updated", {
    orderId: shipment.orderId,
    awbCode,
    shippingStatus: internalStatus,
    trackingUrl: parsed.trackUrl,
    etd: parsed.etd,
  })
  logger.info("shiprocket.sync.success", {
    orderId: shipment.orderId,
    shipmentId: shipment.id,
    awbCode,
    shippingStatus: internalStatus,
    mode: "tracking_by_awb",
  })
  logger.info("shiprocket.tracking.updated", {
    orderId: shipment.orderId,
    shipmentId: shipment.id,
    awbCode,
    shippingStatus: internalStatus,
  })
  if (applyStatus) await advanceOrderFromTracking(shipment.orderId, stage)
  return {
    success: true,
    orderId: shipment.orderId,
    shipmentId: shipment.id,
    awbCode,
    courierName: parsed.courierName,
    trackingUrl: parsed.trackUrl,
    estimatedDeliveryDate: parsed.etd,
    shippingStatus: internalStatus,
  }
}

export const syncShipmentTracking = async (orderId: string) => {
  trackingConsole("tracking.sync_by_order.start", { orderId })
  logger.info("shiprocket.sync.start", { orderId, mode: "tracking_by_order" })
  const shipmentRows = await pgQuery<Array<{ id: string; trackingNo: string | null; awbCode: string | null }>>(
    `SELECT id, "trackingNo", "awbCode" FROM "Shipment" WHERE "orderId" = $1 ORDER BY "createdAt" DESC LIMIT 1`,
    [orderId],
  )
  const shipment = shipmentRows[0]
  if (!shipment) throw new Error("Shipment not found for order")
  trackingConsole("tracking.sync_by_order.shipment_lookup", { orderId, shipment })
  const awbCode = shipment.trackingNo ?? shipment.awbCode
  if (!awbCode) throw new Error("AWB code missing for shipment")
  trackingConsole("tracking.sync_by_order.awb_resolved", { orderId, awbCode })
  return syncShipmentTrackingByAwb(awbCode)
}

/** Public alias: refresh tracking timeline + snapshots for an order. */
export const refreshShipmentTracking = async (orderId: string) => syncShipmentTracking(orderId)

export const syncReturnRequestReverseTracking = async (returnRequestId: string) => {
  const terminal = new Set(["rejected", "cancelled", "refunded", "completed"])
  const rrRows = await pgQuery<Array<{ id: string; reverseAwb: string | null; status: string }>>(
    `SELECT id, "reverseAwb", status FROM "ReturnRequest" WHERE id=$1 LIMIT 1`,
    [returnRequestId],
  )
  const rr = rrRows[0]
  if (!rr) throw new Error("Return request not found")
  if (terminal.has(String(rr.status ?? "").toLowerCase())) {
    trackingConsole("tracking.return.skip_terminal", { returnRequestId, status: rr.status })
    return { skipped: true as const, status: rr.status }
  }
  if (!rr.reverseAwb?.trim()) throw new Error("Reverse AWB not available yet")
  const raw = await fetchTrackingByAwb(rr.reverseAwb.trim())
  const parsed = parseTrackingResponse(raw)
  const s = parsed.shiprocketStatus.toLowerCase()
  let next: string | null = null
  if (s.includes("delivered")) next = "returned"
  else if (s.includes("out_for") || s.includes("ofd")) next = "in_transit"
  else if (s.includes("transit")) next = "in_transit"
  else if (s.includes("picked")) next = "picked_up"

  await pgQuery(
    `
    UPDATE "ReturnRequest"
    SET "reverseTrackingData" = $2::jsonb,
        "lastReverseTrackingSyncAt" = now(),
        status = CASE WHEN $3::text IS NOT NULL THEN $3::text ELSE status END,
        "updatedAt" = now()
    WHERE id = $1
    `,
    [returnRequestId, JSON.stringify(parsed.trackSection ?? {}), next],
  )
  trackingConsole("tracking.return.updated", { returnRequestId, next, shiprocketStatus: parsed.shiprocketStatus })
  return {
    returnRequestId,
    awbCode: rr.reverseAwb,
    shiprocketStatus: parsed.shiprocketStatus,
    mappedStatus: next,
  }
}

export const syncAllActiveShipments = async () => {
  trackingConsole("tracking.sync_all.start")
  logger.info("shiprocket.sync.start", { mode: "cron_active_shipments" })
  const rows = await pgQuery<
    Array<{
      orderId: string
      trackingNo: string | null
      awbCode: string | null
      shippingStatus: string | null
      shipmentStatus: string | null
    }>
  >(
    `
    SELECT DISTINCT ON (s."orderId")
      s."orderId",
      s."trackingNo",
      s."awbCode",
      s."shippingStatus",
      s."shipmentStatus"
    FROM "Shipment" s
    LEFT JOIN "Order" o ON o.id = s."orderId"
    WHERE COALESCE(s."trackingNo", s."awbCode") IS NOT NULL
      AND (s."shipmentNo" IS NULL OR s."shipmentNo" NOT LIKE 'manual-%')
      AND LOWER(COALESCE(s.carrier, '')) NOT IN ('manual', 'manual courier')
      AND LOWER(COALESCE(o."shippingMethod", '')) <> 'manual'
    ORDER BY s."orderId", s."createdAt" DESC
    `,
    [],
  )
  const results: Array<{ orderId: string; status: "synced" | "skipped" | "failed"; reason?: string }> = []
  for (const row of rows) {
    trackingConsole("tracking.sync_all.row", row)
    const awb = row.trackingNo ?? row.awbCode ?? ""
    if (!awb.trim()) {
      results.push({ orderId: row.orderId, status: "skipped", reason: "no_awb" })
      continue
    }
    if (isTerminalCombined(row.shippingStatus, row.shipmentStatus)) {
      results.push({ orderId: row.orderId, status: "skipped", reason: "terminal_status" })
      trackingConsole("tracking.sync_all.skipped_terminal", { orderId: row.orderId })
      continue
    }
    try {
      await syncShipmentTrackingByAwb(awb)
      results.push({ orderId: row.orderId, status: "synced" })
      trackingConsole("tracking.sync_all.synced", { orderId: row.orderId, awbCode: awb })
    } catch (error) {
      logger.error("shiprocket.sync.failed", {
        orderId: row.orderId,
        awbCode: awb,
        reason: error instanceof Error ? error.message : "unknown",
        mode: "cron_active_shipments",
      })
      results.push({
        orderId: row.orderId,
        status: "failed",
        reason: error instanceof Error ? error.message : "unknown",
      })
      trackingConsole("tracking.sync_all.failed", {
        orderId: row.orderId,
        awbCode: awb,
        reason: error instanceof Error ? error.message : "unknown",
      })
    }
  }
  const returnRows = await pgQuery<Array<{ id: string; reverseAwb: string | null; status: string | null }>>(
    `
    SELECT id, "reverseAwb", status
    FROM "ReturnRequest"
    WHERE "reverseAwb" IS NOT NULL
      AND LOWER(COALESCE(status, '')) NOT IN ('rejected', 'cancelled', 'refunded', 'completed', 'returned')
    LIMIT 80
    `,
    [],
  )
  for (const r of returnRows) {
    trackingConsole("tracking.sync_all.return_row", r)
    try {
      await syncReturnRequestReverseTracking(r.id)
      results.push({ orderId: `return:${r.id}`, status: "synced" })
    } catch (error) {
      logger.error("shiprocket.return_sync.failed", {
        returnRequestId: r.id,
        reason: error instanceof Error ? error.message : "unknown",
      })
      results.push({
        orderId: `return:${r.id}`,
        status: "failed",
        reason: error instanceof Error ? error.message : "unknown",
      })
    }
  }
  const output = {
    total: results.length,
    synced: results.filter((r) => r.status === "synced").length,
    skipped: results.filter((r) => r.status === "skipped").length,
    failed: results.filter((r) => r.status === "failed").length,
    results,
  }
  logger.info("shiprocket.sync.success", { mode: "cron_active_shipments", ...output })
  trackingConsole("tracking.sync_all.done", output)
  return output
}
