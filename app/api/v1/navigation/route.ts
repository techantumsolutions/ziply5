import { NextRequest } from "next/server"
import { ok, fail } from "@/src/server/core/http/response"
import { getNavigationConfig } from "@/src/server/modules/product-usage/product-usage.service"

export async function GET(_request: NextRequest) {
  try {
    const productUsageNav = await getNavigationConfig()
    return ok({
      productUsage: productUsageNav,
    })
  } catch (error) {
    return fail(error instanceof Error ? error.message : "Failed to fetch navigation configuration", 500)
  }
}
