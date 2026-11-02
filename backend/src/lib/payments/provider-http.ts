import 'server-only';
import { serviceUnavailable } from '../http';

/**
 * Provider HTTP with a hard deadline.
 *
 * A MoMo call that hangs is worse than one that fails: the buyer stands at a checkout
 * screen with no answer. Every operator request therefore gets a timeout, and a timeout is
 * reported as "we do not know yet" (the payment stays PENDING and the status poller or the
 * webhook resolves it) rather than as a failure — the money may already have moved.
 */

export type JsonRecord = Record<string, unknown>;

const DEFAULT_TIMEOUT_MS = 20_000;

export async function postJson(url: string, body: unknown, headers: Record<string, string>, timeoutMs = DEFAULT_TIMEOUT_MS): Promise<JsonRecord> {
  return request(url, { method: 'POST', body: JSON.stringify(body), headers });
}

export async function getJson(url: string, headers: Record<string, string>, timeoutMs = DEFAULT_TIMEOUT_MS): Promise<JsonRecord> {
  return request(url, { method: 'GET', headers });
}

/** Some operator sandboxes answer DELETE/POST with an empty body; 204 must not throw. */
export async function requestRaw(url: string, init: RequestInit, timeoutMs = DEFAULT_TIMEOUT_MS): Promise<{ ok: boolean; status: number; body: JsonRecord }> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const response = await fetch(url, { ...init, signal: controller.signal });
    const text = await response.text();
    let parsed: JsonRecord = {};
    if (text.trim().length > 0) {
      try {
        parsed = JSON.parse(text) as JsonRecord;
      } catch {
        parsed = { rawText: text };
      }
    }
    return { ok: response.ok, status: response.status, body: parsed };
  } catch (error) {
    if (error instanceof Error && error.name === 'AbortError') {
      throw serviceUnavailable('The payment network did not answer in time — check your payment status before trying again');
    }
    throw serviceUnavailable('The payment network is unreachable right now', { cause: String(error) });
  } finally {
    clearTimeout(timer);
  }
}

async function request(url: string, init: RequestInit): Promise<JsonRecord> {
  const response = await requestRaw(url, { ...init, headers: { 'content-type': 'application/json', accept: 'application/json', ...init.headers } });
  if (!response.ok) {
    const responseMessage = typeof response.body.message === 'string' ? response.body.message : JSON.stringify(response.body).slice(0, 300);
    throw serviceUnavailable(`Payment provider returned ${response.status}: ${responseMessage}`, response.body);
  }
  return response.body;
}

/** Caches an OAuth token for slightly less than its lifetime so a burst of checkouts shares one token. */
export class TokenCache {
  private token: string | null = null;
  private expiresAt = 0;

  constructor(private readonly fetchToken: () => Promise<{ token: string; expiresInSeconds: number }>) {}

  async get(): Promise<string> {
    const now = Date.now();
    if (this.token && now < this.expiresAt) return this.token;
    const fresh = await this.fetchToken();
    this.token = fresh.token;
    this.expiresAt = now + Math.max(30, fresh.expiresInSeconds - 60) * 1000;
    return fresh.token;
  }

  invalidate(): void {
    this.token = null;
    this.expiresAt = 0;
  }
}

export function readString(value: unknown): string | null {
  return typeof value === 'string' && value.length > 0 ? value : null;
}

export function readNumber(value: unknown): number | null {
  if (typeof value === 'number' && Number.isFinite(value)) return value;
  if (typeof value === 'string' && value.trim().length > 0) {
    const parsed = Number(value);
    return Number.isFinite(parsed) ? parsed : null;
  }
  return null;
}

/** Follows a `a.b.c` path through an unknown provider payload. */
export function pick(source: unknown, path: string): unknown {
  let current: unknown = source;
  for (const key of path.split('.')) {
    if (current == null || typeof current !== 'object') return undefined;
    current = (current as JsonRecord)[key];
  }
  return current;
}

export function firstString(source: unknown, paths: string[]): string | null {
  for (const path of paths) {
    const value = readString(pick(source, path));
    if (value) return value;
  }
  return null;
}

export const basicAuth = (user: string, secret: string) =>
  `Basic ${Buffer.from(`${user}:${secret}`).toString('base64')}`;
