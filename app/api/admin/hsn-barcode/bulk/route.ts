import { NextRequest } from "next/server"
import { ok, fail } from "@/src/server/core/http/response"
import { requireAuth } from "@/src/server/middleware/auth"
import { createMasterGroup, createMasterValue, listMasterValues } from "@/src/server/modules/master/master.service"
import { clearMasterCache } from "@/src/server/modules/master/master.cache"

export const dynamic = "force-dynamic"

async function ensureGroupExists(groupKey: string, name: string) {
  try {
    await createMasterGroup({
      key: groupKey,
      name,
      description: `Master entries for ${name}`,
    })
  } catch (e: any) {
    // If group already exists, ignore error
  }
}

export async function POST(request: NextRequest) {
  try {
    const auth = await requireAuth(request) as any
    if ("status" in auth) return auth
    if (auth.user?.role !== "super_admin" && auth.user?.role !== "admin") {
      return fail("Forbidden", 403)
    }

    const body = await request.json()
    const { type, items } = body as {
      type: "HSN_CODE" | "BARCODE_NUMBER"
      items: Array<{ code: string; name?: string }>
    }

    if (!type || !["HSN_CODE", "BARCODE_NUMBER"].includes(type)) {
      return fail("Invalid type. Expected HSN_CODE or BARCODE_NUMBER", 422)
    }

    if (!Array.isArray(items) || items.length === 0) {
      return fail("Items array is required and cannot be empty", 422)
    }

    const groupName = type === "HSN_CODE" ? "HSN Code Master" : "Barcode Master"
    await ensureGroupExists(type, groupName)

    // Fetch existing values for uniqueness verification
    const existingList = await listMasterValues(type, { activeOnly: false }).catch(() => [])
    const existingValues = new Set(existingList.map((x) => x.value.trim().toLowerCase()))

    let createdCount = 0
    let skippedCount = 0
    const errors: string[] = []
    const seenInBatch = new Set<string>()

    for (let index = 0; index < items.length; index++) {
      const item = items[index]
      const codeClean = (item.code || "").trim()
      const nameClean = (item.name || "").trim()

      if (!codeClean) {
        errors.push(`Row ${index + 1}: Code cannot be empty`)
        skippedCount++
        continue
      }

      const codeLower = codeClean.toLowerCase()

      // Check for duplicates within the current batch
      if (seenInBatch.has(codeLower)) {
        errors.push(`Row ${index + 1}: Duplicate code "${codeClean}" in CSV file`)
        skippedCount++
        continue
      }
      seenInBatch.add(codeLower)

      // Check for uniqueness against existing database entries
      if (existingValues.has(codeLower)) {
        errors.push(`Row ${index + 1}: "${codeClean}" already exists in system`)
        skippedCount++
        continue
      }

      try {
        const label = nameClean ? `${codeClean} - ${nameClean}` : codeClean
        await createMasterValue({
          groupKey: type,
          value: codeClean,
          label: label,
          sortOrder: 0,
        })
        existingValues.add(codeLower)
        createdCount++
      } catch (err: any) {
        errors.push(`Row ${index + 1}: Failed to save "${codeClean}" (${err?.message || "Error"})`)
        skippedCount++
      }
    }

    clearMasterCache()

    return ok(
      {
        createdCount,
        skippedCount,
        total: items.length,
        errors,
      },
      `Processed ${items.length} entries. ${createdCount} created, ${skippedCount} skipped.`,
      200,
    )
  } catch (error: any) {
    return fail(error?.message || "Failed to process bulk request", 500)
  }
}
