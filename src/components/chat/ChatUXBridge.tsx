import { useEffect, useMemo, useState } from 'react';
import { createPortal } from 'react-dom';
import { Link, useLocation } from 'react-router-dom';
import { MessageCircle, UserPlus, UserMinus, Clock3 } from 'lucide-react';
import { useApp } from '@/store/AppContext';
import { Button } from '@/components/ui/Button';
import { supabase } from '@/lib/supabase';
import { getFollowStatus, requestFollow, removeFollow, type FollowStatus } from '@/services/chat.service';
import { ChatAdminModerationPanel, ChatCooldownGate } from '@/components/chat/ChatModerationGate';

function normalizeFollowStatus(value: unknown): FollowStatus {
  return value === 'approved' || value === 'auto' || value === 'pending' ? value : 'none';
}

function ProfileMessagingGate() {
  const location = useLocation();
  const { user, toast } = useApp();
  const [profile, setProfile] = useState<any>(null);
  const [status, setStatus] = useState<FollowStatus>('none');
  const [busy, setBusy] = useState(false);
  const [host, setHost] = useState<HTMLElement | null>(null);
  const username = useMemo(
    () => location.pathname.startsWith('/profile/') ? decodeURIComponent(location.pathname.slice('/profile/'.length)).replace(/^@/, '') : '',
    [location.pathname],
  );

  useEffect(() => {
    if (!username || !user || user.username === username) { setHost(null); return; }
    const find = () => setHost(document.querySelector<HTMLElement>('[data-syka-profile-actions-host]'));
    find();
    const observer = new MutationObserver(find);
    observer.observe(document.body, { childList: true, subtree: true });
    return () => { observer.disconnect(); setHost(null); };
  }, [username, user?.id, user?.username]);

  useEffect(() => {
    let alive = true;
    setProfile(null);
    setStatus('none');
    if (!username || !user || user.username === username) return () => { alive = false; };
    (async () => {
      const { data, error } = await supabase.from('profiles').select('id,username,full_name,is_public').eq('username', username).maybeSingle();
      if (!alive || error || !data) return;
      setProfile(data);
      const next = await getFollowStatus(user.id, data.id).catch(() => 'none' as FollowStatus);
      if (alive) setStatus(normalizeFollowStatus(next));
    })();
    return () => { alive = false; };
  }, [username, user?.id, user?.username]);

  if (!profile || !user || user.username === username || !host) return null;

  const follow = async () => {
    if (busy) return;
    setBusy(true);
    const previous = status;
    const optimistic: FollowStatus = profile.is_public ? 'approved' : 'pending';
    setStatus(optimistic);
    try {
      const result = await requestFollow(profile.id);
      setStatus(normalizeFollowStatus(result?.status));
      toast(optimistic === 'approved' ? 'Sekarang kamu mengikuti pengguna ini.' : 'Permintaan mengikuti terkirim.', 'success');
    } catch (e: any) {
      setStatus(previous);
      toast(e?.message ?? 'Gagal mengikuti pengguna.', 'error');
    } finally { setBusy(false); }
  };

  const unfollow = async () => {
    if (busy) return;
    setBusy(true);
    const previous = status;
    setStatus('none');
    try {
      await removeFollow(profile.id);
      toast('Berhenti mengikuti pengguna.', 'success');
    } catch (e: any) {
      setStatus(previous);
      toast(e?.message ?? 'Gagal membatalkan follow.', 'error');
    } finally { setBusy(false); }
  };

  return createPortal(
    <div className="flex justify-center gap-2" aria-live="polite">
      {status === 'approved' || status === 'auto' ? <>
        <Button size="sm" variant="outline" onClick={() => void unfollow()} disabled={busy} icon={<UserMinus size={14} />}>Unfollow</Button>
        <Link to={`/pesan?user_id=${profile.id}`}><Button size="sm" variant="primary" icon={<MessageCircle size={14} />}>Kirim Pesan</Button></Link>
      </> : status === 'pending' ? <Button size="sm" variant="outline" disabled icon={<Clock3 size={14} />}>Diminta</Button>
        : <Button size="sm" variant="primary" onClick={() => void follow()} disabled={busy} icon={<UserPlus size={14} />}>Ikuti</Button>}
    </div>,
    host,
  );
}

export function ChatUXBridge() {
  return <><ProfileMessagingGate /><ChatCooldownGate /><ChatAdminModerationPanel /></>;
}
