import { HttpService } from '@nestjs/axios';
import { ConfigService } from '@nestjs/config';
import { AxiosError, type AxiosResponse } from 'axios';
import { of, throwError } from 'rxjs';
import { PaygateClient } from './paygate.client';
import { PaygateConfigService } from './paygate.config';
import { PaygateApiError, PaygateNetworkError } from './paygate.errors';

function buildClient(
  env: Record<string, string | undefined>,
  httpMock: { request: jest.Mock },
): PaygateClient {
  const cfg = new PaygateConfigService({
    get: (key: string) => env[key],
  } as unknown as ConfigService);
  return new PaygateClient(cfg, httpMock as unknown as HttpService);
}

function axiosOk(data: unknown, status = 200): AxiosResponse {
  return {
    status,
    data,
    statusText: 'OK',
    headers: {},
    config: {} as never,
  };
}

const baseEnv = {
  PAYGATE_API_BASE: 'https://stage.paygatehn.com',
  PAYGATE_BEARER_TOKEN: 'sandbox-token',
};

describe('PaygateClient', () => {
  it('sends Bearer token + Accept header on GET and returns parsed body', async () => {
    const request = jest.fn(() => of(axiosOk({ data: ['x'] })));
    const client = buildClient(baseEnv, { request });

    const result = await client.get<{ data: string[] }>('/pos?limit=1');

    expect(result.data).toEqual(['x']);
    expect(request).toHaveBeenCalledTimes(1);
    const args = request.mock.calls[0][0] as {
      method: string;
      url: string;
      headers: Record<string, string>;
    };
    expect(args.method).toBe('GET');
    expect(args.url).toBe('https://stage.paygatehn.com/pos?limit=1');
    expect(args.headers.Authorization).toBe('Bearer sandbox-token');
    expect(args.headers.Accept).toBe('application/json');
  });

  it('POST includes Content-Type: application/json and sends body', async () => {
    const request = jest.fn(() => of(axiosOk({ _id: 'abc' }, 201)));
    const client = buildClient(baseEnv, { request });

    const result = await client.post<{ _id: string }>('/pos/payment', {
      amount: 10,
    });

    expect(result._id).toBe('abc');
    const args = request.mock.calls[0][0] as {
      method: string;
      url: string;
      data: unknown;
      headers: Record<string, string>;
    };
    expect(args.method).toBe('POST');
    expect(args.url).toBe('https://stage.paygatehn.com/pos/payment');
    expect(args.data).toEqual({ amount: 10 });
    expect(args.headers['Content-Type']).toBe('application/json');
  });

  it('throws PaygateApiError on 4xx with parsed message + errorCode', async () => {
    const request = jest.fn(() =>
      of(
        axiosOk(
          { success: false, message: 'Suspected fraud', errorCode: '59' },
          400,
        ),
      ),
    );
    const client = buildClient(baseEnv, { request });

    await expect(client.post('/pos/payment', {})).rejects.toMatchObject({
      name: 'PaygateApiError',
      httpStatus: 400,
      message: 'Suspected fraud',
      errorCode: '59',
    });
  });

  it('falls back to a generic message when 4xx body has no message field', async () => {
    const request = jest.fn(() => of(axiosOk({}, 422)));
    const client = buildClient(baseEnv, { request });

    await expect(client.post('/pos/payment', {})).rejects.toBeInstanceOf(
      PaygateApiError,
    );
  });

  it('throws PaygateNetworkError on 5xx', async () => {
    const request = jest.fn(() => of(axiosOk({}, 503)));
    const client = buildClient(baseEnv, { request });

    await expect(client.get('/pos')).rejects.toBeInstanceOf(
      PaygateNetworkError,
    );
  });

  it('throws PaygateNetworkError on transport error', async () => {
    const request = jest.fn(() =>
      throwError(() => new AxiosError('connect ECONNREFUSED', 'ECONNREFUSED')),
    );
    const client = buildClient(baseEnv, { request });

    await expect(client.get('/pos')).rejects.toBeInstanceOf(
      PaygateNetworkError,
    );
  });

  it('throws PaygateNetworkError when PAYGATE_API_BASE is missing', async () => {
    const request = jest.fn();
    const client = buildClient({ PAYGATE_BEARER_TOKEN: 'tok' }, { request });

    await expect(client.get('/pos')).rejects.toMatchObject({
      name: 'PaygateNetworkError',
      message: 'PAYGATE_API_BASE is not configured',
    });
    expect(request).not.toHaveBeenCalled();
  });

  it('throws PaygateNetworkError when bearer token is missing', async () => {
    const request = jest.fn();
    const client = buildClient(
      { PAYGATE_API_BASE: 'https://stage.paygatehn.com' },
      { request },
    );

    await expect(client.get('/pos')).rejects.toMatchObject({
      name: 'PaygateNetworkError',
      message: 'PAYGATE_BEARER_TOKEN is not configured',
    });
  });

  it('reports timeout distinctly when axios aborts (ECONNABORTED)', async () => {
    const request = jest.fn(() =>
      throwError(
        () => new AxiosError('timeout of 100ms exceeded', 'ECONNABORTED'),
      ),
    );
    const client = buildClient(baseEnv, { request });

    await expect(client.get('/pos', { timeoutMs: 100 })).rejects.toMatchObject({
      name: 'PaygateNetworkError',
      message: expect.stringContaining('Timeout (100ms)'),
    });
  });
});
