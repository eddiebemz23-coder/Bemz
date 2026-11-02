import { withRoute, jsonBody, readJson, badRequest, forbidden } from '@/lib/http';
import { basketHeaders, basketHolderFromRequest } from '@/lib/auth/guards';
import { readCart, selectedLines } from '@/lib/services/cart';
import { quoteBasket, type LineInput } from '@/lib/services/pricing';
import { loadUsableAddress } from '@/lib/services/accounts';
import { shippingQuoteSchema } from '@/lib/validation/commerce';
import { env } from '@/lib/env';

/**
 * `POST /api/cart/quote`
 *
 * Delivery is quoted per shop, because each seller hands their parcel to their own rider and
 * the free-shipping threshold is a shop's promise, not the platform's. This is the same
 * `quoteBasket` the checkout runs, so the total a buyer sees here is the total they are
 * charged — no surprises at the payment prompt.
 *
 * Commission is stripped from the response: what the platform earns from the seller is not
 * information a buyer, or a competitor scraping the storefront, should have.
 */
export const POST = withRoute(async (request: Request) => {
  const holder = await basketHolderFromRequest(request);
  const body = await readJson(request, shippingQuoteSchema);

  let districtId = body.districtId;
  let lines: LineInput[];
  let couponCode: string | null = null;

  if (body.variantIds?.length) {
    // A product page previewing "deliver to Kampala" without touching anyone's basket.
    lines = body.variantIds.map((variantId) => ({ variantId, quantity: 1 }));
  } else {
    const view = await readCart(holder);
    lines = selectedLines(view);
    couponCode = view.couponCode;
    if (lines.length === 0) throw badRequest('Select an item to see what delivery will cost');

    if (body.addressId) {
      if (!holder.userId) throw forbidden('Sign in to quote delivery to a saved address');
      // Trust the address book over the number in the body: it is the district checkout will
      // actually use, so a stale client-side copy cannot show a cheaper quote than the charge.
      districtId = (await loadUsableAddress(holder.userId, body.addressId)).districtId;
    }
  }

  const quote = await quoteBasket({
    lines,
    districtId,
    couponCode,
    userId: holder.userId,
    allowCashOnDelivery: env().COD_ENABLED,
  });

  return jsonBody(
    {
      currency: quote.currency,
      districtId: quote.districtId,
      districtName: quote.districtName,
      zone: { id: quote.zone.id, code: quote.zone.code, name: quote.zone.name },
      subtotalMinor: quote.subtotalMinor,
      discountMinor: quote.discountMinor,
      shippingFeeMinor: quote.shippingFeeMinor,
      vatIncludedMinor: quote.vatIncludedMinor,
      totalMinor: quote.totalMinor,
      freeShippingSavedMinor: quote.freeShippingSavedMinor,
      couponCode: quote.couponCode,
      couponMessage: quote.couponMessage,
      cashOnDeliveryAvailable: quote.baskets.every((basket) => basket.cashOnDeliveryAllowed),
      baskets: quote.baskets.map((basket) => ({
        shopId: basket.shopId,
        shopName: basket.shopName,
        currency: basket.currency,
        subtotalMinor: basket.subtotalMinor,
        discountMinor: basket.discountMinor,
        shippingFeeMinor: basket.shippingFeeMinor,
        vatIncludedMinor: basket.vatIncludedMinor,
        totalMinor: basket.totalMinor,
        estimatedDaysMin: basket.estimatedDaysMin,
        estimatedDaysMax: basket.estimatedDaysMax,
        zoneName: basket.zoneName,
        cashOnDeliveryAllowed: basket.cashOnDeliveryAllowed,
        lines: basket.lines.map((line) => ({
          variantId: line.variantId,
          productId: line.productId,
          productTitle: line.productTitle,
          variantName: line.variantName,
          sku: line.sku,
          imageUrl: line.imageUrl,
          unitPriceMinor: line.unitPriceMinor,
          currency: line.currency,
          quantity: line.quantity,
          lineTotalMinor: line.lineTotalMinor,
          availableStock: line.availableStock,
        })),
      })),
    },
    200,
    basketHeaders(holder),
  );
});

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';
