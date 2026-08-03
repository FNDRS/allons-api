import {
  BadRequestException,
  Controller,
  Get,
  Param,
  Query,
} from '@nestjs/common';
import { PrismaService } from '../../prisma/prisma.service';
import {
  PublicProviderEventScope,
  PublicProviderEventType,
  PublicProvidersService,
} from './public-providers.service';

const EVENT_SCOPES = ['upcoming', 'past', 'all'] as const;
const EVENT_TYPES = ['single', 'recurring_class'] as const;
const MAX_EVENTS_PER_PAGE = 100;

@Controller('providers')
export class ProvidersController {
  constructor(
    private readonly prisma: PrismaService,
    private readonly publicProviders: PublicProvidersService,
  ) {}

  @Get()
  list() {
    return this.prisma.provider.findMany({ orderBy: { createdAt: 'desc' } });
  }

  /** Client-facing comercio profile (provider profile screen). */
  @Get(':id')
  getOne(@Param('id') id: string) {
    return this.publicProviders.getPublicProfile(id);
  }

  /**
   * The comercio's public catalogue. `scope=upcoming` keeps recurring classes
   * regardless of their first session; `type` narrows to clases or eventos.
   */
  @Get(':id/events')
  listEvents(
    @Param('id') id: string,
    @Query('scope') scope?: string,
    @Query('type') type?: string,
    @Query('limit') limit?: string,
  ) {
    if (scope && !EVENT_SCOPES.includes(scope as PublicProviderEventScope)) {
      throw new BadRequestException(
        `scope inválido: usa ${EVENT_SCOPES.join(' | ')}`,
      );
    }
    if (type && !EVENT_TYPES.includes(type as PublicProviderEventType)) {
      throw new BadRequestException(
        `type inválido: usa ${EVENT_TYPES.join(' | ')}`,
      );
    }

    let parsedLimit: number | undefined;
    if (limit !== undefined) {
      const n = Number(limit);
      if (!Number.isFinite(n) || n < 1) {
        throw new BadRequestException('limit debe ser un número mayor a 0');
      }
      parsedLimit = Math.min(Math.floor(n), MAX_EVENTS_PER_PAGE);
    }

    return this.publicProviders.listPublicEvents(id, {
      scope: scope as PublicProviderEventScope | undefined,
      type: type as PublicProviderEventType | undefined,
      limit: parsedLimit,
    });
  }
}
