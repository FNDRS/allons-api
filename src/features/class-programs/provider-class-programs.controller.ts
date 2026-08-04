import { Body, Controller, Get, Param, Post, Req } from '@nestjs/common';
import type { Request } from 'express';
import { SupabaseAdminService } from '../../shared/supabase/supabase-admin.service';
import { ClassProgramsService } from './class-programs.service';

@Controller('provider/class-programs')
export class ProviderClassProgramsController {
  constructor(
    private readonly classPrograms: ClassProgramsService,
    private readonly supabaseAdmin: SupabaseAdminService,
  ) {}

  private async getUser(req: Request) {
    return this.supabaseAdmin.getAuthenticatedUser(req.headers.authorization);
  }

  @Get()
  async list(@Req() req: Request) {
    const user = await this.getUser(req);
    return this.classPrograms.listProviderPrograms(user.id);
  }

  @Post()
  async create(@Req() req: Request, @Body() body: Record<string, unknown>) {
    const user = await this.getUser(req);
    return this.classPrograms.createProviderProgram(user.id, body);
  }

  @Post(':programId/session-templates')
  async createTemplate(
    @Req() req: Request,
    @Param('programId') programId: string,
    @Body() body: Record<string, unknown>,
  ) {
    const user = await this.getUser(req);
    return this.classPrograms.createSessionTemplate(user.id, programId, body);
  }

  @Post(':programId/packages')
  async createPackage(
    @Req() req: Request,
    @Param('programId') programId: string,
    @Body() body: Record<string, unknown>,
  ) {
    const user = await this.getUser(req);
    return this.classPrograms.createPackage(user.id, programId, body);
  }
}
