import { env } from "@/src/server/core/config/env"
import { pgQuery, pgTx } from "@/src/server/db/pg"
import { codPaymentReferenceId } from "@/src/server/modules/payments/cod-payment-link"

type CodLinkRow = {
  id: string
  total: string | number
  currency: string | null
  paymentMethod: string | null
  paymentStatus: string | null
  paymentId: string | null
  status: string | null
  customerName: string | null
  customerPhone: string | null
  customerEmail: string | null
  codPaymentLinkId: string | null
  codPaymentLinkUrl: string | null
}

const razorpayAuth = () => {
  if (!env.RAZORPAY_KEY_ID || !env.RAZORPAY_KEY_SECRET) {
    throw new Error("Razorpay keys are not configured")
  }
  return Buffer.from(`${env.RAZORPAY_KEY_ID}:${env.RAZORPAY_KEY_SECRET}`).toString("base64")
}

const callbackUrl = (orderId: string) => {
  const base = (process.env.NEXT_PUBLIC_APP_URL || process.env.NEXT_PUBLIC_SITE_URL || "https://ziply5.com").replace(/\/$/, "")
  if (!base.startsWith("https://")) return undefined
  return `${base}/orders/${orderId}`
}

const contactForRazorpay = (phone: string | null) => {
  const digits = String(phone ?? "").replace(/\D/g, "")
  if (digits.length === 10) return `91${digits}`
  if (digits.length >= 8 && digits.length <= 15) return digits
  return ""
}

const loadLinkRow = async (orderId: string, client?: { query: (text: string, values?: unknown[]) => Promise<{ rows: CodLinkRow[] }> }) => {
  const sql = `
    SELECT id, total, currency, "paymentMethod", "paymentStatus", "paymentId", status,
           "customerName", "customerPhone", "customerEmail", "codPaymentLinkId", "codPaymentLinkUrl"
    FROM "Order" WHERE id = $1`
  if (client) {
    const res = await client.query(sql, [orderId])
    return res.rows[0] ?? null
  }
  const rows = await pgQuery<CodLinkRow[]>(sql, [orderId])
  return rows[0] ?? null
}

const payable = (row: CodLinkRow) => {
  const method = String(row.paymentMethod ?? "").toLowerCase()
  const payment = String(row.paymentStatus ?? "").toUpperCase()
  const status = String(row.status ?? "").toLowerCase()
  return method === "cod" && payment !== "SUCCESS" && status !== "cancelled"
}

const createRazorpayLink = async (row: CodLinkRow) => {
  const amount = Math.round(Number(row.total) * 100)
  if (!Number.isFinite(amount) || amount < 100) {
    throw new Error("Order total is too small for a payment link")
  }
  const contact = contactForRazorpay(row.customerPhone)
  const email = String(row.customerEmail ?? "").trim()
  const customer: Record<string, string> = { name: row.customerName?.trim() || "Customer" }
  if (contact) customer.contact = contact
  if (email.includes("@")) customer.email = email
  const payload: Record<string, unknown> = {
    amount,
    currency: row.currency || "INR",
    accept_partial: false,
    reference_id: codPaymentReferenceId(row.id),
    description: `Ziply5 order ${row.id.slice(0, 8)}`,
    customer,
    notify: { sms: false, email: false },
    reminder_enable: false,
    notes: { orderId: row.id, purpose: "cod_collection" },
    expire_by: Math.floor(Date.now() / 1000) + 60 * 24 * 60 * 60,
  }
  const callback = callbackUrl(row.id)
  if (callback) {
    payload.callback_url = callback
    payload.callback_method = "get"
  }
  const res = await fetch("https://api.razorpay.com/v1/payment_links", {
    method: "POST",
    headers: {
      Authorization: `Basic ${razorpayAuth()}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify(payload),
  })
  const json = (await res.json().catch(() => null)) as { id?: string; short_url?: string; error?: { description?: string } } | null
  if (!res.ok || !json?.id || !json.short_url) {
    throw new Error(json?.error?.description || "Could not create the COD payment link")
  }
  return { id: json.id, url: json.short_url }
}

export const ensureCodPaymentLink = async (orderId: string) => {
  return pgTx(async (client) => {
    const locked = await client.query<CodLinkRow>(
      `SELECT id, total, currency, "paymentMethod", "paymentStatus", "paymentId", status,
              "customerName", "customerPhone", "customerEmail", "codPaymentLinkId", "codPaymentLinkUrl"
       FROM "Order" WHERE id = $1 FOR UPDATE`,
      [orderId],
    )
    const row = locked.rows[0]
    if (!row || !payable(row)) return null
    if (row.codPaymentLinkId && row.codPaymentLinkUrl) {
      const remote = await fetch(`https://api.razorpay.com/v1/payment_links/${row.codPaymentLinkId}`, {
        headers: { Authorization: `Basic ${razorpayAuth()}` },
      })
      const json = (await remote.json().catch(() => null)) as {
        status?: string
        amount_paid?: number
        payments?: Array<{ payment_id?: string; status?: string }>
      } | null
      const captured = json?.payments?.find((payment) => payment.payment_id && payment.status !== "failed")
      if (json?.status === "paid" && captured?.payment_id) {
        const paidMinor = Number(json.amount_paid ?? 0)
        const expected = Math.round(Number(row.total) * 100)
        if (paidMinor === expected) {
          await client.query(
            `UPDATE "Order"
             SET "paymentStatus" = 'SUCCESS', "paymentId" = $2, "updatedAt" = now()
             WHERE id = $1 AND COALESCE("paymentStatus", '') <> 'SUCCESS'`,
            [orderId, captured.payment_id],
          )
          await client.query(
            `UPDATE "Transaction" SET status = 'paid', "externalId" = COALESCE("externalId", $2)
             WHERE "orderId" = $1 AND lower(status) <> 'paid'`,
            [orderId, captured.payment_id],
          ).catch(() => null)
        }
        return { paid: true as const }
      }
      return { id: row.codPaymentLinkId, url: row.codPaymentLinkUrl }
    }
    const created = await createRazorpayLink(row)
    const saved = await client.query(
      `UPDATE "Order"
       SET "codPaymentLinkId" = $2, "codPaymentLinkUrl" = $3, "updatedAt" = now()
       WHERE id = $1 AND "codPaymentLinkId" IS NULL`,
      [orderId, created.id, created.url],
    )
    if ((saved.rowCount ?? 0) === 0) {
      await fetch(`https://api.razorpay.com/v1/payment_links/${created.id}/cancel`, {
        method: "POST",
        headers: { Authorization: `Basic ${razorpayAuth()}` },
      }).catch(() => null)
      const current = await loadLinkRow(orderId, client)
      if (current?.codPaymentLinkId && current.codPaymentLinkUrl) {
        return { id: current.codPaymentLinkId, url: current.codPaymentLinkUrl }
      }
      return null
    }
    await client.query(
      `UPDATE "Transaction"
       SET "externalId" = $2
       WHERE id = (
         SELECT id FROM "Transaction"
         WHERE "orderId" = $1 AND lower(gateway) = 'cod' AND ("externalId" IS NULL OR "externalId" = '')
         ORDER BY "createdAt" DESC LIMIT 1
       )`,
      [orderId, created.id],
    ).catch(() => null)
    return created
  })
}

export const cancelCodPaymentLink = async (orderId: string) => {
  const row = await loadLinkRow(orderId)
  if (!row?.codPaymentLinkId) return
  if (String(row.paymentStatus ?? "").toUpperCase() === "SUCCESS") return
  await fetch(`https://api.razorpay.com/v1/payment_links/${row.codPaymentLinkId}/cancel`, {
    method: "POST",
    headers: { Authorization: `Basic ${razorpayAuth()}` },
  }).catch(() => null)
}

export const refundRazorpayPayment = async (paymentId: string) => {
  if (!paymentId.startsWith("pay_")) return false
  const res = await fetch(`https://api.razorpay.com/v1/payments/${paymentId}/refund`, {
    method: "POST",
    headers: {
      Authorization: `Basic ${razorpayAuth()}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({}),
  })
  return res.ok
}
