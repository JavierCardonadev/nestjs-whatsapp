export class WhatsAppError extends Error {
  constructor(message: string, options?: { cause?: unknown }) {
    super(message, options);
    this.name = new.target.name;
  }
}

/** Invalid or missing configuration (access token, app secret…). */
export class WhatsAppConfigurationError extends WhatsAppError {}

/** A message or request that would be rejected by WhatsApp, caught before calling the API. */
export class WhatsAppValidationError extends WhatsAppError {}

/** The webhook request could not be authenticated. Never process its payload. */
export class WhatsAppWebhookError extends WhatsAppError {
  constructor(readonly reason: string) {
    super(`whatsapp webhook rejected: ${reason}`);
  }
}

export interface GraphErrorBody {
  message?: string;
  type?: string;
  code?: number;
  error_subcode?: number;
  error_user_title?: string;
  error_user_msg?: string;
  error_data?: { messaging_product?: string; details?: string };
  fbtrace_id?: string;
}

/** An error answered by the Graph API, or a network failure reaching it. */
export class WhatsAppApiError extends WhatsAppError {
  readonly httpStatus?: number;
  /** Graph/WhatsApp error code, e.g. 131047. See `WHATSAPP_ERROR_CODES`. */
  readonly code?: number;
  readonly subcode?: number;
  readonly details?: string;
  /** Include it when contacting Meta support. */
  readonly fbtraceId?: string;
  readonly raw?: unknown;

  constructor(
    message: string,
    init: { httpStatus?: number; error?: GraphErrorBody; raw?: unknown; cause?: unknown } = {},
  ) {
    super(message, { cause: init.cause });
    this.httpStatus = init.httpStatus;
    this.code = init.error?.code;
    this.subcode = init.error?.error_subcode;
    this.details = init.error?.error_data?.details;
    this.fbtraceId = init.error?.fbtrace_id;
    this.raw = init.raw;
  }

  /** The 24-hour customer service window is closed: send an approved template instead. */
  get isOutsideCustomerServiceWindow(): boolean {
    return this.code === 131047;
  }

  /** Throughput or per-recipient limits. Retry later with backoff. */
  get isRateLimited(): boolean {
    return this.code === 130429 || this.code === 131056 || this.code === 4 || this.code === 80007;
  }

  /** The access token is invalid or expired. */
  get isAuthError(): boolean {
    return this.code === 0 || this.code === 190;
  }
}

/** Common Cloud API error codes (developers.facebook.com › WhatsApp › Error codes). */
export const WHATSAPP_ERROR_CODES = {
  AUTHENTICATION_FAILED: 0,
  TOKEN_EXPIRED: 190,
  INVALID_PARAMETER: 100,
  ACCOUNT_RESTRICTED: 368,
  RATE_LIMIT_HIT: 130429,
  UNKNOWN_SEND_ERROR: 131000,
  MISSING_PARAMETER: 131008,
  INVALID_PARAMETER_VALUE: 131009,
  SERVICE_UNAVAILABLE: 131016,
  DELIVERY_FAILED: 131026,
  PAYMENT_METHOD_ERROR: 131042,
  CUSTOMER_SERVICE_WINDOW_EXPIRED: 131047,
  QUALITY_BLOCKED: 131048,
  ECOSYSTEM_ENGAGEMENT_LIMIT: 131049,
  UNSUPPORTED_MESSAGE_TYPE: 131051,
  MEDIA_DOWNLOAD_FAILED: 131052,
  MEDIA_UPLOAD_FAILED: 131053,
  RECIPIENT_THROTTLED: 131056,
  TEMPLATE_PARAMETER_COUNT_MISMATCH: 132000,
  TEMPLATE_NOT_FOUND_OR_NOT_APPROVED: 132001,
  TEMPLATE_PARAMETER_FORMAT_INVALID: 132012,
  TEMPLATE_PAUSED: 132015,
  TEMPLATE_DISABLED: 132016,
  PHONE_NOT_REGISTERED: 133010,
} as const;
