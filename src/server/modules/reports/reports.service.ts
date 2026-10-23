import { pgTimestampToUtcIso } from "@/src/lib/datetime"
import { pgQuery } from "@/src/server/db/pg"

const COD_METHODS = `('cod', 'cash_on_delivery', 'cash')`

const rangeFilter = (
  from: Date,
  to: Date,
  preparationType?: string | null,
  tagId?: string | null,
  payment?: string | null,
  categoryId?: string | null,
) => {
  const values: unknown[] = [from, to]
  const where = [`o."createdAt" >= $1`, `o."createdAt" <= $2`]

  if (preparationType && preparationType !== "all") {
    values.push(preparationType)
    where.push(`EXISTS (
      SELECT 1 FROM "OrderItem" oi
      INNER JOIN "Product" p ON p.id = oi."productId"
      WHERE oi."orderId" = o.id AND p."preparationType" = $${values.length}
    )`)
  }
  if (tagId && tagId !== "all") {
    values.push(tagId)
    where.push(`EXISTS (
      SELECT 1 FROM "OrderItem" oi
      INNER JOIN "ProductTag" pt ON pt."productId" = oi."productId"
      WHERE oi."orderId" = o.id AND pt."tagId" = $${values.length}
    )`)
  }
  if (categoryId && categoryId !== "all") {
    values.push(categoryId)
    where.push(`EXISTS (
      SELECT 1 FROM "OrderItem" oi
      INNER JOIN "ProductCategory" pc ON pc."productId" = oi."productId"
      WHERE oi."orderId" = o.id AND pc."categoryId" = $${values.length}
    )`)
  }
  if (payment === "cod") {
    where.push(`lower(COALESCE(o."paymentMethod", '')) IN ${COD_METHODS}`)
  } else if (payment === "online") {
    where.push(`lower(COALESCE(o."paymentMethod", '')) NOT IN ${COD_METHODS} AND COALESCE(o."paymentMethod", '') <> ''`)
  }

  return { values, whereSql: `WHERE ${where.join(" AND ")}` }
}

const percentChange = (current: number, previous: number) => {
  if (previous === 0) return current === 0 ? 0 : 100
  return Number((((current - previous) / Math.abs(previous)) * 100).toFixed(1))
}

const fillDays = (from: Date, to: Date, rows: Array<{ day: string; orders: number; revenue: number }>) => {
  const byDay = new Map(rows.map((row) => [String(row.day).slice(0, 10), row]))
  const cursor = new Date(Date.UTC(from.getUTCFullYear(), from.getUTCMonth(), from.getUTCDate()))
  const end = new Date(Date.UTC(to.getUTCFullYear(), to.getUTCMonth(), to.getUTCDate()))
  const series: Array<{ date: string; orders: number; revenue: number }> = []
  while (cursor <= end && series.length < 400) {
    const key = cursor.toISOString().slice(0, 10)
    const row = byDay.get(key)
    series.push({
      date: key,
      orders: Number(row?.orders ?? 0),
      revenue: Number(row?.revenue ?? 0),
    })
    cursor.setUTCDate(cursor.getUTCDate() + 1)
  }
  return series
}

export const salesSummary = async (
  from: Date,
  to: Date,
  preparationType?: string | null,
  tagId?: string | null,
  payment?: string | null,
  categoryId?: string | null,
) => {
  const current = rangeFilter(from, to, preparationType, tagId, payment, categoryId)
  const span = Math.max(to.getTime() - from.getTime(), 24 * 60 * 60 * 1000)
  const prevTo = new Date(from.getTime() - 1)
  const prevFrom = new Date(prevTo.getTime() - span)
  const previous = rangeFilter(prevFrom, prevTo, preparationType, tagId, payment, categoryId)

  const totalsSql = (whereSql: string) => `
    SELECT
      COALESCE(SUM(o.total),0)::numeric as revenue_total,
      COALESCE(SUM(o.subtotal),0)::numeric as subtotal_total,
      COUNT(*)::int as order_count,
      COALESCE(SUM(o.total) FILTER (WHERE lower(COALESCE(o."paymentMethod", '')) IN ${COD_METHODS}), 0)::numeric as cod_total,
      COALESCE(SUM(o.total) FILTER (WHERE lower(COALESCE(o."paymentMethod", '')) NOT IN ${COD_METHODS}), 0)::numeric as online_total
    FROM "Order" o
    ${whereSql}
  `

  const refundSql = (whereSql: string) => `
    SELECT COALESCE(SUM(r.amount),0)::numeric as refunded_amount
    FROM "RefundRecord" r
    INNER JOIN "Order" o ON o.id = r."orderId"
    ${whereSql}
      AND r.status = 'completed'
  `

  const [aggRows, prevAggRows, refundedRows, prevRefundedRows, byStatus, productSummary, dailyRows, recentRows] = await Promise.all([
    pgQuery<Array<{ revenue_total: number; subtotal_total: number; order_count: number; cod_total: number; online_total: number }>>(
      totalsSql(current.whereSql),
      current.values,
    ),
    pgQuery<Array<{ revenue_total: number; subtotal_total: number; order_count: number }>>(
      totalsSql(previous.whereSql),
      previous.values,
    ),
    pgQuery<Array<{ refunded_amount: number }>>(refundSql(current.whereSql), current.values).catch(() => [{ refunded_amount: 0 }]),
    pgQuery<Array<{ refunded_amount: number }>>(refundSql(previous.whereSql), previous.values).catch(() => [{ refunded_amount: 0 }]),
    pgQuery<Array<{ status: string; count: number; revenue: number }>>(
      `
        SELECT o.status as status, COUNT(*)::int as count, COALESCE(SUM(o.total),0)::numeric as revenue
        FROM "Order" o
        ${current.whereSql}
        GROUP BY o.status
      `,
      current.values,
    ),
    pgQuery<Array<{ productId: string; totalQuantity: number; revenue: number }>>(
      `
        SELECT
          oi."productId" as "productId",
          COALESCE(SUM(oi.quantity),0)::int as "totalQuantity",
          COALESCE(SUM(oi."lineTotal"),0)::numeric as revenue
        FROM "OrderItem" oi
        INNER JOIN "Order" o ON o.id = oi."orderId"
        ${current.whereSql}
        GROUP BY oi."productId"
        ORDER BY COALESCE(SUM(oi."lineTotal"),0) DESC, COALESCE(SUM(oi.quantity),0) DESC
        LIMIT 5
      `,
      current.values,
    ),
    pgQuery<Array<{ day: string; orders: number; revenue: number }>>(
      `
        SELECT
          to_char(date_trunc('day', o."createdAt"), 'YYYY-MM-DD') as day,
          COUNT(*)::int as orders,
          COALESCE(SUM(o.total),0)::numeric as revenue
        FROM "Order" o
        ${current.whereSql}
        GROUP BY 1
        ORDER BY 1
      `,
      current.values,
    ),
    pgQuery<
      Array<{
        id: string
        createdAt: Date | string
        customerName: string | null
        paymentMethod: string | null
        total: number
        shipmentStatus: string | null
      }>
    >(
      `
        SELECT
          o.id,
          o."createdAt" as "createdAt",
          o."customerName" as "customerName",
          o."paymentMethod" as "paymentMethod",
          o.total,
          COALESCE(
            NULLIF(o."shipmentStatus", ''),
            (
              SELECT s."shipmentStatus"
              FROM "Shipment" s
              WHERE s."orderId" = o.id
              ORDER BY s."updatedAt" DESC NULLS LAST
              LIMIT 1
            ),
            o.status::text
          ) as "shipmentStatus"
        FROM "Order" o
        ${current.whereSql}
        ORDER BY o."createdAt" DESC
        LIMIT 8
      `,
      current.values,
    ),
  ])

  const agg = aggRows[0] ?? { revenue_total: 0, subtotal_total: 0, order_count: 0, cod_total: 0, online_total: 0 }
  const prev = prevAggRows[0] ?? { revenue_total: 0, subtotal_total: 0, order_count: 0 }
  const refundedAmount = Number(refundedRows[0]?.refunded_amount ?? 0)
  const prevRefunded = Number(prevRefundedRows[0]?.refunded_amount ?? 0)
  const revenueTotal = Number(agg.revenue_total ?? 0)
  const prevRevenue = Number(prev.revenue_total ?? 0)
  const subtotalTotal = Number(agg.subtotal_total ?? 0)
  const prevSubtotal = Number(prev.subtotal_total ?? 0)
  const orderCount = Number(agg.order_count ?? 0)
  const prevOrderCount = Number(prev.order_count ?? 0)
  const netSale = revenueTotal - refundedAmount
  const prevNetSale = prevRevenue - prevRefunded
  const averageOrderValue = orderCount > 0 ? revenueTotal / orderCount : 0
  const prevAverageOrderValue = prevOrderCount > 0 ? prevRevenue / prevOrderCount : 0

  const statusMap = new Map(
    byStatus.map((row) => [
      row.status,
      {
        status: row.status,
        count: row.count,
        revenue: Number(row.revenue ?? 0),
      },
    ]),
  )
  if (!statusMap.has("cancelled")) statusMap.set("cancelled", { status: "cancelled", count: 0, revenue: 0 })

  const productIds = productSummary.map((p) => p.productId)
  const products = productIds.length
    ? await pgQuery<Array<{ id: string; name: string }>>(`SELECT id, name FROM "Product" WHERE id = ANY($1::text[])`, [
        productIds,
      ])
    : []
  const productMap = new Map(products.map((p) => [p.id, p.name]))

  return {
    from,
    to,
    orderCount,
    revenueTotal,
    subtotalTotal,
    refundedAmount,
    netSale,
    averageOrderValue,
    change: {
      orders: percentChange(orderCount, prevOrderCount),
      revenue: percentChange(revenueTotal, prevRevenue),
      netSale: percentChange(netSale, prevNetSale),
      subtotal: percentChange(subtotalTotal, prevSubtotal),
      refunds: percentChange(refundedAmount, prevRefunded),
      averageOrderValue: percentChange(averageOrderValue, prevAverageOrderValue),
    },
    series: fillDays(from, to, dailyRows),
    paymentBreakdown: {
      online: Number(agg.online_total ?? 0),
      cod: Number(agg.cod_total ?? 0),
      refunds: refundedAmount,
    },
    byStatus: Array.from(statusMap.values()),
    products: productSummary.map((row) => ({
      productId: row.productId,
      productName: productMap.get(row.productId) ?? "Unknown",
      totalQuantity: Number(row.totalQuantity ?? 0),
      revenue: Number(row.revenue ?? 0),
    })),
    recentOrders: recentRows.map((row) => ({
      id: row.id,
      createdAt: row.createdAt instanceof Date ? pgTimestampToUtcIso(row.createdAt) ?? row.createdAt.toISOString() : String(row.createdAt),
      customerName: row.customerName || "Guest",
      paymentMethod: row.paymentMethod,
      shipmentStatus: row.shipmentStatus || "pending",
      total: Number(row.total ?? 0),
    })),
  }
};