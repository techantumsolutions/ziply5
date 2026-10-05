"use client";

import { Suspense, useEffect, useMemo, useRef, useState } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import { useMutation } from "@tanstack/react-query";
import { getCartItems, setCartItems } from "@/lib/cart";
import {
  clearCheckoutStorage,
  readCheckoutStorage,
} from "@/lib/ecommerce-order";
import { toast } from "@/lib/toast";
import {
  calculateShippingCharge,
  validateShippingRules,
  DEFAULT_SHIPPING_RULES,
  totalPacksFromCheckoutLines,
  type ShippingRule,
} from "@/src/lib/shipping/ziply5-shipping";

declare global {
  interface Window {
    Razorpay?: new (options: Record<string, unknown>) => { open: () => void };
  }
}

function PaymentPageInner() {
  const router = useRouter();
  const searchParams = useSearchParams();
  const [scriptReady, setScriptReady] = useState(false);
  const [processingGateway, setProcessingGateway] = useState<"COD" | "ONLINE" | null>(null);
  const [error, setError] = useState("");
  const [statusText, setStatusText] = useState("");
  const [loggedIn, setLoggedIn] = useState(false);
  const [createdOrderId, setCreatedOrderId] = useState<string | null>(null);
  const [retryAmount, setRetryAmount] = useState<number | null>(null);
  const [retryMode, setRetryMode] = useState(false);
  const [couponAdjustedTotal, setCouponAdjustedTotal] = useState<number | null>(null);
  const autoRetryTriggeredRef = useRef(false);
  const [items, setItemsState] = useState<ReturnType<typeof getCartItems>>([]);
  const [billingAddress, setBillingAddress] = useState({
    fullName: "",
    email: "",
    line1: "",
    city: "",
    state: "",
    postalCode: "",
    country: "India",
    phone: "",
    email: "",
  });
  const [hasCheckoutBilling, setHasCheckoutBilling] = useState(false);
  const [hasCheckoutSnapshot, setHasCheckoutSnapshot] = useState(false);
  const [fetchingPincode, setFetchingPincode] = useState(false);

  useEffect(() => {
    // Avoid hydration mismatch: cart is client-only (localStorage)
    const checkout = readCheckoutStorage();
    if (checkout?.items?.length) {
      setHasCheckoutSnapshot(true);
      setItemsState(checkout.items as any);
      const saved = checkout.billingAddress;
      if (saved) {
        setBillingAddress({
          fullName: saved.fullName ?? "",
          email: saved.email ?? "",
          line1: saved.addressLine1 ?? "",
          city: saved.city ?? "",
          state: saved.state ?? "",
          postalCode: saved.postalCode ?? "",
          country: saved.country ?? "India",
          phone: saved.phone ?? "",
          email: saved.email ?? "",
        });
      }
      setCouponAdjustedTotal(checkout.total ?? null);
    } else {
      setHasCheckoutSnapshot(false);
      setItemsState(getCartItems());
    }
  }, []);

  const [shippingRules, setShippingRules] = useState<ShippingRule[]>([...DEFAULT_SHIPPING_RULES]);

  useEffect(() => {
    let cancelled = false;
    fetch("/api/v1/settings?group=SHIPPING")
      .then((res) => res.json())
      .then((payload) => {
        if (cancelled) return;
        const list = payload?.data;
        if (Array.isArray(list)) {
          const row = list.find((item: any) => item.key === "rules");
          if (row && Array.isArray(row.valueJson)) {
            const val = validateShippingRules(row.valueJson);
            if (val.valid && val.rules.length > 0) {
              setShippingRules(val.rules);
            }
          }
        }
      })
      .catch(() => null);
    return () => {
      cancelled = true;
    };
  }, []);

  const subTotal = items.reduce((sum, item) => sum + item.price * item.quantity, 0);
  const checkoutSnap = useMemo(() => readCheckoutStorage(), [items]);

  const defaultShipping = useMemo(() => {
    if (!items.length || subTotal <= 0) return 0;
    const calc = calculateShippingCharge(subTotal, shippingRules);
    return calc.ok ? calc.shippingCharge : 0;
  }, [items.length, subTotal, shippingRules]);

  const shippingChargeResolved = useMemo(() => {
    const fromSnap = checkoutSnap?.shippingCharge;
    if (fromSnap != null && Number.isFinite(fromSnap) && fromSnap >= 0) {
      return Number(fromSnap);
    }
    return defaultShipping;
  }, [checkoutSnap, defaultShipping]);

  const calculatedTotal = subTotal + shippingChargeResolved;
  const payableAmount = useMemo(() => {
    if (retryMode) {
      return retryAmount ?? calculatedTotal;
    }
    // If not in retry mode, use the coupon-adjusted total from localStorage if available, otherwise use the calculated total.
    return couponAdjustedTotal ?? calculatedTotal;
  }, [retryMode, retryAmount, couponAdjustedTotal, calculatedTotal]);

  const postCartEvent = async (eventType: string, meta?: Record<string, unknown>) => {
    try {
      const sessionKey = window.localStorage.getItem("ziply5_session_key") || "";
      if (!sessionKey) return;
      await fetch("/api/cart/events", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          sessionKey,
          items,
          total: payableAmount,
          eventType,
          meta,
        }),
      });
    } catch {
      // non-blocking
    }
  };

  useEffect(() => {
    if (!items.length) return;
    void postCartEvent("payment_page_opened", { lastVisitedPage: "/payment" });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [items.length]);

  // Pincode Lookup Logic
  useEffect(() => {
    const pin = billingAddress.postalCode.trim();
    if (pin.length === 6 && /^\d{6}$/.test(pin)) {
      const controller = new AbortController();
      const runLookup = async () => {
        setFetchingPincode(true);
        try {
          const res = await fetch(`/api/v1/pincode/${pin}`, { signal: controller.signal });
          const payload = await res.json();
          if (payload.success && payload.data) {
            const { city: fetchedCity, state: fetchedState } = payload.data;
            const toTitleCase = (str: string) => str.toLowerCase().split(' ').map(w => w.charAt(0).toUpperCase() + w.substring(1)).join(' ');
            setBillingAddress((prev) => ({
              ...prev,
              city: fetchedCity ? toTitleCase(fetchedCity) : prev.city,
              state: fetchedState ? toTitleCase(fetchedState) : prev.state,
            }));
          }
        } catch (err) {
          if ((err as any).name !== "AbortError") {
            console.error("Pincode lookup failed:", err);
          }
        } finally {
          setFetchingPincode(false);
        }
      };
      void runLookup();
      return () => controller.abort();
    }
  }, [billingAddress.postalCode]);

  const createOrderMutation = useMutation({
    mutationFn: async ({ token, gateway }: { token: string; gateway: "cod" | "razorpay" }) => {
      const checkoutRef =
        window.localStorage.getItem("ziply5_checkout_ref") ??
        (typeof crypto !== "undefined" && "randomUUID" in crypto
          ? crypto.randomUUID()
          : `${Date.now()}-${Math.random().toString(36).slice(2, 10)}`);
      const sessionKey = window.localStorage.getItem("ziply5_session_key") || undefined;
      window.localStorage.setItem("ziply5_checkout_ref", checkoutRef);

      const snap = readCheckoutStorage();
      const packTotalInner = totalPacksFromCheckoutLines(items);
      const subTotalInner = items.reduce((sum, item) => sum + item.price * item.quantity, 0);
      const calcInner = calculateShippingCharge(subTotalInner, shippingRules);
      const defaultShippingInner = calcInner.ok ? calcInner.shippingCharge : 0;
      const shippingForOrder = snap?.shippingCharge ?? defaultShippingInner;
      const calculatedTotalInner = subTotalInner + shippingForOrder;

      const res = await fetch("/api/orders/create", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${token}`,
        },
        body: JSON.stringify({
          items: items.map((i) => ({
            productId: i.productId ?? i.slug,
            variantId: i.variantId ?? null,
            sku: i.sku ?? null,
            quantity: Number(i.quantity ?? 1),
            price: Number(i.price ?? 0),
            subtotal: Number((i.subtotal ?? i.price * i.quantity) ?? 0),
            tax: Number(i.tax ?? 0),
          })),
          shippingCharge: shippingForOrder,
          totalItemsUsedForShipping: packTotalInner,
          subtotal: snap?.subtotal ?? subTotalInner,
          discount: snap?.discount ?? 0,
          tax: snap?.tax ?? 0,
          total: snap?.total ?? calculatedTotalInner,
          savingAmount: snap?.savingAmount ?? 0,
          couponCode:
            snap?.coupon?.code ||
            window.localStorage.getItem("ziply5_coupon_code") ||
            undefined,
          couponId:
            snap?.coupon?.couponId ||
            window.localStorage.getItem("ziply5_applied_coupon_id") ||
            null,
          gateway,

          billingAddress: {
            fullName: billingAddress.fullName,
            email: billingAddress.email,
            line1: billingAddress.line1,
            city: billingAddress.city,
            state: billingAddress.state,
            postalCode: billingAddress.postalCode,
            country: billingAddress.country,
            phone: billingAddress.phone || "",
            email: billingAddress.email || "",
          },

          paymentStatus: gateway === "cod" ? "pending" : "pending",
          paymentId:
            gateway === "cod"
              ? undefined
              : `checkout_ref:${checkoutRef}`,
          sessionKey,
        })
      });
      const json = (await res.json()) as { success?: boolean; message?: string; data?: { id: string } };
      if (!res.ok || json.success === false || !json.data?.id) {
        throw new Error(json.message ?? "Unable to create order.");
      }
      return json.data.id;
    },
  });

  const initiatePaymentMutation = useMutation({
    mutationFn: async ({ token, orderId }: { token: string; orderId: string }) => {
      const intentRes = await fetch("/api/payments/initiate", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${token}`,
        },
        body: JSON.stringify({ orderId, provider: "razorpay" }),
      });
      const intentJson = (await intentRes.json()) as {
        success?: boolean;
        message?: string;
        data?: {
          externalId: string;
          amount: number;
          currency: string;
          publicKey?: string;
          key?: string;
          keyId?: string;
          orderId: string;
        };
      };
      const publicKey =
        intentJson.data?.publicKey ??
        intentJson.data?.key ??
        intentJson.data?.keyId ??
        process.env.NEXT_PUBLIC_RAZORPAY_KEY_ID;
      if (!intentRes.ok || intentJson.success === false || !intentJson.data?.externalId || !publicKey) {
        throw new Error(intentJson.message ?? "Unable to initialize payment.");
      }
      return {
        ...intentJson.data,
        publicKey,
      };
    },
  });
  useEffect(() => {
    const token = window.localStorage.getItem("ziply5_access_token");
    if (!token) {
      setLoggedIn(false);
      return;
    }
    fetch("/api/v1/auth/me", { headers: { Authorization: `Bearer ${token}` } })
      .then((r) => r.json())
      .then((json: { success?: boolean }) => {
        setLoggedIn(Boolean(json.success));
      })
      .catch(() => setLoggedIn(false));

    const savedBilling = window.localStorage.getItem("ziply5_checkout_billing_address");
    const pendingOrderId = window.localStorage.getItem("ziply5_pending_order_id");
    if (pendingOrderId) setCreatedOrderId(pendingOrderId);
    if (savedBilling) {
      try {
        const parsed = JSON.parse(savedBilling) as Partial<typeof billingAddress>;
        const merged = {
          fullName: (parsed.fullName ?? "").toString(),
          email: (parsed.email ?? "").toString(),
          line1: (parsed.line1 ?? "").toString(),
          city: (parsed.city ?? "").toString(),
          state: (parsed.state ?? "").toString(),
          postalCode: (parsed.postalCode ?? "").toString(),
          country: (parsed.country ?? "India").toString(),
          phone: (parsed.phone ?? "").toString(),
          email: (parsed.email ?? "").toString(),
        };
        setBillingAddress(merged);
        setHasCheckoutBilling(
          Boolean(merged.fullName.trim() && merged.city.trim() && merged.state.trim() && merged.postalCode.trim()),
        );
      } catch {
        setHasCheckoutBilling(false);
      }
    }

    const savedFinalTotal = window.localStorage.getItem("ziply5_final_total");
    if (savedFinalTotal) {
      const parsedTotal = Number(savedFinalTotal);
      if (Number.isFinite(parsedTotal)) {
        setCouponAdjustedTotal(parsedTotal);
      }
    }
  }, []);
const handleCOD = async () => {
  try {
    if (!loggedIn) {
      askLogin();
      return;
    }

    if (!billingAddress.fullName.trim()) {
      setError("Fill billing details.");
      return;
    }

    setProcessingGateway("COD");
    setError("");
    setStatusText("Placing order...");

    const token = window.localStorage.getItem("ziply5_access_token");
    if (!token) throw new Error("Login required");

    const orderId = await createOrderMutation.mutateAsync({ token, gateway: "cod" });

    // ✅ cleanup
    setCartItems([]);
    clearCheckoutStorage();
    window.localStorage.removeItem("ziply5_checkout_ref");
    window.localStorage.removeItem("ziply5_final_total");
    window.localStorage.removeItem("ziply5_coupon_code");
    window.localStorage.removeItem("ziply5_applied_coupon_id");

    setProcessingGateway(null);

    router.push(`/order-success?orderId=${orderId}`);
  } catch (e) {
    const message = e instanceof Error ? e.message : "COD failed"
    setError(message);
    toast.error(message);
    setProcessingGateway(null);
  }
};
const handleOnlinePayment = async () => {
  try {
    if (!loggedIn) {
      askLogin();
      return;
    }

    if (!billingAddress.fullName.trim()) {
      setError("Fill billing details.");
      return;
    }

    if (!scriptReady || !window.Razorpay) {
      throw new Error("Payment gateway not ready");
    }

    setProcessingGateway("ONLINE");
    setError("");
    setStatusText("Creating order...");

    const token = window.localStorage.getItem("ziply5_access_token");
    if (!token) throw new Error("Login required");

    const orderId =
      createdOrderId ??
      (await createOrderMutation.mutateAsync({ token, gateway: "razorpay" }));

    setCreatedOrderId(orderId);
    window.localStorage.setItem("ziply5_pending_order_id", orderId);

    setStatusText("Redirecting to payment...");

    await openRazorpay(token, orderId);
  } catch (e) {
    const message = e instanceof Error ? e.message : "Payment failed"
    setError(message);
    toast.error(message);
    setProcessingGateway(null);

    const pendingOrderId = createdOrderId || window.localStorage.getItem("ziply5_pending_order_id");
    if (pendingOrderId) {
      router.push(`/payment-failed?orderId=${pendingOrderId}&reason=${encodeURIComponent(message)}`);
    }
  }
};
  useEffect(() => {
    const retryOrderId = searchParams.get("orderId");
    if (!retryOrderId) return;
    setRetryMode(true);
    setCreatedOrderId(retryOrderId);
    window.localStorage.setItem("ziply5_pending_order_id", retryOrderId);
    const queryAmount = Number(searchParams.get("amount") ?? "");
    if (Number.isFinite(queryAmount) && queryAmount > 0) setRetryAmount(queryAmount);

    const queryName = searchParams.get("name") ?? "";
    const queryPhone = searchParams.get("phone") ?? "";
    const queryAddress = searchParams.get("address") ?? "";
    if (queryName || queryPhone || queryAddress) {
      setBillingAddress((prev) => ({
        ...prev,
        fullName: queryName || prev.fullName,
        phone: queryPhone || prev.phone,
        line1: queryAddress || prev.line1,
      }));
    }

    const token = window.localStorage.getItem("ziply5_access_token");
    if (!token) return;
    void (async () => {
      try {
        const res = await fetch(`/api/v1/orders/${encodeURIComponent(retryOrderId)}`, {
          headers: { Authorization: `Bearer ${token}` },
        });
        const json = (await res.json()) as {
          success?: boolean;
          data?: {
            id?: string;
            total?: number | string;
            customerName?: string | null;
            customerPhone?: string | null;
            customerAddress?: string | null;
          };
        };
        if (!res.ok || !json.success || !json.data) return;
        if (json.data.id) {
          setCreatedOrderId(String(json.data.id));
          window.localStorage.setItem("ziply5_pending_order_id", String(json.data.id));
        }
        const fetchedAmount = Number(json.data.total ?? "");
        if (Number.isFinite(fetchedAmount) && fetchedAmount > 0) setRetryAmount(fetchedAmount);
        setBillingAddress((prev) => ({
          ...prev,
          fullName: (json.data?.customerName ?? prev.fullName ?? "").toString(),
          phone: (json.data?.customerPhone ?? prev.phone ?? "").toString(),
          line1: (json.data?.customerAddress ?? prev.line1 ?? "").toString(),
        }));
      } catch {
        // keep retry flow functional using query params/local state fallback
      }
    })();
  }, [searchParams]);

  useEffect(() => {
    const existing = document.querySelector<HTMLScriptElement>("script[data-razorpay='true']");
    if (existing) {
      setScriptReady(true);
      return;
    }
    const script = document.createElement("script");
    script.src = "https://checkout.razorpay.com/v1/checkout.js";
    script.async = true;
    script.dataset.razorpay = "true";
    script.onload = () => setScriptReady(true);
    script.onerror = () => setError("Failed to load Razorpay checkout.");
    document.body.appendChild(script);
  }, []);

  const deleteUnpaidOrder = async (token: string | null, orderId: string | null) => {
    if (!orderId) return;
    const activeToken = token ?? window.localStorage.getItem("ziply5_access_token");
    if (!activeToken) return;
    try {
      await fetch(`/api/v1/orders/${orderId}/actions`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${activeToken}`,
        },
        body: JSON.stringify({ action: "delete_unpaid" }),
      });
    } catch (e) {
      console.error("Failed to delete unpaid order:", e);
    }
  };

  const askLogin = () => {
    router.push(`/login?next=${encodeURIComponent("/payment")}`);
  };

  const openRazorpay = async (token: string, orderId: string) => {
    const intent = await initiatePaymentMutation.mutateAsync({ token, orderId });
    const Razorpay = window.Razorpay;
    if (!Razorpay) throw new Error("Razorpay checkout is not ready yet.");
    const razorpay = new Razorpay({
      key: intent.publicKey,
      amount: Math.round(intent.amount * 100),
      currency: intent.currency || "INR",
      name: "ZiPLY5",
      description: `Order ${intent.orderId.slice(0, 8)}`,
      order_id: intent.externalId,
      prefill: {
        name: billingAddress.fullName,
        contact: billingAddress.phone,
      },
      notes: {
        billing_line1: billingAddress.line1,
        billing_city: billingAddress.city,
        billing_state: billingAddress.state,
        billing_postal_code: billingAddress.postalCode,
        billing_country: billingAddress.country,
        orderId: intent.orderId,
      },
      theme: { color: "#7B3010" },
      handler: async (response: {
        razorpay_order_id?: string
        razorpay_payment_id?: string
        razorpay_signature?: string
      }) => {
        try {
          setStatusText("Verifying payment...");
          if (!response?.razorpay_order_id || !response?.razorpay_payment_id || !response?.razorpay_signature) {
            throw new Error("Incomplete payment response from gateway.")
          }
          const verifyRes = await fetch("/api/payments/verify", {
            method: "POST",
            headers: {
              "Content-Type": "application/json",
              Authorization: `Bearer ${token}`,
            },
            body: JSON.stringify({
              orderId,
              razorpay_order_id: response.razorpay_order_id,
              razorpay_payment_id: response.razorpay_payment_id,
              razorpay_signature: response.razorpay_signature,
            }),
          })
          const verifyJson = (await verifyRes.json()) as { success?: boolean; message?: string }
          if (!verifyRes.ok || verifyJson.success === false) {
            window.localStorage.removeItem("ziply5_final_total"); // Clear coupon-adjusted total on verification failure
            throw new Error(verifyJson.message ?? "Payment verification failed")
          }

          setStatusText("Payment successful.");
          window.localStorage.removeItem("ziply5_pending_order_id");
          window.localStorage.removeItem("ziply5_checkout_ref");
          setCartItems([]);
          clearCheckoutStorage();
          router.push(`/payment-success?orderId=${orderId}`);
          window.localStorage.removeItem("ziply5_final_total");
          window.localStorage.removeItem("ziply5_coupon_code");
          window.localStorage.removeItem("ziply5_applied_coupon_id");
        } catch (error) {
          setProcessingGateway(null)
          const message = error instanceof Error ? error.message : "Payment verification failed"
          setError(message)
          toast.error(message)
          void postCartEvent("payment_failed", { reason: error instanceof Error ? error.message : "verify_failed" })

          router.push(`/payment-failed?orderId=${orderId}&reason=${encodeURIComponent(message)}`);
        }
      },
      modal: {
        ondismiss: () => {
          setStatusText("Payment interrupted. You can retry.");
          setError("Payment was not completed. Please retry.");
          setProcessingGateway(null);
          void postCartEvent("payment_cancelled", { source: "razorpay_modal_dismiss" });

          router.push(`/payment-failed?orderId=${orderId}&reason=User%20cancelled%20payment`);
        },
      },
    });

    razorpay.on('payment.failed', function (response: any) {
      setProcessingGateway(null);
      void postCartEvent("payment_failed", { reason: response.error.description });
      router.push(`/payment-failed?orderId=${orderId}&reason=${encodeURIComponent(response.error.description)}`);
    });

    razorpay.open();
  };

  useEffect(() => {
    if (!retryMode || !createdOrderId || !loggedIn || !scriptReady || autoRetryTriggeredRef.current) return;
    autoRetryTriggeredRef.current = true;
    void handleOnlinePayment();
  }, [retryMode, createdOrderId, loggedIn, scriptReady]);

  const retryPayment = async () => {
    if (!createdOrderId) return;
    const token = window.localStorage.getItem("ziply5_access_token");
    if (!token) {
      setError("Please login to retry payment.");
      return;
    }
    setProcessingGateway("ONLINE");
    setError("");
    setStatusText("Retrying payment...");
    try {
      await openRazorpay(token, createdOrderId);
    } catch (e) {
      const message = e instanceof Error ? e.message : "Retry failed."
      setError(message);
      toast.error(message);
      setProcessingGateway(null);
    }
  };

  return (
    <div className="py-24 flex items-center justify-center bg-[#F5F1E6] p-4">
      <div className="w-full max-w-xl bg-white rounded-3xl p-6 shadow-sm border">
        {!hasCheckoutSnapshot && items.length === 0 ? (
          <p className="mb-4 text-sm text-red-600">Checkout session missing. Please go back to checkout.</p>
        ) : null}
        <h2 className="font-melon text-lg mb-6">Billing Address</h2>

        {!loggedIn && (
          <div className="mb-4 rounded-lg border border-[#E8DCC8] bg-[#FFFBF3] p-3 text-sm text-[#4A1D1F]">
            Login is required to complete purchase.
            <button
              type="button"
              onClick={askLogin}
              className="ml-2 rounded-full bg-[#7B3010] px-3 py-1 text-xs font-semibold uppercase text-white"
            >
              Login
            </button>
          </div>
        )}

        {hasCheckoutBilling ? (
          <div className="mb-6 rounded-xl border px-4 py-3 text-sm text-[#646464]">
            <p className="font-semibold text-[#7B3010]">{billingAddress.fullName}</p>
            {billingAddress.line1 ? <p>{billingAddress.line1}</p> : null}
            <p>
              {billingAddress.city}, {billingAddress.state} {billingAddress.postalCode}
            </p>
            <p>{billingAddress.country}</p>
            {billingAddress.phone ? <p>Phone: {billingAddress.phone}</p> : null}
            <button
              type="button"
              onClick={() => router.push("/checkout")}
              className="mt-2 text-xs font-semibold text-[#7B3010] underline"
            >
              Change billing address in checkout
            </button>
          </div>
        ) : (
          <div className="grid grid-cols-1 gap-4 mb-6">
            <input
              className="input"
              placeholder="Full name"
              value={billingAddress.fullName}
              onChange={(e) => setBillingAddress((prev) => ({ ...prev, fullName: e.target.value }))}
            />
            <input
              className="input"
              placeholder="Address line"
              value={billingAddress.line1}
              onChange={(e) => setBillingAddress((prev) => ({ ...prev, line1: e.target.value }))}
            />
            <div className="grid grid-cols-2 gap-3">
              <input
                className="input"
                placeholder="City"
                value={billingAddress.city}
                onChange={(e) => setBillingAddress((prev) => ({ ...prev, city: e.target.value }))}
              />
              <input
                className="input"
                placeholder="State"
                value={billingAddress.state}
                onChange={(e) => setBillingAddress((prev) => ({ ...prev, state: e.target.value }))}
              />
            </div>
            <div className="grid grid-cols-2 gap-3">
              <input
                className="input"
                placeholder="Postal code"
                value={billingAddress.postalCode}
                onChange={(e) => setBillingAddress((prev) => ({ ...prev, postalCode: e.target.value }))}
                disabled={fetchingPincode}
              />
              {fetchingPincode && <p className="text-[10px] text-primary animate-pulse absolute mt-10">Fetching location...</p>}
              <input
                className="input"
                placeholder="Phone (optional)"
                value={billingAddress.phone}
                onChange={(e) => setBillingAddress((prev) => ({ ...prev, phone: e.target.value }))}
              />
            </div>
            <input
              className="input"
              placeholder="Email address"
              value={billingAddress.email}
              onChange={(e) => setBillingAddress((prev) => ({ ...prev, email: e.target.value }))}
            />
          </div>
        )}

        <div className="mb-5 rounded-xl border px-4 py-3 text-sm text-[#646464]">
          Payable amount: <span className="font-semibold text-[#7B3010]">Rs. {payableAmount.toFixed(2)}</span>
        </div>
      <div className="flex flex-row gap-3">

  {/* ✅ COD BUTTON */}
  <button
    type="button"
    onClick={() => handleCOD()}
    disabled={processingGateway !== null || createOrderMutation.isPending}
    className="w-full hover:bg-primary hover:text-white text-primary border-primary border py-4 rounded-full font-medium"
  >
    {processingGateway === "COD" ? "Processing..." : "Cash on Delivery"}
  </button>

  {/* ✅ PAY NOW BUTTON */}
  <button
    type="button"
    onClick={() => handleOnlinePayment()}
    disabled={
      processingGateway !== null ||
      !scriptReady ||
      createOrderMutation.isPending ||
      initiatePaymentMutation.isPending
    }
    className="w-full border hover:border-[#7B3010] hover:bg-white hover:text-[#7B3010] bg-primary text-white py-4 rounded-full font-medium"
  >
    {processingGateway === "ONLINE" ? "Processing..." : "Pay Now"}
  </button>

</div>
        {/* {createdOrderId && (
          <button
            type="button"
            onClick={() => void retryPayment()}
            disabled={processingOrder || initiatePaymentMutation.isPending}
            className="mt-3 w-full rounded-full border border-[#E8DCC8] bg-white py-3 text-xs font-semibold uppercase tracking-wide text-[#4A1D1F] disabled:opacity-40"
          >
            Retry Payment
          </button>
        )} */}
      </div>
    </div>
  );
}
export default function PaymentPage() {
  return (
    <Suspense fallback={null}>
      <PaymentPageInner />
    </Suspense>
  );
}
