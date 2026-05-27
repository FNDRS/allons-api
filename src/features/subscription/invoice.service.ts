import {
  BadRequestException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { randomBytes } from 'crypto';
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
const UUID_REGEX =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

function assertUuid(value: string, field: string): void {
  if (!UUID_REGEX.test(value)) {
    throw new BadRequestException(`${field} inválido`);
  }
}

function optionalUuid(
  value: string | null | undefined,
  field: string,
): string | null {
  if (value == null || value === '') return null;
  assertUuid(value, field);
  return value;
}

function isUniqueViolation(err: unknown): boolean {
  return (
    err instanceof Prisma.PrismaClientKnownRequestError && err.code === 'P2002'
  );
}

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
  const rand = randomBytes(4).toString('hex').toUpperCase();
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
    assertUuid(input.userId, 'userId');
    const createdBy = optionalUuid(input.createdBy, 'createdBy');
    // Validates the target is a comercio (throws if no membership and no
    // comercio metadata) and gives the current plan/period for proration.
    const sub = await this.subscription.getSubscription(input.userId);
    // Provision the provider row if the comercio never hit the provider API.
    const providerId = await this.subscription.resolveOrCreateProviderId(
      input.userId,
    );
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
    const data = {
      providerId,
      userId: input.userId,
      planId: input.planId,
      billingInterval: 'annual' as const,
      amountCents,
      currency,
      prorated,
      periodStart,
      periodEnd,
      notes: input.notes ?? null,
      dueAt: new Date(now.getTime() + INVOICE_DUE_MS),
      createdBy,
    };

    for (let attempt = 0; attempt < 3; attempt++) {
      try {
        return await this.prisma.providerInvoice.create({
          data: { ...data, invoiceNumber: makeInvoiceNumber() },
        });
      } catch (err) {
        if (isUniqueViolation(err) && attempt < 2) continue;
        throw err;
      }
    }
    throw new BadRequestException('No se pudo generar el número de factura');
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
        where,
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
    assertUuid(invoiceId, 'invoiceId');
    const inv = await this.prisma.providerInvoice.findUnique({
      where: { id: invoiceId },
    });
    if (!inv) throw new NotFoundException('Factura no encontrada');

    if (inv.status === 'paid') {
      await this.activateForInvoice(inv);
      return inv;
    }
    if (inv.status !== 'pending') {
      throw new BadRequestException('La factura no está pendiente');
    }

    const paidAt = new Date();
    const marked = await this.prisma.providerInvoice.updateMany({
      where: { id: invoiceId, status: 'pending' },
      data: { status: 'paid', paidAt },
    });

    const invoice = await this.prisma.providerInvoice.findUnique({
      where: { id: invoiceId },
    });
    if (!invoice) throw new NotFoundException('Factura no encontrada');
    if (invoice.status !== 'paid') {
      throw new BadRequestException('La factura no está pendiente');
    }

    await this.activateForInvoice(invoice);
    return invoice;
  }

  async void(invoiceId: string) {
    assertUuid(invoiceId, 'invoiceId');
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

  private async activateForInvoice(inv: {
    providerId: string;
    planId: string;
    periodEnd: Date;
  }): Promise<void> {
    await this.subscription.activateForProvider(
      inv.providerId,
      inv.planId,
      inv.periodEnd.toISOString(),
    );
  }
}
