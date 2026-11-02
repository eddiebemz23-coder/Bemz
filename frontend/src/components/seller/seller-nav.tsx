'use client';

import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { Inbox, LayoutGrid, Package, Store, Tags, Wallet } from 'lucide-react';
import { cn } from '@/lib/cn';

const ITEMS = [
  { href: '/seller', label: 'Overview', icon: LayoutGrid },
  { href: '/seller/products', label: 'Listings', icon: Tags },
  { href: '/seller/orders', label: 'Orders', icon: Package },
  { href: '/seller/inbox', label: 'Inbox', icon: Inbox },
  { href: '/seller/shop', label: 'Shop', icon: Store },
  { href: '/seller/payouts', label: 'Payouts', icon: Wallet },
] as const;

/**
 * The whole seller tool is six screens, so the navigation is a single row rather than a drawer
 * a trader has to open on the phone they actually run the shop from.
 *
 * Matching is longest-prefix-first: `/seller/products/new` must highlight Listings, not Overview.
 */
export function SellerNav({ storefrontHref }: { storefrontHref: string }) {
  const pathname = usePathname();

  const isActive = (href: string) =>
    href === '/seller' ? pathname === '/seller' : pathname === href || pathname.startsWith(`${href}/`);

  return (
    <nav aria-label="Seller dashboard" className="border-b border-ink-200 bg-white">
      <div className="container-page flex gap-1.5 overflow-x-auto py-2 [scrollbar-width:none]">
        {ITEMS.map((item) => {
          const Icon = item.icon;
          const active = isActive(item.href);
          return (
            <Link
              key={item.href}
              href={item.href}
              aria-current={active ? 'page' : undefined}
              className={cn(
                'flex shrink-0 items-center gap-1.5 rounded-lg px-3 py-2 text-sm font-medium transition-colors',
                active ? 'bg-bemz-50 text-bemz-800' : 'text-ink-600 hover:bg-ink-50 hover:text-ink-900',
              )}
            >
              <Icon className="size-4" />
              {item.label}
            </Link>
          );
        })}
        <Link
          href={storefrontHref}
          className="ml-auto flex shrink-0 items-center gap-1.5 rounded-lg px-3 py-2 text-sm font-medium text-ink-600 hover:bg-ink-50 hover:text-ink-900"
        >
          View stall
          <span aria-hidden>↗</span>
        </Link>
      </div>
    </nav>
  );
}
