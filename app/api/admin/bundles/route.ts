import { NextRequest } from "next/server"
import { z } from "zod"
import { fail, ok } from "@/src/server/core/http/response"
import { requireAuth } from "@/src/server/middleware/auth"
import { requirePermission } from "@/src/server/middleware/rbac"
import { createBundleV2, listActiveCombosForProduct, listBundlesAdmin } from "@/src/server/modules/bundles/bundles.service"

const querySchema = z.object({
  page: z.coerce.number().int().min(1).optional(),
  limit: z.coerce.number().int().min(1).max(100).optional(),
  q: z.string().optional(),
  isActive: z.enum(["true", "false"]).optional(),
  productId: z.string().min(1).optional(),
  sort: z.enum(["created_desc", "created_asc"]).optional(),
})

const bundlePayloadSchema = z.object({
  name: z.string().min(2),
  slug: z.string().min(1).optional(),
  pricingMode: z.enum(["fixed", "dynamic"]),
  comboPrice: z.number().positive().nullable().optional(),
  description: z.string().nullable().optional(),
  image: z.string().nullable().optional(),
  isActive: z.boolean().optional(),
  productIds: z.array(z.string().min(1)).max(3),
  productPrices: z.array(z.object({
    productId: z.string().min(1),
    comboPrice: z.number().nonnegative(),
  })).max(3).optional(),
})

export async function GET(request: NextRequest) {
  const auth = requireAuth(request)
  if ("status" in auth) return auth
  const denied = requirePermission(auth.user.role, "bundles.read")
  if (denied) return denied

  const parsed = querySchema.safeParse(Object.fromEntries(request.nextUrl.searchParams.entries()))
  if (!parsed.success) return fail("Invalid query params", 422, parsed.error.flatten())
  const data = parsed.data
  if (data.productId && data.isActive !== "false") {
    const items = await listActiveCombosForProduct(data.productId)
    return ok({ items, total: items.length, page: 1, limit: items.length || 1 }, "Bundles fetched")
  }
  const result = await listBundlesAdmin({
    page: data.page,
    limit: data.limit,
    q: data.q,
    isActive: data.isActive === undefined ? undefined : data.isActive === "true",
    sort: data.sort,
  })
  return ok(result, "Bundles fetched")
}

export async function POST(request: NextRequest) {
  const auth = requireAuth(request)
  if ("status" in auth) return auth
  const denied = requirePermission(auth.user.role, "bundles.create")
  if (denied) return denied

  const body = await request.json()
  const parsed = bundlePayloadSchema.safeParse(body)
  if (!parsed.success) return fail("Validation failed", 422, parsed.error.flatten())
  try {
    const bundle = await createBundleV2(parsed.data)
    return ok(bundle, "Bundle created", 201)
  } catch (error) {
    return fail(error instanceof Error ? error.message : "Failed to create bundle", 400)
  }
}
