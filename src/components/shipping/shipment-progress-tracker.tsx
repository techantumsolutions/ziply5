"use client"

import { Check } from "lucide-react"
import { SHIPMENT_UI_STEPS } from "@/src/lib/shipping/shipment-ui-constants"

type Props = {
  /** Highest completed step index (0..5), or -1 when unknown / pre-shipment */
  activeIndex: number
}

export function ShipmentProgressTracker({ activeIndex }: Props) {
  const effective = activeIndex < 0 ? -1 : Math.min(activeIndex, SHIPMENT_UI_STEPS.length - 1)

  return (
    <div className="overflow-x-auto pb-1">
      <div className="flex min-w-[min(100%,520px)] items-start justify-between gap-0.5 sm:min-w-0 sm:gap-1">
        {SHIPMENT_UI_STEPS.map((step, idx) => {
          const reached = effective >= 0 && idx <= effective
          const current = effective >= 0 && idx === effective
          return (
            <div key={step.key} className="flex min-w-0 flex-1 flex-col items-center gap-1 text-center">
              <div
                className={`flex h-7 w-7 shrink-0 items-center justify-center rounded-full text-[10px] font-bold transition-colors ${
                  reached ? "bg-[#2DA66D] text-white" : "bg-[#E5E7EB] text-[#9CA3AF]"
                } ${current ? "ring-2 ring-[#7B3010] ring-offset-2 ring-offset-white" : ""}`}
              >
                {reached ? <Check className="h-3.5 w-3.5 stroke-[3]" /> : idx + 1}
              </div>
              <span
                className={`max-w-[4.5rem] text-[9px] uppercase leading-tight sm:max-w-none sm:text-[10px] ${
                  reached ? "font-semibold text-[#2A1810]" : "text-[#9CA3AF]"
                }`}
              >
                {step.label}
              </span>
            </div>
          )
        })}
      </div>
    </div>
  )
}
