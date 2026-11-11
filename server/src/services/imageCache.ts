/**
 * Server-side image cache.
 *
 * The AI service generates recipe images via Wikipedia (real photos) and
 * Pollinations.AI (text-to-image fallback). Both work, but in practice:
 *
 *  - Pollinations URLs can be slow on the first request (5-15s while the
 *    image is generated) and may be intermittently unreachable from some
 *    networks / blocked by ad-blockers.
 *  - Wikipedia URLs are fast but their hosts (upload.wikimedia.org) are
 *    occasionally rate-limited.
 *
 * Browsers that fail to load these images render the broken-image alt-text
 * (the user sees a blank green card with the title text overlaid). That's
 * a poor UX.
 *
 * This module fetches each remote image once, stores it on disk under
 * `server/static/recipe-images/<sha1>.<ext>`, and returns a stable local
 * URL like `/static/recipe-images/<sha1>.jpg`. The server serves that
 * directory as static assets (see `app.ts`).
 *
 * Cached files are content-addressed by URL hash so re-running the cache
 * on the same URL is a no-op.
 */
import { createHash } from 'node:crypto';
import { promises as fs } from 'node:fs';
import path from 'node:path';
import { logger } from '../config/logger';

const ALLOWED_HOSTS = new Set([
  'image.pollinations.ai',
  'upload.wikimedia.org',
  'en.wikipedia.org',
  'commons.wikimedia.org',
]);

const ALLOWED_CONTENT_TYPES = new Set([
  'image/jpeg',
  'image/jpg',
  'image/png',
  'image/webp',
  'image/gif',
]);

// Resolve <repo>/server/static/recipe-images regardless of cwd.
// __dirname when running via tsx points to server/src/services, so we step
// up two levels to the server root.
const STATIC_ROOT = path.resolve(__dirname, '..', '..', 'static');
const IMAGE_DIR = path.join(STATIC_ROOT, 'recipe-images');
const PUBLIC_PREFIX = '/static/recipe-images';

const MAX_BYTES = 8 * 1024 * 1024; // 8 MB ceiling per image
const FETCH_TIMEOUT_MS = 30_000;

function extFromContentType(ct: string | null): string {
  switch ((ct ?? '').toLowerCase().split(';')[0]?.trim()) {
    case 'image/png':
      return '.png';
    case 'image/webp':
      return '.webp';
    case 'image/gif':
      return '.gif';
    case 'image/jpg':
    case 'image/jpeg':
    default:
      return '.jpg';
  }
}

async function ensureDir(): Promise<void> {
  await fs.mkdir(IMAGE_DIR, { recursive: true });
}

/**
 * Already-cached URLs share their hash so we can detect a hit without an
 * HTTP round-trip. Returns the local public URL if the file exists, else
 * null.
 */
async function findCached(hash: string): Promise<string | null> {
  for (const ext of ['.jpg', '.png', '.webp', '.gif']) {
    const file = path.join(IMAGE_DIR, hash + ext);
    try {
      const stat = await fs.stat(file);
      if (stat.isFile() && stat.size > 0) {
        return `${PUBLIC_PREFIX}/${hash}${ext}`;
      }
    } catch {
      /* not found, continue */
    }
  }
  return null;
}

/**
 * Download a remote image and store it locally.
 *
 * Returns the public local URL on success, or `null` if the URL is not on
 * the allow-list, the response isn't a valid image, or the download fails.
 * In all failure cases the original remote URL can still be used by the
 * caller as a fallback.
 *
 * Already-cached URLs short-circuit immediately.
 */
export async function cacheRemoteImage(remoteUrl: string): Promise<string | null> {
  if (!remoteUrl || typeof remoteUrl !== 'string') return null;
  // Already a local path? Nothing to do.
  if (remoteUrl.startsWith('/static/') || remoteUrl.startsWith('/')) return remoteUrl;

  let parsed: URL;
  try {
    parsed = new URL(remoteUrl);
  } catch {
    return null;
  }
  if (parsed.protocol !== 'https:' && parsed.protocol !== 'http:') return null;
  if (!ALLOWED_HOSTS.has(parsed.hostname)) {
    logger.debug({ host: parsed.hostname }, 'imageCache: host not in allow-list, skipping');
    return null;
  }

  const hash = createHash('sha1').update(remoteUrl).digest('hex').slice(0, 24);

  await ensureDir();
  const hit = await findCached(hash);
  if (hit) return hit;

  // Fetch with a hard timeout so a slow upstream doesn't stall the API call
  // that triggered the cache (e.g. POST /recipes/generate).
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), FETCH_TIMEOUT_MS);
  try {
    let currentUrl = remoteUrl;
    let resp: Response | null = null;
    const maxRedirects = 3;

    // Follow redirects manually to verify every hop against ALLOWED_HOSTS (SSRF mitigation)
    for (let hop = 0; hop <= maxRedirects; hop++) {
      let targetUrl: URL;
      try {
        targetUrl = new URL(currentUrl);
      } catch {
        return null;
      }
      if (targetUrl.protocol !== 'https:' && targetUrl.protocol !== 'http:') return null;
      if (!ALLOWED_HOSTS.has(targetUrl.hostname)) {
        logger.warn({ currentUrl, host: targetUrl.hostname }, 'imageCache: host not in allow-list, blocking');
        return null;
      }

      const candidateResp = await fetch(currentUrl, {
        signal: controller.signal,
        headers: {
          'User-Agent': 'MealMate-ImageCache/0.3 (+https://github.com/local)',
          Accept: 'image/*',
        },
        redirect: 'manual',
      });

      if ([301, 302, 303, 307, 308].includes(candidateResp.status)) {
        const loc = candidateResp.headers.get('location');
        if (!loc) return null;
        currentUrl = new URL(loc, currentUrl).toString();
        continue;
      }

      resp = candidateResp;
      break;
    }

    if (!resp || !resp.ok) {
      logger.info({ url: remoteUrl, status: resp?.status }, 'imageCache: upstream returned non-OK');
      return null;
    }
    const contentType = resp.headers.get('content-type');
    if (!contentType || !ALLOWED_CONTENT_TYPES.has(contentType.split(';')[0]?.trim().toLowerCase() ?? '')) {
      logger.info({ url: remoteUrl, contentType }, 'imageCache: unsupported content-type');
      return null;
    }
    const ab = await resp.arrayBuffer();
    if (ab.byteLength === 0 || ab.byteLength > MAX_BYTES) {
      logger.info({ url: remoteUrl, size: ab.byteLength }, 'imageCache: size out of bounds');
      return null;
    }
    const ext = extFromContentType(contentType);
    const fileName = `${hash}${ext}`;
    await fs.writeFile(path.join(IMAGE_DIR, fileName), Buffer.from(ab));
    return `${PUBLIC_PREFIX}/${fileName}`;
  } catch (err) {
    const reason = (err as Error)?.name === 'AbortError' ? 'timeout' : (err as Error)?.message;
    logger.warn({ url: remoteUrl, reason }, 'imageCache: download failed');
    return null;
  } finally {
    clearTimeout(timer);
  }
}

/**
 * Convenience helper: returns the cached URL if caching succeeds, else
 * falls back to the original remote URL. Use this when persisting a
 * recipe — the stored `imageUrl` will be a fast local path on success
 * and still functional (just slower) on failure.
 */
export async function cacheOrPassthrough(remoteUrl: string | null | undefined): Promise<string | null> {
  if (!remoteUrl) return null;
  const cached = await cacheRemoteImage(remoteUrl);
  return cached ?? remoteUrl;
}

export const IMAGE_CACHE_DIR = IMAGE_DIR;
export const IMAGE_CACHE_PUBLIC_PREFIX = PUBLIC_PREFIX;
export const IMAGE_CACHE_STATIC_ROOT = STATIC_ROOT;
