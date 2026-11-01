import { useCallback, useEffect, useState } from 'react';
import { CalendarDays, Check, Edit3, Plus, Save, Sparkles, ToggleLeft, ToggleRight, Upload } from 'lucide-react';
import { Card } from '@/components/ui/Card';
import { Button } from '@/components/ui/Button';
import { useApp } from '@/store/AppContext';
import { supabase } from '@/lib/supabase';
import { uploadImage } from '@/services/cloudinary.service';

type DailyTaskType = 'DAILY' | 'DAILY_CHECKIN' | 'PROFILE_COMPLETE' | 'VERIFIED_REFERRAL';

type DailyTaskRecord = {
  id: string;
  title: string;
  description: string | null;
  task_type: string;
  points: number;
  exp: number;
  sort_order: number;
  is_active: boolean;
  starts_at: string | null;
  ends_at: string | null;
  max_claims_per_user: number | null;
  requirements: Record<string, unknown> | null;
};

type DailyTaskDraft = {
  id?: string;
  title: string;
  description: string;
  task_type: DailyTaskType;
  points: number;
  exp: number;
  sort_order: number;
  is_active: boolean;
  starts_at: string;
  ends_at: string;
  max_claims_per_user: string;
  target_count: number;
};

const toNumber = (value: string | number) => Number(value || 0);
const emptyEvent = {
  name: '',
  start_date: '',
  end_date: '',
  description: '',
  icon_url: '',
  icon_public_id: '',
  frame_style: 'green-gold',
  is_active: true,
};

function createTaskDraft(): DailyTaskDraft {
  return {
    title: '',
    description: '',
    task_type: 'DAILY',
    points: 0,
    exp: 0,
    sort_order: 0,
    is_active: true,
    starts_at: '',
    ends_at: '',
    max_claims_per_user: '',
    target_count: 1,
  };
}

function toLocalDateTime(value: string | null) {
  if (!value) return '';
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return '';
  const localDate = new Date(date.getTime() - date.getTimezoneOffset() * 60_000);
  return localDate.toISOString().slice(0, 16);
}

function taskTypeLabel(type: string) {
  switch (type) {
    case 'DAILY_CHECKIN': return 'Check-in Harian';
    case 'PROFILE_COMPLETE': return 'Kelengkapan Profil';
    case 'VERIFIED_REFERRAL': return 'Referral Terverifikasi';
    default: return 'Tugas Mandiri';
  }
}

export function AdminDailyTaskPage() {
  const { toast } = useApp();
  const [tasks, setTasks] = useState<DailyTaskRecord[]>([]);
  const [settings, setSettings] = useState({ regular_xp: 50, regular_coin: 1 });
  const [overrides, setOverrides] = useState<any[]>([]);
  const [events, setEvents] = useState<any[]>([]);
  const [taskDraft, setTaskDraft] = useState<DailyTaskDraft | null>(null);
  const [edit, setEdit] = useState<any>(null);
  const [event, setEvent] = useState<any | null>(null);
  const [busy, setBusy] = useState(false);
  const [loading, setLoading] = useState(true);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const [taskResult, settingsResult, overrideResult, eventResult] = await Promise.all([
        supabase.from('daily_tasks').select('*').order('sort_order').order('created_at', { ascending: false }),
        supabase.from('daily_checkin_settings').select('*').eq('id', true).maybeSingle(),
        supabase.from('daily_checkin_overrides').select('*').order('day_number').order('checkpoint_date'),
        supabase.from('daily_checkin_events').select('*').order('start_date', { ascending: false }),
      ]);

      if (taskResult.error) throw taskResult.error;
      if (settingsResult.error) throw settingsResult.error;
      if (overrideResult.error) throw overrideResult.error;
      if (eventResult.error) throw eventResult.error;

      setTasks((taskResult.data ?? []) as DailyTaskRecord[]);
      setSettings({
        regular_xp: Number(settingsResult.data?.regular_xp ?? 50),
        regular_coin: Number(settingsResult.data?.regular_coin ?? 1),
      });
      setOverrides(overrideResult.data ?? []);
      setEvents(eventResult.data ?? []);
    } catch (error: unknown) {
      toast(error instanceof Error ? error.message : 'Gagal memuat Daily Tasks.', 'error');
    } finally {
      setLoading(false);
    }
  }, [toast]);

  useEffect(() => {
    void load();
  }, [load]);

  const saveTask = async () => {
    if (!taskDraft?.title.trim()) {
      toast('Judul task wajib diisi.', 'error');
      return;
    }

    if (!Number.isInteger(taskDraft.points) || taskDraft.points < 0
      || !Number.isInteger(taskDraft.exp) || taskDraft.exp < 0
      || !Number.isInteger(taskDraft.sort_order)) {
      toast('Nilai Edu Coin, XP, dan urutan harus berupa bilangan bulat yang valid.', 'error');
      return;
    }

    if (taskDraft.starts_at && taskDraft.ends_at && new Date(taskDraft.ends_at) < new Date(taskDraft.starts_at)) {
      toast('Waktu berakhir tidak boleh lebih awal dari waktu mulai.', 'error');
      return;
    }

    const maxClaims = taskDraft.max_claims_per_user.trim() === '' ? null : Number(taskDraft.max_claims_per_user);
    if (maxClaims !== null && (!Number.isInteger(maxClaims) || maxClaims < 1)) {
      toast('Batas klaim harus kosong atau bilangan bulat minimal 1.', 'error');
      return;
    }

    if (taskDraft.task_type === 'VERIFIED_REFERRAL' && (!Number.isInteger(taskDraft.target_count) || taskDraft.target_count < 1)) {
      toast('Target referral harus minimal 1.', 'error');
      return;
    }

    setBusy(true);
    try {
      const payload = {
        title: taskDraft.title.trim(),
        description: taskDraft.description.trim() || null,
        task_type: taskDraft.task_type,
        points: taskDraft.points,
        exp: taskDraft.exp,
        sort_order: taskDraft.sort_order,
        is_active: taskDraft.is_active,
        starts_at: taskDraft.starts_at ? new Date(taskDraft.starts_at).toISOString() : null,
        ends_at: taskDraft.ends_at ? new Date(taskDraft.ends_at).toISOString() : null,
        max_claims_per_user: maxClaims,
        requirements: taskDraft.task_type === 'VERIFIED_REFERRAL'
          ? { target_count: taskDraft.target_count }
          : {},
      };

      const result = taskDraft.id
        ? await supabase.from('daily_tasks').update(payload).eq('id', taskDraft.id)
        : await supabase.from('daily_tasks').insert(payload);

      if (result.error) throw result.error;
      toast(taskDraft.id ? 'Daily Task berhasil diperbarui.' : 'Daily Task berhasil dibuat.', 'success');
      setTaskDraft(null);
      await load();
    } catch (error: unknown) {
      toast(error instanceof Error ? error.message : 'Gagal menyimpan Daily Task.', 'error');
    } finally {
      setBusy(false);
    }
  };

  const toggleTask = async (task: DailyTaskRecord) => {
    setBusy(true);
    try {
      const { error } = await supabase.from('daily_tasks')
        .update({ is_active: !task.is_active })
        .eq('id', task.id);
      if (error) throw error;
      toast(task.is_active ? 'Daily Task dinonaktifkan.' : 'Daily Task diaktifkan.', 'success');
      await load();
    } catch (error: unknown) {
      toast(error instanceof Error ? error.message : 'Gagal mengubah status task.', 'error');
    } finally {
      setBusy(false);
    }
  };

  const saveSettings = async () => {
    if (!Number.isInteger(settings.regular_xp) || settings.regular_xp < 0
      || !Number.isInteger(settings.regular_coin) || settings.regular_coin < 0) {
      toast('Hadiah XP dan koin harus berupa bilangan bulat minimal 0.', 'error');
      return;
    }

    setBusy(true);
    try {
      const { error } = await supabase.from('daily_checkin_settings').upsert({
        ...settings,
        id: true,
        updated_at: new Date().toISOString(),
      }, { onConflict: 'id' });
      if (error) throw error;
      toast('Hadiah reguler disimpan.', 'success');
      await load();
    } catch (error: unknown) {
      toast(error instanceof Error ? error.message : 'Gagal menyimpan hadiah check-in.', 'error');
    } finally {
      setBusy(false);
    }
  };

  const saveOverride = async (value: any) => {
    const hasDate = Boolean(value.checkpoint_date);
    const hasDay = Number(value.day_number) > 0;
    if (hasDate === hasDay) {
      toast('Pilih tepat satu: tanggal tertentu atau nomor hari streak.', 'error');
      return;
    }
    if (!Number.isInteger(Number(value.reward_amount)) || Number(value.reward_amount) < 0) {
      toast('Hadiah checkpoint harus berupa bilangan bulat minimal 0.', 'error');
      return;
    }

    setBusy(true);
    try {
      const payload = {
        ...value,
        checkpoint_date: hasDate ? value.checkpoint_date : null,
        day_number: hasDay ? Number(value.day_number) : null,
        reward_amount: Number(value.reward_amount),
        updated_at: new Date().toISOString(),
      };
      const result = value.id
        ? await supabase.from('daily_checkin_overrides').update(payload).eq('id', value.id)
        : await supabase.from('daily_checkin_overrides').insert({
          ...payload,
          checkpoint_key: value.checkpoint_key || `cp-${Date.now()}`,
        });
      if (result.error) throw result.error;
      toast('Checkpoint disimpan.', 'success');
      setEdit(null);
      await load();
    } catch (error: unknown) {
      toast(error instanceof Error ? error.message : 'Gagal menyimpan checkpoint.', 'error');
    } finally {
      setBusy(false);
    }
  };

  const saveEvent = async () => {
    if (!event?.name?.trim() || !event.start_date || !event.end_date) {
      toast('Nama event dan tanggal mulai/akhir wajib diisi.', 'error');
      return;
    }
    if (event.end_date < event.start_date) {
      toast('Tanggal akhir event tidak boleh lebih awal dari tanggal mulai.', 'error');
      return;
    }

    setBusy(true);
    try {
      const payload = { ...event, name: event.name.trim(), updated_at: new Date().toISOString() };
      const result = event.id
        ? await supabase.from('daily_checkin_events').update(payload).eq('id', event.id)
        : await supabase.from('daily_checkin_events').insert(payload);
      if (result.error) throw result.error;
      toast('Event tema disimpan.', 'success');
      setEvent(null);
      await load();
    } catch (error: unknown) {
      toast(error instanceof Error ? error.message : 'Gagal menyimpan event.', 'error');
    } finally {
      setBusy(false);
    }
  };

  const uploadEventIcon = async (file: File) => {
    try {
      if (!['image/png', 'image/svg+xml'].includes(file.type)) {
        throw new Error('Ikon harus PNG atau SVG.');
      }
      const result = await uploadImage(file, { folder: 'sykabelajar/daily-checkin/events' });
      setEvent((current: any) => ({
        ...current,
        icon_url: result.secure_url,
        icon_public_id: result.public_id,
      }));
      toast('Ikon event berhasil diupload.', 'success');
    } catch (error: unknown) {
      toast(error instanceof Error ? error.message : 'Gagal mengunggah ikon.', 'error');
    }
  };

  const editTask = (task: DailyTaskRecord) => {
    setTaskDraft({
      id: task.id,
      title: task.title,
      description: task.description ?? '',
      task_type: (['DAILY', 'DAILY_CHECKIN', 'PROFILE_COMPLETE', 'VERIFIED_REFERRAL'].includes(task.task_type)
        ? task.task_type
        : 'DAILY') as DailyTaskType,
      points: Number(task.points ?? 0),
      exp: Number(task.exp ?? 0),
      sort_order: Number(task.sort_order ?? 0),
      is_active: Boolean(task.is_active),
      starts_at: toLocalDateTime(task.starts_at),
      ends_at: toLocalDateTime(task.ends_at),
      max_claims_per_user: task.max_claims_per_user == null ? '' : String(task.max_claims_per_user),
      target_count: Number(task.requirements?.target_count ?? 1),
    });
  };

  return (
    <div className="min-h-screen surface-bg p-4 text-fg md:p-6">
      <div className="mx-auto max-w-6xl space-y-5">
        <div>
          <h1 className="font-display text-2xl font-bold">Daily Tasks &amp; Check-in</h1>
          <p className="mt-1 text-sm text-fg-muted">Kelola task aktif, hadiah check-in, checkpoint, dan event untuk seluruh pengguna.</p>
        </div>

        <Card className="space-y-4 p-5">
          <div className="flex flex-col justify-between gap-3 sm:flex-row sm:items-center">
            <div>
              <h2 className="font-semibold">Daftar Daily Task</h2>
              <p className="mt-1 text-xs text-fg-muted">Task aktif ditampilkan kepada seluruh pengguna ketika jadwalnya berlaku.</p>
            </div>
            <Button size="sm" onClick={() => setTaskDraft(createTaskDraft())} icon={<Plus size={14}/>}>Tambah Task</Button>
          </div>

          {loading && <p className="py-5 text-center text-xs text-fg-muted">Memuat Daily Task...</p>}
          {!loading && tasks.length === 0 && (
            <div className="rounded-xl border border-dashed surface-border p-6 text-center">
              <CalendarDays size={22} className="mx-auto mb-2 text-fg-muted"/>
              <p className="text-sm font-semibold">Belum ada task yang dibuat</p>
              <p className="mt-1 text-xs text-fg-muted">Buat task dari panel ini agar tugas dapat muncul di halaman pengguna.</p>
            </div>
          )}
          {!loading && tasks.length > 0 && (
            <div className="space-y-2">
              {tasks.map((task) => (
                <div key={task.id} className="flex flex-col justify-between gap-3 rounded-xl border surface-border p-3 sm:flex-row sm:items-center">
                  <div className="min-w-0 flex-1">
                    <div className="flex flex-wrap items-center gap-2">
                      <p className="text-sm font-semibold">{task.title}</p>
                      <span className={[
                        'rounded-full border px-2 py-0.5 text-[10px] font-semibold',
                        task.is_active
                          ? 'border-emerald-500/25 bg-emerald-500/10 text-emerald-500'
                          : 'border-slate-500/25 bg-slate-500/10 text-fg-muted',
                      ].join(' ')}>
                        {task.is_active ? 'Aktif' : 'Nonaktif'}
                      </span>
                      <span className="rounded-full bg-accent/10 px-2 py-0.5 text-[10px] font-semibold text-accent">{taskTypeLabel(task.task_type)}</span>
                    </div>
                    <p className="mt-1 line-clamp-2 text-xs text-fg-muted">{task.description || 'Tanpa deskripsi.'}</p>
                    <p className="mt-1 text-[11px] text-fg-muted">+{task.exp} XP · +{task.points} Edu Coin · Urutan {task.sort_order}</p>
                  </div>
                  <div className="flex shrink-0 items-center gap-2">
                    <Button size="sm" variant="outline" disabled={busy} onClick={() => editTask(task)} icon={<Edit3 size={13}/>}>Edit</Button>
                    <Button size="sm" variant="outline" disabled={busy} onClick={() => void toggleTask(task)} icon={task.is_active ? <ToggleRight size={14}/> : <ToggleLeft size={14}/>}>
                      {task.is_active ? 'Nonaktifkan' : 'Aktifkan'}
                    </Button>
                  </div>
                </div>
              ))}
            </div>
          )}
          <p className="border-t surface-border pt-3 text-[11px] leading-relaxed text-fg-muted">
            Task Mandiri dapat diklaim sendiri oleh peserta. Tipe Check-in, Profil, dan Referral diperiksa ulang oleh backend sebelum reward diberikan. Task dinonaktifkan, bukan dihapus, agar riwayat klaim tetap tersimpan.
          </p>
        </Card>

        <Card className="p-5">
          <div className="mb-4 flex items-center gap-2">
            <Sparkles size={18} className="text-accent"/>
            <h2 className="font-semibold">Hadiah Reguler Standar</h2>
          </div>
          <div className="grid gap-3 sm:grid-cols-2">
            <label className="text-xs text-fg-muted">
              XP per hari
              <input type="number" min="0" step="1" className="input mt-1" value={settings.regular_xp} onChange={(e) => setSettings({ ...settings, regular_xp: toNumber(e.target.value) })}/>
              <span className="mt-1 block">Dipakai saat tidak ada checkpoint khusus.</span>
            </label>
            <label className="text-xs text-fg-muted">
              Koin per hari
              <input type="number" min="0" step="1" className="input mt-1" value={settings.regular_coin} onChange={(e) => setSettings({ ...settings, regular_coin: toNumber(e.target.value) })}/>
              <span className="mt-1 block">Masuk ke saldo Edu Coin profil.</span>
            </label>
          </div>
          <div className="mt-4 flex justify-end">
            <Button loading={busy} onClick={() => void saveSettings()} icon={<Save size={15}/>}>Simpan Default</Button>
          </div>
        </Card>

        <Card className="p-5">
          <div className="mb-4 flex items-center justify-between gap-3">
            <div>
              <h2 className="font-semibold">Custom Checkpoint</h2>
              <p className="mt-1 text-xs text-fg-muted">Hari streak atau tanggal tertentu menimpa hadiah reguler.</p>
            </div>
            <Button size="sm" variant="outline" onClick={() => setEdit({
              checkpoint_key: `cp-${Date.now()}`,
              checkpoint_date: '',
              day_number: '',
              reward_type: 'XP',
              reward_amount: 100,
              reward_payload: {},
              sparkle: true,
              is_active: true,
            })} icon={<Plus size={14}/>}>Tambah</Button>
          </div>
          <div className="space-y-2">
            {overrides.map((override) => (
              <div key={override.id} className="flex items-center gap-3 rounded-xl border surface-border p-3">
                <div className="min-w-0 flex-1">
                  <p className="text-sm font-semibold">{override.checkpoint_date ? `Tanggal ${override.checkpoint_date}` : `Hari ke-${override.day_number}`}</p>
                  <p className="text-xs text-fg-muted">{override.reward_type} +{override.reward_amount}{override.sparkle ? ' · ✨ Checkpoint' : ''}</p>
                </div>
                <Button size="sm" variant="outline" onClick={() => setEdit(override)}>Edit</Button>
              </div>
            ))}
            {overrides.length === 0 && <p className="text-xs text-fg-muted">Belum ada checkpoint khusus.</p>}
          </div>
        </Card>

        <Card className="p-5">
          <div className="mb-4 flex items-center justify-between gap-3">
            <div>
              <h2 className="font-semibold">Pengaturan Tema &amp; Event Khusus</h2>
              <p className="mt-1 text-xs text-fg-muted">Ikon dan bingkai aktif otomatis selama tanggal event berlangsung.</p>
            </div>
            <Button size="sm" onClick={() => setEvent({ ...emptyEvent })} icon={<Plus size={14}/>}>Tambah Event</Button>
          </div>
          <div className="grid gap-3 md:grid-cols-2">
            {events.map((item) => (
              <div key={item.id} className="rounded-xl border surface-border p-4">
                <div className="flex gap-3">
                  {item.icon_url && <img src={item.icon_url} alt="" className="h-12 w-12 rounded-xl object-contain surface-elevated"/>}
                  <div className="min-w-0 flex-1">
                    <p className="font-semibold">{item.name}</p>
                    <p className="text-xs text-fg-muted">{item.start_date} — {item.end_date} · {item.frame_style}</p>
                    <p className="mt-1 text-xs text-fg-muted">{item.description || 'Tanpa deskripsi.'}</p>
                  </div>
                  <Button size="sm" variant="outline" onClick={() => setEvent(item)}>Edit</Button>
                </div>
              </div>
            ))}
            {events.length === 0 && <p className="text-xs text-fg-muted">Belum ada event tema.</p>}
          </div>
        </Card>

        {taskDraft && (
          <div className="fixed inset-0 z-[120] flex items-center justify-center bg-black/70 p-4">
            <button className="absolute inset-0" onClick={() => setTaskDraft(null)} aria-label="Tutup editor task"/>
            <Card className="relative max-h-[92vh] w-full max-w-xl space-y-4 overflow-y-auto p-5">
              <div className="flex items-center justify-between gap-3">
                <h3 className="font-semibold">{taskDraft.id ? 'Edit Daily Task' : 'Tambah Daily Task'}</h3>
                <button type="button" onClick={() => setTaskDraft(null)} aria-label="Tutup" className="rounded-lg px-2 py-1 text-fg-muted hover:bg-ink-800">×</button>
              </div>
              <label className="block text-xs text-fg-muted">
                Judul Task
                <input className="input mt-1" maxLength={120} value={taskDraft.title} onChange={(e) => setTaskDraft({ ...taskDraft, title: e.target.value })}/>
              </label>
              <label className="block text-xs text-fg-muted">
                Deskripsi / instruksi
                <textarea className="input mt-1 min-h-20" maxLength={500} value={taskDraft.description} onChange={(e) => setTaskDraft({ ...taskDraft, description: e.target.value })}/>
              </label>
              <label className="block text-xs text-fg-muted">
                Jenis Verifikasi
                <select className="input mt-1" value={taskDraft.task_type} onChange={(e) => setTaskDraft({ ...taskDraft, task_type: e.target.value as DailyTaskType })}>
                  <option value="DAILY">Task Mandiri (klaim sendiri)</option>
                  <option value="DAILY_CHECKIN">Check-in Harian (diverifikasi backend)</option>
                  <option value="PROFILE_COMPLETE">Kelengkapan Profil (diverifikasi backend)</option>
                  <option value="VERIFIED_REFERRAL">Referral Terverifikasi (diverifikasi backend)</option>
                </select>
                <span className="mt-1 block leading-relaxed">
                  {taskDraft.task_type === 'DAILY'
                    ? 'Klaim peserta bersifat mandiri dan tidak memeriksa bukti aktivitas secara otomatis.'
                    : taskDraft.task_type === 'DAILY_CHECKIN'
                      ? 'Hanya dapat diselesaikan setelah catatan check-in hari ini tersimpan.'
                      : taskDraft.task_type === 'PROFILE_COMPLETE'
                        ? 'Backend memeriksa nama, foto profil, dan bio akun.'
                        : 'Backend memeriksa jumlah referral terverifikasi pada hari WIB berjalan.'}
                </span>
              </label>
              {taskDraft.task_type === 'VERIFIED_REFERRAL' && (
                <label className="block text-xs text-fg-muted">
                  Target referral terverifikasi hari ini
                  <input type="number" min="1" step="1" className="input mt-1" value={taskDraft.target_count} onChange={(e) => setTaskDraft({ ...taskDraft, target_count: toNumber(e.target.value) })}/>
                </label>
              )}
              <div className="grid grid-cols-2 gap-3">
                <label className="text-xs text-fg-muted">Reward Edu Coin
                  <input type="number" min="0" step="1" className="input mt-1" value={taskDraft.points} onChange={(e) => setTaskDraft({ ...taskDraft, points: toNumber(e.target.value) })}/>
                </label>
                <label className="text-xs text-fg-muted">Reward XP
                  <input type="number" min="0" step="1" className="input mt-1" value={taskDraft.exp} onChange={(e) => setTaskDraft({ ...taskDraft, exp: toNumber(e.target.value) })}/>
                </label>
                <label className="text-xs text-fg-muted">Urutan tampil
                  <input type="number" step="1" className="input mt-1" value={taskDraft.sort_order} onChange={(e) => setTaskDraft({ ...taskDraft, sort_order: toNumber(e.target.value) })}/>
                </label>
                <label className="text-xs text-fg-muted">Batas klaim per akun (opsional)
                  <input type="number" min="1" step="1" className="input mt-1" placeholder="Kosong = sekali per hari" value={taskDraft.max_claims_per_user} onChange={(e) => setTaskDraft({ ...taskDraft, max_claims_per_user: e.target.value })}/>
                </label>
                <label className="text-xs text-fg-muted">Mulai berlaku
                  <input type="datetime-local" className="input mt-1" value={taskDraft.starts_at} onChange={(e) => setTaskDraft({ ...taskDraft, starts_at: e.target.value })}/>
                </label>
                <label className="text-xs text-fg-muted">Berakhir
                  <input type="datetime-local" className="input mt-1" value={taskDraft.ends_at} onChange={(e) => setTaskDraft({ ...taskDraft, ends_at: e.target.value })}/>
                </label>
              </div>
              <label className="flex items-center gap-2 text-xs font-medium text-fg-muted">
                <input type="checkbox" checked={taskDraft.is_active} onChange={(e) => setTaskDraft({ ...taskDraft, is_active: e.target.checked })}/>
                Aktifkan task setelah disimpan
              </label>
              <div className="flex justify-end gap-2">
                <Button variant="outline" onClick={() => setTaskDraft(null)}>Batal</Button>
                <Button loading={busy} onClick={() => void saveTask()} icon={<Save size={14}/>}>Simpan Task</Button>
              </div>
            </Card>
          </div>
        )}

        {edit && (
          <div className="fixed inset-0 z-[130] flex items-center justify-center bg-black/70 p-4">
            <button className="absolute inset-0" onClick={() => setEdit(null)} aria-label="Tutup checkpoint"/>
            <Card className="relative w-full max-w-md space-y-4 p-5">
              <h3 className="font-semibold">Checkpoint</h3>
              <label className="block text-xs text-fg-muted">Tanggal tertentu
                <input className="input mt-1" type="date" value={edit.checkpoint_date || ''} onChange={(e) => setEdit({ ...edit, checkpoint_date: e.target.value || null, day_number: null })}/>
              </label>
              <label className="block text-xs text-fg-muted">Atau nomor hari streak
                <input className="input mt-1" type="number" min="1" step="1" placeholder="Contoh: 7" value={edit.day_number || ''} onChange={(e) => setEdit({ ...edit, day_number: e.target.value ? toNumber(e.target.value) : null, checkpoint_date: null })}/>
              </label>
              <label className="block text-xs text-fg-muted">Jenis hadiah
                <select className="input mt-1" value={edit.reward_type} onChange={(e) => setEdit({ ...edit, reward_type: e.target.value })}>
                  <option>XP</option><option>COIN</option><option>BADGE</option><option>FEATURE</option>
                </select>
              </label>
              <label className="block text-xs text-fg-muted">Jumlah
                <input className="input mt-1" type="number" min="0" step="1" value={edit.reward_amount} onChange={(e) => setEdit({ ...edit, reward_amount: toNumber(e.target.value) })}/>
              </label>
              <label className="flex items-center gap-2 text-sm">
                <input type="checkbox" checked={Boolean(edit.sparkle)} onChange={(e) => setEdit({ ...edit, sparkle: e.target.checked })}/>
                Efek visual berkilau
              </label>
              <div className="flex justify-end gap-2">
                <Button variant="outline" onClick={() => setEdit(null)}>Batal</Button>
                <Button loading={busy} onClick={() => void saveOverride(edit)}>Simpan</Button>
              </div>
            </Card>
          </div>
        )}

        {event && (
          <div className="fixed inset-0 z-[140] flex items-center justify-center bg-black/70 p-4">
            <button className="absolute inset-0" onClick={() => setEvent(null)} aria-label="Tutup event"/>
            <Card className="relative max-h-[92vh] w-full max-w-lg space-y-4 overflow-y-auto p-5">
              <h3 className="font-semibold">Tema &amp; Event Khusus</h3>
              <label className="block text-xs text-fg-muted">Nama event
                <input className="input mt-1" maxLength={100} value={event.name || ''} onChange={(e) => setEvent({ ...event, name: e.target.value })}/>
              </label>
              <div className="grid grid-cols-2 gap-2">
                <label className="text-xs text-fg-muted">Tanggal mulai
                  <input className="input mt-1" type="date" value={event.start_date || ''} onChange={(e) => setEvent({ ...event, start_date: e.target.value })}/>
                </label>
                <label className="text-xs text-fg-muted">Tanggal akhir
                  <input className="input mt-1" type="date" value={event.end_date || ''} onChange={(e) => setEvent({ ...event, end_date: e.target.value })}/>
                </label>
              </div>
              <label className="block text-xs text-fg-muted">Deskripsi
                <textarea className="input mt-1 min-h-24" maxLength={500} value={event.description || ''} onChange={(e) => setEvent({ ...event, description: e.target.value })}/>
              </label>
              <label className="block text-xs text-fg-muted">Ikon PNG/SVG
                <input type="file" accept=".png,.svg,image/png,image/svg+xml" className="input mt-1" onChange={(e) => {
                  const file = e.target.files?.[0];
                  if (file) void uploadEventIcon(file);
                }}/>
              </label>
              {event.icon_url && <img src={event.icon_url} alt="Preview ikon event" className="h-16 w-16 object-contain"/>}
              <label className="block text-xs text-fg-muted">Gaya bingkai
                <select className="input mt-1" value={event.frame_style || 'green-gold'} onChange={(e) => setEvent({ ...event, frame_style: e.target.value })}>
                  <option value="green-gold">Hijau Emas</option>
                  <option value="red-white">Merah Putih</option>
                  <option value="gold-glow">Glow Emas</option>
                </select>
              </label>
              <div className="flex justify-end gap-2">
                <Button variant="outline" onClick={() => setEvent(null)}>Batal</Button>
                <Button loading={busy} onClick={() => void saveEvent()} icon={<Save size={14}/>}>Simpan Event</Button>
              </div>
            </Card>
          </div>
        )}
      </div>
    </div>
  );
}
