import { NextRequest } from "next/server"
import { fail, ok } from "@/src/server/core/http/response"
import { requireAuth } from "@/src/server/middleware/auth"
import { requirePermission } from "@/src/server/middleware/rbac"
import { salesSummary } from "@/src/server/modules/reports/reports.service"

export async function GET(request: NextRequest) {
  const auth = requireAuth(request)
  if ("status" in auth) return auth

  const forbidden = requirePermission(auth.user.role, "reports.read")
  if (forbidden) return forbidden

  const fromParam = request.nextUrl.searchParams.get("from")
  const toParam = request.nextUrl.searchParams.get("to")
  const prepTypeParam = request.nextUrl.searchParams.get("preparationType")
  const tagIdParam = request.nextUrl.searchParams.get("tagId")
  const paymentParam = request.nextUrl.searchParams.get("payment")
  const categoryIdParam = request.nextUrl.searchParams.get("categoryId")
  if (!fromParam || !toParam) {
    return fail("Query params from and to (ISO dates) are required", 422)
  }

  const from = new Date(fromParam)
  const to = new Date(toParam)
  if (Number.isNaN(from.getTime()) || Number.isNaN(to.getTime())) {
    return fail("Invalid date range", 422)
  }

  const data = await salesSummary(from, to, prepTypeParam, tagIdParam, paymentParam, categoryIdParam)
  return ok(data, "Sales report")
}
