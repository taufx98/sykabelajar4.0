import { useState } from 'react';
import { AlertTriangle, CheckCircle2, Loader2, Play, ShieldCheck, XCircle } from 'lucide-react';
import { Button } from '@/components/ui/Button';
import { Card } from '@/components/ui/Card';
import { useApp } from '@/store/AppContext';
import { supabase } from '@/lib/supabase';
import { isBetterAuthEnabled } from '@/services/auth.service';
import { getStagingBetterAuthClient } from '@/services/betterAuthApi.client';

type ResultState = 'pending' | 'running' | 'passed' | 'failed';
type CheckKey = 'identity' | 'storage' | 'realtime' | 'edge';
type CheckResult = { key: CheckKey; label: string; state: ResultState; detail: string };

const BUCKET = 'auth-oidc-acceptance';
const REALTIME_PREFIX = 'auth-oidc-acceptance:';
const INITIAL_RESULTS: CheckResult[] = [
  { key: 'identity', label: 'Sesi, Data API, profil, dan role', state: 'pending', detail: 'Belum dijalankan' },
  { key: 'storage', label: 'Storage privat dan isolasi pemilik file', state: 'pending', detail: 'Belum dijalankan' },
  { key: 'realtime', label: 'Realtime private channel dan isolasi topic', state: 'pending', detail: 'Belum dijalankan' },
  { key: 'edge', label: 'Edge Function memverifikasi JWT Better Auth', state: 'pending', detail: 'Belum dijalankan' },
];

function messageOf(error: unknown): string {
  if (error instanceof Error) return error.message.slice(0, 180);
  return 'AUTH_ACCEPTANCE_CHECK_FAILED';
}

function withTimeout<T>(promise: Promise<T>, milliseconds: number, code: string): Promise<T> {
  return new Promise<T>((resolve, reject) => {
    const timer = window.setTimeout(() => reject(new Error(code)), milliseconds);
    promise.then(
      (value) => { window.clearTimeout(timer); resolve(value); },
      (error) => { window.clearTimeout(timer); reject(error); },
    );
  });
}

export function BetterAuthAcceptancePanel() {
  const { user, isAuthenticated } = useApp();
  const [results, setResults] = useState<CheckResult[]>(INITIAL_RESULTS);
  const [running, setRunning] = useState(false);
  const [hasRun, setHasRun] = useState(false);

  // This is an owner-run acceptance probe for the isolated Free staging project.
  // Keep it invisible even if the Better Auth frontend flag is later enabled elsewhere.
  if (typeof window === 'undefined' || window.location.hostname !== 'staging.sykabelajar.my.id' || !isBetterAuthEnabled()) return null;

  const setResult = (key: CheckKey, state: ResultState, detail: string) => {
    setResults((current) => current.map((item) => item.key === key ? { ...item, state, detail } : item));
  };

  const run = async () => {
    if (!user?.id || !isAuthenticated || running) return;
    const userId = user.id;
    setRunning(true);
    setHasRun(true);
    setResults(INITIAL_RESULTS.map((item) => ({ ...item, state: 'pending', detail: 'Menunggu pengujian' })));

    const runCheck = async (key: CheckKey, work: () => Promise<string>) => {
      setResult(key, 'running', 'Sedang diuji');
      try {
        const detail = await work();
        setResult(key, 'passed', detail);
      } catch (error) {
        setResult(key, 'failed', messageOf(error));
      }
    };

    try {
      await runCheck('identity', async () => {
        const session = await getStagingBetterAuthClient().getSession();
        if (!session?.user || session.user.id !== userId) throw new Error('BETTER_AUTH_SESSION_SUBJECT_MISMATCH');

        const [profile, roles, foreignRows] = await Promise.all([
          supabase.from('profiles').select('id').eq('id', userId).maybeSingle(),
          supabase.from('user_roles').select('role').eq('user_id', userId).eq('is_active', true),
          supabase.from('auth_oidc_acceptance_rows').select('owner_id'),
        ]);
        if (profile.error) throw profile.error;
        if (roles.error) throw roles.error;
        if (foreignRows.error) throw foreignRows.error;
        if (profile.data?.id !== userId) throw new Error('BETTER_AUTH_PROFILE_NOT_VISIBLE');
        if (!roles.data?.length) throw new Error('BETTER_AUTH_ACTIVE_ROLE_NOT_FOUND');
        if ((foreignRows.data ?? []).some((row) => row.owner_id !== userId)) {
          throw new Error('OIDC_RLS_EXPOSED_SYNTHETIC_FOREIGN_ROWS');
        }
        return 'Sesi cocok; profil dan role aktif terbaca; fixture milik UUID lain tersembunyi';
      });

      await runCheck('storage', async () => {
        const storage = supabase.storage.from(BUCKET);
        const marker = 'SYKABELAJAR Better Auth Storage acceptance probe';
        const ownedPath = userId + '/' + crypto.randomUUID() + '.txt';
        const foreignPath = crypto.randomUUID() + '/' + crypto.randomUUID() + '.txt';
        let ownedUploaded = false;
        let foreignUploaded = false;
        let storageFailure: unknown = null;
        try {
          const upload = await storage.upload(ownedPath, new Blob([marker], { type: 'text/plain' }), {
            contentType: 'text/plain',
            upsert: false,
          });
          if (upload.error) throw upload.error;
          ownedUploaded = true;

          const downloaded = await storage.download(ownedPath);
          if (downloaded.error) throw downloaded.error;
          if (await downloaded.data.text() !== marker) throw new Error('STORAGE_PRIVATE_OBJECT_CONTENT_MISMATCH');

          const denied = await storage.upload(foreignPath, new Blob([marker], { type: 'text/plain' }), {
            contentType: 'text/plain',
            upsert: false,
          });
          if (!denied.error) {
            foreignUploaded = true;
            throw new Error('STORAGE_CROSS_USER_UPLOAD_WAS_ALLOWED');
          }
        } catch (error) {
          storageFailure = error;
        }

        const cleanupPaths = [
          ...(ownedUploaded ? [ownedPath] : []),
          ...(foreignUploaded ? [foreignPath] : []),
        ];
        if (cleanupPaths.length > 0) {
          try {
            const cleanup = await storage.remove(cleanupPaths);
            if (cleanup.error && !storageFailure) storageFailure = cleanup.error;
          } catch (cleanupError) {
            if (!storageFailure) storageFailure = cleanupError;
          }
        }
        if (storageFailure) throw storageFailure;
        return 'Upload, download, dan penghapusan file sendiri berhasil; folder UUID lain ditolak';
      });

      await runCheck('realtime', async () => {
        const resourceToken = await getStagingBetterAuthClient().getSupabaseAccessToken();
        if (!resourceToken) throw new Error('BETTER_AUTH_RESOURCE_TOKEN_MISSING');
        await supabase.realtime.setAuth(resourceToken);

        const nonce = crypto.randomUUID();
        const topic = REALTIME_PREFIX + userId;
        const channel = supabase.channel(topic, {
          config: { private: true, broadcast: { self: true, ack: true } },
        });
        let resolveReceived: (() => void) | undefined;
        const received = new Promise<void>((resolve) => { resolveReceived = resolve; });
        channel.on('broadcast', { event: 'auth-oidc-probe' }, (message) => {
          if ((message.payload as { nonce?: string } | undefined)?.nonce === nonce) resolveReceived?.();
        });

        try {
          await withTimeout(new Promise<void>((resolve, reject) => {
            channel.subscribe((status, error) => {
              if (status === 'SUBSCRIBED') resolve();
              else if (status === 'CHANNEL_ERROR' || status === 'TIMED_OUT' || status === 'CLOSED') {
                reject(new Error('REALTIME_PRIVATE_CHANNEL_' + status + (error ? ': ' + String(error).slice(0, 100) : '')));
              }
            });
          }), 10_000, 'REALTIME_SUBSCRIBE_TIMEOUT');

          const sent = await channel.send({
            type: 'broadcast',
            event: 'auth-oidc-probe',
            payload: { nonce },
          });
          if (sent !== 'ok') throw new Error('REALTIME_BROADCAST_' + String(sent));
          await withTimeout(received, 8_000, 'REALTIME_BROADCAST_ECHO_TIMEOUT');
        } finally {
          await supabase.removeChannel(channel);
        }

        const foreignTopic = REALTIME_PREFIX + crypto.randomUUID();
        const foreignChannel = supabase.channel(foreignTopic, { config: { private: true } });
        try {
          const outcome = await withTimeout(new Promise<'denied' | 'joined'>((resolve, reject) => {
            foreignChannel.subscribe((status) => {
              if (status === 'CHANNEL_ERROR') resolve('denied');
              else if (status === 'SUBSCRIBED') resolve('joined');
              else if (status === 'TIMED_OUT' || status === 'CLOSED') reject(new Error('REALTIME_NEGATIVE_CONTROL_' + status));
            });
          }), 10_000, 'REALTIME_NEGATIVE_CONTROL_TIMEOUT');
          if (outcome !== 'denied') throw new Error('REALTIME_FOREIGN_TOPIC_WAS_ALLOWED');
        } finally {
          await supabase.removeChannel(foreignChannel);
        }
        return 'Private Broadcast tersambung dan mengirim pesan; topic UUID lain ditolak';
      });

      await runCheck('edge', async () => {
        const { data, error } = await supabase.functions.invoke('better-auth-oidc-acceptance', { body: {} });
        if (error) throw error;
        if (
          !data ||
          data.ok !== true ||
          data.user_id !== userId ||
          data.issuer !== 'https://auth.sykabelajar.my.id/api/auth' ||
          data.audience !== 'https://sykabelajar.my.id' ||
          data.cross_user_rows !== 0 ||
          data.read_only !== true ||
          data.production_touched !== false
        ) throw new Error('BETTER_AUTH_EDGE_ACCEPTANCE_RESPONSE_INVALID');
        return 'Edge Function menerima JWT ES256 dengan issuer, audience, subject, role, dan RLS yang valid';
      });
    } finally {
      setRunning(false);
    }
  };

  const passed = results.filter((item) => item.state === 'passed').length;
  const failed = results.filter((item) => item.state === 'failed').length;

  return (
    <Card className="p-5 space-y-4">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div className="min-w-0">
          <div className="flex items-center gap-2">
            <ShieldCheck size={18} className="text-accent" />
            <h3 className="font-semibold text-fg">Uji Penerimaan Better Auth — Staging</h3>
          </div>
          <p className="mt-1 text-sm text-fg-muted">
            Mengetes token akun yang sedang login pada Data API, Storage, Realtime, dan Edge Function.
            Tidak menampilkan atau menyalin token.
          </p>
        </div>
        <Button size="sm" onClick={() => void run()} disabled={!user?.id || !isAuthenticated || running}>
          {running ? <Loader2 size={14} className="animate-spin" /> : <Play size={14} />}
          {running ? 'Menguji…' : hasRun ? 'Ulangi tes' : 'Jalankan tes'}
        </Button>
      </div>

      {!isAuthenticated || !user?.id ? (
        <p className="text-xs text-amber-300">Masuk menggunakan akun Better Auth staging untuk menjalankan pengujian.</p>
      ) : (
        <>
          {hasRun && (
            <div className="rounded-lg border surface-border p-3">
              <p className="text-sm font-medium text-fg">
                {passed}/4 pengujian lulus{failed ? ' · ' + failed + ' gagal' : running ? ' · proses berjalan' : ''}
              </p>
              <p className="mt-1 text-xs text-fg-muted">File probe Storage akan dihapus kembali setelah pengujian.</p>
            </div>
          )}
          <div className="space-y-2">
            {results.map((item) => (
              <div key={item.key} className="flex items-start gap-3 rounded-lg border surface-border p-3">
                <div className="mt-0.5 shrink-0">
                  {item.state === 'passed' ? <CheckCircle2 size={17} className="text-emerald-400" /> :
                    item.state === 'failed' ? <XCircle size={17} className="text-red-400" /> :
                    item.state === 'running' ? <Loader2 size={17} className="animate-spin text-accent" /> :
                    <div className="h-[17px] w-[17px] rounded-full border surface-border" />}
                </div>
                <div className="min-w-0">
                  <p className="text-sm font-medium text-fg">{item.label}</p>
                  <p className={'mt-0.5 break-words text-xs ' + (item.state === 'failed' ? 'text-red-300' : 'text-fg-muted')}>{item.detail}</p>
                </div>
              </div>
            ))}
          </div>
          <div className="flex items-start gap-2 rounded-lg border border-amber-500/20 bg-amber-500/5 p-3">
            <AlertTriangle size={15} className="mt-0.5 shrink-0 text-amber-300" />
            <p className="text-xs text-amber-200">
              Hanya untuk project staging. Pengujian ini membuat file teks sementara, memeriksa channel privat,
              lalu membersihkan file tersebut. Jangan jalankan di Production.
            </p>
          </div>
        </>
      )}
    </Card>
  );
}
