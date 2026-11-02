import 'server-only';
import { randomBytes, timingSafeEqual } from 'node:crypto';
import { prisma } from './prisma';
import { randomToken } from './ids';

/**
 * `Shop.slug` and `Category.slug` are globally unique and `Product.slug` is shop-scoped,
 * so both the API and the seed need one normaliser.
 */

const ALPHABET = '0123456789abcdefghijklmnopqrstuvwxyz';

export function slugify(input: string, maxLength = 70): string {
  const slug = input
    .normalize('NFKD')
    .replace(/[^\x00-\x7F]/g, '') // Kitenge/Jumia-style names carry accents and apostrophes
    .toLowerCase()
    .replace(/['".]/g, '')
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, maxLength)
    .replace(/-+$/g, '');

  return slug.length >= 3 ? slug : `${slug || 'item'}-${randomToken(6).toLowerCase()}`;
}

/**
 * Returns a collision-free slug by appending a random suffix when the base is taken;
 * `exists` is supplied by the caller because the uniqueness scope differs per model.
 */
export async function uniqueSlug(
  base: string,
  exists: (candidate: string) => Promise<boolean>,
  maxAttempts = 8,
): Promise<string> {
  const root = slugify(base);
  let candidate = root;

  for (let attempt = 0; attempt < maxAttempts; attempt += 1) {
    if (!(await exists(candidate))) return candidate;
    candidate = `${root}-${randomSuffix(4)}`;
  }

  throw new Error(`Could not allocate a unique slug from "${base}" after ${maxAttempts} attempts`);
}

function randomSuffix(length: number): string {
  const bytes = randomBytes(length);
  let out = '';
  for (let i = 0; i < length; i += 1) out += ALPHABET[bytes[i]! % ALPHABET.length];
  return out;
}

/** Shop slugs are global, so the lookup helper lives here to keep routes honest. */
export const shopSlugTaken = (slug: string) =>
  prisma.shop.findUnique({ where: { slug }, select: { id: true } }).then(Boolean);

export const categorySlugTaken = (slug: string) =>
  prisma.category.findUnique({ where: { slug }, select: { id: true } }).then(Boolean);

export const productSlugTaken = (shopId: string, slug: string) =>
  prisma.product
    .findUnique({ where: { shopId_slug: { shopId, slug } }, select: { id: true } })
    .then(Boolean);

/** Used by tests to prove `timingSafeEqual` guards are in place. */
export function constantTimeCompare(a: string, b: string): boolean {
  const bufferA = Buffer.from(a);
  const bufferB = Buffer.from(b);
  if (bufferA.length !== bufferB.length) return false;
  return timingSafeEqual(bufferA, bufferB);
}
