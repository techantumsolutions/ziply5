/**
 * Helper functions for calculating and resolving order item display attributes
 * such as clean variant SKU, variant HSN, pack multipliers, and multiplied weight.
 */

export type OrderItemDisplaySource = {
  id?: string
  sku?: string | null
  unitPrice?: number | string | null
  variantId?: string | null
  quantity?: number
  hsnCode?: string | null
  hsn?: string | null
  packQuantity?: number | string | null
  packName?: string | null
  comparePrice?: number | string | null
  savingAmount?: number | string | null
  baseWeight?: string | null
  variant?: {
    id?: string | null
    name?: string | null
    weight?: string | null
    price?: number | string | null
    sku?: string | null
    hsnCode?: string | null
    hsn_code?: string | null
    mrp?: number | string | null
  } | null
  product?: {
    id?: string | null
    name?: string | null
    weight?: string | null
    sku?: string | null
    hsnCode?: string | null
    hsn?: string | null
    packs?: any[] | string | null
    price?: number | string | null
  } | null
}

/**
 * Resolves the pack multiplier (quantity of products in the pack) for an order item.
 * Prioritizes persistent snapshot data so historical orders never change when products or packs are updated.
 * E.g. If an item is a Pack of 2, returns 2.
 */
export function resolveItemPackQuantity(item: OrderItemDisplaySource | null | undefined): number {
  if (!item) return 1

  // 0. Persistent snapshot on order item: highest priority
  const snapshotQty = Number((item as any).packQuantity ?? (item as any).pack_quantity)
  if (Number.isFinite(snapshotQty) && snapshotQty > 0) {
    return snapshotQty
  }

  // 1. Check if SKU contains -PACK-{N} (from legacy auto-generated pack SKU, e.g. TEST-MV-001-REG-PACK-2)
  const skuStr = String(item.sku || "")
  const packMatch = skuStr.match(/-PACK-(\d+)/i)
  if (packMatch && Number(packMatch[1]) > 0) {
    return Number(packMatch[1])
  }

  // 2. Check if product.packs contains a matching pack configuration
  const rawPacks = item.product?.packs
  const packs = Array.isArray(rawPacks)
    ? rawPacks
    : typeof rawPacks === "string"
      ? (() => {
          try {
            return JSON.parse(rawPacks)
          } catch {
            return []
          }
        })()
      : []

  if (packs.length > 0) {
    const itemUnitPrice = Number(item.unitPrice || 0)

    // First try: match variant and price
    const matched =
      packs.find((pk: any) => {
        const vIdMatch = item.variantId && pk.variantId && String(pk.variantId) === String(item.variantId)
        const weightMatch =
          item.variant?.weight &&
          pk.variantWeight &&
          pk.variantWeight.trim().toLowerCase() === item.variant.weight.trim().toLowerCase()
        if ((vIdMatch || weightMatch) && itemUnitPrice > 0 && Math.abs(Number(pk.price) - itemUnitPrice) < 0.05) {
          return true
        }
        return false
      }) ||
      packs.find((pk: any) => {
        // Second try: match by price alone if itemUnitPrice matches pack price
        return itemUnitPrice > 0 && Math.abs(Number(pk.price) - itemUnitPrice) < 0.05
      }) ||
      packs.find((pk: any) => {
        // Third try: match by mrp if itemUnitPrice matches pack mrp
        return itemUnitPrice > 0 && Math.abs(Number(pk.mrp) - itemUnitPrice) < 0.05
      })

    if (matched && Number(matched.quantity) > 0) {
      return Number(matched.quantity)
    }
  }

  // 3. Fallback: check if unit price indicates an integer multiple of variant price
  const variantPrice = Number(item.variant?.price || 0)
  const unitPrice = Number(item.unitPrice || 0)
  if (variantPrice > 0 && unitPrice > variantPrice * 1.5) {
    const ratio = Math.round(unitPrice / variantPrice)
    if (ratio >= 2 && Math.abs(unitPrice - variantPrice * ratio) / unitPrice < 0.15) {
      return ratio
    }
  }

  return 1
}

/**
 * Resolves the pack name (e.g. "Pack of 2", "Pack of 4") for an order item if it is a pack.
 * Prioritizes persistent snapshot data so historical orders never change when products or packs are updated.
 */
export function resolveItemPackName(item: OrderItemDisplaySource | null | undefined): string | null {
  if (!item) return null

  // 0. Persistent snapshot on order item: highest priority
  const directName = String((item as any).packName || (item as any).pack_name || "").trim()
  if (directName) return directName

  const variantLabel = String((item as any).variantLabel || (item as any).variant_label || "").trim()
  if (variantLabel) {
    const packInLabel = variantLabel.match(/Pack\s+of\s+\d+/i)
    if (packInLabel) return packInLabel[0]
  }

  // 1. Check product.packs configuration
  const rawPacks = item.product?.packs
  const packs = Array.isArray(rawPacks)
    ? rawPacks
    : typeof rawPacks === "string"
      ? (() => {
          try {
            return JSON.parse(rawPacks)
          } catch {
            return []
          }
        })()
      : []

  if (packs.length > 0) {
    const itemUnitPrice = Number(item.unitPrice || 0)

    const matched =
      packs.find((pk: any) => {
        const vIdMatch = item.variantId && pk.variantId && String(pk.variantId) === String(item.variantId)
        const weightMatch =
          item.variant?.weight &&
          pk.variantWeight &&
          pk.variantWeight.trim().toLowerCase() === item.variant.weight.trim().toLowerCase()
        if ((vIdMatch || weightMatch) && itemUnitPrice > 0 && Math.abs(Number(pk.price) - itemUnitPrice) < 0.05) {
          return true
        }
        return false
      }) ||
      packs.find((pk: any) => {
        return itemUnitPrice > 0 && Math.abs(Number(pk.price) - itemUnitPrice) < 0.05
      }) ||
      packs.find((pk: any) => {
        return itemUnitPrice > 0 && Math.abs(Number(pk.mrp) - itemUnitPrice) < 0.05
      })

    if (matched && matched.name && String(matched.name).trim()) {
      return String(matched.name).trim()
    }
  }

  // 2. Check SKU suffix for -PACK-{N}
  const skuStr = String(item.sku || "")
  const packMatch = skuStr.match(/-PACK-(\d+)/i)
  if (packMatch && Number(packMatch[1]) > 0) {
    return `Pack of ${packMatch[1]}`
  }

  // 3. If resolveItemPackQuantity > 1, return default "Pack of {N}"
  const packQty = resolveItemPackQuantity(item)
  if (packQty > 1) {
    return `Pack of ${packQty}`
  }

  return null
}

export type ItemSavingsResult = {
  hasSavings: boolean
  unitPrice: number
  comparePrice: number
  savingPerUnit: number
  totalSavings: number
  discountPercent: number
}

/**
 * Resolves discount and savings for an order item.
 * Prioritizes persistent snapshot data (comparePrice, savingAmount) so past order
 * figures remain 100% frozen even when pack or product prices are modified later.
 */
export function resolveItemSavings(item: OrderItemDisplaySource | null | undefined): ItemSavingsResult {
  if (!item) {
    return { hasSavings: false, unitPrice: 0, comparePrice: 0, savingPerUnit: 0, totalSavings: 0, discountPercent: 0 }
  }

  const qty = Math.max(1, Number(item.quantity || 1))
  const unitPrice = Number(item.unitPrice || 0)

  // 1. Direct snapshot fields: highest priority
  const snapshotCompare = Number((item as any).comparePrice ?? (item as any).compare_price)
  const snapshotSaving = Number((item as any).savingAmount ?? (item as any).saving_amount)

  let comparePrice = 0

  if (Number.isFinite(snapshotCompare) && snapshotCompare > unitPrice) {
    comparePrice = snapshotCompare
  } else if (Number.isFinite(snapshotSaving) && snapshotSaving > 0) {
    comparePrice = unitPrice + snapshotSaving / qty
  } else {
    // 2. Legacy fallback for historical orders before snapshot columns
    const packQty = resolveItemPackQuantity(item)
    if (packQty > 1) {
      const variantMrp = Number(item.variant?.mrp || item.variant?.price || 0)
      if (variantMrp > 0 && variantMrp * packQty > unitPrice) {
        comparePrice = variantMrp * packQty
      }
    } else {
      const variantMrp = Number(item.variant?.mrp || 0)
      if (variantMrp > unitPrice) {
        comparePrice = variantMrp
      }
    }
  }

  if (comparePrice > unitPrice && unitPrice > 0) {
    const savingPerUnit = Math.round((comparePrice - unitPrice) * 100) / 100
    const totalSavings = Math.round(savingPerUnit * qty * 100) / 100
    const discountPercent = Math.min(99, Math.round((savingPerUnit / comparePrice) * 100))
    return {
      hasSavings: totalSavings > 0,
      unitPrice,
      comparePrice,
      savingPerUnit,
      totalSavings,
      discountPercent,
    }
  }

  return {
    hasSavings: false,
    unitPrice,
    comparePrice: unitPrice,
    savingPerUnit: 0,
    totalSavings: 0,
    discountPercent: 0,
  }
}

/**
 * Resolves the weight display for an order item.
 * If pack quantity > 1, returns the actual base weight followed by " * " and the pack quantity.
 * Example: resolveItemWeightDisplay("350g", 2) => "350g * 2"
 * If multiplier <= 1: returns actual weight, e.g. "350g"
 */
export function resolveItemWeightDisplay(
  baseWeight: string | null | undefined,
  packMultiplier: number,
): string {
  if (!baseWeight || !baseWeight.trim()) return ""
  const clean = baseWeight.trim()
  if (packMultiplier > 1) {
    return `${clean} * ${packMultiplier}`
  }
  return clean
}

/**
 * Multiplies a weight string (e.g. "350g", "240gm", "1.5 kg") by the pack quantity multiplier.
 * Example: multiplyWeight("350g", 2) => "700g"
 */
export function multiplyWeight(weightStr: string | null | undefined, multiplier: number): string {
  if (!weightStr || !weightStr.trim()) return ""
  if (!multiplier || multiplier <= 1) return weightStr.trim()

  const match = weightStr.trim().match(/^([\d.]+)(\s*.*)$/)
  if (!match) return weightStr.trim()

  const num = parseFloat(match[1])
  if (isNaN(num)) return weightStr.trim()

  const unit = match[2] || ""
  const totalWeight = Math.round(num * multiplier * 100) / 100
  return `${totalWeight}${unit}`
}

/**
 * Resolves the real SKU for an order item, prioritizing the variant SKU
 * and stripping any extraneous -PACK-{N} suffix.
 */
export function resolveItemSku(item: OrderItemDisplaySource | null | undefined): string {
  if (!item) return "—"

  const variantSku = item.variant?.sku?.trim()
  if (variantSku) {
    return variantSku.replace(/-PACK-\d+/i, "")
  }

  const itemSku = item.sku?.trim()
  if (itemSku) {
    return itemSku.replace(/-PACK-\d+/i, "")
  }

  const productSku = item.product?.sku?.trim()
  if (productSku) {
    return productSku.replace(/-PACK-\d+/i, "")
  }

  return "—"
}

/**
 * Resolves the HSN code for an order item, prioritizing the variant's HSN code.
 */
export function resolveItemHsn(item: OrderItemDisplaySource | null | undefined): string {
  if (!item) return "—"

  return (
    item.variant?.hsnCode?.trim() ||
    item.variant?.hsn_code?.trim() ||
    item.hsnCode?.trim() ||
    item.hsn?.trim() ||
    item.product?.hsnCode?.trim() ||
    item.product?.hsn?.trim() ||
    "—"
  )
}
