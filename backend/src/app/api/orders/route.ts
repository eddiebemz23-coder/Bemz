import { withRoute, jsonBody, parseQuery, privateCache } from '@/lib/http';
import { requireUser } from '@/lib/auth/guards';
import { listOrders } from '@/lib/services/orders';
import { orderListQuerySchema } from '@/lib/validation/commerce';

/**
 * `GET /api/orders`
 *
 * One endpoint, three audiences, and the row filter is decided by who is asking rather than
 * by what they send:
 *   - a buyer sees orders they placed;
 *   - a seller sees parcels from their own shops, and a `shopId` pointing somewhere else is
 *     rejected rather than silently honoured;
 *   - an admin sees everything and may narrow by shop.
 *
 * `q` searches order number, tracking number or recipient phone — the three things a buyer
 * can read off a WhatsApp screenshot when they call support.
 */
export const GET = withRoute(async (request: Request) => {
  const user = await requireUser();
  const query = parseQuery(request, orderListQuerySchema);

  const result = await listOrders(user, {
    status: query.status,
    shipmentStatus: query.shipmentStatus,
    shopId: query.shopId ?? null,
    q: query.q ?? null,
    from: query.from,
    to: query.to,
    page: query.page,
    perPage: query.perPage,
  });

  return jsonBody(
    {
      ...result,
      totalPages: Math.max(1, Math.ceil(result.total / result.perPage)),
      hasMore: result.page * result.perPage < result.total,
    },
    200,
    privateCache(),
  );
});

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';
