import { describe, it } from "node:test";
import assert from "node:assert/strict";
import {
  getAdminOrderDetailsButtonFlags,
  getAdminOrderShipmentFlags,
  isAdminOrderDelivered,
  shouldShowAdminListingRowActions,
} from "./admin-order-actions";

describe("admin-order-actions", () => {
  describe("shouldShowAdminListingRowActions", () => {
    it("hides extra action buttons when order or shipment is delivered", () => {
      assert.equal(shouldShowAdminListingRowActions({ status: "delivered", shiprocketOrderId: "sr-1" }), false);
      assert.equal(shouldShowAdminListingRowActions({ status: "shipped", lifecycleStatus: "delivered" }), false);
      assert.equal(shouldShowAdminListingRowActions({ status: "shipped", fulfillmentStatus: "delivered" }), false);
      assert.equal(
        shouldShowAdminListingRowActions({
          status: "processing",
          shipments: [{ shipmentNo: "SR-100", shipmentStatus: "delivered" }],
        }),
        false
      );
    });

    it("hides extra action buttons for manual, cancelled, or rejected orders", () => {
      assert.equal(shouldShowAdminListingRowActions({ status: "shipped", shippingMethod: "manual" }), false);
      assert.equal(shouldShowAdminListingRowActions({ status: "cancelled" }), false);
      assert.equal(shouldShowAdminListingRowActions({ status: "rejected" }), false);
    });

    it("keeps extra action buttons visible for active Shiprocket or new pending orders", () => {
      assert.equal(shouldShowAdminListingRowActions({ status: "pending" }), true);
      assert.equal(
        shouldShowAdminListingRowActions({
          status: "shipped",
          shippingMethod: "shiprocket",
          shiprocketOrderId: "12345",
          shipments: [{ shipmentNo: "SR-100", shipmentStatus: "in_transit" }],
        }),
        true
      );
    });
  });

  describe("getAdminOrderDetailsButtonFlags", () => {
    it("allows serviceability check, sync, and manual shipment before shipment creation", () => {
      const flags = getAdminOrderDetailsButtonFlags(
        { status: "processing", lifecycleStatus: "processing" },
        { isOrderAccepted: true }
      );

      assert.equal(flags.isDelivered, false);
      assert.equal(flags.hasShipmentCreated, false);
      assert.equal(flags.showCheckServiceability, true);
      assert.equal(flags.disableCheckServiceability, false);
      assert.equal(flags.showSyncButton, true);
      assert.equal(flags.disableSyncButton, false);
      assert.equal(flags.showManualShipmentButton, true);
      assert.equal(flags.disableManualShipmentButton, false);
    });

    it("hides Manual shipment and disables Check serviceability when shipping via Shiprocket", () => {
      const flags = getAdminOrderDetailsButtonFlags(
        {
          status: "shipped",
          shippingMethod: "shiprocket",
          shiprocketOrderId: "998877",
          isShipmentCreated: true,
          awbCode: "AWB123456",
          shipments: [{ shipmentNo: "SR-998877", carrier: "Delhivery", shipmentStatus: "shipped" }],
        },
        { isOrderAccepted: true }
      );

      assert.equal(flags.isShiprocketShipment, true);
      assert.equal(flags.isManualShipmentOrder, false);
      assert.equal(flags.hasShipmentCreated, true);
      assert.equal(flags.showManualShipmentButton, false);
      assert.equal(flags.showSyncButton, true);
      assert.equal(flags.disableSyncButton, false);
      assert.equal(flags.disableCheckServiceability, true);
    });

    it("hides Sync now and disables Check serviceability when shipping via manual shipment", () => {
      const flags = getAdminOrderDetailsButtonFlags(
        {
          status: "shipped",
          shippingMethod: "manual",
          shipmentNo: "manual-order-1",
          shipments: [{ shipmentNo: "manual-order-1", carrier: "DTDC", shipmentStatus: "shipped" }],
        },
        { isOrderAccepted: true }
      );

      assert.equal(flags.isManualShipmentOrder, true);
      assert.equal(flags.isShiprocketShipment, false);
      assert.equal(flags.hasShipmentCreated, true);
      assert.equal(flags.showSyncButton, false);
      assert.equal(flags.showManualShipmentButton, true);
      assert.equal(flags.disableManualShipmentButton, false);
      assert.equal(flags.disableCheckServiceability, true);
    });

    it("disables all sync and unnecessary buttons once a Shiprocket order is delivered", () => {
      const flags = getAdminOrderDetailsButtonFlags(
        {
          status: "delivered",
          lifecycleStatus: "delivered",
          shippingMethod: "shiprocket",
          shiprocketOrderId: "998877",
          isShipmentCreated: true,
          shipments: [{ shipmentNo: "SR-998877", shipmentStatus: "delivered" }],
        },
        { isOrderAccepted: true }
      );

      assert.equal(flags.isDelivered, true);
      assert.equal(flags.showManualShipmentButton, false);
      assert.equal(flags.showSyncButton, true);
      assert.equal(flags.disableSyncButton, true);
      assert.equal(flags.disableCheckServiceability, true);
      assert.equal(flags.disableCancelButton, true);
      assert.equal(flags.disableStatusUpdateSelect, true);
    });

    it("disables manual shipment, serviceability, cancel, and status select once a manual order is delivered", () => {
      const flags = getAdminOrderDetailsButtonFlags(
        {
          status: "delivered",
          shippingMethod: "manual",
          shipmentId: "manual-abc",
          shipments: [{ shipmentNo: "manual-abc", carrier: "manual", shipmentStatus: "delivered" }],
        },
        { isOrderAccepted: true }
      );

      assert.equal(flags.isDelivered, true);
      assert.equal(flags.showSyncButton, false);
      assert.equal(flags.showManualShipmentButton, true);
      assert.equal(flags.disableManualShipmentButton, true);
      assert.equal(flags.disableCheckServiceability, true);
      assert.equal(flags.disableCancelButton, true);
      assert.equal(flags.disableStatusUpdateSelect, true);
    });

    it("detects delivered state from fulfillmentStatus or active shipment even if order.status lags", () => {
      assert.equal(isAdminOrderDelivered({ status: "shipped", fulfillmentStatus: "delivered" }), true);
      const flags = getAdminOrderShipmentFlags({
        status: "shipped",
        shipments: [
          { shipmentNo: "SR-1", shipmentStatus: "cancelled" },
          { shipmentNo: "SR-2", shipmentStatus: "delivered" },
        ],
      });
      assert.equal(flags.isDelivered, true);
      assert.equal(flags.isShiprocketShipment, true);
    });
  });
});

