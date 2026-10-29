import { createContext, useCallback, useContext, useEffect, useMemo, useState, type ReactNode } from 'react';

export type Language = 'id' | 'en';

const STORAGE_KEY = 'sykabelajar_language';

const messages = {
  id: {
    'nav.home': 'Beranda',
    'nav.dailyTasks': 'Daily Tasks',
    'nav.leaderboard': 'Peringkat',
    'nav.awards': 'Piagam',
    'nav.notifications': 'Notifikasi',
    'nav.orders': 'Pesanan',
    'nav.messages': 'Pesan',
    'nav.profile': 'Profil',
    'nav.teacher': 'Guru',
    'nav.collectiveRegister': 'Daftar Kolektif',
    'nav.accessCards': 'Kartu Akses',
    'nav.monitoring': 'Monitoring',
    'nav.organizer': 'Penyelenggara',
    'nav.newCompetition': 'Buat Lomba',
    'nav.registrations': 'Pendaftaran',
    'nav.members': 'Anggota',
    'nav.grading': 'Penilaian',
    'nav.planUsage': 'Paket & Usage',
    'nav.serials': 'Serial Sertifikat',
    'nav.ads': 'Pasang Iklan',
    'nav.admin': 'Admin',
    'nav.errorIntelligence': 'Error Intelligence',
    'nav.organizations': 'Organisasi',
    'nav.ranking': 'Peringkat',
    'nav.portal': 'Portal',
    'settings.open': 'Pengaturan',
    'settings.title': 'Pengaturan umum',
    'settings.subtitle': 'Sesuaikan pengalaman SYKABELAJAR di perangkat ini.',
    'settings.appearance': 'Tampilan',
    'settings.theme': 'Tema',
    'settings.themeDark': 'Gelap',
    'settings.themeLight': 'Terang',
    'settings.language': 'Bahasa',
    'settings.indonesian': 'Bahasa Indonesia',
    'settings.english': 'English',
    'settings.accessibility': 'Aksesibilitas',
    'settings.reduceMotion': 'Kurangi animasi',
    'settings.reduceMotionDesc': 'Kurangi gerakan dan transisi untuk pengalaman yang lebih nyaman.',
    'settings.account': 'Akun',
    'settings.profilePrivacy': 'Pengaturan profil & privasi',
    'settings.autoSave': 'Preferensi disimpan otomatis di perangkat ini.',
    'settings.close': 'Tutup',
    'chat.private': 'Chat Pribadi',
    'chat.group': 'Chat Grup',
    'chat.active': 'Aktif',
    'chat.history': 'Riwayat',
    'chat.pendingRating': 'Menunggu penilaian',
    'chat.noConversations': 'Belum ada percakapan.',
    'chat.noPinned': 'Belum ada percakapan disematkan.',
    'chat.notFound': 'Percakapan tidak ditemukan.',
    'chat.newMessages': 'Pesan baru akan muncul di sini.',
    'chat.support': 'Hubungi Admin',
    'profile.about': 'Tentang',
    'profile.achievements': 'Prestasi',
    'profile.competitions': 'Lomba',
    'profile.statistics': 'Statistik',
    'profile.badges': 'Badge',
    'profile.favoriteCategories': 'Kategori Favorit',
    'profile.adminAccess': 'Akses Admin',
    'profile.identity': 'Identitas Akun',
    'profile.roleAccess': 'Peran & Akses',
    'profile.adminDescription': 'Akun untuk pengelolaan dan pengawasan platform.',
    'profile.adminTitle': 'Administrator SYKABELAJAR',
    'profile.xp': 'XP',
    'profile.eduCoin': 'Edu Coin',
    'profile.awards': 'Prestasi',
    'profile.following': 'Mengikuti',
    'profile.followers': 'Pengikut',
    'profile.edit': 'Edit Profil',
    'profile.viewAsVisitor': 'Tampilan Pengunjung',
    'profile.backToOwner': 'Kembali ke Tampilan Pemilik',
  },
  en: {
    'nav.home': 'Home',
    'nav.dailyTasks': 'Daily Tasks',
    'nav.leaderboard': 'Leaderboard',
    'nav.awards': 'Awards',
    'nav.notifications': 'Notifications',
    'nav.orders': 'Orders',
    'nav.messages': 'Messages',
    'nav.profile': 'Profile',
    'nav.teacher': 'Teacher',
    'nav.collectiveRegister': 'Group Registration',
    'nav.accessCards': 'Access Cards',
    'nav.monitoring': 'Monitoring',
    'nav.organizer': 'Organizer',
    'nav.newCompetition': 'Create Competition',
    'nav.registrations': 'Registrations',
    'nav.members': 'Members',
    'nav.grading': 'Grading',
    'nav.planUsage': 'Plan & Usage',
    'nav.serials': 'Certificate Serials',
    'nav.ads': 'Advertise',
    'nav.admin': 'Admin',
    'nav.errorIntelligence': 'Error Intelligence',
    'nav.organizations': 'Organizations',
    'nav.ranking': 'Leaderboard',
    'nav.portal': 'Portal',
    'settings.open': 'Settings',
    'settings.title': 'General settings',
    'settings.subtitle': 'Customize your SYKABELAJAR experience on this device.',
    'settings.appearance': 'Appearance',
    'settings.theme': 'Theme',
    'settings.themeDark': 'Dark',
    'settings.themeLight': 'Light',
    'settings.language': 'Language',
    'settings.indonesian': 'Bahasa Indonesia',
    'settings.english': 'English',
    'settings.accessibility': 'Accessibility',
    'settings.reduceMotion': 'Reduce motion',
    'settings.reduceMotionDesc': 'Reduce movement and transitions for a more comfortable experience.',
    'settings.account': 'Account',
    'settings.profilePrivacy': 'Profile & privacy settings',
    'settings.autoSave': 'Preferences are saved automatically on this device.',
    'settings.close': 'Close',
    'chat.private': 'Private chat',
    'chat.group': 'Group chat',
    'chat.active': 'Active',
    'chat.history': 'History',
    'chat.pendingRating': 'Awaiting rating',
    'chat.noConversations': 'No conversations yet.',
    'chat.noPinned': 'No pinned conversations yet.',
    'chat.notFound': 'No conversations found.',
    'chat.newMessages': 'New messages will appear here.',
    'chat.support': 'Contact support',
    'profile.about': 'About',
    'profile.achievements': 'Achievements',
    'profile.competitions': 'Competitions',
    'profile.statistics': 'Statistics',
    'profile.badges': 'Badges',
    'profile.favoriteCategories': 'Favorite categories',
    'profile.adminAccess': 'Admin access',
    'profile.identity': 'Account identity',
    'profile.roleAccess': 'Role & access',
    'profile.adminDescription': 'Account for platform management and oversight.',
    'profile.adminTitle': 'SYKABELAJAR Administrator',
    'profile.xp': 'XP',
    'profile.eduCoin': 'Edu Coin',
    'profile.awards': 'Achievements',
    'profile.following': 'Following',
    'profile.followers': 'Followers',
    'profile.edit': 'Edit profile',
    'profile.viewAsVisitor': 'Visitor preview',
    'profile.backToOwner': 'Back to owner view',
  },
} as const;

export type TranslationKey = keyof typeof messages.id;

interface LanguageContextValue {
  language: Language;
  setLanguage: (language: Language) => void;
  t: (key: TranslationKey) => string;
}

const LanguageContext = createContext<LanguageContextValue | null>(null);

function getInitialLanguage(): Language {
  if (typeof window === 'undefined') return 'id';
  return window.localStorage.getItem(STORAGE_KEY) === 'en' ? 'en' : 'id';
}

export function LanguageProvider({ children }: { children: ReactNode }) {
  const [language, setLanguageState] = useState<Language>(getInitialLanguage);
  const setLanguage = useCallback((value: Language) => {
    setLanguageState(value);
    try {
      window.localStorage.setItem(STORAGE_KEY, value);
    } catch {
      // The language still applies for the current session if storage is unavailable.
    }
  }, []);

  useEffect(() => {
    document.documentElement.lang = language;
    try {
      window.localStorage.setItem(STORAGE_KEY, language);
    } catch {
      // Persisting preferences is best effort.
    }
  }, [language]);

  const t = useCallback((key: TranslationKey) => messages[language][key] ?? messages.id[key], [language]);
  const value = useMemo(() => ({ language, setLanguage, t }), [language, setLanguage, t]);

  return <LanguageContext.Provider value={value}>{children}</LanguageContext.Provider>;
}

export function useLanguage() {
  const context = useContext(LanguageContext);
  if (!context) throw new Error('useLanguage must be used inside LanguageProvider.');
  return context;
}
