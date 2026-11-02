import { z } from 'zod';
import { CURRENCIES } from './enums';

/** Reusable primitives so every route validates money, phones and pagination the same way. */

export const CURRENCY_VALUES = CURRENCIES;

export const phone = z
  .string()
  .trim()
  .min(9, 'Phone number is too short')
  .max(20, 'Phone number is too long')
  .regex(/^\+?[0-9 ()-]{9,20}$/, 'Use digits only, e.g. 077 1234 567 or +254712345678');

/** Amounts travel as integer minor units; a float in an API body is a client bug. */
export const minorAmount = z
  .number({ invalid_type_error: 'Amount must be a number of minor units (e.g. UGX 4,000 = 400000)' })
  .int('Amount must be a whole number of minor units')
  .nonnegative()
  .max(1_000_000_000_000, 'Amount is unrealistically large');

export const positiveMinorAmount = minorAmount.refine((value) => value > 0, 'Price must be greater than zero');

export const currency = z.enum(CURRENCY_VALUES);

export const quantity = z
  .number()
  .int('Quantity must be a whole number')
  .min(1, 'At least one item')
  .max(999, 'Order more than 999 units through a seller quote');

export const pagination = z.object({
  page: z.coerce.number().int().min(1).default(1),
  perPage: z.coerce.number().int().min(1).max(60).default(20),
});

export const idParam = z.object({ id: z.string().min(1).max(64) });

export const slugParam = z.object({ slug: z.string().min(2).max(120) });

export const cuid = z.string().min(8).max(64);

/** Basis points keep percentages free of float drift: 1250 === 12.5%. */
export const basisPoints = z.number().int().min(0).max(10_000);

export const shortText = (max: number) => z.string().trim().min(1).max(max);

export const optionalText = (max: number) =>
  z
    .string()
    .trim()
    .max(max)
    .optional()
    .transform((value) => (value === '' ? undefined : value));

export const isoDate = z
  .string()
  .datetime({ offset: true, message: 'Use an ISO 8601 timestamp, e.g. 2026-10-29T10:00:00Z' });

export const hexColor = z.string().regex(/^#[0-9a-fA-F]{6}$/, 'Use a hex colour like #1F8A4C');

/**
 * Search filters pass variant attributes as a JSON object in the query string
 * (`?attributes={"Colour":"Black"}`); validating the shape here keeps a malformed
 * value from reaching the raw SQL containment operator.
 */
export function isJsonObjectString(value?: string): boolean {
  if (!value) return true;
  try {
    const parsed: unknown = JSON.parse(value);
    return typeof parsed === 'object' && parsed !== null && !Array.isArray(parsed);
  } catch {
    return false;
  }
}

export function parseJsonObject(value?: string): Record<string, string> | undefined {
  if (!value || !isJsonObjectString(value)) return undefined;
  const parsed = JSON.parse(value) as Record<string, unknown>;
  const entries = Object.entries(parsed).filter(
    (entry): entry is [string, string] => typeof entry[1] === 'string' || typeof entry[1] === 'number',
  );
  return entries.length > 0 ? Object.fromEntries(entries) : undefined;
}
