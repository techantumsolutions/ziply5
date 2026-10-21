/** Customer-facing order payload from GET /api/v1/orders/:id (website order detail). */
export type CustomerOrderDetail = {
  id: string
  status: string
  paymentStatus?: string | null
  paymentMethod?: string | null
  currency: string
  subtotal?: string | number
  tax?: string | number
  discount?: string | number
  couponCode?: string | null
  savingAmount?: string | number
  shipping?: string | number
  total: string | number
  createdAt: string
  deliveredAt?: string | null
  customerName?: string | null
  customerPhone?: string | null
  customerAddress?: string | null
  user?: { email?: string | null } | null
  items: Array<{
    id: string
    productId?: string
    quantity: number
    unitPrice?: string | number
    lineTotal?: string | number
    sku?: string | null
    product?: {
      name?: string | null
      thumbnail?: string | null
      image?: string | null
      weight?: string | null
      sku?: string | null
    } | null
    variant?: {
      name?: string | null
      weight?: string | null
      sku?: string | null
      hsnCode?: string | null
    } | null
  }>
  statusHistory: Array<{ toStatus: string; changedAt: string }>
  transactions: Array<{ id: string; status: string; gateway: string; createdAt: string }>
  shipments: Array<{ id: string; carrier: string | null; trackingNo: string | null; shipmentStatus: string; eta?: string | null }>
  awbCode?: string | null
  courierName?: string | null
  trackingNumber?: string | null
  trackingUrl?: string | null
  estimatedDeliveryDate?: string | null
  shipmentStatus?: string | null
  shipmentDeliveredAt?: string | Date | null
  lastTrackingSyncAt?: string | null
  returnRequests: Array<{
    id: string
    status: string
    reason: string | null
    productId?: string | null
    imageUrl?: string | null
    description?: string | null
    videoUrl?: string | null
    images?: unknown
    returnType?: string | null
    refundMethod?: string | null
    upiId?: string | null
    bankDetails?: unknown
    adminNote?: string | null
    rejectionReason?: string | null
    reverseAwb?: string | null
    reverseCourier?: string | null
    reverseTrackingUrl?: string | null
    pickupScheduledAt?: string | Date | null
    items?: Array<{ id: string; orderItemId: string; requestedQty: number }>
    createdAt?: string | null
  }>
  refunds: Array<{ id: string; status: string; amount: string | number; createdAt: string }>
}
