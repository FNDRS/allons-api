import {
  BadRequestException,
  Controller,
  Delete,
  Get,
  Headers,
  Param,
  Post,
  Query,
} from '@nestjs/common';
import { FriendsService } from './friends.service';
import { SupabaseAdminService } from '../supabase-admin.service';

@Controller('me/friends')
export class FriendsController {
  constructor(
    private readonly friendsService: FriendsService,
    private readonly supabaseAdmin: SupabaseAdminService,
  ) {}

  @Get()
  async list(
    @Headers('authorization') authorization?: string,
    @Query('q') q?: string,
  ) {
    const user = await this.supabaseAdmin.getAuthenticatedUser(authorization);
    return this.friendsService.listFriends(user.id, q);
  }

  @Get('suggestions')
  async suggestions(
    @Headers('authorization') authorization?: string,
    @Query('q') q?: string,
  ) {
    const user = await this.supabaseAdmin.getAuthenticatedUser(authorization);
    return this.friendsService.listSuggestions(user.id, q);
  }

  @Post(':friendUserId')
  async add(
    @Headers('authorization') authorization: string | undefined,
    @Param('friendUserId') friendUserId: string,
  ) {
    if (!friendUserId) throw new BadRequestException('friendUserId required');
    const user = await this.supabaseAdmin.getAuthenticatedUser(authorization);
    return this.friendsService.addFriend(user.id, friendUserId);
  }

  @Delete(':friendUserId')
  async remove(
    @Headers('authorization') authorization: string | undefined,
    @Param('friendUserId') friendUserId: string,
  ) {
    const user = await this.supabaseAdmin.getAuthenticatedUser(authorization);
    return this.friendsService.removeFriend(user.id, friendUserId);
  }
}
