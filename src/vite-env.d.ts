/// <reference types="vite/client" />

declare global {
  var toast: ((message: string, type?: 'success' | 'error' | 'info') => void) | undefined;
}

export {};
