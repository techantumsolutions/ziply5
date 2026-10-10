/** Customer-facing order number, matching the admin and storefront "Order #xxxxxxxx" label. */
export const formatOrderNumber = (orderId: string) => String(orderId).slice(0, 8).toUpperCase()
