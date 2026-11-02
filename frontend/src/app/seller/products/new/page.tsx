import type { Metadata } from 'next';
import { CircleSlash } from 'lucide-react';
import { sellerPage } from '@/lib/seller-page';
import { sellerShopOverview } from '@/lib/services/shops';
import { sellerCategoryOptions } from '@/lib/services/categories';
import { ProductForm, type SellerCategoryOption } from '@/components/seller/product-form';
import { EmptyState } from '@/components/ui/empty-state';
import { LinkButton } from '@/components/ui/link-button';

export const dynamic = 'force-dynamic';

export const metadata: Metadata = {
  title: 'Add a listing · Bemz seller',
  robots: { index: false },
};

/**
 * The two reads the form cannot work without: what the shop is called, where it is and how it
 * fulfils (so prices, delivery copy and the default fulfilment arrive pre-answered), and which
 * categories this seller is allowed to list in today.
 */
export default async function NewProductPage() {
  const { shop } = await sellerPage('/seller/products/new');

  const [overview, categoryRows] = await Promise.all([
    sellerShopOverview(shop.id),
    sellerCategoryOptions(shop.kycStatus === 'APPROVED'),
  ]);

  const categories = categoryRows as SellerCategoryOption[];
  if (categories.length === 0) {
    return (
      <EmptyState
        icon={<CircleSlash className="size-6" />}
        title="No categories are open for listings"
        description="Bemz publishes categories in batches. When one opens for your market it appears here automatically."
        action={
          <LinkButton href="/seller" variant="outline" size="sm">
            Back to overview
          </LinkButton>
        }
      />
    );
  }

  // The shop's own country decides the currency a price is typed in. A listing priced in a
  // currency the shop does not trade in would be rejected by the API anyway, so the form is
  // given the answer rather than a chooser.
  const countryCode = overview.shop.country.code === 'KE' ? 'KE' : 'UG';

  const blocked = categories.filter((category) => !category.listable).length;

  return (
    <div className="space-y-5">
      <section className="card p-5">
        <p className="text-xs font-semibold uppercase tracking-wide text-bemz-700">New listing</p>
        <h1 className="mt-1 text-2xl font-bold text-ink-950">Add a product to {overview.shop.name}</h1>
        <p className="mt-2 max-w-2xl text-sm text-ink-600">
          Fill in what you have, at what price, in how many pieces. Save it as a draft and keep working — nothing is
          visible to a buyer until you press publish.
        </p>
        {shop.kycStatus !== 'APPROVED' && blocked > 0 && (
          <p className="mt-3 rounded-card bg-amber-50 px-3 py-2 text-sm text-amber-900">
            {blocked} {blocked === 1 ? 'category is' : 'categories are'} held back until your ID is approved. You can
            still draft those listings — they just cannot go live yet.
          </p>
        )}
      </section>

      <ProductForm
        shopId={shop.id}
        currency={overview.shop.currency}
        countryCode={countryCode}
        categories={categories}
        kycApproved={shop.kycStatus === 'APPROVED'}
        defaultFulfilment={overview.shop.defaultFulfilment ?? 'SELLER_DELIVERY'}
      />
    </div>
  );
}
