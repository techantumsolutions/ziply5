import { pgQuery, pgTx } from "@/src/server/db/pg"
import { enqueueEmail } from "@/src/server/modules/notifications/email.service"
import { smsService } from "@/src/server/modules/sms/sms.service"
import crypto from "crypto"
import { safeString } from "@/src/lib/db/supabaseIntegrity"
import { renderPlaceholders } from "@/src/server/modules/abandoned-carts/templateRender"

export type CartEventType =
  // Legacy event names (already used in the app)
  | "add_to_cart"
  | "remove_item"
  | "quantity_update"
  | "checkout_started"
  | "address_entered"
  | "payment_initiated"
  | "payment_failed"
  | "payment_success"
  | "order_placed"
  | "manual_clear"
  | "page_view"
  // Spec event names (supported for forward-compat)
  | "cart_item_added"
  | "cart_updated"
  | "payment_page_opened"
  | "payment_attempted"
  | "payment_cancelled"
  | "payment_timeout"
  | "tab_closed"
  | "session_expired"
  | "order_completed"

type RecoveryChannel = "email" | "sms" | "whatsapp"
type RecoveryStatus = "pending" | "sent" | "failed" | "cancelled" | "skipped"

/** Canonical lifecycle states (stored in lifecycle_state). */
export type CartLifecycleState =
  | "CART_ACTIVE"
  | "CHECKOUT_STARTED"
  | "PAYMENT_PENDING"
  | "ABANDONED"
  | "RECOVERED"
  | "CONVERTED"

export type AbandonReason =
  | "inactivity"
  | "checkout_abandoned"
  | "payment_failed"
  | "payment_cancelled"
  | "payment_timeout"

type RecoveryScheduleStep = {
  stepNo: number
  /** Minutes after abandoned_at when this step becomes due. */
  delayMinutes: number
  channels: RecoveryChannel[]
  template?: string
  includeCoupon?: boolean
  active?: boolean
}

const PRODUCTION_ABANDON_MINUTES = 5

const DEFAULT_SETTINGS = {
  enabled: true,
  scheduleVersion: 3,
  abandonThresholdMinutes: PRODUCTION_ABANDON_MINUTES,
  cartOnlyThresholdMinutes: PRODUCTION_ABANDON_MINUTES,
  checkoutStartedThresholdMinutes: PRODUCTION_ABANDON_MINUTES,
  paymentPendingThresholdMinutes: PRODUCTION_ABANDON_MINUTES,
  maxRemindersPerCart: 4,
  stopAfterPurchase: true,
  respectOptOut: true,
  emailEnabled: true,
  smsEnabled: true,
  whatsappEnabled: true,
  attributionModel: "last_click",
  tokenExpiryMinutes: 1440,
  schedule: [
    { stepNo: 1, delayMinutes: 0, channels: ["email", "sms"], template: "abandon_r1", includeCoupon: false, active: true },
    { stepNo: 2, delayMinutes: 60, channels: ["email", "sms"], template: "abandon_r2", includeCoupon: false, active: true },
    { stepNo: 3, delayMinutes: 360, channels: ["email", "sms"], template: "abandon_r3_coupon", includeCoupon: true, active: true },
    { stepNo: 4, delayMinutes: 1440, channels: ["email", "sms"], template: "abandon_r4_final", includeCoupon: false, active: true },
  ] satisfies RecoveryScheduleStep[],
} as const

const sha256 = (value: string) => crypto.createHash("sha256").update(value).digest("hex")

const mergeMeta = (existing: unknown, patch: Record<string, unknown>) => {
  const base = existing && typeof existing === "object" && !Array.isArray(existing) ? (existing as Record<string, unknown>) : {}
  return { ...base, ...patch }
}

const eventToLifecycleState = (eventType: CartEventType): CartLifecycleState => {
  if (eventType === "checkout_started" || eventType === "address_entered") return "CHECKOUT_STARTED"
  if (
    eventType === "payment_initiated" ||
    eventType === "payment_page_opened" ||
    eventType === "payment_attempted"
  ) {
    return "PAYMENT_PENDING"
  }
  if (eventType === "payment_failed" || eventType === "payment_cancelled" || eventType === "payment_timeout") {
    return "ABANDONED"
  }
  if (eventType === "payment_success" || eventType === "order_placed" || eventType === "order_completed") {
    return "CONVERTED"
  }
  return "CART_ACTIVE"
}

const mapLegacyLifecycle = (value: string | null | undefined): CartLifecycleState => {
  const v = String(value ?? "").toUpperCase()
  if (v === "CART_ONLY" || v === "ACTIVE") return "CART_ACTIVE"
  if (v === "CHECKOUT_STARTED" || v === "CONTACT_CAPTURED") return "CHECKOUT_STARTED"
  if (v === "PAYMENT_PENDING" || v === "PAYMENT_FAILED") return "PAYMENT_PENDING"
  if (v === "ABANDONED") return "ABANDONED"
  if (v === "RECOVERED") return "RECOVERED"
  if (v === "CONVERTED" || v === "ORDER_COMPLETED") return "CONVERTED"
  return "CART_ACTIVE"
}

const eventToAbandonReason = (eventType: CartEventType): AbandonReason | null => {
  if (eventType === "payment_failed") return "payment_failed"
  if (eventType === "payment_cancelled") return "payment_cancelled"
  if (eventType === "payment_timeout") return "payment_timeout"
  return null
}

const inactivityAbandonReason = (lifecycle: CartLifecycleState): AbandonReason =>
  lifecycle === "CHECKOUT_STARTED" ? "checkout_abandoned" : "inactivity"

const normalizeEventType = (eventType: CartEventType): CartEventType => {
  if (eventType === "add_to_cart") return "cart_item_added"
  if (eventType === "remove_item" || eventType === "quantity_update") return "cart_updated"
  if (eventType === "payment_initiated") return "payment_attempted"
  if (eventType === "payment_success") return "order_completed"
  if (eventType === "order_placed") return "order_completed"
  return eventType
}

export const ensureRecoveryTables = async () => {
  await pgQuery(`
    ALTER TABLE "AbandonedCart"
      ADD COLUMN IF NOT EXISTS user_id text NULL,
      ADD COLUMN IF NOT EXISTS guest_id text NULL,
      ADD COLUMN IF NOT EXISTS mobile text NULL,
      ADD COLUMN IF NOT EXISTS status text NOT NULL DEFAULT 'active',
      ADD COLUMN IF NOT EXISTS lifecycle_state text NOT NULL DEFAULT 'CART_ONLY',
      ADD COLUMN IF NOT EXISTS checkout_stage text NULL,
      ADD COLUMN IF NOT EXISTS payment_status text NULL,
      ADD COLUMN IF NOT EXISTS coupon_code text NULL,
      ADD COLUMN IF NOT EXISTS last_visited_page text NULL,
      ADD COLUMN IF NOT EXISTS customer_name text NULL,
      ADD COLUMN IF NOT EXISTS address_json jsonb NOT NULL DEFAULT '{}'::jsonb,
      ADD COLUMN IF NOT EXISTS last_active_at timestamptz NULL,
      ADD COLUMN IF NOT EXISTS abandoned_at timestamptz NULL,
      ADD COLUMN IF NOT EXISTS converted_at timestamptz NULL,
      ADD COLUMN IF NOT EXISTS converted_order_id text NULL,
      ADD COLUMN IF NOT EXISTS recovered_channel text NULL,
      ADD COLUMN IF NOT EXISTS recovery_disabled boolean NOT NULL DEFAULT false,
      ADD COLUMN IF NOT EXISTS ignored boolean NOT NULL DEFAULT false,
      ADD COLUMN IF NOT EXISTS last_message_at timestamptz NULL,
      ADD COLUMN IF NOT EXISTS messages_sent int NOT NULL DEFAULT 0,
      ADD COLUMN IF NOT EXISTS steps_completed int NOT NULL DEFAULT 0,
      ADD COLUMN IF NOT EXISTS abandon_reason text NULL,
      ADD COLUMN IF NOT EXISTS metadata jsonb NOT NULL DEFAULT '{}'::jsonb
  `)
  await pgQuery(`
    CREATE TABLE IF NOT EXISTS abandoned_cart_events_v2 (
      id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
      cart_id text NOT NULL,
      event_type text NOT NULL,
      meta jsonb NOT NULL DEFAULT '{}'::jsonb,
      created_at timestamptz NOT NULL DEFAULT now()
    )
  `)
  await pgQuery(`
    CREATE TABLE IF NOT EXISTS abandoned_cart_recovery_queue_v2 (
      id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
      cart_id text NOT NULL,
      step_no int NOT NULL,
      channel text NOT NULL,
      scheduled_at timestamptz NOT NULL,
      sent_at timestamptz NULL,
      status text NOT NULL DEFAULT 'pending',
      error_message text NULL,
      payload jsonb NOT NULL DEFAULT '{}'::jsonb,
      UNIQUE(cart_id, step_no, channel)
    )
  `)
  await pgQuery(`
    CREATE TABLE IF NOT EXISTS abandoned_cart_messages_v2 (
      id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
      cart_id text NOT NULL,
      queue_id uuid NULL,
      channel text NOT NULL,
      template_used text NULL,
      provider_response text NULL,
      sent_to text NULL,
      status text NOT NULL DEFAULT 'sent',
      sent_at timestamptz NOT NULL DEFAULT now()
    )
  `)
  await pgQuery(`
    CREATE TABLE IF NOT EXISTS abandoned_cart_settings_v2 (
      id text PRIMARY KEY,
      value_json jsonb NOT NULL,
      updated_at timestamptz NOT NULL DEFAULT now()
    )
  `)
  await pgQuery(`
    CREATE TABLE IF NOT EXISTS abandoned_cart_templates_v2 (
      id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
      template_key text NOT NULL,
      channel text NOT NULL,
      subject text NULL,
      body text NOT NULL,
      active boolean NOT NULL DEFAULT true,
      updated_at timestamptz NOT NULL DEFAULT now(),
      UNIQUE(template_key, channel)
    )
  `)
  await pgQuery(`
    CREATE TABLE IF NOT EXISTS abandoned_cart_resume_tokens_v2 (
      id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
      cart_id text NOT NULL,
      token_hash text NOT NULL UNIQUE,
      expires_at timestamptz NOT NULL,
      created_at timestamptz NOT NULL DEFAULT now(),
      last_used_at timestamptz NULL,
      meta jsonb NOT NULL DEFAULT '{}'::jsonb
    )
  `)
  await pgQuery(`
    CREATE TABLE IF NOT EXISTS abandoned_cart_analytics_daily_v2 (
      date_key date PRIMARY KEY,
      total_abandoned int NOT NULL DEFAULT 0,
      recovered_count int NOT NULL DEFAULT 0,
      recovered_revenue numeric(12,2) NOT NULL DEFAULT 0,
      by_channel jsonb NOT NULL DEFAULT '{}'::jsonb,
      created_at timestamptz NOT NULL DEFAULT now(),
      updated_at timestamptz NOT NULL DEFAULT now()
    )
  `)
}

const getSettings = async () => {
  await ensureRecoveryTables()
  const rows = await pgQuery<Array<{ value_json: any }>>(
    `SELECT value_json FROM abandoned_cart_settings_v2 WHERE id = 'default' LIMIT 1`,
  )
  const raw = (rows[0]?.value_json as Record<string, unknown> | undefined) ?? {}
  const savedVersion = Number(raw.scheduleVersion ?? 0)
  const schedule =
    savedVersion >= DEFAULT_SETTINGS.scheduleVersion && Array.isArray(raw.schedule) && raw.schedule.length
      ? (raw.schedule as RecoveryScheduleStep[])
      : ([...DEFAULT_SETTINGS.schedule] as RecoveryScheduleStep[])
  return {
    ...DEFAULT_SETTINGS,
    ...raw,
    schedule,
    scheduleVersion: Math.max(savedVersion, DEFAULT_SETTINGS.scheduleVersion),
    cartOnlyThresholdMinutes: Math.max(
      1,
      Number(raw.cartOnlyThresholdMinutes ?? raw.abandonThresholdMinutes ?? PRODUCTION_ABANDON_MINUTES),
    ),
    checkoutStartedThresholdMinutes: Math.max(
      1,
      Number(raw.checkoutStartedThresholdMinutes ?? PRODUCTION_ABANDON_MINUTES),
    ),
    paymentPendingThresholdMinutes: Math.max(
      1,
      Number(raw.paymentPendingThresholdMinutes ?? PRODUCTION_ABANDON_MINUTES),
    ),
    abandonThresholdMinutes: Math.max(1, Number(raw.abandonThresholdMinutes ?? PRODUCTION_ABANDON_MINUTES)),
  }
}

const resolveRecoverySchedule = (settings: Awaited<ReturnType<typeof getSettings>>): RecoveryScheduleStep[] =>
  (Array.isArray(settings.schedule) ? settings.schedule : DEFAULT_SETTINGS.schedule) as RecoveryScheduleStep[]

export const normalizeRecoveryCartItems = (itemsJson: unknown): Array<Record<string, unknown>> => {
  if (!Array.isArray(itemsJson)) return []
  return itemsJson.map((raw) => {
    const item = raw && typeof raw === "object" ? (raw as Record<string, unknown>) : {}
    const productId = safeString(item.productId ?? item.product_id ?? item.id ?? item.slug)
    const slug = safeString(item.slug ?? productId)
    return {
      ...item,
      productId: productId || slug,
      slug,
      name: safeString(item.name) || "Product",
      quantity: Math.max(1, Number(item.quantity ?? 1)),
      price: Number(item.price ?? item.unitPrice ?? 0),
      image: safeString(item.image ?? item.thumbnail) || null,
      variantId: item.variantId ?? item.variant_id ?? null,
    }
  })
}

const hasRecoverableContact = (email: string | null | undefined, mobile: string | null | undefined) =>
  Boolean(String(email ?? "").trim() || String(mobile ?? "").replace(/\D/g, "").length >= 10)

/** Logged-in: User.email + UserProfile.phone. Guest: cart-stored contact only. */
export const resolveCartContact = async (cartId: string) => {
  const rows = await pgQuery<
    Array<{
      user_id: string | null
      cart_email: string | null
      cart_mobile: string | null
      user_email: string | null
      profile_phone: string | null
      customer_name: string | null
    }>
  >(
    `
      SELECT
        c.user_id,
        c.email AS cart_email,
        c.mobile AS cart_mobile,
        u.email AS user_email,
        p.phone AS profile_phone,
        COALESCE(c.customer_name, u.name) AS customer_name
      FROM "AbandonedCart" c
      LEFT JOIN "User" u ON u.id = c.user_id
      LEFT JOIN "UserProfile" p ON p."userId" = c.user_id
      WHERE c.id = $1
      LIMIT 1
    `,
    [cartId],
  )
  const row = rows[0]
  if (!row) return { email: null as string | null, mobile: null as string | null, name: "there" as string }
  const email = row.user_id ? row.user_email : row.cart_email
  const mobile = row.user_id ? row.profile_phone : row.cart_mobile
  return {
    email: email?.trim() || null,
    mobile: mobile?.trim() || null,
    name: safeString(row.customer_name) || "there",
  }
}

const fetchProfileContactByUserId = async (userId: string) => {
  const rows = await pgQuery<
    Array<{ email: string | null; phone: string | null; name: string | null }>
  >(
    `
      SELECT u.email, p.phone, u.name
      FROM "User" u
      LEFT JOIN "UserProfile" p ON p."userId" = u.id
      WHERE u.id = $1
      LIMIT 1
    `,
    [userId],
  )
  const row = rows[0]
  return {
    email: row?.email?.trim() || null,
    mobile: row?.phone?.trim() || null,
    name: safeString(row?.name) || null,
  }
}

/** Only persist carts that can receive email or SMS (profile for logged-in, cart fields for guest). */
const resolveTrackContact = async (input: {
  userId?: string | null
  email?: string | null
  mobile?: string | null
}) => {
  if (input.userId) {
    return fetchProfileContactByUserId(input.userId)
  }
  return {
    email: input.email?.trim() || null,
    mobile: input.mobile?.trim() || null,
    name: null as string | null,
  }
}

const syncProfileContactToCart = async (cartId: string, userId: string | null) => {
  if (!userId) return
  await pgQuery(
    `
      UPDATE "AbandonedCart" c
      SET
        email = COALESCE(u.email, c.email),
        mobile = COALESCE(p.phone, c.mobile),
        customer_name = COALESCE(c.customer_name, u.name)
      FROM "User" u
      LEFT JOIN "UserProfile" p ON p."userId" = u.id
      WHERE c.id = $1 AND u.id = $2 AND c.user_id = $2
    `,
    [cartId, userId],
  )
}

const queueRecoverySteps = async (cartId: string, abandonedAt: Date, schedule: RecoveryScheduleStep[]) => {
  let queued = 0
  const anchorMs = abandonedAt.getTime()
  for (const step of schedule.filter((entry) => entry.active !== false)) {
    const scheduledAt = new Date(anchorMs + Math.max(0, Number(step.delayMinutes ?? 0)) * 60_000)
    for (const channel of step.channels) {
      const inserted = await pgQuery<{ id: string }>(
        `
          INSERT INTO abandoned_cart_recovery_queue_v2 (cart_id, step_no, channel, scheduled_at, payload, status)
          VALUES ($1, $2, $3, $4::timestamptz, $5::jsonb, 'pending')
          ON CONFLICT (cart_id, step_no, channel)
          DO UPDATE SET
            scheduled_at = EXCLUDED.scheduled_at,
            payload = EXCLUDED.payload,
            error_message = NULL
          WHERE abandoned_cart_recovery_queue_v2.status IN ('pending', 'failed')
          RETURNING id
        `,
        [
          cartId,
          step.stepNo,
          channel,
          scheduledAt.toISOString(),
          JSON.stringify({
            template: step.template ?? `abandoned_step_${step.stepNo}`,
            includeCoupon: Boolean(step.includeCoupon),
          }),
        ],
      )
      if (inserted.length) queued += 1
    }
  }
  return queued
}

const markCartAbandoned = async (input: {
  cartId: string
  reason: AbandonReason
  lifecycleBefore?: CartLifecycleState
  schedule?: RecoveryScheduleStep[]
}) => {
  const settings = await getSettings()
  if (!settings.enabled) return { marked: false, queued: 0 }
  const schedule = input.schedule ?? resolveRecoverySchedule(settings)
  const abandonedAt = new Date()
  await pgQuery(
    `
      UPDATE "AbandonedCart"
      SET
        status = 'abandoned',
        lifecycle_state = 'ABANDONED',
        abandoned_at = COALESCE(abandoned_at, now()),
        abandon_reason = COALESCE($2, abandon_reason),
        metadata = metadata || jsonb_build_object('abandoned_reason', $2::text, 'abandoned_lifecycle', $3::text)
      WHERE id = $1
        AND status NOT IN ('converted', 'recovered')
        AND converted_at IS NULL
    `,
    [input.cartId, input.reason, input.lifecycleBefore ?? "CART_ACTIVE"],
  )
  const queued = await queueRecoverySteps(input.cartId, abandonedAt, schedule)
  return { marked: true, queued }
}

const isReminderStepComplete = async (cartId: string, stepNo: number) => {
  const rows = await pgQuery<Array<{ total: string; done: string }>>(
    `
      SELECT
        COUNT(*)::text AS total,
        COUNT(*) FILTER (WHERE status IN ('sent', 'skipped'))::text AS done
      FROM abandoned_cart_recovery_queue_v2
      WHERE cart_id = $1 AND step_no = $2
    `,
    [cartId, stepNo],
  )
  const total = Number(rows[0]?.total ?? 0)
  const done = Number(rows[0]?.done ?? 0)
  return total > 0 && done >= total
}

const maybeAdvanceStepCompletion = async (cartId: string, stepNo: number) => {
  if (!(await isReminderStepComplete(cartId, stepNo))) return
  await pgQuery(
    `UPDATE "AbandonedCart" SET steps_completed = GREATEST(steps_completed, $2) WHERE id = $1`,
    [cartId, stepNo],
  )
}

const priorReminderStepPending = async (cartId: string, stepNo: number) => {
  if (stepNo <= 1) return false
  const rows = await pgQuery<Array<{ count: string }>>(
    `
      SELECT COUNT(*)::text AS count
      FROM abandoned_cart_recovery_queue_v2
      WHERE cart_id = $1
        AND step_no < $2
        AND status IN ('pending', 'failed')
    `,
    [cartId, stepNo],
  )
  return Number(rows[0]?.count ?? 0) > 0
}

export const saveRecoverySettings = async (input: Record<string, unknown>) => {
  await ensureRecoveryTables()
  const current = await getSettings()
  const merged = { ...current, ...input }
  await pgQuery(
    `INSERT INTO abandoned_cart_settings_v2 (id, value_json, updated_at)
     VALUES ('default', $1::jsonb, now())
     ON CONFLICT (id)
     DO UPDATE SET value_json = EXCLUDED.value_json, updated_at = now()`,
    [JSON.stringify(merged)],
  )
  return merged
}

export const getRecoverySettings = getSettings

const getTemplate = async (templateKey: string, channel: RecoveryChannel) => {
  await ensureRecoveryTables()
  const rows = await pgQuery<Array<{ subject: string | null; body: string }>>(
    `SELECT subject, body
     FROM abandoned_cart_templates_v2
     WHERE template_key = $1 AND channel = $2 AND active = true
     LIMIT 1`,
    [templateKey, channel],
  )
  return rows[0] ?? null
}

export const listRecoveryTemplates = async () => {
  await ensureRecoveryTables()
  const rows = await pgQuery<
    Array<{ template_key: string; channel: string; subject: string | null; body: string; active: boolean; updated_at: Date }>
  >(
    `SELECT template_key, channel, subject, body, active, updated_at
     FROM abandoned_cart_templates_v2
     ORDER BY template_key ASC, channel ASC`,
  )
  return rows
}

export const saveRecoveryTemplate = async (input: {
  templateKey: string
  channel: RecoveryChannel
  subject?: string | null
  body: string
  active?: boolean
}) => {
  await ensureRecoveryTables()
  await pgQuery(
    `INSERT INTO abandoned_cart_templates_v2 (template_key, channel, subject, body, active, updated_at)
     VALUES ($1, $2, $3, $4, $5, now())
     ON CONFLICT (template_key, channel)
     DO UPDATE SET subject = EXCLUDED.subject, body = EXCLUDED.body, active = EXCLUDED.active, updated_at = now()`,
    [input.templateKey, input.channel, input.subject ?? null, input.body, input.active ?? true],
  )
  return { saved: true }
}

const buildResumeToken = async (cartId: string, ttlMinutes: number, meta: Record<string, unknown>) => {
  await ensureRecoveryTables()
  const token = crypto.randomBytes(8).toString("base64url")
  const tokenHash = sha256(token)
  await pgQuery(
    `INSERT INTO abandoned_cart_resume_tokens_v2 (cart_id, token_hash, expires_at, meta)
     VALUES ($1, $2, now() + ($3 * interval '1 minute'), $4::jsonb)`,
    [cartId, tokenHash, Math.max(1, ttlMinutes), JSON.stringify(meta ?? {})],
  )
  return token
}

export const trackCartEvent = async (input: {
  sessionKey: string
  userId?: string | null
  guestId?: string | null
  /** Ignored for logged-in users — profile is the source of truth. */
  email?: string | null
  mobile?: string | null
  itemsJson?: unknown
  total?: number | null
  eventType: CartEventType
  meta?: Record<string, unknown>
}) => {
  await ensureRecoveryTables()
  const eventType = normalizeEventType(input.eventType)

  // Logout / tab close / session expiry: log only — never cancel reminders or reset abandon state.
  if (eventType === "tab_closed" || eventType === "session_expired") {
    const existing = await pgQuery<Array<{ id: string; sessionKey: string }>>(
      `SELECT id, "sessionKey" FROM "AbandonedCart" WHERE "sessionKey" = $1 LIMIT 1`,
      [input.sessionKey],
    )
    const cart = existing[0]
    if (cart) {
      await pgQuery(
        `INSERT INTO abandoned_cart_events_v2 (cart_id, event_type, meta) VALUES ($1, $2, $3::jsonb)`,
        [cart.id, eventType, JSON.stringify(input.meta ?? {})],
      )
    }
    return cart ? { id: cart.id, sessionKey: cart.sessionKey } : null
  }

  const lifecycleState = eventToLifecycleState(eventType)
  const items = normalizeRecoveryCartItems(input.itemsJson)
  if (!items.length && eventType !== "manual_clear") {
    return null
  }

  const contact = await resolveTrackContact(input)
  if (!hasRecoverableContact(contact.email, contact.mobile)) {
    return null
  }

  const guestEmail = input.userId ? null : contact.email
  const guestMobile = input.userId ? null : contact.mobile

  const row = (await pgQuery<
    Array<{
      id: string
      sessionKey: string
      email: string | null
      itemsJson: unknown
      total: number | null
      updatedAt: Date
      createdAt: Date
    }>
  >(
    `
      INSERT INTO "AbandonedCart" (id, "sessionKey", email, "itemsJson", total, "createdAt", "updatedAt")
      VALUES (gen_random_uuid()::text, $1, $2, $3::jsonb, $4, now(), now())
      ON CONFLICT ("sessionKey") DO UPDATE
      SET email = CASE WHEN $5::text IS NOT NULL THEN COALESCE(EXCLUDED.email, "AbandonedCart".email) ELSE "AbandonedCart".email END,
          "itemsJson" = COALESCE(EXCLUDED."itemsJson", "AbandonedCart"."itemsJson"),
          total = COALESCE(EXCLUDED.total, "AbandonedCart".total),
          "updatedAt" = now()
      RETURNING id, "sessionKey", email, "itemsJson", total, "updatedAt", "createdAt"
    `,
    [input.sessionKey, guestEmail, JSON.stringify(items), input.total ?? null, guestEmail],
  ))[0]
  if (!row) return null

  const meta = input.meta ?? {}
  const checkoutStage = typeof meta.checkoutStage === "string" ? meta.checkoutStage : undefined
  const paymentStatus = typeof meta.paymentStatus === "string" ? meta.paymentStatus : undefined
  const lastVisitedPage = typeof meta.lastVisitedPage === "string" ? meta.lastVisitedPage : undefined
  const couponCode = typeof meta.couponCode === "string" ? meta.couponCode : undefined
  const addressJson = meta.address && typeof meta.address === "object" && !Array.isArray(meta.address) ? meta.address : undefined

  const isTerminal = eventType === "order_completed" || eventType === "manual_clear"
  const instantAbandonReason = eventToAbandonReason(eventType)

  await pgQuery(
    `
      UPDATE "AbandonedCart"
      SET
        user_id = COALESCE($1, user_id),
        guest_id = COALESCE($2, guest_id),
        mobile = CASE WHEN $1::text IS NULL THEN COALESCE($3, mobile) ELSE mobile END,
        last_active_at = now(),
        lifecycle_state = CASE
          WHEN $12 IN ('order_completed', 'manual_clear') THEN 'CONVERTED'
          WHEN $13::text IS NOT NULL THEN 'ABANDONED'
          ELSE $4
        END,
        checkout_stage = COALESCE($5, checkout_stage),
        payment_status = COALESCE($6, payment_status),
        coupon_code = COALESCE($7, coupon_code),
        last_visited_page = COALESCE($8, last_visited_page),
        address_json = CASE WHEN $9::jsonb IS NOT NULL THEN $9::jsonb ELSE address_json END,
        metadata = metadata || $10::jsonb,
        status = CASE
          WHEN $12 IN ('order_completed', 'manual_clear') THEN 'converted'
          WHEN $13::text IS NOT NULL THEN 'abandoned'
          WHEN status IN ('abandoned', 'reminder_sent') AND $12 IN ('checkout_started', 'payment_page_opened', 'payment_attempted') THEN 'active'
          ELSE status
        END,
        abandoned_at = CASE
          WHEN $12 IN ('order_completed', 'manual_clear') THEN NULL
          WHEN $13::text IS NOT NULL THEN COALESCE(abandoned_at, now())
          WHEN status IN ('abandoned', 'reminder_sent') AND $12 IN ('checkout_started', 'payment_page_opened', 'payment_attempted') THEN NULL
          ELSE abandoned_at
        END,
        abandon_reason = CASE
          WHEN $13::text IS NOT NULL THEN $13
          WHEN status IN ('abandoned', 'reminder_sent') AND $12 IN ('checkout_started', 'payment_page_opened', 'payment_attempted') THEN NULL
          ELSE abandon_reason
        END
      WHERE id = $11
    `,
    [
      input.userId ?? null,
      input.guestId ?? null,
      guestMobile,
      lifecycleState,
      checkoutStage ?? null,
      paymentStatus ?? null,
      couponCode ?? null,
      lastVisitedPage ?? null,
      addressJson ? JSON.stringify(addressJson) : null,
      JSON.stringify(meta ?? {}),
      row.id,
      eventType,
      instantAbandonReason,
    ],
  )

  if (input.userId) {
    await syncProfileContactToCart(row.id, input.userId)
  }

  // Only stop scheduled follow-ups when the user re-enters checkout/payment — NOT on
  // background cart_updated syncs (Header fires those while the tab is still open).
  if (
    !isTerminal &&
    !instantAbandonReason &&
    ["checkout_started", "payment_page_opened", "payment_attempted"].includes(eventType)
  ) {
    await pgQuery(
      `
        UPDATE abandoned_cart_recovery_queue_v2
        SET status = 'cancelled'
        WHERE cart_id = $1 AND status IN ('pending', 'failed')
      `,
      [row.id],
    )
  }

  await pgQuery(
    `INSERT INTO abandoned_cart_events_v2 (cart_id, event_type, meta) VALUES ($1, $2, $3::jsonb)`,
    [row.id, eventType, JSON.stringify(input.meta ?? {})],
  )

  if (instantAbandonReason) {
    await markCartAbandoned({
      cartId: row.id,
      reason: instantAbandonReason,
      lifecycleBefore: lifecycleState === "ABANDONED" ? "PAYMENT_PENDING" : lifecycleState,
    })
  }

  return row
}

export const detectAbandonedCarts = async () => {
  await ensureRecoveryTables()
  const settings = await getSettings()
  if (!settings.enabled) return { scanned: 0, marked: 0, queued: 0 }
  const schedule = resolveRecoverySchedule(settings)
  const thresholds = {
    cartOnlyMinutes: Math.max(1, Number((settings as any).cartOnlyThresholdMinutes ?? PRODUCTION_ABANDON_MINUTES)),
    checkoutStartedMinutes: Math.max(1, Number((settings as any).checkoutStartedThresholdMinutes ?? PRODUCTION_ABANDON_MINUTES)),
    paymentPendingMinutes: Math.max(1, Number((settings as any).paymentPendingThresholdMinutes ?? PRODUCTION_ABANDON_MINUTES)),
  }
  const candidates = await pgQuery<
    Array<{
      id: string
      status: string
      updated_at: Date
      last_active_at: Date | null
      lifecycle_state: string
      items_json: unknown
      recovery_disabled: boolean
      ignored: boolean
      converted_at: Date | null
    }>
  >(
    `
      SELECT
        c.id,
        c.status,
        c."updatedAt" AS updated_at,
        c.last_active_at,
        c.lifecycle_state,
        c."itemsJson" AS items_json,
        c.recovery_disabled,
        c.ignored,
        c.converted_at
      FROM "AbandonedCart" c
      WHERE c.status IN ('active', 'reminder_sent')
        AND c.recovery_disabled = false
        AND c.ignored = false
        AND c.converted_at IS NULL
    `,
  )
  let marked = 0
  let queued = 0
  for (const cart of candidates) {
    const items = normalizeRecoveryCartItems(cart.items_json)
    if (!items.length) continue

    const contact = await resolveCartContact(cart.id)
    if (!hasRecoverableContact(contact.email, contact.mobile)) continue

    const lastActivity = cart.last_active_at ?? cart.updated_at
    const minutesInactive = Math.floor((Date.now() - new Date(lastActivity).getTime()) / 60000)
    const lifecycle = mapLegacyLifecycle(cart.lifecycle_state)
    const thresholdMinutes =
      lifecycle === "PAYMENT_PENDING"
        ? thresholds.paymentPendingMinutes
        : lifecycle === "CHECKOUT_STARTED"
          ? thresholds.checkoutStartedMinutes
          : thresholds.cartOnlyMinutes
    if (minutesInactive < thresholdMinutes) continue

    const reason: AbandonReason =
      lifecycle === "CHECKOUT_STARTED"
        ? "checkout_abandoned"
        : lifecycle === "PAYMENT_PENDING"
          ? "payment_timeout"
          : "inactivity"

    const result = await markCartAbandoned({
      cartId: cart.id,
      reason,
      lifecycleBefore: lifecycle,
      schedule,
    })
    if (result.marked) {
      marked += 1
      queued += result.queued
    }
  }
  console.log("[abandoned-cart][detect]", { scanned: candidates.length, marked, queued })
  return { scanned: candidates.length, marked, queued }
}

const renderMessage = async (input: {
  name: string
  cartValue: number
  itemsCount: number
  checkoutLink: string
  coupon?: string
  templateKey: string
  channel: RecoveryChannel
}) => {
  const vars = buildDefaultVars({
    name: input.name || "there",
    cart_value: input.cartValue.toFixed(2),
    items: String(input.itemsCount),
    resume_link: input.checkoutLink,
    coupon: input.coupon ?? "",
  })
  const stored = await getTemplate(input.templateKey, input.channel)
  const defaultSubject = "You left something in your cart"
  const defaultBody =
    input.channel === "email"
      ? `<p>Hi {{name}}, you left items worth Rs.{{amount}} in your cart. <a href="{{resume_link}}">Resume checkout</a>.</p>`
      : "Hi {{name}}, you left items worth Rs.{{amount}} in your cart. Complete order: {{resume_link}}"

  const subject = renderPlaceholders(stored?.subject ?? defaultSubject, vars)
  const body = renderPlaceholders(stored?.body ?? defaultBody, vars)
  return { subject, body }
}

const sendWhatsapp = async (to: string, body: string, shortSmsLink?: string) => {
  // Reuse SMS adapter as a safe fallback if dedicated provider is absent.
  await smsService.send({ 
    mobile: to, 
    templateKey: "ABANDONED_CART",
    variables: ["there", shortSmsLink || "link"],
    body: `[WA] ${body}` 
  })
}

function normalizeVars(vars: Record<string, string | number | null | undefined>) {
  const out: Record<string, string> = {}
  for (const [k, v] of Object.entries(vars)) out[k] = v == null ? "" : String(v)
  return out
}

function buildDefaultVars(
  input: Partial<{
    name: string
    first_name: string
    cart_value: number | string
    items: number | string
    item_names: string
    coupon: string
    discount: string
    resume_link: string
    payment_link: string
    support_number: string
    store_name: string
    expiry_time: string
  }>,
) {
  const storeName = process.env.NEXT_PUBLIC_STORE_NAME ?? process.env.NEXT_PUBLIC_APP_NAME ?? "Store"
  const supportNumber = process.env.NEXT_PUBLIC_SUPPORT_NUMBER ?? ""
  return normalizeVars({
    name: input.name ?? "there",
    first_name: input.first_name ?? (input.name ? String(input.name).split(" ")[0] : "there"),
    cart_value: input.cart_value ?? "",
    items: input.items ?? "",
    item_names: input.item_names ?? "",
    coupon: input.coupon ?? "",
    discount: input.discount ?? "",
    resume_link: input.resume_link ?? "",
    payment_link: input.payment_link ?? "",
    support_number: input.support_number ?? supportNumber,
    store_name: input.store_name ?? storeName,
    expiry_time: input.expiry_time ?? "",
    // Backwards compatible keys used by older templates
    amount: input.cart_value ?? "",
  })
}

export const processRecoveryQueue = async () => {
  await ensureRecoveryTables()
  const rows = await pgQuery<
    Array<{
      id: string
      cart_id: string
      step_no: number
      channel: RecoveryChannel
      payload: any
      status: RecoveryStatus
      total: number | null
      items_json: any
      coupon_code: string | null
      steps_completed: number
      converted_at: Date | null
      recovery_disabled: boolean
      ignored: boolean
      cart_status: string
    }>
  >(
    `
      SELECT
        q.id,
        q.cart_id,
        q.step_no,
        q.channel,
        q.payload,
        q.status,
        c.total,
        c."itemsJson" AS items_json,
        c.coupon_code,
        c.steps_completed,
        c.converted_at,
        c.recovery_disabled,
        c.ignored,
        c.status AS cart_status
      FROM abandoned_cart_recovery_queue_v2 q
      JOIN "AbandonedCart" c ON c.id = q.cart_id
      WHERE q.status IN ('pending', 'failed')
        AND q.scheduled_at <= now()
        AND COALESCE((q.payload->>'attempts')::int, 0) < 3
      ORDER BY q.scheduled_at ASC, q.step_no ASC
      LIMIT 100
    `,
  )
  const settings = await getSettings()
  const maxSteps = Math.max(1, Number(settings.maxRemindersPerCart ?? DEFAULT_SETTINGS.maxRemindersPerCart))
  const emailEnabled = settings.emailEnabled !== false
  const smsEnabled = settings.smsEnabled !== false
  const whatsappEnabled = settings.whatsappEnabled !== false
  const checkoutBase = (process.env.NEXT_PUBLIC_APP_URL || "https://ziply5.com").replace(/\/$/, "")
  let sent = 0
  let failed = 0
  let skipped = 0

  for (const row of rows) {
    try {
      if (
        row.converted_at ||
        row.recovery_disabled ||
        row.ignored ||
        row.cart_status === "converted" ||
        row.steps_completed >= maxSteps
      ) {
        await pgQuery(`UPDATE abandoned_cart_recovery_queue_v2 SET status='skipped' WHERE id = $1::uuid`, [row.id])
        skipped += 1
        continue
      }
      if (row.step_no > row.steps_completed + 1) {
        skipped += 1
        continue
      }
      if (await priorReminderStepPending(row.cart_id, row.step_no)) {
        skipped += 1
        continue
      }
      if (row.channel === "email" && !emailEnabled) {
        await pgQuery(`UPDATE abandoned_cart_recovery_queue_v2 SET status='skipped', error_message='Email disabled' WHERE id = $1::uuid`, [row.id])
        skipped += 1
        continue
      }
      if (row.channel === "sms" && !smsEnabled) {
        await pgQuery(`UPDATE abandoned_cart_recovery_queue_v2 SET status='skipped', error_message='SMS disabled' WHERE id = $1::uuid`, [row.id])
        skipped += 1
        continue
      }
      if (row.channel === "whatsapp" && !whatsappEnabled) {
        await pgQuery(`UPDATE abandoned_cart_recovery_queue_v2 SET status='skipped', error_message='WhatsApp disabled' WHERE id = $1::uuid`, [row.id])
        skipped += 1
        continue
      }

      const contact = await resolveCartContact(row.cart_id)
      const to = row.channel === "email" ? contact.email : contact.mobile
      if (!to) {
        await pgQuery(
          `UPDATE abandoned_cart_recovery_queue_v2 SET status='skipped', error_message='No contact for recovery' WHERE id = $1::uuid`,
          [row.id],
        )
        skipped += 1
        continue
      }

      const tokenTtl = Math.max(5, Number((settings as any).tokenExpiryMinutes ?? DEFAULT_SETTINGS.tokenExpiryMinutes))
      const resumeToken = await buildResumeToken(row.cart_id, tokenTtl, {
        source: "followup",
        channel: row.channel,
        stepNo: row.step_no,
      })
      const checkoutLink = `${checkoutBase}/cart/recover?token=${encodeURIComponent(resumeToken)}`
      const templateKey = String((row.payload as any)?.template ?? `abandoned_step_${row.step_no}`)
      const cartItems = normalizeRecoveryCartItems(row.items_json)
      const cartValue =
        Number(row.total ?? 0) || cartItems.reduce((s, i) => s + Number(i.price ?? 0) * Number(i.quantity ?? 1), 0)
      const msg = await renderMessage({
        name: contact.name,
        cartValue,
        itemsCount: cartItems.length,
        checkoutLink,
        coupon: typeof row.coupon_code === "string" ? row.coupon_code : undefined,
        templateKey,
        channel: row.channel,
      })

      let providerResponse: string | null = null
      if (row.channel === "email") {
        await enqueueEmail({ to, subject: msg.subject, html: msg.body })
      } else if (row.channel === "sms") {
        const shortSmsLink = `${checkoutBase.replace(/^https?:\/\//, "")}/c/${encodeURIComponent(resumeToken)}`
        const smsResult = await smsService.send({
          mobile: to,
          templateKey: "ABANDONED_CART",
          variables: [contact.name.split(/\s+/)[0] || "there", shortSmsLink],
        })
        providerResponse = smsResult.providerResponse
      } else {
        const shortSmsLink = `${checkoutBase.replace(/^https?:\/\//, "")}/c/${encodeURIComponent(resumeToken)}`
        await sendWhatsapp(to, msg.body, shortSmsLink)
      }

      await pgTx(async (client) => {
        await client.query(
          `UPDATE abandoned_cart_recovery_queue_v2 SET status='sent', sent_at=now(), error_message=NULL WHERE id = $1::uuid`,
          [row.id],
        )
        await client.query(
          `INSERT INTO abandoned_cart_messages_v2 (cart_id, queue_id, channel, template_used, provider_response, sent_to, status)
           VALUES ($1, $2::uuid, $3, $4, $5, $6, 'sent')`,
          [row.cart_id, row.id, row.channel, templateKey, providerResponse, to],
        )
        await client.query(
          `UPDATE "AbandonedCart"
           SET last_message_at = now(),
               status = CASE WHEN status = 'abandoned' THEN 'reminder_sent' ELSE status END
           WHERE id = $1`,
          [row.cart_id],
        )
      })
      await maybeAdvanceStepCompletion(row.cart_id, row.step_no)
      sent += 1
    } catch (error) {
      const errMsg = error instanceof Error ? error.message.slice(0, 200) : "Unknown error"
      await pgQuery(
        `
          UPDATE abandoned_cart_recovery_queue_v2
          SET status='failed',
              error_message=$1,
              scheduled_at = now() + interval '15 minutes',
              payload = payload || jsonb_build_object('attempts', COALESCE((payload->>'attempts')::int, 0) + 1)
          WHERE id = $2::uuid
        `,
        [errMsg, row.id],
      )
      failed += 1
    }
  }
  console.log("[abandoned-cart][process-queue]", { due: rows.length, sent, failed, skipped })
  return { due: rows.length, sent, failed, skipped }
}

export const runAbandonedCartJobs = async () => {
  const detect = await detectAbandonedCarts()
  const process = await processRecoveryQueue()
  return { detect, process }
}

export const markCartConverted = async (input: { sessionKey?: string | null; email?: string | null; mobile?: string | null; orderId?: string | null; revenue?: number | null; channel?: string | null }) => {
  await ensureRecoveryTables()
  await getSettings()
  const rows = await pgQuery<Array<{ id: string }>>(
    `
      SELECT id
      FROM "AbandonedCart"
      WHERE ($1::text IS NOT NULL AND "sessionKey" = $1)
         OR ($2::text IS NOT NULL AND email = $2)
         OR ($3::text IS NOT NULL AND mobile = $3)
      ORDER BY "updatedAt" DESC
      LIMIT 1
    `,
    [input.sessionKey ?? null, input.email ?? null, input.mobile ?? null],
  )
  const cart = rows[0]
  if (!cart) return { updated: false }

  // Best-effort attribution: if no explicit channel provided, infer from last used resume token.
  let channel = input.channel ?? null
  if (!channel) {
    const tokenRows = await pgQuery<Array<{ meta: any }>>(
      `SELECT meta FROM abandoned_cart_resume_tokens_v2 WHERE cart_id = $1 AND last_used_at IS NOT NULL ORDER BY last_used_at DESC LIMIT 1`,
      [cart.id],
    )
    const meta = tokenRows[0]?.meta
    const inferred =
      meta && typeof meta === "object" && !Array.isArray(meta) ? safeString((meta as any).channel) || safeString((meta as any).source) : ""
    if (inferred) channel = inferred
  }

  await pgTx(async (client) => {
    await client.query(
      `
        UPDATE "AbandonedCart"
        SET status = 'converted',
            lifecycle_state = 'CONVERTED',
            converted_at = now(),
            converted_order_id = $1,
            recovered_channel = $2,
            abandoned_at = NULL,
            abandon_reason = NULL
        WHERE id = $3
      `,
      [input.orderId ?? null, channel, cart.id],
    )
    await client.query(
      `UPDATE abandoned_cart_recovery_queue_v2 SET status='cancelled' WHERE cart_id = $1 AND status IN ('pending', 'failed')`,
      [cart.id],
    )
  })
  if ((input.revenue ?? 0) > 0) {
    await pgQuery(
      `
        INSERT INTO abandoned_cart_analytics_daily_v2 (date_key, total_abandoned, recovered_count, recovered_revenue, by_channel, updated_at)
        VALUES (CURRENT_DATE, 0, 1, $1::numeric, $2::jsonb, now())
        ON CONFLICT (date_key)
        DO UPDATE SET
          recovered_count = abandoned_cart_analytics_daily_v2.recovered_count + 1,
          recovered_revenue = abandoned_cart_analytics_daily_v2.recovered_revenue + EXCLUDED.recovered_revenue,
          updated_at = now()
      `,
      [input.revenue ?? 0, JSON.stringify({ [input.channel ?? "unknown"]: 1 })],
    )
  }
  return { updated: true, cartId: cart.id }
}

export const listAbandonedCartsDashboard = async (input?: {
  converted?: "yes" | "no"
  userType?: "guest" | "registered"
  minValue?: number
  maxValue?: number
  q?: string
}) => {
  await ensureRecoveryTables()
  const params: any[] = []
  const where: string[] = []

  if (input?.converted === "yes") where.push(`c.converted_at IS NOT NULL`)
  if (input?.converted === "no") where.push(`c.converted_at IS NULL`)
  if (input?.userType === "registered") where.push(`c.user_id IS NOT NULL`)
  if (input?.userType === "guest") where.push(`c.user_id IS NULL`)

  if (typeof input?.minValue === "number") {
    params.push(input.minValue)
    where.push(`c.total >= $${params.length}`)
  }
  if (typeof input?.maxValue === "number") {
    params.push(input.maxValue)
    where.push(`c.total <= $${params.length}`)
  }
  if (input?.q?.trim()) {
    const q = `%${input.q.trim()}%`
    params.push(q, q, q)
    const a = params.length - 2
    where.push(
      `(COALESCE(u.email, c.email, '') ILIKE $${a} OR COALESCE(p.phone, c.mobile, '') ILIKE $${a + 1} OR c."sessionKey" ILIKE $${a + 2})`,
    )
  }

  const sql = `
    SELECT
      c.id,
      c."sessionKey" AS session_key,
      COALESCE(u.email, c.email) AS email,
      COALESCE(p.phone, c.mobile) AS mobile,
      c.user_id,
      c.total,
      c."updatedAt" AS updated_at,
      c.last_active_at,
      c.abandoned_at,
      c.status,
      c.lifecycle_state,
      c.abandon_reason,
      c.steps_completed,
      c.messages_sent,
      c.last_message_at,
      c.converted_at,
      c."itemsJson" AS items_json,
      (
        SELECT MIN(q.scheduled_at)
        FROM abandoned_cart_recovery_queue_v2 q
        WHERE q.cart_id = c.id AND q.status = 'pending' AND q.scheduled_at > now()
      ) AS next_reminder_at,
      (
        SELECT q.step_no
        FROM abandoned_cart_recovery_queue_v2 q
        WHERE q.cart_id = c.id AND q.status = 'pending' AND q.scheduled_at > now()
        ORDER BY q.scheduled_at ASC
        LIMIT 1
      ) AS next_reminder_step
    FROM "AbandonedCart" c
    LEFT JOIN "User" u ON u.id = c.user_id
    LEFT JOIN "UserProfile" p ON p."userId" = c.user_id
    ${where.length ? `WHERE ${where.join(" AND ")}` : ""}
    ORDER BY COALESCE(c.abandoned_at, c."updatedAt") DESC
    LIMIT 200
  `
  return pgQuery(sql, params)
}

export const markCartRecovered = async (input: { sessionKey?: string | null; cartId?: string | null; channel?: string | null }) => {
  await ensureRecoveryTables()
  const rows = await pgQuery<Array<{ id: string }>>(
    `
      SELECT id FROM "AbandonedCart"
      WHERE ($1::text IS NOT NULL AND id = $1)
         OR ($2::text IS NOT NULL AND "sessionKey" = $2)
      ORDER BY "updatedAt" DESC
      LIMIT 1
    `,
    [input.cartId ?? null, input.sessionKey ?? null],
  )
  const cart = rows[0]
  if (!cart) return { updated: false }
  await pgTx(async (client) => {
    await client.query(
      `
        UPDATE "AbandonedCart"
        SET status = 'recovered',
            lifecycle_state = 'RECOVERED',
            recovered_channel = COALESCE($2, recovered_channel),
            last_active_at = now()
        WHERE id = $1 AND converted_at IS NULL
      `,
      [cart.id, input.channel ?? "recovery_link"],
    )
    await client.query(
      `UPDATE abandoned_cart_recovery_queue_v2 SET status='cancelled' WHERE cart_id = $1 AND status IN ('pending', 'failed')`,
      [cart.id],
    )
  })
  return { updated: true, cartId: cart.id }
}

export const getAbandonedCartTimeline = async (cartId: string) => {
  await ensureRecoveryTables()
  const [events, messages, queue] = await Promise.all([
    pgQuery<Array<{ id: string; event_type: string; meta: any; created_at: Date }>>(
      `SELECT id, event_type, meta, created_at
       FROM abandoned_cart_events_v2
       WHERE cart_id = $1
       ORDER BY created_at DESC
       LIMIT 200`,
      [cartId],
    ),
    pgQuery<Array<{ id: string; channel: string; template_used: string | null; sent_to: string | null; status: string; sent_at: Date }>>(
      `SELECT id, channel, template_used, sent_to, status, sent_at
       FROM abandoned_cart_messages_v2
       WHERE cart_id = $1
       ORDER BY sent_at DESC
       LIMIT 200`,
      [cartId],
    ),
    pgQuery<Array<{ id: string; step_no: number; channel: string; scheduled_at: Date; sent_at: Date | null; status: string; error_message: string | null }>>(
      `SELECT id, step_no, channel, scheduled_at, sent_at, status, error_message
       FROM abandoned_cart_recovery_queue_v2
       WHERE cart_id = $1
       ORDER BY scheduled_at DESC
       LIMIT 200`,
      [cartId],
    ),
  ])
  return { events, messages, queue }
}

export const getRecoverableCartBySession = async (sessionKey: string) => {
  await ensureRecoveryTables()
  const rows = await pgQuery<
    Array<{
      id: string
      session_key: string
      email: string | null
      items_json: any
      total: number | null
      status: string
      converted_at: Date | null
      updated_at: Date
    }>
  >(
    `SELECT id, "sessionKey" as session_key, email, "itemsJson" as items_json, total, status, converted_at, "updatedAt" as updated_at
     FROM "AbandonedCart"
     WHERE "sessionKey" = $1
     LIMIT 1`,
    [sessionKey],
  )
  const row = rows[0]
  if (!row) return null
  return {
    id: row.id,
    sessionKey: row.session_key,
    email: row.email,
    itemsJson: row.items_json,
    total: row.total,
    status: row.status,
    convertedAt: row.converted_at,
    updatedAt: row.updated_at,
  }
}

export const getRecoverableCartByTokenOrSession = async (tokenOrSessionKey: string) => {
  await ensureRecoveryTables()
  const tokenHash = sha256(tokenOrSessionKey)
  const tokenRows = await pgQuery<Array<{ cart_id: string }>>(
    `SELECT cart_id FROM abandoned_cart_resume_tokens_v2 WHERE token_hash = $1 AND expires_at > now() LIMIT 1`,
    [tokenHash],
  )
  const cartId = tokenRows[0]?.cart_id
  if (cartId) {
    await pgQuery(`UPDATE abandoned_cart_resume_tokens_v2 SET last_used_at = now() WHERE token_hash = $1`, [tokenHash])
    const rows = await pgQuery<
      Array<{
        id: string
        session_key: string
        email: string | null
        items_json: any
        total: number | null
        status: string
        converted_at: Date | null
        updated_at: Date
      }>
    >(
      `SELECT id, "sessionKey" as session_key, email, "itemsJson" as items_json, total, status, converted_at, "updatedAt" as updated_at
       FROM "AbandonedCart"
       WHERE id = $1
       LIMIT 1`,
      [cartId],
    )
    const row = rows[0]
    if (!row) return null
    return {
      id: row.id,
      sessionKey: row.session_key,
      email: row.email,
      itemsJson: row.items_json,
      total: row.total,
      status: row.status,
      convertedAt: row.converted_at,
      updatedAt: row.updated_at,
    }
  }

  // Backwards compatible: treat the token as the sessionKey.
  return getRecoverableCartBySession(tokenOrSessionKey)
}

export const createResumeLinkTokenForCart = async (cartId: string, meta: Record<string, unknown> = {}) => {
  const settings = await getSettings()
  const ttl = Math.max(5, Number((settings as any).tokenExpiryMinutes ?? DEFAULT_SETTINGS.tokenExpiryMinutes))
  const token = await buildResumeToken(cartId, ttl, { source: "admin", ...meta })
  return { token, ttlMinutes: ttl }
}

export const sendRecoveryNow = async (cartId: string, channels: RecoveryChannel[] = ["email"]) => {
  await ensureRecoveryTables()
  for (const channel of channels) {
    await pgQuery(
      `
        INSERT INTO abandoned_cart_recovery_queue_v2 (cart_id, step_no, channel, scheduled_at, status, payload)
        VALUES ($1, 0, $2, now(), 'pending', $3::jsonb)
        ON CONFLICT (cart_id, step_no, channel)
        DO UPDATE SET scheduled_at = now(), status='pending', error_message=NULL
      `,
      [cartId, channel, JSON.stringify({ template: "manual_send_now", attempts: 0 })],
    )
  }
  const process = await processRecoveryQueue()
  return { queued: channels.length, process }
}

export const setRecoveryFlags = async (cartId: string, input: { recoveryDisabled?: boolean; ignored?: boolean }) => {
  await ensureRecoveryTables()
  await pgQuery(
    `UPDATE "AbandonedCart"
     SET recovery_disabled = COALESCE($1, recovery_disabled),
         ignored = COALESCE($2, ignored)
     WHERE id = $3`,
    [input.recoveryDisabled ?? null, input.ignored ?? null, cartId],
  )
}

export const getAbandonedAnalytics = async () => {
  await ensureRecoveryTables()
  const [summaryRows, topProductsRows] = await Promise.all([
    pgQuery<Array<{ total: bigint; converted: bigint; recovered_revenue: number }>>(
      `
        SELECT
          COUNT(*)::bigint as total,
          COUNT(*) FILTER (WHERE converted_at IS NOT NULL)::bigint as converted,
          COALESCE(SUM(CASE WHEN converted_at IS NOT NULL THEN total ELSE 0 END), 0)::numeric as recovered_revenue
        FROM "AbandonedCart"
        WHERE status IN ('abandoned', 'converted')
      `,
    ),
    pgQuery<Array<{ product_name: string; abandon_count: bigint }>>(
      `
        WITH flat AS (
          SELECT jsonb_array_elements("itemsJson"::jsonb) as item
          FROM "AbandonedCart"
          WHERE status IN ('abandoned', 'converted')
        )
        SELECT COALESCE(item->>'name', item->>'slug', 'Unknown') as product_name, COUNT(*)::bigint as abandon_count
        FROM flat
        GROUP BY 1
        ORDER BY 2 DESC
        LIMIT 10
      `,
    ),
  ])
  const summary = summaryRows[0] ?? { total: BigInt(0), converted: BigInt(0), recovered_revenue: 0 }
  const total = Number(summary.total)
  const converted = Number(summary.converted)
  const recoveryRate = total > 0 ? (converted / total) * 100 : 0
  return {
    totalAbandoned: total,
    recoveredCount: converted,
    recoveryRate,
    recoveredRevenue: Number(summary.recovered_revenue ?? 0),
    topAbandonedProducts: topProductsRows.map((row) => ({ name: row.product_name, count: Number(row.abandon_count) })),
  }
}

export const aggregateAbandonedAnalyticsDaily = async () => {
  await ensureRecoveryTables()
  await pgQuery(
    `
      INSERT INTO abandoned_cart_analytics_daily_v2 (date_key, total_abandoned, recovered_count, recovered_revenue, by_channel, updated_at)
      SELECT
        CURRENT_DATE,
        COUNT(*) FILTER (WHERE status IN ('abandoned', 'converted'))::int,
        COUNT(*) FILTER (WHERE converted_at::date = CURRENT_DATE)::int,
        COALESCE(SUM(CASE WHEN converted_at::date = CURRENT_DATE THEN total ELSE 0 END), 0)::numeric,
        COALESCE(
          (
            SELECT jsonb_object_agg(channel, cnt)
            FROM (
              SELECT channel, COUNT(*)::int as cnt
              FROM abandoned_cart_messages_v2
              WHERE sent_at::date = CURRENT_DATE
              GROUP BY channel
            ) t
          ),
          '{}'::jsonb
        ),
        now()
      FROM "AbandonedCart"
      ON CONFLICT (date_key)
      DO UPDATE SET
        total_abandoned = EXCLUDED.total_abandoned,
        recovered_count = EXCLUDED.recovered_count,
        recovered_revenue = EXCLUDED.recovered_revenue,
        by_channel = EXCLUDED.by_channel,
        updated_at = now()
    `,
  )
  return { date: new Date().toISOString().slice(0, 10), aggregated: true }
}

export const sendRecoveryTemplateTest = async (input: { templateKey: string; channel: RecoveryChannel; to: string }) => {
  await ensureRecoveryTables()
  const template = await getTemplate(input.templateKey, input.channel)
  const vars = buildDefaultVars({
    name: "Asha",
    cart_value: "1299",
    items: "3",
    item_names: "Vitamin C Serum, Sunscreen, Lip Balm",
    coupon: "WELCOME10",
    discount: "10%",
    resume_link: "https://example.test/cart/recover/demo",
    payment_link: "https://example.test/payment/demo",
    expiry_time: "24 hours",
  })

  const subject = renderPlaceholders(template?.subject ?? "Test recovery message", vars)
  const body = renderPlaceholders(
    template?.body ??
      (input.channel === "email"
        ? "<p>Hi {{name}}, this is a test message from {{store_name}}.</p>"
        : "Hi {{name}}, this is a test message from {{store_name}}."),
    vars,
  )

  if (input.channel === "email") {
    await enqueueEmail({ to: input.to, subject, html: body })
  } else if (input.channel === "sms") {
    await smsService.send({ to: input.to, body })
  } else {
    await sendWhatsapp(input.to, body)
  }
  return { sent: true }
}

// --- Background Job Emulator (for Testing/Development) ---
if (typeof global !== "undefined") {
  // Store the active function references on global so they hot-reload dynamically
  ;(global as any)._detectAbandonedCarts = detectAbandonedCarts
  ;(global as any)._processRecoveryQueue = processRecoveryQueue

  if (!(global as any)._abandoned_cart_worker_started) {
    ;(global as any)._abandoned_cart_worker_started = true
    
    const JOB_INTERVAL_MS = 60 * 1000 // Run every 60 seconds
    
    console.info(`[ABANDONED CART] Starting background job emulator (every ${JOB_INTERVAL_MS / 1000}s)`)
    
    const timer = setInterval(async () => {
      try {
        // Always invoke the latest hot-reloaded functions from the global scope
        const detection = await (global as any)._detectAbandonedCarts()
        const processing = await (global as any)._processRecoveryQueue()
        
        if (detection.marked > 0 || processing.sent > 0 || processing.failed > 0 || processing.skipped > 0) {
          console.info(`[ABANDONED CART JOB] Detection: ${detection.marked} marked, ${detection.queued} queued. Processing: ${processing.sent} sent, ${processing.failed} failed, ${processing.skipped} skipped.`)
        }
      } catch (err) {
        console.error("[ABANDONED CART JOB ERROR]", err)
      }
    }, JOB_INTERVAL_MS)
    if (typeof timer.unref === "function") {
      timer.unref()
    }
  }
}


