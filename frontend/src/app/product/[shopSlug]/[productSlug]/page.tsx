import type { Metadata } from 'next';
import Link from 'next/link';
import { BadgeCheck, MessageCircle, ShieldCheck, Store } from 'lucide-react';
import { getProductForShop, relatedProducts, registerProductView, toPublicProduct } from '@/lib/services/products';
import { listProductReviews } from '@/lib/services/reviews';
import { wishlistStatus } from '@/lib/services/wishlist';
import { getSessionUser } from '@/lib/auth/guards';
import { pageData } from '@/lib/page-data';
import { parseReviewParams } from '@/lib/product-review-params';
import { ProductCard, ProductRail } from '@/components/product-card';
import { ProductGallery } from '@/components/product/gallery';
import { ProductPurchaser, type PurchaseModel } from '@/components/product/purchaser';
import { AskQuestionForm } from '@/components/product/ask-question-form';
import { ReviewPanel } from '@/components/review/review-panel';
import { ProductReviewForm } from '@/components/review/product-review-form';
import { ListingImage } from '@/components/ui/listing-image';
import { Stars } from '@/components/ui/stars';
import { Badge } from '@/components/ui/badge';
import { EmptyState } from '@/components/ui/empty-state';
import { formatDateTime } from '@/lib/client/format';

/**
 * `GET /product/[shopSlug]/[productSlug]`
 *
 * The slug pair is the canonical URL — a product id in the address bar would break the "same
 * title, different shop" case and give a crawler nothing to dedupe on. Views are counted here
 * rather than by a beacon, because the server already knows the listing was really rendered.
 */
export const dynamic = 'force-dynamic';

interface Props {
  params: { shopSlug: string; productSlug: string };
  searchParams: Record<string, string | string[] | undefined>;
}

export async function generateMetadata({ params }: Props): Promise<Metadata> {
  const product = await getProductForShop(params.shopSlug, params.productSlug).catch(() => null);
  if (!product) return { title: 'Listing not found' };

  const title = product.metaTitle ?? product.title;
  const description = product.metaDescription ?? product.subtitle ?? `${product.title} on Bemz Africa.`;

  return {
    title,
    description,
    openGraph: {
      title,
      description,
      images: product.images[0] ? [{ url: product.images[0].url }] : undefined,
    },
  };
}

export default async function ProductPage({ params, searchParams }: Props) {
  const user = await getSessionUser();
  const row = await pageData(getProductForShop(params.shopSlug, params.productSlug));
  const product = toPublicProduct(row);

  const reviewParams = parseReviewParams(searchParams);

  const [reviews, related, saved] = await Promise.all([
    listProductReviews(product.id, reviewParams.query, user?.id),
    relatedProducts(row, 12),
    user ? wishlistStatus(user.id, [product.id]) : Promise.resolve({ count: 0, saved: [] as string[] }),
  ]);
  await registerProductView(product.id);

  const purchase: PurchaseModel = {
    id: product.id,
    title: product.title,
    currency: product.currency,
    condition: product.condition,
    isDigital: product.isDigital,
    warrantyText: product.warrantyText,
    purchasable: product.purchasable,
    startingPriceMinor: product.startingPriceMinor,
    shop: {
      name: product.shop.name,
      country: { code: product.shop.country.code },
      isOpen: product.shop.isOpen,
      dispatchSlaHours: product.shop.dispatchSlaHours,
    },
    variants: product.variants.map((variant) => ({
      id: variant.id,
      name: variant.name,
      priceMinor: variant.priceMinor,
      compareAtPriceMinor: variant.compareAtPriceMinor,
      currency: variant.currency,
      isPrimary: variant.isPrimary,
      availableStock: variant.availableStock,
      maxQuantityPerOrder: variant.maxQuantityPerOrder,
      images: variant.images.map((image) => ({ url: image.url, altText: image.altText })),
    })),
  };

  return (
    <div className="container-page py-6">
      <nav aria-label="Breadcrumb" className="text-sm text-ink-500">
        <ol className="flex flex-wrap items-center gap-1.5">
          <li>
            <Link href="/" className="hover:text-bemz-700">
              Home
            </Link>
          </li>
          {product.primaryCategory && (
            <li className="flex items-center gap-1.5">
              <span aria-hidden>/</span>
              <Link href={`/category/${product.primaryCategory.slug}`} className="hover:text-bemz-700">
                {product.primaryCategory.name}
              </Link>
            </li>
          )}
          <li className="flex items-center gap-1.5">
            <span aria-hidden>/</span>
            <span aria-current="page" className="line-clamp-1 font-medium text-ink-800">
              {product.title}
            </span>
          </li>
        </ol>
      </nav>

      <div className="mt-4 grid gap-8 lg:grid-cols-[minmax(0,1fr)_400px]">
        <div className="space-y-8">
          <ProductGallery images={product.images} alt={product.title} priority />

          <div>
            <h1 className="text-2xl font-bold leading-tight text-ink-950">{product.title}</h1>
            {product.subtitle && <p className="mt-1.5 text-base text-ink-600">{product.subtitle}</p>}

            <div className="mt-3 flex flex-wrap items-center gap-3 text-sm text-ink-500">
              <Stars value={product.ratingAvg} />
              {product.ratingCount > 0 && <a href="#reviews" className="hover:text-bemz-700">{product.ratingCount} reviews</a>}
              {product.soldCount > 0 && <span>{product.soldCount} sold</span>}
              {product.brand && <span>Brand: {product.brand}</span>}
            </div>
          </div>

          <div className="card space-y-3 p-5">
            <h2 className="font-semibold text-ink-900">About this item</h2>
            <p className="whitespace-pre-line text-sm leading-relaxed text-ink-700">{product.description}</p>

            {Object.keys(product.facets).length > 0 && (
              <div className="overflow-hidden rounded-card border border-ink-200">
                <table className="w-full text-sm">
                  <caption className="sr-only">Product specifications</caption>
                  <tbody>
                    {Object.entries(product.facets).map(([name, values]) => (
                      <tr key={name} className="border-b border-ink-100 last:border-0">
                        <th scope="row" className="w-40 bg-ink-50 px-3 py-2 text-left font-medium text-ink-700">
                          {name}
                        </th>
                        <td className="px-3 py-2 text-ink-700">{values.join(', ')}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </div>

          <section id="reviews" className="card scroll-mt-24 space-y-4 p-5">
            <h2 className="font-semibold text-ink-900">Buyer reviews</h2>
            <ReviewPanel
              pathname={`/product/${params.shopSlug}/${params.productSlug}`}
              items={reviews.items}
              summary={reviews.summary}
              page={reviews.page}
              perPage={reviews.perPage}
              total={reviews.total}
              filter={reviewParams.query.filter}
              signedIn={Boolean(user)}
              emptyState={
                <EmptyState
                  title="No reviews in this filter"
                  description="Reviews appear here after buyers receive the item, so only a real purchase can leave one."
                />
              }
            />
          </section>

          <section className="card space-y-4 p-5">
            <h2 className="font-semibold text-ink-900">Rate this item</h2>
            {user ? (
              <ProductReviewForm shopSlug={params.shopSlug} productSlug={params.productSlug} />
            ) : (
              <p className="text-sm text-ink-600">
                <Link
                  href={`/login?callbackUrl=${encodeURIComponent(`/product/${params.shopSlug}/${params.productSlug}`)}`}
                  className="font-medium text-bemz-700 hover:underline"
                >
                  Sign in
                </Link>{' '}
                to review an item you ordered. Ratings from a delivered order are marked verified.
              </p>
            )}
          </section>

          <section className="card space-y-4 p-5">
            <div className="flex items-center gap-2">
              <MessageCircle className="size-4 text-bemz-600" />
              <h2 className="font-semibold text-ink-900">Questions from buyers</h2>
            </div>

            {product.questions.length === 0 ? (
              <p className="text-sm text-ink-500">No questions yet. Ask the seller what matters to you.</p>
            ) : (
              <ul className="divide-y divide-ink-200">
                {product.questions.map((question) => (
                  <li key={question.id} className="py-3">
                    <p className="text-sm font-medium text-ink-900">{question.body}</p>
                    <p className="mt-0.5 text-xs text-ink-500">
                      {question.askedBy} · {formatDateTime(question.askedAt)}
                    </p>
                    {question.answers.map((answer) => (
                      <div
                        key={answer.id}
                        className="mt-2 rounded-card bg-ink-50 p-3 text-sm text-ink-700"
                      >
                        <p>{answer.body}</p>
                        <p className="mt-1 text-xs text-ink-500">
                          {answer.by}
                          {answer.isFromSeller && ' (the seller)'} · {formatDateTime(answer.at)}
                        </p>
                      </div>
                    ))}
                  </li>
                ))}
              </ul>
            )}

            {user ? (
              <AskQuestionForm shopSlug={params.shopSlug} productSlug={params.productSlug} />
            ) : (
              <p className="text-sm text-ink-500">
                <Link href={`/login?callbackUrl=${encodeURIComponent(`/product/${params.shopSlug}/${params.productSlug}`)}`} className="text-bemz-700 hover:underline">
                  Sign in
                </Link>{' '}
                to ask the seller a question.
              </p>
            )}
          </section>
        </div>

        <aside className="space-y-5 lg:sticky lg:top-20 lg:self-start">
          <div className="card space-y-5 p-5">
            <ProductPurchaser product={purchase} signedIn={Boolean(user)} savedInitially={saved.saved.length > 0} />
          </div>

          <Link href={`/shop/${product.shop.slug}`} className="card flex items-center gap-3 p-4 hover:shadow-raised">
            <ListingImage src={product.shop.logoUrl} alt="" className="size-12 shrink-0 rounded-lg" sizes="48px" />
            <div className="min-w-0">
              <p className="flex items-center gap-1.5 truncate text-sm font-semibold text-ink-900">
                {product.shop.name}
                {product.shop.isVerified && <BadgeCheck className="size-4 shrink-0 text-bemz-600" aria-label="Verified shop" />}
              </p>
              <p className="text-xs text-ink-500">
                {product.shop.fromDistrict ? `From ${product.shop.fromDistrict} · ` : ''}
                {product.shop.totalSalesCount.toLocaleString()} orders
              </p>
              {product.shop.ratingAvg !== null && (
                <p className="mt-0.5 text-xs text-ink-500">{product.shop.ratingAvg.toFixed(1)}★ from {product.shop.ratingCount} buyers</p>
              )}
            </div>
            <span className="ml-auto text-xs font-medium text-bemz-700">Visit shop</span>
          </Link>

          {product.isDigital ? (
            <div className="card space-y-2 p-4 text-sm text-ink-600">
              <p className="flex items-center gap-2 font-semibold text-ink-900">
                <ShieldCheck className="size-4 text-bemz-600" />
                How delivery works
              </p>
              <p>No parcel: the code or file is sent to you as soon as the payment settles.</p>
            </div>
          ) : (
            <div className="card space-y-2 p-4 text-sm text-ink-600">
              <p className="flex items-center gap-2 font-semibold text-ink-900">
                <Store className="size-4 text-bemz-600" />
                How delivery works
              </p>
              <p>
                The seller packs within {product.shop.dispatchSlaHours}h. A rider takes it to your district, and the fee
                and the days depend on the zone, so choose your district above to see both.
              </p>
              {product.shop.deliveryZone && (
                <p className="text-xs text-ink-500">
                  Ships from {product.shop.fromDistrict ?? 'the seller'} · {product.shop.deliveryZone.name} zone · usually{' '}
                  {product.shop.deliveryZone.estimatedDaysMin}–{product.shop.deliveryZone.estimatedDaysMax} days
                </p>
              )}
            </div>
          )}

          {product.categories.filter((category) => !category.isPrimary).length > 0 && (
            <div className="flex flex-wrap gap-1.5">
              {product.categories.map((category) => (
                <Badge key={category.slug} tone="neutral">
                  <Link href={`/category/${category.slug}`}>{category.name}</Link>
                </Badge>
              ))}
            </div>
          )}
        </aside>
      </div>

      {related.length > 0 && (
        <section className="mt-12">
          <ProductRail
            title="More in this category"
            href={product.primaryCategory ? `/category/${product.primaryCategory.slug}` : undefined}
          >
            <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-6">
              {related.map((item) => (
                <ProductCard key={item.id} product={item} />
              ))}
            </div>
          </ProductRail>
        </section>
      )}
    </div>
  );
}
