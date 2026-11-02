'use client';

import { useRef, useState } from 'react';
import { useRouter } from 'next/navigation';
import { ImageOff, Star } from 'lucide-react';
import { api, ApiFailure } from '@/lib/client/api';
import { uploadMedia } from '@/lib/client/upload';
import { sizedImage } from '@/lib/client/format';
import { Button } from '@/components/ui/button';
import { ListingImage } from '@/components/ui/listing-image';
import { useToast } from '@/components/toast';

export interface ListingPhotoSnapshot {
  id: string;
  url: string;
  publicId: string;
  altText: string | null;
  position: number;
  isPrimary: boolean;
}

const MAX_PHOTOS = 20;

/**
 * `POST /api/seller/products/{id}/images` and `DELETE /api/seller/images/{imageId}`
 *
 * Files go straight to Cloudinary on pick and are committed to the listing only once the URL is
 * real, so a dropped connection cannot leave a listing pointing at a photo that was never stored.
 * The photo with the lowest position is the cover; deleting the cover promotes the next one, so
 * a tile never renders "No photo" in a grid.
 */
export function ListingPhotos({ productId, shopId, images }: { productId: string; shopId: string; images: ListingPhotoSnapshot[] }) {
  const router = useRouter();
  const toast = useToast();
  const fileInput = useRef<HTMLInputElement>(null);

  const [uploading, setUploading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const remaining = MAX_PHOTOS - images.length;

  async function pick(files: FileList | null) {
    if (!files || files.length === 0) return;
    const chosen = [...files].slice(0, Math.max(0, remaining));
    if (chosen.length === 0) {
      setError(`A listing carries ${MAX_PHOTOS} photos. Delete one to replace it.`);
      return;
    }

    setUploading(true);
    setError(null);
    try {
      const uploaded = [];
      for (const file of chosen) {
        uploaded.push(await uploadMedia(file, { target: 'product', shopId }));
      }

      const startAt = images.reduce((max, image) => Math.max(max, image.position), -1) + 1;
      await api.post<ListingPhotoSnapshot[]>(`/api/seller/products/${productId}/images`, {
        images: uploaded.map((asset, index) => ({
          url: asset.url,
          publicId: asset.publicId,
          position: startAt + index,
        })),
      });

      toast.push(
        uploaded.length === 1 ? 'Photo added to the listing.' : `${uploaded.length} photos added to the listing.`,
        'success',
      );
      router.refresh();
    } catch (failure) {
      setError(failure instanceof ApiFailure ? failure.message : 'The upload did not finish — try again');
    } finally {
      setUploading(false);
      if (fileInput.current) fileInput.current.value = '';
    }
  }

  async function remove(image: ListingPhotoSnapshot) {
    setError(null);
    try {
      await api.del(`/api/seller/images/${image.id}`);
      toast.push('Photo removed.', 'success');
      router.refresh();
    } catch (failure) {
      setError(failure instanceof ApiFailure ? failure.message : 'Could not delete that photo');
    }
  }

  return (
    <section className="card space-y-4 p-5">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div>
          <h2 className="text-sm font-semibold uppercase tracking-wide text-ink-500">Photos</h2>
          <p className="mt-1 text-xs text-ink-500">
            {images.length}/{MAX_PHOTOS} · the first one is what buyers see in search
          </p>
        </div>
        <Button
          size="sm"
          variant="outline"
          loading={uploading}
          disabled={remaining <= 0}
          onClick={() => fileInput.current?.click()}
        >
          {uploading ? 'Uploading…' : remaining > 0 ? 'Add photos' : 'Photo limit reached'}
        </Button>
      </div>

      <input
        ref={fileInput}
        type="file"
        accept="image/jpeg,image/png,image/webp"
        multiple
        className="sr-only"
        onChange={(event) => void pick(event.target.files)}
      />

      {error && (
        <p role="alert" className="text-sm text-clay-700">
          {error}
        </p>
      )}

      {images.length === 0 ? (
        <div className="flex flex-col items-center gap-2 rounded-card bg-ink-50 px-4 py-10 text-center">
          <ImageOff className="size-6 text-ink-400" />
          <p className="text-sm text-ink-600">No photos yet — a listing without one gets almost no clicks.</p>
        </div>
      ) : (
        <ul className="grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-5">
          {images.map((image, index) => (
            <li key={image.id} className="space-y-2">
              <div className="relative">
                <ListingImage
                  src={sizedImage(image.url, 320)}
                  alt={image.altText ?? `${index + 1}`}
                  className="aspect-square rounded-card ring-1 ring-inset ring-ink-200"
                  sizes="(min-width: 1024px) 20vw, (min-width: 640px) 33vw, 50vw"
                />
                {image.isPrimary && (
                  <span className="absolute left-1.5 top-1.5 inline-flex items-center gap-1 rounded bg-bemz-600 px-1.5 py-0.5 text-[10px] font-semibold text-white">
                    <Star className="size-3" fill="currentColor" />
                    Cover
                  </span>
                )}
                <span className="tabular absolute bottom-1.5 right-1.5 rounded bg-white/90 px-1.5 text-[10px] text-ink-700">
                  #{index + 1}
                </span>
              </div>

              <div className="flex items-center justify-between gap-1">
                <p className="min-w-0 flex-1 truncate text-xs text-ink-500" title={image.altText ?? undefined}>
                  {image.altText ?? 'No caption'}
                </p>
                <Button size="sm" variant="ghost" className="text-clay-700" onClick={() => void remove(image)}>
                  Remove
                </Button>
              </div>
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}
