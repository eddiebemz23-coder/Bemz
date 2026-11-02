/**
 * Database seed: geography, category tree, staff/demo accounts and a small demo catalog.
 *
 *   npm run db:seed          (idempotent — safe to re-run)
 *
 * Demo passwords are documented in README.md and are for local/dev only.
 * Catalog photos are shipped in `public/images/products` so a fresh clone looks like a real
 * store; live listings upload through the signed preset and store Cloudinary URLs. The KYC
 * documents are specimen images in `public/images/kyc`, never real identity documents.
 */

import { PrismaClient, CurrencyCode, UserRole, PayoutProvider, ProductStatus, FulfilmentType, KycStatus, KycDocumentType, ShopStatus, StockMovementReason, DiscountType, CouponScope, ReviewTargetType, ReviewStatus } from '@prisma/client';
import { hashPassword } from '../src/lib/auth/password';
import { GEO_SEED, KENYA_COUNTY_COUNT, type DistrictSeed } from './data/geo';
import { CATEGORY_SEED, type CategorySeed } from './data/categories';

const prisma = new PrismaClient();

const slugifyRegion = (name: string) =>
  name
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/(^-|-$)/g, '');

// UGX/KES minor units: multiply the everyday shilling price by 100.
const ug = (shillings: number) => shillings * 100;
const ke = (shillings: number) => shillings * 100;

async function seedGeography() {
  const zoneByCode = new Map<string, number>();
  const districtByCode = new Map<string, number>();
  const countryIdByCode = new Map<string, number>();
  const regionIdByKey = new Map<string, number>();

  for (const countrySeed of GEO_SEED) {
    const country = await prisma.country.upsert({
      where: { code: countrySeed.code },
      update: {
        name: countrySeed.name,
        currency: countrySeed.currency as CurrencyCode,
        phonePrefix: countrySeed.phonePrefix,
        taxRateBps: countrySeed.taxRateBps,
        taxLabel: countrySeed.taxLabel,
        isActive: true,
      },
      create: {
        code: countrySeed.code,
        name: countrySeed.name,
        currency: countrySeed.currency as CurrencyCode,
        phonePrefix: countrySeed.phonePrefix,
        taxRateBps: countrySeed.taxRateBps,
        taxLabel: countrySeed.taxLabel,
      },
    });
    countryIdByCode.set(country.code, country.id);

    for (const zoneSeed of countrySeed.zones) {
      const zone = await prisma.deliveryZone.upsert({
        where: { countryId_code: { countryId: country.id, code: zoneSeed.code } },
        update: {
          name: zoneSeed.name,
          baseFeeMinor: zoneSeed.baseFeeMinor,
          perKgFeeMinor: zoneSeed.perKgFeeMinor,
          freeOverMinor: zoneSeed.freeOverMinor,
          estimatedDaysMin: zoneSeed.daysMin,
          estimatedDaysMax: zoneSeed.daysMax,
          cashOnDeliveryAllowed: zoneSeed.cashOnDeliveryAllowed,
          isActive: true,
        },
        create: {
          countryId: country.id,
          code: zoneSeed.code,
          name: zoneSeed.name,
          baseFeeMinor: zoneSeed.baseFeeMinor,
          perKgFeeMinor: zoneSeed.perKgFeeMinor,
          freeOverMinor: zoneSeed.freeOverMinor,
          estimatedDaysMin: zoneSeed.daysMin,
          estimatedDaysMax: zoneSeed.daysMax,
          cashOnDeliveryAllowed: zoneSeed.cashOnDeliveryAllowed,
        },
      });
      zoneByCode.set(zone.code, zone.id);

      for (const districtSeed of zoneSeed.districts) {
        const regionKey = `${country.id}:${districtSeed.region}`;
        let regionId = regionIdByKey.get(regionKey);
        if (!regionId) {
          const region = await prisma.region.upsert({
            where: { countryId_code: { countryId: country.id, code: slugifyRegion(districtSeed.region) } },
            update: { name: districtSeed.region },
            create: {
              countryId: country.id,
              code: slugifyRegion(districtSeed.region),
              name: districtSeed.region,
            },
          });
          regionId = region.id;
          regionIdByKey.set(regionKey, region.id);
        }

        const district = await upsertDistrict(country.id, zone.id, regionId, districtSeed);
        districtByCode.set(districtKey(countrySeed.code, districtSeed.code), district.id);
      }
    }
  }

  const kenyaCount = await prisma.district.count({ where: { country: { code: 'KE' } } });
  if (kenyaCount !== KENYA_COUNTY_COUNT) {
    throw new Error(`Kenya seed invariant failed: expected ${KENYA_COUNTY_COUNT} counties, found ${kenyaCount}`);
  }

  return { countryIdByCode, zoneByCode, districtByCode };
}

const districtKey = (countryCode: string, districtCode: string) => `${countryCode}/${districtCode}`;

function upsertDistrict(
  countryId: number,
  zoneId: number,
  regionId: number,
  seed: DistrictSeed,
) {
  return prisma.district.upsert({
    where: { countryId_code: { countryId, code: seed.code } },
    update: { name: seed.name, regionId, zoneId, isMajor: seed.isMajor ?? false },
    create: {
      countryId,
      code: seed.code,
      name: seed.name,
      regionId,
      zoneId,
      isMajor: seed.isMajor ?? false,
    },
  });
}

async function seedCategories() {
  const ids = new Map<string, string>();

  const walk = async (nodes: CategorySeed[], parentId: string | null, parentPath: string, depth: number) => {
    for (const [index, node] of nodes.entries()) {
      const path = parentPath ? `${parentPath}/${node.slug}` : node.slug;
      // Every top-level department ships a tile in `public/images/categories/<slug>.jpg`;
      // subcategories inherit the department tile only through breadcrumbs, so they stay null.
      const imageUrl = parentId === null ? `/images/categories/${node.slug}.jpg` : null;
      const existing = await prisma.category.findUnique({ where: { slug: node.slug } });
      const category = existing
        ? await prisma.category.update({
            where: { id: existing.id },
            data: {
              name: node.name,
              parentId,
              path,
              depth,
              imageUrl,
              commissionRateBps: node.commissionRateBps ?? 1000,
              requiresKyc: node.requiresKyc ?? false,
              sortOrder: index,
              isActive: true,
            },
          })
        : await prisma.category.create({
            data: {
              slug: node.slug,
              name: node.name,
              parentId,
              path,
              depth,
              imageUrl,
              commissionRateBps: node.commissionRateBps ?? 1000,
              requiresKyc: node.requiresKyc ?? false,
              sortOrder: index,
            },
          });

      ids.set(node.slug, category.id);
      if (node.children) await walk(node.children, category.id, path, depth + 1);
    }
  };

  await walk(CATEGORY_SEED, null, '', 0);
  return ids;
}

async function seedAccounts(countryIdByCode: Map<string, number>, districtByCode: Map<string, number>) {
  const [adminPassword, demoPassword] = await Promise.all([
    hashPassword('BemzAdmin!2026'),
    hashPassword('BemzDemo!2026'),
  ]);

  const admin = await prisma.user.upsert({
    where: { phone: '+256700000001' },
    update: { role: UserRole.ADMIN, status: 'ACTIVE' },
    create: {
      name: 'Bemz Operations',
      email: 'ops@bemz.co.ug',
      emailVerified: new Date(),
      phone: '+256700000001',
      phoneVerified: new Date(),
      passwordHash: adminPassword,
      role: UserRole.ADMIN,
      countryId: countryIdByCode.get('UG'),
      preferredCurrency: 'UGX',
    },
  });

  const kampalaSeller = await prisma.user.upsert({
    where: { phone: '+256700000002' },
    update: { role: UserRole.SELLER },
    create: {
      name: 'Nakato Aisha',
      email: 'aisha@electrohub.co.ug',
      emailVerified: new Date(),
      phone: '+256700000002',
      phoneVerified: new Date(),
      passwordHash: demoPassword,
      role: UserRole.SELLER,
      countryId: countryIdByCode.get('UG'),
      preferredCurrency: 'UGX',
    },
  });

  const nairobiSeller = await prisma.user.upsert({
    where: { phone: '+254700000003' },
    update: { role: UserRole.SELLER },
    create: {
      name: 'Kevin Otieno',
      email: 'kevin@mitumbafashion.co.ke',
      emailVerified: new Date(),
      phone: '+254700000003',
      phoneVerified: new Date(),
      passwordHash: demoPassword,
      role: UserRole.SELLER,
      countryId: countryIdByCode.get('KE'),
      preferredCurrency: 'KES',
    },
  });

  const buyer = await prisma.user.upsert({
    where: { phone: '+256700000009' },
    update: {},
    create: {
      name: 'Brian Kato',
      phone: '+256700000009',
      phoneVerified: new Date(),
      role: UserRole.BUYER,
      countryId: countryIdByCode.get('UG'),
      preferredCurrency: 'UGX',
      whatsappOptIn: true,
    },
  });

  await prisma.shippingAddress.upsert({
    where: { id: 'addr-demo-brian-kampala' },
    update: {},
    create: {
      id: 'addr-demo-brian-kampala',
      userId: buyer.id,
      label: 'Home',
      recipientName: buyer.name ?? 'Brian Kato',
      recipientPhone: buyer.phone ?? '+256700000009',
      countryId: countryIdByCode.get('UG')!,
      districtId: districtByCode.get(districtKey('UG', 'KLA'))!,
      subcounty: 'Kabowa',
      parish: 'Kisekka',
      village: 'Nkufulu',
      nearestLandmark: 'Behind Arcade, Kampala Central',
      deliveryNote: 'Call when you reach Nduve Cinema, gate is locked after 8pm',
      isDefault: true,
    },
  });

  return { admin, kampalaSeller, nairobiSeller, buyer };
}

type VariantSeed = {
  sku: string;
  name: string;
  attributes: Record<string, string>;
  priceMinor: number;
  compareAtPriceMinor?: number;
  stock: number;
  isPrimary?: boolean;
};

type ProductSeed = {
  shopKey: 'electrohub' | 'mitumba';
  slug: string;
  title: string;
  subtitle?: string;
  description: string;
  brand?: string;
  categorySlug: string;
  fulfilmentType: FulfilmentType;
  weightGrams?: number;
  currency: CurrencyCode;
  imageAlts: string[];
  soldCount: number;
  viewsCount: number;
  variants: VariantSeed[];
};

const DEMO_PRODUCTS: ProductSeed[] = [
  {
    shopKey: 'electrohub',
    slug: 'tecno-spark-30c-android-smartphone',
    title: 'Tecno Spark 30C Android Smartphone',
    subtitle: '6.67" HD+ · 5000mAh · Android 14',
    description:
      'Brand-new Tecno Spark 30C with official distributor warranty. Dual SIM (MTN + Airtel), 5000mAh battery that lasts a full trading day, and 18W fast charging. Includes charger, case and tempered glass.',
    brand: 'Tecno',
    categorySlug: 'smartphones',
    fulfilmentType: FulfilmentType.SELLER_DELIVERY,
    weightGrams: 450,
    currency: 'UGX',
    imageAlts: [
      'Tecno Spark 30C from the front, screen on',
      'Back of the Spark 30C showing the dual camera strip',
      'Spark 30C with its box, charger, cable and clear case',
    ],
    soldCount: 137,
    viewsCount: 8_940,
    variants: [
      {
        sku: 'BMZ-PH-TEC-SP30C-64-BLK',
        name: '64GB / Black',
        attributes: { Storage: '64GB', Colour: 'Black' },
        priceMinor: ug(649_000),
        compareAtPriceMinor: ug(750_000),
        stock: 24,
        isPrimary: true,
      },
      {
        sku: 'BMZ-PH-TEC-SP30C-128-BLU',
        name: '128GB / Blue',
        attributes: { Storage: '128GB', Colour: 'Blue' },
        priceMinor: ug(799_000),
        compareAtPriceMinor: ug(890_000),
        stock: 11,
      },
    ],
  },
  {
    shopKey: 'electrohub',
    slug: 'hisense-43a4g-43-inch-smart-tv',
    title: 'Hisense 43A4G 43-inch VIDAA Smart TV',
    subtitle: 'Full HD · Netflix + Showmax built in',
    description:
      '43-inch Full HD smart TV running VIDAA with Netflix, Showmax and DStv Stream apps pre-installed. Comes with remote, wall-mount bracket and free setup within Kampala district.',
    brand: 'Hisense',
    categorySlug: 'tvs',
    fulfilmentType: FulfilmentType.SELLER_DELIVERY,
    weightGrams: 7500,
    currency: 'UGX',
    imageAlts: [
      'Hisense 43A4G on its stand, front view',
      'Rear three quarter of the 43A4G showing the ports',
    ],
    soldCount: 28,
    viewsCount: 3_120,
    variants: [
      {
        sku: 'BMZ-TV-HIS-43A4G-STD',
        name: 'Standard (with wall mount)',
        attributes: { Bundle: 'With wall mount' },
        priceMinor: ug(1_240_000),
        compareAtPriceMinor: ug(1_450_000),
        stock: 6,
        isPrimary: true,
      },
      {
        sku: 'BMZ-TV-HIS-43A4G-NO-MOUNT',
        name: 'TV only (no mount)',
        attributes: { Bundle: 'TV only' },
        priceMinor: ug(1_160_000),
        stock: 9,
      },
    ],
  },
  {
    shopKey: 'electrohub',
    slug: 'sunmini-solar-home-kit-20w',
    title: 'Sunmini 20W Solar Home Kit with 3 Bulbs',
    subtitle: 'Off-grid lighting for trading centres',
    description:
      '20W panel, 3 LED bulbs, phone charging ports and FM radio. The standard kit for shops without UMEME power. Assembled in Nakawa, 12-month panel warranty.',
    brand: 'Sunmini',
    categorySlug: 'power-solutions',
    fulfilmentType: FulfilmentType.SELLER_DELIVERY,
    weightGrams: 3200,
    currency: 'UGX',
    imageAlts: ['Sunmini 20W panel, power box, three bulbs and cables laid out'],
    soldCount: 96,
    viewsCount: 5_480,
    variants: [
      {
        sku: 'BMZ-SOL-SUN-20W-3BULB',
        name: '20W / 3 bulbs',
        attributes: { Panel: '20W', Bulbs: '3' },
        priceMinor: ug(285_000),
        compareAtPriceMinor: ug(320_000),
        stock: 40,
        isPrimary: true,
      },
    ],
  },
  {
    shopKey: 'mitumba',
    slug: 'kitenge-office-dress-made-to-order',
    title: 'Kitenge Office Dress — Made to Order',
    subtitle: 'Tailored in Nairobi, ships in 3 working days',
    description:
      'Knee-length shein-style office dress cut from quality Kitenge cotton. Choose your size; made-to-order pieces ship within three working days. Machine washable, colourfast.',
    brand: 'Maji Mpya Designs',
    categorySlug: 'kitenge-ankara',
    fulfilmentType: FulfilmentType.SELLER_DELIVERY,
    weightGrams: 350,
    currency: 'KES',
    imageAlts: [
      'Model wearing the kitenge office dress, full length',
      'Dress on a hanger, close view of the collar and buttons',
    ],
    soldCount: 64,
    viewsCount: 4_210,
    variants: [
      { sku: 'BMZ-FS-WM-KTD-S', name: 'Small', attributes: { Size: 'S' }, priceMinor: ke(2_450), stock: 14, isPrimary: true },
      { sku: 'BMZ-FS-WM-KTD-M', name: 'Medium', attributes: { Size: 'M' }, priceMinor: ke(2_450), stock: 22 },
      { sku: 'BMZ-FS-WM-KTD-L', name: 'Large', attributes: { Size: 'L' }, priceMinor: ke(2_650), stock: 17 },
      { sku: 'BMZ-FS-WM-KTD-XL', name: 'Extra Large', attributes: { Size: 'XL' }, priceMinor: ke(2_850), stock: 8 },
    ],
  },
  {
    shopKey: 'mitumba',
    slug: 'premium-mitumba-oxford-shirt-men',
    title: 'Premium Mitumba Oxford Shirt for Men',
    subtitle: 'Grade A second-hand · Gikomba sorted',
    description:
      'Grade A second-hand Oxford shirt hand-sorted at Gikomba: no holes, no stains, freshly laundered and pressed. Sizes are UK equivalents.',
    brand: 'Unbranded',
    categorySlug: 'shirts-men',
    fulfilmentType: FulfilmentType.SELLER_DELIVERY,
    weightGrams: 250,
    currency: 'KES',
    imageAlts: ['Pale blue Oxford shirt on a wooden hanger, front view'],
    soldCount: 210,
    viewsCount: 9_760,
    variants: [
      { sku: 'BMZ-FS-MM-OXF-M', name: 'Medium', attributes: { Size: 'M' }, priceMinor: ke(850), compareAtPriceMinor: ke(1_200), stock: 30, isPrimary: true },
      { sku: 'BMZ-FS-MM-OXF-L', name: 'Large', attributes: { Size: 'L' }, priceMinor: ke(850), stock: 26 },
      { sku: 'BMZ-FS-MM-OXF-XL', name: 'Extra Large', attributes: { Size: 'XL' }, priceMinor: ke(950), stock: 12 },
    ],
  },
];

async function seedShopsAndCatalog(
  countryIdByCode: Map<string, number>,
  districtByCode: Map<string, number>,
  categoryIds: Map<string, string>,
  users: { kampalaSeller: { id: string }; nairobiSeller: { id: string } },
) {
  const shops = {
    electrohub: await prisma.shop.upsert({
      where: { slug: 'electro-hub-kampala' },
      update: {
        status: ShopStatus.ACTIVE,
        isVerified: true,
        kycStatus: KycStatus.APPROVED,
        logoUrl: '/images/shops/electro-hub-kampala-logo.jpg',
        bannerUrl: '/images/shops/electro-hub-kampala-banner.jpg',
      },
      create: {
        ownerId: users.kampalaSeller.id,
        name: 'Electro Hub Kampala',
        slug: 'electro-hub-kampala',
        legacyStoreId: 4821,
        description:
          'Plot 14, Ntinda Complex, Kampala. Phones, TVs and solar kits with genuine distributor warranty. Pay by MTN MoMo, Airtel Money or card.',
        tagline: 'Genuine gadgets, delivered by boda',
        phone: '+256700000002',
        whatsappNumber: '+256700000002',
        email: 'sales@electrohub.co.ug',
        countryId: countryIdByCode.get('UG')!,
        baseDistrictId: districtByCode.get(districtKey('UG', 'WKO'))!,
        streetAddress: 'Ntinda Complex, Plot 14, Shop 7',
        logoUrl: '/images/shops/electro-hub-kampala-logo.jpg',
        bannerUrl: '/images/shops/electro-hub-kampala-banner.jpg',
        status: ShopStatus.ACTIVE,
        isVerified: true,
        kycStatus: KycStatus.APPROVED,
        kycApprovedAt: new Date(),
        ratingAvg: 4.6,
        ratingCount: 218,
        totalSalesCount: 1_460,
        totalSalesMinor: BigInt(ug(640_000_000)),
        defaultFulfilment: FulfilmentType.SELLER_DELIVERY,
        dispatchSlaHours: 24,
      },
    }),
    mitumba: await prisma.shop.upsert({
      where: { slug: 'mitumba-fashion-nbo' },
      update: {
        status: ShopStatus.ACTIVE,
        logoUrl: '/images/shops/mitumba-fashion-nbo-logo.jpg',
        bannerUrl: '/images/shops/mitumba-fashion-nbo-banner.jpg',
      },
      create: {
        ownerId: users.nairobiSeller.id,
        name: 'Mitumba Fashion NBO',
        slug: 'mitumba-fashion-nbo',
        legacyStoreId: 9137,
        description:
          'Grade A second-hand and made-to-order Kitenge clothing from Gikomba and South B. M-Pesa, Airtel Money and cards accepted.',
        tagline: 'Quality mitumba, sorted daily',
        phone: '+254700000003',
        whatsappNumber: '+254700000003',
        email: 'hello@mitumbafashion.co.ke',
        countryId: countryIdByCode.get('KE')!,
        baseDistrictId: districtByCode.get(districtKey('KE', 'KE-030'))!,
        streetAddress: 'South B Lights, Near Stage',
        logoUrl: '/images/shops/mitumba-fashion-nbo-logo.jpg',
        bannerUrl: '/images/shops/mitumba-fashion-nbo-banner.jpg',
        status: ShopStatus.ACTIVE,
        isVerified: false,
        kycStatus: KycStatus.UNDER_REVIEW,
        ratingAvg: 4.3,
        ratingCount: 76,
        totalSalesCount: 340,
        totalSalesMinor: BigInt(ke(9_850_000)),
        defaultFulfilment: FulfilmentType.SELLER_DELIVERY,
        dispatchSlaHours: 48,
      },
    }),
  };

  for (const [slug, shop] of Object.entries(shops)) {
    const provider = slug === 'electrohub' ? PayoutProvider.MTN_MOMO : PayoutProvider.AIRTEL_MONEY;
    await prisma.payoutAccount.upsert({
      where: { shopId: shop.id },
      update: {},
      create: {
        shopId: shop.id,
        provider,
        accountNumber: shop.phone,
        accountName: shop.name,
        isDefault: true,
        isVerified: slug === 'electrohub',
        verifiedAt: slug === 'electrohub' ? new Date() : null,
      },
    });
  }

  const shopKycSeed: {
    shopId: string;
    status: KycStatus;
    type: KycDocumentType;
    publicId: string;
    fileUrl: string;
  }[] = [
    {
      shopId: shops.electrohub.id,
      status: shops.electrohub.kycStatus,
      type: KycDocumentType.NATIONAL_ID,
      publicId: 'bemz/kyc/electrohub/nin',
      fileUrl: '/images/kyc/specimen-id-card.jpg',
    },
    {
      shopId: shops.electrohub.id,
      status: shops.electrohub.kycStatus,
      type: KycDocumentType.TAX_PIN,
      publicId: 'bemz/kyc/electrohub/tin',
      fileUrl: '/images/kyc/specimen-paper-certificate.jpg',
    },
    {
      shopId: shops.mitumba.id,
      status: shops.mitumba.kycStatus,
      type: KycDocumentType.BUSINESS_REGISTRATION,
      publicId: 'bemz/kyc/mitumba/cert',
      fileUrl: '/images/kyc/specimen-paper-certificate.jpg',
    },
  ];

  for (const kyc of shopKycSeed) {
    await prisma.kycDocument.upsert({
      where: { shopId_type: { shopId: kyc.shopId, type: kyc.type } },
      update: {},
      create: {
        shopId: kyc.shopId,
        type: kyc.type,
        fileUrl: kyc.fileUrl,
        publicId: kyc.publicId,
        status: kyc.status,
      },
    });
  }

  for (const seed of DEMO_PRODUCTS) {
    const shop = shops[seed.shopKey];
    const product = await prisma.product.upsert({
      where: { shopId_slug: { shopId: shop.id, slug: seed.slug } },
      update: {
        title: seed.title,
        description: seed.description,
        status: ProductStatus.ACTIVE,
        currency: seed.currency,
        fulfilmentType: seed.fulfilmentType,
        weightGrams: seed.weightGrams,
      },
      create: {
        shopId: shop.id,
        slug: seed.slug,
        title: seed.title,
        subtitle: seed.subtitle,
        description: seed.description,
        brand: seed.brand,
        status: ProductStatus.ACTIVE,
        fulfilmentType: seed.fulfilmentType,
        currency: seed.currency,
        sku: `${seed.slug.split('-')[0].toUpperCase()}-${seed.slug.slice(0, 4).toUpperCase()}`,
        weightGrams: seed.weightGrams,
        warrantyText: seed.currency === 'UGX' ? '12 months distributor warranty' : null,
        soldCount: seed.soldCount,
        viewsCount: seed.viewsCount,
        requiresModeration: false,
      },
    });

    const categoryId = categoryIds.get(seed.categorySlug);
    if (categoryId) {
      await prisma.productCategory.upsert({
        where: { productId_categoryId: { productId: product.id, categoryId } },
        update: { isPrimary: true },
        create: { productId: product.id, categoryId, isPrimary: true },
      });
    }

    for (const [index, variantSeed] of seed.variants.entries()) {
      const variant = await prisma.productVariant.upsert({
        where: { sku: variantSeed.sku },
        update: {
          priceMinor: variantSeed.priceMinor,
          compareAtPriceMinor: variantSeed.compareAtPriceMinor,
          stockQuantity: variantSeed.stock,
          currency: seed.currency,
        },
        create: {
          productId: product.id,
          sku: variantSeed.sku,
          name: variantSeed.name,
          attributes: variantSeed.attributes,
          priceMinor: variantSeed.priceMinor,
          compareAtPriceMinor: variantSeed.compareAtPriceMinor,
          currency: seed.currency,
          stockQuantity: variantSeed.stock,
          lowStockThreshold: 5,
          isPrimary: variantSeed.isPrimary ?? false,
        },
      });

      if (index === 0) {
        await prisma.product.update({
          where: { id: product.id },
          data: {
            startingPriceMinor: variant.priceMinor,
            discountPct: variant.compareAtPriceMinor
              ? Math.round((1 - variant.priceMinor / variant.compareAtPriceMinor) * 100)
              : null,
          },
        });
      }

      await prisma.inventoryMovement.upsert({
        where: { idempotencyKey: `seed:${variantSeed.sku}:opening` },
        update: { delta: variantSeed.stock, balanceAfter: variantSeed.stock, variantId: variant.id, shopId: shop.id },
        create: {
          variantId: variant.id,
          shopId: shop.id,
          reason: StockMovementReason.PURCHASE_IN,
          delta: variantSeed.stock,
          balanceAfter: variantSeed.stock,
          note: 'Opening stock',
          idempotencyKey: `seed:${variantSeed.sku}:opening`,
        },
      });
    }

    for (const [imageIndex, altText] of seed.imageAlts.entries()) {
      const fileBase = `/images/products/${seed.slug}-${imageIndex + 1}`;
      await prisma.productImage.upsert({
        where: { id: `img-${seed.slug}-${imageIndex}` },
        update: {
          url: `${fileBase}.jpg`,
          thumbUrl: `${fileBase}-thumb.jpg`,
          altText,
          position: imageIndex,
          isPrimary: imageIndex === 0,
        },
        create: {
          id: `img-${seed.slug}-${imageIndex}`,
          productId: product.id,
          url: `${fileBase}.jpg`,
          thumbUrl: `${fileBase}-thumb.jpg`,
          publicId: `bemz/products/${seed.slug}/${imageIndex + 1}`,
          altText,
          position: imageIndex,
          isPrimary: imageIndex === 0,
        },
      });
    }
  }

  return shops;
}

async function seedCoupon() {
  await prisma.coupon.upsert({
    where: { code: 'BEMZ10' },
    update: { isActive: true },
    create: {
      code: 'BEMZ10',
      name: '10% off your first order',
      scope: CouponScope.PLATFORM,
      discountType: DiscountType.PERCENTAGE,
      valueBps: 1000,
      maxDiscountMinor: ug(50_000),
      minOrderMinor: ug(30_000),
      currency: 'UGX',
      startsAt: new Date(Date.now() - 86_400_000),
      endsAt: new Date(Date.now() + 90 * 86_400_000),
      usageLimitTotal: 20_000,
      usageLimitPerUser: 1,
    },
  });

  await prisma.coupon.upsert({
    where: { code: 'FREESHIPKL' },
    update: { isActive: true },
    create: {
      code: 'FREESHIPKL',
      name: 'Free Kampala Metro delivery',
      scope: CouponScope.PLATFORM,
      discountType: DiscountType.FREE_SHIPPING,
      minOrderMinor: ug(80_000),
      currency: 'UGX',
      startsAt: new Date(Date.now() - 86_400_000),
      endsAt: new Date(Date.now() + 30 * 86_400_000),
      usageLimitTotal: 5_000,
      usageLimitPerUser: 3,
    },
  });
}

/**
 * Reviews and buyer questions. Without them the storefront is a shell: a product card can say
 * "4.6 from 218 ratings" while the reviews tab says nothing at all, and that is the fastest way
 * to tell an empty database from a shop that has traded.
 */
async function seedSocialProof(
  shops: { electrohub: { id: string; ownerId: string }; mitumba: { id: string; ownerId: string } },
) {
  const reviewers = [
    { key: 'godfrey', name: 'Godfrey Ssebuggwawo', phone: '+256700000011', countryId: 'UG' as const, currency: 'UGX' as const },
    { key: 'grace', name: 'Grace Namutebi', phone: '+256700000012', countryId: 'UG' as const, currency: 'UGX' as const },
    { key: 'peter', name: 'Peter Okello', phone: '+256700000013', countryId: 'UG' as const, currency: 'UGX' as const },
    { key: 'sarah', name: 'Sarah Birabero', phone: '+256700000014', countryId: 'UG' as const, currency: 'UGX' as const },
    { key: 'james', name: 'James Mwangi', phone: '+254700000011', countryId: 'KE' as const, currency: 'KES' as const },
    { key: 'fatuma', name: 'Fatuma Ali', phone: '+254700000012', countryId: 'KE' as const, currency: 'KES' as const },
    { key: 'dennis', name: 'Dennis Wanjala', phone: '+254700000013', countryId: 'KE' as const, currency: 'KES' as const },
    { key: 'mercy', name: 'Mercy Achieng', phone: '+254700000014', countryId: 'KE' as const, currency: 'KES' as const },
  ];

  const userIdByPhone = new Map<string, string>();
  for (const reviewer of reviewers) {
    const user = await prisma.user.upsert({
      where: { phone: reviewer.phone },
      update: { name: reviewer.name },
      create: {
        name: reviewer.name,
        phone: reviewer.phone,
        phoneVerified: new Date(),
        role: UserRole.BUYER,
        preferredCurrency: reviewer.currency,
        whatsappOptIn: true,
      },
    });
    userIdByPhone.set(reviewer.phone, user.id);
  }
  // Brian Kato is the account a developer signs in as; let him own a couple of reviews too.
  const brian = await prisma.user.findUnique({ where: { phone: '+256700000009' }, select: { id: true } });
  if (brian) userIdByPhone.set('brian', brian.id);

  const productIds = await prisma.product.findMany({
    where: { slug: { in: DEMO_PRODUCTS.map((product) => product.slug) } },
    select: { id: true, slug: true, shopId: true },
  });
  const productBySlug = new Map(productIds.map((product) => [product.slug, product]));

  type ReviewSeed = {
    id: string;
    author: string;
    productSlug?: string;
    shopKey?: 'electrohub' | 'mitumba';
    rating: number;
    title?: string;
    body: string;
    daysAgo: number;
    helpful: number;
    images?: string[];
    reply?: string;
  };

  const reviewSeeds: ReviewSeed[] = [
    {
      id: 'rev-tecno-1',
      author: '+256700000011',
      productSlug: 'tecno-spark-30c-android-smartphone',
      rating: 5,
      title: 'Battery really lasts the trading day',
      body: 'Ordered Thursday evening, boda brought it to my shop in Bugolobi before noon Friday. I am on MTN all day selling airtime and the battery still had 30% when I closed. Case and tempered glass were inside as stated.',
      daysAgo: 3,
      helpful: 21,
      reply: 'Thank you Godfrey. The 64GB Black is back in stock if you want a second unit for the shop.',
    },
    {
      id: 'rev-tecno-2',
      author: 'brian',
      productSlug: 'tecno-spark-30c-android-smartphone',
      rating: 4,
      title: 'Good phone, but the brick is 18W not 25W',
      body: 'Phone is solid for the price and HiOS is smooth. Only complaint: the listing says 25W charging and the adapter in the pack is 18W. Still fast enough for me.',
      daysAgo: 11,
      helpful: 9,
    },
    {
      id: 'rev-tecno-3',
      author: '+256700000013',
      productSlug: 'tecno-spark-30c-android-smartphone',
      rating: 5,
      title: 'Second one I have bought here',
      body: 'Bought one for my wife in July, this one for my brother in Mbarara. Both genuine, both warranty cards stamped. Courier to Mbarara took two days.',
      daysAgo: 19,
      helpful: 6,
    },
    {
      id: 'rev-tv-1',
      author: '+256700000012',
      productSlug: 'hisense-43a4g-43-inch-smart-tv',
      rating: 5,
      title: 'Netflix and Showmax both work out of the box',
      body: 'They mounted it free within Kampala as promised. The guy came with the bracket and a level. VIDAA is quick enough, remote is basic but fine.',
      daysAgo: 7,
      helpful: 12,
    },
    {
      id: 'rev-tv-2',
      author: '+256700000014',
      productSlug: 'hisense-43a4g-43-inch-smart-tv',
      rating: 3,
      title: 'Picture is good, apps sometimes hang',
      body: 'For the money the panel is bright and colours are nice. YouTube occasionally needs the TV switched off and on again. Seller responded quickly when I reported it.',
      daysAgo: 24,
      helpful: 5,
      reply: 'That is usually the cache. We have sent our service engineer to check the unit this week, sorry for the trouble.',
    },
    {
      id: 'rev-solar-1',
      author: '+256700000011',
      productSlug: 'sunmini-solar-home-kit-20w',
      rating: 5,
      title: 'Lights the whole shop till 10pm',
      body: 'No UMEME at our trading centre in Bududa. Three bulbs, radio and phone charging from one panel. Even in the long rains the battery reaches evening.',
      daysAgo: 5,
      helpful: 17,
    },
    {
      id: 'rev-solar-2',
      author: '+256700000013',
      productSlug: 'sunmini-solar-home-kit-20w',
      rating: 4,
      title: 'Panel is smaller than the photo suggests',
      body: 'It is a real 20W panel, just smaller than I pictured. Full sun by 10am charges it completely and the bulb cables reach three rooms.',
      daysAgo: 31,
      helpful: 3,
    },
    {
      id: 'rev-dress-1',
      author: '+254700000012',
      productSlug: 'kitenge-office-dress-made-to-order',
      rating: 5,
      title: 'True to size and finished well',
      body: 'I gave my bust and waist in the order note and the dress fits like it was cut for me. Taken in at the waist, hidden zip, lining all the way down. Three working days exactly.',
      daysAgo: 9,
      helpful: 14,
      images: ['/images/products/kitenge-office-dress-made-to-order-2.jpg'],
    },
    {
      id: 'rev-dress-2',
      author: '+254700000014',
      productSlug: 'kitenge-office-dress-made-to-order',
      rating: 4,
      title: 'Colour is deeper than the screen showed',
      body: 'The rust reads more brick than orange in person. Not a problem, I just wish the photo was truer. Fabric is thick cotton and washes well.',
      daysAgo: 16,
      helpful: 4,
    },
    {
      id: 'rev-dress-3',
      author: '+254700000011',
      productSlug: 'kitenge-office-dress-made-to-order',
      rating: 5,
      title: 'Ordered XL, fits perfectly',
      body: 'Second dress from Maji Mpya. They message on WhatsApp with the cutting photo before sewing, which I like.',
      daysAgo: 28,
      helpful: 8,
    },
    {
      id: 'rev-shirt-1',
      author: '+254700000013',
      productSlug: 'premium-mitumba-oxford-shirt-men',
      rating: 5,
      title: 'No holes, pressed, smells fresh',
      body: 'Grade A is accurate here. Collar is stiff, no shine on the elbows. Ordered two more in Large for my husband.',
      daysAgo: 4,
      helpful: 7,
    },
    {
      id: 'rev-shirt-2',
      author: 'brian',
      productSlug: 'premium-mitumba-oxford-shirt-men',
      rating: 3,
      title: 'Runs small, order one up',
      body: 'Medium sits closer to a UK small on me. Exchange was easy, Kevin sent a boda to collect it. Fabric is good though.',
      daysAgo: 21,
      helpful: 11,
      reply: 'Noted, and we have added a sizing note on the listing. Did the Large reach you on Wednesday?',
    },
    {
      id: 'rev-shop-electro-1',
      author: '+256700000012',
      shopKey: 'electrohub',
      rating: 5,
      title: 'Collected my TV the same day',
      body: 'Ordered at 9am, delivered to Ntinda by 4pm with the mount fitted. They call before coming, which is more than most shops do.',
      daysAgo: 6,
      helpful: 9,
    },
    {
      id: 'rev-shop-electro-2',
      author: '+256700000011',
      shopKey: 'electrohub',
      rating: 5,
      title: 'The warranty actually means something here',
      body: 'My phone screen went dead in month ten and they replaced it under the distributor warranty without argument.',
      daysAgo: 40,
      helpful: 15,
    },
    {
      id: 'rev-shop-electro-3',
      author: '+256700000014',
      shopKey: 'electrohub',
      rating: 4,
      title: 'Packaging could be better',
      body: 'TV was fine but the outer carton was crushed on arrival. Check the screen before you sign for it.',
      daysAgo: 14,
      helpful: 6,
    },
    {
      id: 'rev-shop-mitumba-1',
      author: '+254700000012',
      shopKey: 'mitumba',
      rating: 5,
      title: 'Best mitumba sorting in South B',
      body: 'They sort by hand and you can send a measurement list on WhatsApp. Never received a damaged piece from them.',
      daysAgo: 8,
      helpful: 11,
    },
    {
      id: 'rev-shop-mitumba-2',
      author: '+254700000014',
      shopKey: 'mitumba',
      rating: 4,
      title: 'Slow during the holidays',
      body: 'Dress took five days instead of three in December. They were honest about the delay, so no complaint beyond that.',
      daysAgo: 45,
      helpful: 4,
    },
  ];

  for (const review of reviewSeeds) {
    const product = review.productSlug ? productBySlug.get(review.productSlug) : undefined;
    const shopId = product?.shopId ?? (review.shopKey ? shops[review.shopKey].id : undefined);
    const userId = userIdByPhone.get(review.author);
    if (!shopId || !userId) continue;

    await prisma.review.upsert({
      where: { id: review.id },
      update: {},
      create: {
        id: review.id,
        userId,
        targetType: review.productSlug ? ReviewTargetType.PRODUCT : ReviewTargetType.SHOP,
        productId: product?.id,
        shopId,
        rating: review.rating,
        title: review.title,
        body: review.body,
        images: review.images ?? [],
        isVerifiedPurchase: true,
        status: ReviewStatus.PUBLISHED,
        helpfulCount: review.helpful,
        sellerReply: review.reply,
        sellerRepliedAt: review.reply ? new Date(Date.now() - (review.daysAgo - 1) * 86_400_000) : null,
        createdAt: new Date(Date.now() - review.daysAgo * 86_400_000),
      },
    });
  }

  // Counters are denormalised on purpose (the storefront sorts on them), so derive them from the
  // rows that were just written rather than trusting the headline numbers.
  for (const product of productIds) {
    const stats = await prisma.review.aggregate({
      where: { productId: product.id, targetType: ReviewTargetType.PRODUCT, status: ReviewStatus.PUBLISHED },
      _avg: { rating: true },
      _count: { _all: true },
    });
    await prisma.product.update({
      where: { id: product.id },
      data: {
        ratingAvg: stats._count._all === 0 ? null : Number((stats._avg.rating ?? 0).toFixed(2)),
        ratingCount: stats._count._all,
      },
    });
  }

  for (const shop of [shops.electrohub, shops.mitumba]) {
    const stats = await prisma.review.aggregate({
      where: { shopId: shop.id, targetType: ReviewTargetType.SHOP, status: ReviewStatus.PUBLISHED },
      _avg: { rating: true },
      _count: { _all: true },
    });
    await prisma.shop.update({
      where: { id: shop.id },
      data: {
        ratingAvg: stats._count._all === 0 ? null : Number((stats._avg.rating ?? 0).toFixed(2)),
        ratingCount: stats._count._all,
      },
    });
  }

  const questionSeeds: {
    id: string;
    productSlug: string;
    author: string;
    body: string;
    answer: string;
    daysAgo: number;
  }[] = [
    {
      id: 'q-tecno-1',
      productSlug: 'tecno-spark-30c-android-smartphone',
      author: '+256700000013',
      body: 'Does it take two SIMs and a memory card at the same time?',
      answer: 'Yes. Two SIM slots plus a dedicated microSD slot up to 512GB, so you do not have to drop SIM 2.',
      daysAgo: 12,
    },
    {
      id: 'q-tecno-2',
      productSlug: 'tecno-spark-30c-android-smartphone',
      author: '+256700000012',
      body: 'Is the warranty from Tecno Uganda or from the shop?',
      answer: 'Distributor warranty card stamped in Kampala, valid at any authorised Tecno service centre.',
      daysAgo: 26,
    },
    {
      id: 'q-tv-1',
      productSlug: 'hisense-43a4g-43-inch-smart-tv',
      author: '+256700000014',
      body: 'Is the wall mount free outside Kampala?',
      answer: 'Free fitting is within Kampala district only. Outside that we ship the bracket with instructions at no charge.',
      daysAgo: 18,
    },
    {
      id: 'q-solar-1',
      productSlug: 'sunmini-solar-home-kit-20w',
      author: '+256700000011',
      body: 'How long do the three bulbs stay on from a full charge?',
      answer: 'About 8 hours with all three at half brightness, or 14 hours on two bulbs. A full charge needs 5 to 6 hours of direct sun.',
      daysAgo: 9,
    },
    {
      id: 'q-dress-1',
      productSlug: 'kitenge-office-dress-made-to-order',
      author: '+254700000012',
      body: 'Can I send my own measurements instead of choosing S or M?',
      answer: 'Yes. Put bust, waist, hip and your preferred length in the order note, or send them on WhatsApp after ordering.',
      daysAgo: 21,
    },
  ];

  for (const question of questionSeeds) {
    const product = productBySlug.get(question.productSlug);
    const userId = userIdByPhone.get(question.author);
    if (!product || !userId) continue;
    const shopId = product.shopId;
    const responderId = shopId === shops.electrohub.id ? shops.electrohub.ownerId : shops.mitumba.ownerId;

    await prisma.productQuestion.upsert({
      where: { id: question.id },
      update: {},
      create: {
        id: question.id,
        productId: product.id,
        userId,
        body: question.body,
        createdAt: new Date(Date.now() - question.daysAgo * 86_400_000),
      },
    });

    await prisma.productAnswer.upsert({
      where: { id: `${question.id}-a` },
      update: {},
      create: {
        id: `${question.id}-a`,
        questionId: question.id,
        responderId,
        isFromSeller: true,
        body: question.answer,
        createdAt: new Date(Date.now() - (question.daysAgo - 1) * 86_400_000),
      },
    });
  }
}

async function main() {
  const geo = await seedGeography();
  const categoryIds = await seedCategories();
  const users = await seedAccounts(geo.countryIdByCode, geo.districtByCode);
  const shops = await seedShopsAndCatalog(geo.countryIdByCode, geo.districtByCode, categoryIds, users);
  await seedCoupon();
  await seedSocialProof(shops);

  const summary = {
    countries: await prisma.country.count(),
    regions: await prisma.region.count(),
    districts: await prisma.district.count(),
    zones: await prisma.deliveryZone.count(),
    categories: await prisma.category.count(),
    users: await prisma.user.count(),
    shops: await prisma.shop.count(),
    products: await prisma.product.count(),
    variants: await prisma.productVariant.count(),
    reviews: await prisma.review.count(),
    questions: await prisma.productQuestion.count(),
  };
  console.log('Seed complete:', summary);
}

main()
  .catch((error) => {
    console.error('Seed failed:', error);
    process.exitCode = 1;
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
