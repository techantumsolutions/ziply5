/** Detect uploaded/local gallery video URLs by common extensions. */
export const isVideoUrl = (url?: string | null) => {
  const value = String(url ?? "").trim().toLowerCase()
  if (!value) return false
  return /\.(mp4|webm|ogg|ogv|mov|m4v)(\?|#|$)/i.test(value)
}
