import assert from "node:assert/strict"
import test from "node:test"
import {
  classifyShiprocketPickup,
  isConfirmedPickupRequest,
  isPickupAlreadyQueued,
  orderStatusFromShiprocketPanel,
  rankOfStoredStatus,
  stageFromShiprocket,
  stageToShipmentStatus,
} from "./shiprocket-status"

test("status codes outrank loose text", () => {
  assert.equal(stageFromShiprocket(6, "processing"), "shipped")
  assert.equal(stageFromShiprocket(18, "SHIPPED"), "in_transit")
  assert.equal(stageFromShiprocket(7, "in transit"), "delivered")
  assert.equal(stageFromShiprocket(42, null), "shipped")
  assert.equal(stageFromShiprocket(3, "delivered"), "pickup")
  assert.equal(stageToShipmentStatus("pickup"), "pickup_requested")
})

test("older tracking cannot outrank a later stored status", () => {
  assert.ok(rankOfStoredStatus("delivered") > rankOfStoredStatus("in_transit"))
  assert.ok(rankOfStoredStatus("shipped") > rankOfStoredStatus("pickup_requested"))
  assert.ok(rankOfStoredStatus("ready_to_ship") < rankOfStoredStatus("shipped"))
})

test("pickup queue message is an existing request", () => {
  assert.equal(isPickupAlreadyQueued("Already in Pickup Queue."), true)
  assert.equal(isPickupAlreadyQueued("Shiprocket API error (400): Already in Pickup Queue."), true)
  assert.equal(isPickupAlreadyQueued("Invalid Status for pickup generation"), false)
})

test("pickup exception is not a successful pickup request", () => {
  assert.equal(stageFromShiprocket(20, "Pickup Exception"), "pickup_exception")
  assert.equal(classifyShiprocketPickup(35, "PICKUP EXCEPTION").decision, "ineligible")
  assert.equal(classifyShiprocketPickup(12, "PICKUP QUEUE").decision, "already_requested")
  assert.equal(classifyShiprocketPickup(3, "READY TO SHIP").decision, "eligible")
  assert.equal(isConfirmedPickupRequest("501359"), false)
  assert.equal(isConfirmedPickupRequest("Pickup Generated"), false)
  assert.equal(isConfirmedPickupRequest("Pickup Queue"), true)
  assert.equal(isConfirmedPickupRequest("pickup_requested"), true)
})

test("shiprocket panel text maps to the same order and shipment status", () => {
  assert.equal(orderStatusFromShiprocketPanel("READY TO SHIP", 3), "packed")
  assert.equal(orderStatusFromShiprocketPanel("Shipped", null), "shipped")
  assert.equal(orderStatusFromShiprocketPanel("In Transit", null), "in_transit")
  assert.equal(orderStatusFromShiprocketPanel("Out For Delivery", null), "out_for_delivery")
  assert.equal(orderStatusFromShiprocketPanel("Delivered", null), "delivered")
  assert.equal(orderStatusFromShiprocketPanel("Cancelled", null), "cancelled")
  assert.equal(orderStatusFromShiprocketPanel("NEW", null), null)
})
