"use client"

import type { CustomerOrderDetail } from "@/src/lib/orders/customer-order-detail"
import { formatOrderDateTime, toUtcIso } from "@/src/lib/datetime"

const pretty = (value: string) => value.replaceAll("_", " ").replace(/\b\w/g, (c) => c.toUpperCase())

type Props = {
  statusHistory: CustomerOrderDetail["statusHistory"]
  className?: string
}

export function OrderStatusHistoryCard({ statusHistory, className = "" }: Props) {
  if (!statusHistory?.length) {
    return (
      <div className={`rounded-xl border border-[#E5E7EB] bg-white p-4 ${className}`}>
        <h2 className="mb-2 text-sm font-semibold text-[#111827]">Order status history</h2>
        <p className="text-sm text-[#6B7280]">No status changes recorded yet.</p>
      </div>
    )
  }

  return (
    <div className={`rounded-xl border border-[#E5E7EB] bg-white p-4 ${className}`}>
      <h2 className="mb-3 text-sm font-semibold text-[#111827]">Order status history</h2>
      <ul className="max-h-[min(24rem,50vh)] space-y-3 overflow-y-auto pr-1">
        {[...statusHistory]
          .sort((a, b) => new Date(toUtcIso(b.changedAt) ?? 0).getTime() - new Date(toUtcIso(a.changedAt) ?? 0).getTime())
          .map((entry) => {
            const isRejected = (entry as any).reasonCode === "admin_rejected" || entry.toStatus.toLowerCase() === "rejected"
            const label = isRejected ? "Rejected" : pretty(entry.toStatus)
            return (
              <li key={`${entry.toStatus}-${entry.changedAt}`} className={`border-l-2 pl-3 ${isRejected ? "border-red-500" : "border-[#22C55E]"}`}>
                <p className={`text-sm font-medium ${isRejected ? "text-red-700" : "text-[#111827]"}`}>{label}</p>
                <p className="text-xs text-[#6B7280]">{formatOrderDateTime(entry.changedAt)}</p>
                {(entry as any).notes && <p className="mt-0.5 text-xs text-red-600 font-medium">Reason: {(entry as any).notes}</p>}
              </li>
            )
          })}
      </ul>
    </div>
  )
}
