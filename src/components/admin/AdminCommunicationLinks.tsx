import { MessageCircle, Settings2 } from 'lucide-react';
import { Link, useLocation } from 'react-router-dom';

export function AdminCommunicationLinks() {
  const location = useLocation();
  const isUserChat = location.pathname === '/pesan';
  const isAdminChat = location.pathname === '/admin/chat';

  return (
    <>
      <nav aria-label="Navigasi komunikasi admin" className="inline-flex max-w-full items-center gap-1 rounded-2xl border border-white/10 bg-slate-950/80 p-1 shadow-2xl shadow-black/20 backdrop-blur-xl">
        <Link to="/pesan" title="Buka pesan pribadi dan grup" className={`group inline-flex min-w-0 items-center gap-2 rounded-xl px-3 py-2 text-xs font-semibold transition-all duration-200 ${isUserChat ? 'bg-white/10 text-white shadow-sm ring-1 ring-white/5' : 'text-slate-400 hover:bg-white/5 hover:text-white'}`}>
          <MessageCircle size={15} className={isUserChat ? 'text-cyan-300' : 'text-slate-500 group-hover:text-slate-300'} />
          <span>Pesan</span>
        </Link>
        <Link to="/admin/chat" title="Buka pusat kontrol chat Admin" className={`group inline-flex min-w-0 items-center gap-2 rounded-xl px-3 py-2 text-xs font-semibold transition-all duration-200 ${isAdminChat ? 'bg-cyan-500/15 text-cyan-300 shadow-sm ring-1 ring-cyan-400/10' : 'text-slate-400 hover:bg-white/5 hover:text-white'}`}>
          <Settings2 size={15} className={isAdminChat ? 'text-cyan-300' : 'text-slate-500 group-hover:text-slate-300'} />
          <span>Kontrol Admin</span>
        </Link>
      </nav>
      <style>{`
        body:has(a[href="/admin/chat"].bg-cyan-500\\/15) main.min-h-0.flex-1.p-3 { padding: 0.75rem !important; }
        @media (min-width: 768px) { body:has(a[href="/admin/chat"].bg-cyan-500\\/15) main.min-h-0.flex-1.p-3 { padding: 1rem !important; } }
        body:has(a[href="/admin/chat"].bg-cyan-500\\/15) header.shrink-0.glass.border-b.surface-border { background: rgba(9,17,30,0.86); box-shadow: 0 10px 32px rgba(0,0,0,0.12); }
        body:has(a[href="/admin/chat"].bg-cyan-500\\/15) header.shrink-0.glass.border-b.surface-border > div:first-child { padding-top: 0.6rem; padding-bottom: 0.6rem; }
        body:has(a[href="/admin/chat"].bg-cyan-500\\/15) header.shrink-0.glass.border-b.surface-border > div:first-child > div:last-child p:first-child { opacity: 0.7; letter-spacing: 0.14em; }
        body:has(a[href="/admin/chat"].bg-cyan-500\\/15) header.shrink-0.glass.border-b.surface-border > div:nth-child(2) { gap: 0.2rem; padding-bottom: 0.55rem; }
        body:has(a[href="/admin/chat"].bg-cyan-500\\/15) header.shrink-0.glass.border-b.surface-border > div:nth-child(2) button { border: 1px solid transparent; transition: background-color 160ms ease, color 160ms ease, border-color 160ms ease; }
        body:has(a[href="/admin/chat"].bg-cyan-500\\/15) header.shrink-0.glass.border-b.surface-border > div:nth-child(2) button:hover { border-color: rgba(255,255,255,0.06); }
        body:has(a[href="/admin/chat"].bg-cyan-500\\/15) main > div.grid.h-full.min-h-0 { gap: 0.75rem; }
        body:has(a[href="/admin/chat"].bg-cyan-500\\/15) main > div.grid.h-full.min-h-0 > div:first-child { border-color: rgba(255,255,255,0.08); background: rgba(20,32,49,0.76); box-shadow: 0 20px 55px rgba(0,0,0,0.14); }
        @media (min-width: 1024px) { body:has(a[href="/admin/chat"].bg-cyan-500\\/15) main > div.grid.h-full.min-h-0 { grid-template-columns: 300px minmax(0,1fr) !important; } }
      `}</style>
    </>
  );
}
