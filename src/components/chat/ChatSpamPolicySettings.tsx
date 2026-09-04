import { useCallback, useEffect, useState } from 'react';
import { Clock3, Save, ShieldAlert } from 'lucide-react';
import { useApp } from '@/store/AppContext';
import { Button } from '@/components/ui/Button';
import { Card } from '@/components/ui/Card';
import { supabase } from '@/lib/supabase';

const DEFAULTS = [1, 10, 60, 1440];

type Policy = {
  window_seconds: number;
  message_threshold: number;
  levels: number[];
};

const parsePolicy = (value: unknown): Policy => {
  const raw = value && typeof value === 'object' ? value as Record<string, unknown> : {};
  const rawLevels = Array.isArray(raw.levels) ? raw.levels : [];
  const levels = DEFAULTS.map((fallback, index) => {
    const item = rawLevels[index];
    const minutes = item && typeof item === 'object' ? Number((item as Record<string, unknown>).duration_minutes) : NaN;
    return Number.isFinite(minutes) && minutes >= 1 ? Math.min(10080, Math.round(minutes)) : fallback;
  });
  return {
    window_seconds: Number.isFinite(Number(raw.window_seconds)) ? Math.min(300, Math.max(1, Math.round(Number(raw.window_seconds)))) : 10,
    message_threshold: Number.isFinite(Number(raw.message_threshold)) ? Math.min(20, Math.max(2, Math.round(Number(raw.message_threshold)))) : 4,
    levels,
  };
};

function formatDuration(minutes: number) {
  if (minutes % 1440 === 0) return `${minutes / 1440} hari`;
  if (minutes % 60 === 0) return `${minutes / 60} jam`;
  return `${minutes} menit`;
}

export function ChatSpamPolicySettings() {
  const { toast } = useApp();
  const [policy, setPolicy] = useState<Policy>({ window_seconds: 10, message_threshold: 4, levels: DEFAULTS });
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const { data, error } = await supabase.from('platform_settings').select('value').eq('key', 'chat_spam_policy').maybeSingle();
      if (error) throw error;
      setPolicy(parsePolicy(data?.value));
    } catch (error) {
      toast(error instanceof Error ? error.message : 'Gagal memuat pengaturan anti-spam.', 'error');
    } finally {
      setLoading(false);
    }
  }, [toast]);

  useEffect(() => { void load(); }, [load]);

  const save = useCallback(async () => {
    setSaving(true);
    try {
      const value = {
        window_seconds: policy.window_seconds,
        message_threshold: policy.message_threshold,
        levels: policy.levels.map((duration_minutes, index) => ({ level: index + 1, duration_minutes })),
      };
      const { error } = await supabase.from('platform_settings').update({ value, updated_at: new Date().toISOString() }).eq('key', 'chat_spam_policy');
      if (error) throw error;
      toast('Pengaturan penalti spam berhasil disimpan.', 'success');
      await load();
    } catch (error) {
      toast(error instanceof Error ? error.message : 'Gagal menyimpan pengaturan anti-spam.', 'error');
    } finally {
      setSaving(false);
    }
  }, [load, policy, toast]);

  return (
    <Card className="border-amber-500/15 bg-amber-500/[0.03] p-4">
      <div className="flex flex-col gap-4">
        <div className="flex flex-col gap-2 sm:flex-row sm:items-start sm:justify-between">
          <div>
            <p className="flex items-center gap-2 text-sm font-semibold text-fg"><ShieldAlert size={16} />Penalti Spam Otomatis</p>
            <p className="mt-1 text-[11px] text-fg-muted">Aturan ini mengatur penalti sistem. Blokir manual Admin tetap terpisah.</p>
          </div>
          <Button size="sm" onClick={() => void save()} loading={saving} disabled={loading} icon={<Save size={14} />}>Simpan</Button>
        </div>

        <div className="grid gap-3 sm:grid-cols-2">
          <label className="block">
            <span className="label">Pemicu</span>
            <div className="grid grid-cols-2 gap-2">
              <input className="input" type="number" min={2} max={20} value={policy.message_threshold} onChange={e => setPolicy(p => ({ ...p, message_threshold: Math.min(20, Math.max(2, Number(e.target.value) || 2)) }))} />
              <div className="flex items-center rounded-xl border surface-border surface-elevated px-3 text-xs text-fg-muted">pesan</div>
            </div>
            <p className="mt-1 text-[10px] text-fg-muted">Dalam {policy.window_seconds} detik terakhir.</p>
          </label>
          <label className="block">
            <span className="label">Jendela spam</span>
            <div className="flex items-center gap-2">
              <input className="input" type="number" min={1} max={300} value={policy.window_seconds} onChange={e => setPolicy(p => ({ ...p, window_seconds: Math.min(300, Math.max(1, Number(e.target.value) || 1)) }))} />
              <span className="text-xs text-fg-muted">detik</span>
            </div>
            <p className="mt-1 text-[10px] text-fg-muted">Minimum 1, maksimum 300 detik.</p>
          </label>
        </div>

        <div>
          <p className="mb-2 text-xs font-semibold text-fg">Tingkat penalti</p>
          <div className="grid gap-2 sm:grid-cols-2 xl:grid-cols-4">
            {policy.levels.map((minutes, index) => (
              <label key={index} className="rounded-xl border surface-border surface-elevated p-3">
                <span className="flex items-center gap-2 text-xs font-semibold text-fg"><Clock3 size={14} />Tingkat {index + 1}</span>
                <input className="input mt-2" type="number" min={1} max={10080} value={minutes} onChange={e => setPolicy(p => ({ ...p, levels: p.levels.map((value, i) => i === index ? Math.min(10080, Math.max(1, Number(e.target.value) || 1)) : value) }))} />
                <span className="mt-1 block text-[10px] text-fg-muted">{formatDuration(minutes)}</span>
              </label>
            ))}
          </div>
        </div>
      </div>
    </Card>
  );
}
