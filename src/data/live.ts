import type { Award, AppNotification, Certificate, Competition, DailyTask, FeedPost, LeaderboardEntry, Order, User, Question, Emblem } from '@/types';

/** Runtime-only containers. They start empty and are populated exclusively from Supabase services. */
export const liveUsers: User[] = [];
export const liveCompetitions: Competition[] = [];
export const liveDailyTasks: DailyTask[] = [];
export const liveLeaderboard: LeaderboardEntry[] = [];
export const liveAwards: Award[] = [];
export const liveCertificates: Certificate[] = [];
export const liveNotifications: AppNotification[] = [];
export const liveOrders: Order[] = [];
export const liveFeed: FeedPost[] = [];
export const liveQuestions: Record<string, Question[]> = {};
export interface PrintCatalogItem { id: string; category: 'sertifikat' | 'medali' | 'emblem'; name: string; price: number; preview?: string; }
export const printCatalog: PrintCatalogItem[] = [];

/** Emblem lookup — seeded from awards or a static catalogue. */
const EMBLEM_REGISTRY = new Map<string, Emblem>();

export function registerEmblem(emblem: Emblem) {
  EMBLEM_REGISTRY.set(emblem.id, emblem);
}

export function getEmblem(id: string): Emblem | undefined {
  return EMBLEM_REGISTRY.get(id);
}

/** Seed common competition emblems so the UI always has something to show. */
function seedEmblems() {
  const seeds: Emblem[] = [
    { id: 'em-juara-1', name: 'Juara 1', competitionTitle: 'Kompetisi Nasional', position: 'Peringkat 1', color: 'from-moss-500 to-moss-700', icon: 'trophy' },
    { id: 'em-juara-2', name: 'Juara 2', competitionTitle: 'Kompetisi Nasional', position: 'Peringkat 2', color: 'from-slate-400 to-slate-600', icon: 'medal' },
    { id: 'em-juara-3', name: 'Juara 3', competitionTitle: 'Kompetisi Nasional', position: 'Peringkat 3', color: 'from-amber-500 to-amber-700', icon: 'medal' },
    { id: 'em-partisipan', name: 'Partisipan', competitionTitle: 'Semua Kompetisi', position: 'Peserta', color: 'from-sky-500 to-sky-700', icon: 'award' },
    { id: 'em-streak-7', name: 'Streak 7 Hari', competitionTitle: 'Daily Tasks', position: 'Streak', color: 'from-amber-400 to-orange-600', icon: 'flame' },
    { id: 'em-streak-30', name: 'Streak 30 Hari', competitionTitle: 'Daily Tasks', position: 'Streak Master', color: 'from-rose-500 to-rose-700', icon: 'star' },
  ];
  for (const e of seeds) registerEmblem(e);
}
seedEmblems();

export const CATEGORY_LABELS: Record<string, string> = {
  mtk: 'Matematika', ipa: 'Sains & IPA', ips: 'Sosial & IPS', bindo: 'Bahasa Indonesia', bing: 'Bahasa Inggris',
  seni: 'Seni & Budaya', olahraga: 'Olahraga', tech: 'Teknologi', lingkungan: 'Lingkungan',
};
export const LEVEL_LABELS: Record<string, string> = { sd: 'SD 4–6 Sederajat', smp: 'SMP 1–3 Sederajat', sma: 'SMA 1–3 Sederajat' };
