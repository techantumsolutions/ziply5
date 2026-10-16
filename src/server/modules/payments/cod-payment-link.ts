/** Razorpay reference ids are unique, alphanumeric, and at most 40 characters. */
export const codPaymentReferenceId = (orderId: string) =>
  orderId.replace(/[^a-zA-Z0-9]/g, "").slice(0, 40)

/** Razorpay amounts are paise. A link is payable only for the exact order total. */
export const codAmountsMatch = (orderTotal: number, paidMinor: number) =>
  Number.isFinite(orderTotal) &&
  Number.isFinite(paidMinor) &&
  paidMinor > 0 &&
  Math.round(orderTotal * 100) === paidMinor
