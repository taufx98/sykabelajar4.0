import { useEffect, useMemo, useRef, useState } from 'react';
import { Link, useLocation } from 'react-router-dom';
import { MessageCircle, UserPlus, UserMinus, Clock3 } from 'lucide-react';
import { useApp } from '@/store/AppContext';
import { Button } from '@/components/ui/Button';
import { supabase } from '@/lib/supabase';
import { getFollowStatus, requestFollow, type FollowStatus } from '@/services/chat.service';

function ProfileMessagingGate() {
  const location = useLocation();
  const { user, toast } = useApp();
  const [profile, setProfile] = useState<{ id:string; username:string; full_name:string|null; is_public:boolean } | null>(null);
  const [status, setStatus] = useState<FollowStatus>('none');
  const [busy, setBusy] = useState(false);
  const hiddenActionRef = useRef<HTMLElement | null>(null);

  const username = useMemo(() => {
    if (!location.pathname.startsWith('/profile/')) return '';
    return decodeURIComponent(location.pathname.slice('/profile/'.length));
  }, [location.pathname]);

  // Hide the legacy ProfilePage action row immediately so the user never sees
  // an unconditional Follow/Message button flash before the authoritative state loads.
  useEffect(() => {
    if (!username || !user || user.username === username) return;
    const hideLegacyAction = () => {
      const legacyMessage = document.querySelector<HTMLAnchorElement>('a[href*="/admin/chat?user_id="]');
      const action = legacyMessage?.closest('div.flex.justify-center.mt-4.gap-2') as HTMLElement | null;
      if (action && action !== hiddenActionRef.current) {
        if (hiddenActionRef.current) hiddenActionRef.current.style.removeProperty('display');
        hiddenActionRef.current = action;
        action.style.display = 'none';
      }
    };
    hideLegacyAction();
    const observer = new MutationObserver(hideLegacyAction);
    observer.observe(document.body, { childList: true, subtree: true });
    return () => {
      observer.disconnect();
      if (hiddenActionRef.current) hiddenActionRef.current.style.removeProperty('display');
      hiddenActionRef.current = null;
    };
  }, [username, user?.id, user?.username]);

  useEffect(() => {
    let alive = true;
    setProfile(null);
    setStatus('none');
    if (!username || !user || user.username === username) return () => { alive = false; };
    (async () => {
      const { data, error } = await supabase
        .from('profiles')
        .select('id,username,full_name,is_public')
        .eq('username', username)
        .maybeSingle();
      if (!alive || error || !data) return;
      const nextProfile = {
        id: String(data.id),
        username: String(data.username ?? username),
        full_name: data.full_name ?? null,
        is_public: data.is_public !== false,
      };
      setProfile(nextProfile);
      try { setStatus(await getFollowStatus(user.id, nextProfile.id)); } catch (e) { console.warn('[ProfileMessagingGate] follow state failed', e); }
    })();
    return () => { alive = false; };
  }, [username, user?.id, user?.username]);

  useEffect(() => {
    if (!profile || !user || user.username === username) return;
    const findHost = () => {
      const legacyMessage = document.querySelector<HTMLAnchorElement>(`a[href*="/admin/chat?user_id=${profile.id}"]`);
      const action = legacyMessage?.closest('div.flex.justify-center.mt-4.gap-2') as HTMLElement | null;
      if (!action) return;
      if (hiddenActionRef.current && hiddenActionRef.current !== action) hiddenActionRef.current.style.removeProperty('display');
      hiddenActionRef.current = action;
      action.style.display = 'none';
      const host = action.parentElement;
      if (!host) return;
      const marker = 'data-syka-profile-chat-host';
      host.setAttribute(marker, '1');
      if (!host.querySelector('[data-syka-profile-actions]')) {
        const mount = document.createElement('div');
        mount.setAttribute('data-syka-profile-actions', '1');
        host.appendChild(mount);
      }
    };
    findHost();
    const observer = new MutationObserver(findHost);
    observer.observe(document.body, { childList: true, subtree: true });
    const timer = window.setTimeout(findHost, 50);
    return () => { window.clearTimeout(timer); observer.disconnect(); };
  }, [profile?.id, username, user?.username]);

  if (!profile || !user || user.username === username) return null;

  const handleFollow = async () => {
    if (busy) return;
    setBusy(true);
    try {
      const result = await requestFollow(profile.id);
      const next = (result.status as FollowStatus) || 'pending';
      setStatus(next);
      toast(next === 'approved' || next === 'auto' ? 'Sekarang kamu mengikuti pengguna ini.' : 'Permintaan mengikuti terkirim.', 'success');
    } catch (e:any) {
      toast(e?.message ?? 'Gagal mengikuti pengguna.', 'error');
    } finally { setBusy(false); }
  };

  const removeFollow = async () => {
    if (busy) return;
    setBusy(true);
    try {
      const { error } = await supabase.rpc('remove_follow', { p_target_user_id: profile.id });
      if (error) throw error;
      setStatus('none');
      toast('Berhenti mengikuti pengguna.', 'info');
    } catch (e:any) {
      toast(e?.message ?? 'Gagal membatalkan follow.', 'error');
    } finally { setBusy(false); }
  };

  const mount = hiddenActionRef.current?.parentElement?.querySelector<HTMLElement>('[data-syka-profile-actions]');
  if (!mount) return null;

  return (
    <div className="flex justify-center mt-4 gap-2" data-syka-profile-actions-ui="1">
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
    </div>
  );
}

export function ChatUXBridge() {
  return <ProfileMessagingGate />;
}
