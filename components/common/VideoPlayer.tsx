"use client"

import { useMemo } from "react"
import { parseVideoUrl } from "@/lib/video-utils"
import { Play } from "lucide-react"

interface VideoPlayerProps {
  videoType?: "none" | "upload" | "youtube" | "vimeo" | "cdn" | string | null
  videoUrl?: string | null
  uploadedVideo?: string | null
  thumbnail?: string | null
  title?: string
  className?: string
  autoPlay?: boolean
}

export default function VideoPlayer({
  videoType,
  videoUrl,
  uploadedVideo,
  thumbnail,
  title = "Video Player",
  className = "",
  autoPlay = false,
}: VideoPlayerProps) {
  const activeUrl = useMemo(() => {
    if (videoType === "upload" && uploadedVideo?.trim()) {
      return uploadedVideo.trim()
    }
    return videoUrl?.trim() || uploadedVideo?.trim() || null
  }, [videoType, videoUrl, uploadedVideo])

  const videoInfo = useMemo(() => {
    return parseVideoUrl(activeUrl)
  }, [activeUrl])

  if (!activeUrl || videoInfo.provider === "none" || !videoInfo.isValid) {
    return null
  }

  return (
    <div className={`relative aspect-video w-full overflow-hidden rounded-2xl bg-black/90 shadow-lg ${className}`}>
      {videoInfo.provider === "youtube" || videoInfo.provider === "vimeo" ? (
        <iframe
          src={videoInfo.embedUrl || undefined}
          title={title}
          allow="accelerometer; autoplay; clipboard-write; encrypted-media; gyroscope; picture-in-picture; web-share"
          allowFullScreen
          className="h-full w-full border-0"
        />
      ) : (
        <video
          src={videoInfo.embedUrl || activeUrl}
          controls
          autoPlay={autoPlay}
          poster={thumbnail || undefined}
          preload="metadata"
          className="h-full w-full object-contain"
        >
          Your browser does not support playing HTML5 videos.
        </video>
      )}
    </div>
  )
}
