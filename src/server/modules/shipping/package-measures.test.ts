import assert from "node:assert/strict"
import test from "node:test"
import {
  assessPackageMeasures,
  awbQuoteWarning,
  packageQuoteKey,
  shiprocketPackagePayload,
} from "./package-measures"
import { mapShiprocketCourierQuote } from "./shiprocket-quote"

test("package centimetres and kilograms are sent unchanged", () => {
  assert.deepEqual(
    shiprocketPackagePayload({ weightKg: 0.8, lengthCm: 100, widthCm: 100, heightCm: 100 }),
    { weight: 0.8, length: 100, breadth: 100, height: 100 },
  )
  const small = assessPackageMeasures({ weightKg: 0.8, lengthCm: 20, widthCm: 15, heightCm: 10 })
  assert.equal(small.ok, true)
  assert.equal(small.requiresConfirmation, false)
})

test("a 100 cm box for 0.8 kg requires confirmation and keeps the entered size", () => {
  const review = assessPackageMeasures({ weightKg: 0.8, lengthCm: 100, widthCm: 100, heightCm: 100 })
  assert.equal(review.ok, true)
  assert.equal(review.requiresConfirmation, true)
  assert.match(review.reason ?? "", /100 × 100 × 100 cm/)
  assert.match(review.reason ?? "", /0\.8 kg/)
  assert.doesNotMatch(review.reason ?? "", /5000|200 kg/)
})

test("missing dimensions are rejected and a changed size changes the quote key", () => {
  const missing = assessPackageMeasures({ weightKg: 0.8, lengthCm: 0, widthCm: 10, heightCm: 10 })
  assert.equal(missing.ok, false)
  assert.equal(missing.missing, true)
  assert.notEqual(
    packageQuoteKey({ weightKg: 0.8, lengthCm: 20, widthCm: 15, heightCm: 10 }),
    packageQuoteKey({ weightKg: 0.8, lengthCm: 100, widthCm: 100, heightCm: 100 }),
  )
})

test("AWB warning uses the API chargeable weight and leaves courier fields distinct", () => {
  const warning = awbQuoteWarning({
    weightKg: 0.8,
    lengthCm: 100,
    widthCm: 100,
    heightCm: 100,
    chargeableKg: 200,
  })
  assert.equal(warning.block, false)
  assert.equal(warning.confirm, true)
  assert.match(warning.message ?? "", /200 kg/)
  assert.doesNotMatch(warning.message ?? "", /5000/)

  const quote = mapShiprocketCourierQuote({
    courier_name: "Delhivery Surface 20kg",
    rate: 5362.67,
    freight_charge: 5314.32,
    min_weight: 20,
    charge_weight: 200,
    estimated_delivery_days: "2",
    cod: 1,
  })
  assert.equal(quote.name, "Delhivery Surface 20kg")
  assert.equal(quote.rate, 5362.67)
  assert.equal(quote.min_weight_kg, 20)
  assert.equal(quote.charge_weight_kg, 200)
  assert.notEqual(quote.min_weight_kg, quote.charge_weight_kg)

  const compact = awbQuoteWarning({ weightKg: 0.8, lengthCm: 20, widthCm: 15, heightCm: 10, chargeableKg: 0.8 })
  assert.equal(compact.confirm, false)
  const absent = awbQuoteWarning({ weightKg: 0.8, lengthCm: null, widthCm: 10, heightCm: 10, chargeableKg: null })
  assert.equal(absent.block, true)
})
