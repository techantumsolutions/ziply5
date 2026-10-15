"use client"

import Link from "next/link"
import { useEffect, useMemo, useRef, useState } from "react"
import { Bell } from "lucide-react"
import { authedFetch } from "@/lib/dashboard-fetch"

type AdminNotification = {
  id: string
  kind: "order" | "cancel" | "return" | "stock" | "review"
  title: string
  body: string
  href: string
  createdAt: string
}

const READ_KEY = "ziply5_admin_notif_read"

const readStoredIds = () => {
  if (typeof window === "undefined") return new Set<string>()
  try {
    const raw = window.localStorage.getItem(READ_KEY)
    const parsed = raw ? (JSON.parse(raw) as string[]) : []
    return new Set(Array.isArray(parsed) ? parsed : [])
  } catch {
    return new Set<string>()
  }
}

const storeReadIds = (ids: Set<string>) => {
  const list = Array.from(ids).slice(-300)
  window.localStorage.setItem(READ_KEY, JSON.stringify(list))
}

const formatWhen = (value: string) => {
  const date = new Date(value)
  if (Number.isNaN(date.getTime())) return ""
  return date.toLocaleString("en-IN", {
    day: "2-digit",
    month: "short",
    hour: "2-digit",
    minute: "2-digit",
  })
}

export function AdminNotificationBell() {
  const [open, setOpen] = useState(false)
  const [items, setItems] = useState<AdminNotification[]>([])
  const [readIds, setReadIds] = useState<Set<string>>(new Set())
  const rootRef = useRef<HTMLDivElement>(null)

  const load = () => {
    authedFetch<AdminNotification[]>("/api/v1/admin/notifications")
      .then((rows) => setItems(Array.isArray(rows) ? rows : []))
      .catch(() => {})
  }

  useEffect(() => {
    setReadIds(readStoredIds())
    load()
    const timer = window.setInterval(load, 30_000)
    return () => window.clearInterval(timer)
  }, [])

  useEffect(() => {
    if (!open) return
    const onPointer = (event: MouseEvent) => {
      if (!rootRef.current?.contains(event.target as Node)) setOpen(false)
    }
    document.addEventListener("mousedown", onPointer)
    return () => document.removeEventListener("mousedown", onPointer)
  }, [open])

  const unread = useMemo(() => items.filter((item) => !readIds.has(item.id)).length, [items, readIds])

  const markRead = (ids: string[]) => {
    setReadIds((prev) => {
      const next = new Set(prev)
      ids.forEach((id) => next.add(id))
      storeReadIds(next)
      return next
    })
  }

  return (
    <div ref={rootRef} className="relative">
      <button
        type="button"
        onClick={() => {
          setOpen((value) => !value)
          load()
        }}
        className="relative rounded-full border border-[#E8DCC8] bg-white p-2 text-[#4A1D1F] hover:bg-[#FFF7ED]"
        aria-label="Notifications"
      >
        <Bell className="h-4 w-4" />
        {unread > 0 ? (
          <span className="absolute -right-1 -top-1 flex h-4 min-w-4 items-center justify-center rounded-full bg-[#A32A2A] px-1 text-[10px] font-bold text-white">
            {unread > 9 ? "9+" : unread}
          </span>
        ) : null}
      </button>

      {open ? (
        <div className="absolute right-0 z-50 mt-2 w-[min(22rem,calc(100vw-1.5rem))] overflow-hidden rounded-2xl border border-[#E8DCC8] bg-white shadow-xl">
          <div className="flex items-center justify-between border-b border-[#E8DCC8] px-3 py-2">
            <p className="text-sm font-semibold text-[#4A1D1F]">Notifications</p>
            {unread > 0 ? (
              <button
                type="button"
                onClick={() => markRead(items.map((item) => item.id))}
                className="text-[11px] font-semibold text-[#7B3010] hover:underline"
              >
                Mark all read
              </button>
            ) : null}
          </div>
          <div className="max-h-96 overflow-y-auto">
            {items.length === 0 ? (
              <p className="px-3 py-6 text-center text-xs text-[#646464]">No notifications</p>
            ) : (
              items.map((item) => {
                const seen = readIds.has(item.id)
                return (
                  <Link
                    key={item.id}
                    href={item.href}
                    onClick={() => {
                      markRead([item.id])
                      setOpen(false)
                    }}
                    className={`block border-b border-[#F3EBDD] px-3 py-2.5 last:border-b-0 hover:bg-[#FFFBF3] ${seen ? "opacity-70" : ""}`}
                  >
                    <div className="flex items-start justify-between gap-2">
                      <p className="text-xs font-semibold text-[#4A1D1F]">{item.title}</p>
                      {!seen ? <span className="mt-1 h-2 w-2 shrink-0 rounded-full bg-[#A32A2A]" /> : null}
                    </div>
                    <p className="mt-0.5 text-xs text-[#2A1810]">{item.body}</p>
                    <p className="mt-1 text-[10px] text-[#8A8A82]">{formatWhen(item.createdAt)}</p>
                  </Link>
                )
              })
            )}
          </div>
        </div>
      ) : null}
    </div>
  )
}
