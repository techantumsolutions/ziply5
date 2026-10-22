import test from "node:test"
import assert from "node:assert/strict"
import crypto from "node:crypto"
import {
  parseAndVerifyWebhook,
  processWebhookEvent,
  type WebhookEventDeps,
} from "@/src/server/modules/payments/payments.service"

const TEST_WEBHOOK_SECRET = "test_webhook_secret_key_12345"

const createSignature = (payload: string, secret = TEST_WEBHOOK_SECRET) => {
  return crypto.createHmac("sha256", secret).update(payload).digest("hex")
}

// 1. Valid signature
test("1. Valid webhook signature: accepts payload matching secret", () => {
  process.env.RAZORPAY_WEBHOOK_SECRET = TEST_WEBHOOK_SECRET
  const payloadObj = { event: "payment.captured", payload: { payment: { entity: { id: "pay_1" } } } }
  const payloadStr = JSON.stringify(payloadObj)
  const signature = createSignature(payloadStr)

  const result = parseAndVerifyWebhook({
    providerRaw: "razorpay",
    payload: payloadStr,
    signature,
  })

  assert.deepEqual(result, payloadObj)
})

// 2. Invalid signature
test("2. Invalid webhook signature: rejects mismatched signature with 401-triggering error", () => {
  process.env.RAZORPAY_WEBHOOK_SECRET = TEST_WEBHOOK_SECRET
  const payloadStr = JSON.stringify({ event: "payment.captured" })
  const wrongSignature = createSignature(payloadStr, "wrong_secret")

  assert.throws(
    () => {
      parseAndVerifyWebhook({
        providerRaw: "razorpay",
        payload: payloadStr,
        signature: wrongSignature,
      })
    },
    /Invalid Razorpay signature/i,
  )
})

// 3. Missing signature
test("3. Missing signature: rejects when signature header is missing or null", () => {
  process.env.RAZORPAY_WEBHOOK_SECRET = TEST_WEBHOOK_SECRET
  const payloadStr = JSON.stringify({ event: "payment.captured" })

  assert.throws(
    () => {
      parseAndVerifyWebhook({
        providerRaw: "razorpay",
        payload: payloadStr,
        signature: null,
      })
    },
    /Missing razorpay signature/i,
  )
})

// 4. Missing webhook secret
test("4. Missing webhook secret: throws configuration error safely", () => {
  const origRzp = process.env.RAZORPAY_WEBHOOK_SECRET
  const origPay = process.env.PAYMENT_WEBHOOK_SECRET
  delete process.env.RAZORPAY_WEBHOOK_SECRET
  delete process.env.PAYMENT_WEBHOOK_SECRET
  try {
    const payloadStr = JSON.stringify({ event: "payment.captured" })
    assert.throws(
      () => {
        parseAndVerifyWebhook({
          providerRaw: "razorpay",
          payload: payloadStr,
          signature: "some_signature",
        })
      },
      /Razorpay webhook secret is not configured/i,
    )
  } finally {
    process.env.RAZORPAY_WEBHOOK_SECRET = origRzp ?? TEST_WEBHOOK_SECRET
    if (origPay) process.env.PAYMENT_WEBHOOK_SECRET = origPay
  }
})

// 5. Malformed JSON
test("5. Malformed JSON: rejects invalid json payload with 400 error after signature check", () => {
  process.env.RAZORPAY_WEBHOOK_SECRET = TEST_WEBHOOK_SECRET
  const malformed = "{ event: 'payment.captured', unclosed: "
  const signature = createSignature(malformed)

  assert.throws(
    () => {
      parseAndVerifyWebhook({
        providerRaw: "razorpay",
        payload: malformed,
        signature,
      })
    },
    /Malformed webhook payload/i,
  )
})

// 6. payment.authorized does not prematurely mark order paid
test("6. payment.authorized: retains PENDING payment status and records authorized transaction without marking paid", async () => {
  let orderPaymentStatus = "PENDING"
  let txStatus = "pending"
  let historyNote: string | null = null

  const deps: WebhookEventDeps = {
    getOrderById: async (id) => ({
      id,
      total: 800,
      paymentStatus: orderPaymentStatus,
      paymentMethod: "razorpay",
      status: "pending",
    }),
    updateTransactionStatus: async (input) => {
      txStatus = input.status
      return true
    },
    appendOrderStatusHistory: async (input) => {
      historyNote = input.notes
      return true
    },
  }

  const event = {
    event: "payment.authorized",
    payload: {
      payment: {
        entity: {
          id: "pay_auth_001",
          order_id: "order_rzp_auth",
          amount: 80000,
          currency: "INR",
          notes: { orderId: "ord_ziply_auth" },
        },
      },
    },
  }

  const result = await processWebhookEvent("razorpay", event, null, deps)

  assert.equal(result.applied, true)
  assert.equal(result.status, "authorized")
  // Must NOT mark as SUCCESS (not captured yet)
  assert.equal(orderPaymentStatus, "PENDING")
  assert.equal(txStatus, "authorized")
  assert.match(String(historyNote), /awaiting capture/i)
})

// 7. payment.captured marks the correct order paid
test("7. payment.captured: marks the correct order paid and sets paymentStatus to SUCCESS", async () => {
  let orderPaymentStatus = "PENDING"
  let recordedPaymentId: string | null = null
  let txStatus = "pending"

  const deps: WebhookEventDeps = {
    getOrderById: async (id) => ({
      id,
      total: 500,
      currency: "INR",
      paymentStatus: orderPaymentStatus,
      paymentMethod: "razorpay",
      status: "pending",
    }),
    markOrderPaymentSuccess: async (id, paymentId) => {
      orderPaymentStatus = "SUCCESS"
      recordedPaymentId = paymentId
      return true
    },
    updateTransactionStatus: async (input) => {
      txStatus = input.status
      return true
    },
    appendOrderStatusHistory: async () => true,
  }

  const event = {
    event: "payment.captured",
    payload: {
      payment: {
        entity: {
          id: "pay_captured_001",
          order_id: "order_rzp_123",
          amount: 50000, // 500 INR in paise
          currency: "INR",
          notes: { orderId: "ord_ziply_1" },
        },
      },
    },
  }

  const result = await processWebhookEvent("razorpay", event, null, deps)

  assert.equal(result.applied, true)
  assert.equal(result.paid, true)
  assert.equal(orderPaymentStatus, "SUCCESS")
  assert.equal(recordedPaymentId, "pay_captured_001")
  assert.equal(txStatus, "paid")
})

// 8. payment.failed records the attempt
test("8. payment.failed: records failed attempt with error details without destroying order", async () => {
  let orderPaymentStatus = "PENDING"
  let txStatus = "pending"
  let historyNote: string | null = null

  const deps: WebhookEventDeps = {
    getOrderById: async (id) => ({
      id,
      total: 300,
      currency: "INR",
      paymentStatus: orderPaymentStatus,
      paymentMethod: "razorpay",
      status: "pending",
    }),
    setOrderRefundAndPaymentStatus: async (input) => {
      orderPaymentStatus = input.paymentStatus ?? orderPaymentStatus
      return true
    },
    updateTransactionStatus: async (input) => {
      txStatus = input.status
      return true
    },
    appendOrderStatusHistory: async (input) => {
      historyNote = input.notes
      return true
    },
  }

  const event = {
    event: "payment.failed",
    payload: {
      payment: {
        entity: {
          id: "pay_failed_001",
          order_id: "order_rzp_fail",
          error_code: "BAD_REQUEST_ERROR",
          error_description: "Payment was declined by bank",
          notes: { orderId: "ord_ziply_fail" },
        },
      },
    },
  }

  const result = await processWebhookEvent("razorpay", event, null, deps)

  assert.equal(result.applied, true)
  assert.equal(result.paid, false)
  assert.equal(orderPaymentStatus, "FAILED")
  assert.equal(txStatus, "failed")
  assert.match(String(historyNote), /Payment was declined by bank/i)
})

// 9. A failed retry followed by a successful payment
test("9. Failed attempt followed by successful retry: records failure then allows subsequent success", async () => {
  let orderPaymentStatus = "PENDING"
  let recordedPaymentId: string | null = null

  const deps: WebhookEventDeps = {
    getOrderById: async (id) => ({
      id,
      total: 600,
      currency: "INR",
      paymentStatus: orderPaymentStatus,
      paymentMethod: "razorpay",
      status: "pending",
    }),
    setOrderRefundAndPaymentStatus: async (input) => {
      orderPaymentStatus = input.paymentStatus ?? orderPaymentStatus
      return true
    },
    markOrderPaymentSuccess: async (id, paymentId) => {
      orderPaymentStatus = "SUCCESS"
      recordedPaymentId = paymentId
      return true
    },
    updateTransactionStatus: async () => true,
    appendOrderStatusHistory: async () => true,
  }

  // Attempt 1: Failed
  const failEvent = {
    event: "payment.failed",
    payload: {
      payment: {
        entity: {
          id: "pay_attempt_1_fail",
          error_description: "Insufficient funds",
          notes: { orderId: "ord_retry_test" },
        },
      },
    },
  }
  const failResult = await processWebhookEvent("razorpay", failEvent, null, deps)
  assert.equal(failResult.paid, false)
  assert.equal(orderPaymentStatus, "FAILED")

  // Attempt 2: Customer retries and pays successfully
  const successEvent = {
    event: "payment.captured",
    payload: {
      payment: {
        entity: {
          id: "pay_attempt_2_success",
          amount: 60000,
          currency: "INR",
          notes: { orderId: "ord_retry_test" },
        },
      },
    },
  }
  const successResult = await processWebhookEvent("razorpay", successEvent, null, deps)
  assert.equal(successResult.paid, true)
  assert.equal(orderPaymentStatus, "SUCCESS")
  assert.equal(recordedPaymentId, "pay_attempt_2_success")
})

// 10. An old failed event arriving after payment success
test("10. Out-of-order events: stale failed event does not downgrade an already-paid order", async () => {
  let orderPaymentStatus = "SUCCESS" // Order was already verified / paid

  const deps: WebhookEventDeps = {
    getOrderById: async (id) => ({
      id,
      total: 750,
      currency: "INR",
      paymentStatus: orderPaymentStatus,
      paymentId: "pay_fast_success_999",
      paymentMethod: "razorpay",
      status: "pending",
    }),
    setOrderRefundAndPaymentStatus: async (input) => {
      orderPaymentStatus = input.paymentStatus ?? orderPaymentStatus
      return true
    },
    updateTransactionStatus: async () => true,
    appendOrderStatusHistory: async () => true,
  }

  // Late delivery of an earlier failed attempt
  const delayedFailEvent = {
    event: "payment.failed",
    payload: {
      payment: {
        entity: {
          id: "pay_earlier_failed_attempt",
          error_description: "Card expired",
          notes: { orderId: "ord_out_of_order" },
        },
      },
    },
  }

  const result = await processWebhookEvent("razorpay", delayedFailEvent, null, deps)

  assert.equal(result.applied, true)
  assert.equal(result.stale, true)
  assert.equal(result.reason, "order_already_paid")
  // CRITICAL: Order payment status must NOT be downgraded to FAILED!
  assert.equal(orderPaymentStatus, "SUCCESS")
})

// 11. Duplicate delivery of the same event
test("11. Duplicate delivery: idempotent and does not create duplicate side effects", async () => {
  let successCalls = 0

  const deps: WebhookEventDeps = {
    getOrderById: async (id) => ({
      id,
      total: 450,
      currency: "INR",
      paymentStatus: "SUCCESS", // Order is ALREADY marked SUCCESS from first delivery
      paymentId: "pay_dup_001",
      paymentMethod: "razorpay",
      status: "pending",
    }),
    markOrderPaymentSuccess: async () => {
      successCalls++
      return true
    },
    updateTransactionStatus: async () => true,
    appendOrderStatusHistory: async () => true,
  }

  const event = {
    event: "payment.captured",
    payload: {
      payment: {
        entity: {
          id: "pay_dup_001",
          amount: 45000,
          currency: "INR",
          notes: { orderId: "ord_ziply_dup" },
        },
      },
    },
  }

  const result = await processWebhookEvent("razorpay", event, null, deps)

  assert.equal(result.applied, true)
  assert.equal(result.duplicate, true)
  assert.equal(result.paid, true)
  assert.equal(successCalls, 0)
})

// 12. Unmatched Razorpay order ID
test("12. Unmatched Razorpay order ID: returns order_not_found gracefully without throwing", async () => {
  const deps: WebhookEventDeps = {
    getOrderById: async () => null, // Order does not exist in DB
    findOrderIdByRazorpayOrder: async () => null,
  }

  const event = {
    event: "payment.captured",
    payload: {
      payment: {
        entity: {
          id: "pay_unknown",
          order_id: "order_non_existent",
          amount: 50000,
          currency: "INR",
        },
      },
    },
  }

  const result = await processWebhookEvent("razorpay", event, null, deps)
  assert.equal(result.applied, false)
  assert.ok(["orderId_missing", "order_not_found"].includes(result.reason ?? ""))
})

// 13. Amount or currency mismatch
test("13. Amount or currency mismatch: rejects payment when amount or currency does not match", async () => {
  const deps: WebhookEventDeps = {
    getOrderById: async (id) => ({
      id,
      total: 500, // ₹500
      currency: "INR",
      paymentStatus: "PENDING",
      paymentMethod: "razorpay",
      status: "pending",
    }),
  }

  // 13a. Amount mismatch
  const amountMismatchEvent = {
    event: "payment.captured",
    payload: {
      payment: {
        entity: {
          id: "pay_amt_mismatch",
          amount: 10000, // ₹100 instead of ₹500
          currency: "INR",
          notes: { orderId: "ord_mismatch" },
        },
      },
    },
  }
  const amtResult = await processWebhookEvent("razorpay", amountMismatchEvent, null, deps)
  assert.equal(amtResult.applied, false)
  assert.equal(amtResult.reason, "amount_mismatch")

  // 13b. Currency mismatch
  const currencyMismatchEvent = {
    event: "payment.captured",
    payload: {
      payment: {
        entity: {
          id: "pay_curr_mismatch",
          amount: 50000,
          currency: "USD", // USD instead of INR
          notes: { orderId: "ord_mismatch" },
        },
      },
    },
  }
  const currResult = await processWebhookEvent("razorpay", currencyMismatchEvent, null, deps)
  assert.equal(currResult.applied, false)
  assert.equal(currResult.reason, "currency_mismatch")
})

// 14. COD protection
test("14. COD protection: ignores unrelated Razorpay payment events on COD orders", async () => {
  let orderPaymentStatus = "PENDING"
  let orderMethod = "cod"

  const deps: WebhookEventDeps = {
    getOrderById: async (id) => ({
      id,
      total: 900,
      currency: "INR",
      paymentStatus: orderPaymentStatus,
      paymentMethod: orderMethod,
      status: "pending",
      codPaymentLinkId: "plink_legit_cod_123",
    }),
    markOrderPaymentSuccess: async () => {
      orderPaymentStatus = "SUCCESS"
      return true
    },
  }

  const unrelatedEvent = {
    event: "payment.captured",
    payload: {
      payment: {
        entity: {
          id: "pay_unrelated_cod",
          amount: 90000,
          currency: "INR",
          notes: { orderId: "ord_cod_order_1" },
        },
      },
    },
  }

  const result = await processWebhookEvent("razorpay", unrelatedEvent, null, deps)

  assert.equal(result.applied, false)
  assert.equal(result.reason, "cod_order_unrelated_payment_ignored")
  assert.equal(orderPaymentStatus, "PENDING")
  assert.equal(orderMethod, "cod")
})

// 15. Database failure returns a retryable error
test("15. Database failure: throws DATABASE_ERROR so webhook handler returns HTTP 500", async () => {
  const deps: WebhookEventDeps = {
    getOrderById: async (id) => ({
      id,
      total: 500,
      currency: "INR",
      paymentStatus: "PENDING",
      paymentMethod: "razorpay",
      status: "pending",
    }),
    markOrderPaymentSuccess: async () => {
      return false // Simulate write failure
    },
    updateTransactionStatus: async () => true,
  }

  const event = {
    event: "payment.captured",
    payload: {
      payment: {
        entity: {
          id: "pay_db_fail",
          amount: 50000,
          currency: "INR",
          notes: { orderId: "ord_db_fail" },
        },
      },
    },
  }

  await assert.rejects(
    async () => {
      await processWebhookEvent("razorpay", event, null, deps)
    },
    /DATABASE_ERROR.*write_failed/i,
  )
})

// 16. Partial refund versus full refund
test("16. Partial refund versus full refund: distinguishes partial refund from full refund", async () => {
  let orderPaymentStatus = "SUCCESS"
  let orderRefundStatus: string | undefined = undefined
  let txStatus = "paid"
  let historyNotes: string[] = []

  const deps: WebhookEventDeps = {
    getOrderById: async (id) => ({
      id,
      total: 1000, // ₹1000
      currency: "INR",
      paymentStatus: orderPaymentStatus,
      paymentMethod: "razorpay",
      status: "pending",
    }),
    setOrderRefundAndPaymentStatus: async (input) => {
      if (input.paymentStatus) orderPaymentStatus = input.paymentStatus
      if (input.refundStatus) orderRefundStatus = input.refundStatus
      return true
    },
    updateTransactionStatus: async (input) => {
      txStatus = input.status
      return true
    },
    appendOrderStatusHistory: async (input) => {
      historyNotes.push(input.notes)
      return true
    },
  }

  // 16a. Partial refund (₹300 out of ₹1000)
  const partialRefundEvent = {
    event: "refund.processed",
    payload: {
      refund: {
        entity: {
          id: "rfnd_part_001",
          amount: 30000, // ₹300
          currency: "INR",
          notes: { orderId: "ord_refund_test" },
        },
      },
      payment: {
        entity: {
          id: "pay_refund_test",
          amount: 100000,
          amount_refunded: 30000,
          refund_status: "partial",
        },
      },
    },
  }

  const partialResult = await processWebhookEvent("razorpay", partialRefundEvent, null, deps)

  assert.equal(partialResult.applied, true)
  assert.equal(partialResult.partialRefund, true)
  assert.equal(partialResult.refunded, false)
  // Crucial: paymentStatus must remain SUCCESS, NOT downgraded to REFUNDED!
  assert.equal(orderPaymentStatus, "SUCCESS")
  assert.equal(orderRefundStatus, "PARTIAL")
  assert.equal(txStatus, "partially_refunded")

  // 16b. Full refund (₹1000 out of ₹1000)
  const fullRefundEvent = {
    event: "refund.processed",
    payload: {
      refund: {
        entity: {
          id: "rfnd_full_001",
          amount: 100000, // ₹1000
          currency: "INR",
          notes: { orderId: "ord_refund_test" },
        },
      },
      payment: {
        entity: {
          id: "pay_refund_test",
          amount: 100000,
          amount_refunded: 100000,
          refund_status: "full",
        },
      },
    },
  }

  const fullResult = await processWebhookEvent("razorpay", fullRefundEvent, null, deps)

  assert.equal(fullResult.applied, true)
  assert.equal(fullResult.partialRefund, false)
  assert.equal(fullResult.refunded, true)
  assert.equal(orderPaymentStatus, "REFUNDED")
  assert.equal(orderRefundStatus, "COMPLETED")
  assert.equal(txStatus, "refunded")
})

// 17. Duplicate capture handling
test("17. Duplicate capture handling: refunds duplicate capture with different payment ID to avoid double-charging, and prevents duplicate refund on retry", async () => {
  let refundCallCount = 0
  let refundCalledWith: string | null = null
  let txStatusMap = new Map<string, string>()

  const deps: WebhookEventDeps = {
    getOrderById: async (id) => ({
      id,
      total: 500,
      currency: "INR",
      paymentStatus: "SUCCESS", // Order was already captured with payment pay_first
      paymentId: "pay_first_111",
      paymentMethod: "razorpay",
      status: "pending",
    }),
    findTransactionByExternalId: async (_orderId, externalId) => {
      const status = txStatusMap.get(externalId)
      return status ? { id: `tx_${externalId}`, status } : null
    },
    updateTransactionStatus: async (input) => {
      if (input.externalId) txStatusMap.set(input.externalId, input.status)
      return true
    },
    createTransaction: async (input) => {
      if (input.externalId) txStatusMap.set(input.externalId, input.status)
      return { id: `tx_${input.externalId}` }
    },
    refundPayment: async (paymentId) => {
      refundCallCount++
      refundCalledWith = paymentId
      return true
    },
    appendOrderStatusHistory: async () => true,
  }

  // Customer paid again with pay_second_222 (First webhook delivery)
  const secondCaptureEvent = {
    event: "payment.captured",
    payload: {
      payment: {
        entity: {
          id: "pay_second_222",
          amount: 50000,
          currency: "INR",
          notes: { orderId: "ord_double_pay" },
        },
      },
    },
  }

  const result1 = await processWebhookEvent("razorpay", secondCaptureEvent, null, deps)

  assert.equal(result1.applied, true)
  assert.equal(result1.duplicate, true)
  assert.equal(result1.duplicatePaymentRefunded, true)
  assert.equal(refundCalledWith, "pay_second_222")
  assert.equal(refundCallCount, 1)

  // Webhook Retry (Second delivery of same duplicate capture)
  const result2 = await processWebhookEvent("razorpay", secondCaptureEvent, null, deps)

  assert.equal(result2.applied, true)
  assert.equal(result2.duplicate, true)
  assert.equal(result2.duplicatePaymentRefunded, true)
  // Crucial: refundPayment must NOT have been called a second time!
  assert.equal(refundCallCount, 1)
})

// 18. Successful payment after Checkout window is closed
test("18. Payment success after Checkout closed / UPI QR on another device: updates backend asynchronously", async () => {
  let orderPaymentStatus = "PENDING"
  let recordedPaymentId: string | null = null

  const deps: WebhookEventDeps = {
    getOrderById: async (id) => ({
      id,
      total: 1200,
      currency: "INR",
      paymentStatus: orderPaymentStatus,
      paymentMethod: "razorpay",
      status: "pending",
    }),
    markOrderPaymentSuccess: async (id, paymentId) => {
      orderPaymentStatus = "SUCCESS"
      recordedPaymentId = paymentId
      return true
    },
    updateTransactionStatus: async () => true,
    appendOrderStatusHistory: async () => true,
  }

  const qrWebhookEvent = {
    event: "payment.captured",
    payload: {
      payment: {
        entity: {
          id: "pay_upi_qr_999",
          method: "upi",
          order_id: "order_rzp_qr_flow",
          amount: 120000,
          currency: "INR",
          notes: { orderId: "ord_upi_qr_closed_checkout" },
        },
      },
    },
  }

  const result = await processWebhookEvent("razorpay", qrWebhookEvent, null, deps)

  assert.equal(result.applied, true)
  assert.equal(result.paid, true)
  assert.equal(orderPaymentStatus, "SUCCESS")
  assert.equal(recordedPaymentId, "pay_upi_qr_999")
})

// 19. Valid order.paid payload without a payment entity
test("19. Valid order.paid payload without payment entity: marks order as SUCCESS", async () => {
  let orderPaymentStatus = "PENDING"

  const deps: WebhookEventDeps = {
    getOrderById: async (id) => ({
      id,
      total: 1000,
      currency: "INR",
      paymentStatus: orderPaymentStatus,
      paymentMethod: "razorpay",
      status: "pending",
    }),
    setOrderRefundAndPaymentStatus: async (input) => {
      orderPaymentStatus = input.paymentStatus ?? orderPaymentStatus
      return true
    },
    updateTransactionStatus: async () => true,
    appendOrderStatusHistory: async () => true,
  }

  // order.paid payload WITHOUT payload.payment
  const orderPaidEvent = {
    event: "order.paid",
    payload: {
      order: {
        entity: {
          id: "order_rzp_no_payment_obj",
          amount: 100000,
          amount_paid: 100000,
          currency: "INR",
          receipt: "ord_no_payment_entity",
          notes: { orderId: "ord_no_payment_entity" },
        },
      },
    },
  }

  const result = await processWebhookEvent("razorpay", orderPaidEvent, null, deps)

  assert.equal(result.applied, true)
  assert.equal(result.paid, true)
  assert.equal(orderPaymentStatus, "SUCCESS")
})

// 20. Repeated requests do not trigger duplicate fulfillment or refunds
test("20. Repeated requests: idempotent across repeated payment captures and refund deliveries", async () => {
  let successCalls = 0
  let refundUpdates = 0

  const deps: WebhookEventDeps = {
    getOrderById: async (id) => ({
      id,
      total: 500,
      currency: "INR",
      paymentStatus: "REFUNDED",
      paymentMethod: "razorpay",
      status: "pending",
    }),
    markOrderPaymentSuccess: async () => {
      successCalls++
      return true
    },
    setOrderRefundAndPaymentStatus: async () => {
      refundUpdates++
      return true
    },
    updateTransactionStatus: async () => true,
    appendOrderStatusHistory: async () => true,
  }

  // Resending a full refund for an order that is already REFUNDED
  const repeatRefundEvent = {
    event: "refund.processed",
    payload: {
      refund: {
        entity: {
          id: "rfnd_repeat_001",
          amount: 50000,
          currency: "INR",
          notes: { orderId: "ord_repeat_test" },
        },
      },
      payment: {
        entity: {
          id: "pay_repeat_001",
          amount: 50000,
          amount_refunded: 50000,
          refund_status: "full",
        },
      },
    },
  }

  const result = await processWebhookEvent("razorpay", repeatRefundEvent, null, deps)

  assert.equal(result.applied, true)
  assert.equal(result.duplicate, true)
  assert.equal(result.refunded, true)
  assert.equal(refundUpdates, 0)
  assert.equal(successCalls, 0)
})
