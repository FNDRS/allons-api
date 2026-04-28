import {
  BadRequestException,
  Body,
  Controller,
  Get,
  Headers,
  Param,
  Post,
} from '@nestjs/common';
import { ConversationsService } from './conversations.service';
import type { MessagePayload } from './conversations.service';
import { SupabaseAdminService } from '../supabase-admin.service';

@Controller('me/conversations')
export class ConversationsController {
  constructor(
    private readonly conversationsService: ConversationsService,
    private readonly supabaseAdmin: SupabaseAdminService,
  ) {}

  @Post()
  async createOrFind(
    @Headers('authorization') authorization: string | undefined,
    @Body() body: { peerUserId?: string },
  ) {
    const user = await this.supabaseAdmin.getAuthenticatedUser(authorization);
    const peerUserId = body?.peerUserId;
    if (!peerUserId || typeof peerUserId !== 'string') {
      throw new BadRequestException('peerUserId is required');
    }
    const conv = await this.conversationsService.findOrCreateDirect(
      user.id,
      peerUserId,
    );
    return { id: conv.id };
  }

  @Get(':conversationId')
  async getOne(
    @Headers('authorization') authorization: string | undefined,
    @Param('conversationId') conversationId: string,
  ) {
    const user = await this.supabaseAdmin.getAuthenticatedUser(authorization);
    return this.conversationsService.getConversation(user.id, conversationId);
  }

  @Post(':conversationId/messages')
  async sendMessage(
    @Headers('authorization') authorization: string | undefined,
    @Param('conversationId') conversationId: string,
    @Body() body: MessagePayload,
  ) {
    const user = await this.supabaseAdmin.getAuthenticatedUser(authorization);
    if (!body || typeof body !== 'object') {
      throw new BadRequestException('Payload required');
    }
    return this.conversationsService.sendMessage(user.id, conversationId, body);
  }
}
