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
const MAX_STACK_LENGTH = 12_000;
const MAX_CONTEXT_DEPTH = 8;
const SENSITIVE_KEY = /token|authorization|password|secret|api[_-]?key|cookie|set-cookie|client_secret|private[_-]?key|access[_-]?token|refresh[_-]?token/i;
const BEARER_PATTERN = /\bBearer\s+[A-Za-z0-9._~+/=-]+/gi;
const JWT_PATTERN = /\beyJ[A-Za-z0-9_-]{8,}\.[A-Za-z0-9_-]{8,}\.[A-Za-z0-9_-]{8,}\b/g;

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

function toStack(error: unknown) {
  if (!(error instanceof Error) || !error.stack) return null;
  return error.stack.slice(0, MAX_STACK_LENGTH);
}

function cleanText(value: unknown, max = 500) {
  return String(value ?? '').slice(0, max).replace(BEARER_PATTERN, 'Bearer [REDACTED]').replace(JWT_PATTERN, '[REDACTED_JWT]');
}

function sanitizeValue(value: unknown, depth = 0): unknown {
  if (depth > MAX_CONTEXT_DEPTH) return '[MAX_DEPTH]';
  if (typeof value === 'string') return value.replace(BEARER_PATTERN, 'Bearer [REDACTED]').replace(JWT_PATTERN, '[REDACTED_JWT]');
  if (Array.isArray(value)) return value.slice(0, 100).map((item) => sanitizeValue(item, depth + 1));
  if (!value || typeof value !== 'object') return value;
  return Object.fromEntries(
    Object.entries(value)
      .slice(0, 200)
      .map(([key, item]) => [key, SENSITIVE_KEY.test(key) ? '[REDACTED]' : sanitizeValue(item, depth + 1)]),
  );
}

function cleanContext(context: Record<string, unknown> = {}) {
  return sanitizeValue(context) as Record<string, unknown>;
}

function safeUrl(value?: string | null) {
  if (!value) return null;
  try {
    const parsed = new URL(value);
    parsed.search = '';
    parsed.hash = '';
    return parsed.toString();
  } catch {
    return cleanText(value, 2000);
  }
}

function browserCapture() {
  if (typeof window === 'undefined') return null;
  try {
    return {
      captured_at: new Date().toISOString(),
      url: safeUrl(window.location.href),
      path: window.location.pathname,
      query_present: Boolean(window.location.search),
      hash_present: Boolean(window.location.hash),
      referrer: safeUrl(document.referrer),
      online: navigator.onLine,
      user_agent: navigator.userAgent,
      language: navigator.language,
      languages: Array.from(navigator.languages ?? []),
      timezone: Intl.DateTimeFormat().resolvedOptions().timeZone,
      viewport: {
        width: window.innerWidth,
        height: window.innerHeight,
        device_pixel_ratio: window.devicePixelRatio,
      },
      platform: navigator.platform || null,
    };
  } catch {
    return null;
  }
}

function errorDetails(error: unknown, code: string | null) {
  const details: Record<string, unknown> = {
    name: error instanceof Error ? error.name : typeof error,
    message: toMessage(error).slice(0, 2000),
    code,
  };
  const stack = toStack(error);
  if (stack) details.stack = stack;
  if (error && typeof error === 'object') {
    const value = error as Record<string, unknown>;
    for (const key of ['status', 'statusCode', 'details', 'hint', 'cause', 'reason']) {
      if (value[key] !== undefined) details[key] = sanitizeValue(value[key]);
    }
  }
  return details;
}

function sourceCapture(source: ErrorSource, context: Record<string, unknown>) {
  const target: Record<string, unknown> = { kind: source };
  const read = (...keys: string[]) => keys.map((key) => context[key]).find((value) => typeof value === 'string' && value.trim()) ?? null;
  if (source === 'realtime') {
    target.kind = 'realtime_channel';
    target.channel = read('channel', 'channel_name');
    target.schema = read('schema', 'schema_name') ?? 'public';
    target.table = read('table', 'table_name');
    target.event = read('event', 'event_type') ?? '*';
  } else if (source === 'edge_function') {
    target.kind = 'edge_function';
    target.function_name = read('functionName', 'function_name', 'function');
  } else if (source === 'cloudinary') {
    target.kind = 'cloudinary';
    target.provider = read('provider') ?? 'cloudinary';
    target.operation = read('operation');
  } else if (source === 'rpc') {
    target.kind = 'rpc';
    target.rpc_name = read('rpcName', 'rpc_name');
  } else if (source === 'frontend') {
    target.kind = 'frontend_runtime';
  }
  return target;
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

  const safeContext = cleanContext(context);
  const enrichedContext = cleanContext({
    ...safeContext,
    capture: browserCapture(),
    error_details: errorDetails(error, code),
    target: sourceCapture(source, safeContext),
    ai_handoff: {
      objective: 'Identify the root cause of this incident and provide the smallest safe fix.',
      evidence_available: ['error_details', 'context', 'browser_capture', 'target_metadata'],
      constraints: [
        'Do not expose or request secrets.',
        'Do not bypass authentication or RLS.',
        'Prefer verifying the failing target before changing production behavior.',
      ],
      success_criteria: [
        'The original failure no longer reproduces.',
        'The same target passes an admin diagnostic check.',
        'No unrelated user workflow is degraded.',
      ],
    },
  });

  void (async () => {
    try {
      await supabase.rpc('report_system_error', {
        p_source: source,
        p_error_code: code,
        p_error_message: message,
        p_severity: severity,
        p_context: enrichedContext,
        p_path: typeof window !== 'undefined' ? window.location.pathname : null,
        p_fingerprint: key.slice(0, 128),
      });
    } catch {
      // Error telemetry must never trigger another user-visible failure.
    }
  })();
}

export function reportCloudinaryError(error: unknown, context: Record<string, unknown> = {}) {
  const message = toMessage(error);
  const code = toCode(error);
  reportSystemError({
    source: 'cloudinary',
    error,
    severity: code === '401' || message.includes('(401)') ? 'error' : 'warning',
    context: { ...context, provider: 'cloudinary' },
  });
}

export function reportEdgeFunctionError(error: unknown, functionName: string, context: Record<string, unknown> = {}) {
  reportSystemError({
    source: 'edge_function',
    error,
    severity: 'error',
    context: { ...context, functionName: cleanText(functionName) },
  });
}

export function reportRealtimeError(error: unknown, context: Record<string, unknown> = {}) {
  reportSystemError({ source: 'realtime', error, severity: 'error', context: { ...context, channel: cleanText(context.channel) } });
}

export function reportRpcError(error: unknown, rpcName: string, context: Record<string, unknown> = {}) {
  reportSystemError({ source: 'rpc', error, severity: 'error', context: { ...context, rpcName: cleanText(rpcName) } });
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
