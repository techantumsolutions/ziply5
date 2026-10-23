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
  Sparkles,
  Star,
  RotateCcw,
  ShoppingBag,
  Wallet,
  TicketPercent,
  BadgePercent,
  Box,
  ShoppingBasket,
  Truck,
  Gift,
} from "lucide-react"
import { DashboardChrome, type DashboardNavItem } from "./DashboardChrome"
import { PageTransition } from "@/components/animations/PageTransition"

const adminNav: DashboardNavItem[] = [
  { href: "/admin/dashboard", label: "Dashboard", icon: LayoutDashboard },
  { href: "/admin/orders", label: "Orders", icon: ShoppingCart },
  { href: "/admin/products", label: "Products", icon: Package },
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
  {
    label: "CMS",
    icon: FileText,
    subItems: [
      { href: "/admin/cms", label: "CMS Pages", icon: FileText },
      { href: "/admin/product-usage", label: "Product Usage", icon: FileText },
    ],
  },
  { href: "/admin/users", label: "Customers", icon: Users },
  { href: "/admin/reviews", label: "Reviews", icon: Star },
  { href: "/admin/returns", label: "Returns", icon: RotateCcw },
  { href: "/admin/finance", label: "Finance", icon: Wallet },
  { href: "/admin/reports", label: "Sales report", icon: BarChart3 },
  { href: "/admin/abandoned-carts", label: "Abandoned carts", icon: ShoppingBag },
  { href: "/admin/inbox", label: "Inbox", icon: FileText },
  {
    label: "Settings",
    icon: Settings,
    subItems: [
      { href: "/admin/settings", label: "General", icon: Settings },
      { href: "/admin/categories", label: "Categories", icon: FolderTree },
      { href: "/admin/product-features", label: "Product Features", icon: Sparkles },
      { href: "/admin/hsn-barcode", label: "HSN & Barcodes", icon: FileText },
    ],
  },
]

export function AdminPanelLayout({ children }: { children: React.ReactNode }) {
  const navItems = adminNav

  return (
    <DashboardChrome
      portalLabel="Admin console"
      loginPath="/admin/login"
      websiteHref="/"
      navItems={navItems}
      showAdminNotifications
    >
      <PageTransition>{children}</PageTransition>
    </DashboardChrome>
  )
}
