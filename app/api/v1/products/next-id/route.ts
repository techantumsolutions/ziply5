import { NextResponse } from "next/server"
import { getNextProductSequenceId } from "@/src/lib/db/products"

export const dynamic = "force-dynamic"

export async function GET() {
  try {
    const nextId = await getNextProductSequenceId()
    return NextResponse.json({ data: { nextId } })
  } catch {
    return NextResponse.json({ data: { nextId: "PRD-00024" } })
  }
}
