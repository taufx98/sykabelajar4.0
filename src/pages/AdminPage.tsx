import { toast } from '@/lib/toast';
import { useEffect, useMemo, useState } from 'react';
import { AtSign, LayoutDashboard, Trophy, Users, ShoppingBag, FileText, Store, Settings, ShieldCheck, Search, Trash2, Plus, Edit3 } from 'lucide-react';
import { Link, useSearchParams } from 'react-router-dom';
import { supabase } from '@/lib/supabase';
import { Card } from '@/components/ui/Card';
import { Button } from '@/components/ui/Button';
import { Badge } from '@/components/ui/Badge';
import { Avatar } from '@/components/ui/Avatar';
import { AdminUsernameModal } from '@/components/admin/AdminUsernameModal';
import { banUser, deleteCompetition, deletePost, deleteProduct, loadAdminCore, saveCompetition, savePost, saveProduct, transitionCompetition } from '@/services/adminCore.service';
import { AdminDashboard } from '@/components/admin/AdminDashboard';

type CoreAdminTab = 'dashboard' | 'competitions' | 'users' | 'posts' | 'orders' | 'shop' | 'settings';
const tabs: { key: CoreAdminTab; label: string; icon: typeof Trophy }[] = [
  { key: 'dashboard', label: 'Dashboard', icon: LayoutDashboard }, { key: 'competitions', label: 'Lomba', icon: Trophy }, { key: 'users', label: 'Pengguna', icon: Users }, { key: 'posts', label: 'Postingan', icon: FileText }, { key: 'orders', label: 'Pesanan', icon: ShoppingBag }, { key: 'shop', label: 'Shop', icon: Store }, { key: 'settings', label: 'Pengaturan', icon: Settings },
];
const roleLabel: Record<string, string> = { student: 'Pelajar', teacher: 'Guru', organizer_member: 'Penyelenggara', admin: 'Admin' };
const competitionStatuses = ['DRAFT', 'PUBLISHED', 'REGISTRATION_OPEN', 'REGISTRATION_CLOSED', 'LIVE', 'SUBMISSION_CLOSED', 'GRADING', 'RESULT_PUBLISHED', 'ARCHIVED', 'CANCELLED'];

export function AdminPage() {
  const [searchParams, setSearchParams] = useSearchParams();
  const requestedTab = searchParams.get('tab') as CoreAdminTab | null;
  const [tab, setTab] = useState<CoreAdminTab>(tabs.some(t => t.key === requestedTab) ? requestedTab! : 'dashboard');
  const [competitions, setCompetitions] = useState<any[]>([]);
  const [users, setUsers] = useState<any[]>([]);
  const [posts, setPosts] = useState<any[]>([]);
  const [orders, setOrders] = useState<any[]>([]);
  const [products, setProducts] = useState<any[]>([]);
  const [search, setSearch] = useState('');
  const [busy, setBusy] = useState(false);
  const [postEditor, setPostEditor] = useState<any | null>(null);
  const [productEditor, setProductEditor] = useState<any | null>(null);
  const [competitionEditor, setCompetitionEditor] = useState<any | null>(null);
  const [usernameEditor, setUsernameEditor] = useState<any | null>(null);

  useEffect(() => { if (requestedTab && tabs.some(t => t.key === requestedTab)) setTab(requestedTab); }, [requestedTab]);

  const load = async () => {
    try {
      const data = await loadAdminCore();
      setCompetitions(data.competitions); setUsers(data.users); setPosts(data.posts); setOrders(data.orders); setProducts(data.products);
    } catch (error: any) { toast.error(error?.message ?? 'Gagal memuat data Admin.'); }
  };

  useEffect(() => {
    void load();
    const channel = supabase.channel('admin-core-live')
      .on('postgres_changes', { event: '*', schema: 'public', table: 'competitions' }, () => void load())
      .on('postgres_changes', { event: '*', schema: 'public', table: 'profiles' }, () => void load())
      .on('postgres_changes', { event: '*', schema: 'public', table: 'posts' }, () => void load())
      .on('postgres_changes', { event: '*', schema: 'public', table: 'orders' }, () => void load())
      .on('postgres_changes', { event: '*', schema: 'public', table: 'commerce_products' }, () => void load())
      .subscribe(status => { if (status === 'CHANNEL_ERROR') toast.warning('Realtime Admin terputus; data dapat dimuat ulang.'); });
    return () => { void supabase.removeChannel(channel); };
  }, []);

  const selectTab = (next: CoreAdminTab) => { setTab(next); setSearchParams(next === 'dashboard' ? {} : { tab: next }, { replace: true }); };
  const filteredUsers = useMemo(() => users.filter(u => `${u.full_name || ''} ${u.username || ''} ${u.institution || ''}`.toLowerCase().includes(search.toLowerCase())), [users, search]);

  const run = async (action: () => Promise<unknown>, success: string, failure: string) => {
    setBusy(true); try { await action(); toast.success(success); await load(); } catch (error: any) { toast.error(error?.message ?? failure); } finally { setBusy(false); }
  };

  const saveCompetitionAction = async () => {
    if (!competitionEditor?.title || !competitionEditor?.slug) return toast.warning('Judul dan slug lomba wajib diisi.');
    await run(async () => { const saved = await saveCompetition(competitionEditor); if (saved) setCompetitions(rows => competitionEditor.id ? rows.map(row => row.id === competitionEditor.id ? { ...row, ...saved } : row) : [saved, ...rows]); setCompetitionEditor(null); }, competitionEditor.id ? 'Lomba berhasil diperbarui.' : 'Lomba berhasil dibuat.', 'Gagal menyimpan lomba.');
  };
  const savePostAction = async () => {
    if (!postEditor?.title || !postEditor?.body) return toast.warning('Judul dan isi postingan wajib diisi.');
    await run(async () => { const saved = await savePost(postEditor); if (saved) setPosts(rows => postEditor.id ? rows.map(row => row.id === postEditor.id ? { ...row, ...saved } : row) : [saved, ...rows]); setPostEditor(null); }, postEditor.id ? 'Postingan berhasil diperbarui.' : 'Postingan berhasil dibuat.', 'Gagal menyimpan postingan.');
  };
  const saveProductAction = async () => {
    if (!productEditor?.name || !productEditor?.code || !productEditor?.slug) return toast.warning('Nama, kode, dan slug produk wajib diisi.');
    await run(async () => { const saved = await saveProduct(productEditor); if (saved) setProducts(rows => productEditor.id ? rows.map(row => row.id === productEditor.id ? { ...row, ...saved } : row) : [saved, ...rows]); setProductEditor(null); }, productEditor.id ? 'Produk berhasil diperbarui.' : 'Produk berhasil dibuat.', 'Gagal menyimpan produk.');
  };
  const removeRow = async (kind: 'competition' | 'post' | 'product', id: string) => {
    if (!confirm('Hapus data ini?')) return;
    const setter = kind === 'competition' ? setCompetitions : kind === 'post' ? setPosts : setProducts;
    const current = kind === 'competition' ? competitions : kind === 'post' ? posts : products;
    setter(rows => rows.filter(row => row.id !== id));
    await run(async () => { if (kind === 'competition') await deleteCompetition(id); else if (kind === 'post') await deletePost(id); else await deleteProduct(id); }, 'Data berhasil dihapus.', 'Gagal menghapus data.');
    if (busy) setter(() => current);
  };
  const transitionCompetitionAction = async (id: string, status: string) => {
    const previous = competitions.find(row => row.id === id)?.status;
    setCompetitions(rows => rows.map(row => row.id === id ? { ...row, status } : row));
    await run(async () => { const saved = await transitionCompetition(id, status); if (saved) setCompetitions(rows => rows.map(row => row.id === id ? { ...row, ...saved } : row)); }, 'Status lomba diperbarui.', 'Gagal mengubah status lomba.');
    if (previous) setCompetitions(rows => rows.map(row => row.id === id && row.status === status ? row : row));
  };
  const banUserAction = async (id: string) => {
    if (!confirm('Ban user ini?')) return;
    const previous = users.find(row => row.id === id)?.status;
    setUsers(rows => rows.map(row => row.id === id ? { ...row, status: 'BANNED' } : row));
    try { await run(() => banUser(id), 'Pengguna berhasil dibanned.', 'Gagal membanned pengguna.'); } catch { setUsers(rows => rows.map(row => row.id === id ? { ...row, status: previous } : row)); }
  };

  return <div className="min-h-screen surface-bg text-fg-secondary">
    <div className="sticky top-0 z-30 glass border-b surface-border"><div className="px-4 py-3 flex items-center justify-between"><div className="flex items-center gap-3"><Link to="/admin" className="text-xs text-fg-muted hover:text-fg">← Control Center</Link><div><p className="text-[10px] text-accent font-semibold uppercase tracking-wide">SYKABELAJAR</p><h1 className="font-display font-bold text-base text-white">Core Admin</h1></div></div><Badge color="moss">ADMIN</Badge></div><div className="flex gap-1 px-4 pb-2 overflow-x-auto no-scrollbar">{tabs.map(({ key, label, icon: Icon }) => <button key={key} onClick={() => selectTab(key)} className={`flex items-center gap-1.5 px-3 py-2 rounded-lg text-xs font-medium whitespace-nowrap transition ${tab === key ? 'bg-moss-500/15 text-accent' : 'text-slate-500 hover:bg-surface-elevated/50 hover:text-fg-secondary'}`}><Icon size={15} />{label}</button>)}</div></div>
    <section className="p-4 md:p-6 max-w-7xl mx-auto"><div className="flex items-center justify-between mb-5"><div><h2 className="font-display text-xl font-bold text-fg">{tabs.find(t => t.key === tab)?.label}</h2><p className="text-[11px] text-slate-500 mt-0.5">Data live Supabase · aksi sensitif tervalidasi server</p></div></div>
      {tab === 'dashboard' && <AdminDashboard />}
      {tab === 'competitions' && <><div className="flex justify-end mb-3"><Button size="sm" icon={<Plus size={14}/>} onClick={() => setCompetitionEditor({ status: 'DRAFT', visibility: 'PUBLIC', category: 'Kompetisi' })}>Tambah Lomba</Button></div><div className="space-y-2">{competitions.map(c => <div key={c.id} className="group flex items-center gap-3 p-4 rounded-xl surface-card-bg border surface-border hover:border-moss-500/20 hover:surface-elevated transition-all cursor-pointer" onClick={() => setCompetitionEditor(c)}><div className="w-11 h-11 rounded-xl bg-moss-500/10 flex items-center justify-center"><Trophy size={18} className="text-accent"/></div><div className="flex-1 min-w-0"><p className="text-sm font-semibold text-fg truncate">{c.title}</p><p className="text-[11px] text-slate-500">{c.slug} · {c.visibility}</p></div><select className="input w-40 text-xs" value={c.status} onClick={e=>e.stopPropagation()} onChange={e=>{e.stopPropagation();void transitionCompetitionAction(c.id,e.target.value)}} disabled={busy}>{competitionStatuses.map(s=><option key={s}>{s}</option>)}</select><div className="flex gap-1 opacity-0 group-hover:opacity-100 transition"><button className="p-2 rounded-lg text-slate-400 hover:text-fg" onClick={e=>{e.stopPropagation();setCompetitionEditor(c)}}><Edit3 size={14}/></button><button className="p-2 rounded-lg text-red-400 hover:bg-red-500/10" onClick={e=>{e.stopPropagation();void removeRow('competition',c.id)}}><Trash2 size={14}/></button></div></div>)}{!competitions.length&&<Card className="p-8 text-center text-sm text-slate-500">Belum ada lomba.</Card>}</div></>}
      {tab === 'users' && <><div className="relative mb-3"><Search size={15} className="absolute left-3 top-1/2 -translate-y-1/2 text-slate-500"/><input className="input pl-9" value={search} onChange={e=>setSearch(e.target.value)} placeholder="Cari nama, username, atau institusi..."/></div><div className="space-y-1.5">{filteredUsers.map(u=><div key={u.id} className="group flex items-center gap-3 p-3 rounded-xl hover:surface-elevated border border-transparent hover:surface-border transition cursor-pointer"><Avatar name={u.full_name||u.username||'U'} id={u.id} size={38} src={u.avatar_url||undefined}/><div className="flex-1 min-w-0"><p className="text-sm font-semibold text-fg truncate">{u.full_name||u.username}</p><p className="text-[11px] text-slate-500 truncate">@{u.username||'—'} · {u.institution||'—'}</p></div><Badge color={u.status==='BANNED'?'err':'default'}>{roleLabel[u.account_type]||u.account_type}</Badge><div className="flex items-center gap-1.5 shrink-0"><Button size="sm" variant="outline" icon={<AtSign size={14}/>} aria-label={`Ganti username ${u.full_name||u.username||'user'}`} onClick={e=>{e.stopPropagation();setUsernameEditor(u)}}>Ganti Username</Button><Button size="sm" variant="danger" onClick={e=>{e.stopPropagation();void banUserAction(u.id)}} disabled={busy}>Ban</Button></div></div>)}</div></>}
      {tab === 'posts' && <><div className="flex justify-end mb-3"><Button size="sm" icon={<Plus size={14}/>} onClick={()=>setPostEditor({status:'PUBLISHED'})}>Tambah Postingan</Button></div><div className="space-y-2">{posts.map(p=><div key={p.id} className="group flex items-center gap-3 p-4 rounded-xl surface-card-bg border surface-border"><div className="flex-1"><p className="text-sm font-semibold text-fg">{p.title}</p><p className="text-[11px] text-slate-500">{p.status}</p></div><button className="p-2 text-red-400" onClick={()=>void removeRow('post',p.id)}><Trash2 size={14}/></button></div>)}</div></>}
      {tab === 'orders' && <div className="space-y-2">{orders.map(o=><div key={o.id} className="flex items-center gap-3 p-4 rounded-xl surface-card-bg border surface-border"><ShoppingBag size={18}/><div className="flex-1"><p className="text-sm font-semibold text-fg">Order {o.id.slice(0,8)}</p><p className="text-[11px] text-slate-500">{new Date(o.created_at).toLocaleString('id-ID')}</p></div><b>Rp {Number(o.total||0).toLocaleString('id-ID')}</b><Badge>{o.status}</Badge></div>)}</div>}
      {tab === 'shop' && <><div className="flex justify-end mb-3"><Button size="sm" icon={<Plus size={14}/>} onClick={()=>setProductEditor({product_type:'DIGITAL_ITEM',audiences:['student'],price:0,is_active:true,is_featured:false,sort_order:0})}>Tambah Produk</Button></div><div className="grid md:grid-cols-2 gap-3">{products.map(p=><div key={p.id} className="p-4 rounded-xl surface-card-bg border surface-border"><div className="flex items-center gap-3"><Store size={18}/><div className="flex-1"><p className="text-sm font-semibold text-fg">{p.name}</p><p className="text-[11px] text-slate-500">{p.code} · Rp {Number(p.price||0).toLocaleString('id-ID')}</p></div><button className="text-red-400" onClick={()=>void removeRow('product',p.id)}><Trash2 size={14}/></button></div></div>)}</div></>}
      {tab === 'settings' && <Card className="p-5"><h3 className="font-semibold text-fg">Pengaturan Platform</h3><p className="text-sm text-fg-muted mt-1">Akses lanjutan tetap tersedia melalui modul admin khusus.</p><Link to="/admin/roles" className="inline-block mt-4"><Button icon={<ShieldCheck size={15}/>}>Role & Akses</Button></Link></Card>}
    </section>
    {usernameEditor&&<AdminUsernameModal user={usernameEditor} onClose={()=>setUsernameEditor(null)} onSaved={username=>{setUsers(rows=>rows.map(row=>row.id===usernameEditor.id?{...row,username}:row));setUsernameEditor(null);}}/>}
    {competitionEditor&&<Editor title={competitionEditor.id?'Edit Lomba':'Tambah Lomba'} onClose={()=>setCompetitionEditor(null)} onSave={()=>void saveCompetitionAction()} busy={busy}><Field label="Judul" value={competitionEditor.title||''} onChange={v=>setCompetitionEditor((x:any)=>({...x,title:v}))}/><Field label="Slug" value={competitionEditor.slug||''} onChange={v=>setCompetitionEditor((x:any)=>({...x,slug:v}))}/><Field label="Kategori" value={competitionEditor.category||''} onChange={v=>setCompetitionEditor((x:any)=>({...x,category:v}))}/></Editor>}
    {postEditor&&<Editor title={postEditor.id?'Edit Postingan':'Tambah Postingan'} onClose={()=>setPostEditor(null)} onSave={()=>void savePostAction()} busy={busy}><Field label="Judul" value={postEditor.title||''} onChange={v=>setPostEditor((x:any)=>({...x,title:v}))}/><Field label="Isi" value={postEditor.body||''} onChange={v=>setPostEditor((x:any)=>({...x,body:v}))} textarea/></Editor>}
    {productEditor&&<Editor title={productEditor.id?'Edit Produk':'Tambah Produk'} onClose={()=>setProductEditor(null)} onSave={()=>void saveProductAction()} busy={busy}><Field label="Nama" value={productEditor.name||''} onChange={v=>setProductEditor((x:any)=>({...x,name:v}))}/><Field label="Kode Produk" value={productEditor.code||''} onChange={v=>setProductEditor((x:any)=>({...x,code:v}))}/><Field label="Slug" value={productEditor.slug||''} onChange={v=>setProductEditor((x:any)=>({...x,slug:v}))}/></Editor>}
  </div>;
}

function Editor({ title, onClose, onSave, busy, children }: any) { return <div className="fixed inset-0 z-50 bg-black/60 flex items-center justify-center p-4"><div className="w-full max-w-xl max-h-[90vh] overflow-auto rounded-2xl surface-card-bg border surface-border p-5"><div className="flex items-center justify-between mb-4"><h3 className="font-semibold text-fg">{title}</h3><button onClick={onClose}>×</button></div><div className="space-y-3">{children}</div><div className="flex justify-end gap-2 mt-5"><Button variant="ghost" onClick={onClose}>Batal</Button><Button onClick={onSave} disabled={busy}>{busy?'Menyimpan…':'Simpan'}</Button></div></div></div>; }
function Field({ label, value, onChange, textarea, type='text' }: { label: string; value: string; onChange: (v: string) => void; textarea?: boolean; type?: string }) { return <label className="block"><span className="label">{label}</span>{textarea?<textarea className="input min-h-32" value={value} onChange={e=>onChange(e.target.value)}/>:<input className="input" type={type} value={value} onChange={e=>onChange(e.target.value)}/>}</label>; }
