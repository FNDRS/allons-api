import {
  Body,
  Controller,
  Delete,
  Get,
  Param,
  Post,
  UseGuards,
} from '@nestjs/common';
import { AdminSecretGuard } from '../admin/admin-secret.guard';
import { SubscriptionService } from './subscription.service';

/** Manage the payment deny-list (fraud). */
@UseGuards(AdminSecretGuard)
@Controller('admin/blocklist')
export class BlocklistAdminController {
  constructor(private readonly subscription: SubscriptionService) {}

  @Get()
  list() {
    return this.subscription.listBlocklist();
  }

  @Post()
  add(
    @Body()
    body: {
      email?: string;
      userId?: string;
      reason?: string;
      createdBy?: string;
    },
  ) {
    return this.subscription.addToBlocklist(body);
  }

  @Delete(':id')
  remove(@Param('id') id: string) {
    return this.subscription.removeFromBlocklist(id);
  }
}
