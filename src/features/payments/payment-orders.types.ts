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
 * Payload passed by the webhook handler when transitioning an order
 * to a terminal state. The raw webhook is persisted for auditing and
 * for re-running idempotency checks.
 */
export interface TransitionStatusInput {
  status: Exclude<PaymentOrderStatus, 'pending_payment'>;
  paygatePaymentId?: string;
  paygateRawWebhook?: Prisma.InputJsonValue;
}

export type { PaymentOrder, PaymentOrderStatus };
