import { MessageCircle, Settings2 } from 'lucide-react';
import { Link, useLocation } from 'react-router-dom';

export function AdminCommunicationLinks() {
  const location = useLocation();
  const isUserChat = location.pathname === '/pesan';
  const isAdminChat = location.pathname === '/admin/chat';

  return (
    <nav aria-label="Navigasi komunikasi admin" className="inline-flex max-w-full items-center gap-1 rounded-2xl border border-white/10 bg-slate-950/80 p-1 shadow-xl shadow-black/15 backdrop-blur-xl">
      <Link to="/pesan" title="Buka pesan pribadi dan grup" className={`group inline-flex min-w-0 items-center gap-2 rounded-xl px-3 py-2 text-xs font-semibold transition-all duration-200 ${isUserChat ? 'bg-white/10 text-white shadow-sm ring-1 ring-white/5' : 'text-slate-400 hover:bg-white/5 hover:text-white'}`}>
        <MessageCircle size={15} className={isUserChat ? 'text-cyan-300' : 'text-slate-500 group-hover:text-slate-300'} />
        <span>Pesan</span>
      </Link>
      <Link to="/admin/chat" title="Buka pusat kontrol chat Admin" className={`group inline-flex min-w-0 items-center gap-2 rounded-xl px-3 py-2 text-xs font-semibold transition-all duration-200 ${isAdminChat ? 'bg-cyan-500/15 text-cyan-300 shadow-sm ring-1 ring-cyan-400/10' : 'text-slate-400 hover:bg-white/5 hover:text-white'}`}>
        <Settings2 size={15} className={isAdminChat ? 'text-cyan-300' : 'text-slate-500 group-hover:text-slate-300'} />
        <span>Kontrol Admin</span>
      </Link>
    </nav>
  );
}
