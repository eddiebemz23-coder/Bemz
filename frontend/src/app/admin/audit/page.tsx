import type { Metadata } from 'next';
import Link from 'next/link';
import { adminPage } from '@/lib/admin-page';
import { adminStaff, auditTrail } from '@/lib/services/moderation';
import { parseParams, hrefWith } from '@/lib/catalog-params';
import { auditQuerySchema } from '@/lib/validation/commerce';
import { AUDIT_ENTITIES } from '@/lib/validation/enums';
import { formatDateTime, humanise } from '@/lib/client/format';
import { Badge } from '@/components/ui/badge';
import { EmptyState } from '@/components/ui/empty-state';
import { Pagination } from '@/components/ui/pagination';

/**
 * `GET /admin/audit`
 *
 * Every decision that moved money, opened a stall, or removed somebody's work is written here with
 * the name of the person who made it and the reason they gave. The filters are a plain GET form so
 * "show me everything Sarah did to a payout last week" is a URL the team can paste into a dispute
 * instead of a screenshot.
 */
export const dynamic = 'force-dynamic';

export const metadata: Metadata = { title: 'Audit trail', robots: { index: false } };

/** Where an entity id is worth clicking. A payout or a zone has no admin detail page of its own. */
function entityHref(entity: string, entityId: string): string | null {
  switch (entity) {
    case 'USER':
      return `/admin/users/${entityId}`;
    case 'SHOP':
      return `/admin/shops/${entityId}`;
    case 'PRODUCT':
      return `/admin/listings/${entityId}`;
    case 'ORDER':
      return `/orders/${entityId}`;
    default:
      return null;
  }
}

/**
 * `before`/`after` are whatever the route chose to snapshot — a payout stores `{status}`, a zone
 * edit stores the four fee columns — so they are printed as stored rather than shaped into columns.
 */
function Snapshot({ label, value }: { label: string; value: unknown }) {
  if (value === null || value === undefined) {
    return <p className="text-xs text-ink-400">{label}: nothing recorded</p>;
  }
  return (
    <div>
      <p className="text-xs font-medium uppercase tracking-wide text-ink-500">{label}</p>
      <pre className="tabular mt-1 overflow-x-auto whitespace-pre-wrap break-all rounded-card bg-ink-50 px-3 py-2 text-xs text-ink-700">
        {JSON.stringify(value, null, 2)}
      </pre>
    </div>
  );
}

export default async function AdminAuditPage({
  searchParams,
}: {
  searchParams: Record<string, string | string[] | undefined>;
}) {
  await adminPage('/admin/audit');

  const query = parseParams(auditQuerySchema, searchParams);
  const [trail, staff] = await Promise.all([
    auditTrail({
      ...(query.entity ? { entity: query.entity } : {}),
      ...(query.entityId ? { entityId: query.entityId } : {}),
      ...(query.actorId ? { actorId: query.actorId } : {}),
      page: query.page,
      perPage: query.perPage,
    }),
    adminStaff(),
  ]);

  const filters = {
    entity: query.entity,
    entityId: query.entityId,
    actorId: query.actorId,
    perPage: query.perPage,
  };
  const hrefFor = (page: number) => hrefWith('/admin/audit', { ...filters, page: query.page }, { page });
  const actor = staff.find((member) => member.id === query.actorId) ?? null;

  return (
    <div className="space-y-5">
      <section className="card p-5">
        <h1 className="text-xl font-semibold text-ink-900">Audit trail</h1>
        <p className="mt-1 max-w-prose text-sm text-ink-600">
          Newest first. A row exists because a named person pressed a button that changed a listing, a
          stall, an order, a payment, a review, a payout, or a delivery price — reads are not logged.
        </p>

        <form method="get" action="/admin/audit" className="mt-4 grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
          <div>
            <label className="field-label" htmlFor="entity">
              What was touched
            </label>
            <select id="entity" name="entity" defaultValue={query.entity ?? ''} className="field-input">
              <option value="">Everything</option>
              {AUDIT_ENTITIES.map((value) => (
                <option key={value} value={value}>
                  {value.replace('_', ' ').toLowerCase()}
                </option>
              ))}
            </select>
          </div>
          <div>
            <label className="field-label" htmlFor="actorId">
              Who did it
            </label>
            <select id="actorId" name="actorId" defaultValue={query.actorId ?? ''} className="field-input">
              <option value="">Anyone on the team</option>
              {staff.map((member) => (
                <option key={member.id} value={member.id}>
                  {member.name ?? member.phone}
                </option>
              ))}
            </select>
          </div>
          <div>
            <label className="field-label" htmlFor="entityId">
              One record id
            </label>
            <input
              id="entityId"
              name="entityId"
              type="text"
              defaultValue={query.entityId ?? ''}
              maxLength={64}
              placeholder="clxxxx…"
              className="field-input"
            />
          </div>
          <input type="hidden" name="perPage" value={String(query.perPage)} />
          <div className="flex items-end gap-2">
            <button
              type="submit"
              className="rounded-card bg-bemz-600 px-4 py-2 text-sm font-semibold text-white hover:bg-bemz-700"
            >
              Filter
            </button>
            {(query.entity || query.actorId || query.entityId) && (
              <Link href="/admin/audit" className="rounded-card px-3 py-2 text-sm text-ink-600 hover:text-ink-900">
                Reset
              </Link>
            )}
          </div>
        </form>

        <p className="mt-3 text-xs text-ink-500">
          {trail.total} entr{trail.total === 1 ? 'y' : 'ies'}
          {query.entity ? ` touching ${query.entity.replace('_', ' ').toLowerCase()}` : ''}
          {actor ? ` by ${actor.name ?? actor.phone}` : ''}
          {query.entityId ? ' for one record' : ''}
        </p>
      </section>

      <section className="card overflow-hidden">
        {trail.items.length === 0 ? (
          <EmptyState
            title="Nothing matches"
            description="Either nobody has made a change like that, or the filters are narrower than intended. Reset above to see the whole trail."
          />
        ) : (
          <ul className="divide-y divide-ink-100">
            {trail.items.map((entry) => {
              const href = entityHref(entry.entity, entry.entityId);
              return (
                <li key={entry.id} className="px-5 py-4">
                  <div className="flex flex-wrap items-center gap-2">
                    <span className="text-sm font-semibold text-ink-900">{humanise(entry.action)}</span>
                    <Badge tone="neutral">{entry.entity.replace('_', ' ').toLowerCase()}</Badge>
                    {href ? (
                      <Link
                        href={href}
                        className="tabular truncate text-xs text-bemz-700 underline-offset-2 hover:underline"
                      >
                        {entry.entityId}
                      </Link>
                    ) : (
                      <span className="tabular text-xs text-ink-500">{entry.entityId}</span>
                    )}
                  </div>

                  <p className="mt-1 text-xs text-ink-600">
                    <Link href={`/admin/users/${entry.actor.id}`} className="font-medium text-bemz-700 underline-offset-2 hover:underline">
                      {entry.actor.name ?? 'Account with no name'}
                    </Link>{' '}
                    <span className="text-ink-400">({humanise(entry.actor.role)})</span> · {formatDateTime(entry.createdAt)}
                  </p>

                  {entry.reason && (
                    <p className="mt-2 rounded-card border-l-2 border-bemz-300 bg-bemz-50 px-3 py-2 text-sm text-ink-800">
                      “{entry.reason}”
                    </p>
                  )}

                  {(entry.before !== null || entry.after !== null) && (
                    <details className="mt-2">
                      <summary className="cursor-pointer text-xs font-medium text-ink-500 hover:text-ink-800">
                        What changed
                      </summary>
                      <div className="mt-2 grid gap-3 sm:grid-cols-2">
                        <Snapshot label="Before" value={entry.before} />
                        <Snapshot label="After" value={entry.after} />
                      </div>
                    </details>
                  )}
                </li>
              );
            })}
          </ul>
        )}

        <Pagination page={trail.page} perPage={trail.perPage} total={trail.total} hrefFor={hrefFor} />
      </section>

      <section className="card p-5">
        <h2 className="text-sm font-semibold uppercase tracking-wide text-ink-500">Who can be held to it</h2>
        <p className="mt-1 text-xs text-ink-600">
          Every row names the account that made the decision, and the database refuses to delete a person
          who has audit rows against them — a banned admin&rsquo;s name still has to be readable in the trail.
          That is the whole point: a restriction is recorded, it is not an erasure.
        </p>
        <ul className="mt-3 divide-y divide-ink-100 text-sm">
          {staff.map((member) => (
            <li key={member.id} className="flex flex-wrap items-center justify-between gap-2 py-2">
              <Link href={`/admin/users/${member.id}`} className="font-medium text-bemz-700 underline-offset-2 hover:underline">
                {member.name ?? member.phone}
              </Link>
              <span className="flex items-center gap-2 text-xs text-ink-500">
                <Badge tone={member.status === 'ACTIVE' ? 'success' : 'warning'}>{humanise(member.status)}</Badge>
                {member.lastLoginAt ? `last seen ${formatDateTime(member.lastLoginAt)}` : 'never signed in'}
              </span>
            </li>
          ))}
        </ul>
      </section>
    </div>
  );
}
