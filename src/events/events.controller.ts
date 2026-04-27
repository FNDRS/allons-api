import { Controller, Get, Query } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';

@Controller('events')
export class EventsController {
  constructor(private readonly prisma: PrismaService) {}

  @Get()
  list(@Query('city') city?: string) {
    return this.prisma.event.findMany({
      where: city ? { city } : undefined,
      include: { provider: true },
      orderBy: [{ startsAt: 'asc' }, { createdAt: 'desc' }],
    });
  }
}
