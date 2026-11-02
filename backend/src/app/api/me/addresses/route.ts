import { withRoute, jsonBody, created, readJson, privateCache } from '@/lib/http';
import { requireUser } from '@/lib/auth/guards';
import { createAddress, listAddresses } from '@/lib/services/accounts';
import { shippingAddressSchema } from '@/lib/validation/auth';

/**
 * `GET /api/me/addresses`
 *
 * The address book is what makes checkout short in this market: a buyer in Kampala
 * usually delivers to one of three places (home, office, the stall) and the landmark
 * field is what the rider actually calls.
 */
export const GET = withRoute(async () => {
  const user = await requireUser();
  return jsonBody(await listAddresses(user.id), 200, privateCache());
});

/**
 * `POST /api/me/addresses`
 *
 * The first address saved is made the default even if the client does not say so, and the
 * district drives the delivery zone, so an address always carries its fee band with it.
 */
export const POST = withRoute(async (request: Request) => {
  const user = await requireUser();
  const input = await readJson(request, shippingAddressSchema);
  const address = await createAddress(user.id, input);
  return created(address);
});

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';
