import { NextRequest } from "next/server"
import { ok, fail } from "@/src/server/core/http/response"
import { requireAuth } from "@/src/server/middleware/auth"
import { requirePermission } from "@/src/server/middleware/rbac"
import { isTrustedOrigin } from "@/src/server/security/csrf"
import {
  listProductUsageAdmin,
  createProductUsage,
  checkSlugAvailable,
} from "@/src/server/modules/product-usage/product-usage.service"
import { createProductUsageSchema } from "@/src/server/modules/product-usage/product-usage.validator"

export async function GET(request: NextRequest) {
  const auth = requireAuth(request)
  if ("status" in auth) return auth

  const perm = requirePermission(auth.user.role, "product_usage.read")
  if (perm) return perm

  try {
    const { searchParams } = new URL(request.url)
    const page = parseInt(searchParams.get("page") || "1", 10)
    const limit = parseInt(searchParams.get("limit") || "20", 10)
    const search = searchParams.get("search") || undefined
    const publishStatus = searchParams.get("publishStatus") || undefined
    const videoType = searchParams.get("videoType") || undefined
    const relatedProductId = searchParams.get("relatedProductId") || undefined
    const sort = searchParams.get("sort") || undefined
    const isActiveRaw = searchParams.get("isActive")
    const isActive = isActiveRaw === "true" ? true : isActiveRaw === "false" ? false : undefined

    const result = await listProductUsageAdmin({
      page,
      limit,
      search,
      publishStatus,
      isActive,
      videoType,
      relatedProductId,
      sort,
    })

    return ok(result)
  } catch (error) {
    return fail(error instanceof Error ? error.message : "Failed to list product usage items", 500)
  }
}

export async function POST(request: NextRequest) {
  const auth = requireAuth(request)
  if ("status" in auth) return auth
  if (!isTrustedOrigin(request)) return fail("Invalid origin", 403)

  const perm = requirePermission(auth.user.role, "product_usage.create")
  if (perm) return perm

  try {
    const body = await request.json()
    const parsed = createProductUsageSchema.safeParse(body)
    if (!parsed.success) {
      return fail(parsed.error.errors[0]?.message || "Validation failed", 400)
    }

    const isAvailable = await checkSlugAvailable(parsed.data.slug)
    if (!isAvailable) {
      return fail(`Slug '${parsed.data.slug}' is already taken. Please choose another.`, 409)
    }

    const created = await createProductUsage(parsed.data, auth.user.sub)
    return ok(created, "Product Usage created successfully", 201)
  } catch (error) {
    return fail(error instanceof Error ? error.message : "Failed to create product usage", 500)
  }
}
