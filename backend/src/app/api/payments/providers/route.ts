import { z } from 'zod';
import { withRoute, jsonBody, parseQuery, publicCatalogCache, privateCache } from '@/lib/http';
import { listPaymentProviders } from '@/lib/payments';
import { currency, phone } from '@/lib/validation/common';
import { tryNormalisePhone, guessMobileMoneyProvider } from '@/lib/phone';
import { env } from '@/lib/env';

const querySchema = z.object({
  currency: currency.default('UGX'),
  /** The number about to be prompted, so the page can preselect the buyer's own network. */
  payerPhone: phone.optional(),
});

/**
 * `GET /api/payments/providers`
 *
 * Which rails are live for a market. MTN only collects UGX and the Airtel product differs by
 * country, so this is keyed on currency rather than on a global "is Stripe on" flag.
 *
 * `suggestedProvider` is the piece that matters on a feature phone: a buyer typing an 077
 * number is on MTN and should not be shown Airtel first, because choosing the wrong rail means
 * a PIN prompt that never arrives on that handset.
 */
export const GET = withRoute(async (request: Request) => {
  const query = parseQuery(request, querySchema);

  let suggested: 'MTN_MOMO' | 'AIRTEL_MONEY' | null = null;
  if (query.payerPhone) {
    const parsed = tryNormalisePhone(query.payerPhone, query.currency === 'KES' ? 'KE' : 'UG');
    if (parsed.ok) suggested = guessMobileMoneyProvider(parsed.phone) ?? null;
  }

  const providers = listPaymentProviders(query.currency).map((provider) => ({
    ...provider,
    suggested: provider.provider === suggested && provider.available,
  }));

  const personalised = Boolean(query.payerPhone);

  return jsonBody(
    {
      currency: query.currency,
      providers,
      cashOnDeliveryEnabledGlobally: env().COD_ENABLED,
      // A payment that needs the PIN prompt cannot be completed on a screen that times out.
      guidance:
        query.currency === 'UGX'
          ? 'Pay with MTN Mobile Money or Airtel Money, then enter your PIN on the phone that received the prompt.'
          : 'Pay with Airtel Money Kenya or a card — the prompt goes to the number you entered.',
    },
    200,
    personalised ? privateCache() : publicCatalogCache(60),
  );
});

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';
