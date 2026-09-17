"use client"

import { createRoot } from "react-dom/client"
import { Toast as RadixToast, ToastProvider, ToastViewport, ToastTitle, ToastDescription, ToastClose } from "@/components/ui/toast"

export type ToastProps = {
    id: string
    title: string
    description?: string
    type?: "success" | "error" | "info" | "warning"
    duration?: number
    onClose?: () => void
}

let toastContainer: HTMLDivElement | null = null
let toastRoot: ReturnType<typeof createRoot> | null = null
const activeToasts = new Map<string, ToastProps>()

function getToastContainer() {
    if (!toastContainer) {
        toastContainer = document.createElement("div")
        toastContainer.style.position = "fixed"
        toastContainer.style.top = "auto"
        toastContainer.style.right = "0"
        toastContainer.style.bottom = "0"
        toastContainer.style.left = "auto"
        toastContainer.style.zIndex = "9999"
        document.body.appendChild(toastContainer)
        toastRoot = createRoot(toastContainer)
    }
    return { container: toastContainer, root: toastRoot! }
}

function Toast({ id, title, description, type = "success", duration = 4000, onClose }: ToastProps) {
    const variant = type === "error" ? "destructive" : "default"

    return (
        <RadixToast variant={variant} duration={duration} onOpenChange={(open) => !open && onClose?.()}>
            <div className="grid gap-1">
                <ToastTitle>{title}</ToastTitle>
                {description && <ToastDescription>{description}</ToastDescription>}
            </div>
            <ToastClose />
        </RadixToast>
    )
}

function renderToasts() {
    const { root } = getToastContainer()
    root.render(
        <ToastProvider>
            {Array.from(activeToasts.values()).map((toast) => (
                <Toast key={toast.id} {...toast} />
            ))}
            <ToastViewport className="fixed bottom-4 right-4 top-auto left-auto flex-col" />
        </ToastProvider>
    )
}

export function toast({ title, description, type = "success", duration = 4000 }: Omit<ToastProps, "id" | "onClose">) {
    const id = Math.random().toString(36).substring(7)

    const removeToast = () => {
        activeToasts.delete(id)
        renderToasts()
    }

    const toastProps: ToastProps = {
        id,
        title,
        description,
        type,
        duration,
        onClose: removeToast,
    }

    activeToasts.set(id, toastProps)
    renderToasts()

    if (duration > 0) {
        setTimeout(removeToast, duration)
    }

    return id
}

toast.success = (title: string, description?: string) => toast({ title, description, type: "success" })
toast.error = (title: string, description?: string) => toast({ title, description, type: "error" })
toast.info = (title: string, description?: string) => toast({ title, description, type: "info" })
toast.warning = (title: string, description?: string) => toast({ title, description, type: "warning" })
