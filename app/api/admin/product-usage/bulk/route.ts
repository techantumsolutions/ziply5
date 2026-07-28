import { NextRequest } from "next/server"
import { ok, fail } from "@/src/server/core/http/response"
import { requireAuth } from "@/src/server/middleware/auth"
import { requirePermission } from "@/src/server/middleware/rbac"
import { isTrustedOrigin } from "@/src/server/security/csrf"
import { bulkProductUsageAction } from "@/src/server/modules/product-usage/product-usage.service"

export async function POST(request: NextRequest) {
  const auth = requireAuth(request)
  if ("status" in auth) return auth
  if (!isTrustedOrigin(request)) return fail("Invalid origin", 403)

  try {
    const body = await request.json()
    const { ids, action } = body

    if (!Array.isArray(ids) || ids.length === 0) {
      return fail("ids array is required", 400)
    }

    if (!["publish", "unpublish", "activate", "deactivate", "delete"].includes(action)) {
      return fail("Invalid action specified", 400)
    }

    const requiredPerm = action === "delete" ? "product_usage.delete" : action === "publish" || action === "unpublish" ? "product_usage.publish" : "product_usage.update"
    const perm = requirePermission(auth.user.role, requiredPerm)
    if (perm) return perm

    await bulkProductUsageAction(ids, action, auth.user.sub)
    return ok({ count: ids.length, action }, `Bulk operation '${action}' completed successfully`)
  } catch (error) {
    return fail(error instanceof Error ? error.message : "Bulk action failed", 500)
  }
}
