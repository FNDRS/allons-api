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

  @Get('top')
  top() {
    return this.prisma.event.findMany({
      where: {
        OR: [{ startsAt: { gte: new Date() } }, { startsAt: null }],
      },
      include: { provider: true },
      orderBy: [{ startsAt: 'asc' }, { createdAt: 'desc' }],
      take: 5,
    });
  }

  @Get('friends')
  friends() {
    return this.prisma.event.findMany({
      include: { provider: true },
      orderBy: { createdAt: 'desc' },
      take: 6,
    });
  }
}
