import {
  assignAwbForOrderShipment,
  checkOrderServiceability,
  createShiprocketShipmentForOrder,
  debugSingleShipment,
  generatePickupForOrderShipment,
  syncOrderToShiprocket,
} from "@/src/server/modules/integrations/shiprocket-order.service"
import { getOrderByIdSupabaseBasic, getOrderWithOpsRelationsSupabase, upsertOrderShipmentSnapshotSupabase } from "@/src/lib/db/orders"
import { normalizeShiprocketErrorMessage } from "@/src/server/modules/shipping/shiprocket.utils"
import { logger } from "@/lib/logger"
import { withShiprocketOrderSyncLock, SHIPROCKET_SYNC_LOCK_TTL_MS } from "@/src/server/modules/shipping/shiprocket-sync-lock"
import { syncShipmentTracking } from "@/src/server/modules/shipping/shiprocket.tracking"

const shipmentConsole = (step: string, details?: unknown) => {
  if (details === undefined) {
    console.log(`[shiprocket][${step}]`)
    return
  }
  console.log(`[shiprocket][${step}]`, details)
}

type ShipmentSnapshotOrder = {
  id: string
  shipmentId?: string | null
  awbCode?: string | null
  isShipmentCreated?: boolean | null
  shiprocketOrderId?: string | null
  shiprocketRawResponse?: unknown
  courierName?: string | null
  trackingUrl?: string | null
}

const isNonEmpty = (value: unknown) => typeof value === "string" && value.trim().length > 0

export const isShipmentFullySynced = (order: ShipmentSnapshotOrder) =>
  isNonEmpty(order.shipmentId) && isNonEmpty(order.awbCode) && order.isShipmentCreated === true

const detectPartialShipmentState = (order: ShipmentSnapshotOrder) => {
  const issues: string[] = []
  if (isNonEmpty(order.shiprocketOrderId) && !isNonEmpty(order.shipmentId)) issues.push("shiprocketOrderId_present_but_shipmentId_missing")
  if (order.isShipmentCreated === true && !isNonEmpty(order.awbCode)) issues.push("isShipmentCreated_true_but_awbCode_missing")
  if (order.shiprocketRawResponse && (!isNonEmpty(order.shipmentId) || !isNonEmpty(order.awbCode))) {
    issues.push("raw_response_present_but_snapshot_incomplete")
  }
  return { isPartial: issues.length > 0, issues }
}

const recoverSnapshotFromExistingShipment = async (orderId: string) => {
  shipmentConsole("snapshot.recover.start", { orderId })
  const order = await getOrderWithOpsRelationsSupabase(orderId)
  if (!order) throw new Error("Order not found")
  const latestShipment = Array.isArray((order as { shipments?: unknown[] }).shipments)
    ? (((order as { shipments?: Array<Record<string, unknown>> }).shipments ?? [])[0] ?? null)
    : null
  if (!latestShipment) return { recovered: false, reason: "no_existing_shipment_row" }
  const latestStatus = String(latestShipment.shipmentStatus ?? "").toLowerCase()
  if (latestStatus === "cancelled" || latestShipment.cancelledAt) {
    return { recovered: false, reason: "latest_shipment_cancelled" }
  }
  const shipmentNo = latestShipment.shipmentNo ? String(latestShipment.shipmentNo) : null
  const trackingNo = latestShipment.trackingNo ? String(latestShipment.trackingNo) : null
  const carrier = latestShipment.carrier ? String(latestShipment.carrier) : null
  const status = latestShipment.shipmentStatus ? String(latestShipment.shipmentStatus) : "shipment_created"

  await upsertOrderShipmentSnapshotSupabase(orderId, {
    shipmentId: shipmentNo,
    awbCode: trackingNo,
    trackingNumber: trackingNo,
    courierName: carrier,
    shipmentStatus: status,
    shippingStatus: status,
    isShipmentCreated: true,
    shipmentSyncedAt: new Date(),
  })
  shipmentConsole("snapshot.recover.persist_attempted", { orderId, shipmentNo, trackingNo, status })

  const persisted = await getOrderByIdSupabaseBasic(orderId)
  const ok = Boolean(persisted && isNonEmpty((persisted as ShipmentSnapshotOrder).shipmentId))
  logger[ok ? "info" : "error"]("shiprocket.shipment.persistence." + (ok ? "success" : "failed"), {
    orderId,
    source: "recoverSnapshotFromExistingShipment",
    shipmentId: shipmentNo,
    awbCode: trackingNo,
  })
  return { recovered: ok, reason: ok ? "recovered_from_shipment_table" : "snapshot_write_failed" }
}

const persistAndValidateSnapshot = async (
  orderId: string,
  input: Parameters<typeof upsertOrderShipmentSnapshotSupabase>[1],
  context: string,
) => {
  shipmentConsole("snapshot.persist.start", { orderId, context, input })
  const updated = await upsertOrderShipmentSnapshotSupabase(orderId, input)
  const persisted = await getOrderByIdSupabaseBasic(orderId)
  const ok = Boolean(updated && persisted && (persisted as ShipmentSnapshotOrder).isShipmentCreated === true && isNonEmpty((persisted as ShipmentSnapshotOrder).shipmentId))
  logger[ok ? "info" : "error"]("shiprocket.shipment.persistence." + (ok ? "success" : "failed"), {
    orderId,
    context,
    updatedId: updated ?? null,
    shipmentId: (persisted as ShipmentSnapshotOrder | null)?.shipmentId ?? null,
    awbCode: (persisted as ShipmentSnapshotOrder | null)?.awbCode ?? null,
    isShipmentCreated: (persisted as ShipmentSnapshotOrder | null)?.isShipmentCreated ?? null,
  })
  logger[ok ? "info" : "error"]("shipment.db.updated", {
    orderId,
    context,
    success: ok,
    shipmentId: (persisted as ShipmentSnapshotOrder | null)?.shipmentId ?? null,
    awbCode: (persisted as ShipmentSnapshotOrder | null)?.awbCode ?? null,
  })
  shipmentConsole("snapshot.persist.result", {
    orderId,
    context,
    success: ok,
    updatedId: updated ?? null,
    persistedShipmentId: (persisted as ShipmentSnapshotOrder | null)?.shipmentId ?? null,
    persistedAwb: (persisted as ShipmentSnapshotOrder | null)?.awbCode ?? null,
  })
  return ok
}

export const getCourierOptions = async (orderId: string) => {
  const result = await checkOrderServiceability(orderId)
  return {
    orderId,
    availableCouriers: result.response.available_couriers,
    weight: result.weight,
    deliveryPostcode: result.deliveryPostcode,
    pickupPostcode: result.pickupPostcode,
  }
}

export const createShiprocketShipment = async (orderId: string, actorId: string) => {
  shipmentConsole("service.create_shipment.start", { orderId, actorId })
  const created = await createShiprocketShipmentForOrder(orderId, actorId)
  await persistAndValidateSnapshot(orderId, {
    shiprocketOrderId: created.extracted?.shiprocketOrderId ?? (created.shiprocket?.order_id ? String(created.shiprocket.order_id) : null),
    shipmentId: created.extracted?.shipmentId ?? (created.shiprocket?.shipment_id ? String(created.shiprocket.shipment_id) : null),
    awbCode: created.extracted?.awbCode ?? null,
    courierName: created.extracted?.courierName ?? null,
    courierCompanyId: created.extracted?.courierCompanyId ?? null,
    trackingUrl: created.extracted?.trackingUrl ?? null,
    shipmentStatus: created.partial ? "partial" : "shipment_created",
    shippingStatus: created.partial ? "partial" : "shipment_created",
    shipmentCreatedAt: new Date(),
    shipmentSyncedAt: new Date(),
    shiprocketRawResponse: created.shiprocket ?? null,
    isShipmentCreated: created.partial ? false : true,
  }, "createShiprocketShipment").catch(() => null)
  shipmentConsole("service.create_shipment.done", {
    orderId,
    partial: created.partial,
    shiprocketShipmentId: created.extracted?.shipmentId ?? null,
    shiprocketOrderId: created.extracted?.shiprocketOrderId ?? null,
  })
  return created
}

export const assignShipmentAwb = async (orderId: string, actorId: string) => {
  shipmentConsole("service.assign_awb.start", { orderId, actorId })
  const awb = await assignAwbForOrderShipment(orderId, actorId)
  const awbCode = awb.parsedAwb?.awbCode ?? awb.awb?.awb_code ?? awb.shipment?.trackingNo ?? null
  const estimatedDeliveryDate = awb.parsedAwb?.estimatedDeliveryDate ? new Date(awb.parsedAwb.estimatedDeliveryDate) : null

  await persistAndValidateSnapshot(orderId, {
    awbCode,
    shipmentId: awb.parsedAwb?.shipmentId ?? null,
    shiprocketOrderId: awb.parsedAwb?.orderId ?? null,
    trackingNumber: awbCode,
    courierName: awb.parsedAwb?.courierName ?? awb.awb?.courier_name ?? awb.shipment?.carrier ?? null,
    courierCompanyId: awb.parsedAwb?.courierCompanyId ?? (awb.awb?.courier_company_id ? String(awb.awb.courier_company_id) : null),
    trackingUrl: awb.parsedAwb?.trackingUrl ?? awb.awb?.tracking_url ?? null,
    estimatedDeliveryDate,
    shipmentStatus: awb.shipmentUpdated ? "AWB_ASSIGNED" : "AWB_PENDING",
    shippingStatus: awb.shipmentUpdated ? "AWB_ASSIGNED" : "AWB_PENDING",
    shipmentSyncedAt: new Date(),
    isLabelGenerated: Boolean(awbCode),
    shiprocketRawResponse: awb.awb ?? awb.parsedAwb ?? null,
    isShipmentCreated: true,
  }, "assignShipmentAwb").catch(() => null)
  shipmentConsole("service.assign_awb.done", {
    orderId,
    shipmentUpdated: awb.shipmentUpdated,
    awbCode,
    reason: awb.reason ?? null,
  })
  return awb
}

export const generateShipmentPickup = async (orderId: string, actorId: string) => {
  shipmentConsole("service.generate_pickup.start", { orderId, actorId })
  const pickup = await generatePickupForOrderShipment(orderId, actorId)
  await persistAndValidateSnapshot(orderId, {
    pickupStatus: pickup.pickup?.pickup_status ?? "scheduled",
    pickupGeneratedAt: (pickup.shipment as any)?.pickupGeneratedAt ?? null,
    shipmentStatus: pickup.pickup?.pickup_status ?? "pickup_generated",
    shippingStatus: pickup.pickup?.pickup_status ?? "pickup_generated",
    shipmentSyncedAt: new Date(),
    isPickupGenerated: true,
    shiprocketRawResponse: pickup.pickup ?? null,
    isShipmentCreated: true,
  }, "generateShipmentPickup").catch(() => null)
  shipmentConsole("service.generate_pickup.done", { orderId, pickupStatus: pickup.pickup?.pickup_status ?? null })
  return pickup
}

export const retryShiprocketShipmentSync = async (orderId: string, actorId: string) => {
  return safeSyncOrderShipmentToShiprocket(orderId, actorId, { generatePickup: true, forceResync: true })
}

export const syncOrderShipmentToShiprocket = async (
  orderId: string,
  actorId: string,
  options?: { generatePickup?: boolean; forceResync?: boolean },
) => {
  shipmentConsole("service.sync_order.start", { orderId, actorId, options })
  const order = await getOrderByIdSupabaseBasic(orderId)
  if (!order) return { status: "failed" as const, orderId, reason: "Order not found", stage: "precheck" }
  const partial = detectPartialShipmentState(order as ShipmentSnapshotOrder)
  shipmentConsole("service.sync_order.partial_check", { orderId, partial })
  if (partial.isPartial) {
    logger.warn("shiprocket.shipment.partial_state_detected", { orderId, issues: partial.issues })
    const recovered = await recoverSnapshotFromExistingShipment(orderId)
    logger.warn("shiprocket.shipment.snapshot_rebuild_triggered", { orderId, recovered })
  }
  const refreshed = await getOrderByIdSupabaseBasic(orderId)
  if (refreshed && isShipmentFullySynced(refreshed as ShipmentSnapshotOrder) && options?.forceResync !== true) {
    logger.info("shiprocket.sync.skipped", { orderId, skippedReason: "already_fully_synced" })
    return { status: "skipped" as const, orderId, reason: "shipment already exists", skippedReason: "already_fully_synced" }
  }

  if (options?.forceResync === true) {
    logger.warn("shiprocket.sync.force_resync_enabled", { orderId })
  }

  const result = await syncOrderToShiprocket(orderId, actorId, { generatePickup: options?.generatePickup })
  shipmentConsole("service.sync_order.raw_result", { orderId, result })
  if (result.status === "synced") {
    const createdRecord = (result as { created?: { extracted?: { shipmentId?: string | null; shiprocketOrderId?: string | null } } }).created
    const awbRecord = (result as { awb?: { parsedAwb?: { awbCode?: string | null; courierName?: string | null; trackingUrl?: string | null } } }).awb
    await persistAndValidateSnapshot(
      orderId,
      {
        isShipmentCreated: true,
        shipmentSyncedAt: new Date(),
        shipmentId: createdRecord?.extracted?.shipmentId ?? null,
        shiprocketOrderId: createdRecord?.extracted?.shiprocketOrderId ?? null,
        awbCode: awbRecord?.parsedAwb?.awbCode ?? null,
        trackingNumber: awbRecord?.parsedAwb?.awbCode ?? null,
        courierName: awbRecord?.parsedAwb?.courierName ?? null,
        trackingUrl: awbRecord?.parsedAwb?.trackingUrl ?? null,
        shippingStatus: awbRecord?.parsedAwb?.awbCode ? "AWB_ASSIGNED" : "shipment_created",
        shipmentStatus: awbRecord?.parsedAwb?.awbCode ? "AWB_ASSIGNED" : "shipment_created",
      },
      "syncOrderShipmentToShiprocket_result_synced",
    ).catch(() => null)
  } else if (result.status === "skipped") {
    logger.warn("shiprocket.sync.skipped", {
      orderId,
      skippedReason: (result as { skippedReason?: string }).skippedReason ?? "unknown",
      reason: result.reason,
    })
  }
  shipmentConsole("service.sync_order.done", { orderId, status: result.status, reason: (result as { reason?: string }).reason ?? null })
  return result
}

export const syncBulkShiprocketOrders = async (
  orderIds: string[],
  actorId: string,
  options?: { generatePickup?: boolean; retryFailedOnly?: boolean; forceResync?: boolean },
) => {
  shipmentConsole("service.bulk_sync.start", { totalRequested: orderIds.length, options })
  const unique = [...new Set(orderIds)]
  const results: Array<Awaited<ReturnType<typeof syncOrderShipmentToShiprocket>>> = []
  for (const orderId of unique) {
    const result = await syncOrderShipmentToShiprocket(orderId, actorId, {
      generatePickup: options?.generatePickup,
      forceResync: options?.forceResync,
    })
    if (options?.retryFailedOnly && result.status !== "failed") continue
    results.push(result)
  }
  const synced = results.filter((r) => r.status === "synced").length
  const failed = results.filter((r) => r.status === "failed").length
  const skipped = results.filter((r) => r.status === "skipped").length
  const output = { total: results.length, synced, failed, skipped, results }
  shipmentConsole("service.bulk_sync.done", output)
  return output
}

export const debugSingleOrderShipment = async (orderId: string, actorId: string) => {
  return debugSingleShipment(orderId, actorId)
}

export const repairShipmentState = async (orderId: string) => {
  shipmentConsole("service.repair_state.start", { orderId })
  const order = await getOrderByIdSupabaseBasic(orderId)
  if (!order) return { success: false, orderId, reason: "Order not found" }
  const partial = detectPartialShipmentState(order as ShipmentSnapshotOrder)
  if (!partial.isPartial && isShipmentFullySynced(order as ShipmentSnapshotOrder)) {
    return { success: true, orderId, repaired: false, reason: "Shipment already consistent" }
  }
  const recovered = await recoverSnapshotFromExistingShipment(orderId)
  shipmentConsole("service.repair_state.done", { orderId, recovered, partialIssues: partial.issues })
  return {
    success: recovered.recovered,
    orderId,
    repaired: recovered.recovered,
    reason: recovered.reason,
    partialIssues: partial.issues,
  }
}

const hydrateTrackingAfterLifecycleSync = async (orderId: string) => {
  try {
    const o = await getOrderByIdSupabaseBasic(orderId)
    const awb =
      typeof o?.awbCode === "string" && o.awbCode.trim()
        ? o.awbCode.trim()
        : typeof (o as { trackingNumber?: string | null })?.trackingNumber === "string" &&
            (o as { trackingNumber: string }).trackingNumber.trim()
          ? (o as { trackingNumber: string }).trackingNumber.trim()
          : null
    if (!awb) {
      logger.info("shiprocket.stage.completed", { orderId, phase: "tracking_skipped_no_awb" })
      return
    }
    await syncShipmentTracking(orderId)
    logger.info("shiprocket.tracking.updated", { orderId, source: "post_lifecycle_sync" })
  } catch (e) {
    logger.warn("shiprocket.tracking.post_sync_failed", {
      orderId,
      reason: e instanceof Error ? e.message : "unknown",
    })
  }
}

export const safeSyncOrderShipmentToShiprocket = async (
  orderId: string,
  actorId: string,
  options?: { generatePickup?: boolean; forceResync?: boolean },
) => {
  const ran = await withShiprocketOrderSyncLock(orderId, SHIPROCKET_SYNC_LOCK_TTL_MS, async () => {
    logger.info("shiprocket.sync.start", { orderId, actorId, options: options ?? {} })
    try {
      const result = await syncOrderShipmentToShiprocket(orderId, actorId, {
        generatePickup: options?.generatePickup !== false,
        forceResync: options?.forceResync === true,
      })
      if (result.status === "failed") {
        logger.error("shiprocket.sync.failed", { orderId, result })
      } else {
        logger.info("shiprocket.sync.success", { orderId, status: result.status })
      }
      await hydrateTrackingAfterLifecycleSync(orderId)
      return result
    } catch (error) {
      logger.error("shiprocket.sync.failed", {
        orderId,
        reason: error instanceof Error ? error.message : "unknown",
      })
      return {
        status: "failed" as const,
        orderId,
        reason: normalizeShiprocketErrorMessage(error, "Shiprocket sync failed"),
        syncTime: new Date().toISOString(),
      }
    }
  })
  if (ran === null) {
    return {
      status: "skipped" as const,
      orderId,
      reason: "Shiprocket sync already in progress for this order",
      skippedReason: "lock_held" as const,
    }
  }
  return ran
}
