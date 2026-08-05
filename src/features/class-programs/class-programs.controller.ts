import {
  BadRequestException,
  Controller,
  Get,
  Param,
  Query,
  Req,
} from '@nestjs/common';
import type { Request } from 'express';
import { parseList } from '../events/events.types';
import { SupabaseAdminService } from '../../shared/supabase/supabase-admin.service';
import { ClassProgramsService } from './class-programs.service';

@Controller()
export class ClassProgramsController {
  constructor(
    private readonly classPrograms: ClassProgramsService,
    private readonly supabaseAdmin: SupabaseAdminService,
  ) {}

  /**
   * Best-effort auth for a public route: a present-but-invalid/expired token
   * degrades to guest instead of failing the request, since browsing a class
   * program never requires an account. Only `getAvailability`'s
   * `alreadyReserved` and `getPublicProgram`'s `myBalance` depend on this.
   */
  private async tryGetUserId(req: Request): Promise<string | null> {
    if (!req.headers.authorization) return null;
    try {
      const user = await this.supabaseAdmin.getAuthenticatedUser(
        req.headers.authorization,
      );
      return user.id;
    } catch {
      return null;
    }
  }

  @Get('providers/:providerId/class-programs')
  listPublicForProvider(@Param('providerId') providerId: string) {
    return this.classPrograms.listPublicPrograms(providerId);
  }

  /**
   * Discovery listing for the client home. Accepts `city` and `cities` in
   * either repeated or comma-separated form, matching the events listing's
   * contract so both feeds can be filtered the same way.
   * Guest-accessible: browsing classes never requires an account.
   */
  @Get('class-programs')
  listDiscovery(
    @Query('city') city?: string | string[],
    @Query('cities') cities?: string | string[],
    @Query('limit') limit?: string,
    @Query('q') q?: string,
  ) {
    const parsedCities = [
      ...new Set([...parseList(city), ...parseList(cities)]),
    ];
    const parsedLimit = limit === undefined ? 20 : Number(limit);
    if (!Number.isFinite(parsedLimit) || parsedLimit < 1) {
      throw new BadRequestException('limit debe ser mayor a 0');
    }
    return this.classPrograms.listDiscoveryPrograms({
      cities: parsedCities,
      limit: Math.min(Math.floor(parsedLimit), 50),
      q,
    });
  }

  @Get('class-programs/:programId')
  async getPublicProgram(
    @Req() req: Request,
    @Param('programId') programId: string,
  ) {
    const userId = await this.tryGetUserId(req);
    return this.classPrograms.getPublicProgram(programId, { userId });
  }

  @Get('class-programs/:programId/availability')
  async getAvailability(
    @Req() req: Request,
    @Param('programId') programId: string,
    @Query('from') from?: string,
    @Query('days') days?: string,
  ) {
    const parsedDays = days === undefined ? 7 : Number(days);
    if (!Number.isFinite(parsedDays) || parsedDays < 1) {
      throw new BadRequestException('days debe ser mayor a 0');
    }
    const userId = await this.tryGetUserId(req);
    return this.classPrograms.getAvailability(programId, {
      from,
      days: Math.min(Math.floor(parsedDays), 31),
      userId,
    });
  }
}
