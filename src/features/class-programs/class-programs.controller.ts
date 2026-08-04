import {
  BadRequestException,
  Controller,
  Get,
  Param,
  Query,
} from '@nestjs/common';
import { ClassProgramsService } from './class-programs.service';

@Controller()
export class ClassProgramsController {
  constructor(private readonly classPrograms: ClassProgramsService) {}

  @Get('providers/:providerId/class-programs')
  listPublicForProvider(@Param('providerId') providerId: string) {
    return this.classPrograms.listPublicPrograms(providerId);
  }

  @Get('class-programs/:programId')
  getPublicProgram(@Param('programId') programId: string) {
    return this.classPrograms.getPublicProgram(programId);
  }

  @Get('class-programs/:programId/availability')
  getAvailability(
    @Param('programId') programId: string,
    @Query('from') from?: string,
    @Query('days') days?: string,
  ) {
    const parsedDays = days === undefined ? 7 : Number(days);
    if (!Number.isFinite(parsedDays) || parsedDays < 1) {
      throw new BadRequestException('days debe ser mayor a 0');
    }
    return this.classPrograms.getAvailability(programId, {
      from,
      days: Math.min(Math.floor(parsedDays), 31),
    });
  }
}
