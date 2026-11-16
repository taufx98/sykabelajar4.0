import { useEffect, useMemo, useState } from 'react';
import { Navigate, useNavigate, useSearchParams } from 'react-router-dom';
import { ArrowLeft, ArrowRight, CalendarDays, Check, GraduationCap, School, Sparkles, UserRound } from 'lucide-react';
import { Button } from '@/components/ui/Button';
import { useApp } from '@/store/AppContext';
import { useLanguage } from '@/lib/LanguageContext';
import { CATEGORY_LABELS, LEVEL_LABELS } from '@/data/catalog';
import { completeBetterAuthProfile } from '@/services/profileOnboarding.service';
import { needsInitialProfileCompletion, validateInitialProfile } from '@/lib/profileOnboarding.mjs';
import { resolveSafeInternalRedirect } from '@/lib/safeInternalRedirect.mjs';
import type { CompetitionCategory, EducationLevel, User } from '@/types';

type FormState = {
  fullName: string;
  username: string;
  birthDate: string;
  institution: string;
  grade: EducationLevel | '';
  subjects: CompetitionCategory[];
};

const EMPTY_FORM: FormState = {
  fullName: '',
  username: '',
  birthDate: '',
  institution: '',
  grade: '',
  subjects: [],
};

export function AuthSocialOnboardingPage() {
  const { language } = useLanguage();
  const t = (id: string, en: string) => language === 'en' ? en : id;
  const navigate = useNavigate();
  const [searchParams] = useSearchParams();
  const returnPath = resolveSafeInternalRedirect(searchParams.get('redirect') || '/home', window.location.origin);
  const { user, isAuthenticated, authLoading, refreshUser, toast, logout } = useApp();
  const [form, setForm] = useState<FormState>(EMPTY_FORM);
  const [step, setStep] = useState<1 | 2>(1);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');

  useEffect(() => {
    if (!user) return;
    const profile = user as User & { grade?: string };
    const rawGrade = profile.grade;
    setForm({
      fullName: user.displayName || '',
      username: user.username || '',
      birthDate: user.birthDate || '',
      institution: user.school || '',
      grade: rawGrade && Object.prototype.hasOwnProperty.call(LEVEL_LABELS, rawGrade)
        ? rawGrade as EducationLevel
        : user.educationLevel || '',
      subjects: (user.favoriteCategories || []).filter((value): value is CompetitionCategory =>
        Object.prototype.hasOwnProperty.call(CATEGORY_LABELS, value)
      ),
    });
    setError('');
  }, [user?.id]);

  const selectedName = useMemo(() => {
    const first = (user?.displayName || '').trim().split(/\s+/)[0];
    return first || t('teman', 'there');
  }, [user?.displayName, language]);

  const setField = <K extends keyof FormState>(key: K, value: FormState[K]) => {
    setForm((current) => ({ ...current, [key]: value }));
    setError('');
  };

  const toggleSubject = (subject: CompetitionCategory) => {
    setForm((current) => ({
      ...current,
      subjects: current.subjects.includes(subject)
        ? current.subjects.filter((item) => item !== subject)
        : [...current.subjects, subject],
    }));
    setError('');
  };

  const stepOneValid =
    form.fullName.trim().length >= 2 &&
    /^[a-z0-9][a-z0-9._-]{2,39}$/.test(form.username.trim().toLowerCase()) &&
    Boolean(form.birthDate) &&
    Boolean(form.institution.trim()) &&
    Boolean(form.grade);

  const save = async () => {
    const validation = validateInitialProfile({
      username: form.username,
      fullName: form.fullName,
      birthDate: form.birthDate,
      institution: form.institution,
      grade: form.grade,
      subjects: form.subjects,
    });
    if (validation) {
      setError(validation);
      return;
    }

    setSaving(true);
    setError('');
    try {
      await completeBetterAuthProfile({
        username: form.username,
        fullName: form.fullName,
        birthDate: form.birthDate,
        institution: form.institution,
        grade: form.grade,
        subjects: form.subjects,
      });
      await refreshUser();
      toast(t('Profil berhasil dilengkapi. Selamat datang di SYKABELAJAR!','Your profile is complete. Welcome to SYKABELAJAR!'), 'success');
      navigate(returnPath, { replace: true });
    } catch (saveError) {
      const message = saveError instanceof Error ? saveError.message : '';
      const known = [
        'USERNAME_ALREADY_TAKEN',
        'USERNAME_ALREADY_SET',
        'USERNAME_INVALID',
        'FULL_NAME_INVALID',
        'BIRTH_DATE_INVALID',
        'INSTITUTION_INVALID',
        'EDUCATION_LEVEL_INVALID',
        'FAVORITE_CATEGORIES_REQUIRED',
        'VERIFIED_BETTER_AUTH_IDENTITY_REQUIRED',
        'BETTER_AUTH_SESSION_REQUIRED',
      ];
      const code = known.find((item) => message.includes(item));
      setError(code || 'PROFILE_COMPLETION_FAILED');
    } finally {
      setSaving(false);
    }
  };

  if (authLoading) {
    return <main className="min-h-screen surface-bg flex items-center justify-center px-4"><div className="w-full max-w-md rounded-2xl surface-card-bg border surface-border p-5" role="status" aria-live="polite"><div className="h-3 w-24 rounded-full bg-fg-muted/15 animate-pulse" /><div className="mt-4 h-6 w-3/4 rounded-lg bg-fg-muted/15 animate-pulse" /><div className="mt-3 h-3 w-full rounded-full bg-fg-muted/10 animate-pulse" /></div></main>;
  }
  if (!isAuthenticated || !user) return <Navigate to="/login" replace />;
  if (!needsInitialProfileCompletion(user)) return <Navigate to={returnPath} replace />;

  const errorMessage: Record<string, string> = {
    USERNAME_ALREADY_TAKEN: t('Username ini sudah dipakai. Coba variasi lain.','This username is already taken. Try another one.'),
    USERNAME_ALREADY_SET: t('Username akun ini sudah ditetapkan. Muat ulang halaman.','This account already has a username. Reload the page.'),
    USERNAME_INVALID: t('Username 3–40 karakter: huruf kecil, angka, titik, garis bawah, atau tanda hubung.','Username must be 3–40 characters using lowercase letters, numbers, dots, underscores, or hyphens.'),
    FULL_NAME_INVALID: t('Nama lengkap minimal 2 karakter.','Full name must contain at least 2 characters.'),
    BIRTH_DATE_INVALID: t('Periksa kembali tanggal lahir.','Check the date of birth.'),
    INSTITUTION_INVALID: t('Nama sekolah/institusi minimal 2 karakter.','School or institution must contain at least 2 characters.'),
    EDUCATION_LEVEL_INVALID: t('Pilih jenjang pendidikan.','Choose an education level.'),
    FAVORITE_CATEGORIES_REQUIRED: t('Pilih minimal satu minat.','Choose at least one interest.'),
    VERIFIED_BETTER_AUTH_IDENTITY_REQUIRED: t('Email akun belum terverifikasi. Verifikasi email lalu coba lagi.','Your email is not verified. Verify it and try again.'),
    BETTER_AUTH_SESSION_REQUIRED: t('Sesi autentikasi tidak valid. Silakan masuk kembali.','Your authentication session is invalid. Sign in again.'),
    PROFILE_COMPLETION_FAILED: t('Profil belum berhasil disimpan. Coba lagi.','Your profile could not be saved. Try again.'),
  };

  return (
    <main className="min-h-screen surface-bg flex flex-col">
      <header className="h-16 px-4 sm:px-6 flex items-center justify-between border-b surface-border">
        <div className="flex items-center gap-2">
          <div className="h-9 w-9 rounded-xl gradient-moss flex items-center justify-center"><GraduationCap size={18} className="text-white" /></div>
          <span className="font-display font-bold text-fg">sykabelajar<span className="text-accent">.id</span></span>
        </div>
        <button type="button" onClick={() => void logout()} className="text-xs font-semibold text-fg-muted hover:text-fg transition">
          {t('Keluar','Sign out')}
        </button>
      </header>

      <div className="flex-1 w-full max-w-2xl mx-auto px-4 py-8 sm:py-12">
        <div className="mb-6 flex items-center gap-3 text-xs font-semibold text-accent">
          <span className="inline-flex h-8 w-8 items-center justify-center rounded-full bg-accent/10"><Sparkles size={15} /></span>
          {t('PENGATURAN AKUN AWAL','INITIAL ACCOUNT SETUP')}
        </div>
        <div className="mb-5 grid grid-cols-2 gap-2" aria-label={t('Progres pengaturan profil','Profile setup progress')}>
          {[1, 2].map((item) => (
            <div key={item} className="h-1.5 rounded-full surface-elevated overflow-hidden">
              <div className={\`h-full transition-all \${item <= step ? 'gradient-moss w-full' : 'w-0'}\`} />
            </div>
          ))}
        </div>

        <section className="card overflow-hidden">
          <div className="border-b surface-border px-5 py-5 sm:px-7">
            <p className="text-xs font-semibold text-accent">{t('LANGKAH','STEP')} {step} / 2</p>
            <h1 className="mt-2 font-display text-2xl sm:text-3xl font-bold tracking-tight text-fg">
              {step === 1 ? t(\`Selamat datang, \${selectedName}!\`, \`Welcome, \${selectedName}!\`) : t('Apa yang kamu minati?', 'What are you interested in?')}
            </h1>
            <p className="mt-2 max-w-xl text-sm leading-relaxed text-fg-muted">
              {step === 1
                ? t('Akun berhasil terhubung. Nama dan email sudah kami siapkan; lengkapi data yang masih kosong agar profilmu siap digunakan.', 'Your account is connected. We have prefilled your name and email; complete the remaining details to finish your profile.')
                : t('Pilih kategori yang paling kamu suka. Ini membantu kami menampilkan lomba dan aktivitas yang lebih relevan.', 'Choose the categories you enjoy. This helps us show more relevant competitions and activities.')}
            </p>
            <div className="mt-4 inline-flex max-w-full items-center gap-2 rounded-full border surface-border bg-white/[0.03] px-3 py-2 text-xs text-fg-muted">
              <span className="h-2 w-2 rounded-full bg-emerald-400" />
              <span className="truncate">{user.email}</span>
              <span className="shrink-0">{t('· akun terhubung','· connected account')}</span>
            </div>
          </div>

          <div className="space-y-5 px-5 py-6 sm:px-7">
            {step === 1 ? (
              <>
                <div className="grid gap-4 sm:grid-cols-2">
                  <div className="sm:col-span-2">
                    <label className="label" htmlFor="onboarding-full-name">{t('Nama lengkap','Full name')}</label>
                    <div className="relative">
                      <UserRound size={16} className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-fg-muted" />
                      <input id="onboarding-full-name" autoComplete="name" className="input pl-10" value={form.fullName} onChange={(event) => setField('fullName', event.target.value)} maxLength={120} />
                    </div>
                    <p className="mt-1 text-xs text-fg-muted">{t('Terisi otomatis dari akun yang terhubung. Kamu masih bisa mengubahnya.','Prefilled from your connected account. You can still edit it.')}</p>
                  </div>
                  <div className="sm:col-span-2">
                    <label className="label" htmlFor="onboarding-username">Username</label>
                    <div className="flex items-center rounded-xl border surface-border bg-white/[0.03] focus-within:border-accent/60">
                      <span className="pl-3 text-sm text-fg-muted">@</span>
                      <input id="onboarding-username" autoComplete="username" className="min-w-0 flex-1 bg-transparent px-2 py-3 text-sm text-fg outline-none" value={form.username} onChange={(event) => setField('username', event.target.value.replace(/\\s/g, '').toLowerCase())} maxLength={40} placeholder="namakamu" />
                    </div>
                    <p className="mt-1 text-xs text-fg-muted">{t('Username unik, 3–40 karakter. Tidak bisa diubah setelah dibuat.','Unique username, 3–40 characters. It cannot be changed after creation.')}</p>
                  </div>
                  <div>
                    <label className="label" htmlFor="onboarding-birth-date">{t('Tanggal lahir','Date of birth')}</label>
                    <div className="relative">
                      <CalendarDays size={16} className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-fg-muted" />
                      <input id="onboarding-birth-date" type="date" autoComplete="bday" className="input pl-10" value={form.birthDate} onChange={(event) => setField('birthDate', event.target.value)} max={new Date().toISOString().slice(0, 10)} />
                    </div>
                  </div>
                  <div>
                    <label className="label" htmlFor="onboarding-grade">{t('Jenjang pendidikan','Education level')}</label>
                    <div className="relative">
                      <School size={16} className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-fg-muted" />
                      <select id="onboarding-grade" className="input pl-10" value={form.grade} onChange={(event) => setField('grade', event.target.value as EducationLevel | '')}>
                        <option value="">{t('Pilih jenjang','Choose level')}</option>
                        {Object.entries(LEVEL_LABELS).map(([key, label]) => <option key={key} value={key}>{label}</option>)}
                      </select>
                    </div>
                  </div>
                  <div className="sm:col-span-2">
                    <label className="label" htmlFor="onboarding-institution">{t('Sekolah / institusi','School / institution')}</label>
                    <input id="onboarding-institution" autoComplete="organization" className="input" value={form.institution} onChange={(event) => setField('institution', event.target.value)} maxLength={200} placeholder={t('Nama sekolah atau institusi','School or institution name')} />
                  </div>
                </div>
                <div className="rounded-xl border border-accent/15 bg-accent/5 px-3 py-3 text-xs leading-relaxed text-fg-muted">
                  {t('Email dari akun terhubung tidak perlu diisi ulang. Data lain disimpan ke profil SYKABELAJAR milik akun ini.','The connected account email does not need to be entered again. The remaining details are saved to this SYKABELAJAR profile.')}
                </div>
              </>
            ) : (
              <>
                <div className="grid grid-cols-2 gap-2 sm:grid-cols-3">
                  {Object.entries(CATEGORY_LABELS).map(([key, label]) => {
                    const selected = form.subjects.includes(key as CompetitionCategory);
                    return (
                      <button
                        key={key}
                        type="button"
                        aria-pressed={selected}
                        onClick={() => toggleSubject(key as CompetitionCategory)}
                        className={\`flex min-h-12 items-center justify-between gap-2 rounded-xl border px-3 py-3 text-left text-xs font-medium transition-colors \${selected ? 'border-accent/50 bg-accent/10 text-accent' : 'surface-border bg-white/[0.02] text-fg-secondary hover:border-accent/25'}\`}
                      >
                        <span>{label}</span>
                        {selected && <Check size={15} className="shrink-0" />}
                      </button>
                    );
                  })}
                </div>
                <p className="text-xs text-fg-muted">{t('Pilih minimal satu. Kamu bisa mengubah minat ini lagi dari pengaturan profil.','Choose at least one. You can update these interests later in profile settings.')}</p>
              </>
            )}

            {error && (
              <div role="alert" className="rounded-xl border border-rose-500/25 bg-rose-500/5 px-3 py-3 text-sm text-rose-300">
                {errorMessage[error] || errorMessage.PROFILE_COMPLETION_FAILED}
              </div>
            )}

            <div className="flex flex-col-reverse gap-2 border-t surface-border pt-4 sm:flex-row sm:justify-between">
              {step === 1 ? (
                <span className="self-center text-xs text-fg-muted">{t('Data dasar','Basic information')}</span>
              ) : (
                <Button type="button" variant="outline" onClick={() => setStep(1)} icon={<ArrowLeft size={16} />}>{t('Kembali','Back')}</Button>
              )}
              {step === 1 ? (
                <Button type="button" fullWidth onClick={() => {
                  const validation = validateInitialProfile({ ...form, subjects: ['mtk'] });
                  const basicOnlyInvalid = validation && validation !== 'FAVORITE_CATEGORIES_REQUIRED';
                  if (!stepOneValid || basicOnlyInvalid) {
                    setError(basicOnlyInvalid ? validation : 'USERNAME_INVALID');
                    return;
                  }
                  setStep(2);
                }} disabled={!stepOneValid} icon={<ArrowRight size={16} />}>{t('Lanjut','Continue')}</Button>
              ) : (
                <Button type="button" fullWidth loading={saving} disabled={form.subjects.length === 0} onClick={() => void save()} icon={<Check size={16} />}>{t('Simpan & masuk ke Home','Save & go to Home')}</Button>
              )}
            </div>
          </div>
        </section>
        <p className="mt-4 text-center text-xs text-fg-muted">{t('Langkah ini hanya diperlukan sekali untuk akun baru.','You only need to complete this step once for a new account.')}</p>
      </div>
    </main>
  );
}
