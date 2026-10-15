export type PackageMeasures = {
  weightKg: number
  lengthCm: number
  widthCm: number
  heightCm: number
}

export type PackageMeasureReview = {
  ok: boolean
  missing: boolean
  requiresConfirmation: boolean
  reason: string | null
}

const finite = (value: number) => Number.isFinite(value) && value > 0

/** Centimetres and kilograms pass through. No unit scaling. */
export const shiprocketPackagePayload = (input: PackageMeasures) => ({
  weight: input.weightKg,
  length: input.lengthCm,
  breadth: input.widthCm,
  height: input.heightCm,
})

export const packageQuoteKey = (input: {
  weightKg: number | null
  lengthCm: number | null
  widthCm: number | null
  heightCm: number | null
}) => [input.weightKg, input.lengthCm, input.widthCm, input.heightCm].join("|")

export const assessPackageMeasures = (input: PackageMeasures): PackageMeasureReview => {
  if (![input.weightKg, input.lengthCm, input.widthCm, input.heightCm].every(finite)) {
    return {
      ok: false,
      missing: true,
      requiresConfirmation: false,
      reason: "Enter the package weight in kilograms and the length, width, and height in centimetres.",
    }
  }
  if (input.weightKg > 30 || input.lengthCm > 200 || input.widthCm > 200 || input.heightCm > 200) {
    return {
      ok: false,
      missing: false,
      requiresConfirmation: false,
      reason: "Weight must be at most 30 kg and each side at most 200 cm.",
    }
  }
  const litres = (input.lengthCm * input.widthCm * input.heightCm) / 1000
  const longestCm = Math.max(input.lengthCm, input.widthCm, input.heightCm)
  if (longestCm >= 100 || (litres >= 50 && input.weightKg <= 5)) {
    return {
      ok: true,
      missing: false,
      requiresConfirmation: true,
      reason: `These dimensions are ${input.lengthCm} × ${input.widthCm} × ${input.heightCm} cm for a ${input.weightKg} kg package. Confirm that the measurements are centimetres before Shiprocket prices this shipment.`,
    }
  }
  return { ok: true, missing: false, requiresConfirmation: false, reason: null }
}

export const awbQuoteWarning = (input: {
  weightKg: number | null
  lengthCm: number | null
  widthCm: number | null
  heightCm: number | null
  chargeableKg: number | null
}) => {
  if (input.lengthCm == null || input.widthCm == null || input.heightCm == null || input.weightKg == null) {
    return {
      block: true,
      confirm: false,
      message: "Package weight or dimensions are missing. Enter them in kilograms and centimetres before assigning an AWB.",
    }
  }
  const review = assessPackageMeasures({
    weightKg: input.weightKg,
    lengthCm: input.lengthCm,
    widthCm: input.widthCm,
    heightCm: input.heightCm,
  })
  if (!review.ok) {
    return { block: true, confirm: false, message: review.reason }
  }
  const chargeableAbovePackage =
    input.chargeableKg != null && input.chargeableKg > input.weightKg && input.chargeableKg - input.weightKg >= 1
  if (review.requiresConfirmation || chargeableAbovePackage) {
    const charge =
      input.chargeableKg != null ? ` Shiprocket chargeable weight for this package is ${input.chargeableKg} kg.` : ""
    return {
      block: false,
      confirm: true,
      message: `${review.reason ?? `Saved package is ${input.weightKg} kg and ${input.lengthCm} × ${input.widthCm} × ${input.heightCm} cm.`}${charge}`,
    }
  }
  return { block: false, confirm: false, message: null }
}
