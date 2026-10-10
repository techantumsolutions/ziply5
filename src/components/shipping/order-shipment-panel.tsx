"use client"

import { useMemo, useState } from "react"
import type { OrderTrackingPayload } from "@/src/lib/orders/order-tracking-dto"
import { ShipmentProgressTracker } from "@/src/components/shipping/shipment-progress-tracker"

function formatShortDate(iso: string | null | undefined) {
  if (!iso) return "—"
  const d = new Date(iso)
  if (Number.isNaN(d.getTime())) return "—"
  return d.toLocaleDateString("en-GB", { day: "2-digit", month: "short", year: "numeric" })
}

function formatDateTime(iso: string | null | undefined) {
  if (!iso) return "—"
  const d = new Date(iso)
  if (Number.isNaN(d.getTime())) return "—"
  return d.toLocaleString("en-GB", { day: "2-digit", month: "short", year: "numeric", hour: "2-digit", minute: "2-digit" })
}

function prettyStatus(value: string) {
  return value.replaceAll("_", " ").replace(/\b\w/g, (char) => char.toUpperCase())
}

function statusBadgeClass(label: string) {
  const s = label.toLowerCase()
  if (s.includes("delivered")) return "bg-emerald-50 text-emerald-800 ring-emerald-200"
  if (s.includes("failed") || s.includes("lost")) return "bg-red-50 text-red-800 ring-red-200"
  if (s.includes("cancel")) return "bg-gray-100 text-gray-700 ring-gray-200"
  if (s.includes("rto")) return "bg-amber-50 text-amber-900 ring-amber-200"
  if (s.includes("out for")) return "bg-sky-50 text-sky-900 ring-sky-200"
  if (s.includes("transit") || s.includes("picked")) return "bg-indigo-50 text-indigo-900 ring-indigo-200"
  if (s.includes("awb")) return "bg-violet-50 text-violet-900 ring-violet-200"
  if (s.includes("preparing")) return "bg-stone-100 text-stone-700 ring-stone-200"
  return "bg-[#FDF0E6] text-[#7B3010] ring-[#E8DCC8]"
}

type Props = {
  tracking: OrderTrackingPayload | undefined
  isLoading: boolean
  error: Error | null
  onRefreshFromShiprocket: () => Promise<void>
  orderLifecycleStatus?: string | null
}

const ACTIVITY_PAGE = 25

export function OrderShipmentPanel(props: Props) {
  const { tracking, isLoading, error, onRefreshFromShiprocket, orderLifecycleStatus } = props
  const [activityLimit, setActivityLimit] = useState(ACTIVITY_PAGE)
  const [refreshBusy, setRefreshBusy] = useState(false)

  const shipment = tracking?.shipment
  const deliveryComplete = useMemo(() => shipment?.deliveredAt ?? null, [shipment?.deliveredAt])

  const handleRefresh = async () => {
    setRefreshBusy(true)
    try {
      await onRefreshFromShiprocket()
    } finally {
      setRefreshBusy(false)
    }
  }

  if (isLoading) {
    return (
      <div className="animate-pulse space-y-4 rounded-2xl border border-[#E8DCC8] bg-white p-4 shadow-sm">
        <div className="h-4 w-40 rounded bg-[#F2E6DD]" />
        <div className="h-24 rounded-lg bg-[#FFFBF7]" />
        <div className="h-32 rounded-lg bg-[#FFFBF7]" />
      </div>
    )
  }

  if (error) {
    return (
      <div className="rounded-2xl border border-red-200 bg-red-50/80 p-4 text-sm text-red-800 shadow-sm">
        <p className="font-semibold">Could not load shipment tracking</p>
        <p className="mt-1 text-red-700/90">{error.message}</p>
        <button
          type="button"
          onClick={() => void handleRefresh()}
          disabled={refreshBusy}
          className="mt-3 rounded-full border border-red-300 bg-white px-4 py-2 text-xs font-semibold uppercase text-red-900 disabled:opacity-50"
        >
          {refreshBusy ? "Retrying…" : "Retry"}
        </button>
      </div>
    )
  }

  if (!tracking) return null

  const awb = shipment?.awbCode ?? tracking.orderSnapshot.awbCode
  const courier = shipment?.courierName ?? tracking.orderSnapshot.courierName
  const trackUrl = shipment?.trackingUrl ?? tracking.orderSnapshot.trackingUrl
  const noShipmentYet = !tracking.shipment && !tracking.orderSnapshot.shipmentId && !awb
  const orderStatusLabel = orderLifecycleStatus?.trim()
    ? prettyStatus(orderLifecycleStatus.trim())
    : tracking.uiStatusLabel

  return (
    <div className="space-y-4">
      <div className="rounded-2xl border border-[#E8DCC8] bg-white p-4 shadow-sm">
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div>
            <h2 className="text-sm font-semibold uppercase tracking-[0.15em] text-[#4A1D1F]">Shipment summary</h2>
            <p className="mt-1 text-xs text-[#646464]">
              Order status: <span className="font-semibold text-[#2A1810]">{orderStatusLabel}</span>
            </p>
          </div>
          <div className="flex flex-wrap items-center gap-2">
            <span
              className={`inline-flex items-center rounded-full px-3 py-1 text-[10px] font-semibold uppercase ring-1 ring-inset ${statusBadgeClass(orderStatusLabel)}`}
            >
              {orderStatusLabel}
            </span>
            {tracking.isDelayed ? (
              <span className="rounded-full bg-amber-100 px-2.5 py-1 text-[10px] font-semibold uppercase text-amber-900 ring-1 ring-amber-200">
                Delayed
              </span>
            ) : null}
          </div>
        </div>

        {noShipmentYet ? (
          <p className="mt-4 text-sm text-[#646464]">Preparing shipment — tracking details will appear once your order is dispatched.</p>
        ) : (
          <dl className="mt-4 grid gap-3 text-sm sm:grid-cols-2">
            <div>
              <dt className="text-[11px] font-semibold uppercase tracking-wide text-[#8A6A52]">Courier</dt>
              <dd className="text-[#2A1810]">{courier ?? "—"}</dd>
            </div>
            <div>
              <dt className="text-[11px] font-semibold uppercase tracking-wide text-[#8A6A52]">AWB</dt>
              <dd className="font-mono text-xs text-[#2A1810]">{awb ?? "Pending"}</dd>
            </div>
            <div>
              <dt className="text-[11px] font-semibold uppercase tracking-wide text-[#8A6A52]">Tracking number</dt>
              <dd className="font-mono text-xs text-[#2A1810]">{shipment?.trackingNo ?? awb ?? "—"}</dd>
            </div>
            <div>
              <dt className="text-[11px] font-semibold uppercase tracking-wide text-[#8A6A52]">Shiprocket shipment ID</dt>
              <dd className="font-mono text-xs text-[#2A1810]">{shipment?.shiprocketShipmentId ?? "—"}</dd>
            </div>
            <div>
              <dt className="text-[11px] font-semibold uppercase tracking-wide text-[#8A6A52]">Estimated delivery</dt>
              <dd className="font-semibold text-[#2A1810]">{formatShortDate(tracking.estimatedDeliveryDate)}</dd>
            </div>
            <div>
              <dt className="text-[11px] font-semibold uppercase tracking-wide text-[#8A6A52]">Pickup / shipped</dt>
              <dd className="text-[#646464]">
                Pickup: {formatShortDate(shipment?.pickupDate)} · Shipped: {formatShortDate(shipment?.shippedAt)}
              </dd>
            </div>
            <div className="sm:col-span-2">
              <dt className="text-[11px] font-semibold uppercase tracking-wide text-[#8A6A52]">Delivered</dt>
              <dd className="text-[#2A1810]">{formatShortDate(deliveryComplete)}</dd>
            </div>
            <div className="sm:col-span-2">
              <dt className="text-[11px] font-semibold uppercase tracking-wide text-[#8A6A52]">Last synced</dt>
              <dd className="text-[#646464]">{formatDateTime(shipment?.lastTrackingSyncAt ?? tracking.orderSnapshot.lastTrackingSyncAt)}</dd>
            </div>
          </dl>
        )}

        <div className="mt-4 flex flex-wrap gap-2">
          <button
            type="button"
            onClick={() => void handleRefresh()}
            disabled={refreshBusy || tracking.isTerminal || !awb}
            className="rounded-full border border-[#E8DCC8] bg-white px-4 py-2 text-xs font-semibold uppercase text-[#4A1D1F] disabled:opacity-40"
            title={!awb ? "AWB not assigned yet" : tracking.isTerminal ? "Shipment is complete" : "Refresh from courier"}
          >
            {refreshBusy ? "Refreshing…" : "Refresh tracking"}
          </button>
          {trackUrl ? (
            <button
              type="button"
              onClick={() => window.open(trackUrl, "_blank", "noopener,noreferrer")}
              className="rounded-full border border-[#E8DCC8] bg-[#5A272A] px-4 py-2 text-xs font-semibold uppercase text-white"
            >
              Open courier tracking
            </button>
          ) : null}
        </div>
      </div>

      {!noShipmentYet && (
        <div className="rounded-2xl border border-[#E8DCC8] bg-white p-4 shadow-sm">
          <h2 className="mb-3 text-sm font-semibold uppercase tracking-[0.15em] text-[#4A1D1F]">Shipment progress</h2>
          <ShipmentProgressTracker activeIndex={tracking.progressIndex} />
        </div>
      )}

      <div className="rounded-2xl border border-[#E8DCC8] bg-white p-4 shadow-sm">
        <h2 className="mb-2 text-sm font-semibold uppercase tracking-[0.15em] text-[#4A1D1F]">Latest update</h2>
        {tracking.latestActivity?.message ? (
          <p className="text-sm text-[#2A1810]">{tracking.latestActivity.message}</p>
        ) : noShipmentYet ? (
          <p className="text-sm text-[#646464]">Tracking updates will appear soon.</p>
        ) : (
          <p className="text-sm text-[#646464]">No scan activity recorded yet — try refresh in a few minutes.</p>
        )}
        {tracking.latestActivity?.at ? (
          <p className="mt-1 text-xs text-[#646464]">
            {formatDateTime(tracking.latestActivity.at)}
            {tracking.latestActivity.location ? ` · ${tracking.latestActivity.location}` : ""}
          </p>
        ) : null}
      </div>

      {/* <div className="rounded-2xl border border-[#E8DCC8] bg-white p-4 shadow-sm">
        <h2 className="mb-2 text-sm font-semibold uppercase tracking-[0.15em] text-[#4A1D1F]">Delivery estimates</h2>
        <ul className="space-y-1 text-sm text-[#646464]">
          <li>
            <span className="font-semibold text-[#2A1810]">Estimated delivery: </span>
            {formatShortDate(tracking.estimatedDeliveryDate)}
          </li>
          <li>
            <span className="font-semibold text-[#2A1810]">Courier SLA (days): </span>
            {tracking.courierEtaDays != null ? String(tracking.courierEtaDays) : "—"}
          </li>
          {tracking.isDelayed ? (
            <li className="text-amber-800">This shipment appears delayed versus the estimated delivery date.</li>
          ) : null}
        </ul>
      </div> */}

      {(shipment?.origin || shipment?.destination) && (
        <div className="rounded-2xl border border-[#E8DCC8] bg-white p-4 shadow-sm">
          <h2 className="mb-2 text-sm font-semibold uppercase tracking-[0.15em] text-[#4A1D1F]">Route</h2>
          <p className="text-sm text-[#646464]">
            <span className="font-semibold text-[#2A1810]">From: </span>
            {shipment?.origin ?? "—"}
          </p>
          <p className="text-sm text-[#646464]">
            <span className="font-semibold text-[#2A1810]">To: </span>
            {shipment?.destination ?? "—"}
          </p>
        </div>
      )}

      {/* <div className="rounded-2xl border border-[#E8DCC8] bg-white p-4 shadow-sm">
        <h2 className="mb-3 text-sm font-semibold uppercase tracking-[0.15em] text-[#4A1D1F]">Tracking timeline</h2>
        {tracking.activities.length === 0 ? (
          <p className="text-sm text-[#646464]">No tracking history yet.</p>
        ) : (
          <ul className="space-y-3">
            {tracking.activities.slice(0, activityLimit).map((ev) => (
              <li key={ev.id} className="border-l-2 border-[#E8DCC8] pl-3">
                <p className="text-sm font-medium text-[#2A1810]">{ev.message ?? ev.status ?? "Update"}</p>
                {ev.status && ev.message && ev.status !== ev.message ? (
                  <p className="text-[11px] uppercase tracking-wide text-[#8A6A52]">{ev.status}</p>
                ) : null}
                <p className="text-xs text-[#646464]">
                  {formatDateTime(ev.at)}
                  {ev.location ? ` · ${ev.location}` : ""}
                </p>
              </li>
            ))}
          </ul>
        )}
        {tracking.activities.length > activityLimit ? (
          <button
            type="button"
            className="mt-3 text-xs font-semibold uppercase text-[#7B3010] underline"
            onClick={() => setActivityLimit((n) => n + ACTIVITY_PAGE)}
          >
            Load more
          </button>
        ) : null}
      </div> */}
    </div>
  )
}
