'use client';

import { useState } from 'react';
import { useRouter } from 'next/navigation';
import { Plus, Trash2 } from 'lucide-react';
import { api, ApiFailure, idempotencyKey } from '@/lib/client/api';
import { fromMinor, toMinor, type CurrencyCode } from '@/lib/money';
import { Button } from '@/components/ui/button';
import { SelectField, TextField } from '@/components/ui/field';
import { Badge } from '@/components/ui/badge';
import { useToast } from '@/components/toast';

export interface VariantSnapshot {
  id: string;
  sku: string;
  name: string;
  priceMinor: number;
  compareAtPriceMinor: number | null;
  costPriceMinor: number | null;
  stockQuantity: number;
  reservedQuantity: number;
  available: number;
  weightGrams: number | null;
  maxQuantityPerOrder: number | null;
  isDisabled: boolean;
  isPrimary: boolean;
  movementCount: number;
  attributes: Record<string, string>;
}

const STOCK_REASONS = [
  { value: 'PURCHASE_IN', label: 'New stock arrived' },
  { value: 'RETURN', label: 'A buyer returned units' },
  { value: 'CANCELLATION_REVERSAL', label: 'A cancelled order gave stock back' },
  { value: 'TRANSFER_IN', label: 'Moved in from another shop' },
  { value: 'TRANSFER_OUT', label: 'Moved out to another shop' },
  { value: 'SALE', label: 'Sold off-platform' },
  { value: 'MANUAL_ADJUSTMENT', label: 'Correcting the count' },
];

/**
 * A reason never decides the direction on its own — "correcting the count" can be either way,
 * and guessing wrong puts phantom units on a shelf that a buyer will then order.
 */
const INBOUND = new Set(['PURCHASE_IN', 'RETURN', 'CANCELLATION_REVERSAL', 'TRANSFER_IN']);
const OUTBOUND = new Set(['TRANSFER_OUT', 'SALE']);

/** Whole-shilling input back to minor units; blank and nonsense both mean "leave it alone". */
function majorToMinor(raw: string): number | null {
  const digits = raw.replace(/[,\s]/g, '');
  if (!digits) return null;
  const value = Number(digits);
  return Number.isFinite(value) && value >= 0 ? value : null;
}

function attributeText(attributes: Record<string, string>): string {
  return Object.entries(attributes)
    .map(([name, value]) => `${name}: ${value}`)
    .join(' · ');
}

/**
 * `PATCH/POST/DELETE /api/seller/products/{id}/variants[/…]` and
 * `POST /api/seller/products/{id}/variants/{variant}/stock`
 *
 * Price and stock are edited apart on purpose. Price is a number the seller may change as often
 * as they like; a unit count only moves by a signed delta with a reason and a one-shot key,
 * because a seller who retypes "37" after a buyer reserved two would overwrite a live basket.
 */
export function VariantWorkshop({
  productId,
  currency,
  variants,
}: {
  productId: string;
  currency: CurrencyCode;
  variants: VariantSnapshot[];
}) {
  const router = useRouter();
  const toast = useToast();

  const [drafts, setDrafts] = useState<Record<string, { name: string; price: string; compareAt: string; cost: string; weight: string; maxPerOrder: string }>>(() =>
    Object.fromEntries(
      variants.map((variant) => [
        variant.id,
        {
          name: variant.name,
          price: String(fromMinor(variant.priceMinor, currency)),
          compareAt: variant.compareAtPriceMinor === null ? '' : String(fromMinor(variant.compareAtPriceMinor, currency)),
          cost: variant.costPriceMinor === null ? '' : String(fromMinor(variant.costPriceMinor, currency)),
          weight: variant.weightGrams === null ? '' : String(variant.weightGrams),
          maxPerOrder: variant.maxQuantityPerOrder === null ? '' : String(variant.maxQuantityPerOrder),
        },
      ]),
    ),
  );
  const [busyId, setBusyId] = useState<string | null>(null);
  const [rowError, setRowError] = useState<Record<string, string>>({});
  const [adding, setAdding] = useState(false);
  const [showAll, setShowAll] = useState(variants.length <= 6);

  function updateDraft(id: string, patch: Partial<(typeof drafts)[string]>) {
    setDrafts((current) => ({ ...current, [id]: { ...current[id]!, ...patch } }));
  }

  async function savePrice(variant: VariantSnapshot) {
    const draft = drafts[variant.id]!;
    const price = majorToMinor(draft.price);
    const compareAt = draft.compareAt.trim() === '' ? null : majorToMinor(draft.compareAt);
    const cost = draft.cost.trim() === '' ? null : majorToMinor(draft.cost);
    const weight = draft.weight.trim() === '' ? undefined : Number(draft.weight.replace(/[,\s]/g, ''));
    const cap = draft.maxPerOrder.trim() === '' ? undefined : Number(draft.maxPerOrder.replace(/[,\s]/g, ''));

    const problems: Record<string, string> = {};
    if (price === null || price <= 0) problems[variant.id] = 'A price above zero is required';
    else if (compareAt !== null && price !== null && compareAt <= price) problems[variant.id] = 'The old price must be higher than the selling price';
    setRowError(problems);
    if (problems[variant.id]) return;

    setBusyId(variant.id);
    try {
      await api.patch(`/api/seller/products/${productId}/variants/${variant.id}`, {
        name: draft.name.trim() || variant.sku,
        priceMinor: toMinor(price!, currency),
        compareAtPriceMinor: compareAt === null ? undefined : toMinor(compareAt, currency),
        costPriceMinor: cost === null ? undefined : toMinor(cost, currency),
        weightGrams: weight !== undefined && Number.isFinite(weight) && weight > 0 ? Math.round(weight) : undefined,
        maxQuantityPerOrder: cap !== undefined && Number.isFinite(cap) && cap > 0 ? Math.round(cap) : undefined,
      });
      toast.push(`${variant.sku} repriced.`, 'success');
      setRowError({});
      router.refresh();
    } catch (failure) {
      setRowError({ [variant.id]: failure instanceof ApiFailure ? failure.message : 'Could not save this price' });
    } finally {
      setBusyId(null);
    }
  }

  async function setDisabled(variant: VariantSnapshot, isDisabled: boolean) {
    setBusyId(variant.id);
    try {
      await api.patch(`/api/seller/products/${productId}/variants/${variant.id}`, { isDisabled });
      toast.push(isDisabled ? `${variant.sku} hidden from buyers.` : `${variant.sku} is on sale again.`, 'success');
      router.refresh();
    } catch (failure) {
      setRowError({ [variant.id]: failure instanceof ApiFailure ? failure.message : 'That did not work' });
    } finally {
      setBusyId(null);
    }
  }

  async function retire(variant: VariantSnapshot) {
    setBusyId(variant.id);
    try {
      await api.del(`/api/seller/products/${productId}/variants/${variant.id}`);
      toast.push(`${variant.sku} retired. Past orders still show it.`, 'success');
      router.refresh();
    } catch (failure) {
      setRowError({ [variant.id]: failure instanceof ApiFailure ? failure.message : 'Could not retire this option' });
    } finally {
      setBusyId(null);
    }
  }

  const visible = showAll ? variants : variants.slice(0, 6);

  return (
    <section className="card space-y-4 p-5">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div>
          <h2 className="text-sm font-semibold uppercase tracking-wide text-ink-500">Options, prices and stock</h2>
          <p className="mt-1 text-xs text-ink-500">
            {variants.length} {variants.length === 1 ? 'option' : 'options'} · prices in {currency} · stock changes are logged with a
            reason
          </p>
        </div>
        <Button variant="outline" size="sm" onClick={() => setAdding((current) => !current)}>
          <Plus className="size-4" />
          Add option
        </Button>
      </div>

      {adding && <AddVariantForm productId={productId} currency={currency} onDone={() => setAdding(false)} />}

      <div className="space-y-4">
        {visible.map((variant) => {
          const draft = drafts[variant.id]!;
          const held = variant.reservedQuantity;
          return (
            <div key={variant.id} className="rounded-card border border-ink-100 p-4">
              <div className="flex flex-wrap items-center gap-2">
                <p className="text-sm font-semibold text-ink-900">{variant.name}</p>
                <span className="tabular rounded bg-ink-100 px-1.5 py-0.5 text-xs text-ink-600">{variant.sku}</span>
                {variant.isPrimary && <Badge tone="brand">Default</Badge>}
                {variant.isDisabled && <Badge tone="warning">Hidden</Badge>}
                <span className="ml-auto text-xs text-ink-500">
                  {attributeText(variant.attributes) || 'No attributes'}
                </span>
              </div>

              <div className="mt-3 grid gap-3 sm:grid-cols-2 lg:grid-cols-5">
                <TextField
                  label="Option name"
                  value={draft.name}
                  onChange={(event) => updateDraft(variant.id, { name: event.target.value })}
                  maxLength={80}
                />
                <TextField
                  label={`Price (${currency})`}
                  value={draft.price}
                  onChange={(event) => updateDraft(variant.id, { price: event.target.value })}
                  inputMode="numeric"
                  leading={<span>{currency}</span>}
                />
                <TextField
                  label="Old price (optional)"
                  value={draft.compareAt}
                  onChange={(event) => updateDraft(variant.id, { compareAt: event.target.value })}
                  inputMode="numeric"
                  hint={
                    majorToMinor(draft.compareAt) !== null && majorToMinor(draft.price) !== null && majorToMinor(draft.compareAt)! > majorToMinor(draft.price)!
                      ? `Buyers see ${Math.round(((majorToMinor(draft.compareAt)! - majorToMinor(draft.price)!) / majorToMinor(draft.compareAt)!) * 100)}% off`
                      : 'Crossed out next to the price'
                  }
                />
                <TextField
                  label="Your cost (optional)"
                  value={draft.cost}
                  onChange={(event) => updateDraft(variant.id, { cost: event.target.value })}
                  inputMode="numeric"
                  hint="Private — never shown to a buyer"
                />
                <TextField
                  label="Max per order"
                  value={draft.maxPerOrder}
                  onChange={(event) => updateDraft(variant.id, { maxPerOrder: event.target.value })}
                  inputMode="numeric"
                  hint="Blank = no cap"
                />
              </div>

              <div className="mt-3 flex flex-wrap items-end gap-3">
                <TextField
                  label="Weight (grams)"
                  value={draft.weight}
                  onChange={(event) => updateDraft(variant.id, { weight: event.target.value })}
                  inputMode="numeric"
                  className="w-36"
                />
                <Button size="sm" loading={busyId === variant.id} onClick={() => void savePrice(variant)}>
                  Save price
                </Button>
                <Button size="sm" variant="ghost" onClick={() => void setDisabled(variant, !variant.isDisabled)}>
                  {variant.isDisabled ? 'Show to buyers' : 'Hide from buyers'}
                </Button>
                <RetireButton variant={variant} busy={busyId === variant.id} onRetire={() => void retire(variant)} />
              </div>

              {rowError[variant.id] && (
                <p role="alert" className="mt-2 text-sm text-clay-700">
                  {rowError[variant.id]}
                </p>
              )}

              <div className="mt-3 flex flex-wrap items-center gap-2 border-t border-ink-100 pt-3">
                <p className="tabular text-sm text-ink-800">
                  <span className="font-semibold">{variant.stockQuantity}</span> on the shelf
                </p>
                {held > 0 && (
                  <Badge tone="info">
                    {held} held in baskets ({variant.available} sellable)
                  </Badge>
                )}
                {variant.stockQuantity === 0 && <Badge tone="danger">Sold out</Badge>}
                <span className="ml-auto text-xs text-ink-500">{variant.movementCount} stock entries</span>
                <StockTally productId={productId} variant={variant} />
              </div>
            </div>
          );
        })}
      </div>

      {variants.length > 6 && (
        <Button variant="ghost" size="sm" onClick={() => setShowAll((current) => !current)}>
          {showAll ? 'Show fewer' : `Show all ${variants.length} options`}
        </Button>
      )}
    </section>
  );
}

function RetireButton({ variant, busy, onRetire }: { variant: VariantSnapshot; busy: boolean; onRetire: () => void }) {
  const [confirming, setConfirming] = useState(false);
  if (!confirming) {
    return (
      <Button size="sm" variant="ghost" className="text-clay-700" onClick={() => setConfirming(true)}>
        <Trash2 className="size-4" />
        Retire
      </Button>
    );
  }
  return (
    <div className="flex items-center gap-2 rounded-lg bg-clay-50 px-2 py-1 ring-1 ring-inset ring-clay-200">
      <span className="text-xs text-clay-800">Retire {variant.sku}?</span>
      <Button size="sm" variant="danger" loading={busy} onClick={onRetire}>
        Yes
      </Button>
      <Button size="sm" variant="ghost" onClick={() => setConfirming(false)}>
        No
      </Button>
    </div>
  );
}

/**
 * A signed delta, never an absolute count, and one key per tap. A seller who taps "add 10" twice
 * over a dropping signal gets ten units, not twenty — the server replays the first answer.
 */
function StockTally({ productId, variant }: { productId: string; variant: VariantSnapshot }) {
  const router = useRouter();
  const toast = useToast();
  const [open, setOpen] = useState(false);
  const [direction, setDirection] = useState<'in' | 'out'>('in');
  const [amount, setAmount] = useState('10');
  const [reason, setReason] = useState('PURCHASE_IN');
  const [note, setNote] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const units = Math.trunc(Number(amount.replace(/[,\s]/g, '')) || 0);
  const signed = direction === 'out' ? -Math.abs(units) : Math.abs(units);
  const afterCount = variant.stockQuantity + signed;

  function pick(next: string) {
    setReason(next);
    // A reason that only ever goes one way sets the switch for you; "correcting the count"
    // deliberately leaves it where the seller put it.
    if (INBOUND.has(next)) setDirection('in');
    if (OUTBOUND.has(next)) setDirection('out');
  }

  async function apply() {
    if (signed === 0) {
      setError('Enter how many units came in or went out');
      return;
    }
    if (afterCount < variant.reservedQuantity) {
      setError(`Only ${variant.available} are sellable — ${variant.reservedQuantity} sit in buyers' baskets`);
      return;
    }

    setBusy(true);
    setError(null);
    try {
      const movement = await api.post<{ delta: number; balanceAfter: number; duplicate?: boolean }>(
        `/api/seller/products/${productId}/variants/${variant.id}/stock`,
        { delta: signed, reason, note: note.trim() || undefined, idempotencyKey: idempotencyKey('stock') },
      );
      toast.push(
        `${signed > 0 ? 'Added' : 'Removed'} ${Math.abs(signed)} ${Math.abs(signed) === 1 ? 'unit' : 'units'} — ${movement.balanceAfter} on the shelf.`,
        'success',
      );
      setOpen(false);
      setNote('');
      router.refresh();
    } catch (failure) {
      setError(failure instanceof ApiFailure ? failure.message : 'Could not record the stock change');
    } finally {
      setBusy(false);
    }
  }

  if (!open) {
    return (
      <Button
        size="sm"
        variant="outline"
        onClick={() => {
          setOpen(true);
          setDirection('in');
          setAmount('10');
          setReason('PURCHASE_IN');
          setError(null);
        }}
      >
        Count stock
      </Button>
    );
  }

  return (
    <div className="w-full rounded-card bg-ink-50 p-3 sm:ml-auto sm:w-auto sm:min-w-[26rem]">
      <div className="flex gap-1 rounded-lg bg-white p-1 ring-1 ring-inset ring-ink-200">
        {(['in', 'out'] as const).map((way) => (
          <button
            key={way}
            type="button"
            aria-pressed={direction === way}
            onClick={() => setDirection(way)}
            className={`flex-1 rounded-md px-3 py-1.5 text-sm font-medium transition-colors ${
              direction === way ? 'bg-bemz-600 text-white' : 'text-ink-600 hover:bg-ink-100'
            }`}
          >
            {way === 'in' ? 'Coming in' : 'Going out'}
          </button>
        ))}
      </div>

      <div className="mt-3 grid gap-3 sm:grid-cols-2">
        <TextField
          label="Units"
          value={amount}
          onChange={(event) => setAmount(event.target.value)}
          inputMode="numeric"
          hint="A whole number."
        />
        <SelectField
          label="Why"
          value={reason}
          onChange={(event) => pick(event.target.value)}
          options={STOCK_REASONS.map((option) => ({ value: option.value, label: option.label }))}
        />
      </div>

      <div className="mt-3">
        <TextField
          label="Note (optional)"
          value={note}
          onChange={(event) => setNote(event.target.value)}
          maxLength={200}
          placeholder="e.g. carton from Kampala road supplier"
        />
      </div>

      {error && (
        <p role="alert" className="mt-2 text-sm text-clay-700">
          {error}
        </p>
      )}

      <div className="mt-3 flex flex-wrap items-center justify-end gap-2">
        <p className="mr-auto tabular text-xs text-ink-600">
          {variant.stockQuantity} → {afterCount} on the shelf
        </p>
        <Button size="sm" variant="ghost" onClick={() => setOpen(false)}>
          Cancel
        </Button>
        <Button size="sm" loading={busy} onClick={() => void apply()}>
          Record {signed < 0 ? `−${Math.abs(signed)}` : `+${signed}`} units
        </Button>
      </div>
    </div>
  );
}

function AddVariantForm({ productId, currency, onDone }: { productId: string; currency: CurrencyCode; onDone: () => void }) {
  const router = useRouter();
  const toast = useToast();
  const [name, setName] = useState('');
  const [sku, setSku] = useState('');
  const [price, setPrice] = useState('');
  const [stock, setStock] = useState('0');
  const [attributes, setAttributes] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function submit() {
    const priceMinor = majorToMinor(price);
    const stockUnits = Number(stock.replace(/[,\s]/g, '') || 0);
    if (!name.trim()) return setError('Name the option, e.g. "64 GB black"');
    if (priceMinor === null || priceMinor <= 0) return setError('Enter a price above zero');
    if (!Number.isFinite(stockUnits) || stockUnits < 0) return setError('Stock is 0 or more');

    const parsed: Record<string, string> = {};
    for (const part of attributes.split(/[;,]/)) {
      const [key, value] = part.split(':').map((piece) => piece?.trim());
      if (key && value) parsed[key.slice(0, 40)] = value.slice(0, 60);
    }

    setBusy(true);
    setError(null);
    try {
      await api.post(`/api/seller/products/${productId}/variants`, {
        name: name.trim(),
        sku: sku.trim().toUpperCase(),
        attributes: parsed,
        priceMinor: toMinor(priceMinor, currency),
        stockQuantity: Math.round(stockUnits),
      });
      toast.push('Option added. Add its stock with Count stock if you did not type it.', 'success');
      onDone();
      router.refresh();
    } catch (failure) {
      if (failure instanceof ApiFailure) {
        const issues = failure.issues;
        setError(issues.sku ?? issues.priceMinor ?? issues.attributes ?? failure.message);
      } else {
        setError('Could not add the option');
      }
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="rounded-card border border-bemz-200 bg-bemz-50 p-4">
      <p className="text-sm font-semibold text-ink-900">New option</p>
      <div className="mt-3 grid gap-3 sm:grid-cols-2 lg:grid-cols-5">
        <TextField label="Name" value={name} onChange={(event) => setName(event.target.value)} maxLength={80} placeholder="64 GB black" />
        <TextField label="SKU" value={sku} onChange={(event) => setSku(event.target.value)} maxLength={49} placeholder="PHONE64BLK" hint="Letters, numbers, dashes" />
        <TextField label={`Price (${currency})`} value={price} onChange={(event) => setPrice(event.target.value)} inputMode="numeric" leading={<span>{currency}</span>} />
        <TextField label="Opening stock" value={stock} onChange={(event) => setStock(event.target.value)} inputMode="numeric" />
        <TextField label="Attributes" value={attributes} onChange={(event) => setAttributes(event.target.value)} placeholder="Colour: Black, Size: 64GB" />
      </div>
      {error && (
        <p role="alert" className="mt-2 text-sm text-clay-700">
          {error}
        </p>
      )}
      <div className="mt-3 flex justify-end gap-2">
        <Button size="sm" variant="ghost" onClick={onDone}>
          Cancel
        </Button>
        <Button size="sm" loading={busy} onClick={() => void submit()}>
          Add option
        </Button>
      </div>
    </div>
  );
}
