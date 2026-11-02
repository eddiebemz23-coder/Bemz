import { withRoute, jsonBody, readJson, created, privateCache, badRequest, tooManyRequests } from '@/lib/http';
import { requireUser } from '@/lib/auth/guards';
import { readCart } from '@/lib/services/cart';
import { checkout } from '@/lib/services/checkout';
import { listAddresses, loadUsableAddress } from '@/lib/services/accounts';
import { listPaymentProviders } from '@/lib/payments';
import { checkoutSchema } from '@/lib/validation/commerce';
import { checkoutLimiter } from '@/lib/rate-limit';

/**
 * `GET /api/checkout`
 *
 * One call hydrates the whole checkout sheet — basket, address book with each stop's delivery
 * zone and the payment rails live for that currency — because a buyer on prepaid data should
 * not wait through four round trips to see what they are about to pay.
 */
export const GET = withRoute(async () => {
  const user = await requireUser();
  const [view, addresses] = await Promise.all([readCart({ userId: user.id }), listAddresses(user.id)]);
  const currency = view.currency ?? user.preferredCurrency;

  return jsonBody(
    {
      cart: view,
      addresses,
      providers: listPaymentProviders(currency),
      canCheckOut: view.selectedCount > 0 && view.blockedLines === 0 && addresses.length > 0,
      blockers: [
        view.selectedCount === 0 ? 'Select the items you want in this order' : null,
        view.blockedLines > 0 ? 'Remove or reduce items that are sold out or above the per-order limit' : null,
        addresses.length === 0 ? 'Add a delivery address' : null,
      ].filter(Boolean),
    },
    200,
    privateCache(),
  );
});

/**
 * `POST /api/checkout`
 *
 * Turns the selected basket lines into one order per shop: mobile money and card are charged
 * once for the whole group, cash on delivery collects per parcel.
 *
 * Three deliberate constraints:
 *
 * 1. Guests are refused. An order needs a buyer who can be called when the rider cannot find
 *    the landmark, and a payout later needs that identity.
 * 2. The cart id is never taken from the body — it is the caller's own active basket, looked
 *    up from the session, so nobody can check out someone else's draft.
 * 3. `idempotencyKey` is required. On a network that drops the response after the payment
 *    prompt was sent, the retry replays the original orders instead of reserving stock twice
 *    and sending a second MoMo request.
 */
export const POST = withRoute(async (request: Request) => {
  const user = await requireUser();

  const limit = checkoutLimiter(user.id);
  if (!limit.allowed) {
    throw tooManyRequests('Too many checkout attempts — pause a moment and try again', limit.retryAfterSeconds);
  }

  const body = await readJson(request, checkoutSchema);

  const [view, address] = await Promise.all([
    readCart({ userId: user.id }),
    loadUsableAddress(user.id, body.addressId),
  ]);
  if (!view.cartId) throw badRequest('Your basket is empty — add an item first');
  if (view.selectedCount === 0) throw badRequest('Tick at least one item to order');

  const result = await checkout({
    userId: user.id,
    cartId: view.cartId,
    address,
    // A buyer collecting at a town hub overrides the district on their saved address;
    // otherwise the address decides, and the zone fee follows it.
    deliveryDistrictId: body.deliveryDistrictId ?? address.districtId,
    fulfilmentType: body.fulfilmentType,
    paymentProvider: body.paymentProvider,
    payerPhone: body.payerPhone ?? null,
    couponCode: body.couponCode ?? view.couponCode ?? null,
    buyerNote: body.buyerNote ?? null,
    idempotencyKey: body.idempotencyKey,
  });

  return created(result, privateCache());
});

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';
