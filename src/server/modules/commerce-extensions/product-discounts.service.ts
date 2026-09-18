import { pgQuery } from "@/src/server/db/pg"

const isMissingRelation = (error: unknown) => {
  const code = typeof error === "object" && error && "code" in error ? String((error as { code?: string }).code) : ""
  const message = error instanceof Error ? error.message : String(error)
  return code === "42P01" || /does not exist/i.test(message)
}

export const listProductDiscounts = async (productId?: string) => {
  try {
    return await pgQuery<Array<{
      id: string
      product_id: string
      discount_type: string
      discount_value: number
      start_date: Date | null
      end_date: Date | null
      is_stackable: boolean
      created_at: Date
    }>>(
      `
      SELECT *
      FROM product_discounts_v2
      WHERE ($1::text IS NULL OR product_id = $1)
      ORDER BY created_at DESC
    `,
      [productId ?? null],
    )
  } catch (error) {
    if (isMissingRelation(error)) return []
    throw error
  }
}

export const createProductDiscount = async (input: {
  productId: string
  discountType: "percentage" | "flat"
  discountValue: number
  startDate?: string | null
  endDate?: string | null
  isStackable?: boolean
}) => {
  const rows = await pgQuery<Array<{ id: string }>>(
    `
      INSERT INTO product_discounts_v2 (
        product_id, discount_type, discount_value, start_date, end_date, is_stackable
      )
      VALUES ($1, $2, $3, $4, $5, $6)
      RETURNING id
    `,
    [
      input.productId,
      input.discountType,
      input.discountValue,
      input.startDate ? new Date(input.startDate) : null,
      input.endDate ? new Date(input.endDate) : null,
      input.isStackable ?? false,
    ],
  )
  return rows[0]?.id
}

export const updateProductDiscount = async (
  id: string,
  input: Partial<{
    discountType: "percentage" | "flat"
    discountValue: number
    startDate: string | null
    endDate: string | null
    isStackable: boolean
  }>,
) => {
  const sets: string[] = []
  const values: any[] = []

  if (input.discountType !== undefined) {
    values.push(input.discountType)
    sets.push(`discount_type = $${values.length}`)
  }
  if (input.discountValue !== undefined) {
    values.push(input.discountValue)
    sets.push(`discount_value = $${values.length}`)
  }
  if (input.startDate !== undefined) {
    values.push(input.startDate ? new Date(input.startDate) : null)
    sets.push(`start_date = $${values.length}`)
  }
  if (input.endDate !== undefined) {
    values.push(input.endDate ? new Date(input.endDate) : null)
    sets.push(`end_date = $${values.length}`)
  }
  if (input.isStackable !== undefined) {
    values.push(input.isStackable)
    sets.push(`is_stackable = $${values.length}`)
  }
  sets.push(`updated_at = now()`)

  values.push(id)
  await pgQuery(
    `UPDATE product_discounts_v2 SET ${sets.join(", ")} WHERE id = $${values.length}::uuid`,
    values,
  )
}

export const getActiveProductDiscount = async (productId: string, now = new Date()) => {
  try {
    const rows = await pgQuery<Array<{
      id: string
      discount_type: "percentage" | "flat"
      discount_value: number
      is_stackable: boolean
    }>>(
      `
      SELECT id, discount_type, discount_value, is_stackable
      FROM product_discounts_v2
      WHERE product_id = $1
        AND (start_date IS NULL OR start_date <= $2)
        AND (end_date IS NULL OR end_date >= $2)
      ORDER BY created_at DESC
      LIMIT 1
    `,
      [productId, now],
    )
    return rows[0] ?? null
  } catch (error) {
    if (isMissingRelation(error)) return null
    throw error
  }
}

export const applyProductDiscount = (basePrice: number, discount: { discount_type: "percentage" | "flat"; discount_value: number } | null) => {
  if (!discount) return { discountedPrice: basePrice, discountAmount: 0 }
  const rawDiscount =
    discount.discount_type === "percentage"
      ? (basePrice * Number(discount.discount_value)) / 100
      : Number(discount.discount_value)
  const discountAmount = Math.min(Math.max(rawDiscount, 0), basePrice)
  const discountedPrice = Math.max(0, basePrice - discountAmount)
  return { discountedPrice, discountAmount }
}
