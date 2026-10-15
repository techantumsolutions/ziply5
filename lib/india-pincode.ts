export const INDIAN_PINCODE = /^[1-9]\d{5}$/

export type IndianPincodeDetails = {
  city?: string
  district?: string
  state?: string
  names?: string[]
}

export async function lookupIndianPincode(pin: string): Promise<IndianPincodeDetails> {
  const normalized = pin.trim()
  if (!INDIAN_PINCODE.test(normalized)) {
    throw new Error("Enter a correct 6-digit Indian pincode.")
  }
  const res = await fetch(`/api/v1/pincode/${normalized}`)
  const payload = await res.json().catch(() => null)
  if (!res.ok || !payload?.success || !payload.data?.state) {
    throw new Error("Enter a correct Indian pincode.")
  }
  return payload.data as IndianPincodeDetails
}
