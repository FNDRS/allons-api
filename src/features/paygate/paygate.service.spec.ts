import { ConfigService } from '@nestjs/config';
import { Logger } from '@nestjs/common';
import { PaygateClient } from './paygate.client';
import { PaygateConfigService } from './paygate.config';
import { PaygateApiError, PaygateNetworkError } from './paygate.errors';
import { PaygateService } from './paygate.service';
import type { PaygatePaymentLinkRaw } from './paygate.types';

function buildService(
  env: Record<string, string | undefined>,
  clientMock: Partial<PaygateClient>,
) {
  const cfg = new PaygateConfigService({
    get: (key: string) => env[key],
  } as unknown as ConfigService);
  return {
    cfg,
    service: new PaygateService(cfg, clientMock as PaygateClient),
  };
}

const FULL_ENV = {
  PAYGATE_API_BASE: 'https://stage.paygatehn.com',
  PAYGATE_BEARER_TOKEN: 'tok',
  PAYGATE_WEBHOOK_SECRET: 'wsec',
  PAYGATE_CURRENCY: 'HNL',
  PAYGATE_LINK_EXPIRATION_HOURS: '2',
};

describe('PaygateService.health (Phase 0)', () => {
  it('returns skipped when PAYGATE_API_BASE is missing', async () => {
    const get = jest.fn();
    const { service } = buildService({}, { get });

    const result = await service.health();

    expect(result.configured).toBe(false);
    expect(result.missing.apiBase).toBe(true);
    expect(result.connectivity.status).toBe('skipped');
    expect(result.cached).toBe(false);
    expect(get).not.toHaveBeenCalled();
  });

  it('returns unauthorized (synthesized) when api base is set but token is missing', async () => {
    const get = jest.fn();
    const { service } = buildService(
      { PAYGATE_API_BASE: 'https://stage.paygatehn.com' },
      { get },
    );

    const result = await service.health();

    if (result.connectivity.status !== 'unauthorized') {
      throw new Error('expected unauthorized');
    }
    expect(result.connectivity.message).toContain('PAYGATE_BEARER_TOKEN');
    expect(get).not.toHaveBeenCalled();
  });

  it('returns ok when client succeeds', async () => {
    const get = jest.fn().mockResolvedValue({ data: [] });
    const { service } = buildService(FULL_ENV, { get });

    const result = await service.health();

    expect(result.configured).toBe(true);
    expect(result.connectivity.status).toBe('ok');
    expect(get).toHaveBeenCalledWith('/pos?limit=1', expect.any(Object));
  });

  it('maps PaygateApiError(401|403) to unauthorized connectivity', async () => {
    const get = jest.fn().mockRejectedValue(
      new PaygateApiError({
        httpStatus: 401,
        message: 'Unauthorized',
      }),
    );
    const { service } = buildService(FULL_ENV, { get });

    const result = await service.health();
    if (result.connectivity.status !== 'unauthorized') {
      throw new Error('expected unauthorized');
    }
    expect(result.connectivity.httpStatus).toBe(401);
  });

  it('maps PaygateApiError(4xx other) to unexpected_status', async () => {
    const get = jest
      .fn()
      .mockRejectedValue(
        new PaygateApiError({ httpStatus: 404, message: 'Not found' }),
      );
    const { service } = buildService(FULL_ENV, { get });

    const result = await service.health();
    expect(result.connectivity.status).toBe('unexpected_status');
  });

  it('maps PaygateNetworkError to unreachable', async () => {
    const get = jest.fn().mockRejectedValue(new PaygateNetworkError('boom'));
    const { service } = buildService(FULL_ENV, { get });

    const result = await service.health();
    expect(result.connectivity.status).toBe('unreachable');
  });

  it('caches the response for TTL and reports cached=true on second call', async () => {
    const get = jest.fn().mockResolvedValue({ data: [] });
    const { service } = buildService(FULL_ENV, { get });

    const first = await service.health();
    const second = await service.health();

    expect(first.cached).toBe(false);
    expect(second.cached).toBe(true);
    expect(get).toHaveBeenCalledTimes(1);
  });
});

describe('PaygateService.createPaymentLink (Phase 1)', () => {
  it('posts to /pos/payment with defaults from config and maps the response', async () => {
    const raw: PaygatePaymentLinkRaw = {
      _id: 'link-1',
      link: 'https://stage.paygate.biz/checkout/link-1',
      amount: 100,
      subtotal: 100,
      tax: 0,
      description: 'Ticket - Event X',
      expires: true,
      expiration: 2,
      currency: 'HNL',
      numberOfProcesses: 0,
      maximumNumberOfProcessesAllowed: null,
      isOpenAmount: false,
    };
    const post = jest.fn().mockResolvedValue(raw);
    const { service } = buildService(FULL_ENV, { post });

    const result = await service.createPaymentLink({
      description: 'Ticket - Event X',
      amount: 100,
    });

    expect(post).toHaveBeenCalledWith('/pos/payment', {
      description: 'Ticket - Event X',
      amount: 100,
      currency: 'HNL',
      tax: 0,
      expires: true,
      expiration: 2,
    });
    expect(result).toEqual({
      id: 'link-1',
      link: 'https://stage.paygate.biz/checkout/link-1',
      amount: 100,
      subtotal: 100,
      tax: 0,
      description: 'Ticket - Event X',
      expires: true,
      expirationHours: 2,
      currency: 'HNL',
      numberOfProcesses: 0,
      isOpenAmount: false,
      status: undefined,
    });
  });

  it('honors explicit currency/tax/expirationHours overrides', async () => {
    const post = jest.fn().mockResolvedValue({
      _id: 'link-2',
      link: 'https://stage.paygate.biz/checkout/link-2',
      amount: 50,
      subtotal: 45,
      tax: 5,
      description: 'X',
      expires: true,
      expiration: 4,
      currency: 'USD',
      numberOfProcesses: 0,
      maximumNumberOfProcessesAllowed: null,
      isOpenAmount: false,
    });
    const { service } = buildService(FULL_ENV, { post });

    await service.createPaymentLink({
      description: 'X',
      amount: 50,
      currency: 'USD',
      tax: 5,
      expirationHours: 4,
    });

    expect(post).toHaveBeenCalledWith(
      '/pos/payment',
      expect.objectContaining({ currency: 'USD', tax: 5, expiration: 4 }),
    );
  });

  it('propagates PaygateApiError so callers can surface the rejection reason', async () => {
    const post = jest.fn().mockRejectedValue(
      new PaygateApiError({
        httpStatus: 400,
        message: 'Suspected fraud',
        errorCode: '59',
      }),
    );
    const { service } = buildService(FULL_ENV, { post });

    await expect(
      service.createPaymentLink({ description: 'X', amount: 10 }),
    ).rejects.toMatchObject({
      name: 'PaygateApiError',
      errorCode: '59',
    });
  });
});

describe('PaygateService.getPaymentLinkDetail (Phase 1)', () => {
  it('GETs /pos/:id and maps the response', async () => {
    const get = jest.fn().mockResolvedValue({
      _id: 'link-1',
      link: 'https://stage.paygate.biz/checkout/link-1',
      amount: 100,
      subtotal: 100,
      tax: 0,
      description: 'X',
      expires: true,
      expiration: 2,
      currency: 'HNL',
      numberOfProcesses: 1,
      maximumNumberOfProcessesAllowed: null,
      isOpenAmount: false,
      status: 'PROCESSED',
    });
    const { service } = buildService(FULL_ENV, { get });

    const result = await service.getPaymentLinkDetail('link-1');

    expect(get).toHaveBeenCalledWith('/pos/link-1');
    expect(result.id).toBe('link-1');
    expect(result.status).toBe('PROCESSED');
    expect(result.numberOfProcesses).toBe(1);
  });

  it('encodes ids with unusual characters', async () => {
    const get = jest.fn().mockResolvedValue({
      _id: 'a/b',
      amount: 0,
      subtotal: 0,
      tax: 0,
      description: '',
      expires: false,
      expiration: 0,
      currency: 'HNL',
      numberOfProcesses: 0,
      maximumNumberOfProcessesAllowed: null,
      isOpenAmount: false,
    });
    const { service } = buildService(FULL_ENV, { get });

    await service.getPaymentLinkDetail('a/b');

    expect(get).toHaveBeenCalledWith('/pos/a%2Fb');
  });
});

describe('PaygateService.cancelPaymentLink (Phase 1)', () => {
  it('DELETEs /pos/:id', async () => {
    const del = jest.fn().mockResolvedValue(undefined);
    const { service } = buildService(FULL_ENV, { delete: del });

    await service.cancelPaymentLink('link-1');

    expect(del).toHaveBeenCalledWith('/pos/link-1');
  });
});

describe('PaygateConfigService caching (regression)', () => {
  it('reads each PAYGATE_* var from ConfigService only once', () => {
    const env: Record<string, string | undefined> = {
      PAYGATE_API_BASE: 'https://stage.paygatehn.com/',
      PAYGATE_BEARER_TOKEN: ' token ',
    };
    const get = jest.fn((key: string) => env[key]);
    const cfg = new PaygateConfigService({ get } as unknown as ConfigService);

    void cfg.apiBase;
    void cfg.apiBase;
    void cfg.bearerToken;
    void cfg.snapshot();

    const counts = get.mock.calls.reduce<Record<string, number>>(
      (acc, [key]) => {
        acc[String(key)] = (acc[String(key)] ?? 0) + 1;
        return acc;
      },
      {},
    );
    expect(counts.PAYGATE_API_BASE).toBe(1);
    expect(counts.PAYGATE_BEARER_TOKEN).toBe(1);
    expect(cfg.apiBase).toBe('https://stage.paygatehn.com');
    expect(cfg.bearerToken).toBe('token');
  });

  it.each(['0', '-5', 'abc'])(
    'linkExpirationHours rejects %s and falls back to 2 with a warning',
    (raw) => {
      const loggerWarn = jest
        .spyOn(Logger.prototype, 'warn')
        .mockImplementation(() => {});

      const cfg = new PaygateConfigService({
        get: (key: string) =>
          ({
            PAYGATE_LINK_EXPIRATION_HOURS: raw,
          })[key as 'PAYGATE_LINK_EXPIRATION_HOURS'],
      } as unknown as ConfigService);

      expect(cfg.linkExpirationHours).toBe(2);
      expect(loggerWarn).toHaveBeenCalledWith(
        expect.stringContaining(`PAYGATE_LINK_EXPIRATION_HOURS="${raw}"`),
      );

      loggerWarn.mockRestore();
    },
  );
});
