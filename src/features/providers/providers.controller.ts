import { Controller, Get } from '@nestjs/common';
import { PrismaService } from '../../prisma/prisma.service';

@Controller('providers')
export class ProvidersController {
  constructor(private readonly prisma: PrismaService) {}

  @Get()
  list() {
    return this.prisma.provider.findMany({ orderBy: { createdAt: 'desc' } });
  }
}
