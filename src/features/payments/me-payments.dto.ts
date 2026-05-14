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
    description: 'ID del evento para el cual se compran entradas.',
  })
  eventId!: string;

  @ApiPropertyOptional({
    format: 'uuid',
    description:
      'Tipo de entrada (provider_event_ticket_types). Opcional si el evento tiene un solo precio.',
  })
  entryTypeId?: string;

  @ApiPropertyOptional({
    minimum: 1,
    maximum: 20,
    default: 1,
    description: 'Cantidad de entradas (1–20).',
  })
  quantity?: number;

  @ApiPropertyOptional({
    description:
      'Código de referido opcional; si es válido puede aplicar descuento al total.',
    example: 'ABC123',
  })
  referralCode?: string;
}

export class ReferralDiscountAppliedDto {
  @ApiProperty({ description: 'Descuento aplicado en centavos.' })
  cents!: number;
}

export class InitiatePaymentResponseDto {
  @ApiProperty({ format: 'uuid' })
  orderId!: string;

  @ApiProperty({
    description: 'URL del checkout alojado en Paygate (Clinpays).',
    example: 'https://stage.paygate.biz/checkout/...',
  })
  paymentLink!: string;

  @ApiProperty({ description: 'Monto total en centavos.' })
  amountCents!: number;

  @ApiProperty({ example: 'HNL', minLength: 3, maxLength: 3 })
  currency!: string;

  @ApiProperty({
    description: 'ISO 8601 — caducidad del link / ventana de pago.',
  })
  expiresAt!: string;

  @ApiPropertyOptional({
    type: ReferralDiscountAppliedDto,
    nullable: true,
    description: 'Presente si se aplicó descuento por referral.',
  })
  discount!: ReferralDiscountAppliedDto | null;
}

export class PaymentOrderDetailResponseDto {
  @ApiProperty({ format: 'uuid' })
  orderId!: string;

  @ApiProperty({
    enum: PAYMENT_ORDER_STATUSES,
    description:
      'Estado persistido o derivado (p. ej. `cancelled` si expiró estando `pending_payment`).',
  })
  status!: string;

  @ApiProperty()
  amountCents!: number;

  @ApiProperty({ example: 'HNL' })
  currency!: string;

  @ApiProperty({
    type: [String],
    format: 'uuid',
    description: 'IDs de tickets emitidos cuando `status` es `paid`.',
  })
  ticketIds!: string[];

  @ApiProperty({ format: 'uuid' })
  eventId!: string;

  @ApiPropertyOptional({
    nullable: true,
    description: 'ISO 8601 o null.',
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
