import { withRoute, readJson, jsonBody, created, privateCache } from '@/lib/http';
import { requireSellerShop } from '@/lib/auth/guards';
import { submitKyc, withdrawKyc } from '@/lib/services/shops';
import { kycSubmissionSchema } from '@/lib/validation/catalog';

/**
 * `POST /api/seller/shop/kyc`
 *
 * Uploading a national ID is what unlocks gated categories (phones, building materials,
 * agro-chemicals) and the first payout. The identity fields are stored with the documents,
 * never shown back to the client: they are needed for tax invoices and disputes, and a
 * marketplace that echoes them into a browser is a data breach waiting for a cached page.
 *
 * Submitting does not activate a PENDING shop — only a reviewer's approval does.
 */
export const POST = withRoute(async (request: Request) => {
  const { shop } = await requireSellerShop();
  const input = await readJson(request, kycSubmissionSchema);

  return created(await submitKyc(shop, input), privateCache());
});

/**
 * `DELETE /api/seller/shop/kyc`
 *
 * Pulling a submission back before anyone reads it is allowed; once it is APPROVED the record
 * stays, because the platform must be able to show which documents justified the trust.
 */
export const DELETE = withRoute(async () => {
  const { shop } = await requireSellerShop();
  return jsonBody(await withdrawKyc(shop), 200, privateCache());
});

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';
