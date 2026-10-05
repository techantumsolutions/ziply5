import { NextRequest } from "next/server"
import { fail, ok } from "@/src/server/core/http/response"
import { requireAuth } from "@/src/server/middleware/auth"
import { requirePermission } from "@/src/server/middleware/rbac"
import {
  createFeatureDefinition,
  listFeatureDefinitions,
} from "@/src/server/modules/feature-definitions/feature-definitions.service"
import { createFeatureDefinitionSchema } from "@/src/server/modules/feature-definitions/feature-definitions.validator"

export async function GET(request: NextRequest) {
  const activeOnly = request.nextUrl.searchParams.get("activeOnly") === "true"
  try {
    const rows = await listFeatureDefinitions({ activeOnly })
    return ok(rows, "Feature definitions")
  } catch (error) {
    return fail(error instanceof Error ? error.message : "Failed to list features", 400)
  }
}

export async function POST(request: NextRequest) {
  const auth = requireAuth(request)
  if ("status" in auth) return auth
  const denied = requirePermission(auth.user.role, "products.update")
  if (denied) return denied

  const body = await request.json().catch(() => ({}))
  const parsed = createFeatureDefinitionSchema.safeParse(body)
  if (!parsed.success) return fail("Validation failed", 422, parsed.error.flatten())

  try {
    const row = await createFeatureDefinition(
      {
        title: parsed.data.title,
        icon: parsed.data.icon || null,
        isActive: parsed.data.isActive,
        sortOrder: parsed.data.sortOrder,
      },
      auth.user.sub,
    )
    return ok(row, "Feature definition created", 201)
  } catch (error) {
    return fail(error instanceof Error ? error.message : "Create failed", 400)
  }
}
