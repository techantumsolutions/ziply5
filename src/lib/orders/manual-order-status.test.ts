import assert from "node:assert/strict"
import test from "node:test"
import { isManualShipment, manualOrderStatusSteps, orderStatusLabel } from "./manual-order-status"

test("manual order status walks forward and keeps customer labels", () => {
  assert.deepEqual(manualOrderStatusSteps("confirmed", "out_for_delivery"), [
    "packed",
    "shipped",
    "in_transit",
    "out_for_delivery",
  ])
  assert.deepEqual(manualOrderStatusSteps("shipped", "shipped"), [])
  assert.equal(orderStatusLabel("confirmed"), "Accepted")
  assert.equal(orderStatusLabel("in_transit"), "In Transit")
  assert.equal(orderStatusLabel("out_for_delivery"), "Out for delivery")
  assert.throws(() => manualOrderStatusSteps("delivered", "packed"), /backward/)
})

test("only a manual shipment can be updated from the order status list", () => {
  assert.equal(isManualShipment({ shipmentNo: "manual-abc123", shippingMethod: null }), true)
  assert.equal(isManualShipment({ shipmentNo: "1651122355", shippingMethod: null }), false)
  assert.equal(isManualShipment({ shipmentNo: null, shippingMethod: "manual" }), true)
})
