import { ok } from "@/src/server/core/http/response"
import { getNextProductSequenceId } from "@/src/lib/db/products"

export const dynamic = "force-dynamic"

export async function GET() {
  try {
    const nextId = await getNextProductSequenceId()
    return ok({ nextId })
  } catch {
    return ok({ nextId: "PRD-000001" })
  }
}
