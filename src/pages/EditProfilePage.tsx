import { useEffect, useRef, useState } from 'react';
import { ArrowLeft, Camera, Calendar, Check, GraduationCap, School, User as UserIcon, UserCheck, Clock, Settings2 } from 'lucide-react';
import { useNavigate } from 'react-router-dom';
import { Avatar } from '@/components/ui/Avatar';
import { Button } from '@/components/ui/Button';
import { Card } from '@/components/ui/Card';
import { EmblemIcon } from '@/components/ui/Emblem';
import { useApp } from '@/store/AppContext';
import { CATEGORY_LABELS, GRADE_OPTIONS } from '@/data/catalog';
import { uploadProfileImage } from '@/services/cloudinary.service';
import { getProfileById, updateProfile as updateProfileRecord } from '@/services/profile.service';
import type { CompetitionCategory } from '@/types';

interface Form {
  displayName: string;
  username: string;
  bio: string;
  school: string;
  birthDate: string;
  grade: string;
  pembina: string;
  favoriteCategories: CompetitionCategory[];
  showcaseEmblems: string[];
  profilePhoto: string;
  coverPhoto: string;
  acceptMessages: string;
}

const COOLDOWN_MS = 7 * 24 * 60 * 60 * 1000;

function getCooldownRemaining(lastChange: string | null) {
  if (!lastChange) return { locked: false, days: 0, hours: 0, minutes: 0 };
  const remaining = COOLDOWN_MS - (Date.now() - new Date(lastChange).getTime());
  if (remaining <= 0) return { locked: false, days: 0, hours: 0, minutes: 0 };
  return {
    locked: true,
    days: Math.floor(remaining / 86400000),
    hours: Math.floor((remaining % 86400000) / 3600000),
    minutes: Math.floor((remaining % 3600000) / 60000),
  };
}

export function EditProfilePage() {
  const navigate = useNavigate();
  const { user, toast, refreshUser } = useApp();

  const [form, setForm] = useState<Form>({
    displayName: user?.displayName || '',
    username: user?.username || '',
    bio: user?.bio || '',
    school: user?.school || '',
    birthDate: user?.birthDate || '',
    grade: (user as any)?.grade || '',
    pembina: (user as any)?.pembina || '',
    favoriteCategories: (user?.favoriteCategories || []) as CompetitionCategory[],
    showcaseEmblems: user?.showcaseEmblems || user?.emblems?.slice(0, 3).map((e) => e.id) || [],
    profilePhoto: user?.profilePhoto || '',
    coverPhoto: user?.coverPhoto || '',
    acceptMessages: (user as any)?.accept_messages || 'public',
  });
  const [profileFile, setProfileFile] = useState<File | null>(null);
  const [coverFile, setCoverFile] = useState<File | null>(null);
  const [saving, setSaving] = useState(false);
  const [previews, setPreviews] = useState<{ profile?: string; cover?: string }>({});
  const profileRef = useRef<HTMLInputElement>(null);
  const coverRef = useRef<HTMLInputElement>(null);

  const originalDisplayName = user?.displayName || '';
  const [lastNameChange, setLastNameChange] = useState<string | null>(null);
  const [cooldown, setCooldown] = useState(() => getCooldownRemaining(null));

  useEffect(() => {
    if (!user?.id) return;
    let alive = true;
    (async () => {
      try {
        const profile = await getProfileById(user.id);
        if (alive && profile?.last_name_change) {
          setLastNameChange(profile.last_name_change);
          setCooldown(getCooldownRemaining(profile.last_name_change));
        }
      } catch {
        // Optional legacy column; keep normal edit flow available.
      }
    })();
    return () => { alive = false; };
  }, [user?.id]);

  useEffect(() => {
    if (!cooldown.locked) return;
    const id = setInterval(() => setCooldown(getCooldownRemaining(lastNameChange)), 60_000);
    return () => clearInterval(id);
  }, [cooldown.locked, lastNameChange]);

  useEffect(() => () => Object.values(previews).forEach((url) => url && URL.revokeObjectURL(url)), [previews]);

  if (!user) return null;

  const set = <K extends keyof Form>(key: K, value: Form[K]) => setForm((current) => ({ ...current, [key]: value }));
  const nameDisabled = cooldown.locked || saving;
  const nameChanged = form.displayName.trim() !== originalDisplayName.trim();

  const choose = (e: React.ChangeEvent<HTMLInputElement>, kind: 'profile' | 'cover') => {
    const file = e.target.files?.[0];
    if (!file) return;
    if (!file.type.startsWith('image/')) { toast('File harus gambar.', 'error'); return; }
    if (file.size > 5 * 1024 * 1024) { toast('Ukuran maksimal 5MB.', 'error'); return; }
    if (previews[kind]) URL.revokeObjectURL(previews[kind]!);
    const url = URL.createObjectURL(file);
    setPreviews((current) => ({ ...current, [kind]: url }));
    kind === 'profile' ? setProfileFile(file) : setCoverFile(file);
    e.target.value = '';
  };

  const toggleCat = (cat: CompetitionCategory) => setForm((current) => ({
    ...current,
    favoriteCategories: current.favoriteCategories.includes(cat)
      ? current.favoriteCategories.filter((value) => value !== cat)
      : [...current.favoriteCategories, cat],
  }));

  const handleSave = async () => {
    if (!form.displayName || !form.username) { toast('Nama dan username wajib diisi.', 'error'); return; }
    if (nameChanged && cooldown.locked) {
      toast(`Anda dapat mengubah nama lagi dalam ${cooldown.days} hari ${cooldown.hours} jam.`, 'error');
      return;
    }
    setSaving(true);
    try {
      const current = await getProfileById(user.id);
      const patch: Record<string, any> = {
        username: form.username,
        full_name: form.displayName,
        bio: form.bio,
        institution: form.school,
        birth_date: form.birthDate || null,
        grade: form.grade || null,
        subjects: form.favoriteCategories.join(','),
        accept_messages: form.acceptMessages,
      };

      const oldAvatar = current?.avatar_public_id as string | undefined;
      const oldCover = current?.cover_public_id as string | undefined;
      const uname = current?.username || user.username;

      if (profileFile) {
        const up = await uploadProfileImage(profileFile, 'profile', uname, oldAvatar || `sykabelajar/${uname}/profile`);
        Object.assign(patch, {
          avatar_url: up.secure_url,
          avatar_public_id: up.public_id,
          avatar_width: up.width ?? null,
          avatar_height: up.height ?? null,
          avatar_version: up.version ? String(up.version) : null,
          avatar_resource_type: up.resource_type || 'image',
        });
      } else if (!form.profilePhoto && oldAvatar) {
        Object.assign(patch, { avatar_url: null, avatar_public_id: null, avatar_width: null, avatar_height: null, avatar_version: null, avatar_resource_type: null });
      }

      if (coverFile) {
        const up = await uploadProfileImage(coverFile, 'cover', uname, oldCover || `sykabelajar/${uname}/cover`);
        Object.assign(patch, {
          cover_url: up.secure_url,
          cover_public_id: up.public_id,
          cover_width: up.width ?? null,
          cover_height: up.height ?? null,
          cover_version: up.version ? String(up.version) : null,
          cover_resource_type: up.resource_type || 'image',
        });
      } else if (!form.coverPhoto && oldCover) {
        Object.assign(patch, { cover_url: null, cover_public_id: null, cover_width: null, cover_height: null, cover_version: null, cover_resource_type: null });
      }

      if (form.pembina) patch.pembina = form.pembina;
      if (nameChanged) patch.last_name_change = new Date().toISOString();

      try {
        await updateProfileRecord(user.id, patch);
      } catch (saveErr: any) {
        const msg = String(saveErr?.message || saveErr || '');
        if (msg.includes('column') && (msg.includes('does not exist') || msg.includes('not found') || msg.includes('schema cache'))) {
          const { pembina: _p, last_name_change: _lnc, ...safePatch } = patch;
          await updateProfileRecord(user.id, safePatch);
        } else throw saveErr;
      }

      if (nameChanged) {
        const now = new Date().toISOString();
        setLastNameChange(now);
        setCooldown(getCooldownRemaining(now));
      }
      setForm((current) => ({ ...current, profilePhoto: patch.avatar_url ?? current.profilePhoto, coverPhoto: patch.cover_url ?? current.coverPhoto }));
      setProfileFile(null);
      setCoverFile(null);
      setPreviews({});
      toast('Profil berhasil diperbarui.', 'success');
      void refreshUser();
      navigate(`/profile/@${form.username}`);
    } catch (error: any) {
      toast(error?.message || 'Profil gagal diperbarui.', 'error');
    } finally {
      setSaving(false);
    }
  };

  const profileSrc = previews.profile || form.profilePhoto || undefined;
  const coverSrc = previews.cover || form.coverPhoto || undefined;
  const gradeGroups = GRADE_OPTIONS.reduce((acc, opt) => {
    if (!acc[opt.group]) acc[opt.group] = [];
    acc[opt.group].push(opt);
    return acc;
  }, {} as Record<string, typeof GRADE_OPTIONS>);

  return <div className="min-h-screen pb-28 md:pb-6">
    <div className="mx-auto max-w-5xl px-4 pt-4 md:px-6">
      <div className="mb-4 flex items-center justify-between gap-3">
        <button type="button" onClick={() => navigate(-1)} className="inline-flex items-center gap-2 text-sm text-fg-muted hover:text-fg"><ArrowLeft size={18}/> Kembali ke profil</button>
        <LinkButton to="/profile/interface-settings" icon={<Settings2 size={15}/>} label="Tampilan & Privasi" />
      </div>

      <div className="mb-5">
        <p className="text-[10px] font-semibold uppercase tracking-[0.16em] text-accent">Profil</p>
        <h1 className="font-display text-2xl font-bold text-fg">Edit Profil</h1>
        <p className="mt-1 text-sm text-fg-muted">Perbarui identitas, pendidikan, foto, dan preferensi pesan.</p>
      </div>

      <Card className="overflow-hidden p-0">
        <div className="relative h-32 bg-gradient-to-br from-surface-elevated to-surface-card md:h-40">
          {coverSrc && <img src={coverSrc} alt="Sampul profil" className="h-full w-full object-cover"/>}
          <div className="absolute inset-x-0 bottom-0 h-16 bg-gradient-to-t from-black/30 to-transparent"/>
          <button type="button" onClick={() => coverRef.current?.click()} className="absolute bottom-3 right-3 z-10 inline-flex items-center gap-1.5 rounded-xl bg-black/55 px-3 py-2 text-xs font-medium text-white backdrop-blur hover:bg-black/70"><Camera size={14}/> Ganti Sampul</button>
          <input ref={coverRef} type="file" accept="image/*" className="hidden" onChange={(e) => choose(e, 'cover')}/>
        </div>
        <div className="relative px-4 pb-5 md:px-6">
          <div className="-mt-10 flex items-end gap-4">
            <div className="relative shrink-0">
              {profileSrc ? <img src={profileSrc} alt="Foto profil" className="h-20 w-20 rounded-full object-cover ring-4 ring-white dark:ring-slate-950 md:h-24 md:w-24"/> : <div className="rounded-full ring-4 ring-white dark:ring-slate-950"><Avatar name={form.displayName} id={user.id} size={88}/></div>}
              <button type="button" onClick={() => profileRef.current?.click()} aria-label="Ganti foto profil" className="absolute bottom-0 right-0 flex h-8 w-8 items-center justify-center rounded-full border-2 border-white bg-accent text-white transition hover:scale-105 dark:border-slate-950"><Camera size={14}/></button>
            </div>
            <div className="min-w-0 pb-1"><p className="truncate text-sm font-bold text-fg">{form.displayName || 'Nama Tampilan'}</p><p className="text-xs text-fg-muted">@{form.username}</p></div>
          </div>
          <input ref={profileRef} type="file" accept="image/*" className="hidden" onChange={(e) => choose(e, 'profile')}/>
        </div>
      </Card>

      <div className="mt-4 grid gap-4 lg:grid-cols-2">
        <Card className="space-y-4 p-4 md:p-5">
          <h2 className="flex items-center gap-2 font-display text-sm font-semibold text-fg"><UserIcon size={16} className="text-accent"/> Informasi Dasar</h2>
          <div><label className="label">Nama Tampilan</label><div className="relative"><UserIcon size={16} className="absolute left-3 top-1/2 -translate-y-1/2 text-fg-muted"/><input className={`input pl-9 ${nameDisabled ? 'cursor-not-allowed opacity-60' : ''}`} value={form.displayName} onChange={(e) => set('displayName', e.target.value)} disabled={nameDisabled}/></div>{cooldown.locked && <div className="mt-2 flex items-center gap-1.5 rounded-lg border border-amber-500/20 bg-amber-500/10 px-3 py-2"><Clock size={14} className="shrink-0 text-amber-400"/><p className="text-xs text-amber-300">Bisa ganti lagi dalam <span className="font-semibold">{cooldown.days > 0 && `${cooldown.days} hari `}{cooldown.hours} jam {cooldown.minutes} mnt</span></p></div>}{!cooldown.locked && nameChanged && <div className="mt-2 flex items-center gap-1.5 rounded-lg border border-accent/20 bg-accent/5 px-3 py-2"><Check size={14} className="text-accent"/><p className="text-xs text-accent">Setelah disimpan, nama terkunci 7 hari.</p></div>}</div>
          <div><label className="label">Username</label><input className="input cursor-not-allowed opacity-60" value={form.username} disabled readOnly/><p className="mt-1 text-[10px] text-fg-muted">Tidak dapat diubah setelah pendaftaran.</p></div>
          <div><label className="label">Bio <span className="text-fg-muted">({form.bio.length}/160)</span></label><textarea className="input min-h-[90px] resize-none" maxLength={160} value={form.bio} onChange={(e) => set('bio', e.target.value)} /></div>
          <div><label className="label">Siapa yang bisa mengirim pesan</label><select className="input" value={form.acceptMessages} onChange={(e) => set('acceptMessages', e.target.value)}><option value="public">Semua orang (Publik)</option><option value="followers">Hanya Pengikut</option><option value="private">Tidak ada (Privat)</option></select><p className="mt-1 text-[10px] text-fg-muted">{form.acceptMessages === 'public' ? 'Semua pengguna bisa mengirim pesan langsung.' : form.acceptMessages === 'followers' ? 'Hanya pengikut yang disetujui yang bisa mengirim pesan.' : 'Tidak ada yang bisa mengirim pesan langsung.'}</p></div>
          <div><label className="label">Tanggal Lahir</label><div className="relative"><Calendar size={16} className="absolute left-3 top-1/2 -translate-y-1/2 text-fg-muted"/><input type="date" className="input pl-9" value={form.birthDate} onChange={(e) => set('birthDate', e.target.value)}/></div></div>
        </Card>

        <Card className="space-y-4 p-4 md:p-5">
          <h2 className="flex items-center gap-2 font-display text-sm font-semibold text-fg"><GraduationCap size={16} className="text-accent"/> Pendidikan</h2>
          <div><label className="label">Sekolah / Institusi</label><div className="relative"><School size={16} className="absolute left-3 top-1/2 -translate-y-1/2 text-fg-muted"/><input className="input pl-9" value={form.school} onChange={(e) => set('school', e.target.value)}/></div></div>
          <div><label className="label">Tingkat / Kelas</label><div className="relative"><GraduationCap size={16} className="absolute left-3 top-1/2 -translate-y-1/2 text-fg-muted"/><select className="input pl-9" value={form.grade} onChange={(e) => set('grade', e.target.value)}><option value="">Pilih tingkat...</option>{Object.entries(gradeGroups).map(([group, options]) => <optgroup key={group} label={group}>{options.map((opt) => <option key={opt.value} value={opt.value}>{opt.label}</option>)}</optgroup>)}</select></div></div>
          <div><label className="label">Nama Pembina <span className="text-fg-muted">(opsional)</span></label><div className="relative"><UserCheck size={16} className="absolute left-3 top-1/2 -translate-y-1/2 text-fg-muted"/><input className="input pl-9" value={form.pembina} onChange={(e) => set('pembina', e.target.value)} placeholder="Contoh: Pak Budi Santoso"/></div></div>
          <div className="rounded-2xl border border-accent/15 bg-accent/5 p-4"><p className="text-sm font-semibold text-fg">Badge & Privasi</p><p className="mt-1 text-xs leading-relaxed text-fg-muted">Pengaturan Badge Showcase, visibilitas badge, sosial, dan navigasi mobile sekarang terpusat di Tampilan & Privasi.</p><LinkButton to="/profile/interface-settings" label="Buka Tampilan & Privasi" icon={<Settings2 size={14}/>} className="mt-3"/></div>
        </Card>
      </div>

      <div className="mt-4 grid gap-4 lg:grid-cols-2">
        <Card className="p-4 md:p-5"><h2 className="font-display text-sm font-semibold text-fg">Kategori Favorit</h2><div className="mt-3 grid grid-cols-2 gap-2">{Object.entries(CATEGORY_LABELS).map(([key, label]) => { const selected = form.favoriteCategories.includes(key as CompetitionCategory); return <button key={key} type="button" onClick={() => toggleCat(key as CompetitionCategory)} className={`flex items-center justify-between rounded-xl border p-3 text-sm transition ${selected ? 'border-accent bg-accent-muted-strong font-medium text-accent' : 'surface-border text-fg-secondary hover:border-accent/30'}`}>{label}{selected && <Check size={16}/>}</button>; })}</div></Card>
        {user.emblems.length > 0 && <Card className="p-4 md:p-5"><h2 className="font-display text-sm font-semibold text-fg">Emblem Showcase <span className="font-normal text-fg-muted">(maks 3)</span></h2><div className="mt-3 flex flex-wrap gap-2">{user.emblems.map((emblem) => { const selected = form.showcaseEmblems.includes(emblem.id); return <button key={emblem.id} type="button" aria-pressed={selected} onClick={() => setForm((current) => ({ ...current, showcaseEmblems: selected ? current.showcaseEmblems.filter((id) => id !== emblem.id) : current.showcaseEmblems.length < 3 ? [...current.showcaseEmblems, emblem.id] : current.showcaseEmblems }))} className={`rounded-xl border p-1.5 transition ${selected ? 'border-accent bg-accent-muted' : 'surface-border hover:border-accent/30'}`}><EmblemIcon emblem={emblem} size={30}/></button>; })}</div></Card>}
      </div>

      <div className="mt-4 flex justify-end gap-2 pb-2"><Button variant="outline" onClick={() => navigate(-1)}>Batal</Button><Button loading={saving} onClick={() => void handleSave()}>Simpan Perubahan</Button></div>
    </div>

    <div className="md:hidden fixed inset-x-0 bottom-0 z-30 flex gap-3 border-t surface-border glass px-4 py-3 safe-area-bottom"><Button variant="outline" fullWidth onClick={() => navigate(-1)}>Batal</Button><Button fullWidth loading={saving} onClick={() => void handleSave()}>Simpan</Button></div>
  </div>;
}

function LinkButton({ to, label, icon, className = '' }: { to: string; label: string; icon?: ReactNode; className?: string }) {
  return <a href={to} className={`inline-flex items-center gap-2 rounded-xl border border-accent/20 bg-accent/5 px-3 py-2 text-xs font-semibold text-accent transition hover:bg-accent/10 ${className}`}>{icon}{label}</a>;
}

type ReactNode = import('react').ReactNode;
