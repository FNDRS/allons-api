import { Injectable, Logger } from '@nestjs/common';

type Json = null | boolean | number | string | Json[] | { [k: string]: Json };

@Injectable()
export class ObservabilityService {
  private readonly logger = new Logger('obs');

  /**
   * Emit a structured log event.
   *
   * Rules:
   * - No PII (emails/phones/names)
   * - No secrets
   * - Keep payload small and stable (good for CloudWatch Insights/metrics filters)
   */
  event(name: string, data?: Record<string, unknown>) {
    const safe = sanitize(data ?? {});
    this.logger.log(JSON.stringify({ type: 'event', name, ...safe }));
  }

  warn(name: string, data?: Record<string, unknown>) {
    const safe = sanitize(data ?? {});
    this.logger.warn(JSON.stringify({ type: 'warn', name, ...safe }));
  }

  error(name: string, err: unknown, data?: Record<string, unknown>) {
    const safe = sanitize(data ?? {});
    this.logger.error(
      JSON.stringify({
        type: 'error',
        name,
        ...safe,
        error: err instanceof Error ? err.message : String(err),
      }),
    );
  }
}

const MAX_LEN = 400;

function sanitize(input: Record<string, unknown>): Record<string, Json> {
  const out: Record<string, Json> = {};
  for (const [k, v] of Object.entries(input)) {
    out[k] = sanitizeValue(k, v);
  }
  return out;
}

function sanitizeValue(key: string, value: unknown): Json {
  const k = key.toLowerCase();

  // Common PII-ish keys.
  if (k.includes('email') || k.includes('phone') || k.includes('name')) {
    return '[redacted]';
  }
  // Common secret-ish keys.
  if (
    k.includes('token') ||
    k.includes('secret') ||
    k.includes('authorization')
  ) {
    return '[redacted]';
  }

  if (value === null) return null;
  if (typeof value === 'boolean') return value;
  if (typeof value === 'number') return Number.isFinite(value) ? value : null;
  if (typeof value === 'string') {
    // Avoid logging raw emails even if key isn't named email.
    if (value.includes('@')) return '[redacted]';
    return value.length > MAX_LEN ? `${value.slice(0, MAX_LEN)}…` : value;
  }

  if (Array.isArray(value)) {
    return value.slice(0, 20).map((v) => sanitizeValue(key, v));
  }

  if (typeof value === 'object') {
    // Don't dump big objects (e.g. full webhook payload). Keep a hint only.
    const keys = Object.keys(value);
    return { _type: 'object', _keys: keys.slice(0, 30) };
  }

  return '[unknown]';
}
