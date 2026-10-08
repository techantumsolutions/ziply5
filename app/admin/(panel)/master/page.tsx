"use client"

import { FormEvent, useEffect, useMemo, useState } from "react"
import { useQueryClient } from "@tanstack/react-query"
import { useAllMasterData } from "@/hooks/useMasterData"
import { authedFetch } from "@/lib/dashboard-fetch"

const normalizeRole = (value: string | null | undefined) =>
  (value ?? "").trim().toLowerCase().replace(/[\s-]+/g, "_")

type MasterValue = {
  id: string
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
  values: MasterValue[]
}

export default function MasterDataPage() {
  const queryClient = useQueryClient()
  const [selectedGroup, setSelectedGroup] = useState<string>("")
  const [groupKey, setGroupKey] = useState("")
  const [groupName, setGroupName] = useState("")
  const [groupDescription, setGroupDescription] = useState("")
  const [valueLabel, setValueLabel] = useState("")
  const [valueValue, setValueValue] = useState("")
  const [valueSortOrder, setValueSortOrder] = useState("0")
  const [error, setError] = useState("")
  const [saving, setSaving] = useState(false)
  const [role, setRole] = useState<string | null>(null)
  const [roleLoaded, setRoleLoaded] = useState(false)

  useEffect(() => {
    const syncRole = () => {
      const roleFromKey = window.localStorage.getItem("ziply5_user_role")
      const userRaw = window.localStorage.getItem("ziply5_user")
      let roleFromUser: string | null = null
      if (userRaw) {
        try {
          const parsed = JSON.parse(userRaw) as { role?: string | null }
          roleFromUser = parsed?.role ?? null
        } catch {
          roleFromUser = null
        }
      }
      const normalized = normalizeRole(roleFromKey || roleFromUser)
      setRole(normalized || null)
      setRoleLoaded(true)
    }
    syncRole()
    window.addEventListener("storage", syncRole)
    return () => window.removeEventListener("storage", syncRole)
  }, [])

  const allQuery = useAllMasterData(true)
  const groups = (allQuery.data ?? []) as MasterGroup[]

  const activeGroup = useMemo(
    () => groups.find((g) => g.key === selectedGroup) ?? null,
    [groups, selectedGroup],
  )

  const refresh = async () => {
    await queryClient.invalidateQueries({ queryKey: ["master-all"] })
    await queryClient.invalidateQueries({ queryKey: ["master-groups"] })
  }

  const createGroup = async (event: FormEvent) => {
    event.preventDefault()
    setSaving(true)
    setError("")
    try {
      await authedFetch("/api/master/groups", {
        method: "POST",
        body: JSON.stringify({
          key: groupKey,
          name: groupName,
          description: groupDescription || null,
        }),
      })
      setGroupKey("")
      setGroupName("")
      setGroupDescription("")
      await refresh()
    } catch (e) {
      setError(e instanceof Error ? e.message : "Failed to create group")
    } finally {
      setSaving(false)
    }
  }

  const createValue = async (event: FormEvent) => {
    event.preventDefault()
    if (!selectedGroup) {
      setError("Select a group first")
      return
    }
    setSaving(true)
    setError("")
    try {
      await authedFetch("/api/master/values", {
        method: "POST",
        body: JSON.stringify({
          groupKey: selectedGroup,
          label: valueLabel,
          value: valueValue,
          sortOrder: Number(valueSortOrder || 0),
        }),
      })
      setValueLabel("")
      setValueValue("")
      setValueSortOrder("0")
      await refresh()
    } catch (e) {
      setError(e instanceof Error ? e.message : "Failed to create value")
    } finally {
      setSaving(false)
    }
  }

  const toggleValue = async (id: string, isActive: boolean) => {
    setSaving(true)
    setError("")
    try {
      await authedFetch(`/api/master/value/${id}`, {
        method: "PUT",
        body: JSON.stringify({ isActive: !isActive }),
      })
      await refresh()
    } catch (e) {
      setError(e instanceof Error ? e.message : "Failed to update value")
    } finally {
      setSaving(false)
    }
  }

  const removeValue = async (id: string) => {
    setSaving(true)
    setError("")
    try {
      await authedFetch(`/api/master/value/${id}`, { method: "DELETE" })
      await refresh()
    } catch (e) {
      setError(e instanceof Error ? e.message : "Failed to delete value")
    } finally {
      setSaving(false)
    }
  }

  const toggleGroup = async () => {
    if (!activeGroup) return
    setSaving(true)
    setError("")
    try {
      await authedFetch(`/api/master/group/${activeGroup.id}`, {
        method: "PUT",
        body: JSON.stringify({ isActive: !activeGroup.isActive }),
      })
      await refresh()
    } catch (e) {
      setError(e instanceof Error ? e.message : "Failed to update group")
    } finally {
      setSaving(false)
    }
  }

  const removeGroup = async () => {
    if (!activeGroup) return
    setSaving(true)
    setError("")
    try {
      await authedFetch(`/api/master/group/${activeGroup.id}`, { method: "DELETE" })
      setSelectedGroup("")
      await refresh()
    } catch (e) {
      setError(e instanceof Error ? e.message : "Failed to delete group")
    } finally {
      setSaving(false)
    }
  }

  const shiftSort = async (id: string, current: number, delta: number) => {
    setSaving(true)
    setError("")
    try {
      await authedFetch(`/api/master/value/${id}`, {
        method: "PUT",
        body: JSON.stringify({ sortOrder: Math.max(0, current + delta) }),
      })
      await refresh()
    } catch (e) {
      setError(e instanceof Error ? e.message : "Failed to reorder")
    } finally {
      setSaving(false)
    }
  }

  return (
    <section className="w-full space-y-4">
      {roleLoaded && role !== "super_admin" ? (
        <p className="rounded-lg bg-red-50 px-3 py-2 text-sm text-red-800">
          Only super admin can manage master data.
        </p>
      ) : null}
      <div>
        <h1 className="font-melon text-2xl font-bold text-[#4A1D1F]">Master Data</h1>
        <p className="text-sm text-[#646464]">Super admin controlled master groups and values.</p>
      </div>

      {error && <p className="rounded-lg bg-red-50 px-3 py-2 text-sm text-red-800">{error}</p>}
      {allQuery.error && (
        <p className="rounded-lg bg-yellow-50 px-3 py-2 text-sm text-yellow-800">
          No data available.
        </p>
      )}

      <div className="grid gap-4 md:grid-cols-2">
        <form onSubmit={createGroup} className="rounded-2xl border border-[#E8DCC8] bg-white p-4 shadow-sm space-y-2">
          <p className="text-xs font-semibold uppercase tracking-wide text-[#4A1D1F]">Create Group</p>
          <input className="w-full rounded border px-3 py-2 text-sm" placeholder="Key (e.g. PRODUCT_WEIGHT)" value={groupKey} onChange={(e) => setGroupKey(e.target.value)} />
          <input className="w-full rounded border px-3 py-2 text-sm" placeholder="Name" value={groupName} onChange={(e) => setGroupName(e.target.value)} />
          <input className="w-full rounded border px-3 py-2 text-sm" placeholder="Description" value={groupDescription} onChange={(e) => setGroupDescription(e.target.value)} />
          <button disabled={saving || role !== "super_admin"} className="rounded-full bg-[#7B3010] px-4 py-2 text-xs font-semibold uppercase text-white disabled:opacity-40">Create Group</button>
        </form>

        <div className="rounded-2xl border border-[#E8DCC8] bg-white p-4 shadow-sm space-y-2">
          <p className="text-xs font-semibold uppercase tracking-wide text-[#4A1D1F]">Groups</p>
          <select
            value={selectedGroup}
            onChange={(e) => setSelectedGroup(e.target.value)}
            className="w-full rounded border px-3 py-2 text-sm"
          >
            <option value="">Select group</option>
            {groups.map((group) => (
              <option key={group.id} value={group.key}>
                {group.key} - {group.name}
              </option>
            ))}
          </select>
          {!groups.length && <p className="text-sm text-[#646464]">No groups available.</p>}
        </div>
      </div>

      {activeGroup && (
        <div className="rounded-2xl border border-[#E8DCC8] bg-white p-4 shadow-sm space-y-3">
          <div className="flex items-center justify-between">
            <p className="text-xs font-semibold uppercase tracking-wide text-[#4A1D1F]">
              Values: {activeGroup.key}
            </p>
            <div className="flex gap-2">
              <button
                type="button"
                onClick={() => void toggleGroup()}
                disabled={saving || role !== "super_admin"}
                className="rounded-full border px-3 py-1 text-xs disabled:opacity-40"
              >
                {activeGroup.isActive ? "Deactivate Group" : "Activate Group"}
              </button>
              <button
                type="button"
                onClick={() => void removeGroup()}
                disabled={saving || role !== "super_admin"}
                className="rounded-full border border-red-200 px-3 py-1 text-xs text-red-700 disabled:opacity-40"
              >
                Delete Group
              </button>
            </div>
          </div>
          <form onSubmit={createValue} className="grid gap-2 md:grid-cols-4">
            <input className="rounded border px-3 py-2 text-sm" placeholder="Label" value={valueLabel} onChange={(e) => setValueLabel(e.target.value)} />
            <input className="rounded border px-3 py-2 text-sm" placeholder="Value" value={valueValue} onChange={(e) => setValueValue(e.target.value)} />
            <input className="rounded border px-3 py-2 text-sm" type="number" placeholder="Sort order" value={valueSortOrder} onChange={(e) => setValueSortOrder(e.target.value)} />
            <button disabled={saving || role !== "super_admin"} className="rounded-full bg-[#7B3010] px-4 py-2 text-xs font-semibold uppercase text-white disabled:opacity-40">Add Value</button>
          </form>
          <div className="space-y-2">
            {(activeGroup.values ?? []).map((value) => (
              <div key={value.id} className="flex items-center justify-between rounded border px-3 py-2 text-sm">
                <span>
                  {value.label} ({value.value}) - order {value.sortOrder}
                </span>
                <div className="flex gap-2">
                  <button
                    type="button"
                    onClick={() => void shiftSort(value.id, value.sortOrder, -1)}
                    className="rounded-full border px-3 py-1 text-xs disabled:opacity-40"
                    disabled={role !== "super_admin"}
                  >
                    Up
                  </button>
                  <button
                    type="button"
                    onClick={() => void shiftSort(value.id, value.sortOrder, 1)}
                    className="rounded-full border px-3 py-1 text-xs disabled:opacity-40"
                    disabled={role !== "super_admin"}
                  >
                    Down
                  </button>
                  <button
                    type="button"
                    onClick={() => void toggleValue(value.id, value.isActive)}
                    className="rounded-full border px-3 py-1 text-xs disabled:opacity-40"
                    disabled={role !== "super_admin"}
                  >
                    {value.isActive ? "Deactivate" : "Activate"}
                  </button>
                  <button
                    type="button"
                    onClick={() => void removeValue(value.id)}
                    className="rounded-full border border-red-200 px-3 py-1 text-xs text-red-700 disabled:opacity-40"
                    disabled={role !== "super_admin"}
                  >
                    Delete
                  </button>
                </div>
              </div>
            ))}
            {!(activeGroup.values ?? []).length && <p className="text-sm text-[#646464]">No values available.</p>}
          </div>
        </div>
      )}
    </section>
  )
}
