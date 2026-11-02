'use client';

import { useMemo, useState } from 'react';
import { useRouter } from 'next/navigation';
import { api, ApiFailure } from '@/lib/client/api';
import type { ProductCondition, FulfilmentType } from '@/lib/client/types';
import type { CurrencyCode } from '@/lib/money';
import { Button } from '@/components/ui/button';
import { SelectField, TextAreaField, TextField } from '@/components/ui/field';
import { useToast } from '@/components/toast';
import type { SellerCategoryOption } from '@/components/seller/product-form';

const CONDITIONS: { value: ProductCondition; label: string }[] = [
  { value: 'NEW', label: 'New' },
  { value: 'USED', label: 'Used' },
  { value: 'REFURBISHED', label: 'Refurbished' },
];

const FULFILMENT: { value: FulfilmentType; label: string }[] = [
  { value: 'SELLER_DELIVERY', label: 'A Bemz rider collects and delivers' },
  { value: 'SELLER_SELF_DELIVERY', label: 'I deliver it myself' },
  { value: 'BUYER_PICKUP', label: 'The buyer collects from me' },
  { value: 'DIGITAL', label: 'Digital — nothing is carried' },
];

export interface ListingEditorInitial {
  id: string;
  title: string;
  subtitle: string | null;
  description: string;
  brand: string | null;
  condition: ProductCondition;
  fulfilmentType: FulfilmentType;
  warrantyText: string | null;
  weightGrams: number | null;
  metaTitle: string | null;
  metaDescription: string | null;
  isDigital: boolean;
  categoryIds: string[];
  primaryCategoryId: string | null;
}

/**
 * `PATCH /api/seller/products/{id}`
 *
 * Words and categories only. Price lives on the option, stock lives on the ledger, and status
 * has its own button — so nothing in this form can quietly re-price a listing that a buyer is
 * already looking at.
 */
export function ListingEditor({
  initial,
  categories,
  currency,
  kycApproved,
}: {
  initial: ListingEditorInitial;
  categories: SellerCategoryOption[];
  currency: CurrencyCode;
  kycApproved: boolean;
}) {
  const router = useRouter();
  const toast = useToast();

  const [title, setTitle] = useState(initial.title);
  const [subtitle, setSubtitle] = useState(initial.subtitle ?? '');
  const [description, setDescription] = useState(initial.description);
  const [brand, setBrand] = useState(initial.brand ?? '');
  const [condition, setCondition] = useState<ProductCondition>(initial.condition);
  const [fulfilmentType, setFulfilmentType] = useState<FulfilmentType>(initial.fulfilmentType);
  const [warrantyText, setWarrantyText] = useState(initial.warrantyText ?? '');
  const [weightGrams, setWeightGrams] = useState(initial.weightGrams === null ? '' : String(initial.weightGrams));
  const [metaTitle, setMetaTitle] = useState(initial.metaTitle ?? '');
  const [metaDescription, setMetaDescription] = useState(initial.metaDescription ?? '');
  const [categoryIds, setCategoryIds] = useState<string[]>(initial.categoryIds);
  const [primaryCategoryId, setPrimaryCategoryId] = useState(initial.primaryCategoryId ?? initial.categoryIds[0] ?? '');

  const [busy, setBusy] = useState(false);
  const [issues, setIssues] = useState<Record<string, string>>({});

  const selected = useMemo(
    () => categoryIds.map((id) => categories.find((category) => category.id === id)).filter(Boolean) as SellerCategoryOption[],
    [categoryIds, categories],
  );

  const dirty =
    title !== initial.title ||
    subtitle !== (initial.subtitle ?? '') ||
    description !== initial.description ||
    brand !== (initial.brand ?? '') ||
    condition !== initial.condition ||
    fulfilmentType !== initial.fulfilmentType ||
    warrantyText !== (initial.warrantyText ?? '') ||
    weightGrams !== (initial.weightGrams === null ? '' : String(initial.weightGrams)) ||
    metaTitle !== (initial.metaTitle ?? '') ||
    metaDescription !== (initial.metaDescription ?? '') ||
    categoryIds.join(',') !== initial.categoryIds.join(',') ||
    primaryCategoryId !== (initial.primaryCategoryId ?? initial.categoryIds[0] ?? '');

  function toggleCategory(id: string, listable: boolean) {
    if (!listable) return;
    setIssues({});
    setCategoryIds((current) => {
      const next = current.includes(id) ? current.filter((value) => value !== id) : [...current, id].slice(0, 5);
      // A primary that has been unticked would be rejected by the API, so fall back to the
      // deepest remaining selection rather than sending a link the server has to refuse.
      if (!next.includes(primaryCategoryId)) setPrimaryCategoryId(next[0] ?? '');
      return next;
    });
  }

  async function save() {
    const next: Record<string, string> = {};
    if (title.trim().length < 3) next.title = 'Give the listing a title';
    if (description.trim().length < 30) next.description = 'Describe the item in at least 30 characters';
    if (categoryIds.length === 0) next.categoryIds = 'Pick at least one category';
    setIssues(next);
    if (Object.keys(next).length > 0) return;

    setBusy(true);
    try {
      const weight = weightGrams.trim() ? Number(weightGrams.replace(/[,\s]/g, '')) : undefined;
      await api.patch(`/api/seller/products/${initial.id}`, {
        title: title.trim(),
        subtitle: subtitle.trim() || undefined,
        description: description.trim(),
        brand: brand.trim() || undefined,
        condition,
        fulfilmentType,
        warrantyText: warrantyText.trim() || undefined,
        weightGrams: weight !== undefined && Number.isFinite(weight) ? Math.round(weight) : undefined,
        metaTitle: metaTitle.trim() || undefined,
        metaDescription: metaDescription.trim() || undefined,
        categoryIds,
        primaryCategoryId: primaryCategoryId || undefined,
      });
      toast.push('Listing details saved.', 'success');
      router.refresh();
    } catch (failure) {
      if (failure instanceof ApiFailure) {
        const parsed = failure.issues;
        setIssues(Object.keys(parsed).length > 0 ? parsed : { form: failure.message });
      } else {
        setIssues({ form: 'That did not work — check your connection and try again' });
      }
    } finally {
      setBusy(false);
    }
  }

  return (
    <form
      className="card space-y-5 p-5"
      onSubmit={(event) => {
        event.preventDefault();
        void save();
      }}
    >
      <div>
        <h2 className="text-sm font-semibold uppercase tracking-wide text-ink-500">What buyers read</h2>
        <p className="mt-1 text-xs text-ink-500">
          Saved to the listing as it stands now — a live listing changes for buyers the moment you press save.
        </p>
      </div>

      <TextField
        label="Title"
        value={title}
        onChange={(event) => setTitle(event.target.value)}
        maxLength={140}
        error={issues.title}
        hint="What it is, in the words a buyer would type."
      />
      <TextField
        label="Short line (optional)"
        value={subtitle}
        onChange={(event) => setSubtitle(event.target.value)}
        maxLength={160}
        error={issues.subtitle}
      />
      <TextAreaField
        label="Description"
        value={description}
        onChange={(event) => setDescription(event.target.value)}
        rows={8}
        error={issues.description}
        hint={`${description.trim().length} characters — at least 30.`}
      />

      <div className="grid gap-4 sm:grid-cols-2">
        <TextField label="Brand (optional)" value={brand} onChange={(event) => setBrand(event.target.value)} maxLength={80} error={issues.brand} />
        <SelectField
          label="Condition"
          value={condition}
          onChange={(event) => setCondition(event.target.value as ProductCondition)}
          options={CONDITIONS.map((option) => ({ value: option.value, label: option.label }))}
          error={issues.condition}
        />
        <SelectField
          label="How it reaches the buyer"
          value={fulfilmentType}
          onChange={(event) => setFulfilmentType(event.target.value as FulfilmentType)}
          options={FULFILMENT.map((option) => ({ value: option.value, label: option.label }))}
          error={issues.fulfilmentType}
        />
        <TextField
          label="Weight in grams (optional)"
          value={weightGrams}
          onChange={(event) => setWeightGrams(event.target.value)}
          inputMode="numeric"
          error={issues.weightGrams}
          hint={fulfilmentType === 'DIGITAL' ? 'Not needed for a digital item.' : 'Riders price the trip from it.'}
        />
      </div>

      <TextField
        label="Warranty note (optional)"
        value={warrantyText}
        onChange={(event) => setWarrantyText(event.target.value)}
        maxLength={200}
        error={issues.warrantyText}
      />

      <section className="space-y-3 border-t border-ink-100 pt-5">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <h3 className="text-sm font-semibold uppercase tracking-wide text-ink-500">Categories</h3>
          <p className="text-xs text-ink-500">{categoryIds.length}/5 chosen</p>
        </div>
        {issues.categoryIds && (
          <p role="alert" className="text-sm text-clay-700">
            {issues.categoryIds}
          </p>
        )}
        <div className="max-h-72 space-y-1 overflow-y-auto rounded-card bg-ink-50 p-2">
          {categories.map((category) => {
            const checked = categoryIds.includes(category.id);
            const disabled = !category.listable;
            return (
              <label
                key={category.id}
                className={`flex items-center gap-2 rounded-md px-2 py-1.5 text-sm ${
                  disabled ? 'cursor-not-allowed text-ink-400' : checked ? 'bg-white text-ink-900 ring-1 ring-inset ring-bemz-200' : 'cursor-pointer text-ink-800 hover:bg-white'
                }`}
                style={{ marginLeft: `${Math.min(category.depth, 4) * 12}px` }}
              >
                <input
                  type="checkbox"
                  className="size-4 rounded border-ink-300 text-bemz-600 focus:ring-bemz-500"
                  checked={checked}
                  disabled={disabled}
                  onChange={() => toggleCategory(category.id, category.listable)}
                />
                <span className="min-w-0 flex-1 truncate">{category.name}</span>
                <span className="tabular text-xs text-ink-500">{(category.commissionRateBps / 100).toFixed(2).replace(/\.00$/, '')}%</span>
                {disabled && <span className="text-xs text-clay-700">needs your ID</span>}
              </label>
            );
          })}
        </div>
        {!kycApproved && (
          <p className="text-xs text-ink-500">
            Categories marked &ldquo;needs your ID&rdquo; stay closed until your documents are approved. This listing keeps the ones it is
            already in.
          </p>
        )}
        {selected.length > 1 && (
          <SelectField
            label="Main category"
            value={primaryCategoryId || selected[0]!.id}
            onChange={(event) => setPrimaryCategoryId(event.target.value)}
            options={selected.map((category) => ({ value: category.id, label: category.name }))}
            error={issues.primaryCategoryId}
            hint="Commission and the ID rule are read from this one."
          />
        )}
      </section>

      <section className="space-y-3 border-t border-ink-100 pt-5">
        <h3 className="text-sm font-semibold uppercase tracking-wide text-ink-500">Search listing</h3>
        <TextField
          label="Google title (optional)"
          value={metaTitle}
          onChange={(event) => setMetaTitle(event.target.value)}
          maxLength={70}
          error={issues.metaTitle}
          hint="Blank uses the listing title."
        />
        <TextField
          label="Google description (optional)"
          value={metaDescription}
          onChange={(event) => setMetaDescription(event.target.value)}
          maxLength={180}
          error={issues.metaDescription}
          hint="Blank uses the short line, then the first sentences."
        />
      </section>

      {issues.form && (
        <p role="alert" className="rounded-card bg-clay-50 px-3 py-2 text-sm text-clay-800">
          {issues.form}
        </p>
      )}

      <div className="flex flex-wrap items-center justify-between gap-3 border-t border-ink-100 pt-5">
        <p className="text-xs text-ink-500">Prices are set per option below, in {currency}.</p>
        <Button type="submit" loading={busy} disabled={!dirty || busy}>
          {dirty ? 'Save details' : 'Nothing to save'}
        </Button>
      </div>
    </form>
  );
}
