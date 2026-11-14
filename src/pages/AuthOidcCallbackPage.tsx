import { useEffect, useState } from 'react';

type CallbackMessage = {
  source: 'sykabelajar-better-auth-oidc';
  state: string;
  code: string | null;
  issuer: string | null;
  error: string | null;
};

/**
 * Dedicated OAuth callback page for the in-memory PKCE broker.
 * It sends only the short-lived authorization code and state to its parent.
 * The PKCE verifier and all access tokens remain in the parent window memory.
 */
export function AuthOidcCallbackPage() {
  const [status, setStatus] = useState('Memproses callback autentikasi…');

  useEffect(() => {
    const params = new URLSearchParams(window.location.search);
    const message: CallbackMessage = {
      source: 'sykabelajar-better-auth-oidc',
      state: params.get('state') ?? '',
      code: params.get('code'),
      issuer: params.get('iss'),
      error: params.get('error'),
    };

    if (window.parent !== window && message.state) {
      // The parent accepts this message only from the exact registered callback
      // origin and the iframe instance it created. The code is PKCE-bound.
      window.parent.postMessage(message, window.location.origin);
      setStatus('Autentikasi diteruskan dengan aman.');
      return;
    }

    setStatus('Callback autentikasi tidak lengkap. Silakan kembali ke aplikasi.');
  }, []);

  return (
    <main className="min-h-screen surface-bg flex items-center justify-center px-4">
      <p className="text-sm text-fg-muted" role="status" aria-live="polite">{status}</p>
    </main>
  );
}
