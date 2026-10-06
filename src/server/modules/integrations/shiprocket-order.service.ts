import { pgQuery, pgTx } from "@/src/server/db/pg"
import { ShiprocketApiError, shiprocketClient } from "@/lib/integrations/shiprocket"
import { randomUUID } from "crypto"
import { logger } from "@/lib/logger"
import { upsertOrderShipmentSnapshotSupabase } from "@/src/lib/db/orders"

const parsePostalCode = (text?: string | null) => {
  if (!text) return null
  const match = text.match(/\b\d{6}\b/)
  return match?.[0] ?? null
}

const toWeight = (weight?: string | null) => {
  if (!weight) return 0.5
  const normalized = weight.trim().toLowerCase()
  const n = Number(normalized.replace(/[^\d.]/g, ""))
  if (!Number.isFinite(n) || n <= 0) return 0.5
  if (normalized.endsWith("kg")) return n
  if (normalized.endsWith("g")) return n / 1000
  return n
}

const sanitizePhone = (phone?: string | null) => {
  const digits = String(phone ?? "").replace(/\D/g, "")
  if (digits.length >= 10) return digits.slice(-10)
  return digits || "9999999999"
}

const normalizeOptionalText = (value: unknown) => {
  if (typeof value === "string") {
    const trimmed = value.trim()
    return trimmed.length ? trimmed : null
  }
  if (typeof value === "number" && Number.isFinite(value)) return String(value)
  return null
}

const normalizeEmail = (value: unknown) => {
  const email = normalizeOptionalText(value)
  return email ? email.toLowerCase() : null
}

const normalizePhone = (value: unknown) => {
  const digits = String(value ?? "").replace(/\D/g, "")
  if (!digits) return null
  return digits.length >= 10 ? digits.slice(-10) : digits
}

const maskSensitive = (value: string | null) => {
  if (!value) return null
  if (value.includes("@")) {
    const [name, domain] = value.split("@")
    return `${name.slice(0, 2)}***@${domain}`
  }
  return `${value.slice(0, 2)}***${value.slice(-2)}`
}

const parseAddressParts = (address?: string | null) => {
  const parts = String(address ?? "")
    .split(",")
    .map((part) => part.trim())
    .filter(Boolean)
  return {
    line1: parts[0] ?? "Address unavailable",
    city: parts[1] ?? "NA",
    state: parts[2] ?? "NA",
    pincode: parts.find((part) => /\b\d{6}\b/.test(part))?.match(/\b\d{6}\b/)?.[0] ?? null,
  }
}

const shipmentLog = (
  level: "info" | "warn" | "error",
  event: string,
  meta: Record<string, unknown>,
) => {
  logger[level](`shiprocket.${event}`, meta)
}

const shipmentConsole = (step: string, details?: unknown) => {
  if (details === undefined) {
    console.log(`[shiprocket][${step}]`)
    return
  }
  console.log(`[shiprocket][${step}]`, details)
}

const normalizeNullableSqlValue = (value: unknown): string | number | boolean | Date | object | null => {
  if (value === undefined || value === null) return null
  if (typeof value === "number" && !Number.isFinite(value)) return null
  if (typeof value === "string") {
    const trimmed = value.trim()
    return trimmed.length ? trimmed : null
  }
  return value as string | number | boolean | Date | object
}

const getSqlParamType = (value: unknown) => {
  if (value === null) return "null"
  if (Array.isArray(value)) return "array"
  if (value instanceof Date) return "date"
  return typeof value
}

const resolveSkippedReason = (reason: string) => {
  const normalized = reason.toLowerCase()
  if (normalized.includes("already synced") || normalized.includes("shipment already exists")) return "already_synced"
  if (normalized.includes("accepted") || normalized.includes("confirmed") || normalized.includes("approval")) return "order_not_confirmed"
  if (normalized.includes("address")) return "invalid_address"
  if (normalized.includes("payment")) return "invalid_payment_state"
  if (normalized.includes("phone") || normalized.includes("customer")) return "missing_customer_info"
  if (normalized.includes("weight")) return "missing_weight"
  if (normalized.includes("dimension")) return "missing_dimensions"
  return "ineligible"
}

type SyncLifecycleStage =
  | "NO_SHIPMENT"
  | "SHIPMENT_CREATED"
  | "AWB_PENDING"
  | "AWB_ASSIGNED"
  | "PICKUP_PENDING"
  | "PICKUP_GENERATED"

const detectSyncStage = (input: {
  shipmentRowExists: boolean
  shipmentId?: string | null
  awbCode?: string | null
  pickupStatus?: string | null
}) => {
  const hasShipmentRef = hasText(input.shipmentId)
  const hasAwb = hasText(input.awbCode)
  const pickup = String(input.pickupStatus ?? "").toLowerCase()
  const pickupGenerated = Boolean(
    pickup &&
    !["", "pending", "pickup_pending", "ready_to_ship", "awb_assigned", "1", "awb assigned"].includes(pickup)
  )

  if (!input.shipmentRowExists && !hasShipmentRef) return "NO_SHIPMENT" as const
  if ((input.shipmentRowExists || hasShipmentRef) && !hasAwb) return "AWB_PENDING" as const
  if (hasAwb && pickupGenerated) return "PICKUP_GENERATED" as const
  if (hasAwb) return "PICKUP_PENDING" as const
  return "SHIPMENT_CREATED" as const
}

const fetchLatestSyncState = async (orderId: string) => {
  const orderRows = await pgQuery<
    Array<{
      id: string
      shipmentId: string | null
      awbCode: string | null
      isShipmentCreated: boolean | null
      pickupStatus: string | null
      shippingStatus: string | null
      shipmentStatus: string | null
      shippingStatusCode: number | null
    }>
  >(`SELECT id, "shipmentId", "awbCode", "isShipmentCreated", "pickupStatus", "shippingStatus", "shipmentStatus", "shippingStatusCode" FROM "Order" WHERE id = $1 LIMIT 1`, [orderId])
  const shipmentRows = await pgQuery<
    Array<{
      id: string
      shipmentNo: string | null
      trackingNo: string | null
      shipmentStatus: string | null
      pickupStatus: string | null
      awbCode: string | null
      shippingStatusCode: number | null
    }>
  >(
    `SELECT id, "shipmentNo", "trackingNo", "shipmentStatus", "pickupStatus", "awbCode", "shippingStatusCode" FROM "Shipment" WHERE "orderId" = $1 ORDER BY "createdAt" DESC LIMIT 1`,
    [orderId],
  )
  const order = orderRows[0] ?? null
  const shipment = shipmentRows[0] ?? null
  const stage = detectSyncStage({
    shipmentRowExists: Boolean(shipment),
    shipmentId: order?.shipmentId ?? shipment?.shipmentNo ?? null,
    awbCode: order?.awbCode ?? shipment?.trackingNo ?? shipment?.awbCode ?? null,
    pickupStatus:
      order?.pickupStatus ??
      shipment?.pickupStatus ??
      order?.shipmentStatus ??
      shipment?.shipmentStatus ??
      String(order?.shippingStatusCode ?? "") ??
      String(shipment?.shippingStatusCode ?? "") ??
      null,
  })
  return { order, shipment, stage }
}

const hasText = (value: unknown) => typeof value === "string" && value.trim().length > 0

const isShipmentFullySynced = (order: { shipmentId?: string | null; awbCode?: string | null; isShipmentCreated?: boolean | null }) =>
  hasText(order.shipmentId) && hasText(order.awbCode) && order.isShipmentCreated === true

const summarizeError = (error: unknown) => {
  if (error instanceof ShiprocketApiError) {
    return {
      type: "shiprocket_api",
      message: error.message,
      httpStatus: error.status,
      shiprocketBody: error.body.slice(0, 1000),
      endpoint: error.endpoint,
      transient: error.isTransient,
    }
  }
  if (error instanceof Error) {
    return {
      type: "application",
      message: error.message,
    }
  }
  return { type: "unknown", message: "Unknown error" }
}

const extractAwbAssignmentData = (response: unknown) => {
  const awbPaths = [
    "response.data.awb_code",
    "response.data.awbCode",
    "response.awb_code",
    "response.awbCode",
    "awb_code",
    "awbCode",
    "data.awb_code",
    "data.awbCode",
    "payload.awb_code",
    "payload.awbCode",
  ]
  const courierNamePaths = [
    "response.data.courier_name",
    "response.data.courierName",
    "response.courier_name",
    "response.courierName",
    "courier_name",
    "courierName",
    "data.courier_name",
    "data.courierName",
    "payload.courier_name",
    "payload.courierName",
  ]
  const courierCompanyPaths = [
    "response.data.courier_company_id",
    "response.data.courierCompanyId",
    "response.courier_company_id",
    "response.courierCompanyId",
    "courier_company_id",
    "courierCompanyId",
    "data.courier_company_id",
    "data.courierCompanyId",
    "payload.courier_company_id",
    "payload.courierCompanyId",
  ]
  const shipmentIdPaths = [
    "response.data.shipment_id",
    "response.data.shipmentId",
    "response.shipment_id",
    "response.shipmentId",
    "shipment_id",
    "shipmentId",
    "data.shipment_id",
    "data.shipmentId",
  ]
  const orderIdPaths = [
    "response.data.order_id",
    "response.data.orderId",
    "response.order_id",
    "response.orderId",
    "order_id",
    "orderId",
    "data.order_id",
    "data.orderId",
  ]
  const trackingPaths = [
    "response.data.tracking_url",
    "response.data.trackingUrl",
    "response.tracking_url",
    "response.trackingUrl",
    "tracking_url",
    "trackingUrl",
    "data.tracking_url",
    "data.trackingUrl",
    "payload.tracking_url",
    "payload.trackingUrl",
  ]
  const eddPaths = [
    "response.data.estimated_delivery_date",
    "response.data.edd",
    "response.estimated_delivery_date",
    "response.edd",
    "data.estimated_delivery_date",
    "data.edd",
    "estimated_delivery_date",
    "edd",
    "payload.estimated_delivery_date",
    "payload.edd",
  ]
  const routingPaths = ["response.data.routing_code", "data.routing_code", "routing_code"]
  const rtoRoutingPaths = ["response.data.rto_routing_code", "data.rto_routing_code", "rto_routing_code"]
  const transporterNamePaths = ["response.data.transporter_name", "data.transporter_name", "transporter_name"]
  const transporterIdPaths = ["response.data.transporter_id", "data.transporter_id", "transporter_id"]
  const appliedWeightPaths = ["response.data.applied_weight", "data.applied_weight", "applied_weight"]
  const assignedDateTimePaths = ["response.data.assigned_date_time", "data.assigned_date_time", "assigned_date_time"]

  const findFirstWithPath = (paths: string[]) => {
    for (const path of paths) {
      const value = asText(getByPath(response, path))
      if (value) return { value, path }
    }
    return { value: null, path: null as string | null }
  }
  const awb = findFirstWithPath(awbPaths)
  const courierName = findFirstWithPath(courierNamePaths)
  const courierCompanyId = findFirstWithPath(courierCompanyPaths)
  const trackingUrl = findFirstWithPath(trackingPaths)
  const edd = findFirstWithPath(eddPaths)
  const shipmentId = findFirstWithPath(shipmentIdPaths)
  const orderId = findFirstWithPath(orderIdPaths)
  const routingCode = findFirstWithPath(routingPaths)
  const rtoRoutingCode = findFirstWithPath(rtoRoutingPaths)
  const transporterName = findFirstWithPath(transporterNamePaths)
  const transporterId = findFirstWithPath(transporterIdPaths)
  const appliedWeight = findFirstWithPath(appliedWeightPaths)
  const assignedDateTime = findFirstWithPath(assignedDateTimePaths)

  const assignStatusRaw = getByPath(response, "awb_assign_status")
  const awbAssignStatus = typeof assignStatusRaw === "number" ? assignStatusRaw : Number(assignStatusRaw ?? 0)
  const isAssigned = awbAssignStatus === 1 && Boolean(awb.value)
  return {
    awbCode: awb.value,
    courierName: courierName.value,
    courierCompanyId: courierCompanyId.value,
    trackingUrl: trackingUrl.value,
    estimatedDeliveryDate: edd.value,
    shipmentId: shipmentId.value,
    orderId: orderId.value,
    routingCode: routingCode.value,
    rtoRoutingCode: rtoRoutingCode.value,
    transporterName: transporterName.value,
    transporterId: transporterId.value,
    appliedWeight: appliedWeight.value,
    assignedDateTime: assignedDateTime.value,
    awbAssignStatus: Number.isFinite(awbAssignStatus) ? awbAssignStatus : 0,
    isAssigned,
    extractionPath: {
      awbCode: awb.path,
      courierName: courierName.path,
      courierCompanyId: courierCompanyId.path,
      trackingUrl: trackingUrl.path,
      estimatedDeliveryDate: edd.path,
      shipmentId: shipmentId.path,
      orderId: orderId.path,
      routingCode: routingCode.path,
      rtoRoutingCode: rtoRoutingCode.path,
      transporterName: transporterName.path,
      transporterId: transporterId.path,
      appliedWeight: appliedWeight.path,
      assignedDateTime: assignedDateTime.path,
    },
    normalized: {
      awbCode: awb.value,
      courierCompanyId: courierCompanyId.value,
      courierName: courierName.value,
      shipmentId: shipmentId.value,
      orderId: orderId.value,
      trackingUrl: trackingUrl.value,
      estimatedDeliveryDate: edd.value,
      routingCode: routingCode.value,
      rtoRoutingCode: rtoRoutingCode.value,
      transporterName: transporterName.value,
      transporterId: transporterId.value,
      appliedWeight: appliedWeight.value,
      assignedDateTime: assignedDateTime.value,
    },
  }
}

const runWithTransientRetry = async <T>(task: () => Promise<T>, retries: number) => {
  let attempt = 0
  let lastError: unknown = null
  while (attempt <= retries) {
    try {
      return await task()
    } catch (error) {
      lastError = error
      const parsed = summarizeError(error)
      const transient = "transient" in parsed && Boolean(parsed.transient)
      if (!transient || attempt >= retries) throw error
      attempt += 1
      await new Promise((resolve) => setTimeout(resolve, 300 * attempt))
    }
  }
  throw lastError instanceof Error ? lastError : new Error("Transient retry failed")
}

type ExtractedShipmentData = {
  shipmentId: string | null
  shiprocketOrderId: string | null
  awbCode: string | null
  courierName: string | null
  courierCompanyId: string | null
  trackingUrl: string | null
  rawResponse: unknown
  extractionPath: string | null
  missingFields: string[]
  partialSuccess: boolean
}

type ShiprocketOrderItem = {
  orderItemId: string
  quantity: number
  name: string
  sku: string
  sellingPrice: number
}

const getByPath = (input: unknown, path: string): unknown => {
  const parts = path.split(".")
  let cursor: unknown = input
  for (const part of parts) {
    if (cursor && typeof cursor === "object" && part in (cursor as Record<string, unknown>)) {
      cursor = (cursor as Record<string, unknown>)[part]
      continue
    }
    return undefined
  }
  return cursor
}

const asText = (value: unknown) => {
  if (typeof value === "string" && value.trim()) return value.trim()
  if (typeof value === "number" && Number.isFinite(value)) return String(value)
  return null
}

const collectObjectCandidates = (response: unknown): Array<{ path: string; node: Record<string, unknown> }> => {
  const queue: Array<{ path: string; node: unknown }> = [{ path: "root", node: response }]
  const out: Array<{ path: string; node: Record<string, unknown> }> = []
  while (queue.length > 0) {
    const current = queue.shift()
    if (!current || !current.node || typeof current.node !== "object") continue
    if (Array.isArray(current.node)) {
      current.node.forEach((item, idx) => queue.push({ path: `${current.path}[${idx}]`, node: item }))
      continue
    }
    out.push({ path: current.path, node: current.node as Record<string, unknown> })
    for (const [key, value] of Object.entries(current.node as Record<string, unknown>)) {
      if (value && typeof value === "object") queue.push({ path: `${current.path}.${key}`, node: value })
    }
  }
  return out
}

const extractShipmentData = (response: unknown): ExtractedShipmentData => {
  const directPaths = [
    "shipment_id",
    "shipmentId",
    "data.shipment_id",
    "data.shipmentId",
    "payload.shipment_id",
    "payload.shipmentId",
  ]
  const orderPaths = ["order_id", "orderId", "data.order_id", "data.orderId", "payload.order_id", "payload.orderId"]
  const awbPaths = ["awb_code", "awbCode", "data.awb_code", "data.awbCode", "payload.awb_code", "payload.awbCode"]
  const courierNamePaths = [
    "courier_name",
    "courierName",
    "data.courier_name",
    "data.courierName",
    "payload.courier_name",
    "payload.courierName",
  ]
  const courierCompanyPaths = [
    "courier_company_id",
    "courierCompanyId",
    "data.courier_company_id",
    "data.courierCompanyId",
    "payload.courier_company_id",
    "payload.courierCompanyId",
  ]
  const trackingUrlPaths = ["tracking_url", "trackingUrl", "data.tracking_url", "data.trackingUrl", "payload.tracking_url", "payload.trackingUrl"]

  let extractionPath: string | null = null
  let shipmentId = directPaths.map((path) => ({ path, value: asText(getByPath(response, path)) })).find((entry) => entry.value)?.value ?? null
  if (!shipmentId) {
    const candidates = collectObjectCandidates(response)
    for (const candidate of candidates) {
      const id = asText(candidate.node.shipment_id ?? candidate.node.shipmentId)
      if (id) {
        shipmentId = id
        extractionPath = candidate.path
        break
      }
    }
  } else {
    extractionPath = directPaths.find((path) => asText(getByPath(response, path))) ?? null
  }

  let shiprocketOrderId = orderPaths.map((path) => asText(getByPath(response, path))).find(Boolean) ?? null
  if (!shiprocketOrderId) {
    const candidates = collectObjectCandidates(response)
    for (const candidate of candidates) {
      const id = asText(candidate.node.order_id ?? candidate.node.orderId)
      if (id) {
        shiprocketOrderId = id
        extractionPath = extractionPath ?? candidate.path
        break
      }
    }
  }

  const awbCode = awbPaths.map((path) => asText(getByPath(response, path))).find(Boolean) ?? null
  const courierName = courierNamePaths.map((path) => asText(getByPath(response, path))).find(Boolean) ?? null
  const courierCompanyId = courierCompanyPaths.map((path) => asText(getByPath(response, path))).find(Boolean) ?? null
  const trackingUrl = trackingUrlPaths.map((path) => asText(getByPath(response, path))).find(Boolean) ?? null

  const message = asText(getByPath(response, "message")) ?? asText(getByPath(response, "data.message")) ?? ""
  const status = asText(getByPath(response, "status")) ?? asText(getByPath(response, "data.status")) ?? ""
  const looksSuccessful = /success|created|ok/i.test(`${message} ${status}`)
  const partialSuccess = Boolean(!shipmentId && (shiprocketOrderId || looksSuccessful))
  const missingFields = [
    !shipmentId ? "shipmentId" : null,
    !shiprocketOrderId ? "shiprocketOrderId" : null,
    !awbCode ? "awbCode" : null,
  ].filter(Boolean) as string[]
  return {
    shipmentId,
    shiprocketOrderId,
    awbCode,
    courierName,
    courierCompanyId,
    trackingUrl,
    rawResponse: response,
    extractionPath,
    missingFields,
    partialSuccess,
  }
}

const addOrderNote = async (orderId: string, note: string, actorId?: string) => {
  await pgQuery(
    `
      INSERT INTO "OrderNote" (id, "orderId", note, "isInternal", "createdById", "createdAt")
      VALUES ($1,$2,$3,true,$4,now())
    `,
    [randomUUID(), orderId, note, actorId ?? null],
  ).catch(() => null)
}

const persistExtendedShipmentFields = async (
  shipmentId: string,
  data: Partial<{
    shiprocketOrderId: string
    shiprocketShipmentId: string
    awbCode: string
    courierId: string
    courierName: string
    courierCompanyId: string
    pickupStatus: string
    trackingUrl: string
    shippingLabelUrl: string
    manifestUrl: string
    pickupGeneratedAt: Date
    estimatedDeliveryDate: Date
    lastSyncAt: Date
    lastTrackingSyncAt: Date
    routingCode: string
    rtoRoutingCode: string
    transporterName: string
    transporterId: string
    appliedWeight: number
    assignedDateTime: Date
    trackingNo: string
    shipmentStatus: string
    shippingStatus: string
    shippingStatusCode: number
    currentStatus: string
    currentStatusId: number
    freightCharges: number
    awbAssignedAt: Date
    invoiceNo: string
    labelUrl: string
    isPickupGenerated: boolean
    rawShiprocketResponse: unknown
    trackingData: unknown
    cancelledAt: Date
    shiprocketCancelResponse: unknown
  }>,
) => {
  const sets: string[] = []
  const values: Array<string | number | Date | boolean | null> = []
  const add = (column: string, value?: string | number | Date | boolean | null) => {
    if (value === undefined) return
    values.push(value)
    sets.push(`"${column}" = $${values.length}`)
  }
  add("shiprocketOrderId", data.shiprocketOrderId)
  add("shiprocketShipmentId", data.shiprocketShipmentId)
  add("awbCode", data.awbCode)
  add("courierId", data.courierId)
  add("courierName", data.courierName)
  add("courierCompanyId", data.courierCompanyId)
  add("pickupStatus", data.pickupStatus)
  add("trackingUrl", data.trackingUrl)
  add("shippingLabelUrl", data.shippingLabelUrl)
  add("manifestUrl", data.manifestUrl)
  add("pickupGeneratedAt", data.pickupGeneratedAt)
  add("lastSyncAt", data.lastSyncAt)
  add("lastTrackingSyncAt", data.lastTrackingSyncAt)
  add("routingCode", data.routingCode)
  add("rtoRoutingCode", data.rtoRoutingCode)
  add("transporterName", data.transporterName)
  add("transporterId", data.transporterId)
  add("appliedWeight", data.appliedWeight)
  add("assignedDateTime", data.assignedDateTime)
  add("trackingNo", data.trackingNo)
  add("shipmentStatus", data.shipmentStatus)
  add("shippingStatus", data.shippingStatus)
  add("shippingStatusCode", data.shippingStatusCode)
  add("currentStatus", data.currentStatus)
  add("currentStatusId", data.currentStatusId)
  add("freightCharges", data.freightCharges)
  add("awbAssignedAt", data.awbAssignedAt)
  add("estimatedDeliveryDate", data.estimatedDeliveryDate)
  add("invoiceNo", data.invoiceNo)
  add("labelUrl", data.labelUrl)
  add("isPickupGenerated", data.isPickupGenerated)
  if (data.rawShiprocketResponse !== undefined) {
    values.push(JSON.stringify(data.rawShiprocketResponse))
    sets.push(`"rawShiprocketResponse" = $${values.length}::jsonb`)
  }
  if (data.trackingData !== undefined) {
    values.push(JSON.stringify(data.trackingData))
    sets.push(`"trackingData" = $${values.length}::jsonb`)
  }
  add("cancelledAt", data.cancelledAt)
  if (data.shiprocketCancelResponse !== undefined) {
    values.push(JSON.stringify(data.shiprocketCancelResponse))
    sets.push(`"shiprocketCancelResponse" = $${values.length}::jsonb`)
  }
  if (sets.length === 0) return
  values.push(shipmentId)
  const shipmentIdPos = values.length
  const sql = `UPDATE "Shipment" SET ${sets.join(", ")}, "updatedAt" = now() WHERE "id" = $${shipmentIdPos}`
  const normalizedValues = values.map((value) => normalizeNullableSqlValue(value))
  shipmentLog("info", "shipment.db_update_query", {
    shipmentId,
    sql,
    params: normalizedValues,
    paramTypes: normalizedValues.map((value, index) => ({ index: index + 1, type: getSqlParamType(value) })),
    columns: Object.keys(data),
  })
  await pgQuery(sql, normalizedValues as any[]).catch((error) => {
    shipmentLog("error", "shipment.db_update_failed", {
      shipmentId,
      reason: error instanceof Error ? error.message : "unknown",
      columns: Object.keys(data),
      sql,
      params: normalizedValues,
      paramDiagnostics: normalizedValues.map((value, index) => ({
        index: index + 1,
        value,
        type: getSqlParamType(value),
      })),
    })
    return null
  })
}

export const checkOrderServiceability = async (orderId: string) => {
  shipmentConsole("serviceability.start", { orderId })
  shipmentLog("info", "serviceability.started", { orderId })
  const orderRows = await pgQuery<
    Array<{
      id: string
      createdAt: Date
      status: string
      paymentMethod: string | null
      paymentStatus: string | null
      total: number
      customerAddress: string | null
      customerName: string | null
      customerPhone: string | null
      items: unknown
      statusHistory: unknown
    }>
  >(
    `
      SELECT
        o.*,
        COALESCE((
          SELECT jsonb_agg(
            jsonb_build_object(
              'id', oi.id,
              'productId', oi."productId",
              'quantity', oi.quantity,
              'unitPrice', oi."unitPrice",
              'product', jsonb_build_object('name', p.name, 'slug', p.slug, 'sku', p.sku, 'weight', p.weight)
            )
            ORDER BY oi.id ASC
          )
          FROM "OrderItem" oi
          INNER JOIN "Product" p ON p.id = oi."productId"
          WHERE oi."orderId" = o.id
        ), '[]'::jsonb) as items,
        COALESCE((
          SELECT jsonb_agg(jsonb_build_object('toStatus', h."toStatus", 'changedAt', h."changedAt") ORDER BY h."changedAt" DESC)
          FROM "OrderStatusHistory" h
          WHERE h."orderId" = o.id
          LIMIT 1
        ), '[]'::jsonb) as "statusHistory"
      FROM "Order" o
      WHERE o.id = $1
      LIMIT 1
    `,
    [orderId],
  )
  const order = orderRows[0] as any
  if (!order) {
    shipmentConsole("serviceability.order_not_found", { orderId })
    shipmentLog("warn", "serviceability.skipped", { orderId, skippedReason: "order_not_found" })
    throw new Error("Order not found")
  }
  const statusHistory = Array.isArray(order.statusHistory) ? (order.statusHistory as any[]) : []
  const latest = statusHistory[0]?.toStatus ?? order.status
  if (["cancelled", "delivered", "returned"].includes(latest)) {
    shipmentConsole("serviceability.order_ineligible", { orderId, latestStatus: latest })
    shipmentLog("warn", "serviceability.skipped", { orderId, skippedReason: "order_closed", latestStatus: latest })
    throw new Error("Order is not eligible for shipment")
  }
  const parsedAddress = parseAddressParts(order.customerAddress)
  const deliveryPostcode = parsePostalCode(order.customerAddress) ?? parsedAddress.pincode
  const pickupPostcode = process.env.SHIPROCKET_PICKUP_POSTCODE?.trim() || "110001"
  if (!deliveryPostcode) {
    shipmentConsole("serviceability.invalid_delivery_postcode", { orderId, address: order.customerAddress ?? null })
    shipmentLog("warn", "serviceability.skipped", { orderId, skippedReason: "invalid_address", reason: "delivery_postcode_missing" })
    throw new Error("Non-serviceable pincode: delivery postcode missing")
  }
  const items = Array.isArray(order.items) ? (order.items as any[]) : []
  const weight = items.reduce((sum, item) => sum + toWeight(item.product?.weight) * Number(item.quantity ?? 0), 0)
  if (weight <= 0) {
    shipmentConsole("serviceability.weight_missing", { orderId })
    shipmentLog("warn", "serviceability.skipped", { orderId, skippedReason: "missing_weight" })
    throw new Error("Weight missing")
  }

  const codRequired = (order.paymentMethod ?? "").toLowerCase() === "cod"

  const response = await shiprocketClient.checkServiceability({
    pickup_postcode: pickupPostcode,
    delivery_postcode: deliveryPostcode,
    cod: codRequired ? 1 : 0,
    weight,
    declared_value: Number(order.total),
  })
  if (!response.available_couriers?.length) {
    shipmentConsole("serviceability.no_couriers", { orderId, deliveryPostcode, pickupPostcode, codRequired })
    shipmentLog("warn", "serviceability.skipped", {
      orderId,
      skippedReason: "pincode_not_serviceable",
      deliveryPostcode,
      pickupPostcode,
      codRequired,
    })
    throw new Error("Non-serviceable pincode")
  }
  shipmentLog("info", "serviceability.success", {
    orderId,
    availableCouriers: response.available_couriers.length,
    deliveryPostcode,
    pickupPostcode,
    codRequired,
    weight,
  })
  shipmentConsole("serviceability.success", {
    orderId,
    courierCount: response.available_couriers.length,
    deliveryPostcode,
    pickupPostcode,
    weight,
  })
  return { order, response, deliveryPostcode, pickupPostcode, weight }
}

export const createShiprocketShipmentForOrder = async (orderId: string, actorId: string) => {
  shipmentConsole("shipment.create.start", { orderId, actorId })
  shipmentLog("info", "shipment.started", { orderId, actorId })
  const { order, response, deliveryPostcode, pickupPostcode, weight } = await checkOrderServiceability(orderId)
  const pickupLocation = process.env.SHIPROCKET_PICKUP_LOCATION?.trim() || "INSTAHOT FOODS"
  if (!pickupLocation) {
    shipmentConsole("shipment.create.pickup_location_missing", { orderId })
    shipmentLog("warn", "shipment.failure", {
      orderId,
      stage: "payload_validation",
      reason: "pickup_location_missing",
      env: "SHIPROCKET_PICKUP_LOCATION",
    })
    throw new Error("pickup location invalid: set SHIPROCKET_PICKUP_LOCATION")
  }
  const bestCourier = [...response.available_couriers].sort((a, b) => a.rate - b.rate)[0]
  const parsedAddress = parseAddressParts(order.customerAddress)
  const orderItems: ShiprocketOrderItem[] = (Array.isArray(order.items) ? order.items : [])
    .map((item: any) => ({
      orderItemId: item.id,
      quantity: Number(item.quantity ?? 0),
      name: String(item.product?.name ?? "Item"),
      sku: String(item.product?.sku ?? item.product?.slug ?? `sku-${item.id}`),
      sellingPrice: Number(item.unitPrice ?? 0),
    }))
    .filter((item: ShiprocketOrderItem) => item.quantity > 0)
  if (!orderItems.length) {
    shipmentConsole("shipment.create.no_items", { orderId })
    shipmentLog("warn", "shipment.skipped", { orderId, skippedReason: "no_order_items" })
    throw new Error("No order items")
  }

  const shipmentExists = await pgQuery<Array<{ id: string }>>(
    `SELECT id FROM "Shipment" WHERE "orderId" = $1 ORDER BY "createdAt" DESC LIMIT 1`,
    [orderId],
  )
  if (shipmentExists.length > 0) {
    shipmentConsole("shipment.create.already_exists", { orderId, existingShipmentId: shipmentExists[0]?.id ?? null })
    shipmentLog("warn", "shipment.skipped", { orderId, skippedReason: "shipment_already_exists", existingShipmentId: shipmentExists[0]?.id })
    throw new Error("Shipment already exists")
  }

  const createPayload = {
    order_id: order.id,
    order_date: new Date(order.createdAt).toISOString().slice(0, 19).replace("T", " "),
    pickup_location: pickupLocation,
    billing_customer_name: order.customerName ?? "Customer",
    billing_last_name: "",
    billing_address: parsedAddress.line1,
    billing_city: parsedAddress.city,
    billing_pincode: deliveryPostcode,
    billing_state: parsedAddress.state,
    billing_country: "India",
    billing_email: "no-email@example.com",
    billing_phone: sanitizePhone(order.customerPhone),
    shipping_is_billing: true,
    order_items: orderItems.map((item) => ({
      name: item.name,
      sku: item.sku,
      units: item.quantity,
      selling_price: item.sellingPrice,
    })),
    payment_method: (order.paymentMethod ?? "").toLowerCase() === "cod" ? "COD" : "Prepaid",
    sub_total: Number(order.total),
    length: 10,
    breadth: 10,
    height: 10,
    weight,
  }
  shipmentLog("info", "shipment.payload", {
    orderId,
    stage: "before_api_request",
    payload: {
      ...createPayload,
      billing_email: createPayload.billing_email,
      billing_phone: createPayload.billing_phone,
      order_items_count: createPayload.order_items.length,
    },
    selectedCourier: bestCourier ?? null,
  })
  shipmentConsole("shipment.create.payload", {
    orderId,
    pickupLocation: createPayload.pickup_location,
    itemsCount: createPayload.order_items.length,
    paymentMethod: createPayload.payment_method,
    pincode: createPayload.billing_pincode,
    weight: createPayload.weight,
  })

  const created = await shiprocketClient.createOrder(createPayload).catch((error) => {
    const parsed = summarizeError(error)
    shipmentLog("error", "shipment.failure", {
      orderId,
      stage: "create_shipment_api",
      reason: parsed.message,
      ...parsed,
      payload: {
        orderId: createPayload.order_id,
        pickupLocation: createPayload.pickup_location,
        pincode: createPayload.billing_pincode,
        paymentMethod: createPayload.payment_method,
      },
    })
    throw error
  })
  shipmentConsole("shipment.create.raw_response", { orderId, response: created })
  shipmentLog("info", "shipment.raw_response", {
    orderId,
    stage: "create_shipment_api",
    shiprocketResponse: created,
  })
  const extracted = extractShipmentData(created)
  shipmentLog("info", "shipment.response_diagnostics", {
    orderId,
    extractedFields: {
      shipmentId: extracted.shipmentId,
      shiprocketOrderId: extracted.shiprocketOrderId,
      awbCode: extracted.awbCode,
      courierName: extracted.courierName,
      courierCompanyId: extracted.courierCompanyId,
      trackingUrl: extracted.trackingUrl,
    },
    missingFields: extracted.missingFields,
    extractionPath: extracted.extractionPath,
    partialSuccess: extracted.partialSuccess,
  })
  shipmentConsole("shipment.create.response_diagnostics", {
    orderId,
    extractedShipmentId: extracted.shipmentId,
    extractedOrderId: extracted.shiprocketOrderId,
    awbCode: extracted.awbCode,
    missingFields: extracted.missingFields,
    extractionPath: extracted.extractionPath,
    partialSuccess: extracted.partialSuccess,
  })
  await upsertOrderShipmentSnapshotSupabase(orderId, {
    shiprocketOrderId: extracted.shiprocketOrderId,
    shipmentId: extracted.shipmentId,
    awbCode: extracted.awbCode,
    trackingNumber: extracted.awbCode,
    courierName: extracted.courierName,
    courierCompanyId: extracted.courierCompanyId,
    trackingUrl: extracted.trackingUrl,
    shipmentStatus: extracted.shipmentId ? "shipment_created" : "partial",
    shippingStatus: extracted.shipmentId ? "shipment_created" : "partial",
    shipmentCreatedAt: new Date(),
    shipmentSyncedAt: new Date(),
    isShipmentCreated: extracted.shipmentId ? true : false,
    shiprocketRawResponse: extracted.rawResponse,
  }).catch((error) => {
    shipmentLog("error", "shipment.persistence_write_failed", {
      orderId,
      stage: "raw_response_persistence",
      reason: error instanceof Error ? error.message : "unknown",
    })
  })
  shipmentConsole("shipment.create.snapshot_saved", {
    orderId,
    shipmentId: extracted.shipmentId,
    shiprocketOrderId: extracted.shiprocketOrderId,
  })
  if (!extracted.shipmentId && extracted.partialSuccess) {
    shipmentConsole("shipment.create.partial_success", { orderId, extractionPath: extracted.extractionPath })
    shipmentLog("warn", "shipment.partial_success_detected", {
      orderId,
      reason: "shipment_reference_missing_but_response_indicates_success",
      extractionPath: extracted.extractionPath,
    })
    return { shipment: null, shiprocket: created, courier: bestCourier, extracted, partial: true }
  }
  if (!extracted.shipmentId) throw new Error("Shiprocket shipment_id missing")
  const exists = await pgQuery<Array<{ id: string }>>(
    `SELECT id FROM "Shipment" WHERE "orderId" = $1 AND "shipmentNo" = $2 LIMIT 1`,
    [orderId, String(extracted.shipmentId)],
  )
  if (exists.length > 0) {
    shipmentConsole("shipment.create.duplicate_shiprocket_shipment", { orderId, shipmentNo: extracted.shipmentId })
    shipmentLog("warn", "shipment.skipped", {
      orderId,
      skippedReason: "duplicate_shipment",
      shipmentNo: String(extracted.shipmentId),
      existingShipmentId: exists[0]?.id,
    })
    throw new Error("Duplicate shipment")
  }

  const shipment = await pgTx(async (client) => {
    const shipmentId = randomUUID()
    const shipmentRows = await client.query(
      `
        INSERT INTO "Shipment" (id, "orderId", "shipmentNo", carrier, "trackingNo", "shipmentStatus", "createdAt", "updatedAt")
        VALUES ($1,$2,$3,$4,NULL,'shipment_created',now(),now())
        RETURNING *
      `,
      [shipmentId, orderId, String(extracted.shipmentId), extracted.courierName ?? bestCourier?.name ?? "Shiprocket"],
    )
    for (const it of orderItems) {
      await client.query(
        `INSERT INTO "ShipmentItem" (id, "shipmentId", "orderItemId", quantity) VALUES ($1,$2,$3,$4)`,
        [randomUUID(), shipmentId, it.orderItemId, it.quantity],
      )
    }
    return shipmentRows.rows[0]
  })
  shipmentConsole("shipment.create.db_inserted", { orderId, shipmentDbId: shipment.id, shiprocketShipmentId: extracted.shipmentId })

  const statusHistory = Array.isArray(order.statusHistory) ? (order.statusHistory as any[]) : []
  const fromStatus = statusHistory[0]?.toStatus ?? order.status
  await pgQuery(
    `
      INSERT INTO "OrderStatusHistory" (id, "orderId", "fromStatus", "toStatus", "reasonCode", notes, "changedById", "changedAt")
      VALUES (gen_random_uuid()::text, $1, $2, 'packed', 'shipment_created', $3, $4, now())
    `,
    [orderId, fromStatus, `Shipment Created via Shiprocket, order_id=${extracted.shiprocketOrderId ?? "na"}, shipment_id=${extracted.shipmentId ?? "na"}`, actorId],
  ).catch(() => null)
  await addOrderNote(orderId, `Shiprocket shipment created (shipment_id=${extracted.shipmentId}, pickup=${pickupPostcode})`, actorId)
  await persistExtendedShipmentFields(shipment.id, {
    shiprocketOrderId: extracted.shiprocketOrderId ?? undefined,
    shiprocketShipmentId: extracted.shipmentId ? String(extracted.shipmentId) : undefined,
    awbCode: extracted.awbCode ?? undefined,
    trackingNo: extracted.awbCode ?? undefined,
    trackingUrl: extracted.trackingUrl ?? undefined,
    courierId: extracted.courierCompanyId ?? (bestCourier?.courier_company_id ? String(bestCourier.courier_company_id) : undefined),
    lastSyncAt: new Date(),
  })
  shipmentConsole("shipment.create.persist_extended_success", {
    orderId,
    shipmentDbId: shipment.id,
    awbCode: extracted.awbCode,
    trackingUrl: extracted.trackingUrl,
  })
  shipmentLog("info", "shipment.success", {
    orderId,
    shipmentId: shipment.id,
    shiprocketShipmentId: extracted.shipmentId ? String(extracted.shipmentId) : null,
    shiprocketOrderId: extracted.shiprocketOrderId ?? null,
  })
  logger.info("shipment.created", {
    orderId,
    shipmentId: shipment.id,
    shiprocketOrderId: extracted.shiprocketOrderId ?? null,
    shiprocketShipmentId: extracted.shipmentId ?? null,
  })
  return { shipment, shiprocket: created, courier: bestCourier, extracted, partial: false }
}

export const assignAwbForOrderShipment = async (orderId: string, actorId: string) => {
  shipmentConsole("awb.assign.start", { orderId, actorId })
  const rows = await pgQuery<Array<{ id: string; shipmentNo: string | null; trackingNo: string | null; carrier: string | null; courierId: string | null }>>(
    `SELECT id, "shipmentNo", "trackingNo", carrier, "courierId" FROM "Shipment" WHERE "orderId" = $1 ORDER BY "createdAt" DESC LIMIT 1`,
    [orderId],
  )
  const shipment = rows[0]
  if (!shipment) throw new Error("Shipment not found")
  if (shipment.trackingNo) return { shipmentUpdated: false, reason: "AWB already assigned", shipment }
  const shipmentId = Number(shipment.shipmentNo ?? 0)
  if (!Number.isFinite(shipmentId) || shipmentId <= 0) throw new Error("Invalid shipment id for AWB assignment")
  const courierIdNumber = Number(shipment.courierId ?? 0)
  const awb = await shiprocketClient.assignAwb({
    shipment_id: shipmentId,
    courier_id: Number.isFinite(courierIdNumber) && courierIdNumber > 0 ? courierIdNumber : undefined,
  })
  shipmentConsole("awb.assign.raw_response", { orderId, shipmentId: shipment.id, response: awb })
  const parsedAwb = extractAwbAssignmentData(awb)
  shipmentLog("info", "awb.assign.parser_diagnostics", {
    orderId,
    shipmentDbId: shipment.id,
    extractionPath: parsedAwb.extractionPath,
    extractedValues: parsedAwb.normalized,
    awbAssignStatus: parsedAwb.awbAssignStatus,
    isAssigned: parsedAwb.isAssigned,
  })
  shipmentConsole("awb.assign.parser_diagnostics", {
    orderId,
    extractionPath: parsedAwb.extractionPath,
    normalized: parsedAwb.normalized,
    awbAssignStatus: parsedAwb.awbAssignStatus,
    isAssigned: parsedAwb.isAssigned,
  })
  shipmentConsole("awb.assign.parsed", {
    orderId,
    awbCode: parsedAwb.awbCode,
    courierName: parsedAwb.courierName,
    courierCompanyId: parsedAwb.courierCompanyId,
    trackingUrl: parsedAwb.trackingUrl,
  })
  if (!parsedAwb.awbCode) {
    shipmentConsole("awb.assign.pending", { orderId, shipmentId: shipment.id, reason: "awb_code_missing" })
    shipmentLog("warn", "awb.partial_or_pending", {
      orderId,
      shipmentId: shipment.id,
      shipmentNo: shipment.shipmentNo,
      courierHint: shipment.courierId ?? null,
      rawAwbResponse: awb,
    })
    await addOrderNote(orderId, "AWB assignment pending from Shiprocket. Shipment created and saved; retry AWB sync.", actorId)
    return { shipmentUpdated: false, reason: "AWB assignment pending", shipment, awb, parsedAwb }
  }

  const estimatedDeliveryDate = parsedAwb.estimatedDeliveryDate ? new Date(parsedAwb.estimatedDeliveryDate) : null

  const freightChargesRaw =
    (awb as Record<string, unknown>).response && typeof (awb as Record<string, unknown>).response === "object"
      ? Number((((awb as Record<string, unknown>).response as Record<string, unknown>).data as Record<string, unknown> | undefined)?.freight_charges ?? 0)
      : null
  const freightChargesValue = Number.isFinite(freightChargesRaw ?? NaN) ? Number(freightChargesRaw) : null
  const shippingStatusValue = parsedAwb.isAssigned ? "AWB_ASSIGNED" : "AWB_PENDING"
  const shippingStatusCodeValue = parsedAwb.isAssigned ? 1 : 0
  const awbUpdateSql = `UPDATE "Shipment"
     SET "trackingNo"=$2,
         "trackingNumber"=$2,
         "awbCode"=$2,
         carrier=COALESCE($3, carrier),
         "shipmentStatus"='ready_to_ship',
         "courierName"=COALESCE($3, "courierName"),
         "courierCompanyId"=COALESCE($4, "courierCompanyId"),
         "freightCharges"=COALESCE($5, "freightCharges"),
         "shippingStatus"=$6,
         "shippingStatusCode"=$7,
         "routingCode"=$8,
         "rtoRoutingCode"=$9,
         "transporterName"=$10,
         "transporterId"=$11,
         "appliedWeight"=$12,
         "assignedDateTime"=$13,
         "awbAssignedAt"=now(),
         "rawShiprocketResponse"=$14::jsonb,
         "updatedAt"=now()
     WHERE id=$1
     RETURNING *`
  const awbUpdateParams = [
    normalizeNullableSqlValue(shipment.id),
    normalizeNullableSqlValue(parsedAwb.awbCode),
    normalizeNullableSqlValue(parsedAwb.courierName),
    normalizeNullableSqlValue(parsedAwb.courierCompanyId),
    normalizeNullableSqlValue(freightChargesValue),
    normalizeNullableSqlValue(shippingStatusValue),
    normalizeNullableSqlValue(shippingStatusCodeValue),
    normalizeNullableSqlValue(parsedAwb.routingCode),
    normalizeNullableSqlValue(parsedAwb.rtoRoutingCode),
    normalizeNullableSqlValue(parsedAwb.transporterName),
    normalizeNullableSqlValue(parsedAwb.transporterId),
    normalizeNullableSqlValue(parsedAwb.appliedWeight ? Number(parsedAwb.appliedWeight) : null),
    normalizeNullableSqlValue(parsedAwb.assignedDateTime ? new Date(parsedAwb.assignedDateTime) : null),
    normalizeNullableSqlValue(JSON.stringify(awb ?? {})),
  ]
  shipmentLog("info", "awb.assign.db_query", {
    orderId,
    shipmentId: shipment.id,
    sql: awbUpdateSql,
    params: awbUpdateParams,
    paramTypes: awbUpdateParams.map((value, index) => ({ index: index + 1, type: getSqlParamType(value) })),
  })
  const updatedRows = await pgQuery(awbUpdateSql, awbUpdateParams).catch((error) => {
    shipmentLog("error", "awb.assign.db_query_failed", {
      orderId,
      shipmentId: shipment.id,
      reason: error instanceof Error ? error.message : "unknown",
      sql: awbUpdateSql,
      params: awbUpdateParams,
      paramDiagnostics: awbUpdateParams.map((value, index) => ({
        index: index + 1,
        value,
        type: getSqlParamType(value),
      })),
    })
    throw error
  })
  const updated = updatedRows[0]
  shipmentConsole("awb.assign.db_updated", {
    orderId,
    shipmentId: updated?.id ?? shipment.id,
    awbCode: parsedAwb.awbCode,
    shippingStatus: "AWB_ASSIGNED",
  })
  await persistExtendedShipmentFields(updated.id, {
    awbCode: parsedAwb.awbCode,
    trackingNo: parsedAwb.awbCode,
    courierId: parsedAwb.courierCompanyId ?? undefined,
    trackingUrl: parsedAwb.trackingUrl ?? undefined,
    estimatedDeliveryDate: estimatedDeliveryDate ?? undefined,
    routingCode: parsedAwb.routingCode ?? undefined,
    rtoRoutingCode: parsedAwb.rtoRoutingCode ?? undefined,
    transporterName: parsedAwb.transporterName ?? undefined,
    transporterId: parsedAwb.transporterId ?? undefined,
    appliedWeight: parsedAwb.appliedWeight ? Number(parsedAwb.appliedWeight) : undefined,
    assignedDateTime: parsedAwb.assignedDateTime ? new Date(parsedAwb.assignedDateTime) : undefined,
    lastSyncAt: new Date(),
  })
  shipmentConsole("awb.assign.persist_extended_success", { orderId, shipmentId: updated.id, awbCode: parsedAwb.awbCode })
  await addOrderNote(orderId, `AWB assigned (${parsedAwb.awbCode})`, actorId)
  logger.info("shiprocket.awb.assigned", {
    orderId,
    shipmentId: shipment.id,
    awbCode: parsedAwb.awbCode,
  })
  logger.info("awb.assigned", {
    orderId,
    shipmentId: shipment.id,
    awbCode: parsedAwb.awbCode,
    shiprocketOrderId: parsedAwb.awbCode ? String((awb as Record<string, unknown>).order_id ?? "") : null,
  })
  return {
    shipmentUpdated: true,
    shipment: updated,
    awb,
    parsedAwb,
    shippingStatus: shippingStatusValue,
    shippingStatusCode: shippingStatusCodeValue,
    freightCharges: freightChargesValue,
  }
}

export const generatePickupForOrderShipment = async (orderId: string, actorId: string) => {
  shipmentConsole("pickup.generate.start", { orderId, actorId })
  const rows = await pgQuery<Array<{ id: string; shipmentNo: string | null; shipmentStatus: string | null }>>(
    `SELECT id, "shipmentNo", "shipmentStatus" FROM "Shipment" WHERE "orderId" = $1 ORDER BY "createdAt" DESC LIMIT 1`,
    [orderId],
  )
  const shipment = rows[0]
  if (!shipment) throw new Error("Shipment not found")
  const shipmentId = Number(shipment.shipmentNo ?? 0)
  console.log(`[shiprocket][pickup.debug] Attempting pickup for shipmentId=${shipmentId}, DB id=${shipment.id}`)
  if (!Number.isFinite(shipmentId) || shipmentId <= 0) {
    console.error(`[shiprocket][pickup.error] Invalid shipment id: "${shipment.shipmentNo}"`)
    throw new Error("Invalid shipment id for pickup")
  }
  const pickup = await shiprocketClient.generatePickup({ shipment_id: shipmentId }).catch(err => {
    console.error(`[shiprocket][pickup.error] Shiprocket API failed:`, err)
    throw err
  })
  console.log(`[shiprocket][pickup.success] Raw Response:`, JSON.stringify(pickup, null, 2))
  shipmentConsole("pickup.generate.raw_response", { orderId, shipmentId: shipment.id, response: pickup })

  const pickupDateRaw =
    asText(getByPath(pickup, "pickup_scheduled_date")) ??
    asText(getByPath(pickup, "response.data.pickup_scheduled_date")) ??
    asText(getByPath(pickup, "data.pickup_scheduled_date")) ??
    null
  console.log(`[shiprocket][pickup.debug] Extracted pickupDateRaw: ${pickupDateRaw}`)
  const pickupDate = pickupDateRaw ? new Date(pickupDateRaw) : null

  const updatedRows = await pgQuery(
    `UPDATE "Shipment" SET "shipmentStatus"=$2, "pickupGeneratedAt"=$3, "updatedAt"=now() WHERE id=$1 RETURNING *`,
    [shipment.id, pickup.pickup_status ?? "pickup_requested", pickupDate],
  )
  const updated = updatedRows[0]
  shipmentConsole("pickup.generate.db_updated", {
    orderId,
    shipmentId: updated?.id ?? shipment.id,
    pickupStatus: pickup.pickup_status ?? "scheduled",
    pickupGeneratedAt: pickupDate,
  })
  await persistExtendedShipmentFields(updated.id, {
    pickupStatus: pickup.pickup_status ?? "scheduled",
    pickupGeneratedAt: pickupDate ?? undefined,
    lastSyncAt: new Date(),
  })
  await addOrderNote(orderId, `Pickup generated (${pickup.pickup_status ?? "scheduled"})`, actorId)
  logger.info("shiprocket.pickup.generated", {
    orderId,
    shipmentId: updated?.id ?? shipment.id,
    pickupStatus: pickup.pickup_status ?? "scheduled",
  })
  return { shipment: updated, pickup }
}

const getOrderSyncEligibility = async (orderId: string) => {
  const rows = await pgQuery<
    Array<{
      id: string
      status: string
      userId: string | null
      paymentMethod: string | null
      paymentStatus: string | null
      shipmentId: string | null
      awbCode: string | null
      isShipmentCreated: boolean | null
      customerAddress: string | null
      customerName: string | null
      customerPhone: string | null
      userEmail: string | null
      items: unknown
      latestLifecycleToStatus: string | null
      txPaid: boolean
      shipmentRowCount: number
    }>
  >(
    `
      SELECT
        o.*,
        u.email as "userEmail",
        COALESCE((
          SELECT jsonb_agg(jsonb_build_object('id', oi.id, 'productId', oi."productId", 'quantity', oi.quantity, 'unitPrice', oi."unitPrice", 'product', jsonb_build_object('weight', p.weight, 'name', p.name, 'slug', p.slug, 'sku', p.sku)))
          FROM "OrderItem" oi
          INNER JOIN "Product" p ON p.id = oi."productId"
          WHERE oi."orderId" = o.id
        ), '[]'::jsonb) as items,
        (
          SELECT h."toStatus"
          FROM "OrderStatusHistory" h
          WHERE h."orderId" = o.id
          ORDER BY h."changedAt" DESC NULLS LAST
          LIMIT 1
        ) AS "latestLifecycleToStatus",
        EXISTS (
          SELECT 1
          FROM "Transaction" t
          WHERE t."orderId" = o.id
            AND upper(trim(coalesce(t.status::text, ''))) IN ('PAID', 'SUCCESS', 'CAPTURED', 'COMPLETED')
        ) AS "txPaid",
        (SELECT COUNT(*)::int FROM "Shipment" s WHERE s."orderId" = o.id) AS "shipmentRowCount"
      FROM "Order" o
      LEFT JOIN "User" u ON u.id = o."userId"
      WHERE o.id = $1
      LIMIT 1
    `,
    [orderId],
  )
  const order = rows[0] as any
  if (!order) return { eligible: false as const, reason: "Order not found" }
  const shipmentCount = Number(order.shipmentRowCount ?? 0)
  const items = Array.isArray(order.items) ? (order.items as any[]) : []
  const latest = String(order.latestLifecycleToStatus ?? order.status ?? "").toLowerCase()
  const payment = (order.paymentStatus ?? "").toUpperCase()
  const paymentMethod = (order.paymentMethod ?? "").toLowerCase()
  const parsedAddress = parseAddressParts(order.customerAddress)

  const validationPayload = {
    customerName: normalizeOptionalText(order.customerName),
    customerPhone: normalizePhone(order.customerPhone),
    customerEmail: normalizeEmail(order.userEmail),
    shippingAddress1: normalizeOptionalText(parsedAddress.line1),
    shippingCity: normalizeOptionalText(parsedAddress.city),
    shippingState: normalizeOptionalText(parsedAddress.state),
    shippingPostcode: normalizeOptionalText(parsePostalCode(order.customerAddress) ?? parsedAddress.pincode),
  }

  shipmentConsole("sync.eligibility.order_hydrated", {
    orderId,
    order: {
      id: order.id,
      status: order.status,
      paymentStatus: order.paymentStatus,
      paymentMethod: order.paymentMethod,
      userId: order.userId ?? null,
      customerName: order.customerName ?? null,
      customerPhone: maskSensitive(normalizePhone(order.customerPhone)),
      customerAddress: order.customerAddress ?? null,
      userEmail: maskSensitive(normalizeEmail(order.userEmail)),
      shipmentId: order.shipmentId ?? null,
      awbCode: order.awbCode ?? null,
      isShipmentCreated: order.isShipmentCreated ?? null,
      shipmentRows: shipmentCount,
      itemsCount: items.length,
    },
  })
  shipmentConsole("sync.eligibility.validation_payload", {
    orderId,
    validationPayload: {
      ...validationPayload,
      customerPhone: maskSensitive(validationPayload.customerPhone),
      customerEmail: maskSensitive(validationPayload.customerEmail),
    },
  })
  shipmentLog("info", "sync.eligibility.validation_payload", {
    orderId,
    validationPayload: {
      ...validationPayload,
      customerPhone: maskSensitive(validationPayload.customerPhone),
      customerEmail: maskSensitive(validationPayload.customerEmail),
    },
  })

  if (["cancelled", "delivered", "returned"].includes(latest)) return { eligible: false as const, reason: "Order already closed" }
  if (isShipmentFullySynced(order)) {
    return { eligible: false as const, reason: "shipment already exists" }
  }
  if (shipmentCount > 0 && !isShipmentFullySynced(order)) {
    shipmentLog("warn", "sync.partial_state_detected", {
      orderId,
      shipmentRows: shipmentCount,
      shipmentId: order.shipmentId ?? null,
      awbCode: order.awbCode ?? null,
      isShipmentCreated: order.isShipmentCreated ?? null,
    })
  }
  if (!items.length) return { eligible: false as const, reason: "No order items" }
  const missingFields: string[] = []
  if (!validationPayload.shippingAddress1) missingFields.push("shippingAddress1")
  if (!validationPayload.shippingCity) missingFields.push("shippingCity")
  if (!validationPayload.shippingState) missingFields.push("shippingState")
  if (!validationPayload.shippingPostcode) missingFields.push("shippingPostcode")
  if (!validationPayload.customerName) missingFields.push("customerName")
  if (!validationPayload.customerPhone) missingFields.push("customerPhone")
  if (!validationPayload.customerEmail) missingFields.push("customerEmail")
  if (missingFields.some((f) => f.startsWith("shipping"))) {
    return {
      eligible: false as const,
      reason: "invalid address",
      missingFields,
      validationPayload,
    }
  }
  if (missingFields.some((f) => ["customerName", "customerPhone", "customerEmail"].includes(f))) {
    return {
      eligible: false as const,
      reason: "missing customer info",
      missingFields,
      validationPayload,
    }
  }
  if (latest === "admin_approval_pending") {
    return { eligible: false as const, reason: "admin approval pending" }
  }
  const accepted = ["confirmed", "packed", "shipped"].includes(latest)
  if (!accepted) return { eligible: false as const, reason: "order not confirmed" }
  const prepaidPaid =
    order.txPaid === true ||
    ["SUCCESS", "PAID", "CAPTURED", "COMPLETED", "SUCCEEDED"].includes(payment)
  const paidOrCodApproved = paymentMethod === "cod" || prepaidPaid
  if (!paidOrCodApproved) return { eligible: false as const, reason: "invalid payment state" }
  return { eligible: true as const, order }
}

export const syncOrderToShiprocket = async (orderId: string, actorId: string, options?: { generatePickup?: boolean }) => {
  shipmentConsole("sync.start", { orderId, actorId, generatePickup: options?.generatePickup !== false })
  shipmentLog("info", "sync.started", { orderId, actorId, generatePickup: options?.generatePickup !== false })
  const eligibility = await getOrderSyncEligibility(orderId)
  if (!eligibility.eligible) {
    shipmentConsole("sync.skipped", { orderId, reason: eligibility.reason, skippedReason: resolveSkippedReason(eligibility.reason) })
    shipmentLog("warn", "sync.skipped", {
      orderId,
      skippedReason: resolveSkippedReason(eligibility.reason),
      reason: eligibility.reason,
      missingFields: "missingFields" in eligibility ? (eligibility as { missingFields?: string[] }).missingFields ?? [] : [],
      validationPayload:
        "validationPayload" in eligibility
          ? (eligibility as { validationPayload?: Record<string, unknown> }).validationPayload ?? {}
          : {},
    })
    return {
      status: "skipped" as const,
      orderId,
      reason: eligibility.reason,
      skippedReason: resolveSkippedReason(eligibility.reason),
      missingFields: "missingFields" in eligibility ? (eligibility as { missingFields?: string[] }).missingFields ?? [] : [],
      validationPayload:
        "validationPayload" in eligibility
          ? (eligibility as { validationPayload?: Record<string, unknown> }).validationPayload ?? {}
          : {},
    }
  }
  shipmentLog("info", "sync.eligibility_passed", { orderId })
  shipmentConsole("sync.eligibility_passed", { orderId })
  try {
    const stageTrace: Array<{ stage: SyncLifecycleStage; action: string }> = []
    let current = await fetchLatestSyncState(orderId)
    shipmentLog("info", "sync.stage.detected", {
      orderId,
      stage: current.stage,
      shipmentRowId: current.shipment?.id ?? null,
      shipmentId: current.order?.shipmentId ?? current.shipment?.shipmentNo ?? null,
      awbCode: current.order?.awbCode ?? current.shipment?.trackingNo ?? null,
      pickupStatus: current.order?.pickupStatus ?? current.shipment?.pickupStatus ?? current.shipment?.shipmentStatus ?? null,
    })
    shipmentConsole("sync.stage.detected", { orderId, stage: current.stage })

    let created: Awaited<ReturnType<typeof createShiprocketShipmentForOrder>> | null = null
    let awb: Awaited<ReturnType<typeof assignAwbForOrderShipment>> | null = null
    let pickup: Awaited<ReturnType<typeof generatePickupForOrderShipment>> | null = null

    if (current.stage === "NO_SHIPMENT") {
      stageTrace.push({ stage: current.stage, action: "create_shipment" })
      shipmentLog("info", "sync.stage.continuing", { orderId, currentStage: current.stage, nextStage: "create_shipment" })
      shipmentConsole("sync.stage.continuing", { orderId, currentStage: current.stage, nextStage: "create_shipment" })
      try {
        created = await runWithTransientRetry(() => createShiprocketShipmentForOrder(orderId, actorId), 1)
      } catch (error) {
        const message = error instanceof Error ? error.message : "unknown"
        if (message.toLowerCase().includes("shipment already exists")) {
          shipmentLog("warn", "sync.stage.continuing", {
            orderId,
            currentStage: current.stage,
            nextStage: "continue_from_existing_shipment",
            reason: "duplicate_shipment_detected",
          })
          shipmentConsole("sync.stage.continuing", {
            orderId,
            currentStage: current.stage,
            nextStage: "continue_from_existing_shipment",
            reason: "duplicate_shipment_detected",
          })
        } else {
          throw error
        }
      }
      current = await fetchLatestSyncState(orderId)
      shipmentLog("info", "sync.stage.detected", { orderId, stage: current.stage, after: "create_shipment" })
      shipmentConsole("sync.stage.detected", { orderId, stage: current.stage, after: "create_shipment" })
      if (created && (created.partial === true || !created.shipment)) {
        shipmentLog("warn", "sync.partial_success", {
          orderId,
          stage: "shipment_created_partial",
          extracted: created.extracted,
        })
        return {
          status: "synced" as const,
          orderId,
          partial: true,
          stage: "shipment_created_partial",
          created,
          reason: "Shipment created response was partial; snapshot persisted for recovery",
          syncTime: new Date().toISOString(),
        }
      }
    }

    if (current.stage === "AWB_PENDING" || current.stage === "SHIPMENT_CREATED") {
      stageTrace.push({ stage: current.stage, action: "assign_awb" })
      shipmentLog("info", "sync.stage.continuing", { orderId, currentStage: current.stage, nextStage: "assign_awb" })
      shipmentConsole("sync.stage.continuing", { orderId, currentStage: current.stage, nextStage: "assign_awb" })
      awb = await assignAwbForOrderShipment(orderId, actorId)
      shipmentConsole("sync.awb_result", {
        orderId,
        shipmentUpdated: awb.shipmentUpdated,
        reason: awb.reason ?? null,
        awbCode: awb.parsedAwb?.awbCode ?? null,
      })
      current = await fetchLatestSyncState(orderId)
      shipmentLog("info", "sync.stage.detected", { orderId, stage: current.stage, after: "assign_awb" })
      shipmentConsole("sync.stage.detected", { orderId, stage: current.stage, after: "assign_awb" })
      if (!awb.shipmentUpdated) {
        shipmentLog("warn", "sync.partial_success", {
          orderId,
          stage: "awb_pending",
          reason: awb.reason ?? "AWB assignment pending",
        })
        return {
          status: "synced" as const,
          orderId,
          partial: true,
          stage: "awb_pending",
          created,
          awb,
          reason: awb.reason ?? "AWB assignment pending",
          syncTime: new Date().toISOString(),
        }
      }
    }

    if (options?.generatePickup !== false && current.stage === "PICKUP_PENDING") {
      console.log(`[shiprocket][sync.lifecycle] Stage: PICKUP_PENDING, generating pickup for order ${orderId}`)
      stageTrace.push({ stage: current.stage, action: "generate_pickup" })
      shipmentLog("info", "sync.stage.continuing", { orderId, currentStage: current.stage, nextStage: "generate_pickup" })
      shipmentConsole("sync.stage.continuing", { orderId, currentStage: current.stage, nextStage: "generate_pickup" })
      pickup = await generatePickupForOrderShipment(orderId, actorId)
      shipmentConsole("sync.pickup_result", {
        orderId,
        pickupGenerated: Boolean(pickup),
        pickupStatus: pickup?.pickup?.pickup_status ?? null,
      })
      current = await fetchLatestSyncState(orderId)
      shipmentLog("info", "sync.stage.detected", { orderId, stage: current.stage, after: "generate_pickup" })
      shipmentConsole("sync.stage.detected", { orderId, stage: current.stage, after: "generate_pickup" })
    }

    shipmentLog("info", "sync.stage.completed", {
      orderId,
      finalStage: current.stage,
      stageTrace,
      skippedStages: [
        options?.generatePickup === false ? "generate_pickup" : null,
      ].filter(Boolean),
    })
    shipmentConsole("sync.stage.completed", {
      orderId,
      finalStage: current.stage,
      stageTrace,
    })
    shipmentLog("info", "sync.success", {
      orderId,
      shipmentId: current.shipment?.id ?? created?.shipment?.id ?? null,
      awb:
        current.order?.awbCode ??
        current.shipment?.trackingNo ??
        awb?.parsedAwb?.awbCode ??
        null,
    })
    return {
      status: "synced" as const,
      orderId,
      created,
      awb,
      pickup,
      syncTime: new Date().toISOString(),
    }
  } catch (error) {
    shipmentConsole("sync.failed", { orderId, error: error instanceof Error ? error.message : "unknown" })
    const parsed = summarizeError(error)
    const message = parsed.message
    await addOrderNote(orderId, `Shiprocket sync failed: ${message}`, actorId)
    shipmentLog("error", "sync.failure", {
      orderId,
      stage: "shipment_sync",
      reason: message,
      ...parsed,
    })
    return {
      status: "failed" as const,
      orderId,
      reason: message,
      stage: "shipment_sync",
      httpStatus: "httpStatus" in parsed ? parsed.httpStatus : undefined,
      shiprocketResponse: "shiprocketBody" in parsed ? parsed.shiprocketBody : undefined,
      syncTime: new Date().toISOString(),
    }
  }
}

export const debugSingleShipment = async (orderId: string, actorId: string) => {
  shipmentConsole("debug_single.start", { orderId, actorId })
  shipmentLog("info", "debug_single.started", { orderId, actorId })
  const eligibility = await getOrderSyncEligibility(orderId)
  if (!eligibility.eligible) {
    const skippedReason = resolveSkippedReason(eligibility.reason)
    shipmentLog("warn", "debug_single.skipped", { orderId, skippedReason, reason: eligibility.reason })
    return {
      success: false,
      orderId,
      stage: "eligibility_check",
      reason: eligibility.reason,
      skippedReason,
    }
  }
  try {
    const serviceability = await checkOrderServiceability(orderId)
    const created = await createShiprocketShipmentForOrder(orderId, actorId)
    const awb = await assignAwbForOrderShipment(orderId, actorId)
    const pickup = await generatePickupForOrderShipment(orderId, actorId)
    return {
      success: true,
      orderId,
      stage: "completed",
      serviceability: {
        availableCouriers: serviceability.response.available_couriers.length,
        weight: serviceability.weight,
      },
      created,
      awb,
      pickup,
    }
  } catch (error) {
    shipmentConsole("debug_single.failed", { orderId, error: error instanceof Error ? error.message : "unknown" })
    const parsed = summarizeError(error)
    return {
      success: false,
      orderId,
      stage: "shipment_creation",
      reason: parsed.message,
      shiprocketResponse: "shiprocketBody" in parsed ? parsed.shiprocketBody : undefined,
      httpStatus: "httpStatus" in parsed ? parsed.httpStatus : undefined,
    }
  }
}

export const syncBulkOrders = async (
  orderIds: string[],
  actorId: string,
  options?: { generatePickup?: boolean; retryFailedOnly?: boolean },
) => {
  shipmentConsole("bulk_sync.start", { totalRequested: orderIds.length, retryFailedOnly: options?.retryFailedOnly === true })
  shipmentLog("info", "bulk_sync.started", { totalRequested: orderIds.length, retryFailedOnly: options?.retryFailedOnly === true })
  const unique = [...new Set(orderIds)]
  const results = [] as Array<Awaited<ReturnType<typeof syncOrderToShiprocket>>>
  for (const orderId of unique) {
    const result = await syncOrderToShiprocket(orderId, actorId, options)
    if (options?.retryFailedOnly && result.status !== "failed") continue
    results.push(result)
  }
  const synced = results.filter((r) => r.status === "synced").length
  const failed = results.filter((r) => r.status === "failed").length
  const skipped = results.filter((r) => r.status === "skipped").length
  const summary = {
    total: results.length,
    synced,
    failed,
    skipped,
    results,
  }
  shipmentConsole("bulk_sync.completed", summary)
  shipmentLog("info", "bulk_sync.completed", summary)
  return summary
}
