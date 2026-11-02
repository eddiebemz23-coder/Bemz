'use client';

import { useEffect, useRef, useState } from 'react';
import { api } from '@/lib/client/api';
import type { BasketQuote, DistrictRow } from '@/lib/client/types';
import { etaLabel, money } from '@/lib/client/format';

/**
 * "What will delivery cost me here?" without adding to the basket.
 *
 * It calls the same `POST /api/cart/quote` the cart page uses, with one variant and quantity 1,
 * so the number on the listing page is produced by the same zone pricing code as the number at
 * checkout. Districts we do not serve are listed and disabled rather than hidden — a buyer in
 * Kotido deserves to see that we have not reached them yet instead of wondering why the quote
 * never arrives.
 */
export function DeliveryEstimate({
  variantId,
  country,
  shopName,
  shopClosed = false,
}: {
  variantId: string | null;
  country: string;
  shopName: string;
  shopClosed?: boolean;
}) {
  const [districts, setDistricts] = useState<DistrictRow[] | null>(null);
  const [unreachable, setUnreachable] = useState<{ id: number; name: string }[]>([]);
  const [districtId, setDistrictId] = useState<number | null>(null);
  const [quote, setQuote] = useState<BasketQuote | null>(null);
  const [status, setStatus] = useState<'idle' | 'loading' | 'failed'>('idle');
  const requestId = useRef(0);

  useEffect(() => {
    if (country !== 'UG' && country !== 'KE') {
      setDistricts([]);
      return;
    }
    let cancelled = false;
    api
      .get<{ deliverable: DistrictRow[]; unreachable: { id: number; name: string; code: string; country: string }[] }>(
        `/api/geo/districts?country=${country}`,
      )
      .then((list) => {
        if (cancelled) return;
        setDistricts(list.deliverable);
        setUnreachable(list.unreachable);
      })
      .catch(() => {
        if (!cancelled) setDistricts([]);
      });
    return () => {
      cancelled = true;
    };
  }, [country]);

  useEffect(() => {
    if (!variantId || districtId === null) {
      setQuote(null);
      setStatus('idle');
      return;
    }
    const id = (requestId.current += 1);
    setStatus('loading');
    api
      .post<BasketQuote>('/api/cart/quote', { districtId, variantIds: [variantId] })
      .then((result) => {
        if (requestId.current !== id) return;
        setQuote(result);
        setStatus('idle');
      })
      .catch(() => {
        if (requestId.current === id) setStatus('failed');
      });
  }, [variantId, districtId]);

  const basket = quote?.baskets.find((candidate) => candidate.lines.some((line) => line.variantId === variantId));

  return (
    <div className="rounded-card border border-ink-200 bg-white p-3">
      <label className="field-label" htmlFor="estimate-district">
        Delivery estimate
      </label>
      <select
        id="estimate-district"
        className="field-input"
        value={districtId ?? ''}
        onChange={(event) => setDistrictId(event.target.value ? Number(event.target.value) : null)}
        disabled={districts === null}
      >
        <option value="">{districts === null ? 'Loading districts…' : 'Choose the district it is going to'}</option>
        {districts?.map((district) => (
          <option key={district.id} value={district.id}>
            {district.name}
            {district.zone ? ` · ${district.zone.name}` : ''}
          </option>
        ))}
        {unreachable.length > 0 && (
          <optgroup label="Not served yet">
            {unreachable.slice(0, 12).map((district) => (
              <option key={district.id} value="" disabled>
                {district.name}
              </option>
            ))}
          </optgroup>
        )}
      </select>

      {districtId !== null && status === 'loading' && <div className="skeleton mt-2 h-5 w-40" />}

      {districtId !== null && status === 'failed' && (
        <p className="mt-2 text-xs text-clay-700">
          We could not price delivery from {shopName} just now. Try again, or add the item to the basket.
        </p>
      )}

      {shopClosed && districtId !== null && (
        <p className="mt-2 text-xs text-clay-700">
          {shopName} is on holiday. The estimate below is what it will cost once they reopen.
        </p>
      )}

      {quote && basket && status === 'idle' && (
        <dl className="mt-2 space-y-1 text-sm">
          <div className="flex justify-between gap-3">
            <dt className="text-ink-500">Delivery to {quote.districtName}</dt>
            <dd className="tabular font-medium text-ink-900">
              {basket.shippingFeeMinor === 0 ? (
                <span className="text-bemz-700">Free</span>
              ) : (
                money(basket.shippingFeeMinor, basket.currency)
              )}
            </dd>
          </div>
          <div className="flex justify-between gap-3">
            <dt className="text-ink-500">Arrives</dt>
            <dd className="font-medium text-ink-900">{etaLabel(basket.estimatedDaysMin, basket.estimatedDaysMax)}</dd>
          </div>
          <div className="flex justify-between gap-3">
            <dt className="text-ink-500">Total for one</dt>
            <dd className="tabular font-semibold text-ink-900">{money(basket.totalMinor, basket.currency)}</dd>
          </div>
          <p className="pt-1 text-xs text-ink-500">
            {basket.cashOnDeliveryAllowed
              ? 'Cash on delivery is available in this zone.'
              : 'Pay by mobile money or card — cash on delivery is not offered in this zone.'}
          </p>
        </dl>
      )}
    </div>
  );
}
