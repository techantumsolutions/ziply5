"use client";

import { useEffect, useMemo, useState, Suspense } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import { MapPin } from "lucide-react";
import { authedFetch, authedPost, authedPatch } from "@/lib/dashboard-fetch";
import { useLocations } from "@/hooks/useLocations";
import { toast } from "@/lib/toast";

type Addr = {
  id: string;
  label: string | null;
  firstName: string | null;
  lastName: string | null;
  email: string | null;
  line1: string;
  line2: string | null;
  city: string;
  state: string;
  postalCode: string;
  country: string;
  phone: string | null;
  isDefault: boolean;
};

type AddressType = "Home" | "Work" | "Other";

const INDIAN_STATES = [
  "Andhra Pradesh",
  "Arunachal Pradesh",
  "Assam",
  "Bihar",
  "Chhattisgarh",
  "Goa",
  "Gujarat",
  "Haryana",
  "Himachal Pradesh",
  "Jharkhand",
  "Karnataka",
  "Kerala",
  "Madhya Pradesh",
  "Maharashtra",
  "Manipur",
  "Meghalaya",
  "Mizoram",
  "Nagaland",
  "Odisha",
  "Punjab",
  "Rajasthan",
  "Sikkim",
  "Tamil Nadu",
  "Telangana",
  "Tripura",
  "Uttar Pradesh",
  "Uttarakhand",
  "West Bengal",
  "Andaman and Nicobar Islands",
  "Chandigarh",
  "Dadra and Nagar Haveli and Daman and Diu",
  "Delhi",
  "Jammu and Kashmir",
  "Ladakh",
  "Lakshadweep",
  "Puducherry",
];

function nationalPhone(raw: string | null | undefined) {
  let digits = String(raw ?? "").replace(/\D/g, "");
  if (digits.startsWith("91") && digits.length > 10) digits = digits.slice(2);
  else if (digits.startsWith("0") && digits.length > 10) digits = digits.slice(1);
  return digits.slice(0, 10);
}

function titleCase(value: string) {
  return value
    .toLowerCase()
    .split(/\s+/)
    .filter(Boolean)
    .map((word) => word.charAt(0).toUpperCase() + word.slice(1))
    .join(" ");
}

function unpackLine2(line2: string | null) {
  const raw = (line2 ?? "").trim();
  if (!raw) return { building: "", area: "" };
  if (raw.includes(" || ")) {
    const [building, area] = raw.split(" || ");
    return { building: building.trim(), area: area.trim() };
  }
  return { building: "", area: raw };
}

function packLine2(building: string, area: string) {
  const built = building.trim();
  const locality = area.trim();
  if (built && locality) return `${built} || ${locality}`;
  return locality || built || null;
}

function splitAddressLabel(label: string | null): { type: AddressType; custom: string } {
  const raw = (label ?? "").trim();
  const value = raw.toLowerCase();
  if (!raw || value === "home") return { type: "Home", custom: "" };
  if (value === "work" || value === "office") return { type: "Work", custom: "" };
  if (value === "other") return { type: "Other", custom: "" };
  return { type: "Other", custom: raw };
}

function ManageAddressContent() {
  const router = useRouter();
  const searchParams = useSearchParams();
  const id = searchParams ? searchParams.get("id") : null;
  const next = searchParams ? searchParams.get("next") : null;

  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  const [addressCount, setAddressCount] = useState(0);

  const [fullName, setFullName] = useState("");
  const [phone, setPhone] = useState("");
  const [addressType, setAddressType] = useState<AddressType>("Home");
  const [customAddressType, setCustomAddressType] = useState("");
  const [postalCode, setPostalCode] = useState("");
  const [flat, setFlat] = useState("");
  const [building, setBuilding] = useState("");
  const [area, setArea] = useState("");
  const [city, setCity] = useState("");
  const [state, setState] = useState("");
  const [isDefault, setIsDefault] = useState(false);
  const [checkingPin, setCheckingPin] = useState(false);
  const [pinMessage, setPinMessage] = useState("");
  const [pinOk, setPinOk] = useState(false);
  const [checkedPin, setCheckedPin] = useState("");

  const { data: locationStates } = useLocations("state");
  const stateOptions = useMemo(() => {
    const labels = new Set<string>(INDIAN_STATES);
    for (const row of locationStates ?? []) {
      if (row.label) labels.add(row.label);
    }
    if (state) labels.add(state);
    return Array.from(labels);
  }, [locationStates, state]);

  const onlyAddress = id ? addressCount <= 1 : addressCount === 0;

  useEffect(() => {
    const load = async () => {
      try {
        const rows = await authedFetch<Addr[]>("/api/v1/me/addresses");
        setAddressCount(rows.length);
        if (!id) {
          if (rows.length === 0) setIsDefault(true);
          return;
        }
        const match = rows.find((row) => row.id === id);
        if (!match) {
          toast.error("Address not found.");
          router.push(next && next.startsWith("/") ? next : "/addresses");
          return;
        }
        const unpacked = unpackLine2(match.line2);
        setFullName([match.firstName, match.lastName].filter(Boolean).join(" "));
        setPhone(nationalPhone(match.phone));
        const parsedLabel = splitAddressLabel(match.label);
        setAddressType(parsedLabel.type);
        setCustomAddressType(parsedLabel.custom);
        setFlat(match.line1 || "");
        setBuilding(unpacked.building);
        setArea(unpacked.area);
        setCity(match.city || "");
        setState(match.state || "");
        setPostalCode(match.postalCode || "");
        setCheckedPin(match.postalCode || "");
        setPinOk(/^[1-9][0-9]{5}$/.test(match.postalCode || ""));
        setIsDefault(rows.length <= 1 ? true : match.isDefault);
      } catch (err) {
        setError(err instanceof Error ? err.message : "Failed to load address details.");
      } finally {
        setLoading(false);
      }
    };
    void load();
  }, [id, next, router]);

  useEffect(() => {
    if (id) return;
    const token = window.localStorage.getItem("ziply5_access_token");
    const userStr = window.localStorage.getItem("ziply5_user");
    if (!token || !userStr) return;
    let userId = "";
    try {
      const user = JSON.parse(userStr);
      userId = user?.id || "";
      if (user?.name) setFullName(user.name);
    } catch {
      return;
    }
    if (!userId) return;
    void fetch(`/api/v1/profile?userId=${encodeURIComponent(userId)}`, {
      headers: { Authorization: `Bearer ${token}`, "x-user-id": userId },
    })
      .then((res) => res.json())
      .then((payload) => {
        if (!payload.success || !payload.data) return;
        if (payload.data.name) setFullName(payload.data.name);
        if (payload.data.profile?.phone) setPhone(nationalPhone(payload.data.profile.phone));
      })
      .catch(() => null);
  }, [id]);

  const goBack = () => {
    router.push(next && next.startsWith("/") ? next : "/addresses");
  };

  const checkPincode = async () => {
    const pin = postalCode.trim();
    if (!/^[1-9][0-9]{5}$/.test(pin)) {
      const message = "Enter a valid 6-digit pincode.";
      setPinOk(false);
      setCheckedPin("");
      setPinMessage(message);
      toast.error(message);
      return;
    }
    setCheckingPin(true);
    setPinMessage("");
    setError("");
    try {
      const serviceRes = await fetch("/api/shipping/check-serviceability", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ delivery_postcode: pin, cod: false }),
      });
      const servicePayload = await serviceRes.json().catch(() => null);
      const serviceData = servicePayload?.data ?? servicePayload ?? {};
      const notServiceable = !serviceRes.ok || serviceData.deliverable === false || serviceData.status === "not_deliverable";
      if (notServiceable) {
        const message = serviceData.message || "This pincode is not serviceable for delivery.";
        setPinOk(false);
        setCheckedPin("");
        setCity("");
        setState("");
        setPinMessage(message);
        toast.error(message);
        return;
      }

      const pinRes = await fetch(`/api/v1/pincode/${pin}`);
      const pinPayload = await pinRes.json().catch(() => null);
      if (!pinRes.ok || !pinPayload?.success || !pinPayload.data) {
        const message = "Pincode is serviceable, but city and state could not be found. Enter them manually.";
        setPinOk(true);
        setCheckedPin(pin);
        setPinMessage(message);
        toast.error(message);
        return;
      }

      const fetchedState = titleCase(String(pinPayload.data.state || ""));
      const fetchedCity = titleCase(String(pinPayload.data.district || pinPayload.data.city || ""));
      if (fetchedState) setState(fetchedState);
      if (fetchedCity) setCity(fetchedCity);
      if (!area.trim() && Array.isArray(pinPayload.data.names)) {
        const locality = pinPayload.data.names.find((name: string) => name && name.toLowerCase() !== fetchedCity.toLowerCase());
        if (locality) setArea(titleCase(String(locality)));
      }
      setPinOk(true);
      setCheckedPin(pin);
      setPinMessage("This pincode is serviceable. City and state have been filled.");
    } catch (err) {
      const message = err instanceof Error ? err.message : "Could not check this pincode.";
      setPinOk(false);
      setCheckedPin("");
      setPinMessage(message);
      toast.error(message);
    } finally {
      setCheckingPin(false);
    }
  };

  const save = async (event: React.FormEvent) => {
    event.preventDefault();
    const name = fullName.trim();
    const pin = postalCode.trim();
    const mobile = nationalPhone(phone);
    if (!name) {
      const message = "Full name is required.";
      setError(message);
      toast.error(message);
      return;
    }
    if (!/^[6-9]\d{9}$/.test(mobile)) {
      const message = "Wrong contact number";
      setError(message);
      toast.error(message);
      return;
    }
    if (!/^[1-9][0-9]{5}$/.test(pin)) {
      const message = "Enter a valid 6-digit pincode.";
      setError(message);
      toast.error(message);
      return;
    }
    if (!pinOk || checkedPin !== pin) {
      const message = "Check the pincode before saving.";
      setError(message);
      toast.error(message);
      return;
    }
    const customLabel = customAddressType.trim();
    if (addressType === "Other" && !customLabel) {
      const message = "Enter the address type.";
      setError(message);
      toast.error(message);
      return;
    }
    if (!flat.trim() || !area.trim() || !city.trim() || !state.trim()) {
      const message = "Flat, area, city, and state are required.";
      setError(message);
      toast.error(message);
      return;
    }

    const nameParts = name.split(/\s+/);
    setBusy(true);
    setError("");
    try {
      const payload = {
        label: addressType === "Other" ? customLabel : addressType,
        firstName: nameParts[0] || null,
        lastName: nameParts.slice(1).join(" ") || null,
        email: null,
        line1: flat.trim(),
        line2: packLine2(building, area),
        city: city.trim(),
        state: state.trim(),
        postalCode: pin,
        country: "IN",
        phone: mobile,
        isDefault: onlyAddress ? true : isDefault,
      };
      if (id) {
        await authedPatch(`/api/v1/me/addresses/${id}`, payload);
        toast.success("Address updated successfully.");
      } else {
        await authedPost("/api/v1/me/addresses", payload);
        toast.success("Address saved successfully.");
      }
      window.dispatchEvent(new Event("storage"));
      goBack();
    } catch (err) {
      const message = err instanceof Error ? err.message : "Could not save address";
      setError(message);
      toast.error(message);
    } finally {
      setBusy(false);
    }
  };

  if (loading) {
    return (
      <div className="mx-auto max-w-4xl px-4 py-24 text-center">
        <p className="text-sm text-[#646464] animate-pulse">Loading address details…</p>
      </div>
    );
  }

  const fieldClass = "mt-1.5 h-11 w-full rounded-lg border border-[#E5E7EB] bg-white px-3 text-sm text-[#111827] outline-none placeholder:text-[#9CA3AF] focus:border-[#2563EB] focus:ring-2 focus:ring-[#2563EB]/20";

  return (
    <div className="mx-auto max-w-4xl px-4 py-10">
      <div className="rounded-2xl border border-[#E5E7EB] bg-white p-6 shadow-sm sm:p-8">
        <form onSubmit={save} className="space-y-8">
          <section>
            <h2 className="text-base font-semibold text-[#111827]">Contact Information</h2>
            <div className="mt-4 grid gap-4 sm:grid-cols-2">
              <label className="text-sm font-medium text-[#374151]">
                Full Name <span className="text-red-500">*</span>
                <input
                  required
                  value={fullName}
                  onChange={(e) => setFullName(e.target.value)}
                  className={fieldClass}
                  placeholder="Enter full name"
                />
              </label>
              <label className="text-sm font-medium text-[#374151]">
                Phone Number <span className="text-red-500">*</span>
                <div className="mt-1.5 flex h-11 overflow-hidden rounded-lg border border-[#E5E7EB] bg-white focus-within:border-[#2563EB] focus-within:ring-2 focus-within:ring-[#2563EB]/20">
                  <span className="flex items-center border-r border-[#E5E7EB] bg-[#F9FAFB] px-3 text-sm font-medium text-[#111827]">+91</span>
                  <input
                    required
                    inputMode="numeric"
                    autoComplete="tel-national"
                    maxLength={10}
                    value={phone}
                    onChange={(e) => setPhone(e.target.value.replace(/\D/g, "").slice(0, 10))}
                    className="w-full px-3 text-sm outline-none placeholder:text-[#9CA3AF]"
                    placeholder="Enter mobile number"
                  />
                </div>
              </label>
            </div>
          </section>

          <section>
            <h2 className="text-base font-semibold text-[#111827]">Address Details</h2>
            <div className="mt-4">
              <p className="text-sm font-medium text-[#374151]">
                Address Type <span className="text-red-500">*</span>
              </p>
              <div className="mt-2 flex flex-wrap gap-6 text-sm text-[#374151]">
                {(["Home", "Work", "Other"] as AddressType[]).map((type) => (
                  <label key={type} className="inline-flex cursor-pointer items-center gap-2">
                    <input
                      type="radio"
                      name="addressType"
                      checked={addressType === type}
                      onChange={() => setAddressType(type)}
                      className="h-4 w-4 accent-[#2563EB]"
                    />
                    {type}
                  </label>
                ))}
              </div>
              {addressType === "Other" ? (
                <label className="mt-3 block max-w-sm text-sm font-medium text-[#374151]">
                  Address type name <span className="text-red-500">*</span>
                  <input
                    required
                    value={customAddressType}
                    onChange={(e) => setCustomAddressType(e.target.value)}
                    className={fieldClass}
                    placeholder="E.g. Parents, Hostel"
                  />
                </label>
              ) : null}
            </div>

            <div className="mt-4 grid gap-4 sm:grid-cols-[1fr_auto] sm:items-end">
              <label className="text-sm font-medium text-[#374151]">
                Pincode <span className="text-red-500">*</span>
                <input
                  required
                  inputMode="numeric"
                  maxLength={6}
                  value={postalCode}
                  onChange={(e) => {
                    const nextPin = e.target.value.replace(/\D/g, "").slice(0, 6);
                    setPostalCode(nextPin);
                    if (nextPin !== checkedPin) {
                      setPinOk(false);
                      setPinMessage("");
                    }
                  }}
                  className={fieldClass}
                  placeholder="Enter pincode"
                />
              </label>
              <button
                type="button"
                onClick={() => void checkPincode()}
                disabled={checkingPin}
                className="inline-flex h-11 items-center justify-center gap-2 rounded-lg border border-[#2563EB] px-4 text-sm font-semibold text-[#2563EB] hover:bg-[#EFF6FF] disabled:opacity-50"
              >
                <MapPin className="h-4 w-4" />
                {checkingPin ? "Checking…" : "Check"}
              </button>
            </div>
            {pinMessage ? (
              <p className={`mt-2 text-sm ${pinOk ? "text-green-700" : "text-red-600"}`}>{pinMessage}</p>
            ) : null}

            <label className="mt-4 block text-sm font-medium text-[#374151]">
              Flat / House No. <span className="text-red-500">*</span>
              <input
                required
                value={flat}
                onChange={(e) => setFlat(e.target.value)}
                className={fieldClass}
                placeholder="E.g. 12A, 3rd Floor"
              />
            </label>

            <div className="mt-4 grid gap-4 sm:grid-cols-2">
              <label className="text-sm font-medium text-[#374151]">
                Building / Apartment / Society
                <input
                  value={building}
                  onChange={(e) => setBuilding(e.target.value)}
                  className={fieldClass}
                  placeholder="E.g. Green Valley Apartments"
                />
              </label>
              <label className="text-sm font-medium text-[#374151]">
                Area / Locality <span className="text-red-500">*</span>
                <input
                  required
                  value={area}
                  onChange={(e) => setArea(e.target.value)}
                  className={fieldClass}
                  placeholder="E.g. Banjara Hills"
                />
              </label>
              <label className="text-sm font-medium text-[#374151]">
                City / Town <span className="text-red-500">*</span>
                <input
                  required
                  value={city}
                  onChange={(e) => setCity(e.target.value)}
                  className={fieldClass}
                  placeholder="Enter city / town"
                />
              </label>
              <label className="text-sm font-medium text-[#374151]">
                State <span className="text-red-500">*</span>
                <select
                  required
                  value={state}
                  onChange={(e) => setState(e.target.value)}
                  className={fieldClass}
                >
                  <option value="">Select state</option>
                  {stateOptions.map((name) => (
                    <option key={name} value={name}>{name}</option>
                  ))}
                </select>
              </label>
            </div>

            <label className={`mt-5 flex items-start gap-3 ${onlyAddress ? "opacity-80" : "cursor-pointer"}`}>
              <input
                type="checkbox"
                checked={onlyAddress ? true : isDefault}
                disabled={onlyAddress}
                onChange={(e) => setIsDefault(e.target.checked)}
                className="mt-0.5 h-4 w-4 rounded accent-[#2563EB]"
              />
              <span>
                <span className="block text-sm font-medium text-[#111827]">Set as default address</span>
                <span className="block text-xs text-[#6B7280]">
                  {onlyAddress
                    ? "This is your only address, so it is used as the default shipping address."
                    : "This address will be used as your default shipping address."}
                </span>
              </span>
            </label>
          </section>

          {error ? <p className="rounded-lg bg-red-50 px-3 py-2 text-sm text-red-700">{error}</p> : null}

          <div className="flex items-center justify-between border-t border-[#F3F4F6] pt-5">
            <button
              type="button"
              onClick={goBack}
              className="h-11 rounded-lg border border-[#D1D5DB] bg-white px-5 text-sm font-medium text-[#374151] hover:bg-[#F9FAFB]"
            >
              Cancel
            </button>
            <button
              type="submit"
              disabled={busy}
              className="h-11 rounded-lg bg-[#2563EB] px-5 text-sm font-semibold text-white hover:bg-[#1D4ED8] disabled:opacity-50"
            >
              {busy ? "Saving…" : "Save Address"}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}

export default function ManageAddressPage() {
  return (
    <Suspense fallback={<p className="p-12 text-center text-sm text-[#646464]">Loading…</p>}>
      <ManageAddressContent />
    </Suspense>
  );
}
