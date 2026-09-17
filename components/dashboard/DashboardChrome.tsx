"use client"

import Image from "next/image"
import Link from "next/link"
import { usePathname, useSearchParams } from "next/navigation"
import { useEffect, useState, type ReactNode } from "react"
import type { LucideIcon } from "lucide-react"
import { Menu, X } from "lucide-react"
import { Accordion, AccordionContent, AccordionItem, AccordionTrigger } from "@/components/ui/accordion"
import { authFetch, clearSession } from "@/lib/auth-session"
import { AnimatePresence, m, useReducedMotion } from "framer-motion"

export type DashboardNavItem = {
  href?: string
  label: string
  icon: LucideIcon
  subItems?: {
    href: string
    label: string
    icon: LucideIcon
  }[]
}

type MePayload = {
  email?: string
  role?: string
  sub?: string
}

export function DashboardChrome({
  portalLabel,
  loginPath,
  websiteHref,
  navItems,
  children,
}: {
  portalLabel: string
  loginPath: string
  websiteHref: string
  navItems: DashboardNavItem[]
  children: ReactNode
}) {
  const pathname = usePathname()
  const searchParams = useSearchParams()
  const [sidebarOpen, setSidebarOpen] = useState(false)
  const [me, setMe] = useState<MePayload | null>(null)
  const reduce = useReducedMotion()
  // Critical: nav must render instantly on first paint (no "blank sidebar" flash).
  const [isDesktop, setIsDesktop] = useState(() => {
    if (typeof window === "undefined") return true
    try {
      return window.matchMedia("(min-width: 1024px)").matches
    } catch {
      return true
    }
  })

  useEffect(() => {
    const html = document.documentElement
    const { body } = document
    const prevHtmlOverflow = html.style.overflow
    const prevBodyOverflow = body.style.overflow
    const prevBodyOverscroll = body.style.overscrollBehavior
    html.style.overflow = "hidden"
    body.style.overflow = "hidden"
    body.style.overscrollBehavior = "none"
    return () => {
      html.style.overflow = prevHtmlOverflow
      body.style.overflow = prevBodyOverflow
      body.style.overscrollBehavior = prevBodyOverscroll
    }
  }, [])

  useEffect(() => {
    authFetch("/api/v1/auth/me")
      .then(async (r) => {
        if (r.status === 401) {
          // Do not render "unauthorized" pages; send user to login immediately.
          clearSession({ silent: true })
          window.location.href = loginPath
          return null
        }
        return (await r.json()) as { success?: boolean; data?: MePayload }
      })
      .then((p) => {
        if (!p) return
        if (p.success && p.data) setMe(p.data)
      })
      .catch(() => {})
  }, [])

  useEffect(() => {
    const mq = window.matchMedia("(min-width: 1024px)")
    const apply = () => setIsDesktop(mq.matches)
    apply()
    if ("addEventListener" in mq) mq.addEventListener("change", apply)
    else mq.addListener(apply)
    return () => {
      if ("removeEventListener" in mq) mq.removeEventListener("change", apply)
      else mq.removeListener(apply)
    }
  }, [])

  const logout = () => {
    const refresh = window.localStorage.getItem("ziply5_refresh_token")
    clearSession({ silent: true })
    if (refresh) {
      void fetch("/api/v1/auth/logout", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ refreshToken: refresh }),
      })
    }
    window.location.href = loginPath
  }

  const currentPathWithSearch = searchParams?.toString() ? `${pathname}?${searchParams.toString()}` : pathname;

  const isActive = (href: string) => {
    // 1. Exact match (handles both exact paths and exact query strings)
    if (currentPathWithSearch === href) return true;

    const [hrefPath, hrefQuery] = href.split("?");
    const [currentPath, currentQuery] = currentPathWithSearch.split("?");

    // Nested routes (e.g. /admin/products/add) keep the parent nav item selected.
    if (!hrefQuery && hrefPath !== "/" && currentPath.startsWith(`${hrefPath}/`)) return true;

    // 2. Path mismatch
    if (hrefPath !== currentPath) return false;

    // 3. Path matches. Does the nav item dictate a specific query? (e.g. ?catalog=combos)
    if (hrefQuery) return currentQuery?.includes(hrefQuery) ?? false;

    // 4. Base path matches. Prevent highlighting the base menu item if we are on a pseudo-page (like Combos).
    if (currentQuery && currentQuery.includes("catalog=")) return false;

    return true;
  }

  const NavList = ({ onNavigate }: { onNavigate?: () => void }) => (
    <nav className="flex flex-col gap-0.5 px-2 py-3">
      {navItems.map(({ href, label, icon: Icon, subItems }) => {
        if (subItems && subItems.length > 0) {
          const isGroupActive = subItems.some((item) => isActive(item.href))
          return (
            <Accordion key={label} type="single" collapsible defaultValue={isGroupActive ? label : undefined}>
              <AccordionItem value={label} className="border-b-0">
                <AccordionTrigger
                  className={`flex w-full items-center justify-between gap-3 rounded-xl px-3 py-2.5 text-sm font-medium transition-colors hover:bg-[#F5F1E6] hover:no-underline ${
                    isGroupActive ? "bg-[#FFC222] text-[#4A1D1F] shadow-sm" : "text-[#2A1810]"
                  }`}
                >
                  <div className="flex items-center gap-3">
                    <Icon className="h-4 w-4 shrink-0 opacity-90" strokeWidth={2} />
                    {label}
                  </div>
                </AccordionTrigger>
                <AccordionContent className="pb-0 pl-6 pt-1">
                  <nav className="flex flex-col gap-0.5">
                    {subItems.map((subItem) => {
                      const active = isActive(subItem.href)
                      return (
                        <Link
                          key={subItem.href}
                          href={subItem.href}
                          onClick={onNavigate}
                          className={`flex items-center gap-3 rounded-xl px-3 py-2.5 text-sm font-medium transition-colors ${
                            active ? "bg-[#FFC222] text-[#4A1D1F] shadow-sm" : "text-[#2A1810] hover:bg-[#F5F1E6]"
                          }`}
                        >
                          <subItem.icon className="h-4 w-4 shrink-0 opacity-90" strokeWidth={2} />
                          {subItem.label}
                        </Link>
                      )
                    })}
                  </nav>
                </AccordionContent>
              </AccordionItem>
            </Accordion>
          )
        }

        if (!href) return null
        const active = isActive(href)
        return (
          <Link key={href} href={href} onClick={onNavigate} className={`flex items-center gap-3 rounded-xl px-3 py-2.5 text-sm font-medium transition-colors ${active ? "bg-[#FFC222] text-[#4A1D1F] shadow-sm" : "text-[#2A1810] hover:bg-[#F5F1E6]"}`}>
            <Icon className="h-4 w-4 shrink-0 opacity-90" strokeWidth={2} />
            {label}
          </Link>
        )
      })}
    </nav>
  )

  return (
    <div className="fixed inset-0 flex overflow-hidden bg-[#F5F1E6] text-[#2A1810]">
      <AnimatePresence>
        {sidebarOpen ? (
          <m.button
            type="button"
            className="fixed inset-0 z-40 bg-black/40 lg:hidden"
            aria-label="Close menu"
            onClick={() => setSidebarOpen(false)}
            initial={reduce ? { opacity: 1 } : { opacity: 0 }}
            animate={reduce ? { opacity: 1 } : { opacity: 1 }}
            exit={reduce ? { opacity: 0 } : { opacity: 0 }}
            transition={reduce ? { duration: 0.12 } : { duration: 0.18, ease: "easeOut" }}
          />
        ) : null}
      </AnimatePresence>

      <m.aside
        className="fixed inset-y-0 left-0 z-50 flex w-64 flex-col border-r border-[#E0D5C8] bg-white shadow-xl lg:static lg:z-0 lg:translate-x-0 lg:shadow-none"
        initial={false}
        animate={
          reduce
            ? { x: isDesktop ? 0 : sidebarOpen ? 0 : -320 }
            : {
                x: isDesktop ? 0 : sidebarOpen ? 0 : -320,
                transition: isDesktop ? { duration: 0 } : { duration: 0.22, ease: "easeOut" },
              }
        }
        style={{ willChange: "transform" }}
      >
        <div className="flex items-center justify-between gap-2 border-b border-[#E0D5C8] px-4 py-4">
          <Link href={navItems[0]?.href ?? websiteHref} className="flex items-center gap-2" onClick={() => setSidebarOpen(false)}>
            <Image src="/primaryLogo.png" alt="ZiPLY5" width={120} height={44} className="h-9 w-auto object-contain" />
          </Link>
          <button
            type="button"
            className="rounded-lg p-2 text-[#4A1D1F] hover:bg-[#F5F1E6] lg:hidden"
            onClick={() => setSidebarOpen(false)}
            aria-label="Close sidebar"
          >
            <X className="h-5 w-5" />
          </button>
        </div>
        {/* <p className="px-4 pt-3 font-melon text-xs font-bold uppercase tracking-[0.2em] text-[#7B3010]">
          {portalLabel}
        </p> */}
        <div className="flex-1 overflow-y-auto">
          <NavList onNavigate={() => setSidebarOpen(false)} />
        </div>
        <div className="border-t border-[#E0D5C8] p-3 text-xs text-[#646464]">
          <Link href={websiteHref} className="block rounded-lg px-3 py-2 hover:bg-[#F5F1E6]" onClick={() => setSidebarOpen(false)}>
            ← Back to store website
          </Link>
        </div>
      </m.aside>

      <div className="flex h-full min-h-0 min-w-0 flex-1 flex-col overflow-hidden">
        <header className="sticky top-0 z-30 flex shrink-0 items-center justify-between gap-3 border-b border-[#E0D5C8] bg-white/95 px-3 py-[18px] backdrop-blur md:px-5">
          <div className="flex items-center gap-2">
            <button
              type="button"
              className="rounded-lg p-2 text-[#4A1D1F] hover:bg-[#F5F1E6] lg:hidden"
              aria-label="Open menu"
              onClick={() => setSidebarOpen(true)}
            >
              <Menu className="h-5 w-5" />
            </button>
            <div className="hidden min-w-0 sm:block">
              {/* <p className="truncate font-melon text-sm font-bold text-[#4A1D1F]">{portalLabel}</p> */}
              <h1 className="truncate text-lg text-[#646464]">Welcome back {me?.role?.replaceAll("_", " ") ?? ""}</h1>
            </div>
          </div>

          <div className="flex items-center gap-2 sm:gap-3">
            <div className="hidden text-right text-xs sm:block">
              <p className="font-semibold text-[#4A1D1F]">{me?.email ?? "…"}</p>            </div>
            <button
              type="button"
              onClick={() => logout()}
              className="rounded-full bg-[#7B3010] px-3 py-2 text-xs font-semibold uppercase tracking-wide text-white hover:bg-[#5c2410]"
            >
              Log out
            </button>
          </div>
        </header>

        <main className="min-h-0 flex-1 overflow-x-hidden overflow-y-auto overscroll-contain p-4 md:p-6">{children}</main>
      </div>
    </div>
  )
}
