import {
  BadRequestException,
  Body,
  Controller,
  Delete,
  Get,
  Param,
  Post,
  Query,
  Req,
} from '@nestjs/common';
import {
  ApiBearerAuth,
  ApiOperation,
  ApiParam,
  ApiQuery,
  ApiTags,
} from '@nestjs/swagger';
import { seconds, Throttle } from '@nestjs/throttler';
import type { Request } from 'express';
import { SupabaseAdminService } from '../../shared/supabase/supabase-admin.service';
import { ClassProgramsService } from './class-programs.service';

@ApiTags('me — class programs')
@ApiBearerAuth('bearer')
@Controller('me')
export class MeClassProgramsController {
  constructor(
    private readonly classPrograms: ClassProgramsService,
    private readonly supabaseAdmin: SupabaseAdminService,
  ) {}

  @Post('class-packages/:packageId/payment')
  @Throttle({ 'class-package-payment': { ttl: seconds(60), limit: 10 } })
  @ApiOperation({ summary: 'Start payment for a class package' })
  @ApiParam({ name: 'packageId', format: 'uuid' })
  async initiatePackagePayment(
    @Req() req: Request,
    @Param('packageId') packageId: string,
  ) {
    const user = await this.supabaseAdmin.getAuthenticatedUser(
      req.headers.authorization,
    );
    (req as any).userId = user.id;
    return this.classPrograms.initiatePackagePayment(user.id, packageId);
  }

  @Post('class-packages/:packageId/claim')
  @Throttle({ 'class-package-payment': { ttl: seconds(60), limit: 10 } })
  @ApiOperation({ summary: 'Claim a free class package (price 0)' })
  @ApiParam({ name: 'packageId', format: 'uuid' })
  async claimFreePackage(
    @Req() req: Request,
    @Param('packageId') packageId: string,
  ) {
    const user = await this.supabaseAdmin.getAuthenticatedUser(
      req.headers.authorization,
    );
    (req as any).userId = user.id;
    return this.classPrograms.claimFreePackage(user.id, packageId);
  }

  @Get('class-passes')
  @ApiOperation({ summary: "List the caller's usable class passes" })
  @ApiQuery({ name: 'providerId', required: false, format: 'uuid' })
  @ApiQuery({ name: 'programId', required: false, format: 'uuid' })
  async listMyClassPasses(
    @Req() req: Request,
    @Query('providerId') providerId?: string,
    @Query('programId') programId?: string,
  ) {
    const user = await this.supabaseAdmin.getAuthenticatedUser(
      req.headers.authorization,
    );
    (req as any).userId = user.id;
    return this.classPrograms.listMyClassPasses(user.id, {
      providerId,
      programId,
    });
  }

  @Get('class-reservations')
  @ApiOperation({ summary: "List the caller's class reservations" })
  @ApiQuery({ name: 'scope', required: false, enum: ['upcoming', 'past', 'all'] })
  @ApiQuery({ name: 'limit', required: false, type: Number })
  async listMyReservations(
    @Req() req: Request,
    @Query('scope') scope?: string,
    @Query('limit') limit?: string,
  ) {
    const user = await this.supabaseAdmin.getAuthenticatedUser(
      req.headers.authorization,
    );
    (req as any).userId = user.id;
    const parsedLimit = limit === undefined ? undefined : Number(limit);
    if (parsedLimit !== undefined && !Number.isFinite(parsedLimit)) {
      throw new BadRequestException('limit debe ser un número');
    }
    return this.classPrograms.listMyReservations(user.id, {
      scope,
      limit: parsedLimit,
    });
  }

  @Post('class-reservations')
  @Throttle({ 'class-reservation-create': { ttl: seconds(60), limit: 20 } })
  @ApiOperation({ summary: 'Reserve a class session using an active pass' })
  async createReservation(
    @Req() req: Request,
    @Body() body: Record<string, unknown>,
  ) {
    const user = await this.supabaseAdmin.getAuthenticatedUser(
      req.headers.authorization,
    );
    (req as any).userId = user.id;
    return this.classPrograms.createReservation(user.id, body);
  }

  @Delete('class-reservations/:reservationId')
  @Throttle({ 'class-reservation-cancel': { ttl: seconds(60), limit: 20 } })
  @ApiOperation({ summary: 'Cancel a class reservation' })
  @ApiParam({ name: 'reservationId', format: 'uuid' })
  async cancelReservation(
    @Req() req: Request,
    @Param('reservationId') reservationId: string,
  ) {
    const user = await this.supabaseAdmin.getAuthenticatedUser(
      req.headers.authorization,
    );
    (req as any).userId = user.id;
    return this.classPrograms.cancelReservation(user.id, reservationId);
  }
}
