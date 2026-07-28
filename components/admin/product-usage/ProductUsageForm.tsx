"use client"

import { useState, useEffect, useCallback } from "react"
import { useRouter } from "next/navigation"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import { Textarea } from "@/components/ui/textarea"
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card"
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select"
import { Switch } from "@/components/ui/switch"
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs"
import { Loader2, Save, ArrowLeft, Upload, Trash2, Video, Globe, Search, AlertCircle, CheckCircle } from "lucide-react"
import { RichTextEditor } from "@/components/dashboard/RichTextEditor"
import { uploadAdminImage } from "@/lib/admin-upload"
import { authedFetch, authedPost, authedPut } from "@/lib/dashboard-fetch"
import { toast } from "@/lib/toast"
import VideoPlayer from "@/components/common/VideoPlayer"
import { parseVideoUrl } from "@/lib/video-utils"

interface ProductUsageFormProps {
  initialData?: any
  isEdit?: boolean
}

export default function ProductUsageForm({ initialData, isEdit = false }: ProductUsageFormProps) {
  const router = useRouter()
  const [saving, setSaving] = useState(false)
  const [activeTab, setActiveTab] = useState<"content" | "video" | "seo">("content")

  // Form State
  const [title, setTitle] = useState(initialData?.title || "")
  const [slug, setSlug] = useState(initialData?.slug || "")
  const [shortDescription, setShortDescription] = useState(initialData?.shortDescription || "")
  const [description, setDescription] = useState(initialData?.description || "")
  const [usageProcess, setUsageProcess] = useState(initialData?.usageProcess || "")
  const [thumbnail, setThumbnail] = useState(initialData?.thumbnail || "")

  // Video state
  const [videoType, setVideoType] = useState<"upload" | "youtube" | "vimeo" | "cdn">(
    initialData?.videoType && initialData.videoType !== "none" ? initialData.videoType : "youtube"
  )
  const [videoUrl, setVideoUrl] = useState(initialData?.videoUrl || "")
  const [uploadedVideo, setUploadedVideo] = useState(initialData?.uploadedVideo || "")
  const [uploadingVideoFile, setUploadingVideoFile] = useState(false)

  // Related product
  const [relatedProductId, setRelatedProductId] = useState<string | null>(initialData?.relatedProductId || null)
  const [productsList, setProductsList] = useState<Array<{ id: string; name: string; slug: string }>>([])
  const [productSearch, setProductSearch] = useState("")

  // Status & Settings
  const [publishStatus, setPublishStatus] = useState<"draft" | "published" | "archived">(
    initialData?.publishStatus || "draft"
  )
  const [isActive, setIsActive] = useState(initialData?.isActive !== undefined ? initialData.isActive : true)
  const [displayOrder, setDisplayOrder] = useState<number>(initialData?.displayOrder || 0)

  // SEO State
  const [seoTitle, setSeoTitle] = useState(initialData?.seoTitle || "")
  const [metaDescription, setMetaDescription] = useState(initialData?.metaDescription || "")
  const [metaKeywords, setMetaKeywords] = useState(initialData?.metaKeywords || "")
  const [canonicalUrl, setCanonicalUrl] = useState(initialData?.canonicalUrl || "")
  const [ogTitle, setOgTitle] = useState(initialData?.ogTitle || "")
  const [ogDescription, setOgDescription] = useState(initialData?.ogDescription || "")
  const [ogImage, setOgImage] = useState(initialData?.ogImage || "")
  const [robots, setRobots] = useState(initialData?.robots || "index,follow")
  const [includeInSitemap, setIncludeInSitemap] = useState(
    initialData?.includeInSitemap !== undefined ? initialData.includeInSitemap : true
  )

  // Image Uploading
  const [uploadingThumb, setUploadingThumb] = useState(false)

  // Slug Unique Check
  const [slugStatus, setSlugStatus] = useState<"idle" | "checking" | "available" | "taken">("idle")

  // Auto-generate slug from title if not manually touched
  const [isSlugManuallyEdited, setIsSlugManuallyEdited] = useState(Boolean(isEdit))

  const slugify = (str: string) => {
    return str
      .toLowerCase()
      .trim()
      .replace(/[^a-z0-9\s-]/g, "")
      .replace(/[\s_-]+/g, "-")
      .replace(/^-+|-+$/g, "")
  }

  const handleTitleChange = (val: string) => {
    setTitle(val)
    if (!isSlugManuallyEdited) {
      setSlug(slugify(val))
    }
  }

  // Fetch product options
  useEffect(() => {
    let cancelled = false
    fetch("/api/v1/products?limit=100")
      .then((r) => r.json())
      .then((json) => {
        if (cancelled) return
        const items = json.data?.items || []
        setProductsList(items.map((p: any) => ({ id: p.id, name: p.name, slug: p.slug })))
      })
      .catch(() => null)
    return () => {
      cancelled = true
    }
  }, [])

  // Validate Video Provider automatically if videoUrl changes
  useEffect(() => {
    if (videoType === "upload" || !videoUrl.trim()) return
    const info = parseVideoUrl(videoUrl)
    if (info.provider !== "none") {
      setVideoType(info.provider)
    }
  }, [videoUrl, videoType])

  // Upload Thumbnail Handler
  const handleThumbnailUpload = async (file?: File) => {
    if (!file) return
    setUploadingThumb(true)
    try {
      const url = await uploadAdminImage(file, "product-usage/thumbnails")
      setThumbnail(url)
      toast.success("Thumbnail uploaded")
    } catch {
      toast.error("Thumbnail upload failed")
    } finally {
      setUploadingThumb(false)
    }
  }

  // Upload Video File Handler
  const handleVideoFileUpload = async (file?: File) => {
    if (!file) return
    const validExtensions = ["video/mp4", "video/webm", "video/quicktime"]
    if (!validExtensions.includes(file.type) && !/\.(mp4|webm|mov)$/i.test(file.name)) {
      toast.error("Supported video formats: MP4, WebM, MOV")
      return
    }

    setUploadingVideoFile(true)
    try {
      const formData = new FormData()
      formData.append("file", file)
      formData.append("folder", "product-usage/videos")

      const res = await fetch("/api/v1/uploads", {
        method: "POST",
        body: formData,
      })
      const json = await res.json()
      if (!json.success || !json.data?.files?.[0]?.url) {
        throw new Error(json.message || "Video upload failed")
      }
      const uploadedUrl = json.data.files[0].url
      setUploadedVideo(uploadedUrl)
      setVideoType("upload")
      toast.success("Video file uploaded successfully")
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Video upload failed")
    } finally {
      setUploadingVideoFile(false)
    }
  }

  // Save Form Handler
  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault()
    if (!title.trim()) {
      toast.error("Title is required")
      return
    }
    if (!slug.trim()) {
      toast.error("Slug is required")
      return
    }

    const hasVideo = videoType === "upload" ? Boolean(uploadedVideo.trim()) : Boolean(videoUrl.trim())
    if (!hasVideo) {
      toast.error("Video is mandatory. Please provide a video URL or upload a video file.")
      setActiveTab("video")
      return
    }

    setSaving(true)
    try {
      const payload = {
        title: title.trim(),
        slug: slug.trim().toLowerCase(),
        shortDescription: shortDescription.trim() || null,
        description,
        usageProcess,
        thumbnail: thumbnail.trim() || null,
        videoType,
        videoUrl: videoUrl.trim() || null,
        uploadedVideo: uploadedVideo.trim() || null,
        relatedProductId: relatedProductId || null,
        seoTitle: seoTitle.trim() || null,
        metaDescription: metaDescription.trim() || null,
        metaKeywords: metaKeywords.trim() || null,
        canonicalUrl: canonicalUrl.trim() || null,
        ogTitle: ogTitle.trim() || null,
        ogDescription: ogDescription.trim() || null,
        ogImage: ogImage.trim() || null,
        robots,
        includeInSitemap,
        publishStatus,
        isActive,
        displayOrder: Number(displayOrder) || 0,
      }

      if (isEdit && initialData?.id) {
        await authedPut(`/api/admin/product-usage/${initialData.id}`, payload)
        toast.success("Product Usage updated successfully")
      } else {
        await authedPost("/api/admin/product-usage", payload)
        toast.success("Product Usage created successfully")
      }

      router.push("/admin/product-usage")
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Save failed")
    } finally {
      setSaving(false)
    }
  }

  return (
    <form onSubmit={handleSubmit} className="space-y-6">
      {/* Top Header */}
      <div className="flex flex-wrap items-center justify-between gap-4">
        <div className="flex items-center gap-3">
          <Button
            type="button"
            variant="outline"
            size="icon"
            onClick={() => router.push("/admin/product-usage")}
            className="h-9 w-9 border-[#E8DCC8]"
          >
            <ArrowLeft className="h-4 w-4 text-[#7B3010]" />
          </Button>
          <div>
            <h1 className="font-melon text-2xl font-medium text-[#4A1D1F]">
              {isEdit ? "Edit Product Usage" : "Add Product Usage"}
            </h1>
            <p className="text-xs text-[#646464]">
              {isEdit ? `Editing /${initialData?.slug}` : "Create a new product usage guide with video & SEO"}
            </p>
          </div>
        </div>

        <div className="flex items-center gap-2">
          <Button
            type="button"
            variant="outline"
            onClick={() => router.push("/admin/product-usage")}
            disabled={saving}
          >
            Cancel
          </Button>
          <Button
            type="submit"
            disabled={saving}
            className="bg-[#7B3010] text-white hover:bg-[#601c10] gap-2"
          >
            {saving ? <Loader2 className="h-4 w-4 animate-spin" /> : <Save className="h-4 w-4" />}
            {isEdit ? "Update Entry" : "Save Entry"}
          </Button>
        </div>
      </div>

      {/* Main Tabs Layout */}
      <Tabs value={activeTab} onValueChange={(v) => setActiveTab(v as any)} className="space-y-6">
        <TabsList className="bg-[#FFFBF3] border border-[#E8DCC8] p-1">
          <TabsTrigger value="content" className="data-[state=active]:bg-[#7B3010] data-[state=active]:text-white">
            Content & Details
          </TabsTrigger>
          <TabsTrigger value="video" className="data-[state=active]:bg-[#7B3010] data-[state=active]:text-white">
            Video Configuration
          </TabsTrigger>
          <TabsTrigger value="seo" className="data-[state=active]:bg-[#7B3010] data-[state=active]:text-white">
            SEO & SERP Preview
          </TabsTrigger>
        </TabsList>

        {/* TAB 1: Content & Details */}
        <TabsContent value="content" className="space-y-6">
          <div className="grid gap-6 lg:grid-cols-3">
            {/* Left Column: Main Form */}
            <div className="space-y-6 lg:col-span-2">
              <Card className="border-[#E8DCC8]">
                <CardHeader>
                  <CardTitle className="text-base text-[#4A1D1F]">Basic Information</CardTitle>
                  <CardDescription className="text-xs">Title, unique slug, and short description.</CardDescription>
                </CardHeader>
                <CardContent className="space-y-4">
                  <div>
                    <Label className="text-xs font-bold text-[#4A1D1F]">Title *</Label>
                    <Input
                      value={title}
                      onChange={(e) => handleTitleChange(e.target.value)}
                      placeholder="e.g. How to Prepare Ziply5 Ready Meal in 3 Steps"
                      className="mt-1"
                      required
                    />
                  </div>

                  <div>
                    <Label className="text-xs font-bold text-[#4A1D1F]">Slug *</Label>
                    <div className="relative mt-1 flex items-center">
                      <Input
                        value={slug}
                        onChange={(e) => {
                          setIsSlugManuallyEdited(true)
                          setSlug(e.target.value)
                        }}
                        placeholder="how-to-prepare-ziply5-meal"
                        className="font-mono text-xs pr-20"
                        required
                      />
                      <span className="absolute right-3 text-[11px] font-semibold text-[#888]">
                        /product-usage/
                      </span>
                    </div>
                    <p className="mt-1 text-[11px] text-[#888]">
                      Auto-generated from title. URL path for this entry.
                    </p>
                  </div>

                  <div>
                    <Label className="text-xs font-bold text-[#4A1D1F]">Short Description</Label>
                    <Textarea
                      value={shortDescription}
                      onChange={(e) => setShortDescription(e.target.value)}
                      placeholder="Brief overview summarizing this guide (~2 sentences)"
                      className="mt-1 min-h-[70px]"
                    />
                  </div>
                </CardContent>
              </Card>

              {/* Rich Text Editors */}
              <Card className="border-[#E8DCC8]">
                <CardHeader>
                  <CardTitle className="text-base text-[#4A1D1F]">Detailed Description</CardTitle>
                  <CardDescription className="text-xs">Comprehensive information, key benefits, and details.</CardDescription>
                </CardHeader>
                <CardContent>
                  <RichTextEditor
                    value={description}
                    onChange={setDescription}
                    placeholder="Write detailed instructions or product overview..."
                  />
                </CardContent>
              </Card>

              <Card className="border-[#E8DCC8]">
                <CardHeader>
                  <CardTitle className="text-base text-[#4A1D1F]">Step-by-Step Usage Process</CardTitle>
                  <CardDescription className="text-xs">Step 1, Step 2, Step 3 formatting for instructions.</CardDescription>
                </CardHeader>
                <CardContent>
                  <RichTextEditor
                    value={usageProcess}
                    onChange={setUsageProcess}
                    placeholder="1. Open packet\n2. Add boiling water...\n3. Enjoy!"
                  />
                </CardContent>
              </Card>
            </div>

            {/* Right Column: Settings & Thumbnail */}
            <div className="space-y-6">
              {/* Status & Options */}
              <Card className="border-[#E8DCC8]">
                <CardHeader>
                  <CardTitle className="text-base text-[#4A1D1F]">Publishing Settings</CardTitle>
                </CardHeader>
                <CardContent className="space-y-4">
                  <div>
                    <Label className="text-xs font-bold text-[#4A1D1F]">Publish Status</Label>
                    <Select value={publishStatus} onValueChange={(v: any) => setPublishStatus(v)}>
                      <SelectTrigger className="mt-1 text-xs">
                        <SelectValue />
                      </SelectTrigger>
                      <SelectContent>
                        <SelectItem value="draft">Draft</SelectItem>
                        <SelectItem value="published">Published</SelectItem>
                        <SelectItem value="archived">Archived</SelectItem>
                      </SelectContent>
                    </Select>
                  </div>

                  <div className="flex items-center justify-between rounded-xl border border-[#E8DCC8] p-3 bg-[#FFFBF3]">
                    <div>
                      <Label className="text-xs font-bold text-[#4A1D1F]">Is Active</Label>
                      <p className="text-[10px] text-[#646464]">Visible on website if published.</p>
                    </div>
                    <Switch checked={isActive} onCheckedChange={setIsActive} />
                  </div>

                  <div>
                    <Label className="text-xs font-bold text-[#4A1D1F]">Display Order</Label>
                    <Input
                      type="number"
                      value={displayOrder}
                      onChange={(e) => setDisplayOrder(parseInt(e.target.value, 10) || 0)}
                      className="mt-1"
                    />
                    <p className="mt-1 text-[10px] text-[#888]">Lower number appears first.</p>
                  </div>

                  {/* Related Product */}
                  <div>
                    <Label className="text-xs font-bold text-[#4A1D1F]">Related Product (Optional)</Label>
                    <Select
                      value={relatedProductId || "none"}
                      onValueChange={(val) => setRelatedProductId(val === "none" ? null : val)}
                    >
                      <SelectTrigger className="mt-1 text-xs">
                        <SelectValue placeholder="Select a product..." />
                      </SelectTrigger>
                      <SelectContent className="max-h-60">
                        <SelectItem value="none">-- No Related Product --</SelectItem>
                        {productsList.map((p) => (
                          <SelectItem key={p.id} value={p.id}>
                            {p.name}
                          </SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                  </div>
                </CardContent>
              </Card>

              {/* Thumbnail Card */}
              <Card className="border-[#E8DCC8]">
                <CardHeader>
                  <CardTitle className="text-base text-[#4A1D1F]">Featured Thumbnail</CardTitle>
                </CardHeader>
                <CardContent className="space-y-3">
                  {thumbnail ? (
                    <div className="relative aspect-video w-full overflow-hidden rounded-xl border border-[#E8DCC8] bg-black/5">
                      <img src={thumbnail} alt="Thumbnail preview" className="h-full w-full object-cover" />
                      <button
                        type="button"
                        onClick={() => setThumbnail("")}
                        className="absolute right-2 top-2 rounded-full bg-red-600 p-1 text-white hover:bg-red-700"
                        title="Remove image"
                      >
                        <Trash2 className="h-4 w-4" />
                      </button>
                    </div>
                  ) : (
                    <div className="flex flex-col items-center justify-center rounded-xl border-2 border-dashed border-[#E8DCC8] p-6 text-center bg-[#FFFBF3]">
                      <Upload className="h-8 w-8 text-[#7B3010]" />
                      <p className="mt-2 text-xs font-bold text-[#4A1D1F]">Upload Image Thumbnail</p>
                      <p className="text-[10px] text-[#888]">PNG, JPG, WebP up to 5MB</p>
                    </div>
                  )}

                  <div className="flex flex-col gap-2">
                    <Input
                      type="file"
                      accept="image/*"
                      className="cursor-pointer text-xs"
                      disabled={uploadingThumb}
                      onChange={(e) => {
                        const file = e.target.files?.[0]
                        void handleThumbnailUpload(file)
                        e.target.value = ""
                      }}
                    />
                    {uploadingThumb ? (
                      <div className="flex items-center gap-1 text-xs text-[#7B3010]">
                        <Loader2 className="h-3.5 w-3.5 animate-spin" /> Uploading image...
                      </div>
                    ) : null}
                  </div>
                </CardContent>
              </Card>
            </div>
          </div>
        </TabsContent>

        {/* TAB 2: Video Configuration */}
        <TabsContent value="video" className="space-y-6">
          <Card className="border-[#E8DCC8]">
            <CardHeader>
              <CardTitle className="text-base text-[#4A1D1F]">Video Source Setup</CardTitle>
              <CardDescription className="text-xs">
                Supports self-hosted video uploads (MP4, MOV, WebM) or external URLs (YouTube, Vimeo, CDN). Only one video source will be active.
              </CardDescription>
            </CardHeader>
            <CardContent className="space-y-6">
              {/* Radio options */}
              <div className="grid gap-3 sm:grid-cols-3">
                {[
                  { value: "youtube", label: "YouTube / Vimeo" },
                  { value: "upload", label: "Video Upload" },
                  { value: "cdn", label: "CDN Direct Link" },
                ].map((opt) => (
                  <button
                    type="button"
                    key={opt.value}
                    onClick={() => setVideoType(opt.value as any)}
                    className={`rounded-xl border p-3 text-center text-xs font-bold transition-all ${
                      videoType === opt.value
                        ? "border-[#7B3010] bg-[#7B3010] text-white shadow-sm"
                        : "border-[#E8DCC8] bg-white text-[#4A1D1F] hover:bg-[#FFFBF3]"
                    }`}
                  >
                    {opt.label}
                  </button>
                ))}
              </div>

              {/* Option 1: File Upload */}
              {videoType === "upload" && (
                <div className="rounded-xl border border-[#E8DCC8] bg-[#FFFBF3] p-4 space-y-3">
                  <Label className="text-xs font-bold text-[#4A1D1F]">Upload Video File (.mp4, .webm, .mov)</Label>
                  <Input
                    type="file"
                    accept="video/mp4,video/webm,video/quicktime"
                    className="cursor-pointer text-xs"
                    disabled={uploadingVideoFile}
                    onChange={(e) => {
                      const file = e.target.files?.[0]
                      void handleVideoFileUpload(file)
                      e.target.value = ""
                    }}
                  />
                  {uploadingVideoFile && (
                    <div className="flex items-center gap-2 text-xs font-semibold text-[#7B3010]">
                      <Loader2 className="h-4 w-4 animate-spin" /> Uploading video file to CDN storage...
                    </div>
                  )}

                  {uploadedVideo && (
                    <div className="space-y-2 pt-2">
                      <p className="text-xs font-bold text-emerald-700 flex items-center gap-1">
                        <CheckCircle className="h-4 w-4" /> Video uploaded successfully
                      </p>
                      <Input value={uploadedVideo} readOnly className="font-mono text-xs bg-white" />
                    </div>
                  )}
                </div>
              )}

              {/* Option 2: Video URL */}
              {(videoType === "youtube" || videoType === "vimeo" || videoType === "cdn") && (
                <div className="rounded-xl border border-[#E8DCC8] bg-[#FFFBF3] p-4 space-y-3">
                  <Label className="text-xs font-bold text-[#4A1D1F]">Paste Video URL</Label>
                  <Input
                    value={videoUrl}
                    onChange={(e) => setVideoUrl(e.target.value)}
                    placeholder="https://www.youtube.com/watch?v=... or https://vimeo.com/..."
                    className="text-xs bg-white"
                  />
                  <p className="text-[11px] text-[#646464]">
                    Supports YouTube standard/shorts, Vimeo, or direct MP4 CDN links.
                  </p>
                </div>
              )}

              {/* Live Video Preview Box */}
              {videoType !== "none" && (
                <div className="space-y-2 border-t pt-4">
                  <Label className="text-xs font-bold text-[#4A1D1F]">Live Video Preview</Label>
                  <VideoPlayer
                    videoType={videoType}
                    videoUrl={videoUrl}
                    uploadedVideo={uploadedVideo}
                    thumbnail={thumbnail}
                    title={title}
                  />
                </div>
              )}
            </CardContent>
          </Card>
        </TabsContent>

        {/* TAB 3: SEO Configuration */}
        <TabsContent value="seo" className="space-y-6">
          <div className="grid gap-6 lg:grid-cols-3">
            <div className="space-y-6 lg:col-span-2">
              <Card className="border-[#E8DCC8]">
                <CardHeader>
                  <CardTitle className="text-base text-[#4A1D1F]">Search Engine Optimization (SEO)</CardTitle>
                  <CardDescription className="text-xs">
                    Metadata used by Google, Bing, and social platforms.
                  </CardDescription>
                </CardHeader>
                <CardContent className="space-y-4">
                  <div>
                    <Label className="text-xs font-bold text-[#4A1D1F]">SEO Meta Title</Label>
                    <Input
                      value={seoTitle}
                      onChange={(e) => setSeoTitle(e.target.value)}
                      placeholder={title || "Custom Title for Search Engine (~60 chars)"}
                      className="mt-1"
                    />
                  </div>

                  <div>
                    <Label className="text-xs font-bold text-[#4A1D1F]">Meta Description</Label>
                    <Textarea
                      value={metaDescription}
                      onChange={(e) => setMetaDescription(e.target.value)}
                      placeholder={shortDescription || "Summary text shown in Google search results (~155 chars)..."}
                      className="mt-1 min-h-[80px]"
                    />
                  </div>

                  <div>
                    <Label className="text-xs font-bold text-[#4A1D1F]">Meta Keywords</Label>
                    <Input
                      value={metaKeywords}
                      onChange={(e) => setMetaKeywords(e.target.value)}
                      placeholder="e.g. ziply5, ready to eat, recipe, how to cook"
                      className="mt-1"
                    />
                  </div>

                  <div>
                    <Label className="text-xs font-bold text-[#4A1D1F]">Canonical URL</Label>
                    <Input
                      value={canonicalUrl}
                      onChange={(e) => setCanonicalUrl(e.target.value)}
                      placeholder="https://ziply5.com/product-usage/..."
                      className="mt-1 font-mono text-xs"
                    />
                  </div>

                  <div className="border-t pt-4 space-y-4">
                    <h4 className="text-xs font-bold text-[#4A1D1F]">Open Graph (Social Sharing)</h4>
                    <div>
                      <Label className="text-xs text-[#646464]">OG Title</Label>
                      <Input
                        value={ogTitle}
                        onChange={(e) => setOgTitle(e.target.value)}
                        placeholder="Title for WhatsApp / Facebook / Twitter"
                        className="mt-1"
                      />
                    </div>
                    <div>
                      <Label className="text-xs text-[#646464]">OG Description</Label>
                      <Textarea
                        value={ogDescription}
                        onChange={(e) => setOgDescription(e.target.value)}
                        placeholder="Description for social link previews"
                        className="mt-1 min-h-[60px]"
                      />
                    </div>
                    <div>
                      <Label className="text-xs text-[#646464]">OG Image URL</Label>
                      <Input
                        value={ogImage}
                        onChange={(e) => setOgImage(e.target.value)}
                        placeholder={thumbnail || "https://..."}
                        className="mt-1 text-xs"
                      />
                    </div>
                  </div>

                  <div className="border-t pt-4 grid gap-4 sm:grid-cols-2">
                    <div>
                      <Label className="text-xs font-bold text-[#4A1D1F]">Robots Directives</Label>
                      <Select value={robots} onValueChange={setRobots}>
                        <SelectTrigger className="mt-1 text-xs">
                          <SelectValue />
                        </SelectTrigger>
                        <SelectContent>
                          <SelectItem value="index,follow">index, follow (Default)</SelectItem>
                          <SelectItem value="noindex,follow">noindex, follow</SelectItem>
                          <SelectItem value="index,nofollow">index, nofollow</SelectItem>
                          <SelectItem value="noindex,nofollow">noindex, nofollow</SelectItem>
                        </SelectContent>
                      </Select>
                    </div>

                    <div className="flex items-center justify-between rounded-xl border border-[#E8DCC8] p-3 bg-[#FFFBF3]">
                      <div>
                        <Label className="text-xs font-bold text-[#4A1D1F]">Include in Sitemap</Label>
                        <p className="text-[10px] text-[#646464]">Add to sitemap.xml</p>
                      </div>
                      <Switch checked={includeInSitemap} onCheckedChange={setIncludeInSitemap} />
                    </div>
                  </div>
                </CardContent>
              </Card>
            </div>

            {/* Google SERP Preview Card */}
            <div>
              <Card className="border-[#E8DCC8] sticky top-6">
                <CardHeader>
                  <CardTitle className="text-base text-[#4A1D1F]">Google SERP Preview</CardTitle>
                  <CardDescription className="text-xs">Live snippet preview of how your page appears on Google search.</CardDescription>
                </CardHeader>
                <CardContent>
                  <div className="rounded-xl border border-gray-200 bg-white p-4 space-y-1 shadow-sm">
                    <div className="flex items-center gap-2 text-xs text-[#202124]">
                      <span className="flex h-4 w-4 items-center justify-center rounded-full bg-orange-500 text-[9px] text-white font-bold">Z</span>
                      <span className="truncate text-xs font-normal">ziply5.com › product-usage</span>
                    </div>
                    <h3 className="text-base font-medium text-[#1a0dab] hover:underline cursor-pointer truncate">
                      {seoTitle || title || "Title of Product Usage Guide"}
                    </h3>
                    <p className="text-xs text-[#4d5156] line-clamp-2 leading-relaxed">
                      {metaDescription || shortDescription || "This is a preview of the meta description. Provide concise text summarizing your guide to improve click-through rates on Google."}
                    </p>
                  </div>
                </CardContent>
              </Card>
            </div>
          </div>
        </TabsContent>
      </Tabs>
    </form>
  )
}
