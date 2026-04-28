import {
  BadRequestException,
  Body,
  Controller,
  Get,
  Param,
  Post,
  Req,
} from '@nestjs/common';
import type { Request } from 'express';
import { ConversationsService } from './conversations.service';
import type { MessagePayload } from './conversations.service';
import { SupabaseAdminService } from '../../shared/supabase/supabase-admin.service';

@Controller('me/conversations')
export class ConversationsController {
  constructor(
    private readonly conversationsService: ConversationsService,
    private readonly supabaseAdmin: SupabaseAdminService,
  ) {}

  @Post()
  async createOrFind(
    @Req() req: Request,
    @Body() body: { peerUserId?: string },
  ) {
    const user = await this.supabaseAdmin.getAuthenticatedUser(
      req.headers.authorization,
    );
    const peerUserId = body?.peerUserId;
    if (!peerUserId || typeof peerUserId !== 'string') {
      throw new BadRequestException('peerUserId es requerido');
    }
    const conv = await this.conversationsService.findOrCreateDirect(
      user.id,
      peerUserId,
    );
    return { id: conv.id };
  }

  @Get(':conversationId')
  async getOne(
    @Req() req: Request,
    @Param('conversationId') conversationId: string,
  ) {
    const user = await this.supabaseAdmin.getAuthenticatedUser(
      req.headers.authorization,
    );
    return this.conversationsService.getConversation(user.id, conversationId);
  }

  @Post(':conversationId/messages')
  async sendMessage(
    @Req() req: Request,
    @Param('conversationId') conversationId: string,
    @Body() body: MessagePayload,
  ) {
    const user = await this.supabaseAdmin.getAuthenticatedUser(
      req.headers.authorization,
    );
    if (!body || typeof body !== 'object') {
      throw new BadRequestException('Payload es requerido');
    }
    return this.conversationsService.sendMessage(user.id, conversationId, body);
  }
}
