export type ProviderPlanId = 'single_event' | 'basico' | 'pro';

export type ProviderSubscriptionStatus =
  | 'trialing'
  | 'active'
  | 'past_due'
  | 'expired'
  | 'canceled';

/** Days a paid plan keeps working after its term ends, before locking. */
export const SUBSCRIPTION_GRACE_DAYS = 7;

/**
 * Version of the plan rules/limits + terms. Stamped onto the owner's
 * `plan_snapshot` at activation so an active term keeps the rules in effect at
 * purchase even if the catalog changes later. Bump when limits/terms change.
 */
export const RULES_VERSION = '2026-05-27';

export type SupportTier = 'standard' | 'priority';

export interface ProviderPlanLimits {
  /** `null` means unlimited. */
  maxActiveEvents: number | null;
  maxTicketsPerEvent: number | null;
  /** Collaborators (comercio members), excluding the owner. */
  maxMembers: number | null;
  maxStaff: number | null;
  supportTier: SupportTier;
}

export interface ProviderPlan {
  id: ProviderPlanId;
  name: string;
  priceCents: number;
  currency: string;
  billingInterval: 'annual';
  limits: ProviderPlanLimits;
  tagline?: string;
  highlighted?: boolean;
}

export interface ProviderUsage {
  activeEvents: number;
  members: number;
  staff: number;
}

export interface ProviderSubscription {
  planId: ProviderPlanId | null;
  planName: string;
  status: ProviderSubscriptionStatus;
  limits: ProviderPlanLimits;
  usage: ProviderUsage;
  trialEndsAt: string | null;
  currentPeriodEnd: string | null;
  canManage: boolean;
  /** Owner asked to cancel: keep access until `currentPeriodEnd`, then expire. */
  cancelAtPeriodEnd: boolean;
}

const SINGLE_EVENT_LIMITS: ProviderPlanLimits = {
  maxActiveEvents: 1,
  maxTicketsPerEvent: null,
  maxMembers: 0,
  maxStaff: 3,
  supportTier: 'standard',
};

const BASICO_LIMITS: ProviderPlanLimits = {
  maxActiveEvents: 4,
  maxTicketsPerEvent: 500,
  maxMembers: 0,
  maxStaff: 1,
  supportTier: 'standard',
};

const PRO_LIMITS: ProviderPlanLimits = {
  maxActiveEvents: null,
  maxTicketsPerEvent: null,
  maxMembers: 5,
  maxStaff: 15,
  supportTier: 'priority',
};

/** Full (Pro-level) access during the free trial. */
export const TRIAL_LIMITS: ProviderPlanLimits = { ...PRO_LIMITS };

export const PLAN_LIMITS_BY_ID: Record<ProviderPlanId, ProviderPlanLimits> = {
  single_event: SINGLE_EVENT_LIMITS,
  basico: BASICO_LIMITS,
  pro: PRO_LIMITS,
};

export const PLAN_NAME_BY_ID: Record<ProviderPlanId, string> = {
  single_event: 'Evento Único',
  basico: 'Básico',
  pro: 'Pro',
};

/** Annual prices in HNL cents. Keep in sync with allons-mobile `lib/subscription.ts`. */
export const PLAN_CATALOG: ProviderPlan[] = [
  {
    id: 'single_event',
    name: 'Evento Único',
    priceCents: 250000,
    currency: 'HNL',
    billingInterval: 'annual',
    limits: SINGLE_EVENT_LIMITS,
    tagline: 'Para un único evento al año',
  },
  {
    id: 'basico',
    name: 'Básico',
    priceCents: 590000,
    currency: 'HNL',
    billingInterval: 'annual',
    limits: BASICO_LIMITS,
    tagline: 'Para comercios en crecimiento',
  },
  {
    id: 'pro',
    name: 'Pro',
    priceCents: 1290000,
    currency: 'HNL',
    billingInterval: 'annual',
    limits: PRO_LIMITS,
    tagline: 'Eventos y tickets ilimitados',
    highlighted: true,
  },
];

export function isPlanId(value: unknown): value is ProviderPlanId {
  return value === 'single_event' || value === 'basico' || value === 'pro';
}

/** Honduras ISV. Subscription prices are tax-INCLUSIVE (base + ISV = total). */
export const ISV_RATE_PCT = 15;

/** Splits a tax-inclusive total into base + ISV. */
export function taxBreakdownIncluded(totalCents: number): {
  baseCents: number;
  taxCents: number;
} {
  const baseCents = Math.round(totalCents / (1 + ISV_RATE_PCT / 100));
  return { baseCents, taxCents: totalCents - baseCents };
}

function isStatus(value: unknown): value is ProviderSubscriptionStatus {
  return (
    value === 'trialing' ||
    value === 'active' ||
    value === 'past_due' ||
    value === 'expired' ||
    value === 'canceled'
  );
}

function inFuture(iso: string | null): boolean {
  if (!iso) return false;
  const t = new Date(iso).getTime();
  return Number.isFinite(t) && t > Date.now();
}

/** True when `iso` is in the past but within the grace window (inclusive). */
function withinGrace(iso: string | null): boolean {
  if (!iso) return false;
  const t = new Date(iso).getTime();
  if (!Number.isFinite(t)) return false;
  const elapsed = Date.now() - t;
  const graceMs = SUBSCRIPTION_GRACE_DAYS * 24 * 60 * 60 * 1000;
  return elapsed >= 0 && elapsed <= graceMs;
}

/**
 * Derives the subscription from a comercio owner's `user_metadata`. The
 * canonical fields are written by allons-admin (`subscription_plan`,
 * `free_trial_start`, `free_trial_end`) and the payment webhook
 * (`subscription_status`, `subscription_period_end`).
 */
/**
 * Limits captured at purchase (`user_metadata.plan_snapshot`). Used for the
 * active term so catalog changes don't apply retroactively; `null` falls back
 * to the live catalog (legacy terms with no snapshot).
 */
function readSnapshotLimits(
  meta: Record<string, unknown>,
  planId: ProviderPlanId | null,
): ProviderPlanLimits | null {
  if (!planId) return null;
  const snap = meta.plan_snapshot;
  if (!snap || typeof snap !== 'object') return null;
  const s = snap as { planId?: unknown; limits?: unknown };
  if (s.planId !== planId) return null;
  const l = s.limits as Partial<ProviderPlanLimits> | undefined;
  if (!l || typeof l !== 'object') return null;
  const numOrNull = (v: unknown): v is number | null =>
    v === null || typeof v === 'number';
  if (
    !numOrNull(l.maxActiveEvents) ||
    !numOrNull(l.maxTicketsPerEvent) ||
    !numOrNull(l.maxMembers) ||
    !numOrNull(l.maxStaff)
  ) {
    return null;
  }
  return {
    maxActiveEvents: l.maxActiveEvents,
    maxTicketsPerEvent: l.maxTicketsPerEvent,
    maxMembers: l.maxMembers,
    maxStaff: l.maxStaff,
    supportTier: l.supportTier === 'priority' ? 'priority' : 'standard',
  };
}

export function deriveSubscription(
  meta: Record<string, unknown> | null | undefined,
  usage: ProviderUsage,
  canManage: boolean,
): ProviderSubscription {
  const m = meta ?? {};
  const rawPlan = m.subscription_plan;
  const planId = isPlanId(rawPlan) ? rawPlan : null;
  const trialEndsAt =
    typeof m.free_trial_end === 'string' ? m.free_trial_end : null;
  const currentPeriodEnd =
    typeof m.subscription_period_end === 'string'
      ? m.subscription_period_end
      : null;

  let status: ProviderSubscriptionStatus;
  if (isStatus(m.subscription_status)) {
    status = m.subscription_status;
  } else if (planId && inFuture(currentPeriodEnd)) {
    status = 'active';
  } else if (inFuture(trialEndsAt)) {
    status = 'trialing';
  } else if (trialEndsAt && !planId) {
    status = 'expired';
  } else {
    status = planId ? 'active' : 'trialing';
  }

  // Paid plans store `subscription_status: active` in metadata; once the term
  // ends, keep working for a grace window (past_due) then lock (expired) — no
  // cron needed since this is derived on every read.
  if (
    (status === 'active' || status === 'past_due') &&
    currentPeriodEnd &&
    !inFuture(currentPeriodEnd)
  ) {
    status = withinGrace(currentPeriodEnd) ? 'past_due' : 'expired';
  }

  // Active term uses the limits snapshotted at purchase (grandfathering);
  // trial and legacy-without-snapshot fall back to the live catalog.
  const snapshotLimits = readSnapshotLimits(m, planId);
  const limits =
    status === 'trialing'
      ? TRIAL_LIMITS
      : (snapshotLimits ?? (planId ? PLAN_LIMITS_BY_ID[planId] : TRIAL_LIMITS));

  return {
    planId,
    planName: planId ? PLAN_NAME_BY_ID[planId] : 'Prueba',
    status,
    limits,
    usage,
    trialEndsAt,
    currentPeriodEnd,
    canManage,
    cancelAtPeriodEnd: m.subscription_cancel_at_period_end === true,
  };
}
