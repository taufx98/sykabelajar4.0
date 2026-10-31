import { useCallback, useEffect, useState } from 'react';
import { ArrowLeft, Award, Loader2, Trophy, Users } from 'lucide-react';
import { Link, useParams } from 'react-router-dom';
import { Badge } from '@/components/ui/Badge';
import { Button } from '@/components/ui/Button';
import { Card } from '@/components/ui/Card';
import {
  getPublicCompetitionResults,
  type PublicCompetitionResults,
  type CompetitionResultRow,
} from '@/services/competitionResults.service';

function formatDate(value?: string | null) {
  if (!value) return 'Belum ditentukan';
  const date = new Date(value);
  if (!Number.isFinite(date.getTime())) return '—';
  return new Intl.DateTimeFormat('id-ID', {
    dateStyle: 'long',
    timeStyle: 'short',
    timeZone: 'Asia/Jakarta',
  }).format(date) + ' WIB';
}

function podiumLabel(rank: number) {
  if (rank === 1) return 'Juara 1';
  if (rank === 2) return 'Juara 2';
  if (rank === 3) return 'Juara 3';
  return 'Peringkat ' + rank;
}

export function CompetitionResultsPage() {
  const { slug = '' } = useParams<{ slug: string }>();
  const [data, setData] = useState<PublicCompetitionResults | null>(null);
  const [results, setResults] = useState<CompetitionResultRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [loadingMore, setLoadingMore] = useState(false);
  const [error, setError] = useState('');
  const [loadMoreError, setLoadMoreError] = useState('');

  const load = useCallback(async () => {
    if (!slug) {
      setError('Tautan hasil lomba tidak lengkap.');
      setLoading(false);
      return;
    }
    setLoading(true);
    setError('');
    setLoadMoreError('');
    try {
      const response = await getPublicCompetitionResults(slug, 0);
      setData(response);
      setResults(response.results ?? []);
    } catch {
      setData(null);
      setResults([]);
      setError('Hasil belum tersedia, belum diumumkan secara resmi, atau lomba tidak dipublikasikan untuk umum.');
    } finally {
      setLoading(false);
    }
  }, [slug]);

  useEffect(() => {
    void load();
  }, [load]);

  const loadMore = async () => {
    if (!slug || !data || loadingMore || results.length >= data.result_count) return;
    setLoadingMore(true);
    setLoadMoreError('');
    try {
      const next = await getPublicCompetitionResults(slug, results.length);
      setResults((current) => current.concat(next.results ?? []));
    } catch {
      setLoadMoreError('Sebagian daftar peringkat gagal dimuat. Silakan coba lagi.');
    } finally {
      setLoadingMore(false);
    }
  };

  if (loading) {
    return <div className="min-h-screen surface-bg p-5 text-fg-secondary"><Card className="mx-auto max-w-4xl p-10 text-center text-fg-muted"><Loader2 className="mx-auto mb-2 animate-spin"/>Memuat hasil lomba…</Card></div>;
  }

  if (error || !data) {
    return (
      <div className="min-h-screen surface-bg p-5 text-fg-secondary">
        <div className="mx-auto max-w-2xl pt-12">
          <Card className="p-8 text-center sm:p-10">
            <Award size={34} className="mx-auto mb-3 text-fg-muted"/>
            <h1 className="text-xl font-bold text-fg">Hasil lomba belum tersedia</h1>
            <p className="mt-2 text-sm leading-relaxed text-fg-muted">{error}</p>
            <div className="mt-5 flex flex-wrap justify-center gap-2">
              <Button variant="outline" onClick={() => void load()}>Coba lagi</Button>
              <Link to="/"><Button>Kembali ke SykaBelajar</Button></Link>
            </div>
          </Card>
        </div>
      </div>
    );
  }

  const competition = data.competition;
  const resultCount = data.result_count;

  return (
    <main className="min-h-screen surface-bg px-3 py-6 text-fg-secondary sm:px-5 md:py-10">
      <div className="mx-auto max-w-6xl space-y-5">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <Link to="/" className="inline-flex items-center gap-2 text-xs text-fg-muted transition hover:text-fg"><ArrowLeft size={14}/>SykaBelajar</Link>
          <Badge color="moss">Hasil Resmi Diumumkan</Badge>
        </div>

        <Card className="relative overflow-hidden p-5 sm:p-7">
          <div className="pointer-events-none absolute -right-16 -top-20 h-64 w-64 rounded-full bg-accent/10 blur-3xl"/>
          <div className="relative">
            <p className="text-[10px] font-bold uppercase tracking-[0.16em] text-accent">Hasil Kompetisi</p>
            <h1 className="mt-2 max-w-4xl text-2xl font-extrabold leading-tight text-fg sm:text-3xl md:text-4xl">{competition.title}</h1>
            <p className="mt-2 text-sm text-fg-muted">{competition.category || 'Kompetisi SykaBelajar'}</p>
            <div className="mt-5 flex flex-wrap gap-4 text-xs text-fg-muted">
              <span className="inline-flex items-center gap-2"><Users size={14}/>{resultCount.toLocaleString('id-ID')} peserta memperoleh hasil final</span>
              <span className="inline-flex items-center gap-2"><Award size={14}/>Diterbitkan {formatDate(competition.published_at)}</span>
            </div>
          </div>
        </Card>

        {results.length === 0 ? (
          <Card className="p-10 text-center text-sm text-fg-muted">Belum ada hasil final yang dapat ditampilkan.</Card>
        ) : (
          <>
            <div className="grid gap-3 sm:grid-cols-3">
              {results.filter((row) => row.rank <= 3).slice(0, 3).sort((a, b) => a.rank - b.rank).map((row) => (
                <Card key={String(row.rank) + '-' + row.full_name} className={row.rank === 1 ? 'border border-amber-500/30 bg-amber-500/5 p-4' : 'p-4'}>
                  <div className="flex items-center gap-2">
                    <Trophy size={17} className={row.rank === 1 ? 'text-amber-500' : 'text-fg-muted'}/>
                    <span className="text-[10px] font-bold uppercase tracking-wider text-fg-muted">{podiumLabel(row.rank)}</span>
                  </div>
                  <p className="mt-3 truncate text-lg font-bold text-fg">{row.full_name}</p>
                  <p className="mt-1 truncate text-xs text-fg-muted">{row.school_name || row.grade || (row.participant_type === 'COLLECTIVE' ? 'Peserta kolektif' : 'Peserta individu')}</p>
                  <p className="mt-3 text-2xl font-extrabold tabular-nums text-fg">{Number(row.score).toLocaleString('id-ID')}</p>
                  <p className="text-[10px] text-fg-muted">Skor akhir</p>
                </Card>
              ))}
            </div>

            <Card className="overflow-hidden">
              <div className="border-b border-border p-4 sm:p-5">
                <h2 className="font-semibold text-fg">Peringkat Peserta</h2>
                <p className="mt-1 text-xs text-fg-muted">Peringkat dihitung dari hasil resmi terakhir. Nilai yang sama memperoleh peringkat yang sama.</p>
              </div>
              <div className="hidden overflow-x-auto sm:block">
                <table className="w-full min-w-[640px] text-left text-sm">
                  <thead className="bg-surface-elevated/50 text-[11px] text-fg-muted">
                    <tr>
                      <th className="px-4 py-3 font-semibold">Peringkat</th>
                      <th className="px-4 py-3 font-semibold">Peserta</th>
                      <th className="px-4 py-3 font-semibold">Jenjang / Sekolah</th>
                      <th className="px-4 py-3 text-right font-semibold">Skor</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-border/70">
                    {results.map((row, index) => (
                      <tr key={String(row.participant_code ?? row.full_name) + '-' + index}>
                        <td className="px-4 py-3 font-bold tabular-nums text-fg">#{row.rank}</td>
                        <td className="px-4 py-3">
                          <p className="font-semibold text-fg">{row.full_name}</p>
                          <p className="mt-0.5 text-[10px] text-fg-muted">{row.participant_type === 'COLLECTIVE' ? 'Peserta kolektif' : 'Peserta individu'}{row.participant_code ? ' · ' + row.participant_code : ''}</p>
                        </td>
                        <td className="px-4 py-3 text-xs text-fg-muted">{[row.grade, row.class_name, row.school_name].filter(Boolean).join(' · ') || '—'}</td>
                        <td className="px-4 py-3 text-right font-bold tabular-nums text-fg">{Number(row.score).toLocaleString('id-ID')}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
              <div className="divide-y divide-border sm:hidden">
                {results.map((row, index) => (
                  <div key={String(row.participant_code ?? row.full_name) + '-' + index} className="flex items-center gap-3 p-4">
                    <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl bg-surface-elevated text-sm font-bold tabular-nums text-fg">#{row.rank}</div>
                    <div className="min-w-0 flex-1">
                      <p className="truncate text-sm font-semibold text-fg">{row.full_name}</p>
                      <p className="mt-0.5 truncate text-[10px] text-fg-muted">{[row.grade, row.class_name, row.school_name].filter(Boolean).join(' · ') || (row.participant_type === 'COLLECTIVE' ? 'Peserta kolektif' : 'Peserta individu')}</p>
                    </div>
                    <p className="shrink-0 text-sm font-bold tabular-nums text-fg">{Number(row.score).toLocaleString('id-ID')}</p>
                  </div>
                ))}
              </div>
            </Card>
            {loadMoreError && <p className="text-center text-xs text-amber-500">{loadMoreError}</p>}
            {results.length < resultCount && (
              <div className="flex justify-center">
                <Button variant="outline" loading={loadingMore} onClick={() => void loadMore()}>Muat lebih banyak peringkat</Button>
              </div>
            )}
          </>
        )}
        <p className="text-center text-[10px] text-fg-muted">Nilai dan peringkat diambil dari hasil resmi SykaBelajar. Attempt simulasi tidak termasuk.</p>
      </div>
    </main>
  );
}
