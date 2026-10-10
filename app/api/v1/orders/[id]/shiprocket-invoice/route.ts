import { NextRequest } from "next/server"
import { fail, ok } from "@/src/server/core/http/response"
import { requireAuth } from "@/src/server/middleware/auth"
import { requirePermission } from "@/src/server/middleware/rbac"
import { getOrderForActor } from "@/src/server/modules/orders/orders.service"
import { fetchShiprocketInvoiceUrl } from "@/src/server/modules/shipping/shiprocket-invoice"
import { isOrderShipped } from "@/src/lib/orders/order-shipped"
import { getOrderWithOpsRelationsSupabase } from "@/src/lib/db/orders"

export async function POST(request: NextRequest, ctx: { params: Promise<{ id: string }> }) {
  const auth = requireAuth(request)
  if ("status" in auth) return auth
  const forbidden = requirePermission(auth.user.role, "orders.read")
  if (forbidden) return forbidden

  const { id } = await ctx.params
  const order = await getOrderForActor(id, auth.user.role, auth.user.sub)
  if (!order) return fail("Order not found", 404)

  const ops = await getOrderWithOpsRelationsSupabase(id)
  const shipped = isOrderShipped({
    status: String(order.status ?? ""),
    shipmentStatus: (order as { shipmentStatus?: string | null }).shipmentStatus ?? (ops as { shipmentStatus?: string | null } | null)?.shipmentStatus,
    statusHistory: order.statusHistory,
    shipments: (ops as { shipments?: Array<{ shipmentStatus?: string | null }> } | null)?.shipments,
  })
  if (!shipped) return fail("Invoice is available after the order is shipped", 400)

  try {
    const invoiceUrl = await fetchShiprocketInvoiceUrl(id)
    return ok({ invoiceUrl }, "Shiprocket invoice generated successfully")
  } catch (error) {
    return fail(error instanceof Error ? error.message : "Failed to fetch Shiprocket invoice", 400)
  }
}
