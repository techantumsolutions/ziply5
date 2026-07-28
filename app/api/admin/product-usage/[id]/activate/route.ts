import { NextRequest } from "next/server"
import { ok, fail } from "@/src/server/core/http/response"
import { requireAuth } from "@/src/server/middleware/auth"
import { requirePermission } from "@/src/server/middleware/rbac"
import { isTrustedOrigin } from "@/src/server/security/csrf"
import { setActiveStatus } from "@/src/server/modules/product-usage/product-usage.service"

export async function PATCH(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  const auth = requireAuth(request)
  if ("status" in auth) return auth
  if (!isTrustedOrigin(request)) return fail("Invalid origin", 403)

  const perm = requirePermission(auth.user.role, "product_usage.update")
  if (perm) return perm

  try {
    const { id } = await params
    const body = await request.json()
    const { isActive } = body

    if (typeof isActive !== "boolean") {
      return fail("isActive must be a boolean", 400)
    }

    await setActiveStatus(id, isActive, auth.user.sub)
    return ok({ id, isActive }, `Entry ${isActive ? "activated" : "deactivated"}`)
  } catch (error) {
    return fail(error instanceof Error ? error.message : "Failed to update active status", 500)
  }
}
