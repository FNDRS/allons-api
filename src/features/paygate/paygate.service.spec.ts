import { Test } from '@nestjs/testing';
import { HttpService } from '@nestjs/axios';
import { ConfigService } from '@nestjs/config';
import { of, throwError } from 'rxjs';
import { AxiosError } from 'axios';
import { PaygateConfigService } from './paygate.config';
import { PaygateService } from './paygate.service';

function buildModule(
  env: Record<string, string | undefined>,
  httpMock: Partial<HttpService>,
) {
  return Test.createTestingModule({
    providers: [
      PaygateService,
      PaygateConfigService,
      {
        provide: ConfigService,
        useValue: { get: (key: string) => env[key] },
      },
      { provide: HttpService, useValue: httpMock },
    ],
  }).compile();
}

describe('PaygateService.health', () => {
  it('reporta skipped y missing flags si no hay PAYGATE_API_BASE', async () => {
    const moduleRef = await buildModule({}, { get: jest.fn() });
    const service = moduleRef.get(PaygateService);

    const result = await service.health();

    expect(result.configured).toBe(false);
    expect(result.apiBase).toBeNull();
    expect(result.missing.apiBase).toBe(true);
    expect(result.missing.bearerToken).toBe(true);
    expect(result.connectivity.status).toBe('skipped');
  });

  it('marca configured=true y status ok cuando Paygate responde 200', async () => {
    const httpMock = {
      get: jest.fn(() =>
        of({
          status: 200,
          data: { data: [] },
          statusText: 'OK',
          headers: {},
          config: {},
        } as any),
      ),
    } satisfies Partial<HttpService>;
    const moduleRef = await buildModule(
      {
        PAYGATE_API_BASE: 'https://stage.paygatehn.com',
        PAYGATE_BEARER_TOKEN: 'sandbox-token',
        PAYGATE_WEBHOOK_SECRET: 'hook-secret',
      },
      httpMock,
    );
    const service = moduleRef.get(PaygateService);

    const result = await service.health();

    expect(result.configured).toBe(true);
    expect(result.apiBase).toBe('https://stage.paygatehn.com');
    expect(result.connectivity.status).toBe('ok');
    expect(httpMock.get).toHaveBeenCalledWith(
      'https://stage.paygatehn.com/pos?limit=1',
      expect.objectContaining({
        headers: expect.objectContaining({
          Authorization: 'Bearer sandbox-token',
        }),
      }),
    );
  });

  it('devuelve unauthorized cuando Paygate responde 401', async () => {
    const httpMock = {
      get: jest.fn(() =>
        of({
          status: 401,
          data: {},
          statusText: 'Unauthorized',
          headers: {},
          config: {},
        } as any),
      ),
    } satisfies Partial<HttpService>;
    const moduleRef = await buildModule(
      {
        PAYGATE_API_BASE: 'https://stage.paygatehn.com',
        PAYGATE_BEARER_TOKEN: 'bad',
      },
      httpMock,
    );
    const service = moduleRef.get(PaygateService);

    const result = await service.health();

    expect(result.connectivity.status).toBe('unauthorized');
  });

  it('devuelve unreachable cuando la red falla', async () => {
    const httpMock = {
      get: jest.fn(() =>
        throwError(() => new AxiosError('Network down', 'ECONNREFUSED')),
      ),
    } satisfies Partial<HttpService>;
    const moduleRef = await buildModule(
      {
        PAYGATE_API_BASE: 'https://stage.paygatehn.com',
        PAYGATE_BEARER_TOKEN: 'tok',
      },
      httpMock,
    );
    const service = moduleRef.get(PaygateService);

    const result = await service.health();

    expect(result.connectivity.status).toBe('unreachable');
  });
});
