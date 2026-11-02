import { z } from 'zod';
import { withRoute, jsonBody, parseQuery, publicCatalogCache, privateCache, RouteContext } from '@/lib/http';
import { getSessionUser } from '@/lib/auth/guards';
import { getProductForShop, relatedProducts, registerProductView, toPublicProduct } from '@/lib/services/products';
import { listProductReviews } from '@/lib/services/reviews';
import { quoteBasket } from '@/lib/services/pricing';
import { reviewQuerySchema } from '@/lib/validation/catalog';
import { prisma } from '@/lib/prisma';

/** `/api/products/[shopSlug]/[productSlug]` — the listing page, in one request. */
const paramsSchema = z.object({
  shopSlug: z.string().min(2).max(80),
  productSlug: z.string().min(2).max(160),
});

const detailQuerySchema = z.object({
  /** When the buyer has already chosen a delivery district, the page shows the real fee. */
  districtId: z.coerce.number().int().positive().optional(),
  views: z.enum(['true', 'false']).default('true'),
});

/**
 * `GET /api/products/{shop-slug}/{product-slug}`
 *
 * The URL is shop-scoped because two stalls in Kampala can both list "Nokia 3310" and the
 * database allows it — `slug` is unique per shop, not globally.
 *
 * Everything the page needs arrives together: the listing, the seller card, three review
 * previews with the star breakdown, related items, and — only if the buyer has picked a
 * district — the delivery fee and window that will actually be charged.
 */
export const GET = withRoute<{ shopSlug: string; productSlug: string }>(
  async (request: Request, context: RouteContext<{ shopSlug: string; productSlug: string }>) => {
    const { shopSlug, productSlug } = paramsSchema.parse(context.params);
    const query = parseQuery(request, detailQuerySchema);

    const product = await getProductForShop(shopSlug, productSlug);
    const publicProduct = toPublicProduct(product);

    if (query.views === 'true') await registerProductView(product.id);

    const [related, reviews, user] = await Promise.all([
      relatedProducts(product),
      listProductReviews(product.id, reviewQuerySchema.parse({ filter: 'verified', perPage: 3 })),
      getSessionUser(),
    ]);

    const primaryVariant = product.variants.find((variant) => variant.isPrimary && !variant.isDisabled) ??
      product.variants.find((variant) => !variant.isDisabled);

    // A quote is only honest if the district is reachable; a bad one must not blank the page.
    let delivery: Awaited<ReturnType<typeof quoteDelivery>> | null = null;
    if (query.districtId && primaryVariant && publicProduct.purchasable && publicProduct.shop.isOpen) {
      delivery = await quoteDelivery(query.districtId, primaryVariant.id).catch(() => null);
    }

    const savedIds = user
      ? await prisma.wishlistEntry.findMany({ where: { userId: user.id, productId: product.id }, select: { id: true } })
      : [];

    return jsonBody(
      {
        product: publicProduct,
        isSaved: savedIds.length > 0,
        reviews: { summary: reviews.summary, preview: reviews.items },
        related,
        delivery,
        seo: {
          title: product.metaTitle ?? product.title,
          description: product.metaDescription ?? product.subtitle ?? undefined,
          canonical: `/${product.shop.slug}/product/${product.slug}`,
        },
      },
      200,
      user ? privateCache() : publicCatalogCache(30),
    );
  },
);

/** The single-item shipping quote behind "Delivers to Kampala in 1-2 days · UGX 5,000". */
async function quoteDelivery(districtId: number, variantId: string) {
  const quote = await quoteBasket({ lines: [{ variantId, quantity: 1 }], districtId });
  const basket = quote.baskets[0];
  if (!basket) return null;

  return {
    districtId: quote.districtId,
    districtName: quote.districtName,
    zoneName: basket.zoneName,
    shippingFeeMinor: basket.shippingFeeMinor,
    currency: basket.currency,
    estimatedDaysMin: basket.estimatedDaysMin,
    estimatedDaysMax: basket.estimatedDaysMax,
    cashOnDeliveryAllowed: basket.cashOnDeliveryAllowed,
    itemTotalMinor: basket.subtotalMinor,
  };
}

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';
