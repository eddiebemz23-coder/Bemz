import 'server-only';
import { Prisma, prisma, type CurrencyCode } from '../prisma';
import { conflict, notFound } from '../http';

/**
 * Saved items.
 *
 * In this market a wishlist is a price watch: a buyer saves a phone today and comes back
 * when the seller drops it. So the read returns live price, stock and the discount against
 * what they saved it at — a list of dead listings is a list that gets cleared.
 */

const savedSelect = {
  id: true,
  createdAt: true,
  product: {
    select: {
      id: true,
      title: true,
      slug: true,
      status: true,
      deletedAt: true,
      startingPriceMinor: true,
      currency: true,
      discountPct: true,
      ratingAvg: true,
      ratingCount: true,
      images: { where: { variantId: null }, orderBy: { position: 'asc' }, take: 1, select: { url: true } },
      variants: { where: { deletedAt: null, isDisabled: false }, select: { stockQuantity: true, reservedQuantity: true } },
      shop: { select: { id: true, name: true, slug: true, vacationMode: true, status: true } },
    },
  },
} satisfies Prisma.WishlistEntrySelect;

type SavedRow = Prisma.WishlistEntryGetPayload<{ select: typeof savedSelect }>;

function toSaved(row: SavedRow) {
  const product = row.product;
  const purchasable =
    product.status === 'ACTIVE' &&
    product.deletedAt === null &&
    product.shop.status === 'ACTIVE' &&
    !product.shop.vacationMode;

  const available = product.variants.reduce((sum, variant) => sum + Math.max(0, variant.stockQuantity - variant.reservedQuantity), 0);

  return {
    wishlistId: row.id,
    savedAt: row.createdAt,
    id: product.id,
    title: product.title,
    slug: product.slug,
    shopSlug: product.shop.slug,
    shop: { id: product.shop.id, name: product.shop.name, slug: product.shop.slug },
    imageUrl: product.images[0]?.url ?? null,
    startingPriceMinor: product.startingPriceMinor,
    currency: product.currency as CurrencyCode,
    discountPct: product.discountPct,
    ratingAvg: product.ratingAvg === null ? null : Number(product.ratingAvg),
    ratingCount: product.ratingCount,
    inStock: purchasable && available > 0,
    availableQuantity: available,
    // The seller took it down; the row stays so the buyer can un-save it deliberately.
    isPurchasable: purchasable,
    unavailableReason: purchasable ? null : product.deletedAt ? 'removed' : product.shop.vacationMode ? 'shop on vacation' : 'not listed',
  };
}

/** `GET /api/wishlist` */
export async function listWishlist(userId: string) {
  const rows = await prisma.wishlistEntry.findMany({
    where: { userId },
    select: savedSelect,
    orderBy: { createdAt: 'desc' },
  });

  const items = rows.map(toSaved);
  return {
    items,
    total: items.length,
    availableCount: items.filter((item) => item.inStock).length,
  };
}

/** `POST /api/wishlist` — idempotent: saving what is already saved is not an error. */
export async function addToWishlist(userId: string, productId: string) {
  const product = await prisma.product.findUnique({
    where: { id: productId },
    select: { id: true, title: true, slug: true, deletedAt: true, shop: { select: { slug: true } } },
  });
  if (!product || product.deletedAt) throw notFound('That item is no longer listed');

  const existing = await prisma.wishlistEntry.findUnique({
    where: { userId_productId: { userId, productId } },
    select: { id: true },
  });
  if (existing) return { id: existing.id, alreadySaved: true };

  const entry = await prisma.$transaction(async (tx) => {
    const created = await tx.wishlistEntry.create({ data: { userId, productId }, select: { id: true, createdAt: true } });
    await tx.product.update({ where: { id: productId }, data: { wishlistsCount: { increment: 1 } } });
    return created;
  });

  return { ...entry, alreadySaved: false, link: `/${product.shop.slug}/product/${product.slug}` };
}

/** `DELETE /api/wishlist/[productId]` */
export async function removeFromWishlist(userId: string, productId: string) {
  const entry = await prisma.wishlistEntry.findUnique({
    where: { userId_productId: { userId, productId } },
    select: { id: true },
  });
  if (!entry) throw conflict('That item was not on your list');

  await prisma.$transaction([
    prisma.wishlistEntry.delete({ where: { id: entry.id } }),
    // Only decrement what was actually counted; a clamped zero keeps the badge honest.
    prisma.product.update({ where: { id: productId }, data: { wishlistsCount: { decrement: 1 } } }),
  ]);

  return { removed: true };
}

/** The header badge, and the "is this heart filled?" check on a product page. */
export async function wishlistStatus(userId: string, productIds: string[]) {
  if (productIds.length === 0) return { count: 0, saved: [] as string[] };

  const rows = await prisma.wishlistEntry.findMany({
    where: { userId, productId: { in: productIds } },
    select: { productId: true },
  });

  return {
    count: await prisma.wishlistEntry.count({ where: { userId } }),
    saved: rows.map((row) => row.productId),
  };
}
