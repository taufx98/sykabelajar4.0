import { useEffect, useMemo, useState } from 'react';
import {
  Activity,
  CalendarDays,
  ChevronLeft,
  ChevronRight,
  Crown,
  Medal,
  Search,
  School,
  Sparkles,
  Trophy,
  Users,
  X,
} from 'lucide-react';
import { Link } from 'react-router-dom';
import { Avatar } from '@/components/ui/Avatar';
import { useApp } from '@/store/AppContext';
import { supabase } from '@/lib/supabase';
import { useLanguage } from '@/lib/LanguageContext';
import {
  getPublicCoinLeaderboard,
  getPublicLeaderboardEnriched,
  getPublicSchoolLeaderboard,
  invalidateLeaderboardMemory,
  type PublicCoinLeaderboardRow,
  type PublicEnrichedLeaderboardRow,
  type PublicLeaderboardPeriod,
  type PublicSchoolLeaderboardRow,
} from '@/services/platform.service';

type Mode = 'xp' | 'coin';
type Category = 'all' | 'sd' | 'smp' | 'sma' | 'school';
type SchoolLevelFilter = 'all' | 'sd' | 'smp' | 'sma';
type LeaderEntry = {
  user_id: string;
  username: string;
  display_name: string;
  institution: string | null;
  avatar_url: string | null;
  grade: string | null;
  xp: number;
  edu_coin?: number;
  rank: number;
  average_score: number | null;
  competitions_count: number;
  school_id: string | null;
  displayRank: number;
};

const MAX_RANK = 100;
const PER_PAGE = 7;

const PERIODS: Array<{ key: PublicLeaderboardPeriod; label: string }> = [
  { key: 'weekly', label: 'Mingguan' },
  { key: 'monthly', label: 'Bulanan' },
  { key: 'all', label: 'Semua' },
];

const CATEGORIES: Array<{ key: Category; label: string }> = [
  { key: 'all', label: 'Semua Jenjang' },
  { key: 'sd', label: 'SD Sederajat' },
  { key: 'smp', label: 'SMP Sederajat' },
  { key: 'sma', label: 'SMA/SMK Sederajat' },
  { key: 'school', label: 'Peringkat Sekolah' },
];

const SUB_GRADES: Record<Exclude<Category, 'all' | 'school'>, string[]> = {
  sd: ['1', '2', '3', '4', '5', '6'],
  smp: ['7', '8', '9'],
  sma: ['10', '11', '12'],
};

const normalizeGrade = (value: unknown) => String(value ?? '').toLowerCase().trim();

function gradeGroup(value: unknown): '' | 'sd' | 'smp' | 'sma' {
  const grade = normalizeGrade(value).replace(/[_ -]/g, '');
  if (grade.startsWith('sd')) return 'sd';
  if (grade.startsWith('smp')) return 'smp';
  if (grade.startsWith('sma') || grade.startsWith('smk') || grade === 'alumni') return 'sma';
  return '';
}

function matchesSchoolLevel(levels: string, filter: SchoolLevelFilter): boolean {
  if (filter === 'all') return true;
  const normalizedLevels = levels.split('·').map((level) => level.trim().toUpperCase());
  if (filter === 'sd') return normalizedLevels.includes('SD');
  if (filter === 'smp') return normalizedLevels.includes('SMP');
  return normalizedLevels.some((level) => level === 'SMA/SMK' || level === 'SMA' || level === 'SMK');
}

function gradeClass(value: unknown): string {
  const grade = normalizeGrade(value).replace(/[_ -]/g, '');
  const match = grade.match(/^(?:sd|smp|sma|smk)(1[0-2]|[1-9])$/);
  return match?.[1] ?? '';
}

function gradeLabel(value: unknown): string {
  const group = gradeGroup(value);
  const level = group === 'sd' ? 'SD' : group === 'smp' ? 'SMP' : group === 'sma' ? 'SMA/SMK' : '';
  const classNumber = gradeClass(value);
  if (level && classNumber) return 'Kelas ' + classNumber + ' ' + (group === 'sma' ? 'SMA/SMK' : level);
  if (level) return level + ' Sederajat';
  return String(value ?? '').trim() || '—';
}

function formatNumber(value: number | null | undefined): string {
  return Number(value ?? 0).toLocaleString('id-ID', { maximumFractionDigits: 1 });
}

function formatAverage(value: number | null | undefined): string {
  if (value == null || !Number.isFinite(Number(value))) return '—';
  return new Intl.NumberFormat('id-ID', { maximumFractionDigits: 1 }).format(Number(value));
}

function normalizeCoinRow(row: PublicCoinLeaderboardRow): LeaderEntry {
  return {
    user_id: row.user_id,
    username: row.username,
    display_name: row.display_name,
    institution: row.institution,
    avatar_url: row.avatar_url,
    grade: row.grade,
    xp: 0,
    edu_coin: row.edu_coin,
    rank: row.rank,
    average_score: null,
    competitions_count: 0,
    school_id: null,
    displayRank: row.rank,
  };
}

function normalizeXPRows(rows: PublicEnrichedLeaderboardRow[]): LeaderEntry[] {
  return rows.map((row) => ({ ...row, displayRank: row.rank }));
}

const LEADERBOARD_STYLES = String.raw`
.syka-leaderboard {
  --lb-panel: var(--surface-card);
  --lb-elevated: var(--surface-elevated);
  --lb-border: var(--surface-border);
  --lb-fg: var(--fg);
  --lb-muted: var(--fg-muted);
  width: 100%;
  max-width: 1440px;
  margin: 0 auto;
  padding: clamp(14px, 2.1vw, 32px);
  color: var(--lb-fg);
}
.syka-leaderboard * { box-sizing: border-box; }
.lb-heading { text-align: center; margin: 0 auto 22px; }
.lb-eyebrow { color: #60a5fa; display: inline-flex; align-items: center; gap: 8px; font-size: 11px; font-weight: 800; text-transform: uppercase; letter-spacing: .13em; }
.lb-heading h1 { margin: 6px 0 3px; display: flex; align-items: center; justify-content: center; flex-wrap: wrap; gap: 10px; font-size: clamp(25px, 3vw, 34px); line-height: 1.2; font-weight: 850; letter-spacing: -.04em; color: var(--lb-fg); }
.lb-heading p { margin: 0; font-size: 13px; color: var(--lb-muted); }
.lb-live { display: inline-flex; align-items: center; gap: 7px; border-radius: 999px; border: 1px solid rgba(16,185,129,.24); padding: 5px 10px; color: #34d399; background: rgba(16,185,129,.08); font-size: 10px; font-weight: 700; letter-spacing: 0; white-space: nowrap; }
.lb-live-dot { width: 7px; height: 7px; background: #10b981; border-radius: 50%; animation: lb-pulse 1.8s ease-in-out infinite; }
.lb-live.is-polling { color: #93c5fd; background: rgba(59,130,246,.08); border-color: rgba(59,130,246,.24); }
.lb-live.is-polling .lb-live-dot { background: #60a5fa; }
.lb-control-line { display: flex; align-items: center; justify-content: center; flex-wrap: wrap; gap: 12px; margin: 20px auto 26px; }
.lb-segment { display: inline-flex; align-items: center; gap: 3px; padding: 4px; border: 1px solid var(--lb-border); border-radius: 15px; background: color-mix(in srgb, var(--lb-panel) 86%, transparent); }
.lb-segment button { border: 0; cursor: pointer; border-radius: 11px; padding: 9px 15px; min-height: 36px; font-size: 11px; font-weight: 700; color: var(--lb-muted); background: transparent; transition: color .2s ease, background .2s ease, transform .2s ease, box-shadow .2s ease; }
.lb-segment button:hover { color: var(--lb-fg); }
.lb-segment button:active { transform: scale(.97); }
.lb-segment button.active { color: white; background: #2563eb; box-shadow: 0 4px 14px rgba(37,99,235,.28); }
.lb-mode { margin-right: 1px; }
.lb-mode button.active { background: linear-gradient(135deg,#2563eb,#3b82f6); }
.lb-search { display: flex; align-items: center; gap: 9px; min-width: min(100%, 280px); width: 280px; max-width: 100%; padding: 0 12px; min-height: 42px; border: 1px solid var(--lb-border); border-radius: 14px; background: var(--lb-panel); color: var(--lb-muted); transition: border-color .2s ease, box-shadow .2s ease; }
.lb-search:focus-within { border-color: rgba(59,130,246,.62); box-shadow: 0 0 0 3px rgba(59,130,246,.11); }
.lb-search input { flex: 1; min-width: 0; width: 100%; outline: none; border: 0; background: transparent; color: var(--lb-fg); font-size: 11px; }
.lb-search input::placeholder { color: var(--lb-muted); }
.lb-search button { display: inline-flex; border: 0; padding: 3px; border-radius: 6px; background: transparent; color: var(--lb-muted); cursor: pointer; }
.lb-search button:hover { color: var(--lb-fg); background: var(--lb-elevated); }
.lb-category-area { max-width: 1040px; margin: 0 auto 22px; border-bottom: 1px solid var(--lb-border); }
.lb-category-tabs { display: flex; justify-content: center; align-items: stretch; gap: 3px; overflow-x: auto; scrollbar-width: none; padding: 0 2px; }
.lb-category-tabs::-webkit-scrollbar { display: none; }
.lb-category-tab { flex: 0 0 auto; position: relative; border: 0; background: transparent; color: var(--lb-muted); font-size: 11px; font-weight: 800; padding: 12px 15px 15px; white-space: nowrap; cursor: pointer; transition: none; }
.lb-category-tab:hover { color: var(--lb-fg); }
.lb-category-tab.active { color: #facc15; }
.lb-category-tab.active::after { content: ''; position: absolute; height: 3px; width: 66%; left: 17%; bottom: -1px; border-radius: 999px; background: #facc15; box-shadow: 0 0 10px rgba(250,204,21,.45); }
.lb-category-tab:disabled { opacity: .38; cursor: not-allowed; }
.lb-subgrades { display: flex; align-items: center; justify-content: center; flex-wrap: wrap; gap: 7px; padding: 13px 0 15px; }
.lb-subgrade { border: 1px solid var(--lb-border); border-radius: 999px; background: var(--lb-panel); color: var(--lb-muted); padding: 6px 12px; font-size: 10px; font-weight: 700; cursor: pointer; transition: none; }
.lb-subgrade:hover { border-color: rgba(59,130,246,.4); color: var(--lb-fg); }
.lb-subgrade.active { background: rgba(59,130,246,.14); border-color: rgba(59,130,246,.42); color: #60a5fa; }
.lb-main-content { animation: none; }
.lb-podium { display: flex; flex-direction: column; align-items: center; width: 100%; max-width: 280px; min-width: 0; }
.lb-podium.rank-1 { max-width: 300px; }
.lb-podium-badge { display: flex; align-items: center; justify-content: center; gap: 8px; padding: 6px 12px; margin-bottom: 7px; border-radius: 999px; font-size: 10px; font-weight: 850; z-index: 1; }
.lb-podium-badge.rank-1 { background: rgba(245,158,11,.14); color: #fbbf24; border: 1px solid rgba(245,158,11,.3); }
.lb-podium-badge.rank-2 { background: rgba(6,182,212,.12); color: #67e8f9; border: 1px solid rgba(34,211,238,.24); }
.lb-podium-badge.rank-3 { background: rgba(99,102,241,.14); color: #a5b4fc; border: 1px solid rgba(129,140,248,.28); }
.lb-podium-tower { display: flex; flex-direction: column; align-items: center; width: 100%; position: relative; padding: 27px 16px 36px; clip-path: polygon(0 0,100% 0,100% 91%,50% 100%,0 91%); transition: transform .28s ease, filter .28s ease; }
.lb-podium:hover .lb-podium-tower { transform: translateY(-4px); }
.lb-podium.rank-1 .lb-podium-tower { padding-top: 32px; padding-bottom: 43px; background: linear-gradient(180deg,#f59e0b 0%,#ea580c 62%,#7c2d12 100%); box-shadow: 0 0 35px -5px rgba(245,158,11,.45); }
.lb-podium.rank-2 .lb-podium-tower { background: linear-gradient(180deg,#2563eb 0%,#3730a3 68%,#172554 100%); box-shadow: 0 0 25px -5px rgba(6,182,212,.3); }
.lb-podium.rank-3 .lb-podium-tower { background: linear-gradient(180deg,#4338ca 0%,#3730a3 68%,#111827 100%); box-shadow: 0 0 25px -5px rgba(99,102,241,.3); }
.lb-podium.rank-1 .lb-podium-tower { min-height: 330px; }
.lb-podium.rank-2 .lb-podium-tower { min-height: 286px; }
.lb-podium.rank-3 .lb-podium-tower { min-height: 277px; }
.lb-avatar-wrap { display: flex; align-items: center; justify-content: center; width: 86px; height: 86px; padding: 3px; border-radius: 50%; margin: 0 0 12px; background: rgba(255,255,255,.78); border: 2px solid rgba(255,255,255,.7); box-shadow: 0 6px 18px rgba(0,0,0,.16); }
.lb-podium.rank-1 .lb-avatar-wrap { width: 96px; height: 96px; background: #fcd34d; border-color: #fcd34d; }
.lb-podium.rank-2 .lb-avatar-wrap { background: #67e8f9; border-color: #67e8f9; }
.lb-podium.rank-3 .lb-avatar-wrap { background: #c7d2fe; border-color: #c7d2fe; }
.lb-avatar-wrap img, .lb-avatar-wrap > div { border-radius: 50%; }
.lb-podium-name { display: block; width: 100%; text-align: center; color: #fff; font-size: 13px; font-weight: 850; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.lb-podium-user { color: rgba(255,255,255,.82); font-size: 10px; text-align: center; max-width: 100%; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.lb-podium-school { color: rgba(255,255,255,.72); font-size: 10px; text-align: center; margin-top: 7px; max-width: 100%; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.lb-podium-score { display: flex; flex-direction: column; align-items: center; justify-content: center; width: 100%; margin-top: 15px; padding: 11px 8px; border-radius: 11px; background: rgba(15,23,42,.42); color: white; }
.lb-podium.rank-1 .lb-podium-score { background: rgba(124,45,18,.54); }
.lb-podium-score strong { font-size: clamp(17px, 2vw, 23px); font-weight: 900; line-height: 1.1; font-variant-numeric: tabular-nums; }
.lb-podium-score span { color: rgba(255,255,255,.7); font-size: 9px; font-weight: 800; text-transform: uppercase; letter-spacing: .08em; margin-bottom: 4px; }
.lb-podium-metrics { display: grid; grid-template-columns: 1fr 1fr; width: 100%; margin-top: 9px; border-radius: 11px; padding: 9px 4px; background: rgba(2,6,23,.64); color: white; }
.lb-podium-metrics > div { display: flex; flex-direction: column; align-items: center; gap: 3px; font-size: 10px; font-weight: 850; }
.lb-podium-metrics > div + div { border-left: 1px solid rgba(255,255,255,.1); }
.lb-podium-metrics small { font-size: 8px; font-weight: 700; color: rgba(255,255,255,.56); text-transform: uppercase; letter-spacing: .03em; }
.lb-podium-metrics .good { color: #6ee7b7; }
.lb-podium-medal { position: absolute; top: -1px; right: 6px; color: #fcd34d; opacity: .9; }
.lb-podium-area { display: flex; align-items: flex-end; justify-content: center; gap: 8px; width: 100%; margin: 0 auto; padding: 10px 4px 20px; animation: lb-fade-in-up .6s cubic-bezier(.6,1,.3,1) both; }
.lb-podium-area:not(.lb-school-podium-area) { padding-top: 46px; }
.lb-podium-area .lb-podium { flex: 1 1 0; }
.lb-podium-area .lb-podium.rank-1 { flex: 1.1 1 0; }
.lb-search-note { display: flex; justify-content: space-between; align-items: center; flex-wrap: wrap; gap: 8px; margin: 0 0 12px; padding: 10px 12px; border-radius: 12px; color: var(--lb-muted); background: var(--lb-panel); border: 1px solid var(--lb-border); font-size: 11px; }
.lb-search-note strong { color: var(--lb-fg); }
.lb-table-wrap { width: 100%; overflow-x: auto; scrollbar-width: thin; scrollbar-color: rgba(148,163,184,.3) transparent; animation: lb-fade-in-up .6s cubic-bezier(.6,1,.3,1) both; }
.lb-table { min-width: 780px; width: 100%; border-collapse: separate; border-spacing: 0 7px; table-layout: fixed; }
.lb-table th { color: var(--lb-muted); background: var(--lb-panel); font-size: 9px; text-align: left; letter-spacing: .04em; text-transform: uppercase; font-weight: 850; padding: 10px 12px; }
.lb-table th:first-child { border-radius: 12px 0 0 12px; }
.lb-table th:last-child { border-radius: 0 12px 12px 0; text-align: right; }
.lb-table td { background: color-mix(in srgb, var(--lb-panel) 82%, transparent); border-top: 1px solid var(--lb-border); border-bottom: 1px solid var(--lb-border); padding: 11px 12px; font-size: 10px; color: var(--lb-muted); vertical-align: middle; }
.lb-table td:first-child { border-left: 1px solid var(--lb-border); border-radius: 12px 0 0 12px; }
.lb-table td:last-child { border-right: 1px solid var(--lb-border); border-radius: 0 12px 12px 0; text-align: right; }
.lb-table tbody tr { cursor: default; transition: transform .18s ease, filter .18s ease; }
.lb-table tbody tr.lb-clickable { cursor: pointer; }
.lb-table tbody tr:hover td { filter: brightness(1.06); }
.lb-table tbody tr:hover { transform: translateY(-1px); }
.lb-rank-number { display: inline-flex; align-items: center; justify-content: center; width: 27px; height: 27px; border-radius: 8px; color: var(--lb-muted); background: rgba(2,6,23,.6); border: 1px solid var(--lb-border); font-size: 11px; font-weight: 900; font-variant-numeric: tabular-nums; }
.lb-person { display: flex; align-items: center; gap: 10px; min-width: 0; }
.lb-person > a { display: flex; flex-shrink: 0; }
.lb-person img, .lb-person > a > div { border-radius: 50%; }
.lb-person-meta { min-width: 0; }
.lb-person-name { color: var(--lb-fg); display: block; font-size: 11px; font-weight: 850; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; max-width: 100%; }
.lb-person-handle { color: var(--lb-muted); display: block; font-size: 9px; margin-top: 3px; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
.lb-school-cell { color: var(--lb-muted); font-size: 10px; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.lb-score-cell { color: #fbbf24 !important; font-size: 12px !important; font-weight: 900; font-variant-numeric: tabular-nums; white-space: nowrap; }
.lb-score-cell small { font-size: 8px; margin-left: 3px; color: #fbbf24; }
.lb-you { color: #60a5fa; font-size: 9px; margin-left: 5px; font-weight: 800; }
.lb-user-rank { display: flex; align-items: center; gap: 12px; margin-top: 17px; padding: 13px 15px; border: 1px solid rgba(59,130,246,.26); border-radius: 15px; background: linear-gradient(100deg,rgba(37,99,235,.1),rgba(59,130,246,.035)); animation: lb-fade-in-up .42s ease both; }
.lb-user-rank .lb-user-place { color: #60a5fa; font-size: 20px; font-weight: 900; font-variant-numeric: tabular-nums; }
.lb-user-rank .lb-user-details { flex: 1; min-width: 0; }
.lb-user-rank .lb-user-label { color: #60a5fa; font-size: 9px; font-weight: 850; text-transform: uppercase; letter-spacing: .08em; margin-bottom: 3px; }
.lb-user-rank .lb-user-name { color: var(--lb-fg); font-size: 11px; font-weight: 850; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
.lb-user-rank .lb-user-school { color: var(--lb-muted); font-size: 9px; margin-top: 3px; }
.lb-user-rank .lb-user-score { color: #fbbf24; font-size: 14px; font-weight: 900; text-align: right; white-space: nowrap; }
.lb-pagination { display: flex; flex-wrap: wrap; align-items: center; justify-content: center; gap: 5px; margin: 18px 0 8px; }
.lb-pagination button { display: inline-flex; align-items: center; justify-content: center; min-width: 32px; height: 32px; border: 1px solid var(--lb-border); border-radius: 9px; background: var(--lb-panel); color: var(--lb-muted); font-size: 11px; font-weight: 800; cursor: pointer; transition: all .18s ease; }
.lb-pagination button:hover:not(:disabled) { border-color: rgba(59,130,246,.4); color: var(--lb-fg); }
.lb-pagination button.active { color: #fff; border-color: #2563eb; background: #2563eb; }
.lb-pagination button:disabled { opacity: .3; cursor: not-allowed; }
.lb-pagination-info { text-align: center; color: var(--lb-muted); font-size: 10px; margin: 5px 0 0; }
.lb-period-note { display: flex; align-items: flex-start; gap: 7px; max-width: 820px; margin: 12px auto 0; color: var(--lb-muted); font-size: 9px; line-height: 1.6; text-align: center; justify-content: center; }
.lb-empty { padding: 34px 20px; text-align: center; background: var(--lb-panel); border: 1px dashed var(--lb-border); border-radius: 16px; color: var(--lb-muted); font-size: 12px; }
.lb-loading { padding: 36px 20px; text-align: center; color: var(--lb-muted); font-size: 12px; }
.lb-spinner { width: 17px; height: 17px; border: 2px solid var(--lb-border); border-top-color: #60a5fa; border-radius: 50%; display: inline-block; vertical-align: middle; margin-right: 8px; animation: lb-spin .8s linear infinite; }
.lb-school-icon { display: inline-flex; align-items: center; justify-content: center; width: 32px; height: 32px; flex-shrink: 0; border-radius: 10px; background: rgba(245,158,11,.12); color: #fbbf24; }
.lb-modal-backdrop { position: fixed; inset: 0; z-index: 90; display: flex; align-items: center; justify-content: center; padding: 16px; background: rgba(2,6,23,.76); backdrop-filter: blur(8px); animation: lb-backdrop .18s ease both; }
.lb-modal { width: min(100%, 520px); max-height: min(82vh, 720px); overflow: auto; padding: 20px; border: 1px solid var(--lb-border); border-radius: 20px; background: var(--surface-card); color: var(--lb-fg); box-shadow: 0 28px 90px rgba(0,0,0,.35); animation: lb-fade-in-up .25s ease both; }
.lb-modal-header { display: flex; align-items: flex-start; justify-content: space-between; gap: 10px; margin-bottom: 16px; }
.lb-modal-header h2 { margin: 0; font-size: 18px; font-weight: 850; }
.lb-modal-header p { margin: 4px 0 0; font-size: 11px; color: var(--lb-muted); }
.lb-modal-close { display: inline-flex; align-items: center; justify-content: center; padding: 7px; border: 1px solid var(--lb-border); border-radius: 9px; background: var(--lb-panel); color: var(--lb-muted); cursor: pointer; }
.lb-modal-student { display: flex; align-items: center; justify-content: space-between; gap: 10px; padding: 10px; border: 1px solid var(--lb-border); border-radius: 12px; background: var(--lb-panel); margin-top: 8px; }
.lb-modal-student-main { display: flex; align-items: center; gap: 9px; min-width: 0; }
.lb-modal-student-main > div:last-child { min-width: 0; }
.lb-modal-student-name { font-size: 11px; font-weight: 850; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.lb-modal-student-meta { font-size: 9px; color: var(--lb-muted); margin-top: 3px; }
.lb-modal-student-score { font-size: 11px; font-weight: 900; color: #fbbf24; white-space: nowrap; }
@keyframes lb-fade-in-up { from { opacity: 0; transform: translateY(12px) scale(.98); } to { opacity: 1; transform: translateY(0) scale(1); } }
@keyframes lb-pulse { 0%,100% { opacity: 1; box-shadow: 0 0 0 0 rgba(16,185,129,.25); } 50% { opacity: .7; box-shadow: 0 0 0 4px rgba(16,185,129,0); } }
@keyframes lb-spin { to { transform: rotate(360deg); } }
@keyframes lb-backdrop { from { opacity: 0; } to { opacity: 1; } }
@media (prefers-reduced-motion: reduce) {
 .syka-leaderboard *, .syka-leaderboard *::before, .syka-leaderboard *::after { animation-duration: .01ms !important; animation-iteration-count: 1 !important; transition-duration: .01ms !important; scroll-behavior: auto !important; }
}
.lb-podium.is-empty { cursor: default; }
.lb-podium.is-empty .lb-podium-tower { box-shadow: none; border: 1px dashed rgba(148,163,184,.34); filter: saturate(.68); }
.lb-podium.rank-1.is-empty .lb-podium-tower { background: linear-gradient(180deg,rgba(245,158,11,.13),rgba(124,45,18,.045)); }
.lb-podium.rank-2.is-empty .lb-podium-tower { background: linear-gradient(180deg,rgba(37,99,235,.16),rgba(23,37,84,.045)); }
.lb-podium.rank-3.is-empty .lb-podium-tower { background: linear-gradient(180deg,rgba(99,102,241,.16),rgba(17,24,39,.045)); }
.lb-podium.is-empty .lb-podium-badge { opacity: .68; }
.lb-podium.is-empty .lb-avatar-wrap { background: rgba(148,163,184,.07); border: 1px dashed rgba(148,163,184,.38); box-shadow: none; color: var(--lb-muted); }
.lb-podium.is-empty .lb-podium-name { color: var(--lb-muted); }
.lb-podium.is-empty .lb-podium-user, .lb-podium.is-empty .lb-podium-school { color: var(--lb-muted); opacity: .8; }
.lb-podium.is-empty .lb-podium-score { background: rgba(2,6,23,.19); border: 1px dashed rgba(148,163,184,.22); }
.lb-podium.is-empty .lb-podium-score span, .lb-podium.is-empty .lb-podium-score strong { color: var(--lb-muted); }
.lb-podium.is-empty .lb-podium-score strong { font-size: 14px; }
.lb-podium.is-empty .lb-podium-metrics { opacity: .43; }
.lb-empty-row td { background: color-mix(in srgb, var(--lb-panel) 42%, transparent); border-top-style: dashed; border-bottom-style: dashed; border-color: color-mix(in srgb, var(--lb-border) 85%, #94a3b8 15%); }
.lb-empty-row .lb-person-name { color: var(--lb-muted); font-weight: 750; }
.lb-empty-row .lb-person-handle { opacity: .8; }
.lb-empty-avatar { display: inline-flex; align-items: center; justify-content: center; width: 35px; height: 35px; flex-shrink: 0; color: var(--lb-muted); background: rgba(148,163,184,.065); border: 1px dashed rgba(148,163,184,.3); border-radius: 50%; }
.lb-empty-score { color: var(--lb-muted) !important; font-size: 10px !important; font-weight: 750; }
@media (max-width: 1000px) {
 .lb-podium-tower { padding-left: 12px; padding-right: 12px; }
 .lb-table { min-width: 730px; }
 .lb-category-tab { padding-left: 11px; padding-right: 11px; }
}
@media (max-width: 640px) {
 .syka-leaderboard { padding: 14px 10px 24px; }
 .lb-heading { margin-bottom: 16px; }
 .lb-heading h1 { font-size: 25px; }
 .lb-heading p { font-size: 11px; line-height: 1.6; }
 .lb-control-line { align-items: stretch; gap: 9px; margin: 16px auto 20px; }
 .lb-mode { width: 100%; }
 .lb-mode button { flex: 1; padding: 9px 7px; }
 .lb-segment:not(.lb-mode) { flex: 1; justify-content: space-between; }
 .lb-segment:not(.lb-mode) button { flex: 1; padding: 8px 8px; }
 .lb-search { width: 100%; min-width: 100%; }
 .lb-category-tabs { justify-content: flex-start; }
 .lb-category-tab { padding: 12px 11px 14px; font-size: 10px; }
 .lb-subgrades { justify-content: flex-start; flex-wrap: nowrap; overflow-x: auto; }
 .lb-podium-area { gap: 5px; padding-left: 0; padding-right: 0; }
 .lb-podium { max-width: 33.333% !important; }
 .lb-podium.rank-1 { max-width: 35% !important; }
 .lb-podium-badge { padding: 5px 7px; font-size: 9px; gap: 4px; margin-bottom: 6px; }
 .lb-podium-tower { padding: 18px 6px 27px; min-height: 225px !important; }
 .lb-podium.rank-1 .lb-podium-tower { min-height: 254px !important; padding-top: 23px; padding-bottom: 32px; }
 .lb-avatar-wrap { width: 55px; height: 55px; padding: 2px; margin-bottom: 8px; }
 .lb-podium.rank-1 .lb-avatar-wrap { width: 64px; height: 64px; }
 .lb-podium-name { font-size: 9px; }
 .lb-podium-user { font-size: 8px; }
 .lb-podium-school { display: none; }
 .lb-podium-score { margin-top: 10px; padding: 8px 3px; border-radius: 8px; }
 .lb-podium-score strong { font-size: clamp(12px, 3.7vw, 17px); }
 .lb-podium-score span { font-size: 7px; letter-spacing: 0; }
 .lb-podium-metrics { padding: 7px 2px; margin-top: 6px; border-radius: 8px; }
 .lb-podium-metrics > div { font-size: 9px; }
 .lb-podium-metrics small { font-size: 6px; letter-spacing: 0; }
 .lb-table { min-width: 0; table-layout: auto; border-spacing: 0 6px; }
 .lb-table thead th { padding: 9px 6px; font-size: 8px; }
 .lb-table th:nth-child(3), .lb-table td:nth-child(3),
 .lb-table th:nth-child(4), .lb-table td:nth-child(4),
 .lb-table th:nth-child(5), .lb-table td:nth-child(5) { display: none; }
 .lb-table th:first-child { width: 37px; }
 .lb-table th:nth-child(2) { min-width: 160px; }
 .lb-table th:last-child { min-width: 92px; }
 .lb-table td { padding: 9px 6px; font-size: 9px; }
 .lb-rank-number { width: 25px; height: 25px; font-size: 10px; }
 .lb-person { gap: 7px; }
 .lb-person-name { font-size: 10px; }
 .lb-person-handle { font-size: 8px; }
 .lb-score-cell { font-size: 11px !important; }
 .lb-user-rank { gap: 8px; padding: 11px 9px; }
 .lb-user-rank .lb-user-place { font-size: 16px; }
 .lb-user-rank .lb-user-score { font-size: 11px; }
 .lb-pagination { gap: 4px; }
 .lb-pagination button { min-width: 29px; height: 29px; }
 .lb-period-note { font-size: 8px; text-align: left; justify-content: flex-start; }
 .lb-modal { padding: 15px; }
}

/* Reference-matched school leaderboard podium. These selectors are deliberately
   separate from the empty podium placeholders so their existing skeleton state
   keeps its original structure and appearance. */
.lb-school-podium-area {
  max-width: 960px;
  align-items: flex-end;
  gap: 10px;
  padding: 46px 4px 28px;
  margin-bottom: 30px;
}
.lb-school-podium-area .lb-school-podium {
  position: relative;
  display: block;
  flex: 1 1 0;
  width: 100%;
  max-width: none;
  min-width: 0;
  align-self: stretch;
  overflow: visible;
  padding: 0;
  border: 0;
  border-radius: 0;
  outline: none;
  background: transparent;
  color: #fff;
  cursor: pointer;
  text-align: inherit;
  -webkit-tap-highlight-color: transparent;
}
.lb-school-podium-area .lb-school-podium.rank-1 {
  flex: 1.08 1 0;
  margin-bottom: 24px;
}
.lb-school-podium-area .lb-school-podium:focus-visible {
  border-radius: 16px;
  outline: 3px solid rgba(96,165,250,.85);
  outline-offset: 7px;
}
.lb-school-podium-tower {
  position: relative;
  display: flex;
  width: 100%;
  min-height: 370px;
  flex-direction: column;
  align-items: center;
  padding: 49px 16px 43px;
  overflow: hidden;
  clip-path: polygon(0 0,100% 0,100% 91%,50% 100%,0 91%);
  color: #fff;
  text-align: center;
  box-shadow: 0 18px 36px rgba(2,6,23,.25);
  transition: filter .22s ease, transform .22s ease;
}
.lb-school-podium-area .lb-school-podium:hover .lb-school-podium-tower {
  filter: brightness(1.055);
  transform: translateY(-4px);
}
.lb-school-podium-area .lb-school-podium.rank-1 .lb-school-podium-tower {
  min-height: 425px;
  padding-top: 49px;
  padding-bottom: 45px;
  background: linear-gradient(180deg,#f59e0b 0%,#ea580c 60%,#8b3514 100%);
  box-shadow: 0 18px 42px rgba(234,88,12,.2), 0 0 34px rgba(245,158,11,.13);
}
.lb-school-podium-area .lb-school-podium.rank-2 .lb-school-podium-tower {
  background: linear-gradient(180deg,#2563eb 0%,#2845bd 52%,#29327f 100%);
  box-shadow: 0 17px 34px rgba(37,99,235,.18);
}
.lb-school-podium-area .lb-school-podium.rank-3 .lb-school-podium-tower {
  background: linear-gradient(180deg,#4338ca 0%,#3730a3 58%,#172344 100%);
  box-shadow: 0 17px 34px rgba(67,56,202,.18);
}
.lb-person-podium { position: relative; overflow: visible; }
.lb-person-rank-badge { top: -31px; }
.lb-school-rank-badge {
  position: absolute;
  z-index: 2;
  top: -31px;
  left: 50%;
  display: flex;
  width: 65px;
  height: 65px;
  align-items: center;
  justify-content: center;
  border: 2px solid rgba(255,255,255,.86);
  border-radius: 19px;
  box-shadow: 0 7px 18px rgba(2,6,23,.25), inset 0 1px 0 rgba(255,255,255,.32);
  transform: translateX(-50%) rotate(45deg);
}
.lb-school-rank-badge > span {
  display: block;
  transform: rotate(-45deg);
  font-size: 21px;
  font-weight: 900;
  line-height: 1;
}
.lb-school-rank-badge.rank-1 {
  border-color: #fff3c4;
  background: linear-gradient(145deg,#facc15,#f59e0b 75%);
  color: #111827;
}
.lb-school-rank-badge.rank-2 {
  border-color: #d7fbff;
  background: linear-gradient(145deg,#22d3ee,#2563eb);
  color: #fff;
}
.lb-school-rank-badge.rank-3 {
  border-color: #e0e7ff;
  background: linear-gradient(145deg,#818cf8,#4338ca);
  color: #fff;
}
.lb-school-name {
  display: block;
  width: 100%;
  margin-top: 1px;
  color: #fff;
  font-size: clamp(19px,2vw,25px);
  font-weight: 850;
  letter-spacing: -.035em;
  line-height: 1.17;
  overflow-wrap: anywhere;
  text-align: center;
}
.lb-school-podium.rank-1 .lb-school-name {
  font-size: clamp(23px,2.35vw,31px);
}
.lb-school-meta {
  display: block;
  margin-top: 5px;
  color: rgba(255,255,255,.88);
  font-size: 11px;
  font-weight: 650;
  line-height: 1.4;
  text-align: center;
}
.lb-school-score {
  display: flex;
  width: 100%;
  min-height: 58px;
  align-items: center;
  justify-content: center;
  gap: 8px;
  margin-top: 13px;
  padding: 10px 9px;
  border-radius: 13px;
  background: rgba(70,26,7,.38);
  color: #fff;
  font-variant-numeric: tabular-nums;
}
.lb-school-podium.rank-1 .lb-school-score {
  min-height: 60px;
  background: rgba(124,45,18,.58);
}
.lb-school-podium.rank-2 .lb-school-score {
  background: rgba(18,48,126,.65);
}
.lb-school-podium.rank-3 .lb-school-score {
  background: rgba(25,24,91,.62);
}
.lb-school-score > span {
  color: #fcd34d;
  font-size: 14px;
  font-weight: 850;
}
.lb-school-score > strong {
  color: #fff;
  font-size: clamp(20px,2.15vw,26px);
  font-weight: 900;
  letter-spacing: -.035em;
  line-height: 1.1;
}
.lb-school-metrics {
  display: grid;
  width: 100%;
  min-height: 62px;
  grid-template-columns: repeat(2,minmax(0,1fr));
  margin-top: 10px;
  padding: 8px 4px;
  border-radius: 14px;
  background: #fff8e9;
  color: #101827;
}
.lb-school-metrics > span {
  display: flex;
  min-width: 0;
  flex-direction: column;
  align-items: center;
  justify-content: center;
  gap: 2px;
}
.lb-school-metrics > span + span {
  border-left: 1px solid rgba(245,158,11,.28);
}
.lb-school-metrics strong {
  color: #111827;
  font-size: 16px;
  font-weight: 900;
  font-variant-numeric: tabular-nums;
}
.lb-school-metrics small {
  color: #536176;
  font-size: 8px;
  font-weight: 850;
  letter-spacing: .04em;
  text-transform: uppercase;
}
.lb-school-contributors {
  display: flex;
  width: 100%;
  flex-direction: column;
  gap: 5px;
  margin-top: 11px;
  padding-top: 9px;
  border-top: 1px solid rgba(255,255,255,.15);
}
.lb-school-contributors-title {
  display: block;
  margin-bottom: 1px;
  color: rgba(255,255,255,.8);
  font-size: 9px;
  font-weight: 850;
  letter-spacing: .055em;
  line-height: 1.4;
  text-align: center;
  text-transform: uppercase;
}
.lb-school-contributor-row {
  display: grid;
  width: 100%;
  min-width: 0;
  grid-template-columns: 16px minmax(0,1fr) auto;
  align-items: center;
  gap: 5px;
  padding: 5px 7px;
  border-radius: 7px;
  background: rgba(4,12,39,.47);
  color: #f8fafc;
  font-size: 10px;
  line-height: 1.25;
  text-align: left;
}
.lb-school-podium.rank-1 .lb-school-contributor-row {
  background: rgba(82,29,12,.57);
}
.lb-school-podium.rank-2 .lb-school-contributor-row {
  background: rgba(12,31,94,.58);
}
.lb-school-podium.rank-3 .lb-school-contributor-row {
  background: rgba(15,19,75,.57);
}
.lb-school-contributor-rank {
  color: #38bdf8;
  font-weight: 900;
  font-variant-numeric: tabular-nums;
}
.lb-school-podium.rank-1 .lb-school-contributor-rank {
  color: #fbbf24;
}
.lb-school-podium.rank-3 .lb-school-contributor-rank {
  color: #a5b4fc;
}
.lb-school-contributor-name {
  min-width: 0;
  overflow: hidden;
  color: rgba(255,255,255,.94);
  text-overflow: ellipsis;
  white-space: nowrap;
}
.lb-school-contributor-score {
  color: #fcd34d;
  font-size: 9px;
  font-weight: 900;
  font-variant-numeric: tabular-nums;
  white-space: nowrap;
}
.lb-school-contributors-empty {
  padding: 9px 7px;
  border-radius: 7px;
  background: rgba(4,12,39,.35);
  color: rgba(255,255,255,.65);
  font-size: 10px;
  text-align: center;
}

/* Small refinements around the existing controls, category navigation and table. */
.lb-heading h1 {
  font-size: clamp(28px,2.8vw,35px);
  letter-spacing: -.045em;
}
.lb-heading p {
  font-size: 14px;
  line-height: 1.55;
}
.lb-control-line {
  gap: 10px;
  margin-top: 19px;
  margin-bottom: 23px;
}
.lb-segment {
  border-radius: 16px;
  padding: 4px;
}
.lb-segment button {
  min-height: 38px;
  padding: 9px 16px;
  font-size: 12px;
}
.lb-search {
  width: 264px;
  min-height: 42px;
  border-radius: 15px;
}
.lb-search input {
  font-size: 12px;
}
.lb-category-area {
  max-width: 960px;
  margin-top: 8px;
  margin-bottom: 24px;
}
.lb-category-tab {
  padding: 13px 17px 15px;
  font-size: 12px;
}
.lb-subgrades {
  padding-top: 14px;
  padding-bottom: 16px;
}
.lb-school-level-label {
  flex: 0 0 auto;
  color: var(--lb-muted);
  font-size: 10px;
  font-weight: 850;
  letter-spacing: .08em;
  text-transform: uppercase;
}
.lb-subgrade {
  padding: 7px 13px;
  font-size: 11px;
}
.lb-school-table-wrap .lb-table {
  min-width: 880px;
}
.lb-school-table-wrap .lb-table th {
  padding: 12px 14px;
  font-size: 10px;
}
.lb-school-table-wrap .lb-table tbody tr:not(.lb-empty-row) td {
  padding: 14px 14px;
  font-size: 12px;
}
.lb-school-table-wrap .lb-table tbody tr:not(.lb-empty-row) .lb-person-name {
  font-size: 13px;
}
.lb-school-table-wrap .lb-table tbody tr:not(.lb-empty-row) .lb-person-handle {
  font-size: 10px;
}
.lb-school-table-wrap .lb-school-name-cell {
  padding-left: 10px !important;
  padding-right: 18px !important;
  text-align: left;
}
.lb-school-table-wrap .lb-school-name-cell .lb-person {
  justify-content: flex-start;
  gap: 10px;
  margin-left: 0;
}
.lb-school-table-wrap .lb-school-name-cell .lb-person-meta {
  min-width: 0;
  text-align: left;
}
.lb-table .lb-student-school-cell {
  padding-left: 10px;
  text-align: left;
}
.lb-school-table-wrap .lb-table tbody tr:not(.lb-empty-row) .lb-score-cell {
  font-size: 14px !important;
}
.lb-pagination-info {
  font-size: 11px;
}
@media (max-width: 1000px) {
  .lb-school-podium-area { max-width: 860px; gap: 8px; }
  .lb-school-podium-tower { padding-left: 12px; padding-right: 12px; }
}
@media (max-width: 640px) {
  .lb-school-podium-area {
    display: grid;
    grid-template-columns: repeat(2,minmax(0,1fr));
    align-items: stretch;
    gap: 10px 7px;
    padding: 42px 0 20px;
  }
  .lb-school-podium-area .lb-school-podium {
    width: 100%;
    max-width: none !important;
    min-width: 0;
  }
  .lb-school-podium-area .lb-school-podium.rank-1 {
    grid-column: 1 / -1;
    order: -1;
    margin-bottom: 0;
  }
  .lb-school-podium-area .lb-school-podium-tower {
    min-height: 0;
    padding: 43px 9px 34px;
  }
  .lb-school-podium-area .lb-school-podium.rank-1 .lb-school-podium-tower {
    min-height: 0;
    padding: 44px 13px 39px;
  }
  .lb-school-podium-area .lb-school-name { font-size: 16px; }
  .lb-school-podium-area .lb-school-podium.rank-1 .lb-school-name { font-size: 22px; }
  .lb-school-podium-area .lb-school-meta { font-size: 10px; }
  .lb-school-podium-area .lb-school-score { min-height: 48px; gap: 6px; }
  .lb-school-podium-area .lb-school-score > span { font-size: 11px; }
  .lb-school-podium-area .lb-school-score > strong { font-size: 18px; }
  .lb-school-podium-area .lb-school-metrics { min-height: 54px; }
  .lb-school-podium-area .lb-school-metrics strong { font-size: 14px; }
  .lb-school-podium-area .lb-school-metrics small { font-size: 7px; }
  .lb-school-podium-area .lb-school-contributors { gap: 4px; margin-top: 9px; padding-top: 8px; }
  .lb-school-podium-area .lb-school-contributors-title { font-size: 8px; }
  .lb-school-podium-area .lb-school-contributor-row {
    grid-template-columns: 13px minmax(0,1fr);
    gap: 3px;
    padding: 5px;
    font-size: 8px;
  }
  .lb-school-podium-area .lb-school-contributor-score {
    grid-column: 2;
    font-size: 8px;
  }
  .lb-school-rank-badge { top: -28px; width: 56px; height: 56px; border-radius: 16px; }
  .lb-school-rank-badge > span { font-size: 18px; }
  .lb-category-tab { padding-left: 12px; padding-right: 12px; font-size: 10px; }
  .lb-podium-area:not(.lb-school-podium-area) { padding-top: 42px; }
  .lb-school-table-wrap .lb-table { min-width: 760px; }
}

/* Keep the category controls in a fixed two-row frame. The second row remains
   reserved for subfilters even on "Semua Jenjang", so changing categories never
   changes the navigation's height or vertical position. */
.lb-category-area {
  display: grid;
  grid-template-rows: 46px 62px;
  align-content: start;
  margin-bottom: 24px;
}
.lb-category-tabs {
  height: 46px;
  min-height: 46px;
  align-items: stretch;
}
.lb-category-tab {
  display: inline-flex;
  height: 46px;
  align-items: center;
  justify-content: center;
  padding: 0 17px;
}
.lb-category-subnav {
  display: flex;
  width: 100%;
  min-width: 0;
  height: 62px;
  min-height: 62px;
  align-items: center;
  justify-content: center;
  overflow: hidden;
}
.lb-category-subnav > .lb-subgrades {
  display: flex;
  width: 100%;
  height: 62px;
  min-height: 62px;
  flex-wrap: nowrap;
  align-items: center;
  justify-content: center;
  gap: 7px;
  overflow-x: auto;
  margin: 0;
  padding: 0 2px;
  scrollbar-width: none;
}
.lb-category-subnav > .lb-subgrades::-webkit-scrollbar { display: none; }
.lb-category-subnav .lb-subgrade { flex: 0 0 auto; white-space: nowrap; }
.lb-category-subnav .lb-subgrades-placeholder {
  visibility: hidden;
  pointer-events: none;
}

/* Both ranking modes share the same outer podium width, spacing and baseline.
   Their inner cards retain their own content density and existing ghost states. */
.lb-podium-area {
  width: 100%;
  max-width: 960px;
  gap: 10px;
  padding: 46px 4px 20px;
}
.lb-podium-area:not(.lb-school-podium-area) { padding-top: 46px; }
.lb-school-podium-area {
  max-width: 960px;
  gap: 10px;
  padding: 46px 4px 20px;
  margin-bottom: 0;
}
.lb-school-podium-area .lb-school-podium.rank-1 { flex: 1.1 1 0; }

@media (max-width: 1000px) {
  .lb-category-tab { padding-left: 11px; padding-right: 11px; }
}

@media (max-width: 640px) {
  .lb-category-tabs { justify-content: flex-start; }
  .lb-category-tab { padding-left: 12px; padding-right: 12px; }
  .lb-category-subnav { justify-content: flex-start; }
  .lb-category-subnav > .lb-subgrades { justify-content: flex-start; }
  .lb-podium-area { gap: 5px; padding: 42px 0 20px; }
  .lb-podium-area:not(.lb-school-podium-area) { padding-top: 42px; }
  .lb-school-podium-area { gap: 10px 7px; padding: 42px 0 20px; }
}

/* Reserve one shared podium frame so the category navigation remains below
   the Top 3 at the same document position in both leaderboard modes. */
.lb-podium-slot {
  display: flex;
  width: 100%;
  height: 560px;
  align-items: flex-end;
  justify-content: center;
}
.lb-podium-slot > .lb-podium-area { flex: 0 0 auto; }
.lb-podium-area:not(.lb-school-podium-area) .lb-podium.rank-1 {
  margin-bottom: 24px;
}
.lb-podium-area:not(.lb-school-podium-area) .lb-podium.rank-1 .lb-podium-tower {
  min-height: 425px;
}

@media (max-width: 640px) {
  /* Both modes use the same two-tier podium on mobile: first place above,
     second and third place side by side. Matching tower heights keep the
     category controls directly below the podium without vertical jumps. */
  .lb-podium-slot { height: 880px; }
  .lb-podium-area:not(.lb-school-podium-area) {
    display: grid;
    grid-template-columns: repeat(2, minmax(0, 1fr));
    align-items: stretch;
    gap: 10px 7px;
    padding: 42px 0 20px;
  }
  .lb-podium-area:not(.lb-school-podium-area) .lb-podium {
    width: 100%;
    max-width: none !important;
  }
  .lb-podium-area:not(.lb-school-podium-area) .lb-podium.rank-1 {
    grid-column: 1 / -1;
    order: -1;
    margin-bottom: 0;
  }
  .lb-podium-area:not(.lb-school-podium-area) .lb-podium-tower {
    min-height: 370px !important;
    padding: 43px 9px 34px;
  }
  .lb-podium-area:not(.lb-school-podium-area) .lb-podium.rank-1 .lb-podium-tower {
    min-height: 425px !important;
    padding: 44px 13px 39px;
  }
  .lb-school-podium-area .lb-school-podium-tower { min-height: 370px; }
  .lb-school-podium-area .lb-school-podium.rank-1 .lb-school-podium-tower { min-height: 425px; }
}
`;

export function LeaderboardPage() {
  const { user } = useApp();
  const { language } = useLanguage();
  const text = (id: string, en: string) => language === 'en' ? en : id;
  const [mode, setMode] = useState<Mode>('xp');
  const [period, setPeriod] = useState<PublicLeaderboardPeriod>('weekly');
  const [category, setCategory] = useState<Category>('all');
  const [subGrade, setSubGrade] = useState<string | null>(null);
  const [schoolLevelFilter, setSchoolLevelFilter] = useState<SchoolLevelFilter>('all');
  const [searchInput, setSearchInput] = useState('');
  const [page, setPage] = useState(1);
  const [entries, setEntries] = useState<LeaderEntry[]>([]);
  const [schoolEntries, setSchoolEntries] = useState<PublicSchoolLeaderboardRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [isRealtime, setIsRealtime] = useState(false);
  const [refreshNonce, setRefreshNonce] = useState(0);
  const [selectedSchool, setSelectedSchool] = useState<PublicSchoolLeaderboardRow | null>(null);

  useEffect(() => {
    let active = true;
    let requestVersion = 0;

    const load = async (silent: boolean) => {
      const currentRequest = ++requestVersion;
      if (!silent) setLoading(true);
      setError('');
      try {
        const dataPeriod = mode === 'xp' ? period : 'all';
        const [people, schools] = await Promise.all([
          mode === 'xp'
            ? getPublicLeaderboardEnriched(dataPeriod, MAX_RANK)
            : getPublicCoinLeaderboard(MAX_RANK),
          mode === 'xp'
            ? getPublicSchoolLeaderboard(dataPeriod, MAX_RANK)
            : Promise.resolve([] as PublicSchoolLeaderboardRow[]),
        ]);

        if (!active || currentRequest !== requestVersion) return;
        setEntries(mode === 'xp'
          ? normalizeXPRows(people as PublicEnrichedLeaderboardRow[])
          : (people as PublicCoinLeaderboardRow[]).map(normalizeCoinRow));
        setSchoolEntries(schools);
      } catch (cause) {
        if (!active || currentRequest !== requestVersion) return;
        if (!silent) {
          setError(cause instanceof Error ? cause.message : 'Gagal memuat papan peringkat.');
          setEntries([]);
          setSchoolEntries([]);
        }
      } finally {
        if (active && currentRequest === requestVersion && !silent) setLoading(false);
      }
    };

    void load(false);

    const channel = supabase
      .channel('public-leaderboard-live')
      .on('postgres_changes', { event: '*', schema: 'public', table: 'profiles' }, () => {
        invalidateLeaderboardMemory();
        void load(true);
      })
      .subscribe((status) => {
        if (active) setIsRealtime(status === 'SUBSCRIBED');
      });

    const refreshTimer = window.setInterval(() => {
      invalidateLeaderboardMemory();
      void load(true);
    }, 60_000);

    return () => {
      active = false;
      window.clearInterval(refreshTimer);
      void supabase.removeChannel(channel);
    };
  }, [mode, period, refreshNonce]);

  const filteredEntries = useMemo(() => {
    const levelFiltered = entries.filter((entry) => {
      if (category === 'all' || category === 'school') return true;
      if (gradeGroup(entry.grade) !== category) return false;
      if (subGrade && gradeClass(entry.grade) !== subGrade) return false;
      return true;
    });

    return levelFiltered.map((entry, index) => ({
      ...entry,
      displayRank: category === 'all' ? entry.rank : index + 1,
    }));
  }, [entries, category, subGrade]);

  const query = searchInput.trim().toLocaleLowerCase('id-ID');
  const searchActive = query.length > 0;

  const searchedEntries = useMemo(() => {
    if (!query) return filteredEntries;
    return filteredEntries.filter((entry) => [
      entry.display_name,
      entry.username,
      entry.institution ?? '',
      gradeLabel(entry.grade),
      entry.grade ?? '',
    ].some((value) => value.toLocaleLowerCase('id-ID').includes(query)));
  }, [filteredEntries, query]);

  const filteredSchools = useMemo(() => {
    const matches = schoolEntries.filter((school) => {
      const matchesQuery = !query
        || (school.school_name + ' ' + school.levels).toLocaleLowerCase('id-ID').includes(query);
      return matchesQuery && matchesSchoolLevel(school.levels, schoolLevelFilter);
    });
    return schoolLevelFilter === 'all'
      ? matches
      : matches.map((school, index) => ({ ...school, rank: index + 1 }));
  }, [schoolEntries, query, schoolLevelFilter]);

  const activeRows = category === 'school' ? [] : searchedEntries;
  const activeSchools = category === 'school' ? filteredSchools : [];
  const sourceLength = category === 'school' ? activeSchools.length : activeRows.length;
  const listLength = searchActive ? sourceLength : Math.max(0, sourceLength - 3);
  const totalPages = Math.max(1, Math.ceil(listLength / PER_PAGE));
  const safePage = Math.min(page, totalPages);

  const podiumItems = !searchActive && category !== 'school'
    ? [
        { place: 2 as const, entry: filteredEntries[1] ?? null },
        { place: 1 as const, entry: filteredEntries[0] ?? null },
        { place: 3 as const, entry: filteredEntries[2] ?? null },
      ]
    : [];
  const podiumSchoolItems = !searchActive && category === 'school'
    ? [
        { place: 2 as const, school: filteredSchools[1] ?? null },
        { place: 1 as const, school: filteredSchools[0] ?? null },
        { place: 3 as const, school: filteredSchools[2] ?? null },
      ]
    : [];

  const pagedPeople = searchActive
    ? activeRows.slice((safePage - 1) * PER_PAGE, safePage * PER_PAGE)
    : activeRows.slice(3 + (safePage - 1) * PER_PAGE, 3 + safePage * PER_PAGE);
  const pagedSchools = searchActive
    ? activeSchools.slice((safePage - 1) * PER_PAGE, safePage * PER_PAGE)
    : activeSchools.slice(3 + (safePage - 1) * PER_PAGE, 3 + safePage * PER_PAGE);

  const userRank = category !== 'school' && user?.id
    ? filteredEntries.find((entry) => entry.user_id === user.id) ?? null
    : null;

  const changeMode = (next: Mode) => {
    setMode(next);
    setPage(1);
    setSearchInput('');
    setSchoolLevelFilter('all');
    if (next === 'coin' && category === 'school') setCategory('all');
  };

  const changeCategory = (next: Category) => {
    if (next === 'school' && mode === 'coin') return;
    setCategory(next);
    setSubGrade(null);
    setSchoolLevelFilter('all');
    setPage(1);
  };

  const changeSchoolLevel = (next: SchoolLevelFilter) => {
    setSchoolLevelFilter(next);
    setPage(1);
  };

  const changePeriod = (next: PublicLeaderboardPeriod) => {
    setPeriod(next);
    setPage(1);
  };

  const changeSearch = (value: string) => {
    setSearchInput(value);
    setPage(1);
  };

  const onPickSchool = (key: string) => {
    const school = schoolEntries.find((entry) => entry.school_key === key);
    if (school) setSelectedSchool(school);
  };

  useEffect(() => {
    if (!selectedSchool) return;
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') setSelectedSchool(null);
    };
    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, [selectedSchool]);

  const categoryNavigation = (
<nav className="lb-category-area" aria-label={text('Kategori papan peringkat','Leaderboard categories')}>
  <div className="lb-category-tabs">
    {CATEGORIES.map((item) => {
      const isDisabled = item.key === 'school' && mode === 'coin';
      return (
        <button
          key={item.key}
          type="button"
          className={'lb-category-tab ' + (category === item.key ? 'active' : '')}
          disabled={isDisabled}
          title={isDisabled ? text('Peringkat sekolah menggunakan akumulasi XP.','School rankings use accumulated XP.') : undefined}
          onClick={() => changeCategory(item.key)}
        >
          {item.key === 'school' && <School size={13} style={{ display: 'inline', verticalAlign: '-2px', marginRight: 5 }} />}
          {language === 'en' ? ({ all: 'All levels', sd: 'Elementary', smp: 'Junior high', sma: 'Senior high', school: 'School rankings' } as Record<string, string>)[item.key] : item.label}
        </button>
      );
    })}
  </div>
  <div className="lb-category-subnav">
    {category === 'school' ? (
      <div className="lb-subgrades lb-school-level-filters" aria-label={text('Filter jenjang sekolah','School level filter')}>
        <span className="lb-school-level-label">{text('Jenjang Sekolah:','School Level:')}</span>
        <button type="button" className={'lb-subgrade ' + (schoolLevelFilter === 'all' ? 'active' : '')} aria-pressed={schoolLevelFilter === 'all'} onClick={() => changeSchoolLevel('all')}>
          {text('Semua Sekolah','All schools')}
        </button>
        <button type="button" className={'lb-subgrade ' + (schoolLevelFilter === 'sd' ? 'active' : '')} aria-pressed={schoolLevelFilter === 'sd'} onClick={() => changeSchoolLevel('sd')}>
          {text('SD Sederajat','Elementary')}
        </button>
        <button type="button" className={'lb-subgrade ' + (schoolLevelFilter === 'smp' ? 'active' : '')} aria-pressed={schoolLevelFilter === 'smp'} onClick={() => changeSchoolLevel('smp')}>
          {text('SMP Sederajat','Junior high')}
        </button>
        <button type="button" className={'lb-subgrade ' + (schoolLevelFilter === 'sma' ? 'active' : '')} aria-pressed={schoolLevelFilter === 'sma'} onClick={() => changeSchoolLevel('sma')}>
          {text('SMA/SMK Sederajat','Senior high')}
        </button>
      </div>
    ) : category !== 'all' ? (
      <div className="lb-subgrades" aria-label={text('Filter kelas','Grade filter')}>
        <button type="button" className={'lb-subgrade ' + (!subGrade ? 'active' : '')} onClick={() => { setSubGrade(null); setPage(1); }}>
          Semua {category === 'sd' ? 'SD' : category === 'smp' ? 'SMP' : 'SMA/SMK'}
        </button>
        {SUB_GRADES[category].map((level) => (
          <button key={level} type="button" className={'lb-subgrade ' + (subGrade === level ? 'active' : '')} onClick={() => { setSubGrade(level); setPage(1); }}>
            Kelas {level}
          </button>
        ))}
      </div>
    ) : (
      <div className="lb-subgrades lb-subgrades-placeholder" aria-hidden="true" />
    )}
  </div>
</nav>
  );

  return (
    <main className="syka-leaderboard">
      <style>{LEADERBOARD_STYLES}</style>

      <header className="lb-heading">
        <div className="lb-eyebrow"><Activity size={14} /> {text('Pencapaian Siswa','Student Achievements')}</div>
        <h1>
          {text('Peringkat Juara','Leaderboard')}
          <span className={'lb-live ' + (isRealtime ? '' : 'is-polling')} title={isRealtime ? text('Berlangganan perubahan profil realtime, dengan penyegaran berkala sebagai cadangan.','Subscribed to realtime profile updates with periodic refresh as fallback.') : text('Data disegarkan otomatis setiap 60 detik.','Data refreshes automatically every 60 seconds.')}>
            <span className="lb-live-dot" />
            {isRealtime ? text('Update Realtime','Realtime Updates') : text('Update Otomatis','Auto Updates')}
          </span>
        </h1>
        <p>{text('Pantau pemuncak klasemen XP global dan tingkatkan prestasimu!','Track the global XP leaders and improve your achievements!')}</p>
      </header>

      <div className="lb-control-line">
        <div className="lb-segment lb-mode" role="group" aria-label={text("Mode peringkat","Leaderboard mode")}>
          <button type="button" className={mode === 'xp' ? 'active' : ''} onClick={() => changeMode('xp')}>{text('XP Global','Global XP')}</button>
          <button type="button" className={mode === 'coin' ? 'active' : ''} onClick={() => changeMode('coin')}>Edu Coin</button>
        </div>
        {mode === 'xp' && (
          <div className="lb-segment" role="group" aria-label={text("Periode peringkat","Ranking period")}>
            {PERIODS.map((item) => (
              <button key={item.key} type="button" className={period === item.key ? 'active' : ''} onClick={() => changePeriod(item.key)}>
                {language === 'en' ? ({ weekly: 'Weekly', monthly: 'Monthly', all: 'All time' } as Record<string, string>)[item.key] : item.label}
              </button>
            ))}
          </div>
        )}
        <label className="lb-search">
          <Search size={15} aria-hidden="true" />
          <input
            type="search"
            value={searchInput}
            onChange={(event) => changeSearch(event.target.value)}
            placeholder={category === 'school' ? text('Cari nama sekolah...','Search school name...') : text('Cari nama atau sekolah...','Search name or school...')}
            aria-label={category === 'school' ? text('Cari peringkat sekolah','Search school rankings') : text('Cari siswa atau sekolah','Search students or schools')}
          />
          {searchInput && <button type="button" aria-label={text("Hapus pencarian","Clear search")} onClick={() => changeSearch('')}><X size={14} /></button>}
        </label>
      </div>



      {loading && <div className="lb-loading"><span className="lb-spinner" />{text('Memuat peringkat...','Loading rankings...')}</div>}
      {!loading && error && (
        <div className="lb-empty" role="alert">
          <strong>{text('Belum bisa memuat peringkat.','Could not load rankings.')}</strong>
          <p style={{ margin: '7px 0 12px' }}>{error}</p>
          <button type="button" className="lb-subgrade active" onClick={() => { invalidateLeaderboardMemory(); setRefreshNonce((value) => value + 1); }}>{text('Coba segarkan','Try again')}</button>
        </div>
      )}

      {!loading && !error && (
        <div key={mode + '-' + period + '-' + category + '-' + (subGrade ?? 'all') + '-' + schoolLevelFilter + '-' + (searchActive ? 'search' : 'browse')} className="lb-main-content">
          {searchActive && (
            <div className="lb-search-note">
              <span>Hasil pencarian untuk <strong>“{searchInput.trim()}”</strong> · {sourceLength} ditemukan</span>
              <button type="button" className="lb-subgrade" onClick={() => changeSearch('')}>Hapus pencarian</button>
            </div>
          )}

          {category === 'school' ? (
            <>
              <div className="lb-podium-slot">
                {!searchActive && (
                  <div className="lb-podium-area lb-school-podium-area">
                    {podiumSchoolItems.map(({ school, place }) => school
                      ? <SchoolPodiumCard key={school.school_key} school={school} place={place} onClick={() => onPickSchool(school.school_key)} />
                      : <EmptyPodiumCard key={'empty-school-' + place} place={place} kind="school" mode="xp" />)}
                  </div>
                )}
              </div>
              {categoryNavigation}
              <SchoolRankingTable schools={pagedSchools} placeholderRanks={searchActive ? [] : Array.from({ length: Math.max(0, PER_PAGE - pagedSchools.length) }, (_, index) => 4 + (safePage - 1) * PER_PAGE + pagedSchools.length + index)} onPickSchool={onPickSchool} />
              {sourceLength > 3 && renderPagination(safePage, totalPages, setPage, listLength, 'sekolah', searchActive)}
              <p className="lb-pagination-info">Menampilkan {Math.min(sourceLength, searchActive ? pagedSchools.length : 3 + pagedSchools.length)} dari {sourceLength} sekolah</p>
            </>
          ) : (
            <>
              <div className="lb-podium-slot">
                {!searchActive && (
                  <div className="lb-podium-area">
                    {podiumItems.map(({ entry, place }) => entry
                      ? <PersonPodiumCard key={entry.user_id} entry={entry} place={place} mode={mode} />
                      : <EmptyPodiumCard key={'empty-student-' + place} place={place} kind="student" mode={mode} />)}
                  </div>
                )}
              </div>
              {categoryNavigation}
              <PersonRankingTable rows={pagedPeople} placeholderRanks={searchActive ? [] : Array.from({ length: Math.max(0, PER_PAGE - pagedPeople.length) }, (_, index) => 4 + (safePage - 1) * PER_PAGE + pagedPeople.length + index)} mode={mode} currentUserId={user?.id} onPickSchool={onPickSchool} />
              {sourceLength > (searchActive ? 0 : 3) && renderPagination(safePage, totalPages, setPage, listLength, 'siswa', searchActive)}
              <p className="lb-pagination-info">Menampilkan {Math.min(sourceLength, searchActive ? pagedPeople.length : 3 + pagedPeople.length)} dari {sourceLength} siswa</p>
              {userRank && (
                <div className="lb-user-rank">
                  <div className="lb-user-place">#{userRank.displayRank}</div>
                  <Avatar name={userRank.display_name} id={userRank.user_id} size={42} src={userRank.avatar_url ?? undefined} />
                  <div className="lb-user-details">
                    <div className="lb-user-label">{text('Peringkat kamu','Your rank')}</div>
                    <div className="lb-user-name">{userRank.display_name} <span className="lb-you">KAMU</span></div>
                    <div className="lb-user-school">{userRank.institution || 'Sekolah belum diisi'} · {gradeLabel(userRank.grade)}</div>
                  </div>
                  <div className="lb-user-score">{formatNumber(scoreFor(userRank, mode))}<div style={{ fontSize: 9, fontWeight: 700, opacity: .75 }}>{mode === 'xp' ? 'XP' : 'Edu Coin'}</div></div>
                </div>
              )}
              {mode === 'xp' && period !== 'all' && (
                <p className="lb-period-note">
                  <CalendarDays size={13} style={{ flexShrink: 0, marginTop: 1 }} />
                  Peringkat periode menggunakan transaksi XP yang tercatat pada jurnal XP selama {period === 'weekly' ? 'minggu berjalan (Senin–Minggu)' : 'bulan berjalan'}. XP lama yang tidak memiliki catatan transaksi periode tidak direkonstruksi dari saldo total.
                </p>
              )}
            </>
          )}
        </div>
      )}

      {selectedSchool && (
        <div className="lb-modal-backdrop" role="presentation" onClick={() => setSelectedSchool(null)}>
          <section className="lb-modal" role="dialog" aria-modal="true" aria-labelledby="lb-school-title" onClick={(event) => event.stopPropagation()}>
            <div className="lb-modal-header">
              <div>
                <h2 id="lb-school-title">{selectedSchool.school_name}</h2>
                <p>5 siswa penyumbang XP terbanyak · {formatNumber(selectedSchool.student_count)} siswa terdaftar di peringkat</p>
              </div>
              <button type="button" className="lb-modal-close" aria-label="Tutup detail sekolah" onClick={() => setSelectedSchool(null)}><X size={17} /></button>
            </div>
            {selectedSchool.top_students.length === 0 && <div className="lb-empty">{text('Belum ada siswa publik pada sekolah ini.','No public students at this school yet.')}</div>}
            {selectedSchool.top_students.map((student, index) => (
              <div className="lb-modal-student" key={student.user_id}>
                <div className="lb-modal-student-main">
                  <span className={'lb-rank-number rank-' + (index + 1)}>#{index + 1}</span>
                  <Link to={'/profile/' + student.username} onClick={() => setSelectedSchool(null)}>
                    <Avatar name={student.display_name} id={student.user_id} size={37} src={student.avatar_url ?? undefined} />
                  </Link>
                  <div>
                    <Link to={'/profile/' + student.username} className="lb-modal-student-name" onClick={() => setSelectedSchool(null)}>{student.display_name}</Link>
                    <div className="lb-modal-student-meta">@{student.username} · {gradeLabel(student.grade)}</div>
                  </div>
                </div>
                <div style={{ textAlign: 'right' }}>
                  <div className="lb-modal-student-score">{formatNumber(student.xp)} XP</div>
                  <div className="lb-modal-student-meta">Rata-rata {formatAverage(student.average_score)}</div>
                </div>
              </div>
            ))}
          </section>
        </div>
      )}
    </main>
  );
}

function scoreFor(entry: LeaderEntry, mode: Mode): number {
  return mode === 'xp' ? entry.xp : Number(entry.edu_coin ?? 0);
}

function EmptyPodiumCard({ place, kind, mode }: { place: 1 | 2 | 3; kind: 'student' | 'school'; mode: Mode }) {
  const label = place === 1 ? '1st' : place === 2 ? '2nd' : '3rd';
  const scoreLabel = kind === 'school' ? 'Total XP' : mode === 'xp' ? 'XP' : 'Edu Coin';
  return (
    <article className={'lb-podium is-empty rank-' + place} aria-label={'Slot peringkat ' + place + ' belum terisi'}>
      <div className={'lb-podium-badge rank-' + place}>
        {place === 1 ? <Crown size={14} /> : <Medal size={14} />}
        {label}
      </div>
      <div className="lb-podium-tower">
        <div className="lb-avatar-wrap">
          {kind === 'school' ? <School size={place === 1 ? 42 : 36} /> : <Trophy size={place === 1 ? 38 : 32} />}
        </div>
        <span className="lb-podium-name">Belum terisi</span>
        <span className="lb-podium-user">{kind === 'school' ? 'Menunggu sekolah' : 'Menunggu peserta'}</span>
        <div className="lb-podium-score">
          <span>{scoreLabel}</span>
          <strong>—</strong>
        </div>
        {kind === 'student' && mode === 'xp' && (
          <div className="lb-podium-metrics">
            <div><span>—</span><small>Rata-rata</small></div>
            <div><span>—</span><small>Lomba</small></div>
          </div>
        )}
      </div>
    </article>
  );
}

function PersonPodiumCard({ entry, place, mode }: { entry: LeaderEntry; place: 1 | 2 | 3; mode: Mode }) {
  const label = place === 1 ? '1st' : place === 2 ? '2nd' : '3rd';
  const average = entry.average_score == null ? '—' : formatAverage(entry.average_score);
  return (
    <article className={'lb-podium lb-person-podium rank-' + place}>
      <span className={'lb-school-rank-badge lb-person-rank-badge rank-' + place}><span>{label}</span></span>
      <div className="lb-podium-tower">
        {place === 1 && <Crown size={21} className="lb-podium-medal" />}
        <div className="lb-avatar-wrap">
          <Avatar name={entry.display_name} id={entry.user_id} size={place === 1 ? 88 : 78} src={entry.avatar_url ?? undefined} />
        </div>
        <Link to={'/profile/' + entry.username} className="lb-podium-name" title={entry.display_name}>{entry.display_name}</Link>
        <div className="lb-podium-user">@{entry.username}</div>
        <div className="lb-podium-school">{entry.institution || 'Sekolah belum diisi'}</div>
        <div className="lb-podium-score">
          <span>{mode === 'xp' ? 'XP' : 'Edu Coin'}</span>
          <strong>{formatNumber(scoreFor(entry, mode))}</strong>
        </div>
        {mode === 'xp' && (
          <div className="lb-podium-metrics">
            <div><span className={entry.average_score == null ? '' : 'good'}>{average}</span><small>Rata-rata</small></div>
            <div><span>{formatNumber(entry.competitions_count)}</span><small>Lomba</small></div>
          </div>
        )}
      </div>
    </article>
  );
}

function SchoolPodiumCard({ school, place, onClick }: { school: PublicSchoolLeaderboardRow; place: 1 | 2 | 3; onClick: () => void }) {
  const label = place === 1 ? '1st' : place === 2 ? '2nd' : '3rd';
  const topStudents = school.top_students.slice(0, 3);

  return (
    <button
      type="button"
      className={'lb-podium lb-school-podium rank-' + place}
      onClick={onClick}
      aria-label={'Lihat peringkat sekolah ' + school.school_name}
    >
      <span className={'lb-school-rank-badge rank-' + place}><span>{label}</span></span>
      <span className="lb-school-podium-tower">
        <span className="lb-school-name" title={school.school_name}>{school.school_name}</span>
        <span className="lb-school-meta">{formatNumber(school.student_count)} Siswa Aktif</span>

        <span className="lb-school-score">
          <span>XP</span>
          <strong>{formatNumber(school.xp)}</strong>
        </span>

        <span className="lb-school-metrics">
          <span>
            <strong>{formatAverage(school.average_score)}</strong>
            <small>Rata-rata</small>
          </span>
          <span>
            <strong>{formatNumber(school.competitions_count)}</strong>
            <small>Tot. Lomba</small>
          </span>
        </span>

        <span className="lb-school-contributors">
          <span className="lb-school-contributors-title">Top Penyumbang XP:</span>
          {topStudents.length > 0 ? topStudents.map((student, index) => (
            <span className="lb-school-contributor-row" key={student.user_id}>
              <span className="lb-school-contributor-rank">{index + 1}.</span>
              <span className="lb-school-contributor-name">{student.display_name}</span>
              <strong className="lb-school-contributor-score">{formatNumber(student.xp)} XP</strong>
            </span>
          )) : (
            <span className="lb-school-contributors-empty">Belum ada kontributor XP.</span>
          )}
        </span>
      </span>
    </button>
  );
}
function PersonRankingTable({ rows, placeholderRanks, mode, currentUserId }: { rows: LeaderEntry[]; placeholderRanks: number[]; mode: Mode; currentUserId?: string; onPickSchool: (key: string) => void }) {
  return (
    <div className="lb-table-wrap">
      <table className="lb-table">
        <thead>
          <tr>
            <th style={{ width: 78 }}>Peringkat</th>
            <th style={{ width: '29%' }}>Nama & Username</th>
            <th style={{ width: '22%' }}>Sekolah</th>
            <th style={{ width: 120 }}>Kelas</th>
            <th style={{ width: 92 }}>Rata-rata</th>
            <th style={{ width: 80 }}>Lomba</th>
            <th style={{ width: 130, textAlign: 'right' }}>{mode === 'xp' ? 'Total XP' : 'Total Edu Coin'}</th>
          </tr>
        </thead>
        <tbody>
          {rows.map((entry) => {
            const isMe = currentUserId === entry.user_id;
            return (
              <tr key={entry.user_id}>
                <td><span className="lb-rank-number">{entry.displayRank}</span></td>
                <td>
                  <div className="lb-person">
                    <Link to={'/profile/' + entry.username}>
                      <Avatar name={entry.display_name} id={entry.user_id} size={35} src={entry.avatar_url ?? undefined} />
                    </Link>
                    <div className="lb-person-meta">
                      <Link to={'/profile/' + entry.username} className="lb-person-name">{entry.display_name}{isMe && <span className="lb-you">KAMU</span>}</Link>
                      <span className="lb-person-handle">@{entry.username}</span>
                    </div>
                  </div>
                </td>
                <td className="lb-student-school-cell"><div className="lb-school-cell" title={entry.institution ?? ''}>{entry.institution || '—'}</div></td>
                <td>{gradeLabel(entry.grade)}</td>
                <td>{mode === 'xp' ? formatAverage(entry.average_score) : '—'}</td>
                <td>{mode === 'xp' ? formatNumber(entry.competitions_count) : '—'}</td>
                <td className="lb-score-cell">{formatNumber(scoreFor(entry, mode))}<small>{mode === 'xp' ? 'XP' : 'Coin'}</small></td>
              </tr>
            );
          })}
          {placeholderRanks.map((rank) => <RankingPlaceholderRow key={'empty-student-' + rank} rank={rank} kind="student" />)}
        </tbody>
      </table>
      {!rows.length && !placeholderRanks.length && <div className="lb-empty">Tidak ada siswa yang cocok dengan pencarian atau filter ini.</div>}
    </div>
  );
}

function SchoolRankingTable({ schools, placeholderRanks, onPickSchool }: { schools: PublicSchoolLeaderboardRow[]; placeholderRanks: number[]; onPickSchool: (key: string) => void }) {
  return (
    <div className="lb-table-wrap lb-school-table-wrap">
      <table className="lb-table">
        <colgroup>
          <col style={{ width: 58 }} />
          <col style={{ width: '30%' }} />
          <col style={{ width: '12%' }} />
          <col style={{ width: '14%' }} />
          <col style={{ width: 92 }} />
          <col style={{ width: 100 }} />
          <col style={{ width: 115 }} />
        </colgroup>
        <thead>
          <tr>
            <th colSpan={2} style={{ width: '36%' }}>Peringkat & Nama</th>
            <th style={{ width: '13%' }}>Jumlah Siswa</th>
            <th style={{ width: '14%' }}>Jenjang</th>
            <th style={{ width: 110 }}>Rata-rata</th>
            <th style={{ width: 105 }}>Lomba</th>
            <th style={{ width: 130, textAlign: 'right' }}>Total XP</th>
          </tr>
        </thead>
        <tbody>
          {schools.map((school) => (
            <tr key={school.school_key} className="lb-clickable" onClick={() => onPickSchool(school.school_key)} onKeyDown={(event) => { if (event.key === 'Enter' || event.key === ' ') onPickSchool(school.school_key); }} tabIndex={0} aria-label={'Lihat siswa dari ' + school.school_name}>
              <td><span className="lb-rank-number">{school.rank}</span></td>
              <td className="lb-school-name-cell">
                <div className="lb-person">
                  <span className="lb-school-icon"><School size={16} /></span>
                  <div className="lb-person-meta">
                    <span className="lb-person-name">{school.school_name}</span>
                    <span className="lb-person-handle">Klik untuk melihat 5 kontributor XP teratas</span>
                  </div>
                </div>
              </td>
              <td>{formatNumber(school.student_count)}</td>
              <td>{school.levels}</td>
              <td>{formatAverage(school.average_score)}</td>
              <td>{formatNumber(school.competitions_count)}</td>
              <td className="lb-score-cell">{formatNumber(school.xp)}<small>XP</small></td>
            </tr>
          ))}
          {placeholderRanks.map((rank) => <RankingPlaceholderRow key={'empty-school-' + rank} rank={rank} kind="school" />)}
        </tbody>
      </table>
      {!schools.length && !placeholderRanks.length && <div className="lb-empty">Belum ada data sekolah yang cocok.</div>}
    </div>
  );
}

function RankingPlaceholderRow({ rank, kind }: { rank: number; kind: 'student' | 'school' }) {
  return (
    <tr className="lb-empty-row" aria-label={'Peringkat ' + rank + ' belum terisi'}>
      <td><span className="lb-rank-number">{rank}</span></td>
      <td>
        <div className="lb-person">
          <span className="lb-empty-avatar">{kind === 'school' ? <School size={15} /> : <Users size={15} />}</span>
          <div className="lb-person-meta">
            <span className="lb-person-name">Belum terisi</span>
            <span className="lb-person-handle">Slot peringkat kosong</span>
          </div>
        </div>
      </td>
      <td>—</td>
      <td>—</td>
      <td>—</td>
      <td>—</td>
      <td className="lb-empty-score">—</td>
    </tr>
  );
}

function renderPagination(
  page: number,
  totalPages: number,
  setPage: (page: number) => void,
  count: number,
  label: string,
  searchActive: boolean,
) {
  if (count <= PER_PAGE) return null;
  const pageButtons = Array.from({ length: Math.min(totalPages, 7) }, (_, index) => {
    if (totalPages <= 7) return index + 1;
    if (page <= 4) return index + 1;
    if (page >= totalPages - 3) return totalPages - 6 + index;
    return page - 3 + index;
  });
  return (
    <nav className="lb-pagination" aria-label={'Halaman peringkat ' + label}>
      <button type="button" aria-label="Halaman sebelumnya" disabled={page <= 1} onClick={() => setPage(Math.max(1, page - 1))}><ChevronLeft size={15} /></button>
      {pageButtons.map((pageNumber) => (
        <button key={pageNumber} type="button" className={pageNumber === page ? 'active' : ''} aria-current={pageNumber === page ? 'page' : undefined} onClick={() => setPage(pageNumber)}>{pageNumber}</button>
      ))}
      <button type="button" aria-label="Halaman berikutnya" disabled={page >= totalPages} onClick={() => setPage(Math.min(totalPages, page + 1))}><ChevronRight size={15} /></button>
    </nav>
  );
}
