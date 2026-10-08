"use client"

import { FormEvent, useEffect, useState } from "react"
import { authedFetch } from "@/lib/dashboard-fetch"
import { useMasterValues } from "@/hooks/useMasterData"

type CouponRow = {
  id: string
  code: string
  description: string | null
  discountType: "percentage" | "flat"
  discountValue: number
  minOrderAmount: number | null
  maxDiscountAmount: number | null
  usageLimitTotal: number | null
  usageLimitPerUser: number | null
  endsAt: string | null
  active: boolean
  startsAt?: string | null
  stackable?: boolean
  firstOrderOnly?: boolean
}

export default function MarketingCouponsPage() {
  const couponTypeMasterQuery = useMasterValues("COUPON_DISCOUNT_TYPE")
  const couponStatusMasterQuery = useMasterValues("COUPON_STATUS_FILTER")
  const discountTypeOptions =
    couponTypeMasterQuery.data?.length
      ? couponTypeMasterQuery.data.map((item) => ({ label: item.label, value: item.value }))
      : [
          { label: "Percentage", value: "percentage" },
          { label: "Flat", value: "flat" },
        ]
  const statusFilterOptions =
    couponStatusMasterQuery.data?.length
      ? couponStatusMasterQuery.data.map((item) => ({ label: item.label, value: item.value }))
      : [
          { label: "All Status", value: "all" },
          { label: "Active", value: "active" },
          { label: "Inactive", value: "inactive" },
          { label: "Expired", value: "expired" },
        ]

  const [items, setItems] = useState<CouponRow[]>([])
  const [error, setError] = useState("")
  const [saving, setSaving] = useState(false)
  const [viewCoupon, setViewCoupon] = useState<CouponRow | null>(null)
  const [editingId, setEditingId] = useState<string | null>(null)
  const [togglingId, setTogglingId] = useState<string | null>(null)
  const [searchQuery, setSearchQuery] = useState("")
  const [statusFilter, setStatusFilter] = useState("all")
  const [formErrors, setFormErrors] = useState({
    code: "",
    discountValue: "",
    minOrderValue: "",
    maxDiscount: "",
    usageLimit: "",
    usagePerUser: "",
    startsAt: "",
    expiryDate: "",
  });

  const [form, setForm] = useState({
    code: "",
    description: "",
    discountType: "percentage" as "percentage" | "flat",
    discountValue: "0",
    minOrderValue: "0",
    maxDiscount: "",
    usageLimit: "",
    usagePerUser: "",
    expiryDate: "",
    startsAt: "",
    stackable: false,
    firstOrderOnly: false,
  })

  const load = async () => {
    try {
      setError("")
      const rows = await authedFetch<CouponRow[]>("/api/v1/coupons")
      setItems(rows)
    } catch (e) {
      setError(e instanceof Error ? e.message : "Failed to load coupons")
    }
  }

  useEffect(() => {
    void load()
  }, [])

  console.log("fetched ccoupns::::::",items)

const validateForm = () => {
    const newErrors = {
      code: "",
      discountValue: "",
      minOrderValue: "",
      maxDiscount: "",
      usageLimit: "",
      usagePerUser: "",
      startsAt: "",
      expiryDate: "",
    };
    let isValid = true;

    if (!form.code.trim()) {
      newErrors.code = "Coupon code is required.";
      isValid = false;
    }

    if (!form.discountValue.trim() || Number(form.discountValue) <= 0) {
      newErrors.discountValue = "A valid discount value is required.";
      isValid = false;
    }

    if (!form.minOrderValue.toString().trim() || Number(form.minOrderValue) < 0) {
      newErrors.minOrderValue = "Valid min order amount is required.";
      isValid = false;
    }

    if (!form.maxDiscount.toString().trim() || Number(form.maxDiscount) <= 0) {
      newErrors.maxDiscount = "Valid max discount is required.";
      isValid = false;
    }

    if (!form.usageLimit.toString().trim() || Number(form.usageLimit) <= 0) {
      newErrors.usageLimit = "Total usage limit is required.";
      isValid = false;
    }

    if (!form.usagePerUser.toString().trim() || Number(form.usagePerUser) <= 0) {
      newErrors.usagePerUser = "Per user limit is required.";
      isValid = false;
    }

    if (!form.startsAt) {
      newErrors.startsAt = "Start date is required.";
      isValid = false;
    }

    if (!form.expiryDate) {
      newErrors.expiryDate = "Expiry date is required.";
      isValid = false;
    } else if (form.startsAt && new Date(form.expiryDate) <= new Date(form.startsAt)) {
      newErrors.expiryDate = "Expiry date must be after the start date.";
      isValid = false;
    }

    setFormErrors(newErrors);
    return isValid;
  };

  const handleSubmit = async (event: FormEvent) => {
    event.preventDefault()
    setError("");
    if (!validateForm()) return;
    setSaving(true)

    try {
      const payload = {
        code: form.code,
        description: form.description || null,
        discountType: form.discountType === "percentage" ? "percentage" : "flat",
        discountValue: Number(form.discountValue),
        minOrderAmount: Number(form.minOrderValue || 0),
        maxDiscountAmount: form.maxDiscount ? Number(form.maxDiscount) : null,
        usageLimitTotal: form.usageLimit ? Number(form.usageLimit) : null,
        usageLimitPerUser: form.usagePerUser ? Number(form.usagePerUser) : null,
        endsAt: form.expiryDate ? new Date(form.expiryDate).toISOString() : null,
        startsAt: form.startsAt ? new Date(form.startsAt).toISOString() : null,
        stackable: form.stackable,
        firstOrderOnly: form.firstOrderOnly,
      };

    if (editingId) {
      await authedFetch(`/api/v1/coupons/${editingId}`, {
        method: "PATCH",
        body: JSON.stringify(payload),
      });
    } else {
      await authedFetch("/api/v1/coupons", {
        method: "POST",
        body: JSON.stringify(payload),
      });
    }

      setForm({
        code: "",
        description: "",
        discountType: "percentage",
        discountValue: "0",
        minOrderValue: "0",
        maxDiscount: "",
        usageLimit: "",
        usagePerUser: "",
        expiryDate: "",
        startsAt: "",
        stackable: false,
        firstOrderOnly: false,
      })
      setEditingId(null)

      await load()
    } catch (e) {
      setError(e instanceof Error ? e.message : "Failed to save coupon")
    } finally {
      setSaving(false)
    }
  };

  const handleEdit = (coupon: CouponRow) => {
    setEditingId(coupon.id);

    const toLocalDatetime = (isoString: string | null | undefined) => {
      if (!isoString) return "";
      const date = new Date(isoString);
      if (isNaN(date.getTime())) return "";
      const local = new Date(date.getTime() - date.getTimezoneOffset() * 60000);
      return local.toISOString().slice(0, 16);
    };

    setForm({
      code: coupon.code,
      description: coupon.description || "",
      discountType: coupon.discountType,
      discountValue: coupon.discountValue.toString(),
      minOrderValue: (coupon.minOrderAmount || 0).toString(),
      maxDiscount: coupon.maxDiscountAmount ? coupon.maxDiscountAmount.toString() : "",
      usageLimit: coupon.usageLimitTotal ? coupon.usageLimitTotal.toString() : "",
      usagePerUser: coupon.usageLimitPerUser ? coupon.usageLimitPerUser.toString() : "",
      startsAt: toLocalDatetime(coupon.startsAt),
      expiryDate: toLocalDatetime(coupon.endsAt),
      stackable: coupon.stackable || false,
      firstOrderOnly: coupon.firstOrderOnly || false,
    });
    setFormErrors({ code: "", discountValue: "", minOrderValue: "", maxDiscount: "", usageLimit: "", usagePerUser: "", startsAt: "", expiryDate: "" });
    window.scrollTo({ top: 0, behavior: "smooth" });
  };

  const toggleStatus = async (id: string, status: boolean) => {

    setTogglingId(id)
    setError("")

    try {

      await authedFetch(`/api/v1/coupons/${id}`, {

        method: "PATCH",

        body: JSON.stringify({ active: !status }),

      })

      await load()

    } catch (e) {

      setError(e instanceof Error ? e.message : "Failed to update status")

    } finally {

      setTogglingId(null)

    }

  }

  const filteredItems = items.filter((item) => {
    const matchesSearch =
      item.code.toLowerCase().includes(searchQuery.toLowerCase()) ||
      (item.description?.toLowerCase() || "").includes(searchQuery.toLowerCase());

    const isExpired = item.endsAt ? new Date(item.endsAt) < new Date() : false;
    const isActive = item.active ?? (item as any).status;

    let matchesStatus = true;
    if (statusFilter === "active") {
      matchesStatus = isActive && !isExpired;
    } else if (statusFilter === "inactive") {
      matchesStatus = !isActive && !isExpired;
    } else if (statusFilter === "expired") {
      matchesStatus = isExpired;
    }

    return matchesSearch && matchesStatus;
  });

  return (

    <section className="w-full space-y-4">

      <div>

        <h1 className="font-melon text-2xl font-bold text-[#4A1D1F]">
          Marketing Coupons
        </h1>

        <p className="text-sm text-[#646464]">
          Create, activate, and monitor coupon configurations.
        </p>

      </div>

      {error && (
        <p className="rounded-lg bg-red-50 px-3 py-2 text-sm text-red-800">
          {error}
        </p>
      )}

      {/* FORM */}

      <form
  onSubmit={handleSubmit}
  className="grid gap-3 rounded-xl border bg-white p-4 md:grid-cols-4"
>

  {/* Code */}

  <div className="flex flex-col gap-1">
    <label className="text-xs font-medium text-[#4A1D1F]">
      Code
    </label>

    <input
      className="rounded border px-3 py-2 text-sm"
      placeholder="Enter coupon code"
      value={form.code}
      onChange={(e) =>
        setForm((prev) => ({
          ...prev,
          code: e.target.value,
        }))
      }
    />
    {formErrors.code && (
      <p className="text-xs text-red-600 mt-1">{formErrors.code}</p>
    )}
  </div>

  {/* Description */}

  <div className="flex flex-col gap-1">
    <label className="text-xs font-medium text-[#4A1D1F]">
      Description
    </label>

    <input
      className="rounded border px-3 py-2 text-sm"
      placeholder="Optional description"
      value={form.description}
      onChange={(e) =>
        setForm((prev) => ({
          ...prev,
          description: e.target.value,
        }))
      }
    />
  </div>

  {/* Discount Type */}

  <div className="flex flex-col gap-1">
    <label className="text-xs font-medium text-[#4A1D1F]">
      Discount Type
    </label>

    <select
      className="rounded border px-3 py-2 text-sm"
      value={form.discountType}
      onChange={(e) =>
        setForm((prev) => ({
          ...prev,
          discountType: e.target.value as
            | "percentage"
            | "flat",
        }))
      }
    >
      {discountTypeOptions.map((option) => (
        <option key={option.value} value={option.value}>
          {option.label}
        </option>
      ))}
    </select>
  </div>

  {/* Discount Value */}

  <div className="flex flex-col gap-1">
    <label className="text-xs font-medium text-[#4A1D1F]">
      Discount Value
    </label>

    <input
      type="number"
      className="rounded border px-3 py-2 text-sm"
      value={form.discountValue}
      onChange={(e) =>
        setForm((prev) => ({
          ...prev,
          discountValue: e.target.value,
        }))
      }
    />
    {formErrors.discountValue && (
      <p className="text-xs text-red-600 mt-1">{formErrors.discountValue}</p>
    )}
  </div>

  {/* Min Order */}

  <div className="flex flex-col gap-1">
    <label className="text-xs font-medium text-[#4A1D1F]">
      Minimum Order Amount
    </label>

    <input
      type="number"
      className="rounded border px-3 py-2 text-sm"
      value={form.minOrderValue}
      onChange={(e) =>
        setForm((prev) => ({
          ...prev,
          minOrderValue: e.target.value,
        }))
      }
    />
    {formErrors.minOrderValue && (
      <p className="text-xs text-red-600 mt-1">{formErrors.minOrderValue}</p>
    )}
  </div>

  {/* Max Discount */}

  <div className="flex flex-col gap-1">
    <label className="text-xs font-medium text-[#4A1D1F]">
      Maximum Discount
    </label>

    <input
      type="number"
      className="rounded border px-3 py-2 text-sm"
      placeholder="maximum anount"
      value={form.maxDiscount}
      onChange={(e) =>
        setForm((prev) => ({
          ...prev,
          maxDiscount: e.target.value,
        }))
      }
    />
    {formErrors.maxDiscount && (
      <p className="text-xs text-red-600 mt-1">{formErrors.maxDiscount}</p>
    )}
  </div>

  {/* Usage Limit */}

  <div className="flex flex-col gap-1">
    <label className="text-xs font-medium text-[#4A1D1F]">
      Total Usage Limit
    </label>

    <input
      type="number"
      className="rounded border px-3 py-2 text-sm"
      placeholder="total usage limit"
      value={form.usageLimit}
      onChange={(e) =>
        setForm((prev) => ({
          ...prev,
          usageLimit: e.target.value,
        }))
      }
    />
    {formErrors.usageLimit && (
      <p className="text-xs text-red-600 mt-1">{formErrors.usageLimit}</p>
    )}
  </div>

  {/* Per User */}

  <div className="flex flex-col gap-1">
    <label className="text-xs font-medium text-[#4A1D1F]">
      Per User Limit
    </label>

    <input
      type="number"
      className="rounded border px-3 py-2 text-sm"
      placeholder="per user limit"
      value={form.usagePerUser}
      onChange={(e) =>
        setForm((prev) => ({
          ...prev,
          usagePerUser: e.target.value,
        }))
      }
    />
    {formErrors.usagePerUser && (
      <p className="text-xs text-red-600 mt-1">{formErrors.usagePerUser}</p>
    )}
  </div>

  {/* Starts At */}

  <div className="flex flex-col gap-1">
    <label className="text-xs font-medium text-[#4A1D1F]">
      Starts At
    </label>

    <input
      type="datetime-local"
      className="rounded border px-3 py-2 text-sm"
      value={form.startsAt}
      onChange={(e) =>
        setForm((prev) => ({
          ...prev,
          startsAt: e.target.value,
        }))
      }
    />
    {formErrors.startsAt && (
      <p className="text-xs text-red-600 mt-1">{formErrors.startsAt}</p>
    )}
  </div>

  {/* Expiry */}

  <div className="flex flex-col gap-1">
    <label className="text-xs font-medium text-[#4A1D1F]">
      Expiry Date
    </label>

    <input
      type="datetime-local"
      className="rounded border px-3 py-2 text-sm"
      value={form.expiryDate}
      onChange={(e) =>
        setForm((prev) => ({
          ...prev,
          expiryDate: e.target.value,
        }))
      }
    />
    {formErrors.expiryDate && (
      <p className="text-xs text-red-600 mt-1">{formErrors.expiryDate}</p>
    )}
  </div>

  {/* Stackable */}

  <div className="flex flex-col justify-end gap-1">
    <label className="flex items-center gap-2 text-xs font-medium">
      <input
        type="checkbox"
        checked={form.stackable}
        onChange={(e) =>
          setForm((prev) => ({
            ...prev,
            stackable: e.target.checked,
          }))
        }
      />
      Stackable
    </label>
  </div>

  {/* First Order */}

  <div className="flex flex-col justify-end gap-1">
    <label className="flex items-center gap-2 text-xs font-medium">
      <input
        type="checkbox"
        checked={form.firstOrderOnly}
        onChange={(e) =>
          setForm((prev) => ({
            ...prev,
            firstOrderOnly: e.target.checked,
          }))
        }
      />
      First Order Only
    </label>
  </div>

  {/* Button */}

  <div className="flex items-end gap-3 md:col-span-4">
    <button
      disabled={saving}
      className="rounded-full bg-[#7B3010] px-5 py-2.5 text-xs font-semibold uppercase tracking-wide text-white disabled:opacity-50"
    >
      {saving ? "Saving..." : editingId ? "Update Coupon" : "Create Coupon"}
    </button>
    {editingId && (
      <button
        type="button"
        disabled={saving}
        onClick={() => {
          setEditingId(null);
          setForm({
            code: "", description: "", discountType: "percentage", discountValue: "0",
            minOrderValue: "0", maxDiscount: "", usageLimit: "", usagePerUser: "",
            expiryDate: "", startsAt: "", stackable: false, firstOrderOnly: false,
          });
          setFormErrors({
            code: "", discountValue: "", minOrderValue: "", maxDiscount: "",
            usageLimit: "", usagePerUser: "", startsAt: "", expiryDate: "",
          });
        }}
        className="rounded-full border border-[#E8DCC8] bg-white px-5 py-2.5 text-xs font-semibold uppercase tracking-wide text-[#4A1D1F] hover:bg-[#FFFBF3] disabled:opacity-50"
      >
        Cancel
      </button>
    )}
  </div>

</form>

      {/* FILTERS */}

      <div className="flex flex-col  mb-1 md:flex-row md:items-center md:justify-between">
        <h3 className="text-lg font-medium text-[#4A1D1F]  font-melon">Coupons</h3>
        <div className="flex flex-row gap-3">
            <input
              type="text"
              placeholder="Search by code"
              className="w-full  rounded border bg-white px-3 py-2 text-sm md:max-w-[250px]"
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
            />
            <select
              className="w-full rounded border bg-white px-3 py-2 text-sm md:max-w-[150px]"
              value={statusFilter}
              onChange={(e) => setStatusFilter(e.target.value)}
            >
              {statusFilterOptions.map((option) => (
                <option key={option.value} value={option.value}>
                  {option.label}
                </option>
              ))}
            </select>
          
              <button
                type="button"
                onClick={() => {
                  setSearchQuery("");
                  setStatusFilter("all");
                }}
                className="w-full text-sm cursor-pointer  border bg-[#6C1C10] px-3 py-2  text-[#fff] rounded-full md:w-auto"
              >
                Clear
              </button>
          </div>
        
      </div>

      {/* TABLE */}

      <div className="rounded-xl border bg-white">

        <table className="w-full text-sm">

          <thead className="bg-[#FFFBF3] text-left">

            <tr>

              <th className="px-3 py-2">Code</th>
              <th className="px-3 py-2">Type</th>
              <th className="px-3 py-2">Value</th>
              <th className="px-3 py-2">Expiry</th>
              <th className="px-3 py-2">Status</th>
              <th className="px-3 py-2 text-center">Actions</th>

            </tr>

          </thead>

          <tbody>

            {filteredItems.map((item) => {
              const isExpired = item.endsAt ? new Date(item.endsAt) < new Date() : false;
              return (
                <tr key={item.id} className="border-t">

                <td className="px-3 py-2">{item.code}</td>

            <td className="px-3 py-2 capitalize">
                  {item?.discountType || "-"}
                </td>

                <td className="px-3 py-2">
                  {Number(item?.discountValue || 0)}
                </td>

            <td className="px-3 py-2 text-xs text-[#646464]">
                  {item.endsAt
                    ? new Date(item.endsAt).toLocaleString()
                    : "-"}
                </td>

                <td className="px-3 py-2">

                  {isExpired ? (
                    <span className="inline-block rounded-full border border-gray-200 bg-gray-50 px-3 py-1 text-[10px] font-semibold uppercase tracking-wider text-gray-700">
                      Expired
                    </span>
                  ) : (
                  <span
                    className={`inline-block rounded-full border px-3 py-1 text-[10px] font-semibold uppercase tracking-wider ${
                      item.active ?? (item as any).status
                        ? "border-green-200 bg-green-50 text-green-700"
                        : "border-red-200 bg-red-50 text-red-700"
                    }`}
                  >

                    {item.active ?? (item as any).status ? "Active" : "Inactive"}

                  </span>
                  )}

                </td>

                <td className="px-3 py-2 text-center">
                  <div className="flex items-center justify-center gap-2">
                  <button
                    type="button"
                    onClick={() => setViewCoupon(item)}
                    className="inline-flex items-center justify-center rounded-full border border-[#646464] p-1.5 text-[#646464] hover:bg-gray-50"
                    title="View Details"
                  >
                    <svg xmlns="http://www.w3.org/2000/svg" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                      <path d="M2 12s3-7 10-7 10 7 10 7-3 7-10 7-10-7-10-7Z" />
                      <circle cx="12" cy="12" r="3" />
                    </svg>
                  </button>
                  <button
                    type="button"
                    onClick={() => handleEdit(item)}
                    className="inline-flex items-center justify-center rounded-full border border-[#7B3010] p-1.5 text-[#7B3010] hover:bg-[#FFFBF3]"
                    title="Edit"
                  >
                    <svg xmlns="http://www.w3.org/2000/svg" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                      <path d="M12 20h9"></path>
                      <path d="M16.5 3.5a2.12 2.12 0 0 1 3 3L7 19l-4 1 1-4Z"></path>
                    </svg>
                  </button>
                  {!isExpired && (
                  <button
                    type="button"
                    role="switch"
                    aria-checked={item.active ?? (item as any).status}
                    disabled={saving || togglingId === item.id}
                    onClick={() => toggleStatus(item.id, item.active ?? (item as any).status)}
                    className={`relative inline-flex h-5 w-9 shrink-0 cursor-pointer items-center rounded-full border-2 border-transparent transition-colors duration-200 ease-in-out focus:outline-none focus-visible:ring-2 focus-visible:ring-[#7B3010] focus-visible:ring-offset-2 ${
                      item.active ?? (item as any).status ? "bg-green-500" : "bg-gray-300"
                    }`}
                    title={item.active ?? (item as any).status ? "Deactivate" : "Activate"}
                  >
                    <span className="sr-only">Toggle Status</span>
                    <span
                      aria-hidden="true"
                      className={`pointer-events-none inline-block h-4 w-4 transform rounded-full bg-white shadow ring-0 transition duration-200 ease-in-out ${
                        item.active ?? (item as any).status ? "translate-x-4" : "translate-x-0"
                      }`}
                    />
                  </button>
                  )}
                  </div>
                </td>

                </tr>
              );
            })}

            {!filteredItems.length && (

              <tr>

                <td
                  className="px-3 py-6 text-center text-[#646464]"
                  colSpan={6}
                >

                  No coupons yet.

                </td>

              </tr>

            )}

          </tbody>

        </table>

      </div>

      {/* VIEW COUPON MODAL */}
      {viewCoupon && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4 backdrop-blur-sm">
          <div className="w-full max-w-lg overflow-hidden rounded-2xl bg-white shadow-xl">
            <div className="flex items-center justify-between border-b border-[#E8DCC8] px-6 py-4">
              <h2 className="font-melon text-xl font-bold text-[#4A1D1F]">Coupon Details</h2>
              <button
                onClick={() => setViewCoupon(null)}
                className="text-[#646464] transition-colors hover:text-red-700"
                title="Close"
              >
                <svg xmlns="http://www.w3.org/2000/svg" width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                  <path d="M18 6 6 18" />
                  <path d="m6 6 12 12" />
                </svg>
              </button>
            </div>
            <div className="p-6 space-y-4 bg-[#FFFBF3]">
              <div className="grid grid-cols-2 gap-4">
                <div>
                  <p className="text-[10px] font-semibold uppercase tracking-wider text-[#646464]">Code</p>
                  <p className="mt-1 font-medium text-[#4A1D1F]">{viewCoupon.code}</p>
                </div>
                <div>
                  <p className="text-[10px] font-semibold uppercase tracking-wider text-[#646464]">Status</p>
                  <p className="mt-1 font-medium text-[#4A1D1F]">
                    {viewCoupon.active ?? (viewCoupon as any).status ? "Active" : "Inactive"}
                  </p>
                </div>
                <div className="col-span-2">
                  <p className="text-[10px] font-semibold uppercase tracking-wider text-[#646464]">Description</p>
                  <p className="mt-1 font-medium text-[#4A1D1F]">{viewCoupon.description || "—"}</p>
                </div>
                <div>
                  <p className="text-[10px] font-semibold uppercase tracking-wider text-[#646464]">Type</p>
                  <p className="mt-1 font-medium capitalize text-[#4A1D1F]">{viewCoupon.discountType}</p>
                </div>
                <div>
                  <p className="text-[10px] font-semibold uppercase tracking-wider text-[#646464]">Value</p>
                  <p className="mt-1 font-medium text-[#4A1D1F]">{viewCoupon.discountValue}</p>
                </div>
                <div>
                  <p className="text-[10px] font-semibold uppercase tracking-wider text-[#646464]">Min Order Amount</p>
                  <p className="mt-1 font-medium text-[#4A1D1F]">{viewCoupon.minOrderAmount ?? "—"}</p>
                </div>
                <div>
                  <p className="text-[10px] font-semibold uppercase tracking-wider text-[#646464]">Max Discount</p>
                  <p className="mt-1 font-medium text-[#4A1D1F]">{viewCoupon.maxDiscountAmount ?? "—"}</p>
                </div>
                <div>
                  <p className="text-[10px] font-semibold uppercase tracking-wider text-[#646464]">Usage Limit (Total)</p>
                  <p className="mt-1 font-medium text-[#4A1D1F]">{viewCoupon.usageLimitTotal ?? "—"}</p>
                </div>
                <div>
                  <p className="text-[10px] font-semibold uppercase tracking-wider text-[#646464]">Usage Limit (Per User)</p>
                  <p className="mt-1 font-medium text-[#4A1D1F]">{viewCoupon.usageLimitPerUser ?? "—"}</p>
                </div>
                <div className="col-span-2">
                  <p className="text-[10px] font-semibold uppercase tracking-wider text-[#646464]">Expiry</p>
                  <p className="mt-1 font-medium text-[#4A1D1F]">
                    {viewCoupon.endsAt ? new Date(viewCoupon.endsAt).toLocaleString() : "No Expiry"}
                  </p>
                </div>
              </div>
            </div>
          </div>
        </div>
      )}

    </section>

  )

}