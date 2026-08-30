import { useEffect, useState } from 'react';
import { Bell, Check, CheckCheck, Trophy, Play, TrendingUp, Truck, Clock, AlertCircle, MoreHorizontal, UserPlus, UserCheck, UserX } from 'lucide-react';
import { useApp } from '@/store/AppContext';
import { Button } from '@/components/ui/Button';
import { Card } from '@/components/ui/Card';
import { timeAgo } from '@/lib/utils';
import { listNotifications } from '@/services/notification.service';
import { respondFollowRequest } from '@/services/chat.service';
import { supabase } from '@/lib/supabase';
import type { AppNotification, NotificationType } from '@/types';

const ICONS: Record<NotificationType, React.ReactNode> = {
  'competition-start': <Play size={16} className="text-sky-400" />, 'result-out': <Trophy size={16} className="text-amber-400" />,
  'registration-approved': <Check size={16} className="text-accent" />, 'registration-rejected': <AlertCircle size={16} className="text-red-400" />,
  'order-update': <Truck size={16} className="text-sky-400" />, 'daily-reminder': <Clock size={16} className="text-amber-400" />,
  'rank-up': <TrendingUp size={16} className="text-accent" />, 'twibbon-verified': <Check size={16} className="text-accent" />,
  'follow-request': <UserPlus size={16} className="text-sky-400" />, 'follow-accepted': <UserCheck size={16} className="text-accent" />,
};
function mapNotification(n:any): AppNotification { return {id:String(n.id),type:n.type,title:String(n.title??''),body:String(n.body??''),createdAt:String(n.created_at),read:Boolean(n.read_at),link:n.data?.link}; }

export function NotificationsPageV2(){
  const {user,toast,markNotificationRead,markAllNotificationsRead,refreshUnreadCount}=useApp();
  const [rows,setRows]=useState<AppNotification[]>([]); const [loading,setLoading]=useState(true); const [busy,setBusy]=useState<string|null>(null);
  useEffect(()=>{let live=true;if(!user){setRows([]);setLoading(false);return()=>{live=false;};}setLoading(true);listNotifications(user.id).then(r=>live&&setRows(r.map(mapNotification))).catch(e=>live&&toast(e?.message??'Notifikasi gagal dimuat.','error')).finally(()=>live&&setLoading(false));return()=>{live=false;};},[user?.id,toast]);
  const read=async(id:string)=>{if(!user)return;await markNotificationRead(id);setRows(p=>p.map(n=>n.id===id?{...n,read:true}:n));void refreshUnreadCount();};
  const decide=async(n:AppNotification,accept:boolean)=>{if(!user||busy)return;setBusy(n.id);try{const {data}=await supabase.from('notifications').select('data').eq('id',n.id).eq('user_id',user.id).maybeSingle();const followerId=data?.data?.follower_id;if(!followerId)throw new Error('Data permintaan mengikuti tidak ditemukan.');await respondFollowRequest(followerId,accept);await read(n.id);setRows(p=>p.filter(x=>x.id!==n.id));toast(accept?'Permintaan mengikuti diterima.':'Permintaan mengikuti ditolak.','success');}catch(e:any){toast(e?.message??'Gagal memproses permintaan.','error');}finally{setBusy(null);}};
  const allRead=async()=>{if(!user)return;await markAllNotificationsRead();setRows(p=>p.map(n=>({...n,read:true})));void refreshUnreadCount();};
  const unread=rows.filter(n=>!n.read).length;
  return <div><div className="sticky top-0 z-20 glass border-b surface-border px-4 py-3 flex items-center justify-between"><div><h2 className="font-display font-bold text-lg text-fg">Notifikasi</h2><p className="text-xs text-fg-muted">{unread} belum dibaca</p></div>{unread>0&&<Button size="sm" variant="ghost" onClick={()=>void allRead()} icon={<CheckCheck size={14}/>}>Tandai Semua</Button>}</div><div className="p-4 space-y-2">{loading?<div className="text-center py-16 text-sm text-fg-muted">Memuat notifikasi…</div>:rows.length===0?<div className="text-center py-16"><Bell size={40} className="text-slate-700 mx-auto mb-3"/><p className="text-sm text-fg-muted">Belum ada notifikasi.</p></div>:rows.map(n=>{const follow=n.type==='follow-request';return <Card key={n.id} className={`p-4 flex items-start gap-3 ${!n.read?'border-moss-500/20 bg-moss-500/5':'opacity-70'}`}><div className="w-9 h-9 rounded-xl surface-elevated flex items-center justify-center shrink-0">{ICONS[n.type]??<Bell size={16}/>}</div><div className="flex-1 min-w-0"><p className="text-sm font-semibold text-fg">{n.title}</p><p className="text-xs text-fg-muted mt-1">{n.body}</p><p className="text-[10px] text-slate-600 mt-1">{timeAgo(n.createdAt)}</p>{follow&&!n.read&&<div className="flex gap-2 mt-3"><button disabled={busy===n.id} onClick={()=>void decide(n,true)} className="px-3 py-1.5 rounded-lg bg-moss-500 text-white text-xs font-semibold flex items-center gap-1 disabled:opacity-50"><UserCheck size={13}/>Terima</button><button disabled={busy===n.id} onClick={()=>void decide(n,false)} className="px-3 py-1.5 rounded-lg surface-elevated text-fg-muted text-xs font-semibold flex items-center gap-1 disabled:opacity-50"><UserX size={13}/>Tolak</button></div>}</div>{n.link&&!follow&&<a href={n.link} onClick={()=>void read(n.id)} className="text-xs text-accent">Buka</a>}<button onClick={()=>void read(n.id)} className="p-1 text-slate-600 hover:text-slate-400">{n.read?<MoreHorizontal size={14}/>:<span className="block w-2 h-2 rounded-full bg-moss-400"/>}</button></Card>;})}</div></div>;
}
