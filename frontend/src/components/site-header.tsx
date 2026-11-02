'use client';

import Link from 'next/link';
import { useRouter, usePathname } from 'next/navigation';
import { useEffect, useState } from 'react';
import { signOut, useSession } from 'next-auth/react';
import { LayoutGrid, LogOut, Menu, Search, ShoppingCart, Store, User, Package, MapPin } from 'lucide-react';
import { cn } from '@/lib/cn';
import { useCart } from '@/lib/client/cart-store';

const NAV_LINKS = [
  { href: '/search?sort=popular', label: 'Trending' },
  { href: '/search?inStockOnly=true&sort=newest', label: 'New listings' },
  { href: '/shops', label: 'Shops' },
  { href: '/search?sort=rating', label: 'Top rated' },
];

export function SiteHeader() {
  const { data: session, status } = useSession();
  const { count } = useCart();
  const router = useRouter();
  const pathname = usePathname();
  const [term, setTerm] = useState('');

  // The header outlives client-side navigation, so the box is re-synced from the URL each time
  // the path changes. Reading it during render would break on the server, where there is none.
  useEffect(() => {
    setTerm(new URLSearchParams(window.location.search).get('q') ?? '');
  }, [pathname]);

  const role = session?.user?.role;

  return (
    <header className="sticky top-0 z-40 border-b border-ink-200 bg-white/95 backdrop-blur supports-[backdrop-filter]:bg-white/80">
      <div className="container-page flex h-16 items-center gap-3">
        <Link href="/" className="flex shrink-0 items-center gap-2" aria-label="Bemz Africa home">
          <span className="grid size-9 place-items-center rounded-lg bg-bemz-600 text-lg font-black text-white">B</span>
          <span className="hidden text-lg font-bold leading-none tracking-tight text-ink-900 sm:block">
            Bemz<span className="text-clay-500">Africa</span>
          </span>
        </Link>

        <form
          className="flex min-w-0 flex-1 items-center"
          action="/search"
          onSubmit={(event) => {
            event.preventDefault();
            router.push(term.trim() ? `/search?q=${encodeURIComponent(term.trim())}` : '/search');
          }}
          role="search"
        >
          <input
            name="q"
            value={term}
            onChange={(event) => setTerm(event.target.value)}
            placeholder="Search phones, sukali, shoes…"
            aria-label="Search products"
            className="h-11 w-full rounded-l-lg border border-ink-200 bg-ink-50 px-3 text-sm outline-none focus:border-bemz-500 focus:bg-white"
          />
          <button type="submit" className="grid h-11 w-12 place-items-center rounded-r-lg bg-bemz-600 text-white hover:bg-bemz-700" aria-label="Search">
            <Search className="size-5" />
          </button>
        </form>

        <nav className="flex items-center gap-1">
          {role === 'SELLER' || role === 'ADMIN' ? (
            <Link
              href="/seller"
              className="hidden items-center gap-1.5 rounded-lg px-3 py-2 text-sm font-medium text-ink-700 hover:bg-ink-100 lg:inline-flex"
            >
              <Store className="size-4" /> Seller tools
            </Link>
          ) : (
            <Link
              href="/register?role=seller"
              className="hidden items-center gap-1.5 rounded-lg px-3 py-2 text-sm font-medium text-ink-700 hover:bg-ink-100 lg:inline-flex"
            >
              <Store className="size-4" /> Sell on Bemz
            </Link>
          )}

          {role === 'ADMIN' && (
            <Link href="/admin" className="hidden rounded-lg px-3 py-2 text-sm font-medium text-ink-700 hover:bg-ink-100 lg:block">
              Admin
            </Link>
          )}

          <details className="relative hidden sm:block">
            <summary className="grid size-11 cursor-pointer list-none place-items-center rounded-lg text-ink-700 hover:bg-ink-100 [&::-webkit-details-marker]:hidden">
              <User className="size-5" />
              <span className="sr-only">Account</span>
            </summary>
            <div className="absolute right-0 top-12 w-60 rounded-xl border border-ink-200 bg-white p-2 shadow-raised">
              {status === 'authenticated' ? (
                <>
                  <div className="px-2 py-1.5">
                    <p className="truncate text-sm font-semibold text-ink-900">{session?.user?.name ?? session?.user?.phone ?? 'Your account'}</p>
                    <p className="truncate text-xs text-ink-500">{session?.user?.phone ?? session?.user?.email}</p>
                  </div>
                  <div className="my-1 h-px bg-ink-100" />
                  <MenuLink href="/orders" icon={<Package className="size-4" />}>My orders</MenuLink>
                  <MenuLink href="/account/addresses" icon={<MapPin className="size-4" />}>Delivery addresses</MenuLink>
                  <MenuLink href="/account" icon={<User className="size-4" />}>Account settings</MenuLink>
                  {(role === 'SELLER' || role === 'ADMIN') && (
                    <MenuLink href="/seller" icon={<Store className="size-4" />}>Seller dashboard</MenuLink>
                  )}
                  {role === 'ADMIN' && <MenuLink href="/admin" icon={<LayoutGrid className="size-4" />}>Admin dashboard</MenuLink>}
                  <div className="my-1 h-px bg-ink-100" />
                  <button
                    type="button"
                    onClick={() => signOut({ callbackUrl: '/' })}
                    className="flex w-full items-center gap-2 rounded-lg px-2.5 py-2 text-left text-sm text-clay-700 hover:bg-clay-50"
                  >
                    <LogOut className="size-4" /> Sign out
                  </button>
                </>
              ) : (
                <>
                  <MenuLink href="/login" icon={<User className="size-4" />}>Sign in</MenuLink>
                  <MenuLink href="/register" icon={<Store className="size-4" />}>Create an account</MenuLink>
                  <div className="my-1 h-px bg-ink-100" />
                  <MenuLink href="/orders" icon={<Package className="size-4" />}>Track an order</MenuLink>
                </>
              )}
            </div>
          </details>

          <Link
            href="/cart"
            className="relative grid size-11 place-items-center rounded-lg text-ink-700 hover:bg-ink-100"
            aria-label={`Basket${count > 0 ? `, ${count} items` : ''}`}
          >
            <ShoppingCart className="size-5" />
            {count > 0 && (
              <span className="tabular absolute -right-0.5 -top-0.5 grid min-w-5 place-items-center rounded-full bg-clay-500 px-1 text-[11px] font-bold text-white">
                {count > 99 ? '99+' : count}
              </span>
            )}
          </Link>
        </nav>
      </div>

      <div className="container-page hidden gap-1 overflow-x-auto pb-2 md:flex">
        {NAV_LINKS.map((link) => (
          <Link key={link.href} href={link.href} className="whitespace-nowrap rounded-lg px-2.5 py-1 text-sm text-ink-600 hover:bg-ink-100 hover:text-bemz-700">
            {link.label}
          </Link>
        ))}
      </div>

      <MobileTabBar />
    </header>
  );
}

function MenuLink({ href, icon, children }: { href: string; icon: React.ReactNode; children: React.ReactNode }) {
  return (
    <Link href={href} className="flex items-center gap-2 rounded-lg px-2.5 py-2 text-sm text-ink-800 hover:bg-ink-50" onClick={(event) => {
      // <details> keeps itself open after navigation, which looks broken on the next page.
      const details = (event.currentTarget as HTMLElement).closest('details');
      if (details) details.open = false;
    }}>
      {icon}
      {children}
    </Link>
  );
}

function MobileTabBar() {
  const { count } = useCart();
  const { status } = useSession();

  const tabs = [
    { href: '/', label: 'Home', icon: <Menu className="size-5" /> },
    { href: '/search', label: 'Search', icon: <Search className="size-5" /> },
    { href: '/cart', label: 'Basket', icon: <ShoppingCart className="size-5" />, badge: count },
    { href: status === 'authenticated' ? '/account' : '/login', label: 'Account', icon: <User className="size-5" /> },
  ];

  return (
    <nav className="fixed inset-x-0 bottom-0 z-40 flex border-t border-ink-200 bg-white pb-[env(safe-area-inset-bottom)] md:hidden">
      {tabs.map((tab) => (
        <Link
          key={tab.href}
          href={tab.href}
          className={cn('relative flex flex-1 flex-col items-center gap-0.5 py-2 text-[11px] text-ink-600', 'active:bg-ink-50')}
        >
          {tab.icon}
          {tab.label}
          {'badge' in tab && (tab.badge ?? 0) > 0 && (
            <span className="tabular absolute right-[22%] top-1 grid min-w-4 place-items-center rounded-full bg-clay-500 px-1 text-[10px] font-bold text-white">
              {tab.badge}
            </span>
          )}
        </Link>
      ))}
    </nav>
  );
}
