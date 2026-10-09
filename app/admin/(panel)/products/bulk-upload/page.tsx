"use client"

import { useMemo, useState } from "react"
import Link from "next/link"
import { authedFormDataPost } from "@/lib/dashboard-fetch"
import { getValidAccessToken } from "@/lib/auth-session"
import { toast } from "@/lib/toast"
import { Button } from "@/components/ui/button"
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card"
import { Label } from "@/components/ui/label"
import { RadioGroup, RadioGroupItem } from "@/components/ui/radio-group"
import {
  Loader2,
  Download,
  FileSpreadsheet,
  ImageIcon,
  Play,
  ShieldCheck,
  CheckCircle2,
  AlertTriangle,
  Info,
  HelpCircle,
  AlertCircle,
  Film,
  ArrowRight,
  ArrowLeft,
  UploadCloud,
} from "lucide-react"

type UploadType = "simple" | "variant"
type TabStep = "template" | "upload" | "media" | "validate" | "import"

type BulkValidationSummary = {
  uploadType: UploadType
  totalRows: number
  validRows: number
  invalidRows: number
  duplicateSkuInFile: number
  existingSkuConflicts: number
  missingImages: number
  invalidVariants: number
  invalidCategories: number
  invalidPrices: number
}

type BulkRowError = { row: number; sheet?: string; sku?: string; message: string }

type BulkImportReport = {
  summary: BulkValidationSummary
  errors: BulkRowError[]
  results: Array<{ row: number; sku?: string; success: boolean; message?: string; productId?: string }>
  failedRowsForCsv: Record<string, string | number | boolean | null>[]
}

const TAB_STEPS: Array<{ id: TabStep; number: number; label: string; shortLabel: string; icon: React.ElementType }> = [
  { id: "template", number: 1, label: "Download Template", shortLabel: "Template", icon: Download },
  { id: "upload", number: 2, label: "Upload Spreadsheet", shortLabel: "Spreadsheet", icon: FileSpreadsheet },
  { id: "media", number: 3, label: "Media Archive", shortLabel: "Media ZIP", icon: ImageIcon },
  { id: "validate", number: 4, label: "Validate Data", shortLabel: "Validate", icon: ShieldCheck },
  { id: "import", number: 5, label: "Execute Import", shortLabel: "Import", icon: Play },
]

const downloadTemplate = async (template: UploadType) => {
  const token = await getValidAccessToken()
  const res = await fetch(`/api/admin/products/bulk-upload?template=${template}`, {
    headers: token ? { Authorization: `Bearer ${token}` } : {},
  })
  if (!res.ok) {
    const j = await res.json().catch(() => ({}))
    throw new Error((j as { message?: string }).message ?? "Download failed")
  }
  const blob = await res.blob()
  const name =
    template === "simple" ? "simple-products-template.xlsx" : "variant-products-template.xlsx"
  const url = URL.createObjectURL(blob)
  const a = document.createElement("a")
  a.href = url
  a.download = name
  a.click()
  URL.revokeObjectURL(url)
}

const failedRowsToCsv = (rows: Record<string, string | number | boolean | null>[]) => {
  if (!rows.length) return ""
  const keys = [...new Set(rows.flatMap((r) => Object.keys(r)))]
  const esc = (v: string | number | boolean | null | undefined) => {
    const s = String(v ?? "")
    if (/[",\n]/.test(s)) return `"${s.replace(/"/g, '""')}"`
    return s
  }
  const lines = [keys.join(",")]
  for (const r of rows) {
    lines.push(keys.map((k) => esc(r[k])).join(","))
  }
  return lines.join("\n")
}

const formatFileSize = (bytes: number) => {
  if (bytes < 1024) return `${bytes} B`
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`
}

export default function AdminBulkProductUploadPage() {
  const [activeTab, setActiveTab] = useState<TabStep>("template")
  const [uploadType, setUploadType] = useState<UploadType | null>(null)
  const [templateDownloaded, setTemplateDownloaded] = useState<boolean>(false)
  const [excelFile, setExcelFile] = useState<File | null>(null)
  const [zipFile, setZipFile] = useState<File | null>(null)
  const [validating, setValidating] = useState(false)
  const [importing, setImporting] = useState(false)
  const [report, setReport] = useState<BulkImportReport | null>(null)

  const onPickType = (t: UploadType) => {
    if (t === uploadType) return
    setUploadType(t)
    setExcelFile(null)
    setZipFile(null)
    setReport(null)
  }

  const handleDownloadTemplate = async (template: UploadType) => {
    try {
      await downloadTemplate(template)
      setTemplateDownloaded(true)
      toast.success("Template downloaded", "Fill out the template and proceed to upload your spreadsheet.")
    } catch (e) {
      toast.error("Download failed", e instanceof Error ? e.message : "Download failed")
    }
  }

  const runValidate = async () => {
    if (!uploadType || !excelFile) {
      toast.error("Missing files", "Please choose upload type and select a spreadsheet first in Step 2.")
      setActiveTab("upload")
      return
    }
    setValidating(true)
    setReport(null)
    try {
      const fd = new FormData()
      fd.set("mode", "validate")
      fd.set("uploadType", uploadType)
      fd.set("excelFile", excelFile)
      if (zipFile) fd.set("zipFile", zipFile)
      const data = await authedFormDataPost<BulkImportReport>("/api/admin/products/bulk-upload", fd)
      setReport(data)
      toast.success(
        "Validation complete",
        `${data.summary.validRows} of ${data.summary.totalRows} rows look OK.`,
      )
    } catch (e) {
      toast.error("Validation failed", e instanceof Error ? e.message : "Unknown error")
    } finally {
      setValidating(false)
    }
  }

  const runImport = async () => {
    if (!uploadType || !excelFile) {
      toast.error("Missing files", "Please upload a spreadsheet first.")
      return
    }
    setImporting(true)
    try {
      const fd = new FormData()
      fd.set("mode", "import")
      fd.set("uploadType", uploadType)
      fd.set("excelFile", excelFile)
      if (zipFile) fd.set("zipFile", zipFile)
      const data = await authedFormDataPost<BulkImportReport>("/api/admin/products/bulk-upload", fd)
      setReport(data)
      const ok = data.results.filter((r) => r.success).length
      const bad = data.results.filter((r) => !r.success).length
      toast.success("Import finished", `${ok} succeeded, ${bad} failed.`)
    } catch (e) {
      toast.error("Import failed", e instanceof Error ? e.message : "Unknown error")
    } finally {
      setImporting(false)
    }
  }

  const downloadFailedCsv = () => {
    if (!report?.failedRowsForCsv?.length) return
    const csv = failedRowsToCsv(report.failedRowsForCsv)
    const blob = new Blob([csv], { type: "text/csv;charset=utf-8" })
    const url = URL.createObjectURL(blob)
    const a = document.createElement("a")
    a.href = url
    a.download = "bulk-upload-failed-rows.csv"
    a.click()
    URL.revokeObjectURL(url)
  }

  // Step Completion Status for visual indicators
  const isStepComplete = useMemo(() => {
    return {
      template: templateDownloaded,
      upload: Boolean(uploadType && excelFile),
      media: Boolean(zipFile),
      validate: Boolean(report),
      import: Boolean(report && report.results.length > 0),
    }
  }, [excelFile, report, templateDownloaded, uploadType, zipFile])

  const canAccessTab = (tabId: TabStep): boolean => {
    if (tabId === "template") return true
    if (tabId === "upload") return templateDownloaded
    if (tabId === "media") return Boolean(templateDownloaded && uploadType && excelFile)
    if (tabId === "validate") return Boolean(templateDownloaded && uploadType && excelFile)
    if (tabId === "import") return Boolean(templateDownloaded && uploadType && excelFile && report)
    return false
  }

  const handleTabClick = (stepId: TabStep) => {
    if (!canAccessTab(stepId)) {
      if (stepId === "upload" && !templateDownloaded) {
        toast.error("Step 1 required", "Please download an official template first in Step 1.")
      } else if ((stepId === "media" || stepId === "validate") && (!uploadType || !excelFile)) {
        toast.error("Step 2 required", "Please select product type and upload your spreadsheet first in Step 2.")
      } else if (stepId === "import" && !report) {
        toast.error("Step 4 required", "Please run validation in Step 4 before importing.")
      }
      return
    }
    setActiveTab(stepId)
  }

  return (
    <div className="w-full max-w-6xl space-y-6 p-6">
      {/* Page Header */}
      <div>
        <Link
          href="/admin/products"
          className="inline-flex items-center gap-1 text-sm font-medium text-[#646464] transition-colors hover:text-[#4A1D1F]"
        >
          ← Back to products
        </Link>
        <div className="mt-2 flex flex-col gap-1 sm:flex-row sm:items-center sm:justify-between">
          <div>
            <h1 className="font-melon text-2xl font-bold text-[#4A1D1F]">Bulk Product Upload</h1>
            <p className="mt-0.5 text-sm text-[#646464]">
              Follow the guided steps below to import products from Excel with media assets.
            </p>
          </div>
          {uploadType && (
            <span className="inline-flex items-center rounded-full bg-[#FFF4F4] px-3 py-1 text-xs font-semibold text-[#4A1D1F] border border-[#E8D5D5]">
              Type: {uploadType === "simple" ? "Single Variant" : "Multi Variant"}
            </span>
          )}
        </div>
      </div>

      {/* Step Tabs Navigation Bar */}
      <div className="rounded-xl border border-[#E8D5D5] bg-white p-1.5 shadow-sm">
        <div className="grid grid-cols-2 gap-1.5 sm:grid-cols-3 md:grid-cols-5">
          {TAB_STEPS.map((step) => {
            const isActive = activeTab === step.id
            const isDone = isStepComplete[step.id]
            const canAccess = canAccessTab(step.id)
            const Icon = step.icon

            return (
              <button
                key={step.id}
                type="button"
                disabled={!canAccess}
                onClick={() => handleTabClick(step.id)}
                className={`group flex items-center gap-2 rounded-lg px-3 py-2.5 text-left transition-all ${
                  isActive
                    ? "border border-[#4A1D1F]/30 bg-[#FFF4F4] text-[#4A1D1F] shadow-sm ring-1 ring-[#4A1D1F]/20"
                    : isDone
                      ? "bg-[#FFFDFC] text-[#4A1D1F] hover:bg-[#FFF4F4]/50 cursor-pointer"
                      : canAccess
                        ? "text-[#646464] hover:bg-[#FAF6F6] hover:text-[#4A1D1F] cursor-pointer"
                        : "text-[#A89F9F] cursor-not-allowed opacity-45 hover:bg-transparent"
                }`}
              >
                <div
                  className={`flex h-6 w-6 shrink-0 items-center justify-center rounded-full text-xs font-bold transition-colors ${
                    isActive
                      ? "bg-[#4A1D1F] text-white"
                      : isDone
                        ? "bg-emerald-100 text-emerald-700"
                        : canAccess
                          ? "bg-[#F4E8E8] text-[#646464] group-hover:bg-[#E8D5D5]"
                          : "bg-[#F0EAEA] text-[#A89F9F]"
                  }`}
                >
                  {isDone ? <CheckCircle2 className="h-4 w-4 text-emerald-600" /> : step.number}
                </div>
                <div className="min-w-0 flex-1">
                  <div className="flex items-center gap-1">
                    <Icon className={`h-3.5 w-3.5 shrink-0 ${isActive ? "text-[#4A1D1F]" : canAccess ? "text-[#8C8C8C]" : "text-[#B0A6A6]"}`} />
                    <span className="truncate text-xs font-semibold">{step.label}</span>
                  </div>
                </div>
              </button>
            )
          })}
        </div>
      </div>

      {/* ================= STEP 1: Download Template ================= */}
      {activeTab === "template" && (
        <Card className="border-[#E8D5D5] shadow-sm animate-in fade-in duration-200">
          <CardHeader className="pb-3">
            <div className="flex items-center gap-2">
              <span className="flex h-6 w-6 items-center justify-center rounded-full bg-[#4A1D1F] text-xs font-bold text-white">
                1
              </span>
              <CardTitle className="font-melon text-lg text-[#4A1D1F]">
                Step 1: Download Official Excel Template
              </CardTitle>
            </div>
            <CardDescription>
              Download the pre-formatted Excel template corresponding to your product structure.
            </CardDescription>
          </CardHeader>
          <CardContent className="space-y-6">
            <div className="grid gap-4 sm:grid-cols-2">
              <div className="rounded-xl border border-[#E8D5D5] bg-[#FFFDFC] p-5 space-y-3">
                <div className="flex items-center gap-2 font-semibold text-[#4A1D1F]">
                  <FileSpreadsheet className="h-5 w-5 text-[#4A1D1F]" />
                  Single Variant Product Template
                </div>
                <p className="text-xs text-[#646464]">
                  One SKU per row. Best for standalone items with fixed weight, size, and price on a single sheet.
                </p>
                <Button
                  type="button"
                  variant="outline"
                  className="w-full border-[#4A1D1F] text-[#4A1D1F] hover:bg-[#FFF4F4]"
                  onClick={() => void handleDownloadTemplate("simple")}
                >
                  <Download className="mr-2 h-4 w-4" />
                  Download Single Variant (.xlsx)
                </Button>
              </div>

              <div className="rounded-xl border border-[#E8D5D5] bg-[#FFFDFC] p-5 space-y-3">
                <div className="flex items-center gap-2 font-semibold text-[#4A1D1F]">
                  <FileSpreadsheet className="h-5 w-5 text-[#4A1D1F]" />
                  Multi Variant Product Template
                </div>
                <p className="text-xs text-[#646464]">
                  Includes two connected sheets: <code className="bg-white px-1 py-0.5 rounded border border-[#E8D5D5]">Products</code> (Parent info) and <code className="bg-white px-1 py-0.5 rounded border border-[#E8D5D5]">Variants</code> (SKU, weight, price per child option).
                </p>
                <Button
                  type="button"
                  variant="outline"
                  className="w-full border-[#4A1D1F] text-[#4A1D1F] hover:bg-[#FFF4F4]"
                  onClick={() => void handleDownloadTemplate("variant")}
                >
                  <Download className="mr-2 h-4 w-4" />
                  Download Multi Variant (.xlsx)
                </Button>
              </div>
            </div>

            {/* Instructions Box */}
            <div className="rounded-lg border border-[#E8D5D5] bg-[#FAF6F6] p-3 text-xs text-[#523234] space-y-1.5">
              <div className="flex items-center gap-1.5 font-semibold text-[#4A1D1F]">
                <AlertCircle className="h-3.5 w-3.5 shrink-0" />
                Important Template Rules:
              </div>
              <ul className="list-inside list-disc space-y-1 text-[#646464] pl-1">
                <li>
                  <strong className="text-[#4A1D1F]">Do NOT rename or remove column headers:</strong> Header names must remain exact.
                </li>
                <li>
                  <strong className="text-[#4A1D1F]">Example & Instructions Sheets:</strong> Open the downloaded file to see sample rows and read the embedded instructions sheet.
                </li>
              </ul>
            </div>

            {/* Tab Navigation Footer */}
            <div className="flex items-center justify-end border-t border-[#E8D5D5] pt-4">
              {!templateDownloaded && (
                <span className="text-xs text-[#8C8C8C] mr-3">
                  (Please download a template above to proceed)
                </span>
              )}
              <Button
                type="button"
                className="bg-[#4A1D1F] text-white hover:bg-[#3d181a] disabled:opacity-50 disabled:cursor-not-allowed"
                disabled={!templateDownloaded}
                onClick={() => setActiveTab("upload")}
              >
                Next: Select Type & Upload Spreadsheet
                <ArrowRight className="ml-2 h-4 w-4" />
              </Button>
            </div>
          </CardContent>
        </Card>
      )}

      {/* ================= STEP 2: Select Type & Upload Spreadsheet ================= */}
      {activeTab === "upload" && (
        <Card className="border-[#E8D5D5] shadow-sm animate-in fade-in duration-200">
          <CardHeader className="pb-3">
            <div className="flex items-center gap-2">
              <span className="flex h-6 w-6 items-center justify-center rounded-full bg-[#4A1D1F] text-xs font-bold text-white">
                2
              </span>
              <CardTitle className="font-melon text-lg text-[#4A1D1F]">
                Step 2: Select Product Upload Type & Upload Spreadsheet
              </CardTitle>
            </div>
            <CardDescription>
              Choose your product structure below, then upload your completed spreadsheet.
            </CardDescription>
          </CardHeader>
          <CardContent className="space-y-6">
            {/* Part A: Product Type Selection */}
            <div className="space-y-2">
              <Label className="text-xs font-semibold text-[#4A1D1F]">
                Choose Product Structure:
              </Label>
              <RadioGroup
                value={uploadType ?? ""}
                onValueChange={(v) => onPickType(v as UploadType)}
                className="grid gap-4 sm:grid-cols-2"
              >
                <label
                  className={`flex cursor-pointer items-start gap-3 rounded-xl border p-4 transition-all ${
                    uploadType === "simple"
                      ? "border-[#4A1D1F] bg-[#FFF9F9] shadow-sm ring-1 ring-[#4A1D1F]"
                      : "border-[#E8D5D5] hover:border-[#4A1D1F]/40 hover:bg-[#FFFDFC]"
                  }`}
                >
                  <RadioGroupItem
                    value="simple"
                    id="step-ut-simple"
                    className="mt-0.5 size-[18px] border-[#4A1D1F] text-[#4A1D1F] [&_svg]:fill-[#4A1D1F]"
                  />
                  <div className="space-y-1">
                    <div className="flex items-center gap-2">
                      <span className="cursor-pointer font-semibold text-[#4A1D1F] text-sm">
                        Single Variant Product
                      </span>
                      <span className="rounded bg-[#E8D5D5]/50 px-1.5 py-0.5 text-[10px] font-medium text-[#4A1D1F]">
                        Single Sheet
                      </span>
                    </div>
                    <p className="text-xs text-[#646464]">
                      One SKU per row. Best for standalone items with fixed weight, size, and price.
                    </p>
                  </div>
                </label>

                <label
                  className={`flex cursor-pointer items-start gap-3 rounded-xl border p-4 transition-all ${
                    uploadType === "variant"
                      ? "border-[#4A1D1F] bg-[#FFF9F9] shadow-sm ring-1 ring-[#4A1D1F]"
                      : "border-[#E8D5D5] hover:border-[#4A1D1F]/40 hover:bg-[#FFFDFC]"
                  }`}
                >
                  <RadioGroupItem
                    value="variant"
                    id="step-ut-variant"
                    className="mt-0.5 size-[18px] border-[#4A1D1F] text-[#4A1D1F] [&_svg]:fill-[#4A1D1F]"
                  />
                  <div className="space-y-1">
                    <div className="flex items-center gap-2">
                      <span className="cursor-pointer font-semibold text-[#4A1D1F] text-sm">
                        Multi Variant Product
                      </span>
                      <span className="rounded bg-[#E8D5D5]/50 px-1.5 py-0.5 text-[10px] font-medium text-[#4A1D1F]">
                        2 Sheets (Products + Variants)
                      </span>
                    </div>
                    <p className="text-xs text-[#646464]">
                      Parent product linked to multiple child variant rows (different sizes, weights, or prices).
                    </p>
                  </div>
                </label>
              </RadioGroup>
            </div>

            {/* Part B: Spreadsheet Upload Area (Revealed after selecting uploadType) */}
            {uploadType ? (
              <div className="space-y-4 animate-in fade-in slide-in-from-top-2 duration-200">
                <div className="flex items-center justify-between">
                  <Label className="text-xs font-semibold text-[#4A1D1F]">
                    Upload Completed Spreadsheet ({uploadType === "simple" ? "Single Variant" : "Multi Variant"}):
                  </Label>
                  {excelFile && (
                    <span className="text-xs font-medium text-emerald-700 flex items-center gap-1">
                      <CheckCircle2 className="h-3.5 w-3.5 text-emerald-600" />
                      Spreadsheet selected
                    </span>
                  )}
                </div>

                <div className="rounded-xl border-2 border-dashed border-[#E8D5D5] bg-[#FFFDFC] p-6 text-center transition-colors hover:border-[#4A1D1F]/50">
                  <FileSpreadsheet className="mx-auto h-10 w-10 text-[#4A1D1F]" />
                  <div className="mt-2 text-sm font-medium text-[#4A1D1F]">
                    {excelFile ? `Selected: ${excelFile.name} (${formatFileSize(excelFile.size)})` : "Select or drag your product spreadsheet"}
                  </div>
                  <p className="mt-1 text-xs text-[#646464]">
                    Accepted formats: .xlsx, .xls, .csv
                  </p>
                  <div className="mt-3 flex items-center justify-center gap-2">
                    <label>
                      <span className="cursor-pointer rounded-lg bg-[#4A1D1F] px-4 py-2 text-xs font-semibold text-white shadow transition-colors hover:bg-[#3d181a]">
                        {excelFile ? "Change Spreadsheet" : "Browse Spreadsheet"}
                      </span>
                      <input
                        type="file"
                        accept=".xlsx,.xls,.csv"
                        className="hidden"
                        onChange={(e) => {
                          setExcelFile(e.target.files?.[0] ?? null)
                          setReport(null)
                        }}
                      />
                    </label>
                    {excelFile && (
                      <Button
                        type="button"
                        variant="outline"
                        size="sm"
                        className="border-[#E8D5D5] text-xs text-[#646464]"
                        onClick={() => {
                          setExcelFile(null)
                          setReport(null)
                        }}
                      >
                        Remove File
                      </Button>
                    )}
                  </div>
                </div>

                {/* Instructions Box */}
                <div className="rounded-lg border border-[#E8D5D5] bg-[#FAF6F6] p-3 text-xs text-[#523234] space-y-1.5">
                  <div className="flex items-center gap-1.5 font-semibold text-[#4A1D1F]">
                    <Info className="h-3.5 w-3.5 shrink-0" />
                    Spreadsheet Field Guidelines:
                  </div>
                  <ul className="list-inside list-disc space-y-1 text-[#646464] pl-1">
                    <li>
                      <strong className="text-[#4A1D1F]">SKU Uniqueness:</strong> Every SKU must be unique across your store.
                    </li>
                    <li>
                      <strong className="text-[#4A1D1F]">HSN Code & Barcode:</strong> Enter 4-8 digit HSN code in <code className="bg-white px-1 py-0.5 rounded border border-[#E8D5D5]">hsnCode</code> and barcode in <code className="bg-white px-1 py-0.5 rounded border border-[#E8D5D5]">barcode</code>.
                    </li>
                    <li>
                      <strong className="text-[#4A1D1F]">Categories & Tags:</strong> Category and tag names or slugs must already exist in your store.
                    </li>
                  </ul>
                </div>
              </div>
            ) : (
              <div className="rounded-xl border border-dashed border-[#E8D5D5] bg-[#FAF6F6] p-6 text-center text-xs text-[#646464]">
                <UploadCloud className="mx-auto h-8 w-8 text-[#8C8C8C] mb-1.5" />
                Please select a product upload type above to enable spreadsheet upload.
              </div>
            )}

            {/* Tab Navigation Footer */}
            <div className="flex items-center justify-between border-t border-[#E8D5D5] pt-4">
              <Button
                type="button"
                variant="outline"
                className="border-[#E8D5D5] text-[#646464] hover:bg-[#FAF6F6]"
                onClick={() => setActiveTab("template")}
              >
                <ArrowLeft className="mr-2 h-4 w-4" />
                Back: Download Template
              </Button>
              <Button
                type="button"
                className="bg-[#4A1D1F] text-white hover:bg-[#3d181a]"
                disabled={!uploadType || !excelFile}
                onClick={() => setActiveTab("media")}
              >
                Next: Media Archive (Optional)
                <ArrowRight className="ml-2 h-4 w-4" />
              </Button>
            </div>
          </CardContent>
        </Card>
      )}

      {/* ================= STEP 3: Upload Images & Video ZIP ================= */}
      {activeTab === "media" && (
        <Card className="border-[#E8D5D5] shadow-sm animate-in fade-in duration-200">
          <CardHeader className="pb-3">
            <div className="flex items-center gap-2">
              <span className="flex h-6 w-6 items-center justify-center rounded-full bg-[#4A1D1F] text-xs font-bold text-white">
                3
              </span>
              <CardTitle className="font-melon text-lg text-[#4A1D1F]">
                Step 3: Upload Media Archive (Images & Videos ZIP - Optional)
              </CardTitle>
            </div>
            <CardDescription>
              If using local media files, pack your images and demonstration videos into a single <code className="rounded bg-[#FFF4F4] px-1">.zip</code> file.
            </CardDescription>
          </CardHeader>
          <CardContent className="space-y-6">
            <div className="rounded-xl border-2 border-dashed border-[#E8D5D5] bg-[#FFFDFC] p-6 text-center transition-colors hover:border-[#4A1D1F]/50">
              <div className="mx-auto flex justify-center gap-2 text-[#4A1D1F]">
                <ImageIcon className="h-9 w-9" />
                <Film className="h-9 w-9" />
              </div>
              <div className="mt-2 text-sm font-medium text-[#4A1D1F]">
                {zipFile ? `Selected ZIP: ${zipFile.name} (${formatFileSize(zipFile.size)})` : "Select or drag your media ZIP archive"}
              </div>
              <p className="mt-1 text-xs text-[#646464]">
                Supports Images (.jpg, .png, .webp, .gif) & Videos (.mp4, .webm, .mov - Max 10MB per video)
              </p>
              <div className="mt-3 flex items-center justify-center gap-2">
                <label>
                  <span className="cursor-pointer rounded-lg bg-[#4A1D1F] px-4 py-2 text-xs font-semibold text-white shadow transition-colors hover:bg-[#3d181a]">
                    {zipFile ? "Change ZIP Archive" : "Browse ZIP Archive"}
                  </span>
                  <input
                    type="file"
                    accept=".zip,application/zip"
                    className="hidden"
                    onChange={(e) => {
                      setZipFile(e.target.files?.[0] ?? null)
                      setReport(null)
                    }}
                  />
                </label>
                {zipFile && (
                  <Button
                    type="button"
                    variant="outline"
                    size="sm"
                    className="border-[#E8D5D5] text-xs text-[#646464]"
                    onClick={() => {
                      setZipFile(null)
                      setReport(null)
                    }}
                  >
                    Remove ZIP
                  </Button>
                )}
              </div>
            </div>

            {/* Instructions Box */}
            <div className="rounded-lg border border-[#E8D5D5] bg-[#FAF6F6] p-3 text-xs text-[#523234] space-y-1.5">
              <div className="flex items-center gap-1.5 font-semibold text-[#4A1D1F]">
                <Info className="h-3.5 w-3.5 shrink-0" />
                Media & ZIP Structuring Instructions:
              </div>
              <ul className="list-inside list-disc space-y-1 text-[#646464] pl-1">
                <li>
                  <strong className="text-[#4A1D1F]">Direct Web URLs:</strong> If you wrote full HTTP/HTTPS image/video URLs in the spreadsheet, the ZIP upload is optional.
                </li>
                <li>
                  <strong className="text-[#4A1D1F]">Thumbnail Naming:</strong> Use the exact filename entered in <code className="bg-white px-1 py-0.5 rounded border border-[#E8D5D5]">thumbnail</code> or name it <code className="bg-white px-1 py-0.5 rounded border border-[#E8D5D5]">{"{sku}"}-thumb.png</code>.
                </li>
                <li>
                  <strong className="text-[#4A1D1F]">Gallery Images & Videos:</strong> List comma-separated filenames in <code className="bg-white px-1 py-0.5 rounded border border-[#E8D5D5]">galleryImages</code>.
                </li>
              </ul>
            </div>

            {/* Tab Navigation Footer */}
            <div className="flex items-center justify-between border-t border-[#E8D5D5] pt-4">
              <Button
                type="button"
                variant="outline"
                className="border-[#E8D5D5] text-[#646464] hover:bg-[#FAF6F6]"
                onClick={() => setActiveTab("upload")}
              >
                <ArrowLeft className="mr-2 h-4 w-4" />
                Back: Upload Spreadsheet
              </Button>
              <Button
                type="button"
                className="bg-[#4A1D1F] text-white hover:bg-[#3d181a]"
                onClick={() => setActiveTab("validate")}
              >
                Next: Validate Data & Media
                <ArrowRight className="ml-2 h-4 w-4" />
              </Button>
            </div>
          </CardContent>
        </Card>
      )}

      {/* ================= STEP 4: Validate Data & Media ================= */}
      {activeTab === "validate" && (
        <Card className="border-[#E8D5D5] shadow-sm animate-in fade-in duration-200">
          <CardHeader className="pb-3">
            <div className="flex items-center gap-2">
              <span className="flex h-6 w-6 items-center justify-center rounded-full bg-[#4A1D1F] text-xs font-bold text-white">
                4
              </span>
              <CardTitle className="font-melon text-lg text-[#4A1D1F]">
                Step 4: Validate Data & Media
              </CardTitle>
            </div>
            <CardDescription>
              Quickly check your spreadsheet and media files for errors before adding products to your store.
            </CardDescription>
          </CardHeader>
          <CardContent className="space-y-6">
            <div className="rounded-xl border border-[#E8D5D5] bg-[#FFFDFC] p-5 space-y-4">
              <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-3">
                <div>
                  <div className="font-semibold text-sm text-[#4A1D1F]">Run Pre-Import Validation</div>
                  <p className="text-xs text-[#646464] mt-0.5">
                    {excelFile
                      ? `Ready to validate "${excelFile.name}" with ${zipFile ? `ZIP "${zipFile.name}"` : "no local ZIP (using URLs if provided)"}.`
                      : "Please upload a spreadsheet in Step 2 before running validation."}
                  </p>
                </div>
                <Button
                  type="button"
                  disabled={!excelFile || validating}
                  onClick={() => void runValidate()}
                  className="bg-[#4A1D1F] text-white hover:bg-[#3d181a] shrink-0"
                >
                  {validating ? (
                    <>
                      <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                      Validating workbook & media...
                    </>
                  ) : (
                    <>
                      <ShieldCheck className="mr-2 h-4 w-4" />
                      Validate files now
                    </>
                  )}
                </Button>
              </div>

              {/* Validation Result Status */}
              {report && (
                <div className="rounded-lg border border-emerald-200 bg-emerald-50/60 p-3.5 text-xs text-emerald-900 flex items-center justify-between">
                  <div className="flex items-center gap-2">
                    <CheckCircle2 className="h-4 w-4 text-emerald-600 shrink-0" />
                    <span>
                      Validation finished: <strong>{report.summary.validRows} valid rows</strong> ({report.summary.invalidRows} invalid rows found).
                    </span>
                  </div>
                  <Button
                    type="button"
                    size="sm"
                    variant="outline"
                    className="border-emerald-600 text-emerald-800 hover:bg-emerald-100 text-xs h-7"
                    onClick={() => setActiveTab("import")}
                  >
                    View Details & Import →
                  </Button>
                </div>
              )}
            </div>

            {/* Instructions Box */}
            <div className="rounded-lg border border-[#E8D5D5] bg-[#FAF6F6] p-3 text-xs text-[#523234] space-y-1.5">
              <div className="flex items-center gap-1.5 font-semibold text-[#4A1D1F]">
                <HelpCircle className="h-3.5 w-3.5 shrink-0" />
                What Validation Checks:
              </div>
              <ul className="list-inside list-disc space-y-1 text-[#646464] pl-1">
                <li>Checks if any required product details (Name, Price, SKU, Weight) are missing or if SKU already exists.</li>
                <li>Checks that all selected categories and tags exist in your store catalog.</li>
                <li>Verifies that all product photos and videos exist in your ZIP file or are valid web links.</li>
                <li>This is a safe preview check — no changes will be made to your live store catalog until Step 5.</li>
              </ul>
            </div>

            {/* Tab Navigation Footer */}
            <div className="flex items-center justify-between border-t border-[#E8D5D5] pt-4">
              <Button
                type="button"
                variant="outline"
                className="border-[#E8D5D5] text-[#646464] hover:bg-[#FAF6F6]"
                onClick={() => setActiveTab("media")}
              >
                <ArrowLeft className="mr-2 h-4 w-4" />
                Back: Media Archive
              </Button>
              <div className="flex items-center gap-3">
                {!report && (
                  <span className="text-xs text-[#8C8C8C]">
                    (Please validate files before proceeding to import)
                  </span>
                )}
                <Button
                  type="button"
                  className="bg-[#4A1D1F] text-white hover:bg-[#3d181a] disabled:opacity-50 disabled:cursor-not-allowed"
                  disabled={!report}
                  onClick={() => setActiveTab("import")}
                >
                  Next: Review & Execute Import
                  <ArrowRight className="ml-2 h-4 w-4" />
                </Button>
              </div>
            </div>
          </CardContent>
        </Card>
      )}

      {/* ================= STEP 5: Review Summary & Execute Import ================= */}
      {activeTab === "import" && (
        <Card className="border-[#E8D5D5] shadow-sm animate-in fade-in duration-200">
          <CardHeader className="pb-3">
            <div className="flex items-center gap-2">
              <span className="flex h-6 w-6 items-center justify-center rounded-full bg-[#4A1D1F] text-xs font-bold text-white">
                5
              </span>
              <CardTitle className="font-melon text-lg text-[#4A1D1F]">
                Step 5: Review Summary & Execute Bulk Import
              </CardTitle>
            </div>
            <CardDescription>
              Review validation results and commit your verified products to the live store catalog.
            </CardDescription>
          </CardHeader>
          <CardContent className="space-y-6">
            {report ? (
              <>
                {/* Metrics Grid */}
                <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
                  <div className="rounded-xl border border-[#E8D5D5] bg-white p-3.5 shadow-sm">
                    <div className="text-xs text-[#646464]">Total Rows Parsed</div>
                    <div className="mt-1 text-xl font-bold text-[#4A1D1F]">{report.summary.totalRows}</div>
                  </div>
                  <div className="rounded-xl border border-emerald-200 bg-emerald-50/50 p-3.5 shadow-sm">
                    <div className="text-xs text-emerald-800">Valid Rows (Ready)</div>
                    <div className="mt-1 text-xl font-bold text-emerald-700">{report.summary.validRows}</div>
                  </div>
                  <div className="rounded-xl border border-amber-200 bg-amber-50/50 p-3.5 shadow-sm">
                    <div className="text-xs text-amber-800">Invalid Rows</div>
                    <div className="mt-1 text-xl font-bold text-amber-700">{report.summary.invalidRows}</div>
                  </div>
                  <div className="rounded-xl border border-[#E8D5D5] bg-white p-3.5 shadow-sm">
                    <div className="text-xs text-[#646464]">SKU Conflicts / Missing Media</div>
                    <div className="mt-1 text-xl font-bold text-[#4A1D1F]">
                      {report.summary.existingSkuConflicts + report.summary.duplicateSkuInFile} / {report.summary.missingImages}
                    </div>
                  </div>
                </div>

                {/* Error issues list */}
                {report.errors.length > 0 && (
                  <div className="rounded-xl border border-amber-200 bg-amber-50/30 p-4 space-y-2">
                    <div className="flex items-center justify-between">
                      <span className="font-semibold text-xs text-amber-900 flex items-center gap-1.5">
                        <AlertTriangle className="h-4 w-4 text-amber-600" />
                        Validation Issues Found ({report.errors.length}):
                      </span>
                      {report.failedRowsForCsv.length > 0 && (
                        <Button
                          type="button"
                          variant="outline"
                          size="sm"
                          onClick={downloadFailedCsv}
                          className="border-[#4A1D1F] text-xs text-[#4A1D1F] hover:bg-[#FFF4F4]"
                        >
                          <Download className="mr-1.5 h-3.5 w-3.5" />
                          Download Failed Rows CSV
                        </Button>
                      )}
                    </div>
                    <ul className="max-h-48 list-inside list-disc overflow-y-auto text-xs text-[#646464] space-y-1">
                      {report.errors.slice(0, 100).map((e, idx) => (
                        <li key={`${e.row}-${idx}`}>
                          <strong className="text-[#4A1D1F]">Row {e.row}</strong>
                          {e.sheet ? ` [Sheet: ${e.sheet}]` : ""}
                          {e.sku ? ` (SKU: ${e.sku})` : ""}: {e.message}
                        </li>
                      ))}
                    </ul>
                    {report.errors.length > 100 && (
                      <p className="text-[11px] text-[#8C8C8C]">
                        Showing first 100 of {report.errors.length} issues. Download CSV for full details.
                      </p>
                    )}
                  </div>
                )}
              </>
            ) : (
              <div className="rounded-xl border border-dashed border-[#E8D5D5] bg-[#FFFDFC] p-5 text-center text-xs text-[#646464]">
                Validation has not been executed yet. We recommend clicking &quot;Validate files now&quot; in Step 4 before importing.
              </div>
            )}

            {/* Execute Import Action */}
            <div className="rounded-xl border border-[#E8D5D5] bg-[#FAF6F6] p-5 space-y-3">
              <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-3">
                <div>
                  <div className="font-semibold text-sm text-[#4A1D1F]">Execute Product Import</div>
                  <p className="text-xs text-[#646464] mt-0.5">
                    This will insert valid products, upload images/videos to cloud storage, and publish them to your store.
                  </p>
                </div>
                <Button
                  type="button"
                  disabled={!excelFile || importing}
                  onClick={() => void runImport()}
                  className="bg-[#7a2e32] text-white hover:bg-[#6a282c] px-6 shrink-0"
                >
                  {importing ? (
                    <>
                      <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                      Importing into database...
                    </>
                  ) : (
                    <>
                      <Play className="mr-2 h-4 w-4 fill-white" />
                      Start Bulk Import
                    </>
                  )}
                </Button>
              </div>

              {/* Import Results List */}
              {report?.results && report.results.length > 0 && (
                <div className="rounded-lg border border-[#E8D5D5] bg-white p-4 space-y-2 mt-3">
                  <div className="font-semibold text-xs text-[#4A1D1F]">
                    Import Execution Log ({report.results.filter((r) => r.success).length} succeeded, {report.results.filter((r) => !r.success).length} failed):
                  </div>
                  <ul className="max-h-48 overflow-y-auto text-xs space-y-1">
                    {report.results.map((r, idx) => (
                      <li
                        key={`${r.row}-${idx}`}
                        className={`flex items-center justify-between rounded px-2 py-1 ${
                          r.success ? "bg-emerald-50 text-emerald-800" : "bg-rose-50 text-rose-800"
                        }`}
                      >
                        <span>
                          Row {r.row} {r.sku ? `(${r.sku})` : ""}: {r.success ? "Imported successfully" : r.message ?? "Failed"}
                        </span>
                        {r.productId && <span className="font-mono text-[10px] text-emerald-600">ID: {r.productId}</span>}
                      </li>
                    ))}
                  </ul>
                </div>
              )}
            </div>

            {/* Tab Navigation Footer */}
            <div className="flex items-center justify-between border-t border-[#E8D5D5] pt-4">
              <Button
                type="button"
                variant="outline"
                className="border-[#E8D5D5] text-[#646464] hover:bg-[#FAF6F6]"
                onClick={() => setActiveTab("validate")}
              >
                <ArrowLeft className="mr-2 h-4 w-4" />
                Back: Validate Data & Media
              </Button>
            </div>
          </CardContent>
        </Card>
      )}
    </div>
  )
}

