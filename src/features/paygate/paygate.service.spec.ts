import { Test } from '@nestjs/testing';
import { HttpService } from '@nestjs/axios';
import { ConfigService } from '@nestjs/config';
import { Logger } from '@nestjs/common';
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

function okResponse(status = 200) {
  return of({
    status,
    data: { data: [] },
    statusText: 'OK',
    headers: {},
    config: {},
  } as any);
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
    expect(result.cached).toBe(false);
  });

  it('marca configured=true y status ok cuando Paygate responde 200', async () => {
    const httpMock = {
      get: jest.fn(() => okResponse(200)),
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

  it('devuelve unexpected_status para HTTP no 200/401/403 (ej. 503)', async () => {
    const httpMock = {
      get: jest.fn(() =>
        of({
          status: 503,
          data: {},
          statusText: 'Service Unavailable',
          headers: {},
          config: {},
        } as any),
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

    expect(result.connectivity.status).toBe('unexpected_status');
    if (result.connectivity.status === 'unexpected_status') {
      expect(result.connectivity.httpStatus).toBe(503);
    }
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

  it('no incluye Authorization header cuando no hay bearer token configurado', async () => {
    const httpMock = {
      get: jest.fn(() => okResponse(401)),
    } satisfies Partial<HttpService>;
    const moduleRef = await buildModule(
      { PAYGATE_API_BASE: 'https://stage.paygatehn.com' },
      httpMock,
    );
    const service = moduleRef.get(PaygateService);

    await service.health();

    expect(httpMock.get).toHaveBeenCalledTimes(1);
    const [, options] = (httpMock.get as jest.Mock).mock.calls[0];
    const headers = (options as { headers: Record<string, string> }).headers;
    expect(headers).not.toHaveProperty('Authorization');
    expect(headers.Accept).toBe('application/json');
  });

  it('cachea el resultado durante el TTL y marca cached=true en la segunda llamada', async () => {
    const httpMock = {
      get: jest.fn(() => okResponse(200)),
    } satisfies Partial<HttpService>;
    const moduleRef = await buildModule(
      {
        PAYGATE_API_BASE: 'https://stage.paygatehn.com',
        PAYGATE_BEARER_TOKEN: 'tok',
      },
      httpMock,
    );
    const service = moduleRef.get(PaygateService);

    const first = await service.health();
    const second = await service.health();

    expect(first.cached).toBe(false);
    expect(second.cached).toBe(true);
    expect(httpMock.get).toHaveBeenCalledTimes(1);
  });
});

describe('PaygateConfigService', () => {
  it('cachea el snapshot al construir (no re-lee ConfigService en cada acceso)', () => {
    const env: Record<string, string | undefined> = {
      PAYGATE_API_BASE: 'https://stage.paygatehn.com/',
      PAYGATE_BEARER_TOKEN: ' token ',
    };
    const get = jest.fn((key: string) => env[key]);
    const cfg = new PaygateConfigService({ get } as unknown as ConfigService);

    // Acceso múltiple
    void cfg.apiBase;
    void cfg.apiBase;
    void cfg.bearerToken;
    void cfg.snapshot();

    // Cada variable debe haberse leído UNA sola vez (en el constructor).
    const calls = get.mock.calls.map(([k]: [string]) => k);
    const counts = calls.reduce<Record<string, number>>((acc, key) => {
      acc[key] = (acc[key] ?? 0) + 1;
      return acc;
    }, {});
    expect(counts.PAYGATE_API_BASE).toBe(1);
    expect(counts.PAYGATE_BEARER_TOKEN).toBe(1);

    // El trim y trailing-slash trim se aplican.
    expect(cfg.apiBase).toBe('https://stage.paygatehn.com');
    expect(cfg.bearerToken).toBe('token');
  });

  it('linkExpirationHours loguea warning y usa default cuando el valor es inválido', () => {
    const loggerWarn = jest
      .spyOn(Logger.prototype, 'warn')
      .mockImplementation(() => {});

    const env: Record<string, string | undefined> = {
      PAYGATE_API_BASE: 'https://stage.paygatehn.com',
      PAYGATE_LINK_EXPIRATION_HOURS: 'abc',
    };
    const cfg = new PaygateConfigService({
      get: (key: string) => env[key],
    } as unknown as ConfigService);

    expect(cfg.linkExpirationHours).toBe(2);
    expect(loggerWarn).toHaveBeenCalledWith(
      expect.stringContaining('PAYGATE_LINK_EXPIRATION_HOURS="abc"'),
    );

    loggerWarn.mockRestore();
  });

  it.each([
    ['0', 'cero'],
    ['-5', 'negativo'],
    ['abc', 'no numérico'],
  ])('linkExpirationHours rechaza valor %s (%s) y usa default 2', (raw) => {
    const env: Record<string, string | undefined> = {
      PAYGATE_LINK_EXPIRATION_HOURS: raw,
    };
    const cfg = new PaygateConfigService({
      get: (key: string) => env[key],
    } as unknown as ConfigService);

    expect(cfg.linkExpirationHours).toBe(2);
  });
});
