"use client"

import { Check } from "lucide-react"

const STEPS = [
  { id: 1, label: "Basic Info", hint: "Product details" },
  { id: 2, label: "Media & Content", hint: "Images & description" },
  { id: 3, label: "Pricing & Inventory", hint: "Variants & stock" },
  { id: 4, label: "SEO & Channels", hint: "Search & links" },
  { id: 5, label: "Review & Publish", hint: "Check & submit" },
] as const

export type ProductFormStepId = (typeof STEPS)[number]["id"]

export const PRODUCT_FORM_STEPS = STEPS
export const PRODUCT_FORM_STEP_COUNT = STEPS.length

export function ProductFormStepper({
  currentStep,
  onStepClick,
}: {
  currentStep: number
  onStepClick?: (step: ProductFormStepId) => void
}) {
  return (
    <nav aria-label="Product form steps" className="w-full overflow-x-auto pb-1">
      <ol className="flex min-w-[720px] items-center gap-1">
        {STEPS.map((step, index) => {
          const active = currentStep === step.id
          const completed = currentStep > step.id
          const clickable = Boolean(onStepClick) && (completed || active)
          return (
            <li key={step.id} className="flex flex-1 items-center gap-1">
              <button
                type="button"
                disabled={!clickable}
                onClick={() => onStepClick?.(step.id)}
                className={`flex w-full items-center gap-2 rounded-xl border px-2.5 py-2 text-left transition ${
                  active
                    ? "border-[#7B3010] bg-[#FFF7ED] shadow-sm"
                    : completed
                      ? "border-[#E8DCC8] bg-[#FFFBF3]"
                      : "border-[#E8DCC8] bg-white opacity-70"
                } ${clickable ? "cursor-pointer" : "cursor-default"}`}
              >
                <span
                  className={`flex h-7 w-7 shrink-0 items-center justify-center rounded-full text-xs font-bold ${
                    active
                      ? "bg-[#7B3010] text-white"
                      : completed
                        ? "bg-[#7B3010] text-white"
                        : "bg-[#F5F1E6] text-[#646464]"
                  }`}
                >
                  {completed ? <Check className="h-3.5 w-3.5" strokeWidth={3} /> : step.id}
                </span>
                <span className="min-w-0">
                  <span
                    className={`block text-[11px] font-semibold uppercase leading-tight tracking-wide ${
                      active ? "text-[#7B3010]" : "text-[#4A1D1F]"
                    }`}
                  >
                    {step.label}
                  </span>
                  <span
                    className={`mt-0.5 block text-[10px] font-normal normal-case tracking-normal ${
                      active ? "text-[#9A5A3A]" : "text-[#8A8A82]"
                    }`}
                  >
                    {step.hint}
                  </span>
                </span>
              </button>
              {index < STEPS.length - 1 ? (
                <span className="hidden h-px w-3 shrink-0 bg-[#E8DCC8] sm:block" aria-hidden />
              ) : null}
            </li>
          )
        })}
      </ol>
    </nav>
  )
}
