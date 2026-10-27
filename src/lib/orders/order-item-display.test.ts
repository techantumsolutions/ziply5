import assert from "node:assert/strict"
import test from "node:test"
import {
  multiplyWeight,
  resolveItemHsn,
  resolveItemPackName,
  resolveItemPackQuantity,
  resolveItemSavings,
  resolveItemSku,
  resolveItemWeightDisplay,
} from "./order-item-display"

test("multiplyWeight multiplies numeric weight while preserving unit", () => {
  assert.equal(multiplyWeight("350g", 2), "700g")
  assert.equal(multiplyWeight("240gm", 2), "480gm")
  assert.equal(multiplyWeight("500 g", 3), "1500 g")
  assert.equal(multiplyWeight("1kg", 2), "2kg")
  assert.equal(multiplyWeight("1.5 kg", 2), "3 kg")
  assert.equal(multiplyWeight("100ml", 4), "400ml")
  assert.equal(multiplyWeight("350g", 1), "350g")
  assert.equal(multiplyWeight("", 2), "")
  assert.equal(multiplyWeight(null, 2), "")
})

test("resolveItemWeightDisplay formats weight * pack multiplier", () => {
  assert.equal(resolveItemWeightDisplay("350g", 2), "350g * 2")
  assert.equal(resolveItemWeightDisplay("240gm", 3), "240gm * 3")
  assert.equal(resolveItemWeightDisplay("1kg", 1), "1kg")
  assert.equal(resolveItemWeightDisplay("", 2), "")
  assert.equal(resolveItemWeightDisplay(null, 2), "")
})

test("resolveItemPackName resolves pack name from packs config or quantity", () => {
  assert.equal(
    resolveItemPackName({
      sku: "TEST-MV-001-REG-PACK-2",
      unitPrice: 598,
    }),
    "Pack of 2"
  )

  assert.equal(
    resolveItemPackName({
      sku: "TEST-MV-001-REG",
      unitPrice: 598,
      variantId: "v-1",
      product: {
        packs: [
          { variantId: "v-1", name: "Family Pack of 2", quantity: 2, price: 598 },
        ],
      },
    }),
    "Family Pack of 2"
  )

  assert.equal(
    resolveItemPackName({
      sku: "TEST-MV-001-REG",
      unitPrice: 299,
      variant: { price: 299 },
    }),
    null
  )
})

test("resolveItemSku prioritizes variant SKU and strips any -PACK- suffix", () => {
  assert.equal(
    resolveItemSku({
      sku: "TEST-MV-001-REG-PACK-2",
      variant: { sku: "TEST-MV-001-REG" },
    }),
    "TEST-MV-001-REG"
  )

  assert.equal(
    resolveItemSku({
      sku: "TEST-MV-001-REG-PACK-2",
      variant: null,
    }),
    "TEST-MV-001-REG"
  )

  assert.equal(
    resolveItemSku({
      sku: null,
      variant: { sku: "TEST-MV-001-REG-PACK-3" },
    }),
    "TEST-MV-001-REG"
  )

  assert.equal(
    resolveItemSku({
      sku: null,
      variant: null,
      product: { sku: "PROD-SKU" },
    }),
    "PROD-SKU"
  )
})

test("resolveItemHsn prioritizes variant HSN", () => {
  assert.equal(
    resolveItemHsn({
      variant: { hsnCode: "21069099" },
      product: { hsnCode: "11111111" },
    }),
    "21069099"
  )

  assert.equal(
    resolveItemHsn({
      variant: null,
      product: { hsnCode: "21069099" },
    }),
    "21069099"
  )

  assert.equal(
    resolveItemHsn({
      variant: null,
      product: null,
    }),
    "—"
  )
})

test("resolveItemPackQuantity parses -PACK- suffix and matches product packs", () => {
  // 1. From -PACK-2 in SKU
  assert.equal(
    resolveItemPackQuantity({
      sku: "TEST-MV-001-REG-PACK-2",
      unitPrice: 598,
    }),
    2
  )

  // 2. From product.packs configuration
  assert.equal(
    resolveItemPackQuantity({
      sku: "TEST-MV-001-REG",
      unitPrice: 598,
      variantId: "v-1",
      product: {
        packs: [
          { variantId: "v-1", quantity: 2, price: 598 },
          { variantId: "v-1", quantity: 3, price: 850 },
        ],
      },
    }),
    2
  )

  // 3. Fallback when not a pack
  assert.equal(
    resolveItemPackQuantity({
      sku: "TEST-MV-001-REG",
      unitPrice: 299,
      variant: { price: 299 },
    }),
    1
  )

  // 4. Prioritizes snapshot on order item even if product packs differ
  assert.equal(
    resolveItemPackQuantity({
      packQuantity: 4,
      sku: "TEST-MV-001-REG",
      unitPrice: 999,
      product: {
        packs: [{ quantity: 2, price: 499 }],
      },
    }),
    4
  )
})

test("resolveItemPackName prioritizes snapshot packName", () => {
  assert.equal(
    resolveItemPackName({
      packName: "Mega Saver Pack of 4",
      product: {
        packs: [{ name: "Small Pack of 2" }],
      },
    }),
    "Mega Saver Pack of 4"
  )
})

test("resolveItemSavings calculates savings from snapshot comparePrice", () => {
  const result = resolveItemSavings({
    unitPrice: 499,
    comparePrice: 598,
    quantity: 2,
  })
  assert.equal(result.hasSavings, true)
  assert.equal(result.unitPrice, 499)
  assert.equal(result.comparePrice, 598)
  assert.equal(result.savingPerUnit, 99)
  assert.equal(result.totalSavings, 198)
  assert.equal(result.discountPercent, 17)
})

test("resolveItemSavings calculates savings from snapshot savingAmount", () => {
  const result = resolveItemSavings({
    unitPrice: 200,
    savingAmount: 100,
    quantity: 2,
  })
  assert.equal(result.hasSavings, true)
  assert.equal(result.unitPrice, 200)
  assert.equal(result.comparePrice, 250)
  assert.equal(result.totalSavings, 100)
  assert.equal(result.discountPercent, 20)
})

test("resolveItemSavings returns hasSavings: false when unitPrice >= comparePrice", () => {
  const result = resolveItemSavings({
    unitPrice: 299,
    comparePrice: 299,
    quantity: 1,
  })
  assert.equal(result.hasSavings, false)
  assert.equal(result.totalSavings, 0)
  assert.equal(result.discountPercent, 0)
})
