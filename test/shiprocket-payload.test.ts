import test from "node:test"
import assert from "node:assert/strict"
import { buildShiprocketLineItems, parseShiprocketAddress, weightToKg } from "@/src/server/modules/shipping/shiprocket.utils"

test("weightToKg treats gm and g pack sizes as grams", () => {
  assert.equal(weightToKg("240gm"), 0.24)
  assert.equal(weightToKg("350g"), 0.35)
  assert.equal(weightToKg("1.5kg"), 1.5)
  assert.equal(weightToKg("480"), 0.48)
  assert.equal(Math.round(weightToKg("240gm") * 2 * 1000) / 1000, 0.48)
})

test("parseShiprocketAddress keeps locality text in the street line", () => {
  const parsed = parseShiprocketAddress(
    "Road No.10, Bandlaguda Jagir, Sirdi Sai baba colony, Hyderabad, Telangana, 500086, India",
  )
  assert.equal(parsed.line1, "Road No.10, Bandlaguda Jagir, Sirdi Sai baba colony")
  assert.equal(parsed.city, "Hyderabad")
  assert.equal(parsed.state, "Telangana")
  assert.equal(parsed.pincode, "500086")
})

test("buildShiprocketLineItems keeps variant SKUs distinct", () => {
  const lines = buildShiprocketLineItems([
    { id: "a", quantity: 1, unitPrice: 239, sku: "TEST-MV-002-ROTI", variantName: "Meal with 3 Butter Parathas", product: { name: "Paneer Butter Masala Meal Box", sku: "TEST-MV-002" } },
    { id: "b", quantity: 1, unitPrice: 219, sku: "TEST-MV-002-RICE", variantName: "Meal with Jeera Rice", product: { name: "Paneer Butter Masala Meal Box", sku: "TEST-MV-002" } },
  ])
  assert.deepEqual(lines.map((line) => line.sku), ["TEST-MV-002-ROTI", "TEST-MV-002-RICE"])
})

test("parseShiprocketAddress keeps a simple checkout address intact", () => {
  const parsed = parseShiprocketAddress("12-3-45, Hyderabad, Telangana, 500086, India")
  assert.equal(parsed.line1, "12-3-45")
  assert.equal(parsed.city, "Hyderabad")
  assert.equal(parsed.state, "Telangana")
  assert.equal(parsed.pincode, "500086")
})
