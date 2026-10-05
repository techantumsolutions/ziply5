import test from "node:test"
import assert from "node:assert/strict"
import {
  // New dynamic shipping rules module exports
  DEFAULT_SHIPPING_RULES,
  validateShippingRules,
  calculateShippingCharge,
  assertShippingWithinAllowedCap,
  type ShippingRule,

  // Legacy pack-count slab helpers (backward-compat tests)
  calculateZiply5Shipping,
  matchZiply5ShippingSlab,
  totalPacksFromCheckoutLines,
  assertZiply5ShippingWithinSlabCap,
  assertZiply5ShippingMatchesSlab,
} from "@/src/lib/shipping/ziply5-shipping"

// Dynamic subtotal-based shipping rules tests

// Verifies lower-inclusive and upper-exclusive [min, max) boundaries.
test("dynamic rules: exact range boundaries (lower-inclusive, upper-exclusive)", () => {
  const rules: ShippingRule[] = [
    { id: "r1", minSubtotal: 250, maxSubtotal: 1000, shippingCharge: 125, active: true },
    { id: "r2", minSubtotal: 1000, maxSubtotal: 2000, shippingCharge: 250, active: true },
    { id: "r3", minSubtotal: 2000, maxSubtotal: null, shippingCharge: 0, active: true },
  ]

  // Lower-inclusive boundary of r1 (subtotal = 250 matches r1)
  const at250 = calculateShippingCharge(250, rules)
  assert.equal(at250.ok, true)
  assert.equal(at250.shippingCharge, 125)
  assert.equal(at250.matchedRule?.id, "r1")

  // Interior of r1
  const at500 = calculateShippingCharge(500, rules)
  assert.equal(at500.ok, true)
  assert.equal(at500.shippingCharge, 125)

  // Just below upper boundary of r1
  const at999 = calculateShippingCharge(999.99, rules)
  assert.equal(at999.ok, true)
  assert.equal(at999.shippingCharge, 125)
  assert.equal(at999.matchedRule?.id, "r1")

  // Exact boundary 1000 transitions to r2 (upper-exclusive on r1, lower-inclusive on r2)
  const at1000 = calculateShippingCharge(1000, rules)
  assert.equal(at1000.ok, true)
  assert.equal(at1000.shippingCharge, 250)
  assert.equal(at1000.matchedRule?.id, "r2")

  // Just below upper boundary of r2
  const at1999 = calculateShippingCharge(1999.99, rules)
  assert.equal(at1999.ok, true)
  assert.equal(at1999.shippingCharge, 250)
  assert.equal(at1999.matchedRule?.id, "r2")

  // Exact boundary 2000 transitions to open-ended r3
  const at2000 = calculateShippingCharge(2000, rules)
  assert.equal(at2000.ok, true)
  assert.equal(at2000.shippingCharge, 0)
  assert.equal(at2000.matchedRule?.id, "r3")
})

// Verifies open-ended final tier (maxSubtotal: null) supports high subtotals.
test("dynamic rules: open-ended final tier covers high subtotals", () => {
  const rules: ShippingRule[] = [
    { id: "r1", minSubtotal: 0, maxSubtotal: 1000, shippingCharge: 125, active: true },
    { id: "r2", minSubtotal: 1000, maxSubtotal: null, shippingCharge: 0, active: true },
  ]

  assert.equal(calculateShippingCharge(1000, rules).shippingCharge, 0)
  assert.equal(calculateShippingCharge(5000, rules).shippingCharge, 0)
  assert.equal(calculateShippingCharge(100000, rules).shippingCharge, 0)
})

// Verifies empty cart (subtotal = 0) returns zero shipping fee.
test("dynamic rules: empty cart (subtotal = 0) returns zero shipping", () => {
  const rules: ShippingRule[] = [
    { id: "r1", minSubtotal: 250, maxSubtotal: 1000, shippingCharge: 125, active: true },
  ]
  const res = calculateShippingCharge(0, rules)
  assert.equal(res.ok, true)
  assert.equal(res.shippingCharge, 0)
})

// Verifies error handling for subtotals below minimum, in tier gaps, or above max.
test("dynamic rules: out-of-range subtotals (below minimum, gaps, and above maximum)", () => {
  const rules: ShippingRule[] = [
    { id: "r1", minSubtotal: 250, maxSubtotal: 500, shippingCharge: 100, active: true },
    { id: "r2", minSubtotal: 700, maxSubtotal: 1000, shippingCharge: 200, active: true },
  ]

  // Subtotal below first range (where subtotal > 0)
  const below = calculateShippingCharge(150, rules)
  assert.equal(below.ok, false)
  assert.match(below.error!, /below the minimum serviceable shipping tier/)

  // Subtotal in gap [500, 700)
  const inGap = calculateShippingCharge(600, rules)
  assert.equal(inGap.ok, false)
  assert.match(inGap.error!, /falls in an unconfigured shipping range gap/)

  // Subtotal above last finite range [1000, ∞)
  const above = calculateShippingCharge(1500, rules)
  assert.equal(above.ok, false)
  assert.match(above.error!, /exceeds the maximum configured shipping tier/)
})

// Verifies validator rejects overlaps, inverted bounds, and negative fees.
test("dynamic rules: validation rejects invalid settings (overlaps, min >= max, negative fees)", () => {
  // Overlapping ranges
  const overlap = validateShippingRules([
    { minSubtotal: 0, maxSubtotal: 1000, shippingCharge: 100, active: true },
    { minSubtotal: 800, maxSubtotal: 2000, shippingCharge: 200, active: true },
  ])
  assert.equal(overlap.valid, false)
  assert.match(overlap.errors[0], /overlap/i)

  // min >= max
  const minGteMax = validateShippingRules([
    { minSubtotal: 1000, maxSubtotal: 500, shippingCharge: 100, active: true },
  ])
  assert.equal(minGteMax.valid, false)
  assert.match(minGteMax.errors[0], /greater than minimum/i)

  // Negative shipping charge
  const negCharge = validateShippingRules([
    { minSubtotal: 0, maxSubtotal: 1000, shippingCharge: -50, active: true },
  ])
  assert.equal(negCharge.valid, false)
  assert.match(negCharge.errors[0], /finite number greater than or equal to 0/i)

  // Open-ended rule not at the end
  const openEndedNotLast = validateShippingRules([
    { minSubtotal: 0, maxSubtotal: null, shippingCharge: 100, active: true },
    { minSubtotal: 1000, maxSubtotal: 2000, shippingCharge: 200, active: true },
  ])
  assert.equal(openEndedNotLast.valid, false)
  assert.match(openEndedNotLast.errors[0], /highest tier|overlaps/i)
})

// Verifies rejection of missing, empty, or inactive rule configurations.
test("dynamic rules: validation handles missing, empty, or non-active rules", () => {
  assert.equal(validateShippingRules(null).valid, false)
  assert.equal(validateShippingRules([]).valid, false)
  assert.equal(
    validateShippingRules([
      { minSubtotal: 0, maxSubtotal: 1000, shippingCharge: 100, active: false },
    ]).valid,
    false,
  )
})

// Verifies anti-tamper check permits promos while rejecting fee inflation.
test("dynamic rules: anti-tamper cap checks (allows promotions, rejects inflation)", () => {
  const rules = [...DEFAULT_SHIPPING_RULES] as ShippingRule[]
  // For subtotal 500, expected charge is 125
  const normal = assertShippingWithinAllowedCap(125, 500, rules)
  assert.equal(normal.ok, true)
  assert.equal(normal.cap, 125)

  // Promotional discount allowed (e.g. ₹0 or ₹50)
  const freePromo = assertShippingWithinAllowedCap(0, 500, rules)
  assert.equal(freePromo.ok, true)

  const partialDiscount = assertShippingWithinAllowedCap(50, 500, rules)
  assert.equal(partialDiscount.ok, true)

  // Tampering above allowed cap is rejected
  const tamperedAbove = assertShippingWithinAllowedCap(200, 500, rules)
  assert.equal(tamperedAbove.ok, false)
  assert.match(tamperedAbove.message, /exceeds the allowed/i)

  // Negative shipping is rejected
  const negative = assertShippingWithinAllowedCap(-10, 500, rules)
  assert.equal(negative.ok, false)
})

// Verifies order total consistency across subtotal, shipping, tax, and promos.
test("dynamic rules: order total consistency with dynamic shipping and discounts", () => {
  const rules: ShippingRule[] = [
    { id: "r1", minSubtotal: 0, maxSubtotal: 1000, shippingCharge: 125, active: true },
    { id: "r2", minSubtotal: 1000, maxSubtotal: null, shippingCharge: 0, active: true },
  ]

  // Normal order
  const subtotal = 800
  const shipping = calculateShippingCharge(subtotal, rules).shippingCharge
  const tax = subtotal * 0.05
  const discount = 50
  const total = subtotal + shipping + tax - discount
  assert.equal(shipping, 125)
  assert.equal(tax, 40)
  assert.equal(total, 915)

  // Order crossing free shipping threshold
  const subtotalLarge = 1200
  const shippingLarge = calculateShippingCharge(subtotalLarge, rules).shippingCharge
  const taxLarge = subtotalLarge * 0.05
  const totalLarge = subtotalLarge + shippingLarge + taxLarge
  assert.equal(shippingLarge, 0)
  assert.equal(totalLarge, 1260)
})

// Legacy backward compatibility tests

const expectCharge = (
  packs: number,
  charge: number,
  opts?: { freeLargeOrder?: boolean },
) => {
  const r = calculateZiply5Shipping(packs)
  assert.equal(r.chargeInr, charge, `packs=${packs}`)
  assert.equal(r.usedHighestSlabFallback, false, `usedHighestSlabFallback packs=${packs}`)
  assert.equal(r.freeLargeOrderShipping, opts?.freeLargeOrder ?? false, `freeLargeOrder packs=${packs}`)
}

test("legacy: slab charges (spec table)", () => {
  expectCharge(1, 125)
  expectCharge(2, 125)
  expectCharge(3, 125)
  expectCharge(4, 250)
  expectCharge(5, 250)
  expectCharge(6, 250)
  expectCharge(7, 450)
  expectCharge(18, 450)
  expectCharge(19, 550)
  expectCharge(24, 550)
  expectCharge(30, 550)
})

test("legacy: 31+ packs: free shipping", () => {
  expectCharge(31, 0, { freeLargeOrder: true })
  expectCharge(100, 0, { freeLargeOrder: true })
})

test("legacy: zero or invalid packs => no charge", () => {
  assert.equal(calculateZiply5Shipping(0).chargeInr, 0)
  assert.equal(calculateZiply5Shipping(-3).chargeInr, 0)
})

test("legacy: matchZiply5ShippingSlab edge boundaries", () => {
  assert.equal(matchZiply5ShippingSlab(3).slab?.chargeInr, 125)
  assert.equal(matchZiply5ShippingSlab(4).slab?.chargeInr, 250)
  assert.equal(matchZiply5ShippingSlab(6).slab?.chargeInr, 250)
  assert.equal(matchZiply5ShippingSlab(7).slab?.chargeInr, 450)
  assert.equal(matchZiply5ShippingSlab(30).slab?.chargeInr, 550)
  assert.equal(matchZiply5ShippingSlab(31).slab, null)
})

test("legacy: shipping cap allows discounted or free shipping", () => {
  assert.equal(assertZiply5ShippingWithinSlabCap(0, 5).ok, true)
  assert.equal(assertZiply5ShippingWithinSlabCap(100, 5).ok, true)
  assert.equal(assertZiply5ShippingWithinSlabCap(300, 5).ok, false)
})

test("legacy: large-order free cap: only zero shipping allowed when packs > 30", () => {
  assert.equal(assertZiply5ShippingWithinSlabCap(0, 40).ok, true)
  assert.equal(assertZiply5ShippingWithinSlabCap(1, 40).ok, false)
})

test("legacy: strict slab match helper", () => {
  assert.equal(assertZiply5ShippingMatchesSlab(250, 5).ok, true)
  assert.equal(assertZiply5ShippingMatchesSlab(125, 5).ok, false)
  assert.equal(assertZiply5ShippingMatchesSlab(0, 40).ok, true)
  assert.equal(assertZiply5ShippingMatchesSlab(550, 40).ok, false)
})

test("legacy: totalPacksFromCheckoutLines sums quantities", () => {
  assert.equal(
    totalPacksFromCheckoutLines([
      { quantity: 2 },
      { quantity: 3 },
    ]),
    5,
  )
})
