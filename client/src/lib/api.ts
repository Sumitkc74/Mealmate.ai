import axios, { AxiosError, type AxiosInstance } from 'axios';
import { useAuthStore } from '@/stores/authStore';

const baseURL = import.meta.env.VITE_API_URL ?? '/api';

/**
 * Resolve a recipe image URL for display. Absolute URLs (remote photos,
 * generated images) pass through unchanged. Server-relative paths such as
 * `/static/recipe-images/<hash>.jpg` are hosted by the API server, so they
 * must be resolved against the API origin — used verbatim they would hit
 * the Vercel origin instead, which answers with the SPA HTML and the image
 * silently fails to load.
 */
export function resolveImageUrl(url?: string | null): string | undefined {
  if (!url) return undefined;
  if (/^(https?:|data:|blob:)/i.test(url)) return url;
  if (url.startsWith('/')) {
    // Read at call time (not module load) so the value tracks the runtime env.
    const apiUrl = (import.meta.env.VITE_API_URL as string | undefined) ?? '/api';
    try {
      return new URL(apiUrl, window.location.origin).origin + url;
    } catch {
      return url;
    }
  }
  return url;
}

export const api: AxiosInstance = axios.create({
  baseURL,
  timeout: 15_000,
});

// Attach JWT to outgoing requests.
api.interceptors.request.use((config) => {
  const token = useAuthStore.getState().token;
  if (token) {
    config.headers.Authorization = `Bearer ${token}`;
  }
  return config;
});

// Auto-logout on 401 and surface a friendly message.
api.interceptors.response.use(
  (res) => res,
  (error: AxiosError<{ message?: string }>) => {
    if (error.response?.status === 401) {
      const { token, logout } = useAuthStore.getState();
      // Only force logout if we actually had a token (not for failed login attempts).
      if (token) logout();
    }
    return Promise.reject(error);
  }
);

export function extractErrorMessage(err: unknown, fallback = 'Something went wrong'): string {
  if (axios.isAxiosError(err)) {
    const data = err.response?.data as { message?: string; details?: unknown } | undefined;
    if (data?.message) return data.message;
    if (err.message) return err.message;
  }
  if (err instanceof Error) return err.message;
  return fallback;
}
