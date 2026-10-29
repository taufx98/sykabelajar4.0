import { useEffect, useState } from 'react';
import { Accessibility, Check, Languages, Moon, Settings2, Sun, UserRound, X } from 'lucide-react';
import { Link } from 'react-router-dom';
import { useTheme } from '@/hooks/useTheme';
import { useLanguage } from '@/lib/LanguageContext';
import { useApp } from '@/store/AppContext';

const REDUCED_MOTION_KEY = 'sykabelajar_reduce_motion';

function readReducedMotion(): boolean {
  if (typeof window === 'undefined') return false;
  try {
    return window.localStorage.getItem(REDUCED_MOTION_KEY) === '1';
  } catch {
    return false;
  }
}

export function GeneralSettingsButton({ className = '', showLabel = false }: { className?: string; showLabel?: boolean }) {
  const [open, setOpen] = useState(false);
  const [reduceMotion, setReduceMotion] = useState(readReducedMotion);
  const { theme, setTheme } = useTheme();
  const { language, setLanguage, t } = useLanguage();
  const { user } = useApp();

  useEffect(() => {
    if (!open) return;
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') setOpen(false);
    };
    const previousOverflow = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    window.addEventListener('keydown', onKeyDown);
    return () => {
      document.body.style.overflow = previousOverflow;
      window.removeEventListener('keydown', onKeyDown);
    };
  }, [open]);

  const changeMotionPreference = (checked: boolean) => {
    setReduceMotion(checked);
    document.documentElement.classList.toggle('reduce-motion', checked);
    try {
      window.localStorage.setItem(REDUCED_MOTION_KEY, checked ? '1' : '0');
    } catch {
      // Apply in the current session even if browser storage is unavailable.
    }
  };

  return (
    <>
      <button
        type="button"
        onClick={() => setOpen(true)}
        aria-label={t('settings.open')}
        aria-haspopup="dialog"
        aria-expanded={open}
        title={t('settings.open')}
        className={`relative inline-flex min-h-9 items-center justify-center gap-2 rounded-xl border border-surface-border px-3 py-2 text-sm text-fg-muted transition hover:border-accent/30 hover:bg-surface-elevated hover:text-accent ${className}`}
      >
        <Settings2 size={18} />
        {showLabel && <span>{t('settings.open')}</span>}
      </button>

      {open && (
        <div className="fixed inset-0 z-[190] flex items-center justify-center bg-black/65 p-4" role="presentation" onMouseDown={(event) => { if (event.target === event.currentTarget) setOpen(false); }}>
          <section
            role="dialog"
            aria-modal="true"
            aria-labelledby="general-settings-title"
            className="relative max-h-[90dvh] w-full max-w-lg overflow-y-auto rounded-3xl border surface-border surface-card-bg p-5 shadow-2xl sm:p-6"
          >
            <header className="flex items-start gap-3">
              <div className="flex h-11 w-11 shrink-0 items-center justify-center rounded-2xl bg-accent/10 text-accent">
                <Settings2 size={21} />
              </div>
              <div className="min-w-0 flex-1">
                <h2 id="general-settings-title" className="font-display text-xl font-bold text-fg">{t('settings.title')}</h2>
                <p className="mt-1 text-sm leading-relaxed text-fg-muted">{t('settings.subtitle')}</p>
              </div>
              <button type="button" onClick={() => setOpen(false)} aria-label={t('settings.close')} className="rounded-xl p-2 text-fg-muted transition hover:bg-surface-elevated hover:text-fg">
                <X size={18} />
              </button>
            </header>

            <div className="mt-6 space-y-5">
              <section className="rounded-2xl border surface-border p-4">
                <div className="flex items-center gap-2">
                  <Sun size={16} className="text-accent" />
                  <h3 className="text-sm font-semibold text-fg">{t('settings.appearance')}</h3>
                </div>
                <p className="mt-3 text-xs font-medium text-fg-muted">{t('settings.theme')}</p>
                <div className="mt-2 grid grid-cols-2 gap-2">
                  {(['dark', 'light'] as const).map((value) => {
                    const selected = theme === value;
                    return (
                      <button
                        key={value}
                        type="button"
                        onClick={() => setTheme(value)}
                        aria-pressed={selected}
                        className={`flex items-center justify-between gap-2 rounded-xl border px-3 py-2.5 text-sm font-medium transition ${selected ? 'border-accent/40 bg-accent/10 text-accent' : 'surface-border text-fg-muted hover:bg-surface-elevated hover:text-fg'}`}
                      >
                        <span className="flex items-center gap-2">{value === 'dark' ? <Moon size={16} /> : <Sun size={16} />}{value === 'dark' ? t('settings.themeDark') : t('settings.themeLight')}</span>
                        {selected && <Check size={15} />}
                      </button>
                    );
                  })}
                </div>
              </section>

              <section className="rounded-2xl border surface-border p-4">
                <div className="flex items-center gap-2">
                  <Languages size={16} className="text-accent" />
                  <h3 className="text-sm font-semibold text-fg">{t('settings.language')}</h3>
                </div>
                <div className="mt-3 grid grid-cols-2 gap-2">
                  {([
                    { value: 'id', label: t('settings.indonesian') },
                    { value: 'en', label: t('settings.english') },
                  ] as const).map((item) => {
                    const selected = language === item.value;
                    return (
                      <button
                        key={item.value}
                        type="button"
                        onClick={() => setLanguage(item.value)}
                        aria-pressed={selected}
                        className={`flex items-center justify-between gap-2 rounded-xl border px-3 py-2.5 text-sm font-medium transition ${selected ? 'border-accent/40 bg-accent/10 text-accent' : 'surface-border text-fg-muted hover:bg-surface-elevated hover:text-fg'}`}
                      >
                        <span>{item.label}</span>{selected && <Check size={15} />}
                      </button>
                    );
                  })}
                </div>
              </section>

              <section className="rounded-2xl border surface-border p-4">
                <div className="flex items-start gap-3">
                  <Accessibility size={17} className="mt-0.5 shrink-0 text-accent" />
                  <div className="min-w-0 flex-1">
                    <h3 className="text-sm font-semibold text-fg">{t('settings.accessibility')}</h3>
                    <p className="mt-1 text-xs leading-relaxed text-fg-muted">{t('settings.reduceMotionDesc')}</p>
                    <label className="mt-3 flex cursor-pointer items-center justify-between gap-3">
                      <span className="text-sm font-medium text-fg">{t('settings.reduceMotion')}</span>
                      <input
                        type="checkbox"
                        checked={reduceMotion}
                        onChange={(event) => changeMotionPreference(event.target.checked)}
                        className="h-4 w-4 accent-emerald-600"
                      />
                    </label>
                  </div>
                </div>
              </section>

              {user?.id && (
                <Link to="/profile/edit" onClick={() => setOpen(false)} className="flex items-center gap-3 rounded-2xl border surface-border p-4 transition hover:border-accent/30 hover:bg-surface-elevated">
                  <UserRound size={17} className="text-accent" />
                  <span className="min-w-0 flex-1 text-sm font-semibold text-fg">{t('settings.profilePrivacy')}</span>
                  <span aria-hidden="true" className="text-fg-muted">↗</span>
                </Link>
              )}
              <p className="text-center text-[11px] text-fg-muted">{t('settings.autoSave')}</p>
            </div>
          </section>
        </div>
      )}
    </>
  );
}
