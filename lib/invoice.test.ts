import assert from "node:assert/strict"
import test from "node:test"
import { isInvoiceOrderPaid, resolveInvoicePaidFrom, resolveInvoiceReferenceNo, type OrderForInvoice } from "./invoice"

test("isInvoiceOrderPaid identifies paid status", () => {
  const paidOrders: OrderForInvoice[] = [
    { id: "o1", status: "confirmed", currency: "INR", total: 100, createdAt: "2026-05-13", paymentStatus: "SUCCESS" },
    { id: "o2", status: "confirmed", currency: "INR", total: 100, createdAt: "2026-05-13", paymentStatus: "paid" },
    { id: "o3", status: "payment_success", currency: "INR", total: 100, createdAt: "2026-05-13" },
    { id: "o4", status: "confirmed", currency: "INR", total: 100, createdAt: "2026-05-13", transactions: [{ id: "tx1", status: "paid" }] },
    { id: "o5", status: "confirmed", currency: "INR", total: 100, createdAt: "2026-05-13", transactions: [{ id: "tx2", status: "captured" }] },
    { id: "o6", status: "confirmed", currency: "INR", total: 100, createdAt: "2026-05-13", paymentId: "pay_123456" },
  ]

  for (const o of paidOrders) {
    assert.equal(isInvoiceOrderPaid(o), true, `Order ${o.id} should be paid`)
  }

  const unpaidOrders: OrderForInvoice[] = [
    { id: "u1", status: "confirmed", currency: "INR", total: 100, createdAt: "2026-05-13", paymentMethod: "cod", paymentStatus: "PENDING" },
    { id: "u2", status: "pending", currency: "INR", total: 100, createdAt: "2026-05-13", paymentStatus: null },
    { id: "u3", status: "confirmed", currency: "INR", total: 100, createdAt: "2026-05-13", paymentId: "checkout_ref:abcd" },
  ]

  for (const o of unpaidOrders) {
    assert.equal(isInvoiceOrderPaid(o), false, `Order ${o.id} should be unpaid`)
  }
})

test("resolveInvoicePaidFrom detects Shiprocket and explicit sources", () => {
  // Explicit paidFrom
  assert.equal(
    resolveInvoicePaidFrom({ id: "1", status: "confirmed", currency: "INR", total: 100, createdAt: "2026-05-13", paidFrom: "Custom Gateway" }),
    "Custom Gateway"
  )

  // From Shiprocket order ID
  assert.equal(
    resolveInvoicePaidFrom({ id: "2", status: "confirmed", currency: "INR", total: 100, createdAt: "2026-05-13", shiprocketOrderId: "1342165007" }),
    "Shiprocket"
  )

  // From Shiprocket shipment
  assert.equal(
    resolveInvoicePaidFrom({ id: "3", status: "confirmed", currency: "INR", total: 100, createdAt: "2026-05-13", awbCode: "19041917817131" }),
    "Shiprocket"
  )

  // From paymentMethod = shiprocket
  assert.equal(
    resolveInvoicePaidFrom({ id: "4", status: "confirmed", currency: "INR", total: 100, createdAt: "2026-05-13", paymentMethod: "shiprocket" }),
    "Shiprocket"
  )

  // Razorpay without Shiprocket
  assert.equal(
    resolveInvoicePaidFrom({ id: "5", status: "confirmed", currency: "INR", total: 100, createdAt: "2026-05-13", paymentMethod: "razorpay" }),
    "Razorpay"
  )
})

test("resolveInvoiceReferenceNo selects the best reference number", () => {
  // 1. refNo prioritized
  assert.equal(
    resolveInvoiceReferenceNo({ id: "o1", status: "confirmed", currency: "INR", total: 100, createdAt: "2026-05-13", refNo: "REF-100", paymentId: "pay_1" }),
    "REF-100"
  )

  // 2. transaction refNo
  assert.equal(
    resolveInvoiceReferenceNo({ id: "o2", status: "confirmed", currency: "INR", total: 100, createdAt: "2026-05-13", transactions: [{ id: "tx1", refNo: "TX-REF-1" }] }),
    "TX-REF-1"
  )

  // 3. real paymentId (pay_...)
  assert.equal(
    resolveInvoiceReferenceNo({ id: "o3", status: "confirmed", currency: "INR", total: 100, createdAt: "2026-05-13", paymentId: "pay_SoriX7CfKBdTur" }),
    "pay_SoriX7CfKBdTur"
  )

  // 4. shiprocketOrderId prioritized over checkout_ref
  assert.equal(
    resolveInvoiceReferenceNo({ id: "o4", status: "confirmed", currency: "INR", total: 100, createdAt: "2026-05-13", paymentId: "checkout_ref:abc", shiprocketOrderId: "1342165007" }),
    "1342165007"
  )

  // 5. fallback to order id
  assert.equal(
    resolveInvoiceReferenceNo({ id: "o5-fallback", status: "confirmed", currency: "INR", total: 100, createdAt: "2026-05-13" }),
    "o5-fallback"
  )
})

