/**
 * Error returned by the Paygate API when it rejects a request
 * (HTTP 4xx with body `{ success: false, message, errorCode }`).
 *
 * Does not cover network errors or timeouts (see `PaygateNetworkError`).
 */
export class PaygateApiError extends Error {
  readonly httpStatus: number;
  readonly errorCode: string | null;

  constructor(params: {
    httpStatus: number;
    message: string;
    errorCode?: string | null;
  }) {
    super(params.message);
    this.name = 'PaygateApiError';
    this.httpStatus = params.httpStatus;
    this.errorCode = params.errorCode ?? null;
  }
}

/**
 * Network-level error while talking to Paygate: timeout, DNS failure,
 * connection refused, or any 5xx we treat as transient.
 */
export class PaygateNetworkError extends Error {
  readonly cause?: unknown;

  constructor(message: string, cause?: unknown) {
    super(message);
    this.name = 'PaygateNetworkError';
    this.cause = cause;
  }
}

/**
 * Error validating the signature on an incoming Paygate webhook.
 * The handler should respond 401 without processing the body.
 */
export class PaygateWebhookSignatureError extends Error {
  readonly reason: 'missing_secret' | 'missing_header' | 'mismatch';

  constructor(reason: PaygateWebhookSignatureError['reason'], message: string) {
    super(message);
    this.name = 'PaygateWebhookSignatureError';
    this.reason = reason;
  }
}
