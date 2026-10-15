import assert from "node:assert/strict"
import test from "node:test"
import { mapShiprocketCourierQuote } from "./shiprocket-quote"

const delhiverySurface = {
  courier_name: "Delhivery Surface 20kg",
  courier_company_id: 101,
  rate: 5362.67,
  freight_charge: 5314.32,
  cod_charges: 48.35,
  estimated_delivery_days: "2",
  etd: "Oct 17, 2026",
  etd_hours: 44,
  charge_weight: 200,
  min_weight: 20,
  cod: 1,
}

test("courier quote keeps Shiprocket name and uses rate, delivery days, and chargeable weight", () => {
  const quote = mapShiprocketCourierQuote(delhiverySurface)
  assert.equal(quote.name, "Delhivery Surface 20kg")
  assert.equal(quote.rate, 5362.67)
  assert.equal(quote.eta_days, 2)
  assert.equal(quote.etd, "Oct 17, 2026")
  assert.equal(quote.cod_available, true)
  assert.equal(quote.charge_weight_kg, 200)
  assert.equal(quote.min_weight_kg, 20)
  assert.equal(quote.courier_company_id, 101)
})

test("delivery hours are not shown as days and a missing COD flag is not treated as available", () => {
  const quote = mapShiprocketCourierQuote({
    courier_name: "Delhivery Surface",
    etd_hours: 44,
    freight_charge: 40,
  })
  assert.equal(quote.eta_days, 0)
  assert.equal(quote.rate, 40)
  assert.equal(quote.cod_available, false)
  assert.equal(quote.charge_weight_kg, undefined)
})
