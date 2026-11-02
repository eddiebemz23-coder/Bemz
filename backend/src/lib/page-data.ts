import 'server-only';
import { notFound } from 'next/navigation';
import { ApiError } from './http';

/**
 * Catalog pages read through the same services the API does, so a missing category is a 404 in
 * both places. This is the one translation layer: a service `ApiError(404)` becomes Next's
 * not-found render, and every other failure keeps propagating to the nearest `error.tsx` where it
 * gets logged with the request id rather than being dressed up as an empty department.
 */
export async function pageData<T>(promise: Promise<T>): Promise<T> {
  try {
    return await promise;
  } catch (error) {
    if (error instanceof ApiError && error.status === 404) notFound();
    throw error;
  }
}
