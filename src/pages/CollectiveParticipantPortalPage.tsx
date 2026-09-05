import { useMemo } from 'react';
import { Award, BookOpen, LogOut, MessageCircle, Trophy, UserRound } from 'lucide-react';
import { useNavigate } from 'react-router-dom';
import { Card } from '@/components/ui/Card';
import { Button } from '@/components/ui/Button';
import { Badge } from '@/components/ui/Badge';

export function CollectiveParticipantPortalPage() {
  const navigate = useNavigate();
  const participant = useMemo(() => {
    try { return JSON.parse(sessionStorage.getItem('syka_collective_participant') || 'null'); } catch { return null; }
  }, []);

  if (!participant) {
    navigate('/peserta-kolektif/login', { replace: true });
    return null;
  }

  const logout = () => {
    sessionStorage.removeItem('syka_collective_code');
    sessionStorage.removeItem('syka_collective_password');
    sessionStorage.removeItem('syka_collective_participant');
    navigate('/peserta-kolektif/login', { replace: true });
  };

  const items = [
    { icon: BookOpen, title: 'Lomba Terdaftar', text: 'Lihat lomba dan jadwal yang diberikan guru.' },
    { icon: Trophy, title: 'Peringkat', text: 'Hasil dan peringkat tampil setelah dipublikasikan.' },
    { icon: Award, title: 'Piagam', text: 'Piagam digital akan tersedia setelah dinyatakan berhak.' },
    { icon: MessageCircle, title: 'Chat Group', text: 'Area komunikasi khusus event akan ditampilkan di sini.' },
  ];

  return <div className="min-h-screen surface-bg text-fg-secondary p-5 md:p-8"><div className="max-w-5xl mx-auto space-y-5">
    <div className="flex items-center justify-between gap-4"><div><p className="text-xs text-accent font-semibold tracking-wider">PORTAL PESERTA KOLEKTIF</p><h1 className="text-2xl md:text-3xl font-bold text-fg">Halo, {String(participant.full_name || 'Peserta')}</h1><p className="text-sm text-fg-muted mt-1">Akun kolektif • kode <span className="font-mono text-fg">{participant.participant_code}</span></p></div><Button variant="outline" size="sm" onClick={logout} icon={<LogOut size={14}/>}>Keluar</Button></div>
    <Card className="p-5"><div className="flex flex-col md:flex-row md:items-center gap-4"><div className="w-16 h-16 rounded-2xl overflow-hidden bg-accent/10 flex items-center justify-center text-accent">{participant.photo_url ? <img src={participant.photo_url} alt="" className="w-full h-full object-cover"/> : <UserRound size={28}/>}</div><div className="flex-1"><p className="text-lg font-semibold text-fg">{participant.full_name}</p><p className="text-sm text-fg-muted">{participant.class_name || 'Kelas —'} · {participant.grade || 'Jenjang —'}</p></div><Badge color="moss">AKSES AKTIF</Badge></div></Card>
    <div className="grid md:grid-cols-2 gap-4">{items.map(({icon:Icon,title,text})=><Card key={title} className="p-5"><div className="w-10 h-10 rounded-xl bg-accent/10 text-accent flex items-center justify-center"><Icon size={19}/></div><p className="font-semibold text-fg mt-4">{title}</p><p className="text-sm text-fg-muted mt-1">{text}</p></Card>)}</div>
    <Card className="p-5"><p className="font-semibold text-fg">Profil</p><div className="grid sm:grid-cols-2 gap-3 mt-3 text-sm"><div><span className="text-fg-muted">Kode peserta</span><p className="font-mono text-fg mt-1">{participant.participant_code}</p></div><div><span className="text-fg-muted">Status</span><p className="text-fg mt-1">Aktif</p></div></div></Card>
  </div></div>;
}
