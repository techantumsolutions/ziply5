import { readFile } from "node:fs/promises"
import path from "node:path"
import { env } from "@/src/server/core/config/env"

type ShiprocketMode = "mock" | "staging" | "live"
type HttpMethod = "GET" | "POST"

type TokenCache = {
  token: string
  expiresAtMs: number
}

type ShiprocketAuthResponse = {
  token?: string
}

export type ServiceabilityInput = {
  pickup_postcode: string
  delivery_postcode: string
  cod: 0 | 1
  weight: number
  declared_value: number
}

export type ServiceabilityCourier = {
  name: string
  eta_days: number
  /** Present for internal diagnostics only — never use for customer shipping price. */
  rate: number
  courier_company_id?: number
  /** Shiprocket courier row: COD supported for this option when true / 1. */
  cod_available?: boolean
}

export type ServiceabilityResponse = {
  available_couriers: ServiceabilityCourier[]
}

export type CreateOrderInput = Record<string, unknown>
export type CreateOrderResponse = {
  order_id?: number
  shipment_id?: number
  message?: string
  errors?: unknown
  [key: string]: unknown
}

export type AssignAwbInput = {
  shipment_id: number
  courier_id?: number
}

export type AssignAwbResponse = {
  awb_code?: string
  courier_name?: string
  courier_company_id?: number
  tracking_url?: string
}

export type GeneratePickupInput = {
  shipment_id: number
}

export type GeneratePickupResponse = {
  pickup_status?: string
  pickup_request_id?: string
}

export type CancelOrdersInput = {
  /** Shiprocket channel order ids (numeric). */
  ids: number[]
}

export type CreateReturnOrderResponse = {
  shipment_id?: number
  order_id?: number
  awb_code?: string
  awb_code_data?: string
  message?: unknown
  payload?: Record<string, unknown>
  [key: string]: unknown
}

export type CancelOrdersResponse = {
  message?: unknown
  status_code?: number
  status?: number
  [key: string]: unknown
}

const DEFAULT_TIMEOUT_MS = 12000

export class ShiprocketApiError extends Error {
  status: number
  body: string
  endpoint: string
  isTransient: boolean

  constructor(input: { message: string; status: number; body: string; endpoint: string; isTransient: boolean }) {
    super(input.message)
    this.name = "ShiprocketApiError"
    this.status = input.status
    this.body = input.body
    this.endpoint = input.endpoint
    this.isTransient = input.isTransient
  }
}

const normalizeBearer = (value: string) => value.trim().replace(/^Bearer\s+/i, "")

/** JWT from POST …/auth/login; use as Authorization Bearer (see Shiprocket external API docs). */
export const getStaticShiprocketToken = () => {
  const raw = env.SHIPROCKET_TOKEN?.trim() || env.SHIPROCKET_API_KEY?.trim()
  return raw ? normalizeBearer(raw) : ""
}

const hasLoginCredentials = () => Boolean(env.SHIPROCKET_EMAIL?.trim() && env.SHIPROCKET_PASSWORD)

const resolveShiprocketMode = (): ShiprocketMode => {
  const explicit = env.SHIPROCKET_MODE?.trim().toLowerCase()
  if (explicit === "mock" || explicit === "staging" || explicit === "live") return explicit
  if (hasLoginCredentials() || getStaticShiprocketToken()) return "live"
  return "mock"
}

const mode = resolveShiprocketMode()
const baseUrl = (env.SHIPROCKET_BASE_URL ?? "https://apiv2.shiprocket.in/v1/external").replace(/\/+$/, "")

let tokenCache: TokenCache | null = null

const withTimeout = async <T>(promise: Promise<T>, timeoutMs = DEFAULT_TIMEOUT_MS): Promise<T> => {
  let timer: NodeJS.Timeout | null = null
  try {
    return await Promise.race([
      promise,
      new Promise<T>((_, reject) => {
        timer = setTimeout(() => reject(new Error("Shiprocket request timed out")), timeoutMs)
      }),
    ])
  } finally {
    if (timer) clearTimeout(timer)
  }
}

const mockFile = async <T>(filename: string): Promise<T> => {
  const filePath = path.join(process.cwd(), "lib", "integrations", "mocks", filename)
  const text = await readFile(filePath, "utf-8")
  return JSON.parse(text) as T
}

const shouldUseMock = () => mode === "mock"

const maskToken = (token: string) => `${token.slice(0, 4)}***${token.slice(-4)}`

const loginShiprocket = async () => {
  if (!hasLoginCredentials()) {
    throw new Error(
      "Shiprocket auth: set SHIPROCKET_EMAIL + SHIPROCKET_PASSWORD (API user from Shiprocket panel), or SHIPROCKET_TOKEN / SHIPROCKET_API_KEY with the JWT from POST …/auth/login",
    )
  }
  const loginUrl = `${baseUrl}/auth/login`
  const res = await withTimeout(
    fetch(loginUrl, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        email: env.SHIPROCKET_EMAIL,
        password: env.SHIPROCKET_PASSWORD,
      }),
    }),
  )
  if (!res.ok) {
    const body = await res.text()
    throw new Error(`Shiprocket auth failed (${res.status}): ${body.slice(0, 180)}`)
  }
  const data = (await res.json()) as ShiprocketAuthResponse
  if (!data.token) throw new Error("Shiprocket auth token missing")
  tokenCache = {
    token: data.token,
    expiresAtMs: Date.now() + 23 * 60 * 60 * 1000,
  }
  return tokenCache.token
}

export const getShiprocketToken = async () => {
  if (shouldUseMock()) return "mock-token"
  const staticToken = getStaticShiprocketToken()
  if (staticToken) return staticToken
  if (tokenCache && tokenCache.expiresAtMs > Date.now()) return tokenCache.token
  return loginShiprocket()
}

const requestWithAuth = async <T>(
  endpoint: string,
  method: HttpMethod,
  body?: unknown,
  retryOn401 = true,
  retriedTransient = false,
): Promise<T> => {
  if (shouldUseMock()) {
    throw new Error("requestWithAuth should not be called in mock mode")
  }
  const token = await getShiprocketToken()
  const url = `${baseUrl}${endpoint.startsWith("/") ? endpoint : `/${endpoint}`}`
  const res = await withTimeout(
    fetch(url, {
      method,
      headers: {
        Authorization: `Bearer ${token}`,
        "Content-Type": "application/json",
      },
      body: body ? JSON.stringify(body) : undefined,
    }),
  )
  if (res.status === 401 && retryOn401) {
    tokenCache = null
    await loginShiprocket()
    return requestWithAuth<T>(endpoint, method, body, false)
  }
  if (!res.ok) {
    if (!retriedTransient && (res.status === 429 || res.status >= 500)) {
      return requestWithAuth<T>(endpoint, method, body, retryOn401, true)
    }
    const raw = await res.text()
    console.error(`[shiprocket] ${method} ${endpoint} failed ${res.status}`, raw.slice(0, 300))
    throw new ShiprocketApiError({
      message: `Shiprocket API error (${res.status})`,
      status: res.status,
      body: raw,
      endpoint,
      isTransient: res.status === 429 || res.status >= 500,
    })
  }
  return (await res.json()) as T
}

const request = async <T>(endpoint: string, method: HttpMethod, body?: unknown) => {
  if (shouldUseMock()) {
    if (endpoint.includes("/courier/serviceability")) return mockFile<T>("serviceability.json")
    if (endpoint.includes("/orders/create/adhoc")) return mockFile<T>("create-order.json")
    if (endpoint.includes("/courier/assign/awb")) return mockFile<T>("assign-awb.json")
    if (endpoint.includes("/courier/generate/pickup")) return mockFile<T>("pickup.json")
    if (endpoint.includes("/orders/cancel")) return mockFile<T>("cancel-order.json")
    if (endpoint.includes("/orders/create/return")) return mockFile<T>("create-return.json")
    throw new Error(`No mock response mapped for ${endpoint}`)
  }
  return requestWithAuth<T>(endpoint, method, body)
}

export const shiprocketClient = {
  mode,
  baseUrl,
  async checkServiceability(input: ServiceabilityInput): Promise<ServiceabilityResponse> {
    const query = new URLSearchParams({
      pickup_postcode: String(input.pickup_postcode),
      delivery_postcode: String(input.delivery_postcode),
      cod: String(input.cod),
      weight: String(input.weight),
      declared_value: String(input.declared_value),
    })
    const payload = await request<Record<string, unknown>>(`/courier/serviceability?${query.toString()}`, "GET")
    if ("available_couriers" in payload) return payload as ServiceabilityResponse
    const data = payload.data as Record<string, unknown> | undefined
    const available = (data?.available_courier_companies ?? data?.available_couriers ?? []) as Array<Record<string, unknown>>
    const normalized: ServiceabilityCourier[] = available.map((item) => {
      const rawCod = item.cod ?? item.cod_available ?? item.is_cod_available
      const cod_available =
        rawCod === undefined || rawCod === null
          ? true
          : rawCod === 1 ||
            rawCod === true ||
            String(rawCod).toLowerCase() === "true" ||
            String(rawCod).toLowerCase() === "yes"
      return {
        name: String(item.courier_name ?? item.name ?? "Courier"),
        eta_days: Number(item.estimated_delivery_days ?? item.eta_days ?? item.etd_hours ?? 3),
        rate: Number(item.rate ?? item.freight_charge ?? item.shipping_rate ?? 0),
        courier_company_id: item.courier_company_id ? Number(item.courier_company_id) : undefined,
        cod_available,
      }
    })
    return { available_couriers: normalized }
  },
  async createOrder(input: CreateOrderInput): Promise<CreateOrderResponse> {
    return request<CreateOrderResponse>("/orders/create/adhoc", "POST", input)
  },
  async assignAwb(input: AssignAwbInput): Promise<AssignAwbResponse> {
    return request<AssignAwbResponse>("/courier/assign/awb", "POST", input)
  },
  async generatePickup(input: GeneratePickupInput): Promise<GeneratePickupResponse> {
    return request<GeneratePickupResponse>("/courier/generate/pickup", "POST", input)
  },
  async cancelOrders(input: CancelOrdersInput): Promise<CancelOrdersResponse> {
    return request<CancelOrdersResponse>("/orders/cancel", "POST", input)
  },
  async createReturnOrder(input: Record<string, unknown>): Promise<CreateReturnOrderResponse> {
    return request<CreateReturnOrderResponse>("/orders/create/return", "POST", input)
  },
  async generateInvoice(ids: number[]): Promise<{ is_invoice_created?: boolean; invoice_url?: string; [key: string]: unknown }> {
    return request<{ is_invoice_created?: boolean; invoice_url?: string }>("/orders/print/invoice", "POST", { ids })
  },
}

export const getShiprocketConfig = () => ({
  mode: shiprocketClient.mode,
  baseUrl: shiprocketClient.baseUrl,
  hasCredentials: Boolean(hasLoginCredentials() || getStaticShiprocketToken()),
  tokenCached: Boolean(tokenCache && tokenCache.expiresAtMs > Date.now()),
  tokenPreview: tokenCache?.token ? maskToken(tokenCache.token) : null,
})
