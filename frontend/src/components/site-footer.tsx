import Link from 'next/link';

const COLUMNS: { title: string; links: { href: string; label: string }[] }[] = [
  {
    title: 'Shop',
    links: [
      { href: '/search', label: 'All products' },
      { href: '/shops', label: 'Browse shops' },
      { href: '/cart', label: 'Your basket' },
      { href: '/orders', label: 'Track an order' },
    ],
  },
  {
    title: 'Sell',
    links: [
      { href: '/register?role=seller', label: 'Open a shop' },
      { href: '/seller', label: 'Seller dashboard' },
      { href: '/seller/payouts', label: 'Withdraw your money' },
    ],
  },
];

export function SiteFooter() {
  return (
    <footer className="mt-12 border-t border-ink-200 bg-white">
      <div className="container-page grid gap-8 py-10 sm:grid-cols-2 lg:grid-cols-4">
        <div>
          <p className="text-lg font-bold text-ink-900">
            Bemz<span className="text-clay-500">Africa</span>
          </p>
          <p className="mt-2 max-w-xs text-sm text-ink-500">
            A marketplace built for Uganda and Kenya: prices in shillings, delivery to your district, payment by
            mobile money.
          </p>
        </div>

        {COLUMNS.map((column) => (
          <div key={column.title}>
            <h3 className="text-sm font-semibold text-ink-900">{column.title}</h3>
            <ul className="mt-3 space-y-2">
              {column.links.map((link) => (
                <li key={`${column.title}-${link.label}`}>
                  <Link href={link.href} className="text-sm text-ink-600 hover:text-bemz-700">
                    {link.label}
                  </Link>
                </li>
              ))}
            </ul>
          </div>
        ))}

        <div>
          <h3 className="text-sm font-semibold text-ink-900">Pay your way</h3>
          <ul className="mt-3 space-y-1.5 text-sm text-ink-600">
            <li>MTN Mobile Money — Uganda</li>
            <li>Airtel Money — Uganda &amp; Kenya</li>
            <li>Debit / credit card</li>
            <li>Cash on delivery where your zone allows it</li>
          </ul>
        </div>
      </div>

      <div className="border-t border-ink-100 py-4">
        <p className="container-page text-xs text-ink-400">
          Prices shown include VAT where it applies. © {new Date().getFullYear()} Bemz Africa Marketplace.
        </p>
      </div>
    </footer>
  );
}
