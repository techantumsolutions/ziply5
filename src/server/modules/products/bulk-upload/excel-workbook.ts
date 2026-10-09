import * as XLSX from "xlsx"
import type { BulkUploadType } from "@/src/server/modules/products/bulk-upload/bulk-upload.types"
import {
  SIMPLE_SHEET,
  VARIANT_CHILD_SHEET,
  VARIANT_PARENT_SHEET,
} from "@/src/server/modules/products/bulk-upload/bulk-upload.constants"

const VARIANT_PARENT_SHEET_ALIASES = [VARIANT_PARENT_SHEET, "Products"]

const normHeader = (value: unknown) =>
  String(value ?? "")
    .trim()
    .toLowerCase()
    .replace(/\s+/g, "")
    .replace(/\*+$/g, "")

export const sheetRowsToObjects = (sheet: XLSX.WorkSheet | undefined): Record<string, unknown>[] => {
  if (!sheet) return []
  const rows = XLSX.utils.sheet_to_json<unknown[]>(sheet, { header: 1, defval: "" }) as unknown[][]
  if (!rows.length) return []
  const headerRow = rows[0] ?? []
  const keys = headerRow.map((h) => String(h ?? "").trim())
  const out: Record<string, unknown>[] = []
  for (let i = 1; i < rows.length; i++) {
    const line = rows[i] ?? []
    if (line.every((c) => String(c ?? "").trim() === "")) continue
    const obj: Record<string, unknown> = {}
    for (let j = 0; j < keys.length; j++) {
      const k = keys[j]
      if (!k) continue
      obj[k] = line[j]
    }
    out.push(obj)
  }
  return out
}

const headerMap = (row: Record<string, unknown>) => {
  const m = new Map<string, string>()
  for (const k of Object.keys(row)) {
    m.set(normHeader(k), k)
  }
  return m
}

export const getCell = (row: Record<string, unknown>, ...aliases: string[]) => {
  const map = headerMap(row)
  for (const a of aliases) {
    const orig = map.get(normHeader(a))
    if (orig && orig in row) return row[orig]
  }
  return undefined
}

export const readWorkbookBuffer = (buffer: Buffer, uploadType: BulkUploadType) => {
  const wb = XLSX.read(buffer, { type: "buffer", cellDates: true })
  const sheetNames = wb.SheetNames
  if (uploadType === "simple") {
    const hasVariantsSheet = sheetNames.some((n) => n.trim().toLowerCase() === VARIANT_CHILD_SHEET.toLowerCase())
    const hasSimpleSheet = sheetNames.some((n) => n.trim().toLowerCase() === SIMPLE_SHEET.toLowerCase())
    if (hasVariantsSheet && !hasSimpleSheet) {
      throw new Error("This file contains multiple variant sheets (Variants). Please select 'Multi Variant Product' in Step 1 to upload this file.")
    }
    const name =
      sheetNames.find((n) => n.trim().toLowerCase() === SIMPLE_SHEET.toLowerCase()) ??
      sheetNames[0] ??
      ""
    if (!name) throw new Error("Workbook has no sheets")
    const sheet = wb.Sheets[name]
    const rows = sheetRowsToObjects(sheet)
    return { sheetUsed: name, simpleRows: rows, parentRows: [] as Record<string, unknown>[], variantRows: [] as Record<string, unknown>[] }
  }
  const parentName =
    sheetNames.find((n) => VARIANT_PARENT_SHEET_ALIASES.some((alias) => n.trim().toLowerCase() === alias.toLowerCase())) ?? ""
  const variantName =
    sheetNames.find((n) => n.trim().toLowerCase() === VARIANT_CHILD_SHEET.toLowerCase()) ?? ""
  if (!parentName || !variantName) {
    const hasSimpleSheet = sheetNames.some((n) => n.trim().toLowerCase() === SIMPLE_SHEET.toLowerCase())
    if (hasSimpleSheet) {
      throw new Error("This file is a Single Variant spreadsheet (SimpleProducts). Please select 'Single Variant Product' in Step 1 to upload this file.")
    }
    throw new Error(`Variant workbook must include sheets "${VARIANT_PARENT_SHEET}" and "${VARIANT_CHILD_SHEET}"`)
  }
  return {
    sheetUsed: `${parentName} + ${variantName}`,
    simpleRows: [] as Record<string, unknown>[],
    parentRows: sheetRowsToObjects(wb.Sheets[parentName]),
    variantRows: sheetRowsToObjects(wb.Sheets[variantName]),
  }
}
