import { Module } from '@nestjs/common';
import { PreferenceController } from './preference.controller';
import { PreferenceService } from './preference.service';

@Module({
  controllers: [PreferenceController],
  providers: [PreferenceService],
  // Grid + export read the masking preference to redact rows server-side (Phase 39).
  exports: [PreferenceService],
})
export class PreferenceModule {}
