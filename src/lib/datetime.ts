const HAS_ZONE = /(?:Z|[+-]\d{2}:?\d{2})$/i

const IST: Intl.DateTimeFormatOptions = { timeZone: "Asia/Kolkata" }

/**
 * Order timestamps are stored in `timestamp without time zone` as a UTC wall clock.
 * Strings with no offset must be read as UTC. A real Date is already an absolute instant.
 */
export function toUtcIso(value: unknown): string | null {
  if (value == null || value === "") return null
  if (value instanceof Date) {
    return Number.isNaN(value.getTime()) ? null : value.toISOString()
  }
  if (typeof value === "number") {
    const date = new Date(value)
    return Number.isNaN(date.getTime()) ? null : date.toISOString()
  }
  const raw = String(value).trim()
  if (!raw) return null
  const normalized = HAS_ZONE.test(raw) ? raw : `${raw.includes("T") ? raw : raw.replace(" ", "T")}Z`
  const date = new Date(normalized)
  return Number.isNaN(date.getTime()) ? null : date.toISOString()
}

/**
 * node-pg parses `timestamp without time zone` as the process local time.
 * Those columns store a UTC wall clock, so the local clock parts are the UTC time.
 */
export function pgTimestampToUtcIso(value: Date): string | null {
  if (Number.isNaN(value.getTime())) return null
  const pad = (n: number, width = 2) => String(n).padStart(width, "0")
  const wall = `${value.getFullYear()}-${pad(value.getMonth() + 1)}-${pad(value.getDate())}T${pad(value.getHours())}:${pad(value.getMinutes())}:${pad(value.getSeconds())}.${pad(value.getMilliseconds(), 3)}Z`
  const date = new Date(wall)
  return Number.isNaN(date.getTime()) ? null : date.toISOString()
}

function instant(value: unknown): Date | null {
  const iso = toUtcIso(value)
  if (!iso) return null
  const date = new Date(iso)
  return Number.isNaN(date.getTime()) ? null : date
}

export function formatOrderDate(value: unknown): string {
  const date = instant(value)
  if (!date) return "—"
  return date.toLocaleDateString("en-IN", { ...IST, day: "2-digit", month: "short", year: "numeric" })
}

export function formatOrderTime(value: unknown): string {
  const date = instant(value)
  if (!date) return "—"
  return date.toLocaleTimeString("en-IN", { ...IST, hour: "2-digit", minute: "2-digit", hour12: true })
}

export function formatOrderDateTime(value: unknown): string {
  const date = instant(value)
  if (!date) return "—"
  return date.toLocaleString("en-IN", {
    ...IST,
    day: "2-digit",
    month: "short",
    year: "numeric",
    hour: "2-digit",
    minute: "2-digit",
    hour12: true,
  })
}

/** `YYYY-MM-DD HH:mm:ss` in India time, for systems that store a local order clock. */
export function formatIstSqlDateTime(value: unknown): string | null {
  const date = instant(value)
  if (!date) return null
  const parts = new Intl.DateTimeFormat("en-GB", {
    ...IST,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
    hourCycle: "h23",
  }).formatToParts(date)
  const get = (type: Intl.DateTimeFormatPartTypes) => parts.find((part) => part.type === type)?.value ?? "00"
  return `${get("year")}-${get("month")}-${get("day")} ${get("hour")}:${get("minute")}:${get("second")}`
}
