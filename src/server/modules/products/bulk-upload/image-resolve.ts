import path from "node:path"

export const isHttpUrl = (s: string) => /^https?:\/\//i.test(s.trim())

const extFromName = (name: string) => path.posix.extname(name).toLowerCase()

export const guessContentType = (fileName: string) => {
  const ext = extFromName(fileName)
  if (ext === ".png") return "image/png"
  if (ext === ".webp") return "image/webp"
  if (ext === ".gif") return "image/gif"
  if (ext === ".mp4" || ext === ".m4v") return "video/mp4"
  if (ext === ".webm") return "video/webm"
  if (ext === ".mov") return "video/quicktime"
  return "image/jpeg"
}

const lookup = (map: Map<string, Uint8Array>, fileName: string): Uint8Array | null => {
  const base = path.posix.basename(fileName.trim().replaceAll("\\", "/"))
  if (!base) return null
  return map.get(base.toLowerCase()) ?? null
}

/**
 * Resolve image / video from ZIP: exact sheet reference first, then SKU naming fallbacks.
 */
export const resolveImageFromZip = (
  zipMap: Map<string, Uint8Array>,
  ref: string,
  sku: string,
  role: "thumb" | "gallery",
  galleryIndex?: number,
): { bytes: Uint8Array; sourceName: string } | null => {
  const trimmed = ref.trim()
  if (trimmed && !isHttpUrl(trimmed)) {
    const hit = lookup(zipMap, trimmed)
    if (hit) return { bytes: hit, sourceName: path.posix.basename(trimmed) }
  }
  const s = sku.trim()
  if (!s) return null
  const thumbCandidates = [`${s}-thumb.jpg`, `${s}-thumb.jpeg`, `${s}-thumb.png`, `${s}_thumb.jpg`, `${s}-thumb.webp`]
  const galleryCandidates =
    galleryIndex != null
      ? [
          `${s}-${galleryIndex}.jpg`,
          `${s}-${galleryIndex}.jpeg`,
          `${s}-${galleryIndex}.png`,
          `${s}-${galleryIndex}.webp`,
          `${s}_${galleryIndex}.jpg`,
          `${s}-${galleryIndex}.mp4`,
          `${s}-${galleryIndex}.webm`,
          `${s}-${galleryIndex}.mov`,
          `${s}-video.mp4`,
        ]
      : []
  const candidates = role === "thumb" ? thumbCandidates : galleryCandidates
  for (const c of candidates) {
    const hit = zipMap.get(c.toLowerCase())
    if (hit) return { bytes: hit, sourceName: c }
  }
  return null
}

export const parseGalleryRefs = (raw: unknown): string[] => {
  const s = String(raw ?? "").trim()
  if (!s) return []
  return s
    .split(/[,;]/g)
    .map((x) => x.trim())
    .filter(Boolean)
}
