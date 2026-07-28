"use client"

import type React from "react"
import {
  LayoutDashboard,
  ShoppingCart,
  Package,
  FolderTree,
  FileText,
  Users,
  BarChart3,
  Settings,
  Award,
  Hash,
  Star,
  RotateCcw,
  ShoppingBag,
  Wallet,
  TrendingUp,
  Database,
  TicketPercent,
  BadgePercent,
  Box,
  ShoppingBasket,
  Truck,
  Gift,
  Upload,
} from "lucide-react"
import { DashboardChrome, type DashboardNavItem } from "./DashboardChrome"
import { useEffect, useMemo, useState } from "react"
import { PageTransition } from "@/components/animations/PageTransition"

const adminNav: DashboardNavItem[] = [
  { href: "/admin/dashboard", label: "Dashboard", icon: LayoutDashboard },
  { href: "/admin/orders", label: "Orders", icon: ShoppingCart },
  {
    label: "Products",
    icon: Package,
    subItems: [
      { href: "/admin/products", label: "All Products", icon: Package },
      { href: "/admin/products/add", label: "Add Product", icon: Package },
      { href: "/admin/products/bulk-upload", label: "Bulk upload", icon: Upload },
      { href: "/admin/products/combos", label: "Combos", icon: Gift },
    ],
  },
  {
    label: "Content",
    icon: FileText,
    subItems: [
      { href: "/admin/cms", label: "CMS Pages", icon: FileText },
      { href: "/admin/product-usage", label: "Product Usage", icon: FileText },
    ],
  },
  { href: "/admin/users", label: "Users", icon: Users },
  { href: "/admin/reviews", label: "Reviews", icon: Star },
  { href: "/admin/returns", label: "Returns", icon: RotateCcw },
  {
    label: "Offers",
    icon: TicketPercent,
    subItems: [
      { href: "/admin/offers/coupon-codes", label: "Coupon Codes", icon: TicketPercent },
      { href: "/admin/offers/automatic-promotions", label: "Automatic Promotions", icon: BadgePercent },
      { href: "/admin/offers/product-level-discounts", label: "Product-Level Discounts", icon: Box },
      { href: "/admin/offers/cart-level-discounts", label: "Cart-Level Discounts", icon: ShoppingBasket },
      { href: "/admin/offers/shipping-discounts", label: "Shipping Discounts", icon: Truck },
      { href: "/admin/offers/bogo-offers", label: "BOGO Offers", icon: Gift },
    ],
  },
  { href: "/admin/inbox", label: "Inbox", icon: FileText },
  { href: "/admin/abandoned-carts", label: "Abandoned carts", icon: ShoppingBag },
  { href: "/admin/finance", label: "Finance", icon: Wallet },
  { href: "/admin/reports", label: "Sales report", icon: BarChart3 },
  { href: "/admin/top-products", label: "Top products", icon: TrendingUp },
  {
    label: "Settings",
    icon: Settings,
    subItems: [
      { href: "/admin/settings", label: "General", icon: Settings },
      { href: "/admin/categories", label: "Categories", icon: FolderTree },
      { href: "/admin/tags", label: "Tags", icon: Hash },
    ],
  },
  { href: "/admin/master", label: "Master data", icon: Database },
]

export function AdminPanelLayout({ children }: { children: React.ReactNode }) {
  const [role, setRole] = useState<string | null>(null)
  useEffect(() => {
    setRole(window.localStorage.getItem("ziply5_user_role"))
  }, [])
  const navItems = useMemo(
    () =>
      adminNav.filter((item) =>
        item.href === "/admin/master" ? role === "super_admin" : true,
      ),
    [role],
  )

  return (
    <DashboardChrome
      portalLabel="Admin console"
      loginPath="/admin/login"
      websiteHref="/"
      navItems={navItems}
    >
      <PageTransition>{children}</PageTransition>
    </DashboardChrome>
  )
}
