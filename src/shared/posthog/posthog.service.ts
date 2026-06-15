import { Injectable, OnApplicationShutdown } from '@nestjs/common';
import { PostHog } from 'posthog-node';

@Injectable()
export class PostHogService implements OnApplicationShutdown {
  readonly client: PostHog;

  constructor() {
    this.client = new PostHog(process.env.POSTHOG_API_KEY ?? '', {
      host: process.env.POSTHOG_HOST,
      enableExceptionAutocapture: true,
    });
  }

  capture(params: {
    distinctId: string;
    event: string;
    properties?: Record<string, unknown>;
  }): void {
    this.client.capture({
      distinctId: params.distinctId,
      event: params.event,
      properties: params.properties,
    });
  }

  identify(params: {
    distinctId: string;
    properties?: Record<string, unknown>;
  }): void {
    this.client.identify({
      distinctId: params.distinctId,
      properties: params.properties,
    });
  }

  captureException(
    error: unknown,
    distinctId?: string,
    additionalProperties?: Record<string, unknown>,
  ): void {
    this.client.captureException(error, distinctId, additionalProperties);
  }

  async onApplicationShutdown(): Promise<void> {
    await this.client.shutdown();
  }
}
