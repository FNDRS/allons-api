import { Injectable, Logger } from '@nestjs/common';

interface HogQlQueryResponse {
  results?: unknown[][];
}

/**
 * Read-only PostHog HogQL for admin dashboards. Requires a personal API key
 * with query read access — the project ingest key is not sufficient.
 */
@Injectable()
export class PostHogQueryService {
  private readonly logger = new Logger(PostHogQueryService.name);

  async countExceptionsLast30Days(): Promise<number | null> {
    const apiKey = process.env.POSTHOG_PERSONAL_API_KEY?.trim();
    const projectId = process.env.POSTHOG_PROJECT_ID?.trim();
    const host = (process.env.POSTHOG_HOST ?? 'https://us.i.posthog.com').replace(
      /\/+$/,
      '',
    );

    if (!apiKey || !projectId) {
      return null;
    }

    try {
      const res = await fetch(
        `${host}/api/projects/${encodeURIComponent(projectId)}/query/`,
        {
          method: 'POST',
          headers: {
            Authorization: `Bearer ${apiKey}`,
            'Content-Type': 'application/json',
          },
          body: JSON.stringify({
            query: {
              kind: 'HogQLQuery',
              query:
                "SELECT count() FROM events WHERE event = '$exception' AND timestamp >= now() - INTERVAL 30 DAY",
            },
            name: 'admin_overview_errors_30d',
          }),
          cache: 'no-store',
        },
      );

      if (!res.ok) {
        const body = await res.text().catch(() => '');
        this.logger.warn(
          `PostHog query failed (${res.status}): ${body.slice(0, 200)}`,
        );
        return null;
      }

      const data = (await res.json()) as HogQlQueryResponse;
      const raw = data.results?.[0]?.[0];
      const count = typeof raw === 'number' ? raw : Number(raw);
      return Number.isFinite(count) ? count : 0;
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      this.logger.warn(`PostHog query error: ${message}`);
      return null;
    }
  }
}
