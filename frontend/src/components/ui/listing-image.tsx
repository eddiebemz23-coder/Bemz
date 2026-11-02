import Image from 'next/image';
import { cn } from '@/lib/cn';

/**
 * Product media comes from Cloudinary (and, on a freshly seeded database, from the seed
 * placeholder host) — both are allow-listed in `next.config.mjs`, so this is the only place
 * that decides how a listing image is sized.
 */
export function ListingImage({
  src,
  alt,
  className,
  sizes = '(min-width: 1024px) 20vw, (min-width: 640px) 33vw, 50vw',
  priority = false,
}: {
  src: string | null | undefined;
  alt: string;
  className?: string;
  sizes?: string;
  priority?: boolean;
}) {
  if (!src) {
    return (
      <div className={cn('flex items-center justify-center bg-ink-100 text-xs text-ink-400', className)}>
        No photo
      </div>
    );
  }

  return (
    <div className={cn('relative overflow-hidden bg-ink-100', className)}>
      <Image
        src={src}
        alt={alt}
        fill
        sizes={sizes}
        priority={priority}
        loading={priority ? undefined : 'lazy'}
        className="object-contain"
      />
    </div>
  );
}
