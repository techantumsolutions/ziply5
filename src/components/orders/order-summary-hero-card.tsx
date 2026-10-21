"use client"

import type { ReactNode } from "react"
import { Download } from "lucide-react"
import type { CustomerOrderDetail } from "@/src/lib/orders/customer-order-detail"
import { formatInvoiceNumber } from "@/lib/invoice"
import { formatOrderDateTime } from "@/src/lib/datetime"

type Props = {
  order: CustomerOrderDetail
  paymentStatus: string
  onDownloadInvoice: () => void
  invoiceAvailable?: boolean
  downloadingInvoice?: boolean
  extraActions?: ReactNode
  orderLifecycleStatus?: string | null
}

function statusBadgeClass(label: string) {
  const s = label.toLowerCase()
  if (s.includes("delivered")) return "bg-emerald-50 text-emerald-800 ring-emerald-200"
  if (s.includes("failed") || s.includes("lost") || s.includes("reject") || s.includes("cancel")) return "bg-red-50 text-red-700 ring-red-200"
  if (s.includes("rto")) return "bg-amber-50 text-amber-900 ring-amber-200"
  if (s.includes("out for")) return "bg-sky-50 text-sky-900 ring-sky-200"
  if (s.includes("transit") || s.includes("picked") || s.includes("shipped")) return "bg-indigo-50 text-indigo-900 ring-indigo-200"
  if (s.includes("awb")) return "bg-violet-50 text-violet-900 ring-violet-200"
  return "bg-[#F3F4F6] text-[#374151] ring-[#E5E7EB]"
}

function prettyStatus(value: string) {
  if (value.toLowerCase() === "confirmed") return "Accepted"
  return value.replaceAll("_", " ").replace(/\b\w/g, (char) => char.toUpperCase())
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
            const isRejected =
              order.status.toLowerCase() === "rejected" ||
              order.statusHistory?.some((h: any) => h.reasonCode === "admin_rejected" || h.toStatus?.toLowerCase() === "rejected")
            const rawStatus = isRejected ? "rejected" : (orderLifecycleStatus?.trim() || order.status || "")
            const displayStatus = isRejected ? "REJECTED" : prettyStatus(rawStatus).toUpperCase()
            return (
              <span className={`rounded-full px-3 py-1 text-[11px] font-semibold uppercase ring-1 ${statusBadgeClass(rawStatus)}`}>
                {displayStatus}
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
