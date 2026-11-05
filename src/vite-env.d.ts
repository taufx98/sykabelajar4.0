/// <reference types="vite/client" />

declare global {
  interface ImportMetaEnv {
    readonly VITE_AUTH_WORKER_URL?: string;
  }

  interface ImportMeta {
    readonly env: ImportMetaEnv;
  }

  var toast: ((message: string, type?: 'success' | 'error' | 'info') => void) | undefined;
}

export {};
