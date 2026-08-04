import { Module } from '@nestjs/common';
import { ProvidersModule } from '../providers/providers.module';
import { ClassProgramsController } from './class-programs.controller';
import { ClassProgramsRepository } from './class-programs.repository';
import { ProviderClassProgramsController } from './provider-class-programs.controller';
import { ClassProgramsService } from './class-programs.service';

@Module({
  imports: [ProvidersModule],
  controllers: [ClassProgramsController, ProviderClassProgramsController],
  providers: [ClassProgramsRepository, ClassProgramsService],
})
export class ClassProgramsModule {}
