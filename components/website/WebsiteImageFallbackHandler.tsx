"use client"

import { FALLBACK_PRODUCT_IMAGE } from "@/lib/storefront-products"
import { useEffect } from "react"

/**
 * If a product image is missing or fails to load, hide it instead of swapping
 * in the placeholder graphic.
 */
export default function WebsiteImageFallbackHandler() {
  useEffect(() => {
    const hideImage = (target: HTMLImageElement) => {
      target.style.visibility = "hidden"
    }

    const isProductPlaceholder = (src: string) =>
      !src || src === FALLBACK_PRODUCT_IMAGE || src.endsWith("/fallback-product.png") || src.endsWith("/placeholder.svg")

    const onError = (event: Event) => {
      const target = event.target
      if (!(target instanceof HTMLImageElement)) return
      const current = target.getAttribute("src") ?? ""
      if (!isProductPlaceholder(current) && !current.includes("/uploads/") && !current.includes("/products/")) return
      if (target.dataset.fallbackApplied === "true") return
      target.dataset.fallbackApplied = "true"
      hideImage(target)
    }

    document.querySelectorAll("img").forEach((img) => {
      const current = img.getAttribute("src") ?? ""
      if (!current || current === FALLBACK_PRODUCT_IMAGE || current.endsWith("/fallback-product.png") || current.endsWith("/placeholder.svg")) hideImage(img)
    })

    document.addEventListener("error", onError, true)
    return () => {
      document.removeEventListener("error", onError, true)
    }
  }, [])

  return null
}
