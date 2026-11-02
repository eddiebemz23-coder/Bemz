import { z } from 'zod';
import { withRoute, jsonBody, readJson, privateCache, notFound, RouteContext } from '@/lib/http';
import { requireUser } from '@/lib/auth/guards';
import { deleteAddress, listAddresses, loadOwnedAddress, updateAddress } from '@/lib/services/accounts';
import { updateAddressSchema } from '@/lib/validation/auth';
import { prisma } from '@/lib/prisma';

/** `/api/me/addresses/[id]` — the address editor and the checkout "edit this stop" sheet. */
const paramsSchema = z.object({ id: z.string().min(1).max(64) });

export const GET = withRoute<{ id: string }>(async (request: Request, context: RouteContext<{ id: string }>) => {
  const user = await requireUser();
  const { id } = paramsSchema.parse(context.params);
  await loadOwnedAddress(user.id, id);

  // One query shape for the whole book, then pick the row: cheaper than a second mapper.
  const addresses = await listAddresses(user.id);
  const address = addresses.find((row) => row.id === id);
  if (!address) throw notFound('That address is no longer in your book');

  return jsonBody(address, 200, privateCache());
});

/**
 * `PATCH /api/me/addresses/[id]`
 *
 * Partial on purpose: the checkout sheet changes the landmark and the note, while the full
 * editor can move the district — which re-prices delivery for every future order.
 */
export const PATCH = withRoute<{ id: string }>(async (request: Request, context: RouteContext<{ id: string }>) => {
  const user = await requireUser();
  const { id } = paramsSchema.parse(context.params);
  const patch = await readJson(request, updateAddressSchema);
  return jsonBody(await updateAddress(user.id, id, patch), 200, privateCache());
});

/**
 * `DELETE /api/me/addresses/[id]`
 *
 * Orders carry their own JSON copy of the address, so removing a book entry never rewrites
 * delivery history. If the deleted row was the default, the newest live one takes over.
 */
export const DELETE = withRoute<{ id: string }>(async (_request: Request, context: RouteContext<{ id: string }>) => {
  const user = await requireUser();
  const { id } = paramsSchema.parse(context.params);
  const result = await deleteAddress(user.id, id);
  const remaining = await prisma.shippingAddress.count({ where: { userId: user.id, archivedAt: null } });
  return jsonBody({ ...result, remaining });
});

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';
