/// <reference types="vite/client" />

interface ImportMetaEnv {
  // Optional: unset in production (the client uses same-origin /api), set
  // in local dev to point at the API server (see .env.example).
  readonly VITE_API_URL?: string;
  readonly VITE_AI_SERVICE_URL?: string;
}

interface ImportMeta {
  readonly env: ImportMetaEnv;
}
