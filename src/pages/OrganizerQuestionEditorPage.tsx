import { toast } from "@/lib/toast";
import { useEffect, useState } from 'react';
import { Link, useParams } from 'react-router-dom';
import { ArrowLeft, Plus, Trash2, Save, FileQuestion } from 'lucide-react';
import { Card } from '@/components/ui/Card';
import { Button } from '@/components/ui/Button';
import { supabase } from '@/lib/supabase';
import { listQuestions, listQuestionOptions, saveQuestion, deleteQuestion } from '@/services/organizer.service';

type Option = { label: string; value: string; is_correct: boolean; display_order: number };

export function OrganizerQuestionEditorPage() {
  const { bankId = '' } = useParams();
  const [bank, setBank] = useState<any>(null);
  const [questions, setQuestions] = useState<any[]>([]);
  const [options, setOptions] = useState<Record<string, Option[]>>({});
  const [editor, setEditor] = useState<any | null>(null);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);

  const load = async () => {
    if (!bankId) return;
    setLoading(true);
    const [{ data: bankData, error: bankError }, qs] = await Promise.all([
      supabase.from('question_banks').select('id,name,description,status').eq('id', bankId).single(),
      listQuestions(bankId),
    ]);
    if (bankError) { toast.error(bankError.message); setLoading(false); return; }
    const os = await listQuestionOptions(qs.map((q: any) => q.id));
    const grouped: Record<string, Option[]> = {};
    os.forEach((o: any) => { (grouped[o.question_id] ||= []).push(o); });
    setBank(bankData); setQuestions(qs); setOptions(grouped); setLoading(false);
  };
  useEffect(() => { void load(); }, [bankId]);

  const newOption = (): Option => ({ label: '', value: '', is_correct: false, display_order: 0 });
  const save = async () => {
    if (!editor?.prompt?.trim()) return;
    setBusy(true);
    try {
      const cleanOptions = (editor.options || []).filter((o: Option) => o.label.trim()).map((o: Option, i: number) => ({ ...o, value: o.value || o.label, display_order: i }));
      if (editor.type === 'multiple-choice' && cleanOptions.length < 2) throw new Error('Pilihan ganda membutuhkan minimal 2 opsi.');
      if (editor.type === 'multiple-choice' && !cleanOptions.some((o: Option) => o.is_correct)) throw new Error('Tentukan minimal satu jawaban benar.');
      await saveQuestion({ id: editor.id, questionBankId: bankId, type: editor.type || 'multiple-choice', prompt: editor.prompt.trim(), points: Number(editor.points || 1), required: editor.required !== false, displayOrder: Number(editor.display_order ?? questions.length), status: editor.status || 'DRAFT', config: editor.config || {}, options: cleanOptions });
      setEditor(null); await load();
    } catch (e: any) { toast.error(e.message); } finally { setBusy(false); }
  };

  const editQuestion = (q: any) => setEditor({ ...q, options: options[q.id] || [] });
  const remove = async (id: string) => {
    if (!confirm('Hapus soal ini?')) return;
    setBusy(true);
    try { await deleteQuestion(id); await load(); } catch (e: any) { toast.error(e.message); } finally { setBusy(false); }
  };

  return <div className="min-h-screen bg-ink-950 text-slate-200 p-5 md:p-8">
    <div className="max-w-5xl mx-auto">
      <Link to="/organizer" className="inline-flex items-center gap-2 text-xs text-slate-500 hover:text-white mb-5"><ArrowLeft size={14}/> Kembali ke Penyelenggara</Link>
      <div className="flex items-center justify-between mb-6">
        <div><p className="text-xs text-moss-400">BANK SOAL LIVE</p><h1 className="text-2xl font-bold text-white">{loading ? 'Memuat…' : bank?.name || 'Bank Soal'}</h1><p className="text-sm text-slate-500 mt-1">Kelola pertanyaan dan kunci jawaban langsung di Supabase.</p></div>
        <Button size="sm" icon={<Plus size={15}/>} onClick={() => setEditor({ type:'multiple-choice', points:1, required:true, status:'DRAFT', options:[newOption(),newOption()] })}>Tambah Soal</Button>
      </div>
      <div className="space-y-3">
        {questions.map((q, index) => <Card key={q.id} className="p-4 flex gap-3 items-start"><div className="w-9 h-9 rounded-lg bg-moss-500/10 flex items-center justify-center shrink-0"><span className="text-sm text-moss-300">{index + 1}</span></div><div className="flex-1"><p className="text-sm text-white whitespace-pre-wrap">{q.prompt}</p><p className="text-xs text-slate-500 mt-2">{q.type} · {q.points} poin · {q.status} · {(options[q.id] || []).length} opsi</p></div><button onClick={() => editQuestion(q)} className="p-2 hover:bg-white/5 rounded-lg"><FileQuestion size={16}/></button><button onClick={() => void remove(q.id)} disabled={busy} className="p-2 text-red-400 hover:bg-red-500/10 rounded-lg"><Trash2 size={16}/></button></Card>)}
        {!questions.length && <Card className="p-10 text-center text-slate-500">Belum ada soal.</Card>}
      </div>
    </div>
    {editor && <div className="fixed inset-0 z-50 bg-black/70 overflow-y-auto p-4"><div className="min-h-full flex items-center justify-center"><Card className="w-full max-w-2xl p-5"><div className="flex justify-between mb-4"><h2 className="font-bold text-white">{editor.id ? 'Edit Soal' : 'Tambah Soal'}</h2><button onClick={() => setEditor(null)}>×</button></div><div className="space-y-3"><div><label className="label">Tipe</label><select className="input" value={editor.type || 'multiple-choice'} onChange={e => setEditor((x:any)=>({...x,type:e.target.value}))}><option value="multiple-choice">Pilihan Ganda</option><option value="short-answer">Jawaban Singkat</option><option value="essay">Esai</option><option value="file-upload">Upload File</option></select></div><div><label className="label">Pertanyaan</label><textarea className="input min-h-[120px]" value={editor.prompt || ''} onChange={e=>setEditor((x:any)=>({...x,prompt:e.target.value}))}/></div><div><label className="label">Poin</label><input className="input" type="number" min="0" value={editor.points ?? 1} onChange={e=>setEditor((x:any)=>({...x,points:Number(e.target.value)}))}/></div>{editor.type === 'multiple-choice' || editor.type === 'short-answer' ? <div><div className="flex justify-between items-center mb-2"><label className="label">Pilihan & Kunci Jawaban</label><Button size="sm" variant="outline" onClick={()=>setEditor((x:any)=>({...x,options:[...(x.options||[]),newOption()]}))}>Tambah opsi</Button></div><div className="space-y-2">{(editor.options || []).map((o: Option, i: number) => <div key={i} className="grid grid-cols-[1fr_1fr_auto_auto] gap-2 items-center"><input className="input" placeholder="Label" value={o.label} onChange={e=>setEditor((x:any)=>({...x,options:x.options.map((z:Option,j:number)=>j===i?{...z,label:e.target.value}:z)}))}/><input className="input" placeholder="Nilai (opsional)" value={o.value} onChange={e=>setEditor((x:any)=>({...x,options:x.options.map((z:Option,j:number)=>j===i?{...z,value:e.target.value}:z)}))}/><label className="text-xs text-slate-400 flex gap-1 items-center"><input type="checkbox" checked={o.is_correct} onChange={e=>setEditor((x:any)=>({...x,options:x.options.map((z:Option,j:number)=>j===i?{...z,is_correct:e.target.checked}:z)}))}/> Benar</label><button className="p-2 text-red-400" onClick={()=>setEditor((x:any)=>({...x,options:x.options.filter((_:Option,j:number)=>j!==i)}))}><Trash2 size={14}/></button></div>)}</div></div>:null}<div className="flex gap-2 justify-end"><Button variant="outline" onClick={()=>setEditor(null)}>Batal</Button><Button loading={busy} onClick={()=>void save()} icon={<Save size={15}/>}>Simpan</Button></div></div></Card></div></div>}
  </div>;
}
