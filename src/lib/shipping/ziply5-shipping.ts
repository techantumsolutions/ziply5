// Centralized shipping module providing authoritative, subtotal-based pricing
// rules configured via Admin Dashboard to replace hardcoded pack slabs.


import {
  SHIPROCKET_SERVICEABILITY_PLACEHOLDER_DECLARED_VALUE_INR,
  SHIPROCKET_SERVICEABILITY_PLACEHOLDER_WEIGHT_KG,
  ZIPLY5_PACKS_FREE_SHIPPING_ABOVE,
  ZIPLY5_SHIPPING_MIN_PACKS,
  ZIPLY5_SHIPPING_SLABS,
  type Ziply5ShippingSlab,
} from "./ziply5-shipping.constants"

// Re-export legacy slab type for backward compatibility
export type { Ziply5ShippingSlab }

// Configurable shipping tier: [minSubtotal, maxSubtotal) range with flat fee.
export type ShippingRule = {
  id: string
  minSubtotal: number
  maxSubtotal: number | null
  shippingCharge: number
  active: boolean
}

// Default tiers used when database settings have not yet been initialized.
export const DEFAULT_SHIPPING_RULES: readonly ShippingRule[] = [
  { id: "rule_1", minSubtotal: 0, maxSubtotal: 1000, shippingCharge: 125, active: true },
  { id: "rule_2", minSubtotal: 1000, maxSubtotal: 2000, shippingCharge: 250, active: true },
  { id: "rule_3", minSubtotal: 2000, maxSubtotal: null, shippingCharge: 0, active: true },
] as const

/** Currency floating-point tolerance (2 paise) to prevent rounding rejections. */
export const SHIPPING_MONEY_EPS = 0.02

export type ShippingRulesValidationResult = {
  valid: boolean
  errors: string[]
  rules: ShippingRule[]
}

// Validates admin rules: checks non-negative values, non-overlapping bounds,
// and ensures open-ended tier is placed only at the highest subtotal.
export function validateShippingRules(input: unknown): ShippingRulesValidationResult {
  const errors: string[] = []

  if (!Array.isArray(input)) {
    return {
      valid: false,
      errors: ["Shipping rules must be an array of rule objects."],
      rules: [],
    }
  }

  const parsedRules: ShippingRule[] = []

  input.forEach((item, index) => {
    const idxLabel = `Rule #${index + 1}`
    if (!item || typeof item !== "object") {
      errors.push(`${idxLabel} is not a valid object.`)
      return
    }

    const raw = item as Record<string, unknown>
    const id = typeof raw.id === "string" && raw.id.trim().length ? raw.id.trim() : `rule_${index + 1}`

    const minSubtotal = Number(raw.minSubtotal)
    if (!Number.isFinite(minSubtotal) || minSubtotal < 0) {
      errors.push(`${idxLabel}: Minimum subtotal must be a finite number greater than or equal to 0.`)
    }

    let maxSubtotal: number | null = null
    if (raw.maxSubtotal !== null && raw.maxSubtotal !== undefined && raw.maxSubtotal !== "") {
      const parsedMax = Number(raw.maxSubtotal)
      if (!Number.isFinite(parsedMax) || parsedMax <= 0) {
        errors.push(`${idxLabel}: Maximum subtotal must be a positive finite number or left empty for open-ended.`)
      } else if (Number.isFinite(minSubtotal) && parsedMax <= minSubtotal) {
        errors.push(`${idxLabel}: Maximum subtotal (₹${parsedMax}) must be strictly greater than minimum subtotal (₹${minSubtotal}).`)
      }
      maxSubtotal = parsedMax
    }

    const shippingCharge = Number(raw.shippingCharge)
    if (!Number.isFinite(shippingCharge) || shippingCharge < 0) {
      errors.push(`${idxLabel}: Shipping charge must be a finite number greater than or equal to 0.`)
    }

    const active = raw.active === undefined ? true : Boolean(raw.active)

    parsedRules.push({
      id,
      minSubtotal,
      maxSubtotal,
      shippingCharge,
      active,
    })
  })

  if (errors.length > 0) {
    return { valid: false, errors, rules: parsedRules }
  }

  const activeRules = parsedRules.filter((r) => r.active)
  if (activeRules.length === 0) {
    return {
      valid: false,
      errors: ["At least one active shipping rule is required."],
      rules: parsedRules,
    }
  }

  // Sort active rules by minSubtotal ascending to verify contiguous/non-overlapping order
  const sorted = [...activeRules].sort((a, b) => a.minSubtotal - b.minSubtotal)

  for (let i = 0; i < sorted.length; i++) {
    const current = sorted[i]

    // Open-ended rule must be the last tier
    if (current.maxSubtotal === null && i < sorted.length - 1) {
      errors.push(`Rule with open-ended maximum (min: ₹${current.minSubtotal}) must be the highest tier.`)
      break
    }

    if (i < sorted.length - 1) {
      const next = sorted[i + 1]

      if (current.maxSubtotal === null) {
        errors.push(`Range starting at ₹${current.minSubtotal} has no upper bound and overlaps with range starting at ₹${next.minSubtotal}.`)
      } else if (current.maxSubtotal > next.minSubtotal) {
        errors.push(
          `Ranges overlap: [₹${current.minSubtotal}, ₹${current.maxSubtotal}) overlaps with [₹${next.minSubtotal}, ${
            next.maxSubtotal !== null ? `₹${next.maxSubtotal}` : "∞"
          }).`,
        )
      }
    }
  }

  return {
    valid: errors.length === 0,
    errors,
    rules: parsedRules,
  }
}

export type MatchRuleResult = {
  matched: boolean
  rule: ShippingRule | null
  shippingCharge: number
  error?: string
}

// Matches subtotal to active tiers using [min, max) boundaries, returning ₹0
// for empty carts and informative errors for gaps or out-of-range subtotals.
export function matchShippingRule(subtotalInput: number, rules: ShippingRule[]): MatchRuleResult {
  const subtotal = Number(subtotalInput)
  if (!Number.isFinite(subtotal) || subtotal < 0) {
    return {
      matched: false,
      rule: null,
      shippingCharge: 0,
      error: "Invalid subtotal: subtotal must be a non-negative finite number.",
    }
  }

  // An empty cart requires no shipping fee
  if (subtotal === 0) {
    return {
      matched: true,
      rule: null,
      shippingCharge: 0,
    }
  }

  const activeRules = rules.filter((r) => r.active).sort((a, b) => a.minSubtotal - b.minSubtotal)
  if (activeRules.length === 0) {
    return {
      matched: false,
      rule: null,
      shippingCharge: 0,
      error: "No active shipping rules are configured.",
    }
  }

  const lowestMin = activeRules[0].minSubtotal
  if (subtotal < lowestMin) {
    return {
      matched: false,
      rule: null,
      shippingCharge: 0,
      error: `Order subtotal of ₹${subtotal.toFixed(2)} is below the minimum serviceable shipping tier of ₹${lowestMin}.`,
    }
  }

  for (let i = 0; i < activeRules.length; i++) {
    const rule = activeRules[i]
    if (rule.maxSubtotal === null) {
      if (subtotal >= rule.minSubtotal) {
        return {
          matched: true,
          rule,
          shippingCharge: rule.shippingCharge,
        }
      }
    } else {
      if (subtotal >= rule.minSubtotal && subtotal < rule.maxSubtotal) {
        return {
          matched: true,
          rule,
          shippingCharge: rule.shippingCharge,
        }
      }
    }
  }

  const highestRule = activeRules[activeRules.length - 1]
  if (highestRule.maxSubtotal !== null && subtotal >= highestRule.maxSubtotal) {
    return {
      matched: false,
      rule: null,
      shippingCharge: 0,
      error: `Order subtotal of ₹${subtotal.toFixed(2)} exceeds the maximum configured shipping tier limit of ₹${highestRule.maxSubtotal}.`,
    }
  }

  return {
    matched: false,
    rule: null,
    shippingCharge: 0,
    error: `Order subtotal of ₹${subtotal.toFixed(2)} falls in an unconfigured shipping range gap.`,
  }
}

export type ShippingCalculationResult = {
  ok: boolean
  subtotal: number
  shippingCharge: number
  matchedRule: ShippingRule | null
  error?: string
}

// Central subtotal shipping calculation used across Checkout, Payment, and Orders.
export function calculateShippingCharge(
  subtotalInput: number,
  rules: ShippingRule[],
): ShippingCalculationResult {
  const subtotal = Math.max(0, Number(subtotalInput) || 0)
  const match = matchShippingRule(subtotal, rules)

  if (!match.matched) {
    return {
      ok: false,
      subtotal,
      shippingCharge: 0,
      matchedRule: null,
      error: match.error,
    }
  }

  return {
    ok: true,
    subtotal,
    shippingCharge: match.shippingCharge,
    matchedRule: match.rule,
  }
}

// Anti-tamper verification: ensures claimed fee does not exceed server cap while
// permitting promotional discounts (e.g. ₹0 free shipping promo).
export function assertShippingWithinAllowedCap(
  claimedShipping: number,
  subtotal: number,
  rules: ShippingRule[],
): { ok: true; cap: number } | { ok: false; cap: number; message: string } {
  const calc = calculateShippingCharge(subtotal, rules)
  if (!calc.ok) {
    return {
      ok: false,
      cap: 0,
      message: calc.error ?? "Failed to calculate shipping.",
    }
  }

  const cap = calc.shippingCharge
  const claimed = Number(claimedShipping)

  if (!Number.isFinite(claimed) || claimed < 0) {
    return { ok: false, cap, message: "Invalid shipping charge." }
  }

  if (claimed > cap + SHIPPING_MONEY_EPS) {
    return {
      ok: false,
      cap,
      message: `Shipping charge ₹${claimed} exceeds the allowed server shipping cap of ₹${cap}. Please refresh checkout.`,
    }
  }

  return { ok: true, cap }
}

// Preserved legacy helpers so existing courier parcel utilities continue to compile.
export type Ziply5ShippingBreakdown = {
  totalPacks: number
  chargeInr: number
  slab: Ziply5ShippingSlab | null
  usedHighestSlabFallback: boolean
  freeLargeOrderShipping: boolean
}

// Legacy pack-count slab calculation, deprecated in favor of subtotal rules.
export const calculateZiply5Shipping = (
  totalPacks: number,
): Ziply5ShippingBreakdown => {
  const n = Math.floor(Number(totalPacks))
  if (!Number.isFinite(n) || n < ZIPLY5_SHIPPING_MIN_PACKS) {
    return {
      totalPacks: Math.max(0, n),
      chargeInr: 0,
      slab: null,
      usedHighestSlabFallback: false,
      freeLargeOrderShipping: false,
    }
  }
  const freeLargeOrderShipping = n > ZIPLY5_PACKS_FREE_SHIPPING_ABOVE
  const { slab } = matchZiply5ShippingSlab(n)
  const chargeInr = freeLargeOrderShipping ? 0 : slab?.chargeInr ?? 0
  return {
    totalPacks: n,
    chargeInr,
    slab: freeLargeOrderShipping ? null : slab,
    usedHighestSlabFallback: false,
    freeLargeOrderShipping,
  }
}

/** @deprecated Legacy slab matcher. */
export const matchZiply5ShippingSlab = (
  totalPacks: number,
): { slab: Ziply5ShippingSlab | null } => {
  const n = Math.floor(Number(totalPacks))
  if (!Number.isFinite(n) || n < ZIPLY5_SHIPPING_MIN_PACKS) {
    return { slab: null }
  }
  if (n > ZIPLY5_PACKS_FREE_SHIPPING_ABOVE) {
    return { slab: null }
  }
  for (const slab of ZIPLY5_SHIPPING_SLABS) {
    if (n >= slab.minQty && n <= slab.maxQty) {
      return { slab }
    }
  }
  return { slab: null }
}

/** Helper to sum total quantities across checkout lines for parcel metadata. */
export const totalPacksFromCheckoutLines = (
  items: Array<{ quantity: number }>,
): number => {
  let sum = 0
  for (const line of items) {
    const q = Math.floor(Number(line.quantity))
    if (!Number.isFinite(q) || q < 1) continue
    sum += q
  }
  return sum
}

/** @deprecated Use assertShippingWithinAllowedCap with merchandise subtotal instead. */
export const assertZiply5ShippingWithinSlabCap = (
  claimedShipping: number,
  totalPacks: number,
): { ok: true; slabCapInr: number } | { ok: false; slabCapInr: number; message: string } => {
  const { chargeInr: cap } = calculateZiply5Shipping(totalPacks)
  const claimed = Number(claimedShipping)
  if (!Number.isFinite(claimed) || claimed < 0) {
    return { ok: false, slabCapInr: cap, message: "Invalid shipping charge." }
  }
  if (claimed > cap + 0.02) {
    return {
      ok: false,
      slabCapInr: cap,
      message: "Shipping charge exceeds allowed Ziply5 pricing. Please refresh checkout.",
    }
  }
  return { ok: true, slabCapInr: cap }
}

/** @deprecated Strict equality against legacy slab. */
export const assertZiply5ShippingMatchesSlab = (
  claimedShipping: number,
  totalPacks: number,
): { ok: true; expected: number } | { ok: false; expected: number; message: string } => {
  const { chargeInr } = calculateZiply5Shipping(totalPacks)
  const claimed = Number(claimedShipping)
  if (!Number.isFinite(claimed) || claimed < 0) {
    return { ok: false, expected: chargeInr, message: "Invalid shipping charge." }
  }
  if (Math.abs(claimed - chargeInr) > 0.02) {
    return {
      ok: false,
      expected: chargeInr,
      message: "Shipping charge does not match server pricing. Please refresh checkout.",
    }
  }
  return { ok: true, expected: chargeInr }
}

/** Utility to generate Shiprocket serviceability query payload. */
export const shiprocketServiceabilityPayload = (input: {
  pickupPostcode: string
  deliveryPostcode: string
  cod: 0 | 1
}) => ({
  pickup_postcode: input.pickupPostcode,
  delivery_postcode: input.deliveryPostcode,
  cod: input.cod,
  weight: SHIPROCKET_SERVICEABILITY_PLACEHOLDER_WEIGHT_KG,
  declared_value: SHIPROCKET_SERVICEABILITY_PLACEHOLDER_DECLARED_VALUE_INR,
})
