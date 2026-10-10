import { NextRequest } from "next/server"
import { z } from "zod"
import { fail, ok } from "@/src/server/core/http/response"
import { requireAuth } from "@/src/server/middleware/auth"
import { requirePermission } from "@/src/server/middleware/rbac"
import { deleteBundleSoft, getBundleAdminById, toggleBundleActive, updateBundleV2 } from "@/src/server/modules/bundles/bundles.service"

const updateSchema = z.object({
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

const patchSchema = z.object({
  isActive: z.boolean(),
})

export async function GET(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const auth = requireAuth(request)
  if ("status" in auth) return auth
  const denied = requirePermission(auth.user.role, "bundles.read")
  if (denied) return denied
  const { id } = await params
  const bundle = await getBundleAdminById(id)
  if (!bundle) return fail("Bundle not found", 404)
  return ok(bundle, "Bundle fetched")
}

export async function PUT(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const auth = requireAuth(request)
  if ("status" in auth) return auth
  const denied = requirePermission(auth.user.role, "bundles.update")
  if (denied) return denied
  const { id } = await params
  const body = await request.json()
  const parsed = updateSchema.safeParse(body)
  if (!parsed.success) return fail("Validation failed", 422, parsed.error.flatten())
  try {
    const bundle = await updateBundleV2(id, parsed.data)
    return ok(bundle, "Bundle updated")
  } catch (error) {
    return fail(error instanceof Error ? error.message : "Failed to update bundle", 400)
  }
}

export async function PATCH(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const auth = requireAuth(request)
  if ("status" in auth) return auth
  const denied = requirePermission(auth.user.role, "bundles.update")
  if (denied) return denied
  const { id } = await params
  const body = await request.json()
  const parsed = patchSchema.safeParse(body)
  if (!parsed.success) return fail("Validation failed", 422, parsed.error.flatten())
  try {
    const bundle = await toggleBundleActive(id, parsed.data.isActive)
    return ok(bundle, "Bundle status updated")
  } catch (error) {
    return fail(error instanceof Error ? error.message : "Failed to update bundle", 400)
  }
}

export async function DELETE(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const auth = requireAuth(request)
  if ("status" in auth) return auth
  const denied = requirePermission(auth.user.role, "bundles.update")
  if (denied) return denied
  const { id } = await params
  try {
    const result = await deleteBundleSoft(id)
    return ok(result, "Bundle disabled")
  } catch (error) {
    return fail(error instanceof Error ? error.message : "Failed to disable bundle", 400)
  }
}
