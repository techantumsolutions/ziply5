"use client"

import type { ReactNode } from "react"
import { Download } from "lucide-react"
import type { CustomerOrderDetail } from "@/src/lib/orders/customer-order-detail"
import { formatInvoiceNumber } from "@/lib/invoice"
import { formatOrderDateTime } from "@/src/lib/datetime"

import { resolveCanonicalOrderStatus } from "@/src/lib/orders/manual-order-status"

type Props = {
  order: CustomerOrderDetail
  paymentStatus: string
  onDownloadInvoice: () => void
  invoiceAvailable?: boolean
  downloadingInvoice?: boolean
  extraActions?: ReactNode
  orderLifecycleStatus?: string | null
}

export function OrderSummaryHeroCard({
  order,
  paymentStatus,
  onDownloadInvoice,
  invoiceAvailable = true,
  downloadingInvoice = false,
  extraActions,
  orderLifecycleStatus,
}: Props) {
  const invoiceNo = formatInvoiceNumber(order.id, order.createdAt)

  return (
    <div className="rounded-xl border border-[#E5E7EB] bg-white p-4 shadow-sm">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div className="min-w-0">
          <p className="text-xs font-medium uppercase tracking-wide text-[#6B7280]">Order ID & Invoice</p>
          <p className="font-mono text-sm font-semibold text-[#111827] break-all" title={order.id}>
            {order.id}
          </p>
          <p className="mt-0.5 text-xs text-[#374151]">
            Invoice No: <code className="font-mono font-semibold text-[#7B3010]">{invoiceNo}</code>
          </p>
          <p className="mt-0.5 text-xs text-[#374151]">
            Order ID: <code className="font-mono font-semibold text-[#7B3010]">#{order.id.slice(0, 10).toUpperCase()}</code>
          </p>
          <p className="mt-1 text-xs text-[#6B7280]">
            Placed on {formatOrderDateTime(order.createdAt)}
          </p>
          <p className="mt-2 text-sm text-[#374151]">
            Payment: <span className="font-semibold uppercase">{paymentStatus}</span>
          </p>
        </div>
        <div className="flex shrink-0 flex-wrap items-center gap-2">
          {(() => {
            const canonical = resolveCanonicalOrderStatus(orderLifecycleStatus || order.status, order.statusHistory)
            const badgeClass =
              canonical === "rejected"
                ? "bg-red-50 text-red-700 ring-red-200"
                : canonical === "cancelled"
                  ? "bg-gray-100 text-gray-700 ring-gray-200"
                  : canonical === "accepted"
                    ? "bg-emerald-50 text-emerald-800 ring-emerald-200"
                    : "bg-amber-50 text-amber-800 ring-amber-200"
            return (
              <span className={`rounded-full px-3 py-1 text-[11px] font-semibold uppercase ring-1 ${badgeClass}`}>
                {canonical.toUpperCase()}
              </span>
            )
          })()}
          <button
            type="button"
            onClick={() => void onDownloadInvoice()}
            disabled={!invoiceAvailable || downloadingInvoice}
            title={invoiceAvailable ? "Download invoice" : "Available after the order is shipped"}
            className="flex items-center gap-1.5 rounded-md border border-[#D1D5DB] bg-white px-3 py-1.5 text-xs font-medium text-[#111827] hover:bg-[#F9FAFB] disabled:cursor-not-allowed disabled:opacity-50"
          >
            <Download size={14} />
            {downloadingInvoice ? "Downloading…" : "Invoice"}
          </button>
          <button
            type="button"
            onClick={() => window.print()}
            className="rounded-md border border-[#D1D5DB] bg-white px-3 py-1.5 text-xs font-medium text-[#111827] hover:bg-[#F9FAFB]"
          >
            Print
          </button>
        </div>
      </div>
      {extraActions ? <div className="mt-4 flex flex-wrap gap-2 border-t border-[#F3F4F6] pt-4">{extraActions}</div> : null}
    </div>
  )
}
