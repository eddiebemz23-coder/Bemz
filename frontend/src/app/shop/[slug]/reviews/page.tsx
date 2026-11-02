import type { Metadata } from 'next';
import Link from 'next/link';
import { ChevronLeft } from 'lucide-react';
import { getShopBySlug } from '@/lib/services/shops';
import { listShopReviews } from '@/lib/services/reviews';
import { getSessionUser } from '@/lib/auth/guards';
import { pageData } from '@/lib/page-data';
import { parseReviewParams } from '@/lib/product-review-params';
import { EmptyState } from '@/components/ui/empty-state';
import { ReviewPanel } from '@/components/review/review-panel';
import { ShopReviewForm } from '@/components/review/shop-review-form';

/**
 * `GET /shop/[slug]/reviews`
 *
 * Shop reviews judge the trader — dispatch speed, whether the parcel matched the photo, how the
 * rider handled cash — so they are a separate thread from the item ratings on each listing.
 */
export const dynamic = 'force-dynamic';

interface Props {
  params: { slug: string };
  searchParams: Record<string, string | string[] | undefined>;
}

export async function generateMetadata({ params }: Props): Promise<Metadata> {
  const page = await getShopBySlug(params.slug).catch(() => null);
  if (!page) return { title: 'Shop not found' };

  return {
    title: `${page.shop.name} — buyer reviews`,
    description: `Ratings for ${page.shop.name} on Bemz Africa: delivery speed, accuracy and how the seller communicates.`,
  };
}

export default async function ShopReviewsPage({ params, searchParams }: Props) {
  const user = await getSessionUser();
  const pathname = `/shop/${params.slug}/reviews`;
  const reviewParams = parseReviewParams(searchParams);

  const page = await pageData(getShopBySlug(params.slug));
  const reviews = await listShopReviews(page.shop.id, reviewParams.query, user?.id);

  return (
    <div className="container-page space-y-5 py-6">
      <Link href={`/shop/${params.slug}`} className="inline-flex items-center gap-1 text-sm text-ink-600 hover:text-bemz-700">
        <ChevronLeft className="size-4" aria-hidden />
        Back to {page.shop.name}
      </Link>

      <header>
        <h1 className="text-xl font-bold text-ink-950 sm:text-2xl">Reviews for {page.shop.name}</h1>
        <p className="mt-1 text-sm text-ink-600">
          {page.shop.totalSalesCount.toLocaleString()} orders delivered · replies from the seller appear under the
          review they answer.
        </p>
      </header>

      <section className="card space-y-5 p-5">
        <ReviewPanel
          pathname={pathname}
          items={reviews.items}
          summary={reviews.summary}
          page={reviews.page}
          perPage={reviews.perPage}
          total={reviews.total}
          filter={reviewParams.query.filter}
          signedIn={Boolean(user)}
          emptyState={
            <EmptyState
              title="No ratings yet"
              description={`${page.shop.name} has not been reviewed in this filter. Buyers rate a shop after their parcel arrives.`}
            />
          }
        />
      </section>

      <section className="card space-y-4 p-5">
        <h2 className="font-semibold text-ink-900">Rate this shop</h2>
        {user ? (
          <ShopReviewForm shopSlug={params.slug} />
        ) : (
          <p className="text-sm text-ink-600">
            <Link href={`/login?callbackUrl=${encodeURIComponent(pathname)}`} className="font-medium text-bemz-700 hover:underline">
              Sign in
            </Link>{' '}
            to rate a seller you have ordered from.
          </p>
        )}
      </section>
    </div>
  );
}
