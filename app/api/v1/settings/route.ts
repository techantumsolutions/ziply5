import { NextRequest } from "next/server"
import { revalidatePath } from "next/cache"
import { fail, ok } from "@/src/server/core/http/response"
import { requireAuth } from "@/src/server/middleware/auth"
import { requirePermission } from "@/src/server/middleware/rbac"
import { upsertSettingSchema } from "@/src/server/modules/settings/settings.validator"
import { listSettings, upsertSetting } from "@/src/server/modules/settings/settings.service"
import { validateShippingRules } from "@/src/lib/shipping/ziply5-shipping"

export async function GET(request: NextRequest) {
  const group = request.nextUrl.searchParams.get("group") ?? undefined

  const upperGroup = group?.toUpperCase()
  const isPublicGroup =
    upperGroup === "TAX" ||
    upperGroup === "CART" ||
    upperGroup === "SEO" ||
    upperGroup === "SHIPPING" ||
    group === "seo"

  if (!isPublicGroup) {
    const auth = requireAuth(request)
    if ("status" in auth) return auth
  }

  // const forbidden = requirePermission(auth.user.role, "settings.read")
  // if (forbidden) return forbidden

  const items = await listSettings(group ?? undefined)
  return ok(items, "Settings fetched")
}

export async function POST(request: NextRequest) {
  const auth = requireAuth(request)
  if ("status" in auth) return auth

  const forbidden = requirePermission(auth.user.role, "settings.update")
  if (forbidden) return forbidden

  const body = await request.json()
  const parsed = upsertSettingSchema.safeParse(body)
  if (!parsed.success) {
    return fail("Validation failed", 422, parsed.error.flatten())
  }

  if (
    (parsed.data.group.toUpperCase() === "SHIPPING" || parsed.data.group === "shipping") &&
    parsed.data.key === "rules"
  ) {
    const validation = validateShippingRules(parsed.data.valueJson)
    if (!validation.valid) {
      return fail(validation.errors.join("; "), 422, {
        errors: validation.errors,
      })
    }
  }

  const row = await upsertSetting({
    group: parsed.data.group,
    key: parsed.data.key,
    valueJson: parsed.data.valueJson,
  })

  if (
    (parsed.data.group === "site" && parsed.data.key === "favicons") ||
    (parsed.data.group === "seo" && parsed.data.key === "storefront")
  ) {
    revalidatePath("/", "layout")
  }

  if (parsed.data.group.toUpperCase() === "SHIPPING") {
    revalidatePath("/checkout")
  }

  return ok(row, "Setting saved")
}
