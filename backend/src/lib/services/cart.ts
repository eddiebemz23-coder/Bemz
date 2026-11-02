import 'server-only';
import { prisma, type Cart, type CurrencyCode } from '../prisma';
import { badRequest, conflict, notFound } from '../http';
import { loadPurchasableVariants } from './pricing';

/**
 * The cart is a draft basket, not a price lock.
 *
 * `CartItem.unitPriceMinor` keeps the price shown when the buyer added the line, but the
 * subtotal is always recomputed from the live variant price and the UI is told which lines
 * moved — a seller cutting a phone's price 20% overnight should benefit the buyer, and a
 * silent price rise must be visible before checkout, not after.
 */

export type CartHolder = {
  userId?: string | null;
  guestToken?: string | null;
};

export type CartLine = {
  itemId: string;
  variantId: string;
  productId: string;
  productSlug: string;
  productTitle: string;
  variantName: string;
  sku: string;
  imageUrl: string | null;
  shopId: string;
  shopName: string;
  shopSlug: string;
  quantity: number;
  selected: boolean;
  currency: CurrencyCode;
  /** Live price the checkout will charge. */
  unitPriceMinor: number;
  /** Price displayed when the line was added. */
  snapshotPriceMinor: number;
  priceChanged: boolean;
  lineTotalMinor: number;
  availableStock: number;
  maxQuantityPerOrder: number | null;
  isOutOfStock: boolean;
  exceedsStock: boolean;
  exceedsMaxPerOrder: boolean;
};

export type CartView = {
  cartId: string;
  isGuest: boolean;
  currency: CurrencyCode | null;
  couponCode: string | null;
  itemCount: number;
  selectedCount: number;
  subtotalMinor: number;
  selectedSubtotalMinor: number;
  blockedLines: number;
  lines: CartLine[];
};

function assertHolder(holder: CartHolder) {
  if (!holder.userId && !holder.guestToken) {
    throw badRequest('Sign in, or send the x-cart-token header, to use a basket');
  }
}

async function findActiveCart(holder: CartHolder): Promise<Cart | null> {
  if (holder.userId) {
    return prisma.cart.findUnique({ where: { userId_status: { userId: holder.userId, status: 'ACTIVE' } } });
  }
  if (holder.guestToken) {
    return prisma.cart.findUnique({ where: { guestToken: holder.guestToken, status: 'ACTIVE' } });
  }
  return null;
}

export async function getOrCreateCart(holder: CartHolder, currency?: CurrencyCode): Promise<Cart> {
  assertHolder(holder);
  const existing = await findActiveCart(holder);
  if (existing) return existing;

  const country = holder.userId
    ? await prisma.user.findUnique({ where: { id: holder.userId }, select: { countryId: true, preferredCurrency: true } })
    : null;

  return prisma.cart.create({
    data: {
      userId: holder.userId ?? null,
      guestToken: holder.guestToken ?? null,
      currency: currency ?? country?.preferredCurrency ?? 'UGX',
      countryId: country?.countryId ?? null,
      expiresAt: holder.userId ? null : new Date(Date.now() + 30 * 24 * 60 * 60 * 1000),
    },
  });
}

/**
 * Recomputes the stored totals from live variant prices and returns the buyer-facing view.
 * Called on every read and mutation so `Cart.subtotalMinor` shown in the header is the same
 * number checkout will charge.
 */
export async function syncCart(cartId: string): Promise<CartView> {
  const cart = await prisma.cart.findUnique({
    where: { id: cartId },
    include: {
      coupon: { select: { code: true } },
      items: {
        orderBy: { addedAt: 'asc' },
        include: {
          variant: {
            select: {
              id: true,
              sku: true,
              name: true,
              priceMinor: true,
              currency: true,
              stockQuantity: true,
              reservedQuantity: true,
              maxQuantityPerOrder: true,
              isDisabled: true,
              deletedAt: true,
              attributes: true,
              productId: true,
              product: {
                select: {
                  id: true,
                  slug: true,
                  title: true,
                  status: true,
                  deletedAt: true,
                  shop: { select: { id: true, name: true, slug: true, status: true, vacationMode: true } },
                },
              },
              images: { where: { variantId: null }, orderBy: { position: 'asc' }, take: 1, select: { url: true } },
            },
          },
        },
      },
    },
  });

  if (!cart) throw notFound('Your basket could not be found');

  const lines: CartLine[] = cart.items.map((item) => {
    const variant = item.variant;
    const availableStock = Math.max(0, variant.stockQuantity - variant.reservedQuantity);
    const purchasable =
      !variant.isDisabled &&
      !variant.deletedAt &&
      variant.product.status === 'ACTIVE' &&
      variant.product.deletedAt === null &&
      variant.product.shop.status === 'ACTIVE' &&
      !variant.product.shop.vacationMode;

    return {
      itemId: item.id,
      variantId: variant.id,
      productId: variant.productId,
      productSlug: variant.product.slug,
      productTitle: variant.product.title,
      variantName: variant.name,
      sku: variant.sku,
      imageUrl: variant.images[0]?.url ?? null,
      shopId: variant.product.shop.id,
      shopName: variant.product.shop.name,
      shopSlug: variant.product.shop.slug,
      quantity: item.quantity,
      selected: item.selected,
      currency: variant.currency,
      unitPriceMinor: variant.priceMinor,
      snapshotPriceMinor: item.unitPriceMinor,
      priceChanged: item.unitPriceMinor !== variant.priceMinor,
      lineTotalMinor: variant.priceMinor * item.quantity,
      availableStock,
      maxQuantityPerOrder: variant.maxQuantityPerOrder,
      isOutOfStock: !purchasable || availableStock < 1,
      exceedsStock: purchasable && item.quantity > availableStock,
      exceedsMaxPerOrder: Boolean(variant.maxQuantityPerOrder && item.quantity > variant.maxQuantityPerOrder),
    };
  });

  const blockedLines = lines.filter(
    (line) => line.isOutOfStock || line.exceedsStock || line.exceedsMaxPerOrder,
  ).length;

  // Keep the snapshot in step with the live price after the first read, so the "price
  // changed" notice is shown once rather than on every page view.
  const livePriceByItem = new Map(lines.map((line) => [line.itemId, line.unitPriceMinor]));
  const changed = cart.items.filter((item) => item.unitPriceMinor !== livePriceByItem.get(item.id));
  await prisma.$transaction([
    ...changed.map((item) =>
      prisma.cartItem.update({
        where: { id: item.id },
        data: { unitPriceMinor: livePriceByItem.get(item.id) ?? item.unitPriceMinor },
      }),
    ),
    prisma.cart.update({
      where: { id: cart.id },
      data: {
        itemsCount: lines.reduce((sum, line) => sum + line.quantity, 0),
        subtotalMinor: lines.reduce((sum, line) => sum + line.lineTotalMinor, 0),
      },
    }),
  ]);

  return {
    cartId: cart.id,
    isGuest: !cart.userId,
    currency: lines[0]?.currency ?? null,
    couponCode: cart.coupon?.code ?? null,
    itemCount: lines.reduce((sum, line) => sum + line.quantity, 0),
    selectedCount: lines.filter((line) => line.selected).reduce((sum, line) => sum + line.quantity, 0),
    subtotalMinor: lines.reduce((sum, line) => sum + line.lineTotalMinor, 0),
    selectedSubtotalMinor: lines
      .filter((line) => line.selected)
      .reduce((sum, line) => sum + line.lineTotalMinor, 0),
    blockedLines,
    lines,
  };
}

/** The lines checkout will actually turn into orders. */
export function selectedLines(view: CartView): { variantId: string; quantity: number }[] {
  return view.lines.filter((line) => line.selected).map((line) => ({ variantId: line.variantId, quantity: line.quantity }));
}

export async function readCart(holder: CartHolder): Promise<CartView> {
  const cart = await findActiveCart(holder);
  if (!cart) {
    return {
      cartId: '',
      isGuest: !holder.userId,
      currency: null,
      couponCode: null,
      itemCount: 0,
      selectedCount: 0,
      subtotalMinor: 0,
      selectedSubtotalMinor: 0,
      blockedLines: 0,
      lines: [],
    };
  }
  return syncCart(cart.id);
}

export async function addToCart(holder: CartHolder, params: { variantId: string; quantity: number }): Promise<CartView> {
  const [variant] = await loadPurchasableVariants([params.variantId]);
  if (!variant) throw notFound('That item is no longer on sale');

  const cart = await getOrCreateCart(holder, variant.currency);

  // One basket cannot mix Ugandan and Kenyan sellers: the payment rails and courier
  // networks differ per country, so checkout would have to split anyway.
  if (cart.itemsCount > 0 && cart.currency !== variant.currency) {
    throw conflict(`This basket is in ${cart.currency}. Buy ${variant.currency} items in a separate basket.`);
  }

  const availableStock = variant.stockQuantity - variant.reservedQuantity;
  if (availableStock < 1) throw badRequest(`${variant.product.title} (${variant.name}) is sold out`);
  if (variant.maxQuantityPerOrder && params.quantity > variant.maxQuantityPerOrder) {
    throw badRequest(`Only ${variant.maxQuantityPerOrder} of ${variant.name} per order`);
  }

  const existingItem = await prisma.cartItem.findUnique({ where: { cartId_variantId: { cartId: cart.id, variantId: variant.id } } });
  const targetQuantity = (existingItem?.quantity ?? 0) + params.quantity;
  if (targetQuantity > availableStock) {
    throw badRequest(`Only ${availableStock} left of ${variant.product.title} (${variant.name})`);
  }
  if (variant.maxQuantityPerOrder && targetQuantity > variant.maxQuantityPerOrder) {
    throw badRequest(`Your basket can hold at most ${variant.maxQuantityPerOrder} of ${variant.name}`);
  }

  await prisma.cartItem.upsert({
    where: { cartId_variantId: { cartId: cart.id, variantId: variant.id } },
    update: { quantity: targetQuantity, selected: true, unitPriceMinor: variant.priceMinor },
    create: { cartId: cart.id, variantId: variant.id, quantity: params.quantity, unitPriceMinor: variant.priceMinor, currency: variant.currency },
  });

  return syncCart(cart.id);
}

export async function updateCartItem(
  holder: CartHolder,
  params: { itemId: string; quantity: number; selected?: boolean },
): Promise<CartView> {
  const cart = await findActiveCart(holder);
  if (!cart) throw notFound('Your basket is empty');

  const item = await prisma.cartItem.findFirst({
    where: { id: params.itemId, cartId: cart.id },
    include: { variant: { select: { stockQuantity: true, reservedQuantity: true, maxQuantityPerOrder: true, priceMinor: true } } },
  });
  if (!item) throw notFound('That item is not in your basket');

  if (params.selected === false) {
    await prisma.cartItem.update({ where: { id: item.id }, data: { selected: false } });
    return syncCart(cart.id);
  }

  const available = item.variant.stockQuantity - item.variant.reservedQuantity;
  if (params.quantity > available) {
    throw badRequest(`Only ${available} left — reduce the quantity or remove the item`);
  }
  if (item.variant.maxQuantityPerOrder && params.quantity > item.variant.maxQuantityPerOrder) {
    throw badRequest(`At most ${item.variant.maxQuantityPerOrder} per order`);
  }

  await prisma.cartItem.update({
    where: { id: item.id },
    data: { quantity: params.quantity, selected: true, unitPriceMinor: item.variant.priceMinor },
  });
  return syncCart(cart.id);
}

export async function removeCartItem(holder: CartHolder, itemId: string): Promise<CartView> {
  const cart = await findActiveCart(holder);
  if (!cart) throw notFound('Your basket is empty');
  const deleted = await prisma.cartItem.deleteMany({ where: { id: itemId, cartId: cart.id } });
  if (deleted.count === 0) throw notFound('That item is not in your basket');
  return syncCart(cart.id);
}

export async function clearCart(holder: CartHolder): Promise<CartView> {
  const cart = await findActiveCart(holder);
  if (!cart) return readCart(holder);
  await prisma.$transaction([
    prisma.cartItem.deleteMany({ where: { cartId: cart.id } }),
    prisma.cart.update({ where: { id: cart.id }, data: { couponId: null, itemsCount: 0, subtotalMinor: 0 } }),
  ]);
  return syncCart(cart.id);
}

export async function setSelectedAll(holder: CartHolder, selected: boolean): Promise<CartView> {
  const cart = await findActiveCart(holder);
  if (!cart) throw notFound('Your basket is empty');
  await prisma.cartItem.updateMany({ where: { cartId: cart.id }, data: { selected } });
  return syncCart(cart.id);
}

export async function setCartCoupon(holder: CartHolder, code: string): Promise<CartView> {
  const coupon = await prisma.coupon.findUnique({ where: { code } });
  if (!coupon) throw notFound('That coupon code is not recognised');
  const now = new Date();
  if (!coupon.isActive || now < coupon.startsAt || now > coupon.endsAt) {
    throw badRequest('That coupon is no longer active');
  }

  const cart = await getOrCreateCart(holder);
  await prisma.cart.update({ where: { id: cart.id }, data: { couponId: coupon.id } });
  return syncCart(cart.id);
}

export async function clearCartCoupon(holder: CartHolder): Promise<CartView> {
  const cart = await findActiveCart(holder);
  if (!cart) return readCart(holder);
  await prisma.cart.update({ where: { id: cart.id }, data: { couponId: null } });
  return syncCart(cart.id);
}

/**
 * Runs on the first authenticated request after sign-in. The guest basket is folded into
 * the user's basket (quantities summed, capped at live stock) and the guest cart is closed
 * so the cookie can be dropped.
 */
export async function mergeGuestCart(params: { guestToken: string; userId: string }): Promise<CartView> {
  const [guestCart, userCart] = await Promise.all([
    prisma.cart.findUnique({
      where: { guestToken: params.guestToken, status: 'ACTIVE' },
      include: { items: true },
    }),
    prisma.cart.findUnique({ where: { userId_status: { userId: params.userId, status: 'ACTIVE' } } }),
  ]);

  if (!guestCart || guestCart.items.length === 0) {
    if (guestCart) {
      await prisma.cart.update({ where: { id: guestCart.id }, data: { status: 'CONVERTED', guestToken: null } });
    }
    return userCart ? syncCart(userCart.id) : { cartId: '', isGuest: false, currency: null, couponCode: null, itemCount: 0, selectedCount: 0, subtotalMinor: 0, selectedSubtotalMinor: 0, blockedLines: 0, lines: [] };
  }

  const target = userCart ?? (await getOrCreateCart({ userId: params.userId }, guestCart.currency));

  const stockById = new Map<string, number>();
  if (guestCart.items.length > 0) {
    const variants = await prisma.productVariant.findMany({
      where: { id: { in: guestCart.items.map((item) => item.variantId) } },
      select: { id: true, stockQuantity: true, reservedQuantity: true, maxQuantityPerOrder: true },
    });
    for (const variant of variants) {
      stockById.set(variant.id, variant.stockQuantity - variant.reservedQuantity);
    }
  }

  const existingItems = await prisma.cartItem.findMany({ where: { cartId: target.id } });
  const byVariant = new Map(existingItems.map((item) => [item.variantId, item]));

  await prisma.$transaction(
    guestCart.items.map((item) => {
      const existing = byVariant.get(item.variantId);
      const available = stockById.get(item.variantId) ?? 0;
      const quantity = Math.max(1, Math.min((existing?.quantity ?? 0) + item.quantity, available));
      return prisma.cartItem.upsert({
        where: { cartId_variantId: { cartId: target.id, variantId: item.variantId } },
        update: { quantity, selected: true },
        create: {
          cartId: target.id,
          variantId: item.variantId,
          quantity,
          unitPriceMinor: item.unitPriceMinor,
          currency: item.currency,
          selected: true,
        },
      });
    }),
  );

  await prisma.cart.update({ where: { id: guestCart.id }, data: { status: 'CONVERTED', guestToken: null } });

  return syncCart(target.id);
}

/** Checkout closes the basket; a retry after failure reopens it by clearing CONVERTED items. */
export async function convertCart(cartId: string): Promise<void> {
  await prisma.cart.update({
    where: { id: cartId },
    data: { status: 'CONVERTED', couponId: null, itemsCount: 0, subtotalMinor: 0 },
  });
}
