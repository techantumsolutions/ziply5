#!/usr/bin/env node

/**
 * Script to trigger Shiprocket active tracking sync.
 * Can be run via cron (e.g. 0 *\/6 * * *) or directly via CLI.
 */

const port = process.env.PORT || 3000;
const secret = process.env.INTERNAL_JOB_SECRET || "";
const baseUrl = process.env.APP_URL
  ? process.env.APP_URL.replace(/\/+$/, "")
  : `http://127.0.0.1:${port}`;
const endpoint = `${baseUrl}/api/internal/jobs/shiprocket-tracking-sync`;

async function main() {
  console.log(`[${new Date().toISOString()}] Triggering Shiprocket sync on: ${endpoint}`);
  
  if (!secret) {
    console.warn("[WARN] INTERNAL_JOB_SECRET is not set in environment!");
  }

  const res = await fetch(endpoint, {
    method: "POST",
    headers: {
      "x-internal-job-secret": secret,
      "Content-Type": "application/json",
    },
  });

  const body = await res.json().catch(() => null);

  if (!res.ok) {
    console.error(`[${new Date().toISOString()}] Sync failed (status ${res.status}):`, body);
    process.exit(1);
  }

  console.log(`[${new Date().toISOString()}] Sync success:`, JSON.stringify(body, null, 2));
}

main().catch((err) => {
  console.error(`[${new Date().toISOString()}] Unhandled error:`, err);
  process.exit(1);
});
