import { NextRequest } from "next/server"
import { ok, fail } from "@/src/server/core/http/response"
import { requireAuth } from "@/src/server/middleware/auth"
import { requirePermission } from "@/src/server/middleware/rbac"
import { isTrustedOrigin } from "@/src/server/security/csrf"
import { pgTx } from "@/src/server/db/pg"

export async function PATCH(request: NextRequest) {
  const auth = requireAuth(request)
  if ("status" in auth) return auth
  if (!isTrustedOrigin(request)) return fail("Invalid origin", 403)

  const perm = requirePermission(auth.user.role, "product_usage.update")
  if (perm) return perm

  try {
    const body = await request.json()
    const { items } = body // Array<{ id: string; displayOrder: number }>

    if (!Array.isArray(items) || items.length === 0) {
      return fail("items must be a non-empty array", 400)
    }

    await pgTx(async (client) => {
      for (const item of items) {
        if (item.id && typeof item.displayOrder === "number") {
          await client.query(
            `UPDATE "ProductUsage" SET display_order = $2, updated_by = $3, updated_at = now() WHERE id = $1 AND "deleted_at" IS NULL`,
            [item.id, item.displayOrder, auth.user.sub],
          )
        }
      }
    })

    return ok({ updated: items.length }, "Display order updated successfully")
  } catch (error) {
    return fail(error instanceof Error ? error.message : "Failed to update display order", 500)
  }
}
