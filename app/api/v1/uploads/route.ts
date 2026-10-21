import { NextRequest } from "next/server"
import { fail, ok } from "@/src/server/core/http/response"
import { requireAuth } from "@/src/server/middleware/auth"
import { storageService } from "@/src/server/integrations/storage/storage.service"
import { logger } from "@/lib/logger"
import { rateLimit, resolveClientIp } from "@/src/server/security/rate-limit"
import { isTrustedOrigin } from "@/src/server/security/csrf"

export async function POST(request: NextRequest) {
  const auth = requireAuth(request)
  if ("status" in auth) return auth
  if (!isTrustedOrigin(request)) return fail("Invalid origin", 403)

  const ip = resolveClientIp(request.headers)
  const rl = await rateLimit({
    key: `rl:upload:${ip}`,
    limit: Number(process.env.UPLOAD_RATE_LIMIT_PER_MIN ?? 120),
    windowSec: 60,
  })
  if (!rl.ok) return fail("Too many uploads. Please try again shortly.", 429)

  const form = await request.formData()
  const folderRaw = String(form.get("folder") ?? "misc").trim()
  const folder = folderRaw.replace(/\.\./g, "").replace(/^\/+/, "").replace(/\/+$/, "") || "misc"
  const replaceRaw = String(form.get("replace") ?? "").trim()
  const replaceRelativePaths = replaceRaw
    ? replaceRaw.split(",").map((s) => s.trim()).filter(Boolean)
    : []

  const allFiles = [
    ...form.getAll("files"),
    ...form.getAll("file"),
  ].filter((entry): entry is File => entry instanceof File)

  if (allFiles.length === 0) return fail("No files uploaded", 400)
  if (allFiles.length > Number(process.env.UPLOAD_MAX_FILES_PER_REQUEST ?? 20)) {
    return fail("Too many files in one request", 422)
  }

  const uploaded: Array<Record<string, unknown>> = []
  const createdRelative: string[] = []
  const useRawFaviconUpload = folder.toLowerCase().startsWith("site/favicons")
  try {
    for (let i = 0; i < allFiles.length; i++) {
      const file = allFiles[i]
      if (!file.name) continue
      const bytes = new Uint8Array(await file.arrayBuffer())
      
      // Determine if we should use raw upload (favicons, videos, PDFs, documents, or orders folder)
      const isVideo = file.type.startsWith("video/")
      const isPdf = file.type === "application/pdf" || file.name.toLowerCase().endsWith(".pdf")
      const useRaw = useRawFaviconUpload || isVideo || isPdf || folder.startsWith("orders/") || file.type.startsWith("application/")
      
      if (useRaw) {
        const saved = await storageService.saveRawUpload({
          folder,
          originalName: file.name,
          buffer: bytes,
        })
        createdRelative.push(String(saved.relativePath))
        const url = String(saved.url)
        uploaded.push({
          name: file.name,
          size: file.size,
          type: file.type || (isPdf ? "application/pdf" : "application/octet-stream"),
          relativePath: saved.relativePath,
          url,
          variants: { original: url, medium: url, thumbnail: url },
        })
        continue
      }
      const saved = await storageService.saveProductImageSet({
        folder,
        originalName: file.name,
        buffer: bytes,
        replaceRelativePaths: i === 0 ? replaceRelativePaths : undefined,
      })
      createdRelative.push(String(saved.relativePath))
      uploaded.push({
        name: file.name,
        size: file.size,
        type: file.type,
        ...saved,
      })
    }
  } catch (error) {
    await Promise.all(createdRelative.map((relativePath) => storageService.deleteFile(relativePath)))
    logger.warn("uploads.api.failed", {
      folder,
      files: allFiles.length,
      ip,
      actorId: auth.user.sub,
      error: error instanceof Error ? error.message : "unknown",
    })
    return fail(error instanceof Error ? error.message : "Upload failed", 400)
  }

  logger.info("uploads.api.success", {
    folder,
    files: uploaded.length,
    ip,
    actorId: auth.user.sub,
  })
  return ok({ files: uploaded }, "Uploaded")
}
