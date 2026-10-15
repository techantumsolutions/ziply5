const finiteNumber = (value: unknown) => {
  const n = Number(value)
  return Number.isFinite(n) ? n : null
}

const flag = (value: unknown) => {
  if (value === 1 || value === true) return true
  const text = String(value ?? "").trim().toLowerCase()
  return text === "1" || text === "true" || text === "yes"
}

/** Map one Shiprocket `available_courier_companies` row. Courier name is kept as returned. */
export const mapShiprocketCourierQuote = (item: Record<string, unknown>) => {
  const rawCod = item.cod ?? item.cod_available ?? item.is_cod_available
  const eta = finiteNumber(item.estimated_delivery_days ?? item.eta_days)
  const rate = finiteNumber(item.rate ?? item.freight_charge ?? item.shipping_rate)
  const chargeWeight = finiteNumber(item.charge_weight)
  const minWeight = finiteNumber(item.min_weight)
  const courierId = finiteNumber(item.courier_company_id)
  return {
    name: String(item.courier_name ?? item.name ?? "Courier"),
    eta_days: eta != null && eta > 0 ? eta : 0,
    etd: typeof item.etd === "string" && item.etd.trim() ? item.etd.trim() : undefined,
    rate: rate ?? 0,
    courier_company_id: courierId != null && courierId > 0 ? courierId : undefined,
    cod_available: rawCod == null || rawCod === "" ? false : flag(rawCod),
    charge_weight_kg: chargeWeight != null && chargeWeight > 0 ? chargeWeight : undefined,
    min_weight_kg: minWeight != null && minWeight > 0 ? minWeight : undefined,
  }
}
