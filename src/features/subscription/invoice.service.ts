import {
  BadRequestException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { Prisma } from '../../../generated/prisma';
import { PrismaService } from '../../prisma/prisma.service';
import { SubscriptionService } from './subscription.service';
import {
  isPlanId,
  PLAN_CATALOG,
  type ProviderPlanId,
} from './subscription.types';

const ONE_YEAR_MS = 365 * 24 * 60 * 60 * 1000;
const INVOICE_DUE_MS = 7 * 24 * 60 * 60 * 1000;

export interface GenerateInvoiceInput {
  /** Comercio owner's auth user id. */
  userId: string;
  planId: ProviderPlanId;
  /** When true, an upgrade mid-term is prorated against the remaining days. */
  prorate?: boolean;
  notes?: string | null;
  createdBy?: string | null;
}

function priceFor(planId: string): number {
  return PLAN_CATALOG.find((p) => p.id === planId)?.priceCents ?? 0;
}

function makeInvoiceNumber(): string {
  const d = new Date();
  const ymd = `${d.getFullYear()}${String(d.getMonth() + 1).padStart(2, '0')}${String(
    d.getDate(),
  ).padStart(2, '0')}`;
  const rand = Math.random().toString(36).slice(2, 7).toUpperCase();
  return `INV-${ymd}-${rand}`;
}

@Injectable()
export class InvoiceService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly subscription: SubscriptionService,
  ) {}

  /**
   * Creates a pending invoice. All plans are annual. Upgrading mid-term with
   * `prorate` charges only the price difference for the remaining days and
   * keeps the current period end; otherwise it's a full annual term from now.
   */
  async generate(input: GenerateInvoiceInput) {
    if (!isPlanId(input.planId)) {
      throw new BadRequestException('planId inválido');
    }
    const providerId = await this.subscription.resolveProviderId(input.userId);
    if (!providerId) {
      throw new BadRequestException('El usuario no pertenece a un comercio');
    }

    const sub = await this.subscription.getSubscription(input.userId);
    const full = priceFor(input.planId);
    const now = new Date();
    const currentPeriodEnd = sub.currentPeriodEnd
      ? new Date(sub.currentPeriodEnd)
      : null;
    const currentActive =
      sub.status === 'active' &&
      !!sub.planId &&
      !!currentPeriodEnd &&
      currentPeriodEnd.getTime() > now.getTime();
    const currentPrice = sub.planId ? priceFor(sub.planId) : 0;

    let amountCents: number;
    const periodStart = now;
    let periodEnd: Date;
    let prorated = false;

    if (
      input.prorate &&
      currentActive &&
      currentPeriodEnd &&
      full > currentPrice
    ) {
      periodEnd = currentPeriodEnd;
      const remaining = Math.max(0, periodEnd.getTime() - now.getTime());
      amountCents = Math.max(
        0,
        Math.round(((full - currentPrice) * remaining) / ONE_YEAR_MS),
      );
      prorated = true;
    } else {
      periodEnd = new Date(now.getTime() + ONE_YEAR_MS);
      amountCents = full;
    }

    const currency = PLAN_CATALOG.find((p) => p.id === input.planId)!.currency;
    return this.prisma.providerInvoice.create({
      data: {
        invoiceNumber: makeInvoiceNumber(),
        providerId,
        userId: input.userId,
        planId: input.planId,
        billingInterval: 'annual',
        amountCents,
        currency,
        prorated,
        periodStart,
        periodEnd,
        notes: input.notes ?? null,
        dueAt: new Date(now.getTime() + INVOICE_DUE_MS),
        createdBy: input.createdBy ?? null,
      },
    });
  }

  async list(filter: { status?: string; providerId?: string }) {
    const where: Prisma.ProviderInvoiceWhereInput = {};
    if (filter.status) where.status = filter.status;
    if (filter.providerId) where.providerId = filter.providerId;

    const [items, grouped] = await Promise.all([
      this.prisma.providerInvoice.findMany({
        where,
        orderBy: { issuedAt: 'desc' },
        take: 200,
      }),
      this.prisma.providerInvoice.groupBy({
        by: ['status'],
        _sum: { amountCents: true },
        _count: { _all: true },
      }),
    ]);

    const totals = {
      paidCents: 0,
      pendingCents: 0,
      paidCount: 0,
      pendingCount: 0,
    };
    for (const g of grouped) {
      if (g.status === 'paid') {
        totals.paidCents = g._sum.amountCents ?? 0;
        totals.paidCount = g._count._all;
      } else if (g.status === 'pending') {
        totals.pendingCents = g._sum.amountCents ?? 0;
        totals.pendingCount = g._count._all;
      }
    }
    return { items, totals };
  }

  /** Marks a pending invoice paid and activates the plan for its exact term. */
  async markPaid(invoiceId: string) {
    const inv = await this.prisma.providerInvoice.findUnique({
      where: { id: invoiceId },
    });
    if (!inv) throw new NotFoundException('Factura no encontrada');
    if (inv.status === 'paid') return inv; // idempotent
    if (inv.status !== 'pending') {
      throw new BadRequestException('La factura no está pendiente');
    }
    const updated = await this.prisma.providerInvoice.update({
      where: { id: invoiceId },
      data: { status: 'paid', paidAt: new Date() },
    });
    await this.subscription.activateForProvider(
      inv.providerId,
      inv.planId,
      inv.periodEnd.toISOString(),
    );
    return updated;
  }

  async void(invoiceId: string) {
    const inv = await this.prisma.providerInvoice.findUnique({
      where: { id: invoiceId },
    });
    if (!inv) throw new NotFoundException('Factura no encontrada');
    if (inv.status === 'void') return inv;
    if (inv.status !== 'pending') {
      throw new BadRequestException(
        'Solo se pueden anular facturas pendientes',
      );
    }
    return this.prisma.providerInvoice.update({
      where: { id: invoiceId },
      data: { status: 'void' },
    });
  }
}
