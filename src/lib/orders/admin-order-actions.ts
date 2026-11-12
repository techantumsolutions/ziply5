export interface AdminOrderShipmentRef {
  shipmentNo?: string | null;
  carrier?: string | null;
  status?: string | null;
  shipmentStatus?: string | null;
}

export interface AdminOrderActionInput {
  status?: string | null;
  lifecycleStatus?: string | null;
  shipmentStatus?: string | null;
  fulfillmentStatus?: string | null;
  shippingMethod?: string | null;
  shipping_method?: string | null;
  shipmentId?: string | null;
  shipmentNo?: string | null;
  shiprocketOrderId?: string | number | null;
  isShipmentCreated?: boolean | null;
  awbCode?: string | null;
  shipments?: AdminOrderShipmentRef[] | null;
}

export interface AdminOrderShipmentFlags {
  isDelivered: boolean;
  isCancelledOrRejected: boolean;
  isManualShipmentOrder: boolean;
  isShiprocketShipment: boolean;
  hasShipmentCreated: boolean;
}

export interface AdminOrderDetailsButtonFlags extends AdminOrderShipmentFlags {
  showCheckServiceability: boolean;
  disableCheckServiceability: boolean;
  showSyncButton: boolean;
  disableSyncButton: boolean;
  showManualShipmentButton: boolean;
  disableManualShipmentButton: boolean;
  disableCancelButton: boolean;
  disableStatusUpdateSelect: boolean;
}

function normalizeStatus(value: unknown): string {
  return String(value ?? "").trim().toLowerCase();
}

function getActiveShipment(shipments?: AdminOrderShipmentRef[] | null): AdminOrderShipmentRef | undefined {
  if (!Array.isArray(shipments) || shipments.length === 0) return undefined;
  return (
    shipments.find((s) => normalizeStatus(s?.shipmentStatus ?? s?.status) !== "cancelled") ??
    shipments[0]
  );
}

/** Returns true once an order or its active shipment reaches a delivered/completed state. */
export function isAdminOrderDelivered(input: AdminOrderActionInput): boolean {
  const activeShipment = getActiveShipment(input.shipments);
  const candidates = [
    input.lifecycleStatus,
    input.status,
    input.shipmentStatus,
    input.fulfillmentStatus,
    activeShipment?.shipmentStatus,
    activeShipment?.status,
  ];
  return candidates.some((val) => {
    const s = normalizeStatus(val);
    return s === "delivered" || s === "completed";
  });
}

/**
 * Derives whether an order is shipped via manual courier or Shiprocket without
 * misclassifying Shiprocket orders that already have a courier name and AWB/tracking number.
 */
export function getAdminOrderShipmentFlags(input: AdminOrderActionInput): AdminOrderShipmentFlags {
  const activeShipment = getActiveShipment(input.shipments);
  const lifecycle = normalizeStatus(input.lifecycleStatus || input.status);
  const shipmentState = normalizeStatus(
    input.shipmentStatus || activeShipment?.shipmentStatus || activeShipment?.status
  );
  const method = normalizeStatus(input.shippingMethod ?? input.shipping_method);
  const shipmentNo = normalizeStatus(input.shipmentNo ?? activeShipment?.shipmentNo);
  const shipmentId = normalizeStatus(input.shipmentId);
  const carrier = normalizeStatus(activeShipment?.carrier);

  const isDelivered = isAdminOrderDelivered(input);
  const isCancelledOrRejected =
    lifecycle === "cancelled" ||
    lifecycle === "rejected" ||
    shipmentState === "cancelled";

  const isShiprocketMethod = method === "shiprocket";
  const isManualMethod = method === "manual";
  const hasManualIdOrNo = shipmentNo.startsWith("manual-") || shipmentId.startsWith("manual-");
  const hasManualCarrier = carrier === "manual";

  const isManualShipmentOrder = Boolean(isManualMethod || hasManualIdOrNo || hasManualCarrier);

  const hasNonManualShipmentNo = Boolean(shipmentNo && !shipmentNo.startsWith("manual-"));
  const hasShippedStage = ["shipped", "in_transit", "out_for_delivery", "delivered"].some(
    (target) => lifecycle === target || shipmentState === target
  );

  const isShiprocketShipment = Boolean(
    !isManualShipmentOrder &&
      (isShiprocketMethod ||
        input.shiprocketOrderId ||
        input.isShipmentCreated ||
        input.awbCode ||
        hasNonManualShipmentNo ||
        hasShippedStage)
  );

  return {
    isDelivered,
    isCancelledOrRejected,
    isManualShipmentOrder,
    isShiprocketShipment,
    hasShipmentCreated: isManualShipmentOrder || isShiprocketShipment,
  };
}

/** Computes listing-row visibility: delivered orders only keep the View action. */
export function shouldShowAdminListingRowActions(input: AdminOrderActionInput): boolean {
  const flags = getAdminOrderShipmentFlags(input);
  return !flags.isDelivered && !flags.isCancelledOrRejected && !flags.isManualShipmentOrder;
}

/** Computes visibility and disabled flags for action buttons on the admin order details page. */
export function getAdminOrderDetailsButtonFlags(
  input: AdminOrderActionInput,
  options: { isOrderAccepted: boolean }
): AdminOrderDetailsButtonFlags {
  const flags = getAdminOrderShipmentFlags(input);
  const canManageFulfillment = options.isOrderAccepted && !flags.isCancelledOrRejected;

  return {
    ...flags,
    showCheckServiceability: canManageFulfillment,
    disableCheckServiceability: flags.hasShipmentCreated || flags.isDelivered,
    // Hide Sync now for manual shipments; keep it visible for Shiprocket and unshipped orders so Shiprocket sync remains reachable.
    showSyncButton: canManageFulfillment && !flags.isManualShipmentOrder,
    disableSyncButton: flags.isDelivered,
    // Never show Manual shipment once the order is shipping via Shiprocket.
    showManualShipmentButton: canManageFulfillment && !flags.isShiprocketShipment,
    disableManualShipmentButton: flags.isDelivered,
    disableCancelButton: flags.isDelivered,
    disableStatusUpdateSelect: flags.isDelivered,
  };
}
