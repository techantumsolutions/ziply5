"use client"

import type { ReactNode } from "react"
import { Download, RefreshCw } from "lucide-react"
import type { CustomerOrderDetail } from "@/src/lib/orders/customer-order-detail"
import { formatInvoiceNumber } from "@/lib/invoice"

type Props = {
  order: CustomerOrderDetail
  paymentStatus: string
  onDownloadInvoice: () => void
  onSyncOrder?: () => void
  syncingOrder?: boolean
  extraActions?: ReactNode
}

export function OrderSummaryHeroCard({ order, paymentStatus, onDownloadInvoice, onSyncOrder, syncingOrder, extraActions }: Props) {
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
          <p className="mt-1 text-xs text-[#6B7280]">
            Placed on {new Date(order.createdAt).toLocaleDateString("en-GB", { day: "2-digit", month: "short", year: "numeric" })}
          </p>
          <p className="mt-2 text-sm text-[#374151]">
            Payment: <span className="font-semibold uppercase">{paymentStatus}</span>
          </p>
        </div>
        <div className="flex shrink-0 flex-wrap items-center gap-2">
          <span className="rounded-full bg-[#F3F4F6] px-3 py-1 text-[11px] font-semibold uppercase text-[#374151] ring-1 ring-[#E5E7EB]">
            {order.status}
          </span>
          {onSyncOrder ? (
            <button
              type="button"
              onClick={() => void onSyncOrder()}
              disabled={syncingOrder}
              className="flex items-center gap-1.5 rounded-md border border-[#7B3010] bg-white px-3 py-1.5 text-xs font-medium text-[#7B3010] hover:bg-[#FFF7EA] disabled:opacity-50"
            >
              <RefreshCw size={14} className={syncingOrder ? "animate-spin" : ""} />
              Sync Order
            </button>
          ) : null}
          <button
            type="button"
            onClick={() => void onDownloadInvoice()}
            className="flex items-center gap-1.5 rounded-md border border-[#D1D5DB] bg-white px-3 py-1.5 text-xs font-medium text-[#111827] hover:bg-[#F9FAFB]"
          >
            <Download size={14} />
            Invoice
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
