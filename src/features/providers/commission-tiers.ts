// ---------------------------------------------------------------------
// Commission by plan
//
// Allons charges providers a base app commission per ticket sold, tied to
// their subscription plan: the higher-volume plans pay a lower base
// (Pro 8% < Básico 12% < Evento Único 15%). On top of it sits a
// per-comercio payment-gateway ("pasarela") fee negotiated with Clinpays +
// the bank by business type, set in allons-admin. Percentages are whole
// numbers (e.g. 8 = 8%).
//
// Mirrors `lib/commissionTiers.ts` in allons-mobile and the plan table in
// allons-admin. The effective fee withheld from a sale is
// `getBaseFeeByPlan(plan) + pasarelaFee`.
// ---------------------------------------------------------------------

export type ProviderPlanId = 'single_event' | 'basico' | 'pro';

/**
 * Fallback pasarela fee (%) used when a comercio has no negotiated rate set
 * in admin yet. Overridable via `PLATFORM_PASARELA_FEE_PCT_DEFAULT`.
 */
export const DEFAULT_PASARELA_FEE = 5;

export interface PlanCommission {
  plan: ProviderPlanId;
  /** Display name, es-HN. */
  name: string;
  /** Base app commission for this plan (whole-number percent). */
  baseFee: number;
}

/** Ordered cheapest → most expensive base commission. */
export const PLAN_COMMISSIONS: readonly PlanCommission[] = [
  { plan: 'pro', name: 'Pro', baseFee: 8 },
  { plan: 'basico', name: 'Básico', baseFee: 12 },
  { plan: 'single_event', name: 'Evento Único', baseFee: 15 },
];

/** Base app commission (%) during the free trial (no plan chosen yet). */
export const TRIAL_BASE_FEE = 12;

/** Base app commission % for a subscription plan. Trial/unknown → trial rate. */
export function getBaseFeeByPlan(plan: string | null | undefined): number {
  return PLAN_COMMISSIONS.find((p) => p.plan === plan)?.baseFee ?? TRIAL_BASE_FEE;
}

/** Human label for a plan id (trial/unknown → "Prueba"). */
export function planLabel(plan: string | null | undefined): string {
  return PLAN_COMMISSIONS.find((p) => p.plan === plan)?.name ?? 'Prueba';
}

/**
 * Total commission withheld from a sale = base app commission (by plan) + the
 * comercio's pasarela fee.
 */
export function totalFee(baseFee: number, pasarelaFee: number): number {
  return +(baseFee + pasarelaFee).toFixed(2);
}
