"use client"

import { Suspense, useEffect, useMemo, useState } from "react"
import Link from "next/link"
import Image from "next/image"
import { Facebook, Twitter, Linkedin, X, Heart, Camera } from "lucide-react"
import { User, Star, Package } from "lucide-react"
import { useRouter, useSearchParams } from "next/navigation"
import { useQuery, useQueryClient, useMutation } from "@tanstack/react-query"
import { getFavoriteSlugs, toggleFavoriteSlug } from "@/lib/favorites"
import { addToCart, getCartItems, setCartItemQuantity } from "@/lib/cart"
import { FALLBACK_PRODUCT_IMAGE } from "@/lib/storefront-products"
import { useStorefrontProducts } from "@/hooks/useStorefrontProducts"
import { useRealtimeTables } from "@/hooks/useRealtimeTables"
import { clearSession } from "@/lib/auth-session"
import { toast } from "@/lib/toast"
import {
  deriveLatestLifecycleToStatus,
  orderHistoryHasCancelRequested,
  shouldRenderCustomerCancelOrderButton,
} from "@/src/lib/orders/order-cancel-policy"
import { getReturnIneligibilityReason } from "@/src/lib/returns/return-eligibility"

const CUSTOMER_RETURN_WINDOW_DAYS = 7

type ApiOrderRow = {
  id: string
  status: string
  paymentStatus?: string | null
  paymentMethod?: string | null
  customerName?: string | null
  customerPhone?: string | null
  customerAddress?: string | null
  refunds?: Array<{ status: string }>
  total: string | number
  createdAt: string
  deliveredAt?: string | null
  items: Array<{ id: string; productId: string; quantity: number; product: { name: string } }>
  transactions?: Array<{ status: string }>
  returnRequests?: Array<{ id: string; status: string; productId?: string | null }>
  shipmentStatus?: string | null
  shippingStatus?: string | null
  shipmentDeliveredAt?: string | Date | null
  statusHistory?: Array<{ toStatus: string; changedAt?: string | null }>
  courierName?: string | null
  awbCode?: string | null
  trackingNumber?: string | null
}

const isNonTerminalReturnStatus = (status: string | undefined | null) =>
  !["rejected", "cancelled", "completed", "refunded"].includes(String(status ?? "").toLowerCase())

const getReturnedProductIds = (order: ApiOrderRow) =>
  new Set(
    (order.returnRequests ?? [])
      .filter((req) => isNonTerminalReturnStatus(req.status))
      .map((req) => String(req.productId ?? "").trim())
      .filter(Boolean),
  )

const profileHasActiveOpenReturn = (order: ApiOrderRow) =>
  Boolean(order.returnRequests?.some((req) => isNonTerminalReturnStatus(req.status)))

const profileReturnEligibilityReason = (order: ApiOrderRow): string | null => {
  if (profileHasActiveOpenReturn(order)) return "active_return"
  const returnedIds = getReturnedProductIds(order)
  const hasReturnableItems = order.items.some((item) => !returnedIds.has(String(item.productId ?? "").trim()))
  if (!hasReturnableItems) return "no_items"
  const deliveredAt = order.deliveredAt
    ? new Date(order.deliveredAt)
    : order.shipmentDeliveredAt
      ? new Date(order.shipmentDeliveredAt as string | Date)
      : (() => {
        const hit = order.statusHistory?.find((h) => h.toStatus.toLowerCase() === "delivered")
        return hit?.changedAt ? new Date(hit.changedAt) : null
      })()
  const latestLifecycle = deriveLatestLifecycleToStatus(order.statusHistory ?? [], order.status)
  return (
    getReturnIneligibilityReason({
      orderStatus: order.status.toLowerCase(),
      latestLifecycle,
      deliveredAt,
      returnWindowDays: CUSTOMER_RETURN_WINDOW_DAYS,
    }) ?? null
  )
}

function ProfilePageContent() {
  const { products } = useStorefrontProducts(200)
  const searchParams = useSearchParams()
  const router = useRouter()
  const initialTab = searchParams.get("tab")
  const [activeTab, setActiveTab] = useState("about")
  const [favoriteSlugs, setFavoriteSlugs] = useState<string[]>([])
  const [cartQtyBySlug, setCartQtyBySlug] = useState<Record<string, number>>({})
  const [orders, setOrders] = useState<ApiOrderRow[]>([])
  const [orderActionBusy, setOrderActionBusy] = useState<string | null>(null)
  const queryClient = useQueryClient()
  const [isManageModalOpen, setIsManageModalOpen] = useState(false)
  const [editForm, setEditForm] = useState({ name: "", bio: "", phone: "" })
  const [authSnapshot, setAuthSnapshot] = useState<{ token: string | null; role: string | null }>({
    token: null,
    role: null,
  })

  // Return modal state
  const [isReturnModalOpen, setIsReturnModalOpen] = useState(false)
  const [selectedOrderForReturn, setSelectedOrderForReturn] = useState<ApiOrderRow | null>(null)
  const [returnReasons, setReturnReasons] = useState<{ id: string; label: string; value: string }[]>([])
  const [selectedItemsForReturn, setSelectedItemsForReturn] = useState<Record<string, {
    selected: boolean;
    productId: string;
    reasonCode: string;
    notes: string;
    imageUrl: string;
    quantity: number;
    uploading: boolean;
  }>>({})
  const [returnMeta, setReturnMeta] = useState({
    returnType: "refund" as "refund" | "exchange",
    description: "",
    videoUrl: "",
    refundMethod: "" as "" | "upi" | "bank",
    upiId: "",
    bankAccountName: "",
    bankAccountNumber: "",
    bankIfsc: "",
    bankName: "",
  })
  const [isCancelModalOpen, setIsCancelModalOpen] = useState(false)
  const [selectedOrderForCancel, setSelectedOrderForCancel] = useState<{ id: string, status: string } | null>(null)

  useEffect(() => {
    const fetchReasons = async () => {
      const token = window.localStorage.getItem("ziply5_access_token")
      if (!token) return
      try {
        const res = await fetch("/api/master/all", {
          headers: { Authorization: `Bearer ${token}` }
        })
        const payload = await res.json()
        if (payload.success && Array.isArray(payload.data)) {
          const group = payload.data.find((g: any) => g.key === "RETURN_REASONS")
          if (group && Array.isArray(group.values)) {
            setReturnReasons(group.values)
          }
        }
      } catch (e) {
        // Ignore
      }
    }
    fetchReasons()
  }, [])

  const openReturnModal = (order: ApiOrderRow) => {
    setSelectedOrderForReturn(order)
    const initialItems: typeof selectedItemsForReturn = {}
    const returnedProductIds = getReturnedProductIds(order)
    const selectableItems = order.items.filter((item) => !returnedProductIds.has(String(item.productId ?? "").trim()))
    const autoSelect = selectableItems.length === 1
    order.items.forEach(item => {
      const blocked = returnedProductIds.has(String(item.productId ?? "").trim())
      initialItems[item.id] = {
        selected: !blocked && autoSelect,
        productId: item.productId,
        reasonCode: "",
        notes: "",
        imageUrl: "",
        quantity: item.quantity,
        uploading: false,
      }
    })
    setSelectedItemsForReturn(initialItems)
    setReturnMeta({
      returnType: "refund",
      description: "",
      videoUrl: "",
      refundMethod: "",
      upiId: "",
      bankAccountName: "",
      bankAccountNumber: "",
      bankIfsc: "",
      bankName: "",
    })
    setIsReturnModalOpen(true)
  }

  const handleImageUpload = async (orderItemId: string, file: File) => {
    setSelectedItemsForReturn(prev => ({
      ...prev,
      [orderItemId]: { ...prev[orderItemId], uploading: true }
    }))
    try {
      const formData = new FormData()
      formData.append("file", file)
      const token = window.localStorage.getItem("ziply5_access_token")
      const res = await fetch("/api/v1/uploads", {
        method: "POST",
        headers: { Authorization: `Bearer ${token}` },
        body: formData
      })
      const payload = await res.json()
      if (!res.ok || !payload.success) throw new Error(payload.message || "Upload failed")

      setSelectedItemsForReturn(prev => ({
        ...prev,
        [orderItemId]: { ...prev[orderItemId], imageUrl: payload.data.url, uploading: false }
      }))
    } catch (error) {
      toast.error("Upload Failed", error instanceof Error ? error.message : "Failed to upload image")
      setSelectedItemsForReturn(prev => ({
        ...prev,
        [orderItemId]: { ...prev[orderItemId], uploading: false }
      }))
    }
  }

  const submitReturnRequest = async () => {
    if (!selectedOrderForReturn) return

    const block = profileReturnEligibilityReason(selectedOrderForReturn)
    if (block === "active_return") {
      toast.error("Not eligible", "This order already has an active return request.")
      return
    }
    if (block === "no_items") {
      toast.error("Not eligible", "There are no additional items available to return on this order.")
      return
    }
    if (block === "not_delivered") {
      toast.error("Not eligible", "Returns are only available for delivered orders.")
      return
    }
    if (block === "missing_delivered_at") {
      toast.error("Not eligible", "Delivery date is not available yet.")
      return
    }
    if (block === "return_window_expired") {
      toast.error("Not eligible", `Return window is ${CUSTOMER_RETURN_WINDOW_DAYS} days after delivery.`)
      return
    }
    if (block) {
      toast.error("Not eligible", "Returns are not available for this order.")
      return
    }

    const returnedProductIds = getReturnedProductIds(selectedOrderForReturn)
    const itemsToReturn = Object.entries(selectedItemsForReturn)
      .filter(([_, data]) => data.selected && !returnedProductIds.has(String(data.productId ?? "").trim()))
      .map(([id, data]) => ({
        orderItemId: id,
        productId: data.productId,
        quantity: data.quantity,
        reasonCode: data.reasonCode,
        notes: data.notes,
        imageUrl: data.imageUrl
      }))

    if (itemsToReturn.length === 0) {
      toast.error("Validation Error", "Please select at least one return-eligible item.")
      return
    }

    for (const item of itemsToReturn) {
      if (!item.reasonCode) {
        toast.error("Validation Error", "Please select a reason for all selected items.")
        return
      }
    }

    if (returnMeta.returnType === "refund" && String(selectedOrderForReturn.paymentMethod ?? "").toLowerCase() === "cod") {
      const hasUpi = Boolean(returnMeta.upiId.trim())
      const hasBank = Boolean(returnMeta.bankAccountNumber.trim() && returnMeta.bankIfsc.trim())
      if (!hasUpi && !hasBank) {
        toast.error("Validation Error", "For COD refunds, enter a UPI ID or complete bank details.")
        return
      }
    }

    const token = window.localStorage.getItem("ziply5_access_token")
    if (!token) return
    setOrderActionBusy(`${selectedOrderForReturn.id}:return_request`)
    try {
      const bankDetails =
        returnMeta.refundMethod === "bank" && returnMeta.bankAccountNumber.trim()
          ? {
            accountName: returnMeta.bankAccountName.trim() || undefined,
            accountNumber: returnMeta.bankAccountNumber.trim(),
            ifsc: returnMeta.bankIfsc.trim(),
            bankName: returnMeta.bankName.trim() || undefined,
          }
          : undefined

      const res = await fetch(`/api/v1/returns`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${token}`,
        },
        body: JSON.stringify({
          orderId: selectedOrderForReturn.id,
          items: itemsToReturn,
          description: returnMeta.description.trim() || undefined,
          videoUrl: returnMeta.videoUrl.trim() || undefined,
          returnType: returnMeta.returnType,
          refundMethod: returnMeta.refundMethod || undefined,
          upiId: returnMeta.upiId.trim() || undefined,
          bankDetails,
          headerImages: itemsToReturn.map((i) => i.imageUrl).filter(Boolean),
        }),
      })
      const payload = await res.json()
      if (!res.ok || !payload.success) throw new Error(payload.message || "Failed to submit return request")

      toast.success("Return Requested", "Your return request has been submitted successfully.")
      setIsReturnModalOpen(false)
      void queryClient.invalidateQueries({ queryKey: ["profile-orders"] })
    } catch (error) {
      toast.error("Error", error instanceof Error ? error.message : "Failed to submit return request")
    } finally {
      setOrderActionBusy(null)
    }
  }

  useEffect(() => {
    if (initialTab === "favorite" || initialTab === "about" || initialTab === "orders") {
      setActiveTab(initialTab)
    }
  }, [initialTab])

  // Fetch User Profile Data
  const profileQuery = useQuery({
    queryKey: ["user-profile"],
    enabled: Boolean(authSnapshot.token),
    queryFn: async () => {
      const token = window.localStorage.getItem("ziply5_access_token");
      const userId = JSON.parse(window.localStorage.getItem("ziply5_user") || "{}").id;
      const res = await fetch(`/api/v1/profile?userId=${encodeURIComponent(userId)}`, {
        headers: {
          Authorization: `Bearer ${token}`,
          "x-user-id": userId
        },
      });
      const payload = await res.json();
      if (!res.ok || !payload.success) throw new Error(payload.message || "Failed to load profile");
      return payload.data;
    },
  });

  useEffect(() => {
    if (profileQuery.data) {
      setEditForm({
        name: profileQuery.data.name || "",
        bio: profileQuery.data.profile?.bio || "",
        phone: profileQuery.data.profile?.phone || "",
      })
    }
  }, [profileQuery.data])

  const updateProfileMutation = useMutation({
    mutationFn: async (payload: typeof editForm) => {
      const token = window.localStorage.getItem("ziply5_access_token")
      const userId = JSON.parse(window.localStorage.getItem("ziply5_user") || "{}").id
      if (!userId) throw new Error("User session not found. Please log in again.")

      const res = await fetch(`/api/v1/profile?userId=${encodeURIComponent(userId)}`, {
        method: "PATCH",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${token}`,
          "x-user-id": userId,
        },
        body: JSON.stringify(payload),
      })
      const data = await res.json()
      if (!data.success) throw new Error(data.message || "Update failed")
      return data
    },
    onSuccess: () => {
      toast.success("Profile Updated", "Your profile has been successfully updated.")
      void queryClient.invalidateQueries({ queryKey: ["user-profile"] })
      setIsManageModalOpen(false)
    },
    onError: (error: Error) => {
      toast.error("Update Failed", error.message)
    },
  })

  const deleteProfileMutation = useMutation({
    mutationFn: async () => {
      const token = window.localStorage.getItem("ziply5_access_token")
      const userId = JSON.parse(window.localStorage.getItem("ziply5_user") || "{}").id
      const res = await fetch(`/api/v1/profile?userId=${encodeURIComponent(userId)}`, {
        method: "DELETE",
        headers: {
          Authorization: `Bearer ${token}`,
          "x-user-id": userId,
        },
      })
      const data = await res.json()
      if (!data.success) throw new Error(data.message)
      return data
    },
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: ["user-profile"] })
      setIsManageModalOpen(false)
    },
  })

  useEffect(() => {
    const syncFavorites = () => setFavoriteSlugs(getFavoriteSlugs())
    syncFavorites()
    window.addEventListener("ziply5:favorites-updated", syncFavorites)
    window.addEventListener("storage", syncFavorites)
    return () => {
      window.removeEventListener("ziply5:favorites-updated", syncFavorites)
      window.removeEventListener("storage", syncFavorites)
    }
  }, [])

  useEffect(() => {
    const syncCartQty = () => {
      const items = getCartItems()
      const qtyMap = items.reduce<Record<string, number>>((acc, item) => {
        acc[item.slug] = item.quantity
        return acc
      }, {})
      setCartQtyBySlug(qtyMap)
    }

    syncCartQty()
    window.addEventListener("ziply5:cart-updated", syncCartQty)
    window.addEventListener("storage", syncCartQty)
    return () => {
      window.removeEventListener("ziply5:cart-updated", syncCartQty)
      window.removeEventListener("storage", syncCartQty)
    }
  }, [])

  useEffect(() => {
    const syncAuth = () => {
      setAuthSnapshot({
        token: window.localStorage.getItem("ziply5_access_token"),
        role: window.localStorage.getItem("ziply5_user_role"),
      })
    }
    syncAuth()
    window.addEventListener("storage", syncAuth)
    return () => window.removeEventListener("storage", syncAuth)
  }, [])

  useEffect(() => {
    const fetchDbFavorites = async () => {
      const token = window.localStorage.getItem("ziply5_access_token");
      if (!token) return;
      const userId = JSON.parse(window.localStorage.getItem("ziply5_user") || "{}").id;
      if (!userId) return;

      try {
        const res = await fetch("/api/v1/favorites", {
          headers: {
            Authorization: `Bearer ${token}`,
            "x-user-id": userId
          },
        });
        const payload = await res.json();
        if (payload.success && Array.isArray(payload.data)) {
          window.localStorage.setItem("ziply5-favorites", JSON.stringify(payload.data));
          setFavoriteSlugs(payload.data);
        }
      } catch (e) { /* ignore */ }
    };
    fetchDbFavorites();
  }, []);

  const ordersQuery = useQuery({
    queryKey: ["profile-orders"],
    enabled: activeTab === "orders" && Boolean(authSnapshot.token) && authSnapshot.role === "customer",
    queryFn: async () => {
      const token = window.localStorage.getItem("ziply5_access_token")
      if (!token) return []
      const res = await fetch("/api/v1/orders?page=1&limit=20", {
        headers: { Authorization: `Bearer ${token}` },
      })
      const payload = (await res.json()) as { success?: boolean; data?: { items: ApiOrderRow[] }; message?: string }
      const allItems = payload.data.items ?? []
      const filtered = allItems.filter((order) => {
        const isOnline = order.paymentMethod?.toLowerCase() === "razorpay"
        const isPaid =
          order.paymentStatus?.toLowerCase() === "paid" ||
          order.paymentStatus?.toLowerCase() === "success" ||
          order.transactions?.some((tx) =>
            ["paid", "success", "captured"].includes(tx.status?.toLowerCase())
          )
        return !isOnline || isPaid
      })
      return filtered
    },
  })

  useEffect(() => {
    setOrders(ordersQuery.data ?? [])
  }, [ordersQuery.data])

  useRealtimeTables({
    tables: ["orders", "returns", "refunds"],
    onChange: () => {
      if (activeTab === "orders") {
        void queryClient.invalidateQueries({ queryKey: ["profile-orders"] })
      }
    },
  })

  const runOrderAction = async (orderId: string, action: "cancel_request" | "return_request" | "cancel_pending") => {
    const token = window.localStorage.getItem("ziply5_access_token")
    if (!token) return false
    setOrderActionBusy(`${orderId}:${action}`)
    try {
      const res = await fetch(`/api/v1/orders/${orderId}/actions`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${token}`,
        },
        body: JSON.stringify({ action }),
      })
      const payload = (await res.json()) as { success?: boolean; message?: string }
      if (!res.ok || payload.success === false) {
        toast.error("Action failed", payload.message ?? "Request failed")
        return false
      }
      if (action === "cancel_request" || action === "cancel_pending") {
        toast.success("Order cancelled", "Your order has been cancelled.")
      }
      return true
    } finally {
      setOrderActionBusy(null)
      void queryClient.invalidateQueries({ queryKey: ["profile-orders"] })
    }
  }

  const favoriteProducts = useMemo(() => {
    return favoriteSlugs.map((slug) => {
      const existing = products.find((item) => item.slug === slug)
      if (existing) return existing

      const fallbackName = slug
        .split("-")
        .map((part) => part.charAt(0).toUpperCase() + part.slice(1))
        .join(" ")

      return {
        id: Number(`9${Math.abs(slug.length)}`),
        name: fallbackName,
        slug,
        price: 229.25,
        oldPrice: 310,
        weight: "95 g",
        description: "Favourite product",
        type: "non-veg" as const,
        category: "all",
        image: "/assets/product listing/Ziply5 - Pouch - Butter Chk Rice 3.png",
        gallery: [],
        labels: [],
        features: [],
        details: [],
        variants: [],
      }
    })
  }, [favoriteSlugs, products])

  const socialLinks = [
    { icon: Facebook, link: "https://facebook.com" },
    { icon: Twitter, link: "https://twitter.com" },
    { icon: Linkedin, link: "https://linkedin.com" },
    { icon: "G", link: "https://google.com" },
  ]

  const removeFavorite = async (slug: string, isMovingToCart = false) => {
    await toggleFavoriteSlug(slug)
    if (!isMovingToCart) {
      toast.info("Removed from wishlist", "The item has been removed from your favorites list.")
    }
    setFavoriteSlugs(getFavoriteSlugs())
  }

  const toCartProduct = (product: (typeof favoriteProducts)[number]) => ({
    ...product,
    id: String((product as any).id ?? product.slug),
    discountPercent: (product as any).discountPercent ?? undefined,
  })

  const moveFavoriteToCart = (product: (typeof favoriteProducts)[number]) => {
    setCartItemQuantity(toCartProduct(product), 1)
    removeFavorite(product.slug, true)
    toast.success("Added to Cart", `${product.name} has been moved to your cart.`)
  }

  const updateCartQty = (product: (typeof favoriteProducts)[number], delta: number) => {
    const currentQty = cartQtyBySlug[product.slug] ?? 0
    const nextQty = Math.max(0, currentQty + delta)
    setCartItemQuantity(toCartProduct(product), nextQty)
  }

  const handleLogout = async () => {
    const refreshToken = window.localStorage.getItem("ziply5_refresh_token")

    try {
      if (refreshToken) {
        await fetch("/api/v1/auth/logout", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ refreshToken }),
        })
      }
    } catch {
      // Ignore network/logout API errors and continue local logout.
    } finally {
      clearSession({ silent: true })
      router.push("/login")
    }
  }
  const cancelPendingOrder = async (orderId: string) => {
    const token = window.localStorage.getItem("ziply5_access_token")
    if (!token) return

    setOrderActionBusy(`${orderId}:cancel`)

    try {
      await fetch(`/api/v1/orders/${orderId}/cancel`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${token}`,
        },
      })
    } finally {
      setOrderActionBusy(null)
      void queryClient.invalidateQueries({ queryKey: ["profile-orders"] })
    }
  }
  const sectionTitle =
    activeTab === "about"
      ? "Personal Information"
      : activeTab === "favorite"
        ? "Wishlist"
        : "My orders"

  return (
    <div className="min-h-screen bg-[#f6f7fb] px-4 py-10 md:py-14">
      <div className="mx-auto w-full max-w-6xl">
        <h1 className="mb-6 text-2xl font-semibold text-[#111827]">My Account</h1>

        <div className="grid grid-cols-1 gap-6 md:grid-cols-[280px_1fr]">

          {/* LEFT SIDEBAR */}
          <div>
            <div
              className="w-full rounded-2xl bg-white p-2 shadow-sm ring-1 ring-black/5"
            >

              {/* TAB ITEM */}
              <div
                onClick={() => setActiveTab("about")}
                className={`flex items-center gap-3 rounded-xl px-4 py-3 cursor-pointer text-sm font-medium transition-colors ${activeTab === "about" ? "bg-[#FDE2E7] text-[#7A1F2A]" : "text-[#374151] hover:bg-[#F3F4F6]"
                  }`}
              >
                <User size={18} />
                <span className="font-medium">Personal Information</span>
              </div>

              <div
                onClick={() => setActiveTab("favorite")}
                className={`mt-1 flex items-center gap-3 rounded-xl cursor-pointer px-4 py-3 text-sm font-medium transition-colors ${activeTab === "favorite" ? "bg-[#FDE2E7] text-[#7A1F2A]" : "text-[#374151] hover:bg-[#F3F4F6]"
                  }`}
              >
                <Heart size={18} />
                <span className="font-medium">Wishlist</span>
              </div>

              <div
                onClick={() => setActiveTab("orders")}
                className={`mt-1 flex items-center gap-3 rounded-xl cursor-pointer px-4 py-3 text-sm font-medium transition-colors ${activeTab === "orders" ? "bg-[#FDE2E7] text-[#7A1F2A]" : "text-[#374151] hover:bg-[#F3F4F6]"
                  }`}
              >
                <Package size={18} />
                <span className="font-medium">My orders</span>
              </div>
            </div>
          </div>
          {/* RIGHT CONTENT */}
          <div className="w-full">
            <div className="rounded-2xl bg-white shadow-sm ring-1 ring-black/5">
              <div className="flex flex-col gap-3 border-b border-black/5 p-5 sm:flex-row sm:items-center sm:justify-between">
                <div className="min-w-0">
                  <p className="text-base font-semibold text-[#111827]">{sectionTitle}</p>
                  <p className="mt-0.5 text-xs text-[#6B7280]">Manage your account details and preferences.</p>
                </div>
                {activeTab === "about" && (
                  <button
                    type="button"
                    onClick={() => setIsManageModalOpen(true)}
                    className="h-10 rounded-xl bg-[#5A272A] px-4 text-xs font-semibold uppercase tracking-wide text-white hover:bg-[#451f21]"
                  >
                    Edit
                  </button>
                )}
              </div>

              <div className="p-5">
                {activeTab === "about" && (
                  <div className="space-y-6 text-sm gap-2">

                    <div className="flex">
                      <p className="w-24 font-bold text-gray-700">Bio</p>
                      <p className="text-gray-600 max-w-md italic">
                        {profileQuery.data?.profile?.bio || "No bio set yet. Click edit to add one!"}
                      </p>
                    </div>

                    <div className="flex">
                      <p className="w-24 font-bold text-gray-700">Email</p>
                      <p className="text-gray-600">{profileQuery.data?.email || "Loading..."}</p>
                    </div>

                    <div className="flex">
                      <p className="w-24 font-bold text-gray-700">Contact</p>
                      <p className="text-gray-600">{profileQuery.data?.profile?.phone || "Not provided"}</p>
                    </div>
                    <div className="flex">
                      <p className="w-24 font-bold text-gray-700">Address</p>
                      <p className="text-gray-600">
                        {profileQuery.data?.addresses?.[0]?.line1 || "No primary address set."}
                      </p>
                    </div>
                    <div className="flex">
                      <p className="w-24 font-bold text-gray-700">Addresses</p>
                      <Link href="/addresses" className="text-orange-600 underline hover:text-orange-700">
                        Manage saved addresses
                      </Link>
                    </div>

                    {/* <div className="flex">
                <p className="w-24 font-bold text-gray-700">Support</p>
                <Link href="/support" className="text-orange-600 underline hover:text-orange-700">
                  Open support center
                </Link>
              </div>

              <div className="flex">
                <p className="w-24 font-bold text-gray-700">Returns</p>
                <Link href="/my-returns" className="text-orange-600 underline hover:text-orange-700">
                  Track return/replace
                </Link>
              </div> */}
                    <div className="flex justify-between items-center w-full">
                      {/* <button
                        onClick={() => setIsManageModalOpen(true)}
                        className="mt-4 text-xs font-bold text-primary underline uppercase tracking-widest"
                      >
                        Manage Profile
                      </button> */}
                      <div className="">
                        {/* <button
              type="button"
              onClick={handleLogout}
              className="rounded-md bg-[#5A272A] px-4 py-2 text-xs font-semibold uppercase tracking-wide text-white hover:bg-[#451f21]"
            >
              Logout
            </button> */}
                      </div>
                    </div>

                    {/* SOCIAL */}
                    {/* <div className="flex items-center">
                <p className="w-24 font-bold text-gray-700">Social</p>

                <div className="flex gap-3">
                  {socialLinks.map((item, i) => {
                    const Icon = item.icon
                    return (
                      <a
                        key={i}
                        href={item.link}
                        target="_blank"
                        rel="noopener noreferrer"
                        className="w-8 h-8 flex items-center justify-center 
                        border border-gray-400 text-orange-500 
                        rounded-md cursor-pointer 
                        hover:bg-orange-500 hover:text-white transition"
                      >
                        {typeof Icon === "string" ? (
                          <span className="font-semibold">{Icon}</span>
                        ) : (
                          <Icon size={14} />
                        )}
                      </a>
                    )
                  })}
                </div>
              </div> */}

                  </div>
                )}

                {/* MANAGE PROFILE MODAL */}
                {isManageModalOpen && (
                  <div className="fixed inset-0 z-[200] flex items-center justify-center bg-black/60 p-4 backdrop-blur-sm" onClick={() => setIsManageModalOpen(false)}>
                    <div className="w-full max-w-md overflow-hidden rounded-3xl bg-white shadow-2xl" onClick={(e) => e.stopPropagation()}>
                      <div className="flex items-center justify-between bg-primary p-5 text-white">
                        <h3 className="font-melon text-lg font-bold uppercase tracking-wider">Manage Profile</h3>
                        <button onClick={() => setIsManageModalOpen(false)} className="rounded-full bg-white/20 p-1 hover:bg-white/30 transition-colors">
                          <X size={20} />
                        </button>
                      </div>

                      <form className="p-6 space-y-4" onSubmit={(e) => {
                        e.preventDefault()
                        updateProfileMutation.mutate(editForm)
                      }}>
                        <div>
                          <label className="block text-[10px] font-bold text-gray-400 uppercase tracking-widest mb-1">Full Name</label>
                          <input
                            type="text"
                            value={editForm.name}
                            onChange={(e) => setEditForm({ ...editForm, name: e.target.value })}
                            className="w-full rounded-xl border border-gray-200 px-4 py-3 text-sm focus:border-orange-500 focus:ring-1 focus:ring-orange-500 outline-none transition-all"
                          />
                        </div>

                        <div>
                          <label className="block text-[10px] font-bold text-gray-400 uppercase tracking-widest mb-1">Bio</label>
                          <textarea
                            rows={3}
                            value={editForm.bio}
                            onChange={(e) => setEditForm({ ...editForm, bio: e.target.value })}
                            className="w-full rounded-xl border border-gray-200 px-4 py-3 text-sm focus:border-orange-500 focus:ring-1 focus:ring-orange-500 outline-none transition-all resize-none"
                          />
                        </div>

                        <div>
                          <label className="block text-[10px] font-bold text-gray-400 uppercase tracking-widest mb-1">Contact Phone</label>
                          <input
                            type="text"
                            value={editForm.phone}
                            onChange={(e) => setEditForm({ ...editForm, phone: e.target.value })}
                            className="w-full rounded-xl border border-gray-200 px-4 py-3 text-sm focus:border-orange-500 focus:ring-1 focus:ring-orange-500 outline-none transition-all"
                          />
                        </div>

                        <div className="flex gap-3 pt-2">
                          <button
                            type="submit"
                            disabled={updateProfileMutation.isPending}
                            className="flex-1 rounded-xl bg-primary py-4 text-xs font-bold uppercase tracking-widest text-white shadow-lg hover:opacity-90 disabled:opacity-50 transition-all"
                          >
                            {updateProfileMutation.isPending ? "Updating..." : "Update Profile"}
                          </button>
                          {/* <button
                      type="button"
                      disabled={deleteProfileMutation.isPending}
                      onClick={() => {
                        if (confirm("Are you sure you want to clear your profile data?")) {
                          deleteProfileMutation.mutate()
                        }
                      }}
                      className="px-4 rounded-xl border-2 border-red-100 text-red-500 text-[10px] font-bold uppercase tracking-widest hover:bg-red-50 transition-all"
                    >
                      Delete
                    </button> */}
                        </div>
                      </form>
                    </div>
                  </div>
                )}
                {activeTab === "favorite" && (
                  <>
                    {favoriteProducts.length === 0 ? (
                      <p className="text-gray-500">No favorites yet.</p>
                    ) : (
                      <>
                        <div className="mb-5 flex items-center justify-between">
                          <p className="text-base font-semibold text-[#111827]">
                            Wishlist ({favoriteProducts.length})
                          </p>
                          <button
                            type="button"
                            onClick={() => {
                              favoriteProducts.forEach((p) => {
                                setCartItemQuantity(toCartProduct(p), 1)
                                removeFavorite(p.slug, true)
                              })
                              toast.success("Added to Cart", "All items have been moved to your cart.")
                            }}
                            className="rounded-md border border-[#D1D5DB] bg-white px-4 py-2 text-xs font-medium text-[#111827] hover:bg-[#F9FAFB]"
                          >
                            Move all to cart
                          </button>
                        </div>

                        <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-3 max-h-[50vh] overflow-y-auto ">
                          {favoriteProducts.map((product) => {
                            const comboProducts = ((product as any).bundleProducts ?? []) as Array<{
                              thumbnail?: string | null
                              name?: string
                            }>

                            const comboThumbs = comboProducts
                              .map((x) => (x?.thumbnail ?? "").trim())
                              .filter(Boolean)
                              .slice(0, 3)

                            const showComboThumbStrip =
                              Boolean((product as any).isCombo) &&
                              comboThumbs.length > 0

                            return (
                              <article
                                key={product.slug}
                                className="rounded-xl border border-[#E5E7EB] bg-white p-3 shadow-sm transition hover:shadow-md"
                              >
                                <div className="relative rounded-md bg-[#F8F9FB] p-3">
                                  <button
                                    type="button"
                                    onClick={() => removeFavorite(product.slug)}
                                    className="absolute right-2 top-2 h-7 w-7 z-10 rounded-full border border-[#E5E7EB] bg-white text-sm text-[#6B7280]"
                                    aria-label="Remove from wishlist"
                                  >
                                    ×
                                  </button>

                                  <Link
                                    href={
                                      (product as any).isCombo
                                        ? `/combo/${product.slug}`
                                        : `/product/${product.slug}`
                                    }
                                    className="block"
                                  >
                                    <div className="relative h-32 w-full">
                                      {showComboThumbStrip ? (
                                        <div className="flex flex-col sm:flex-row items-center justify-center gap-1 h-full">
                                          {comboThumbs.map((thumb, imageIdx) => (
                                            <div
                                              key={imageIdx}
                                              className="flex flex-col sm:flex-row items-center justify-center gap-1"
                                            >
                                              <div className="relative h-10 w-10 sm:h-12 sm:w-12">
                                                <Image
                                                  src={thumb}
                                                  alt={`${product.name} item ${imageIdx + 1}`}
                                                  fill
                                                  className="object-contain"
                                                />
                                              </div>
                                              {imageIdx < comboThumbs.length - 1 && (
                                                <span className="text-lg font-bold text-gray-400">
                                                  +
                                                </span>
                                              )}
                                            </div>
                                          ))}
                                        </div>
                                      ) : (
                                        <Image
                                          src={product.image}
                                          alt={product.name}
                                          fill
                                          className="object-contain"
                                        />
                                      )}
                                    </div>
                                  </Link>
                                </div>

                                <h3 className="mt-3 line-clamp-2 text-sm font-semibold text-[#111827]">
                                  {product.name}
                                </h3>

                                <p className="mt-1 text-xs text-[#6B7280]">
                                  {(product as any).isCombo
                                    ? "Combo Pack"
                                    : `Net wt. ${product.weight}`}
                                </p>

                                <p className="mt-2 text-sm font-semibold text-[#B91C1C]">
                                  Rs.{Number(product.price).toFixed(2)}
                                </p>

                                <div className="mt-3 flex items-center justify-end">
                                  <button
                                    type="button"
                                    onClick={(e) => {
                                      e.stopPropagation()
                                      if ((product as any).isCombo) {
                                        router.push(`/combo/${product.slug}`)
                                      } else {
                                        moveFavoriteToCart(product)
                                      }
                                    }}
                                    className="rounded-md border border-[#D1D5DB] px-3 py-1.5 text-xs font-medium text-[#111827] hover:bg-[#F9FAFB]"
                                  >
                                    {(product as any).isCombo
                                      ? "View Combo"
                                      : "Move to cart"}
                                  </button>
                                </div>
                              </article>
                            )
                          })}
                        </div>
                      </>
                    )}
                  </>
                )}

                {activeTab === "orders" && (
                  <div className="space-y-4 text-sm">
                    {!authSnapshot.token && (
                      <p className="text-gray-500">Please log in to see your orders.</p>
                    )}
                    {authSnapshot.token && authSnapshot.role && authSnapshot.role !== "customer" && (
                      <p className="text-gray-500">
                        Order history is available for customer accounts. Use the website login to shop and track orders.
                      </p>
                    )}
                    {authSnapshot.token && authSnapshot.role === "customer" && ordersQuery.isLoading && (
                      <p className="text-gray-500">Loading orders…</p>
                    )}
                    {authSnapshot.token && authSnapshot.role === "customer" && ordersQuery.error && (
                      <p className="text-red-600">{ordersQuery.error instanceof Error ? ordersQuery.error.message : "Could not load orders."}</p>
                    )}
                    {authSnapshot.token &&
                      authSnapshot.role === "customer" &&
                      !ordersQuery.isLoading &&
                      !ordersQuery.error &&
                      orders.length === 0 && <p className="text-gray-500">No orders yet.</p>}
                    {authSnapshot.token && authSnapshot.role === "customer" && orders.map((order) => {
                      const paymentStatus = order.paymentStatus ?? (order.transactions?.some((tx) => tx.status === "paid") ? "paid" : "pending")
                      const shippingStatus = (order.shipmentStatus ?? "pending").toLowerCase()
                      const previewItems = order.items.slice(0, 2)
                      const moreItems = Math.max(order.items.length - 2, 0)
                      const latestLifecycle = deriveLatestLifecycleToStatus(order.statusHistory, order.status)
                      const cancelRequested = orderHistoryHasCancelRequested(order.statusHistory)
                      const showCancel = shouldRenderCustomerCancelOrderButton({
                        latestLifecycle,
                        shipmentStatus: order.shipmentStatus ?? null,
                        shippingStatus: order.shippingStatus ?? null,
                        orderStatusLower: order.status.toLowerCase(),
                        cancelRequested,
                      })
                      return (<div
                        key={order.id}
                        className="rounded-2xl border border-[#E8DCC8] bg-white p-4 shadow-sm"
                      >
                        <div className="flex items-start justify-between gap-3">
                          <div className="space-y-1">
                            <p className="text-[11px] uppercase tracking-[0.15em] text-[#8A6A52]">Order {order.id.slice(0, 8)}</p>
                            <p className="text-xs text-[#646464]">
                              Order created on {new Date(order.createdAt).toLocaleDateString("en-GB", { day: "2-digit", month: "short", year: "numeric" })}
                            </p>
                          </div>
                          <div className="flex flex-col items-end gap-1">
                            {latestLifecycle === "rejected" ? (
                              <>
                                <span className="rounded-full bg-red-50 px-2.5 py-1 text-[10px] font-semibold uppercase text-red-700 ring-1 ring-red-200">
                                  Order Status: rejected
                                </span>
                                {(() => {
                                  const rej = order.statusHistory?.find((h) => String((h as any).reasonCode ?? "").toLowerCase() === "admin_rejected" || String(h.toStatus).toLowerCase() === "rejected")
                                  const noteText = (rej as any)?.notes || (order.statusHistory?.[0] as any)?.notes
                                  return noteText ? <p className="text-[11px] font-medium text-red-600">Reason: {noteText}</p> : null
                                })()}
                              </>
                            ) : (
                              <span className="rounded-full bg-[#FDF0E6] px-2.5 py-1 text-[10px] font-semibold uppercase text-[#7B3010]">
                                Order Status: {order.status}
                              </span>
                            )}
                          </div>
                        </div>

                        <div className="mt-3 space-y-1 text-sm text-[#2A1810]">
                          {previewItems.map((line, idx) => (
                            <p key={`${order.id}-${idx}`}>{line.product.name}</p>
                          ))}
                          {moreItems > 0 && <p className="text-xs text-[#646464]">+{moreItems} more items</p>}
                        </div>

                        <div className="mt-3 flex flex-wrap items-center justify-between gap-2">
                          <p className="font-semibold text-[#5A272A]">Rs. {Number(order.total).toFixed(2)}</p>
                          <p className="text-[11px] text-[#646464]">
                            {order.courierName ?? "Courier TBD"} • AWB {order.awbCode ?? order.trackingNumber ?? "Pending"}
                          </p>
                          {/* <span className="rounded-full border border-[#E8DCC8] px-2.5 py-1 text-[10px] font-semibold uppercase text-[#4A1D1F]">
                      {paymentStatus}
                    </span> */}
                        </div>

                        <div className="mt-3 flex flex-wrap items-center gap-2">
                          {showCancel && (
                            <button
                              type="button"
                              disabled={orderActionBusy === `${order.id}:cancel_request` || orderActionBusy === `${order.id}:cancel_pending`}
                              onClick={() => {
                                setSelectedOrderForCancel({ id: order.id, status: order.status })
                                setIsCancelModalOpen(true)
                              }}
                              className="rounded-md border border-[#E8DCC8] bg-white px-3 py-1.5 text-xs font-semibold uppercase tracking-wide text-[#4A1D1F] disabled:opacity-40"
                            >
                              Cancel Order
                            </button>
                          )}
                          {paymentStatus.toLowerCase() === "pending" && order.status.toLowerCase() !== "delivered" && order.status.toLowerCase() !== "cancelled" && (
                            <button
                              className="rounded-md border border-[#E8DCC8] bg-white px-3 py-1.5 text-xs font-semibold uppercase tracking-wide text-[#4A1D1F]"
                              type="button"
                              onClick={() =>
                                router.push(
                                  `/payment?orderId=${encodeURIComponent(order.id)}&amount=${encodeURIComponent(String(order.total ?? ""))}&name=${encodeURIComponent(order.customerName ?? "")}&phone=${encodeURIComponent(order.customerPhone ?? "")}&address=${encodeURIComponent(order.customerAddress ?? "")}`,
                                )
                              }
                            >
                              Pay Now
                            </button>
                          )}
                          {order.status.toLowerCase() === "delivered" && (
                            <button
                              type="button"
                              disabled={
                                orderActionBusy === `${order.id}:return_request` ||
                                Boolean(profileReturnEligibilityReason(order))
                              }
                              title={
                                profileReturnEligibilityReason(order) === "active_return"
                                  ? "An open return already exists for this order."
                                  : profileReturnEligibilityReason(order) === "return_window_expired"
                                    ? `Returns must be within ${CUSTOMER_RETURN_WINDOW_DAYS} days of delivery.`
                                    : undefined
                              }
                              onClick={() => openReturnModal(order)}
                              className="rounded-md border border-[#E8DCC8] bg-white px-3 py-1.5 text-xs font-semibold uppercase tracking-wide text-[#4A1D1F] disabled:opacity-40"
                            >
                              Return order
                            </button>
                          )}
                          {order.status.toLowerCase() === "delivered" && (
                            <button
                              type="button"
                              onClick={() => router.push(`/orders/${order.id}`)}
                              className="rounded-md border border-[#E8DCC8] bg-white px-3 py-1.5 text-xs font-semibold uppercase tracking-wide text-[#4A1D1F]"
                            >
                              Review
                            </button>
                          )}
                          {order.status.toLowerCase() !== "cancelled" && (
                            <button
                              type="button"
                              onClick={() => router.push(`/orders/${order.id}/track`)}
                              className="rounded-md border border-[#E8DCC8] bg-white px-3 py-1.5 text-xs font-semibold uppercase tracking-wide text-[#4A1D1F]"
                            >
                              Track my order
                            </button>
                          )}
                          <button
                            type="button"
                            onClick={() => router.push(`/orders/${order.id}`)}
                            className="ml-auto rounded-md bg-[#5A272A] px-3 py-1.5 text-xs font-semibold uppercase tracking-wide text-white"
                          >
                            View details →
                          </button>
                        </div>
                      </div>)
                    })}
                  </div>
                )}
              </div>


              {/* RETURN MODAL */}
              {isReturnModalOpen && selectedOrderForReturn && (
                <div className="fixed inset-0 z-[200] flex items-center justify-center bg-black/60 p-4 backdrop-blur-sm" onClick={() => setIsReturnModalOpen(false)}>
                  <div className="w-full max-w-2xl max-h-[90vh] overflow-y-auto rounded-3xl bg-white shadow-2xl" onClick={(e) => e.stopPropagation()}>
                    <div className="flex items-center justify-between bg-primary p-5 text-white sticky top-0 z-10">
                      <h3 className="font-melon text-lg font-bold uppercase tracking-wider">Return Request</h3>
                      <button onClick={() => setIsReturnModalOpen(false)} className="rounded-full bg-white/20 p-1 hover:bg-white/30 transition-colors">
                        <X size={20} />
                      </button>
                    </div>

                    <div className="p-6 space-y-6">
                      <p className="text-sm text-gray-600">Select the items you wish to return and provide a reason and photo for each.</p>

                      <div className="grid gap-3 sm:grid-cols-2">
                        <div>
                          <label className="block text-[10px] font-bold text-gray-400 uppercase tracking-widest mb-1">Return type</label>
                          <select
                            value={returnMeta.returnType}
                            onChange={(e) =>
                              setReturnMeta((m) => ({ ...m, returnType: e.target.value as "refund" | "exchange" }))
                            }
                            className="w-full rounded-xl border border-gray-200 px-3 py-2 text-sm"
                          >
                            <option value="refund">Refund</option>
                            <option value="exchange">Exchange</option>
                          </select>
                        </div>
                        <div>
                          <label className="block text-[10px] font-bold text-gray-400 uppercase tracking-widest mb-1">Video URL (optional)</label>
                          <input
                            value={returnMeta.videoUrl}
                            onChange={(e) => setReturnMeta((m) => ({ ...m, videoUrl: e.target.value }))}
                            className="w-full rounded-xl border border-gray-200 px-3 py-2 text-sm"
                            placeholder="https://…"
                          />
                        </div>
                      </div>

                      <div>
                        <label className="block text-[10px] font-bold text-gray-400 uppercase tracking-widest mb-1">Overall description</label>
                        <textarea
                          rows={2}
                          value={returnMeta.description}
                          onChange={(e) => setReturnMeta((m) => ({ ...m, description: e.target.value }))}
                          className="w-full rounded-xl border border-gray-200 px-3 py-2 text-sm resize-none"
                          placeholder="Describe the issue across items…"
                        />
                      </div>

                      {returnMeta.returnType === "refund" && String(selectedOrderForReturn.paymentMethod ?? "").toLowerCase() === "cod" && (
                        <div className="rounded-xl border border-amber-200 bg-amber-50 p-4 space-y-3">
                          <p className="text-xs font-semibold text-amber-900 uppercase">COD refund details</p>
                          <div className="grid gap-2 sm:grid-cols-2">
                            <div>
                              <label className="block text-[10px] font-bold text-gray-500 uppercase mb-1">Refund via</label>
                              <select
                                value={returnMeta.refundMethod}
                                onChange={(e) =>
                                  setReturnMeta((m) => ({ ...m, refundMethod: e.target.value as "" | "upi" | "bank" }))
                                }
                                className="w-full rounded-lg border border-gray-200 px-2 py-2 text-sm"
                              >
                                <option value="">Select</option>
                                <option value="upi">UPI</option>
                                <option value="bank">Bank transfer</option>
                              </select>
                            </div>
                            {returnMeta.refundMethod === "upi" && (
                              <div>
                                <label className="block text-[10px] font-bold text-gray-500 uppercase mb-1">UPI ID</label>
                                <input
                                  value={returnMeta.upiId}
                                  onChange={(e) => setReturnMeta((m) => ({ ...m, upiId: e.target.value }))}
                                  className="w-full rounded-lg border border-gray-200 px-2 py-2 text-sm"
                                />
                              </div>
                            )}
                          </div>
                          {returnMeta.refundMethod === "bank" && (
                            <div className="grid gap-2 sm:grid-cols-2">
                              <input
                                placeholder="Account holder"
                                value={returnMeta.bankAccountName}
                                onChange={(e) => setReturnMeta((m) => ({ ...m, bankAccountName: e.target.value }))}
                                className="rounded-lg border border-gray-200 px-2 py-2 text-sm"
                              />
                              <input
                                placeholder="Account number"
                                value={returnMeta.bankAccountNumber}
                                onChange={(e) => setReturnMeta((m) => ({ ...m, bankAccountNumber: e.target.value }))}
                                className="rounded-lg border border-gray-200 px-2 py-2 text-sm"
                              />
                              <input
                                placeholder="IFSC"
                                value={returnMeta.bankIfsc}
                                onChange={(e) => setReturnMeta((m) => ({ ...m, bankIfsc: e.target.value }))}
                                className="rounded-lg border border-gray-200 px-2 py-2 text-sm"
                              />
                              <input
                                placeholder="Bank name"
                                value={returnMeta.bankName}
                                onChange={(e) => setReturnMeta((m) => ({ ...m, bankName: e.target.value }))}
                                className="rounded-lg border border-gray-200 px-2 py-2 text-sm"
                              />
                            </div>
                          )}
                        </div>
                      )}

                      <div className="space-y-4">
                        {selectedOrderForReturn.items.map((item) => {
                          const itemState = selectedItemsForReturn[item.id]
                          if (!itemState) return null
                          const returnedProductIds = getReturnedProductIds(selectedOrderForReturn)
                          const blocked = returnedProductIds.has(String(item.productId ?? "").trim())

                          return (
                            <div key={item.id} className="border border-gray-200 rounded-xl p-4 space-y-4">
                              <div className="flex items-start gap-3">
                                <input
                                  type="checkbox"
                                  className="mt-1 w-4 h-4 text-primary"
                                  checked={itemState.selected}
                                  onChange={(e) => setSelectedItemsForReturn(prev => ({
                                    ...prev,
                                    [item.id]: { ...prev[item.id], selected: e.target.checked }
                                  }))}
                                />
                                <div>
                                  <p className="text-sm font-semibold text-gray-900">{item.product.name}</p>
                                  <p className="text-xs text-gray-500">Qty: {item.quantity}</p>
                                  {blocked ? <p className="text-[11px] font-semibold text-amber-700">Return already requested for this product.</p> : null}
                                </div>
                              </div>

                              {itemState.selected && !blocked && (
                                <div className="pl-7 space-y-3">
                                  <div>
                                    <label className="block text-[10px] font-bold text-gray-400 uppercase tracking-widest mb-1">Reason</label>
                                    <select
                                      value={itemState.reasonCode}
                                      onChange={(e) => setSelectedItemsForReturn(prev => ({
                                        ...prev,
                                        [item.id]: { ...prev[item.id], reasonCode: e.target.value }
                                      }))}
                                      className="w-full rounded-xl border border-gray-200 px-3 py-2 text-sm focus:border-orange-500 focus:ring-1 outline-none"
                                    >
                                      <option value="">Select a reason</option>
                                      {returnReasons.map(r => (
                                        <option key={r.id} value={r.value}>{r.label}</option>
                                      ))}
                                    </select>
                                  </div>

                                  <div>
                                    <label className="block text-[10px] font-bold text-gray-400 uppercase tracking-widest mb-1">Details / Issue</label>
                                    <textarea
                                      rows={2}
                                      value={itemState.notes}
                                      onChange={(e) => setSelectedItemsForReturn(prev => ({
                                        ...prev,
                                        [item.id]: { ...prev[item.id], notes: e.target.value }
                                      }))}
                                      placeholder="Describe the issue..."
                                      className="w-full rounded-xl border border-gray-200 px-3 py-2 text-sm focus:border-orange-500 focus:ring-1 outline-none resize-none"
                                    />
                                  </div>

                                  <div>
                                    <label className="block text-[10px] font-bold text-gray-400 uppercase tracking-widest mb-1">Photo Evidence</label>
                                    <div className="flex items-center gap-3">
                                      <label className="cursor-pointer flex items-center gap-2 rounded-lg border border-gray-300 px-3 py-2 text-xs font-medium text-gray-700 hover:bg-gray-50">
                                        <Camera size={14} />
                                        <span>{itemState.uploading ? "Uploading..." : "Upload Photo"}</span>
                                        <input
                                          type="file"
                                          accept="image/*"
                                          className="hidden"
                                          disabled={itemState.uploading}
                                          onChange={(e) => {
                                            if (e.target.files && e.target.files[0]) {
                                              void handleImageUpload(item.id, e.target.files[0])
                                            }
                                          }}
                                        />
                                      </label>
                                      {itemState.imageUrl && (
                                        <span className="text-xs text-green-600 font-medium">Image attached ✓</span>
                                      )}
                                    </div>
                                  </div>
                                </div>
                              )}
                            </div>
                          )
                        })}
                      </div>

                      <div className="flex gap-3 pt-4 border-t border-gray-100">
                        <button
                          type="button"
                          onClick={() => setIsReturnModalOpen(false)}
                          className="flex-1 rounded-xl border border-gray-200 py-3 text-xs font-bold uppercase tracking-widest text-gray-600 hover:bg-gray-50 transition-all"
                        >
                          Cancel
                        </button>
                        <button
                          type="button"
                          onClick={() => void submitReturnRequest()}
                          disabled={orderActionBusy === `${selectedOrderForReturn.id}:return_request`}
                          className="flex-1 rounded-xl bg-primary py-3 text-xs font-bold uppercase tracking-widest text-white shadow-md hover:opacity-90 disabled:opacity-50 transition-all"
                        >
                          {orderActionBusy === `${selectedOrderForReturn.id}:return_request` ? "Submitting..." : "Submit Return Request"}
                        </button>
                      </div>
                    </div>
                  </div>
                </div>
              )}

              {/* CANCEL CONFIRMATION MODAL */}
              {isCancelModalOpen && selectedOrderForCancel && (
                <div className="fixed inset-0 z-[200] flex items-center justify-center bg-black/60 p-4 backdrop-blur-sm" onClick={() => setIsCancelModalOpen(false)}>
                  <div className="w-full max-w-md rounded-3xl bg-white shadow-2xl overflow-hidden" onClick={(e) => e.stopPropagation()}>
                    <div className="bg-primary p-5 text-white flex items-center justify-between">
                      <h3 className="font-melon text-lg font-bold uppercase tracking-wider">Confirm Cancellation</h3>
                      <button onClick={() => setIsCancelModalOpen(false)} className="rounded-full bg-white/20 p-1 hover:bg-white/30 transition-colors">
                        <X size={20} />
                      </button>
                    </div>
                    <div className="p-6 text-center">
                      <p className="text-gray-600 mb-6">Are you sure you want to cancel order #{selectedOrderForCancel.id.slice(0, 8)}? This action cannot be undone.</p>
                      <div className="flex gap-3">
                        <button
                          type="button"
                          onClick={() => setIsCancelModalOpen(false)}
                          className="flex-1 rounded-xl border border-gray-200 py-3 text-xs font-bold uppercase tracking-widest text-gray-600 hover:bg-gray-50 transition-all"
                        >
                          Go Back
                        </button>
                        <button
                          type="button"
                          onClick={() => {
                            void (async () => {
                              const ok = await runOrderAction(
                                selectedOrderForCancel.id,
                                selectedOrderForCancel.status.toLowerCase() === "pending" ? "cancel_pending" : "cancel_request",
                              )
                              if (ok) setIsCancelModalOpen(false)
                            })()
                          }}
                          disabled={
                            orderActionBusy === `${selectedOrderForCancel.id}:cancel_request` ||
                            orderActionBusy === `${selectedOrderForCancel.id}:cancel_pending`
                          }
                          className="flex-1 rounded-xl bg-red-600 py-3 text-xs font-bold uppercase tracking-widest text-white shadow-md hover:bg-red-700 transition-all disabled:opacity-50"
                        >
                          {orderActionBusy === `${selectedOrderForCancel.id}:cancel_request` ||
                            orderActionBusy === `${selectedOrderForCancel.id}:cancel_pending`
                            ? "Processing…"
                            : "Confirm"}
                        </button>
                      </div>
                    </div>
                  </div>
                </div>
              )}

            </div>
          </div>
        </div>

      </div>
    </div>
  )
}

export default function ProfilePage() {
  return (
    <Suspense
      fallback={
        <div className="flex min-h-[40vh] items-center justify-center bg-[#F5F1E6] text-sm text-[#5A272A]">
          Loading…
        </div>
      }
    >
      <ProfilePageContent />
    </Suspense>
  )
}