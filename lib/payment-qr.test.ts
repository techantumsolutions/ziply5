import assert from "node:assert/strict"
import test from "node:test"
import { buildPaymentQrMatrix, paymentDataCodewords } from "./payment-qr"

test("byte mode pads a short payload to the version capacity", () => {
  const words = paymentDataCodewords("A", 1)
  assert.deepEqual(words.slice(0, 6), [0x40, 0x14, 0x10, 0xec, 0x11, 0xec])
  assert.equal(words.length, 16)
})

test("a payment url matches a scannable symbol", () => {
  const matrix = buildPaymentQrMatrix("https://rzp.io/rzp/9fqPHqW")
  assert.equal(matrix.length, 25)
  assert.equal(matrix[0][0], true)
  assert.equal(matrix[1][8], true)
  assert.equal(matrix[17][8], true)
})

test("each payment url gets its own QR matrix", () => {
  const first = buildPaymentQrMatrix("https://rzp.io/i/order-one")
  const second = buildPaymentQrMatrix("https://rzp.io/i/order-two")
  assert.equal(first.length, first[0].length)
  assert.equal(first[0][0], true)
  assert.equal(first[6][6], true)
  assert.notDeepEqual(first, second)
})
