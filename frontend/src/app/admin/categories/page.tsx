import type { Metadata } from 'next';
import Link from 'next/link';
import { adminPage } from '@/lib/admin-page';
import { categoryTree } from '@/lib/services/categories';
import { parseParams, hrefWith } from '@/lib/catalog-params';
import { categoryTreeQuerySchema } from '@/lib/validation/catalog';
import { fromBps } from '@/lib/client/format';
import { Badge } from '@/components/ui/badge';
import { EmptyState } from '@/components/ui/empty-state';
import { CategoryEditor } from '@/components/admin/category-editor';

/**
 * `GET /admin/categories`
 *
 * The commercial spine of the marketplace: what percentage the platform keeps in each department, and
 * which departments need a verified identity before a seller can list in them. Both are per-category
 * because a phone and a sack of beans cannot carry the same risk or the same margin.
 *
 * One level at a time, walked by URL — a subtree is priced from its parent down, and a page that
 * rendered all four levels at once would be a wall of forty editors.
 */
export const dynamic = 'force-dynamic';

export const metadata: Metadata = { title: 'Categories & commission', robots: { index: false } };

export default async function AdminCategoriesPage({
  searchParams,
}: {
  searchParams: Record<string, string | string[] | undefined>;
}) {
  await adminPage('/admin/categories');

  const query = parseParams(categoryTreeQuerySchema, {
    parentId: searchParams.parent,
    includeInactive: searchParams.includeInactive,
  });

  const rows = await categoryTree(query);

  const showInactive = query.includeInactive === 'true';
  const parentPath = rows[0] ? rows[0].path.split('/').slice(0, -1).join('/') : '';

  const listHref = (page: Record<string, string | undefined>) =>
    hrefWith('/admin/categories', { parent: query.parentId, includeInactive: showInactive ? 'true' : undefined }, page);

  const childrenOf = (slug: string) => listHref({ parent: slug, includeInactive: showInactive ? 'true' : undefined });

  return (
    <div className="space-y-5">
      <section className="card p-5">
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div>
            <h1 className="text-xl font-semibold text-ink-900">Categories &amp; commission</h1>
            <p className="mt-1 max-w-prose text-sm text-ink-600">
              The rate here is what Bemz holds at checkout, taken from the item total before delivery. A
              shop can carry its own negotiated rate, and that one wins — this screen sets the default for
              everyone else in the department.
            </p>
          </div>
          <Link
            href={showInactive ? listHref({ includeInactive: undefined, parent: query.parentId }) : listHref({ includeInactive: 'true', parent: query.parentId })}
            className="text-sm font-medium text-bemz-700 underline-offset-2 hover:underline"
          >
            {showInactive ? 'Hide hidden departments' : 'Show hidden departments'}
          </Link>
        </div>

        {query.parentId ? (
          <nav aria-label="Breadcrumb" className="mt-4 flex flex-wrap items-center gap-2 text-xs text-ink-500">
            <Link href="/admin/categories" className="font-medium text-bemz-700 underline-offset-2 hover:underline">
              All departments
            </Link>
            {parentPath
              ? parentPath.split('/').map((segment, index, all) => (
                  <span key={`${segment}-${index}`} className="flex items-center gap-2">
                    <span aria-hidden>/</span>
                    <Link
                      href={listHref({ parent: all.slice(index, index + 1)[0], includeInactive: showInactive ? 'true' : undefined })}
                      className="underline-offset-2 hover:underline"
                    >
                      {segment}
                    </Link>
                  </span>
                ))
              : null}
          </nav>
        ) : (
          <p className="mt-3 text-xs text-ink-500">
            {rows.length} top-level department{rows.length === 1 ? '' : 's'}. Rates here are the fallback; a category below can carry
            its own.
          </p>
        )}

        <p className="mt-4 max-w-prose text-xs leading-relaxed text-ink-500">
          Departments are added in the database, not here — a new one needs a place in the taxonomy and a
          path, which is a decision about the whole tree rather than a form. What this screen can do is
          reprice one, gate it behind ID checks, reorder the navigation, and hide it without deleting the
          work of every seller listed inside it.
        </p>
      </section>

      <section className="card overflow-hidden">
        <div className="flex flex-wrap items-baseline justify-between gap-2 border-b border-ink-100 px-5 py-3">
          <h2 className="text-sm font-semibold uppercase tracking-wide text-ink-500">
            {query.parentId ? 'Departments one level down' : 'Departments'}
          </h2>
          <p className="text-xs text-ink-500">
            {rows.length} row{rows.length === 1 ? '' : 's'} · commission and the ID gate both take effect on the next sale
          </p>
        </div>

        {rows.length === 0 ? (
          <EmptyState
            title={query.parentId ? 'Nothing below this' : 'No categories yet'}
            description={
              query.parentId
                ? 'This department has no children, so it is a leaf: listings sit directly in it. Remove the parent filter in the breadcrumb to move around the rest of the tree.'
                : 'The taxonomy table is empty. Seed the database before opening a storefront — buyers need somewhere to browse.'
            }
          />
        ) : (
          <div className="divide-y divide-ink-100">
            {rows.map((row) => (
              <div key={row.id}>
                <div className="flex flex-wrap items-center gap-2 px-5 pt-4">
                  <Link href={`/category/${row.slug}`} className="text-sm font-semibold text-bemz-700 underline-offset-2 hover:underline">
                    {row.name}
                  </Link>
                  <Badge tone={row.isActive ? 'success' : 'danger'}>{row.isActive ? 'visible' : 'hidden'}</Badge>
                  {row.requiresKyc && <Badge tone="warning">ID required to list</Badge>}
                  <span className="tabular text-xs text-ink-500">{fromBps(row.commissionRateBps)} of each sale</span>
                  <span className="tabular text-xs text-ink-400">/{row.path}</span>
                  {row.hasChildren && (
                    <Link
                      href={childrenOf(row.slug)}
                      className="ml-auto text-xs font-medium text-bemz-700 underline-offset-2 hover:underline"
                    >
                      open sub-departments
                    </Link>
                  )}
                </div>
                <CategoryEditor
                  category={{
                    id: row.id,
                    name: row.name,
                    slug: row.slug,
                    requiresKyc: row.requiresKyc,
                    isActive: row.isActive,
                    commissionRateBps: row.commissionRateBps,
                    sortOrder: row.sortOrder,
                    productCount: row.productCount,
                    hasChildren: row.hasChildren,
                  }}
                />
              </div>
            ))}
          </div>
        )}
      </section>
    </div>
  );
}
