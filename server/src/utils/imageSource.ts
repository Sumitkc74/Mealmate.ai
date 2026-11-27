/**
 * Where a recipe image came from, derived from its URL host.
 *
 * The AI service fetches real dish photos from Wikipedia/Wikimedia and
 * falls back to Pollinations.AI-generated images; users may also paste
 * their own image URLs. Wikimedia photos are CC-licensed and require
 * attribution, so the source is recorded on the recipe at write time
 * (before the image cache rewrites the URL to a local path) and shown
 * with the photo. A cached `/static/recipe-images/...` URL no longer
 * carries its origin, so it reports nothing here — the client falls back
 * to a generic cached-image note for those.
 */
export type ImageSource = 'wikimedia' | 'pollinations' | 'user';

const WIKIMEDIA_HOSTS = new Set([
  'upload.wikimedia.org',
  'commons.wikimedia.org',
  'en.wikipedia.org',
]);

export function deriveImageSource(imageUrl: string | null | undefined): ImageSource | undefined {
  if (!imageUrl || typeof imageUrl !== 'string') return undefined;
  // Already a cached local path: the origin was rewritten away.
  if (imageUrl.startsWith('/static/') || imageUrl.startsWith('/')) return undefined;
  let host: string;
  try {
    host = new URL(imageUrl).hostname.toLowerCase();
  } catch {
    return undefined;
  }
  if (WIKIMEDIA_HOSTS.has(host)) return 'wikimedia';
  if (host === 'image.pollinations.ai') return 'pollinations';
  return 'user';
}
