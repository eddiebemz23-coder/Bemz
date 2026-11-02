import 'server-only';
import { Prisma, prisma, type ReviewStatus } from '../prisma';
import { conflict, forbidden, notFound, unprocessable } from '../http';
import type { reviewQuerySchema, reviewSchema } from '../validation/catalog';
import type { z } from 'zod';

/**
 * Social proof: product and shop reviews, seller replies, helpful votes, moderation, and
 * the buyer Q&A thread.
 *
 * The one rule that keeps this credible in a market full of paid reviews is
 * `isVerifiedPurchase`: the badge is set by the server from a delivered order line, never
 * from anything the client sends. A review without it is still published — people who buy
 * in the shop physically deserve a voice — but the UI shows it as an unverified opinion.
 */

export type ReviewInput = z.infer<typeof reviewSchema>;

const reviewSelect = {
  id: true,
  targetType: true,
  productId: true,
  shopId: true,
  orderId: true,
  rating: true,
  title: true,
  body: true,
  images: true,
  isVerifiedPurchase: true,
  status: true,
  helpfulCount: true,
  sellerReply: true,
  sellerRepliedAt: true,
  createdAt: true,
  user: { select: { id: true, name: true, avatarUrl: true } },
} satisfies Prisma.ReviewSelect;

type ReviewRow = Prisma.ReviewGetPayload<{ select: typeof reviewSelect }>;

/** Names are trimmed to a first name + initial: a marketplace page is not a phone book. */
function displayName(name: string | null) {
  if (!name) return 'Bemz buyer';
  const parts = name.trim().split(/\s+/);
  return parts.length > 1 ? `${parts[0]} ${parts[parts.length - 1]!.slice(0, 1)}.` : parts[0]!;
}

function toReviewView(row: ReviewRow, viewerVoted?: boolean) {
  return {
    id: row.id,
    targetType: row.targetType,
    productId: row.productId,
    shopId: row.shopId,
    rating: row.rating,
    title: row.title,
    body: row.body,
    images: Array.isArray(row.images) ? (row.images as string[]) : [],
    isVerifiedPurchase: row.isVerifiedPurchase,
    helpfulCount: row.helpfulCount,
    sellerReply: row.sellerReply,
    sellerRepliedAt: row.sellerRepliedAt,
    createdAt: row.createdAt,
    author: {
      id: row.user.id,
      displayName: displayName(row.user.name),
      avatarUrl: row.user.avatarUrl,
    },
    votedHelpful: viewerVoted ?? false,
  };
}

/**
 * The purchase evidence behind a review: a delivered order line for this exact product
 * (or any line from this shop, for a shop review) owned by the reviewer.
 */
async function verifiedPurchaseEvidence(
  userId: string,
  params: { productId?: string; shopId?: string; orderId?: string },
) {
  const delivered = await prisma.order.findFirst({
    where: {
      buyerId: userId,
      status: 'DELIVERED',
      ...(params.orderId ? { id: params.orderId } : {}),
      ...(params.productId
        ? { items: { some: { productId: params.productId } } }
        : params.shopId
          ? { shopId: params.shopId }
          : {}),
    },
    select: { id: true, deliveredAt: true },
  });
  return delivered;
}

/**
 * `POST /api/reviews`
 *
 * The rating average shown on a listing is recomputed inside the same transaction, so two
 * simultaneous reviews cannot leave the product page advertising a stale 4.8.
 */
export async function createReview(userId: string, input: ReviewInput) {
  const productId = input.targetType === 'PRODUCT' ? input.productId : undefined;
  const shopId = input.targetType === 'SHOP' ? input.shopId : undefined;

  if (productId) {
    const product = await prisma.product.findUnique({
      where: { id: productId },
      select: { id: true, shopId: true, status: true, deletedAt: true, shop: { select: { ownerId: true } } },
    });
    if (!product || product.deletedAt) throw notFound('That item is no longer listed');
    // The trader writing their own five stars is the abuse this table exists to prevent.
    if (product.shop.ownerId === userId) throw unprocessable('You cannot review your own listing');

    const already = await prisma.review.findFirst({
      where: { userId, productId, targetType: 'PRODUCT', status: { not: 'REMOVED' } },
      select: { id: true },
    });
    if (already) throw conflict('You have already reviewed this item — edit your review instead');

    // An order id is optional, but when it is sent it must be the reviewer's own.
    if (input.orderId) await assertOwnOrder(userId, input.orderId);
  }

  if (shopId) {
    const shop = await prisma.shop.findUnique({ where: { id: shopId }, select: { id: true, status: true, ownerId: true } });
    if (!shop) throw notFound('That shop is not open');
    if (shop.ownerId === userId) throw unprocessable('You cannot review your own shop');

    const already = await prisma.review.findFirst({
      where: { userId, shopId, targetType: 'SHOP', status: { not: 'REMOVED' } },
      select: { id: true },
    });
    if (already) throw conflict('You already rated this shop');
  }

  const purchase = await verifiedPurchaseEvidence(userId, { productId, shopId, orderId: input.orderId });

  const review = await prisma.$transaction(async (tx) => {
    const created = await tx.review.create({
      data: {
        userId,
        targetType: input.targetType,
        productId: productId ?? null,
        shopId: shopId ?? null,
        orderId: purchase?.id ?? null,
        rating: input.rating,
        title: input.title ?? null,
        body: input.body,
        images: input.images,
        // Anything else is a client claiming a badge it has not earned.
        isVerifiedPurchase: purchase !== null,
        status: 'PUBLISHED',
      },
      select: reviewSelect,
    });

    if (productId) await recalculateProductRating(tx, productId);
    if (shopId) await recalculateShopRating(tx, shopId);

    return created;
  });

  return toReviewView(review);
}

/** `PUBLISHED` only — a removed review must stop bending the average. */
export async function recalculateProductRating(tx: Prisma.TransactionClient, productId: string) {
  const stats = await tx.review.aggregate({
    where: { productId, targetType: 'PRODUCT', status: 'PUBLISHED' },
    _avg: { rating: true },
    _count: { _all: true },
  });

  await tx.product.update({
    where: { id: productId },
    data: {
      ratingAvg: stats._count._all === 0 ? null : new Prisma.Decimal(stats._avg.rating ?? 0).toDecimalPlaces(2),
      ratingCount: stats._count._all,
    },
  });
}

export async function recalculateShopRating(tx: Prisma.TransactionClient, shopId: string) {
  const stats = await tx.review.aggregate({
    where: { shopId, targetType: 'SHOP', status: 'PUBLISHED' },
    _avg: { rating: true },
    _count: { _all: true },
  });

  await tx.shop.update({
    where: { id: shopId },
    data: {
      ratingAvg: stats._count._all === 0 ? null : new Prisma.Decimal(stats._avg.rating ?? 0).toDecimalPlaces(2),
      ratingCount: stats._count._all,
    },
  });
}

async function assertOwnOrder(userId: string, orderId: string) {
  const order = await prisma.order.findFirst({ where: { id: orderId, buyerId: userId }, select: { id: true } });
  if (!order) throw forbidden('That order does not belong to you');
}

function filterWhere(filter: z.infer<typeof reviewQuerySchema>['filter']) {
  switch (filter) {
    case 'verified':
      return { isVerifiedPurchase: true } as Prisma.ReviewWhereInput;
    case 'with_photos':
      // `images` is a JSONB array defaulting to `[]`, so "has photos" means "not empty".
      return { images: { not: { equals: [] } } } as Prisma.ReviewWhereInput;
    case '5':
    case '4':
    case '3':
    case '2':
    case '1':
      return { rating: Number(filter) } as Prisma.ReviewWhereInput;
    default:
      return {} as Prisma.ReviewWhereInput;
  }
}

/**
 * `GET /api/products/[id]/reviews`
 *
 * Sorted by helpfulness then recency, so the top of the thread is what other buyers found
 * useful rather than whatever landed last.
 */
export async function listProductReviews(productId: string, query: z.infer<typeof reviewQuerySchema>, viewerId?: string) {
  const where: Prisma.ReviewWhereInput = { productId, targetType: 'PRODUCT', status: 'PUBLISHED', ...filterWhere(query.filter) };

  const [total, rows, breakdown] = await Promise.all([
    prisma.review.count({ where }),
    prisma.review.findMany({
      where,
      select: reviewSelect,
      orderBy: [{ helpfulCount: 'desc' }, { createdAt: 'desc' }],
      skip: (query.page - 1) * query.perPage,
      take: query.perPage,
    }),
    prisma.review.groupBy({
      by: ['rating'],
      where: { productId, targetType: 'PRODUCT', status: 'PUBLISHED' },
      _count: { _all: true },
    }),
  ]);

  const votes = viewerId ? await loadVotes(viewerId, rows.map((row) => row.id)) : new Set<string>();

  // The summary always describes every published review, not just the current filter slice.
  const verifiedCount = await prisma.review.count({
    where: { productId, targetType: 'PRODUCT', status: 'PUBLISHED', isVerifiedPurchase: true },
  });

  return {
    items: rows.map((row) => toReviewView(row, votes.has(row.id))),
    total,
    page: query.page,
    perPage: query.perPage,
    hasMore: query.page * query.perPage < total,
    summary: summarise(breakdown, verifiedCount),
  };
}

/** `GET /api/shops/[shopId]/reviews` — the shop page's rating tab. */
export async function listShopReviews(shopId: string, query: z.infer<typeof reviewQuerySchema>, viewerId?: string) {
  const where: Prisma.ReviewWhereInput = { shopId, targetType: 'SHOP', status: 'PUBLISHED', ...filterWhere(query.filter) };

  const [total, rows, breakdown] = await Promise.all([
    prisma.review.count({ where }),
    prisma.review.findMany({
      where,
      select: reviewSelect,
      orderBy: [{ helpfulCount: 'desc' }, { createdAt: 'desc' }],
      skip: (query.page - 1) * query.perPage,
      take: query.perPage,
    }),
    prisma.review.groupBy({ by: ['rating'], where: { shopId, targetType: 'SHOP', status: 'PUBLISHED' }, _count: { _all: true } }),
  ]);

  const votes = viewerId ? await loadVotes(viewerId, rows.map((row) => row.id)) : new Set<string>();

  const verifiedCount = await prisma.review.count({
    where: { shopId, targetType: 'SHOP', status: 'PUBLISHED', isVerifiedPurchase: true },
  });

  return {
    items: rows.map((row) => toReviewView(row, votes.has(row.id))),
    total,
    page: query.page,
    perPage: query.perPage,
    hasMore: query.page * query.perPage < total,
    summary: summarise(breakdown, verifiedCount),
  };
}

/**
 * One summary shape for both review threads.
 *
 * A product thread and a shop thread that report different JSON would mean two components for the
 * same star bars; the `breakdown` always covers every published review, so the filter chips sit on
 * top of a stable average instead of silently rewriting it.
 */
function summarise(
  breakdown: { rating: number; _count: { _all: number } }[],
  verifiedCount: number,
) {
  const published = breakdown.reduce((sum, row) => sum + row._count._all, 0);
  const weighted = breakdown.reduce((sum, row) => sum + row.rating * row._count._all, 0);

  return {
    average: published === 0 ? null : round2(weighted / published),
    count: published,
    verifiedCount,
    breakdown: [5, 4, 3, 2, 1].map((star) => ({
      rating: star,
      count: breakdown.find((row) => row.rating === star)?._count._all ?? 0,
    })),
  };
}

async function loadVotes(userId: string, reviewIds: string[]): Promise<Set<string>> {
  if (reviewIds.length === 0) return new Set();
  const votes = await prisma.reviewVote.findMany({
    where: { userId, reviewId: { in: reviewIds }, helpful: true },
    select: { reviewId: true },
  });
  return new Set(votes.map((vote) => vote.reviewId));
}

const round2 = (value: number) => Math.round(value * 100) / 100;

/**
 * `POST /api/reviews/[id]/helpful` — idempotent per person.
 *
 * Re-tapping undoes the vote rather than erroring, because a buyer who misclicks should be
 * able to fix it without a support ticket.
 */
export async function voteHelpful(userId: string, reviewId: string) {
  const review = await prisma.review.findUnique({ where: { id: reviewId }, select: { id: true, status: true } });
  if (!review || review.status !== 'PUBLISHED') throw notFound('That review is not published');

  const existing = await prisma.reviewVote.findUnique({
    where: { reviewId_userId: { reviewId, userId } },
    select: { id: true, helpful: true },
  });

  return prisma.$transaction(async (tx) => {
    if (existing?.helpful) {
      await tx.reviewVote.delete({ where: { id: existing.id } });
      const decremented = await tx.review.update({
        where: { id: reviewId },
        data: { helpfulCount: { decrement: 1 } },
        select: { helpfulCount: true },
      });
      return { helpfulCount: Math.max(0, decremented.helpfulCount), voted: false };
    }

    if (existing) {
      await tx.reviewVote.update({ where: { id: existing.id }, data: { helpful: true } });
    } else {
      await tx.reviewVote.create({ data: { reviewId, userId, helpful: true } });
    }
    const incremented = await tx.review.update({
      where: { id: reviewId },
      data: { helpfulCount: { increment: 1 } },
      select: { helpfulCount: true },
    });
    return { helpfulCount: incremented.helpfulCount, voted: true };
  });
}

/**
 * `PATCH /api/reviews/[id]` — the author's own edit.
 *
 * Editing resets nothing but the content and the rating; the verified badge stays, because
 * the purchase evidence has not changed.
 */
export async function editReview(userId: string, reviewId: string, patch: { rating: number; title?: string | null; body: string }) {
  const review = await prisma.review.findUnique({
    where: { id: reviewId },
    select: { id: true, userId: true, productId: true, shopId: true, targetType: true, status: true },
  });
  if (!review) throw notFound('Review not found');
  if (review.userId !== userId) throw forbidden('Only the author can edit this review');
  if (review.status === 'REMOVED') throw conflict('Support removed this review — contact us to restore it');

  const updated = await prisma.$transaction(async (tx) => {
    const row = await tx.review.update({
      where: { id: reviewId },
      data: { rating: patch.rating, title: patch.title ?? null, body: patch.body },
      select: reviewSelect,
    });
    if (row.productId) await recalculateProductRating(tx, row.productId);
    if (row.shopId && row.targetType === 'SHOP') await recalculateShopRating(tx, row.shopId);
    return row;
  });

  return toReviewView(updated);
}

/** `DELETE /api/reviews/[id]` — the author withdraws it; the average is rebuilt. */
export async function deleteOwnReview(userId: string, reviewId: string) {
  const review = await prisma.review.findUnique({
    where: { id: reviewId },
    select: { id: true, userId: true, productId: true, shopId: true, targetType: true },
  });
  if (!review) throw notFound('Review not found');
  if (review.userId !== userId) throw forbidden('Only the author can remove this review');

  await prisma.$transaction(async (tx) => {
    await tx.review.delete({ where: { id: reviewId } });
    if (review.productId) await recalculateProductRating(tx, review.productId);
    if (review.shopId && review.targetType === 'SHOP') await recalculateShopRating(tx, review.shopId);
  });

  return { removed: true };
}

/**
 * `POST /api/seller/reviews/[id]/reply`
 *
 * One public reply per review, editable while it stands. A seller may only answer for their
 * own shop, which is why this takes the resolved shop rather than trusting an id in the body.
 */
export async function replyAsSeller(shop: { id: string }, reviewId: string, reply: string) {
  const review = await prisma.review.findUnique({
    where: { id: reviewId },
    select: { id: true, targetType: true, shopId: true, productId: true, product: { select: { shopId: true } } },
  });
  if (!review) throw notFound('Review not found');

  const owningShopId = review.targetType === 'SHOP' ? review.shopId : review.product?.shopId ?? null;
  if (owningShopId !== shop.id) throw forbidden('That review belongs to another shop');

  return prisma.review.update({
    where: { id: reviewId },
    data: { sellerReply: reply, sellerRepliedAt: new Date() },
    select: { id: true, sellerReply: true, sellerRepliedAt: true, rating: true, body: true },
  });
}

/** The seller's un-answered reviews — the queue that costs a shop its rating. */
export async function shopReviewsToAnswer(shopId: string, limit = 20) {
  const rows = await prisma.review.findMany({
    where: {
      sellerReply: null,
      status: 'PUBLISHED',
      OR: [{ targetType: 'SHOP', shopId }, { targetType: 'PRODUCT', product: { shopId } }],
    },
    select: {
      ...reviewSelect,
      product: { select: { id: true, title: true, slug: true } },
    },
    orderBy: [{ createdAt: 'desc' }],
    take: limit,
  });

  return rows.map((row) => ({
    ...toReviewView(row),
    product: row.product ? { id: row.product.id, title: row.product.title, slug: row.product.slug } : null,
  }));
}

/**
 * `POST /api/admin/reviews/[id]/moderate`
 *
 * Removal is a status change, not a delete: the text has to stay for the dispute trail, and
 * restoring a wrongly-removed review must not require the buyer to retype it.
 */
export async function moderateReview(
  reviewId: string,
  params: { decision: 'PUBLISH' | 'REMOVE' | 'HOLD'; reason?: string; actorId: string },
) {
  const review = await prisma.review.findUnique({
    where: { id: reviewId },
    select: { id: true, status: true, productId: true, shopId: true, targetType: true, userId: true },
  });
  if (!review) throw notFound('Review not found');

  const status: ReviewStatus =
    params.decision === 'PUBLISH' ? 'PUBLISHED' : params.decision === 'REMOVE' ? 'REMOVED' : 'PENDING';

  await prisma.$transaction(async (tx) => {
    await tx.review.update({
      where: { id: reviewId },
      data: { status, rejectionReason: status === 'REMOVED' ? params.reason ?? null : null },
    });
    if (review.productId) await recalculateProductRating(tx, review.productId);
    if (review.shopId && review.targetType === 'SHOP') await recalculateShopRating(tx, review.shopId);

    await tx.auditLog.create({
      data: {
        actorId: params.actorId,
        action: status === 'REMOVED' ? 'REVIEW_REMOVE' : 'REVIEW_PUBLISH',
        entity: 'REVIEW',
        entityId: reviewId,
        reason: params.reason,
        before: { status: review.status },
        after: { status },
      },
    });

    // The buyer is told either way — a review that silently disappears reads as censorship.
    await tx.notification.create({
      data: {
        userId: review.userId,
        channel: 'IN_APP',
        status: 'SENT',
        template: status === 'REMOVED' ? 'review_removed' : 'review_published',
        title: status === 'REMOVED' ? 'Your review was hidden' : 'Your review is live',
        body: status === 'REMOVED' ? params.reason ?? 'It broke our community rules.' : 'Thanks for helping other buyers.',
        data: { reviewId },
        sentAt: new Date(),
      },
    });
  });

  return { id: reviewId, status };
}

/**
 * `POST /api/products/[id]/questions` and the answer thread.
 *
 * A buyer asks in public; only the shop that owns the listing may answer it, and the badge
 * tells the difference between the seller and another buyer trying to help.
 */
export async function askQuestion(userId: string, productId: string, body: string) {
  const product = await prisma.product.findUnique({ where: { id: productId }, select: { id: true, status: true, deletedAt: true } });
  if (!product || product.deletedAt || product.status !== 'ACTIVE') throw notFound('That item is no longer listed');

  const existing = await prisma.productQuestion.findFirst({
    where: { userId, productId, body },
    select: { id: true },
  });
  if (existing) throw conflict('You already asked that');

  return prisma.productQuestion.create({
    data: { userId, productId, body },
    select: {
      id: true,
      body: true,
      createdAt: true,
      answers: { select: { id: true, body: true, isFromSeller: true, createdAt: true } },
    },
  });
}

export async function answerQuestion(params: { shopId: string; questionId: string; body: string; userId: string }) {
  const question = await prisma.productQuestion.findUnique({
    where: { id: params.questionId },
    select: { id: true, productId: true, product: { select: { shopId: true } } },
  });
  if (!question) throw notFound('That question does not exist');
  if (question.product.shopId !== params.shopId) throw forbidden('That listing belongs to another shop');

  return prisma.productAnswer.create({
    data: {
      questionId: params.questionId,
      responderId: params.userId,
      body: params.body,
      isFromSeller: true,
    },
    select: { id: true, body: true, isFromSeller: true, createdAt: true },
  });
}

/**
 * `GET /api/products/[id]/questions`
 *
 * Questions with answers first: an unanswered pile tells a buyer nothing, while the answered
 * thread is the content that actually converts.
 */
export async function listQuestions(productId: string) {
  const rows = await prisma.productQuestion.findMany({
    where: { productId },
    select: {
      id: true,
      body: true,
      createdAt: true,
      user: { select: { name: true } },
      answers: {
        orderBy: { createdAt: 'asc' },
        select: { id: true, body: true, isFromSeller: true, createdAt: true, responder: { select: { name: true } } },
      },
    },
    orderBy: { createdAt: 'desc' },
    take: 50,
  });

  return rows
    .map((row) => ({
      id: row.id,
      body: row.body,
      createdAt: row.createdAt,
      askedBy: displayName(row.user.name),
      answers: row.answers.map((answer) => ({
        id: answer.id,
        body: answer.body,
        isFromSeller: answer.isFromSeller,
        createdAt: answer.createdAt,
        answeredBy: answer.isFromSeller ? 'The seller' : displayName(answer.responder.name),
      })),
    }))
    .sort((a, b) => Number(b.answers.length > 0) - Number(a.answers.length > 0));
}

/**
 * `GET /api/seller/questions`
 *
 * Unanswered first: a question left sitting on a listing costs the seller the sale that is
 * happening right now, while the answered ones are already doing their job.
 */
export async function shopQuestions(shopId: string, params: { unansweredOnly: boolean; perPage: number }) {
  const rows = await prisma.productQuestion.findMany({
    where: {
      product: { shopId, deletedAt: null },
      ...(params.unansweredOnly ? { answers: { none: { isFromSeller: true } } } : {}),
    },
    select: {
      id: true,
      body: true,
      createdAt: true,
      user: { select: { name: true } },
      product: { select: { id: true, title: true, slug: true } },
      answers: {
        orderBy: { createdAt: 'asc' },
        select: { id: true, body: true, isFromSeller: true, createdAt: true },
      },
    },
    orderBy: { createdAt: 'desc' },
    take: params.perPage,
  });

  return rows.map((row) => ({
    id: row.id,
    body: row.body,
    createdAt: row.createdAt,
    askedBy: displayName(row.user.name),
    product: { id: row.product.id, title: row.product.title, slug: row.product.slug },
    answers: row.answers.map((answer) => ({
      id: answer.id,
      body: answer.body,
      isFromSeller: answer.isFromSeller,
      createdAt: answer.createdAt,
    })),
    needsSellerAnswer: !row.answers.some((answer) => answer.isFromSeller),
  }));
}

/**
 * The "rate your purchase" strip on the account page.
 *
 * Only delivered orders surface here, and only lines the buyer has not already reviewed —
 * otherwise the same phone keeps nagging about a mat they bought in March.
 */
export async function pendingReviewTargets(userId: string, limit = 8) {
  const orders = await prisma.order.findMany({
    where: { buyerId: userId, status: 'DELIVERED' },
    select: {
      id: true,
      deliveredAt: true,
      shop: { select: { id: true, name: true, slug: true, logoUrl: true } },
      items: { select: { productId: true, productTitle: true, imageUrl: true, variantName: true } },
    },
    orderBy: { deliveredAt: 'desc' },
    take: 30,
  });

  const productIds = [...new Set(orders.flatMap((order) => order.items.map((item) => item.productId)))];
  const reviewed = productIds.length
    ? await prisma.review.findMany({
        where: { userId, productId: { in: productIds }, targetType: 'PRODUCT', status: { not: 'REMOVED' } },
        select: { productId: true },
      })
    : [];
  const reviewedSet = new Set(reviewed.map((row) => row.productId));

  const targets: { orderId: string; productId: string; title: string; imageUrl: string | null; variantName: string; deliveredAt: Date | null; shop: { id: string; name: string; slug: string; logoUrl: string | null } }[] = [];
  for (const order of orders) {
    for (const item of order.items) {
      if (reviewedSet.has(item.productId)) continue;
      targets.push({
        orderId: order.id,
        productId: item.productId,
        title: item.productTitle,
        imageUrl: item.imageUrl,
        variantName: item.variantName,
        deliveredAt: order.deliveredAt,
        shop: order.shop,
      });
      if (targets.length >= limit) return targets;
    }
  }
  return targets;
}

/** Admin queue: reviews flagged or held for a first look. */export async function reviewModerationQueue(params: { status?: 'PENDING' | 'PUBLISHED' | 'REMOVED'; page: number; perPage: number }) {
  const where: Prisma.ReviewWhereInput = params.status ? { status: params.status } : { status: 'PENDING' };

  const [total, rows] = await Promise.all([
    prisma.review.count({ where }),
    prisma.review.findMany({
      where,
      select: {
        ...reviewSelect,
        product: { select: { id: true, title: true, slug: true, shopId: true } },
        shop: { select: { id: true, name: true } },
      },
      orderBy: { createdAt: 'desc' },
      skip: (params.page - 1) * params.perPage,
      take: params.perPage,
    }),
  ]);

  return {
    items: rows.map((row) => ({
      ...toReviewView(row),
      product: row.product ? { id: row.product.id, title: row.product.title, slug: row.product.slug } : null,
      shop: row.shop ? { id: row.shop.id, name: row.shop.name } : null,
    })),
    total,
    page: params.page,
    perPage: params.perPage,
    hasMore: params.page * params.perPage < total,
  };
}
