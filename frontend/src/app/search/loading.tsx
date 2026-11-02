import { ProductGridSkeleton } from '@/components/ui/skeleton';

/**
 * Shown while the search server component runs its count + page queries. A skeleton that matches
 * the grid keeps the page from jumping under a buyer's thumb on a slow cell connection.
 */
export default function SearchLoading() {
  return (
    <div className="container-page py-6">
      <div className="skeleton h-7 w-56" />
      <div className="mt-6 grid gap-6 lg:grid-cols-[240px_1fr]">
        <div className="hidden space-y-3 lg:block">
          <div className="skeleton h-6 w-32" />
          <div className="skeleton h-10 w-full" />
          <div className="skeleton h-10 w-full" />
          <div className="skeleton h-36 w-full" />
        </div>
        <ProductGridSkeleton />
      </div>
    </div>
  );
}
