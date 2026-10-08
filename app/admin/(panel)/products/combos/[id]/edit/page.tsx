"use client"

import Link from "next/link"
import { use } from "react"
import { ComboForm } from "@/components/dashboard/ComboForm"

export default function AdminEditComboPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = use(params)
  return (
    <section className="w-full space-y-4">
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <h1 className="font-melon text-2xl font-bold text-[#4A1D1F]">Edit Combo</h1>
          <p className="text-sm text-[#646464]">Update combo products, pricing, and active status.</p>
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
      <ComboForm bundleId={id} onSaved={() => (window.location.href = "/admin/products/combos")} />
    </section>
  )
}
