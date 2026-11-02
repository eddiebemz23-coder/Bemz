import Link from 'next/link';
import { Home, Package, Search, Store } from 'lucide-react';
import { LinkButton } from '@/components/ui/link-button';

/**
 * 404 for the whole app.
 *
 * The three URLs people actually land here with are a listing that sold out and was deleted, a
 * shop that closed, and a mistyped district on a shared link — so the page names those cases
 * instead of shrugging, and points at the two places where the item is probably still findable.
 */
export default function NotFound() {
  return (
    <div className="container-page max-w-xl py-16">
      <div className="card space-y-4 p-6 text-center">
        <p className="text-5xl font-bold text-bemz-600">404</p>
        <h1 className="text-xl font-bold text-ink-950">That page is not here</h1>
        <p className="text-sm leading-relaxed text-ink-600">
          The listing may have sold out and been taken down, the shop may have closed, or a link may have lost a letter
          on the way. Nothing you ordered is affected.
        </p>

        <div className="flex flex-wrap justify-center gap-2">
          <LinkButton href="/search">
            <Search className="size-4" aria-hidden />
            Search the market
          </LinkButton>
          <LinkButton href="/shops" variant="outline">
            <Store className="size-4" aria-hidden />
            Browse shops
          </LinkButton>
          <Link href="/orders" className="inline-flex items-center gap-1 rounded-lg px-3 py-2 text-sm font-medium text-ink-700 hover:bg-ink-100">
            <Package className="size-4" aria-hidden />
            My orders
          </Link>
          <Link href="/" className="inline-flex items-center gap-1 rounded-lg px-3 py-2 text-sm font-medium text-ink-700 hover:bg-ink-100">
            <Home className="size-4" aria-hidden />
            Home
          </Link>
        </div>
      </div>
    </div>
  );
}
