"use client"

import { useCallback, useEffect, useState } from "react"
import { authedFetch, authedPost, authedPut } from "@/lib/dashboard-fetch"
import { ConsoleTable, ConsoleTd } from "@/components/dashboard/ConsoleTable"
import { UploadCloud, X, Loader2 } from "lucide-react"

type FeatureRow = {
  id: string
  title: string
  icon: string | null
  isActive: boolean
  sortOrder: number
}

export default function AdminProductFeaturesPage() {
  const [rows, setRows] = useState<FeatureRow[]>([])
  const [error, setError] = useState("")
  const [loading, setLoading] = useState(true)
  const [isModalOpen, setIsModalOpen] = useState(false)
  const [editing, setEditing] = useState<FeatureRow | null>(null)
  const [title, setTitle] = useState("")
  const [icon, setIcon] = useState("")
  const [sortOrder, setSortOrder] = useState("0")
  const [saving, setSaving] = useState(false)
  const [uploading, setUploading] = useState(false)

  const load = useCallback(() => {
    setLoading(true)
    setError("")
    authedFetch<FeatureRow[]>("/api/v1/feature-definitions")
      .then(setRows)
      .catch((e: Error) => setError(e.message))
      .finally(() => setLoading(false))
  }, [])

  useEffect(() => {
    load()
  }, [load])

  const openAdd = () => {
    setEditing(null)
    setTitle("")
    setIcon("")
    setSortOrder(String((rows.length + 1) * 10))
    setIsModalOpen(true)
    setError("")
  }

  const openEdit = (row: FeatureRow) => {
    setEditing(row)
    setTitle(row.title)
    setIcon(row.icon ?? "")
    setSortOrder(String(row.sortOrder ?? 0))
    setIsModalOpen(true)
    setError("")
  }

  const uploadIcon = async (files: FileList | null) => {
    const selected = files?.[0]
    if (!selected) return
    if (selected.size > 2 * 1024 * 1024) {
      setError("File size exceeds 2 MB limit. Please select a smaller square icon.")
      return
    }
    setUploading(true)
    setError("")
    try {
      const token = window.localStorage.getItem("ziply5_access_token")
      const form = new FormData()
      form.append("files", selected)
      form.append("folder", "products/feature-icons")
      const res = await fetch("/api/v1/uploads", {
        method: "POST",
        headers: token ? { Authorization: `Bearer ${token}` } : undefined,
        body: form,
      })
      const json = (await res.json()) as {
        success?: boolean
        message?: string
        data?: { files?: Array<{ url: string }> }
      }
      if (!res.ok || json.success === false) {
        setError(json.message ?? "Icon upload failed")
        return
      }
      const url = json.data?.files?.[0]?.url
      if (!url) {
        setError("Icon upload failed")
        return
      }
      setIcon(url)
    } catch {
      setError("Icon upload failed")
    } finally {
      setUploading(false)
    }
  }

  const handleSave = async (e: React.FormEvent) => {
    e.preventDefault()
    if (!title.trim()) return
    setSaving(true)
    setError("")
    try {
      const payload = {
        title: title.trim(),
        icon: icon.trim() || null,
        sortOrder: Number(sortOrder) || 0,
        isActive: editing?.isActive ?? true,
      }
      if (editing) {
        await authedPut(`/api/v1/feature-definitions/${editing.id}`, payload)
      } else {
        await authedPost("/api/v1/feature-definitions", payload)
      }
      setIsModalOpen(false)
      setEditing(null)
      await load()
    } catch (e) {
      setError(e instanceof Error ? e.message : "Save failed")
    } finally {
      setSaving(false)
    }
  }

  const toggleActive = async (row: FeatureRow) => {
    try {
      setError("")
      await authedPut(`/api/v1/feature-definitions/${row.id}`, {
        title: row.title,
        icon: row.icon,
        sortOrder: row.sortOrder,
        isActive: !row.isActive,
      })
      await load()
    } catch (e) {
      setError(e instanceof Error ? e.message : "Update failed")
    }
  }

  return (
    <section className="w-full space-y-4">
      <div className="flex items-center justify-between gap-3">
        <div>
          <h1 className="font-melon text-2xl font-bold text-[#4A1D1F]">Product Features</h1>
          <p className="text-sm text-[#646464]">
            Common feature icons and titles. Select them with checkboxes when adding or editing a product.
          </p>
        </div>
        <button
          type="button"
          onClick={openAdd}
          className="rounded-full bg-[#7B3010] px-5 py-2.5 text-xs font-semibold uppercase tracking-wide text-white hover:bg-[#5C230B]"
        >
          Add Feature
        </button>
      </div>

      {isModalOpen && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4 backdrop-blur-sm">
          <div className="w-full max-w-md rounded-2xl border border-[#E8DCC8] bg-white p-6 shadow-2xl">
            <div className="flex items-center justify-between pb-3 border-b border-[#E8DCC8]">
              <h2 className="text-xl font-bold text-[#4A1D1F]">
                {editing ? "Edit Feature" : "Add Feature"}
              </h2>
              <button
                type="button"
                onClick={() => setIsModalOpen(false)}
                className="rounded-lg p-1 text-[#646464] hover:bg-[#FFF7EA] hover:text-[#4A1D1F]"
              >
                <X className="h-5 w-5" />
              </button>
            </div>
            <form onSubmit={handleSave} className="mt-4 space-y-4">
              {error && <p className="rounded-lg bg-red-50 p-2.5 text-xs text-red-800 border border-red-200">{error}</p>}
              
              <label className="block text-xs font-semibold uppercase tracking-wider text-[#646464]">
                Title <span className="text-red-500">*</span>
                <input
                  value={title}
                  onChange={(e) => setTitle(e.target.value)}
                  className="mt-1 block w-full rounded-xl border border-[#D9D9D1] px-3.5 py-2.5 text-sm normal-case focus:border-[#7B3010] focus:outline-none"
                  required
                  placeholder="e.g. 100% Natural"
                />
              </label>

              {/* Highlighted Upload Dropzone */}
              <div className="space-y-1.5">
                <label className="block text-xs font-semibold uppercase tracking-wider text-[#646464]">
                  Feature Icon
                </label>
                <div className="relative flex flex-col items-center justify-center rounded-2xl border-2 border-dashed border-[#7B3010]/40 bg-[#FFFDF9] p-4 text-center transition-colors hover:border-[#7B3010] hover:bg-[#FFF7EA]">
                  <input
                    type="file"
                    accept="image/*"
                    onChange={(e) => void uploadIcon(e.target.files)}
                    disabled={uploading}
                    className="absolute inset-0 z-10 cursor-pointer opacity-0 disabled:cursor-not-allowed"
                  />
                  <div className="flex flex-col items-center gap-1.5">
                    <div className="flex h-10 w-10 items-center justify-center rounded-full bg-[#FFF0E6] text-[#7B3010]">
                      {uploading ? <Loader2 className="h-5 w-5 animate-spin" /> : <UploadCloud className="h-5 w-5" />}
                    </div>
                    <p className="text-xs font-semibold text-[#4A1D1F]">
                      {uploading ? "Uploading icon…" : "Click or drag to upload feature icon"}
                    </p>
                    <div className="mt-1 space-y-0.5 text-[11px] text-[#7A7A7A]">
                      <p>• Resolution: <strong className="font-semibold text-[#2A1810]">Square (1:1 aspect ratio)</strong></p>
                      <p>• Suggested Dimensions: <strong className="font-semibold text-[#2A1810]">64×64 px to 128×128 px</strong></p>
                      <p>• Size Limit: <strong className="font-semibold text-[#2A1810]">Max 2 MB</strong> (PNG, SVG, WEBP, JPG)</p>
                    </div>
                  </div>
                </div>
              </div>

              {icon ? (
                <div className="flex items-center justify-between rounded-xl border border-[#E8DCC8] bg-[#FFFBF3] p-3">
                  <div className="flex items-center gap-3">
                    <img src={icon} alt="Feature Icon Preview" className="h-10 w-10 rounded-lg border border-[#E8DCC8] bg-white object-contain p-1" />
                    <div>
                      <p className="text-xs font-semibold text-[#4A1D1F]">Icon Uploaded</p>
                      <p className="text-[10px] text-[#7A7A7A]">Square format ready</p>
                    </div>
                  </div>
                  <button
                    type="button"
                    onClick={() => setIcon("")}
                    className="rounded-lg border border-red-200 bg-red-50 px-2.5 py-1 text-xs font-semibold text-red-600 hover:bg-red-100"
                  >
                    Remove
                  </button>
                </div>
              ) : null}

              <label className="block text-xs font-semibold uppercase tracking-wider text-[#646464]">
                Display Order
                <input
                  type="number"
                  value={sortOrder}
                  onChange={(e) => setSortOrder(e.target.value)}
                  className="mt-1 block w-full rounded-xl border border-[#D9D9D1] px-3.5 py-2.5 text-sm normal-case focus:border-[#7B3010] focus:outline-none"
                />
              </label>

              <div className="flex justify-end gap-3 pt-2">
                <button
                  type="button"
                  onClick={() => setIsModalOpen(false)}
                  className="rounded-full px-5 py-2.5 text-xs font-semibold uppercase tracking-wide text-[#646464] hover:bg-gray-100"
                >
                  Cancel
                </button>
                <button
                  type="submit"
                  disabled={saving || uploading}
                  className="rounded-full bg-[#7B3010] px-5 py-2.5 text-xs font-semibold uppercase tracking-wide text-white hover:bg-[#5C230B] disabled:opacity-50"
                >
                  {saving ? "Saving…" : editing ? "Update" : "Add feature"}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      {error && <p className="rounded-lg bg-red-50 px-3 py-2 text-sm text-red-800">{error}</p>}
      {loading && <p className="text-sm text-[#646464]">Loading…</p>}

      {!loading && (
        <ConsoleTable headers={["Icon", "Title", "Order", "Status", "Actions"]}>
          {rows.length === 0 ? (
            <tr>
              <ConsoleTd className="py-8 text-center text-[#646464]" colSpan={5}>
                No features yet. Add common features here first.
              </ConsoleTd>
            </tr>
          ) : (
            rows.map((row) => (
              <tr key={row.id} className="hover:bg-[#FFFBF3]/80">
                <ConsoleTd>
                  {row.icon ? (
                    <img src={row.icon} alt="" className="h-8 w-8 rounded object-cover border border-[#E8DCC8]" />
                  ) : (
                    <span className="text-xs text-[#646464]">—</span>
                  )}
                </ConsoleTd>
                <ConsoleTd className="font-medium">{row.title}</ConsoleTd>
                <ConsoleTd>{row.sortOrder}</ConsoleTd>
                <ConsoleTd>
                  <span className={`rounded-full px-2 py-0.5 text-[10px] font-bold uppercase ${row.isActive ? "bg-green-100 text-green-700" : "bg-gray-100 text-gray-600"}`}>
                    {row.isActive ? "Active" : "Inactive"}
                  </span>
                </ConsoleTd>
                <ConsoleTd className="flex gap-3">
                  <button
                    type="button"
                    onClick={() => openEdit(row)}
                    className="rounded-full border border-[#D9D9D1] px-2 py-1 text-[11px] font-semibold uppercase text-[#7B3010]"
                  >
                    Edit
                  </button>
                  <button
                    type="button"
                    onClick={() => void toggleActive(row)}
                    className={`rounded-full border border-[#D9D9D1] px-3 py-1 text-[11px] font-semibold uppercase ${row.isActive ? "text-red-600" : "text-green-600"}`}
                  >
                    {row.isActive ? "Deactivate" : "Activate"}
                  </button>
                </ConsoleTd>
              </tr>
            ))
          )}
        </ConsoleTable>
      )}
    </section>
  )
}
