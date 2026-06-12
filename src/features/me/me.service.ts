import {
  BadRequestException,
  ForbiddenException,
  Injectable,
  InternalServerErrorException,
  Logger,
  NotFoundException,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { Prisma } from '../../../generated/prisma';
import { PrismaService } from '../../prisma/prisma.service';
import { parseList } from '../events/events.types';
import { attachMinPriceCents } from '../events/events-pricing.util';
import {
  ConversationsService,
  parseMessageBody,
} from '../conversations/conversations.service';
import { MailService } from '../../shared/mail/mail.service';
import { SupabaseAdminService } from '../../shared/supabase/supabase-admin.service';
import { buildTicketQrPayload } from '../providers/ticket-qr.utils';

interface UpdateProfileInput {
  fullName?: string | null;
  location?: string | null;
  avatarUrl?: string | null;
  avatarColor?: string | null;
  notificationSettings?: unknown;
}

type NotificationSettings = {
  push: {
    eventReminders: boolean;
    friendActivity: boolean;
    marketing: boolean;
  };
  inApp: {
    eventReminders: boolean;
    friendActivity: boolean;
    marketing: boolean;
  };
};

const DEFAULT_NOTIFICATION_SETTINGS: NotificationSettings = {
  push: { eventReminders: true, friendActivity: true, marketing: false },
  inApp: { eventReminders: true, friendActivity: true, marketing: false },
};

function coerceNotificationSettings(input: unknown): NotificationSettings {
  if (!input || typeof input !== 'object') return DEFAULT_NOTIFICATION_SETTINGS;
  const obj = input as any;

  function readSection(section: any) {
    return {
      eventReminders:
        typeof section?.eventReminders === 'boolean'
          ? section.eventReminders
          : DEFAULT_NOTIFICATION_SETTINGS.push.eventReminders,
      friendActivity:
        typeof section?.friendActivity === 'boolean'
          ? section.friendActivity
          : DEFAULT_NOTIFICATION_SETTINGS.push.friendActivity,
      marketing:
        typeof section?.marketing === 'boolean'
          ? section.marketing
          : DEFAULT_NOTIFICATION_SETTINGS.push.marketing,
    };
  }

  return {
    push: readSection(obj.push),
    inApp: readSection(obj.inApp),
  };
}

export interface NotificationItemDto {
  id: string;
  categoryLabel: string;
  title: string;
  description: string;
  date: string;
  avatarColor: string;
  relevantTabs: string[];
}

export interface NotificationGroupDto {
  groupLabel: string;
  items: NotificationItemDto[];
}

type ReferralClaimStatus = 'pending' | 'applied' | 'invalidated';

interface ReferralCodeRow {
  owner_user_id: string;
  code: string;
  active: boolean;
}

interface ReferralClaimRow {
  id: string;
  referred_user_id: string;
  referrer_user_id: string;
  code: string;
  status: ReferralClaimStatus;
  captured_at: Date;
  applied_at: Date | null;
  invalid_reason: string | null;
}

interface ReferralBenefitRow {
  id: string;
  claim_id: string;
  referred_user_id: string;
  discount_type: string;
  discount_value: number;
  max_uses: number;
  used_count: number;
  consumed_at: Date | null;
}

interface ReferralEventSummary {
  referredUserId: string;
  status: ReferralClaimStatus;
  capturedAt: string;
  appliedAt: string | null;
}

export interface ReferralSummaryDto {
  enabled: boolean;
  cohortEnabled: boolean;
  myCode: string | null;
  config: {
    discountType: 'fixed_amount';
    discountValueCents: number;
  };
  invited: {
    total: number;
    pending: number;
    applied: number;
    invalidated: number;
    events: ReferralEventSummary[];
  };
  myBenefit: {
    eligible: boolean;
    status: ReferralClaimStatus | null;
    discountValueCents: number;
    consumed: boolean;
  };
}

@Injectable()
export class MeService {
  private readonly logger = new Logger(MeService.name);

  /**
   * Per-process flags so the idempotent `CREATE TABLE IF NOT EXISTS`
   * DDL inside each `ensure*` method only round-trips to the DB on
   * the first invocation. Subsequent calls in the same process skip
   * the DDL entirely. On Supabase's pooled, cross-region setup these
   * round-trips dominate request latency.
   *
   * These booleans are never reset for the lifetime of the process (same
   * tradeoff as `ProvidersService.infraReady`): other instances or a DB
   * restore without redeploy would not self-heal via DDL here — prefer
   * proper migrations for durable schema.
   */
  private infraReady = {
    ticketHolders: false,
    providerRefundPolicies: false,
    providerFollows: false,
    providerSales: false,
    referral: false,
  };

  constructor(
    private readonly prisma: PrismaService,
    private readonly conversationsService: ConversationsService,
    private readonly mailService: MailService,
    private readonly supabaseAdmin: SupabaseAdminService,
    private readonly config: ConfigService,
  ) {}

  /**
   * Wraps an awaited step with a stopwatch + structured log line so we
   * can see exactly where `createTicket` (or any other multi-step
   * service method) is spending its time, including which step throws.
   */
  private async timed<T>(
    correlationId: string,
    step: string,
    work: () => Promise<T>,
  ): Promise<T> {
    const startedAt = Date.now();
    try {
      const result = await work();
      this.logger.log(
        `[${correlationId}] step=${step} ms=${Date.now() - startedAt} ok=true`,
      );
      return result;
    } catch (err) {
      this.logger.error(
        `[${correlationId}] step=${step} ms=${Date.now() - startedAt} ok=false err=${
          err instanceof Error ? err.message : String(err)
        }`,
      );
      throw err;
    }
  }

  async getProfile(
    userId: string,
    email?: string,
    metadata: Record<string, unknown> = {},
  ) {
    const profile = await this.prisma.profile.findUnique({
      where: { userId },
      include: {
        interests: { include: { interest: true } },
      },
    });

    const fallbackName =
      getMetadataString(metadata, 'name') ??
      getMetadataString(metadata, 'full_name');
    const fallbackUsername =
      getMetadataString(metadata, 'username') ??
      getMetadataString(metadata, 'user_name') ??
      getMetadataString(metadata, 'preferred_username');
    const fallbackAvatarUrl =
      getMetadataString(metadata, 'avatar_url') ??
      getMetadataString(metadata, 'picture');
    const fallbackLocation = getMetadataString(metadata, 'location');
    const fallbackAvatarColor = '#787878';

    const profileFullName = nonEmptyOrUndefined(profile?.fullName);
    const profileUsername = nonEmptyOrUndefined(profile?.username);
    const profileAvatarUrl = nonEmptyOrUndefined(profile?.avatarUrl);
    const profileAvatarColor = nonEmptyOrUndefined(profile?.avatarColor);
    const profileLocation = nonEmptyOrUndefined(profile?.location);

    const notificationSettings = coerceNotificationSettings(
      (profile as any)?.notificationSettings,
    );

    return {
      userId,
      email: email ?? null,
      fullName: profileFullName ?? fallbackName ?? null,
      username: profileUsername ?? fallbackUsername ?? null,
      avatarUrl: profileAvatarUrl ?? fallbackAvatarUrl ?? null,
      avatarColor: profileAvatarColor ?? fallbackAvatarColor,
      location: profileLocation ?? fallbackLocation ?? null,
      interests: (profile?.interests ?? []).map((row) => row.interest.name),
      notificationSettings,
    };
  }

  async updateProfile(
    userId: string,
    email: string | undefined,
    input: UpdateProfileInput,
    metadata: Record<string, unknown> = {},
  ) {
    const data: Record<string, unknown> = {};
    if (input.fullName !== undefined) data.fullName = input.fullName;
    if (input.location !== undefined) data.location = input.location;
    if (input.avatarUrl !== undefined) data.avatarUrl = input.avatarUrl;
    if (input.avatarColor !== undefined) data.avatarColor = input.avatarColor;
    if (input.notificationSettings !== undefined) {
      data.notificationSettings = coerceNotificationSettings(
        input.notificationSettings,
      );
    }

    const fallbackName =
      typeof metadata.name === 'string' ? metadata.name : undefined;
    const fallbackUsername =
      typeof metadata.username === 'string' ? metadata.username : undefined;

    await this.prisma.profile.upsert({
      where: { userId },
      create: {
        userId,
        fullName: (data.fullName as string | undefined) ?? fallbackName ?? null,
        username: fallbackUsername ?? null,
        location: (data.location as string | undefined) ?? null,
        avatarUrl: (data.avatarUrl as string | undefined) ?? null,
        avatarColor: (data.avatarColor as string | undefined) ?? null,
      },
      update: { ...data, updatedAt: new Date() },
    });

    return this.getProfile(userId, email, metadata);
  }

  async getReferralSummary(userId: string): Promise<ReferralSummaryDto> {
    await this.ensureReferralTables();
    const config = this.getReferralConfig();
    const cohortEnabled = this.isReferralsEnabledForUser(userId);
    if (!cohortEnabled) {
      return {
        enabled: false,
        cohortEnabled: false,
        myCode: null,
        config,
        invited: {
          total: 0,
          pending: 0,
          applied: 0,
          invalidated: 0,
          events: [],
        },
        myBenefit: {
          eligible: false,
          status: null,
          discountValueCents: config.discountValueCents,
          consumed: false,
        },
      };
    }

    const myCode = await this.getOrCreateReferralCode(userId);
    const invitedRows = await this.prisma.$queryRaw<ReferralClaimRow[]>`
      SELECT id, referred_user_id, referrer_user_id, code, status, captured_at, applied_at, invalid_reason
      FROM customer_referral_claims
      WHERE referrer_user_id = ${userId}::uuid
      ORDER BY captured_at DESC
      LIMIT 30
    `;
    const myClaimRows = await this.prisma.$queryRaw<ReferralClaimRow[]>`
      SELECT id, referred_user_id, referrer_user_id, code, status, captured_at, applied_at, invalid_reason
      FROM customer_referral_claims
      WHERE referred_user_id = ${userId}::uuid
      LIMIT 1
    `;
    const myClaim = myClaimRows[0] ?? null;
    const myBenefitRows = await this.prisma.$queryRaw<ReferralBenefitRow[]>`
      SELECT id, claim_id, referred_user_id, discount_type, discount_value, max_uses, used_count, consumed_at
      FROM customer_referral_benefits
      WHERE referred_user_id = ${userId}::uuid
      LIMIT 1
    `;
    const myBenefit = myBenefitRows[0] ?? null;
    const pendingCount = invitedRows.filter(
      (row) => row.status === 'pending',
    ).length;
    const appliedCount = invitedRows.filter(
      (row) => row.status === 'applied',
    ).length;
    const invalidatedCount = invitedRows.filter(
      (row) => row.status === 'invalidated',
    ).length;

    return {
      enabled: true,
      cohortEnabled: true,
      myCode,
      config,
      invited: {
        total: invitedRows.length,
        pending: pendingCount,
        applied: appliedCount,
        invalidated: invalidatedCount,
        events: invitedRows.map((row) => ({
          referredUserId: row.referred_user_id,
          status: row.status,
          capturedAt: row.captured_at.toISOString(),
          appliedAt: row.applied_at ? row.applied_at.toISOString() : null,
        })),
      },
      myBenefit: {
        eligible:
          myClaim?.status === 'pending' &&
          Boolean(myBenefit) &&
          myBenefit.used_count < myBenefit.max_uses,
        status: myClaim?.status ?? null,
        discountValueCents:
          myBenefit?.discount_value ?? config.discountValueCents,
        consumed: Boolean(
          myBenefit && myBenefit.used_count >= myBenefit.max_uses,
        ),
      },
    };
  }

  async captureReferralCode(userId: string, codeRaw: string) {
    await this.ensureReferralTables();
    if (!this.isReferralsEnabledForUser(userId)) {
      return {
        captured: false,
        status: 'disabled' as const,
        message: 'Referidos no disponibles para esta cuenta en este momento.',
      };
    }

    const code = codeRaw.trim().toUpperCase();
    if (code.length < 4 || code.length > 16) {
      throw new BadRequestException('Código de referido inválido.');
    }

    const matchingRows = await this.prisma.$queryRaw<ReferralCodeRow[]>`
      SELECT owner_user_id, code, active
      FROM customer_referral_codes
      WHERE code = ${code}
      LIMIT 1
    `;
    const referralCode = matchingRows[0];
    if (!referralCode || !referralCode.active) {
      throw new NotFoundException('Código de referido no encontrado.');
    }
    if (referralCode.owner_user_id === userId) {
      throw new BadRequestException('No puedes aplicar tu propio código.');
    }

    const existingClaimRows = await this.prisma.$queryRaw<ReferralClaimRow[]>`
      SELECT id, referred_user_id, referrer_user_id, code, status, captured_at, applied_at, invalid_reason
      FROM customer_referral_claims
      WHERE referred_user_id = ${userId}::uuid
      LIMIT 1
    `;
    const existingClaim = existingClaimRows[0];
    if (existingClaim) {
      return {
        captured: true,
        status: existingClaim.status,
        message: 'Ya existe un referido capturado para esta cuenta.',
      };
    }

    const insertedRows = await this.prisma.$queryRaw<Array<{ id: string }>>`
      INSERT INTO customer_referral_claims (
        referred_user_id,
        referrer_user_id,
        code,
        status,
        captured_at
      )
      VALUES (
        ${userId}::uuid,
        ${referralCode.owner_user_id}::uuid,
        ${code},
        ${'pending'}::text,
        now()
      )
      RETURNING id
    `;
    const claimId = insertedRows[0]?.id;
    if (!claimId) {
      throw new InternalServerErrorException(
        'No se pudo registrar el referido.',
      );
    }
    const config = this.getReferralConfig();
    await this.prisma.$executeRaw`
      INSERT INTO customer_referral_benefits (
        claim_id,
        referred_user_id,
        discount_type,
        discount_value,
        max_uses,
        used_count
      )
      VALUES (
        ${claimId}::uuid,
        ${userId}::uuid,
        ${config.discountType},
        ${config.discountValueCents},
        1,
        0
      )
      ON CONFLICT (referred_user_id) DO NOTHING
    `;
    await this.logReferralEvent(userId, 'capture_success', {
      code,
      referrerUserId: referralCode.owner_user_id,
    });
    return {
      captured: true,
      status: 'pending' as const,
      discountValueCents: config.discountValueCents,
    };
  }

  async getReferralCheckoutPreview(userId: string) {
    await this.ensureReferralTables();
    const config = this.getReferralConfig();
    if (!this.isReferralsEnabledForUser(userId)) {
      return {
        enabled: false,
        eligible: false,
        discountValueCents: 0,
        reason: 'Referidos desactivados para esta cuenta.',
      };
    }
    const ticketsCount = await this.prisma.ticket.count({
      where: { ownerId: userId },
    });
    if (ticketsCount > 0) {
      return {
        enabled: true,
        eligible: false,
        discountValueCents: 0,
        reason: 'El descuento aplica solo en la primera compra de ticket.',
      };
    }
    const claimRows = await this.prisma.$queryRaw<ReferralClaimRow[]>`
      SELECT id, referred_user_id, referrer_user_id, code, status, captured_at, applied_at, invalid_reason
      FROM customer_referral_claims
      WHERE referred_user_id = ${userId}::uuid
      LIMIT 1
    `;
    const claim = claimRows[0];
    if (!claim || claim.status !== 'pending') {
      return {
        enabled: true,
        eligible: false,
        discountValueCents: 0,
        reason: 'No tienes un beneficio de referido pendiente.',
      };
    }
    const benefitRows = await this.prisma.$queryRaw<ReferralBenefitRow[]>`
      SELECT id, claim_id, referred_user_id, discount_type, discount_value, max_uses, used_count, consumed_at
      FROM customer_referral_benefits
      WHERE referred_user_id = ${userId}::uuid
      LIMIT 1
    `;
    const benefit = benefitRows[0];
    if (!benefit || benefit.used_count >= benefit.max_uses) {
      return {
        enabled: true,
        eligible: false,
        discountValueCents: 0,
        reason: 'Este beneficio ya fue consumido.',
      };
    }

    return {
      enabled: true,
      eligible: true,
      discountValueCents: benefit.discount_value ?? config.discountValueCents,
      reason: 'Descuento de referido disponible para esta compra.',
    };
  }

  async listTickets(
    userId: string,
    filters?: {
      cities?: string | string[];
      types?: string | string[];
      email?: string | null;
    },
  ) {
    await this.ensureTicketHoldersTable();
    const cities = parseList(filters?.cities);
    const types = parseList(filters?.types);
    const userEmail = (filters?.email ?? '').trim().toLowerCase();

    const eventFilter =
      cities.length > 0 || types.length > 0
        ? {
            ...(cities.length > 0 ? { city: { in: cities } } : {}),
            ...(types.length > 0
              ? {
                  interests: {
                    some: { interest: { slug: { in: types } } },
                  },
                }
              : {}),
          }
        : undefined;

    const ownedWhere: any = { ownerId: userId };
    if (eventFilter) ownedWhere.event = eventFilter;

    let invitedTicketIds: string[] = [];
    if (userEmail) {
      const rows = await this.prisma.$queryRaw<Array<{ ticket_id: string }>>`
        SELECT ticket_id
        FROM ticket_holders
        WHERE LOWER(holder_email) = ${userEmail}
      `;
      invitedTicketIds = rows.map((r) => r.ticket_id);
    }

    const invitedWhere: any = {
      AND: [
        { id: { in: invitedTicketIds } },
        { ownerId: { not: userId } },
        ...(eventFilter ? [{ event: eventFilter }] : []),
      ],
    };

    const tickets = await this.prisma.ticket.findMany({
      where: {
        AND: [
          invitedTicketIds.length > 0
            ? { OR: [ownedWhere, invitedWhere] }
            : ownedWhere,
          { cancelledAt: null },
        ],
      },
      include: {
        event: {
          include: {
            provider: true,
            interests: { include: { interest: true } },
          },
        },
      },
      orderBy: { createdAt: 'desc' },
    });

    const holdersByTicket = new Map<
      string,
      { holderName: string; holderEmail: string; holderUserId: string | null }
    >();
    for (const ticket of tickets) {
      const rows = await this.prisma.$queryRaw<
        Array<{
          holder_name: string;
          holder_email: string;
          holder_user_id: string | null;
        }>
      >`
        SELECT holder_name, holder_email, holder_user_id
        FROM ticket_holders
        WHERE ticket_id = ${ticket.id}::uuid
        LIMIT 1
      `;
      const row = rows[0];
      if (row) {
        holdersByTicket.set(ticket.id, {
          holderName: row.holder_name,
          holderEmail: row.holder_email,
          holderUserId: row.holder_user_id,
        });
      }
    }

    const normalizedUserEmail = userEmail.trim().toLowerCase();
    const groups = new Map<
      string,
      {
        representative: (typeof tickets)[number];
        representativeHolder?: {
          holderName: string;
          holderEmail: string;
          holderUserId: string | null;
        };
        attendeeEmails: Set<string>;
      }
    >();

    for (const ticket of tickets) {
      const holder = holdersByTicket.get(ticket.id);
      const key = ticket.eventId ?? ticket.id;
      if (!groups.has(key)) {
        groups.set(key, {
          representative: ticket,
          representativeHolder: holder,
          attendeeEmails: new Set<string>(),
        });
      }
      const group = groups.get(key)!;
      const holderEmail = (holder?.holderEmail ?? '').trim().toLowerCase();
      if (holderEmail) group.attendeeEmails.add(holderEmail);

      const currentRepEmail = (group.representativeHolder?.holderEmail ?? '')
        .trim()
        .toLowerCase();
      const isCurrentUsersTicket = holderEmail === normalizedUserEmail;
      const repIsCurrentUsersTicket = currentRepEmail === normalizedUserEmail;
      if (isCurrentUsersTicket && !repIsCurrentUsersTicket) {
        group.representative = ticket;
        group.representativeHolder = holder;
      }
    }

    return Array.from(groups.values()).map((group) => {
      const dto = this.toTicketDto(
        group.representative,
        group.representativeHolder,
      );
      return {
        ...dto,
        attendeeCount: Math.max(group.attendeeEmails.size, 1),
      };
    });
  }

  async createTicket(
    userId: string,
    eventId: string,
    quantity = 1,
    options?: {
      name?: string | null;
      email?: string | null;
      holders?: Array<{ name?: string; email?: string }>;
      referralCode?: string;
      paymentOrderId?: string | null;
    },
  ) {
    const correlationId = `tk-${Date.now().toString(36)}-${Math.random()
      .toString(36)
      .slice(2, 6)}`;
    const startedAt = Date.now();
    this.logger.log(
      `[${correlationId}] createTicket start userId=${userId} eventId=${eventId} quantity=${quantity} hasReferralCode=${Boolean(
        options?.referralCode?.trim(),
      )} paymentOrderId=${options?.paymentOrderId ?? '—'}`,
    );

    await this.timed(correlationId, 'ensureReferralTables', () =>
      this.ensureReferralTables(),
    );
    const referralCodeInput = options?.referralCode?.trim();
    if (referralCodeInput) {
      await this.timed(correlationId, 'captureReferralCode', () =>
        this.captureReferralCode(userId, referralCodeInput).catch(() => null),
      );
    }
    const event = await this.timed(correlationId, 'event.findUnique', () =>
      this.prisma.event.findUnique({ where: { id: eventId } }),
    );
    if (!event) {
      throw new NotFoundException('Evento no encontrado');
    }
    await this.timed(correlationId, 'ensureTicketHoldersTable', () =>
      this.ensureTicketHoldersTable(),
    );
    const existingTicketCount = await this.timed(
      correlationId,
      'ticket.count',
      () => this.prisma.ticket.count({ where: { ownerId: userId } }),
    );

    const providedHolders = options?.holders ?? [];
    if (providedHolders.length > quantity) {
      throw new BadRequestException(
        'La cantidad de asistentes no puede exceder la cantidad de tickets',
      );
    }

    const fallbackName = nonEmptyOrUndefined(options?.name) ?? 'Invitado';
    const fallbackEmail = nonEmptyOrUndefined(options?.email);
    const buyersEmailNorm = fallbackEmail?.trim().toLowerCase() ?? '';
    const holders = Array.from({ length: quantity }, (_, idx) => {
      const holder = providedHolders[idx];
      const name = nonEmptyOrUndefined(holder?.name) ?? fallbackName;
      const email =
        nonEmptyOrUndefined(holder?.email) ??
        (idx === 0 ? fallbackEmail : undefined);
      if (!email) {
        throw new BadRequestException(
          `El correo del asistente es requerido para el ticket ${idx + 1}`,
        );
      }
      const holderUserId =
        fallbackEmail &&
        email.trim().toLowerCase() === fallbackEmail.trim().toLowerCase()
          ? userId
          : null;
      return { name, email, holderUserId };
    });

    const seenEmails = new Set<string>();
    for (const holder of holders) {
      const normalized = holder.email.trim().toLowerCase();
      if (seenEmails.has(normalized)) {
        const isRepeatBuyerEmail =
          Boolean(buyersEmailNorm) && normalized === buyersEmailNorm;
        if (!isRepeatBuyerEmail) {
          throw new BadRequestException(
            'No puedes comprar esta invitación ya tienes una invitación asignada para este evento.',
          );
        }
        continue;
      }
      seenEmails.add(normalized);
    }
    await Promise.all(
      holders.map((holder, i) =>
        this.timed(correlationId, `assertNoDupe[${i}]`, () =>
          this.assertNoDuplicateTicketForEventAndEmail(
            event.id,
            holder.email,
            'purchase',
          ),
        ),
      ),
    );

    // Make sure the provider sales infra exists BEFORE entering the
    // transaction. The DDL is now memoized (no-op after the first call
    // in the process), so this cost is paid once per boot.
    await this.timed(correlationId, 'ensureProviderSalesTables', () =>
      this.ensureProviderSalesTables(),
    );

    // Bundle the 4 writes (+ ticket-type lookup when there's a
    // provider) into a single interactive transaction. The holders
    // insert collapses N round-trips into one VALUES(...) statement
    // and the whole thing is atomic — partial state on failure can't
    // leak (e.g. tickets without holders, or sold_count drift).
    const txResult = await this.timed(correlationId, 'tx.write_bundle', () =>
      this.prisma.$transaction(
        async (tx) => {
          const inserted = await tx.$queryRaw<Array<{ id: string }>>`
          INSERT INTO tickets (
            owner_id,
            event_id,
            payment_order_id,
            title,
            theme_color,
            attendee_count
          )
          SELECT
            ${userId}::uuid,
            ${event.id}::uuid,
            ${options?.paymentOrderId ?? null}::uuid,
            ${event.title},
            ${event.themeColor},
            1
          FROM generate_series(1, ${quantity}::int)
          RETURNING id
        `;
          if (inserted.length === 0) {
            throw new InternalServerErrorException(
              'No se pudo crear el ticket',
            );
          }

          const holderValues = Prisma.join(
            inserted.map((row, i) => {
              const holder = holders[i];
              return Prisma.sql`(
              ${row.id}::uuid,
              ${holder.name},
              ${holder.email},
              ${holder.holderUserId}::uuid,
              ${holder.holderUserId ? new Date() : null}
            )`;
            }),
          );
          await tx.$executeRaw`
          INSERT INTO ticket_holders (
            ticket_id,
            holder_name,
            holder_email,
            holder_user_id,
            accepted_at
          )
          VALUES ${holderValues}
        `;

          let selectedTicketType: { id: string; price: number } | null = null;
          if (event.providerId) {
            const ticketTypeRows = await tx.$queryRaw<
              Array<{ id: string; price: number }>
            >`
            SELECT id, price::float8 AS price
            FROM provider_event_ticket_types
            WHERE event_id = ${event.id}::uuid
              AND active = true
            ORDER BY
              CASE kind
                WHEN 'general' THEN 0
                WHEN 'early' THEN 1
                WHEN 'vip' THEN 2
                ELSE 3
              END ASC,
              created_at ASC
            LIMIT 1
          `;
            selectedTicketType = ticketTypeRows[0] ?? null;

            if (selectedTicketType?.id) {
              await tx.$executeRaw`
              UPDATE provider_event_ticket_types
              SET sold_count = sold_count + ${quantity},
                  updated_at = now()
              WHERE id = ${selectedTicketType.id}::uuid
            `;
            }
            await tx.$executeRaw`
            INSERT INTO provider_activity_log (provider_id, type, message, meta)
            VALUES (
              ${event.providerId}::uuid,
              'sale',
              ${`Venta registrada: ${quantity} ticket(s) para ${event.title}`},
              ${selectedTicketType ? `L. ${Number(selectedTicketType.price).toFixed(2)}` : null}
            )
          `;

            const soldOutRows = await tx.$queryRaw<Array<{ id: string }>>`
            UPDATE events e
            SET status = 'sold_out', updated_at = now()
            WHERE e.id = ${event.id}::uuid
              AND e.status = 'published'
              AND NOT EXISTS (
                SELECT 1
                FROM provider_event_ticket_types t
                WHERE t.event_id = e.id
                  AND t.active = true
                  AND t.total > 0
                  AND t.sold_count < t.total
              )
              AND (
                EXISTS (
                  SELECT 1
                  FROM provider_event_ticket_types t
                  WHERE t.event_id = e.id
                    AND t.active = true
                    AND t.total > 0
                )
                OR (
                  COALESCE(e.capacity, 0) > 0
                  AND (
                    SELECT COUNT(*)::int
                    FROM tickets tk
                    WHERE tk.event_id = e.id
                      AND tk.cancelled_at IS NULL
                  ) >= e.capacity
                )
              )
            RETURNING e.id
          `;
            if (soldOutRows.length > 0) {
              await tx.$executeRaw`
              INSERT INTO provider_activity_log (provider_id, type, message, meta)
              VALUES (
                ${event.providerId}::uuid,
                'event',
                ${`¡Sold out! ${event.title} se agotó`},
                'sold_out'
              )
            `;
            }
          }

          return { inserted, selectedTicketType };
        },
        {
          // Interactive tx defaults (~2s wait / ~5s timeout) are too tight for
          // cross-region pooler latency when several statements run serially.
          maxWait: 10_000,
          timeout: 30_000,
        },
      ),
    );
    const createdRows = txResult.inserted;
    const referralApplied =
      existingTicketCount === 0
        ? await this.timed(correlationId, 'applyReferral', () =>
            this.applyReferralForFirstPaidTicket(userId),
          )
        : null;

    this.logger.log(
      `[${correlationId}] createTicket done totalMs=${Date.now() - startedAt} created=${createdRows.length} referralApplied=${Boolean(referralApplied)}`,
    );

    return {
      createdCount: createdRows.length,
      ticketIds: createdRows.map((row) => row.id),
      holders: holders.map((h) => ({ name: h.name, email: h.email })),
      referral: referralApplied
        ? {
            applied: true,
            discountType: referralApplied.discountType,
            discountValueCents: referralApplied.discountValueCents,
            claimId: referralApplied.claimId,
          }
        : {
            applied: false,
            discountType: 'fixed_amount',
            discountValueCents: 0,
          },
    };
  }

  async getTicketDetails(
    userId: string,
    ticketId: string,
    userEmail?: string | null,
  ) {
    await this.ensureTicketHoldersTable();
    await this.ensureProviderRefundPoliciesTable();

    const ticket = await this.prisma.ticket.findUnique({
      where: { id: ticketId },
      include: {
        event: {
          include: {
            provider: true,
            interests: { include: { interest: true } },
          },
        },
      },
    });
    if (!ticket) {
      throw new NotFoundException('Ticket no encontrado');
    }
    const holderRows = await this.prisma.$queryRaw<
      Array<{
        holder_name: string;
        holder_email: string;
        holder_user_id: string | null;
      }>
    >`
      SELECT holder_name, holder_email, holder_user_id
      FROM ticket_holders
      WHERE ticket_id = ${ticket.id}::uuid
      LIMIT 1
    `;
    const holder = holderRows[0];

    const normalizedUserEmail = (userEmail ?? '').trim().toLowerCase();
    const holderEmail = (holder?.holder_email ?? '').trim().toLowerCase();
    const holderUserId = holder?.holder_user_id ?? null;
    const isOwner = ticket.ownerId === userId;
    const isAssignedByUserId = Boolean(holderUserId) && holderUserId === userId;
    const isAssignedHolder =
      normalizedUserEmail.length > 0 && holderEmail === normalizedUserEmail;

    if (!isOwner && !isAssignedHolder && !isAssignedByUserId) {
      throw new ForbiddenException('El ticket no pertenece al usuario');
    }

    const refundPolicy = await this.getRefundPolicyForProvider(
      ticket.event?.providerId ?? null,
      ticket.event?.startsAt ?? null,
    );

    return {
      ...this.toTicketDto(
        ticket,
        holder
          ? { holderName: holder.holder_name, holderEmail: holder.holder_email }
          : undefined,
      ),
      // Minimal signed payload — no PII. The scanner looks up holder
      // info server-side after verifying the signature.
      qrPayload: buildTicketQrPayload(
        ticket.id,
        ticket.eventId ?? '',
        this.config.get<string>('TICKET_QR_SECRET') ?? null,
      ),
      refundPolicy,
    };
  }

  async cancelTicket(userId: string, ticketId: string) {
    await this.ensureProviderRefundPoliciesTable();

    const ticket = await this.prisma.ticket.findUnique({
      where: { id: ticketId },
      include: { event: true, paymentOrder: true },
    });
    if (!ticket) {
      throw new NotFoundException('Ticket no encontrado');
    }
    if (ticket.ownerId !== userId) {
      throw new ForbiddenException('El ticket no pertenece al usuario');
    }
    if (ticket.cancelledAt) {
      throw new BadRequestException('El ticket ya fue cancelado');
    }

    const refundPolicy = await this.getRefundPolicyForProvider(
      ticket.event?.providerId ?? null,
      ticket.event?.startsAt ?? null,
    );

    // Soft-delete: keep the row so the scanner can show "ticket
    // cancelado" instead of "not found", so sold_count math stays
    // auditable, and so the refund record below has a stable FK target.
    await this.prisma.ticket.update({
      where: { id: ticket.id },
      data: { cancelledAt: new Date() },
    });

    // Audit row: every cancellation produces a refund record, even
    // when the policy says no money goes back. `skipped_policy` is a
    // valid terminal state — it's how we tell "user wanted out and
    // we kept the money per policy" apart from "user wants money
    // back, awaiting processing". Failures here are logged but don't
    // abort: the cancellation already succeeded from the user's
    // perspective.
    if (ticket.paymentOrderId && ticket.paymentOrder) {
      const order = ticket.paymentOrder;
      const perTicketAmount =
        order.quantity > 0
          ? Math.floor(order.amountCents / order.quantity)
          : order.amountCents;
      try {
        await this.prisma.refund.create({
          data: {
            paymentOrderId: order.id,
            ticketId: ticket.id,
            userId,
            amountCents: perTicketAmount,
            currency: order.currency,
            reason: 'user_cancelled',
            status: refundPolicy.eligible ? 'requested' : 'skipped_policy',
            policyEligibleAtRequest: refundPolicy.eligible,
            policyDeadlineHoursAtRequest: refundPolicy.deadlineHours ?? null,
            paygatePaymentId: order.paygatePaymentId ?? null,
          },
        });
      } catch (err) {
        this.logger.warn(
          `cancelTicket: failed to write refund record for ticket=${ticket.id}: ${
            err instanceof Error ? err.message : String(err)
          }`,
        );
      }
    }

    // Surface the cancellation on the provider's activity feed and
    // free the seat back to availability so a new buyer can claim it.
    // Both are best-effort: the ticket delete already succeeded, so a
    // failure here can't be reported as an error to the buyer — the
    // worst case is that the provider sees stale availability and
    // needs a manual reconciliation. Both writes invalidate the
    // realtime feed for the dashboard.
    if (ticket.event?.providerId) {
      await this.ensureProviderSalesTables();
      const eventTitle = ticket.event.title ?? 'evento';

      // Decrement sold_count on the same ticket type the increment
      // ran against in createTicket. We re-run that same ORDER BY so
      // the cancel is the mirror image of the sale: in the common case
      // (one active ticket type, or a "general" + paid types) both
      // pick the same row. `GREATEST(0, ...)` guards against drift if
      // the row is somehow already at 0.
      try {
        await this.prisma.$executeRaw`
          WITH selected_type AS (
            SELECT id
            FROM provider_event_ticket_types
            WHERE event_id = ${ticket.event.id}::uuid
              AND active = true
            ORDER BY
              CASE kind
                WHEN 'general' THEN 0
                WHEN 'early' THEN 1
                WHEN 'vip' THEN 2
                ELSE 3
              END ASC,
              created_at ASC
            LIMIT 1
          )
          UPDATE provider_event_ticket_types
          SET sold_count = GREATEST(0, sold_count - 1),
              updated_at = now()
          WHERE id = (SELECT id FROM selected_type)
        `;
      } catch (err) {
        this.logger.warn(
          `cancelTicket: failed to decrement sold_count for ticket=${ticket.id}: ${
            err instanceof Error ? err.message : String(err)
          }`,
        );
      }

      try {
        await this.prisma.$executeRaw`
          INSERT INTO provider_activity_log (provider_id, type, message, meta)
          VALUES (
            ${ticket.event.providerId}::uuid,
            'cancel',
            ${`Ticket cancelado: ${eventTitle}`},
            ${refundPolicy.eligible ? 'Reembolso aplica' : 'Sin reembolso'}
          )
        `;
      } catch (err) {
        this.logger.warn(
          `cancelTicket: failed to write activity_log for ticket=${ticket.id}: ${
            err instanceof Error ? err.message : String(err)
          }`,
        );
      }
    }

    // If this was the last ticket tied to the payment order, close the
    // order so the paid-without-tickets canary doesn't false-positive
    // and the nightly sweep doesn't try to re-mint what the user just
    // cancelled. Status reflects what happened to the money: refunded
    // when the policy applied, cancelled when the provider kept it.
    if (ticket.paymentOrderId) {
      try {
        const remaining = await this.prisma.ticket.count({
          where: {
            paymentOrderId: ticket.paymentOrderId,
            cancelledAt: null,
          },
        });
        if (remaining === 0) {
          const nextStatus = refundPolicy.eligible ? 'refunded' : 'cancelled';
          await this.prisma.paymentOrder.updateMany({
            where: { id: ticket.paymentOrderId, status: 'paid' },
            data: {
              status: nextStatus,
              resolutionSource: 'manual',
              updatedAt: new Date(),
            },
          });
        }
      } catch (err) {
        this.logger.warn(
          `cancelTicket: failed to close payment_order=${ticket.paymentOrderId} for ticket=${ticket.id}: ${
            err instanceof Error ? err.message : String(err)
          }`,
        );
      }
    }

    return {
      cancelled: true,
      refundEligible: refundPolicy.eligible,
      refundMessage: refundPolicy.eligible
        ? 'La reserva fue cancelada y aplica reembolso.'
        : 'La reserva fue cancelada, pero no aplica reembolso.',
    };
  }

  private async ensureTicketHoldersTable() {
    if (this.infraReady.ticketHolders) return;
    await this.prisma.$executeRaw`
      CREATE TABLE IF NOT EXISTS ticket_holders (
        ticket_id uuid PRIMARY KEY REFERENCES tickets(id) ON DELETE CASCADE,
        holder_name text NOT NULL,
        holder_email text NOT NULL,
        holder_user_id uuid,
        accepted_at timestamptz,
        created_at timestamptz NOT NULL DEFAULT now()
      )
    `;
    await this.prisma.$executeRaw`
      ALTER TABLE ticket_holders
      ADD COLUMN IF NOT EXISTS holder_user_id uuid
    `;
    await this.prisma.$executeRaw`
      ALTER TABLE ticket_holders
      ADD COLUMN IF NOT EXISTS accepted_at timestamptz
    `;
    this.infraReady.ticketHolders = true;
  }

  private async ensureProviderRefundPoliciesTable() {
    if (this.infraReady.providerRefundPolicies) return;
    await this.prisma.$executeRaw`
      CREATE TABLE IF NOT EXISTS provider_refund_policies (
        provider_id uuid PRIMARY KEY REFERENCES providers(id) ON DELETE CASCADE,
        refund_enabled boolean NOT NULL DEFAULT false,
        refund_deadline_hours integer NOT NULL DEFAULT 24,
        updated_at timestamptz NOT NULL DEFAULT now()
      )
    `;
    this.infraReady.providerRefundPolicies = true;
  }

  private async ensureProviderFollowsTable() {
    if (this.infraReady.providerFollows) return;
    await this.prisma.$executeRaw`
      CREATE TABLE IF NOT EXISTS provider_follows (
        user_id uuid NOT NULL,
        provider_id uuid NOT NULL,
        created_at timestamptz NOT NULL DEFAULT now(),
        PRIMARY KEY (user_id, provider_id)
      )
    `;
    this.infraReady.providerFollows = true;
  }

  private async ensureProviderSalesTables() {
    if (this.infraReady.providerSales) return;
    await this.prisma.$executeRaw`
      CREATE TABLE IF NOT EXISTS provider_event_ticket_types (
        id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
        provider_id uuid NOT NULL REFERENCES providers(id) ON DELETE CASCADE,
        event_id uuid NOT NULL REFERENCES events(id) ON DELETE CASCADE,
        name text NOT NULL,
        kind text NOT NULL DEFAULT 'general',
        price numeric(12,2) NOT NULL DEFAULT 0,
        total integer NOT NULL DEFAULT 0,
        sold_count integer NOT NULL DEFAULT 0,
        active boolean NOT NULL DEFAULT true,
        created_at timestamptz NOT NULL DEFAULT now(),
        updated_at timestamptz NOT NULL DEFAULT now()
      )
    `;
    await this.prisma.$executeRaw`
      CREATE TABLE IF NOT EXISTS provider_activity_log (
        id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
        provider_id uuid NOT NULL REFERENCES providers(id) ON DELETE CASCADE,
        type text NOT NULL,
        message text NOT NULL,
        meta text,
        created_at timestamptz NOT NULL DEFAULT now()
      )
    `;
    this.infraReady.providerSales = true;
  }

  private async ensureReferralTables() {
    if (this.infraReady.referral) return;
    await this.prisma.$executeRaw`
      CREATE TABLE IF NOT EXISTS customer_referral_codes (
        owner_user_id uuid PRIMARY KEY,
        code text NOT NULL UNIQUE,
        active boolean NOT NULL DEFAULT true,
        created_at timestamptz NOT NULL DEFAULT now(),
        updated_at timestamptz NOT NULL DEFAULT now()
      )
    `;
    await this.prisma.$executeRaw`
      CREATE TABLE IF NOT EXISTS customer_referral_claims (
        id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
        referred_user_id uuid NOT NULL UNIQUE,
        referrer_user_id uuid NOT NULL,
        code text NOT NULL,
        status text NOT NULL DEFAULT 'pending',
        captured_at timestamptz NOT NULL DEFAULT now(),
        applied_at timestamptz,
        invalid_reason text
      )
    `;
    await this.prisma.$executeRaw`
      CREATE TABLE IF NOT EXISTS customer_referral_benefits (
        id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
        claim_id uuid NOT NULL UNIQUE,
        referred_user_id uuid NOT NULL UNIQUE,
        discount_type text NOT NULL,
        discount_value integer NOT NULL,
        max_uses integer NOT NULL DEFAULT 1,
        used_count integer NOT NULL DEFAULT 0,
        consumed_at timestamptz,
        created_at timestamptz NOT NULL DEFAULT now()
      )
    `;
    await this.prisma.$executeRaw`
      CREATE TABLE IF NOT EXISTS customer_referral_events (
        id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
        user_id uuid NOT NULL,
        event_name text NOT NULL,
        payload jsonb,
        created_at timestamptz NOT NULL DEFAULT now()
      )
    `;
    this.infraReady.referral = true;
  }

  private getReferralConfig() {
    const discountValue = Number(process.env.REFERRAL_DISCOUNT_CENTS ?? 500);
    return {
      discountType: 'fixed_amount' as const,
      discountValueCents: Number.isFinite(discountValue)
        ? Math.max(0, Math.floor(discountValue))
        : 500,
    };
  }

  private isReferralsEnabledForUser(userId: string) {
    const globalFlag = (process.env.REFERRALS_ENABLED ?? 'true')
      .trim()
      .toLowerCase();
    if (globalFlag === 'false') return false;
    const rolloutPercent = Number(process.env.REFERRALS_ROLLOUT_PERCENT ?? 100);
    const pct = Number.isFinite(rolloutPercent)
      ? Math.max(0, Math.min(100, Math.floor(rolloutPercent)))
      : 100;
    if (pct >= 100) return true;
    if (pct <= 0) return false;
    const hash = userId
      .split('')
      .reduce((acc, char) => acc + char.charCodeAt(0), 0);
    return hash % 100 < pct;
  }

  private async getOrCreateReferralCode(userId: string) {
    const rows = await this.prisma.$queryRaw<Array<{ code: string }>>`
      SELECT code
      FROM customer_referral_codes
      WHERE owner_user_id = ${userId}::uuid
      LIMIT 1
    `;
    if (rows[0]?.code) return rows[0].code;

    for (let attempt = 0; attempt < 5; attempt += 1) {
      const nextCode = `AL${Math.random().toString(36).slice(2, 8).toUpperCase()}`;
      const createdRows = await this.prisma.$queryRaw<Array<{ code: string }>>`
        INSERT INTO customer_referral_codes (
          owner_user_id,
          code,
          active,
          created_at,
          updated_at
        )
        VALUES (
          ${userId}::uuid,
          ${nextCode},
          true,
          now(),
          now()
        )
        ON CONFLICT (owner_user_id)
        DO UPDATE SET updated_at = now()
        RETURNING code
      `;
      if (createdRows[0]?.code) return createdRows[0].code;
    }
    throw new InternalServerErrorException(
      'No se pudo generar código de referido.',
    );
  }

  private async applyReferralForFirstPaidTicket(userId: string) {
    if (!this.isReferralsEnabledForUser(userId)) return null;

    const claimRows = await this.prisma.$queryRaw<ReferralClaimRow[]>`
      SELECT id, referred_user_id, referrer_user_id, code, status, captured_at, applied_at, invalid_reason
      FROM customer_referral_claims
      WHERE referred_user_id = ${userId}::uuid
        AND status = ${'pending'}::text
      LIMIT 1
    `;
    const claim = claimRows[0];
    if (!claim) return null;

    const benefitRows = await this.prisma.$queryRaw<ReferralBenefitRow[]>`
      SELECT id, claim_id, referred_user_id, discount_type, discount_value, max_uses, used_count, consumed_at
      FROM customer_referral_benefits
      WHERE referred_user_id = ${userId}::uuid
      LIMIT 1
    `;
    const benefit = benefitRows[0];
    if (!benefit || benefit.used_count >= benefit.max_uses) return null;

    await this.prisma.$executeRaw`
      UPDATE customer_referral_claims
      SET status = ${'applied'}::text,
          applied_at = now(),
          invalid_reason = NULL
      WHERE id = ${claim.id}::uuid
    `;
    await this.prisma.$executeRaw`
      UPDATE customer_referral_benefits
      SET used_count = used_count + 1,
          consumed_at = now()
      WHERE id = ${benefit.id}::uuid
    `;
    await this.logReferralEvent(userId, 'benefit_applied', {
      claimId: claim.id,
      discountValueCents: benefit.discount_value,
    });
    return {
      claimId: claim.id,
      discountType: benefit.discount_type,
      discountValueCents: benefit.discount_value,
    };
  }

  private async logReferralEvent(
    userId: string,
    eventName: string,
    payload?: Record<string, unknown>,
  ) {
    const safePayload = payload ? JSON.stringify(payload) : null;
    await this.prisma.$executeRaw`
      INSERT INTO customer_referral_events (user_id, event_name, payload, created_at)
      VALUES (${userId}::uuid, ${eventName}, ${safePayload}::jsonb, now())
    `;
    this.logger.debug(
      `[referrals] ${eventName} userId=${userId} payload=${safePayload ?? '{}'} `,
    );
  }

  private async getRefundPolicyForProvider(
    providerId: string | null,
    startsAt: Date | null,
  ) {
    if (!providerId) {
      return {
        enabled: false,
        deadlineHours: 24,
        eligible: false,
        reason: 'El evento no tiene proveedor configurado.',
      };
    }
    const rows = await this.prisma.$queryRaw<
      Array<{ refund_enabled: boolean; refund_deadline_hours: number }>
    >`
      SELECT refund_enabled, refund_deadline_hours
      FROM provider_refund_policies
      WHERE provider_id = ${providerId}::uuid
      LIMIT 1
    `;
    const row = rows[0] ?? { refund_enabled: false, refund_deadline_hours: 24 };
    if (!row.refund_enabled) {
      return {
        enabled: false,
        deadlineHours: row.refund_deadline_hours,
        eligible: false,
        reason: 'El proveedor no permite reembolsos.',
      };
    }
    if (!startsAt) {
      return {
        enabled: true,
        deadlineHours: row.refund_deadline_hours,
        eligible: true,
        reason: 'Reembolso habilitado por proveedor.',
      };
    }

    const now = Date.now();
    const cutoff =
      new Date(startsAt).getTime() - row.refund_deadline_hours * 60 * 60 * 1000;
    const eligible = now <= cutoff;
    return {
      enabled: true,
      deadlineHours: row.refund_deadline_hours,
      eligible,
      reason: eligible
        ? `Reembolso disponible hasta ${row.refund_deadline_hours}h antes del evento.`
        : `Ya pasó la ventana de ${row.refund_deadline_hours}h para reembolso.`,
    };
  }

  private toTicketDto(
    ticket: {
      id: string;
      title: string;
      tab: string;
      themeColor: string | null;
      attendeeCount: number;
      eventId: string | null;
      event: {
        id: string;
        title: string;
        city: string | null;
        venue: string | null;
        address: string | null;
        themeColor: string | null;
        provider: unknown;
        interests: { interest: { slug: string } }[];
        smokingAllowed: boolean;
        petFriendly: boolean;
        parkingAvailable: boolean;
        minAge: number | null;
      } | null;
    },
    holder?: {
      holderName: string;
      holderEmail: string;
      holderUserId?: string | null;
    },
  ) {
    return {
      id: ticket.id,
      title: ticket.title,
      tab: ticket.tab,
      color: ticket.themeColor ?? '#2a3a4a',
      attendeeCount: ticket.attendeeCount,
      holderName: holder?.holderName ?? null,
      holderEmail: holder?.holderEmail ?? null,
      eventId: ticket.eventId,
      event: ticket.event
        ? {
            id: ticket.event.id,
            title: ticket.event.title,
            city: ticket.event.city,
            venue: ticket.event.venue,
            address: ticket.event.address,
            themeColor: ticket.event.themeColor,
            provider: ticket.event.provider,
            types: (ticket.event.interests ?? []).map((x) => x.interest.slug),
            smokingAllowed: ticket.event.smokingAllowed,
            petFriendly: ticket.event.petFriendly,
            parkingAvailable: ticket.event.parkingAvailable,
            minAge: ticket.event.minAge,
          }
        : null,
    };
  }

  async listConversations(userId: string) {
    const memberships = await this.prisma.conversationMember.findMany({
      where: { userId },
      include: {
        conversation: {
          include: {
            members: { include: { profile: true } },
            messages: { orderBy: { createdAt: 'desc' }, take: 1 },
          },
        },
      },
    });

    const providerRows = await this.prisma.$queryRaw<Array<{ id: string }>>`
      SELECT id FROM providers
    `;
    const providerIds = new Set(providerRows.map((row) => row.id));

    type ConversationRow = {
      id: string;
      name: string;
      lastMessage: string;
      peerUserId: string | null;
      avatarUrl: string | null;
      avatarColor: string;
      tabs: Array<'amigos' | 'eventos'>;
      lastSenderId: string | null;
      updatedAt: Date;
    };

    const baseRows: Array<ConversationRow | null> = memberships.map(
      ({ conversation }) => {
        const others = conversation.members.filter((m) => m.userId !== userId);
        const peer = others[0]?.profile;
        const peerUserId = peer?.userId ?? null;
        if (peerUserId && providerIds.has(peerUserId)) return null;
        const last = conversation.messages[0];
        const preview = last ? previewFromBody(last.body) : '';
        const tabs: Array<'amigos' | 'eventos'> = last
          ? previewIsEventInvite(last.body)
            ? ['eventos']
            : ['amigos']
          : ['amigos'];

        return {
          id: conversation.id,
          name: peer?.fullName ?? peer?.username ?? 'Conversación',
          lastMessage: preview,
          peerUserId,
          avatarUrl: peer?.avatarUrl ?? null,
          avatarColor: peer?.avatarColor ?? '#5a4a4a',
          tabs,
          lastSenderId: last?.senderId ?? null,
          updatedAt: last?.createdAt ?? conversation.createdAt,
        };
      },
    );

    const visibleRows = baseRows
      .filter((row): row is ConversationRow => row !== null)
      .sort(
        (a, b) =>
          new Date(b.updatedAt).getTime() - new Date(a.updatedAt).getTime(),
      )
      .map(async ({ updatedAt: _updatedAt, lastSenderId: _lastSenderId, ...rest }) => {
        // Read receipts are intentionally disabled (no "mark as read").
        return {
          ...rest,
          unread: false,
        };
      });
    return Promise.all(visibleRows);
  }

  async listNotifications(userId: string) {
    const notifications = await this.prisma.notification.findMany({
      where: { userId },
      orderBy: { createdAt: 'desc' },
    });

    const startOfToday = new Date();
    startOfToday.setHours(0, 0, 0, 0);

    const todayItems: NotificationItemDto[] = [];
    const previousItems: NotificationItemDto[] = [];

    for (const n of notifications) {
      const item: NotificationItemDto = {
        id: n.id,
        categoryLabel: n.categoryLabel ?? '',
        title: n.title,
        description: n.description ?? '',
        date: formatShortDate(n.createdAt),
        avatarColor: '#4a4a5a',
        relevantTabs: n.relevantTabs ?? [],
      };
      if (n.createdAt >= startOfToday) todayItems.push(item);
      else previousItems.push(item);
    }

    const groups: NotificationGroupDto[] = [];
    if (todayItems.length > 0)
      groups.push({ groupLabel: 'Hoy', items: todayItems });
    if (previousItems.length > 0)
      groups.push({ groupLabel: 'Previamente', items: previousItems });

    return groups;
  }

  async listFollowedOrganizerEvents(
    userId: string,
    filters?: {
      cities?: string | string[];
      types?: string | string[];
    },
  ) {
    await this.ensureProviderFollowsTable();
    const providerRows = await this.prisma.$queryRaw<
      Array<{ provider_id: string }>
    >`
      SELECT DISTINCT provider_id
      FROM provider_follows
      WHERE user_id = ${userId}::uuid
    `;
    const providerIds = providerRows.map((row) => row.provider_id);
    if (providerIds.length === 0) return [];

    const cities = parseList(filters?.cities);
    const types = parseList(filters?.types);
    const events = await this.prisma.event.findMany({
      where: {
        providerId: { in: providerIds },
        OR: [{ startsAt: { gte: new Date() } }, { startsAt: null }],
        ...(cities.length > 0 ? { city: { in: cities } } : {}),
        ...(types.length > 0
          ? {
              interests: {
                some: { interest: { slug: { in: types } } },
              },
            }
          : {}),
      },
      include: {
        provider: true,
        interests: { include: { interest: true } },
      },
      orderBy: [{ startsAt: 'asc' }, { createdAt: 'desc' }],
      take: 8,
    });
    const mapped = events.map((event) => ({
      ...event,
      types: (event.interests ?? []).map((x) => x.interest.slug),
    }));
    return attachMinPriceCents(this.prisma, mapped);
  }

  async shareTicketWithUser(
    userId: string,
    args: { ticketId: string; peerUserId: string },
  ) {
    await this.ensureTicketHoldersTable();
    const ticket = await this.prisma.ticket.findUnique({
      where: { id: args.ticketId },
      include: { event: true },
    });
    if (!ticket) throw new NotFoundException('Ticket no encontrado');
    if (ticket.ownerId !== userId) {
      throw new ForbiddenException('El ticket no pertenece al usuario');
    }
    if (ticket.cancelledAt) {
      throw new BadRequestException(
        'No se puede compartir un ticket cancelado',
      );
    }

    const peerAuth = await this.supabaseAdmin.db.auth.admin.getUserById(
      args.peerUserId,
    );
    const peerUser = peerAuth.data?.user;
    const peerEmail = (peerUser?.email ?? '').trim().toLowerCase();
    if (!peerEmail) {
      throw new BadRequestException(
        'No se pudo obtener el correo del usuario invitado.',
      );
    }
    const peerName =
      (typeof peerUser?.user_metadata?.name === 'string'
        ? peerUser.user_metadata.name
        : undefined) ??
      (typeof peerUser?.user_metadata?.full_name === 'string'
        ? peerUser.user_metadata.full_name
        : undefined) ??
      'Invitado';

    await this.assertNoDuplicateTicketForEventAndEmail(
      ticket.eventId,
      peerEmail,
      'accept-invite',
    );

    // Assign this shared ticket holder to the invited Allons user so it appears in "Mis Tickets".
    await this.prisma.$executeRaw`
      INSERT INTO ticket_holders (
        ticket_id,
        holder_name,
        holder_email,
        holder_user_id,
        accepted_at
      )
      VALUES (
        ${ticket.id}::uuid,
        ${peerName},
        ${peerEmail},
        ${args.peerUserId}::uuid,
        NULL
      )
      ON CONFLICT (ticket_id)
      DO UPDATE SET
        holder_name = EXCLUDED.holder_name,
        holder_email = EXCLUDED.holder_email,
        holder_user_id = EXCLUDED.holder_user_id,
        accepted_at = NULL
    `;

    const conv = await this.conversationsService.findOrCreateDirect(
      userId,
      args.peerUserId,
    );
    await this.conversationsService.sendMessage(userId, conv.id, {
      type: 'event_invite',
      text: `Te invité a "${ticket.event?.title ?? ticket.title}".`,
      eventId: ticket.eventId,
      ticketId: ticket.id,
      eventTitle: ticket.event?.title ?? ticket.title,
      eventStartsAt: ticket.event?.startsAt
        ? ticket.event.startsAt.toISOString()
        : null,
    });
    await this.createTicketNotification(
      args.peerUserId,
      'Invitación nueva',
      `Te enviaron una invitación para ${ticket.event?.title ?? ticket.title}.`,
      ['eventos'],
    );
    return { sent: true, conversationId: conv.id };
  }

  async inviteTicketRecipient(
    userId: string,
    args: {
      ticketId: string;
      email: string;
      name?: string | null;
      inviterName?: string | null;
    },
  ) {
    const ticket = await this.prisma.ticket.findUnique({
      where: { id: args.ticketId },
      include: { event: true },
    });
    if (!ticket) throw new NotFoundException('Ticket no encontrado');
    if (ticket.ownerId !== userId) {
      throw new ForbiddenException('El ticket no pertenece al usuario');
    }
    if (ticket.cancelledAt) {
      throw new BadRequestException(
        'No se puede invitar a un ticket cancelado',
      );
    }

    const email = (args.email ?? '').trim().toLowerCase();
    if (!email || !email.includes('@')) {
      throw new BadRequestException('Email inválido');
    }
    await this.assertNoDuplicateTicketForEventAndEmail(
      ticket.eventId,
      email,
      'accept-invite',
    );

    let allonsUserId: string | null = null;
    try {
      const lookup = await this.supabaseAdmin.db.auth.admin.listUsers({
        page: 1,
        perPage: 200,
      });
      const users = (lookup.data?.users ?? []) as Array<{
        id?: string;
        email?: string | null;
      }>;
      const found = users.find((u) => (u.email ?? '').toLowerCase() === email);
      if (found?.id) allonsUserId = found.id;
    } catch {
      allonsUserId = null;
    }

    let conversationId: string | null = null;
    if (allonsUserId) {
      await this.prisma.$executeRaw`
        UPDATE ticket_holders
        SET holder_user_id = ${allonsUserId}::uuid,
            accepted_at = NULL
        WHERE ticket_id = ${ticket.id}::uuid
      `;
      const conv = await this.conversationsService.findOrCreateDirect(
        userId,
        allonsUserId,
      );
      conversationId = conv.id;
      await this.conversationsService.sendMessage(userId, conv.id, {
        type: 'event_invite',
        text: `Te invité a "${ticket.event?.title ?? ticket.title}".`,
        eventId: ticket.eventId,
        ticketId: ticket.id,
        eventTitle: ticket.event?.title ?? ticket.title,
        eventStartsAt: ticket.event?.startsAt
          ? ticket.event.startsAt.toISOString()
          : null,
      });
      await this.createTicketNotification(
        allonsUserId,
        'Invitación nueva',
        `Te enviaron una invitación para ${ticket.event?.title ?? ticket.title}.`,
        ['eventos'],
      );
    }

    const mail = await this.mailService.sendTicketInvitation({
      to: email,
      inviterName: (args.inviterName ?? 'Un amigo').trim() || 'Un amigo',
      eventTitle: ticket.event?.title ?? ticket.title,
      ticketId: ticket.id,
      isAllonsUser: Boolean(allonsUserId),
    });

    return {
      sent: true,
      isAllonsUser: Boolean(allonsUserId),
      conversationId,
      mail,
    };
  }

  async acceptTicketInvitation(
    userId: string,
    userEmail: string | null | undefined,
    ticketId: string,
  ) {
    await this.ensureTicketHoldersTable();
    const rows = await this.prisma.$queryRaw<
      Array<{
        ticket_id: string;
        owner_id: string;
        event_title: string | null;
        holder_email: string;
        holder_user_id: string | null;
        accepted_at: Date | null;
      }>
    >`
      SELECT
        t.id AS ticket_id,
        t.owner_id,
        COALESCE(e.title, t.title) AS event_title,
        th.holder_email,
        th.holder_user_id,
        th.accepted_at
      FROM tickets t
      LEFT JOIN events e ON e.id = t.event_id
      JOIN ticket_holders th ON th.ticket_id = t.id
      WHERE t.id = ${ticketId}::uuid
      LIMIT 1
    `;
    const row = rows[0];
    if (!row) {
      throw new BadRequestException('La invitación caducó.');
    }

    const normalizedUserEmail = (userEmail ?? '').trim().toLowerCase();
    const holderEmail = row.holder_email.trim().toLowerCase();
    const isHolderByUserId =
      Boolean(row.holder_user_id) && row.holder_user_id === userId;
    const isHolderByEmail =
      normalizedUserEmail.length > 0 && normalizedUserEmail === holderEmail;
    if (!isHolderByUserId && !isHolderByEmail) {
      throw new BadRequestException('La invitación caducó.');
    }

    if (!row.accepted_at) {
      await this.prisma.$executeRaw`
        UPDATE ticket_holders
        SET holder_user_id = ${userId}::uuid,
            accepted_at = now()
        WHERE ticket_id = ${ticketId}::uuid
      `;
      if (row.owner_id !== userId) {
        await this.createTicketNotification(
          row.owner_id,
          'Invitación aceptada',
          `Tu invitación para ${row.event_title ?? 'el evento'} fue aceptada.`,
          ['eventos'],
        );
      }
    }
    return { accepted: true, alreadyAccepted: Boolean(row.accepted_at) };
  }

  private async assertNoDuplicateTicketForEventAndEmail(
    eventId: string | null,
    email: string,
    context: 'purchase' | 'accept-invite',
  ) {
    if (!eventId) return;
    const normalizedEmail = email.trim().toLowerCase();
    if (!normalizedEmail) return;

    const rows = await this.prisma.$queryRaw<Array<{ ticket_id: string }>>`
      SELECT t.id AS ticket_id
      FROM tickets t
      JOIN ticket_holders th ON th.ticket_id = t.id
      WHERE t.event_id = ${eventId}::uuid
        AND LOWER(th.holder_email) = ${normalizedEmail}
      LIMIT 1
    `;
    if (rows.length > 0) {
      if (context === 'purchase') {
        throw new BadRequestException(
          'No puedes comprar esta invitación ya tienes una invitación asignada para este evento.',
        );
      }
      throw new BadRequestException(
        'No puedes aceptar esta invitación porque ya tienes una invitación a tu nombre.',
      );
    }
  }

  private async createTicketNotification(
    userId: string,
    title: string,
    description: string,
    tabs: Array<'amigos' | 'eventos' | 'menciones'>,
  ) {
    await this.prisma.$executeRaw`
      INSERT INTO notifications (
        user_id,
        category_label,
        title,
        description,
        relevant_tabs
      )
      VALUES (
        ${userId}::uuid,
        ${'Invitaciones'},
        ${title},
        ${description},
        ${tabs}::notification_tab[]
      )
    `;
  }

  async listEventHistory(userId: string) {
    const tickets = await this.prisma.ticket.findMany({
      where: { ownerId: userId, NOT: { eventId: null }, cancelledAt: null },
      include: { event: true },
      orderBy: { createdAt: 'desc' },
    });

    return tickets
      .filter((t) => t.event)
      .map((t) => ({
        id: t.event!.id,
        title: t.event!.title,
        subtitle: 'Detalles de evento',
        color: t.event!.themeColor ?? t.themeColor ?? '#3f2c44',
      }));
  }
}

function formatShortDate(date: Date) {
  const d = String(date.getDate()).padStart(2, '0');
  const m = String(date.getMonth() + 1).padStart(2, '0');
  return `${d}/${m}`;
}

function previewFromBody(body: string) {
  const payload = parseMessageBody(body);
  if (payload.type === 'event_invite') {
    return payload.text || `Invitación: ${payload.eventTitle ?? 'evento'}`;
  }
  return payload.text ?? '';
}

function previewIsEventInvite(body: string) {
  return parseMessageBody(body).type === 'event_invite';
}

function getMetadataString(metadata: Record<string, unknown>, key: string) {
  const value = metadata[key];
  return typeof value === 'string' && value.trim().length > 0
    ? value.trim()
    : undefined;
}

function nonEmptyOrUndefined(value?: string | null) {
  return typeof value === 'string' && value.trim().length > 0
    ? value.trim()
    : undefined;
}
