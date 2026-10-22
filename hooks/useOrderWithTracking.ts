"use client"

import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query"
import { assertTrackingRefreshOk } from "@/lib/order-tracking-refresh"
import { toast } from "@/lib/toast"
import type { CustomerOrderDetail } from "@/src/lib/orders/customer-order-detail"
import type { OrderTrackingPayload } from "@/src/lib/orders/order-tracking-dto"

export const orderDetailQueryKey = (orderId: string | undefined) => ["order-detail", orderId] as const
export const orderTrackingQueryKey = (orderId: string | undefined) => ["order-tracking", orderId] as const

type Options = {
  /** Default true — matches legacy /track UX */
  toastOnTrackingRefresh?: boolean
}

export function useOrderWithTracking(orderId: string | undefined, options?: Options) {
  const queryClient = useQueryClient()
  const toastOnTrackingRefresh = options?.toastOnTrackingRefresh ?? true

  const orderQuery = useQuery({
    queryKey: orderDetailQueryKey(orderId),
    enabled: Boolean(orderId),
    queryFn: async (): Promise<CustomerOrderDetail> => {
      const token = window.localStorage.getItem("ziply5_access_token")
      if (!token) throw new Error("Please login to view order details.")
      const res = await fetch(`/api/v1/orders/${orderId}`, {
        headers: { Authorization: `Bearer ${token}` },
      })
      const payload = (await res.json()) as { success?: boolean; message?: string; data?: CustomerOrderDetail }
      if (!res.ok || !payload.success || !payload.data) throw new Error(payload.message ?? "Unable to load order.")
      return payload.data
    },
    refetchInterval: (q) => {
      const order = q.state.data
      const status = String(order?.paymentStatus ?? "").toLowerCase()
      // If payment is awaiting confirmation, poll every 3.5s until resolved
      if (status === "pending") return 3500
      return false
    },
  })

  const trackingQuery = useQuery({
    queryKey: orderTrackingQueryKey(orderId),
    enabled: Boolean(orderId) && Boolean(orderQuery.data),
    queryFn: async (): Promise<OrderTrackingPayload> => {
      const token = window.localStorage.getItem("ziply5_access_token")
      if (!token) throw new Error("Please login to view tracking.")
      const res = await fetch(`/api/v1/orders/${orderId}/tracking`, {
        headers: { Authorization: `Bearer ${token}` },
      })
      const payload = (await res.json()) as { success?: boolean; message?: string; data?: OrderTrackingPayload }
      if (!res.ok || !payload.success || !payload.data) throw new Error(payload.message ?? "Unable to load tracking.")
      return payload.data
    },
    refetchInterval: (q) => {
      const d = q.state.data
      return d && !d.isTerminal ? 120_000 : false
    },
  })

  const refreshTrackingMutation = useMutation({
    mutationFn: async () => {
      if (!orderId) throw new Error("Order missing")
      const token = window.localStorage.getItem("ziply5_access_token")
      if (!token) throw new Error("Please login to continue.")
      const res = await fetch(`/api/v1/orders/${orderId}/tracking/refresh`, {
        method: "POST",
        headers: { Authorization: `Bearer ${token}` },
      })
      await assertTrackingRefreshOk(res)
    },
    onSuccess: async () => {
      if (toastOnTrackingRefresh) {
        toast.success("Tracking refreshed", "Latest shipment status loaded.")
      }
      await queryClient.invalidateQueries({ queryKey: orderTrackingQueryKey(orderId) })
      await queryClient.invalidateQueries({ queryKey: orderDetailQueryKey(orderId) })
    },
    onError: (e) => {
      toast.error("Tracking refresh failed", e instanceof Error ? e.message : "Refresh failed")
    },
  })

  return { orderQuery, trackingQuery, refreshTrackingMutation, queryClient }
}
