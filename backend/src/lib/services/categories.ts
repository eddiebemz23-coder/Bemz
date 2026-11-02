import 'server-only';
import { Prisma, prisma, type CurrencyCode } from '../prisma';
import { notFound, unprocessable } from '../http';
import type { categoryTreeQuerySchema } from '../validation/catalog';
import type { z } from 'zod';

/**
 * The category spine of the storefront.
 *
 * `Category.path` is a materialised slug trail ("electronics/phones/smartphones"), which is
 * what lets a category page include everything listed anywhere beneath it in a single
 * indexed prefix query instead of a recursive walk. Listings carry several categories, so
 * counting and filtering always go through `ProductCategory`.
 */

/** A product a buyer can purchase right now, from a shop that is actually open. */
const PURCHASABLE = {
  status: 'ACTIVE',
  deletedAt: null,
  shop: { deletedAt: null, status: 'ACTIVE', vacationMode: false },
} satisfies Prisma.ProductWhereInput;

function inSubtree(path: string): Prisma.ProductWhereInput {
  return { ...PURCHASABLE, categories: { some: { category: { path: { startsWith: path } } } } };
}

const categoryNodeSelect = {
  id: true,
  name: true,
  slug: true,
  path: true,
  depth: true,
  imageUrl: true,
  icon: true,
  description: true,
  requiresKyc: true,
  isActive: true,
  commissionRateBps: true,
  sortOrder: true,
  _count: { select: { children: true } },
} satisfies Prisma.CategorySelect;

/**
 * `GET /api/categories`
 *
 * With no `parentId` this returns the top-level departments behind the header nav; pass a
 * category id or slug to walk one level down. A parent's count includes everything below it,
 * because that is the number a buyer sees when they tap the department.
 */
export async function categoryTree(query: z.infer<typeof categoryTreeQuerySchema>) {
  let parentId: string | null = null;
  if (query.parentId) {
    const parent = await prisma.category.findFirst({
      where: { OR: [{ id: query.parentId }, { slug: query.parentId }] },
      select: { id: true, path: true },
    });
    if (!parent) throw notFound('That category does not exist');
    parentId = parent.id;
  }

  const rows = await prisma.category.findMany({
    where: { parentId, ...(query.includeInactive === 'true' ? {} : { isActive: true }) },
    select: categoryNodeSelect,
    orderBy: [{ sortOrder: 'asc' }, { name: 'asc' }],
  });

  const productCounts = await Promise.all(rows.map((row) => prisma.product.count({ where: inSubtree(row.path) })));

  return rows.map((row, index) => ({
    id: row.id,
    name: row.name,
    slug: row.slug,
    path: row.path,
    depth: row.depth,
    imageUrl: row.imageUrl,
    icon: row.icon,
    description: row.description,
    requiresKyc: row.requiresKyc,
    // Read by the admin category screen; buyers never see a hidden department, so adding the
    // field is harmless to them and the editor cannot guess what it is switching.
    isActive: row.isActive,
    commissionRateBps: row.commissionRateBps,
    sortOrder: row.sortOrder,
    hasChildren: row._count.children > 0,
    productCount: productCounts[index] ?? 0,
  }));
}

/**
 * `GET /api/categories/[slug]`
 *
 * The category landing page: where you are, what sits below, and the filter facets that make
 * a listing grid usable — brands, price band per currency, condition, and the attributes
 * sellers actually filled in.
 */
export async function categoryLanding(slug: string) {
  const category = await prisma.category.findUnique({
    where: { slug },
    include: {
      parent: { select: { name: true, slug: true, path: true } },
      children: {
        where: { isActive: true },
        orderBy: [{ sortOrder: 'asc' }, { name: 'asc' }],
        select: { id: true, name: true, slug: true, imageUrl: true, icon: true, _count: { select: { children: true } } },
      },
    },
  });
  if (!category) throw notFound('That category does not exist');

  const base = inSubtree(category.path);

  const [total, brands, conditions, priceBands, attributeFacets, topSellers] = await Promise.all([
    prisma.product.count({ where: base }),
    prisma.product.groupBy({
      by: ['brand'],
      where: { ...base, brand: { not: null } },
      _count: { _all: true },
      orderBy: { _count: { brand: 'desc' } },
      take: 20,
    }),
    prisma.product.groupBy({
      by: ['condition'],
      where: base,
      _count: { _all: true },
      orderBy: { _count: { condition: 'desc' } },
    }),
    // Prices are only comparable within a currency, so the band is per currency.
    prisma.product.groupBy({
      by: ['currency'],
      where: base,
      _min: { startingPriceMinor: true },
      _max: { startingPriceMinor: true },
      _count: { _all: true },
    }),
    prisma.productAttribute.groupBy({
      by: ['name'],
      where: { product: base },
      _count: { _all: true },
      orderBy: { _count: { name: 'desc' } },
      take: 12,
    }),
    prisma.product.groupBy({
      by: ['shopId'],
      where: base,
      _count: { _all: true },
      orderBy: { _count: { shopId: 'desc' } },
      take: 6,
    }),
  ]);

  // The values behind each attribute name are only worth fetching once the names are known.
  const attributes = await Promise.all(
    attributeFacets.map(async (facet) => {
      const values = await prisma.productAttribute.groupBy({
        by: ['value'],
        where: { name: facet.name, product: base },
        _count: { _all: true },
        orderBy: { _count: { value: 'desc' } },
        take: 15,
      });
      return { name: facet.name, options: values.map((row) => ({ value: row.value, count: row._count._all })) };
    }),
  );

  const shops = await prisma.shop.findMany({
    where: { id: { in: topSellers.map((row) => row.shopId) }, deletedAt: null },
    select: { id: true, name: true, slug: true, logoUrl: true, ratingAvg: true, isVerified: true },
  });

  // The materialised path already carries the ancestors, so no parent-chain walk is needed.
  const ancestorPaths = category.path.split('/').slice(0, -1).map((_, index) =>
    category.path.split('/').slice(0, index + 1).join('/'),
  );
  const ancestors =
    ancestorPaths.length > 0
      ? await prisma.category.findMany({
          where: { path: { in: ancestorPaths } },
          select: { name: true, slug: true },
          orderBy: { depth: 'asc' },
        })
      : [];

  return {
    category: {
      id: category.id,
      name: category.name,
      slug: category.slug,
      path: category.path,
      description: category.description,
      imageUrl: category.imageUrl,
      requiresKyc: category.requiresKyc,
      commissionRateBps: category.commissionRateBps,
    },
    breadcrumb: [...ancestors, { name: category.name, slug: category.slug }],
    children: category.children.map((child) => ({
      id: child.id,
      name: child.name,
      slug: child.slug,
      imageUrl: child.imageUrl,
      icon: child.icon,
      hasChildren: child._count.children > 0,
    })),
    facets: {
      totalProducts: total,
      priceBands: priceBands
        .filter((band) => band.currency !== null && band._min.startingPriceMinor !== null)
        .map((band) => ({
          currency: band.currency as CurrencyCode,
          minMinor: band._min.startingPriceMinor as number,
          maxMinor: band._max.startingPriceMinor ?? 0,
          count: band._count._all,
        })),
      brands: brands
        .filter((row) => row.brand !== null)
        .map((row) => ({ brand: row.brand as string, count: row._count._all })),
      conditions: conditions.map((row) => ({ condition: row.condition, count: row._count._all })),
      attributes: attributes.filter((facet) => facet.options.length > 0),
    },
    topShops: topSellers
      .map((row) => {
        const shop = shops.find((candidate) => candidate.id === row.shopId);
        return shop
          ? { ...shop, ratingAvg: shop.ratingAvg === null ? null : Number(shop.ratingAvg), productCount: row._count._all }
          : null;
      })
      .filter((row): row is NonNullable<typeof row> => row !== null),
  };
}

/**
 * `PATCH /api/admin/categories/[id]`
 *
 * Renaming or reparenting rewrites the path of the whole subtree: every category page,
 * filter and KYC gate reads `path`, so a stale prefix silently drops listings off a page.
 */
export async function updateCategory(
  categoryId: string,
  patch: {
    name?: string;
    isActive?: boolean;
    commissionRateBps?: number;
    requiresKyc?: boolean;
    sortOrder?: number;
    imageUrl?: string | null;
    icon?: string | null;
    description?: string | null;
    parentId?: string | null;
  },
  actorId: string,
) {
  const category = await prisma.category.findUnique({
    where: { id: categoryId },
    include: { children: { select: { id: true, slug: true } } },
  });
  if (!category) throw notFound('Category not found');

  if (patch.parentId !== undefined && patch.parentId !== null) {
    if (patch.parentId === categoryId) throw unprocessable('A category cannot contain itself');
    const parent = await prisma.category.findUnique({ where: { id: patch.parentId }, select: { id: true, path: true } });
    if (!parent) throw unprocessable('The new parent category does not exist');
    // Moving a department inside its own subtree would orphan everything below it.
    if (parent.path === category.path || parent.path.startsWith(`${category.path}/`)) {
      throw unprocessable('You cannot move a category inside itself');
    }
  }

  const nextSlug = patch.name?.trim().toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '');
  const slugChanged = nextSlug !== undefined && nextSlug !== category.slug;

  const data: Prisma.CategoryUpdateInput = {};
  if (patch.name !== undefined) data.name = patch.name;
  if (patch.isActive !== undefined) data.isActive = patch.isActive;
  if (patch.commissionRateBps !== undefined) data.commissionRateBps = patch.commissionRateBps;
  if (patch.requiresKyc !== undefined) data.requiresKyc = patch.requiresKyc;
  if (patch.sortOrder !== undefined) data.sortOrder = patch.sortOrder;
  if (patch.imageUrl !== undefined) data.imageUrl = patch.imageUrl;
  if (patch.icon !== undefined) data.icon = patch.icon;
  if (patch.description !== undefined) data.description = patch.description;
  if (patch.parentId !== undefined) data.parent = patch.parentId ? { connect: { id: patch.parentId } } : { disconnect: true };
  if (slugChanged) data.slug = nextSlug as string;

  const updated = await prisma.$transaction(async (tx) => {
    const row = await tx.category.update({ where: { id: categoryId }, data });

    const moved = patch.parentId !== undefined && patch.parentId !== category.parentId;
    if (slugChanged || moved) {
      const parentPath = row.parentId
        ? (await tx.category.findUnique({ where: { id: row.parentId }, select: { path: true } }))?.path ?? ''
        : '';
      const newPath = parentPath ? `${parentPath}/${row.slug}` : row.slug;

      const descendants = await tx.category.findMany({
        where: { path: { startsWith: `${category.path}/` } },
        select: { id: true, path: true },
      });
      for (const descendant of descendants) {
        await tx.category.update({
          where: { id: descendant.id },
          data: { path: `${newPath}${descendant.path.slice(category.path.length)}` },
        });
      }
      if (newPath !== category.path) {
        await tx.category.update({ where: { id: categoryId }, data: { path: newPath } });
        row.path = newPath;
      }
    }

    await tx.auditLog.create({
      data: {
        actorId,
        action: 'CATEGORY_UPDATE',
        entity: 'CATEGORY',
        entityId: categoryId,
        after: {
          name: row.name,
          slug: row.slug,
          path: row.path,
          commissionRateBps: row.commissionRateBps,
          requiresKyc: row.requiresKyc,
          isActive: row.isActive,
          previous: { name: category.name, slug: category.slug, path: category.path },
        },
      },
    });

    return row;
  });

  return {
    id: updated.id,
    name: updated.name,
    slug: updated.slug,
    path: updated.path,
    commissionRateBps: updated.commissionRateBps,
    requiresKyc: updated.requiresKyc,
    isActive: updated.isActive,
  };
}

/**
 * Categories offered to a seller in the listing form, with the KYC gate already resolved —
 * so the dashboard can grey out phones and tablets before a seller writes a whole listing
 * and then hits a 403 on publish.
 */
export async function sellerCategoryOptions(shopKycApproved: boolean) {
  const rows = await prisma.category.findMany({
    where: { isActive: true },
    select: { id: true, name: true, slug: true, path: true, depth: true, requiresKyc: true, commissionRateBps: true, sortOrder: true },
    orderBy: [{ depth: 'asc' }, { sortOrder: 'asc' }, { name: 'asc' }],
  });

  return rows.map((row) => ({ ...row, listable: shopKycApproved || !row.requiresKyc }));
}

/**
 * Resolves the categories a listing submission names. `primaryCategoryId` decides which
 * category's KYC gate and commission rate apply, so it must be one of the selections.
 */
export async function resolveCategories(categoryIds: string[], primaryCategoryId?: string) {
  const unique = [...new Set(categoryIds)];
  const rows = await prisma.category.findMany({
    where: { id: { in: unique }, isActive: true },
    select: { id: true, name: true, slug: true, path: true, requiresKyc: true, commissionRateBps: true },
  });
  if (rows.length !== unique.length) {
    throw unprocessable('One of those categories does not exist or is closed to new listings');
  }

  const primary = primaryCategoryId ? rows.find((row) => row.id === primaryCategoryId) : undefined;
  if (primaryCategoryId && !primary) {
    throw unprocessable('The primary category must be one of the selected categories');
  }

  // Deepest path wins as the default primary: "smartphones" carries the real commission,
  // not the "electronics" department it hangs under.
  const byDepth = [...rows].sort((a, b) => b.path.split('/').length - a.path.split('/').length);
  return { categories: rows, primary: primary ?? byDepth[0] };
}

/** The single KYC/commission judgement a listing needs, read from the deepest category. */
export async function categoryGate(categoryId: string) {
  const category = await prisma.category.findUnique({
    where: { id: categoryId },
    select: { id: true, name: true, requiresKyc: true, commissionRateBps: true },
  });
  if (!category) throw unprocessable('That category no longer exists');
  return category;
}
