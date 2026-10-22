import { NextRequest } from "next/server"
import { POST as handleProviderWebhook } from "@/app/api/v1/payments/webhooks/[provider]/route"

export async function POST(request: NextRequest) {
  return handleProviderWebhook(request, {
    params: Promise.resolve({ provider: "razorpay" }),
  })
}
