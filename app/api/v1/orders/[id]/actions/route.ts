import { NextRequest } from "next/server"
import { z } from "zod"
import { fail, ok } from "@/src/server/core/http/response"
import { requireAuth } from "@/src/server/middleware/auth"
import {
  getOrderById,
  releaseOrderInventory,
  setOrderCancelReason,
  setOrderReturnReason,
  triggerShiprocketAutoSync,
  updateOrderStatus,
} from "@/src/server/modules/orders/orders.service"
import {
  cancelCustomerOrderWithShiprocketGate,
  OrderCancellationError,
} from "@/src/server/modules/orders/order-cancellation.service"
import { createRefund, updateRefundStatus } from "@/src/server/modules/extended/extended.service"
import { triggerRazorpayRefund } from "@/src/server/modules/payments/payments.service"
import { env } from "@/src/server/core/config/env"
import { getSupabaseAdmin } from "@/src/lib/supabase/admin"

const schema = z.object({
  action: z.enum([
    "cancel_request",
    "cancel_pending",
    "delete_unpaid",
    "return_request",
    "approve_order",
    "reject_order",
    "approve_cancel",
    "reject_cancel",
    "approve_return",
    "reject_return",
    "trigger_refund",
    "retry_refund",
  ]),
  reason: z.string().max(500).optional(),
  amount: z.number().positive().optional(),
})

const normalizePaymentStatus = (value?: string | null) => {
  const status = (value ?? "").toUpperCase()
  if (status === "PAID") return "SUCCESS"
  return status || "PENDING"
}

export async function POST(request: NextRequest, ctx: { params: Promise<{ id: string }> }) {
  const auth = requireAuth(request)
  if ("status" in auth) return auth
  const { id } = await ctx.params
  const body = await request.json()
  const parsed = schema.safeParse(body)
  if (!parsed.success) return fail("Validation failed", 422, parsed.error.flatten())

  const order = await getOrderById(id)
  if (!order) return fail("Order not found", 404)
  const lifecycleStatus = String(order.statusHistory?.[0]?.toStatus ?? order.status ?? "").toLowerCase()
  const isAdmin = ["admin", "super_admin"].includes(auth.user.role)
  if (!isAdmin && order.userId !== auth.user.sub) {
    return fail("Forbidden", 403)
  }

  try {
    if (parsed.data.action === "cancel_request") {
      const paymentStatus = normalizePaymentStatus(order.paymentStatus)
      const { updated } = await cancelCustomerOrderWithShiprocketGate({
        orderId: order.id,
        actorId: auth.user.sub,
        reasonCode: "customer_cancelled",
        note: parsed.data.reason ?? "Customer cancelled order",
        latestLifecycle: lifecycleStatus,
      })

      if (paymentStatus === "SUCCESS") {
        const amount = Number(order.total)
        const refund = await createRefund(order.id, amount, "Customer auto-cancellation refund")
        await triggerRazorpayRefund({ refundRecordId: refund.id }).catch((e) => {
          console.error("[Auto-Refund Error] Failed to trigger Razorpay refund", e)
        })
      }

      return ok(updated, "Order cancelled successfully")
    }
    if (parsed.data.action === "cancel_pending") {
      const { updated } = await cancelCustomerOrderWithShiprocketGate({
        orderId: order.id,
        actorId: auth.user.sub,
        reasonCode: "cancel_pending",
        note: parsed.data.reason ?? "Customer cancelled pending order",
        latestLifecycle: lifecycleStatus,
      })

      return ok(updated ?? { id: order.id }, "Pending order cancelled")
    }
    if (parsed.data.action === "delete_unpaid") {
      const paymentStatus = normalizePaymentStatus(order.paymentStatus)
      if (paymentStatus === "SUCCESS") {
        return fail("Cannot delete a paid order", 400)
      }

      // Prohibit deleting COD orders
      const paymentMethod = String(order.paymentMethod ?? "").trim().toLowerCase()
      if (paymentMethod === "cod") {
        return fail("Cannot delete a Cash on Delivery order", 400)
      }

      const client = getSupabaseAdmin()
      const orderId = order.id

      // Clean up all related rows to prevent foreign key violations
      await client.from("OrderItem").delete().eq("orderId", orderId)
      await client.from("Transaction").delete().eq("orderId", orderId)
      await client.from("OrderStatusHistory").delete().eq("orderId", orderId)
      await client.from("Order").delete().eq("id", orderId)

      return ok({ id: orderId }, "Unpaid order deleted successfully")
    }
    if (parsed.data.action === "return_request") {
      if (lifecycleStatus !== "delivered") return fail("Return is allowed only for delivered orders", 422)
      const deliveredAt = order.statusHistory.find((entry) => entry.toStatus === "delivered")?.changedAt ?? order.updatedAt ?? new Date()
      const returnWindowDays = Number(env.RETURN_WINDOW_DAYS ?? "7")
      const elapsedDays = (Date.now() - new Date(deliveredAt).getTime()) / (1000 * 60 * 60 * 24)
      if (elapsedDays > returnWindowDays) {
        return fail(`Return window expired (${returnWindowDays} days)`, 422)
      }
      const updated = await updateOrderStatus(order.id, "return_requested", auth.user.sub, {
        reasonCode: "return_requested",
        note: parsed.data.reason ?? "Customer requested return",
      })
      if (parsed.data.reason?.trim()) {
        await setOrderReturnReason(order.id, parsed.data.reason.trim())
      }
      return ok(updated, "Return requested")
    }

    if (!isAdmin) return fail("Forbidden", 403)

    if (parsed.data.action === "approve_order") {
      if (lifecycleStatus !== "admin_approval_pending") {
        return fail(`Order cannot be approved from status "${lifecycleStatus}". Only pending approval orders can be approved.`, 422)
      }
      if (!order.items || order.items.length === 0) {
        return fail("Order has no items", 422)
      }
      const stockCheck = order.items.every((item) => {
        const row = item as any
        const qty = Number(row.quantity ?? 0)
        if (qty <= 0) return false
        if (row.variantId || row.product?.type === "variant") {
          const vStock = row.variant?.stock != null
            ? Number(row.variant.stock)
            : (row.product?.variants ?? []).find((v: any) => v.id === row.variantId)?.stock
          if (vStock != null) return Number(vStock) >= 0
          return Boolean(row.variant)
        }
        if (row.product?.totalStock != null) {
          return Number(row.product.totalStock) >= 0
        }
        return Boolean(row.product && row.product.name !== "Deleted product")
      })
      const serviceableCheck = Boolean(order.customerAddress?.trim())
      const fraudCheckPassed = true
      if (!stockCheck || !serviceableCheck || !fraudCheckPassed) {
        const reasons = [
          !stockCheck ? "Stock unavailable for one or more items" : null,
          !serviceableCheck ? "Delivery address/serviceability check failed" : null,
          !fraudCheckPassed ? "Fraud check failed" : null,
        ].filter(Boolean)
        return fail("Order cannot be accepted", 422, { reasons })
      }
      const updated = await updateOrderStatus(order.id, "confirmed", auth.user.sub, {
        reasonCode: "admin_approved",
        note: parsed.data.reason ?? "Admin approved order",
      })

      const paymentMethod = String(order.paymentMethod ?? "").toLowerCase()
      const paymentStatus = normalizePaymentStatus(order.paymentStatus)
      const isEligibleForSync = paymentMethod === "cod" || paymentStatus === "SUCCESS"
      if (isEligibleForSync) {
        void triggerShiprocketAutoSync({
          orderId: order.id,
          actorId: auth.user.sub,
          source: "status_confirmed",
        })
      }
      return ok(updated, "Order approved")
    }

    if (parsed.data.action === "reject_order") {
      if (lifecycleStatus !== "admin_approval_pending") {
        return fail(`Order cannot be rejected from status "${lifecycleStatus}". Only pending approval orders can be rejected.`, 422)
      }
      const paymentStatus = normalizePaymentStatus(order.paymentStatus)
      const paymentMethod = String(order.paymentMethod ?? "").toLowerCase()
      const updated = await updateOrderStatus(order.id, "cancelled", auth.user.sub, {
        reasonCode: "admin_rejected",
        note: parsed.data.reason ?? "Admin rejected order",
      })

      // Release reserved inventory
      try {
        await releaseOrderInventory(order.id)
      } catch (invErr) {
        console.error("[reject_order] Failed to release inventory:", invErr)
      }

      // If prepaid payment was captured, create and initiate refund for refundable amount
      if (paymentStatus === "SUCCESS" && paymentMethod !== "cod") {
        const existingRefund = (order.refunds ?? []).find((r: any) => ["pending", "failed", "initiated", "completed"].includes(r.status))
        let refund: any = existingRefund
        if (!refund) {
          const amount = parsed.data.amount ?? Number(order.total)
          refund = await createRefund(order.id, amount, "Order rejected by admin")
        }

        let triggered: any = null
        let refundError: string | null = null
        if (refund && ["pending", "failed"].includes(refund.status)) {
          try {
            triggered = await triggerRazorpayRefund({ refundRecordId: refund.id })
          } catch (err: any) {
            refundError = err instanceof Error ? err.message : String(err)
            console.error("[reject_order] Razorpay refund failed:", refundError)
            await updateRefundStatus(refund.id, "failed").catch(() => null)
            await getSupabaseAdmin().from("Order").update({ refundStatus: "FAILED" }).eq("id", order.id).catch(() => null)
          }
        }
        return ok(
          { updated, refund, triggered, refundError },
          refundError ? "Order rejected; refund trigger failed (retry available)" : "Order rejected and refund initiated",
        )
      }
      return ok(updated, "Order rejected")
    }

    if (parsed.data.action === "approve_cancel") {
      const paymentStatus = normalizePaymentStatus(order.paymentStatus)
      if (paymentStatus !== "SUCCESS") return fail("Refund allowed only when payment_status = SUCCESS", 422)
      await updateOrderStatus(order.id, "cancelled", auth.user.sub, {
        reasonCode: "cancel_approved",
        note: parsed.data.reason ?? "Admin approved cancellation",
      })
      const amount = parsed.data.amount ?? Number(order.total)
      const refund = await createRefund(order.id, amount, "Cancellation refund")
      const triggered = await triggerRazorpayRefund({ refundRecordId: refund.id })
      return ok({ refund, triggered }, "Cancellation approved and refund initiated")
    }

    if (parsed.data.action === "reject_cancel") {
      const updated = await updateOrderStatus(order.id, "confirmed", auth.user.sub, {
        reasonCode: "cancel_rejected",
        note: parsed.data.reason ?? "Cancel request rejected",
      })
      return ok(updated, "Cancel request rejected")
    }

    if (parsed.data.action === "approve_return") {
      const updated = await updateOrderStatus(order.id, "return_approved", auth.user.sub, {
        reasonCode: "return_approved",
        note: parsed.data.reason ?? "Admin approved return",
      })
      return ok(updated, "Return approved")
    }

    if (parsed.data.action === "reject_return") {
      const updated = await updateOrderStatus(order.id, "delivered", auth.user.sub, {
        reasonCode: "return_rejected",
        note: parsed.data.reason ?? "Return request rejected",
      })
      return ok(updated, "Return request rejected")
    }

    const paymentStatus = normalizePaymentStatus(order.paymentStatus)
    if (paymentStatus !== "SUCCESS") return fail("Refund allowed only when payment_status = SUCCESS", 422)

    const existingRefund = (order.refunds ?? []).find((r: any) => ["pending", "failed"].includes(r.status))
    let refund: any = existingRefund
    if (!refund && parsed.data.action === "retry_refund") {
      const latestRefund = order.refunds?.[0]
      if (latestRefund && ["pending", "failed"].includes(latestRefund.status)) {
        refund = latestRefund
      }
    }

    if (!refund) {
      const amount = parsed.data.amount ?? Number(order.total)
      refund = await createRefund(order.id, amount, parsed.data.action === "retry_refund" ? "Retry refund trigger" : "Manual refund trigger")
    }
    if (!refund) return fail("Unable to resolve refund record", 400)

    try {
      const triggered = await triggerRazorpayRefund({ refundRecordId: refund.id })
      await updateOrderStatus(order.id, "refund_initiated", auth.user.sub, {
        reasonCode: "refund_initiated",
        note: "Refund flow initiated by admin",
      }).catch(() => null)
      return ok({ refund, triggered }, parsed.data.action === "retry_refund" ? "Refund retry initiated" : "Refund initiated")
    } catch (err: any) {
      const message = err instanceof Error ? err.message : String(err)
      await updateRefundStatus(refund.id, "failed").catch(() => null)
      await getSupabaseAdmin().from("Order").update({ refundStatus: "FAILED" }).eq("id", order.id).catch(() => null)
      return fail(`Refund failed: ${message}`, 400, { refundRecordId: refund.id })
    }
  } catch (error) {
    if (error instanceof OrderCancellationError) {
      return fail(error.message, error.httpStatus)
    }
    return fail(error instanceof Error ? error.message : "Action failed", 400)
  }
}
