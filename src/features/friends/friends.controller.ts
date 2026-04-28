import {
  BadRequestException,
  Controller,
  Delete,
  Get,
  Param,
  Post,
  Query,
  Req,
} from '@nestjs/common';
import type { Request } from 'express';
import { FriendsService } from './friends.service';
import { SupabaseAdminService } from '../../shared/supabase/supabase-admin.service';

@Controller('me/friends')
export class FriendsController {
  constructor(
    private readonly friendsService: FriendsService,
    private readonly supabaseAdmin: SupabaseAdminService,
  ) {}

  @Get()
  async list(@Req() req: Request, @Query('q') q?: string) {
    const user = await this.supabaseAdmin.getAuthenticatedUser(
      req.headers.authorization,
    );
    return this.friendsService.listFriends(user.id, q);
  }

  @Get('suggestions')
  async suggestions(@Req() req: Request, @Query('q') q?: string) {
    const user = await this.supabaseAdmin.getAuthenticatedUser(
      req.headers.authorization,
    );
    return this.friendsService.listSuggestions(user.id, q);
  }

  @Post(':friendUserId')
  async add(@Req() req: Request, @Param('friendUserId') friendUserId: string) {
    if (!friendUserId) throw new BadRequestException('friendUserId required');
    const user = await this.supabaseAdmin.getAuthenticatedUser(
      req.headers.authorization,
    );
    return this.friendsService.addFriend(user.id, friendUserId);
  }

  @Delete(':friendUserId')
  async remove(
    @Req() req: Request,
    @Param('friendUserId') friendUserId: string,
  ) {
    const user = await this.supabaseAdmin.getAuthenticatedUser(
      req.headers.authorization,
    );
    return this.friendsService.removeFriend(user.id, friendUserId);
  }
}
