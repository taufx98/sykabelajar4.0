import { MessageCircle, Settings2 } from 'lucide-react';
import { Link, useLocation } from 'react-router-dom';

export function AdminCommunicationLinks() {
  const location = useLocation();
  const isUserChat = location.pathname === '/pesan';
  const isAdminChat = location.pathname === '/admin/chat';
  return (
    <div className="flex flex-wrap gap-2 rounded-2xl border surface-border surface-card-bg p-2">
      <Link to="/pesan" className={`inline-flex items-center gap-2 rounded-xl px-3 py-2 text-xs font-semibold ${isUserChat ? 'bg-accent-muted-strong text-accent' : 'text-fg-muted hover:bg-white/5 hover:text-fg'}`}>
        <MessageCircle size={15} /> Chat Pribadi &amp; Grup
      </Link>
      <Link to="/admin/chat" className={`inline-flex items-center gap-2 rounded-xl px-3 py-2 text-xs font-semibold ${isAdminChat ? 'bg-accent-muted-strong text-accent' : 'text-fg-muted hover:bg-white/5 hover:text-fg'}`}>
        <Settings2 size={15} /> Kontrol Chat Admin
      </Link>
    </div>
  );
}
