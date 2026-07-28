import { NextRequest } from "next/server"
import { ok, fail } from "@/src/server/core/http/response"
import { requireAuth } from "@/src/server/middleware/auth"
import { requirePermission } from "@/src/server/middleware/rbac"
import { isTrustedOrigin } from "@/src/server/security/csrf"
import {
  getProductUsageByIdAdmin,
  updateProductUsage,
  deleteProductUsage,
  checkSlugAvailable,
} from "@/src/server/modules/product-usage/product-usage.service"
import { updateProductUsageSchema } from "@/src/server/modules/product-usage/product-usage.validator"

export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  const auth = requireAuth(request)
  if ("status" in auth) return auth

  const perm = requirePermission(auth.user.role, "product_usage.read")
  if (perm) return perm

  try {
    const { id } = await params
    const record = await getProductUsageByIdAdmin(id)
    if (!record) return fail("Product Usage entry not found", 404)

    return ok(record)
  } catch (error) {
    return fail(error instanceof Error ? error.message : "Failed to fetch product usage entry", 500)
  }
}

export async function PUT(
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
    const parsed = updateProductUsageSchema.safeParse(body)
    if (!parsed.success) {
      return fail(parsed.error.errors[0]?.message || "Validation failed", 400)
    }

    if (parsed.data.slug) {
      const isAvailable = await checkSlugAvailable(parsed.data.slug, id)
      if (!isAvailable) {
        return fail(`Slug '${parsed.data.slug}' is already taken. Please choose another.`, 409)
      }
    }

    const updated = await updateProductUsage(id, parsed.data, auth.user.sub)
    return ok(updated, "Product Usage updated successfully")
  } catch (error) {
    return fail(error instanceof Error ? error.message : "Failed to update product usage", 500)
  }
}

export const POST = PUT

export async function DELETE(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  const auth = requireAuth(request)
  if ("status" in auth) return auth
  if (!isTrustedOrigin(request)) return fail("Invalid origin", 403)

  const perm = requirePermission(auth.user.role, "product_usage.delete")
  if (perm) return perm

  try {
    const { id } = await params
    await deleteProductUsage(id, auth.user.sub)
    return ok({ id }, "Product Usage entry deleted successfully")
  } catch (error) {
    return fail(error instanceof Error ? error.message : "Failed to delete product usage", 500)
  }
}
