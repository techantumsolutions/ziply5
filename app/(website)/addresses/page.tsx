"use client";

import { useCallback, useEffect, useState, Suspense } from "react";
import Link from "next/link";
import { useRouter, useSearchParams } from "next/navigation";
import { authedDelete, authedFetch } from "@/lib/dashboard-fetch";

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

function AddressesContent() {
  const router = useRouter();
  const searchParams = useSearchParams();
  const next = searchParams ? searchParams.get("next") : null;
  const [rows, setRows] = useState<Addr[]>([]);
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState<string | null>(null);

  const load = useCallback(() => {
    const token = typeof window !== "undefined" ? window.localStorage.getItem("ziply5_access_token") : null;
    if (!token) {
      setLoading(false);
      router.replace("/login?next=/addresses");
      return;
    }
    setLoading(true);
    setError("");
    authedFetch<Addr[]>("/api/v1/me/addresses")
      .then(setRows)
      .catch((e: Error) => setError(e.message))
      .finally(() => setLoading(false));
  }, [router]);

  useEffect(() => {
    load();
  }, [load]);

  const remove = async (id: string) => {
    if (!confirm("Remove this address?")) return;
    setBusy(id);
    setError("");
    try {
      await authedDelete<{ id: string }>(`/api/v1/me/addresses/${id}`);
      await load();
      window.dispatchEvent(new Event("storage"));
    } catch (e) {
      setError(e instanceof Error ? e.message : "Could not delete");
    } finally {
      setBusy(null);
    }
  };

  return (
    <div className="mx-auto max-w-3xl px-4 py-12">
      {/* heading and back link */}
      <div className="mb-6 flex flex-wrap items-center justify-between gap-3">
        <div>
          <h1 className="font-melon text-2xl font-bold text-[#4A1D1F]">Saved addresses</h1>
          <p className="text-sm text-[#646464]">Used at checkout when you are signed in.</p>
        </div>
        <div className="flex items-center gap-4">
          <Link href={next ? `/addresses/manage?next=${encodeURIComponent(next)}` : `/addresses/manage`}>
            <button className="flex items-center gap-2 rounded-xl border border-[#7B3010] bg-[#FFFBF3] px-4 py-2 text-sm font-semibold text-[#7B3010] hover:bg-[#7B3010] hover:text-white transition-colors cursor-pointer">
              + Add New Address
            </button>
          </Link>
          <Link href="/profile" className="text-sm font-semibold text-[#7B3010] underline">
            Back to profile
          </Link>
        </div>
      </div>

      {error && <p className="mb-4 rounded-lg bg-red-50 px-3 py-2 text-sm text-red-800">{error}</p>}
      {loading && <p className="text-sm text-[#646464]">Loading…</p>}

      {!loading && (
        <ul className="space-y-3">
          {rows.length === 0 ? (
            <li className="rounded-2xl border border-[#E8DCC8] bg-white p-6 text-sm text-[#646464]">
              No addresses saved yet.
            </li>
          ) : (
            rows.map((a) => (
              <li
                key={a.id}
                className="flex flex-wrap items-start justify-between gap-3 rounded-2xl border border-[#E8DCC8] bg-white p-4 shadow-sm"
              >
                <div className="text-sm">
                  {(a.firstName || a.lastName) && (
                    <p className="font-semibold text-[#4A1D1F]">
                      {a.firstName} {a.lastName}
                    </p>
                  )}
                  {a.label && (
                    <p className="flex items-center gap-2 font-semibold text-[#4A1D1F]">
                      <span>{a.label}</span>
                      {a.isDefault && (
                        <span className="inline-flex items-center rounded-full border border-[#7B3010] bg-[#F3D6C4] px-2 py-0.5 text-[10px] font-bold uppercase tracking-wide text-[#7B3010]">
                          Default
                        </span>
                      )}
                    </p>
                  )}
                  <p className="text-[#333]">
                    {a.line1}
                    {a.line2 ? `, ${a.line2.replace(" || ", ", ")}` : ""}
                  </p>
                  <p className="text-[#646464]">
                    {a.city}, {a.state} {a.postalCode}, {a.country}
                  </p>
                  {a.phone && (
                    <p className="text-[#646464]">
                      {(() => {
                        const digits = a.phone.replace(/\D/g, "")
                        const national = digits.startsWith("91") && digits.length > 10 ? digits.slice(2) : digits
                        return /^\d{10}$/.test(national) ? `+91 ${national}` : a.phone
                      })()}
                    </p>
                  )}
                </div>
                <div className="flex gap-4">
                  <Link
                    href={
                      next
                        ? `/addresses/manage?id=${a.id}&next=${encodeURIComponent(next)}`
                        : `/addresses/manage?id=${a.id}`
                    }
                    className="text-xs font-semibold uppercase text-[#7B3010] hover:underline"
                  >
                    Edit
                  </Link>
                  <button
                    type="button"
                    disabled={busy === a.id}
                    onClick={() => remove(a.id)}
                    className="text-xs font-semibold uppercase text-red-700 hover:underline disabled:opacity-50"
                  >
                    {busy === a.id ? "…" : "Remove"}
                  </button>
                </div>
              </li>
            ))
          )}
        </ul>
      )}
    </div>
  );
}

export default function AddressesPage() {
  return (
    <Suspense fallback={<p className="text-sm text-[#646464] p-12 text-center">Loading…</p>}>
      <AddressesContent />
    </Suspense>
  );
}
