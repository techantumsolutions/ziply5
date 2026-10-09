import { storageService } from "@/src/server/integrations/storage/storage.service"

const sanitizeSegment = (s: string) =>
  s
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9-_]+/g, "-")
    .replace(/-+/g, "-")
    .replace(/^-|-$/g, "") || "product"

const VIDEO_EXTENSIONS = new Set([".mp4", ".webm", ".mov", ".m4v"])

export const uploadProductImage = async (input: {
  slug: string
  relativePath: string
  bytes: Uint8Array
  sourceFileName: string
}): Promise<string> => {
  const folder = sanitizeSegment(input.slug)
  const safeFilePath = input.relativePath
    .split("/")
    .map((p) => sanitizeSegment(p))
    .filter(Boolean)
    .join("/")
  const leaf = safeFilePath || `${Date.now()}-${sanitizeSegment(input.sourceFileName || "image")}`
  
  const ext = (input.sourceFileName.includes(".")
    ? input.sourceFileName.slice(input.sourceFileName.lastIndexOf("."))
    : ""
  ).toLowerCase()

  if (VIDEO_EXTENSIONS.has(ext)) {
    const saved = await storageService.saveRawUpload({
      folder: `products/${folder}`,
      originalName: leaf.endsWith(ext) ? leaf : `${leaf}${ext}`,
      buffer: input.bytes,
    })
    return saved.url
  }

  const saved = await storageService.saveProductImageSet({
    folder: `products/${folder}`,
    originalName: leaf,
    buffer: input.bytes,
  })
  return saved.url
}

/** Optional variant asset path (storage only; no DB field change). */
export const uploadVariantAsset = async (input: {
  parentSlug: string
  variantSku: string
  bytes: Uint8Array
  sourceFileName: string
}): Promise<string> => {
  const ext = input.sourceFileName.includes(".") ? input.sourceFileName.slice(input.sourceFileName.lastIndexOf(".")) : ".jpg"
  const name = `${sanitizeSegment(input.variantSku)}${ext}`
  return uploadProductImage({
    slug: input.parentSlug,
    relativePath: `variants/${name}`,
    bytes: input.bytes,
    sourceFileName: input.sourceFileName,
  })
}
