import { toast } from "@/lib/toast";
import { useEffect, useMemo, useState } from 'react';
import { LayoutDashboard, Trophy, Users, ShoppingBag, FileText, Store, Settings, ShieldCheck, Search, Trash2, Plus, Edit3, X, Megaphone, Ban, MessageCircle, Eye, ExternalLink } from 'lucide-react';
import { Link } from 'react-router-dom';
import { supabase } from '@/lib/supabase';
import { Card } from '@/components/ui/Card';
import { Button } from '@/components/ui/Button';
import { Badge } from '@/components/ui/Badge';
import { Avatar } from '@/components/ui/Avatar';
import { adminSetUserRole, type BackendRole } from '@/services/role.service';
import { AdminDashboard } from '@/components/admin/AdminDashboard';

type AdminTab = 'dashboard' | 'competitions' | 'users' | 'posts' | 'orders' | 'shop' | 'banners' | 'chat' | 'settings';
const tabs: { key: AdminTab; label: string; icon: typeof Trophy }[] = [
  { key: 'dashboard', label: 'Dashboard', icon: LayoutDashboard },
  { key: 'competitions', label: 'Lomba', icon: Trophy },
  { key: 'users', label: 'Pengguna', icon: Users },
  { key: 'posts', label: 'Postingan', icon: FileText },
  { key: 'orders', label: 'Pesanan', icon: ShoppingBag },
  { key: 'shop', label: 'Shop', icon: Store },
  { key: 'banners', label: 'Banner Iklan', icon: Megaphone },
  { key: 'chat', label: 'Chat', icon: MessageCircle },
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
      title: competitionEditor.title, slug: competitionEditor.slug,
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
    if (result.error) { toast.error(result.error.message); return; }
    setCompetitionEditor(null); await load();
  };

  const savePost = async () => {
    if (!postEditor?.title || !postEditor?.body) return;
    setBusy(true);
    const payload = { title: postEditor.title, body: postEditor.body, cover_url: postEditor.cover_url || null, competition_id: postEditor.competition_id || null, status: postEditor.status || 'PUBLISHED' };
    const result = postEditor.id ? await supabase.from('posts').update(payload).eq('id', postEditor.id) : await supabase.from('posts').insert(payload);
    setBusy(false);
    if (result.error) { toast.error(result.error.message); return; }
    setPostEditor(null); await load();
  };

  const saveProduct = async () => {
    if (!productEditor?.name || !productEditor?.code || !productEditor?.slug) return;
    setBusy(true);
    const payload = {
      code: productEditor.code, slug: productEditor.slug, name: productEditor.name,
      short_description: productEditor.short_description || null,
      description: productEditor.description || null,
      product_type: productEditor.product_type || 'DIGITAL_ITEM',
      audiences: productEditor.audiences || ['student'],
      price: Number(productEditor.price || 0), currency: 'IDR',
      image_url: productEditor.image_url || null,
      is_active: !!productEditor.is_active, is_featured: !!productEditor.is_featured,
      sort_order: Number(productEditor.sort_order || 0), metadata: productEditor.metadata || {},
    };
    const result = productEditor.id ? await supabase.from('commerce_products').update(payload).eq('id', productEditor.id) : await supabase.from('commerce_products').insert(payload);
    setBusy(false);
    if (result.error) { toast.error(result.error.message); return; }
    setProductEditor(null); await load();
  };

  const removeRow = async (table: string, id: string) => {
    if (!confirm('Hapus data ini?')) return;
    setBusy(true);
    const result = await supabase.from(table as any).delete().eq('id', id);
    setBusy(false);
    if (result.error) toast.error(result.error.message); else await load();
  };

  const transitionCompetition = async (id: string, status: string) => {
    setBusy(true);
    const { error } = await supabase.rpc('transition_competition', { p_competition_id: id, p_to_status: status, p_reason: 'Admin panel' });
    setBusy(false);
    if (error) toast.error(error.message); else await load();
  };

  const setRole = async (id: string, role: BackendRole) => {
    setBusy(true);
    try { await adminSetUserRole(id, role, true, 'Admin panel'); await load(); }
    catch (e: any) { toast.error(e.message); }
    finally { setBusy(false); }
  };

  return (
    <div className="min-h-screen surface-bg text-fg-secondary">
      {/* ═══ HEADER ═══ */}
      <div className="sticky top-0 z-30 glass border-b surface-border">
        <div className="px-4 py-3 flex items-center justify-between">
          <div className="flex items-center gap-3">
            <Link to="/home" className="p-2 rounded-lg hover:bg-surface-elevated/50 text-slate-400 hover:text-fg text-xs transition">← Kembali</Link>
            <div>
              <p className="text-[10px] text-moss-400 font-semibold uppercase tracking-wide">SYKABELAJAR</p>
              <h1 className="font-display font-bold text-base text-white leading-tight">Panel Admin</h1>
            </div>
          </div>
          <Badge color="moss">ADMIN</Badge>
        </div>
        {/* Tabs */}
        <div className="flex gap-1 px-4 pb-2 overflow-x-auto no-scrollbar">
          {tabs.map(({ key, label, icon: Icon }) => (
            <button
              key={key}
              onClick={() => setTab(key)}
              className={`flex items-center gap-1.5 px-3 py-2 rounded-lg text-xs font-medium whitespace-nowrap transition-all duration-200 ${
                tab === key
                  ? 'bg-moss-500/15 text-moss-300 shadow-sm shadow-moss-500/10'
                  : 'text-slate-500 hover:bg-surface-elevated/50 hover:text-fg-secondary active:scale-95'
              }`}
            >
              <Icon size={15} />
              {label}
            </button>
          ))}
        </div>
      </div>

      <section className="p-4 md:p-6 max-w-7xl mx-auto">
        <div className="flex items-center justify-between mb-5">
          <div>
            <h2 className="font-display text-xl font-bold text-fg">{tabs.find((t) => t.key === tab)?.label}</h2>
            <p className="text-[11px] text-slate-500 mt-0.5">Data live Supabase · perubahan langsung tersimpan</p>
          </div>
        </div>

        {/* ═══ DASHBOARD ═══ */}
        {tab === 'dashboard' && <AdminDashboard />}

        {/* ═══ COMPETITIONS ═══ */}
        {tab === 'competitions' && <>
          <div className="flex justify-end mb-3">
            <Button size="sm" icon={<Plus size={14}/>} onClick={() => setCompetitionEditor({ status: 'DRAFT', visibility: 'PUBLIC', category: 'Kompetisi' })}>Tambah Lomba</Button>
          </div>
          <div className="space-y-2">
            {competitions.map((c) => (
              <div key={c.id} className="group flex items-center gap-3 p-4 rounded-xl surface-card-bg border surface-border hover:border-moss-500/20 hover:surface-elevated transition-all duration-200 cursor-pointer active:scale-[0.99]"
                onClick={() => setCompetitionEditor(c)}>
                <div className="w-11 h-11 rounded-xl bg-moss-500/10 flex items-center justify-center group-hover:bg-moss-500/15 transition">
                  <Trophy size={18} className="text-moss-400" />
                </div>
                <div className="flex-1 min-w-0">
                  <p className="text-sm font-semibold text-fg group-hover:text-moss-300 transition truncate">{c.title}</p>
                  <p className="text-[11px] text-slate-500">{c.slug} · {c.visibility}</p>
                </div>
                <select className="input w-40 text-xs" value={c.status} onClick={e => e.stopPropagation()} onChange={(e) => { e.stopPropagation(); void transitionCompetition(c.id, e.target.value); }} disabled={busy}>
                  {competitionStatuses.map((s) => <option key={s}>{s}</option>)}
                </select>
                <div className="flex gap-1 opacity-0 group-hover:opacity-100 transition">
                  <button className="p-2 rounded-lg hover:bg-surface-elevated/50 text-slate-400 hover:text-fg transition active:scale-90" onClick={(e) => { e.stopPropagation(); setCompetitionEditor(c); }}>
                    <Edit3 size={14} />
                  </button>
                  <button className="p-2 rounded-lg text-red-400 hover:bg-red-500/10 transition active:scale-90" onClick={(e) => { e.stopPropagation(); void removeRow('competitions', c.id); }}>
                    <Trash2 size={14} />
                  </button>
                </div>
              </div>
            ))}
            {!competitions.length && <Card className="p-8 text-center text-sm text-slate-500">Belum ada lomba.</Card>}
          </div>
        </>}

        {/* ═══ USERS ═══ */}
        {tab === 'users' && <>
          <div className="relative mb-3">
            <Search size={15} className="absolute left-3 top-1/2 -translate-y-1/2 text-slate-500" />
            <input className="input pl-9" value={search} onChange={(e) => setSearch(e.target.value)} placeholder="Cari pengguna..." />
          </div>
          <div className="space-y-1.5">
            {filteredUsers.map((u) => (
              <div key={u.id} className="group flex items-center gap-3 p-3 rounded-xl hover:surface-elevated border border-transparent hover:surface-border transition-all duration-200 cursor-pointer active:scale-[0.99]"
                onClick={() => window.open(`/profile/${u.username}`, '_blank')}>
                <Avatar name={u.full_name || u.username || 'U'} id={u.id} size={38} src={u.avatar_url || undefined} />
                <div className="flex-1 min-w-0">
                  <p className="text-sm font-semibold text-fg group-hover:text-moss-300 transition truncate">{u.full_name || u.username}</p>
                  <p className="text-[11px] text-slate-500 truncate">@{u.username || '—'} · {u.institution || '—'}</p>
                </div>
                <Badge color={u.status === 'BANNED' ? 'err' : 'default'}>{roleLabel[u.account_type] || u.account_type}</Badge>
                <div className="flex gap-1 opacity-0 group-hover:opacity-100 transition">
                  <Link to={`/profile/${u.username}`} className="p-2 rounded-lg hover:bg-surface-elevated/50 text-slate-400 hover:text-moss-300 transition active:scale-90" onClick={e => e.stopPropagation()}>
                    <ExternalLink size={14} />
                  </Link>
                  <button className="p-2 rounded-lg text-red-400 hover:bg-red-500/10 transition active:scale-90" onClick={async (e) => {
                    e.stopPropagation();
                    if (!confirm("Ban user ini?")) return;
                    setBusy(true);
                    await supabase.from("profiles").update({ status: "BANNED" }).eq("id", u.id);
                    setBusy(false); await load();
                  }}>
                    <Ban size={14} />
                  </button>
                </div>
              </div>
            ))}
          </div>
        </>}

        {/* ═══ POSTS ═══ */}
        {tab === 'posts' && <>
          <div className="flex justify-end mb-3">
            <Button size="sm" icon={<Plus size={14}/>} onClick={() => setPostEditor({ status: 'PUBLISHED' })}>Tambah Postingan</Button>
          </div>
          <div className="space-y-2">
            {posts.map((p) => (
              <div key={p.id} className="group flex items-center gap-3 p-4 rounded-xl surface-card-bg border surface-border hover:border-moss-500/20 hover:surface-elevated transition-all duration-200 cursor-pointer active:scale-[0.99]"
                onClick={() => setPostEditor(p)}>
                <div className="w-11 h-11 rounded-xl bg-blue-500/10 flex items-center justify-center group-hover:bg-blue-500/15 transition">
                  <FileText size={18} className="text-blue-400" />
                </div>
                <div className="flex-1 min-w-0">
                  <div className="flex items-center gap-2">
                    <p className="text-sm font-semibold text-fg group-hover:text-blue-300 transition truncate">{p.title}</p>
                    <Badge>{p.status}</Badge>
                  </div>
                  <p className="text-[11px] text-slate-500 mt-0.5 line-clamp-1">{p.body}</p>
                </div>
                <div className="flex gap-1 opacity-0 group-hover:opacity-100 transition">
                  <button className="p-2 rounded-lg hover:bg-surface-elevated/50 text-slate-400 hover:text-fg transition active:scale-90" onClick={(e) => { e.stopPropagation(); setPostEditor(p); }}>
                    <Edit3 size={14} />
                  </button>
                  <button className="p-2 rounded-lg text-red-400 hover:bg-red-500/10 transition active:scale-90" onClick={(e) => { e.stopPropagation(); void removeRow('posts', p.id); }}>
                    <Trash2 size={14} />
                  </button>
                </div>
              </div>
            ))}
          </div>
        </>}

        {/* ═══ ORDERS ═══ */}
        {tab === 'orders' && <div className="space-y-2">
          {orders.map((o) => (
            <div key={o.id} className="group flex items-center gap-3 p-4 rounded-xl surface-card-bg border surface-border hover:border-amber-500/20 hover:surface-elevated transition-all duration-200">
              <div className="w-11 h-11 rounded-xl bg-amber-500/10 flex items-center justify-center group-hover:bg-amber-500/15 transition">
                <ShoppingBag size={18} className="text-amber-400" />
              </div>
              <div className="flex-1 min-w-0">
                <p className="text-sm font-semibold text-fg">Order {o.id.slice(0, 8)}</p>
                <p className="text-[11px] text-slate-500">{new Date(o.created_at).toLocaleString('id-ID')}</p>
                {o.payment_proof_status === 'SUBMITTED' && (
                  <p className="text-[11px] text-amber-400 mt-0.5 flex items-center gap-1">
                    <span className="w-1.5 h-1.5 rounded-full bg-amber-400 animate-pulse" />
                    Bukti pembayaran menunggu review
                  </p>
                )}
              </div>
              <b className="text-sm text-white tabular-nums">Rp {Number(o.total || 0).toLocaleString('id-ID')}</b>
              <Badge color={o.status === 'COMPLETED' ? 'moss' : o.status === 'PENDING_PAYMENT' ? 'warn' : 'default'}>{o.status}</Badge>
            </div>
          ))}
          {!orders.length && <Card className="p-8 text-center text-sm text-slate-500">Belum ada order.</Card>}
        </div>}

        {/* ═══ SHOP ═══ */}
        {tab === 'shop' && <>
          <div className="flex justify-end mb-3">
            <Button size="sm" icon={<Plus size={14}/>} onClick={() => setProductEditor({ product_type: 'DIGITAL_ITEM', audiences: ['student'], price: 0, is_active: true, is_featured: false, sort_order: 0 })}>Tambah Produk</Button>
          </div>
          <div className="grid md:grid-cols-2 gap-3">
            {products.map((p) => (
              <div key={p.id} className="group p-4 rounded-xl surface-card-bg border surface-border hover:border-purple-500/20 hover:surface-elevated transition-all duration-200 cursor-pointer active:scale-[0.99]"
                onClick={() => setProductEditor(p)}>
                <div className="flex gap-3">
                  <div className="w-11 h-11 rounded-xl bg-purple-500/10 flex items-center justify-center group-hover:bg-purple-500/15 transition shrink-0">
                    <Store size={18} className="text-purple-400" />
                  </div>
                  <div className="flex-1 min-w-0">
                    <p className="text-sm font-semibold text-fg group-hover:text-purple-300 transition truncate">{p.name}</p>
                    <p className="text-[11px] text-slate-500">{p.code} · {p.product_type}</p>
                    <p className="text-moss-300 font-bold text-sm mt-1">Rp {Number(p.price || 0).toLocaleString('id-ID')}</p>
                  </div>
                  <div className="flex flex-col gap-1 opacity-0 group-hover:opacity-100 transition">
                    <button className="p-1.5 rounded-lg hover:bg-surface-elevated/50 text-slate-400 hover:text-fg transition active:scale-90" onClick={(e) => { e.stopPropagation(); setProductEditor(p); }}>
                      <Edit3 size={13} />
                    </button>
                    <button className="p-1.5 rounded-lg text-red-400 hover:bg-red-500/10 transition active:scale-90" onClick={(e) => { e.stopPropagation(); void removeRow('commerce_products', p.id); }}>
                      <Trash2 size={13} />
                    </button>
                  </div>
                </div>
                <div className="flex items-center gap-2 mt-2">
                  <span className={`text-[10px] px-2 py-0.5 rounded-full ${p.is_active ? 'bg-moss-500/10 text-moss-400' : 'bg-slate-500/10 text-slate-500'}`}>
                    {p.is_active ? 'Aktif' : 'Nonaktif'}
                  </span>
                  {p.is_featured && <span className="text-[10px] px-2 py-0.5 rounded-full bg-amber-500/10 text-amber-400">Featured</span>}
                </div>
              </div>
            ))}
          </div>
        </>}

        {/* ═══ CHAT ═══ */}
        {tab === 'chat' && (
          <Link to="/admin/chat" className="block group">
            <div className="p-5 rounded-xl surface-card-bg border surface-border hover:border-moss-500/20 hover:surface-elevated transition-all duration-200 active:scale-[0.99]">
              <div className="flex items-center gap-4">
                <div className="w-14 h-14 rounded-xl bg-moss-500/10 flex items-center justify-center group-hover:bg-moss-500/15 group-hover:scale-110 transition-all">
                  <MessageCircle size={24} className="text-moss-400" />
                </div>
                <div className="flex-1">
                  <p className="text-base font-semibold text-fg group-hover:text-moss-300 transition">Buka Panel Chat Admin</p>
                  <p className="text-sm text-slate-400 mt-0.5">Lihat dan balas pesan dari pengguna secara real-time</p>
                </div>
                <ExternalLink size={16} className="text-slate-600 group-hover:text-moss-400 transition" />
              </div>
            </div>
          </Link>
        )}

        {/* ═══ SETTINGS ═══ */}
        {tab === 'settings' && <div className="space-y-3">
          <div className="p-5 rounded-xl surface-card-bg border surface-border hover:surface-border transition">
            <h3 className="font-semibold text-fg">Platform settings</h3>
            <p className="text-sm text-slate-400 mt-1">Konfigurasi global disimpan di <code className="text-moss-400 bg-moss-500/10 px-1.5 py-0.5 rounded">global_settings</code></p>
            <Link to="/admin/roles" className="inline-block mt-4">
              <Button icon={<ShieldCheck size={15}/>}>Manajemen Role Detail</Button>
            </Link>
          </div>
          <div className="p-5 rounded-xl bg-amber-500/5 border border-amber-500/10">
            <p className="text-xs text-amber-300 font-semibold">Catatan security</p>
            <p className="text-sm text-slate-400 mt-1">RPC administratif harus dibatasi ke role backend yang sesuai.</p>
          </div>
        </div>}
      </section>

      {/* ═══ EDITORS ═══ */}
      {competitionEditor && <Editor title={competitionEditor.id ? 'Edit Lomba' : 'Tambah Lomba'} onClose={() => setCompetitionEditor(null)} onSave={() => void saveCompetition()} busy={busy}>
        <Field label="Judul" value={competitionEditor.title || ''} onChange={(v) => setCompetitionEditor((x: any) => ({ ...x, title: v }))} />
        <Field label="Slug" value={competitionEditor.slug || ''} onChange={(v) => setCompetitionEditor((x: any) => ({ ...x, slug: v }))} />
        <Field label="Kategori" value={competitionEditor.category || ''} onChange={(v) => setCompetitionEditor((x: any) => ({ ...x, category: v }))} />
        <Field label="Deskripsi singkat" value={competitionEditor.short_description || ''} onChange={(v) => setCompetitionEditor((x: any) => ({ ...x, short_description: v }))} />
        <Field label="Poster URL" value={competitionEditor.poster_url || ''} onChange={(v) => setCompetitionEditor((x: any) => ({ ...x, poster_url: v }))} />
        <div className="grid md:grid-cols-2 gap-3">
          <Field label="Mulai registrasi" type="datetime-local" value={competitionEditor.registration_starts_at?.slice(0,16) || ''} onChange={(v) => setCompetitionEditor((x: any) => ({ ...x, registration_starts_at: v ? new Date(v).toISOString() : null }))} />
          <Field label="Selesai registrasi" type="datetime-local" value={competitionEditor.registration_ends_at?.slice(0,16) || ''} onChange={(v) => setCompetitionEditor((x: any) => ({ ...x, registration_ends_at: v ? new Date(v).toISOString() : null }))} />
        </div>
      </Editor>}

      {postEditor && <Editor title={postEditor.id ? 'Edit Postingan' : 'Tambah Postingan'} onClose={() => setPostEditor(null)} onSave={() => void savePost()} busy={busy}>
        <Field label="Judul" value={postEditor.title || ''} onChange={(v) => setPostEditor((x: any) => ({ ...x, title: v }))} />
        <Field label="Isi" value={postEditor.body || ''} onChange={(v) => setPostEditor((x: any) => ({ ...x, body: v }))} textarea />
        <Field label="Cover URL" value={postEditor.cover_url || ''} onChange={(v) => setPostEditor((x: any) => ({ ...x, cover_url: v }))} />
        <div>
          <label className="label">Status</label>
          <select className="input" value={postEditor.status || 'PUBLISHED'} onChange={(e) => setPostEditor((x: any) => ({ ...x, status: e.target.value }))}>
            <option>DRAFT</option><option>PUBLISHED</option><option>HIDDEN</option><option>ARCHIVED</option>
          </select>
        </div>
      </Editor>}

      {productEditor && <Editor title={productEditor.id ? 'Edit Produk' : 'Tambah Produk'} onClose={() => setProductEditor(null)} onSave={() => void saveProduct()} busy={busy}>
        <Field label="Code" value={productEditor.code || ''} onChange={(v) => setProductEditor((x: any) => ({ ...x, code: v }))} />
        <Field label="Slug" value={productEditor.slug || ''} onChange={(v) => setProductEditor((x: any) => ({ ...x, slug: v }))} />
        <Field label="Nama" value={productEditor.name || ''} onChange={(v) => setProductEditor((x: any) => ({ ...x, name: v }))} />
        <Field label="Harga" value={String(productEditor.price ?? 0)} onChange={(v) => setProductEditor((x: any) => ({ ...x, price: Number(v) }))} type="number" />
        <Field label="Image URL" value={productEditor.image_url || ''} onChange={(v) => setProductEditor((x: any) => ({ ...x, image_url: v }))} />
        <div className="flex gap-4 text-xs">
          <label className="flex items-center gap-2 cursor-pointer"><input type="checkbox" checked={!!productEditor.is_active} onChange={(e) => setProductEditor((x: any) => ({ ...x, is_active: e.target.checked }))} /> Aktif</label>
          <label className="flex items-center gap-2 cursor-pointer"><input type="checkbox" checked={!!productEditor.is_featured} onChange={(e) => setProductEditor((x: any) => ({ ...x, is_featured: e.target.checked }))} /> Featured</label>
        </div>
      </Editor>}
    </div>
  );
}

// ═══ EDITOR MODAL ═══
function Editor({ title, children, onClose, onSave, busy }: any) {
  return (
    <div className="fixed inset-0 z-50 bg-black/70 backdrop-blur-sm flex items-center justify-center p-4 animate-in fade-in">
      <div className="w-full max-w-2xl max-h-[90vh] overflow-auto surface-card-bg border surface-border rounded-2xl shadow-2xl p-6 animate-in slide-in-from-bottom-4">
        <div className="flex justify-between items-center mb-5">
          <h3 className="font-display font-bold text-lg text-fg">{title}</h3>
          <button onClick={onClose} className="p-2 rounded-lg hover:bg-surface-elevated/50 text-slate-400 hover:text-fg transition active:scale-90">
            <X size={18} />
          </button>
        </div>
        <div className="space-y-4">{children}</div>
        <div className="flex justify-end gap-2 mt-6 pt-4 border-t surface-border">
          <Button variant="outline" onClick={onClose}>Batal</Button>
          <Button onClick={onSave} loading={busy}>Simpan</Button>
        </div>
      </div>
    </div>
  );
}

// ═══ FIELD ═══
function Field({ label, value, onChange, type = 'text', textarea = false }: { label: string; value: string; onChange: (value: string) => void; type?: string; textarea?: boolean }) {
  return (
    <div>
      <label className="text-xs text-slate-400 font-medium mb-1.5 block">{label}</label>
      {textarea ? (
        <textarea className="input min-h-28 focus:border-moss-500/50 focus:ring-1 focus:ring-moss-500/20" value={value} onChange={(e) => onChange(e.target.value)} />
      ) : (
        <input className="input focus:border-moss-500/50 focus:ring-1 focus:ring-moss-500/20" type={type} value={value} onChange={(e) => onChange(e.target.value)} />
      )}
    </div>
  );
}
