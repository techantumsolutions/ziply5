"use client"

import Link from "next/link"
import { ComboForm } from "@/components/dashboard/ComboForm"

export default function AdminCreateComboPage() {
  return (
    <section className="w-full space-y-4">
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <h1 className="font-melon text-2xl font-bold text-[#4A1D1F]">Create Combo</h1>
          <p className="text-sm text-[#646464]">Create a combo product from existing products.</p>
        </div>
        <div className="flex gap-2">
          <Link
            href="/admin/products/combos"
            className="rounded-full border border-[#E8DCC8] bg-white px-4 py-2 text-xs font-semibold uppercase tracking-wide text-[#4A1D1F] hover:bg-[#FFFBF3]"
          >
            Back
          </Link>
        </div>
      </div>
      <ComboForm onSaved={() => (window.location.href = "/admin/products/combos")} />
    </section>
  )
}

