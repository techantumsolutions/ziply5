import { getSupabaseAdmin } from "@/src/lib/supabase/admin"
import { safeString } from "@/src/lib/db/supabaseIntegrity"
import { toUtcIso } from "@/src/lib/datetime"

/** Avoid crashing the whole dashboard when optional tables are missing or DB is partial. */
const safe = async <T>(fn: () => Promise<T>, fallback: T): Promise<T> => {
  try {
    return await fn()
  } catch {
    return fallback
  }
}

const countFromTables = async (tables: string[], where?: { column: string; value: string }) => {
  const client = getSupabaseAdmin()
  for (const table of tables) {
    const base = client.from(table).select("id", { count: "exact", head: true })
    const q = where ? base.eq(where.column, where.value) : base
    const { count, error } = await q
    if (!error) return Number(count ?? 0)
  }
  return 0
}

const sumColumnFromTables = async (tables: string[], columns: string[]) => {
  const client = getSupabaseAdmin()
  for (const table of tables) {
    for (const column of columns) {
      // PostgREST aggregate syntax: `alias:column.sum()`
      const { data, error } = await client.from(table).select(`total_sum:${column}.sum()`)
      if (error) continue
      const row = Array.isArray(data) ? (data[0] as any) : null
      const sum = row?.total_sum ?? row?.sum ?? row?.[column]?.sum ?? row?.[`${column}`]?.sum
      if (sum != null) return Number(sum ?? 0)
    }
  }
  return 0
}

const fetchAllInRange = async <T extends Record<string, unknown>>(input: {
  table: string
  selectCamel: string
  selectSnake: string
  rangeSize?: number
  maxRows?: number
  fromIso?: string
  toIso?: string
  dateColumns?: { camel: string; snake: string }
}) => {
  const client = getSupabaseAdmin()
  const rangeSize = Math.min(1000, Math.max(200, input.rangeSize ?? 1000))
  const maxRows = Math.min(20_000, Math.max(1000, input.maxRows ?? 10_000))
  const out: T[] = []
  let offset = 0
  while (offset < maxRows) {
    let qb = client.from(input.table).select(input.selectCamel).range(offset, offset + rangeSize - 1)
    if (input.fromIso && input.toIso && input.dateColumns) {
      // Prefer camelCase column; fallback to snake_case if needed.
      qb = qb.gte(input.dateColumns.camel, input.fromIso).lt(input.dateColumns.camel, input.toIso)
    }
    const { data, error } = await qb
    if (error) {
      if (input.fromIso && input.toIso && input.dateColumns) {
        const qb2 = client
          .from(input.table)
          .select(input.selectSnake)
          .gte(input.dateColumns.snake, input.fromIso)
          .lt(input.dateColumns.snake, input.toIso)
          .range(offset, offset + rangeSize - 1)
        const { data: d2, error: e2 } = await qb2
        if (e2) break
        if (!Array.isArray(d2) || d2.length === 0) break
        out.push(...(d2 as T[]))
        offset += d2.length
        if (d2.length < rangeSize) break
        continue
      }
      break
    }
    if (!Array.isArray(data) || data.length === 0) break
    out.push(...(data as T[]))
    offset += data.length
    if (data.length < rangeSize) break
  }
  return out
}

const monthKey = (d: Date) => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}`
const monthLabel = (monthIdx: number) =>
  ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"][monthIdx] ?? "-"

export const getDashboardSummary = async () => {
  const ORDER_TABLES = ["Order", "orders"]
  const ORDER_ITEM_TABLES = ["OrderItem", "order_items", "order_items_v2", "OrderItems", "order_item", "orderItems"]
  const USER_TABLES = ["User", "users"]
  const PRODUCT_TABLES = ["Product", "products"]
  const PRODUCT_VARIANT_TABLES = ["ProductVariant", "product_variants"]

  const now = new Date()
  const currentYearStart = new Date(now.getFullYear(), 0, 1)
  const lastYearStart = new Date(now.getFullYear() - 1, 0, 1)
  const nextYearStart = new Date(now.getFullYear() + 1, 0, 1)

  const [totalOrders, pendingOrders, totalUsers, totalProducts] = await Promise.all([
    safe(() => countFromTables(ORDER_TABLES), 0),
    safe(() => countFromTables(ORDER_TABLES, { column: "status", value: "pending" }), 0),
    safe(() => countFromTables(USER_TABLES), 0),
    safe(() => countFromTables(PRODUCT_TABLES), 0),
  ])

  const totalSales = await safe(async () => {
    const sum = await sumColumnFromTables(ORDER_TABLES, ["total", "grandTotal", "grand_total", "totalAmount", "total_amount"])
    if (Number.isFinite(sum) && sum > 0) return sum

    // Fallback if aggregates are blocked: sum latest N rows (best-effort).
    const client = getSupabaseAdmin()
    for (const table of ORDER_TABLES) {
      for (const col of ["total", "grandTotal", "grand_total", "totalAmount", "total_amount"]) {
        const { data, error } = await client.from(table).select(col).limit(20_000)
        if (error || !Array.isArray(data) || data.length === 0) continue
        const s = (data as Array<Record<string, unknown>>).reduce((acc, r) => acc + Number(r[col] ?? 0), 0)
        if (s > 0) return s
      }
    }

    return 0
  }, 0)

  const recentOrders = await safe(async () => {
    const client = getSupabaseAdmin()
    for (const table of ORDER_TABLES) {
      const attempts = [
        () => client.from(table).select("id,status,total,createdAt,customerName").order("createdAt", { ascending: false }).limit(6),
        () => client.from(table).select("id,status,total,created_at,customer_name").order("created_at", { ascending: false }).limit(6),
      ]
      for (const run of attempts) {
        const { data, error } = await run()
        if (error || !Array.isArray(data)) continue
        return (data as Array<Record<string, unknown>>).map((o) => ({
          id: safeString(o.id),
          status: safeString(o.status),
          total: Number(o.total ?? 0),
          createdAt: toUtcIso(o.createdAt ?? o.created_at) ?? "",
          customerName: safeString(o.customerName ?? o.customer_name),
        }))
      }
    }
    return []
  }, [])

  const lowStockVariants = await safe(async () => {
    const client = getSupabaseAdmin()
    for (const table of PRODUCT_VARIANT_TABLES) {
      const attempts = [
        () => client.from(table).select("id,stock,name,productId").lte("stock", 5).order("stock", { ascending: true }).limit(10),
        () => client.from(table).select("id,stock,name,product_id").lte("stock", 5).order("stock", { ascending: true }).limit(10),
      ]
      for (const run of attempts) {
        const { data, error } = await run()
        if (error || !Array.isArray(data)) continue
        const variants = data as Array<Record<string, unknown>>
        const productIds = variants.map((v) => safeString(v.productId ?? v.product_id)).filter(Boolean)
        let products: Array<Record<string, unknown>> = []
        for (const pt of PRODUCT_TABLES) {
          const { data: pData, error: pErr } = await client.from(pt).select("id,name,slug").in("id", productIds.length ? productIds : ["__none__"])
          if (!pErr && Array.isArray(pData)) {
            products = pData as Array<Record<string, unknown>>
            break
          }
        }
        const byId = new Map(products.map((p) => [safeString(p.id), p]))
        return variants.map((v) => {
          const pid = safeString(v.productId ?? v.product_id)
          const p = byId.get(pid) as any
          return {
            id: safeString(v.id),
            stock: Number(v.stock ?? 0),
            name: safeString(v.name),
            product: { name: safeString(p?.name), slug: safeString(p?.slug) },
          }
        })
      }
    }
    return []
  }, [])

  // Sales trend: computed from DB rows in the date window (cached by API).
  const salesRows = await safe(async () => {
    for (const table of ORDER_TABLES) {
      const rows = await fetchAllInRange<{ total?: number | string | null; createdAt?: string | null; created_at?: string | null }>({
        table,
        selectCamel: "total,createdAt",
        selectSnake: "total,created_at",
        rangeSize: 750,
        maxRows: 50_000,
        fromIso: lastYearStart.toISOString(),
        toIso: nextYearStart.toISOString(),
        dateColumns: { camel: "createdAt", snake: "created_at" },
      })
      if (rows.length) return rows
    }
    return []
  }, [])

  const monthTotals = new Map<string, number>()
  for (const row of salesRows) {
    const ts = toUtcIso(row.createdAt ?? row.created_at)
    if (!ts) continue
    const d = new Date(ts)
    if (!Number.isFinite(d.getTime())) continue
    const key = monthKey(d)
    monthTotals.set(key, (monthTotals.get(key) ?? 0) + Number(row.total ?? 0))
  }
  const months = Array.from({ length: 12 }).map((_, idx) => idx)
  const salesTrend = months.map((m) => {
    const curKey = `${now.getFullYear()}-${String(m + 1).padStart(2, "0")}`
    const prevKey = `${now.getFullYear() - 1}-${String(m + 1).padStart(2, "0")}`
    return {
      month: monthLabel(m),
      currentYear: Number(monthTotals.get(curKey) ?? 0),
      lastYear: Number(monthTotals.get(prevKey) ?? 0),
    }
  })

  // Product views chart: use real order counts per weekday for this/last week (DB-backed).
  const weekday = (d: Date) => ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"][d.getDay()] ?? "-"
  const startOfWeek = (d: Date) => {
    const x = new Date(d)
    x.setHours(0, 0, 0, 0)
    x.setDate(x.getDate() - x.getDay())
    return x
  }
  const thisWeekStart = startOfWeek(now)
  const lastWeekStart = new Date(thisWeekStart)
  lastWeekStart.setDate(lastWeekStart.getDate() - 7)
  const thisWeekEnd = new Date(thisWeekStart)
  thisWeekEnd.setDate(thisWeekEnd.getDate() + 7)

  const weeklyRows = await safe(async () => {
    for (const table of ORDER_TABLES) {
      const rows = await fetchAllInRange<{ createdAt?: string | null; created_at?: string | null }>({
        table,
        selectCamel: "createdAt",
        selectSnake: "created_at",
        rangeSize: 1000,
        maxRows: 10_000,
        fromIso: lastWeekStart.toISOString(),
        toIso: thisWeekEnd.toISOString(),
        dateColumns: { camel: "createdAt", snake: "created_at" },
      })
      if (rows.length) return rows
    }
    return []
  }, [])
  const thisWeek = new Map<string, number>()
  const lastWeek = new Map<string, number>()
  for (const row of weeklyRows) {
    const ts = toUtcIso(row.createdAt ?? row.created_at)
    if (!ts) continue
    const d = new Date(ts)
    const key = weekday(d)
    const target = d >= thisWeekStart ? thisWeek : lastWeek
    target.set(key, (target.get(key) ?? 0) + 1)
  }
  const productViews = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"].map((day) => ({
    day,
    thisWeek: thisWeek.get(day) ?? 0,
    lastWeek: lastWeek.get(day) ?? 0,
  }))

  // Top sold items: read recent order_items and aggregate client-side (fast + bounded).
  const topSoldItems = await safe(async () => {
    const client = getSupabaseAdmin()
    let itemRows: Array<Record<string, unknown>> = []
    for (const table of ORDER_ITEM_TABLES) {
      const attempts = [
        () => client.from(table).select("productId,quantity").limit(2000),
        () => client.from(table).select("product_id,quantity").limit(2000),
        () => client.from(table).select("productId,qty").limit(2000),
        () => client.from(table).select("product_id,qty").limit(2000),
        () => client.from(table).select("productId,units").limit(2000),
        () => client.from(table).select("product_id,units").limit(2000),
      ]
      for (const run of attempts) {
        const { data, error } = await run()
        if (!error && Array.isArray(data) && data.length) {
          itemRows = data as Array<Record<string, unknown>>
          break
        }
      }
      if (itemRows.length) break
    }
    const counts = new Map<string, number>()
    for (const r of itemRows) {
      const pid = safeString(r.productId ?? r.product_id)
      const qty = Number(r.quantity ?? r.qty ?? r.units ?? 0)
      if (!pid || !Number.isFinite(qty) || qty <= 0) continue
      counts.set(pid, (counts.get(pid) ?? 0) + qty)
    }
    const sorted = Array.from(counts.entries()).sort((a, b) => b[1] - a[1]).slice(0, 5)
    const ids = sorted.map(([id]) => id)
    const names = new Map<string, string>()
    if (ids.length) {
      for (const pt of PRODUCT_TABLES) {
        const { data, error } = await client.from(pt).select("id,name,title").in("id", ids)
        if (!error && Array.isArray(data)) {
          for (const p of data as Array<Record<string, unknown>>) {
            const id = safeString(p.id)
            const name = safeString(p.name ?? p.title)
            if (id) names.set(id, name)
          }
          break
        }
      }
    }
    const max = sorted[0]?.[1] ?? 1
    return sorted.map(([productId, qty]) => ({
      productId,
      name: names.get(productId) ?? productId.slice(0, 8),
      percent: Math.round((qty / max) * 100),
      units: qty,
    }))
  }, [])

  return {
    totalCustomers: totalUsers,
    totalProducts,
    totalOrders,
    totalSales,
    pendingOrders,
    recentOrders,
    lowStockVariants,
    salesTrend,
    productViews,
    topSoldItems,
  }
}
