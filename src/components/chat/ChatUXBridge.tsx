import { useEffect, useMemo, useState } from 'react';
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
  const [profile, setProfile] = useState<any>(null);
  const [status, setStatus] = useState<FollowStatus>('none');
  const [busy, setBusy] = useState(false);
  const [host, setHost] = useState<HTMLElement | null>(null);

  const username = useMemo(() => {
    if (!location.pathname.startsWith('/profile/')) return '';
    return decodeURIComponent(location.pathname.slice('/profile/'.length));
  }, [location.pathname]);

  useEffect(() => {
    let alive = true;
    setProfile(null);
    setStatus('none');
    if (!username || !user || user.username === username) return;
    (async () => {
      const { data, error } = await supabase
        .from('profiles')
        .select('id,username,full_name,is_public')
        .eq('username', username)
        .maybeSingle();
      if (!alive || error || !data) return;
      setProfile(data);
      try { setStatus(await getFollowStatus(user.id, data.id)); } catch {}
    })();
    return () => { alive = false; };
  }, [username, user?.id, user?.username]);

  useEffect(() => {
    if (!profile || user?.username === username) { setHost(null); return; }
    const findHost = () => {
      const oldMessage = document.querySelector<HTMLAnchorElement>(`a[href*="/admin/chat?user_id=${profile.id}"]`);
      const candidate = oldMessage?.parentElement?.parentElement;
      if (candidate) {
        (candidate as HTMLElement).style.display = 'none';
        setHost(candidate.parentElement as HTMLElement);
        return;
      }
      const action = document.querySelector<HTMLDivElement>('div.flex.justify-center.mt-4.gap-2');
      if (action) {
        action.style.display = 'none';
        setHost(action.parentElement as HTMLElement);
      }
    };
    findHost();
    const observer = new MutationObserver(findHost);
    observer.observe(document.body, { childList: true, subtree: true });
    const timer = window.setTimeout(findHost, 100);
    return () => {
      window.clearTimeout(timer);
      observer.disconnect();
      if (candidateSafe()) candidateSafe()!.style.removeProperty('display');
    };
    function candidateSafe(): HTMLElement | null {
      const oldMessage = document.querySelector<HTMLAnchorElement>(`a[href*="/admin/chat?user_id=${profile.id}"]`);
      return (oldMessage?.parentElement?.parentElement as HTMLElement | null) ?? null;
    }
  }, [profile, username, user?.username]);

  if (!profile || !user || user.username === username || !host) return null;

  const handleFollow = async () => {
    if (busy) return;
    setBusy(true);
    try {
      const result = await requestFollow(profile.id);
      const next = (result.status as FollowStatus) || 'pending';
      setStatus(next);
      if (next === 'approved' || next === 'auto') toast('Sekarang kamu mengikuti pengguna ini.', 'success');
      else toast('Permintaan mengikuti terkirim.', 'success');
    } catch (e: any) {
      toast(e?.message ?? 'Gagal mengikuti pengguna.', 'error');
    } finally { setBusy(false); }
  };

  const removeFollow = async () => {
    setBusy(true);
    try {
      const { error } = await supabase.rpc('remove_follow', { p_target_user_id: profile.id });
      if (error) throw error;
      setStatus('none');
      toast('Berhenti mengikuti pengguna.', 'info');
    } catch (e: any) {
      toast(e?.message ?? 'Gagal membatalkan follow.', 'error');
    } finally { setBusy(false); }
  };

  return createPortal(
    <div className="flex justify-center mt-4 gap-2">
      {status === 'approved' || status === 'auto' ? (
        <>
          <Button size="sm" variant="outline" onClick={() => void removeFollow()} disabled={busy} icon={<UserMinus size={14} />}>Unfollow</Button>
          <Link to={`/admin/chat?user_id=${profile.id}`}>
            <Button size="sm" variant="primary" icon={<MessageCircle size={14} />}>Kirim Pesan</Button>
          </Link>
        </>
      ) : status === 'pending' ? (
        <Button size="sm" variant="outline" disabled icon={<Clock3 size={14} />}>Diminta</Button>
      ) : (
        <Button size="sm" variant="primary" onClick={() => void handleFollow()} disabled={busy} icon={<UserPlus size={14} />}>Ikuti</Button>
      )}
    </div>,
    host,
  );
}

export function ChatUXBridge() {
  return <ProfileMessagingGate />;
}
