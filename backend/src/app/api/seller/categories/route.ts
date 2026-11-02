import { withRoute, jsonBody, publicCatalogCache, privateCache } from '@/lib/http';
import { requireSellerShop } from '@/lib/auth/guards';
import { sellerCategoryOptions } from '@/lib/services/categories';

/**
 * `GET /api/seller/categories`
 *
 * The category picker in the listing form, filtered by what this seller is actually allowed to
 * list in. A trader without approved ID sees gated categories as locked rather than absent —
 * hiding them would leave them convinced the marketplace does not do phones.
 *
 * The list is the same for every seller in the same KYC state, so it is keyed on that: an
 * approved seller gets a shared cache entry, everyone else a private one.
 */
export const GET = withRoute(async () => {
  const { shop } = await requireSellerShop();
  const kycApproved = shop.kycStatus === 'APPROVED';
  const categories = await sellerCategoryOptions(kycApproved);

  return jsonBody({ kycApproved, categories }, 200, kycApproved ? publicCatalogCache(300) : privateCache());
});

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';
