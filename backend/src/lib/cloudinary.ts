import 'server-only';
import { v2 as cloudinary, type UploadApiResponse } from 'cloudinary';
import type { Readable } from 'node:stream';
import { env } from './env';
import { badRequest } from './http';

/**
 * Product photos and KYC documents both land in Cloudinary, but they are not the same
 * thing: product media is public and aggressively cached, KYC (national ID, tax PIN)
 * is private, signed and must never be indexed by a search engine.
 */

let configured = false;

function client() {
  const config = env();
  if (!config.CLOUDINARY_CLOUD_NAME || !config.CLOUDINARY_API_KEY || !config.CLOUDINARY_API_SECRET) {
    throw badRequest(
      'Image storage is not configured — set CLOUDINARY_CLOUD_NAME, CLOUDINARY_API_KEY and CLOUDINARY_API_SECRET',
    );
  }
  if (!configured) {
    cloudinary.config({
      cloud_name: config.CLOUDINARY_CLOUD_NAME,
      api_key: config.CLOUDINARY_API_KEY,
      api_secret: config.CLOUDINARY_API_SECRET,
      secure: true,
    });
    configured = true;
  }
  return cloudinary;
}

export type UploadTarget = 'product' | 'shop' | 'kyc';

const folderFor = (target: UploadTarget) => {
  const config = env();
  switch (target) {
    case 'product':
      return config.CLOUDINARY_PRODUCT_FOLDER;
    case 'shop':
      return `${config.CLOUDINARY_PRODUCT_FOLDER}/shops`;
    case 'kyc':
      return config.CLOUDINARY_KYC_FOLDER;
  }
};

/**
 * KYC uploads use `type: private` so the CDN refuses unsigned requests; product images
 * use `type: upload` (public, but only at URLs we hand out).
 */
export async function uploadStream(
  stream: Readable,
  params: { target: UploadTarget; publicId: string; folder?: string },
): Promise<{ url: string; publicId: string; width: number; format: string }> {
  const folder = params.folder ?? folderFor(params.target);

  const result = await new Promise<UploadApiResponse>((resolve, reject) => {
    const uploader = client().uploader
      .upload_stream(
        {
          folder,
          public_id: params.publicId,
          resource_type: 'image',
          type: params.target === 'kyc' ? 'private' : 'upload',
          overwrite: false,
          access_mode: params.target === 'kyc' ? 'authenticated' : 'public',
          // Sellers photograph products on mid-range Androids; this keeps listings under
          // ~120 KB on 3G without a separate image pipeline.
          transformation: [
            { width: 1200, height: 1200, crop: 'limit' },
            { quality: 'auto:good' },
            { fetch_format: 'auto' },
          ],
        },
        (error, uploadResult) => {
          if (error || !uploadResult) return reject(error ?? new Error('Cloudinary returned no result'));
          resolve(uploadResult);
        },
      );
    stream.pipe(uploader);
  });

  return {
    url: result.secure_url,
    publicId: result.public_id,
    width: result.width ?? 0,
    format: result.format ?? 'jpg',
  };
}

/**
 * Client-side direct upload needs a signed POST payload; the browser never sees the API
 * secret. `prefix` scopes the signature to one folder, so a leaked signature cannot be
 * used to write into another seller's media.
 */
export function signedUploadParams(params: { target: UploadTarget; prefix: string }) {
  const timestamp = Math.round(Date.now() / 1000);
  const folder = `${folderFor(params.target)}/${params.prefix}`;
  const signature = client().utils.api_sign_request({ folder, timestamp }, env().CLOUDINARY_API_SECRET ?? '');

  return {
    cloudName: env().CLOUDINARY_CLOUD_NAME,
    apiKey: env().CLOUDINARY_API_KEY,
    preset: env().CLOUDINARY_UPLOAD_PRESET,
    folder,
    timestamp,
    signature,
    endpoint: `https://api.cloudinary.com/v1_1/${env().CLOUDINARY_CLOUD_NAME}/image/upload`,
  };
}

/**
 * A KYC image is uploaded `type: private`, so its stored URL 403s on its own. This mints a
 * short-lived signed URL an admin can open in a browser: five minutes is long enough to read a
 * national ID and short enough that a leaked link is not an ongoing exposure.
 *
 * The format comes from the stored `secure_url` because the signed download URL Cloudinary
 * accepts has to name the extension the asset was uploaded with.
 */
export function signedViewUrl(params: { publicId: string; storedUrl: string }, expiresInSeconds = 300): string {
  const withoutQuery = params.storedUrl.split('?')[0] ?? params.storedUrl;
  const format = /\.([a-z0-9]{2,4})$/i.exec(withoutQuery)?.[1]?.toLowerCase() ?? 'jpg';

  return client().utils.private_download_url(params.publicId, format, {
    resource_type: 'image',
    type: 'private',
    expires_at: Math.round(Date.now() / 1000) + expiresInSeconds,
  });
}

export async function destroyAsset(publicId: string): Promise<boolean> {  if (!publicId) return false;
  const result = await client().uploader.destroy(publicId, { invalidate: true });
  return result.result === 'ok';
}

/** Deterministic public_id: `<folder>/<shopId>/<sha-like-slug>-<n>` keeps assets tidy per seller. */
export function buildPublicId(params: { target: UploadTarget; parts: string[]; index?: number }) {
  const sanitised = params.parts
    .filter(Boolean)
    .join('-')
    .toLowerCase()
    .replace(/[^a-z0-9_-]+/g, '-')
    .replace(/^-|-$/g, '');
  const suffix = params.index === undefined ? '' : `-${params.index}`;
  return `${sanitised}${suffix}-${Math.random().toString(36).slice(2, 8)}`;
}

/** Rewrites a stored URL to a sized variant for listing grids (avoids a second upload). */
export function thumbUrl(url: string, width = 300): string {
  if (!url.includes('/upload/')) return url;
  return url.replace('/upload/', `/upload/f_auto,q_auto,w_${width},c_limit/`);
}

export const isCloudinaryConfigured = () => {
  const config = env();
  return Boolean(
    config.CLOUDINARY_CLOUD_NAME && config.CLOUDINARY_API_KEY && config.CLOUDINARY_API_SECRET,
  );
};
