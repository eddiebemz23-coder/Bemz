import { withRoute, readJson, created, privateCache } from '@/lib/http';
import { requireUser } from '@/lib/auth/guards';
import { signUploadFor } from '@/lib/services/shops';
import { uploadSignSchema } from '@/lib/validation/catalog';

/**
 * `POST /api/uploads/sign`
 *
 * Direct-to-Cloudinary from the browser: a seller on a Khartoum-to-Kampala 3G link cannot push
 * twelve 4 MB phone photos through a Next.js server route, and forwarding them would also mean
 * the platform pays for the bandwidth twice.
 *
 * The signature is scoped to one folder derived from the caller — a buyer writes under their own
 * user id, a shop or KYC upload must name a shop the caller owns. A leaked signature therefore
 * cannot write into another seller's gallery, and it expires with the timestamp.
 *
 * KYC files come back flagged `type: private` / `access_mode: authenticated`, because a national
 * ID photo is not a product image.
 */
export const POST = withRoute(async (request: Request) => {
  const user = await requireUser();
  const { target, shopId } = await readJson(request, uploadSignSchema);

  return created(await signUploadFor({ target, userId: user.id, shopId }), privateCache());
});

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';
