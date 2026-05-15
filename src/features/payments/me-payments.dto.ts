import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';

const PAYMENT_ORDER_STATUSES = [
  'pending_payment',
  'paid',
  'failed',
  'cancelled',
  'refunded',
] as const;

export class InitiatePaymentBodyDto {
  @ApiProperty({
    format: 'uuid',
    description: 'Event id tickets are purchased for.',
  })
  eventId!: string;

  @ApiPropertyOptional({
    format: 'uuid',
    description:
      'Ticket tier (`provider_event_ticket_types`). Optional when the event has a single price.',
  })
  entryTypeId?: string;

  @ApiPropertyOptional({
    minimum: 1,
    maximum: 20,
    default: 1,
    description: 'Number of tickets (1–20).',
  })
  quantity?: number;

  @ApiPropertyOptional({
    description:
      'Optional referral code; when valid it may discount the total.',
    example: 'ABC123',
  })
  referralCode?: string;
}

export class ReferralDiscountAppliedDto {
  @ApiProperty({ description: 'Discount applied, in cents.' })
  cents!: number;
}

export class InitiatePaymentResponseDto {
  @ApiProperty({ format: 'uuid' })
  orderId!: string;

  @ApiProperty({
    description: 'Hosted Paygate (Clinpays) checkout URL.',
    example: 'https://stage.paygate.biz/checkout/...',
  })
  paymentLink!: string;

  @ApiProperty({ description: 'Total amount in cents.' })
  amountCents!: number;

  @ApiProperty({ example: 'HNL', minLength: 3, maxLength: 3 })
  currency!: string;

  @ApiProperty({
    description: 'ISO 8601 — link expiry / payment window.',
  })
  expiresAt!: string;

  @ApiPropertyOptional({
    type: ReferralDiscountAppliedDto,
    nullable: true,
    description: 'Present when a referral discount was applied.',
  })
  discount!: ReferralDiscountAppliedDto | null;
}

export class PaymentOrderDetailResponseDto {
  @ApiProperty({ format: 'uuid' })
  orderId!: string;

  @ApiProperty({
    enum: PAYMENT_ORDER_STATUSES,
    description:
      'Persisted or derived status (e.g. `cancelled` if it expired while `pending_payment`).',
  })
  status!: string;

  @ApiProperty()
  amountCents!: number;

  @ApiProperty({ example: 'HNL' })
  currency!: string;

  @ApiProperty({
    type: [String],
    format: 'uuid',
    description: 'Ticket ids issued when `status` is `paid`.',
  })
  ticketIds!: string[];

  @ApiProperty({ format: 'uuid' })
  eventId!: string;

  @ApiPropertyOptional({
    nullable: true,
    description: 'ISO 8601 or null.',
  })
  expiresAt!: string | null;
}

export class PaymentOrderListItemDto {
  @ApiProperty({ format: 'uuid' })
  orderId!: string;

  @ApiProperty({ enum: PAYMENT_ORDER_STATUSES })
  status!: string;

  @ApiProperty()
  amountCents!: number;

  @ApiProperty()
  currency!: string;

  @ApiProperty({ format: 'uuid' })
  eventId!: string;

  @ApiProperty({ description: 'ISO 8601' })
  createdAt!: string;
}

export class PaymentOrderListResponseDto {
  @ApiProperty({ type: [PaymentOrderListItemDto] })
  data!: PaymentOrderListItemDto[];
}
