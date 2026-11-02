import type { Metadata, Viewport } from 'next';
import './globals.css';
import { Providers } from '@/components/providers';
import { SiteHeader } from '@/components/site-header';
import { SiteFooter } from '@/components/site-footer';

/** Read directly: `env()` is server-only and validated lazily, a layout must not throw on it. */
const appUrl = process.env.NEXT_PUBLIC_APP_URL ?? 'http://localhost:3000';

export const metadata: Metadata = {
  metadataBase: new URL(appUrl),
  title: {
    default: 'Bemz Africa | buy and sell in Uganda and Kenya',
    template: '%s · Bemz Africa',
  },
  description:
    'A marketplace for Ugandan and Kenyan traders: pay with MTN Mobile Money, Airtel Money or card, and get delivery to your district.',
  keywords: ['Uganda online shopping', 'Kenya marketplace', 'MTN MoMo', 'Airtel Money', 'Kampala', 'Nairobi'],
  openGraph: {
    type: 'website',
    siteName: 'Bemz Africa',
    locale: 'en_UG',
  },
  robots: { index: true, follow: true },
};

export const viewport: Viewport = {
  themeColor: '#1f8a4c',
  width: 'device-width',
  initialScale: 1,
  maximumScale: 5,
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en">
      <body>
        <Providers>
          {/* Keyboard and screen-reader users get one exit from the header before the grid. */}
          <a href="#main" className="sr-only focus:not-sr-only focus:absolute focus:left-4 focus:top-4 focus:z-50 focus:rounded focus:bg-white focus:px-3 focus:py-2">
            Skip to content
          </a>
          <SiteHeader />
          <main id="main" className="pb-20 sm:pb-0">
            {children}
          </main>
          <SiteFooter />
        </Providers>
      </body>
    </html>
  );
}
