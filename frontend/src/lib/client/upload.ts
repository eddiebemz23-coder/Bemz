import { api, ApiFailure } from '@/lib/client/api';
import type { UploadTicket, UploadedAsset } from '@/lib/client/types';

/**
 * Photos go straight from the browser to Cloudinary with a signed ticket. Routing them through
 * a Next.js handler would mean a seller on 3G uploads the same 4 MB twice — and the platform
 * pays for the bandwidth on both hops.
 */
export async function uploadMedia(
  file: File,
  params: { target: 'product' | 'shop' | 'kyc'; shopId?: string },
): Promise<UploadedAsset> {
  const ticket = await api.post<UploadTicket>('/api/uploads/sign', {
    target: params.target,
    ...(params.shopId ? { shopId: params.shopId } : {}),
  });

  if (file.size > ticket.maxSizeMb * 1024 * 1024) {
    throw new ApiFailure(413, 'file_too_large', `That photo is too big — keep it under ${ticket.maxSizeMb} MB`);
  }
  if (!ticket.accepted.includes(file.type)) {
    throw new ApiFailure(415, 'unsupported_type', `Upload a ${ticket.accepted.map((type) => type.split('/')[1]).join(', ')} image`);
  }

  const publicId = `${ticket.publicIdHint}-${Math.random().toString(36).slice(2, 6)}`;

  const form = new FormData();
  form.append('api_key', ticket.apiKey);
  form.append('timestamp', String(ticket.timestamp));
  form.append('folder', ticket.folder);
  form.append('public_id', publicId);
  form.append('signature', ticket.signature);
  for (const [key, value] of Object.entries(ticket.extraFormFields)) form.append(key, value);
  form.append('file', file);

  const response = await fetch(ticket.endpoint, { method: 'POST', body: form });
  const payload = (await response.json().catch(() => null)) as { secure_url?: string; public_id?: string; width?: number; format?: string; error?: { message?: string } } | null;

  if (!response.ok || !payload?.secure_url) {
    throw new ApiFailure(502, 'upload_failed', payload?.error?.message ?? 'The upload did not finish — try again');
  }

  return { url: payload.secure_url, publicId: payload.public_id ?? publicId, width: payload.width ?? 0, format: payload.format ?? 'jpg' };
}
