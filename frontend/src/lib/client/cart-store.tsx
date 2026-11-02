'use client';

import { createContext, useCallback, useContext, useEffect, useMemo, useState, type ReactNode } from 'react';
import { api, ApiFailure } from '@/lib/client/api';
import type { BasketQuote, CartView } from '@/lib/client/types';

/**
 * One basket per browser tab, mirroring the server cart exactly.
 *
 * Every mutation returns the recomputed `CartView` rather than a diff, so the header badge and
 * the cart page can never drift from what checkout will charge.
 */
interface CartApi {
  cart: CartView | null;
  ready: boolean;
  busy: boolean;
  count: number;
  quote: BasketQuote | null;
  quoting: boolean;
  refresh: () => Promise<CartView | null>;
  add: (variantId: string, quantity?: number) => Promise<{ ok: boolean; message: string }>;
  /** Every mutation resolves with the recomputed basket the server just returned. */
  setQuantity: (itemId: string, quantity: number, selected?: boolean) => Promise<CartView>;
  setSelected: (itemId: string, selected: boolean) => Promise<CartView>;
  selectAll: (selected: boolean) => Promise<CartView>;
  remove: (itemId: string) => Promise<CartView>;
  clear: () => Promise<CartView>;
  applyCoupon: (code: string) => Promise<{ ok: boolean; message: string }>;
  removeCoupon: () => Promise<CartView>;
  mergeAfterSignIn: () => Promise<void>;
  quoteFor: (districtId: number, addressId?: string) => Promise<BasketQuote | null>;
}

const CartContext = createContext<CartApi | null>(null);

export function useCart(): CartApi {
  const context = useContext(CartContext);
  if (!context) throw new Error('useCart must be used inside <CartProvider>');
  return context;
}

export function CartProvider({ children }: { children: ReactNode }) {
  const [cart, setCart] = useState<CartView | null>(null);
  const [ready, setReady] = useState(false);
  const [busy, setBusy] = useState(false);
  const [quote, setQuote] = useState<BasketQuote | null>(null);
  const [quoting, setQuoting] = useState(false);

  const load = useCallback(async () => {
    try {
      const view = await api.get<CartView>('/api/cart');
      setCart(view);
      return view;
    } catch (error) {
      // A guest with no basket yet and no cookie is a normal first visit, not an error.
      if (error instanceof ApiFailure && (error.status === 400 || error.status === 401)) return null;
      return null;
    } finally {
      setReady(true);
    }
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  const run = useCallback(
    async (mutation: () => Promise<CartView>) => {
      setBusy(true);
      try {
        const view = await mutation();
        setCart(view);
        return view;
      } finally {
        setBusy(false);
      }
    },
    [],
  );

  const value = useMemo<CartApi>(
    () => ({
      cart,
      ready,
      busy,
      count: cart?.itemCount ?? 0,
      quote,
      quoting,
      refresh: load,

      add: async (variantId, quantity = 1) => {
        try {
          await run(() => api.post<CartView>('/api/cart', { variantId, quantity }));
          return { ok: true, message: 'Added to basket' };
        } catch (error) {
          return { ok: false, message: error instanceof ApiFailure ? error.message : 'Could not add that item' };
        }
      },

      setQuantity: (itemId, quantity, selected) =>
        run(() => api.patch<CartView>(`/api/cart/${itemId}`, { quantity, selected })),

      setSelected: (itemId, selected) => run(() => api.patch<CartView>(`/api/cart/${itemId}`, { selected })),

      selectAll: (selected) => run(() => api.patch<CartView>('/api/cart', { selected })),

      remove: (itemId) => run(() => api.del<CartView>(`/api/cart/${itemId}`)),

      clear: () => run(() => api.del<CartView>('/api/cart')),

      applyCoupon: async (code) => {
        try {
          await run(() => api.post<CartView>('/api/cart/coupon', { code }));
          return { ok: true, message: 'Coupon applied' };
        } catch (error) {
          return { ok: false, message: error instanceof ApiFailure ? error.message : 'Coupon did not apply' };
        }
      },

      removeCoupon: () => run(() => api.del<CartView>('/api/cart/coupon')),

      /** The guest token is read from the HttpOnly cookie by the server, never from here. */
      mergeAfterSignIn: async () => {
        try {
          const merged = await api.post<CartView>('/api/cart/merge', {});
          setCart(merged);
        } catch {
          // A signed-in visitor with nothing to merge is the common case.
        }
      },

      quoteFor: async (districtId, addressId) => {
        setQuoting(true);
        try {
          const next = await api.post<BasketQuote>('/api/cart/quote', { districtId, addressId });
          setQuote(next);
          return next;
        } catch {
          setQuote(null);
          return null;
        } finally {
          setQuoting(false);
        }
      },
    }),
    [cart, ready, busy, quote, quoting, load, run],
  );

  return <CartContext.Provider value={value}>{children}</CartContext.Provider>;
}
