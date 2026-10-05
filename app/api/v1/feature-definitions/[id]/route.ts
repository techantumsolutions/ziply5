import { NextRequest } from "next/server"
import { fail, ok } from "@/src/server/core/http/response"
import { requireAuth } from "@/src/server/middleware/auth"
import { requirePermission } from "@/src/server/middleware/rbac"
import {
  deleteFeatureDefinition,
  updateFeatureDefinition,
} from "@/src/server/modules/feature-definitions/feature-definitions.service"
import { updateFeatureDefinitionSchema } from "@/src/server/modules/feature-definitions/feature-definitions.validator"

export async function PUT(request: NextRequest, ctx: { params: Promise<{ id: string }> }) {
  const auth = requireAuth(request)
  if ("status" in auth) return auth
  const denied = requirePermission(auth.user.role, "products.update")
  if (denied) return denied

  const { id } = await ctx.params
  const body = await request.json().catch(() => ({}))
  const parsed = updateFeatureDefinitionSchema.safeParse(body)
  if (!parsed.success) return fail("Validation failed", 422, parsed.error.flatten())

  try {
    const row = await updateFeatureDefinition(
      id,
      {
        title: parsed.data.title,
        icon: parsed.data.icon === "" ? null : parsed.data.icon,
        isActive: parsed.data.isActive,
        sortOrder: parsed.data.sortOrder,
      },
      auth.user.sub,
    )
    return ok(row, "Feature definition updated")
  } catch (error) {
    return fail(error instanceof Error ? error.message : "Update failed", 400)
  }
}

export async function DELETE(request: NextRequest, ctx: { params: Promise<{ id: string }> }) {
  const auth = requireAuth(request)
  if ("status" in auth) return auth
  const denied = requirePermission(auth.user.role, "products.delete")
  if (denied) return denied

  const { id } = await ctx.params
  try {
    const row = await deleteFeatureDefinition(id, auth.user.sub)
    return ok(row, "Feature definition deleted")
  } catch (error) {
    return fail(error instanceof Error ? error.message : "Delete failed", 400)
  }
}
