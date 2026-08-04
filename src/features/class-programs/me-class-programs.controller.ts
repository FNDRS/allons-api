import { Controller, Param, Post, Req } from '@nestjs/common';
import {
  ApiBearerAuth,
  ApiOperation,
  ApiParam,
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
}
