"use client"

import Link from "next/link"
import { usePathname, useRouter } from "next/navigation"
import { Heart, Menu, X } from "lucide-react"
import { useState, useRef, useEffect, useCallback, Fragment } from "react"
import Image from "next/image"
import CartDropdown from "./CartDropdown"
import { useSearch } from "../hooks/useSearch"
import LocationDropdown from "./LocationDropdown"
import { Search, User, ShoppingCart } from "lucide-react"
import { getCartItems, setCartItems, type CartItem } from "@/lib/cart"
import { AnimatePresence, m, useReducedMotion } from "framer-motion"
import { clearSession } from "@/lib/auth-session"
import { getFavoriteSlugs } from "@/lib/favorites"

type MenuCategory = {
  id: string
  name: string
  slug: string
  products: Array<{ id: string; name: string; slug: string }>
}

type ApiCategory = { id?: string; name?: string; slug?: string }
type ApiProduct = {
  id?: string
  name?: string
  slug?: string
  categories?: Array<{ categoryId?: string; category?: { id?: string } }>
}

export default function Header() {
  const pathname = usePathname()
  const router = useRouter()
  const reduce = useReducedMotion()
  const [menuOpen, setMenuOpen] = useState(false)
  const { searchOpen, setSearchOpen, searchQuery, setSearchQuery, searchResults, handleSearch } = useSearch()
  const [cartItems, setLocalCartItems] = useState<CartItem[]>([])
  const [cartOpen, setCartOpen] = useState(false)
  const [profileHref, setProfileHref] = useState("/login")
  const [isLoggedIn, setIsLoggedIn] = useState(false)
  const [userDropdownOpen, setUserDropdownOpen] = useState(false)
  const userDropdownRef = useRef<HTMLDivElement>(null)
  const [menuCategories, setMenuCategories] = useState<MenuCategory[]>([])
  const closeCartTimeoutRef = useRef<number | null>(null)
  const [cmsData, setCmsData] = useState<any>(null)
  const [wishlistCount, setWishlistCount] = useState(0)
  const [productUsageNav, setProductUsageNav] = useState<{ title: string; url: string; enabled: boolean } | null>(null)

  const productRef = useRef<HTMLDivElement>(null)
  const [productDropdownOpen, setProductDropdownOpen] = useState(false)
  const [arrowLeft, setArrowLeft] = useState(0)

  useEffect(() => {
    if (!pathname) return

    const excludedPaths = [
      "/login",
      "/signup",
      "/forgotPassword",
      "/reset-password",
      "/resetPassword",
    ]

    const isExcluded = excludedPaths.some((p) => pathname.startsWith(p)) || pathname.startsWith("/api")

    if (!isExcluded) {
      const fullPath = pathname + window.location.search
      window.sessionStorage.setItem("ziply5_last_visited", fullPath)
    }
  }, [pathname])

  const loadMenuData = useCallback(async () => {
    try {
      const [catsRes, productsRes] = await Promise.all([
        fetch("/api/v1/categories").then((r) => r.json()).catch(() => ({ data: [] })),
        // Dropdown only needs a small subset; reduce load.
        fetch("/api/v1/products?page=1&limit=80").then((r) => r.json()).catch(() => ({ data: { items: [] } })),
      ])

      const cats = ((catsRes as { data?: ApiCategory[] })?.data ?? [])
        .filter((c) => c.id && c.name)
        .map((c) => ({
          id: c.id as string,
          name: c.name as string,
          slug: (c.slug ?? c.name ?? "").toString(),
        }))

      const products = ((productsRes as { data?: { items?: ApiProduct[] } })?.data?.items ?? [])
        .filter((p) => p.id && p.name && p.slug)

      let grouped = cats.map((cat) => ({
        ...cat,
        products: products
          .filter((p) =>
            p.categories?.some((x) => x.category?.id === cat.id || x.categoryId === cat.id),
          )
          .map((p) => ({ id: p.id as string, name: p.name as string, slug: p.slug as string })),
      }))

      const hasAnyMappedProducts = grouped.some((g) => g.products.length > 0)
      if (!hasAnyMappedProducts && cats.length > 0 && products.length > 0) {
        grouped = grouped.map((g, idx) => ({
          ...g,
          products:
            idx === 0
              ? products.map((p) => ({
                id: p.id as string,
                name: p.name as string,
                slug: p.slug as string,
              }))
              : [],
        }))
      }

      setMenuCategories(grouped.filter((c) => c.products.length > 0).slice(0, 8))
    } catch {
      setMenuCategories([])
    }
  }, [])

  const persistCart = (next: CartItem[]) => {
    setLocalCartItems(next)
    setCartItems(next)
  }

  const updateCartQuantity = (id: string, delta: number) => {
    const current = cartItems.find((item) => item.id === id)
    if (!current) return

    const nextQty = current.quantity + delta
    const next =
      nextQty <= 0
        ? cartItems.filter((item) => item.id !== id)
        : cartItems.map((item) => (item.id === id ? { ...item, quantity: nextQty } : item))

    persistCart(next)
  }

  const openCart = () => {
    if (closeCartTimeoutRef.current) {
      window.clearTimeout(closeCartTimeoutRef.current)
      closeCartTimeoutRef.current = null
    }
    setCartOpen(true)
  }

  const closeCartWithDelay = () => {
    if (closeCartTimeoutRef.current) {
      window.clearTimeout(closeCartTimeoutRef.current)
    }
    closeCartTimeoutRef.current = window.setTimeout(() => {
      setCartOpen(false)
    }, 180)
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
      setUserDropdownOpen(false)
      setIsLoggedIn(false)
      setProfileHref("/login")

      // Notify other components/tabs
      window.dispatchEvent(new Event("storage"))

      router.push("/login")
    }
  }

  useEffect(() => {
    const handleOutsideClick = (e: MouseEvent) => {
      if (userDropdownRef.current && !userDropdownRef.current.contains(e.target as Node)) {
        setUserDropdownOpen(false)
      }
    }
    document.addEventListener("mousedown", handleOutsideClick)
    return () => document.removeEventListener("mousedown", handleOutsideClick)
  }, [])

  useEffect(() => {
    const syncCart = () => setLocalCartItems(getCartItems())
    const syncWishlist = () => setWishlistCount(getFavoriteSlugs().length)
    const syncProfileHref = () => {
      const token = window.localStorage.getItem("ziply5_access_token")
      const role = window.localStorage.getItem("ziply5_user_role")
      setIsLoggedIn(Boolean(token))
      if (!token || role === "admin" || role === "super_admin") {
        setProfileHref("/login")
        return
      }
      setProfileHref("/profile")
    }

    const fetchCmsData = async () => {
      try {
        const res = await fetch("/api/v1/cms/pages?slug=header")
        const json = await res.json()
        if (json.data) {
          const headerContent = json.data.sections?.find((s: any) => s.sectionType === 'header')?.contentJson || {}
          setCmsData(headerContent)
        }
      } catch (err) {
        console.error("Failed to load header CMS data", err)
      }
    }

    const fetchNavData = async () => {
      try {
        const res = await fetch("/api/v1/navigation")
        const json = await res.json()
        if (json.data?.productUsage) {
          setProductUsageNav(json.data.productUsage)
        }
      } catch {
        /* fallback to default */
      }
    }

    syncCart()
    syncWishlist()
    syncProfileHref()
    void loadMenuData()
    void fetchCmsData()
    void fetchNavData()

    window.addEventListener("ziply5:cart-updated", syncCart)
    window.addEventListener("ziply5:favorites-updated", syncWishlist)
    window.addEventListener("storage", syncProfileHref)
    window.addEventListener("storage", syncCart)
    window.addEventListener("storage", syncWishlist)
    return () => {
      if (closeCartTimeoutRef.current) {
        window.clearTimeout(closeCartTimeoutRef.current)
      }
      window.removeEventListener("ziply5:cart-updated", syncCart)
      window.removeEventListener("ziply5:favorites-updated", syncWishlist)
      window.removeEventListener("storage", syncProfileHref)
      window.removeEventListener("storage", syncCart)
      window.removeEventListener("storage", syncWishlist)
    }
  }, [loadMenuData])

  // Sync cart for logged-in users only (avoids post-logout sync clearing abandon state / reminders).
  useEffect(() => {
    const hasSession =
      typeof window !== "undefined" ? !!window.localStorage.getItem("ziply5_refresh_token") : false;
    let sessionKey = typeof window !== "undefined" ? window.localStorage.getItem("ziply5_session_key") : null;

    if (!sessionKey && typeof window !== "undefined") {
      sessionKey = "sess_" + Math.random().toString(36).substring(2, 15);
      window.localStorage.setItem("ziply5_session_key", sessionKey);
    }

    if (!hasSession || !sessionKey || cartItems.length === 0) return;

    const subTotal = cartItems.reduce((acc, item) => acc + item.price * item.quantity, 0);

    // Let the global interceptor automatically inject the fresh Bearer token (handles silent refresh if expired)
    void fetch("/api/checkout/start", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        sessionKey,
        items: cartItems,
        total: subTotal,
        eventType: "cart_updated",
        meta: {
          checkoutStage: "CART_ACTIVE",
          lastVisitedPage: pathname || "/",
        },
      }),
    }).catch(() => null);
  }, [cartItems, pathname]);

  const cartCount = cartItems.reduce((sum, item) => sum + item.quantity, 0)
  const total = cartItems.reduce((sum, item) => sum + item.price * item.quantity, 0)

  return (
    <header className="sticky top-0 z-[100]">
      {/* Top Marquee Bar */}
      <div className="bg-yellow-400 py-1.5 overflow-hidden relative z-0">
        <style>{`
          @keyframes seamless-marquee {
            0% { transform: translateX(0%); }
            100% { transform: translateX(-50%); }
          }
          .animate-seamless-marquee {
            animation: seamless-marquee 40s linear infinite;
            will-change: transform;
          }
          .animate-seamless-marquee:hover {
            animation-play-state: paused;
          }
        `}</style>
        <div className="marquee-container flex whitespace-nowrap animate-seamless-marquee" style={{ width: 'max-content' }}>
          {(() => {
            const customItems = cmsData?.marqueeItems?.filter((i: string) => typeof i === 'string' && i.trim() !== "");
            let itemsToUse = [];
            if (customItems?.length > 0) {
              const repeatedItems = [];
              while (repeatedItems.length < 20) {
                repeatedItems.push(...customItems);
              }
              itemsToUse = repeatedItems;
            } else if (cmsData?.marqueeText?.trim()) {
              itemsToUse = Array(20).fill(cmsData.marqueeText);
            } else {
              itemsToUse = Array(20).fill("Welcome To Ziply5");
            }

            const elements = itemsToUse.map((item: string, idx: number) => (
              <Fragment key={idx}>
                <span className="marquee-item ">{item}</span>
                <span className="marquee-dot">•</span>
              </Fragment>
            ));

            return (
              <>
                <div className="marquee-content flex shrink-0 items-center" style={{ animation: 'none' }}>
                  {elements}
                </div>
                <div className="marquee-content flex shrink-0 items-center" aria-hidden="true" style={{ animation: 'none' }}>
                  {elements}
                </div>
              </>
            );
          })()}
        </div>
      </div>

      {/* Mobile Location & Profile Bar */}
      <div className="bg-[#601c10] text-white lg:hidden px-4 py-0.5 flex items-center justify-between">
        <div className="text-white [&_*]:text-white">
          <LocationDropdown />
        </div>
        <Link href={profileHref} className="p-1 hover:bg-white/10 rounded-full transition-colors">
          <User size={20} className="text-white" />
        </Link>
      </div>

      {/* Navigation */}
      <nav className="bg-white w-full relative z-10">
        <div className="w-full px-4 max-w-7xl mx-auto flex items-center justify-between py-2 md:py-0 relative">

          {/* MOBILE SEARCH BUTTON */}
          <button
            onClick={() => setSearchOpen(!searchOpen)}
            className="lg:hidden flex items-center gap-2 bg-[#e6e6e6] px-3 py-1.5 rounded-lg w-auto"
          >
            <Search size={16} className="text-[#601c10]" />

          </button>

          <div className="hidden lg:flex items-center gap-8">

            {/* PRODUCTS WITH DROPDOWN */}
            <div
              ref={productRef}
              className="relative flex flex-col items-center"
              onMouseEnter={() => {
                setProductDropdownOpen(true)
                if (productRef.current) {
                  const rect = productRef.current.getBoundingClientRect()
                  setArrowLeft(rect.left + rect.width / 2)
                }
                if (menuCategories.length === 0) {
                  void loadMenuData()
                }
              }}
              onMouseLeave={() => setProductDropdownOpen(false)}
            >
              <Link
                href="/products"
                onClick={() => setProductDropdownOpen(false)}
                className="font-extrabold text-black hover:text-[#f97316] transition-colors text-[15px]"
              >
                Products
              </Link>

              {/* DROPDOWN */}
              <div className={`absolute left-0 top-[calc(100%+16px)] w-[100vw] flex justify-start ${productDropdownOpen ? "opacity-100 visible" : "opacity-0 invisible"} transition-all duration-300`}>

                <div className="relative w-auto max-w-7xl">

                  {/*  DYNAMIC ARROW */}
                  {/* <div
                    className="absolute -top-3 w-0 h-0 
                      border-l-[10px] border-r-[10px] border-b-[10px] 
                      border-l-transparent border-r-transparent border-b-[#7a1e0e] transition-all duration-200"
                    style={{
                      left: arrowLeft,
                      transform: "translateX(-10%)"
                    }}
                  /> */}

                  <div className="bg-[#7a1e0e] text-white rounded-2xl shadow-xl p-10">
                    <div className="grid grid-cols-3 gap-5">
                      {menuCategories.length === 0 ? (
                        <div className="col-span-4 text-sm text-white/80">No categories with products yet.</div>
                      ) : (
                        menuCategories.map((category) => (
                          <div key={category.id}>
                            <h3 className="text-lg font-bold mb-4">{category.name}</h3>
                            <ul className="space-y-3">
                              {category.products.slice(0, 8).map((product, idx) => (
                                <li key={product.id}>
                                  <Link
                                    href={`/product/${product.slug}`}
                                    onClick={() => setProductDropdownOpen(false)}
                                    className={`${pathname === `/product/${product.slug}` ? "text-orange-400 font-semibold" : "text-white"} hover:underline`}
                                  >
                                    {product.name}
                                  </Link>
                                </li>
                              ))}
                            </ul>
                          </div>
                        ))
                      )}
                    </div>
                  </div>

                </div>
              </div>
            </div>

            <Link href={cmsData?.link1Url || "/#best-sellers"} className="font-extrabold text-black hover:text-[#f97316] transition-colors text-[15px]">
              {cmsData?.link1Title || "Best Sellers"}
            </Link>

            <Link
              href={cmsData?.link2Url || "/products?type=combo"}
              className="font-extrabold text-black hover:text-[#f97316] transition-colors text-[15px]"
            >
              {cmsData?.link2Title || "Combos"}
            </Link>

            {productUsageNav?.enabled !== false && (
              <Link
                href={productUsageNav?.url || "/product-usage"}
                className="font-extrabold text-black hover:text-[#f97316] transition-colors text-[15px]"
              >
                {productUsageNav?.title || "How to Use"}
              </Link>
            )}
          </div>

          <div className="absolute left-1/2 top-1/2 -translate-x-1/2 -translate-y-1/2 lg:static lg:translate-x-0 lg:translate-y-0 flex-none flex justify-center z-20 pointer-events-none lg:pointer-events-auto">
            <Link href="/" className="flex items-center pointer-events-auto">
              <Image
                src={cmsData?.logo || "/primaryLogo.png"}
                alt="ZiPLY5 Logo"
                width={180}
                height={80}
                priority
                className="h-auto w-36 lg:w-auto object-contain"
              />
            </Link>
          </div>

          <div className="flex items-center gap-3 md:gap-5">

            <div className="hidden lg:block">
              <LocationDropdown />
            </div>

            <button
              onClick={() => setSearchOpen(!searchOpen)}
              className="hidden lg:block p-2 hover:bg-zinc-50 cursor-pointer rounded-full transition-colors"
              title="Click and Search For Delicious meals.."
            >
              <Search size={20} className="text-zinc-700 hover:text-[#f97316]" />
            </button>

            <div className="hidden lg:flex items-center gap-6">
              <Link
                href="/profile?tab=favorite"
                onClick={() => setMenuOpen(false)}
                className="relative flex items-center justify-center w-8 h-8 rounded-full hover:bg-zinc-50 transition-colors"
                title="Go to wishlist"
              >
                <Heart size={20} className="text-zinc-700 hover:text-[#f97316]" />
                {wishlistCount > 0 && (
                  <m.span
                    key={wishlistCount}
                    initial={reduce ? undefined : { scale: 0.9 }}
                    animate={reduce ? undefined : { scale: [1, 1.15, 1] }}
                    transition={reduce ? undefined : { duration: 0.35, ease: "easeOut" }}
                    className="absolute -top-1.5 -right-1.5 flex h-4 min-w-4 items-center justify-center rounded-full bg-[#f97316] px-1 text-[10px] font-bold text-white"
                  >
                    {wishlistCount}
                  </m.span>
                )}
              </Link>
              <div className="relative" ref={userDropdownRef}>
                <button
                  onClick={() => setUserDropdownOpen(!userDropdownOpen)}
                  className="p-2 hover:bg-zinc-50 rounded-full transition-colors cursor-pointer flex items-center justify-center"
                  title="User Options"
                >
                  <User size={20} className="text-zinc-700 hover:text-[#f97316]" />
                </button>

                {/* Dropdown Menu */}
                {userDropdownOpen && (
                  <div className="absolute right-0 mt-2 w-48 rounded-2xl bg-white border border-[#E8DCC8] p-2 shadow-xl z-[110] animate-in fade-in slide-in-from-top-2 duration-200">
                    {isLoggedIn ? (
                      <>
                        <Link
                          href={profileHref}
                          onClick={() => setUserDropdownOpen(false)}
                          className="flex w-full items-center px-4 py-2.5 text-sm font-semibold text-zinc-700 hover:bg-[#FFFBF3] hover:text-[#7B3010] rounded-xl transition-colors"
                        >
                          My Profile
                        </Link>
                        <Link
                          href="/profile?tab=orders"
                          onClick={() => setUserDropdownOpen(false)}
                          className="flex w-full items-center px-4 py-2.5 text-sm font-semibold text-zinc-700 hover:bg-[#FFFBF3] hover:text-[#7B3010] rounded-xl transition-colors"
                        >
                          My Orders
                        </Link>
                        <div className="my-1 border-t border-black/5" />
                        <button
                          onClick={() => {
                            void handleLogout()
                          }}
                          className="flex w-full items-center px-4 py-2.5 text-sm font-semibold text-red-600 hover:bg-red-50 rounded-xl transition-colors text-left"
                        >
                          Logout
                        </button>
                      </>
                    ) : (
                      <Link
                        href="/login"
                        onClick={() => setUserDropdownOpen(false)}
                        className="flex w-full items-center px-4 py-2.5 text-sm font-semibold text-zinc-700 hover:bg-[#FFFBF3] hover:text-[#7B3010] rounded-xl transition-colors"
                      >
                        Login
                      </Link>
                    )}
                  </div>
                )}
              </div>
            </div>

            {/* MOBILE MENU BUTTON (Right Side) */}
            <button
              className="lg:hidden z-40 p-1"
              onClick={() => setMenuOpen(!menuOpen)}
            >
              {menuOpen ? <X size={26} className="text-[#601c10]" /> : <Menu size={26} className="text-[#601c10]" />}
            </button>

            {/* CART WITH DROPDOWN */}
            <div className="relative" onMouseEnter={openCart} onMouseLeave={closeCartWithDelay}>
              <Link
                href="/cart"
                className="relative flex items-center justify-center w-8 h-8 rounded-full hover:bg-zinc-50 transition-colors"
              >
                <ShoppingCart size={20} className="text-zinc-700 hover:text-[#f97316]" />
                {cartCount > 0 && (
                  <m.span
                    key={cartCount}
                    initial={reduce ? undefined : { scale: 0.9 }}
                    animate={reduce ? undefined : { scale: [1, 1.15, 1] }}
                    transition={reduce ? undefined : { duration: 0.35, ease: "easeOut" }}
                    className="absolute -top-1.5 -right-1.5 flex h-4 min-w-4 items-center justify-center rounded-full bg-[#f97316] px-1 text-[10px] font-bold text-white"
                  >
                    {cartCount}
                  </m.span>
                )}
              </Link>

              <div className="hidden lg:block">
                <CartDropdown
                  items={cartItems}
                  total={total}
                  open={cartOpen}
                  onIncrement={(id) => updateCartQuantity(id, 1)}
                  onDecrement={(id) => updateCartQuantity(id, -1)}
                />
              </div>

            </div>

          </div>
        </div>
      </nav>

      <AnimatePresence initial={false}>
        {menuOpen ? (
          <m.div
            key="mobile-menu"
            initial={reduce ? { opacity: 1 } : { opacity: 0, y: -8 }}
            animate={reduce ? { opacity: 1 } : { opacity: 1, y: 0 }}
            exit={reduce ? { opacity: 0 } : { opacity: 0, y: -8 }}
            transition={reduce ? { duration: 0.12 } : { duration: 0.22, ease: "easeOut" }}
            className="lg:hidden bg-white border-t px-6 py-4 space-y-4 shadow-md"
          >
            {/* <div className="pb-4 border-b">
              <LocationDropdown />
            </div> */}

            <Link href="/products" onClick={() => setMenuOpen(false)} className="block font-semibold text-black">
              Products
            </Link>
            <Link href={cmsData?.link1Url || "/#best-sellers"} onClick={() => setMenuOpen(false)} className="block font-semibold text-black">
              {cmsData?.link1Title || "Best Sellers"}
            </Link>
            <Link
              href={cmsData?.link2Url || "/products?type=combo"}
              onClick={() => setMenuOpen(false)}
              className="block font-semibold text-black"
            >
              {cmsData?.link2Title || "Combos"}
            </Link>
            <Link href="/about" onClick={() => setMenuOpen(false)} className="block font-semibold text-black">
              About
            </Link>
            {productUsageNav?.enabled !== false && (
              <Link
                href={productUsageNav?.url || "/product-usage"}
                onClick={() => setMenuOpen(false)}
                className="block font-semibold text-black"
              >
                {productUsageNav?.title || "How to Use"}
              </Link>
            )}
          </m.div>
        ) : null}
      </AnimatePresence>

      <AnimatePresence>
        {searchOpen ? (
          <m.div
            key="search-overlay"
            className="fixed inset-0 bg-black/60 z-50 flex items-start justify-center pt-24"
            onClick={() => setSearchOpen(false)}
            initial={reduce ? { opacity: 1 } : { opacity: 0 }}
            animate={reduce ? { opacity: 1 } : { opacity: 1 }}
            exit={reduce ? { opacity: 0 } : { opacity: 0 }}
            transition={reduce ? { duration: 0.12 } : { duration: 0.22, ease: "easeOut" }}
          >
            <m.div
              className="bg-white rounded-2xl p-6 w-[90%] max-w-xl shadow-2xl"
              onClick={(e) => e.stopPropagation()}
              initial={reduce ? { opacity: 1 } : { opacity: 0, scale: 0.98, y: 8 }}
              animate={reduce ? { opacity: 1 } : { opacity: 1, scale: 1, y: 0 }}
              exit={reduce ? { opacity: 0 } : { opacity: 0, scale: 0.98, y: 8 }}
              transition={reduce ? { duration: 0.12 } : { duration: 0.22, ease: "easeOut" }}
            >
              <form onSubmit={handleSearch} className="flex flex-col sm:flex-row gap-3">
                <input
                  type="text"
                  placeholder="Search for delicious meals..."
                  className="flex-1 px-4 py-3 border-2 border-orange-200 rounded-xl focus:outline-none focus:border-orange-500 font-medium"
                  value={searchQuery}
                  onChange={(e) => setSearchQuery(e.target.value)}
                  autoFocus
                />
                <button type="submit" className="w-full sm:w-auto px-6 py-3 bg-orange-500 text-white font-bold rounded-xl hover:bg-orange-600 transition-colors">
                  Search
                </button>
              </form>
              <div className="mt-4 max-h-80 overflow-auto rounded-xl border border-orange-100">
                {searchResults.map((item) => (
                  <Link
                    key={item.slug}
                    href={`/product/${item.slug}`}
                    onClick={() => setSearchOpen(false)}
                    className="flex items-center justify-between border-b border-orange-50 px-4 py-3 last:border-b-0 hover:bg-orange-50"
                  >
                    <span className="text-sm font-medium text-zinc-800">{item.name}</span>
                    <span className="text-xs font-semibold text-zinc-500">Rs.{item.price.toFixed(2)}</span>
                  </Link>
                ))}
                {searchResults.length === 0 && (
                  <p className="px-4 py-5 text-center text-sm text-zinc-500">No products found for "{searchQuery}"</p>
                )}
              </div>
            </m.div>
          </m.div>
        ) : null}
      </AnimatePresence>
    </header>
  )
}