import { NextRequest } from "next/server"
import { z } from "zod"
import { fail, ok } from "@/src/server/core/http/response"
import { requireAuth } from "@/src/server/middleware/auth"
import { requirePermission } from "@/src/server/middleware/rbac"
import {
  advanceOrderToShipped,
  createManualShipment,
  markShipmentInTransit,
  setAdminShipmentStatus,
  setManualOrderStatus,
} from "@/src/server/modules/orders/order-fulfillment.service"

const schema = z.object({
  action: z.enum(["mark_shipped", "pickup_done", "manual_shipment", "set_shipment_status", "set_order_status"]),
  trackingId: z.string().optional(),
  trackingUrl: z.string().optional(),
  courierName: z.string().optional(),
  slipUrl: z.string().optional(),
  shipmentStatus: z.enum(["shipped", "in_transit", "out_for_delivery", "delivered", "cancelled"]).optional(),
  orderStatus: z.enum(["confirmed", "packed", "shipped", "in_transit", "out_for_delivery", "delivered"]).optional(),
})

export async function POST(request: NextRequest, ctx: { params: Promise<{ id: string }> }) {
  const auth = requireAuth(request)
  if ("status" in auth) return auth
  const forbidden = requirePermission(auth.user.role, "orders.update")
  if (forbidden) return forbidden
  const { id } = await ctx.params
  const parsed = schema.safeParse(await request.json().catch(() => ({})))
  if (!parsed.success) return fail("Validation failed", 422, parsed.error.flatten())

  try {
    if (parsed.data.action === "mark_shipped") {
      return ok(await advanceOrderToShipped(id, auth.user.sub), "Order moved to shipped")
    }
    if (parsed.data.action === "pickup_done") {
      return ok(await markShipmentInTransit(id, auth.user.sub, "Pickup completed"), "Order moved to in transit")
    }
    if (parsed.data.action === "manual_shipment") {
      const created = await createManualShipment({
        orderId: id,
        actorId: auth.user.sub,
        trackingId: parsed.data.trackingId ?? "",
        trackingUrl: parsed.data.trackingUrl ?? "",
        courierName: parsed.data.courierName,
        slipUrl: parsed.data.slipUrl,
      })
      return ok(created, "Manual shipment saved")
    }
    if (parsed.data.action === "set_order_status") {
      if (!parsed.data.orderStatus) return fail("Order status is required", 422)
      return ok(await setManualOrderStatus(id, parsed.data.orderStatus, auth.user.sub), "Order status updated")
    }
    if (!parsed.data.shipmentStatus) return fail("Shipment status is required", 422)
    return ok(await setAdminShipmentStatus(id, parsed.data.shipmentStatus, auth.user.sub), "Shipment status updated")
  } catch (error) {
    return fail(error instanceof Error ? error.message : "Fulfillment update failed", 400)
  }
}
