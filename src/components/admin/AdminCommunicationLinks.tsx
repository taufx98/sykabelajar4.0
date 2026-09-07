import { MessageCircle, Settings2 } from 'lucide-react';
import { Link, useLocation } from 'react-router-dom';

export function AdminCommunicationLinks() {
  const location = useLocation();
  const isUserChat = location.pathname === '/pesan';
  const isAdminChat = location.pathname === '/admin/chat';
  return (
    <nav aria-label="Navigasi komunikasi admin" className="inline-flex max-w-full items-center gap-1 rounded-2xl border surface-border bg-surface-elevated/90 p-1 shadow-lg shadow-black/10 backdrop-blur-xl">
      <Link to="/pesan" className={`inline-flex min-w-0 items-center gap-2 rounded-xl px-3 py-2 text-xs font-semibold transition ${isUserChat ? 'bg-accent-muted-strong text-accent shadow-sm' : 'text-fg-muted hover:bg-white/5 hover:text-fg'}`}>
        <MessageCircle size={15} /><span>Pesan</span>
      </Link>
      <Link to="/admin/chat" className={`inline-flex min-w-0 items-center gap-2 rounded-xl px-3 py-2 text-xs font-semibold transition ${isAdminChat ? 'bg-accent-muted-strong text-accent shadow-sm' : 'text-fg-muted hover:bg-white/5 hover:text-fg'}`}>
        <Settings2 size={15} /><span>Kontrol Admin</span>
      </Link>
    </nav>
  );
}
