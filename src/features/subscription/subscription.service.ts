import {
  BadRequestException,
  ForbiddenException,
  HttpException,
  HttpStatus,
  Injectable,
  Logger,
  NotFoundException,
} from '@nestjs/common';
import { PrismaService } from '../../prisma/prisma.service';
import { SupabaseAdminService } from '../../shared/supabase/supabase-admin.service';
import { PaygateService } from '../paygate/paygate.service';
import type { PaygatePaymentLink } from '../paygate/paygate.types';
import {
  deriveSubscription,
  isPlanId,
  PLAN_CATALOG,
  PLAN_LIMITS_BY_ID,
  RULES_VERSION,
  type ProviderPlan,
  type ProviderPlanId,
  type ProviderPlanLimits,
  type ProviderSubscription,
  type ProviderUsage,
} from './subscription.types';

const ONE_YEAR_MS = 365 * 24 * 60 * 60 * 1000;
/** Give the webhook a head start before polling reconciles against Paygate. */
const RECONCILE_GRACE_MS = 4_000;
const UUID_REGEX =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

type MembershipRole = 'owner' | 'admin' | 'staff_scanner';
interface Membership {
  providerId: string;
  role: MembershipRole;
}

const EMPTY_USAGE: ProviderUsage = { activeEvents: 0, members: 0, staff: 0 };

@Injectable()
export class SubscriptionService {
  private readonly logger = new Logger(SubscriptionService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly supabaseAdmin: SupabaseAdminService,
    private readonly paygate: PaygateService,
  ) {}

  // ---- public reads ----

  getPlans(): ProviderPlan[] {
    return PLAN_CATALOG;
  }

  async getSubscription(userId: string): Promise<ProviderSubscription> {
    const membership = await this.getMembership(userId);
    if (!membership) {
      const callerMeta = await this.getUserMetadata(userId);
      const hasComercioContext = Boolean(
        callerMeta?.comercio_role ??
        callerMeta?.free_trial_end ??
        callerMeta?.subscription_plan ??
        callerMeta?.subscription_status,
      );
      if (!hasComercioContext) {
        throw new ForbiddenException('No tienes acceso provider');
      }
    }

    const providerId = membership?.providerId ?? null;
    const ownerUserId = providerId
      ? ((await this.getOwnerUserId(providerId)) ?? userId)
      : userId;

    const ownerMeta = await this.getUserMetadata(ownerUserId);
    const canManage = membership
      ? membership.role === 'owner'
      : (await this.callerComercioRole(userId, ownerUserId, ownerMeta)) ===
        'admin';

    const usage = providerId
      ? await this.countUsage(providerId)
      : { ...EMPTY_USAGE };

    return deriveSubscription(ownerMeta, usage, canManage);
  }

  // ---- in-app purchase (Paygate) ----

  /** Owner-only: creates a Paygate link + a subscription order for a 1-year term. */
  async initiateSubscription(userId: string, planId: unknown) {
    if (!isPlanId(planId)) {
      throw new BadRequestException('planId inválido');
    }
    const membership = await this.getMembership(userId);
    if (!membership) throw new ForbiddenException('No tienes acceso provider');
    if (membership.role !== 'owner') {
      throw new ForbiddenException(
        'Solo el dueño del comercio puede comprar el plan',
      );
    }
    await this.assertNotBlocked(userId);
    await this.assertInitiateVelocity(membership.providerId);
    const plan = PLAN_CATALOG.find((p) => p.id === planId)!;

    // Proration: upgrading mid-term (active, different & pricier plan) charges
    // only the price difference for the remaining days and keeps the current
    // term end. Otherwise it's a full annual term (periodEnd null → activation
    // sets/extends a year).
    const sub = await this.getSubscription(userId);
    const nowMs = Date.now();
    const currentEndMs = sub.currentPeriodEnd
      ? new Date(sub.currentPeriodEnd).getTime()
      : 0;
    const currentPrice = sub.planId
      ? (PLAN_CATALOG.find((p) => p.id === sub.planId)?.priceCents ?? 0)
      : 0;
    const isUpgrade =
      sub.status === 'active' &&
      sub.planId !== null &&
      sub.planId !== planId &&
      currentEndMs > nowMs &&
      plan.priceCents > currentPrice;

    let amountCents = plan.priceCents;
    let periodEnd: Date | null = null;
    if (isUpgrade) {
      const remaining = currentEndMs - nowMs;
      amountCents = Math.max(
        1,
        Math.round(
          ((plan.priceCents - currentPrice) * remaining) / ONE_YEAR_MS,
        ),
      );
      periodEnd = new Date(currentEndMs);
    }

    const link = await this.paygate.createPaymentLink({
      description: `Suscripción ${plan.name} · Allons`,
      amount: Number((amountCents / 100).toFixed(2)),
      currency: 'HNL',
    });
    const expiresAt = new Date(nowMs + link.expirationHours * 60 * 60 * 1000);

    const order = await this.prisma.providerSubscriptionOrder.create({
      data: {
        providerId: membership.providerId,
        userId,
        planId,
        amountCents,
        currency: link.currency,
        paygateLinkId: link.id,
        periodEnd,
        expiresAt,
      },
    });

    return {
      orderId: order.id,
      paymentLink: link.link,
      amountCents: order.amountCents,
      currency: order.currency,
      expiresAt: (order.expiresAt ?? expiresAt).toISOString(),
    };
  }

  /** Poll target for the mobile checkout; reconciles against Paygate if needed. */
  async getSubscriptionOrder(userId: string, orderId: string) {
    let order = await this.prisma.providerSubscriptionOrder.findUnique({
      where: { id: orderId },
    });
    if (!order) throw new NotFoundException('Orden no encontrada');
    if (order.userId !== userId)
      throw new ForbiddenException('Acceso denegado');

    order = await this.reconcileOrder(order);

    const now = new Date();
    const status =
      order.status === 'pending_payment' &&
      order.expiresAt &&
      order.expiresAt < now
        ? 'cancelled'
        : order.status;

    return {
      orderId: order.id,
      status,
      planId: order.planId,
      amountCents: order.amountCents,
      currency: order.currency,
      expiresAt: order.expiresAt?.toISOString() ?? null,
    };
  }

  /** Called by the Paygate webhook for orders not found in `payment_orders`. */
  async tryFulfillWebhook(input: {
    paygateId: string;
    orderRef: string | null;
    rawStatus: string;
    payload: unknown;
  }): Promise<boolean> {
    const order = await this.findOrderByPaygate(
      input.paygateId,
      input.orderRef,
    );
    if (!order) return false; // not a subscription order — let the webhook continue
    const next = mapPaygateStatus(input.rawStatus);
    if (!next) return true; // ours, but nothing to do for this status
    if (next === 'paid') {
      await this.markOrderPaid(order.id, input.paygateId, input.payload);
      await this.ensureActivated(order.id, order.providerId, order.planId);
    } else if (next === 'refunded') {
      // Refund/chargeback arrives after payment (order already paid), so update
      // unconditionally and revoke access immediately.
      await this.prisma.providerSubscriptionOrder.update({
        where: { id: order.id },
        data: {
          status: 'refunded',
          paygatePaymentId: input.paygateId,
          paygateRawWebhook: input.payload as any,
          updatedAt: new Date(),
        },
      });
      await this.revokeForProvider(order.providerId);
    } else {
      await this.prisma.providerSubscriptionOrder.updateMany({
        where: { id: order.id, status: 'pending_payment' },
        data: {
          status: next,
          paygatePaymentId: input.paygateId,
          paygateRawWebhook: input.payload as any,
          updatedAt: new Date(),
        },
      });
    }
    return true;
  }

  // ---- fraud & limits ----

  /** Blocks initiate when the caller (email or user_id) is on the deny-list. */
  private async assertNotBlocked(userId: string): Promise<void> {
    const user = await this.supabaseAdmin.getUserById(userId);
    const email = user?.email?.toLowerCase() ?? null;
    const rows = await this.prisma.$queryRaw<{ n: number }[]>`
      SELECT count(*)::int AS n FROM payment_blocklist
      WHERE user_id = ${userId}::uuid
         OR (email IS NOT NULL AND lower(email) = ${email})
    `;
    if (Number(rows[0]?.n ?? 0) > 0) {
      throw new ForbiddenException('Pago no permitido para esta cuenta');
    }
  }

  /** Caps pending subscription orders per comercio in a short window. */
  private async assertInitiateVelocity(providerId: string): Promise<void> {
    const since = new Date(Date.now() - 10 * 60 * 1000);
    const recent = await this.prisma.providerSubscriptionOrder.count({
      where: {
        providerId,
        status: 'pending_payment',
        createdAt: { gte: since },
      },
    });
    if (recent >= 3) {
      throw new HttpException(
        'Demasiados intentos de pago; intenta de nuevo en unos minutos',
        HttpStatus.TOO_MANY_REQUESTS,
      );
    }
  }

  /** Revokes access immediately (refund/chargeback/abuse) → status canceled. */
  async revokeForProvider(providerId: string): Promise<void> {
    const ownerUserId = await this.getOwnerUserId(providerId);
    if (!ownerUserId) return;
    const meta = (await this.getUserMetadata(ownerUserId)) ?? {};
    await this.supabaseAdmin.db.auth.admin.updateUserById(ownerUserId, {
      user_metadata: {
        ...meta,
        subscription_status: 'canceled',
        subscription_canceled_at: new Date().toISOString(),
        subscription_cancel_at_period_end: false,
      },
    });
  }

  // ---- blocklist admin ----

  async listBlocklist() {
    return this.prisma.$queryRaw<
      Array<{
        id: string;
        email: string | null;
        userId: string | null;
        reason: string | null;
        createdAt: Date;
      }>
    >`SELECT id, email, user_id AS "userId", reason, created_at AS "createdAt"
      FROM payment_blocklist ORDER BY created_at DESC LIMIT 500`;
  }

  async addToBlocklist(input: {
    email?: string;
    userId?: string;
    reason?: string;
    createdBy?: string;
  }): Promise<{ ok: true }> {
    const email = input.email?.trim().toLowerCase() || null;
    const userId =
      input.userId && UUID_REGEX.test(input.userId) ? input.userId : null;
    if (!email && !userId) {
      throw new BadRequestException('email o userId es requerido');
    }
    const createdBy =
      input.createdBy && UUID_REGEX.test(input.createdBy)
        ? input.createdBy
        : null;
    await this.prisma.$executeRaw`
      INSERT INTO payment_blocklist (email, user_id, reason, created_by)
      VALUES (${email}, ${userId}::uuid, ${input.reason ?? null}, ${createdBy}::uuid)
    `;
    return { ok: true };
  }

  async removeFromBlocklist(id: string): Promise<{ ok: true }> {
    if (!UUID_REGEX.test(id)) throw new BadRequestException('id inválido');
    await this.prisma
      .$executeRaw`DELETE FROM payment_blocklist WHERE id = ${id}::uuid`;
    return { ok: true };
  }

  /** Writes the plan into the owner's user_metadata for a 1-year term. */
  /**
   * Writes the active plan into the owner's user_metadata. With
   * `explicitPeriodEndIso` (paid invoice) the term end is set exactly; without
   * it (Paygate webhook/poll) the term extends a year from the later of now or
   * the current end.
   */
  async activateForProvider(
    providerId: string,
    planId: string,
    explicitPeriodEndIso?: string,
  ): Promise<void> {
    const ownerUserId = await this.getOwnerUserId(providerId);
    if (!ownerUserId) return;
    const meta = (await this.getUserMetadata(ownerUserId)) ?? {};

    let periodEndIso: string;
    if (explicitPeriodEndIso) {
      const explicitMs = new Date(explicitPeriodEndIso).getTime();
      if (!Number.isFinite(explicitMs)) {
        throw new BadRequestException('subscription_period_end inválido');
      }
      periodEndIso = new Date(explicitMs).toISOString();
    } else {
      const now = Date.now();
      const existingEndMs =
        typeof meta.subscription_period_end === 'string'
          ? new Date(meta.subscription_period_end).getTime()
          : NaN;
      const base =
        Number.isFinite(existingEndMs) && existingEndMs > now
          ? existingEndMs
          : now;
      const desiredEndMs = base + ONE_YEAR_MS;
      // Idempotent for duplicate webhook/poll races on the same payment.
      if (
        meta.subscription_status === 'active' &&
        meta.subscription_plan === planId &&
        Number.isFinite(existingEndMs) &&
        existingEndMs >= desiredEndMs - 86_400_000
      ) {
        return;
      }
      periodEndIso = new Date(desiredEndMs).toISOString();
    }

    const userMeta: Record<string, unknown> = {
      ...meta,
      subscription_plan: planId,
      subscription_status: 'active',
      subscription_period_end: periodEndIso,
    };
    // Snapshot the rules in effect at purchase so later catalog changes don't
    // apply retroactively to this term (grandfathering + version-at-purchase).
    if (isPlanId(planId)) {
      userMeta.plan_snapshot = {
        planId,
        limits: PLAN_LIMITS_BY_ID[planId],
        priceCents:
          PLAN_CATALOG.find((p) => p.id === planId)?.priceCents ?? null,
        rulesVersion: RULES_VERSION,
        activatedAt: new Date().toISOString(),
      };
    }
    await this.supabaseAdmin.db.auth.admin.updateUserById(ownerUserId, {
      user_metadata: userMeta,
    });
  }

  /** Read-only list of subscription payment orders + revenue totals (admin). */
  async listOrders(filter: { status?: string }) {
    const rows = await this.prisma.providerSubscriptionOrder.findMany({
      orderBy: { createdAt: 'desc' },
      take: 500,
    });
    let paidCents = 0;
    let paidCount = 0;
    let pendingCount = 0;
    for (const o of rows) {
      if (o.status === 'paid') {
        paidCents += o.amountCents;
        paidCount += 1;
      } else if (o.status === 'pending_payment') {
        pendingCount += 1;
      }
    }
    const filtered = filter.status
      ? rows.filter((o) => o.status === filter.status)
      : rows;
    return {
      items: filtered.map((o) => ({
        id: o.id,
        userId: o.userId,
        providerId: o.providerId,
        planId: o.planId,
        amountCents: o.amountCents,
        currency: o.currency,
        status: o.status,
        periodEnd: o.periodEnd?.toISOString() ?? null,
        createdAt: o.createdAt.toISOString(),
      })),
      totals: { paidCents, paidCount, pendingCount },
    };
  }

  /** Activates the plan when the order is paid, even if another path marked it first. */
  private async ensureActivated(
    orderId: string,
    providerId: string,
    planId: string,
  ): Promise<void> {
    const order = await this.prisma.providerSubscriptionOrder.findUnique({
      where: { id: orderId },
    });
    if (order?.status === 'paid') {
      await this.activateForProvider(
        providerId,
        planId,
        order.periodEnd?.toISOString(),
      );
    }
  }

  private async reconcileOrder<
    T extends {
      id: string;
      status: string;
      paygateLinkId: string | null;
      providerId: string;
      planId: string;
      periodEnd: Date | null;
      createdAt: Date;
      expiresAt: Date | null;
    },
  >(order: T): Promise<T> {
    if (order.status !== 'pending_payment' || !order.paygateLinkId)
      return order;
    const now = Date.now();
    if (now - order.createdAt.getTime() < RECONCILE_GRACE_MS) return order;
    if (order.expiresAt && order.expiresAt.getTime() < now) return order;

    let detail: PaygatePaymentLink;
    try {
      detail = await this.paygate.getPaymentLinkDetail(order.paygateLinkId);
    } catch (err) {
      this.logger.warn(
        `subscription reconcile failed for order=${order.id}: ${String(err)}`,
      );
      return order;
    }
    const paid =
      detail.status?.toUpperCase() === 'PROCESSED' ||
      (detail.numberOfProcesses ?? 0) > 0;
    if (!paid) return order;

    const updated = await this.markOrderPaid(order.id, detail.id, detail);
    if (!updated) {
      await this.ensureActivated(order.id, order.providerId, order.planId);
      return (
        ((await this.prisma.providerSubscriptionOrder.findUnique({
          where: { id: order.id },
        })) as T | null) ?? order
      );
    }
    await this.activateForProvider(
      order.providerId,
      order.planId,
      updated.periodEnd?.toISOString(),
    );
    return updated as unknown as T;
  }

  private async markOrderPaid(
    id: string,
    paygatePaymentId: string,
    raw: unknown,
  ) {
    try {
      const res = await this.prisma.providerSubscriptionOrder.updateMany({
        where: { id, status: 'pending_payment' },
        data: {
          status: 'paid',
          paygatePaymentId,
          paygateRawWebhook: raw as any,
          updatedAt: new Date(),
        },
      });
      if (res.count === 0) return null;
      return this.prisma.providerSubscriptionOrder.findUnique({
        where: { id },
      });
    } catch (err) {
      this.logger.warn(`markOrderPaid failed for order=${id}: ${String(err)}`);
      return null;
    }
  }

  private async findOrderByPaygate(paygateId: string, orderRef: string | null) {
    if (orderRef) {
      if (UUID_REGEX.test(orderRef)) {
        const byId = await this.prisma.providerSubscriptionOrder.findUnique({
          where: { id: orderRef },
        });
        if (byId) return byId;
      }
      const byLink = await this.prisma.providerSubscriptionOrder.findUnique({
        where: { paygateLinkId: orderRef },
      });
      if (byLink) return byLink;
    }
    return (
      (await this.prisma.providerSubscriptionOrder.findUnique({
        where: { paygateLinkId: paygateId },
      })) ??
      (await this.prisma.providerSubscriptionOrder.findUnique({
        where: { paygatePaymentId: paygateId },
      }))
    );
  }

  // ---- enforcement (called from ProvidersService) ----

  /** Throws 402 if publishing another active event exceeds the plan. */
  async assertCanPublishEvent(providerId: string): Promise<void> {
    const { planId, limits } = await this.providerLimits(providerId);
    if (limits.maxActiveEvents === null) return;
    const used = await this.countActiveEvents(providerId);
    if (used >= limits.maxActiveEvents) {
      throw this.limitExceeded(limits.maxActiveEvents, used, planId);
    }
  }

  /** Throws 402 if the event's total tickets would exceed the plan cap. */
  async assertWithinTicketCap(
    providerId: string,
    eventId: string,
    addedTotal: number,
  ): Promise<void> {
    const { planId, limits } = await this.providerLimits(providerId);
    if (limits.maxTicketsPerEvent === null) return;
    const existing = await this.countTicketsForEvent(providerId, eventId);
    const next = existing + Math.max(0, addedTotal);
    if (next > limits.maxTicketsPerEvent) {
      throw this.limitExceeded(limits.maxTicketsPerEvent, existing, planId);
    }
  }

  // ---- helpers ----

  private limitExceeded(
    limit: number,
    used: number,
    planId: ProviderPlanId | null,
  ): HttpException {
    return new HttpException(
      {
        statusCode: HttpStatus.PAYMENT_REQUIRED,
        code: 'limit_exceeded',
        message:
          'Alcanzaste el límite de tu plan. Mejora tu plan para continuar.',
        limit,
        used,
        planId,
      },
      HttpStatus.PAYMENT_REQUIRED,
    );
  }

  private async providerLimits(
    providerId: string,
  ): Promise<{ planId: ProviderPlanId | null; limits: ProviderPlanLimits }> {
    const ownerUserId = await this.getOwnerUserId(providerId);
    const ownerMeta = ownerUserId
      ? await this.getUserMetadata(ownerUserId)
      : null;
    const sub = deriveSubscription(ownerMeta, EMPTY_USAGE, true);
    if (sub.status === 'expired' || sub.status === 'canceled') {
      throw new HttpException(
        {
          statusCode: HttpStatus.PAYMENT_REQUIRED,
          code: 'subscription_expired',
          message: 'Tu suscripción expiró. Selecciona un plan para continuar.',
          planId: sub.planId,
        },
        HttpStatus.PAYMENT_REQUIRED,
      );
    }
    return { planId: sub.planId, limits: sub.limits };
  }

  private async getMembership(userId: string): Promise<Membership | null> {
    const rows = await this.prisma.$queryRaw<Membership[]>`
      SELECT provider_id AS "providerId", role
      FROM provider_members
      WHERE user_id = ${userId}::uuid AND active = true
      ORDER BY
        CASE role WHEN 'owner' THEN 0 WHEN 'admin' THEN 1 ELSE 2 END ASC,
        created_at ASC
      LIMIT 1
    `;
    return rows[0] ?? null;
  }

  private async getOwnerUserId(providerId: string): Promise<string | null> {
    const rows = await this.prisma.$queryRaw<{ userId: string }[]>`
      SELECT user_id AS "userId"
      FROM provider_members
      WHERE provider_id = ${providerId}::uuid AND active = true AND role = 'owner'
      ORDER BY created_at ASC
      LIMIT 1
    `;
    return rows[0]?.userId ?? null;
  }

  private async getUserMetadata(
    userId: string,
  ): Promise<Record<string, unknown> | null> {
    const user = await this.supabaseAdmin.getUserById(userId);
    return user?.user_metadata ?? null;
  }

  private async callerComercioRole(
    callerId: string,
    ownerUserId: string,
    ownerMeta: Record<string, unknown> | null,
  ): Promise<string> {
    const meta =
      callerId === ownerUserId
        ? ownerMeta
        : await this.getUserMetadata(callerId);
    const role = meta?.comercio_role;
    return typeof role === 'string' ? role : 'member';
  }

  private async countActiveEvents(providerId: string): Promise<number> {
    const rows = await this.prisma.$queryRaw<{ count: number }[]>`
      SELECT count(*)::int AS count
      FROM events
      WHERE provider_id = ${providerId}::uuid
        AND status IN ('published', 'sold_out')
    `;
    return Number(rows[0]?.count ?? 0);
  }

  private async countTicketsForEvent(
    providerId: string,
    eventId: string,
  ): Promise<number> {
    const rows = await this.prisma.$queryRaw<{ total: number }[]>`
      SELECT COALESCE(sum(total), 0)::int AS total
      FROM provider_event_ticket_types
      WHERE provider_id = ${providerId}::uuid
        AND event_id = ${eventId}::uuid
        AND active = true
    `;
    return Number(rows[0]?.total ?? 0);
  }

  private async countUsage(providerId: string): Promise<ProviderUsage> {
    const rows = await this.prisma.$queryRaw<
      { active_events: number; members: number; staff: number }[]
    >`
      SELECT
        (SELECT count(*)::int FROM events
          WHERE provider_id = ${providerId}::uuid
            AND status IN ('published', 'sold_out')) AS active_events,
        (SELECT count(*)::int FROM provider_members
          WHERE provider_id = ${providerId}::uuid
            AND active = true AND role = 'admin') AS members,
        (SELECT count(*)::int FROM provider_members
          WHERE provider_id = ${providerId}::uuid
            AND active = true AND role = 'staff_scanner') AS staff
    `;
    const row = rows[0];
    return {
      activeEvents: Number(row?.active_events ?? 0),
      members: Number(row?.members ?? 0),
      staff: Number(row?.staff ?? 0),
    };
  }
}

function mapPaygateStatus(
  status: string,
): 'paid' | 'failed' | 'cancelled' | 'refunded' | null {
  switch (status.toUpperCase()) {
    case 'APPROVED':
      return 'paid';
    case 'DENIED':
      return 'failed';
    case 'CANCELED':
    case 'CANCELLED':
    case 'EXPIRED':
      return 'cancelled';
    case 'REFUNDED':
    case 'REVERSED':
    case 'CHARGEBACK':
    case 'DISPUTED':
      return 'refunded';
    default:
      return null;
  }
}
