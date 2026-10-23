#!/usr/bin/env node

/**
 * Background worker to sync active Shiprocket tracking every 6 hours.
 * Can be managed with PM2:
 *   pm2 start scripts/shiprocket-sync-worker.mjs --name "shiprocket-sync-worker"
 */

const SIX_HOURS_MS = 6 * 60 * 60 * 1000;
const port = process.env.PORT || 3000;
const secret = process.env.INTERNAL_JOB_SECRET || "";
const baseUrl = process.env.APP_URL
  ? process.env.APP_URL.replace(/\/+$/, "")
  : `http://127.0.0.1:${port}`;
const endpoint = `${baseUrl}/api/internal/jobs/shiprocket-tracking-sync`;

console.info("[shiprocket-sync-worker] Starting Shiprocket 6-hour sync worker...");

async function runSync() {
  const timestamp = new Date().toISOString();
  console.log(`[${timestamp}] [shiprocket-sync-worker] Starting tracking sync cycle...`);

  try {
    const res = await fetch(endpoint, {
      method: "POST",
      headers: {
        "x-internal-job-secret": secret,
        "Content-Type": "application/json",
      },
    });

    const body = await res.json().catch(() => null);

    if (!res.ok) {
      console.error(`[${new Date().toISOString()}] [shiprocket-sync-worker] Sync failed (HTTP ${res.status}):`, body);
      return;
    }

    const { total = 0, synced = 0, skipped = 0, failed = 0 } = body.data ?? {};
    console.log(
      `[${new Date().toISOString()}] [shiprocket-sync-worker] Sync completed: total=${total}, synced=${synced}, skipped=${skipped}, failed=${failed}`
    );
  } catch (error) {
    console.error(`[${new Date().toISOString()}] [shiprocket-sync-worker] Unexpected error:`, error?.message || error);
  }
}

// Initial sync after 10 seconds to allow Next.js server to be fully ready
setTimeout(() => {
  void runSync();
}, 10_000);

// Recurring sync every 6 hours
setInterval(() => {
  void runSync();
}, SIX_HOURS_MS);

console.info(`[shiprocket-sync-worker] Initialized. Recurring sync interval set to 6 hours (${SIX_HOURS_MS / 1000}s).`);
