import { withRoute, jsonBody, readJson, parseQuery, created, privateCache } from '@/lib/http';
import { requireSellerShop } from '@/lib/auth/guards';
import { createProduct, listSellerProducts } from '@/lib/services/products';
import { createProductSchema, sellerProductQuerySchema } from '@/lib/validation/catalog';

/**
 * `GET /api/seller/products`
 *
 * Includes drafts and rejected listings — the seller's own workshop, not the shop window. A
 * rejected row carries `rejectionReason`, because "we said no" without a reason is the number
 * one reason traders give up on a marketplace.
 */
export const GET = withRoute(async (request: Request) => {
  const { shop } = await requireSellerShop();
  const query = parseQuery(request, sellerProductQuerySchema);

  return jsonBody(await listSellerProducts(shop.id, query), 200, privateCache());
});

/**
 * `POST /api/seller/products`
 *
 * One transaction writes the product, its variants, its photos and its facet rows: a listing
 * saved with prices but no stock row is a listing that will oversell.
 *
 * `publish: true` does not guarantee `ACTIVE` — a shop that is not yet approved, or a category
 * behind the KYC gate, lands in `PENDING_REVIEW` instead, and the response says so.
 */
export const POST = withRoute(async (request: Request) => {
  const { shop } = await requireSellerShop();
  const input = await readJson(request, createProductSchema);

  return created(await createProduct(shop, input), privateCache());
});

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';
