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

@Controller('provider')
export class ProviderPrivateController {
  constructor(
    private readonly providersService: ProvidersService,
    private readonly supabaseAdmin: SupabaseAdminService,
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
  async createEvent(@Req() req: Request, @Body() body: Record<string, unknown>) {
    const user = await this.getUser(req);
    return this.providersService.createProviderEvent(user.id, body);
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
    return this.providersService.deleteProviderEvent(user.id, id);
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

  @Post('scans/validate')
  async validateScan(@Req() req: Request, @Body() body: Record<string, unknown>) {
    const user = await this.getUser(req);
    return this.providersService.validateScan(user.id, body);
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
    return this.providersService.requestPayout(user.id, body as Record<string, unknown>);
  }
}
