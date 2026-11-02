'use client';

import type { ReactNode } from 'react';
import { SessionProvider } from 'next-auth/react';
import { CartProvider } from '@/lib/client/cart-store';
import { ToastProvider } from '@/components/toast';

export function Providers({ children }: { children: ReactNode }) {
  return (
    <SessionProvider>
      <ToastProvider>
        <CartProvider>{children}</CartProvider>
      </ToastProvider>
    </SessionProvider>
  );
}
