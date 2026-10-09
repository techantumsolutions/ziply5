"use client"

import { FormEvent, useState, ChangeEvent } from "react"
import { useRouter } from "next/navigation"
import { useQueryClient } from "@tanstack/react-query"
import { useMasterValues } from "@/hooks/useMasterData"
import { authedFetch } from "@/lib/dashboard-fetch"
import { Download, Upload, Plus, FileSpreadsheet, CheckCircle2, AlertCircle, Trash2, Search, FileText, X, Loader2, ChevronLeft, ChevronRight } from "lucide-react"
import { toast } from "@/lib/toast"

type MasterValue = {
  id: string
  groupKey: string
  label: string
  value: string
  sortOrder: number
  isActive: boolean
}

const PAGE_SIZE = 10

export default function HsnBarcodePage() {
  const router = useRouter()
  const queryClient = useQueryClient()
  const [activeTab, setActiveTab] = useState<"HSN_CODE" | "BARCODE_NUMBER">("HSN_CODE")

  // Single creation state
  const [singleCode, setSingleCode] = useState("")
  const [singleName, setSingleName] = useState("")
  const [savingSingle, setSavingSingle] = useState(false)
  const [singleError, setSingleError] = useState("")

  // Bulk upload state
  const [selectedFile, setSelectedFile] = useState<File | null>(null)
  const [parsedItems, setParsedItems] = useState<Array<{ code: string; name?: string }>>([])
  const [uploadingBulk, setUploadingBulk] = useState(false)
  const [bulkResult, setBulkResult] = useState<{
    createdCount: number
    skippedCount: number
    total: number
    errors: string[]
  } | null>(null)
  const [bulkError, setBulkError] = useState("")

  // Search & Pagination filter
  const [searchQuery, setSearchQuery] = useState("")
  const [currentPage, setCurrentPage] = useState(1)

  // Fetch master values
  const { data: items = [], isLoading, refetch } = useMasterValues(activeTab, true, false)

  const isHsn = activeTab === "HSN_CODE"
  const title = isHsn ? "HSN Master" : "Barcode Master"
  const codeLabel = isHsn ? "HSN Code" : "Barcode Number"
  const nameLabel = isHsn ? "HSN Name / Description" : "Barcode Name / Product"

  const filteredItems = (items as MasterValue[]).filter((item) => {
    if (!searchQuery.trim()) return true
    const q = searchQuery.toLowerCase()
    return item.value.toLowerCase().includes(q) || item.label.toLowerCase().includes(q)
  })

  const totalPages = Math.ceil(filteredItems.length / PAGE_SIZE) || 1
  const validCurrentPage = Math.min(currentPage, totalPages)
  const startIndex = (validCurrentPage - 1) * PAGE_SIZE
  const endIndex = Math.min(startIndex + PAGE_SIZE, filteredItems.length)
  const paginatedItems = filteredItems.slice(startIndex, endIndex)

  // Handle single item add
  const handleSingleSubmit = async (e: FormEvent) => {
    e.preventDefault()
    setSingleError("")

    const code = singleCode.trim()
    const name = singleName.trim()

    if (!code) {
      setSingleError(`${codeLabel} is required`)
      return
    }

    setSavingSingle(true)
    try {
      const res = await authedFetch<{
        createdCount: number
        skippedCount: number
        total: number
        errors: string[]
      }>("/api/admin/hsn-barcode/bulk", {
        method: "POST",
        body: JSON.stringify({
          type: activeTab,
          items: [{ code, name }],
        }),
      })

      if (res?.skippedCount > 0) {
        const errMsg = res.errors?.[0] || `${codeLabel} "${code}" already exists or is invalid.`
        setSingleError(errMsg)
        toast.error(errMsg)
      } else {
        setSingleCode("")
        setSingleName("")
        await queryClient.invalidateQueries({ queryKey: ["master-values"] })
        await queryClient.refetchQueries({ queryKey: ["master-values"] })
        await refetch()
        router.refresh()
        toast.success(`${codeLabel} "${code}" added successfully!`)
      }
    } catch (err: any) {
      const msg = err?.message || `Failed to create ${codeLabel}`
      setSingleError(msg)
      toast.error(msg)
    } finally {
      setSavingSingle(false)
    }
  }

  // Handle CSV Download Template
  const handleDownloadCsvTemplate = () => {
    const csvContent = isHsn
      ? "hsn_code,hsn_name\n21069099,Food preparations n.e.c.\n19041010,Ready to eat cereals"
      : "barcode_number,barcode_name\n8901234567890,Dal Rice 250g\n8901234567891,Chicken Biryani 250g"

    const blob = new Blob([csvContent], { type: "text/csv;charset=utf-8;" })
    const url = URL.createObjectURL(blob)
    const link = document.createElement("a")
    link.href = url
    link.setAttribute("download", isHsn ? "hsn_bulk_upload_template.csv" : "barcode_bulk_upload_template.csv")
    document.body.appendChild(link)
    link.click()
    document.body.removeChild(link)
  }

  // Handle CSV File Selection
  const handleFileSelect = (e: ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0]
    if (!file) return

    setBulkError("")
    setBulkResult(null)

    const reader = new FileReader()
    reader.onload = (event) => {
      try {
        const text = event.target?.result as string
        if (!text) {
          setBulkError("Selected file is empty")
          return
        }

        const lines = text.split(/\r\n|\n/).filter((l) => l.trim().length > 0)
        if (lines.length < 2) {
          setBulkError("CSV file must contain a header line and at least one data row")
          return
        }

        const items: Array<{ code: string; name?: string }> = []
        // Skip header
        for (let i = 1; i < lines.length; i++) {
          const row = lines[i].split(",").map((cell) => cell.trim().replace(/^"|"$/g, ""))
          if (row.length > 0 && row[0]) {
            items.push({
              code: row[0],
              name: row[1] || "",
            })
          }
        }

        if (items.length === 0) {
          setBulkError("No valid rows found in CSV file")
          return
        }

        setSelectedFile(file)
        setParsedItems(items)
      } catch (err: any) {
        setBulkError(err?.message || "Failed to read CSV file")
      } finally {
        e.target.value = "" // Reset input
      }
    }

    reader.onerror = () => {
      setBulkError("Error reading CSV file")
      e.target.value = ""
    }

    reader.readAsText(file)
  }

  // Handle CSV Import Execution
  const handleImportCsv = async () => {
    if (!parsedItems.length) return
    setUploadingBulk(true)
    setBulkError("")
    setBulkResult(null)

    try {
      const res = await authedFetch<{
        createdCount: number
        skippedCount: number
        total: number
        errors: string[]
      }>("/api/admin/hsn-barcode/bulk", {
        method: "POST",
        body: JSON.stringify({
          type: activeTab,
          items: parsedItems,
        }),
      })

      if (res) {
        const { createdCount, skippedCount, total, errors } = res
        setBulkResult(res)
        setSelectedFile(null)
        setParsedItems([])

        await queryClient.invalidateQueries({ queryKey: ["master-values"] })
        await queryClient.refetchQueries({ queryKey: ["master-values"] })
        await refetch()
        router.refresh()

        if (createdCount > 0) {
          toast.success(
            `Import Successful! ${createdCount} new ${codeLabel} entries added out of ${total}. ${skippedCount > 0 ? `(${skippedCount} skipped)` : ""}`
          )
        } else {
          const failMsg = errors?.[0] || `Import completed with 0 new entries. ${skippedCount} duplicate/invalid entries skipped.`
          setBulkError(failMsg)
          toast.error(failMsg)
        }
      }
    } catch (err: any) {
      const msg = err?.message || "Failed to import CSV data"
      setBulkError(msg)
      toast.error(`Import Failed: ${msg}`)
    } finally {
      setUploadingBulk(false)
    }
  }

  const handleRemoveFile = () => {
    setSelectedFile(null)
    setParsedItems([])
    setBulkError("")
  }

  // Delete item
  const handleDelete = async (id: string) => {
    if (!window.confirm("Are you sure you want to delete this master record?")) return
    try {
      await authedFetch(`/api/master/value/${id}`, { method: "DELETE" })
      await queryClient.invalidateQueries({ queryKey: ["master-values"] })
      await queryClient.refetchQueries({ queryKey: ["master-values"] })
      await refetch()
      toast.success(`${codeLabel} record deleted successfully!`)
    } catch (err: any) {
      const msg = err?.message || "Failed to delete record"
      alert(msg)
      toast.error(msg)
    }
  }

  return (
    <section className="w-full space-y-6 pb-12">
      {/* Header */}
      <div className="flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between">
        <div>
          <h1 className="font-melon text-2xl font-bold text-[#4A1D1F]">HSN & Barcode Settings</h1>
          <p className="text-sm text-[#646464]">
            Manage master HSN Codes and Barcodes, perform bulk uploads, and enforce uniqueness.
          </p>
        </div>

        {/* Tab Switcher */}
        <div className="inline-flex rounded-xl border border-[#E8DCC8] bg-white p-1 shadow-sm">
          <button
            type="button"
            onClick={() => {
              setActiveTab("HSN_CODE")
              setCurrentPage(1)
              setSingleError("")
              setBulkError("")
              setBulkResult(null)
            }}
            className={`rounded-lg px-4 py-2 text-xs font-bold transition ${
              activeTab === "HSN_CODE"
                ? "bg-[#7B3010] text-white shadow-sm"
                : "text-[#646464] hover:bg-[#FFF7ED]"
            }`}
          >
            HSN Codes
          </button>
          <button
            type="button"
            onClick={() => {
              setActiveTab("BARCODE_NUMBER")
              setCurrentPage(1)
              setSingleError("")
              setBulkError("")
              setBulkResult(null)
            }}
            className={`rounded-lg px-4 py-2 text-xs font-bold transition ${
              activeTab === "BARCODE_NUMBER"
                ? "bg-[#7B3010] text-white shadow-sm"
                : "text-[#646464] hover:bg-[#FFF7ED]"
            }`}
          >
            Barcode Numbers
          </button>
        </div>
      </div>

      {/* Grid for Single Add & Bulk Upload */}
      <div className="grid gap-6 md:grid-cols-2">
        {/* Single Add Form */}
        <div className="rounded-2xl border border-[#E8DCC8] bg-white p-5 shadow-sm space-y-4">
          <div className="flex items-center gap-2 text-[#4A1D1F]">
            <Plus className="h-5 w-5 text-[#7B3010]" />
            <h2 className="font-semibold text-base">Add Single {codeLabel}</h2>
          </div>

          {singleError && (
            <div className="flex items-start gap-2 rounded-xl bg-red-50 p-3 text-xs text-red-800 border border-red-200">
              <AlertCircle className="h-4 w-4 shrink-0 mt-0.5" />
              <span>{singleError}</span>
            </div>
          )}

          <form onSubmit={handleSingleSubmit} className="space-y-3">
            <div>
              <label className="block text-xs font-semibold uppercase tracking-wide text-[#646464] mb-1">
                {codeLabel} <span className="text-red-500">*</span>
              </label>
              <input
                type="text"
                placeholder={isHsn ? "e.g. 21069099" : "e.g. 8901234567890"}
                value={singleCode}
                onChange={(e) => setSingleCode(e.target.value)}
                className="w-full rounded-xl border border-[#D9D9D1] px-3 py-2 text-sm focus:border-[#7B3010] focus:outline-none"
              />
            </div>

            <div>
              <label className="block text-xs font-semibold uppercase tracking-wide text-[#646464] mb-1">
                {nameLabel}
              </label>
              <input
                type="text"
                placeholder={isHsn ? "e.g. Food preparations n.e.c." : "e.g. Dal Rice 250g Pack"}
                value={singleName}
                onChange={(e) => setSingleName(e.target.value)}
                className="w-full rounded-xl border border-[#D9D9D1] px-3 py-2 text-sm focus:border-[#7B3010] focus:outline-none"
              />
            </div>

            <button
              type="submit"
              disabled={savingSingle}
              className="w-full rounded-full bg-[#7B3010] py-2.5 text-xs font-bold uppercase tracking-wider text-white transition hover:bg-[#5E240C] disabled:opacity-50"
            >
              {savingSingle ? "Saving..." : `Add ${codeLabel}`}
            </button>
          </form>
        </div>

        {/* Bulk Upload CSV */}
        <div className="rounded-2xl border border-[#E8DCC8] bg-white p-5 shadow-sm space-y-4">
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-2 text-[#4A1D1F]">
              <FileSpreadsheet className="h-5 w-5 text-[#7B3010]" />
              <h2 className="font-semibold text-base">Bulk CSV Upload</h2>
            </div>
            <button
              type="button"
              onClick={handleDownloadCsvTemplate}
              className="inline-flex items-center gap-1.5 rounded-full border border-[#7B3010] px-3 py-1 text-xs font-semibold text-[#7B3010] hover:bg-[#FFF7ED] transition"
            >
              <Download className="h-3.5 w-3.5" />
              CSV Format
            </button>
          </div>

          <p className="text-xs text-[#646464]">
            Download the sample CSV format, add your entries, and upload below. Each {codeLabel.toLowerCase()} will be verified for uniqueness.
          </p>

          {bulkError && (
            <div className="flex items-start gap-2 rounded-xl bg-red-50 p-3 text-xs text-red-800 border border-red-200">
              <AlertCircle className="h-4 w-4 shrink-0 mt-0.5" />
              <span>{bulkError}</span>
            </div>
          )}

          {bulkResult && (
            <div className="rounded-xl bg-[#F0FDF4] p-3 text-xs text-green-800 border border-green-200 space-y-1">
              <div className="flex items-center gap-1.5 font-bold">
                <CheckCircle2 className="h-4 w-4 text-green-600" />
                Upload Completed Successfully
              </div>
              <p>
                Imported <strong>{bulkResult.createdCount}</strong> new entries out of {bulkResult.total}. (Skipped {bulkResult.skippedCount} duplicates/invalid rows).
              </p>
              {bulkResult.errors.length > 0 && (
                <div className="mt-2 max-h-24 overflow-y-auto rounded bg-white p-2 text-[11px] text-red-700 border border-red-100">
                  {bulkResult.errors.map((err, i) => (
                    <div key={i}>{err}</div>
                  ))}
                </div>
              )}
            </div>
          )}

          <div className="relative">
            <input
              type="file"
              accept=".csv"
              disabled={uploadingBulk}
              onChange={handleFileSelect}
              className="hidden"
              id="bulk-csv-upload-input"
            />
            {!selectedFile ? (
              <label
                htmlFor="bulk-csv-upload-input"
                className={`flex flex-col items-center justify-center rounded-2xl border-2 border-dashed border-[#D9D9D1] bg-[#FFFBF5] p-6 text-center transition cursor-pointer hover:border-[#7B3010] hover:bg-[#FFF7ED] ${
                  uploadingBulk ? "opacity-50 cursor-not-allowed" : ""
                }`}
              >
                <Upload className="h-7 w-7 text-[#7B3010] mb-2" />
                <span className="text-xs font-bold text-[#4A1D1F]">
                  Click to Select {codeLabel} CSV File
                </span>
                <span className="mt-1 text-[11px] text-[#8A8A82]">Only CSV files supported</span>
              </label>
            ) : (
              <div className="rounded-2xl border border-[#E8DCC8] bg-[#FFFBF5] p-4 space-y-3">
                <div className="flex items-center justify-between">
                  <div className="flex items-center gap-3">
                    <div className="flex h-10 w-10 items-center justify-center rounded-xl bg-[#7B3010]/10 text-[#7B3010]">
                      <FileSpreadsheet className="h-5 w-5" />
                    </div>
                    <div>
                      <div className="text-xs font-bold text-[#4A1D1F]">{selectedFile.name}</div>
                      <div className="text-[11px] text-[#646464]">
                        {(selectedFile.size / 1024).toFixed(1)} KB · <span className="font-semibold text-[#7B3010]">{parsedItems.length} entries parsed</span>
                      </div>
                    </div>
                  </div>
                  <button
                    type="button"
                    onClick={handleRemoveFile}
                    disabled={uploadingBulk}
                    className="rounded-full p-1 text-[#8A8A82] hover:bg-red-50 hover:text-red-600 transition"
                    title="Remove file"
                  >
                    <X className="h-4 w-4" />
                  </button>
                </div>

                <div className="flex gap-2">
                  <button
                    type="button"
                    onClick={handleImportCsv}
                    disabled={uploadingBulk || parsedItems.length === 0}
                    className="flex-1 inline-flex items-center justify-center gap-2 rounded-full bg-[#7B3010] py-2.5 px-4 text-xs font-bold uppercase tracking-wider text-white transition hover:bg-[#5E240C] disabled:opacity-50"
                  >
                    {uploadingBulk ? (
                      <>
                        <Loader2 className="h-4 w-4 animate-spin" />
                        Importing {parsedItems.length} Entries...
                      </>
                    ) : (
                      <>
                        <Upload className="h-4 w-4" />
                        Import Data ({parsedItems.length} Entries)
                      </>
                    )}
                  </button>
                  <button
                    type="button"
                    onClick={handleRemoveFile}
                    disabled={uploadingBulk}
                    className="rounded-full border border-[#D9D9D1] bg-white px-4 py-2.5 text-xs font-semibold text-[#646464] hover:bg-gray-50 transition"
                  >
                    Cancel
                  </button>
                </div>
              </div>
            )}
          </div>
        </div>
      </div>

      {/* Existing Items Table */}
      <div className="rounded-2xl border border-[#E8DCC8] bg-white p-5 shadow-sm space-y-4">
        <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
          <div>
            <h2 className="font-semibold text-base text-[#4A1D1F]">Available {title} Entries ({filteredItems.length})</h2>
            <p className="text-xs text-[#646464]">These values appear in product variant dropdowns.</p>
          </div>

          <div className="relative w-full sm:w-64">
            <Search className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-[#8A8A82]" />
            <input
              type="text"
              placeholder={`Search ${codeLabel}...`}
              value={searchQuery}
              onChange={(e) => {
                setSearchQuery(e.target.value)
                setCurrentPage(1)
              }}
              className="w-full rounded-full border border-[#D9D9D1] pl-9 pr-4 py-1.5 text-xs focus:border-[#7B3010] focus:outline-none"
            />
          </div>
        </div>

        {isLoading ? (
          <div className="p-8 text-center text-xs text-[#8A8A82]">Loading entries...</div>
        ) : filteredItems.length === 0 ? (
          <div className="p-8 text-center text-xs text-[#8A8A82]">
            {searchQuery ? "No matching entries found." : `No ${codeLabel} entries added yet. Add one above or upload CSV.`}
          </div>
        ) : (
          <>
            <div className="overflow-x-auto">
              <table className="w-full text-left text-xs">
                <thead>
                  <tr className="border-b border-[#E8DCC8] bg-[#FFFBF5] text-[#4A1D1F] font-semibold uppercase tracking-wider">
                    <th className="px-4 py-3">#</th>
                    <th className="px-4 py-3">{codeLabel}</th>
                    <th className="px-4 py-3">{nameLabel}</th>
                    <th className="px-4 py-3 text-right">Actions</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-[#F0E8DC]">
                  {paginatedItems.map((item, index) => (
                    <tr key={item.id} className="hover:bg-[#FFFBF5] transition">
                      <td className="px-4 py-3 font-medium text-[#8A8A82]">{startIndex + index + 1}</td>
                      <td className="px-4 py-3 font-mono font-bold text-[#7B3010]">{item.value}</td>
                      <td className="px-4 py-3 text-[#2A1810]">{item.label || item.value}</td>
                      <td className="px-4 py-3 text-right">
                        <button
                          type="button"
                          onClick={() => handleDelete(item.id)}
                          className="rounded p-1.5 text-red-600 hover:bg-red-50 transition"
                          title="Delete Record"
                        >
                          <Trash2 className="h-4 w-4" />
                        </button>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>

            {/* Pagination Controls */}
            <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between border-t border-[#E8DCC8] pt-4 text-xs text-[#646464]">
              <div>
                Showing <span className="font-semibold text-[#4A1D1F]">{startIndex + 1}</span> to{" "}
                <span className="font-semibold text-[#4A1D1F]">{endIndex}</span> of{" "}
                <span className="font-semibold text-[#4A1D1F]">{filteredItems.length}</span> entries
              </div>

              <div className="flex items-center gap-1.5">
                <button
                  type="button"
                  disabled={validCurrentPage <= 1}
                  onClick={() => setCurrentPage((p) => Math.max(1, p - 1))}
                  className="inline-flex items-center justify-center rounded-lg border border-[#D9D9D1] bg-white p-1.5 text-[#4A1D1F] hover:bg-[#FFFBF5] disabled:opacity-40 disabled:cursor-not-allowed transition"
                  title="Previous Page"
                >
                  <ChevronLeft className="h-4 w-4" />
                </button>

                <span className="px-3 py-1 font-semibold text-[#4A1D1F]">
                  Page {validCurrentPage} of {totalPages}
                </span>

                <button
                  type="button"
                  disabled={validCurrentPage >= totalPages}
                  onClick={() => setCurrentPage((p) => Math.min(totalPages, p + 1))}
                  className="inline-flex items-center justify-center rounded-lg border border-[#D9D9D1] bg-white p-1.5 text-[#4A1D1F] hover:bg-[#FFFBF5] disabled:opacity-40 disabled:cursor-not-allowed transition"
                  title="Next Page"
                >
                  <ChevronRight className="h-4 w-4" />
                </button>
              </div>
            </div>
          </>
        )}
      </div>
    </section>
  )
}
