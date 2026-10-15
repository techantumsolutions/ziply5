import { NextRequest } from "next/server"
import { fail, ok } from "@/src/server/core/http/response"
import { requireAuth } from "@/src/server/middleware/auth"
import { listAdminNotifications } from "@/src/server/modules/notifications/admin-feed.service"

export const dynamic = "force-dynamic"

export async function GET(request: NextRequest) {
  const auth = requireAuth(request)
  if ("status" in auth) return auth
  if (!["admin", "super_admin"].includes(auth.user.role)) return fail("Forbidden", 403)

  const items = await listAdminNotifications()
  return ok(items, "Admin notifications")
}
