import { useEffect, useMemo, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { Link, useLocation } from 'react-router-dom';
import { MessageCircle, UserPlus, UserMinus, Clock3 } from 'lucide-react';
import { useApp } from '@/store/AppContext';
import { Button } from '@/components/ui/Button';
import { supabase } from '@/lib/supabase';
import { getFollowStatus, requestFollow, type FollowStatus } from '@/services/chat.service';

function ProfileMessagingGate() {
  const location = useLocation();
  const { user, toast } = useApp();
  const [profile, setProfile] = useState<{id:string;username:string;full_name:string|null;is_public:boolean}|null>(null);
  const [status, setStatus] = useState<FollowStatus>('none');
  const [busy, setBusy] = useState(false);
  const hostRef = useRef<HTMLElement|null>(null);
  const username = useMemo(()=>location.pathname.startsWith('/profile/')?decodeURIComponent(location.pathname.slice('/profile/'.length)):'',[location.pathname]);

  useEffect(()=>{
    if(!username||!user||user.username===username)return;
    const findHost=()=>{
      const host=document.querySelector<HTMLElement>('[data-syka-profile-actions-host]');
      if(host)hostRef.current=host;
    };
    findHost();
    const observer=new MutationObserver(findHost);
    observer.observe(document.body,{childList:true,subtree:true});
    return()=>{observer.disconnect();hostRef.current=null;};
  },[username,user?.id,user?.username]);

  useEffect(()=>{
    let alive=true;
    setProfile(null);setStatus('none');
    if(!username||!user||user.username===username)return()=>{alive=false;};
    (async()=>{
      const {data,error}=await supabase.from('profiles').select('id,username,full_name,is_public').eq('username',username).maybeSingle();
      if(!alive||error||!data)return;
      const next={id:String(data.id),username:String(data.username??username),full_name:data.full_name??null,is_public:data.is_public!==false};
      setProfile(next);
      try{setStatus(await getFollowStatus(user.id,next.id));}catch(e){console.warn('[ProfileMessagingGate] follow state failed',e);}
    })();
    return()=>{alive=false;};
  },[username,user?.id,user?.username]);

  if(!profile||!user||user.username===username||!hostRef.current)return null;

  const handleFollow=async()=>{
    if(busy)return;setBusy(true);
    try{const result=await requestFollow(profile.id);const next=(result.status as FollowStatus)||'pending';setStatus(next);toast(next==='approved'||next==='auto'?'Sekarang kamu mengikuti pengguna ini.':'Permintaan mengikuti terkirim.','success');}
    catch(e:any){toast(e?.message??'Gagal mengikuti pengguna.','error');}
    finally{setBusy(false);}
  };
  const remove=async()=>{
    if(busy)return;setBusy(true);
    try{const {error}=await supabase.rpc('remove_follow',{p_target_user_id:profile.id});if(error)throw error;setStatus('none');toast('Berhenti mengikuti pengguna.','info');}
    catch(e:any){toast(e?.message??'Gagal membatalkan follow.','error');}
    finally{setBusy(false);}
  };

  return createPortal(
    <div className="flex justify-center mt-4 gap-2" aria-live="polite">
      {status==='approved'||status==='auto'?<><Button size="sm" variant="outline" onClick={()=>void remove()} disabled={busy} icon={<UserMinus size={14}/>}>Unfollow</Button><Link to={`/admin/chat?user_id=${profile.id}`}><Button size="sm" variant="primary" icon={<MessageCircle size={14}/>}>Kirim Pesan</Button></Link></>:status==='pending'?<Button size="sm" variant="outline" disabled icon={<Clock3 size={14}/>}>Diminta</Button>:<Button size="sm" variant="primary" onClick={()=>void handleFollow()} disabled={busy} icon={<UserPlus size={14}/>}>Ikuti</Button>}
    </div>,hostRef.current);
}

export function ChatUXBridge(){return <ProfileMessagingGate/>;}
