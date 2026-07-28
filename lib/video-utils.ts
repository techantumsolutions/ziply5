export type VideoProvider = "none" | "upload" | "youtube" | "vimeo" | "cdn"

export interface VideoInfo {
  provider: VideoProvider
  embedUrl: string | null
  originalUrl: string | null
  isValid: boolean
}

export function parseVideoUrl(url?: string | null): VideoInfo {
  if (!url || typeof url !== "string" || !url.trim()) {
    return { provider: "none", embedUrl: null, originalUrl: null, isValid: false }
  }

  const cleanUrl = url.trim()

  // 1. YouTube detection
  // Standard: youtube.com/watch?v=ID, youtube.com/embed/ID, ytu.be/ID, youtube.com/shorts/ID
  const youtubeMatch = cleanUrl.match(
    /(?:youtube\.com\/(?:[^\/]+\/.+\/|(?:v|e(?:mbed)?)\/|.*[?&]v=)|youtu\.be\/|youtube\.com\/shorts\/)([^"&?\/\s]{11})/i,
  )
  if (youtubeMatch && youtubeMatch[1]) {
    const videoId = youtubeMatch[1]
    return {
      provider: "youtube",
      embedUrl: `https://www.youtube.com/embed/${videoId}?autoplay=0&rel=0`,
      originalUrl: cleanUrl,
      isValid: true,
    }
  }

  // 2. Vimeo detection
  // vimeo.com/ID or player.vimeo.com/video/ID
  const vimeoMatch = cleanUrl.match(/(?:vimeo\.com\/|player\.vimeo\.com\/video\/)(\d+)/i)
  if (vimeoMatch && vimeoMatch[1]) {
    const videoId = vimeoMatch[1]
    return {
      provider: "vimeo",
      embedUrl: `https://player.vimeo.com/video/${videoId}?title=0&byline=0&portrait=0`,
      originalUrl: cleanUrl,
      isValid: true,
    }
  }

  // 3. Direct HTML5 Video File / CDN link detection (.mp4, .webm, .mov, /uploads/)
  const isDirectVideo =
    /\.(mp4|webm|mov|m4v)(\?.*)?$/i.test(cleanUrl) || cleanUrl.includes("/uploads/")
  if (isDirectVideo || cleanUrl.startsWith("http://") || cleanUrl.startsWith("https://") || cleanUrl.startsWith("/")) {
    return {
      provider: "cdn",
      embedUrl: cleanUrl,
      originalUrl: cleanUrl,
      isValid: true,
    }
  }

  return {
    provider: "none",
    embedUrl: null,
    originalUrl: cleanUrl,
    isValid: false,
  }
}
