// ---------------------------------------------------------------------
// Commission tiers
//
// Allons charges providers a volume-based commission per ticket sold.
// The base app commission shrinks as a provider runs more events per
// month. On top of it sits a per-comercio payment-gateway ("pasarela")
// fee negotiated with Clinpays + the bank by business type (e.g. an NGO
// gets a lower rate than a tech company); it is set in allons-admin and
// stored on the comercio owner's metadata. Percentages are whole numbers
// (e.g. 8 = 8%).
//
// Mirrors `lib/commissionTiers.ts` in allons-mobile and the tier table in
// allons-admin. The effective fee withheld from a sale is
// `getTierByEvents(eventsThisMonth).baseFee + pasarelaFee`.
// ---------------------------------------------------------------------

export type CommissionLevel = 'platino' | 'oro' | 'plata' | 'base';

/**
 * Fallback pasarela fee (%) used when a comercio has no negotiated rate set
 * in admin yet. Overridable via `PLATFORM_PASARELA_FEE_PCT_DEFAULT`.
 */
export const DEFAULT_PASARELA_FEE = 5;

export interface CommissionTier {
  level: CommissionLevel;
  /** Display name, es-HN. */
  name: string;
  /** Human description of the monthly-event volume that earns this tier. */
  eventsLabel: string;
  /** Base app commission for this tier (whole-number percent). */
  baseFee: number;
}

/** Ordered best → worst (lowest → highest commission). */
export const COMMISSION_TIERS: readonly CommissionTier[] = [
  { level: 'platino', name: 'Platino', eventsLabel: 'Más de 8 eventos / mes', baseFee: 8 },
  { level: 'oro', name: 'Oro', eventsLabel: '4 a 8 eventos / mes', baseFee: 10 },
  { level: 'plata', name: 'Plata', eventsLabel: '2 a 3 eventos / mes', baseFee: 12 },
  { level: 'base', name: 'Base / Esporádico', eventsLabel: '1 evento o menos / mes', baseFee: 15 },
];

/**
 * Total commission withheld from a sale = base app commission (volume tier)
 * + the comercio's pasarela fee.
 */
export function totalFee(baseFee: number, pasarelaFee: number): number {
  return +(baseFee + pasarelaFee).toFixed(2);
}

/** Tier earned by a given monthly event volume. */
export function getTierByEvents(eventsPerMonth: number): CommissionTier {
  if (eventsPerMonth > 8) return COMMISSION_TIERS[0];
  if (eventsPerMonth >= 4) return COMMISSION_TIERS[1];
  if (eventsPerMonth >= 2) return COMMISSION_TIERS[2];
  return COMMISSION_TIERS[3];
}
