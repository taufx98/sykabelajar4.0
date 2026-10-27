import { toast } from '@/lib/toast';
import { useEffect, useMemo, useState } from 'react';
import { AtSign, LayoutDashboard, Trophy, Users, ShoppingBag, FileText, Store, Settings, ShieldCheck, Search, Trash2, Plus, Edit3, Package, Eye, EyeOff, Sparkles, Image as ImageIcon } from 'lucide-react';
import { Link, useSearchParams } from 'react-router-dom';
import { supabase } from '@/lib/supabase';
import { Card } from '@/components/ui/Card';
import { Button } from '@/components/ui/Button';
import { Badge } from '@/components/ui/Badge';
import { Avatar } from '@/components/ui/Avatar';
import { AdminUsernameModal } from '@/components/admin/AdminUsernameModal';
import { CompetitionDeleteModal, type CompetitionDeleteBlockers } from '@/components/admin/CompetitionDeleteModal';
import { banUser, deleteCompetition, deletePost, deleteProduct, forceDeleteCompetition, getCompetitionDeleteBlockers, loadAdminCore, saveCompetition, savePost, saveProduct, transitionCompetition } from '@/services/adminCore.service';
import { AdminDashboard } from '@/components/admin/AdminDashboard';
import { ShopProductEditor, type ShopProductDraft } from '@/components/admin/ShopProductEditor';

type CoreAdminTab = 'dashboard' | 'competitions' | 'users' | 'posts' | 'orders' | 'shop' | 'settings';
const tabs: { key: CoreAdminTab; label: string; icon: typeof Trophy }[] = [
  { key: 'dashboard', label: 'Dashboard', icon: LayoutDashboard }, { key: 'competitions', label: 'Lomba', icon: Trophy }, { key: 'users', label: 'Pengguna', icon: Users }, { key: 'posts', label: 'Postingan', icon: FileText }, { key: 'orders', label: 'Pesanan', icon: ShoppingBag }, { key: 'shop', label: 'Shop', icon: Store }, { key: 'settings', label: 'Pengaturan', icon: Settings },
];
const roleLabel: Record<string, string> = { student: 'Pelajar', teacher: 'Guru', organizer_member: 'Penyelenggara', admin: 'Admin' };
const competitionStatuses = ['DRAFT', 'PUBLISHED', 'REGISTRATION_OPEN', 'REGISTRATION_CLOSED', 'LIVE', 'SUBMISSION_CLOSED', 'GRADING', 'RESULT_PUBLISHED', 'ARCHIVED', 'CANCELLED'];

type CompetitionDeleteState = {
  id: string;
  title: string;
  blockers: CompetitionDeleteBlockers | null;
  loading: boolean;
  deleting: boolean;
  error: string | null;
};

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
  const [competitionDelete, setCompetitionDelete] = useState<CompetitionDeleteState | null>(null);
  const [shopSearch, setShopSearch] = useState('');
  const [shopStatus, setShopStatus] = useState<'all' | 'active' | 'inactive' | 'featured'>('all');
  const [shopType, setShopType] = useState<'all' | 'DIGITAL_ITEM' | 'DONATION'>('all');

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
  const userSuggestions = useMemo(() => {
    const q = search.trim().toLowerCase();
    if (!q) return [];
    return users
      .filter(u => String(u.username || '').toLowerCase().startsWith(q))
      .sort((a, b) => String(a.username || '').localeCompare(String(b.username || '')))
      .slice(0, 8);
  }, [users, search]);

  const filteredShopProducts = useMemo(() => {
    const query = shopSearch.trim().toLowerCase();
    return products.filter((product) => {
      const matchesQuery = !query || [product.name, product.code, product.short_description, product.description]
        .some(value => String(value ?? '').toLowerCase().includes(query));
      const matchesStatus = shopStatus === 'all'
        || (shopStatus === 'active' && Boolean(product.is_active))
        || (shopStatus === 'inactive' && !product.is_active)
        || (shopStatus === 'featured' && Boolean(product.is_featured));
      const matchesType = shopType === 'all' || product.product_type === shopType;
      return matchesQuery && matchesStatus && matchesType;
    });
  }, [products, shopSearch, shopStatus, shopType]);

  const activeShopCount = products.filter((product) => Boolean(product.is_active)).length;
  const inactiveShopCount = products.length - activeShopCount;
  const featuredShopCount = products.filter((product) => Boolean(product.is_featured)).length;
  const pendingPaymentReviewCount = orders.filter((order) => order.payment_proof_status === 'SUBMITTED').length;

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
  const saveProductAction = async (draft: ShopProductDraft) => {
    const name = draft.name.trim();
    if (!name) return toast.warning('Nama produk wajib diisi.');
    if (!draft.audiences.length) return toast.warning('Pilih minimal satu kelompok pengguna.');
    if (!['DIGITAL_ITEM', 'DONATION'].includes(draft.product_type)) return toast.warning('Jenis produk ini belum didukung untuk pemesanan Shop.');
    if (!Number.isFinite(draft.price) || draft.price < 0) return toast.warning('Harga harus berupa angka nol atau lebih.');
    if (draft.is_active && draft.price <= 0) return toast.warning('Produk aktif harus memiliki harga di atas Rp0. Alur klaim produk gratis belum tersedia.');

    const toSlug = (value: string) => value.normalize('NFKD').replace(/\p{M}/gu, '').toLowerCase().trim().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 48) || 'produk';
    const token = crypto.randomUUID().replace(/-/g, '').slice(0, 8).toUpperCase();
    const base = toSlug(name);
    const code = draft.code.trim() || `SHOP-${base.toUpperCase()}-${token}`;
    const slug = draft.slug.trim() ? toSlug(draft.slug) : `${base}-${token.toLowerCase()}`;
    const payload: ShopProductDraft = {
      ...draft,
      name,
      code,
      slug,
      short_description: draft.short_description.trim(),
      description: draft.description.trim(),
      image_url: draft.image_url.trim(),
      currency: 'IDR',
      audiences: [...new Set(draft.audiences)],
      metadata: draft.metadata ?? {},
    };

    setBusy(true);
    try {
      const saved = await saveProduct(payload);
      const savedRow = Array.isArray(saved) ? saved[0] : saved;
      if (savedRow && typeof savedRow === 'object') {
        setProducts(rows => draft.id ? rows.map(row => row.id === draft.id ? { ...row, ...savedRow } : row) : [savedRow, ...rows]);
      }
      setProductEditor(null);
      toast.success(draft.id ? 'Perubahan produk berhasil disimpan.' : 'Produk berhasil dibuat.');
      await load();
    } catch (error: any) {
      const raw = String(error?.message ?? '');
      if (raw.includes('commerce_products_code_key')) toast.error('Kode produk ini sudah dipakai. Ubah kode di Identitas produk.');
      else if (raw.includes('commerce_products_slug_key')) toast.error('Tautan pendek ini sudah dipakai. Ubah tautan di Identitas produk.');
      else if (raw.includes('ACTIVE_PRODUCT_PRICE_REQUIRED')) toast.error('Produk yang ditampilkan harus memiliki harga di atas Rp0.');
      else if (raw.includes('PRODUCT_TYPE_NOT_SUPPORTED')) toast.error('Jenis produk ini belum didukung untuk pemesanan Shop.');
      else toast.error(raw || 'Produk gagal disimpan. Periksa kembali isian produk.');
    } finally {
      setBusy(false);
    }
  };

  const openCompetitionDelete = async (id: string) => {
    const competition = competitions.find(row => row.id === id);
    if (!competition) return;
    setCompetitionDelete({ id, title: String(competition.title || 'Lomba'), blockers: null, loading: true, deleting: false, error: null });
    try {
      const blockers = await getCompetitionDeleteBlockers(id);
      setCompetitionDelete(current => current?.id === id ? { ...current, blockers, loading: false } : current);
    } catch (error: any) {
      setCompetitionDelete(current => current?.id === id ? { ...current, loading: false, error: error?.message ?? 'Gagal memeriksa data yang terkait dengan lomba.' } : current);
    }
  };

  const confirmCompetitionDelete = async () => {
    if (!competitionDelete || competitionDelete.loading || competitionDelete.deleting || competitionDelete.error) return;
    const { id, blockers } = competitionDelete;
    setCompetitionDelete(current => current ? { ...current, deleting: true, error: null } : current);
    try {
      const hasBlockers = blockers ? Object.values(blockers).some(value => Number(value) > 0) : false;
      if (hasBlockers) await forceDeleteCompetition(id);
      else await deleteCompetition(id);
      setCompetitionDelete(null);
      setCompetitions(rows => rows.filter(row => row.id !== id));
      toast.success('Lomba berhasil dihapus.');
      await load();
    } catch (error: any) {
      await load();
      setCompetitionDelete(current => current ? { ...current, deleting: false, error: error?.message ?? 'Lomba tidak dapat dihapus. Data tetap dipertahankan.' } : current);
    }
  };

  const removeRow = async (kind: 'competition' | 'post' | 'product', id: string) => {
    if (kind === 'competition') {
      await openCompetitionDelete(id);
      return;
    }

    const confirmMessage = kind === 'product' ? 'Hapus produk ini dari katalog? Pesanan yang sudah tercatat tetap tersimpan, tetapi produk tidak bisa dipesan lagi.' : 'Hapus postingan ini?';
    if (!window.confirm(confirmMessage)) return;
    setBusy(true);
    try {
      if (kind === 'post') await deletePost(id);
      else await deleteProduct(id);
      if (kind === 'post') setPosts(rows => rows.filter(row => row.id !== id));
      else setProducts(rows => rows.filter(row => row.id !== id));
      toast.success('Data berhasil dihapus.');
      await load();
    } catch (error: any) {
      await load();
      toast.error(error?.message ?? 'Data tidak dapat dihapus. Data tetap dipertahankan.');
    } finally {
      setBusy(false);
    }
  };

  const transitionCompetitionAction = async (id: string, status: string) => {
    setCompetitions(rows => rows.map(row => row.id === id ? { ...row, status } : row));
    await run(async () => { const saved = await transitionCompetition(id, status); if (saved) setCompetitions(rows => rows.map(row => row.id === id ? { ...row, ...saved } : row)); }, 'Status lomba diperbarui.', 'Gagal mengubah status lomba.');
  };
  const banUserAction = async (id: string) => {
    if (!window.confirm('Ban user ini?')) return;
    const previous = users.find(row => row.id === id)?.status;
    setUsers(rows => rows.map(row => row.id === id ? { ...row, status: 'BANNED' } : row));
    try { await run(() => banUser(id), 'Pengguna berhasil dibanned.', 'Gagal membanned pengguna.'); } catch { setUsers(rows => rows.map(row => row.id === id ? { ...row, status: previous } : row)); }
  };

  return <div className="min-h-screen surface-bg text-fg-secondary">
    <section className="p-4 md:p-6 max-w-7xl mx-auto"><div className="flex items-center justify-between mb-5"><div><h2 className="font-display text-xl font-bold text-fg">{tabs.find(t => t.key === tab)?.label}</h2><p className="text-[11px] text-slate-500 mt-0.5">Data live Supabase · aksi sensitif tervalidasi server</p></div></div>
      {tab === 'dashboard' && <AdminDashboard />}
      {tab === 'competitions' && <><div className="flex justify-end mb-3"><Button size="sm" icon={<Plus size={14}/>} onClick={() => setCompetitionEditor({ status: 'DRAFT', visibility: 'PUBLIC', category: 'Kompetisi' })}>Tambah Lomba</Button></div><div className="space-y-2">{competitions.map(c => <div key={c.id} className="group flex items-center gap-3 p-4 rounded-xl surface-card-bg border surface-border hover:border-moss-500/20 hover:surface-elevated transition-all cursor-pointer" onClick={() => setCompetitionEditor(c)}><div className="w-11 h-11 rounded-xl bg-moss-500/10 flex items-center justify-center"><Trophy size={18} className="text-accent"/></div><div className="flex-1 min-w-0"><p className="text-sm font-semibold text-fg truncate">{c.title}</p><p className="text-[11px] text-slate-500">{c.slug} · {c.visibility}</p></div><select className="input w-40 text-xs" value={c.status} onClick={e=>e.stopPropagation()} onChange={e=>{e.stopPropagation();void transitionCompetitionAction(c.id,e.target.value)}} disabled={busy}>{competitionStatuses.map(s=><option key={s}>{s}</option>)}</select><div className="flex gap-1 opacity-0 group-hover:opacity-100 transition"><button className="p-2 rounded-lg text-slate-400 hover:text-fg" onClick={e=>{e.stopPropagation();setCompetitionEditor(c)}}><Edit3 size={14}/></button><button className="p-2 rounded-lg text-red-400 hover:bg-red-500/10" onClick={e=>{e.stopPropagation();void removeRow('competition',c.id)}} disabled={busy}><Trash2 size={14}/></button></div></div>)}{!competitions.length&&<Card className="p-8 text-center text-sm text-slate-500">Belum ada lomba.</Card>}</div></>}
      {tab === 'users' && <><div className="relative mb-3"><Search size={15} className="absolute left-3 top-1/2 -translate-y-1/2 text-slate-500"/><input className="input pl-9" value={search} onChange={e=>setSearch(e.target.value)} placeholder="Cari username..."/>{search.trim() && <div className="absolute left-0 right-0 top-full mt-1 z-40 surface-elevated border surface-border rounded-xl shadow-xl overflow-hidden">{userSuggestions.length ? userSuggestions.map(u => <button key={u.id} type="button" onClick={() => setSearch(String(u.username || ''))} className="w-full flex items-center gap-3 px-3 py-2.5 text-left hover:bg-white/5 transition"><Avatar name={u.full_name||u.username||'U'} id={u.id} size={32} src={u.avatar_url||undefined}/><div className="min-w-0 flex-1"><p className="text-xs font-semibold text-fg truncate">@{u.username || '—'}</p><p className="text-[10px] text-slate-500 truncate">{u.full_name || 'Tanpa nama'}{u.institution ? ` · ${u.institution}` : ''}</p></div></button>) : <p className="px-3 py-3 text-xs text-slate-500">Username tidak ditemukan.</p>}</div>}</div><div className="space-y-1.5">{filteredUsers.map(u=><div key={u.id} className="group flex items-center gap-3 p-3 rounded-xl hover:surface-elevated border border-transparent hover:surface-border transition cursor-pointer"><Avatar name={u.full_name||u.username||'U'} id={u.id} size={38} src={u.avatar_url||undefined}/><div className="flex-1 min-w-0"><p className="text-sm font-semibold text-fg truncate">{u.full_name||u.username}</p><p className="text-[11px] text-slate-500 truncate">@{u.username||'—'} · {u.institution||'—'}</p></div><Badge color={u.status==='BANNED'?'err':'default'}>{roleLabel[u.account_type]||u.account_type}</Badge><div className="flex items-center gap-1.5 shrink-0"><Button size="sm" variant="outline" icon={<AtSign size={14}/>} aria-label={`Ganti username ${u.full_name||u.username||'user'}`} onClick={e=>{e.stopPropagation();setUsernameEditor(u)}}>Ganti Username</Button><Button size="sm" variant="danger" onClick={e=>{e.stopPropagation();void banUserAction(u.id)}} disabled={busy}>Ban</Button></div></div>)}</div></>}
      {tab === 'posts' && <><div className="flex justify-end mb-3"><Button size="sm" icon={<Plus size={14}/>} onClick={()=>setPostEditor({status:'PUBLISHED'})}>Tambah Postingan</Button></div><div className="space-y-2">{posts.map(p=><div key={p.id} className="group flex items-center gap-3 p-4 rounded-xl surface-card-bg border surface-border"><div className="flex-1"><p className="text-sm font-semibold text-fg">{p.title}</p><p className="text-[11px] text-slate-500">{p.status}</p></div><button className="p-2 text-red-400" onClick={()=>void removeRow('post',p.id)} disabled={busy}><Trash2 size={14}/></button></div>)}</div></>}
      {tab === 'orders' && <div className="space-y-2">{orders.map(o=><div key={o.id} className="flex items-center gap-3 p-4 rounded-xl surface-card-bg border surface-border"><ShoppingBag size={18}/><div className="flex-1"><p className="text-sm font-semibold text-fg">Order {o.id.slice(0,8)}</p><p className="text-[11px] text-slate-500">{new Date(o.created_at).toLocaleString('id-ID')}</p></div><b>Rp {Number(o.total||0).toLocaleString('id-ID')}</b><Badge>{o.status}</Badge></div>)}</div>}
      {tab === 'shop' && <div className="space-y-5">
        <div className="flex flex-col gap-3 sm:flex-row sm:items-end sm:justify-between">
          <div>
            <p className="text-[10px] font-bold uppercase tracking-[0.18em] text-accent">Katalog SYKABELAJAR</p>
            <h3 className="mt-1 font-display text-xl font-bold text-fg md:text-2xl">Kelola Shop</h3>
            <p className="mt-1 max-w-2xl text-sm leading-6 text-fg-muted">Buat produk yang bisa dipesan pengguna, atur harga, gambar, dan siapa yang boleh melihatnya.</p>
          </div>
          <div className="flex flex-wrap gap-2">
            <Link to="/admin/orders/review"><Button size="sm" variant="outline" icon={<ShoppingBag size={14}/>}>Verifikasi pembayaran{pendingPaymentReviewCount > 0 ? ` (${pendingPaymentReviewCount})` : ''}</Button></Link>
            <Button size="sm" icon={<Plus size={14}/>} onClick={() => setProductEditor({code:'',slug:'',name:'',short_description:'',description:'',product_type:'DIGITAL_ITEM',audiences:['student'],price:0,currency:'IDR',image_url:'',is_active:false,is_featured:false,sort_order:products.length,metadata:{}})}>Tambah produk</Button>
          </div>
        </div>

        <div className="grid grid-cols-2 gap-3 xl:grid-cols-4">
          <Card className="p-3 sm:p-4"><div className="flex items-center gap-3"><span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-xl bg-accent/10 text-accent"><Package size={17}/></span><div className="min-w-0"><p className="text-xs text-fg-muted">Semua produk</p><p className="text-xl font-bold text-fg">{products.length}</p></div></div></Card>
          <Card className="p-3 sm:p-4"><div className="flex items-center gap-3"><span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-xl bg-emerald-500/10 text-emerald-400"><Eye size={17}/></span><div className="min-w-0"><p className="text-xs text-fg-muted">Tampil di Shop</p><p className="text-xl font-bold text-fg">{activeShopCount}</p></div></div></Card>
          <Card className="p-3 sm:p-4"><div className="flex items-center gap-3"><span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-xl bg-amber-500/10 text-amber-400"><Sparkles size={17}/></span><div className="min-w-0"><p className="text-xs text-fg-muted">Produk unggulan</p><p className="text-xl font-bold text-fg">{featuredShopCount}</p></div></div></Card>
          <Card className="p-3 sm:p-4"><div className="flex items-center gap-3"><span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-xl bg-slate-500/10 text-fg-muted"><EyeOff size={17}/></span><div className="min-w-0"><p className="text-xs text-fg-muted">Tersimpan, belum tampil</p><p className="text-xl font-bold text-fg">{inactiveShopCount}</p></div></div></Card>
        </div>

        <Card className="p-3 sm:p-4">
          <div className="grid gap-2 md:grid-cols-[minmax(0,1fr)_180px_180px]">
            <div className="relative">
              <Search size={15} className="absolute left-3 top-1/2 -translate-y-1/2 text-fg-muted"/>
              <input className="input w-full pl-9" value={shopSearch} onChange={(event) => setShopSearch(event.target.value)} placeholder="Cari nama atau keterangan produk..." aria-label="Cari produk"/>
            </div>
            <select className="input w-full" value={shopStatus} onChange={(event) => setShopStatus(event.target.value as typeof shopStatus)} aria-label="Filter tampilan produk">
              <option value="all">Semua status</option><option value="active">Tampil di Shop</option><option value="inactive">Belum ditampilkan</option><option value="featured">Produk unggulan</option>
            </select>
            <select className="input w-full" value={shopType} onChange={(event) => setShopType(event.target.value as typeof shopType)} aria-label="Filter jenis produk">
              <option value="all">Semua jenis</option><option value="DIGITAL_ITEM">Produk digital</option><option value="DONATION">Donasi</option>
            </select>
          </div>
        </Card>

        {products.length === 0
          ? <Card className="p-8 text-center sm:p-12">
              <div className="mx-auto flex h-14 w-14 items-center justify-center rounded-2xl bg-accent/10 text-accent"><Store size={25}/></div>
              <h4 className="mt-4 font-display text-lg font-bold text-fg">Shop masih kosong</h4>
              <p className="mx-auto mt-2 max-w-lg text-sm leading-6 text-fg-muted">Mulai dengan produk digital atau pilihan donasi. Produk baru tidak langsung terlihat oleh pengguna sampai kamu mengaktifkannya.</p>
              <Button className="mt-5" icon={<Plus size={14}/>} onClick={() => setProductEditor({code:'',slug:'',name:'',short_description:'',description:'',product_type:'DIGITAL_ITEM',audiences:['student'],price:0,currency:'IDR',image_url:'',is_active:false,is_featured:false,sort_order:products.length,metadata:{}})}>Buat produk pertama</Button>
            </Card>
          : filteredShopProducts.length === 0
            ? <Card className="p-8 text-center"><Search size={22} className="mx-auto text-fg-muted"/><p className="mt-3 text-sm font-semibold text-fg">Produk tidak ditemukan</p><p className="mt-1 text-xs text-fg-muted">Coba kata pencarian atau filter lainnya.</p></Card>
            : <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-3">
                {filteredShopProducts.map((product: any) => {
                  const audiences = Array.isArray(product.audiences) ? product.audiences : [];
                  const audienceLabels = audiences.map((audience: string) => ({student:'Pelajar',teacher:'Guru',organizer:'Penyelenggara'}[audience] ?? 'Pengguna'));
                  const typeLabel = product.product_type === 'DONATION' ? 'Donasi' : product.product_type === 'DIGITAL_ITEM' ? 'Produk digital' : 'Belum didukung';
                  return <Card key={product.id} className="overflow-hidden border surface-border p-0 transition hover:border-accent/25">
                    <div className="relative flex aspect-[16/8] items-center justify-center bg-surface-elevated/30">
                      {product.image_url
                        ? <img src={product.image_url} alt={product.name} loading="lazy" className="h-full w-full object-cover"/>
                        : <div className="text-center text-fg-muted"><ImageIcon size={25} className="mx-auto mb-2 opacity-70"/><p className="text-xs">Belum ada gambar</p></div>}
                      <div className="absolute left-3 top-3 flex flex-wrap gap-1.5">
                        <Badge color={product.is_active ? 'moss' : 'default'}>{product.is_active ? 'Aktif' : 'Disembunyikan'}</Badge>
                        {product.is_featured && <Badge color="moss"><Sparkles size={11} className="mr-1 inline"/>Unggulan</Badge>}
                      </div>
                    </div>
                    <div className="space-y-3 p-4">
                      <div className="flex items-start justify-between gap-3">
                        <div className="min-w-0"><p className="break-words text-sm font-semibold text-fg">{product.name || 'Tanpa nama'}</p><p className="mt-1 text-xs leading-5 text-fg-muted">{product.short_description || 'Belum ada ringkasan produk.'}</p></div>
                        <span className="shrink-0 rounded-full border surface-border px-2 py-1 text-[10px] text-fg-muted">{typeLabel}</span>
                      </div>
                      <p className="text-xl font-bold text-accent">Rp {Number(product.price || 0).toLocaleString('id-ID')}</p>
                      <div className="flex flex-wrap gap-1.5">
                        {audienceLabels.length ? audienceLabels.map((audience: string) => <span key={audience} className="rounded-full bg-surface-elevated/50 px-2 py-1 text-[10px] text-fg-muted">{audience}</span>) : <span className="text-[10px] text-amber-400">Belum memilih kelompok pengguna</span>}
                      </div>
                      <div className="flex gap-2 border-t surface-border pt-3">
                        <Button size="sm" variant="outline" className="flex-1" icon={<Edit3 size={13}/>} onClick={() => setProductEditor(product)}>Edit produk</Button>
                        <Button size="sm" variant="danger" aria-label={`Hapus ${product.name || 'produk'}`} onClick={() => void removeRow('product', product.id)} disabled={busy}><Trash2 size={14}/></Button>
                      </div>
                    </div>
                  </Card>;
                })}
              </div>}
      </div>}
      {tab === 'settings' && <Card className="p-5"><h3 className="font-semibold text-fg">Pengaturan Platform</h3><p className="text-sm text-fg-muted mt-1">Akses lanjutan tetap tersedia melalui modul admin khusus.</p><Link to="/admin/roles" className="inline-block mt-4"><Button icon={<ShieldCheck size={15}/>}>Role & Akses</Button></Link></Card>}
    </section>
    {usernameEditor&&<AdminUsernameModal user={usernameEditor} onClose={()=>setUsernameEditor(null)} onSaved={username=>{setUsers(rows=>rows.map(row=>row.id===usernameEditor.id?{...row,username}:row));setUsernameEditor(null);}}/>}
    {competitionEditor&&<Editor title={competitionEditor.id?'Edit Lomba':'Tambah Lomba'} onClose={()=>setCompetitionEditor(null)} onSave={()=>void saveCompetitionAction()} busy={busy}><Field label="Judul" value={competitionEditor.title||''} onChange={v=>setCompetitionEditor((x:any)=>({...x,title:v}))}/><Field label="Slug" value={competitionEditor.slug||''} onChange={v=>setCompetitionEditor((x:any)=>({...x,slug:v}))}/><Field label="Kategori" value={competitionEditor.category||''} onChange={v=>setCompetitionEditor((x:any)=>({...x,category:v}))}/></Editor>}
    {postEditor&&<Editor title={postEditor.id?'Edit Postingan':'Tambah Postingan'} onClose={()=>setPostEditor(null)} onSave={()=>void savePostAction()} busy={busy}><Field label="Judul" value={postEditor.title||''} onChange={v=>setPostEditor((x:any)=>({...x,title:v}))}/><Field label="Isi" value={postEditor.body||''} onChange={v=>setPostEditor((x:any)=>({...x,body:v}))} textarea/></Editor>}
    {productEditor&&<ShopProductEditor key={productEditor.id ?? 'new'} product={productEditor} busy={busy} onClose={()=>setProductEditor(null)} onSave={saveProductAction}/>}
    {competitionDelete&&<CompetitionDeleteModal title={competitionDelete.title} blockers={competitionDelete.blockers} loading={competitionDelete.loading} deleting={competitionDelete.deleting} error={competitionDelete.error} onClose={()=>{if(!competitionDelete.deleting)setCompetitionDelete(null);}} onConfirm={()=>void confirmCompetitionDelete()}/>} 
  </div>;
}

function Editor({ title, onClose, onSave, busy, children }: any) { return <div className="fixed inset-0 z-50 bg-black/60 flex items-center justify-center p-4"><div className="w-full max-w-xl max-h-[90vh] overflow-auto rounded-2xl surface-card-bg border surface-border p-5"><div className="flex items-center justify-between mb-4"><h3 className="font-semibold text-fg">{title}</h3><button onClick={onClose}>×</button></div><div className="space-y-3">{children}</div><div className="flex justify-end gap-2 mt-5"><Button variant="ghost" onClick={onClose}>Batal</Button><Button onClick={onSave} disabled={busy}>{busy?'Menyimpan…':'Simpan'}</Button></div></div></div>; }
function Field({ label, value, onChange, textarea, type='text' }: { label: string; value: string; onChange: (v: string) => void; textarea?: boolean; type?: string }) { return <label className="block"><span className="label">{label}</span>{textarea?<textarea className="input min-h-32" value={value} onChange={e=>onChange(e.target.value)}/>:<input className="input" type={type} value={value} onChange={e=>onChange(e.target.value)}/>}</label>; }
