import { NextRequest } from "next/server"
import { fail, ok } from "@/src/server/core/http/response"
import { requireAuth } from "@/src/server/middleware/auth"
import { optionalAuth } from "@/src/server/middleware/optionalAuth"
import { requirePermission } from "@/src/server/middleware/rbac"
import { updateProductSchema } from "@/src/server/modules/products/products.validator"
import {
  canAccessProduct,
  deleteProduct,
  getProductById,
  updateProduct,
  type ListProductsScope,
} from "@/src/server/modules/products/products.service"
import { invalidateProductCache } from "@/src/server/modules/products/products.cache"
import type { AppTokenPayload } from "@/src/server/core/security/jwt"

const resolveAccessScope = (user: AppTokenPayload | null): { scope: ListProductsScope } => {
  if (!user) return { scope: "public" }
  if (user.role === "super_admin" || user.role === "admin") return { scope: "admin" }
  return { scope: "public" }
}

export async function GET(request: NextRequest, ctx: { params: Promise<{ id: string }> }) {
  const { id } = await ctx.params
  const user = optionalAuth(request)
  const { scope } = resolveAccessScope(user)

  const product = await getProductById(id)
  if (!product) return fail("Product not found", 404)

  if (!canAccessProduct(product, scope)) {
    return fail("Product not found", 404)
  }

  return ok({ ...product, product, variants: product.variants ?? [] }, "Product fetched")
}

export async function PATCH(request: NextRequest, ctx: { params: Promise<{ id: string }> }) {
  const { id } = await ctx.params
  const auth = requireAuth(request)
  if ("status" in auth) return auth

  const forbidden = requirePermission(auth.user.role, "products.update")
  if (forbidden) return forbidden

  const body = await request.json()
  const parsed = updateProductSchema.safeParse(body)
  if (!parsed.success) {
    return fail("Validation failed", 422, parsed.error.flatten())
  }

  try {
    const product = await updateProduct(id, parsed.data as any, {
      role: auth.user.role,
      userId: auth.user.sub,
    })
    await invalidateProductCache()
    return ok(product, "Product updated")
  } catch (error) {
    const message = error instanceof Error ? error.message : "Unexpected error"
    if (message === "Forbidden") return fail(message, 403)
    if (message === "Product not found") return fail(message, 404)
    return fail(message, 400)
  }
}

export async function PUT(request: NextRequest, ctx: { params: Promise<{ id: string }> }) {
  return PATCH(request, ctx)
}

export async function DELETE(request: NextRequest, ctx: { params: Promise<{ id: string }> }) {
  const { id } = await ctx.params
  const auth = requireAuth(request)
  if ("status" in auth) return auth

  const forbidden = requirePermission(auth.user.role, "products.delete")
  if (forbidden) return forbidden

  try {
    await deleteProduct(id, { role: auth.user.role, userId: auth.user.sub })
    await invalidateProductCache()
    return ok({ id }, "Product deleted")
  } catch (error) {
    const message = error instanceof Error ? error.message : "Unexpected error"
    if (message === "Forbidden") return fail(message, 403)
    if (message === "Product not found") return fail(message, 404)
    return fail(message, 400)
  }
}
