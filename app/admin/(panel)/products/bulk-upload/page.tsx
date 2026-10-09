"use client"

import { useMemo, useState } from "react"
import Link from "next/link"
import { authedFormDataPost } from "@/lib/dashboard-fetch"
import { getValidAccessToken } from "@/lib/auth-session"
import { toast } from "@/lib/toast"
import { Button } from "@/components/ui/button"
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card"
import { Progress } from "@/components/ui/progress"
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
  Sparkles,
  AlertCircle,
  Film,
} from "lucide-react"

type UploadType = "simple" | "variant"

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

const steps = [
  "Select upload type",
  "Download template",
  "Upload spreadsheet",
  "Upload images & video ZIP",
  "Validate files",
  "Review summary & fixes",
  "Execute import",
] as const

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
  const [uploadType, setUploadType] = useState<UploadType>("simple")
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
    setTemplateDownloaded(false)
  }

  const handleDownloadTemplate = async (template: UploadType) => {
    try {
      await downloadTemplate(template)
      setTemplateDownloaded(true)
    } catch (e) {
      toast.error("Download failed", e instanceof Error ? e.message : "Download failed")
    }
  }

  const runValidate = async () => {
    if (!uploadType || !excelFile) {
      toast.error("Missing files", "Choose upload type and spreadsheet first.")
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
    if (!uploadType || !excelFile) return
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

  const progressStep = useMemo(() => {
    if (!uploadType) return 0
    if (!templateDownloaded && !excelFile) return 1
    if (!excelFile) return 2
    if (!report) return 4
    if (report.results.length > 0) return 6
    return 5
  }, [excelFile, report, templateDownloaded, uploadType])

  const progressValue = useMemo(() => {
    return Math.min(100, Math.round(((progressStep + 1) / steps.length) * 100))
  }, [progressStep])

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
        <div className="mt-2">
          <h1 className="font-melon text-2xl font-bold text-[#4A1D1F]">Bulk Product Upload</h1>
          <p className="mt-0.5 text-sm text-[#646464]">
            Follow the 7 steps below to import products from Excel with images and videos.
          </p>
        </div>
      </div>

      {/* Progress Overview Card (Commented out for now) */}
      {/*
      <Card className="border-[#E8D5D5] bg-gradient-to-r from-white to-[#FFFDFC] shadow-sm">
        <CardHeader className="pb-3">
          <div className="flex items-center justify-between">
            <CardTitle className="font-melon text-lg text-[#4A1D1F]">Workflow Progress</CardTitle>
            <span className="text-xs font-semibold text-[#4A1D1F]">
              Step {progressStep + 1} of {steps.length}: {steps[progressStep]}
            </span>
          </div>
          <CardDescription className="text-xs text-[#646464]">
            Complete each step sequentially to validate and upload your products safely.
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          <Progress value={progressValue} className="h-2.5 bg-[#F4E8E8] [&>div]:bg-[#4A1D1F]" />
          <ol className="grid grid-cols-2 gap-2 text-xs sm:grid-cols-4 md:grid-cols-7">
            {steps.map((label, i) => {
              const isDone = i < progressStep
              const isCurrent = i === progressStep
              return (
                <li
                  key={label}
                  className={`flex items-center gap-1.5 rounded-lg p-2 transition-colors ${
                    isCurrent
                      ? "border border-[#4A1D1F]/30 bg-[#FFF4F4] font-semibold text-[#4A1D1F]"
                      : isDone
                        ? "text-[#4A1D1F]"
                        : "text-[#8C8C8C]"
                  }`}
                >
                  {isDone ? (
                    <CheckCircle2 className="h-3.5 w-3.5 shrink-0 text-emerald-600" />
                  ) : (
                    <span
                      className={`flex h-4 w-4 shrink-0 items-center justify-center rounded-full text-[10px] ${
                        isCurrent
                          ? "bg-[#4A1D1F] text-white"
                          : "bg-[#E8D5D5] text-[#646464]"
                      }`}
                    >
                      {i + 1}
                    </span>
                  )}
                  <span className="truncate">{label}</span>
                </li>
              )
            })}
          </ol>
        </CardContent>
      </Card>
      */}

      {/* ================= STEP 1: Download Template ================= */}
      <Card className="border-[#E8D5D5] shadow-sm">
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
            Download the pre-formatted Excel template corresponding to your product type.
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          <div className="flex flex-wrap items-center gap-3">
            <Button
              type="button"
              variant="outline"
              className="border-[#4A1D1F] text-[#4A1D1F] hover:bg-[#FFF4F4]"
              onClick={() => void handleDownloadTemplate("simple")}
            >
              <Download className="mr-2 h-4 w-4" />
              Download Single Variant Template (.xlsx)
            </Button>
            <Button
              type="button"
              variant="outline"
              className="border-[#4A1D1F] text-[#4A1D1F] hover:bg-[#FFF4F4]"
              onClick={() => void handleDownloadTemplate("variant")}
            >
              <Download className="mr-2 h-4 w-4" />
              Download Multi Variant Template (.xlsx)
            </Button>
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
        </CardContent>
      </Card>

      {/* ================= STEP 2: Select Upload Type ================= */}
      <Card className="border-[#E8D5D5] shadow-sm">
        <CardHeader className="pb-3">
          <div className="flex items-center gap-2">
            <span className="flex h-6 w-6 items-center justify-center rounded-full bg-[#4A1D1F] text-xs font-bold text-white">
              2
            </span>
            <CardTitle className="font-melon text-lg text-[#4A1D1F]">
              Step 2: Select Product Upload Type
            </CardTitle>
          </div>
          <CardDescription>
            Choose whether you are uploading standalone products or products with multiple variants (sizes, weights, packs).
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          <RadioGroup
            value={uploadType}
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
                  <Label
                    htmlFor="step-ut-simple"
                    className="cursor-pointer font-semibold text-[#4A1D1F]"
                  >
                    Single Variant Product
                  </Label>
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
                  <Label
                    htmlFor="step-ut-variant"
                    className="cursor-pointer font-semibold text-[#4A1D1F]"
                  >
                    Multi Variant Product
                  </Label>
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

          {/* Instructions Box */}
          <div className="rounded-lg border border-[#E8D5D5] bg-[#FAF6F6] p-3 text-xs text-[#523234] space-y-1.5">
            <div className="flex items-center gap-1.5 font-semibold text-[#4A1D1F]">
              <Info className="h-3.5 w-3.5 shrink-0" />
              Step Instructions & Restrictions:
            </div>
            <ul className="list-inside list-disc space-y-1 text-[#646464] pl-1">
              <li>
                <strong className="text-[#4A1D1F]">Single Variant:</strong> Use when each product item has its own standalone listing without sub-options.
              </li>
              <li>
                <strong className="text-[#4A1D1F]">Multi Variant:</strong> Requires two sheets inside the Excel workbook: <code className="bg-white px-1 py-0.5 rounded border border-[#E8D5D5]">Products</code> (Parent info) and <code className="bg-white px-1 py-0.5 rounded border border-[#E8D5D5]">Variants</code> (SKU, weight, price per option).
              </li>
              <li>
                <strong className="text-[#4A1D1F]">Restriction:</strong> Switching the upload type resets any uploaded files and reports below.
              </li>
            </ul>
          </div>
        </CardContent>
      </Card>

      {/* ================= STEP 3: Upload Spreadsheet ================= */}
      <Card className="border-[#E8D5D5] shadow-sm">
        <CardHeader className="pb-3">
          <div className="flex items-center gap-2">
            <span className="flex h-6 w-6 items-center justify-center rounded-full bg-[#4A1D1F] text-xs font-bold text-white">
              3
            </span>
            <CardTitle className="font-melon text-lg text-[#4A1D1F]">
              Step 3: Upload Completed Spreadsheet
            </CardTitle>
          </div>
          <CardDescription>
            Upload your completed Excel workbook (<code className="rounded bg-[#FFF4F4] px-1">.xlsx</code>, <code className="rounded bg-[#FFF4F4] px-1">.xls</code>) or CSV file.
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          <div className="rounded-xl border-2 border-dashed border-[#E8D5D5] bg-[#FFFDFC] p-5 text-center transition-colors hover:border-[#4A1D1F]/50">
            <FileSpreadsheet className="mx-auto h-8 w-8 text-[#4A1D1F]" />
            <div className="mt-2 text-sm font-medium text-[#4A1D1F]">
              {excelFile ? `Selected: ${excelFile.name} (${formatFileSize(excelFile.size)})` : "Select or drag your product spreadsheet"}
            </div>
            <p className="mt-1 text-xs text-[#646464]">
              Accepted formats: .xlsx, .xls, .csv
            </p>
            <label className="mt-3 inline-block">
              <span className="cursor-pointer rounded-lg bg-[#4A1D1F] px-4 py-2 text-xs font-semibold text-white shadow transition-colors hover:bg-[#3d181a]">
                {excelFile ? "Change File" : "Browse Spreadsheet"}
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
          </div>

          {/* Instructions Box */}
          <div className="rounded-lg border border-[#E8D5D5] bg-[#FAF6F6] p-3 text-xs text-[#523234] space-y-1.5">
            <div className="flex items-center gap-1.5 font-semibold text-[#4A1D1F]">
              <Info className="h-3.5 w-3.5 shrink-0" />
              Spreadsheet Field Guidelines:
            </div>
            <ul className="list-inside list-disc space-y-1 text-[#646464] pl-1">
              <li>
                <strong className="text-[#4A1D1F]">SKU Uniqueness:</strong> Every SKU must be unique across your catalog.
              </li>
              <li>
                <strong className="text-[#4A1D1F]">HSN Code & Barcode:</strong> Enter 4-8 digit HSN code in <code className="bg-white px-1 py-0.5 rounded border border-[#E8D5D5]">hsnCode</code> and 8-14 digit barcode in <code className="bg-white px-1 py-0.5 rounded border border-[#E8D5D5]">barcode</code>.
              </li>
              <li>
                <strong className="text-[#4A1D1F]">Categories & Tags:</strong> Category and tag names or slugs must already exist in your store.
              </li>
              <li>
                <strong className="text-[#4A1D1F]">Formatted Fields:</strong> Details format: <code className="bg-white px-1 py-0.5 rounded border border-[#E8D5D5]">Title::Content::SortOrder</code>.
              </li>
            </ul>
          </div>
        </CardContent>
      </Card>

      {/* ================= STEP 4: Upload Images & Video ZIP ================= */}
      <Card className="border-[#E8D5D5] shadow-sm">
        <CardHeader className="pb-3">
          <div className="flex items-center gap-2">
            <span className="flex h-6 w-6 items-center justify-center rounded-full bg-[#4A1D1F] text-xs font-bold text-white">
              4
            </span>
            <CardTitle className="font-melon text-lg text-[#4A1D1F]">
              Step 4: Upload Media Archive (Images & Videos ZIP - Optional)
            </CardTitle>
          </div>
          <CardDescription>
            If using local media files, pack your images and short demonstration videos into a single <code className="rounded bg-[#FFF4F4] px-1">.zip</code> file.
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          <div className="rounded-xl border-2 border-dashed border-[#E8D5D5] bg-[#FFFDFC] p-5 text-center transition-colors hover:border-[#4A1D1F]/50">
            <div className="mx-auto flex justify-center gap-2 text-[#4A1D1F]">
              <ImageIcon className="h-8 w-8" />
              <Film className="h-8 w-8" />
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
                  {zipFile ? "Change ZIP" : "Browse ZIP Archive"}
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
                  onClick={() => setZipFile(null)}
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
                <strong className="text-[#4A1D1F]">Thumbnail Naming:</strong> Use the exact filename entered in <code className="bg-white px-1 py-0.5 rounded border border-[#E8D5D5]">thumbnail</code> or name it <code className="bg-white px-1 py-0.5 rounded border border-[#E8D5D5]">{"{sku}"}-thumb.jpg</code>.
              </li>
              <li>
                <strong className="text-[#4A1D1F]">Gallery Images & Videos:</strong> List comma-separated filenames in <code className="bg-white px-1 py-0.5 rounded border border-[#E8D5D5]">galleryImages</code> (e.g. <code className="bg-white px-1 py-0.5 rounded border border-[#E8D5D5]">APP001-1.jpg, APP001-video.mp4</code>).
              </li>
              <li>
                <strong className="text-[#4A1D1F]">Video Formats:</strong> Accepted formats are MP4, WEBM, MOV (Max 10 MB per video).
              </li>
            </ul>
          </div>
        </CardContent>
      </Card>

      {/* ================= STEP 5: Validate Files ================= */}
      <Card className="border-[#E8D5D5] shadow-sm">
        <CardHeader className="pb-3">
          <div className="flex items-center gap-2">
            <span className="flex h-6 w-6 items-center justify-center rounded-full bg-[#4A1D1F] text-xs font-bold text-white">
              5
            </span>
            <CardTitle className="font-melon text-lg text-[#4A1D1F]">
              Step 5: Validate Data & Media
            </CardTitle>
          </div>
          <CardDescription>
            Quickly check your spreadsheet and media files for errors before adding products to your store.
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          <div className="flex flex-wrap items-center gap-3">
            <Button
              type="button"
              disabled={!excelFile || validating}
              onClick={() => void runValidate()}
              className="bg-[#4A1D1F] text-white hover:bg-[#3d181a]"
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
            {!excelFile && (
              <span className="text-xs text-[#8C8C8C]">
                (Please select a spreadsheet in Step 3 first)
              </span>
            )}
          </div>

          {/* Instructions Box */}
          <div className="rounded-lg border border-[#E8D5D5] bg-[#FAF6F6] p-3 text-xs text-[#523234] space-y-1.5">
            <div className="flex items-center gap-1.5 font-semibold text-[#4A1D1F]">
              <HelpCircle className="h-3.5 w-3.5 shrink-0" />
              What Validation Checks:
            </div>
            <ul className="list-inside list-disc space-y-1 text-[#646464] pl-1">
              <li>Checks if any required product details (like Name, Price, or SKU) are missing or if a product code is already in use.</li>
              <li>Checks that all selected categories and tags exist in your store.</li>
              <li>Verifies that all product photos and videos exist in your ZIP file or are valid web links.</li>
              <li>This is a safe preview check — no changes will be made to your store until you click &quot;Start Bulk Import&quot; in Step 7.</li>
            </ul>
          </div>
        </CardContent>
      </Card>

      {/* ================= STEP 6: Review Summary & Fixes ================= */}
      {report && (
        <Card className="border-[#E8D5D5] shadow-sm">
          <CardHeader className="pb-3">
            <div className="flex items-center gap-2">
              <span className="flex h-6 w-6 items-center justify-center rounded-full bg-[#4A1D1F] text-xs font-bold text-white">
                6
              </span>
              <CardTitle className="font-melon text-lg text-[#4A1D1F]">
                Step 6: Review Summary & Validation Issues
              </CardTitle>
            </div>
            <CardDescription>
              Review the detailed breakdown of valid and invalid rows. Download the failed rows CSV to correct mistakes if needed.
            </CardDescription>
          </CardHeader>
          <CardContent className="space-y-4">
            {/* Metrics Grid */}
            <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
              <div className="rounded-xl border border-[#E8D5D5] bg-white p-3.5 shadow-sm">
                <div className="text-xs text-[#646464]">Total Rows Parsed</div>
                <div className="mt-1 text-xl font-bold text-[#4A1D1F]">{report.summary.totalRows}</div>
              </div>
              <div className="rounded-xl border border-emerald-200 bg-emerald-50/50 p-3.5 shadow-sm">
                <div className="text-xs text-emerald-800">Valid Rows (Ready to Import)</div>
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

            {/* Instructions Box */}
            <div className="rounded-lg border border-[#E8D5D5] bg-[#FAF6F6] p-3 text-xs text-[#523234] space-y-1.5">
              <div className="flex items-center gap-1.5 font-semibold text-[#4A1D1F]">
                <Info className="h-3.5 w-3.5 shrink-0" />
                Review Instructions:
              </div>
              <p className="text-[#646464]">
                You can download the failed rows CSV, fix the specific rows in Excel, and re-upload in Step 3. If you proceed to import now, all <strong>{report.summary.validRows} valid rows</strong> will be imported and invalid rows will be skipped.
              </p>
            </div>
          </CardContent>
        </Card>
      )}

      {/* ================= STEP 7: Execute Import ================= */}
      <Card className="border-[#E8D5D5] shadow-sm">
        <CardHeader className="pb-3">
          <div className="flex items-center gap-2">
            <span className="flex h-6 w-6 items-center justify-center rounded-full bg-[#4A1D1F] text-xs font-bold text-white">
              7
            </span>
            <CardTitle className="font-melon text-lg text-[#4A1D1F]">
              Step 7: Execute Bulk Import
            </CardTitle>
          </div>
          <CardDescription>
            Commit your valid products, upload media files, and publish to the live store catalog.
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          <div className="flex flex-wrap items-center gap-3">
            <Button
              type="button"
              disabled={!excelFile || importing}
              onClick={() => void runImport()}
              className="bg-[#7a2e32] text-white hover:bg-[#6a282c] px-6"
            >
              {importing ? (
                <>
                  <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                  Importing products into database...
                </>
              ) : (
                <>
                  <Play className="mr-2 h-4 w-4 fill-white" />
                  Start Bulk Import
                </>
              )}
            </Button>
            {!report && excelFile && (
              <span className="text-xs text-[#8C8C8C]">
                (Recommended: Click &apos;Validate files now&apos; in Step 5 before running import)
              </span>
            )}
          </div>

          {/* Import Results List */}
          {report?.results && report.results.length > 0 && (
            <div className="rounded-xl border border-[#E8D5D5] bg-white p-4 space-y-2">
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

          {/* Instructions Box */}
          <div className="rounded-lg border border-[#E8D5D5] bg-[#FAF6F6] p-3 text-xs text-[#523234] space-y-1.5">
            <div className="flex items-center gap-1.5 font-semibold text-[#4A1D1F]">
              <AlertCircle className="h-3.5 w-3.5 shrink-0" />
              Import Execution Notes:
            </div>
            <ul className="list-inside list-disc space-y-1 text-[#646464] pl-1">
              <li>Do not refresh or close the browser tab during import processing.</li>
              <li>Products will automatically have their images and videos uploaded, variants linked, and caches cleared.</li>
            </ul>
          </div>
        </CardContent>
      </Card>
    </div>
  )
}

