'use client';

import { useState } from 'react';
import { useRouter } from 'next/navigation';
import { api, ApiFailure } from '@/lib/client/api';
import { Button } from '@/components/ui/button';
import { SwitchField, TextField } from '@/components/ui/field';
import { useToast } from '@/components/toast';

export interface CategoryRow {
  id: string;
  name: string;
  slug: string;
  requiresKyc: boolean;
  isActive: boolean;
  commissionRateBps: number;
  sortOrder: number;
  productCount: number;
  hasChildren: boolean;
}

/** `12.50%` is how the rate is quoted to a seller; the column stores basis points. */
const toPercent = (bps: number) => (bps / 100).toFixed(2);
const toBps = (percent: number) => Math.round(percent * 100);

/**
 * `PATCH /api/admin/categories/{id}`
 *
 * Two of these four fields change what the platform earns or what a seller is allowed to list, so
 * the panel only ever sends what moved and the reason is implicit in the audit row's before/after.
 * Renaming also rewrites the materialised path of every category below it — the server does that in
 * the same transaction, which is why the name field warns instead of quietly accepting a typo.
 */
export function CategoryEditor({ category }: { category: CategoryRow }) {
  const router = useRouter();
  const toast = useToast();

  const [name, setName] = useState(category.name);
  const [percent, setPercent] = useState(toPercent(category.commissionRateBps));
  const [requiresKyc, setRequiresKyc] = useState(category.requiresKyc);
  const [isActive, setIsActive] = useState(category.isActive);
  const [sortOrder, setSortOrder] = useState(String(category.sortOrder));

  const [busy, setBusy] = useState(false);
  const [issues, setIssues] = useState<Record<string, string>>({});

  const trimmedName = name.trim();
  const parsedPercent = Number(percent);
  const parsedOrder = Number(sortOrder);

  const unchanged =
    trimmedName === category.name &&
    Number.isFinite(parsedPercent) &&
    toBps(parsedPercent) === category.commissionRateBps &&
    requiresKyc === category.requiresKyc &&
    isActive === category.isActive &&
    Number.isInteger(parsedOrder) &&
    parsedOrder === category.sortOrder;

  async function save() {
    setIssues({});

    if (trimmedName.length < 2) {
      setIssues({ name: 'A department needs a name buyers can search for' });
      return;
    }
    if (!Number.isFinite(parsedPercent) || parsedPercent < 0 || parsedPercent > 100) {
      setIssues({ commissionRateBps: 'Write the share as a percentage between 0 and 100' });
      return;
    }
    if (!Number.isInteger(parsedOrder) || parsedOrder < 0 || parsedOrder > 9999) {
      setIssues({ sortOrder: 'Order is a whole number between 0 and 9999' });
      return;
    }

    const patch: Record<string, unknown> = {};
    if (trimmedName !== category.name) patch.name = trimmedName;
    if (toBps(parsedPercent) !== category.commissionRateBps) patch.commissionRateBps = toBps(parsedPercent);
    if (requiresKyc !== category.requiresKyc) patch.requiresKyc = requiresKyc;
    if (isActive !== category.isActive) patch.isActive = isActive;
    if (parsedOrder !== category.sortOrder) patch.sortOrder = parsedOrder;

    if (Object.keys(patch).length === 0) {
      setIssues({ form: 'Nothing changed — this department already says that' });
      return;
    }

    setBusy(true);
    try {
      await api.patch(`/api/admin/categories/${category.id}`, patch);
      toast.push(`${trimmedName} updated. Live rates apply to the next sale, not to orders already placed.`, 'success');
      router.refresh();
    } catch (failure) {
      if (failure instanceof ApiFailure) {
        setIssues(Object.keys(failure.issues).length > 0 ? failure.issues : { form: failure.message });
        toast.push(failure.message, 'error');
      } else {
        setIssues({ form: 'The department did not save — try again' });
      }
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="space-y-4 px-5 py-4">
      <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
        <TextField
          label="Name"
          value={name}
          onChange={(event) => setName(event.target.value)}
          maxLength={80}
          required
          error={issues.name}
          hint={
            trimmedName !== category.name
              ? `Renaming changes the URL from /category/${category.slug} — every page below it moves with it.`
              : 'The label and the address both come from this.'
          }
        />
        <TextField
          label="Commission (%)"
          value={percent}
          onChange={(event) => setPercent(event.target.value)}
          inputMode="decimal"
          required
          error={issues.commissionRateBps}
          hint={`Held from each sale in ${category.name}. Currently ${toPercent(category.commissionRateBps)}%.`}
        />
        <TextField
          label="Sort order"
          value={sortOrder}
          onChange={(event) => setSortOrder(event.target.value)}
          inputMode="numeric"
          required
          error={issues.sortOrder}
          hint="Lowest first in the header nav and on the departments page."
        />
        <div className="flex items-end">
          <p className="text-xs text-ink-500">
            {category.productCount} purchasable listing{category.productCount === 1 ? '' : 's'} in this subtree
            {category.hasChildren ? ' · has departments below' : ''}
          </p>
        </div>
      </div>

      <div className="grid gap-3 sm:grid-cols-2">
        <SwitchField
          label="Sellers need approved ID to list here"
          description="For counterfeit-heavy lines. Existing listings stay; new ones are refused until the shop's documents clear."
          checked={requiresKyc}
          onChange={setRequiresKyc}
        />
        <SwitchField
          label="Visible to buyers"
          description="Switching off hides the department and everything under it from search and navigation without deleting any listing."
          checked={isActive}
          onChange={setIsActive}
        />
      </div>

      {issues.form && (
        <p role="alert" className="rounded-card bg-clay-50 px-3 py-2 text-sm text-clay-800">
          {issues.form}
        </p>
      )}

      <div className="flex flex-wrap items-center gap-3">
        <Button loading={busy} disabled={unchanged} onClick={() => void save()}>
          Save department
        </Button>
        {unchanged && <p className="text-xs text-ink-500">Saved as it stands.</p>}
        {!category.isActive && (
          <p className="text-xs text-clay-800">
            Hidden now — {category.productCount} listing{category.productCount === 1 ? '' : 's'} below it are unreachable until it is
            switched back on.
          </p>
        )}
      </div>
    </div>
  );
}
