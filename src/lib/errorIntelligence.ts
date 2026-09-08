import { supabase } from '@/lib/supabase';

type ErrorSource = 'rpc' | 'realtime' | 'edge_function' | 'cloudinary' | 'frontend' | 'network' | 'database' | 'other';
type ErrorSeverity = 'info' | 'warning' | 'error' | 'critical';

type ErrorReport = {
  source: ErrorSource;
  error: unknown;
  severity?: ErrorSeverity;
  context?: Record<string, unknown>;
  fingerprint?: string;
};

const recentFingerprints = new Map<string, number>();
const REPORT_TTL_MS = 30_000;

function toMessage(error: unknown) {
  if (error instanceof Error) return error.message;
  if (typeof error === 'string') return error;
  try { return JSON.stringify(error); } catch { return 'Unknown system error'; }
}

function toCode(error: unknown) {
  if (!error || typeof error !== 'object') return null;
  const value = error as { code?: unknown; status?: unknown };
  return value.code ? String(value.code) : value.status ? String(value.status) : null;
}

function cleanContext(context: Record<string, unknown> = {}) {
  const blocked = /token|authorization|password|secret|api[_-]?key/i;
  return Object.fromEntries(Object.entries(context).filter(([key]) => !blocked.test(key)));
}

export function reportSystemError({ source, error, severity = 'error', context = {}, fingerprint }: ErrorReport) {
  const message = toMessage(error).slice(0, 2000);
  const code = toCode(error);
  const key = fingerprint || `${source}|${code ?? ''}|${message.slice(0, 180)}`;
  const now = Date.now();
  const previous = recentFingerprints.get(key) ?? 0;
  if (now - previous < REPORT_TTL_MS) return;
  recentFingerprints.set(key, now);

  if (recentFingerprints.size > 200) {
    for (const [item, timestamp] of recentFingerprints) {
      if (now - timestamp > REPORT_TTL_MS) recentFingerprints.delete(item);
    }
  }

  void supabase.rpc('report_system_error', {
    p_source: source,
    p_error_code: code,
    p_error_message: message,
    p_severity: severity,
    p_context: cleanContext(context),
    p_path: typeof window !== 'undefined' ? window.location.pathname : null,
    p_fingerprint: key.slice(0, 128),
  }).catch(() => {
    // Error telemetry must never trigger another user-visible failure.
  });
}

export function initializeErrorIntelligence() {
  if (typeof window === 'undefined') return;

  window.addEventListener('error', (event) => {
    reportSystemError({
      source: 'frontend',
      error: event.error ?? event.message,
      severity: 'error',
      context: { filename: event.filename, line: event.lineno, column: event.colno },
    });
  });

  window.addEventListener('unhandledrejection', (event) => {
    reportSystemError({ source: 'frontend', error: event.reason, severity: 'error', context: { kind: 'unhandledrejection' } });
  });
}
