import { NextRequest } from "next/server"
import { ok, fail } from "@/src/server/core/http/response"
import { getProductUsageBySlugPublic } from "@/src/server/modules/product-usage/product-usage.service"

export async function GET(
  _request: NextRequest,
  { params }: { params: Promise<{ slug: string }> },
) {
  try {
    const { slug } = await params
    if (!slug) return fail("Slug is required", 400)

    const data = await getProductUsageBySlugPublic(slug)
    if (!data) return fail("Product Usage entry not found", 404)

    return ok(data)
  } catch (error) {
    return fail(error instanceof Error ? error.message : "Failed to fetch product usage details", 500)
  }
}
