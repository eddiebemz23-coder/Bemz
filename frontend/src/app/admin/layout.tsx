import type { Metadata } from 'next';
import { adminPage } from '@/lib/admin-page';
import { AdminNav } from '@/components/admin/admin-nav';

/**
 * `GET /admin/**`
 *
 * The guard runs here so no admin screen can be rendered by forgetting a check inside the page,
 * and every page calls `adminPage` again for the actor it is acting as. Nothing under this tree is
 * indexable and nothing under it is cached: an order number or an ID number must never reach a
 * search engine from an internal tool.
 */
export const dynamic = 'force-dynamic';

export const metadata: Metadata = { title: 'Bemz platform team', robots: { index: false } };

export default async function AdminLayout({ children }: { children: React.ReactNode }) {
  await adminPage('/admin');

  return (
    <>
      <AdminNav />
      <div className="container-page space-y-5 py-6">{children}</div>
    </>
  );
}
