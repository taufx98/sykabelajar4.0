import { useEffect, useState } from 'react';
import { ArrowLeft, Check, Lock, RotateCcw, Save } from 'lucide-react';
import { Link } from 'react-router-dom';
import { Card } from '@/components/ui/Card';
import { Button } from '@/components/ui/Button';
import { Avatar } from '@/components/ui/Avatar';
import { useApp } from '@/store/AppContext';
import { supabase } from '@/lib/supabase';
import { unblockChatUser } from '@/services/chat.service';

const MOBILE_ITEMS = [
  ['home','Beranda'],['leaderboard','Peringkat'],['awards','Piagam'],['chat','Pesan'],['notifications','Notifikasi'],['profile','Profil']
] as const;

export function ProfileInterfaceSettingsPage(){
 const {user,toast}=useApp();
 const [showSocial,setShowSocial]=useState(true); const [showFollowing,setShowFollowing]=useState(true);
 const [mobileNav,setMobileNav]=useState<string[]>(['home','leaderboard','awards','chat']);
 const [blocked,setBlocked]=useState<any[]>([]); const [loading,setLoading]=useState(true); const [saving,setSaving]=useState(false);
 useEffect(()=>{if(!user)return;let live=true;(async()=>{setLoading(true);const {data:s}=await supabase.from('profile_ui_settings').select('*').eq('user_id',user.id).maybeSingle();if(live&&s){setShowSocial(Boolean(s.show_social_popup));setShowFollowing(Boolean(s.show_following_popup));setMobileNav(Array.isArray(s.mobile_nav)?s.mobile_nav:['home','leaderboard','awards','chat']);}const {data:b}=await supabase.from('chat_blocks').select('blocked_id,created_at').eq('blocker_id',user.id).order('created_at',{ascending:false});if(!live)return;const ids=(b??[]).map(x=>x.blocked_id);const {data:p}=ids.length?await supabase.from('profiles').select('id,username,full_name,avatar_url,verification_type').in('id',ids):{data:[]};setBlocked((b??[]).map(x=>({...x,profile:(p??[]).find(q=>q.id===x.blocked_id)})));setLoading(false);})();return()=>{live=false;};},[user?.id]);
 const save=async()=>{if(!user)return;setSaving(true);try{const {error}=await supabase.from('profile_ui_settings').upsert({user_id:user.id,show_social_popup:showSocial,show_following_popup:showFollowing,mobile_nav:mobileNav,updated_at:new Date().toISOString()},{onConflict:'user_id'});if(error)throw error;toast('Pengaturan tampilan disimpan.','success');}catch(e:any){toast(e?.message??'Gagal menyimpan pengaturan.','error');}finally{setSaving(false);}};
 const reset=()=>{setShowSocial(true);setShowFollowing(true);setMobileNav(['home','leaderboard','awards','chat']);};
 const toggle=(key:string)=>setMobileNav(v=>v.includes(key)?v.filter(x=>x!==key):[...v,key].slice(0,5));
 const unBlock=async(id:string)=>{try{await unblockChatUser(id);setBlocked(v=>v.filter(x=>x.blocked_id!==id));toast('Blokir chat dibuka.','success');}catch(e:any){toast(e?.message??'Gagal membuka blokir.','error');}};
 return <div className="min-h-screen p-4 md:p-6"><div className="max-w-3xl mx-auto space-y-4"><Link to={`/profile/${user?.username}`} className="inline-flex items-center gap-2 text-sm text-fg-muted hover:text-fg"><ArrowLeft size={16}/>Kembali ke profil</Link><div><h1 className="font-display text-2xl font-bold text-fg">Tampilan & Privasi</h1><p className="text-sm text-fg-muted mt-1">Atur apa yang terlihat di profil dan tombol navigasi mobile. Ini terpisah dari Edit Profil.</p></div>
 <Card className="p-5"><h2 className="font-semibold text-fg">Profil sosial</h2><div className="mt-4 space-y-4"><label className="flex items-center justify-between gap-4"><div><p className="text-sm font-medium text-fg">Tampilkan popup sosial</p><p className="text-xs text-fg-muted">Izinkan orang membuka daftar Penggemar dan koneksi sosial dari profil Anda.</p></div><input type="checkbox" checked={showSocial} onChange={e=>setShowSocial(e.target.checked)} className="h-5 w-5 accent-emerald-500"/></label><label className="flex items-center justify-between gap-4"><div><p className="text-sm font-medium text-fg">Tampilkan “Mengikuti”</p><p className="text-xs text-fg-muted">Matikan untuk menyembunyikan akses daftar akun yang Anda ikuti dari profil publik.</p></div><input type="checkbox" checked={showFollowing} onChange={e=>setShowFollowing(e.target.checked)} className="h-5 w-5 accent-emerald-500"/></label></div></Card>
 <Card className="p-5"><h2 className="font-semibold text-fg">Navigasi bawah mobile</h2><p className="text-xs text-fg-muted mt-1">Maksimal 5 tombol. Urutan mengikuti pilihan Anda.</p><div className="mt-4 grid grid-cols-2 sm:grid-cols-3 gap-2">{MOBILE_ITEMS.map(([key,label])=>{const active=mobileNav.includes(key);return <button key={key} onClick={()=>toggle(key)} className={`flex items-center justify-between rounded-xl border px-3 py-2.5 text-sm ${active?'border-accent/40 bg-accent/10 text-accent':'surface-border surface-elevated text-fg-muted'}`}><span>{label}</span>{active&&<Check size={15}/>}</button>})}</div></Card>
 <Card className="p-5"><div className="flex items-center gap-2"><Lock size={17} className="text-red-400"/><h2 className="font-semibold text-fg">Pengguna diblokir</h2></div>{loading?<p className="text-sm text-fg-muted mt-4">Memuat…</p>:blocked.length===0?<p className="text-sm text-fg-muted mt-4">Belum ada pengguna yang diblokir.</p>:<div className="mt-3 divide-y surface-border">{blocked.map(x=><div key={x.blocked_id} className="py-3 flex items-center gap-3"><Avatar name={x.profile?.full_name||x.profile?.username||'User'} id={x.blocked_id} size={38} src={x.profile?.avatar_url||undefined}/><div className="flex-1"><p className="text-sm font-semibold text-fg">{x.profile?.full_name||x.profile?.username}</p><p className="text-xs text-fg-muted">@{x.profile?.username}</p></div><Button size="sm" variant="outline" onClick={()=>void unBlock(x.blocked_id)}>Buka Blokir</Button></div>)}</div>}</Card>
 <div className="flex justify-end gap-2"><Button variant="ghost" onClick={reset} icon={<RotateCcw size={14}/>}>Reset</Button><Button onClick={()=>void save()} disabled={saving} icon={<Save size={14}/>}>{saving?'Menyimpan…':'Simpan Pengaturan'}</Button></div>
 </div></div>;
}
