import { toast } from "@/lib/toast";
import { useEffect, useMemo, useState } from 'react';
import { LayoutDashboard, Trophy, Users, ShoppingBag, FileText, Store, Settings, ShieldCheck, Search, Trash2, Plus, Edit3, X, ExternalLink } from 'lucide-react';
import { Link, useSearchParams } from 'react-router-dom';
import { supabase } from '@/lib/supabase';
import { Card } from '@/components/ui/Card';
import { Button } from '@/components/ui/Button';
import { Badge } from '@/components/ui/Badge';
import { Avatar } from '@/components/ui/Avatar';
import {
  banUser,
  deleteCompetition,
  deletePost,
  deleteProduct,
  loadAdminCore,
  saveCompetition,
  savePost,
  saveProduct,
  setUserRole,
  transitionCompetition,
} from '@/services/adminCore.service';
import type { BackendRole } from '@/services/role.service';
import { AdminDashboard } from '@/components/admin/AdminDashboard';

type CoreAdminTab = 'dashboard' | 'competitions' | 'users' | 'posts' | 'orders' | 'shop' | 'settings';
const tabs: { key: CoreAdminTab; label: string; icon: typeof Trophy }[] = [
  { key: 'dashboard', label: 'Dashboard', icon: LayoutDashboard },
  { key: 'competitions', label: 'Lomba', icon: Trophy },
  { key: 'users', label: 'Pengguna', icon: Users },
  { key: 'posts', label: 'Postingan', icon: FileText },
  { key: 'orders', label: 'Pesanan', icon: ShoppingBag },
  { key: 'shop', label: 'Shop', icon: Store },
  { key: 'settings', label: 'Pengaturan', icon: Settings },
];
const roleLabel: Record<string, string> = { student: 'Pelajar', teacher: 'Guru', organizer_member: 'Penyelenggara', admin: 'Admin' };
const competitionStatuses = ['DRAFT', 'PUBLISHED', 'REGISTRATION_OPEN', 'REGISTRATION_CLOSED', 'LIVE', 'SUBMISSION_CLOSED', 'GRADING', 'RESULT_PUBLISHED', 'ARCHIVED', 'CANCELLED'];

export function AdminPage() {
  const [searchParams, setSearchParams] = useSearchParams();
  const requestedTab = searchParams.get('tab') as CoreAdminTab | null;
  const [tab, setTab] = useState<CoreAdminTab>(tabs.some(t => t.key === requestedTab) ? requestedTab! : 'dashboard');
  const [stats, setStats] = useState<Record<string, unknown>>({});
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

  useEffect(() => {
    if (requestedTab && tabs.some(t => t.key === requestedTab)) setTab(requestedTab);
  }, [requestedTab]);

  const load = async () => {
    setBusy(true);
    try {
      const data = await loadAdminCore();
      setStats(data.stats);
      setCompetitions(data.competitions);
      setUsers(data.users);
      setPosts(data.posts);
      setOrders(data.orders);
      setProducts(data.products);
    } catch (error: any) {
      toast.error(error?.message ?? 'Gagal memuat data Admin.');
    } finally {
      setBusy(false);
    }
  };

  useEffect(() => {
    void load();
    const channel = supabase
      .channel('admin-core-live')
      .on('postgres_changes', { event: '*', schema: 'public', table: 'competitions' }, () => { void load(); })
      .on('postgres_changes', { event: '*', schema: 'public', table: 'profiles' }, () => { void load(); })
      .on('postgres_changes', { event: '*', schema: 'public', table: 'posts' }, () => { void load(); })
      .on('postgres_changes', { event: '*', schema: 'public', table: 'orders' }, () => { void load(); })
      .on('postgres_changes', { event: '*', schema: 'public', table: 'commerce_products' }, () => { void load(); })
      .subscribe((status) => {
        if (status === 'CHANNEL_ERROR') toast.warning('Realtime Admin terputus; data tetap dapat dimuat manual.');
      });
    return () => { void supabase.removeChannel(channel); };
  }, []);

  const selectTab = (next: CoreAdminTab) => {
    setTab(next);
    if (next === 'dashboard') setSearchParams({}, { replace: true });
    else setSearchParams({ tab: next }, { replace: true });
  };

  const filteredUsers = useMemo(() => users.filter((u) => `${u.full_name || ''} ${u.username || ''} ${u.institution || ''}`.toLowerCase().includes(search.toLowerCase())), [users, search]);

  const saveCompetitionAction = async () => {
    if (!competitionEditor?.title || !competitionEditor?.slug) {
      toast.warning('Judul dan slug lomba wajib diisi.');
      return;
    }
    setBusy(true);
    try {
      const saved = await saveCompetition(competitionEditor);
      if (competitionEditor.id) setCompetitions((rows) => rows.map((row) => row.id === competitionEditor.id ? { ...row, ...saved } : row));
      else if (saved) setCompetitions((rows) => [saved, ...rows]);
      toast.success(competitionEditor.id ? 'Lomba berhasil diperbarui.' : 'Lomba berhasil dibuat.');
      setCompetitionEditor(null);
    } catch (error: any) {
      toast.error(error?.message ?? 'Gagal menyimpan lomba.');
    } finally { setBusy(false); }
  };

  const savePostAction = async () => {
    if (!postEditor?.title || !postEditor?.body) {
      toast.warning('Judul dan isi postingan wajib diisi.');
      return;
    }
    setBusy(true);
    try {
      const saved = await savePost(postEditor);
      if (postEditor.id) setPosts((rows) => rows.map((row) => row.id === postEditor.id ? { ...row, ...saved } : row));
      else if (saved) setPosts((rows) => [saved, ...rows]);
      toast.success(postEditor.id ? 'Postingan berhasil diperbarui.' : 'Postingan berhasil dibuat.');
      setPostEditor(null);
    } catch (error: any) {
      toast.error(error?.message ?? 'Gagal menyimpan postingan.');
    } finally { setBusy(false); }
  };

  const saveProductAction = async () => {
    if (!productEditor?.name || !productEditor?.code || !productEditor?.slug) {
      toast.warning('Nama, kode, dan slug produk wajib diisi.');
      return;
    }
    setBusy(true);
    try {
      const saved = await saveProduct(productEditor);
      if (productEditor.id) setProducts((rows) => rows.map((row) => row.id === productEditor.id ? { ...row, ...saved } : row));
      else if (saved) setProducts((rows) => [saved, ...rows]);
      toast.success(productEditor.id ? 'Produk berhasil diperbarui.' : 'Produk berhasil dibuat.');
      setProductEditor(null);
    } catch (error: any) {
      toast.error(error?.message ?? 'Gagal menyimpan produk.');
    } finally { setBusy(false); }
  };

  const removeRow = async (kind: 'competition' | 'post' | 'product', id: string) => {
    if (!confirm('Hapus data ini?')) return;
    setBusy(true);
    const rollback = kind === 'competition' ? competitions : kind === 'post' ? posts : products;
    if (kind === 'competition') setCompetitions((rows) => rows.filter((row) => row.id !== id));
    if (kind === 'post') setPosts((rows) => rows.filter((row) => row.id !== id));
    if (kind === 'product') setProducts((rows) => rows.filter((row) => row.id !== id));
    try {
      if (kind === 'competition') await deleteCompetition(id);
      else if (kind === 'post') await deletePost(id);
      else await deleteProduct(id);
      toast.success('Data berhasil dihapus.');
    } catch (error: any) {
      if (kind === 'competition') setCompetitions(rollback);
      if (kind === 'post') setPosts(rollback);
      if (kind === 'product') setProducts(rollback);
      toast.error(error?.message ?? 'Gagal menghapus data.');
    } finally { setBusy(false); }
  };

  const transitionCompetitionAction = async (id: string, status: string) => {
    const previous = competitions.find((row) => row.id === id)?.status;
    setCompetitions((rows) => rows.map((row) => row.id === id ? { ...row, status } : row));
    setBusy(true);
    try {
      const saved = await transitionCompetition(id, status);
      if (saved) setCompetitions((rows) => rows.map((row) => row.id === id ? { ...row, ...saved } : row));
      toast.success('Status lomba diperbarui.');
    } catch (error: any) {
      setCompetitions((rows) => rows.map((row) => row.id === id ? { ...row, status: previous } : row));
      toast.error(error?.message ?? 'Gagal mengubah status lomba.');
    } finally { setBusy(false); }
  };

  const banUserAction = async (id: string) => {
    if (!confirm('Ban user ini?')) return;
    const previous = users.find((row) => row.id === id)?.status;
    setUsers((rows) => rows.map((row) => row.id === id ? { ...row, status: 'BANNED' } : row));
    setBusy(true);
    try {
      const saved = await banUser(id);
      if (saved) setUsers((rows) => rows.map((row) => row.id === id ? { ...row, ...saved } : row));
      toast.success('Pengguna berhasil dibanned.');
    } catch (error: any) {
      setUsers((rows) => rows.map((row) => row.id === id ? { ...row, status: previous } : row));
      toast.error(error?.message ?? 'Gagal membanned pengguna.');
    } finally { setBusy(false); }
  };

  const setRole = async (id: string, role: BackendRole) => {
    setBusy(true);
    try {
      const saved = await setUserRole(id, role);
      if (saved) setUsers((rows) => rows.map((row) => row.id === id ? { ...row, role: saved.role ?? role, account_type: role === 'teacher' ? 'teacher' : role === 'organizer_member' ? 'organizer' : role === 'admin' ? 'admin' : 'student' } : row));
      toast.success('Role pengguna diperbarui.');
    } catch (error: any) {
      toast.error(error?.message ?? 'Gagal memperbarui role.');
    } finally { setBusy(false); }
  };

  return (
    <div className="min-h-screen surface-bg text-fg-secondary">
      <div className="sticky top-0 z-30 glass border-b surface-border">
        <div className="px-4 py-3 flex items-center justify-between">
          <div className="flex items-center gap-3">
            <Link to="/admin" className="text-xs text-fg-muted hover:text-fg">← Control Center</Link>
            <div><p className="text-[10px] text-accent font-semibold uppercase tracking-wide">SYKABELAJAR</p><h1 className="font-display font-bold text-base text-white">Core Admin</h1></div>
          </div>
          <Badge color="moss">ADMIN</Badge>
        </div>
        <div className="flex gap-1 px-4 pb-2 overflow-x-auto no-scrollbar">
          {tabs.map(({ key, label, icon: Icon }) => <button key={key} onClick={() => selectTab(key)} className={`flex items-center gap-1.5 px-3 py-2 rounded-lg text-xs font-medium whitespace-nowrap transition ${tab === key ? 'bg-moss-500/15 text-accent' : 'text-slate-500 hover:bg-surface-elevated/50 hover:text-fg-secondary'}`}><Icon size={15} />{label}</button>)}
        </div>
      </div>
      <section className="p-4 md:p-6 max-w-7xl mx-auto">
        <div className="flex items-center justify-between mb-5"><div><h2 className="font-display text-xl font-bold text-fg">{tabs.find((t) => t.key === tab)?.label}</h2><p className="text-[11px] text-slate-500 mt-0.5">Data live Supabase · aksi sensitif tervalidasi server</p></div></div>
        {tab === 'dashboard' && <AdminDashboard />}
        {tab === 'competitions' && <><div className="flex justify-end mb-3"><Button size="sm" icon={<Plus size={14}/>} onClick={() => setCompetitionEditor({ status: 'DRAFT', visibility: 'PUBLIC', category: 'Kompetisi' })}>Tambah Lomba</Button></div><div className="space-y-2">{competitions.map((c) => <div key={c.id} className="group flex items-center gap-3 p-4 rounded-xl surface-card-bg border surface-border hover:border-moss-500/20 hover:surface-elevated transition-all cursor-pointer" onClick={() => setCompetitionEditor(c)}><div className="w-11 h-11 rounded-xl bg-moss-500/10 flex items-center justify-center"><Trophy size={18} className="text-accent"/></div><div className="flex-1 min-w-0"><p className="text-sm font-semibold text-fg truncate">{c.title}</p><p className="text-[11px] text-slate-500">{c.slug} · {c.visibility}</p></div><select className="input w-40 text-xs" value={c.status} onClick={e=>e.stopPropagation()} onChange={e=>{e.stopPropagation();void transitionCompetitionAction(c.id,e.target.value)}} disabled={busy}>{competitionStatuses.map(s=><option key={s}>{s}</option>)}</select><div className="flex gap-1 opacity-0 group-hover:opacity-100 transition"><button className="p-2 rounded-lg text-slate-400 hover:text-fg" onClick={e=>{e.stopPropagation();setCompetitionEditor(c)}}><Edit3 size={14}/></button><button className="p-2 rounded-lg text-red-400 hover:bg-red-500/10" onClick={e=>{e.stopPropagation();void removeRow('competition',c.id)}}><Trash2 size={14}/></button></div></div>)}{!competitions.length&&<Card className="p-8 text-center text-sm text-slate-500">Belum ada lomba.</Card>}</div></>}
        {tab === 'users' && <><div className="relative mb-3"><Search size={15} className="absolute left-3 top-1/2 -translate-y-1/2 text-slate-500"/><input className="input pl-9" value={search} onChange={e=>setSearch(e.target.value)} placeholder="Cari nama, username, atau institusi..."/></div><div className="space-y-1.5">{filteredUsers.map((u)=><div key={u.id} className="group flex items-center gap-3 p-3 rounded-xl hover:surface-elevated border border-transparent hover:surface-border transition cursor-pointer" onClick={()=>window.open(`/profile/@${u.username}`,'_blank')}><Avatar name={u.full_name||u.username||'U'} id={u.id} size={38} src={u.avatar_url||undefined}/><div className="flex-1 min-w-0"><p className="text-sm font-semibold text-fg truncate">{u.full_name||u.username}</p><p className="text-[11px] text-slate-500 truncate">@{u.username||'—'} · {u.institution||'—'}</p></div><Badge color={u.status==='BANNED'?'err':'default'}>{roleLabel[u.account_type]||u.account_type}</Badge><div className="flex gap-1 opacity-0 group-hover:opacity-100 transition"><Link to={`/profile/@${u.username}`} className="p-2 rounded-lg hover:bg-surface-elevated/50 text-slate-400 hover:text-accent" onClick={e=>e.stopPropagation()}><ExternalLink size={14}/></Link><Button size="sm" variant="danger" onClick={e=>{e.stopPropagation();void banUserAction(u.id)}} disabled={busy}>Ban</Button></div></div>)}</div></>}
        {tab === 'posts' && <><div className="flex justify-end mb-3"><Button size="sm" icon={<Plus size={14}/>} onClick={()=>setPostEditor({status:'PUBLISHED'})}>Tambah Postingan</Button></div><div className="space-y-2">{posts.map(p=><div key={p.id} className="group flex items-center gap-3 p-4 rounded-xl surface-card-bg border surface-border hover:surface-elevated transition cursor-pointer" onClick={()=>setPostEditor(p)}><div className="w-11 h-11 rounded-xl bg-blue-500/10 flex items-center justify-center"><FileText size={18} className="text-blue-400"/></div><div className="flex-1 min-w-0"><div className="flex items-center gap-2"><p className="text-sm font-semibold text-fg truncate">{p.title}</p><Badge>{p.status}</Badge></div><p className="text-[11px] text-slate-500 mt-0.5 line-clamp-1">{p.body}</p></div><div className="flex gap-1 opacity-0 group-hover:opacity-100 transition"><button className="p-2 rounded-lg hover:bg-surface-elevated/50 text-slate-400" onClick={e=>{e.stopPropagation();setPostEditor(p)}}><Edit3 size={14}/></button><button className="p-2 rounded-lg text-red-400 hover:bg-red-500/10" onClick={e=>{e.stopPropagation();void removeRow('post',p.id)}}><Trash2 size={14}/></button></div></div>)}{!posts.length&&<Card className="p-8 text-center text-sm text-slate-500">Belum ada postingan.</Card>}</div></>}
        {tab === 'orders' && <div className="space-y-2">{orders.map(o=><div key={o.id} className="flex items-center gap-3 p-4 rounded-xl surface-card-bg border surface-border"><div className="w-11 h-11 rounded-xl bg-amber-500/10 flex items-center justify-center"><ShoppingBag size={18} className="text-amber-400"/></div><div className="flex-1 min-w-0"><p className="text-sm font-semibold text-fg">Order {o.id.slice(0,8)}</p><p className="text-[11px] text-slate-500">{new Date(o.created_at).toLocaleString('id-ID')}</p>{o.payment_proof_status==='SUBMITTED'&&<p className="text-[11px] text-amber-400 mt-0.5">Bukti pembayaran menunggu review</p>}</div><b className="text-sm text-white tabular-nums">Rp {Number(o.total||0).toLocaleString('id-ID')}</b><Badge color={o.status==='COMPLETED'?'moss':o.status==='PENDING_PAYMENT'?'warn':'default'}>{o.status}</Badge></div>)}{!orders.length&&<Card className="p-8 text-center text-sm text-slate-500">Belum ada order.</Card>}</div>}
        {tab === 'shop' && <><div className="flex justify-end mb-3"><Button size="sm" icon={<Plus size={14}/>} onClick={()=>setProductEditor({product_type:'DIGITAL_ITEM',audiences:['student'],price:0,is_active:true,is_featured:false,sort_order:0})}>Tambah Produk</Button></div><div className="grid md:grid-cols-2 gap-3">{products.map(p=><div key={p.id} className="group p-4 rounded-xl surface-card-bg border surface-border hover:surface-elevated transition cursor-pointer" onClick={()=>setProductEditor(p)}><div className="flex gap-3"><div className="w-11 h-11 rounded-xl bg-purple-500/10 flex items-center justify-center shrink-0"><Store size={18} className="text-purple-400"/></div><div className="flex-1 min-w-0"><p className="text-sm font-semibold text-fg truncate">{p.name}</p><p className="text-[11px] text-slate-500">{p.code} · {p.product_type}</p><p className="text-accent font-bold text-sm mt-1">Rp {Number(p.price||0).toLocaleString('id-ID')}</p></div><div className="flex gap-1 opacity-0 group-hover:opacity-100 transition"><button className="p-1.5 rounded-lg text-slate-400 hover:text-fg" onClick={e=>{e.stopPropagation();setProductEditor(p)}}><Edit3 size={13}/></button><button className="p-1.5 rounded-lg text-red-400 hover:bg-red-500/10" onClick={e=>{e.stopPropagation();void removeRow('product',p.id)}}><Trash2 size={13}/></button></div></div><div className="flex items-center gap-2 mt-2"><span className={`text-[10px] px-2 py-0.5 rounded-full ${p.is_active?'bg-moss-500/10 text-accent':'bg-slate-500/10 text-slate-500'}`}>{p.is_active?'Aktif':'Nonaktif'}</span>{p.is_featured&&<span className="text-[10px] px-2 py-0.5 rounded-full bg-amber-500/10 text-amber-400">Featured</span>}</div></div>)}</div></>}
        {tab === 'settings' && <div className="space-y-3"><Card className="p-5"><h3 className="font-semibold text-fg">Pengaturan Platform</h3><p className="text-sm text-fg-muted mt-1">Akses lanjutan tetap tersedia melalui modul admin khusus.</p><Link to="/admin/roles" className="inline-block mt-4"><Button icon={<ShieldCheck size={15}/>}>Role & Akses</Button></Link></Card></div>}
      </section>
      {competitionEditor&&<Editor title={competitionEditor.id?'Edit Lomba':'Tambah Lomba'} onClose={()=>setCompetitionEditor(null)} onSave={()=>void saveCompetitionAction()} busy={busy}><Field label="Judul" value={competitionEditor.title||''} onChange={v=>setCompetitionEditor((x:any)=>({...x,title:v}))}/><Field label="Slug" value={competitionEditor.slug||''} onChange={v=>setCompetitionEditor((x:any)=>({...x,slug:v}))}/><Field label="Kategori" value={competitionEditor.category||''} onChange={v=>setCompetitionEditor((x:any)=>({...x,category:v}))}/><Field label="Deskripsi singkat" value={competitionEditor.short_description||''} onChange={v=>setCompetitionEditor((x:any)=>({...x,short_description:v}))}/><Field label="Poster URL" value={competitionEditor.poster_url||''} onChange={v=>setCompetitionEditor((x:any)=>({...x,poster_url:v}))}/><div className="grid md:grid-cols-2 gap-3"><Field label="Mulai registrasi" type="datetime-local" value={competitionEditor.registration_starts_at?.slice(0,16)||''} onChange={v=>setCompetitionEditor((x:any)=>({...x,registration_starts_at:v?new Date(v).toISOString():null}))}/><Field label="Selesai registrasi" type="datetime-local" value={competitionEditor.registration_ends_at?.slice(0,16)||''} onChange={v=>setCompetitionEditor((x:any)=>({...x,registration_ends_at:v?new Date(v).toISOString():null}))}</div></Editor>}
      {postEditor&&<Editor title={postEditor.id?'Edit Postingan':'Tambah Postingan'} onClose={()=>setPostEditor(null)} onSave={()=>void savePostAction()} busy={busy}><Field label="Judul" value={postEditor.title||''} onChange={v=>setPostEditor((x:any)=>({...x,title:v}))}/><Field label="Isi" value={postEditor.body||''} onChange={v=>setPostEditor((x:any)=>({...x,body:v}))} textarea/><Field label="Cover URL" value={postEditor.cover_url||''} onChange={v=>setPostEditor((x:any)=>({...x,cover_url:v}))}/><div><label className="label">Status</label><select className="input" value={postEditor.status||'PUBLISHED'} onChange={e=>setPostEditor((x:any)=>({...x,status:e.target.value}))}><option>DRAFT</option><option>PUBLISHED</option><option>HIDDEN</option><option>ARCHIVED</option></select></div></Editor>}
      {productEditor&&<Editor title={productEditor.id?'Edit Produk':'Tambah Produk'} onClose={()=>setProductEditor(null)} onSave={()=>void saveProductAction()} busy={busy}><Field label="Nama" value={productEditor.name||''} onChange={v=>setProductEditor((x:any)=>({...x,name:v}))}/><Field label="Kode Produk" value={productEditor.code||''} onChange={v=>setProductEditor((x:any)=>({...x,code:v}))}/><Field label="Slug" value={productEditor.slug||''} onChange={v=>setProductEditor((x:any)=>({...x,slug:v}))}/><Field label="Harga (Rupiah)" value={String(productEditor.price ?? 0)} onChange={v=>setProductEditor((x:any)=>({...x,price:Number(v.replace(/[^0-9]/g,''))}))}/><Field label="Image URL" value={productEditor.image_url||''} onChange={v=>setProductEditor((x:any)=>({...x,image_url:v}))}/><div className="flex gap-4 text-xs"><label className="flex items-center gap-2 cursor-pointer"><input type="checkbox" checked={!!productEditor.is_active} onChange={e=>setProductEditor((x:any)=>({...x,is_active:e.target.checked}))}/> Aktif</label><label className="flex items-center gap-2 cursor-pointer"><input type="checkbox" checked={!!productEditor.is_featured} onChange={e=>setProductEditor((x:any)=>({...x,is_featured:e.target.checked}))}/> Featured</label></div></Editor>}
    </div>
  );
}

function Editor({ title, children, onClose, onSave, busy }: { title: string; children: React.ReactNode; onClose: () => void; onSave: () => void; busy: boolean }) {
  return <div className="fixed inset-0 z-50 bg-black/70 backdrop-blur-sm flex items-center justify-center p-4"><div className="w-full max-w-2xl max-h-[90vh] overflow-auto surface-card-bg border surface-border rounded-2xl shadow-2xl p-6"><div className="flex justify-between items-center mb-5"><h3 className="font-display font-bold text-lg text-fg">{title}</h3><button onClick={onClose} className="p-2 rounded-lg hover:bg-surface-elevated/50 text-slate-400 hover:text-fg"><X size={18}/></button></div><div className="space-y-4">{children}</div><div className="flex justify-end gap-2 mt-6 pt-4 border-t surface-border"><Button variant="outline" onClick={onClose}>Batal</Button><Button onClick={onSave} loading={busy}>Simpan</Button></div></div></div>;
}

function Field({ label, value, onChange, type = 'text', textarea = false }: { label: string; value: string; onChange: (value: string) => void; type?: string; textarea?: boolean }) {
  return <div><label className="text-xs text-slate-400 font-medium mb-1.5 block">{label}</label>{textarea?<textarea className="input min-h-28 focus:border-moss-500/50 focus:ring-1 focus:ring-moss-500/20" value={value} onChange={e=>onChange(e.target.value)}/>:<input className="input focus:border-moss-500/50 focus:ring-1 focus:ring-moss-500/20" type={type} value={value} onChange={e=>onChange(e.target.value)}/>}</div>;
}
