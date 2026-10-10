"use client"

import { useQuery } from "@tanstack/react-query"
import { authedFetch } from "@/lib/dashboard-fetch"

type MasterValue = {
  id: string
  groupKey: string
  label: string
  value: string
  sortOrder: number
  isActive: boolean
}

type MasterGroup = {
  id: string
  key: string
  name: string
  description?: string | null
  isActive: boolean
}

export const useMasterValues = (groupKey: string, enabled = true, activeOnly = true) => {
  return useQuery({
    queryKey: ["master-values", groupKey, activeOnly],
    enabled: enabled && Boolean(groupKey),
    staleTime: 0,
    refetchOnMount: "always",
    retry: 1,
    queryFn: () =>
      authedFetch<MasterValue[]>(
        `/api/master/values?group=${encodeURIComponent(groupKey)}&activeOnly=${activeOnly}`,
      ),
  })
}

export const useMasterGroups = (enabled = true) => {
  return useQuery({
    queryKey: ["master-groups"],
    enabled,
    staleTime: 5 * 60_000,
    retry: 1,
    queryFn: () => authedFetch<MasterGroup[]>("/api/master/groups?activeOnly=true"),
  })
}

export const useAllMasterData = (enabled = true) => {
  return useQuery({
    queryKey: ["master-all"],
    enabled,
    staleTime: 5 * 60_000,
    retry: 1,
    queryFn: () => authedFetch<Array<MasterGroup & { values: MasterValue[] }>>("/api/master/all"),
  })
}
