"use client"

import { useState, useEffect } from "react"
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from "@/components/ui/dialog"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import { Switch } from "@/components/ui/switch"
import { authedFetch, authedPost } from "@/lib/dashboard-fetch"
import { toast } from "@/lib/toast"
import { Loader2 } from "lucide-react"

interface NavigationConfigModalProps {
  open: boolean
  onClose: () => void
  onSaved?: () => void
}

export default function NavigationConfigModal({ open, onClose, onSaved }: NavigationConfigModalProps) {
  const [loading, setLoading] = useState(false)
  const [saving, setSaving] = useState(false)
  const [form, setForm] = useState({
    title: "How to Use",
    url: "/product-usage",
    enabled: true,
    displayOrder: 4,
  })

  useEffect(() => {
    if (!open) return
    let cancelled = false
    setLoading(true)
    authedFetch<any>("/api/admin/product-usage/navigation")
      .then((data) => {
        if (cancelled) return
        if (data) {
          setForm({
            title: data.title || "How to Use",
            url: data.url || "/product-usage",
            enabled: data.enabled !== undefined ? Boolean(data.enabled) : true,
            displayOrder: data.displayOrder !== undefined ? Number(data.displayOrder) : 4,
          })
        }
      })
      .catch(() => {
        if (!cancelled) toast.error("Failed to load navigation settings")
      })
      .finally(() => {
        if (!cancelled) setLoading(false)
      })
    return () => {
      cancelled = true
    }
  }, [open])

  const handleSave = async () => {
    setSaving(true)
    try {
      await authedPost("/api/admin/product-usage/navigation", form)
      toast.success("Website navigation link updated successfully")
      onSaved?.()
      onClose()
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Failed to save navigation config")
    } finally {
      setSaving(false)
    }
  }

  return (
    <Dialog open={open} onOpenChange={(val) => !val && onClose()}>
      <DialogContent className="sm:max-w-md bg-white border-[#E8DCC8]">
        <DialogHeader>
          <DialogTitle className="text-xl font-bold text-[#4A1D1F]">
            Navbar Link Settings
          </DialogTitle>
        </DialogHeader>

        {loading ? (
          <div className="flex h-40 items-center justify-center">
            <Loader2 className="h-6 w-6 animate-spin text-[#7B3010]" />
          </div>
        ) : (
          <div className="space-y-4 py-2">
            <div>
              <Label className="text-xs font-bold text-[#4A1D1F]">Menu Item Title</Label>
              <Input
                value={form.title}
                onChange={(e) => setForm({ ...form, title: e.target.value })}
                placeholder="e.g. How to Use"
                className="mt-1"
              />
              <p className="mt-1 text-[11px] text-[#646464]">
                This is the label displayed in the website header navigation bar.
              </p>
            </div>

            <div>
              <Label className="text-xs font-bold text-[#4A1D1F]">Menu Item URL / Route</Label>
              <Input
                value={form.url}
                onChange={(e) => setForm({ ...form, url: e.target.value })}
                placeholder="e.g. /product-usage"
                className="mt-1"
              />
              <p className="mt-1 text-[11px] text-[#646464]">
                The path or URL clicked by visitors.
              </p>
            </div>

            <div className="flex items-center justify-between rounded-xl border border-[#E8DCC8] p-3 bg-[#FFFBF3]">
              <div>
                <Label className="text-xs font-bold text-[#4A1D1F]">Enable Navbar Link</Label>
                <p className="text-[11px] text-[#646464]">
                  Show or hide this link in the storefront header menu.
                </p>
              </div>
              <Switch
                checked={form.enabled}
                onCheckedChange={(val) => setForm({ ...form, enabled: val })}
              />
            </div>

            <div>
              <Label className="text-xs font-bold text-[#4A1D1F]">Display Order</Label>
              <Input
                type="number"
                value={form.displayOrder}
                onChange={(e) => setForm({ ...form, displayOrder: parseInt(e.target.value, 10) || 0 })}
                className="mt-1"
              />
            </div>
          </div>
        )}

        <DialogFooter className="gap-2">
          <Button variant="outline" onClick={onClose} disabled={saving}>
            Cancel
          </Button>
          <Button onClick={() => void handleSave()} disabled={saving || loading} className="bg-[#7B3010] text-white hover:bg-[#601c10]">
            {saving ? <Loader2 className="h-4 w-4 animate-spin mr-1" /> : null}
            Save Settings
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}
