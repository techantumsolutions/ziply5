import { NextRequest } from "next/server"
import { ok, fail } from "@/src/server/core/http/response"
import { requireAuth } from "@/src/server/middleware/auth"
import { requirePermission } from "@/src/server/middleware/rbac"
import { isTrustedOrigin } from "@/src/server/security/csrf"
import { getNavigationConfig, updateNavigationConfig } from "@/src/server/modules/product-usage/product-usage.service"
import { navigationConfigSchema } from "@/src/server/modules/product-usage/product-usage.validator"

export async function GET(request: NextRequest) {
  const auth = requireAuth(request)
  if ("status" in auth) return auth

  const perm = requirePermission(auth.user.role, "product_usage.read")
  if (perm) return perm

  try {
    const config = await getNavigationConfig()
    return ok(config)
  } catch (error) {
    return fail(error instanceof Error ? error.message : "Failed to fetch navigation settings", 500)
  }
}

export async function POST(request: NextRequest) {
  const auth = requireAuth(request)
  if ("status" in auth) return auth
  if (!isTrustedOrigin(request)) return fail("Invalid origin", 403)

  const perm = requirePermission(auth.user.role, "product_usage.navigation")
  if (perm) return perm

  try {
    const body = await request.json()
    const parsed = navigationConfigSchema.safeParse(body)
    if (!parsed.success) {
      return fail(parsed.error.errors[0]?.message || "Validation failed", 400)
    }

    const updated = await updateNavigationConfig(parsed.data, auth.user.sub)
    return ok(updated, "Navigation settings updated successfully")
  } catch (error) {
    return fail(error instanceof Error ? error.message : "Failed to update navigation settings", 500)
  }
}
