"use client"

import { useEffect, useState, use } from "react"
import ProductUsageForm from "@/components/admin/product-usage/ProductUsageForm"
import { authedFetch } from "@/lib/dashboard-fetch"
import { Loader2 } from "lucide-react"

export default function AdminProductUsageEditPage({ params }: { params: Promise<{ id: string }> }) {
  const resolvedParams = use(params)
  const [data, setData] = useState<any | null>(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState("")

  useEffect(() => {
    let cancelled = false
    setLoading(true)
    authedFetch<any>(`/api/admin/product-usage/${resolvedParams.id}`)
      .then((record) => {
        if (cancelled) return
        if (!record) {
          setError("Product Usage entry not found")
        } else {
          setData(record)
        }
      })
      .catch((err) => {
        if (!cancelled) setError(err instanceof Error ? err.message : "Failed to load entry")
      })
      .finally(() => {
        if (!cancelled) setLoading(false)
      })
    return () => {
      cancelled = true
    }
  }, [resolvedParams.id])

  if (loading) {
    return (
      <div className="flex h-64 items-center justify-center">
        <Loader2 className="h-8 w-8 animate-spin text-[#7B3010]" />
      </div>
    )
  }

  if (error || !data) {
    return (
      <div className="rounded-xl border border-red-200 bg-red-50 p-6 text-center text-red-800">
        {error || "Entry not found"}
      </div>
    )
  }

  return <ProductUsageForm initialData={data} isEdit={true} />
}
