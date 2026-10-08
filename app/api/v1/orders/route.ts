import { NextRequest } from "next/server"
import { fail, ok } from "@/src/server/core/http/response"
import { requireAuth } from "@/src/server/middleware/auth"
import { optionalAuth } from "@/src/server/middleware/optionalAuth"
import { requirePermission } from "@/src/server/middleware/rbac"
import { checkRateLimit } from "@/src/server/middleware/rateLimit"
import { createOrderSchema } from "@/src/server/modules/orders/orders.validator"
import { createOrderFromCheckout, listOrders } from "@/src/server/modules/orders/orders.service"

export async function GET(request: NextRequest) {
  const auth = requireAuth(request)
  if ("status" in auth) return auth

  const forbidden = requirePermission(auth.user.role, "orders.read")
  if (forbidden) return forbidden

  const page = Number(request.nextUrl.searchParams.get("page") ?? "1")
  const limit = Number(request.nextUrl.searchParams.get("limit") ?? "1000")

  try {
    const data = await listOrders(page, limit, auth.user.role, auth.user.sub)
    return ok(data, "Orders fetched")
  } catch (error) {
    const message = error instanceof Error ? error.message : "Orders load failed"
    return fail(message, 500)
  }
}

export async function POST(request: NextRequest) {
  const blocked = checkRateLimit(request, "orders:create", { limit: 15, windowMs: 60_000 })
  if (blocked) return blocked

  try {
    const user = optionalAuth(request)
    const body = await request.json()
    const parsed = createOrderSchema.safeParse(body)
    if (!parsed.success) {
      return fail("Validation failed", 422, parsed.error.flatten())
    }

    const userId = user?.role === "customer" ? user.sub : null

    const order = await createOrderFromCheckout({
      items: parsed.data.items,
      userId,
      shipping: parsed.data.shippingCharge ?? parsed.data.shipping,
      currency: parsed.data.currency,
      couponCode: parsed.data.couponCode,
      appliedCouponId: parsed.data.couponId ?? parsed.data.appliedCouponId ?? null,
      gateway: parsed.data.gateway,
      subtotal: parsed.data.subtotal,
      discount: parsed.data.discount,
      tax: parsed.data.tax,
      total: parsed.data.total,
      savingAmount: parsed.data.savingAmount ?? 0,

      // 🔥 NEW FIELDS
      billingAddress: parsed.data.billingAddress,
      paymentStatus: parsed.data.paymentStatus,
      paymentId: parsed.data.paymentId,
      sessionKey: parsed.data.sessionKey ?? null,
      totalItemsUsedForShipping: parsed.data.totalItemsUsedForShipping ?? null,
    })

    return ok(order, "Order created", 201)
  } catch (error) {
    const message = error instanceof Error ? error.message : "Unexpected error"
    return fail(message, 400)
  }
}
