import { notFound } from 'next/navigation';
import Link from 'next/link';
import type { Metadata } from 'next';
import { ArrowLeft, Eye, Tags } from 'lucide-react';
import { sellerPage } from '@/lib/seller-page';
import { pageData } from '@/lib/page-data';
import { ApiError } from '@/lib/http';
import { getSellerProductDetail } from '@/lib/services/products';
import { sellerCategoryOptions } from '@/lib/services/categories';
import { formatDate, humanise } from '@/lib/client/format';
import type { SellerProductRow } from '@/lib/client/types';
import { Badge } from '@/components/ui/badge';
import { LinkButton } from '@/components/ui/link-button';
import { StatusPill } from '@/components/ui/status-pill';
import { ListingEditor, type ListingEditorInitial } from '@/components/seller/listing-editor';
import { VariantWorkshop, type VariantSnapshot } from '@/components/seller/variant-workshop';
import { ListingPhotos, type ListingPhotoSnapshot } from '@/components/seller/listing-photos';
import { ListingActions } from '@/components/seller/listing-actions';

export const dynamic = 'force-dynamic';

export const metadata: Metadata = { title: 'Edit listing · Bemz seller', robots: { index: false } };

interface Props {
  params: { id: string };
}

/**
 * `GET /seller/products/{id}` — the listing workshop.
 *
 * Three panels, each with its own endpoint, because the three things a seller changes about a
 * listing have three different blast radii: words are free, a price re-prices every grid and cart
 * on the next render, and a unit count is a ledger entry someone has to be able to audit later.
 */
export default async function EditProductPage({ params }: Props) {
  const { shop } = await sellerPage(`/seller/products/${params.id}`);

  const [product, categoryRows] = await Promise.all([
    pageData(getSellerProductDetail(shop, params.id).catch((error) => {
      // A listing that belongs to a different shop is a 403, and there is no page to render for
      // that — it is the same answer as a listing that does not exist.
      if (error instanceof ApiError && error.status === 403) notFound();
      throw error;
    })),
    sellerCategoryOptions(shop.kycStatus === 'APPROVED'),
  ]);

  const cover = product.images.find((image) => image.variantId === null) ?? null;

  const listing = {
    id: product.id,
    slug: product.slug,
    title: product.title,
    status: product.status,
    currency: product.currency,
    brand: product.brand,
    condition: product.condition,
    fulfilmentType: product.fulfilmentType,
    rejectionReason: product.rejectionReason,
    startingPriceMinor: product.startingPriceMinor,
    soldCount: product.soldCount,
    viewsCount: product.viewsCount,
    ratingCount: product.ratingCount,
    imageUrl: cover?.url ?? null,
    categories: product.categories.map((link) => ({
      id: link.category.id,
      name: link.category.name,
      requiresKyc: link.category.requiresKyc,
    })),
    variants: product.variants.map((variant) => ({
      id: variant.id,
      sku: variant.sku,
      name: variant.name,
      priceMinor: variant.priceMinor,
      compareAtPriceMinor: variant.compareAtPriceMinor,
      costPriceMinor: variant.costPriceMinor,
      stockQuantity: variant.stockQuantity,
      reservedQuantity: variant.reservedQuantity,
      available: Math.max(0, variant.stockQuantity - variant.reservedQuantity),
      lowStockThreshold: variant.lowStockThreshold,
      isDisabled: variant.isDisabled,
      isPrimary: variant.isPrimary,
    })),
    updatedAt: product.updatedAt,
    createdAt: product.createdAt,
  } satisfies SellerProductRow;

  const editorInitial: ListingEditorInitial = {
    id: product.id,
    title: product.title,
    subtitle: product.subtitle,
    description: product.description,
    brand: product.brand,
    condition: product.condition,
    fulfilmentType: product.fulfilmentType,
    warrantyText: product.warrantyText,
    weightGrams: product.weightGrams,
    metaTitle: product.metaTitle,
    metaDescription: product.metaDescription,
    isDigital: product.isDigital,
    categoryIds: product.categories.map((link) => link.categoryId),
    primaryCategoryId: product.categories.find((link) => link.isPrimary)?.categoryId ?? null,
  };

  const variants: VariantSnapshot[] = product.variants.map((variant) => ({
    id: variant.id,
    sku: variant.sku,
    name: variant.name,
    priceMinor: variant.priceMinor,
    compareAtPriceMinor: variant.compareAtPriceMinor,
    costPriceMinor: variant.costPriceMinor,
    stockQuantity: variant.stockQuantity,
    reservedQuantity: variant.reservedQuantity,
    available: Math.max(0, variant.stockQuantity - variant.reservedQuantity),
    weightGrams: variant.weightGrams,
    maxQuantityPerOrder: variant.maxQuantityPerOrder,
    isDisabled: variant.isDisabled,
    isPrimary: variant.isPrimary,
    movementCount: variant._count.inventoryMovements,
    attributes: (variant.attributes ?? {}) as Record<string, string>,
  }));

  const photos: ListingPhotoSnapshot[] = product.images
    .filter((image) => image.variantId === null)
    .map((image) => ({
      id: image.id,
      url: image.url,
      publicId: image.publicId,
      altText: image.altText,
      position: image.position,
      isPrimary: image.isPrimary,
    }));

  const stockOnShelf = variants.reduce((sum, variant) => sum + variant.stockQuantity, 0);
  const sellable = variants.reduce((sum, variant) => sum + variant.available, 0);

  return (
    <div className="space-y-5">
      <Link
        href="/seller/products"
        className="inline-flex items-center gap-1.5 text-sm font-medium text-ink-600 hover:text-bemz-700"
      >
        <ArrowLeft className="size-4" />
        All listings
      </Link>

      <header className="card space-y-4 p-5">
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div className="min-w-0">
            <div className="flex flex-wrap items-center gap-2">
              <StatusPill status={product.status} />
              {product.isDigital && <Badge tone="info">Digital</Badge>}
              {product.requiresModeration && <Badge tone="warning">Checked by Bemz first</Badge>}
            </div>
            <h1 className="mt-2 truncate text-xl font-bold text-ink-950">{product.title}</h1>
            <p className="mt-1 text-xs text-ink-500">
              <span className="tabular">/product/{shop.slug}/{product.slug}</span> · updated{' '}
              {formatDate(product.updatedAt, 'short')} · listed {formatDate(product.createdAt, 'short')}
            </p>
          </div>
          <div className="flex flex-col items-end gap-2">
            {product.status === 'ACTIVE' ? (
              <LinkButton href={`/product/${shop.slug}/${product.slug}`} variant="outline" size="sm">
                <Eye className="size-4" />
                See it as a buyer
              </LinkButton>
            ) : (
              <span className="text-xs text-ink-500">Not visible to buyers yet</span>
            )}
            <ListingActions listing={listing} />
          </div>
        </div>

        {product.status === 'REJECTED' && product.rejectionReason && (
          <div className="rounded-card bg-clay-50 p-3 ring-1 ring-inset ring-clay-200">
            <p className="text-sm font-medium text-clay-800">Why the review team stopped this listing</p>
            <p className="mt-1 text-sm text-clay-800">{product.rejectionReason}</p>
            <p className="mt-1 text-xs text-clay-600">
              Fix it below and press publish — it goes back to the same queue automatically.
            </p>
          </div>
        )}
        {product.status === 'PENDING_REVIEW' && (
          <p className="rounded-card bg-amber-50 px-3 py-2 text-sm text-amber-900">
            The review team is looking at this. You can keep editing; the version they see is the one that was
            submitted.
          </p>
        )}

        <dl className="grid grid-cols-2 gap-3 border-t border-ink-100 pt-4 sm:grid-cols-4">
          {[
            { term: 'Units on the shelf', value: stockOnShelf.toLocaleString() },
            { term: 'Sellable right now', value: sellable.toLocaleString() },
            { term: 'Sold', value: product.soldCount.toLocaleString() },
            { term: 'Views', value: product.viewsCount.toLocaleString() },
          ].map((cell) => (
            <div key={cell.term}>
              <dt className="text-xs text-ink-500">{cell.term}</dt>
              <dd className="tabular mt-0.5 text-sm font-semibold text-ink-900">{cell.value}</dd>
            </div>
          ))}
        </dl>
      </header>

      <ListingPhotos productId={product.id} shopId={shop.id} images={photos} />

      <VariantWorkshop productId={product.id} currency={product.currency} variants={variants} />

      <ListingEditor
        initial={editorInitial}
        categories={categoryRows}
        currency={product.currency}
        kycApproved={shop.kycStatus === 'APPROVED'}
      />

      <p className="text-xs text-ink-500">
        Deleting a listing keeps every order that already named it, so a buyer&apos;s receipt never changes.
        Status after publishing is decided by the review team: {humanise(product.status.toLowerCase())}.
      </p>

      <div className="flex items-center gap-2 text-xs text-ink-500">
        <Tags className="size-4" />
        <span>
          {variants.length} {variants.length === 1 ? 'option' : 'options'} · {photos.length} photos ·{' '}
          {product.categories.map((link) => link.category.name).join(', ') || 'no category'}
        </span>
      </div>
    </div>
  );
}
