import {
  Body,
  Controller,
  Get,
  Param,
  Post,
  Query,
  UseGuards,
} from '@nestjs/common';
import { AdminSecretGuard } from '../admin/admin-secret.guard';
import { InvoiceService } from './invoice.service';
import type { ProviderPlanId } from './subscription.types';

@UseGuards(AdminSecretGuard)
@Controller('admin/invoices')
export class InvoiceAdminController {
  constructor(private readonly invoices: InvoiceService) {}

  @Get()
  list(
    @Query('status') status?: string,
    @Query('providerId') providerId?: string,
  ) {
    return this.invoices.list({ status, providerId });
  }

  @Post()
  generate(
    @Body()
    body: {
      userId: string;
      planId: ProviderPlanId;
      prorate?: boolean;
      notes?: string;
      createdBy?: string;
    },
  ) {
    return this.invoices.generate(body);
  }

  @Post(':id/pay')
  pay(@Param('id') id: string) {
    return this.invoices.markPaid(id);
  }

  @Post(':id/void')
  voidInvoice(@Param('id') id: string) {
    return this.invoices.void(id);
  }
}
