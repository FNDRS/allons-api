import {
  Body,
  Controller,
  Delete,
  Get,
  Param,
  Patch,
  Post,
  Req,
} from '@nestjs/common';
import type { Request } from 'express';
import { SupabaseAdminService } from '../../shared/supabase/supabase-admin.service';
import { ClassProgramsService } from './class-programs.service';

/**
 * No class-level prefix: templates and packages are addressed by their own
 * id under their own top-level path (`provider/class-session-templates/:id`,
 * `provider/class-packages/:id`), not nested under `provider/class-programs`
 * — same shape as the public `ClassProgramsController`.
 */
@Controller()
export class ProviderClassProgramsController {
  constructor(
    private readonly classPrograms: ClassProgramsService,
    private readonly supabaseAdmin: SupabaseAdminService,
  ) {}

  private async getUser(req: Request) {
    return this.supabaseAdmin.getAuthenticatedUser(req.headers.authorization);
  }

  @Get('provider/class-programs')
  async list(@Req() req: Request) {
    const user = await this.getUser(req);
    return this.classPrograms.listProviderPrograms(user.id);
  }

  /**
   * Checks a client in to today's class. `code` carries whatever the scanner
   * read: a signed QR, an unsigned one, a bare reservation id, or a typed
   * `CLS-XXXXXX`.
   *
   * Open to `staff_scanner` as well as owners/admins — scanning at the door is
   * exactly what that role exists for.
   */
  @Post('provider/class-scans')
  async checkIn(@Req() req: Request, @Body() body: Record<string, unknown>) {
    const user = await this.getUser(req);
    return this.classPrograms.checkInClassReservation(user.id, body);
  }

  @Post('provider/class-programs')
  async create(@Req() req: Request, @Body() body: Record<string, unknown>) {
    const user = await this.getUser(req);
    return this.classPrograms.createProviderProgram(user.id, body);
  }

  @Patch('provider/class-programs/:programId')
  async update(
    @Req() req: Request,
    @Param('programId') programId: string,
    @Body() body: Record<string, unknown>,
  ) {
    const user = await this.getUser(req);
    return this.classPrograms.updateProviderProgram(user.id, programId, body);
  }

  @Post('provider/class-programs/:programId/session-templates')
  async createTemplate(
    @Req() req: Request,
    @Param('programId') programId: string,
    @Body() body: Record<string, unknown>,
  ) {
    const user = await this.getUser(req);
    return this.classPrograms.createSessionTemplate(user.id, programId, body);
  }

  @Patch('provider/class-session-templates/:templateId')
  async updateTemplate(
    @Req() req: Request,
    @Param('templateId') templateId: string,
    @Body() body: Record<string, unknown>,
  ) {
    const user = await this.getUser(req);
    return this.classPrograms.updateSessionTemplate(user.id, templateId, body);
  }

  @Delete('provider/class-session-templates/:templateId')
  async deleteTemplate(
    @Req() req: Request,
    @Param('templateId') templateId: string,
  ) {
    const user = await this.getUser(req);
    return this.classPrograms.deactivateSessionTemplate(user.id, templateId);
  }

  @Post('provider/class-programs/:programId/packages')
  async createPackage(
    @Req() req: Request,
    @Param('programId') programId: string,
    @Body() body: Record<string, unknown>,
  ) {
    const user = await this.getUser(req);
    return this.classPrograms.createPackage(user.id, programId, body);
  }

  @Patch('provider/class-packages/:packageId')
  async updatePackage(
    @Req() req: Request,
    @Param('packageId') packageId: string,
    @Body() body: Record<string, unknown>,
  ) {
    const user = await this.getUser(req);
    return this.classPrograms.updatePackage(user.id, packageId, body);
  }

  @Delete('provider/class-packages/:packageId')
  async deletePackage(
    @Req() req: Request,
    @Param('packageId') packageId: string,
  ) {
    const user = await this.getUser(req);
    return this.classPrograms.deactivatePackage(user.id, packageId);
  }
}
