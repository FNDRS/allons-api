import { Injectable, Logger } from '@nestjs/common';
import { Prisma } from '../../../generated/prisma';
import { PrismaService } from '../../prisma/prisma.service';
import { SupabaseAdminService } from '../../shared/supabase/supabase-admin.service';
import { MeService } from '../me/me.service';
import type { PaymentOrder } from './payment-orders.types';

@Injectable()
export class PaymentFulfillmentService {
  private readonly logger = new Logger(PaymentFulfillmentService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly me: MeService,
    private readonly supabaseAdmin: SupabaseAdminService,
  ) {}

  async fulfillPaidOrder(order: PaymentOrder, label: string): Promise<boolean> {
    if (order.status !== 'paid') return false;
    if (order.orderType === 'class_package') {
      return this.createClassPass(order, label);
    }
    return this.createTickets(order, label);
  }

  private async createClassPass(
    order: PaymentOrder,
    label: string,
  ): Promise<boolean> {
    if (!order.classPackageId || !order.classProgramId) {
      this.logger.error(
        `[fulfillment] ${label}: class package order=${order.id} is missing package/program references`,
      );
      return false;
    }

    const existing = await this.prisma.userClassPass.findFirst({
      where: { paymentOrderId: order.id },
      select: { id: true },
    });
    if (existing) return false;

    const item = await this.prisma.classPackage.findUnique({
      where: { id: order.classPackageId },
      include: { program: true },
    });
    if (!item || item.programId !== order.classProgramId) {
      this.logger.error(
        `[fulfillment] ${label}: class package order=${order.id} references missing package=${order.classPackageId}`,
      );
      return false;
    }

    const validFrom = new Date();
    const expiresAt = item.validityDays
      ? addDays(validFrom, item.validityDays)
      : null;
    const credits = item.kind === 'unlimited' ? null : item.credits;

    try {
      await this.prisma.userClassPass.create({
        data: {
          userId: order.userId,
          providerId: item.program.providerId,
          programId: item.programId,
          packageId: item.id,
          paymentOrderId: order.id,
          creditsTotal: credits,
          creditsRemaining: credits,
          validFrom,
          expiresAt,
          status: 'active',
        },
      });
      this.logger.log(
        `[fulfillment] ${label}: created class pass for order=${order.id}`,
      );
      return true;
    } catch (err) {
      if (
        err instanceof Prisma.PrismaClientKnownRequestError &&
        err.code === 'P2002'
      ) {
        return false;
      }
      this.logger.error(
        `[fulfillment] ${label}: class pass creation failed for order=${order.id}: ${
          err instanceof Error ? err.message : String(err)
        }`,
      );
      return false;
    }
  }

  private async createTickets(
    order: PaymentOrder,
    label: string,
  ): Promise<boolean> {
    if (!order.eventId) {
      this.logger.error(
        `[fulfillment] ${label}: ticket order=${order.id} is missing eventId`,
      );
      return false;
    }

    try {
      const eventRow = await this.prisma.event.findUnique({
        where: { id: order.eventId },
      });
      if (!eventRow) {
        this.logger.error(
          `[fulfillment] ${label}: order=${order.id} references missing event=${order.eventId}`,
        );
        return false;
      }

      const sold = await this.prisma.ticket.count({
        where: { eventId: order.eventId, cancelledAt: null },
      });
      if (eventRow.capacity > 0 && sold + order.quantity > eventRow.capacity) {
        this.logger.error(
          `[fulfillment] ${label}: refusing ticket issuance for order=${order.id}; capacity=${eventRow.capacity} sold=${sold} quantity=${order.quantity}`,
        );
        return false;
      }

      const { data } = await this.supabaseAdmin.db.auth.admin.getUserById(
        order.userId,
      );
      const email = data?.user?.email ?? null;
      const meta = data?.user?.user_metadata as { name?: unknown } | null;
      const name = typeof meta?.name === 'string' ? meta.name : null;
      if (!email) {
        this.logger.error(
          `[fulfillment] ${label}: missing email for user=${order.userId} order=${order.id}`,
        );
        return false;
      }

      await this.me.createTicket(order.userId, order.eventId, order.quantity, {
        email,
        name,
        holders: Array.from({ length: order.quantity }, () => ({
          email,
          ...(name ? { name } : {}),
        })),
        paymentOrderId: order.id,
        ticketTypeId: order.entryTypeId,
      });
      this.logger.log(
        `[fulfillment] ${label}: minted ${order.quantity} ticket(s) for order=${order.id}`,
      );
      return true;
    } catch (err) {
      this.logger.error(
        `[fulfillment] ${label}: ticket creation failed for order=${order.id}: ${
          err instanceof Error ? err.message : String(err)
        }`,
      );
      return false;
    }
  }
}

function addDays(date: Date, days: number) {
  const next = new Date(date);
  next.setUTCDate(next.getUTCDate() + days);
  return next;
}
