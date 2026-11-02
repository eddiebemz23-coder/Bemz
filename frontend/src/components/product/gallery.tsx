'use client';

import { useState } from 'react';
import { cn } from '@/lib/cn';
import { ListingImage } from '@/components/ui/listing-image';

interface GalleryImage {
  url: string;
  altText: string | null;
}

/**
 * The listing gallery.
 *
 * The first frame is server-rendered inside this component, so the photo is visible before the
 * bundle arrives; the thumbnails are the enhancement. A variant's own photos are shown next to the
 * option picker in the buy box, where the buyer tapped them, rather than being spliced in here.
 */
export function ProductGallery({
  images,
  alt,
  priority = false,
}: {
  images: GalleryImage[];
  alt: string;
  priority?: boolean;
}) {
  const [active, setActive] = useState(0);
  const shown = images.slice(0, 8);
  const current = shown[active] ?? shown[0];

  if (shown.length === 0) {
    return (
      <div className="card p-0">
        <ListingImage src={null} alt={alt} className="aspect-square w-full" sizes="(min-width: 1024px) 45vw, 100vw" />
      </div>
    );
  }

  return (
    <div className="space-y-3">
      <div className="card overflow-hidden">
        <ListingImage
          key={current.url}
          src={current.url}
          alt={current.altText ?? alt}
          priority={priority}
          className="aspect-square w-full bg-white"
          sizes="(min-width: 1024px) 45vw, 100vw"
        />
      </div>

      {shown.length > 1 && (
        <ul className="flex flex-wrap gap-2">
          {shown.map((image, index) => (
            <li key={`${image.url}-${index}`}>
              <button
                type="button"
                onClick={() => setActive(index)}
                aria-label={`Show photo ${index + 1} of ${shown.length}`}
                aria-current={index === active}
                className={cn(
                  'block size-16 overflow-hidden rounded-lg border-2 transition-colors',
                  index === active ? 'border-bemz-600' : 'border-ink-200 hover:border-bemz-400',
                )}
              >
                <ListingImage src={image.url} alt="" className="size-full" sizes="64px" />
              </button>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
