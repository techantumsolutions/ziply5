import AdmZip from "adm-zip"
import path from "node:path"

const MEDIA_EXT = new Set([
  ".jpg",
  ".jpeg",
  ".png",
  ".webp",
  ".gif",
  ".mp4",
  ".webm",
  ".mov",
  ".m4v",
])

const isSafeZipPath = (entryName: string) => {
  const normalized = entryName.replaceAll("\\", "/").replace(/^\/+/, "")
  if (!normalized || normalized.includes("..")) return false
  if (path.isAbsolute(normalized)) return false
  const base = path.posix.basename(normalized)
  if (!base || base.startsWith(".")) return false
  const ext = path.posix.extname(base).toLowerCase()
  return MEDIA_EXT.has(ext)
}

/**
 * Build a case-insensitive map of basename -> file bytes from a ZIP archive.
 * Drops path traversal and non-image entries.
 */
export const buildZipImageMap = (zipBuffer: Buffer): Map<string, Uint8Array> => {
  const zip = new AdmZip(zipBuffer)
  const map = new Map<string, Uint8Array>()
  for (const entry of zip.getEntries()) {
    if (entry.isDirectory) continue
    const name = entry.entryName
    if (!isSafeZipPath(name)) continue
    const base = path.posix.basename(name.replaceAll("\\", "/"))
    const key = base.toLowerCase()
    const data = entry.getData()
    map.set(key, new Uint8Array(data))
  }
  return map
}
