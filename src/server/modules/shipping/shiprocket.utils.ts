import { SHIPROCKET_STATUS_TO_ORDER_STATUS } from "@/src/server/modules/shipping/shiprocket.constants"

export const normalizeShiprocketStatus = (value?: string | null) => (value ?? "").trim().toLowerCase().replace(/\s+/g, "_")

export const mapShiprocketStatusToOrderStatus = (value?: string | null) => {
  const normalized = normalizeShiprocketStatus(value)
  return SHIPROCKET_STATUS_TO_ORDER_STATUS[normalized] ?? null
}

type ShiprocketLineSource = {
  id?: string
  quantity?: number
  unitPrice?: number
  sku?: string | null
  variantName?: string | null
  product?: { name?: string | null; sku?: string | null; slug?: string | null } | null
}

export type ShiprocketLineItem = {
  orderItemId?: string
  quantity: number
  name: string
  sku: string
  sellingPrice: number
}

/** Shiprocket rejects an order when two lines share a SKU. Prefer the variant SKU, then merge true duplicates. */
export const buildShiprocketLineItems = (items: ShiprocketLineSource[]): ShiprocketLineItem[] => {
  const merged = new Map<string, ShiprocketLineItem>()
  for (const item of items) {
    const quantity = Number(item.quantity ?? 0)
    if (!Number.isFinite(quantity) || quantity <= 0) continue
    const baseSku = String(item.sku || item.product?.sku || item.product?.slug || `sku-${item.id ?? merged.size + 1}`).trim()
    const name = [item.product?.name, item.variantName].filter((part) => String(part ?? "").trim()).join(" - ") || "Item"
    const sellingPrice = Number(item.unitPrice ?? 0)
    const existing = merged.get(baseSku)
    if (!existing) {
      merged.set(baseSku, { orderItemId: item.id, quantity, name, sku: baseSku, sellingPrice })
      continue
    }
    if (existing.sellingPrice === sellingPrice) {
      existing.quantity += quantity
      continue
    }
    let suffix = 2
    let uniqueSku = `${baseSku}-${suffix}`
    while (merged.has(uniqueSku)) {
      suffix += 1
      uniqueSku = `${baseSku}-${suffix}`
    }
    merged.set(uniqueSku, { orderItemId: item.id, quantity, name, sku: uniqueSku, sellingPrice })
  }
  return [...merged.values()]
}

export const parseOrderPostalCode = (address?: string | null) => {
  if (!address) return null
  const match = address.match(/\b\d{6}\b/)
  return match?.[0] ?? null
}

/** Shiprocket `weight` is kilograms. Catalog values are pack sizes like `240gm` or `350g`. */
export const weightToKg = (weight?: string | null) => {
  if (!weight) return 0.5
  const normalized = weight.trim().toLowerCase()
  const n = Number(normalized.replace(/[^\d.]/g, ""))
  if (!Number.isFinite(n) || n <= 0) return 0.5
  const unit = normalized.replace(/[\d.\s]/g, "")
  let kg = n
  if (unit.includes("kg") || unit.includes("kilo")) kg = n
  else if (unit.includes("mg") || unit.includes("milli")) kg = n / 1_000_000
  else if (unit === "g" || unit === "gm" || unit === "gms" || unit.startsWith("gram")) kg = n / 1000
  else if (!unit && n >= 10) kg = n / 1000
  const rounded = Math.round(kg * 1000) / 1000
  return rounded > 0 ? rounded : 0.5
}

/**
 * Checkout stores `line1, city, state, pincode, country`, and line1 itself may contain commas.
 * Read city and state from the end so the street keeps the locality, not only the first fragment.
 */
export const parseShiprocketAddress = (address?: string | null) => {
  const parts = String(address ?? "")
    .split(",")
    .map((part) => part.trim())
    .filter(Boolean)
  const isCountry = (part: string) => /^(india|in)$/i.test(part)
  const isPincode = (part: string) => /\b\d{6}\b/.test(part)
  const pincode = parts.find((part) => isPincode(part))?.match(/\b\d{6}\b/)?.[0] ?? null
  const body = parts.filter((part) => !isCountry(part) && !isPincode(part))

  if (body.length >= 3) {
    return {
      line1: body.slice(0, -2).join(", ").slice(0, 190),
      city: body[body.length - 2],
      state: body[body.length - 1],
      pincode,
    }
  }
  if (body.length === 2) {
    return { line1: body[0].slice(0, 190), city: body[1], state: "NA", pincode }
  }
  return {
    line1: (body[0] ?? "Address unavailable").slice(0, 190),
    city: "NA",
    state: "NA",
    pincode,
  }
}

export const normalizeShiprocketErrorMessage = (error: unknown, fallback: string) => {
  if (error instanceof Error && error.message.trim()) return error.message
  return fallback
}
