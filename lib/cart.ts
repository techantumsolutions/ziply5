import { type StorefrontProduct } from "./storefront-products"
import {
  computeItemTotals,
  readCartStorage,
  writeCartStorage,
  type CartItemNormalized,
} from "./ecommerce-order"

export type CartItem = {
  id: string
  productId?: string
  variantId?: string | null
  slug: string
  name: string
  variantLabel?: string
  variantOptions?: string[]
  price: number
  comparePrice?: number
  subtotal?: number
  tax?: number
  stock?: number | null
  image: string
  weight: string
  sku?: string
  basePrice?: number
  discountPercent?: number
  quantity: number
}

const emitCartUpdated = () => {
  if (typeof window === "undefined") return
  window.dispatchEvent(new CustomEvent("ziply5:cart-updated"))
}

export const getCartItems = (): CartItem[] => {
  const items = readCartStorage()
  return items.map((item) => ({
    id: item.id,
    productId: item.productId,
    variantId: item.variantId,
    slug: item.slug ?? "",
    name: item.name,
    variantLabel: item.variantLabel,
    variantOptions: item.variantOptions,
    price: item.price,
    comparePrice: item.comparePrice,
    quantity: item.quantity,
    subtotal: item.subtotal,
    tax: item.tax,
    stock: item.stock,
    image: item.image,
    weight: item.weight ?? item.variantLabel ?? "",
    sku: item.sku ?? undefined,
  }))
}

export const setCartItems = (items: CartItem[]) => {
  if (typeof window === "undefined") return
  const normalized: CartItemNormalized[] = items
    .filter((item): item is CartItem & { productId: string } => Boolean(item.productId))
    .map((item) => {
      const totals = computeItemTotals({
        price: item.price,
        quantity: item.quantity,
        explicitTax: item.tax,
      })
      const variantId = item.variantId ?? null
      return {
        id: `${item.productId}:${variantId ?? "default"}`,
        productId: item.productId,
        variantId,
        sku: item.sku ?? null,
        slug: item.slug,
        name: item.name,
        variantLabel: item.variantLabel ?? item.weight ?? "",
        variantOptions: item.variantOptions,
        image: item.image,
        price: item.price,
        comparePrice: item.comparePrice ?? item.basePrice ?? item.price,
        quantity: Math.max(1, item.quantity),
        subtotal: item.subtotal ?? totals.subtotal,
        tax: item.tax ?? totals.tax,
        stock: item.stock ?? null,
        weight: item.weight,
      }
    })
  writeCartStorage(normalized)
  emitCartUpdated()
}

export const getCartCount = (): number => getCartItems().reduce((sum, item) => sum + item.quantity, 0)

type CartProductInput = {
  id?: string
  productId?: string
  variantId?: string | null
  slug: string
  name: string
  variantLabel?: string
  variantOptions?: string[]
  price: number
  comparePrice?: number
  tax?: number
  stock?: number | null
  image: string
  weight: string
  sku?: string
  basePrice?: number
  discountPercent?: number
}

const getCartKey = (product: CartProductInput) => {
  const base = product.productId || product.id || product.slug
  return `${base}:${product.variantId ?? "default"}`
}
export const addToCart = (product: CartProductInput, quantity = 1) => {
  const existing = getCartItems()
  const key = getCartKey(product)
  const index = existing.findIndex((item) => item.id === key)

  if (index === -1) {
    existing.push({
      id: key,
      productId: product.productId || product.id || product.slug,
      variantId: product.variantId ?? null,
      slug: product.slug,
      name: product.name,
      variantLabel: product.variantLabel ?? product.weight,
      variantOptions: product.variantOptions,
      price: product.price,
      comparePrice: product.comparePrice ?? product.basePrice ?? product.price,
      tax: product.tax ?? 0,
      stock: product.stock ?? null,
      image: product.image,
      weight: product.weight,
      sku: product.sku,
      basePrice: product.basePrice,
      discountPercent: product.discountPercent,
      quantity,
    })
  } else {
    existing[index] = {
      ...existing[index],
      quantity: existing[index].quantity + quantity,
    }
  }

  setCartItems(existing)
}

export const getCartQuantityForSlug = (slug: string): number => {
  return getCartItems()
    .filter((cartItem) => cartItem.slug === slug)
    .reduce((sum, item) => sum + item.quantity, 0)
}

export const getCartQuantity = (productId: string, variantId?: string | null): number => {
  const key = `${productId}:${variantId ?? "default"}`
  return getCartItems()
    .filter((item) => item.id === key)
    .reduce((sum, item) => sum + item.quantity, 0)
}

export const setCartItemQuantity = (product: CartProductInput, quantity: number) => {
  const existing = getCartItems()
  const nextQuantity = Math.max(0, quantity)
  const key = getCartKey(product)
  const index = existing.findIndex((item) => item.id === key)

  if (index === -1 && nextQuantity > 0) {
    existing.push({
      id: key,
      productId: product.productId || product.id || product.slug,
      variantId: product.variantId ?? null,
      slug: product.slug,
      name: product.name,
      variantLabel: product.variantLabel ?? product.weight,
      variantOptions: product.variantOptions,
      price: product.price,
      comparePrice: product.comparePrice ?? product.basePrice ?? product.price,
      tax: product.tax ?? 0,
      stock: product.stock ?? null,
      image: product.image,
      weight: product.weight,
      sku: product.sku,
      basePrice: product.basePrice,
      discountPercent: product.discountPercent,
      quantity: nextQuantity,
    })
  } else if (index !== -1 && nextQuantity === 0) {
    existing.splice(index, 1)
  } else if (index !== -1) {
    existing[index] = { ...existing[index], quantity: nextQuantity }
  }

  setCartItems(existing)
}

/**
 * Validates that all items in the cart that require variants have one selected.
 */
export const validateCartItems = (items: CartItem[], products: StorefrontProduct[]) => {
  for (const item of items) {
    const product = products.find((p) => p.id === item.productId || p.slug === item.slug)
    if (!product) continue

    const isPack = item.variantId?.includes(":pack-")
    const [rawVariantId] = item.variantId ? item.variantId.split(":pack-") : [null]
    const baseVariantId = rawVariantId === "default" ? null : rawVariantId

    if (product.productKind === "variant") {
      if (!item.variantId) {
        return { valid: false, error: `Variant is required for product: ${product.name}` }
      }
      if (isPack || product.packs?.some((pk: any) => pk.id === item.variantId)) {
        if (baseVariantId && !product.variants.some((v) => v.id === baseVariantId) && !product.packs?.some((pk: any) => pk.id === item.variantId)) {
          return { valid: false, error: `Invalid variant selected for: ${product.name}` }
        }
      } else if (!product.variants.some((v) => v.id === item.variantId)) {
        return { valid: false, error: `Invalid variant selected for: ${product.name}` }
      }
    }
  }
  return { valid: true }
}
