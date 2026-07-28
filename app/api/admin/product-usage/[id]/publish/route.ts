import { NextRequest } from "next/server"
import { ok, fail } from "@/src/server/core/http/response"
import { requireAuth } from "@/src/server/middleware/auth"
import { requirePermission } from "@/src/server/middleware/rbac"
import { isTrustedOrigin } from "@/src/server/security/csrf"
import { setPublishStatus } from "@/src/server/modules/product-usage/product-usage.service"

export async function PATCH(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  const auth = requireAuth(request)
  if ("status" in auth) return auth
  if (!isTrustedOrigin(request)) return fail("Invalid origin", 403)

  const perm = requirePermission(auth.user.role, "product_usage.publish")
  if (perm) return perm

  try {
    const { id } = await params
    const body = await request.json()
    const { publishStatus } = body

    if (!["draft", "published", "archived"].includes(publishStatus)) {
      return fail("Invalid publish status", 400)
    }

    await setPublishStatus(id, publishStatus, auth.user.sub)
    return ok({ id, publishStatus }, `Status updated to ${publishStatus}`)
  } catch (error) {
    return fail(error instanceof Error ? error.message : "Failed to update publish status", 500)
  }
}
