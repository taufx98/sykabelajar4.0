import { useEffect, useRef, useState } from 'react';
import { ArrowLeft, Camera, Calendar, Check, GraduationCap, School, User as UserIcon, UserCheck, Clock } from 'lucide-react';
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
  badgeShowcase: string[];
  badgeShowcaseManual: boolean;
  profilePhoto: string;
  coverPhoto: string;
}

// ── Cooldown ───────────────────────────────────────────────────
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
    showcaseEmblems: user?.showcaseEmblems || user?.emblems?.slice(0, 3).map(e => e.id) || [],
    badgeShowcase: (user as any)?.badgeShowcase || [],
    badgeShowcaseManual: (user as any)?.badgeShowcaseManual || false,
    profilePhoto: user?.profilePhoto || '',
    coverPhoto: user?.coverPhoto || '',
  });

  const [profileFile, setProfileFile] = useState<File | null>(null);
  const [coverFile, setCoverFile] = useState<File | null>(null);
  const [saving, setSaving] = useState(false);
  const [previews, setPreviews] = useState<{ profile?: string; cover?: string }>({});
  const profileRef = useRef<HTMLInputElement>(null);
  const coverRef = useRef<HTMLInputElement>(null);

  // ── Name cooldown ────────────────────────────────────────────
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
      } catch { /* column might not exist */ }
    })();
    return () => { alive = false; };
  }, [user?.id]);

  useEffect(() => {
    if (!cooldown.locked) return;
    const id = setInterval(() => setCooldown(getCooldownRemaining(lastNameChange)), 60_000);
    return () => clearInterval(id);
  }, [cooldown.locked, lastNameChange]);

  useEffect(() => () => Object.values(previews).forEach(u => u && URL.revokeObjectURL(u)), [previews]);

  if (!user) return null;

  const set = <K extends keyof Form>(k: K, v: Form[K]) => setForm(f => ({ ...f, [k]: v }));
  const nameDisabled = cooldown.locked || saving;
  const nameChanged = form.displayName.trim() !== originalDisplayName.trim();

  const choose = (e: React.ChangeEvent<HTMLInputElement>, kind: 'profile' | 'cover') => {
    const file = e.target.files?.[0];
    if (!file) return;
    if (!file.type.startsWith('image/')) { toast('File harus gambar.', 'error'); return; }
    if (file.size > 5 * 1024 * 1024) { toast('Ukuran maksimal 5MB.', 'error'); return; }
    if (previews[kind]) URL.revokeObjectURL(previews[kind]!);
    const url = URL.createObjectURL(file);
    setPreviews(p => ({ ...p, [kind]: url }));
    kind === 'profile' ? setProfileFile(file) : setCoverFile(file);
    e.target.value = '';
  };

  const toggleCat = (cat: CompetitionCategory) =>
    setForm(f => ({
      ...f,
      favoriteCategories: f.favoriteCategories.includes(cat)
        ? f.favoriteCategories.filter(c => c !== cat)
        : [...f.favoriteCategories, cat],
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
        username: form.username, full_name: form.displayName, bio: form.bio,
        institution: form.school, birth_date: form.birthDate || null, grade: form.grade || null,
      };
      patch.subjects = form.favoriteCategories.join(',');
      if (form.pembina) patch.pembina = form.pembina;
      if (form.badgeShowcase.length > 0) patch.badge_showcase = form.badgeShowcase;
      if (form.badgeShowcaseManual) patch.badge_showcase_manual = true;

      const oldAvatar = current?.avatar_public_id as string | undefined;
      const oldCover = current?.cover_public_id as string | undefined;
      const uname = current?.username || user.username;

      if (profileFile) {
        const up = await uploadProfileImage(profileFile, 'profile', uname, oldAvatar || `sykabelajar/${uname}/profile`);
        Object.assign(patch, { avatar_url: up.secure_url, avatar_public_id: up.public_id, avatar_width: up.width ?? null, avatar_height: up.height ?? null, avatar_version: up.version ? String(up.version) : null, avatar_resource_type: up.resource_type || 'image' });
      } else if (!form.profilePhoto && oldAvatar) {
        Object.assign(patch, { avatar_url: null, avatar_public_id: null, avatar_width: null, avatar_height: null, avatar_version: null, avatar_resource_type: null });
      }

      if (coverFile) {
        const up = await uploadProfileImage(coverFile, 'cover', uname, oldCover || `sykabelajar/${uname}/cover`);
        Object.assign(patch, { cover_url: up.secure_url, cover_public_id: up.public_id, cover_width: up.width ?? null, cover_height: up.height ?? null, cover_version: up.version ? String(up.version) : null, cover_resource_type: up.resource_type || 'image' });
      } else if (!form.coverPhoto && oldCover) {
        Object.assign(patch, { cover_url: null, cover_public_id: null, cover_width: null, cover_height: null, cover_version: null, cover_resource_type: null });
      }

      if (nameChanged) patch.last_name_change = new Date().toISOString();

      try { await updateProfileRecord(user.id, patch); }
      catch (saveErr: any) {
        const msg = String(saveErr?.message || saveErr || '');
        if (msg.includes('column') && (msg.includes('does not exist') || msg.includes('not found') || msg.includes('schema cache'))) {
          const { pembina: _p, badge_showcase: _b, badge_showcase_manual: _bm, last_name_change: _lnc, ...safePatch } = patch;
          await updateProfileRecord(user.id, safePatch);
        } else throw saveErr;
      }

      if (nameChanged) { const now = new Date().toISOString(); setLastNameChange(now); setCooldown(getCooldownRemaining(now)); }
      setForm(f => ({ ...f, profilePhoto: patch.avatar_url ?? f.profilePhoto, coverPhoto: patch.cover_url ?? f.coverPhoto }));
      setProfileFile(null); setCoverFile(null); setPreviews({});
      toast('Profil berhasil diperbarui.', 'success');
      void refreshUser();
      navigate(`/profile/${form.username}`);
    } catch (error: any) { toast(error?.message || 'Profil gagal diperbarui.', 'error'); }
    finally { setSaving(false); }
  };

  const profileSrc = previews.profile || form.profilePhoto || undefined;
  const coverSrc = previews.cover || form.coverPhoto || undefined;

  const gradeGroups = GRADE_OPTIONS.reduce((acc, opt) => {
    if (!acc[opt.group]) acc[opt.group] = [];
    acc[opt.group].push(opt);
    return acc;
  }, {} as Record<string, typeof GRADE_OPTIONS>);

  return (
    <div className="min-h-screen">
      {/* ═══ STICKY HEADER ═══ */}
      <div className="sticky top-0 z-20 glass border-b surface-border px-4 py-3 flex items-center gap-3">
        <button onClick={() => navigate(-1)} className="p-2 rounded-lg hover:bg-white/5 transition">
          <ArrowLeft size={19} className="text-fg" />
        </button>
        <h2 className="font-display font-semibold text-sm text-fg">Edit Profil</h2>
      </div>

      {/* ═══ CONTENT — scrollable area above mobile action bar ═══ */}
      <div className="max-w-4xl mx-auto p-4 md:p-6 space-y-4 pb-28 md:pb-6">

        {/* ═══ MEDIA HEADER — Compact Banner + Avatar ═══ */}
        <Card className="p-0 overflow-hidden">
          {/* Cover */}
          <div className="relative h-28 md:h-36 bg-gradient-to-br from-ink-700 to-ink-850">
            {coverSrc && <img src={coverSrc} alt="Cover" className="w-full h-full object-cover" />}
            <div className="absolute inset-x-0 bottom-0 h-12 bg-gradient-to-t from-surface-card to-transparent" />
            <button type="button" onClick={() => coverRef.current?.click()}
              className="absolute bottom-2 right-2 px-3 py-1.5 rounded-lg bg-black/50 backdrop-blur-sm text-white text-xs flex items-center gap-1.5 hover:bg-black/70 transition z-10">
              <Camera size={14} /> Ganti Sampul
            </button>
            <input ref={coverRef} type="file" accept="image/*" className="hidden" onChange={e => choose(e, 'cover')} />
          </div>

          {/* Avatar — overlapping cover */}
          <div className="relative px-4 md:px-6 pb-4">
            <div className="flex items-end gap-4 -mt-10 md:-mt-12">
              <div className="relative shrink-0">
                {profileSrc
                  ? <img src={profileSrc} alt="Profile" className="w-20 h-20 md:w-24 md:h-24 rounded-full object-cover ring-4 surface-card-bg" />
                  : <div className="ring-4 surface-card-bg rounded-full inline-block"><Avatar name={form.displayName} id={user.id} size={80} /></div>
                }
                <button type="button" onClick={() => profileRef.current?.click()}
                  className="absolute bottom-0 right-0 w-8 h-8 rounded-full bg-accent flex items-center justify-center border-2 surface-card-bg text-white hover:scale-110 transition">
                  <Camera size={14} />
                </button>
              </div>
              <div className="pb-1 min-w-0">
                <p className="text-sm font-bold text-fg truncate">{form.displayName || 'Nama Tampilan'}</p>
                <p className="text-xs text-fg-muted">@{form.username}</p>
                <div className="flex gap-3 mt-1">
                  <button type="button" onClick={() => profileRef.current?.click()} className="text-[11px] text-accent hover:underline">
                    {profileFile ? '✓ Foto dipilih' : 'Ubah foto'}
                  </button>
                  {form.profilePhoto && !profileFile && (
                    <button type="button" onClick={() => set('profilePhoto', '')} className="text-[11px] text-red-400 hover:underline">Hapus</button>
                  )}
                </div>
              </div>
            </div>
            <input ref={profileRef} type="file" accept="image/*" className="hidden" onChange={e => choose(e, 'profile')} />
          </div>
        </Card>

        {/* ═══ FORM GRID — 2 columns on desktop ═══ */}
        <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">

          {/* ── LEFT: Informasi Dasar ── */}
          <Card className="p-4 md:p-5 space-y-4">
            <h3 className="font-display font-semibold text-sm text-fg flex items-center gap-2">
              <UserIcon size={16} className="text-accent" /> Informasi Dasar
            </h3>

            {/* Nama Tampilan */}
            <div>
              <label className="label">Nama Tampilan</label>
              <div className="relative">
                <UserIcon size={16} className="absolute left-3 top-1/2 -translate-y-1/2 text-fg-muted" />
                <input
                  className={`input pl-9 ${nameDisabled ? 'opacity-60 cursor-not-allowed' : ''}`}
                  value={form.displayName}
                  onChange={e => set('displayName', e.target.value)}
                  disabled={nameDisabled}
                />
              </div>
              {cooldown.locked && (
                <div className="flex items-center gap-1.5 mt-2 px-3 py-2 rounded-lg bg-amber-500/10 border border-amber-500/20">
                  <Clock size={14} className="text-amber-400 shrink-0" />
                  <p className="text-xs text-amber-300">
                    Bisa ganti lagi dalam{' '}
                    <span className="font-semibold text-amber-200">
                      {cooldown.days > 0 && `${cooldown.days} hari `}{cooldown.hours} jam {cooldown.minutes} mnt
                    </span>
                  </p>
                </div>
              )}
              {!cooldown.locked && nameChanged && (
                <div className="flex items-center gap-1.5 mt-2 px-3 py-2 rounded-lg bg-accent-muted border border-accent/20">
                  <Check size={14} className="text-accent shrink-0" />
                  <p className="text-xs text-accent">Setelah disimpan, nama terkunci 7 hari.</p>
                </div>
              )}
            </div>

            {/* Username */}
            <div>
              <label className="label">Username</label>
              <input className="input opacity-60 cursor-not-allowed" value={form.username} disabled readOnly />
              <p className="text-[10px] text-fg-muted mt-1">Tidak dapat diubah setelah pendaftaran.</p>
            </div>

            {/* Bio */}
            <div>
              <label className="label">Bio <span className="text-fg-muted">({form.bio.length}/160)</span></label>
              <textarea className="input min-h-[80px] resize-none" maxLength={160} value={form.bio} onChange={e => set('bio', e.target.value)} />
            </div>

            {/* Tanggal Lahir */}
            <div>
              <label className="label">Tanggal Lahir</label>
              <div className="relative">
                <Calendar size={16} className="absolute left-3 top-1/2 -translate-y-1/2 text-fg-muted" />
                <input type="date" className="input pl-9" value={form.birthDate} onChange={e => set('birthDate', e.target.value)} />
              </div>
            </div>
          </Card>

          {/* ── RIGHT: Pendidikan ── */}
          <Card className="p-4 md:p-5 space-y-4">
            <h3 className="font-display font-semibold text-sm text-fg flex items-center gap-2">
              <GraduationCap size={16} className="text-accent" /> Pendidikan
            </h3>

            {/* Sekolah */}
            <div>
              <label className="label">Sekolah / Institusi</label>
              <div className="relative">
                <School size={16} className="absolute left-3 top-1/2 -translate-y-1/2 text-fg-muted" />
                <input className="input pl-9" value={form.school} onChange={e => set('school', e.target.value)} />
              </div>
            </div>

            {/* Tingkat / Kelas */}
            <div>
              <label className="label">Tingkat / Kelas</label>
              <div className="relative">
                <GraduationCap size={16} className="absolute left-3 top-1/2 -translate-y-1/2 text-fg-muted" />
                <select className="input pl-9" value={form.grade} onChange={e => set('grade', e.target.value)}>
                  <option value="">Pilih tingkat...</option>
                  {Object.entries(gradeGroups).map(([group, options]) => (
                    <optgroup key={group} label={group}>
                      {options.map(opt => <option key={opt.value} value={opt.value}>{opt.label}</option>)}
                    </optgroup>
                  ))}
                </select>
              </div>
            </div>

            {/* Pembina */}
            <div>
              <label className="label">Nama Pembina <span className="text-fg-muted">(opsional)</span></label>
              <div className="relative">
                <UserCheck size={16} className="absolute left-3 top-1/2 -translate-y-1/2 text-fg-muted" />
                <input className="input pl-9" value={form.pembina} onChange={e => set('pembina', e.target.value)} placeholder="Contoh: Pak Budi Santoso" />
              </div>
            </div>
          </Card>
        </div>

        {/* ═══ FULL-WIDTH SECTIONS ═══ */}
        <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">

          {/* ── Kategori Favorit ── */}
          <Card className="p-4 md:p-5">
            <h3 className="font-display font-semibold text-sm text-fg mb-3">Kategori Favorit</h3>
            <div className="grid grid-cols-2 gap-2">
              {Object.entries(CATEGORY_LABELS).map(([key, label]) => {
                const selected = form.favoriteCategories.includes(key as CompetitionCategory);
                return (
                  <button key={key} onClick={() => toggleCat(key as CompetitionCategory)}
                    className={`p-3 rounded-xl border text-sm flex items-center justify-between transition ${
                      selected
                        ? 'border-accent bg-accent-muted text-accent font-medium'
                        : 'surface-border text-fg-secondary hover:border-accent/30'
                    }`}>
                    {label}
                    {selected && <Check size={16} />}
                  </button>
                );
              })}
            </div>
          </Card>

          {/* ── Badge Showcase ── */}
          <Card className="p-4 md:p-5">
            <div className="flex items-center justify-between mb-2">
              <h3 className="font-display font-semibold text-sm text-fg">Badge Showcase</h3>
              <button
                onClick={() => setForm(f => ({ ...f, badgeShowcaseManual: !f.badgeShowcaseManual }))}
                className={`relative w-10 h-5 rounded-full transition ${form.badgeShowcaseManual ? 'bg-accent' : 'bg-ink-700'}`}
              >
                <div className={`absolute top-0.5 w-4 h-4 rounded-full bg-white shadow transition-transform ${form.badgeShowcaseManual ? 'translate-x-5' : 'translate-x-0.5'}`} />
              </button>
            </div>
            <p className="text-[10px] text-fg-muted mb-3">
              {form.badgeShowcaseManual ? 'Mode manual — pilih badge sendiri.' : 'Mode otomatis — badge terbaru ditampilkan.'}
            </p>
            {form.badgeShowcaseManual && (
              <div className="flex flex-wrap gap-2">
                {['Streak 30 Hari', 'Top 10 Nasional', 'Juara 1 Lomba', 'Siswa Aktif', 'Penggiat Sains'].map(badge => {
                  const selected = form.badgeShowcase.includes(badge);
                  return (
                    <button key={badge}
                      onClick={() => setForm(f => ({
                        ...f,
                        badgeShowcase: selected
                          ? f.badgeShowcase.filter(b => b !== badge)
                          : f.badgeShowcase.length < 3 ? [...f.badgeShowcase, badge] : f.badgeShowcase,
                      }))}
                      className={`px-3 py-1.5 rounded-full text-xs font-medium border transition ${
                        selected ? 'border-accent bg-accent-muted text-accent' : 'surface-border text-fg-muted hover:border-accent/30'
                      }`}>
                      {badge}
                    </button>
                  );
                })}
              </div>
            )}
          </Card>
        </div>

        {/* ── Emblem Showcase (if any) ── */}
        {user.emblems.length > 0 && (
          <Card className="p-4 md:p-5">
            <h3 className="font-display font-semibold text-sm text-fg mb-3">Emblem Showcase <span className="text-fg-muted font-normal">(maks 3)</span></h3>
            <div className="flex flex-wrap gap-2">
              {user.emblems.map(emblem => {
                const selected = form.showcaseEmblems.includes(emblem.id);
                return (
                  <button key={emblem.id}
                    onClick={() => setForm(f => ({
                      ...f,
                      showcaseEmblems: selected
                        ? f.showcaseEmblems.filter(id => id !== emblem.id)
                        : f.showcaseEmblems.length < 3 ? [...f.showcaseEmblems, emblem.id] : f.showcaseEmblems,
                    }))}
                    className={`p-1.5 rounded-xl border transition ${selected ? 'border-accent bg-accent-muted' : 'surface-border hover:border-accent/30'}`}>
                    <EmblemIcon emblem={emblem} size={28} />
                  </button>
                );
              })}
            </div>
          </Card>
        )}
      </div>

      {/* ═══ DESKTOP: Sticky bottom bar ═══ */}
      <div className="hidden md:block sticky bottom-0 z-20 glass border-t surface-border">
        <div className="max-w-4xl mx-auto px-6 py-3 flex items-center justify-end gap-3">
          <Button variant="outline" onClick={() => navigate(-1)}>Batal</Button>
          <Button loading={saving} onClick={() => void handleSave()}>Simpan Perubahan</Button>
        </div>
      </div>

      {/* ═══ MOBILE: Fixed bottom action bar ═══ */}
      <div className="md:hidden fixed bottom-0 inset-x-0 z-30 glass border-t surface-border px-4 py-3 flex gap-3 safe-area-bottom">
        <Button variant="outline" fullWidth onClick={() => navigate(-1)}>Batal</Button>
        <Button fullWidth loading={saving} onClick={() => void handleSave()}>Simpan</Button>
      </div>
    </div>
  );
}
