import { NextRequest } from "next/server"
import { z } from "zod"
import { env } from "@/src/server/core/config/env"
import { fail, ok } from "@/src/server/core/http/response"
import { checkShiprocketServiceability } from "@/src/server/modules/shipping/shiprocket.service"
import {
  applyCodIntentToServiceability,
  normalizeShiprocketCouriersForUi,
  type NormalizedServiceability,
  type ServiceabilityUiStatus,
} from "@/src/server/modules/shipping/serviceability-check.service"
import type { ShiprocketCourierOption } from "@/src/server/modules/shipping/shiprocket.types"
import { ShiprocketApiError } from "@/lib/integrations/shiprocket"
import {
  shiprocketServiceabilityPayload,
} from "@/src/lib/shipping/ziply5-shipping"
import { calculateAuthoritativeShipping } from "@/src/server/modules/shipping/shipping-settings"

const bodySchema = z.object({
  pickup_postcode: z.string().regex(/^\d{6}$/).optional(),
  delivery_postcode: z.string().regex(/^\d{6}$/),
  cod: z.boolean(),
  subtotal: z.number().nonnegative().optional(),
  totalItems: z.number().int().min(0).max(5000).optional(),
})

const toCourierOptions = (raw: unknown): ShiprocketCourierOption[] => {
  const list = (raw as { available_couriers?: ShiprocketCourierOption[] })?.available_couriers
  return Array.isArray(list) ? list : []
}

const mergeServiceability = (
  prepaidNorm: NormalizedServiceability,
  codNorm: NormalizedServiceability,
): NormalizedServiceability => {
  const prepaidOk = prepaidNorm.deliverable
  const codOk = codNorm.deliverable
  const deliverable = prepaidOk || codOk
  const base = prepaidOk ? prepaidNorm : codNorm
  const codAvailable = codNorm.courierCount > 0
  const prepaidAvailable = prepaidNorm.courierCount > 0

  if (!deliverable) {
    return {
      status: "not_deliverable",
      deliverable: false,
      courierCount: 0,
      estimatedDeliveryDaysMin: null,
      estimatedDeliveryDaysMax: null,
      codAvailable: false,
      prepaidAvailable: false,
      couriers: [],
    }
  }

  const status: ServiceabilityUiStatus =
    base.status === "limited_service" ||
    (!codAvailable && prepaidAvailable) ||
    (!prepaidAvailable && codAvailable)
      ? "limited_service"
      : base.status

  return {
    status,
    deliverable: true,
    courierCount: base.courierCount,
    estimatedDeliveryDaysMin: base.estimatedDeliveryDaysMin,
    estimatedDeliveryDaysMax: base.estimatedDeliveryDaysMax,
    codAvailable,
    prepaidAvailable,
    couriers: base.couriers,
  }
}

export async function POST(request: NextRequest) {
  try {
    const json = await request.json()
    const parsed = bodySchema.safeParse(json)
    if (!parsed.success) {
      return fail("Validation failed", 422, parsed.error.flatten())
    }
    const { delivery_postcode, cod, totalItems, subtotal } = parsed.data
    const pickup =
      parsed.data.pickup_postcode?.trim() ||
      env.SHIPROCKET_PICKUP_POSTCODE?.trim() ||
      "110001"

    const subtotalToUse = subtotal ?? 0
    const shippingRes = await calculateAuthoritativeShipping(subtotalToUse)
    const shippingChargeInr = shippingRes.shippingCharge

    try {
      const [r0, r1] = await Promise.all([
        checkShiprocketServiceability(
          shiprocketServiceabilityPayload({
            pickupPostcode: pickup,
            deliveryPostcode: delivery_postcode,
            cod: 0,
          }),
        ),
        checkShiprocketServiceability(
          shiprocketServiceabilityPayload({
            pickupPostcode: pickup,
            deliveryPostcode: delivery_postcode,
            cod: 1,
          }),
        ),
      ])
      const prepaidNorm = normalizeShiprocketCouriersForUi(toCourierOptions(r0))
      const codNorm = normalizeShiprocketCouriersForUi(toCourierOptions(r1))
      const merged = mergeServiceability(prepaidNorm, codNorm)
      const withCod = applyCodIntentToServiceability(merged, cod)

      return ok({
        status: withCod.status,
        deliverable: withCod.deliverable,
        courierAvailability: {
          count: withCod.courierCount,
          couriers: withCod.couriers,
        },
        estimatedDeliveryDaysMin: withCod.estimatedDeliveryDaysMin,
        estimatedDeliveryDaysMax: withCod.estimatedDeliveryDaysMax,
        codAvailable: withCod.codAvailable,
        prepaidAvailable: withCod.prepaidAvailable,
        shippingChargeInr,
        totalItemsUsedForShipping: totalItems ?? 0,
        usedHighestSlabFallback: false,
        freeLargeOrderShipping: shippingChargeInr === 0,
        shippingError: shippingRes.ok ? undefined : shippingRes.error,
      })
    } catch (e) {
      const transient = e instanceof ShiprocketApiError ? e.isTransient : false
      const apiUnavailable: NormalizedServiceability = {
        status: "api_unavailable",
        deliverable: true,
        courierCount: 0,
        estimatedDeliveryDaysMin: null,
        estimatedDeliveryDaysMax: null,
        codAvailable: true,
        prepaidAvailable: true,
        couriers: [],
      }
      const withCod = applyCodIntentToServiceability(apiUnavailable, cod)
      return ok(
        {
          ...withCod,
          courierAvailability: { count: 0, couriers: [] },
          shippingChargeInr,
          totalItemsUsedForShipping: totalItems ?? 0,
          usedHighestSlabFallback: false,
          freeLargeOrderShipping: shippingChargeInr === 0,
          shippingError: shippingRes.ok ? undefined : shippingRes.error,
          shiprocketTransient: transient,
          message:
            "Delivery could not be verified right now. You can still place the order; we will confirm serviceability before dispatch.",
        },
        "Serviceability check unavailable (fallback)",
        200,
      )
    }
  } catch (error) {
    const message = error instanceof Error ? error.message : "Serviceability check failed"
    return fail(message, 400)
  }
}
