import { z } from "zod"

export const createOrderSchema = z.object({
  items: z.array(
    z.object({
      productId: z.string().min(1),
      variantId: z.string().nullable().optional(),
      sku: z.string().nullable().optional(),
      quantity: z.number().int().positive(),
      price: z.number().nonnegative().optional(),
      subtotal: z.number().nonnegative().optional(),
      tax: z.number().nonnegative().optional(),
      packName: z.string().nullable().optional(),
      packQuantity: z.number().int().positive().optional(),
      comparePrice: z.number().nonnegative().nullable().optional(),
      savingAmount: z.number().nonnegative().nullable().optional(),
      baseWeight: z.string().nullable().optional(),
    })
  ).min(1),

  shipping: z.number().nonnegative().optional(), // backward compatibility
  shippingCharge: z.number().nonnegative().optional(),
  /** Sum of checkout line quantities; must match server recomputation for anti-tamper. */
  totalItemsUsedForShipping: z.number().int().min(0).max(5000).optional(),
  currency: z.string().min(1).optional(),
  couponCode: z.string().optional(),
  couponId: z.string().nullable().optional(),
  subtotal: z.number().nonnegative().optional(),
  discount: z.number().nonnegative().optional(),
  tax: z.number().nonnegative().optional(),
  total: z.number().nonnegative().optional(),
  savingAmount: z.number().nonnegative().optional(),
  gateway: z.string().min(1),

  // 🔥 NEW FIELDS
  billingAddress: z
    .object({
      fullName: z.string(),
      email: z.string().email().optional(),
      line1: z.string(),
      line2: z.string().optional(),
      city: z.string(),
      state: z.string(),
      postalCode: z.string(),
      country: z.string(),
      phone: z.string().optional(),
    })
    .optional(),

  paymentStatus: z.enum(["pending", "paid", "failed"]).optional(),
  paymentId: z.string().optional(),
  razorpayOrderId: z.string().optional(),
  razorpayPaymentId: z.string().optional(),
  razorpaySignature: z.string().optional(),
  appliedCouponId: z.string().nullable().optional(),
  sessionKey: z.string().optional(),
})

export const updateOrderStatusSchema = z.object({
  status: z.string().trim().min(1),
  reasonCode: z.string().max(80).optional(),
  note: z.string().max(1000).optional(),
})

export const createOrderNoteSchema = z.object({
  note: z.string().min(1).max(2000),
  isInternal: z.boolean().optional(),
})

export const createOrderInvoiceSchema = z.object({
  gstin: z.string().max(30).optional(),
  taxRate: z.number().min(0).max(1).optional(),
})

export const createShipmentSchema = z.object({
  shipmentNo: z.string().max(80).optional(),
  carrier: z.string().min(1).max(120),
  trackingNo: z.string().max(120).optional(),
  itemAllocations: z
    .array(
      z.object({
        orderItemId: z.string().min(1),
        quantity: z.number().int().positive(),
      }),
    )
    .min(1),
})

export const reconcileCodSchema = z.object({
  collectedAmount: z.number().nonnegative(),
  settledAmount: z.number().nonnegative().optional(),
  status: z.enum(["pending", "partial", "settled", "failed"]).optional(),
  notes: z.string().max(1000).optional(),
})

export const confirmDeliverySchema = z.object({
  shipmentId: z.string().optional(),
  note: z.string().max(1000).optional(),
})
