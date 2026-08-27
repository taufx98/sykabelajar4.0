import { useEffect, useMemo, useState } from 'react';
import { LayoutDashboard, Trophy, Users, ShoppingBag, FileText, Store, Settings, ShieldCheck, Search, Trash2, Plus, Edit3, X } from 'lucide-react';
import { Link } from 'react-router-dom';
import { supabase } from '@/lib/supabase';
import { Card } from '@/components/ui/Card';
import { Button } from '@/components/ui/Button';
import { Badge } from '@/components/ui/Badge';
import { Avatar } from '@/components/ui/Avatar';
import { adminSetUserRole, type BackendRole } from '@/services/role.service';

type AdminTab = 'dashboard' | 'competitions' | 'users' | 'roles' | 'posts' | 'orders' | 'shop' | 'banners' | 'settings';
const tabs: { key: AdminTab; label: string; icon: typeof Trophy }[] = [
  { key: 'dashboard', label: 'Dashboard', icon: LayoutDashboard },
  { key: 'competitions', label: 'Lomba', icon: Trophy },
  { key: 'users', label: 'Pengguna', icon: Users },
  { key: 'roles', label: 'Roles', icon: ShieldCheck },
  { key: 'posts', label: 'Postingan', icon: FileText },
  { key: 'orders', label: 'Pesanan', icon: ShoppingBag },
  { key: 'shop', label: 'Shop', icon: Store },
  { key: 'banners', label: 'Banner Iklan', icon: Megaphone },
  { key: 'settings', label: 'Pengaturan', icon: Settings },
];
const roleLabel: Record<string, string> = { student: 'Pelajar', teacher: 'Guru', organizer_member: 'Penyelenggara', admin: 'Admin' };
const competitionStatuses = ['DRAFT', 'PUBLISHED', 'REGISTRATION_OPEN', 'REGISTRATION_CLOSED', 'LIVE', 'SUBMISSION_CLOSED', 'GRADING', 'RESULT_PUBLISHED', 'ARCHIVED', 'CANCELLED'];

export function AdminPage() {
  const [tab, setTab] = useState<AdminTab>('dashboard');
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

  const load = async () => {
    const [s, c, u, p, o, pr] = await Promise.all([
      supabase.rpc('get_platform_stats'),
      supabase.from('competitions').select('*').order('created_at', { ascending: false }),
      supabase.from('profiles').select('id,username,full_name,institution,avatar_url,status,account_type').order('created_at', { ascending: false }),
      supabase.from('posts').select('id,title,body,cover_url,status,competition_id,created_at,author_user_id').order('created_at', { ascending: false }),
      supabase.from('orders').select('id,user_id,status,total,payment_proof_url,payment_proof_status,created_at').order('created_at', { ascending: false }),
      supabase.from('commerce_products').select('*').order('sort_order'),
    ]);
    setStats(s.data?.[0] || {});
    setCompetitions(c.data || []);
    setUsers(u.data || []);
    setPosts(p.data || []);
    setOrders(o.data || []);
    setProducts(pr.data || []);
  };

  useEffect(() => { void load(); }, []);

  const filteredUsers = useMemo(() => users.filter((u) => `${u.full_name || ''} ${u.username || ''} ${u.institution || ''}`.toLowerCase().includes(search.toLowerCase())), [users, search]);

  const saveCompetition = async () => {
    if (!competitionEditor?.title || !competitionEditor?.slug) return;
    setBusy(true);
    const payload = {
      title: competitionEditor.title,
      slug: competitionEditor.slug,
      short_description: competitionEditor.short_description || null,
      description: competitionEditor.description || null,
      category: competitionEditor.category || 'Kompetisi',
      poster_url: competitionEditor.poster_url || null,
      visibility: competitionEditor.visibility || 'PUBLIC',
      status: competitionEditor.status || 'DRAFT',
      registration_starts_at: competitionEditor.registration_starts_at || null,
      registration_ends_at: competitionEditor.registration_ends_at || null,
      starts_at: competitionEditor.starts_at || null,
      ends_at: competitionEditor.ends_at || null,
      juknis_url: competitionEditor.juknis_url || null,
      kisi_kisi_published: !!competitionEditor.kisi_kisi_published,
      kisi_kisi_content: competitionEditor.kisi_kisi_content || null,
    };
    const result = competitionEditor.id
      ? await supabase.from('competitions').update(payload).eq('id', competitionEditor.id)
      : await supabase.from('competitions').insert(payload);
    setBusy(false);
    if (result.error) { alert(result.error.message); return; }
    setCompetitionEditor(null); await load();
  };

  const savePost = async () => {
    if (!postEditor?.title || !postEditor?.body) return;
    setBusy(true);
    const payload = { title: postEditor.title, body: postEditor.body, cover_url: postEditor.cover_url || null, competition_id: postEditor.competition_id || null, status: postEditor.status || 'PUBLISHED' };
    const result = postEditor.id ? await supabase.from('posts').update(payload).eq('id', postEditor.id) : await supabase.from('posts').insert(payload);
    setBusy(false);
    if (result.error) { alert(result.error.message); return; }
    setPostEditor(null); await load();
  };

  const saveProduct = async () => {
    if (!productEditor?.name || !productEditor?.code || !productEditor?.slug) return;
    setBusy(true);
    const payload = {
      code: productEditor.code,
      slug: productEditor.slug,
      name: productEditor.name,
      short_description: productEditor.short_description || null,
      description: productEditor.description || null,
      product_type: productEditor.product_type || 'DIGITAL_ITEM',
      audiences: productEditor.audiences || ['student'],
      price: Number(productEditor.price || 0),
      currency: 'IDR',
      image_url: productEditor.image_url || null,
      is_active: !!productEditor.is_active,
      is_featured: !!productEditor.is_featured,
      sort_order: Number(productEditor.sort_order || 0),
      metadata: productEditor.metadata || {},
    };
    const result = productEditor.id ? await supabase.from('commerce_products').update(payload).eq('id', productEditor.id) : await supabase.from('commerce_products').insert(payload);
    setBusy(false);
    if (result.error) { alert(result.error.message); return; }
    setProductEditor(null); await load();
  };

  const removeRow = async (table: string, id: string) => {
    if (!confirm('Hapus data ini?')) return;
    setBusy(true);
    const result = await supabase.from(table as any).delete().eq('id', id);
    setBusy(false);
    if (result.error) alert(result.error.message); else await load();
  };

  const transitionCompetition = async (id: string, status: string) => {
    setBusy(true);
    const { error } = await supabase.rpc('transition_competition', { p_competition_id: id, p_to_status: status, p_reason: 'Admin panel' });
    setBusy(false);
    if (error) alert(error.message); else await load();
  };

  const setRole = async (id: string, role: BackendRole) => {
    setBusy(true);
    try { await adminSetUserRole(id, role, true, 'Admin panel'); await load(); }
    catch (e: any) { alert(e.message); }
    finally { setBusy(false); }
  };

  return (
    <div className="min-h-screen bg-ink-950 text-slate-200">
      <div className="sticky top-0 z-30 glass border-b border-white/5">
        <div className="px-4 py-3 flex items-center justify-between">
          <div className="flex items-center gap-3">
            <Link to="/home" className="p-2 rounded-lg hover:bg-white/5 text-slate-400 hover:text-white text-xs">← Kembali</Link>
            <div><p className="text-[10px] text-moss-400 font-semibold uppercase tracking-wide">SYKABELAJAR</p><h1 className="font-display font-bold text-base text-white leading-tight">Panel Admin</h1></div>
          </div>
          <Badge color="moss">ADMIN</Badge>
        </div>
        <div className="flex gap-1 px-4 pb-2 overflow-x-auto no-scrollbar">{tabs.map(({ key, label, icon: Icon }) => <button key={key} onClick={() => setTab(key)} className={`flex items-center gap-1.5 px-3 py-2 rounded-lg text-xs font-medium whitespace-nowrap transition ${tab === key ? 'bg-moss-500/15 text-moss-300' : 'text-slate-500 hover:bg-white/5 hover:text-slate-300'}`}><Icon size={15} />{label}</button>)}</div>
      </div>

      <section className="p-4 md:p-6 max-w-7xl mx-auto">
        <div className="flex items-center justify-between mb-5"><div><h2 className="font-display text-xl font-bold text-white">{tabs.find((t) => t.key === tab)?.label}</h2><p className="text-[11px] text-slate-500 mt-0.5">Data live Supabase · perubahan langsung tersimpan</p></div></div>

        {tab === 'dashboard' && <div className="grid grid-cols-2 lg:grid-cols-4 gap-3"><Stat label="User" value={stats.total_users}/><Stat label="Sekolah" value={stats.total_schools}/><Stat label="Lomba" value={stats.total_competitions}/><Stat label="Lomba Publik" value={stats.total_public_competitions}/><Stat label="Sertifikat" value={stats.total_certificates}/><Stat label="Pending Order" value={orders.filter((o) => o.status === 'PENDING_PAYMENT').length}/><Stat label="Postingan" value={posts.length}/><Stat label="Produk Shop" value={products.length}/></div>}

        {tab === 'competitions' && <>
          <div className="flex justify-end mb-3"><Button size="sm" icon={<Plus size={14}/>} onClick={() => setCompetitionEditor({ status: 'DRAFT', visibility: 'PUBLIC', category: 'Kompetisi' })}>Tambah Lomba</Button></div>
          <div className="space-y-3">{competitions.map((c) => <Card key={c.id} className="p-4"><div className="flex gap-3 items-center"><div className="w-12 h-12 rounded-xl bg-moss-500/10 flex items-center justify-center"><Trophy size={20} className="text-moss-400"/></div><div className="flex-1"><p className="font-semibold text-white">{c.title}</p><p className="text-xs text-slate-500">{c.slug} · {c.visibility}</p></div><select className="input w-48" value={c.status} onChange={(e) => void transitionCompetition(c.id, e.target.value)} disabled={busy}>{competitionStatuses.map((s) => <option key={s}>{s}</option>)}</select><button className="p-2 rounded-lg hover:bg-white/5" onClick={() => setCompetitionEditor(c)}><Edit3 size={16}/></button><button className="p-2 rounded-lg text-red-400 hover:bg-red-500/10" onClick={() => void removeRow('competitions', c.id)}><Trash2 size={16}/></button></div></Card>)}{!competitions.length&&<Card className="p-8 text-center text-slate-500">Belum ada lomba.</Card>}</div>
        </>}

        {(tab === 'users' || tab === 'roles') && <><div className="relative mb-3"><Search size={15} className="absolute left-3 top-1/2 -translate-y-1/2 text-slate-500"/><input className="input pl-9" value={search} onChange={(e) => setSearch(e.target.value)} placeholder="Cari pengguna..."/></div><div className="space-y-2">{filteredUsers.map((u) => <Card key={u.id} className="p-3 flex items-center gap-3"><Avatar name={u.full_name || u.username || 'U'} id={u.id} size={38} src={u.avatar_url || undefined}/><div className="flex-1"><p className="text-sm text-white">{u.full_name || u.username}</p><p className="text-xs text-slate-500">@{u.username || '—'} · {u.institution || '—'} · {u.status}</p></div>{tab === 'roles' ? <select className="input w-48" value={u.account_type === 'organizer' ? 'organizer_member' : u.account_type || 'student'} disabled={busy} onChange={(e) => void setRole(u.id, e.target.value as BackendRole)}>{Object.entries(roleLabel).map(([r, l]) => <option key={r} value={r}>{l}</option>)}</select> : <Badge>{roleLabel[u.account_type] || u.account_type}</Badge>}<Link to={`/profile/${u.username}`}><Edit3 size={15}/></Link></Card>)}</div></>}

        {tab === 'posts' && <><div className="flex justify-end mb-3"><Button size="sm" icon={<Plus size={14}/>} onClick={() => setPostEditor({ status: 'PUBLISHED' })}>Tambah Postingan</Button></div><div className="space-y-2">{posts.map((p) => <Card key={p.id} className="p-4"><div className="flex gap-3"><div className="flex-1"><div className="flex gap-2 items-center"><p className="font-semibold text-white">{p.title}</p><Badge>{p.status}</Badge></div><p className="text-xs text-slate-500 mt-1 line-clamp-2">{p.body}</p></div><button onClick={() => setPostEditor(p)} className="p-2 hover:bg-white/5 rounded-lg"><Edit3 size={16}/></button><button onClick={() => void removeRow('posts', p.id)} className="p-2 text-red-400 hover:bg-red-500/10 rounded-lg"><Trash2 size={16}/></button></div></Card>)}</div></>}

        {tab === 'orders' && <div className="space-y-2">{orders.map((o) => <Card key={o.id} className="p-4 flex items-center gap-3"><ShoppingBag size={18} className="text-moss-400"/><div className="flex-1"><p className="text-sm text-white">Order {o.id.slice(0, 8)}</p><p className="text-xs text-slate-500">{o.user_id} · {new Date(o.created_at).toLocaleString('id-ID')}</p>{o.payment_proof_status === 'SUBMITTED' && <p className="text-[11px] text-amber-300 mt-1">Bukti pembayaran menunggu review</p>}</div><b className="text-sm text-white">Rp {Number(o.total || 0).toLocaleString('id-ID')}</b><Badge>{o.status}</Badge></Card>)}{!orders.length&&<Card className="p-8 text-center text-sm text-slate-500">Belum ada order di backend.</Card>}</div>}

        {tab === 'shop' && <><div className="flex justify-end mb-3"><Button size="sm" icon={<Plus size={14}/>} onClick={() => setProductEditor({ product_type: 'DIGITAL_ITEM', audiences: ['student'], price: 0, is_active: true, is_featured: false, sort_order: 0 })}>Tambah Produk</Button></div><div className="grid md:grid-cols-2 gap-3">{products.map((p) => <Card key={p.id} className="p-4"><div className="flex gap-3"><div className="flex-1"><p className="font-semibold text-white">{p.name}</p><p className="text-xs text-slate-500">{p.code} · {p.product_type}</p><p className="text-moss-300 font-bold mt-2">Rp {Number(p.price || 0).toLocaleString('id-ID')}</p><p className="text-xs text-slate-500 mt-1">{p.is_active ? 'Aktif' : 'Nonaktif'} · {p.is_featured ? 'Featured' : 'Biasa'}</p></div><button onClick={() => setProductEditor(p)} className="p-2 rounded-lg hover:bg-white/5"><Edit3 size={16}/></button><button onClick={() => void removeRow('commerce_products', p.id)} className="p-2 rounded-lg text-red-400 hover:bg-red-500/10"><Trash2 size={16}/></button></div></Card>)}</div></>}

        {tab === 'settings' && <div className="space-y-3"><Card className="p-5"><h3 className="font-semibold text-white">Platform settings</h3><p className="text-sm text-slate-400 mt-1">Konfigurasi global disimpan di <code>global_settings</code>; audit aktivitas tersedia di <code>audit_logs</code>.</p><Link to="/admin/roles" className="inline-block mt-4"><Button icon={<ShieldCheck size={15}/>}>Manajemen Role Detail</Button></Link></Card><Card className="p-5"><p className="text-xs text-amber-300">Catatan security</p><p className="text-sm text-slate-400 mt-1">RPC administratif harus dibatasi ke role backend yang sesuai. Audit security database sedang ditindaklanjuti terpisah.</p></Card></div>}
      </section>

      {competitionEditor && <Editor title={competitionEditor.id ? 'Edit Lomba' : 'Tambah Lomba'} onClose={() => setCompetitionEditor(null)} onSave={() => void saveCompetition()} busy={busy}>
        <Field label="Judul" value={competitionEditor.title || ''} onChange={(v) => setCompetitionEditor((x: any) => ({ ...x, title: v }))}/><Field label="Slug" value={competitionEditor.slug || ''} onChange={(v) => setCompetitionEditor((x: any) => ({ ...x, slug: v }))}/><Field label="Kategori" value={competitionEditor.category || ''} onChange={(v) => setCompetitionEditor((x: any) => ({ ...x, category: v }))}/><Field label="Deskripsi singkat" value={competitionEditor.short_description || ''} onChange={(v) => setCompetitionEditor((x: any) => ({ ...x, short_description: v }))}/><Field label="Poster URL" value={competitionEditor.poster_url || ''} onChange={(v) => setCompetitionEditor((x: any) => ({ ...x, poster_url: v }))}/><div className="grid md:grid-cols-2 gap-3"><Field label="Mulai registrasi" type="datetime-local" value={competitionEditor.registration_starts_at?.slice(0,16) || ''} onChange={(v) => setCompetitionEditor((x: any) => ({ ...x, registration_starts_at: v ? new Date(v).toISOString() : null }))}/><Field label="Selesai registrasi" type="datetime-local" value={competitionEditor.registration_ends_at?.slice(0,16) || ''} onChange={(v) => setCompetitionEditor((x: any) => ({ ...x, registration_ends_at: v ? new Date(v).toISOString() : null }))}/></div>
      </Editor>}

      {postEditor && <Editor title={postEditor.id ? 'Edit Postingan' : 'Tambah Postingan'} onClose={() => setPostEditor(null)} onSave={() => void savePost()} busy={busy}><Field label="Judul" value={postEditor.title || ''} onChange={(v) => setPostEditor((x: any) => ({ ...x, title: v }))}/><Field label="Isi" value={postEditor.body || ''} onChange={(v) => setPostEditor((x: any) => ({ ...x, body: v }))} textarea/><Field label="Cover URL" value={postEditor.cover_url || ''} onChange={(v) => setPostEditor((x: any) => ({ ...x, cover_url: v }))}/><div><label className="label">Status</label><select className="input" value={postEditor.status || 'PUBLISHED'} onChange={(e) => setPostEditor((x: any) => ({ ...x, status: e.target.value }))}><option>DRAFT</option><option>PUBLISHED</option><option>HIDDEN</option><option>ARCHIVED</option></select></div></Editor>}

      {productEditor && <Editor title={productEditor.id ? 'Edit Produk' : 'Tambah Produk'} onClose={() => setProductEditor(null)} onSave={() => void saveProduct()} busy={busy}><Field label="Code" value={productEditor.code || ''} onChange={(v) => setProductEditor((x: any) => ({ ...x, code: v }))}/><Field label="Slug" value={productEditor.slug || ''} onChange={(v) => setProductEditor((x: any) => ({ ...x, slug: v }))}/><Field label="Nama" value={productEditor.name || ''} onChange={(v) => setProductEditor((x: any) => ({ ...x, name: v }))}/><Field label="Harga" value={String(productEditor.price ?? 0)} onChange={(v) => setProductEditor((x: any) => ({ ...x, price: Number(v) }))} type="number"/><Field label="Image URL" value={productEditor.image_url || ''} onChange={(v) => setProductEditor((x: any) => ({ ...x, image_url: v }))}/><div className="flex gap-4 text-xs"><label className="flex items-center gap-2"><input type="checkbox" checked={!!productEditor.is_active} onChange={(e) => setProductEditor((x: any) => ({ ...x, is_active: e.target.checked }))}/> Aktif</label><label className="flex items-center gap-2"><input type="checkbox" checked={!!productEditor.is_featured} onChange={(e) => setProductEditor((x: any) => ({ ...x, is_featured: e.target.checked }))}/> Featured</label></div></Editor>}
    </div>
  );
}

function Editor({ title, children, onClose, onSave, busy }: any) { return <div className="fixed inset-0 z-50 bg-black/70 backdrop-blur-sm flex items-center justify-center p-4"><div className="w-full max-w-2xl max-h-[90vh] overflow-auto card p-5"><div className="flex justify-between items-center mb-4"><h3 className="font-display font-bold text-white">{title}</h3><button onClick={onClose} className="p-2 text-slate-400"><X size={18}/></button></div><div className="space-y-3">{children}</div><div className="flex justify-end gap-2 mt-5"><Button variant="outline" onClick={onClose}>Batal</Button><Button onClick={onSave} loading={busy}>Simpan</Button></div></div></div> }
function Field({ label, value, onChange, type = 'text', textarea = false }: { label: string; value: string; onChange: (value: string) => void; type?: string; textarea?: boolean }) { return <div><label className="label">{label}</label>{textarea ? <textarea className="input min-h-28" value={value} onChange={(e) => onChange(e.target.value)}/> : <input className="input" type={type} value={value} onChange={(e) => onChange(e.target.value)}/>}</div> }
function Stat({ label, value }: { label: string; value: unknown }) { return <Card className="p-4"><p className="text-xs text-slate-500">{label}</p><p className="text-2xl font-bold text-white mt-1">{Number(value || 0).toLocaleString('id-ID')}</p></Card> }
