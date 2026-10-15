import { logger } from "@/lib/logger"
import { pgQuery } from "@/src/server/db/pg"

export type AdminNotification = {
  id: string
  kind: "order" | "cancel" | "return" | "stock" | "review"
  title: string
  body: string
  href: string
  createdAt: string
}

const safeRows = async <T extends Record<string, unknown>>(label: string, sql: string) => {
  try {
    return await pgQuery<T[]>(sql)
  } catch (error) {
    logger.warn("admin.notifications.query_failed", {
      label,
      error: error instanceof Error ? error.message : "unknown",
    })
    return [] as T[]
  }
}

const text = (value: unknown, fallback: string) => {
  const raw = String(value ?? "").trim()
  return raw || fallback
}

const iso = (value: unknown) => {
  const date = value instanceof Date ? value : new Date(String(value ?? ""))
  return Number.isNaN(date.getTime()) ? new Date().toISOString() : date.toISOString()
}

export const listAdminNotifications = async (): Promise<AdminNotification[]> => {
  const [orders, cancels, returns, stock, reviews] = await Promise.all([
    safeRows<{ id: string; customerName: string | null; createdAt: string }>(
      "orders",
      `
        SELECT id, "customerName", "createdAt"
        FROM "Order"
        WHERE "createdAt" > now() - interval '14 days'
          AND status::text <> 'failed'
        ORDER BY "createdAt" DESC
        LIMIT 20
      `,
    ),
    safeRows<{ id: string; orderId: string; customerName: string | null; changedAt: string; reasonCode: string | null }>(
      "cancels",
      `
        SELECT h.id, h."orderId", o."customerName", h."changedAt", h."reasonCode"
        FROM "OrderStatusHistory" h
        JOIN "Order" o ON o.id = h."orderId"
        WHERE h."reasonCode" IN ('customer_cancelled', 'cancel_pending')
           OR h."toStatus" = 'cancel_requested'
        ORDER BY h."changedAt" DESC
        LIMIT 20
      `,
    ),
    safeRows<{ id: string; orderId: string; customerName: string | null; createdAt: string; reason: string | null }>(
      "returns",
      `
        SELECT r.id, r."orderId", o."customerName", r."createdAt", r.reason
        FROM "ReturnRequest" r
        LEFT JOIN "Order" o ON o.id = r."orderId"
        WHERE lower(r.status) IN ('requested', 'pending')
        ORDER BY r."createdAt" DESC
        LIMIT 20
      `,
    ),
    safeRows<{ id: string; name: string; updatedAt: string }>(
      "stock",
      `
        SELECT id, name, "updatedAt"
        FROM "Product"
        WHERE status::text = 'published'
          AND ("totalStock" <= 0 OR "stockStatus"::text = 'out_of_stock')
        ORDER BY "updatedAt" DESC
        LIMIT 20
      `,
    ),
    safeRows<{ id: string; productName: string | null; rating: number; createdAt: string }>(
      "reviews",
      `
        SELECT r.id, p.name AS "productName", r.rating, r."createdAt"
        FROM "ProductReview" r
        LEFT JOIN "Product" p ON p.id = r."productId"
        WHERE r."createdAt" > now() - interval '14 days'
        ORDER BY r."createdAt" DESC
        LIMIT 20
      `,
    ),
  ])

  const items: AdminNotification[] = [
    ...orders.map((row) => ({
      id: `order:${row.id}`,
      kind: "order" as const,
      title: "New order",
      body: `${text(row.customerName, "A customer")} placed a new order.`,
      href: `/admin/orders/${row.id}`,
      createdAt: iso(row.createdAt),
    })),
    ...cancels.map((row) => ({
      id: `cancel:${row.id}`,
      kind: "cancel" as const,
      title: "Cancellation request",
      body: `${text(row.customerName, "A customer")} requested to cancel an order.`,
      href: `/admin/orders/${row.orderId}`,
      createdAt: iso(row.changedAt),
    })),
    ...returns.map((row) => ({
      id: `return:${row.id}`,
      kind: "return" as const,
      title: "Return request",
      body: `${text(row.customerName, "A customer")} submitted a return request${row.reason ? `: ${row.reason}` : "."}`,
      href: "/admin/returns",
      createdAt: iso(row.createdAt),
    })),
    ...stock.map((row) => ({
      id: `stock:${row.id}`,
      kind: "stock" as const,
      title: "Out of stock",
      body: `Update stock. ${text(row.name, "This product")} is out of stock.`,
      href: `/admin/products/${row.id}/edit`,
      createdAt: iso(row.updatedAt),
    })),
    ...reviews.map((row) => ({
      id: `review:${row.id}`,
      kind: "review" as const,
      title: "New product review",
      body: `${text(row.productName, "A product")} received a new ${row.rating}-star review.`,
      href: "/admin/reviews",
      createdAt: iso(row.createdAt),
    })),
  ]

  return items.sort((a, b) => (a.createdAt < b.createdAt ? 1 : -1)).slice(0, 40)
}
