import { NextRequest } from "next/server"
import { z } from "zod"
import { fail, ok } from "@/src/server/core/http/response"
import { requireAuth } from "@/src/server/middleware/auth"
import { requirePermission } from "@/src/server/middleware/rbac"
import {
  assignShipmentAwb,
  createShiprocketShipment,
  debugSingleOrderShipment,
  generateShipmentLabel,
  generateShipmentPickup,
  getCourierOptions,
  retryShiprocketShipmentSync,
  repairShipmentState,
  safeSyncOrderShipmentToShiprocket,
} from "@/src/server/modules/shipping/shiprocket.orders"
import { syncShipmentTracking } from "@/src/server/modules/shipping/shiprocket.tracking"
import { getShiprocketClientConfig } from "@/src/server/modules/shipping/shiprocket.service"
import { assessPackageMeasures } from "@/src/server/modules/shipping/package-measures"

const schema = z.object({
  action: z.enum([
    "serviceability",
    "create_shipment",
    "assign_awb",
    "generate_label",
    "generate_pickup",
    "sync_order",
    "resync_order",
    "retry_shipment_sync",
    "refresh_tracking",
    "regenerate_tracking_data",
    "debug_single_shipment",
    "repair_shipment_state",
    "fetch_invoice",
  ]),
  generatePickup: z.boolean().optional(),
  panelSync: z.boolean().optional(),
  forceResync: z.boolean().optional(),
  courierId: z.number().int().positive().optional(),
  confirmLargePackage: z.boolean().optional(),
  package: z.object({
    weightKg: z.number().positive().max(30),
    lengthCm: z.number().positive().max(200),
    widthCm: z.number().positive().max(200),
    heightCm: z.number().positive().max(200),
  }).optional(),
})

export async function GET(request: NextRequest, ctx: { params: Promise<{ id: string }> }) {
  const auth = requireAuth(request)
  if ("status" in auth) return auth
  const forbidden = requirePermission(auth.user.role, "orders.read")
  if (forbidden) return forbidden
  const { id } = await ctx.params
  try {
    const serviceability = await getCourierOptions(id)
    return ok(
      {
        orderId: id,
        mode: getShiprocketClientConfig().mode,
        availableCouriers: serviceability.availableCouriers,
        weight: serviceability.weight,
        lengthCm: serviceability.lengthCm,
        widthCm: serviceability.widthCm,
        heightCm: serviceability.heightCm,
      },
      "Serviceability fetched",
    )
  } catch (error) {
    return fail(error instanceof Error ? error.message : "Serviceability check failed", 400)
  }
}

export async function POST(request: NextRequest, ctx: { params: Promise<{ id: string }> }) {
  const auth = requireAuth(request)
  if ("status" in auth) return auth
  const forbidden = requirePermission(auth.user.role, "orders.update")
  if (forbidden) return forbidden
  const { id } = await ctx.params
  const body = await request.json().catch(() => ({}))
  const parsed = schema.safeParse(body)
  if (!parsed.success) return fail("Validation failed", 422, parsed.error.flatten())

  try {
    if (parsed.data.action === "serviceability") {
      const data = await getCourierOptions(id)
      return ok(
        {
          mode: getShiprocketClientConfig().mode,
          availableCouriers: data.availableCouriers,
          weight: data.weight,
          lengthCm: data.lengthCm,
          widthCm: data.widthCm,
          heightCm: data.heightCm,
        },
        "Serviceability checked",
      )
    }
    if (parsed.data.action === "create_shipment") {
      if (!parsed.data.package) return fail("Package weight and dimensions are required", 422)
      const review = assessPackageMeasures(parsed.data.package)
      if (!review.ok) return fail(review.reason ?? "Package details are invalid", 422)
      if (review.requiresConfirmation && parsed.data.confirmLargePackage !== true) {
        return fail(review.reason ?? "Confirm the package dimensions before creating the shipment.", 422)
      }
      const data = await createShiprocketShipment(id, auth.user.sub, parsed.data.package)
      return ok(data, "Shipment created")
    }
    if (parsed.data.action === "assign_awb") {
      const data = await assignShipmentAwb(id, auth.user.sub, parsed.data.courierId)
      if (!data.shipmentUpdated) return fail(data.reason || "AWB was not assigned", 400)
      const awbCode = data.parsedAwb?.awbCode ?? data.shipment?.trackingNo ?? ""
      return ok(data, awbCode ? `AWB ${awbCode} assigned` : "AWB assigned")
    }
    if (parsed.data.action === "generate_label") {
      const data = await generateShipmentLabel(id, auth.user.sub)
      return ok(data, "Shipping label ready")
    }
    if (parsed.data.action === "sync_order" || parsed.data.action === "resync_order" || parsed.data.action === "retry_shipment_sync") {
      const data =
        parsed.data.action === "retry_shipment_sync"
          ? await retryShiprocketShipmentSync(id, auth.user.sub)
          : await safeSyncOrderShipmentToShiprocket(id, auth.user.sub, {
              generatePickup: parsed.data.panelSync === true ? false : parsed.data.generatePickup !== false,
              forceResync: parsed.data.forceResync === true || parsed.data.action === "resync_order",
              panelSync: parsed.data.panelSync === true,
            })
      const normalized = {
        success: data.status !== "failed",
        orderId: id,
        shipmentId:
          (data as { created?: { extracted?: { shipmentId?: string | null } } }).created?.extracted?.shipmentId ??
          null,
        awbCode:
          (data as { awb?: { parsedAwb?: { awbCode?: string | null } } }).awb?.parsedAwb?.awbCode ?? null,
        courierName:
          (data as { awb?: { parsedAwb?: { courierName?: string | null } } }).awb?.parsedAwb?.courierName ?? null,
        trackingUrl:
          (data as { awb?: { parsedAwb?: { trackingUrl?: string | null } } }).awb?.parsedAwb?.trackingUrl ?? null,
        estimatedDeliveryDate:
          (data as { awb?: { parsedAwb?: { estimatedDeliveryDate?: string | null } } }).awb?.parsedAwb?.estimatedDeliveryDate ?? null,
        shippingStatus:
          (data as { awb?: { shipmentUpdated?: boolean } }).awb?.shipmentUpdated === true ? "AWB_ASSIGNED" : "PROCESSING",
        raw: data,
      }
      if (data.status === "failed") {
        return fail((data as { reason?: string }).reason || "Shiprocket sync failed", 400, normalized)
      }
      return ok(normalized, parsed.data.action === "resync_order" ? "Order re-sync completed" : "Order sync completed")
    }
    if (parsed.data.action === "repair_shipment_state") {
      const data = await repairShipmentState(id)
      if (data.success) return ok(data, "Shipment state repaired")
      return fail("Shipment state repair failed", 400, data)
    }
    if (parsed.data.action === "debug_single_shipment") {
      const data = await debugSingleOrderShipment(id, auth.user.sub)
      if (data.success) return ok(data, "Single-order Shiprocket debug completed")
      return fail("Shiprocket debug failed", 400, data)
    }
    if (parsed.data.action === "refresh_tracking" || parsed.data.action === "regenerate_tracking_data") {
      const data = await syncShipmentTracking(id)
      return ok(data, parsed.data.action === "regenerate_tracking_data" ? "Tracking data regenerated" : "Tracking refreshed")
    }
    if (parsed.data.action === "fetch_invoice") {
      const { getOrderWithOpsRelationsSupabase } = await import("@/src/lib/db/orders")
      const { shiprocketClient } = await import("@/lib/integrations/shiprocket")
      const orderRecord = await getOrderWithOpsRelationsSupabase(id)
      if (!orderRecord) return fail("Order not found", 404)

      const raw = (orderRecord as any).shiprocketRawResponse
      let srOrderId = (orderRecord as any).shiprocketOrderId
      if (!srOrderId && raw) {
        srOrderId = raw.order_id ?? raw.orderId ?? raw.data?.order_id
      }
      const numericSrOrderId = Number(srOrderId)
      if (!Number.isFinite(numericSrOrderId) || numericSrOrderId <= 0) {
        return fail("Shiprocket Order ID not found for this order. Please sync order to Shiprocket first.", 400)
      }

      const res = await shiprocketClient.generateInvoice([numericSrOrderId])
      const invoiceUrl = res.invoice_url || (res as any).invoice_pdf_url || (res as any).pdf_url || (res as any).result?.invoice_url
      if (!invoiceUrl) {
        return fail((res as any).message || "Invoice not yet generated by Shiprocket", 400, res)
      }
      return ok({ invoiceUrl }, "Shiprocket invoice generated successfully")
    }
    const pickup = await generateShipmentPickup(id, auth.user.sub)
    return ok(pickup, pickup.alreadyRequested ? "Pickup was already requested. The saved status now matches Shiprocket." : "Pickup requested")
  } catch (error) {
    return fail(error instanceof Error ? error.message : "Shiprocket action failed", 400)
  }
}
