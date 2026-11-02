'use client';

import { useMemo, useRef, useState } from 'react';
import { useRouter } from 'next/navigation';
import { api, ApiFailure } from '@/lib/client/api';
import { toMinor, type CurrencyCode } from '@/lib/money';
import { uploadMedia } from '@/lib/client/upload';
import { money } from '@/lib/client/format';
import { REGIONS } from '@/lib/client/regions';
import { Button } from '@/components/ui/button';
import { CheckboxField, SelectField, TextAreaField, TextField } from '@/components/ui/field';
import { useToast } from '@/components/toast';

export interface SellerCategoryOption {
  id: string;
  name: string;
  slug: string;
  path: string;
  depth: number;
  requiresKyc: boolean;
  commissionRateBps: number;
  listable: boolean;
}

interface Photo {
  url: string;
  publicId: string;
  altText: string;
}

interface AttributePair {
  id: string;
  name: string;
  value: string;
}

interface VariantDraft {
  id: string;
  name: string;
  sku: string;
  price: string;
  compareAt: string;
  cost: string;
  stock: string;
  weightGrams: string;
  maxPerOrder: string;
  attributes: AttributePair[];
}

const MAX_PHOTOS = 20;
const CONDITIONS = [
  { value: 'NEW', label: 'New' },
  { value: 'USED', label: 'Used' },
  { value: 'REFURBISHED', label: 'Refurbished' },
];
const FULFILMENT = [
  { value: 'SELLER_DELIVERY', label: 'A Bemz rider delivers it' },
  { value: 'SELLER_SELF_DELIVERY', label: 'I deliver it myself' },
  { value: 'BUYER_PICKUP', label: 'The buyer collects from me' },
  { value: 'DIGITAL', label: 'Digital — nothing is carried' },
];

let rowSequence = 0;
const nextKey = () => `row-${(rowSequence += 1)}`;

/** Prices are typed in shillings, the API takes minor units, and the difference is two zeros. */
function priceInput(raw: string): number | null {
  const digits = raw.replace(/[,\s]/g, '');
  if (!digits) return null;
  const major = Number(digits);
  if (!Number.isFinite(major) || major <= 0) return null;
  return Math.round(major);
}

function wholeInput(raw: string): number | undefined {
  const digits = raw.replace(/[,\s]/g, '');
  if (!digits) return undefined;
  const value = Number(digits);
  return Number.isFinite(value) && value >= 0 ? Math.round(value) : undefined;
}

/**
 * A stock code the server will accept: 4-49 characters of letters, numbers and dashes, starting
 * with a letter or digit. Sellers who do not keep SKUs get one cut from the title so the field is
 * never the reason a listing is not finished.
 */
function suggestSku(title: string, index: number): string {
  const base = title
    .toUpperCase()
    .replace(/[^A-Z0-9]+/g, '')
    .slice(0, 8);
  const pad = base.length >= 4 ? base : `${base}ITEM`.slice(0, 4);
  return `${pad}-${String(index + 1).padStart(2, '0')}`.slice(0, 49);
}

function blankVariant(title: string, index: number): VariantDraft {
  return {
    id: nextKey(),
    name: index === 0 ? 'Default' : '',
    sku: suggestSku(title || 'item', index),
    price: '',
    compareAt: '',
    cost: '',
    stock: '0',
    weightGrams: '',
    maxPerOrder: '',
    attributes: [],
  };
}

/**
 * `POST /api/seller/products`
 *
 * One form writes the listing, its options and its photos in a single request because they cannot
 * be saved apart: a product with prices but no stock row is a listing that oversells, and a
 * seller who loses a half-filled form on a 3G drop is a seller who does not come back.
 *
 * Photos are uploaded to Cloudinary as they are picked — the listing only commits the URLs it
 * already owns, so a failed save never leaves the platform storing images nobody has.
 */
export function ProductForm({
  shopId,
  currency,
  countryCode,
  categories,
  kycApproved,
  defaultFulfilment,
}: {
  shopId: string;
  currency: CurrencyCode;
  countryCode: 'UG' | 'KE';
  categories: SellerCategoryOption[];
  kycApproved: boolean;
  defaultFulfilment: string;
}) {
  const router = useRouter();
  const toast = useToast();
  const fileInput = useRef<HTMLInputElement>(null);

  const [title, setTitle] = useState('');
  const [subtitle, setSubtitle] = useState('');
  const [description, setDescription] = useState('');
  const [brand, setBrand] = useState('');
  const [condition, setCondition] = useState('NEW');
  const [fulfilmentType, setFulfilmentType] = useState(defaultFulfilment);
  const [isDigital, setIsDigital] = useState(defaultFulfilment === 'DIGITAL');
  const [warrantyText, setWarrantyText] = useState('');
  const [weightGrams, setWeightGrams] = useState('');
  const [categoryIds, setCategoryIds] = useState<string[]>([]);
  const [primaryCategoryId, setPrimaryCategoryId] = useState('');
  const [variants, setVariants] = useState<VariantDraft[]>(() => [blankVariant('', 0)]);
  const [photos, setPhotos] = useState<Photo[]>([]);
  const [uploading, setUploading] = useState(false);
  const [uploadError, setUploadError] = useState<string | null>(null);
  const [busy, setBusy] = useState<'draft' | 'publish' | null>(null);
  const [issues, setIssues] = useState<Record<string, string>>({});

  const region = REGIONS[countryCode];

  const selected = useMemo(
    () => categoryIds.map((id) => categories.find((category) => category.id === id)).filter(Boolean) as SellerCategoryOption[],
    [categoryIds, categories],
  );

  const primaryCategory = selected.find((category) => category.id === primaryCategoryId) ?? selected[0] ?? null;

  const pricedPreview = useMemo(() => {
    const prices = variants
      .map((variant) => {
        const major = priceInput(variant.price);
        return major === null ? null : toMinor(major, currency);
      })
      .filter((value): value is number => value !== null);
    if (prices.length === 0) return null;
    return money(Math.min(...prices), currency);
  }, [variants, currency]);

  function toggleCategory(id: string, listable: boolean) {
    if (!listable) return;
    setIssues((current) => ({ ...current, categoryIds: '' }));
    setCategoryIds((current) => {
      if (current.includes(id)) {
        const nextIds = current.filter((candidate) => candidate !== id);
        if (primaryCategoryId === id) setPrimaryCategoryId(nextIds[0] ?? '');
        return nextIds;
      }
      if (current.length >= 5) return current;
      return [...current, id];
    });
  }

  function updateVariant(id: string, patch: Partial<VariantDraft>) {
    setVariants((current) => current.map((variant) => (variant.id === id ? { ...variant, ...patch } : variant)));
  }

  function addVariant() {
    setVariants((current) => (current.length >= 60 ? current : [...current, blankVariant(title, current.length)]));
  }

  function removeVariant(id: string) {
    setVariants((current) => (current.length === 1 ? current : current.filter((variant) => variant.id !== id)));
  }

  function addAttribute(variantId: string) {
    setVariants((current) =>
      current.map((variant) =>
        variant.id === variantId && variant.attributes.length < 8
          ? { ...variant, attributes: [...variant.attributes, { id: nextKey(), name: '', value: '' }] }
          : variant,
      ),
    );
  }

  function changeAttribute(variantId: string, attributeId: string, patch: Partial<AttributePair>) {
    setVariants((current) =>
      current.map((variant) =>
        variant.id === variantId
          ? {
              ...variant,
              attributes: variant.attributes.map((attribute) =>
                attribute.id === attributeId ? { ...attribute, ...patch } : attribute,
              ),
            }
          : variant,
      ),
    );
  }

  function removeAttribute(variantId: string, attributeId: string) {
    setVariants((current) =>
      current.map((variant) =>
        variant.id === variantId
          ? { ...variant, attributes: variant.attributes.filter((attribute) => attribute.id !== attributeId) }
          : variant,
      ),
    );
  }

  async function pickPhotos(files: FileList | null) {
    if (!files || files.length === 0) return;
    const room = MAX_PHOTOS - photos.length;
    if (room <= 0) {
      setUploadError(`A listing carries at most ${MAX_PHOTOS} photos.`);
      return;
    }

    setUploadError(null);
    setUploading(true);
    const accepted: Photo[] = [];
    for (const file of Array.from(files).slice(0, room)) {
      try {
        const asset = await uploadMedia(file, { target: 'product', shopId });
        accepted.push({ url: asset.url, publicId: asset.publicId, altText: '' });
      } catch (failure) {
        setUploadError(failure instanceof ApiFailure ? failure.message : `Could not upload ${file.name}`);
        break;
      }
    }
    if (accepted.length > 0) setPhotos((current) => [...current, ...accepted]);
    setUploading(false);
    if (fileInput.current) fileInput.current.value = '';
  }

  function makeCover(index: number) {
    setPhotos((current) => {
      const next = [...current];
      const [chosen] = next.splice(index, 1);
      return chosen ? [chosen, ...next] : current;
    });
  }

  function buildBody(publish: boolean) {
    const errors: Record<string, string> = {};
    if (!title.trim()) errors.title = 'Give the item a title buyers can search for';
    if (description.trim().length < 30) errors.description = 'Describe the item in at least 30 characters';
    if (categoryIds.length === 0) errors.categoryIds = 'Pick at least one category';

    const variantPayload = variants.map((variant) => {
      const major = priceInput(variant.price);
      const compareMajor = priceInput(variant.compareAt);
      const costMajor = priceInput(variant.cost);
      const attributes: Record<string, string> = {};
      for (const attribute of variant.attributes) {
        const name = attribute.name.trim();
        const value = attribute.value.trim();
        if (name && value) attributes[name] = value;
      }
      return {
        name: variant.name.trim(),
        sku: variant.sku.trim().toUpperCase(),
        attributes,
        priceMinor: major === null ? 0 : toMinor(major, currency),
        compareAtPriceMinor: compareMajor === null ? undefined : toMinor(compareMajor, currency),
        costPriceMinor: costMajor === null ? undefined : toMinor(costMajor, currency),
        stockQuantity: wholeInput(variant.stock) ?? 0,
        weightGrams: wholeInput(variant.weightGrams),
        maxQuantityPerOrder: wholeInput(variant.maxPerOrder),
      };
    });

    variants.forEach((variant, index) => {
      const path = `variants.${index}`;
      if (!variant.name.trim()) errors[path] = `Option ${index + 1} needs a name — buyers choose by it`;
      if (!variant.sku.trim()) errors[`${path}.sku`] = `Option ${index + 1} needs a stock code`;
      if (priceInput(variant.price) === null) errors[`${path}.price`] = `Option ${index + 1} needs a price above zero`;
    });

    if (variantPayload.some((variant) => variant.compareAtPriceMinor !== undefined && variant.compareAtPriceMinor <= variant.priceMinor)) {
      errors['variants.0.compareAt'] = 'A compare-at price must be higher than the selling price';
    }
    if (publish && !variantPayload.some((variant) => variant.stockQuantity > 0)) {
      errors.stock = 'At least one option needs stock before publishing';
    }

    setIssues(errors);
    if (Object.keys(errors).length > 0) return null;

    return {
      title: title.trim(),
      subtitle: subtitle.trim() || undefined,
      description: description.trim(),
      brand: brand.trim() || undefined,
      condition,
      categoryIds,
      primaryCategoryId: primaryCategory?.id,
      fulfilmentType: isDigital ? 'DIGITAL' : fulfilmentType,
      warrantyText: warrantyText.trim() || undefined,
      isDigital,
      weightGrams: wholeInput(weightGrams) ?? undefined,
      publish,
      currency,
      variants: variantPayload,
      images: photos.map((photo, index) => ({
        url: photo.url,
        publicId: photo.publicId,
        altText: photo.altText.trim() || undefined,
        position: index,
      })),
    };
  }

  async function submit(publish: boolean) {
    const body = buildBody(publish);
    if (!body) {
      toast.push('Some details are still missing', 'error');
      return;
    }

    setBusy(publish ? 'publish' : 'draft');
    setIssues({});
    try {
      const result = await api.post<{
        product: { id: string; slug: string; status: string };
        status: string;
        moderationRequired: boolean;
      }>('/api/seller/products', body);

      toast.push(
        result.moderationRequired
          ? 'Saved and sent to the review team. It goes live once they approve it.'
          : publish
            ? 'Live — buyers can order this now.'
            : 'Saved as a draft. Only you can see it.',
        'success',
      );
      router.push(`/seller/products/${result.product.id}`);
    } catch (failure) {
      if (failure instanceof ApiFailure) {
        setIssues(failure.issues);
        toast.push(failure.message, 'error');
      } else {
        toast.push('Could not save the listing — check your connection and try again', 'error');
      }
      setBusy(null);
    }
  }

  const lockedCount = categories.filter((category) => !category.listable).length;

  return (
    <form
      className="space-y-5"
      onSubmit={(event) => {
        event.preventDefault();
        void submit(false);
      }}
    >
      <section className="card space-y-4 p-5">
        <h2 className="text-sm font-semibold uppercase tracking-wide text-ink-500">What you are selling</h2>
        <TextField
          label="Item title"
          value={title}
          onChange={(event) => setTitle(event.target.value)}
          required
          maxLength={140}
          placeholder="Tecno Camon 30 256GB 8RAM"
          error={issues.title}
          hint="Brand, model and the size or capacity a buyer searches for."
        />
        <TextField
          label="One line under the title"
          value={subtitle}
          onChange={(event) => setSubtitle(event.target.value)}
          maxLength={160}
          placeholder="New box, 12 months shop warranty"
          error={issues.subtitle}
        />
        <TextAreaField
          label="Description"
          value={description}
          onChange={(event) => setDescription(event.target.value)}
          required
          rows={6}
          maxLength={20000}
          placeholder={
            'What is in the box, what it is not, and what happens when it does not suit. Sellers who write this get fewer returns.'
          }
          error={issues.description}
          hint={`${description.trim().length} characters — 30 is the minimum.`}
        />
        <div className="grid gap-4 sm:grid-cols-3">
          <TextField
            label="Brand"
            value={brand}
            onChange={(event) => setBrand(event.target.value)}
            maxLength={80}
            placeholder="Tecno"
            error={issues.brand}
          />
          <SelectField label="Condition" value={condition} onChange={(event) => setCondition(event.target.value)} options={CONDITIONS} error={issues.condition} />
          <TextField
            label="Warranty note"
            value={warrantyText}
            onChange={(event) => setWarrantyText(event.target.value)}
            maxLength={200}
            placeholder="12 months on the screen only"
            error={issues.warrantyText}
          />
        </div>
      </section>

      <section className="card space-y-4 p-5">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <h2 className="text-sm font-semibold uppercase tracking-wide text-ink-500">Category</h2>
          <p className="text-xs text-ink-500">Up to 5 · the main one sets your commission</p>
        </div>
        {issues.categoryIds && (
          <p role="alert" className="text-sm text-clay-700">
            {issues.categoryIds}
          </p>
        )}
        <div className="max-h-72 overflow-y-auto rounded-card border border-ink-200 p-2">
          <ul className="space-y-0.5">
            {categories.map((category) => {
              const checked = categoryIds.includes(category.id);
              return (
                <li key={category.id} style={{ paddingLeft: `${category.depth * 14}px` }}>
                  <label
                    className={`flex items-center gap-2 rounded px-1.5 py-1 text-sm ${
                      category.listable ? 'cursor-pointer hover:bg-ink-50 text-ink-800' : 'cursor-not-allowed text-ink-400'
                    }`}
                  >
                    <input
                      type="checkbox"
                      className="size-4 rounded border-ink-300 text-bemz-600 focus:ring-bemz-500"
                      checked={checked}
                      disabled={!category.listable}
                      onChange={() => toggleCategory(category.id, category.listable)}
                    />
                    <span className="min-w-0 flex-1 truncate">{category.name}</span>
                    {!category.listable && (
                      <span className="shrink-0 text-xs text-amber-700">needs your national ID</span>
                    )}
                    {category.listable && (
                      <span className="tabular shrink-0 text-xs text-ink-400">{(category.commissionRateBps / 100).toFixed(0)}%</span>
                    )}
                  </label>
                </li>
              );
            })}
          </ul>
        </div>
        {lockedCount > 0 && (
          <p className="text-xs text-ink-500">
            {lockedCount} {lockedCount === 1 ? 'category is' : 'categories are'} closed until your ID
            documents are approved.{' '}
            <a href="/seller/shop" className="font-medium text-bemz-700 hover:underline">
              Upload them
            </a>
            .
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
        <p className="text-xs text-ink-600">
          Commission on <span className="font-medium">{primaryCategory?.name ?? 'your category'}</span>:{' '}
          <span className="tabular">{((primaryCategory?.commissionRateBps ?? 0) / 100).toFixed(2).replace(/\.00$/, '')}%</span> of the item
          price on each delivered order.
        </p>
      </section>

      <section className="card space-y-4 p-5">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <h2 className="text-sm font-semibold uppercase tracking-wide text-ink-500">Photos</h2>
          <p className="text-xs text-ink-500">
            {photos.length}/{MAX_PHOTOS} · first photo is the one buyers see in search
          </p>
        </div>

        <input
          ref={fileInput}
          type="file"
          accept="image/jpeg,image/png,image/webp"
          multiple
          className="sr-only"
          onChange={(event) => void pickPhotos(event.target.files)}
        />
        <div className="flex flex-wrap gap-2">
          <Button type="button" variant="outline" size="sm" loading={uploading} onClick={() => fileInput.current?.click()}>
            {uploading ? 'Uploading…' : 'Add photos'}
          </Button>
          {photos.length > 0 && <Button type="button" variant="ghost" size="sm" onClick={() => fileInput.current?.click()}>Add more</Button>}
        </div>
        {uploadError && (
          <p role="alert" className="text-sm text-clay-700">
            {uploadError}
          </p>
        )}

        {photos.length === 0 ? (
          <p className="rounded-card bg-ink-50 px-3 py-4 text-center text-sm text-ink-500">
            No photos yet. A listing with a clear front photo and one of the packaging sells; one
            with a stock image does not.
          </p>
        ) : (
          <ul className="grid grid-cols-2 gap-3 sm:grid-cols-4">
            {photos.map((photo, index) => (
              <li key={photo.publicId} className="space-y-1.5">
                <div className="relative aspect-square overflow-hidden rounded-card bg-ink-100">
                  {/* eslint-disable-next-line @next/next/no-img-element */}
                  <img src={photo.url} alt={photo.altText || `${title || 'listing'} photo ${index + 1}`} className="size-full object-contain" loading="lazy" />
                  {index === 0 && (
                    <span className="absolute left-1 top-1 rounded bg-bemz-600 px-1.5 py-0.5 text-[10px] font-semibold text-white">
                      Cover
                    </span>
                  )}
                </div>
                <div className="flex gap-1">
                  {index > 0 && (
                    <Button type="button" variant="ghost" size="sm" className="h-7 px-2 text-xs" onClick={() => makeCover(index)}>
                      Make cover
                    </Button>
                  )}
                  <Button
                    type="button"
                    variant="ghost"
                    size="sm"
                    className="h-7 px-2 text-xs text-clay-700"
                    onClick={() => setPhotos((current) => current.filter((_, position) => position !== index))}
                  >
                    Remove
                  </Button>
                </div>
                <input
                  value={photo.altText}
                  onChange={(event) =>
                    setPhotos((current) =>
                      current.map((candidate, position) =>
                        position === index ? { ...candidate, altText: event.target.value } : candidate,
                      ),
                    )
                  }
                  maxLength={140}
                  placeholder="Describe the photo"
                  aria-label={`Caption for photo ${index + 1}`}
                  className="field-input h-9 text-xs"
                />
              </li>
            ))}
          </ul>
        )}
      </section>

      <section className="card space-y-4 p-5">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <h2 className="text-sm font-semibold uppercase tracking-wide text-ink-500">Options, prices and stock</h2>
          {pricedPreview && <p className="text-xs text-ink-600">Buyers see “from {pricedPreview}”</p>}
        </div>
        <p className="text-xs text-ink-500">
          Prices are in {region.currency} ({region.currencyLabel}) because the shop is in{' '}
          {region.name}. Enter whole {region.currency} — a phone priced at 400,000 is typed as 400000.
        </p>
        {issues.stock && (
          <p role="alert" className="text-sm font-medium text-clay-700">
            {issues.stock}
          </p>
        )}

        <div className="space-y-4">
          {variants.map((variant, index) => (
            <div key={variant.id} className="rounded-card border border-ink-200 p-4">
              <div className="mb-3 flex flex-wrap items-center justify-between gap-2">
                <h3 className="text-sm font-semibold text-ink-900">Option {index + 1}</h3>
                <div className="flex gap-1">
                  {index === 0 && <span className="rounded bg-bemz-100 px-2 py-0.5 text-xs font-medium text-bemz-800">Cheapest shown first</span>}
                  {variants.length > 1 && (
                    <Button type="button" variant="ghost" size="sm" className="h-7 px-2 text-xs" onClick={() => removeVariant(variant.id)}>
                      Remove
                    </Button>
                  )}
                </div>
              </div>

              <div className="grid gap-3 sm:grid-cols-2">
                <TextField
                  label="What the buyer chooses"
                  value={variant.name}
                  onChange={(event) => updateVariant(variant.id, { name: event.target.value })}
                  maxLength={80}
                  required
                  placeholder={index === 0 ? '256GB / Black' : 'Blue'}
                  error={issues[`variants.${index}`] ?? issues[`variants.${index}.name`]}
                />
                <TextField
                  label="Stock code (SKU)"
                  value={variant.sku}
                  onChange={(event) => updateVariant(variant.id, { sku: event.target.value.toUpperCase() })}
                  maxLength={49}
                  required
                  placeholder="TECNO30-01"
                  error={issues[`variants.${index}.sku`]}
                  hint="4-49 letters, numbers and dashes. Yours may repeat across shops."
                />
                <TextField
                  label={`Price (${region.currency})`}
                  value={variant.price}
                  onChange={(event) => updateVariant(variant.id, { price: event.target.value })}
                  inputMode="numeric"
                  required
                  placeholder="400000"
                  leading={<span>{region.currency}</span>}
                  error={issues[`variants.${index}.price`]}
                  trailing={
                    priceInput(variant.price) === null ? undefined : (
                      <span className="tabular">{money(toMinor(priceInput(variant.price)!, currency), currency)}</span>
                    )
                  }
                />
                <TextField
                  label="“Was” price (optional)"
                  value={variant.compareAt}
                  onChange={(event) => updateVariant(variant.id, { compareAt: event.target.value })}
                  inputMode="numeric"
                  placeholder="450000"
                  error={issues['variants.0.compareAt']}
                  hint="Only if a buyer genuinely paid that recently."
                />
                <TextField
                  label="Stock on the shelf (units)"
                  value={variant.stock}
                  onChange={(event) => updateVariant(variant.id, { stock: event.target.value })}
                  inputMode="numeric"
                  required
                  placeholder="12"
                  error={issues[`variants.${index}.stock`]}
                  hint="Type what is physically there. Later changes go through the stock ledger."
                />
                <TextField
                  label="What you paid for it (optional)"
                  value={variant.cost}
                  onChange={(event) => updateVariant(variant.id, { cost: event.target.value })}
                  inputMode="numeric"
                  placeholder="320000"
                  hint="Never shown to buyers. Used only for your own margin."
                />
                <TextField
                  label="Weight in grams (optional)"
                  value={variant.weightGrams}
                  onChange={(event) => updateVariant(variant.id, { weightGrams: event.target.value })}
                  inputMode="numeric"
                  placeholder="350"
                  hint="Heavier parcels cost more to deliver."
                />
                <TextField
                  label="Max per order (optional)"
                  value={variant.maxPerOrder}
                  onChange={(event) => updateVariant(variant.id, { maxPerOrder: event.target.value })}
                  inputMode="numeric"
                  placeholder="2"
                  hint="Use it when you only have a few units."
                />
              </div>

              <div className="mt-3">
                <div className="flex flex-wrap items-center justify-between gap-2">
                  <p className="text-xs font-medium text-ink-700">Choice details (colour, size, storage)</p>
                  <Button type="button" variant="ghost" size="sm" className="h-7 px-2 text-xs" onClick={() => addAttribute(variant.id)}>
                    Add detail
                  </Button>
                </div>
                {variant.attributes.length === 0 ? (
                  <p className="mt-1 text-xs text-ink-500">
                    Details are what a buyer filters by. One option needs none.
                  </p>
                ) : (
                  <ul className="mt-2 space-y-2">
                    {variant.attributes.map((attribute) => (
                      <li key={attribute.id} className="flex flex-wrap items-end gap-2">
                        <input
                          value={attribute.name}
                          onChange={(event) => changeAttribute(variant.id, attribute.id, { name: event.target.value })}
                          maxLength={40}
                          placeholder="Colour"
                          aria-label="Detail name"
                          className="field-input h-9 flex-1 text-sm"
                        />
                        <input
                          value={attribute.value}
                          onChange={(event) => changeAttribute(variant.id, attribute.id, { value: event.target.value })}
                          maxLength={60}
                          placeholder="Black"
                          aria-label="Detail value"
                          className="field-input h-9 flex-1 text-sm"
                        />
                        <Button
                          type="button"
                          variant="ghost"
                          size="sm"
                          className="h-9 px-2 text-xs text-clay-700"
                          onClick={() => removeAttribute(variant.id, attribute.id)}
                        >
                          Remove
                        </Button>
                      </li>
                    ))}
                  </ul>
                )}
              </div>
            </div>
          ))}
        </div>

        <div className="flex flex-wrap items-center gap-3">
          <Button type="button" variant="outline" size="sm" onClick={addVariant} disabled={variants.length >= 60}>
            Add another option
          </Button>
          <p className="text-xs text-ink-500">
            {variants.length} option{variants.length === 1 ? '' : 's'} · a listing needs at least one
          </p>
        </div>
      </section>

      <section className="card space-y-4 p-5">
        <h2 className="text-sm font-semibold uppercase tracking-wide text-ink-500">Delivery</h2>
        <div className="grid gap-4 sm:grid-cols-2">
          <SelectField
            label="How this item travels"
            value={isDigital ? 'DIGITAL' : fulfilmentType}
            onChange={(event) => setFulfilmentType(event.target.value)}
            options={FULFILMENT}
            disabled={isDigital}
            error={issues.fulfilmentType}
            hint="New listings start with your shop default and can be changed per item."
          />
          <TextField
            label="Parcel weight in grams (optional)"
            value={weightGrams}
            onChange={(event) => setWeightGrams(event.target.value)}
            inputMode="numeric"
            disabled={isDigital}
            placeholder="350"
            error={issues.weightGrams}
          />
        </div>
        <CheckboxField
          label="This is a digital item"
          description="Airtime, vouchers, e-books. Nothing is carried, so no delivery fee is quoted."
          checked={isDigital}
          onChange={(event) => {
            setIsDigital(event.target.checked);
            if (event.target.checked) setFulfilmentType('DIGITAL');
          }}
        />
      </section>

      <div className="card flex flex-wrap items-center justify-between gap-3 p-5">
        <div className="space-y-1">
          <p className="text-sm font-medium text-ink-900">Save or publish</p>
          <p className="text-xs text-ink-500">
            {kycApproved
              ? 'Publishing goes live at once unless the category needs a second look.'
              : 'Publishing sends it to the review team first. Drafts stay private until you do.'}
          </p>
        </div>
        <div className="flex flex-wrap gap-2">
          <Button type="submit" variant="outline" loading={busy === 'draft'} disabled={busy !== null}>
            Save as draft
          </Button>
          <Button type="button" loading={busy === 'publish'} disabled={busy !== null} onClick={() => void submit(true)}>
            Publish this listing
          </Button>
        </div>
      </div>

    </form>
  );
}
