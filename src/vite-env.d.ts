/// <reference types="vite/client" />

declare global {
  interface ImportMetaEnv {
    readonly VITE_AUTH_WORKER_URL?: string;
    readonly VITE_BETTER_AUTH_FRONTEND_ENABLED?: string;
  }

  interface ImportMeta {
    readonly env: ImportMetaEnv;
  }

  var toast: ((message: string, type?: 'success' | 'error' | 'info') => void) | undefined;
}

export {};
