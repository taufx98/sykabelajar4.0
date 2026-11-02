import { useCallback, useEffect, useRef, useState } from 'react';
import { ArrowLeft, Award, CheckCircle2, Clock3, ExternalLink, Loader2, Medal, Trophy, Users, X } from 'lucide-react';
import { Link, useParams, useSearchParams } from 'react-router-dom';
import { Badge } from '@/components/ui/Badge';
import { Button } from '@/components/ui/Button';
import { Card } from '@/components/ui/Card';
import {
  getCompetitionParticipantDetail,
  getPublicCompetitionResults,
  type CompetitionParticipantDetail,
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

function formatDuration(seconds?: number | null) {
  const value = Math.max(0, Math.floor(Number(seconds ?? 0)));
  const hours = Math.floor(value / 3600);
  const minutes = Math.floor((value % 3600) / 60);
  const remaining = value % 60;
  if (hours > 0) return hours + ' jam ' + minutes + ' menit';
  if (minutes > 0) return minutes + ' menit ' + remaining + ' detik';
  return remaining + ' detik';
}

function podiumLabel(rank: number) {
  if (rank === 1) return 'Juara 1';
  if (rank === 2) return 'Juara 2';
  if (rank === 3) return 'Juara 3';
  return 'Peringkat ' + rank;
}

export function CompetitionResultsPage() {
  const { slug = '' } = useParams<{ slug: string }>();
  const [searchParams, setSearchParams] = useSearchParams();
  const autoDetailRequest = useRef<string | null>(null);
  const [data, setData] = useState<PublicCompetitionResults | null>(null);
  const [results, setResults] = useState<CompetitionResultRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [loadingMore, setLoadingMore] = useState(false);
  const [error, setError] = useState('');
  const [loadMoreError, setLoadMoreError] = useState('');
  const [selectedDetail, setSelectedDetail] = useState<CompetitionParticipantDetail | null>(null);
  const [detailName, setDetailName] = useState('');
  const [detailLoading, setDetailLoading] = useState(false);
  const [detailError, setDetailError] = useState('');

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

  const loadParticipantDetail = useCallback(async (participantId: string, participantName: string) => {
    if (!participantId || detailLoading) return;
    setDetailName(participantName);
    setSelectedDetail(null);
    setDetailError('');
    setDetailLoading(true);
    try {
      setSelectedDetail(await getCompetitionParticipantDetail(slug, participantId));
    } catch (cause) {
      setDetailError(cause instanceof Error ? cause.message : 'Detail peserta gagal dimuat.');
    } finally {
      setDetailLoading(false);
    }
  }, [detailLoading, slug]);

  const openDetail = async (row: CompetitionResultRow) => {
    if (!row.participant_id || detailLoading) return;
    autoDetailRequest.current = row.participant_id;
    setSearchParams((current) => {
      const nextParams = new URLSearchParams(current);
      nextParams.set('participant', row.participant_id!);
      return nextParams;
    });
    await loadParticipantDetail(row.participant_id, row.full_name);
  };

  useEffect(() => {
    const requestedId = searchParams.get('participant');
    if (!data || !requestedId || detailLoading || autoDetailRequest.current === requestedId) return;
    autoDetailRequest.current = requestedId;
    void loadParticipantDetail(requestedId, 'Detail peserta');
  }, [data, detailLoading, loadParticipantDetail, searchParams]);

  const closeDetail = () => {
    if (detailLoading) return;
    setSelectedDetail(null);
    setDetailName('');
    setDetailError('');
    autoDetailRequest.current = null;
    setSearchParams((current) => {
      const nextParams = new URLSearchParams(current);
      nextParams.delete('participant');
      return nextParams;
    }, { replace: true });
  };

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
  const detail = selectedDetail;
  const questionSummary = detail?.question_summary;

  return (
    <>
      <main className="min-h-screen surface-bg px-3 py-6 text-fg-secondary sm:px-5 md:py-10">
        <div className="mx-auto max-w-6xl space-y-5">
          <div className="flex flex-wrap items-center justify-between gap-3">
            <Link to={'/lomba/' + encodeURIComponent(competition.slug)} className="inline-flex items-center gap-2 text-xs text-fg-muted transition hover:text-fg"><ArrowLeft size={14}/>Kembali ke Detail Lomba</Link>
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
                    <Button size="sm" variant="outline" className="mt-3" disabled={!row.participant_id} onClick={() => void openDetail(row)}>Detail Peserta</Button>
                  </Card>
                ))}
              </div>

              <Card className="overflow-hidden">
                <div className="border-b border-border p-4 sm:p-5">
                  <h2 className="font-semibold text-fg">Peringkat Peserta</h2>
                  <p className="mt-1 text-xs text-fg-muted">Peringkat dihitung dari hasil resmi terakhir. Nilai yang sama memperoleh peringkat yang sama. Pilih Detail untuk melihat durasi dan ringkasan jawaban peserta.</p>
                </div>
                <div className="hidden overflow-x-auto sm:block">
                  <table className="w-full min-w-[760px] text-left text-sm">
                    <thead className="bg-surface-elevated/50 text-[11px] text-fg-muted">
                      <tr>
                        <th className="px-4 py-3 font-semibold">Peringkat</th>
                        <th className="px-4 py-3 font-semibold">Peserta</th>
                        <th className="px-4 py-3 font-semibold">Jenjang / Sekolah</th>
                        <th className="px-4 py-3 text-right font-semibold">Skor</th>
                        <th className="px-4 py-3 text-right font-semibold">Rincian</th>
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
                          <td className="px-4 py-3 text-right"><Button size="sm" variant="outline" disabled={!row.participant_id} onClick={() => void openDetail(row)}>Detail</Button></td>
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
                        <p className="mt-1 text-sm font-bold tabular-nums text-fg">{Number(row.score).toLocaleString('id-ID')} <span className="text-[10px] font-normal text-fg-muted">skor</span></p>
                        <Button size="sm" variant="outline" className="mt-2" disabled={!row.participant_id} onClick={() => void openDetail(row)}>Detail Peserta</Button>
                      </div>
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

      {(detailLoading || detail || detailError) && <div className="fixed inset-0 z-[130] flex items-center justify-center bg-slate-950/75 p-3 backdrop-blur-sm" role="presentation" onMouseDown={(event) => { if (event.target === event.currentTarget) closeDetail(); }}>
        <section role="dialog" aria-modal="true" aria-labelledby="participant-detail-title" className="flex max-h-[92dvh] w-full max-w-2xl flex-col overflow-hidden rounded-3xl border border-border bg-card shadow-2xl">
          <div className="flex items-center justify-between gap-3 border-b border-border p-4 sm:p-5">
            <div className="min-w-0"><p className="text-[10px] font-bold uppercase tracking-wider text-accent">Detail hasil peserta</p><h2 id="participant-detail-title" className="mt-1 truncate text-lg font-bold text-fg">{detail?.participant.full_name || detailName}</h2></div>
            <button type="button" onClick={closeDetail} disabled={detailLoading} aria-label="Tutup detail peserta" className="flex h-9 w-9 shrink-0 items-center justify-center rounded-xl border border-border text-fg-muted hover:text-fg"><X size={17}/></button>
          </div>
          <div className="min-h-0 flex-1 overflow-y-auto p-4 sm:p-5">
            {detailLoading ? <div className="flex min-h-48 items-center justify-center gap-2 text-sm text-fg-muted"><Loader2 size={18} className="animate-spin"/>Memuat detail peserta…</div>
              : detailError ? <p className="rounded-xl border border-rose-500/20 bg-rose-500/5 p-4 text-sm text-rose-400">{detailError}</p>
              : detail && !detail.has_result ? <p className="rounded-xl border border-dashed border-border p-5 text-center text-sm text-fg-muted">Hasil final peserta ini belum tersedia.</p>
              : detail && <>
                <div className="grid gap-3 sm:grid-cols-3">
                  <Card className="p-4"><p className="text-[10px] text-fg-muted">Peringkat</p><p className="mt-1 text-2xl font-extrabold text-fg">#{detail.result?.rank ?? '—'}</p></Card>
                  <Card className="p-4"><p className="text-[10px] text-fg-muted">Nilai akhir</p><p className="mt-1 text-2xl font-extrabold tabular-nums text-fg">{Number(detail.result?.score ?? 0).toLocaleString('id-ID')}</p></Card>
                  <Card className="p-4"><p className="flex items-center gap-1 text-[10px] text-fg-muted"><Clock3 size={12}/>Durasi pengerjaan</p><p className="mt-1 text-lg font-bold text-fg">{formatDuration(detail.result?.duration_seconds)}</p></Card>
                </div>
                <div className="mt-4 rounded-2xl border border-border p-4">
                  <div className="mb-3 flex items-center justify-between gap-3"><h3 className="text-sm font-bold text-fg">Ringkasan jawaban</h3><span className="text-[10px] text-fg-muted">{questionSummary?.total ?? 0} soal</span></div>
                  <div className="grid grid-cols-2 gap-2 sm:grid-cols-4">
                    <div className="rounded-xl bg-emerald-500/10 p-3"><p className="text-[10px] text-emerald-500">Benar</p><p className="mt-1 text-xl font-extrabold text-emerald-500">{questionSummary?.correct ?? 0}<span className="text-xs font-medium"> / {questionSummary?.total ?? 0}</span></p></div>
                    <div className="rounded-xl bg-rose-500/10 p-3"><p className="text-[10px] text-rose-400">Salah</p><p className="mt-1 text-xl font-extrabold text-rose-400">{questionSummary?.incorrect ?? 0}</p></div>
                    <div className="rounded-xl bg-amber-500/10 p-3"><p className="text-[10px] text-amber-500">Perlu tinjauan</p><p className="mt-1 text-xl font-extrabold text-amber-500">{questionSummary?.manual_review ?? 0}</p></div>
                    <div className="rounded-xl bg-surface-elevated p-3"><p className="text-[10px] text-fg-muted">Tidak dijawab</p><p className="mt-1 text-xl font-extrabold text-fg">{questionSummary?.unanswered ?? 0}</p></div>
                  </div>
                  <p className="mt-3 text-[10px] leading-relaxed text-fg-muted">Rincian menampilkan jumlah jawaban, bukan isi jawaban atau kunci soal. Soal esai/unggahan yang membutuhkan pemeriksaan manual dipisahkan dari hitungan benar dan salah.</p>
                </div>
                <div className="mt-4 grid gap-4 sm:grid-cols-2">
                  <div className="rounded-2xl border border-border p-4">
                    <h3 className="mb-3 flex items-center gap-2 text-sm font-bold text-fg"><Medal size={15}/>Badge & Penghargaan</h3>
                    {[...(detail.badges ?? []).map((badge) => ({ title: badge.name, description: badge.description || badge.rarity || 'Badge peserta', icon: badge.icon_emoji || '🏅' })), ...(detail.awards ?? []).map((award) => ({ title: award.title, description: '+' + Number(award.points).toLocaleString('id-ID') + ' poin', icon: '🏆' }))].length
                      ? [...(detail.badges ?? []).map((badge) => ({ title: badge.name, description: badge.description || badge.rarity || 'Badge peserta', icon: badge.icon_emoji || '🏅' })), ...(detail.awards ?? []).map((award) => ({ title: award.title, description: '+' + Number(award.points).toLocaleString('id-ID') + ' poin', icon: '🏆' }))].map((award, index) => <div key={award.title + '-' + index} className="flex items-center gap-2 border-b border-border/60 py-2 last:border-0"><span className="text-xl">{award.icon}</span><span className="min-w-0"><strong className="block text-xs text-fg">{award.title}</strong><span className="text-[10px] text-fg-muted">{award.description}</span></span></div>)
                      : <p className="text-xs text-fg-muted">Belum ada badge atau penghargaan yang diterbitkan.</p>}
                  </div>
                  <div className="rounded-2xl border border-border p-4">
                    <h3 className="mb-3 flex items-center gap-2 text-sm font-bold text-fg"><Award size={15}/>Sertifikat & Piagam</h3>
                    {detail.certificates?.length ? detail.certificates.map((certificate, index) => <a key={certificate.serial_number || index} href={certificate.certificate_url} target="_blank" rel="noopener noreferrer" className="flex items-center justify-between gap-2 border-b border-border/60 py-2 text-xs text-accent hover:underline last:border-0"><span><strong className="block text-fg">Sertifikat resmi</strong><span className="text-[10px] text-fg-muted">{certificate.serial_number || formatDate(certificate.issued_at)}</span></span><ExternalLink size={14}/></a>)
                      : <p className="text-xs text-fg-muted">Sertifikat atau piagam belum diterbitkan secara publik.</p>}
                  </div>
                </div>
                <p className="mt-4 text-[10px] text-fg-muted">Hasil ini diambil dari attempt resmi terakhir yang telah difinalisasi oleh sistem.</p>
              </>}
          </div>
          <div className="flex justify-end border-t border-border p-4"><Button variant="outline" onClick={closeDetail} disabled={detailLoading}>Tutup</Button></div>
        </section>
      </div>}
    </>
  );
}
