"use client"

type TrackingStep = {
  key: string
  label: string
  reached: boolean
  at?: string | null
}

const toLabel = (value: string) => value.replaceAll("_", " ").replace(/\b\w/g, (c) => c.toUpperCase())

export function TrackingTimeline(props: {
  orderStatus?: string | null
  shipmentStatus?: string | null
  statusHistory?: Array<{ toStatus?: string; changedAt?: string }>
}) {
  const history = props.statusHistory ?? []
  const reached = new Set(history.map((step) => String(step.toStatus ?? "").toLowerCase()))
  const shipmentStatus = String(props.shipmentStatus ?? "").toLowerCase()
  const orderStatus = String(props.orderStatus ?? "").toLowerCase()

  const pickupGenerated = shipmentStatus.includes("pickup")
  const shipped = ["shipped", "in_transit", "out_for_delivery", "delivered"].includes(orderStatus) || ["shipped", "in_transit", "out_for_delivery", "delivered"].includes(shipmentStatus)
  const steps: TrackingStep[] = [
    { key: "confirmed", label: "Order Confirmed", reached: reached.has("confirmed") || orderStatus === "confirmed" },
    {
      key: "pickup_generated",
      label: "Pickup Generated",
      reached: pickupGenerated,
    },
    { key: "shipped", label: "Shipped", reached: shipped || reached.has("shipped") },
    { key: "in_transit", label: "In Transit", reached: shipmentStatus.includes("transit") },
    { key: "out_for_delivery", label: "Out For Delivery", reached: shipmentStatus.includes("out_for_delivery") || shipmentStatus.includes("out for delivery") },
    { key: "delivered", label: "Delivered", reached: reached.has("delivered") || orderStatus === "delivered" || shipmentStatus.includes("delivered") },
  ]

  return (
    <div className="space-y-2">
      {steps.map((step) => (
        <div key={step.key} className="flex items-center gap-2 rounded-lg border border-[#F2E6DD] bg-[#FFFBF7] px-3 py-2 text-xs">
          <span className={`inline-flex h-2.5 w-2.5 rounded-full ${step.reached ? "bg-[#2DA66D]" : "bg-[#CFCFC7]"}`} />
          <span className={step.reached ? "font-semibold text-[#2A1810]" : "text-[#646464]"}>{step.label}</span>
          {step.at ? <span className="ml-auto text-[#646464]">{toLabel(step.at)}</span> : null}
        </div>
      ))}
    </div>
  )
}
