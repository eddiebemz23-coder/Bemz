/**
 * The browser half of the API contract. Every response is `{ data }` or
 * `{ error: { code, message, details } }`, so one parser covers all 89 endpoints — including
 * the field-level Zod issues a form has to put back next to the input that caused them.
 *
 * Only for client components: a relative URL has no origin inside a server component.
 */

export class ApiFailure extends Error {
  readonly status: number;
  readonly code: string;
  readonly details: unknown;
  readonly requestId: string | null;

  constructor(status: number, code: string, message: string, details?: unknown, requestId?: string | null) {
    super(message);
    this.name = 'ApiFailure';
    this.status = status;
    this.code = code;
    this.details = details;
    this.requestId = requestId ?? null;
  }

  /** Zod issues come back as `[{ field, message }]`; a form wants `{ field: message }`. */
  get issues(): Record<string, string> {
    if (!Array.isArray(this.details)) return {};
    const out: Record<string, string> = {};
    for (const issue of this.details as { field?: unknown; message?: unknown }[]) {
      if (typeof issue?.field === 'string' && typeof issue?.message === 'string') out[issue.field] = issue.message;
    }
    return out;
  }

  get retryAfterSeconds(): number | null {
    const detail = this.details as { retryAfterSeconds?: unknown } | undefined;
    return typeof detail?.retryAfterSeconds === 'number' ? detail.retryAfterSeconds : null;
  }
}

export type ApiMethod = 'GET' | 'POST' | 'PATCH' | 'DELETE';

export interface ApiOptions {
  method?: ApiMethod;
  body?: unknown;
  headers?: Record<string, string>;
  /** Sent as `Idempotency-Key`; checkout and stock moves refuse to double-apply without it. */
  idempotencyKey?: string;
  signal?: AbortSignal;
}

async function request<T>(path: string, options: ApiOptions = {}): Promise<T> {
  const method = options.method ?? 'GET';
  const headers: Record<string, string> = { accept: 'application/json', ...options.headers };

  if (options.body !== undefined) headers['content-type'] = 'application/json';
  if (options.idempotencyKey) headers['idempotency-key'] = options.idempotencyKey;

  let response: Response;
  try {
    response = await fetch(path, {
      method,
      headers,
      body: options.body === undefined ? undefined : JSON.stringify(options.body),
      // Same-origin cookies carry the session and the HttpOnly guest-basket token.
      credentials: 'same-origin',
      signal: options.signal,
    });
  } catch (error) {
    if ((error as Error)?.name === 'AbortError') throw error;
    throw new ApiFailure(0, 'network_error', 'Could not reach Bemz — check your connection and try again');
  }

  const requestId = response.headers.get('x-request-id');

  if (response.status === 204) return undefined as T;

  let payload: unknown;
  try {
    payload = await response.json();
  } catch {
    throw new ApiFailure(
      response.status,
      'bad_response',
      response.ok ? 'The server replied without a body' : `Request failed (${response.status})`,
      undefined,
      requestId,
    );
  }

  const envelope = payload as { data?: unknown; error?: { code?: string; message?: string; details?: unknown } };

  if (!response.ok || envelope.error) {
    throw new ApiFailure(
      response.status,
      envelope.error?.code ?? 'request_failed',
      envelope.error?.message ?? defaultMessage(response.status),
      envelope.error?.details,
      requestId,
    );
  }

  return envelope.data as T;
}

function defaultMessage(status: number): string {
  if (status === 401) return 'Sign in to continue';
  if (status === 403) return 'You do not have access to this';
  if (status === 404) return 'We could not find that';
  if (status === 429) return 'Too many attempts — wait a moment and try again';
  if (status >= 500) return 'Bemz is having trouble. Please try again in a minute';
  return 'That did not work';
}

export const api = {
  get: <T>(path: string, options?: { signal?: AbortSignal; headers?: Record<string, string> }) =>
    request<T>(path, { method: 'GET', ...options }),
  post: <T>(path: string, body?: unknown, options?: { idempotencyKey?: string; headers?: Record<string, string> }) =>
    request<T>(path, { method: 'POST', body, ...options }),
  patch: <T>(path: string, body?: unknown, options?: { idempotencyKey?: string }) =>
    request<T>(path, { method: 'PATCH', body, ...options }),
  del: <T>(path: string, body?: unknown) => request<T>(path, { method: 'DELETE', body }),
};

/** Non-throwing variant for optimistic UI and background refreshes that must not crash a page. */
export async function apiSafe<T>(run: () => Promise<T>): Promise<{ ok: true; data: T } | { ok: false; error: ApiFailure }> {
  try {
    return { ok: true, data: await run() };
  } catch (error) {
    if (error instanceof ApiFailure) return { ok: false, error };
    return {
      ok: false,
      error: new ApiFailure(500, 'unexpected', error instanceof Error ? error.message : 'Something went wrong'),
    };
  }
}

/** `undefined`, `null` and empty strings are dropped so the server defaults apply. */
export function qs(params: Record<string, string | number | boolean | null | undefined>): string {
  const search = new URLSearchParams();
  for (const [key, value] of Object.entries(params)) {
    if (value === undefined || value === null || value === '') continue;
    search.set(key, String(value));
  }
  const query = search.toString();
  return query.length > 0 ? `?${query}` : '';
}

/** One key per user action; the server stores it and replays the response on a double tap. */
export const idempotencyKey = (scope: string) =>
  `${scope}:${Date.now().toString(36)}:${crypto.randomUUID().slice(0, 8)}`;
