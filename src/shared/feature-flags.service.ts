import { Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';

export interface FeatureFlagsSnapshot {
  paymentsEnabled: boolean;
  forceFreeEvents: boolean;
}

@Injectable()
export class FeatureFlagsService {
  private readonly snapshotValue: FeatureFlagsSnapshot;

  constructor(cfg: ConfigService) {
    this.snapshotValue = {
      paymentsEnabled: readBool(cfg, 'PAYMENTS_ENABLED', true),
      forceFreeEvents: readBool(cfg, 'FORCE_FREE_EVENTS', false),
    };
  }

  snapshot(): FeatureFlagsSnapshot {
    return { ...this.snapshotValue };
  }

  get paymentsEnabled(): boolean {
    return this.snapshotValue.paymentsEnabled;
  }

  get forceFreeEvents(): boolean {
    return this.snapshotValue.forceFreeEvents;
  }
}

function readBool(cfg: ConfigService, key: string, fallback: boolean): boolean {
  const raw = cfg.get<string>(key);
  if (raw === undefined || raw === null || raw.trim() === '') return fallback;
  return raw.trim().toLowerCase() === 'true';
}
