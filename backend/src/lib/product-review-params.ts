import { z } from 'zod';
import { REVIEW_FILTERS } from '@/lib/validation/enums';

/**
 * Review paging on a listing or shop page travels in the URL (`?reviewFilter=4&reviewPage=2`),
 * because a buyer who wants "the one-star reviews of this phone" should be able to send that link
 * to somebody. These are the same values `reviewQuerySchema` accepts, so the page and
 * `GET /api/products/{shop}/{product}/reviews` cannot disagree about what `?reviewFilter=5` means.
 */
export const reviewParamsSchema = z.object({
  reviewFilter: z.enum(REVIEW_FILTERS).default('all'),
  reviewPage: z.coerce.number().int().min(1).default(1),
  reviewPerPage: z.coerce.number().int().min(1).max(50).default(10),
});

export interface ReviewParams {
  query: { filter: z.infer<typeof reviewParamsSchema>['reviewFilter']; page: number; perPage: number };
}

export function parseReviewParams(raw: Record<string, string | string[] | undefined>): ReviewParams {
  const flat: Record<string, string> = {};
  for (const [key, value] of Object.entries(raw)) {
    if (typeof value === 'string') flat[key] = value;
    else if (Array.isArray(value) && typeof value[0] === 'string') flat[key] = value[0];
  }

  const parsed = reviewParamsSchema.safeParse({
    reviewFilter: flat.reviewFilter,
    reviewPage: flat.reviewPage,
    reviewPerPage: flat.reviewPerPage,
  });

  if (!parsed.success) return { query: { filter: 'all', page: 1, perPage: 10 } };

  return {
    query: { filter: parsed.data.reviewFilter, page: parsed.data.reviewPage, perPage: parsed.data.reviewPerPage },
  };
}
