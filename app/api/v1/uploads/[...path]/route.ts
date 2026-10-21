import fs from "node:fs/promises"
import path from "node:path"
import { NextRequest, NextResponse } from "next/server"
import { env } from "@/src/server/core/config/env"

const contentTypeForExt = (ext: string) => {
  const map: Record<string, string> = {
    ".png": "image/png",
    ".jpg": "image/jpeg",
    ".jpeg": "image/jpeg",
    ".webp": "image/webp",
    ".gif": "image/gif",
    ".svg": "image/svg+xml",
    ".mp4": "video/mp4",
    ".webm": "video/webm",
    ".pdf": "application/pdf",
  }
  return map[ext.toLowerCase()] ?? "application/octet-stream"
}

export async function GET(
  _request: NextRequest,
  context: { params: Promise<{ path: string[] }> },
) {
  const params = await context.params
  const parts = (params.path ?? []).filter(Boolean)
  if (parts.length === 0) {
    return NextResponse.json({ success: false, message: "Not found" }, { status: 404 })
  }

  const cleaned = parts.map((part) => part.replace(/\.\./g, "").replace(/^\/+|\/+$/g, ""))
  const relativePath = path.posix.normalize(path.posix.join(...cleaned)).replace(/^(\.\.(\/|\\|$))+/, "")
  if (!relativePath || relativePath.includes("..")) {
    return NextResponse.json({ success: false, message: "Invalid path" }, { status: 400 })
  }
  const rootPath = path.resolve(env.STORAGE_LOCAL_PATH)
  const absolutePath = path.resolve(rootPath, relativePath)
  const safeRoot = rootPath.endsWith(path.sep) ? rootPath : `${rootPath}${path.sep}`
  if (!(absolutePath === rootPath || absolutePath.startsWith(safeRoot))) {
    return NextResponse.json({ success: false, message: "Forbidden path" }, { status: 403 })
  }

  try {
    const stats = await fs.stat(absolutePath)
    const ext = path.extname(absolutePath)
    const contentType = contentTypeForExt(ext)
    const immutable = /-(thumb|medium|original)\.(webp|png|jpg|jpeg|gif)$/i.test(relativePath)
    
    // Support Range Requests for Video Scrubbing/Seeking
    const range = _request.headers.get("range")
    if (range && (contentType.startsWith("video/") || contentType.startsWith("audio/"))) {
      const parts = range.replace(/bytes=/, "").split("-")
      const start = parseInt(parts[0], 10)
      const end = parts[1] ? parseInt(parts[1], 10) : stats.size - 1
      const chunksize = end - start + 1
      
      const file = await fs.open(absolutePath, "r")
      const buffer = Buffer.alloc(chunksize)
      await file.read(buffer, 0, chunksize, start)
      await file.close()

      return new NextResponse(buffer, {
        status: 206,
        headers: {
          "Content-Range": `bytes ${start}-${end}/${stats.size}`,
          "Accept-Ranges": "bytes",
          "Content-Length": String(chunksize),
          "Content-Type": contentType,
          "Cache-Control": "no-cache",
        },
      })
    }

    const data = await fs.readFile(absolutePath)
    return new NextResponse(new Uint8Array(data), {
      headers: {
        "Content-Type": contentType,
        "Accept-Ranges": "bytes",
        "Cache-Control": immutable
          ? "public, max-age=31536000, immutable"
          : "public, max-age=86400, stale-while-revalidate=604800",
      },
    })
  } catch {
    // In local/dev, uploaded files may be missing even if DB paths exist.
    // Serve a stable placeholder image instead of hard 404 to keep UI usable.
    try {
      const placeholderPath = path.join(
        process.cwd(),
        "public",
        "assets",
        "product listing",
        "Ziply5 - Pouch - Butter Chk Rice 3.png",
      )
      const fallback = await fs.readFile(placeholderPath)
      return new NextResponse(new Uint8Array(fallback), {
        status: 200,
        headers: {
          "Content-Type": "image/png",
          "Cache-Control": "no-store",
          "X-Upload-Fallback": "true",
        },
      })
    } catch {
      return NextResponse.json({ success: false, message: "File not found" }, { status: 404 })
    }
  }
}
