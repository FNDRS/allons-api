import {
  BadRequestException,
  Body,
  Controller,
  Get,
  Req,
  Put,
} from '@nestjs/common';
import type { Request } from 'express';
import { InterestsService } from './interests.service';
import { SupabaseAdminService } from '../../shared/supabase/supabase-admin.service';

interface UpdateInterestsBody {
  interests?: string[];
}

@Controller('me/interests')
export class InterestsController {
  constructor(
    private readonly interestsService: InterestsService,
    private readonly supabaseAdmin: SupabaseAdminService,
  ) {}

  @Get()
  async list(@Req() req: Request) {
    const user = await this.supabaseAdmin.getAuthenticatedUser(
      req.headers.authorization,
    );
    const interests = await this.interestsService.getUserInterestNames(user.id);
    return { interests };
  }

  @Put()
  async update(@Req() req: Request, @Body() body: UpdateInterestsBody) {
    if (!Array.isArray(body?.interests)) {
      throw new BadRequestException('"interests" must be an array of strings');
    }
    if (body.interests.some((item) => typeof item !== 'string')) {
      throw new BadRequestException('"interests" must contain only strings');
    }

    const user = await this.supabaseAdmin.getAuthenticatedUser(
      req.headers.authorization,
    );
    const interests = await this.interestsService.replaceUserInterests(
      user.id,
      user.user_metadata ?? {},
      body.interests,
    );
    return { interests };
  }
}
