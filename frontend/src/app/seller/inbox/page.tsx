import type { Metadata } from 'next';
import Link from 'next/link';
import { Inbox, MessageCircleQuestion, Star } from 'lucide-react';
import { sellerPage } from '@/lib/seller-page';
import { shopQuestions, shopReviewsToAnswer } from '@/lib/services/reviews';
import { formatRelative } from '@/lib/client/format';
import { Badge } from '@/components/ui/badge';
import { EmptyState } from '@/components/ui/empty-state';
import { Stars } from '@/components/ui/stars';
import { AnswerQuestionForm, ReplyToReviewForm } from '@/components/seller/inbox-forms';

/**
 * `GET /seller/inbox`
 *
 * Two piles, both of them public: a question a buyer asked on a listing and a review nobody has
 * answered. Neither is a private message — the platform has no seller-to-buyer chat, and the honest
 * version of this page is the one that says so rather than promising an inbox that cannot reply.
 */
export const dynamic = 'force-dynamic';

export const metadata: Metadata = { title: 'Questions and reviews · Bemz seller', robots: { index: false } };

export default async function SellerInboxPage() {
  const { shop } = await sellerPage('/seller/inbox');

  const [questions, reviews] = await Promise.all([shopQuestions(shop.id, { unansweredOnly: false, perPage: 40 }), shopReviewsToAnswer(shop.id, 30)]);

  const awaitingAnswer = questions.filter((question) => question.needsSellerAnswer);
  const answered = questions.filter((question) => !question.needsSellerAnswer);
  const lowStars = reviews.filter((review) => review.rating <= 3);

  return (
    <div className="space-y-6">
      <header>
        <h1 className="text-2xl font-bold text-ink-950">Questions and reviews</h1>
        <p className="mt-1 text-sm text-ink-600">
          {awaitingAnswer.length} {awaitingAnswer.length === 1 ? 'question is' : 'questions are'} still open ·{' '}
          {reviews.length} {reviews.length === 1 ? 'review has' : 'reviews have'} no reply from you
        </p>
        <p className="mt-2 max-w-2xl text-xs text-ink-500">
          Answers and replies appear on your public listing, next to your shop name. There is no private chat on Bemz —
          if a buyer needs to change something about an order, use the phone number on the order row.
        </p>
      </header>

      <section className="space-y-3">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <h2 className="text-sm font-semibold uppercase tracking-wide text-ink-500">Buyer questions</h2>
          {awaitingAnswer.length > 0 && <Badge tone="warning">{awaitingAnswer.length} need an answer</Badge>}
        </div>

        {questions.length === 0 ? (
          <EmptyState
            icon={<Inbox className="size-6" />}
            title="No one has asked about your listings yet"
            description="Questions show up here and on the listing itself, and your answer shows on both."
          />
        ) : (
          <ul className="space-y-3">
            {awaitingAnswer.map((question) => (
              <li key={question.id}>
                <QuestionRow shopSlug={shop.slug} question={question} />
              </li>
            ))}
            {answered.slice(0, 6).map((question) => (
              <li key={question.id}>
                <QuestionRow shopSlug={shop.slug} question={question} />
              </li>
            ))}
          </ul>
        )}

        {answered.length > 6 && (
          <p className="text-xs text-ink-500">{answered.length - 6} more answered questions are visible on your listings.</p>
        )}
      </section>

      <section className="space-y-3">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <h2 className="text-sm font-semibold uppercase tracking-wide text-ink-500">Reviews without a reply</h2>
          {lowStars.length > 0 && <Badge tone="danger">{lowStars.length} at three stars or fewer</Badge>}
        </div>

        {reviews.length === 0 ? (
          <EmptyState
            icon={<Star className="size-6" />}
            title="Every review has your reply"
            description="A reply under a low rating is the first thing the next buyer reads, so this is worth keeping up."
          />
        ) : (
          <ul className="space-y-3">
            {reviews
              .slice()
              .sort((a, b) => a.rating - b.rating)
              .map((review) => (
                <li key={review.id}>
                  <article className="card space-y-2 p-4">
                    <div className="flex flex-wrap items-center gap-2">
                      <Stars value={review.rating} />
                      <p className="text-sm font-medium text-ink-900">{review.author.displayName}</p>
                      {review.isVerifiedPurchase && <Badge tone="success">Verified purchase</Badge>}
                      <span className="ml-auto text-xs text-ink-500">{formatRelative(review.createdAt)}</span>
                    </div>

                    {review.title && <p className="text-sm font-semibold text-ink-900">{review.title}</p>}
                    <p className="text-sm text-ink-700">{review.body}</p>

                    <div className="flex flex-wrap items-center justify-between gap-2">
                      <p className="text-xs text-ink-500">
                        {review.targetType === 'SHOP' ? (
                          <>About <span className="font-medium">{shop.name}</span> as a shop</>
                        ) : review.product ? (
                          <>
                            On{' '}
                            <Link
                              href={`/product/${shop.slug}/${review.product.slug}`}
                              className="font-medium text-bemz-700 hover:underline"
                            >
                              {review.product.title}
                            </Link>
                          </>
                        ) : (
                          <>About a listing you have since deleted</>
                        )}
                        {review.helpfulCount > 0 && ` · ${review.helpfulCount} buyers found it helpful`}
                      </p>
                      <ReplyToReviewForm reviewId={review.id} rating={review.rating} />
                    </div>
                  </article>
                </li>
              ))}
          </ul>
        )}
      </section>
    </div>
  );
}

type Question = Awaited<ReturnType<typeof shopQuestions>>[number];

function QuestionRow({ question, shopSlug }: { question: Question; shopSlug: string }) {
  const sellerAnswer = question.answers.find((answer) => answer.isFromSeller) ?? null;

  return (
    <article className="card space-y-2 p-4">
      <div className="flex flex-wrap items-center gap-2">
        <MessageCircleQuestion className="size-4 text-ink-400" />
        <p className="text-sm font-medium text-ink-900">{question.askedBy}</p>
        <span className="text-xs text-ink-500">asked {formatRelative(question.createdAt)}</span>
        {question.needsSellerAnswer ? (
          <Badge tone="warning" className="ml-auto">
            Waiting for you
          </Badge>
        ) : (
          <Badge tone="success" className="ml-auto">
            Answered
          </Badge>
        )}
      </div>

      <p className="text-sm text-ink-800">{question.body}</p>

      <Link
        href={`/product/${shopSlug}/${question.product.slug}`}
        className="block truncate text-xs font-medium text-bemz-700 hover:underline"
      >
        {question.product.title}
      </Link>

      {sellerAnswer ? (
        <div className="rounded-card bg-bemz-50 p-3">
          <p className="text-xs font-semibold uppercase tracking-wide text-bemz-700">Your answer</p>
          <p className="mt-1 text-sm text-ink-800">{sellerAnswer.body}</p>
          <p className="mt-1 text-xs text-ink-500">posted {formatRelative(sellerAnswer.createdAt)}</p>
        </div>
      ) : (
        <div className="pt-1">
          <AnswerQuestionForm questionId={question.id} productTitle={question.product.title} />
        </div>
      )}

      {question.answers.filter((answer) => !answer.isFromSeller).length > 0 && (
        <ul className="space-y-1 border-t border-ink-100 pt-2">
          {question.answers
            .filter((answer) => !answer.isFromSeller)
            .map((answer) => (
              <li key={answer.id} className="text-xs text-ink-500">
                <span className="font-medium text-ink-700">Another buyer:</span> {answer.body}
              </li>
            ))}
        </ul>
      )}
    </article>
  );
}
