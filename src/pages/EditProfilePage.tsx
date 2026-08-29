import { useEffect, useRef, useState } from 'react';
import { ArrowLeft, Camera, Calendar, Check, GraduationCap, School, User as UserIcon, UserCheck } from 'lucide-react';
import { useNavigate } from 'react-router-dom';
import { Avatar } from '@/components/ui/Avatar';
import { Button } from '@/components/ui/Button';
import { Card } from '@/components/ui/Card';
import { EmblemIcon } from '@/components/ui/Emblem';
import { useApp } from '@/store/AppContext';
import { CATEGORY_LABELS, GRADE_OPTIONS } from '@/data/catalog';
import { deleteImage, uploadImage } from '@/services/cloudinary.service';
import { getProfileById, updateProfile as updateProfileRecord } from '@/services/profile.service';
import type { CompetitionCategory, EducationLevel } from '@/types';

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

  useEffect(() => () => Object.values(previews).forEach(url => url && URL.revokeObjectURL(url)), [previews]);

  if (!user) return null;

  const set = <K extends keyof Form>(k: K, v: Form[K]) => setForm(f => ({ ...f, [k]: v }));

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
    if (!form.displayName || !form.username) {
      toast('Nama dan username wajib diisi.', 'error');
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
      };
      // Only add new columns if they have values (graceful fallback for missing columns)
      if (form.pembina) patch.pembina = form.pembina;
      if (form.badgeShowcase.length > 0) patch.badge_showcase = form.badgeShowcase;
      if (form.badgeShowcaseManual) patch.badge_showcase_manual = true;

      const oldAvatar = current?.avatar_public_id as string | undefined;
      const oldCover = current?.cover_public_id as string | undefined;

      // Upload profile image (direct to Cloudinary, no Edge Function)
      if (profileFile) {
        const up = await uploadImage(profileFile, `sykabelajar/users/profiles/${user.id}`);
        Object.assign(patch, {
          avatar_url: up.secure_url,
          avatar_public_id: up.public_id,
          avatar_width: up.width ?? null,
          avatar_height: up.height ?? null,
          avatar_version: up.version ? String(up.version) : null,
          avatar_resource_type: up.resource_type || 'image',
        });
      } else if (!form.profilePhoto && oldAvatar) {
        Object.assign(patch, {
          avatar_url: null, avatar_public_id: null,
          avatar_width: null, avatar_height: null,
          avatar_version: null, avatar_resource_type: null,
        });
      }

      // Upload cover image (direct to Cloudinary, no Edge Function)
      if (coverFile) {
        const up = await uploadImage(coverFile, `sykabelajar/users/covers/${user.id}`);
        Object.assign(patch, {
          cover_url: up.secure_url,
          cover_public_id: up.public_id,
          cover_width: up.width ?? null,
          cover_height: up.height ?? null,
          cover_version: up.version ? String(up.version) : null,
          cover_resource_type: up.resource_type || 'image',
        });
      } else if (!form.coverPhoto && oldCover) {
        Object.assign(patch, {
          cover_url: null, cover_public_id: null,
          cover_width: null, cover_height: null,
          cover_version: null, cover_resource_type: null,
        });
      }

      // Try save with all fields first; if it fails due to missing columns, retry without optional ones
      try {
        await updateProfileRecord(user.id, patch);
      } catch (saveErr: any) {
        const msg = String(saveErr?.message || saveErr || '');
        // If error mentions missing column, remove optional fields and retry
        if (msg.includes('column') && (msg.includes('does not exist') || msg.includes('not found') || msg.includes('schema cache'))) {
          const { pembina: _p, badge_showcase: _b, badge_showcase_manual: _bm, ...safePatch } = patch;
          await updateProfileRecord(user.id, safePatch);
        } else {
          throw saveErr;
        }
      }

      // Delete old images from Cloudinary
      if (profileFile && oldAvatar && oldAvatar !== patch.avatar_public_id) void deleteImage(oldAvatar);
      if (coverFile && oldCover && oldCover !== patch.cover_public_id) void deleteImage(oldCover);

      setForm(f => ({
        ...f,
        profilePhoto: patch.avatar_url ?? f.profilePhoto,
        coverPhoto: patch.cover_url ?? f.coverPhoto,
      }));
      setProfileFile(null);
      setCoverFile(null);
      setPreviews({});
      toast('Profil berhasil diperbarui.', 'success');
      // Refresh user data in context so profile page shows updated values
      void refreshUser();
      navigate(`/profile/${form.username}`);
    } catch (error: any) {
      toast(error?.message || 'Profil gagal diperbarui.', 'error');
    } finally {
      setSaving(false);
    }
  };

  const profileSrc = previews.profile || form.profilePhoto || undefined;
  const coverSrc = previews.cover || form.coverPhoto || undefined;

  // Group grades by SD/SMP/SMA
  const gradeGroups = GRADE_OPTIONS.reduce((acc, opt) => {
    if (!acc[opt.group]) acc[opt.group] = [];
    acc[opt.group].push(opt);
    return acc;
  }, {} as Record<string, typeof GRADE_OPTIONS>);

  return (
    <div>
      {/* Header */}
      <div className="sticky top-0 z-20 glass border-b border-white/5 px-4 py-3 flex items-center gap-3">
        <button onClick={() => navigate(-1)} className="p-2 rounded-lg hover:bg-white/5">
          <ArrowLeft size={19} />
        </button>
        <h2 className="font-display font-semibold text-sm text-white">Edit Profil</h2>
      </div>

      <div className="max-w-lg mx-auto p-4 space-y-4">
        {/* Cover */}
        <Card className="p-0 overflow-hidden">
          <div className="relative h-32 bg-gradient-to-br from-ink-700 to-ink-850">
            {coverSrc && <img src={coverSrc} alt="Cover" className="w-full h-full object-cover" />}
            <button type="button" onClick={() => coverRef.current?.click()}
              className="absolute bottom-2 right-2 px-3 py-1.5 rounded-lg bg-black/60 text-white text-xs flex items-center gap-1.5">
              <Camera size={14} /> Ganti Sampul
            </button>
            <input ref={coverRef} type="file" accept="image/*" className="hidden" onChange={e => choose(e, 'cover')} />
          </div>
        </Card>

        {/* Avatar */}
        <Card className="p-6 text-center">
          <div className="relative inline-block">
            {profileSrc
              ? <img src={profileSrc} alt="Profile" className="w-20 h-20 rounded-full object-cover ring-2 ring-moss-500/30" />
              : <Avatar name={form.displayName} id={user.id} size={80} ring />
            }
            <button type="button" onClick={() => profileRef.current?.click()}
              className="absolute bottom-0 right-0 w-8 h-8 rounded-full bg-moss-600 flex items-center justify-center border-2 border-ink-900">
              <Camera size={14} />
            </button>
          </div>
          <div className="mt-3 flex justify-center gap-3">
            <button type="button" onClick={() => profileRef.current?.click()} className="text-xs text-moss-400">
              {profileFile ? 'Foto baru dipilih' : 'Pilih foto profil'}
            </button>
            {form.profilePhoto && !profileFile && (
              <button type="button" onClick={() => set('profilePhoto', '')} className="text-xs text-red-400">Hapus</button>
            )}
          </div>
          <p className="text-[10px] text-slate-600 mt-1">Preview lokal. Upload berjalan saat Simpan.</p>
          <input ref={profileRef} type="file" accept="image/*" className="hidden" onChange={e => choose(e, 'profile')} />
        </Card>

        {/* Basic Info */}
        <Card className="p-4 space-y-4">
          <h3 className="font-display font-semibold text-sm text-white">Informasi Dasar</h3>
          <div>
            <label className="label">Nama Tampilan</label>
            <div className="relative">
              <UserIcon size={16} className="absolute left-3 top-1/2 -translate-y-1/2 text-slate-500" />
              <input className="input pl-9" value={form.displayName} onChange={e => set('displayName', e.target.value)} />
            </div>
          </div>
          <div>
            <label className="label">Username</label>
            <input className="input" value={form.username} onChange={e => set('username', e.target.value.replace(/\s/g, '').toLowerCase())} />
          </div>
          <div>
            <label className="label">Bio</label>
            <textarea className="input min-h-[80px]" maxLength={160} value={form.bio} onChange={e => set('bio', e.target.value)} />
          </div>
          <div>
            <label className="label">Tanggal Lahir</label>
            <div className="relative">
              <Calendar size={16} className="absolute left-3 top-1/2 -translate-y-1/2 text-slate-500" />
              <input type="date" className="input pl-9" value={form.birthDate} onChange={e => set('birthDate', e.target.value)} />
            </div>
          </div>
        </Card>

        {/* Education */}
        <Card className="p-4 space-y-4">
          <h3 className="font-display font-semibold text-sm text-white">Pendidikan</h3>
          <div>
            <label className="label">Sekolah / Institusi</label>
            <div className="relative">
              <School size={16} className="absolute left-3 top-1/2 -translate-y-1/2 text-slate-500" />
              <input className="input pl-9" value={form.school} onChange={e => set('school', e.target.value)} />
            </div>
          </div>

          {/* Granular grade selection */}
          <div>
            <label className="label">Tingkat / Kelas</label>
            <div className="relative">
              <GraduationCap size={16} className="absolute left-3 top-1/2 -translate-y-1/2 text-slate-500" />
              <select className="input pl-9" value={form.grade} onChange={e => set('grade', e.target.value)}>
                <option value="">Pilih tingkat...</option>
                {Object.entries(gradeGroups).map(([group, options]) => (
                  <optgroup key={group} label={group}>
                    {options.map(opt => (
                      <option key={opt.value} value={opt.value}>{opt.label}</option>
                    ))}
                  </optgroup>
                ))}
              </select>
            </div>
          </div>

          {/* Pembina */}
          <div>
            <label className="label">Nama Pembina</label>
            <div className="relative">
              <UserCheck size={16} className="absolute left-3 top-1/2 -translate-y-1/2 text-slate-500" />
              <input
                className="input pl-9"
                value={form.pembina}
                onChange={e => set('pembina', e.target.value)}
                placeholder="Contoh: Pak Budi Santoso"
              />
            </div>
            <p className="text-[10px] text-slate-600 mt-1">Nama pembina/pendamping (opsional)</p>
          </div>
        </Card>

        {/* Favorite Categories */}
        <Card className="p-4 space-y-3">
          <h3 className="font-display font-semibold text-sm text-white">Kategori Favorit</h3>
          <div className="grid grid-cols-2 gap-2">
            {Object.entries(CATEGORY_LABELS).map(([key, label]) => {
              const selected = form.favoriteCategories.includes(key as CompetitionCategory);
              return (
                <button key={key} onClick={() => toggleCat(key as CompetitionCategory)}
                  className={`p-3 rounded-xl border text-sm flex items-center justify-between ${
                    selected ? 'border-moss-500 bg-moss-500/10 text-moss-300' : 'border-white/10 text-slate-300'
                  }`}>
                  {label}
                  {selected && <Check size={16} />}
                </button>
              );
            })}
          </div>
        </Card>

        {/* Emblems */}
        {user.emblems.length > 0 && (
          <Card className="p-4 space-y-3">
            <div>
              <h3 className="font-display font-semibold text-sm text-white">Emblem Showcase</h3>
              <p className="text-xs text-slate-500">Pilih maksimal 3.</p>
            </div>
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
                    className={`p-1.5 rounded-xl border ${selected ? 'border-moss-500 bg-moss-500/10' : 'border-white/10'}`}>
                    <EmblemIcon emblem={emblem} size={28} />
                  </button>
                );
              })}
            </div>
          </Card>
        )}

        {/* Badge Showcase — Top 3 */}
        <Card className="p-4 space-y-3">
          <div className="flex items-center justify-between">
            <div>
              <h3 className="font-display font-semibold text-sm text-white">Badge Showcase</h3>
              <p className="text-xs text-slate-500">Tampilan badge di profil Anda (maks 3).</p>
            </div>
            <button
              onClick={() => setForm(f => ({ ...f, badgeShowcaseManual: !f.badgeShowcaseManual }))}
              className={`relative w-10 h-5 rounded-full transition ${form.badgeShowcaseManual ? 'bg-moss-500' : 'bg-ink-700'}`}
            >
              <div className={`absolute top-0.5 w-4 h-4 rounded-full bg-white shadow transition-transform ${form.badgeShowcaseManual ? 'translate-x-5' : 'translate-x-0.5'}`} />
            </button>
          </div>
          <p className="text-[10px] text-slate-600">
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
                      selected ? 'border-moss-500 bg-moss-500/15 text-moss-300' : 'border-white/10 text-slate-400 hover:border-white/20'
                    }`}>
                    {badge}
                  </button>
                );
              })}
            </div>
          )}
        </Card>

        {/* Actions */}
        <div className="flex gap-2 pb-4">
          <Button variant="outline" fullWidth onClick={() => navigate(-1)}>Batal</Button>
          <Button fullWidth loading={saving} onClick={() => void handleSave()}>Simpan Perubahan</Button>
        </div>
      </div>
    </div>
  );
}
