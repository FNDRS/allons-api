import type {
  Prisma,
  PaymentOrder,
  PaymentOrderStatus,
} from '../../../generated/prisma';

/**
 * Inputs accepted by the repository when creating an order. We mirror
 * only the fields callers should set explicitly — derived fields like
 * `id`, `status`, `createdAt` come from defaults.
 */
export interface CreatePaymentOrderInput {
  userId: string;
  eventId: string;
  entryTypeId?: string | null;
  quantity: number;
  amountCents: number;
  currency?: string;
  paygateLinkId: string;
  expiresAt: Date;
}

/**
 * Which code path drove an order from `pending_payment` to a terminal
 * state. Logged into `payment_orders.resolution_source` for audit and
 * for the admin canary dashboard (`GET /admin/payments/canary`).
 *
 *  - `webhook`  paygate.webhook.controller verified + transitioned
 *  - `polling`  MePaymentsService.getOrder reconciled at poll time
 *  - `cron`     PaymentsReconciliationService nightly sweep
 *  - `manual`   admin override / SQL fix
 */
export type ResolutionSource = 'webhook' | 'polling' | 'cron' | 'manual';

/**
 * Payload passed by the webhook handler (or any other caller) when
 * transitioning an order to a terminal state. The raw webhook is
 * persisted for auditing and for re-running idempotency checks.
 */
export interface TransitionStatusInput {
  status: Exclude<PaymentOrderStatus, 'pending_payment'>;
  paygatePaymentId?: string;
  paygateRawWebhook?: Prisma.InputJsonValue;
  /**
   * Tag of the code path doing the transition. Defaults to `manual`
   * if omitted — callers should always pass an explicit value.
   */
  source?: ResolutionSource;
}

export type { PaymentOrder, PaymentOrderStatus };
