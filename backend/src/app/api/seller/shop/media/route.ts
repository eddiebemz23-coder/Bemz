import { withRoute, readJson, jsonBody, privateCache } from '@/lib/http';
import { requireSellerShop } from '@/lib/auth/guards';
import { setShopMedia } from '@/lib/services/shops';
import { shopMediaSchema } from '@/lib/validation/catalog';

/**
 * `POST /api/seller/shop/media`
 *
 * The file is uploaded straight to Cloudinary first (see `/api/uploads/sign`); this only
 * commits the URL. Swapping a logo destroys the previous asset, so a seller who rebrands five
 * times does not leave five orphaned images billed to the platform forever.
 */
export const POST = withRoute(async (request: Request) => {
  const { shop } = await requireSellerShop();
  const params = await readJson(request, shopMediaSchema);

  return jsonBody(await setShopMedia(shop, params), 200, privateCache());
});

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';
