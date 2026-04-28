import { Module } from '@nestjs/common';
import { ProvidersController } from './providers.controller';

@Module({
  controllers: [ProvidersController],
})
export class ProvidersModule {}
