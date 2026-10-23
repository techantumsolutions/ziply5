import { NextRequest } from "next/server"
import { fail, ok } from "@/src/server/core/http/response"
import { requireAuth } from "@/src/server/middleware/auth"
import { requirePermission } from "@/src/server/middleware/rbac"
import { getSupabaseAdmin } from "@/src/lib/supabase/admin"

export async function GET(request: NextRequest) {
  const auth = requireAuth(request)
  if ("status" in auth) return auth

  const denied = requirePermission(auth.user.role, "orders.read")
  if (denied) return denied

  try {
    const client = getSupabaseAdmin()
    const tables = ["Transaction", "transactions"]
    let rows: Array<Record<string, unknown>> = []
    for (const table of tables) {
      const attempts = [
        () => client.from(table).select("*").order("createdAt", { ascending: false }).limit(100),
        () => client.from(table).select("*").order("created_at", { ascending: false }).limit(100),
        () => client.from(table).select("*").limit(100),
      ]
      for (const run of attempts) {
        const { data, error } = await run()
        if (!error && Array.isArray(data)) {
          rows = data as Array<Record<string, unknown>>
          break
        }
      }
      if (rows.length) break
    }

    let mappedTransactions = rows.map((tx) => {
      const gatewayRaw = String(tx.gateway ?? (tx as any).paymentMethod ?? (tx as any).type ?? "").trim()
      const gatewayFormatted = gatewayRaw.toLowerCase() === "cod" ? "COD" : "Razorpay"
      const statusRaw = String(tx.status ?? "").toLowerCase()
      const statusFormatted =
        statusRaw === "paid" || statusRaw === "success" || statusRaw === "completed"
          ? "Paid"
          : statusRaw === "failed"
          ? "Failed"
          : "Pending"

      return {
        id: String(tx.id ?? ""),
        orderId: String((tx as any).orderId ?? (tx as any).order_id ?? ""),
        amount: Number(tx.amount ?? 0),
        type: gatewayFormatted,
        status: statusFormatted,
        referenceId: String((tx as any).externalId ?? (tx as any).external_id ?? (tx as any).referenceId ?? (tx as any).paymentId ?? ""),
        createdAt: String((tx as any).createdAt ?? (tx as any).created_at ?? ""),
      }
    })

    if (mappedTransactions.length === 0) {
      for (const orderTable of ["Order", "orders"]) {
        const { data: orderRows, error: orderErr } = await client
          .from(orderTable)
          .select("id, total, paymentStatus, payment_status, paymentMethod, payment_method, paymentId, payment_id, createdAt, created_at")
          .order("createdAt", { ascending: false })
          .limit(100)

        if (!orderErr && Array.isArray(orderRows) && orderRows.length > 0) {
          mappedTransactions = orderRows.map((o) => {
            const rawMethod = String(o.paymentMethod ?? (o as any).payment_method ?? "").toLowerCase()
            const isCod = rawMethod.includes("cod") || rawMethod.includes("cash")
            const rawStatus = String(o.paymentStatus ?? (o as any).payment_status ?? "").toLowerCase()
            const isPaid = rawStatus === "success" || rawStatus === "paid"
            const status = isPaid ? "Paid" : rawStatus === "failed" ? "Failed" : "Pending"
            const ref = String(
              o.paymentId ??
                (o as any).payment_id ??
                (isCod ? `plink_${String(o.id).slice(0, 14)}` : `order_${String(o.id).slice(0, 14)}`)
            )

            return {
              id: `tx_${o.id}`,
              orderId: String(o.id),
              amount: Number(o.total ?? 0),
              type: isCod ? "COD" : "Razorpay",
              status,
              referenceId: ref,
              createdAt: String(o.createdAt ?? (o as any).created_at ?? new Date().toISOString()),
            }
          })
          break
        }
      }
    }

    return ok(mappedTransactions, "Transactions fetched successfully")
  } catch (e) {
    return fail(e instanceof Error ? e.message : "Failed to fetch transactions", 500)
  }
}
