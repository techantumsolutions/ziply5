import assert from "node:assert/strict"
import test from "node:test"
import { codAmountsMatch, codPaymentReferenceId } from "./cod-payment-link"

test("each order id is a unique payment-link reference", () => {
  const first = "4aeaa29f-bc23-4527-a04b-4eefd17f5f10"
  const second = "8c614da4-75e1-4663-b7f5-b047b481ed9e"
  assert.equal(codPaymentReferenceId(first), "4aeaa29fbc234527a04b4eefd17f5f10")
  assert.notEqual(codPaymentReferenceId(first), codPaymentReferenceId(second))
  assert.ok(codPaymentReferenceId(first).length <= 40)
})

test("a COD link accepts only the exact order total", () => {
  assert.equal(codAmountsMatch(584.9, 58490), true)
  assert.equal(codAmountsMatch(584.9, 58491), false)
  assert.equal(codAmountsMatch(100, 0), false)
})
