export const ECOMMERCE_CART_KEY = "ecommerce_cart"
export const ECOMMERCE_CHECKOUT_KEY = "ecommerce_checkout"

export type CheckoutAddress = {
  fullName: string
  phone: string
  email: string
  addressLine1: string
  addressLine2?: string
  city: string
  state: string
  country: string
  postalCode: string
}

export type CartItemNormalized = {
  id: string
  productId: string
  variantId: string | null
  sku: string | null
  slug?: string
  name: string
  variantLabel: string
  variantOptions?: string[]
  image: string
  price: number
  comparePrice: number
  quantity: number
  subtotal: number
  tax: number
  stock: number | null
  weight?: string
  packName?: string | null
  packQuantity?: number
  baseWeight?: string
  savingAmount?: number
}

export type AppliedCoupon = {
  couponId: string | null
  code: string
  discountType: "percentage" | "flat"
  discountValue: number
  appliedDiscount: number
}

export type EcommerceCheckoutState = {
  items: CartItemNormalized[]
  shippingAddress: CheckoutAddress | null
  billingAddress: CheckoutAddress | null
  selectedShippingMethod: string | null
  coupon: AppliedCoupon | null
  subtotal: number
  discount: number
  tax: number
  shippingCharge: number
  /** Sum of line quantities used for Ziply5 slab shipping at checkout. */
  totalItemsUsedForShipping?: number
  total: number
  savingAmount?: number
  updatedAt: string
}

const toFinite = (value: unknown, fallback = 0) => {
  const n = Number(value)
  return Number.isFinite(n) ? n : fallback
}

const normalizeCartItem = (item: any): CartItemNormalized | null => {
  const productId = String(item?.productId ?? "").trim()
  if (!productId) return null
  const variantId = item?.variantId == null || item?.variantId === "" ? null : String(item.variantId)
  const quantity = Math.max(1, Math.floor(toFinite(item?.quantity, 1)))
  const price = Math.max(0, toFinite(item?.price, 0))
  const comparePrice = Math.max(0, toFinite(item?.comparePrice, price))
  const tax = Math.max(0, toFinite(item?.tax, 0))
  const subtotal = Math.max(0, toFinite(item?.subtotal, price * quantity))
  return {
    id: `${productId}:${variantId ?? "default"}`,
    productId,
    variantId,
    sku: item?.sku ? String(item.sku) : null,
    slug: item?.slug ? String(item.slug) : undefined,
    name: String(item?.name ?? ""),
    variantLabel: String(item?.variantLabel ?? item?.weight ?? ""),
    variantOptions: Array.isArray(item?.variantOptions) ? item.variantOptions.map(String) : undefined,
    image: String(item?.image ?? ""),
    price,
    comparePrice,
    quantity,
    subtotal,
    tax,
    stock: item?.stock == null ? null : toFinite(item.stock, 0),
    weight: item?.weight ? String(item.weight) : undefined,
    packName: item?.packName ? String(item.packName) : null,
    packQuantity: item?.packQuantity != null ? Math.max(1, Math.floor(toFinite(item.packQuantity, 1))) : undefined,
    baseWeight: item?.baseWeight ? String(item.baseWeight) : undefined,
    savingAmount: item?.savingAmount != null ? Math.max(0, toFinite(item.savingAmount, 0)) : undefined,
  }
}

export const computeItemTotals = (input: {
  price: number
  quantity: number
  taxRatePercent?: number
  explicitTax?: number
}) => {
  const quantity = Math.max(1, Math.floor(toFinite(input.quantity, 1)))
  const price = Math.max(0, toFinite(input.price, 0))
  const subtotal = Number((price * quantity).toFixed(2))
  const tax =
    input.explicitTax != null
      ? Math.max(0, toFinite(input.explicitTax, 0))
      : Number((subtotal * Math.max(0, toFinite(input.taxRatePercent, 0)) / 100).toFixed(2))
  return { subtotal, tax }
}

export const readCartStorage = (): CartItemNormalized[] => {
  if (typeof window === "undefined") return []
  try {
    const raw = window.localStorage.getItem(ECOMMERCE_CART_KEY) ?? window.localStorage.getItem("ziply5-cart")
    const parsed = JSON.parse(raw || "{}")
    const list = Array.isArray(parsed) ? parsed : parsed?.items
    if (!Array.isArray(list)) return []
    return list.map(normalizeCartItem).filter((item): item is CartItemNormalized => Boolean(item))
  } catch {
    return []
  }
}

export const writeCartStorage = (items: CartItemNormalized[]) => {
  if (typeof window === "undefined") return
  const normalized = items.map((item) => normalizeCartItem(item)).filter((item): item is CartItemNormalized => Boolean(item))
  window.localStorage.setItem(ECOMMERCE_CART_KEY, JSON.stringify({ items: normalized }))
}

export const readCheckoutStorage = (): EcommerceCheckoutState | null => {
  if (typeof window === "undefined") return null
  try {
    const raw = window.localStorage.getItem(ECOMMERCE_CHECKOUT_KEY)
    if (!raw) return null
    const parsed = JSON.parse(raw) as Record<string, unknown>
    const items = Array.isArray(parsed?.items)
      ? (parsed.items as unknown[])
          .map(normalizeCartItem)
          .filter((item): item is CartItemNormalized => Boolean(item))
      : []
    return {
      items,
      shippingAddress: parsed?.shippingAddress ?? null,
      billingAddress: parsed?.billingAddress ?? null,
      selectedShippingMethod: parsed?.selectedShippingMethod ?? null,
      coupon: parsed?.coupon ?? null,
      subtotal: Math.max(0, toFinite(parsed?.subtotal, 0)),
      discount: Math.max(0, toFinite(parsed?.discount, 0)),
      tax: Math.max(0, toFinite(parsed?.tax, 0)),
      shippingCharge: Math.max(0, toFinite(parsed?.shippingCharge, 0)),
      totalItemsUsedForShipping:
        parsed?.totalItemsUsedForShipping == null
          ? undefined
          : Math.max(0, Math.floor(toFinite(parsed?.totalItemsUsedForShipping, 0))),
      total: Math.max(0, toFinite(parsed?.total, 0)),
      savingAmount: parsed?.savingAmount == null ? undefined : Math.max(0, toFinite(parsed?.savingAmount, 0)),
      updatedAt: String(parsed?.updatedAt ?? new Date().toISOString()),
    }
  } catch {
    return null
  }
}

export const writeCheckoutStorage = (state: EcommerceCheckoutState) => {
  if (typeof window === "undefined") return
  window.localStorage.setItem(
    ECOMMERCE_CHECKOUT_KEY,
    JSON.stringify({
      ...state,
      items: state.items.map((item) => normalizeCartItem(item)).filter((item): item is CartItemNormalized => Boolean(item)),
      updatedAt: new Date().toISOString(),
    }),
  )
}

export const clearCheckoutStorage = () => {
  if (typeof window === "undefined") return
  window.localStorage.removeItem(ECOMMERCE_CHECKOUT_KEY)
}
