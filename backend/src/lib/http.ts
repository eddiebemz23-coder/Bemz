import { NextResponse } from 'next/server';
import { ZodError } from 'zod';
import { Prisma } from '@prisma/client';
import { env } from './env';

/**
 * Every API response is `{ data }` or `{ error: { code, message, details? } }`.
 * Keeping the envelope fixed means the mobile app and the web client share one parser.
 */

export class ApiError extends Error {
  readonly status: number;
  readonly code: string;
  readonly details?: unknown;

  constructor(status: number, code: string, message: string, details?: unknown) {
    super(message);
    this.name = 'ApiError';
    this.status = status;
    this.code = code;
    this.details = details;
  }
}

export const badRequest = (message: string, details?: unknown) =>
  new ApiError(400, 'bad_request', message, details);
export const unauthorized = (message = 'Sign in required') => new ApiError(401, 'unauthorized', message);
export const forbidden = (message = 'Not allowed') => new ApiError(403, 'forbidden', message);
export const notFound = (message = 'Not found') => new ApiError(404, 'not_found', message);
export const conflict = (message: string, details?: unknown) => new ApiError(409, 'conflict', message, details);
export const unprocessable = (message: string, details?: unknown) =>
  new ApiError(422, 'validation_failed', message, details);
export const tooManyRequests = (message = 'Too many requests, try again shortly', retryAfterSeconds = 60) =>
  new ApiError(429, 'rate_limited', message, { retryAfterSeconds });
export const serviceUnavailable = (message: string, details?: unknown) =>
  new ApiError(503, 'upstream_unavailable', message, details);

export function jsonBody(data: unknown, status = 200, headers?: Record<string, string>) {
  return NextResponse.json({ data }, { status, headers });
}

export const created = (data: unknown, headers?: Record<string, string>) => jsonBody(data, 201, headers);
export const noContent = () => new NextResponse(null, { status: 204 });

type ValidationIssue = { field: string; message: string };

function zodIssues(error: ZodError): ValidationIssue[] {
  return error.issues.map((issue) => ({
    field: issue.path.join('.') || '(root)',
    message: issue.message,
  }));
}

function fromPrisma(error: unknown): ApiError | undefined {
  if (error instanceof Prisma.PrismaClientKnownRequestError) {
    if (error.code === 'P2002') {
      const target = (error.meta?.target as string[] | string | undefined) ?? 'value';
      const fields = Array.isArray(target) ? target.join(', ') : String(target);
      return new ApiError(409, 'already_exists', `A record with this ${fields} already exists`);
    }
    if (error.code === 'P2025') return notFound('That record no longer exists');
    if (error.code === 'P2003') return badRequest('Related record is missing or already deleted');
    if (error.code === 'P2000') return badRequest('Value is too long for this field');
    return new ApiError(500, 'database_error', `Database request failed (${error.code})`);
  }
  if (error instanceof Prisma.PrismaClientValidationError) {
    return badRequest('The database query was malformed');
  }
  if (error instanceof Prisma.PrismaClientInitializationError) {
    return serviceUnavailable('Database is not reachable yet — is PostgreSQL running and migrated?');
  }
  return undefined;
}

export type RouteContext<P extends Record<string, string> = Record<string, never>> = { params: P };

type Handler<P extends Record<string, string>> = (
  request: Request,
  context: RouteContext<P>,
) => Response | Promise<Response>;

/**
 * Wraps a route handler so thrown ApiError/ZodError/Prisma errors become the standard
 * envelope and unexpected failures are logged with a request id the buyer can quote to support.
 */
export function withRoute<P extends Record<string, string> = Record<string, never>>(handler: Handler<P>) {
  return async (request: Request, context: RouteContext<P>): Promise<Response> => {
    const requestId = crypto.randomUUID();
    try {
      const response = await handler(request, context);
      response.headers.set('x-request-id', requestId);
      return response;
    } catch (error) {
      const normalised = normalise(error, requestId);
      if (normalised.status >= 500) {
        console.error(`[api ${requestId}]`, request.method, new URL(request.url).pathname, error);
      } else {
        console.warn(`[api ${requestId}] ${normalised.code}: ${normalised.message}`);
      }
      return NextResponse.json(
        { error: { code: normalised.code, message: normalised.message, details: normalised.details } },
        { status: normalised.status, headers: { 'x-request-id': requestId } },
      );
    }
  };
}

function normalise(error: unknown, requestId: string): ApiError {
  if (error instanceof ApiError) return error;
  if (error instanceof ZodError) {
    return new ApiError(422, 'validation_failed', 'Some fields need attention', zodIssues(error));
  }
  const prismaError = fromPrisma(error);
  if (prismaError) return prismaError;
  if (error instanceof SyntaxError) return badRequest('Request body is not valid JSON');
  return new ApiError(500, 'internal_error', `Something went wrong (ref ${requestId})`);
}

/** Parse + validate a JSON body. Empty body becomes `{}` so PATCH-style routes can use defaults. */
export async function readJson<Schema extends { parse: (value: unknown) => unknown }>(
  request: Request,
  schema: Schema,
) {
  const text = await request.text();
  const raw = text.trim().length === 0 ? {} : JSON.parse(text);
  return schema.parse(raw) as ReturnType<Schema['parse']>;
}

export async function readForm<Schema extends { parse: (value: unknown) => unknown }>(
  request: Request,
  schema: Schema,
) {
  const form = await request.formData();
  const record: Record<string, unknown> = {};
  form.forEach((value, key) => {
    record[key] = value;
  });
  return schema.parse(record) as ReturnType<Schema['parse']>;
}

export function parseQuery<Schema extends { parse: (value: unknown) => unknown }>(
  request: Request,
  schema: Schema,
) {
  const url = new URL(request.url);
  const record: Record<string, string> = {};
  url.searchParams.forEach((value, key) => {
    record[key] = value;
  });
  return schema.parse(record) as ReturnType<Schema['parse']>;
}

/** `Cache-Control` for public catalog reads; sellers' own data must never be shared-cacheable. */
export const publicCatalogCache = (seconds = 30) => ({
  'cache-control': `public, s-maxage=${seconds}, stale-while-revalidate=${seconds * 2}`,
});

export const privateCache = () => ({ 'cache-control': 'private, no-store' });

/** Used by dev tooling and tests to confirm the envelope shape. */
export const ERROR_CODES = [
  'bad_request',
  'unauthorized',
  'forbidden',
  'not_found',
  'conflict',
  'already_exists',
  'validation_failed',
  'rate_limited',
  'database_error',
  'upstream_unavailable',
  'internal_error',
] as const;

export const runtimeConfig = () => ({
  appUrl: env().NEXT_PUBLIC_APP_URL,
  nodeEnv: env().NODE_ENV,
});
