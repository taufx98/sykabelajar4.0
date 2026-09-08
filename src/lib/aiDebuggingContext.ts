export type AiDebuggingIncident = {
  id: string;
  source: string;
  severity: string;
  error_code?: string | null;
  error_message: string;
  path?: string | null;
  occurred_at?: string;
  status?: string | null;
  backend_version?: number | null;
  context?: Record<string, unknown> | null;
  occurrence_count?: number | null;
  user_id?: string | null;
  fingerprint?: string | null;
  rpcName?: string | null;
};

export type AiDiagnosticResult = {
  checked_at: string;
  status: 'fixed' | 'error';
  method: string;
  target: string;
  duration_ms: number;
  details: Record<string, unknown>;
  admin_diagnostic_mode: true;
};

const SENSITIVE_KEY = /token|authorization|password|secret|api[_-]?key|cookie|set-cookie/i;

function asRecord(value: unknown): Record<string, unknown> {
  return value && typeof value === 'object' && !Array.isArray(value) ? value as Record<string, unknown> : {};
}

function firstString(context: Record<string, unknown>, keys: string[]) {
  for (const key of keys) {
    const value = context[key];
    if (typeof value === 'string' && value.trim()) return value.trim();
  }
  return null;
}

function redact(value: unknown, depth = 0): unknown {
  if (depth > 8) return '[MAX_DEPTH]';
  if (Array.isArray(value)) return value.map((item) => redact(item, depth + 1));
  if (!value || typeof value !== 'object') return value;
  return Object.fromEntries(Object.entries(value).map(([key, item]) => [
    key,
    SENSITIVE_KEY.test(key) ? '[REDACTED]' : redact(item, depth + 1),
  ]));
}

function normalizeSource(source: string) {
  const value = source.toLowerCase();
  if (value === 'realtime') return 'realtime';
  if (value === 'rpc') return 'rpc';
  if (value === 'cloudinary') return 'storage';
  if (value === 'edge_function') return 'api';
  if (value === 'frontend') return 'frontend_runtime';
  if (value === 'database') return 'database';
  if (value === 'rls') return 'rls';
  if (value === 'authentication' || value === 'auth') return 'authentication';
  if (value === 'network') return 'network';
  if (value === 'payment' || value === 'midtrans') return 'payment';
  if (value === 'deployment' || value === 'build') return 'deployment';
  return value || 'unknown';
}

function structuredCode(source: string, context: Record<string, unknown>, errorCode: string | null | undefined, diagnostic?: AiDiagnosticResult | null) {
  if (errorCode && /^[A-Z][A-Z0-9_]{3,}$/.test(errorCode)) return errorCode;
  const normalized = normalizeSource(source);
  const subscribeStatus = firstString(context, ['subscribe_status', 'subscription_status', 'status']);
  if (normalized === 'realtime') {
    if (subscribeStatus === 'TIMED_OUT') return 'REALTIME_SUBSCRIPTION_TIMEOUT';
    if (subscribeStatus === 'CHANNEL_ERROR') return 'REALTIME_SUBSCRIPTION_CHANNEL_ERROR';
    if (diagnostic?.details?.subscribe_status === 'TIMED_OUT') return 'REALTIME_SUBSCRIPTION_TIMEOUT';
    if (diagnostic?.details?.subscribe_status === 'CHANNEL_ERROR') return 'REALTIME_SUBSCRIPTION_CHANNEL_ERROR';
    return 'REALTIME_SUBSCRIPTION_FAILED';
  }
  if (normalized === 'rpc') return 'RPC_HEALTH_CHECK_FAILED';
  if (normalized === 'storage') return 'CLOUDINARY_OPERATION_FAILED';
  if (normalized === 'api') return 'EDGE_FUNCTION_REQUEST_FAILED';
  if (normalized === 'frontend_runtime') return 'FRONTEND_RUNTIME_ERROR';
  if (normalized === 'database') return 'DATABASE_OPERATION_FAILED';
  if (normalized === 'rls') return 'RLS_ACCESS_CHECK_FAILED';
  if (normalized === 'authentication') return 'AUTHENTICATION_FAILED';
  if (normalized === 'network') return 'NETWORK_REQUEST_FAILED';
  if (normalized === 'payment') return 'PAYMENT_OPERATION_FAILED';
  if (normalized === 'deployment') return 'DEPLOYMENT_OR_BUILD_FAILED';
  return 'SYSTEM_ERROR';
}

function componentMeta(incident: AiDebuggingIncident, context: Record<string, unknown>) {
  const source = normalizeSource(incident.source);
  const provider = firstString(context, ['provider'])
    ?? (source === 'realtime' || source === 'rpc' ? 'Supabase' : source === 'storage' ? 'Cloudinary' : null);
  const service = firstString(context, ['service'])
    ?? (source === 'realtime' ? 'Realtime' : source === 'rpc' ? 'PostgreSQL RPC' : source === 'storage' ? 'Media storage' : null);
  return {
    provider,
    service,
    component: firstString(context, ['component', 'module']),
    channel: firstString(context, ['channel', 'channel_name']),
    target_resource: firstString(context, ['target', 'resource', 'endpoint']),
    target_table: firstString(context, ['table', 'table_name']),
    rpc_name: incident.rpcName ?? firstString(context, ['rpcName', 'rpc_name']),
    function_name: firstString(context, ['functionName', 'function_name', 'function']),
  };
}

function evidenceFrom(incident: AiDebuggingIncident, context: Record<string, unknown>, diagnostic?: AiDiagnosticResult | null) {
  const evidence: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(context)) {
    if (/^diagnostic_|^verified_|^observed_|^http_status$|^subscribe_status$|^subscribe_error$|^health_status$|^response_ok$/.test(key)) {
      evidence[key] = redact(value);
    }
  }
  if (diagnostic) {
    evidence.diagnostic_status = diagnostic.status;
    evidence.diagnostic_method = diagnostic.method;
    evidence.diagnostic_target = diagnostic.target;
    evidence.diagnostic_duration_ms = diagnostic.duration_ms;
    for (const [key, value] of Object.entries(diagnostic.details)) evidence[key] = redact(value);
  }
  if (Object.keys(evidence).length === 0) evidence.recorded_error = redact(incident.error_message);
  return evidence;
}

function investigationTargets(incident: AiDebuggingIncident, context: Record<string, unknown>, diagnostic?: AiDiagnosticResult | null) {
  const source = normalizeSource(incident.source);
  const result: string[] = [];
  if (source === 'realtime') {
    const channel = firstString(context, ['channel', 'channel_name']) ?? incident.id;
    result.push(`Frontend implementation untuk channel '${channel}'`);
    result.push('Pemanggilan dan lifecycle channel.subscribe()');
    result.push('Supabase Realtime configuration dan konektivitas WebSocket');
    const table = firstString(context, ['table', 'table_name']);
    if (table) result.push(`Realtime publication dan permission untuk '${table}'`);
    result.push('RLS dan permission yang berlaku pada koneksi diagnostic');
  } else if (source === 'rpc') {
    result.push('Implementasi RPC dan fungsi backend terkait');
    result.push('Health-check state dan lifecycle BLOCKED/PROBING/OPEN');
    result.push('Permission, RLS, dan dependency database yang dipanggil RPC');
  } else if (source === 'storage') {
    result.push('Frontend upload flow dan signed upload request');
    result.push('Cloudinary configuration dan preset');
    result.push('Edge Function pembuat signature dan secret configuration');
  } else if (source === 'api') {
    result.push('Frontend request ke Edge Function');
    result.push('Authentication dan authorization Edge Function');
    result.push('Logic serta dependency backend function');
  } else if (source === 'database') {
    result.push('Query/database operation yang gagal');
    result.push('Schema, constraints, index, dan transaction boundary');
    result.push('RLS/permission bila akses dilakukan melalui client');
  } else if (source === 'rls') {
    result.push('RLS policy yang berlaku pada resource target');
    result.push('Role/session identity yang digunakan saat request');
    result.push('Query dan permission path yang memicu deny');
  } else if (source === 'authentication') {
    result.push('Session/token lifecycle');
    result.push('Supabase Auth configuration dan callback flow');
    result.push('Route guard atau role check yang terkait');
  } else if (source === 'payment') {
    result.push('Frontend payment initiation dan callback handling');
    result.push('Midtrans API/configuration dan response handling');
    result.push('Idempotency dan status transition payment');
  } else if (source === 'deployment') {
    result.push('Build configuration dan failing command');
    result.push('Environment/configuration yang dibutuhkan saat build/deploy');
    result.push('CI workflow, dependency graph, dan runtime assumptions');
  } else {
    result.push('Frontend caller/component yang menghasilkan error');
    result.push('Service/API/backend dependency terkait');
    result.push('Network request atau permission path bila relevan');
  }
  if (diagnostic?.status === 'error') result.push(`Diagnostic target '${diagnostic.target}' masih gagal dan perlu diverifikasi pada implementasi yang menghasilkan error.`);
  return [...new Set(result)];
}

function behavior(incident: AiDebuggingIncident, context: Record<string, unknown>, diagnostic?: AiDiagnosticResult | null) {
  const source = normalizeSource(incident.source);
  const subscribeStatus = firstString(context, ['subscribe_status', 'subscription_status']);
  if (source === 'realtime') {
    const expected = 'Channel berhasil subscribe dengan status SUBSCRIBED.';
    const actual = subscribeStatus
      ? `Channel tidak mencapai SUBSCRIBED dan berakhir dengan status ${subscribeStatus}.`
      : diagnostic?.details?.subscribe_status
        ? `Diagnostic mengamati status subscription ${String(diagnostic.details.subscribe_status)}.`
        : 'Status subscription aktual belum terverifikasi pada payload ini.';
    return { expected, actual };
  }
  if (diagnostic?.status === 'fixed') return { expected: 'Target kembali dapat digunakan sesuai fungsi normal.', actual: 'Diagnostic saat ini berhasil; root cause historis belum dianggap terkonfirmasi.' };
  return {
    expected: firstString(context, ['expected_behavior', 'expected']) ?? 'Operasi berjalan tanpa error dan memenuhi kontrak layanan yang dituju.',
    actual: firstString(context, ['actual_behavior', 'actual']) ?? incident.error_message,
  };
}

export function buildAiDebuggingContext(incident: AiDebuggingIncident, diagnostic?: AiDiagnosticResult | null) {
  const context = asRecord(incident.context);
  const source = normalizeSource(incident.source);
  const page = incident.path ?? firstString(context, ['page', 'path']);
  const url = typeof window !== 'undefined' && incident.path === window.location.pathname ? window.location.href : firstString(context, ['url']);
  const online = typeof navigator !== 'undefined' ? navigator.onLine : null;
  const authenticated = context.authenticated === true ? true : context.authenticated === false ? false : null;
  const rlsBypassed = context.rls_bypassed === true ? true : context.rls_bypassed === false ? false : false;

  return {
    schema_version: 'sykabelajar.ai-error.v1',
    error: {
      type: source === 'realtime' ? 'realtime_subscription' : source === 'rpc' ? 'rpc_failure' : source,
      severity: incident.severity,
      code: structuredCode(incident.source, context, incident.error_code, diagnostic),
      message: incident.error_message,
      status: firstString(context, ['status', 'http_status', 'subscribe_status']) ?? null,
      subscribe_status: source === 'realtime' ? firstString(context, ['subscribe_status', 'subscription_status']) ?? (typeof diagnostic?.details?.subscribe_status === 'string' ? diagnostic.details.subscribe_status : null) : null,
      occurrences: Math.max(1, Number(incident.occurrence_count ?? 1)),
    },
    location: {
      page: page ?? null,
      url: url ?? null,
    },
    component: componentMeta(incident, context),
    runtime: {
      online,
      authenticated,
      admin_diagnostic_mode: diagnostic?.admin_diagnostic_mode === true || context.admin_diagnostic === true,
      rls_bypassed: rlsBypassed,
    },
    behavior: behavior(incident, context, diagnostic),
    evidence: evidenceFrom(incident, context, diagnostic),
    investigation_targets: investigationTargets(incident, context, diagnostic),
    ai_task: {
      goal: source === 'realtime'
        ? 'Identifikasi root cause dan perbaiki kegagalan subscription Supabase Realtime.'
        : 'Identifikasi root cause dan perbaiki error tanpa mengubah bagian sistem yang tidak berkaitan.',
      do_not: [
        'Jangan hanya suppress error.',
        'Jangan menghapus health-check atau diagnostic hanya agar error hilang.',
        'Jangan mematikan RLS atau melewati authentication.',
        'Jangan mengubah arsitektur yang tidak berkaitan dengan root cause.',
        'Jangan menyatakan hipotesis sebagai fakta tanpa evidence terverifikasi.',
      ],
      success_condition: source === 'realtime'
        ? [
          'Channel dapat mencapai status SUBSCRIBED.',
          'Tidak terjadi TIMED_OUT atau CHANNEL_ERROR secara normal.',
          'Health diagnostic dapat memverifikasi koneksi Realtime.',
          'Perbaikan tidak merusak authentication atau RLS.',
        ]
        : [
          'Error tidak terjadi pada jalur normal yang sebelumnya gagal.',
          'Diagnostic/probe yang relevan dapat memverifikasi pemulihan.',
          'Authentication, authorization, RLS, dan workflow existing tetap berfungsi.',
        ],
    },
  };
}
