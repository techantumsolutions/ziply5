import { pgQuery } from "@/src/server/db/pg"
import {
  DEFAULT_SHIPPING_RULES,
  validateShippingRules,
  calculateShippingCharge,
  type ShippingRule,
  type ShippingCalculationResult,
} from "@/src/lib/shipping/ziply5-shipping"

export async function getAuthoritativeShippingRules(): Promise<ShippingRule[]> {
  try {
    const rows = await pgQuery<Array<{ valueJson: unknown }>>(
      `SELECT "valueJson" FROM "Setting" WHERE ("group" = 'SHIPPING' OR "group" = 'shipping') AND key = 'rules' LIMIT 1`,
    )
    const raw = rows[0]?.valueJson

    if (raw == null) {
      // If not yet persisted, return default rules
      return [...DEFAULT_SHIPPING_RULES]
    }

    const val = validateShippingRules(raw)
    if (!val.valid) {
      throw new Error(`Persisted shipping rules are invalid: ${val.errors.join("; ")}`)
    }

    return val.rules
  } catch (error) {
    // If it was our explicit validation error, rethrow
    if (error instanceof Error && error.message.includes("Persisted shipping rules are invalid")) {
      throw error
    }
    console.error("[shipping-settings] Error loading shipping rules from database:", error)
    // If database connection is completely down, fail authoritative calculation rather than silently inventing random charges
    throw new Error("Unable to load shipping settings from database.")
  }
}

export async function calculateAuthoritativeShipping(
  subtotal: number,
): Promise<ShippingCalculationResult> {
  const rules = await getAuthoritativeShippingRules()
  return calculateShippingCharge(subtotal, rules)
}
