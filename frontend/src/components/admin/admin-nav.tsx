'use client';

import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { ClipboardList, LayoutGrid, Map, ScrollText, Tags, Wallet } from 'lucide-react';
import { cn } from '@/lib/cn';

const ITEMS = [
  { href: '/admin', label: 'Numbers', icon: LayoutGrid },
  { href: '/admin/queues', label: 'Queues', icon: ClipboardList },
  { href: '/admin/payouts', label: 'Payouts', icon: Wallet },
  { href: '/admin/zones', label: 'Delivery', icon: Map },
  { href: '/admin/categories', label: 'Commission', icon: Tags },
  { href: '/admin/audit', label: 'Audit', icon: ScrollText },
] as const;

/**
 * Six screens, because the platform team is three people, not a department. The longest-prefix
 * match keeps `/admin/queues` from highlighting Overview the way a naive `startsWith('/admin')`
 * would light up every page.
 */
export function AdminNav() {
  const pathname = usePathname();

  const isActive = (href: string) => (href === '/admin' ? pathname === '/admin' : pathname === href || pathname.startsWith(`${href}/`));

  return (
    <nav aria-label="Platform team" className="border-b border-ink-200 bg-white">
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
              <Icon className="size-4" aria-hidden />
              {item.label}
            </Link>
          );
        })}
        <Link
          href="/"
          className="ml-auto flex shrink-0 items-center gap-1.5 rounded-lg px-3 py-2 text-sm font-medium text-ink-600 hover:bg-ink-50 hover:text-ink-900"
        >
          View the marketplace
          <span aria-hidden>↗</span>
        </Link>
      </div>
    </nav>
  );
}
