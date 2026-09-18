"use client"

import { useMemo, useState } from "react"
import Link from "next/link"
import { useRouter } from "next/navigation"
import { authedFormDataPost } from "@/lib/dashboard-fetch"
import { getValidAccessToken } from "@/lib/auth-session"
import { toast } from "@/lib/toast"
import { Button } from "@/components/ui/button"
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card"
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog"
import { Progress } from "@/components/ui/progress"
import { Label } from "@/components/ui/label"
import { RadioGroup, RadioGroupItem } from "@/components/ui/radio-group"
import { Loader2, Download, FileSpreadsheet, ImageIcon, Play, ShieldCheck, X } from "lucide-react"

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
  "Upload images ZIP",
  "Validate",
  "Review summary",
  "Import",
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

export default function AdminBulkProductUploadPage() {
  const router = useRouter()
  const [typeDialogOpen, setTypeDialogOpen] = useState(true)
  const [uploadType, setUploadType] = useState<UploadType | null>(null)
  const [excelFile, setExcelFile] = useState<File | null>(null)
  const [zipFile, setZipFile] = useState<File | null>(null)
  const [validating, setValidating] = useState(false)
  const [importing, setImporting] = useState(false)
  const [report, setReport] = useState<BulkImportReport | null>(null)

  const effectiveType = uploadType

  const onPickType = (t: UploadType) => {
    setUploadType(t)
    setTypeDialogOpen(false)
    setExcelFile(null)
    setZipFile(null)
    setReport(null)
  }

  const closeTypeDialog = () => {
    setTypeDialogOpen(false)
    if (!uploadType) router.push("/admin/products")
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
      toast.success("Validation complete", `${data.summary.validRows} of ${data.summary.totalRows} rows look OK.`)
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
    if (!excelFile) return 2
    if (!report) return 3
    if (report.results.length > 0) return 6
    return 5
  }, [excelFile, report, uploadType])

  const progressValue = useMemo(() => {
    if (!effectiveType) return 5
    return Math.min(100, Math.round(((progressStep + 1) / steps.length) * 100))
  }, [effectiveType, progressStep])

  return (
    <div className="mx-auto max-w-4xl space-y-6 p-6">
      <div>
        <Link href="/admin/products" className="text-sm text-[#646464] hover:text-[#4A1D1F]">
          ← Back to products
        </Link>
        <h1 className="font-melon mt-2 text-2xl font-bold text-[#4A1D1F]">Bulk product upload</h1>
        <p className="mt-1 text-sm text-[#646464]">
          Import simple or variant products from Excel with images in a ZIP. Existing product forms and APIs are unchanged.
        </p>
      </div>

      <Dialog
        open={typeDialogOpen}
        onOpenChange={(open) => {
          if (open) {
            setTypeDialogOpen(true)
            return
          }
          setTypeDialogOpen(false)
        }}
      >
        <DialogContent
          className="border-[#E8D5D5] bg-white sm:max-w-md"
          showCloseButton={false}
        >
          <button
            type="button"
            aria-label="Close"
            onClick={closeTypeDialog}
            className="absolute top-4 right-4 rounded-sm text-[#4A1D1F] transition-opacity hover:opacity-80 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#4A1D1F]/30"
          >
            <X className="h-5 w-5" strokeWidth={2} />
            <span className="sr-only">Close</span>
          </button>
          <DialogHeader className="pr-8">
            <DialogTitle className="font-melon text-[#4A1D1F]">Select product upload type</DialogTitle>
            <DialogDescription>
              Simple products have no variants. Variant products use two sheets (parent + variants).
            </DialogDescription>
          </DialogHeader>
          <RadioGroup
            value={uploadType ?? ""}
            onValueChange={(v) => onPickType(v as UploadType)}
            className="grid gap-3 pt-2"
          >
            <label
              className={`flex cursor-pointer items-start gap-3 rounded-xl border p-3.5 transition-colors ${
                uploadType === "simple"
                  ? "border-[#4A1D1F] bg-[#FFF9F9] shadow-sm"
                  : "border-[#E8D5D5] hover:border-[#4A1D1F]/40 hover:bg-[#FFF9F9]"
              }`}
            >
              <RadioGroupItem
                value="simple"
                id="ut-simple"
                className="mt-0.5 size-[18px] border-[#4A1D1F] text-[#4A1D1F] [&_svg]:fill-[#4A1D1F] [&_svg]:size-2.5"
              />
              <div>
                <Label htmlFor="ut-simple" className="cursor-pointer font-medium text-[#4A1D1F]">
                  Simple products
                </Label>
                <p className="text-xs text-[#646464]">Single SKU per row, no variants.</p>
              </div>
            </label>
            <label
              className={`flex cursor-pointer items-start gap-3 rounded-xl border p-3.5 transition-colors ${
                uploadType === "variant"
                  ? "border-[#4A1D1F] bg-[#FFF9F9] shadow-sm"
                  : "border-[#E8D5D5] hover:border-[#4A1D1F]/40 hover:bg-[#FFF9F9]"
              }`}
            >
              <RadioGroupItem
                value="variant"
                id="ut-variant"
                className="mt-0.5 size-[18px] border-[#4A1D1F] text-[#4A1D1F] [&_svg]:fill-[#4A1D1F] [&_svg]:size-2.5"
              />
              <div>
                <Label htmlFor="ut-variant" className="cursor-pointer font-medium text-[#4A1D1F]">
                  Variant products
                </Label>
                <p className="text-xs text-[#646464]">Parent row plus Variants sheet (size, weight, pack, etc.).</p>
              </div>
            </label>
          </RadioGroup>
        </DialogContent>
      </Dialog>

      <Card className="border-[#E8D5D5]">
        <CardHeader className="pb-2">
          <CardTitle className="font-melon text-lg text-[#4A1D1F]">Progress</CardTitle>
          <CardDescription>{steps[Math.min(progressStep, steps.length - 1)]}</CardDescription>
        </CardHeader>
        <CardContent>
          <Progress value={progressValue} className="h-2" />
          <ol className="mt-4 grid gap-2 text-sm text-[#646464] sm:grid-cols-2">
            {steps.map((label, i) => (
              <li key={label} className={i <= progressStep ? "font-medium text-[#4A1D1F]" : ""}>
                {i + 1}. {label}
              </li>
            ))}
          </ol>
        </CardContent>
      </Card>

      {uploadType && (
        <>
          <Card className="border-[#E8D5D5]">
            <CardHeader>
              <CardTitle className="font-melon text-lg text-[#4A1D1F]">Templates</CardTitle>
              <CardDescription>Download the spreadsheet that matches your upload type.</CardDescription>
            </CardHeader>
            <CardContent className="flex flex-wrap gap-3">
              <Button
                type="button"
                variant="outline"
                className="border-[#4A1D1F] text-[#4A1D1F]"
                onClick={() =>
                  void downloadTemplate("simple").catch((e) =>
                    toast.error("Download failed", e instanceof Error ? e.message : ""),
                  )
                }
              >
                <Download className="mr-2 h-4 w-4" />
                Simple template
              </Button>
              <Button
                type="button"
                variant="outline"
                className="border-[#4A1D1F] text-[#4A1D1F]"
                onClick={() =>
                  void downloadTemplate("variant").catch((e) =>
                    toast.error("Download failed", e instanceof Error ? e.message : ""),
                  )
                }
              >
                <Download className="mr-2 h-4 w-4" />
                Variant template
              </Button>
            </CardContent>
          </Card>

          <Card className="border-[#E8D5D5]">
            <CardHeader>
              <CardTitle className="font-melon text-lg text-[#4A1D1F]">Files</CardTitle>
              <CardDescription>
                Upload type: <span className="font-medium text-[#4A1D1F]">{uploadType}</span>. Use{" "}
                <code className="rounded bg-[#FFF4F4] px-1">.xlsx</code> (variant requires two sheets). Images can be
                URLs in the sheet or filenames inside the ZIP.
              </CardDescription>
            </CardHeader>
            <CardContent className="space-y-4">
              <div>
                <Label className="flex items-center gap-2 text-[#4A1D1F]">
                  <FileSpreadsheet className="h-4 w-4" />
                  Excel / CSV
                </Label>
                <input
                  type="file"
                  accept=".xlsx,.xls,.csv"
                  className="mt-2 block w-full text-sm"
                  onChange={(e) => {
                    setExcelFile(e.target.files?.[0] ?? null)
                    setReport(null)
                  }}
                />
              </div>
              <div>
                <Label className="flex items-center gap-2 text-[#4A1D1F]">
                  <ImageIcon className="h-4 w-4" />
                  Images ZIP (optional if all image columns are URLs)
                </Label>
                <input
                  type="file"
                  accept=".zip,application/zip"
                  className="mt-2 block w-full text-sm"
                  onChange={(e) => {
                    setZipFile(e.target.files?.[0] ?? null)
                    setReport(null)
                  }}
                />
              </div>
              <div className="flex flex-wrap gap-3">
                <Button
                  type="button"
                  disabled={!excelFile || validating}
                  onClick={() => void runValidate()}
                  className="bg-[#4A1D1F] text-white hover:bg-[#3d181a]"
                >
                  {validating ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : <ShieldCheck className="mr-2 h-4 w-4" />}
                  Validate files
                </Button>
                <Button
                  type="button"
                  variant="secondary"
                  disabled={!excelFile || importing}
                  onClick={() => void runImport()}
                  className="bg-[#7a2e32] text-white hover:bg-[#6a282c]"
                >
                  {importing ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : <Play className="mr-2 h-4 w-4" />}
                  Start import
                </Button>
              </div>
            </CardContent>
          </Card>

          {report && (
            <Card className="border-[#E8D5D5]">
              <CardHeader>
                <CardTitle className="font-melon text-lg text-[#4A1D1F]">Summary</CardTitle>
                <CardDescription>Row-level messages appear below; import continues per row.</CardDescription>
              </CardHeader>
              <CardContent className="space-y-4 text-sm">
                <div className="grid gap-2 sm:grid-cols-2">
                  <div className="rounded-lg border border-[#E8D5D5] p-3">
                    <div className="text-[#646464]">Upload type</div>
                    <div className="font-medium text-[#4A1D1F]">{report.summary.uploadType}</div>
                  </div>
                  <div className="rounded-lg border border-[#E8D5D5] p-3">
                    <div className="text-[#646464]">Total rows</div>
                    <div className="font-medium text-[#4A1D1F]">{report.summary.totalRows}</div>
                  </div>
                  <div className="rounded-lg border border-[#E8D5D5] p-3">
                    <div className="text-[#646464]">Valid / invalid</div>
                    <div className="font-medium text-[#4A1D1F]">
                      {report.summary.validRows} / {report.summary.invalidRows}
                    </div>
                  </div>
                  <div className="rounded-lg border border-[#E8D5D5] p-3">
                    <div className="text-[#646464]">Duplicates / existing SKU / images / variants / categories / prices</div>
                    <div className="font-medium text-[#4A1D1F]">
                      {report.summary.duplicateSkuInFile} / {report.summary.existingSkuConflicts} /{" "}
                      {report.summary.missingImages} / {report.summary.invalidVariants} /{" "}
                      {report.summary.invalidCategories} / {report.summary.invalidPrices}
                    </div>
                  </div>
                </div>

                {report.errors.length > 0 && (
                  <div>
                    <div className="mb-2 font-medium text-[#4A1D1F]">Validation issues (sample)</div>
                    <ul className="max-h-48 list-inside list-disc overflow-y-auto text-[#646464]">
                      {report.errors.slice(0, 80).map((e, idx) => (
                        <li key={`${e.row}-${idx}`}>
                          Row {e.row}
                          {e.sheet ? ` (${e.sheet})` : ""}: {e.message}
                          {e.sku ? ` — ${e.sku}` : ""}
                        </li>
                      ))}
                    </ul>
                    {report.errors.length > 80 && (
                      <p className="mt-1 text-xs text-[#646464]">Showing first 80 of {report.errors.length} messages.</p>
                    )}
                  </div>
                )}

                {report.results.length > 0 && (
                  <div>
                    <div className="mb-2 font-medium text-[#4A1D1F]">Import results</div>
                    <ul className="max-h-40 overflow-y-auto text-[#646464]">
                      {report.results.slice(0, 50).map((r) => (
                        <li key={`${r.row}-${r.sku}`}>
                          Row {r.row} {r.sku ? `(${r.sku})` : ""}: {r.success ? "OK" : r.message ?? "Failed"}
                          {r.productId ? ` — id ${r.productId}` : ""}
                        </li>
                      ))}
                    </ul>
                  </div>
                )}

                {report.failedRowsForCsv.length > 0 && (
                  <Button type="button" variant="outline" onClick={downloadFailedCsv} className="border-[#4A1D1F] text-[#4A1D1F]">
                    <Download className="mr-2 h-4 w-4" />
                    Download failed rows CSV
                  </Button>
                )}
              </CardContent>
            </Card>
          )}
        </>
      )}

      {uploadType && (
        <Button
          type="button"
          variant="ghost"
          className="text-[#646464]"
          onClick={() => {
            setUploadType(null)
            setTypeDialogOpen(true)
            setExcelFile(null)
            setZipFile(null)
            setReport(null)
          }}
        >
          Change upload type
        </Button>
      )}
    </div>
  )
}
