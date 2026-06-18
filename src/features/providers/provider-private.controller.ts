import {
  BadRequestException,
  Body,
  Controller,
  Delete,
  Get,
  Param,
  Patch,
  Post,
  Query,
  Req,
} from '@nestjs/common';
import type { Request } from 'express';
import { SupabaseAdminService } from '../../shared/supabase/supabase-admin.service';
import { ProvidersService } from './providers.service';
import { PostHogService } from '../../shared/posthog/posthog.service';

@Controller('provider')
export class ProviderPrivateController {
  constructor(
    private readonly providersService: ProvidersService,
    private readonly supabaseAdmin: SupabaseAdminService,
    private readonly posthog: PostHogService,
  ) {}

  private async getUser(req: Request) {
    return this.supabaseAdmin.getAuthenticatedUser(req.headers.authorization);
  }

  @Get('dashboard')
  async dashboard(@Req() req: Request) {
    const user = await this.getUser(req);
    return this.providersService.getDashboard(user.id);
  }

  @Get('activity')
  async activity(@Req() req: Request) {
    const user = await this.getUser(req);
    return this.providersService.getActivity(user.id);
  }

  @Get('profile')
  async profile(@Req() req: Request) {
    const user = await this.getUser(req);
    return this.providersService.getProviderProfile(user.id);
  }

  @Patch('profile')
  async updateProfile(
    @Req() req: Request,
    @Body() body: Record<string, unknown>,
  ) {
    const user = await this.getUser(req);
    return this.providersService.updateProviderProfile(user.id, body);
  }

  @Get('staff')
  async staff(@Req() req: Request) {
    const user = await this.getUser(req);
    return this.providersService.listProviderStaff(user.id);
  }

  @Post('staff')
  async createStaff(
    @Req() req: Request,
    @Body() body: Record<string, unknown>,
  ) {
    const user = await this.getUser(req);
    return this.providersService.upsertProviderStaff(user.id, body);
  }

  @Post('staff/invite')
  async inviteStaff(
    @Req() req: Request,
    @Body() body: Record<string, unknown>,
  ) {
    const user = await this.getUser(req);
    return this.providersService.inviteProviderStaff(user.id, body);
  }

  @Patch('staff/:userId')
  async updateStaff(
    @Req() req: Request,
    @Param('userId') userId: string,
    @Body() body: Record<string, unknown>,
  ) {
    const user = await this.getUser(req);
    return this.providersService.updateProviderStaff(user.id, userId, body);
  }

  @Delete('staff/:userId')
  async removeStaff(@Req() req: Request, @Param('userId') userId: string) {
    const user = await this.getUser(req);
    return this.providersService.removeProviderStaff(user.id, userId);
  }

  @Post('staff/:userId/remove')
  async removeStaffPost(@Req() req: Request, @Param('userId') userId: string) {
    const user = await this.getUser(req);
    return this.providersService.removeProviderStaff(user.id, userId);
  }

  @Get('discounts')
  async listDiscounts(@Req() req: Request) {
    const user = await this.getUser(req);
    return this.providersService.listProviderDiscounts(user.id);
  }

  @Post('discounts')
  async createDiscount(
    @Req() req: Request,
    @Body() body: Record<string, unknown>,
  ) {
    const user = await this.getUser(req);
    return this.providersService.createProviderDiscount(user.id, body);
  }

  @Patch('discounts/:id')
  async updateDiscount(
    @Req() req: Request,
    @Param('id') id: string,
    @Body() body: Record<string, unknown>,
  ) {
    const user = await this.getUser(req);
    return this.providersService.updateProviderDiscount(user.id, id, body);
  }

  @Delete('discounts/:id')
  async deleteDiscount(@Req() req: Request, @Param('id') id: string) {
    const user = await this.getUser(req);
    return this.providersService.deleteProviderDiscount(user.id, id);
  }

  @Get('events')
  async listEvents(@Req() req: Request) {
    const user = await this.getUser(req);
    return this.providersService.listProviderEvents(user.id);
  }

  @Get('events/:id')
  async getEvent(@Req() req: Request, @Param('id') id: string) {
    const user = await this.getUser(req);
    return this.providersService.getProviderEvent(user.id, id);
  }

  @Post('events')
  async createEvent(
    @Req() req: Request,
    @Body() body: Record<string, unknown>,
  ) {
    const user = await this.getUser(req);
    const result = await this.providersService.createProviderEvent(
      user.id,
      body,
    );
    this.posthog.capture({
      distinctId: user.id,
      event: 'provider event created',
      properties: {
        event_id:
          result && typeof result === 'object' && 'id' in result
            ? String(result.id)
            : undefined,
      },
    });
    return result;
  }

  @Patch('events/:id')
  async updateEvent(
    @Req() req: Request,
    @Param('id') id: string,
    @Body() body: Record<string, unknown>,
  ) {
    const user = await this.getUser(req);
    return this.providersService.updateProviderEvent(user.id, id, body);
  }

  @Delete('events/:id')
  async deleteEvent(@Req() req: Request, @Param('id') id: string) {
    const user = await this.getUser(req);
    const result = await this.providersService.deleteProviderEvent(user.id, id);
    this.posthog.capture({
      distinctId: user.id,
      event: 'provider event deleted',
      properties: { event_id: id },
    });
    return result;
  }

  @Get('events/:id/ticket-types')
  async listTicketTypes(@Req() req: Request, @Param('id') id: string) {
    const user = await this.getUser(req);
    return this.providersService.listTicketTypesForEvent(user.id, id);
  }

  @Post('events/:id/ticket-types')
  async createTicketType(
    @Req() req: Request,
    @Param('id') id: string,
    @Body() body: Record<string, unknown>,
  ) {
    const user = await this.getUser(req);
    return this.providersService.createTicketType(user.id, id, body);
  }

  @Patch('ticket-types/:id')
  async updateTicketType(
    @Req() req: Request,
    @Param('id') id: string,
    @Body() body: Record<string, unknown>,
  ) {
    const user = await this.getUser(req);
    return this.providersService.updateTicketType(user.id, id, body);
  }

  @Delete('ticket-types/:id')
  async deleteTicketType(@Req() req: Request, @Param('id') id: string) {
    const user = await this.getUser(req);
    return this.providersService.deleteTicketType(user.id, id);
  }

  @Post('scans/preview')
  async previewScan(
    @Req() req: Request,
    @Body() body: Record<string, unknown>,
  ) {
    const user = await this.getUser(req);
    return this.providersService.previewScan(user.id, body);
  }

  @Post('scans/confirm')
  async confirmScan(
    @Req() req: Request,
    @Body() body: Record<string, unknown>,
  ) {
    const user = await this.getUser(req);
    const result = await this.providersService.confirmScan(user.id, body);
    this.posthog.capture({
      distinctId: user.id,
      event: 'ticket scan confirmed',
      properties: {
        event_id: result.eventId,
        ticket_id: result.ticketId,
        status: result.status,
        rejected: result.status !== 'valid',
      },
    });
    return result;
  }

  @Post('scans/validate')
  async validateScan(
    @Req() req: Request,
    @Body() body: Record<string, unknown>,
  ) {
    const user = await this.getUser(req);
    const result = await this.providersService.validateScan(user.id, body);
    // Capture the actual outcome (not just the request) so PostHog can alert
    // on scan rejections — e.g. a spike in `wrong_event` (operator on the
    // wrong event) or `invalid` (fake/garbled codes). Filter on `rejected`
    // or `status` to build the alert.
    this.posthog.capture({
      distinctId: user.id,
      event: 'ticket scan validated',
      properties: {
        event_id: result.eventId,
        ticket_code: result.ticketCode,
        status: result.status,
        verified: result.verified,
        rejected: result.status !== 'valid',
      },
    });
    return result;
  }

  @Get('scans')
  async scans(@Req() req: Request, @Query('eventId') eventId?: string) {
    const user = await this.getUser(req);
    if (eventId && typeof eventId !== 'string') {
      throw new BadRequestException('eventId inválido');
    }
    return this.providersService.getScanRecords(user.id, eventId);
  }

  @Get('payouts')
  async payouts(@Req() req: Request) {
    const user = await this.getUser(req);
    return this.providersService.listPayouts(user.id);
  }

  @Post('payouts')
  async requestPayout(
    @Req() req: Request,
    @Body() body: { amount?: number; method?: string },
  ) {
    const user = await this.getUser(req);
    const result = await this.providersService.requestPayout(user.id, body);
    this.posthog.capture({
      distinctId: user.id,
      event: 'payout requested',
      properties: {
        amount: typeof body.amount === 'number' ? body.amount : undefined,
        method: typeof body.method === 'string' ? body.method : undefined,
      },
    });
    return result;
  }
}
