"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { authedFetch, authedPost } from "@/lib/dashboard-fetch";
import { ConsoleTable, ConsoleTd } from "@/components/dashboard/ConsoleTable";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";

type CartRow = {
  id: string;
  session_key: string;
  email: string | null;
  mobile: string | null;
  user_id: string | null;
  total: string | number | null;
  updated_at: string;
  items_json: unknown;
  abandoned_at: string | null;
  lifecycle_state: string | null;
  abandon_reason: string | null;
  steps_completed: number;
  next_reminder_at: string | null;
  next_reminder_step: number | null;
  messages_sent: number;
  last_message_at: string | null;
  converted_at: string | null;
  status: string;
};

const formatLifecycle = (row: CartRow) => {
  if (row.converted_at) return "Converted";
  const lc = String(row.lifecycle_state ?? row.status ?? "").toUpperCase();
  if (lc === "RECOVERED" || row.status === "recovered") return "Recovered";
  if (lc === "ABANDONED" || row.status === "abandoned" || row.abandoned_at) return "Abandoned";
  if (lc === "PAYMENT_PENDING") return "Payment Pending";
  if (lc === "CHECKOUT_STARTED") return "Checkout Started";
  return "Active";
};

const formatAbandonReason = (reason: string | null) => {
  if (!reason) return "—";
  return reason.replace(/_/g, " ");
};

export default function AdminAbandonedCartsPage() {
  const [rows, setRows] = useState<CartRow[]>([]);
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(true);
  const [resumeLink, setResumeLink] = useState<string | null>(null);
  const [timeline, setTimeline] = useState<null | {
    events: Array<{ id: string; event_type: string; created_at: string }>;
    messages: Array<{ id: string; channel: string; status: string; sent_at: string; sent_to: string | null }>;
    queue: Array<{ id: string; step_no: number; channel: string; status: string; scheduled_at: string; sent_at: string | null; error_message: string | null }>;
  }>(null);
  const [q, setQ] = useState("");
  const [converted, setConverted] = useState<"all" | "yes" | "no">("all");
  const [userType, setUserType] = useState<"all" | "guest" | "registered">("all");
  const [analytics, setAnalytics] = useState<{
    totalAbandoned: number;
    recoveredCount: number;
    recoveryRate: number;
    recoveredRevenue: number;
    topAbandonedProducts?: Array<{ name: string; count: number }>;
  } | null>(null);
  const [activeTab, setActiveTab] = useState<"dashboard" | "live" | "campaigns" | "templates" | "settings" | "analytics">("dashboard");

  const load = useCallback(() => {
    setLoading(true);
    setError("");
    const params = new URLSearchParams();
    if (q.trim()) params.set("q", q.trim());
    if (converted !== "all") params.set("converted", converted);
    if (userType !== "all") params.set("userType", userType);
    Promise.all([
      authedFetch<CartRow[]>(`/api/admin/abandoned-carts?${params.toString()}`),
      authedFetch<{
        totalAbandoned: number;
        recoveredCount: number;
        recoveryRate: number;
        recoveredRevenue: number;
        topAbandonedProducts?: Array<{ name: string; count: number }>;
      }>("/api/admin/abandoned-carts/analytics"),
    ])
      .then(([carts, kpi]) => {
        setRows(carts);
        setAnalytics(kpi);
      })
      .catch((e: Error) => setError(e.message))
      .finally(() => setLoading(false));
  }, [converted, q, userType]);

  useEffect(() => {
    load();
  }, [load]);

  const tabs = useMemo(
    () =>
      [
        { id: "dashboard", label: "Dashboard" },
        { id: "live", label: "Live Abandoned Carts" },
        { id: "campaigns", label: "Recovery Campaigns" },
        { id: "templates", label: "Templates" },
        { id: "settings", label: "Settings" },
        { id: "analytics", label: "Analytics" },
      ] as const,
    [],
  );

  const openTimeline = async (id: string) => {
    try {
      const data = await authedFetch<typeof timeline extends null ? never : NonNullable<typeof timeline>>(`/api/admin/abandoned-carts/${id}`);
      setTimeline(data);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Failed to load timeline");
    }
  };

  const createResumeLink = async (id: string) => {
    try {
      setError("")
      setResumeLink(null)
      const res = await authedPost<{ token: string; ttlMinutes: number }>("/api/admin/abandoned-carts/resume-link", { cartId: id })
      const base = typeof window !== "undefined" ? window.location.origin : ""
      setResumeLink(`${base}/cart/recover/${encodeURIComponent(res.token)}`)
    } catch (e) {
      setError(e instanceof Error ? e.message : "Failed to create resume link")
    }
  }

  const sendNow = async (id: string, channels: Array<"email" | "sms" | "whatsapp"> = ["email", "sms", "whatsapp"]) => {
    try {
      await authedPost("/api/admin/abandoned-carts/send-now", { cartId: id, channels });
      await load();
    } catch (e) {
      setError(e instanceof Error ? e.message : "Failed to queue recovery");
    }
  };

  const runAction = async (cartId: string, action: "disable_recovery" | "mark_ignore") => {
    try {
      await authedPost("/api/admin/abandoned-carts/actions", { cartId, action });
      await load();
    } catch (e) {
      setError(e instanceof Error ? e.message : "Failed to run action");
    }
  };

  const triggerDetection = async () => {
    try {
      await authedPost("/api/admin/abandoned-carts", { action: "detect_now" });
      await load();
    } catch (e) {
      setError(e instanceof Error ? e.message : "Failed to run detection");
    }
  };

  return (
    <section className="w-full space-y-4">
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <h1 className="font-melon text-2xl font-bold text-[#4A1D1F]">Abandoned carts</h1>
          <p className="text-sm text-[#646464]">Abandonment detection, recovery actions, and conversion tracking.</p>
        </div>
        <div className="flex flex-wrap gap-2">
          <Link href="/admin/abandoned-carts/settings" className="rounded-full border border-[#E8DCC8] bg-white px-4 py-2 text-xs font-semibold uppercase tracking-wide text-[#4A1D1F] hover:bg-[#FFFBF3]">
            Recovery Settings
          </Link>
          <Link href="/admin/abandoned-carts/templates" className="rounded-full border border-[#E8DCC8] bg-white px-4 py-2 text-xs font-semibold uppercase tracking-wide text-[#4A1D1F] hover:bg-[#FFFBF3]">
            Templates
          </Link>
          <button type="button" onClick={() => void triggerDetection()} className="rounded-full border border-[#E8DCC8] bg-white px-4 py-2 text-xs font-semibold uppercase tracking-wide text-[#4A1D1F] hover:bg-[#FFFBF3]">
            Detect Now
          </button>
          <button type="button" onClick={() => load()} className="rounded-full border border-[#E8DCC8] bg-white px-4 py-2 text-xs font-semibold uppercase tracking-wide text-[#4A1D1F] hover:bg-[#FFFBF3]">
            Refresh
          </button>
        </div>
      </div>

      <div className="flex flex-wrap gap-2 rounded-2xl border border-[#E8DCC8] bg-white p-2">
        {tabs.map((t) => (
          <button
            key={t.id}
            type="button"
            onClick={() => setActiveTab(t.id)}
            className={
              activeTab === t.id
                ? "rounded-full bg-[#7B3010] px-4 py-2 text-xs font-semibold uppercase tracking-wide text-white"
                : "rounded-full border border-[#E8DCC8] bg-white px-4 py-2 text-xs font-semibold uppercase tracking-wide text-[#4A1D1F] hover:bg-[#FFFBF3]"
            }
          >
            {t.label}
          </button>
        ))}
      </div>

      {error && <p className="rounded-lg bg-red-50 px-3 py-2 text-sm text-red-800">{error}</p>}
      {resumeLink ? (
        <div className="rounded-xl border border-[#E8DCC8] bg-white p-3 text-sm">
          <p className="text-[#7A7A7A]">Resume link (expiring)</p>
          <div className="mt-1 flex flex-wrap items-center gap-2">
            <code className="break-all rounded bg-[#FFFBF3] px-2 py-1 text-xs">{resumeLink}</code>
            <button
              type="button"
              className="rounded border px-2 py-1 text-[10px]"
              onClick={() => void navigator.clipboard?.writeText(resumeLink)}
            >
              Copy
            </button>
          </div>
        </div>
      ) : null}
      {loading && <p className="text-sm text-[#646464]">Loading…</p>}

      {!loading && activeTab === "dashboard" && analytics ? (
        <div className="grid gap-2 md:grid-cols-4">
          <div className="rounded-xl border border-[#E8DCC8] bg-white p-3 text-sm"><p className="text-[#7A7A7A]">Total Abandoned</p><p className="font-semibold text-[#4A1D1F]">{analytics.totalAbandoned}</p></div>
          <div className="rounded-xl border border-[#E8DCC8] bg-white p-3 text-sm"><p className="text-[#7A7A7A]">Recovered</p><p className="font-semibold text-[#4A1D1F]">{analytics.recoveredCount}</p></div>
          <div className="rounded-xl border border-[#E8DCC8] bg-white p-3 text-sm"><p className="text-[#7A7A7A]">Recovery Rate</p><p className="font-semibold text-[#4A1D1F]">{analytics.recoveryRate.toFixed(1)}%</p></div>
          <div className="rounded-xl border border-[#E8DCC8] bg-white p-3 text-sm"><p className="text-[#7A7A7A]">Recovered Revenue</p><p className="font-semibold text-[#4A1D1F]">Rs.{analytics.recoveredRevenue.toFixed(2)}</p></div>
        </div>
      ) : null}

      {!loading && activeTab === "live" ? (
        <>
          <div className="grid gap-2 rounded-xl border border-[#E8DCC8] bg-white p-3 md:grid-cols-4">
            <input value={q} onChange={(e) => setQ(e.target.value)} placeholder="Search session/email/mobile" className="rounded border px-3 py-2 text-sm" />
            <Select
              value={converted}
              onValueChange={(value) =>
                setConverted(value as "all" | "yes" | "no")
              }
            >
              <SelectTrigger className=" rounded border px-3 py-2 text-sm">
                <SelectValue placeholder="All conversions" />
              </SelectTrigger>

              <SelectContent>
                <SelectItem value="all">All conversions</SelectItem>
                <SelectItem value="yes">Converted</SelectItem>
                <SelectItem value="no">Unconverted</SelectItem>
              </SelectContent>
            </Select>

            <Select
              value={userType}
              onValueChange={(value) =>
                setUserType(value as "all" | "guest" | "registered")
              }
            >
              <SelectTrigger className="rounded border px-3 py-2 text-sm">
                <SelectValue placeholder="All users" />
              </SelectTrigger>

              <SelectContent>
                <SelectItem value="all">All users</SelectItem>
                <SelectItem value="guest">Guest</SelectItem>
                <SelectItem value="registered">Registered</SelectItem>
              </SelectContent>
            </Select>
            <button type="button" onClick={() => load()} className="rounded bg-[#7B3010] px-3 py-2 text-xs font-semibold uppercase tracking-wide text-white">Apply Filters</button>
          </div>
          <ConsoleTable headers={["Cart ID", "Customer", "State", "Reason", "Step", "Items", "Value", "Last Active", "Recovery", "Actions"]}>
            {rows.length === 0 ? (
              <tr>
                <ConsoleTd className="py-8 text-center text-[#646464]" colSpan={10}>
                  No abandoned carts recorded.
                </ConsoleTd>
              </tr>
            ) : (
              rows.map((r) => (
                <tr key={r.id} className="hover:bg-[#FFFBF3]/80">
                  <ConsoleTd className="font-mono text-[11px]">{r.session_key.slice(0, 16)}…</ConsoleTd>
                  <ConsoleTd className="text-xs">
                    <div>{r.email ?? "No email"}</div>
                    <div className="text-[11px] text-[#646464]">{r.mobile ?? "No mobile"}</div>
                  </ConsoleTd>
                  <ConsoleTd className="text-xs font-medium">{formatLifecycle(r)}</ConsoleTd>
                  <ConsoleTd className="text-xs capitalize">{formatAbandonReason(r.abandon_reason)}</ConsoleTd>
                  <ConsoleTd className="text-xs">
                    <div>Done: {r.steps_completed ?? 0}/4</div>
                    <div className="text-[11px] text-[#646464]">
                      Next: {r.next_reminder_step != null ? `step ${r.next_reminder_step}` : "—"}
                      {r.next_reminder_at ? ` @ ${new Date(r.next_reminder_at).toLocaleString()}` : ""}
                    </div>
                  </ConsoleTd>
                  <ConsoleTd className="text-xs">{Array.isArray(r.items_json) ? r.items_json.length : 0}</ConsoleTd>
                  <ConsoleTd>{r.total != null ? `Rs.${Number(r.total).toFixed(2)}` : "—"}</ConsoleTd>
                  <ConsoleTd className="text-xs">{new Date(r.updated_at).toLocaleString()}</ConsoleTd>
                  <ConsoleTd className="text-xs">
                    <div>{r.converted_at ? "Converted" : r.abandoned_at ? "Abandoned" : "In funnel"}</div>
                    <div className="text-[11px] text-[#646464]">Last msg: {r.last_message_at ? new Date(r.last_message_at).toLocaleString() : "—"}</div>
                  </ConsoleTd>
                  <ConsoleTd className="text-xs">
                    <div className="flex flex-wrap gap-1">
                      <button type="button" className="rounded border px-2 py-1 text-[10px]" onClick={() => void sendNow(r.id)}>
                        Send Recovery Now
                      </button>
                      <button type="button" className="rounded border px-2 py-1 text-[10px]" onClick={() => void openTimeline(r.id)}>
                        View Timeline
                      </button>
                      <button type="button" className="rounded border px-2 py-1 text-[10px]" onClick={() => void createResumeLink(r.id)}>
                        Resume Link
                      </button>
                      <button type="button" className="rounded border px-2 py-1 text-[10px]" onClick={() => void runAction(r.id, "disable_recovery")}>
                        Disable Recovery
                      </button>
                      <button type="button" className="rounded border px-2 py-1 text-[10px]" onClick={() => void runAction(r.id, "mark_ignore")}>
                        Mark Ignore
                      </button>
                      <a className="rounded border px-2 py-1 text-[10px]" href={`/cart/recover/${encodeURIComponent(r.session_key)}`} target="_blank" rel="noreferrer">
                        View Cart
                      </a>
                    </div>
                  </ConsoleTd>
                </tr>
              ))
            )}
          </ConsoleTable>
        </>
      ) : null}

      {!loading && activeTab === "campaigns" ? (
        <div className="rounded-2xl border border-[#E8DCC8] bg-white p-4">
          <p className="font-semibold text-[#4A1D1F]">Recovery Campaigns</p>
          <p className="mt-1 text-sm text-[#646464]">Automation builder (stage targeting + timing + channels + coupons) lands here next.</p>
        </div>
      ) : null}

      {!loading && activeTab === "templates" ? (
        <div className="rounded-2xl border border-[#E8DCC8] bg-white p-4">
          <p className="font-semibold text-[#4A1D1F]">Templates</p>
          <p className="mt-1 text-sm text-[#646464]">Professional grouped templates with preview and test send.</p>
          <div className="mt-3">
            <Link href="/admin/abandoned-carts/templates" className="rounded-full bg-[#7B3010] px-4 py-2 text-xs font-semibold uppercase tracking-wide text-white">
              Open Templates
            </Link>
          </div>
        </div>
      ) : null}

      {!loading && activeTab === "settings" ? (
        <div className="rounded-2xl border border-[#E8DCC8] bg-white p-4">
          <p className="font-semibold text-[#4A1D1F]">Settings</p>
          <p className="mt-1 text-sm text-[#646464]">Thresholds, retry schedule, token expiry, max reminders, channel toggles.</p>
          <div className="mt-3">
            <Link href="/admin/abandoned-carts/settings" className="rounded-full bg-[#7B3010] px-4 py-2 text-xs font-semibold uppercase tracking-wide text-white">
              Open Settings
            </Link>
          </div>
        </div>
      ) : null}

      {!loading && activeTab === "analytics" && analytics ? (
        <div className="rounded-2xl border border-[#E8DCC8] bg-white p-4">
          <p className="font-semibold text-[#4A1D1F]">Analytics</p>
          <p className="mt-1 text-sm text-[#646464]">Top abandoned products (quick view).</p>
          <div className="mt-3 space-y-2">
            {(analytics.topAbandonedProducts ?? []).length ? (
              (analytics.topAbandonedProducts ?? []).map((p) => (
                <div key={p.name} className="flex items-center justify-between gap-3 rounded-lg border bg-[#FFFBF3]/40 px-3 py-2 text-sm">
                  <span className="truncate text-[#4A1D1F]">{p.name}</span>
                  <span className="shrink-0 rounded bg-white px-2 py-0.5 text-xs font-semibold text-[#4A1D1F]">{p.count}</span>
                </div>
              ))
            ) : (
              <div className="text-sm text-[#646464]">No analytics yet.</div>
            )}
          </div>
        </div>
      ) : null}
      {timeline ? (
        <div className="rounded-xl border border-[#E8DCC8] bg-white p-4">
          <div className="mb-2 flex items-center justify-between">
            <h2 className="font-semibold text-[#4A1D1F]">Timeline</h2>
            <button type="button" className="rounded border px-3 py-1 text-xs" onClick={() => setTimeline(null)}>
              Close
            </button>
          </div>
          <div className="grid gap-4 md:grid-cols-3">
            <div>
              <h3 className="text-xs font-semibold uppercase text-[#7A7A7A]">Events</h3>
              <div className="space-y-1 text-xs">
                {timeline.events.map((e) => (
                  <div key={e.id} className="rounded border px-2 py-1">
                    <div>{e.event_type}</div>
                    <div className="text-[11px] text-[#646464]">{new Date(e.created_at).toLocaleString()}</div>
                  </div>
                ))}
              </div>
            </div>
            <div>
              <h3 className="text-xs font-semibold uppercase text-[#7A7A7A]">Queue</h3>
              <div className="space-y-1 text-xs">
                {timeline.queue.map((e) => (
                  <div key={e.id} className="rounded border px-2 py-1">
                    <div>Step {e.step_no} · {e.channel}</div>
                    <div>{e.status}</div>
                    <div className="text-[11px] text-[#646464]">{new Date(e.scheduled_at).toLocaleString()}</div>
                  </div>
                ))}
              </div>
            </div>
            <div>
              <h3 className="text-xs font-semibold uppercase text-[#7A7A7A]">Messages</h3>
              <div className="space-y-1 text-xs">
                {timeline.messages.map((e) => (
                  <div key={e.id} className="rounded border px-2 py-1">
                    <div>{e.channel} · {e.status}</div>
                    <div>{e.sent_to ?? "—"}</div>
                    <div className="text-[11px] text-[#646464]">{new Date(e.sent_at).toLocaleString()}</div>
                  </div>
                ))}
              </div>
            </div>
          </div>
        </div>
      ) : null}
    </section>
  );
}
