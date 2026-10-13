"use client";

import BannerSection from "@/components/BannerSection";
import { getCartItems, setCartItems, type CartItem } from "@/lib/cart"; // utils to manage cart items in localStorage
import { getFavoriteSlugs, setFavoriteSlugs } from "@/lib/favorites";
import { ArrowLeft, Heart, Minus, Plus, ShieldCheck, ShieldHalf, X, Trash2 } from "lucide-react";
import Link from "next/link";
import { useCallback, useEffect, useState } from "react";
import { toggleFavoriteSlug } from "@/lib/favorites"
import { toast } from "@/lib/toast"
import { useRouter } from "next/navigation";
import {
  Tooltip,
  TooltipContent,
  TooltipProvider,
  TooltipTrigger,
} from "@/components/ui/tooltip"
const formatMoney = (amount: number) => amount.toFixed(2);


export default function CartPage() {
  const router = useRouter();
  const [cartItems, setLocalCartItems] = useState<CartItem[]>([]);
  const [couponCode, setCouponCode] = useState("");
  const [offerBreakdown, setOfferBreakdown] = useState<Array<{ label: string; amount: number; type: string }>>([]);
  const [offerTotalDiscount, setOfferTotalDiscount] = useState(0);
  const [offerAdjustedShipping, setOfferAdjustedShipping] = useState<number | null>(null);
  const [offerFinalTotal, setOfferFinalTotal] = useState<number | null>(null);
  const [couponError, setCouponError] = useState("");
  const [minCartValue, setMinCartValue] = useState<number>(250);

  useEffect(() => {
    const syncCart = () => {
      setLocalCartItems(getCartItems());
    };
    syncCart();

    if (typeof window !== "undefined") {
      setCouponCode(window.localStorage.getItem("ziply5_coupon_code") ?? "");
    }

    window.addEventListener("ziply5:cart-updated", syncCart);
    window.addEventListener("storage", syncCart);

    return () => {
      window.removeEventListener("ziply5:cart-updated", syncCart);
      window.removeEventListener("storage", syncCart);
    };
  }, []);

  useEffect(() => {
    fetch("/api/v1/settings?group=CART")
      .then((res) => res.json())
      .then((payload: any) => {
        if (payload.success && Array.isArray(payload.data)) {
          const row = payload.data.find((r: any) => r.key === "min_order_value");
          if (row && row.valueJson != null) {
            setMinCartValue(Number(row.valueJson));
          }
        }
      })
      .catch((err) => console.error("Cart setting fetch failed", err));
  }, []);



  const persistCart = (next: CartItem[]) => {
    setLocalCartItems(next);
    setCartItems(next);
  };

  const updateQuantity = (id: string, delta: number) => {
    const next = cartItems.map((item) =>
      item.id === id
        ? { ...item, quantity: Math.max(1, item.quantity + delta) }
        : item
    );
    persistCart(next);
  };

  const removeItem = (id: string) => {
    const next = cartItems.filter((item) => item.id !== id);
    persistCart(next);
  };

  const handleToggleFavorite = async (e: React.MouseEvent, slug: string, id: any) => {
    e.stopPropagation();
    const token = window.localStorage.getItem("ziply5_access_token");
    if (!token) {
      window.localStorage.setItem("ziply5_pending_wishlist_slug", slug);
      router.push(`/login?next=${encodeURIComponent(window.location.pathname + window.location.search)}`);
      return;
    }
    const isNowFav = await toggleFavoriteSlug(slug);
    if (isNowFav) {
      toast.success("Added to favorites", "The product is now in your favorites.");
    } else {
      toast.info("Removed from favorites", "The product has been removed from your favorites.");
    }
    removeItem(id);

  }

  const subTotal = cartItems.reduce(
    (acc, item) => acc + item.price * item.quantity,
    0
  );
  const shipping = cartItems.length === 0 ? 0 : 0;

  // Track cart for abandonment recovery (server skips save if no profile email/phone)
  useEffect(() => {
    const sessionKey = typeof window !== "undefined" ? window.localStorage.getItem("ziply5_session_key") : null;
    const hasSession =
      typeof window !== "undefined" ? !!window.localStorage.getItem("ziply5_refresh_token") : false;
    if (!sessionKey || cartItems.length === 0) return;
    if (!hasSession) return;

    void fetch("/api/checkout/start", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        sessionKey,
        items: cartItems,
        total: subTotal,
        eventType: "cart_updated",
        meta: {
          checkoutStage: "CART_ACTIVE",
          lastVisitedPage: "/cart",
        },
      }),
    }).catch(() => null);
  }, [cartItems.length, subTotal]);
  const total = offerFinalTotal != null ? offerFinalTotal : subTotal + (offerAdjustedShipping ?? shipping);

  const recalculateOffers = useCallback(
    async (incomingCoupon?: string) => {
      if (!cartItems.length) {
        setOfferBreakdown([]);
        setOfferTotalDiscount(0);
        setOfferAdjustedShipping(null);
        setOfferFinalTotal(null);
        setCouponError("");
        return;
      }
      const response = await fetch("/api/v1/offers/calculate", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          couponCode: (incomingCoupon ?? couponCode).trim() || null,
          cartSubtotal: subTotal,
          shippingAmount: shipping,
          items: cartItems.map((item) => ({
            productId: item.productId ?? item.slug,
            categoryId: null,
            quantity: item.quantity,
            unitPrice: item.price,
          })),
        }),
      });
      const payload = (await response.json()) as {
        success?: boolean;
        message?: string;
        data?: { breakdown: Array<{ label: string; amount: number; type: string }>; totalDiscount: number; adjustedShipping?: number; finalTotal?: number };
      };
      if (!response.ok || !payload.success || !payload.data) {
        throw new Error(payload.message ?? "Unable to calculate offers.");
      }
      setOfferBreakdown(payload.data.breakdown ?? []);
      setOfferTotalDiscount(Number(payload.data.totalDiscount ?? 0));
      setOfferAdjustedShipping(payload.data.adjustedShipping == null ? null : Number(payload.data.adjustedShipping));
      setOfferFinalTotal(payload.data.finalTotal == null ? null : Number(payload.data.finalTotal));
      setCouponError("");
    },
    [cartItems, couponCode, shipping, subTotal],
  );

  useEffect(() => {
    void recalculateOffers().catch(() => {
      setOfferBreakdown([]);
      setOfferTotalDiscount(0);
      setOfferAdjustedShipping(null);
      setOfferFinalTotal(null);
    });
  }, [recalculateOffers]);

  const applyCoupon = async () => {
    const code = couponCode.trim().toUpperCase();
    setCouponCode(code);
    if (typeof window !== "undefined") window.localStorage.setItem("ziply5_coupon_code", code);
    if (!code) {
      setCouponError("Enter a coupon code.");
      return;
    }
    try {
      await recalculateOffers(code);
    } catch (e) {
      setCouponError(e instanceof Error ? e.message : "Unable to apply coupon.");
      setOfferFinalTotal(null);
    }
  };

  return (
    <div>
      {/* <BannerSection
        title="Shopping Cart"
        subtitle="Some of the queries you want to know about us."
        gradient="linear-gradient(to right, #EFD7EF 0%, #F5F9FC 30%, #F8EAE1 60%, #EAF8F9 100%)"
      /> */}

      <section className="bg-[#F5F1E6] py-16">
        <div className="mx-auto grid max-w-7xl gap-10 px-4 lg:grid-cols-3">
          <div className="overflow-x-auto lg:col-span-2">
            <Link
              href="/products"
              className="mb-6 inline-flex items-center gap-2 rounded-full bg-gray-200 px-5 py-2 text-sm transition hover:bg-gray-300"
            >
              <ArrowLeft size={16} />
              Back To Products
            </Link>

            <div className="mb-4 flex items-center justify-between border-b pb-3 font-melon tracking-wide">
              <h2 className="text-lg font-medium text-black">Shopping Cart</h2>
              <span className="font-medium text-black">
                ({cartItems.length.toString().padStart(2, "0")} - Items)
              </span>
            </div>

            {cartItems.length === 0 ? (
              <div className="rounded-2xl border border-[#E0E0E0] bg-white p-10 text-center">
                <p className="text-[#646464]">Your cart is empty.</p>
                <Link
                  href="/products"
                  className="mt-6 inline-flex items-center gap-2 rounded-full bg-primary px-6 py-2 text-sm font-semibold text-white"
                >
                  Continue Shopping
                </Link>
              </div>
            ) : (
              <>
                <div className="overflow-x-auto">
                  <div className="min-w-[700px]">
                    <div className="mb-2 grid grid-cols-6 gap-10 border-b pb-1 text-sm text-[#787878]">
                      <span className="col-span-2 text-left">Product Details</span>
                      <span className="text-left">Price</span>
                      <span className="text-left">Quantity</span>
                      <span className="text-left">Total</span>
                      <span></span>
                    </div>

                    {cartItems.map((item) => (
                      <div
                        key={item.id}
                        className="grid grid-cols-6 gap-10 items-center border-b py-6"
                      >
                        <div className="col-span-2 flex items-center gap-4 text-start">
                          <div >
                            {item.image && item.image !== "/placeholder.svg" && !item.image.endsWith("/fallback-product.png") ? (
                              <img
                                src={item.image}
                                alt={item.name}
                                className="h-16 w-16 rounded-lg object-contain"
                              />
                            ) : (
                              <div className="h-16 w-16" />
                            )}
                          </div>
                          <div>
                            <p className="font-melon font-medium tracking-wide text-black">
                              {item.name}
                            </p>
                            <p className="text-xs text-[#787878]">
                              Weight:{" "}
                              <span className="font-medium text-black">
                                {item.weight}
                              </span>
                            </p>
                          </div>
                        </div>

                        <p className=" font-melon font-medium tracking-wide text-primary">
                          Rs.{formatMoney(item.price)}
                        </p>

                        <div className="flex w-fit items-center overflow-hidden rounded-full border">
                          <button
                            className="border-r px-3 py-1 flex items-center justify-center cursor-pointer"
                            onClick={() => {
                              if (item.quantity === 1) {
                                removeItem(item.id)
                              } else {
                                updateQuantity(item.id, -1)
                              }
                            }}
                            aria-label={
                              item.quantity === 1
                                ? `Remove ${item.name} from cart`
                                : `Decrease quantity for ${item.name}`
                            }
                          >
                            {item.quantity === 1 ? (
                              <Trash2 size={14} className="text-red-500 hover:text-red-600 transition-colors" />
                            ) : (
                              <Minus size={14} />
                            )}
                          </button>
                          <span className="px-4">{item.quantity}</span>
                          <button
                            className="border-l px-3 py-1"
                            onClick={() => updateQuantity(item.id, 1)}
                            aria-label={`Increase quantity for ${item.name}`}
                          >
                            <Plus size={14} />
                          </button>
                        </div>

                        <span className=" font-melon font-medium tracking-wide text-black">
                          Rs.{formatMoney(item.price * item.quantity)}
                        </span>
                        <div className="flex items-center justify-end gap-2">
                          <TooltipProvider>
                            <Tooltip>
                              <TooltipTrigger asChild>
                                <button
                                  className="rounded-full border border-[#D1D5DB] h-8 w-8 flex items-center justify-center text-xs text-[#374151] cursor-pointer"
                                  onClick={(e) =>
                                    handleToggleFavorite(e, item.slug, item.id)
                                  }
                                  aria-label={`Move ${item.name} to wishlist`}
                                >
                                  <Heart size={16} />
                                </button>
                              </TooltipTrigger>

                              <TooltipContent side="top">
                                Move the product to wishlist
                              </TooltipContent>
                            </Tooltip>
                          </TooltipProvider>
                          <button
                            className="flex h-8 w-8 items-center justify-center rounded-full border border-red-400 text-red-500"
                            onClick={() => removeItem(item.id)}
                            aria-label={`Remove ${item.name} from cart`}
                          >
                            <X size={14} />
                          </button>
                        </div>
                      </div>
                    ))}
                  </div>
                </div>

                <Link
                  href="/products"
                  className="mt-8 inline-flex items-center gap-2 rounded-full border border-gray-200 px-5 py-1 text-sm font-bold text-primary"
                >
                  <ArrowLeft size={16} />
                  Continue Shopping
                </Link>
              </>
            )}
          </div>

          <div className="h-fit rounded-3xl bg-[#FFC222] p-6 shadow-md">
            <h3 className="mb-6 text-center font-melon text-xl">
              Order Summary
            </h3>
            {/* <div className="my-4 border-t border-white" />
            <div className="mb-6 flex items-center font-melon justify-between">
              <p className="text-sm">Apply Coupons</p>
              <button onClick={applyCoupon} className="rounded-full bg-black px-5 py-2 text-xs text-[#FFC222]">
                Apply
              </button>
            </div>
            <input
              value={couponCode}
              onChange={(e) => setCouponCode(e.target.value.toUpperCase())}
              placeholder="Enter coupon code"
              className="w-full rounded-full border border-black/10 bg-white px-4 py-2 text-sm"
            />
            {couponError ? <p className="mt-2 text-xs text-red-700">{couponError}</p> : null} */}
            <div className="my-4 border-t border-white" />
            <div className="space-y-3 text-sm text-[#C03621] font-melon">
              <div className="flex justify-between">
                <span>Sub Total</span>
                <span>INR {formatMoney(subTotal)}</span>
              </div>
              {offerTotalDiscount > 0 ? (
                <div className="flex justify-between">
                  <span>Savings</span>
                  <span>-INR {formatMoney(offerTotalDiscount)}</span>
                </div>
              ) : null}
              {/* <div className="flex justify-between">
                <span>Shipping</span>
                <span>INR {formatMoney(offerAdjustedShipping ?? shipping)}</span>
              </div> */}
            </div>

            <div className="my-4 border-t border-white" />

            <div className="flex justify-between text-[#C03621] font-melon font-medium">
              <span>Grand Total</span>
              <span>INR {formatMoney(total)}</span>
            </div>

            {offerBreakdown.length ? (
              <div className="mt-4 rounded-2xl bg-white/60 p-3 text-xs text-[#2A1810]">
                <p className="mb-2 font-semibold">Applied offers</p>
                <div className="space-y-1">
                  {offerBreakdown.map((b, idx) => (
                    <div key={`${b.type}:${idx}`} className="flex justify-between">
                      <span className="truncate">{b.label}</span>
                      <span>-INR {formatMoney(Number(b.amount) || 0)}</span>
                    </div>
                  ))}
                </div>
              </div>
            ) : null}

            {cartItems.length > 0 && total < minCartValue && (
              <div className="mt-4 rounded-2xl bg-white/60 p-3 text-center border border-red-200/50">
                <p className="text-xs font-medium text-red-700">
                  Add INR {formatMoney(minCartValue - total)} more to checkout.
                  <br />
                  <span className="text-[10px] opacity-70">(Minimum order: INR {formatMoney(minCartValue)})</span>
                </p>
              </div>
            )}

            {cartItems.length > 0 && total >= minCartValue ? (
              <Link href="/checkout">
                <button className="mt-6 w-full rounded-xl bg-primary py-3 font-melon font-medium tracking-wide text-white transition-all hover:bg-primary/90">
                  Proceed to checkout →
                </button>
              </Link>
            ) : (
              <button
                className="mt-6 w-full rounded-xl bg-gray-400 py-3 font-melon font-medium tracking-wide text-white opacity-70 cursor-not-allowed transition-all"
                disabled
              >
                Proceed to checkout →
              </button>
            )}
            <div className="my-4 border-t border-white" />
            <div className="flex flex-row gap-2 justify-center items-center">
              <div className="mt-3">
                <ShieldCheck />
              </div>

              <p className="mt-4 font-semibold text-xs ">
                Safe and Secure Payments. Easy Returns. 100% Authentic Products.
              </p>
            </div>
          </div>
        </div>
      </section>
    </div>
  );
}