import { NextRequest } from "next/server"
import { ok, fail } from "@/src/server/core/http/response"
import { listProductUsagePublic } from "@/src/server/modules/product-usage/product-usage.service"

export async function GET(request: NextRequest) {
  try {
    const { searchParams } = new URL(request.url)
    const page = parseInt(searchParams.get("page") || "1", 10)
    const limit = parseInt(searchParams.get("limit") || "12", 10)
    const search = searchParams.get("search") || undefined
    const productId = searchParams.get("productId") || undefined
    const sort = searchParams.get("sort") || undefined

    const result = await listProductUsagePublic({
      page,
      limit,
      search,
      productId,
      sort,
    })

    return ok(result)
  } catch (error) {
    return fail(error instanceof Error ? error.message : "Failed to fetch product usage items", 500)
  }
}
