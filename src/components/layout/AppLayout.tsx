import { useEffect, useState, useCallback, useRef } from 'react';
import { Home, CalendarCheck, BarChart3, Award, Bell, ShoppingBag, User as UserIcon, LogOut, Menu, GraduationCap, LogIn, UserPlus, ShieldCheck, Building2, Sparkles, Megaphone, MessageCircle, Sun, Moon } from 'lucide-react';
import { Link, Outlet, useLocation, useNavigate } from 'react-router-dom';
import { useApp } from '@/store/AppContext';
import { Avatar } from '@/components/ui/Avatar';
import { Button } from '@/components/ui/Button';
import { RankBadge } from '@/components/ui/Badge';
import { supabase } from '@/lib/supabase';
import { ChatWidget } from '@/components/ui/ChatWidget';
import { ThemeToggle } from '@/components/ui/ThemeToggle';

export function AppLayout(){
  const{user,isGuest,logout,notifications}=useApp();
  const location=useLocation();const navigate=useNavigate();const[drawerOpen,setDrawerOpen]=useState(false);
  const[unreadChat,setUnreadChat]=useState(0);
  const[unreadOrders,setUnreadOrders]=useState(0);
  const[unreadAwards,setUnreadAwards]=useState(0);
  const unread=notifications.filter(n=>!n.read).length;
  const isAdmin=user?.role==='admin';
  const isOrganizer=user?.role==='penyelenggara';

  // Poll unread chat threads for admin
  useEffect(()=>{
    if(!isAdmin){setUnreadChat(0);return;}
    let alive=true;
    const poll=async()=>{
      try{
        const{data}=await supabase.from('chat_threads').select('id').eq('status','open');
        if(alive)setUnreadChat((data??[]).length);
      }catch{}
    };
    void poll();
    const t=setInterval(()=>void poll(),10000);
    return()=>{alive=false;clearInterval(t);};
  },[isAdmin]);

  // Poll unread orders for admin
  useEffect(()=>{
    if(!isAdmin){setUnreadOrders(0);return;}
    let alive=true;
    const poll=async()=>{
      try{
        const{count}=await supabase.from('orders').select('id',{count:'exact',head:true}).eq('payment_proof_status','SUBMITTED');
        if(alive)setUnreadOrders(count??0);
      }catch{}
    };
    void poll();
    const t=setInterval(()=>void poll(),30000);
    return()=>{alive=false;clearInterval(t);};
  },[isAdmin]);

  // Poll new awards for current user
  useEffect(()=>{
    if(isGuest||!user){setUnreadAwards(0);return;}
    let alive=true;
    const poll=async()=>{
      try{
        const{count}=await supabase.from('awards').select('id',{count:'exact',head:true}).eq('user_id',user.id).gt('created_at',new Date(Date.now()-7*24*60*60*1000).toISOString());
        if(alive)setUnreadAwards(count??0);
      }catch{}
    };
    void poll();
    const t=setInterval(()=>void poll(),30000);
    return()=>{alive=false;clearInterval(t);};
  },[isGuest,user?.id]);

  type NavItem=[string,string,typeof Home,number|undefined];
  const guestNav:NavItem[]=[
    ["/home","Beranda",Home,undefined],
    ["/leaderboard","Peringkat",BarChart3,undefined],
    ["/awards","Piagam",Award,undefined],
  ];
  const userNav:NavItem[]=[
    ["/home","Beranda",Home,undefined],
    ["/daily-tasks","Daily Tasks",CalendarCheck,undefined],
    ["/leaderboard","Peringkat",BarChart3,undefined],
    ["/awards","Piagam",Award,unreadAwards>0?unreadAwards:undefined],
    ["/notifications","Notifikasi",Bell,unread>0?unread:undefined],
    ["/orders","Pesanan",ShoppingBag,unreadOrders>0?unreadOrders:undefined],
  ];
  if(isOrganizer){userNav.push(["/organizer","Penyelenggara",Building2,undefined],["/organizer/ads","Pasang Iklan",Megaphone,undefined]);}
  if(isAdmin){userNav.push(["/admin","Admin",ShieldCheck,undefined],["/admin/chat","Chat Admin",MessageCircle,unreadChat>0?unreadChat:undefined]);}
  userNav.push([user?`/profile/${user.username}`:"/home","Profil",UserIcon,undefined]);
  const nav:NavItem[]=isGuest?guestNav:userNav;

  const active=(to:string)=>location.pathname===to||(to==='/home'&&location.pathname==='/');
  const logoutNow=()=>{void logout();navigate('/')};

  // Don't block render while auth loads — render layout immediately
  // If user data isn't ready yet, show layout with placeholder sidebar profile

  return (
    <>
      <div className="min-h-screen max-w-[1440px] mx-auto flex surface-bg">

        {/* ═══ DESKTOP SIDEBAR ═══ */}
        <aside className="hidden md:flex w-[250px] xl:w-[270px] shrink-0 sticky top-0 h-screen border-r border-white/5 p-3 flex-col">

          {/* Logo */}
          <Link to="/home" className="flex items-center gap-2.5 px-3 py-3 mb-4">
            <div className="w-9 h-9 rounded-xl gradient-moss flex items-center justify-center shadow-lg shadow-moss-500/20">
              <GraduationCap size={19} className="text-white"/>
            </div>
            <span className="font-display font-bold text-lg text-white">sykabelajar</span>
          </Link>

          {/* Navigation */}
          <nav className="space-y-0.5 flex-1">
            {nav.map(([to,label,Icon,badge]: NavItem)=>{
              const isActive=active(to);
              return (
                <Link key={to} to={to} className={`group flex items-center gap-3 px-3.5 py-2.5 rounded-xl text-sm font-medium transition-all duration-150 ${isActive?'bg-moss-500/12 text-moss-300 shadow-sm shadow-moss-500/5':'text-slate-400 hover:bg-white/5 hover:text-slate-200'}`}>
                  <Icon size={19} className={isActive?'text-moss-400':'text-slate-500 group-hover:text-slate-300 transition'}/>
                  <span className="flex-1">{label}</span>
                  {badge != null && badge > 0 && (
                    <span className="min-w-[18px] h-[18px] flex items-center justify-center text-[10px] font-bold rounded-full bg-red-500 text-white px-1">{badge>99?'99+':badge}</span>
                  )}
                </Link>
              );
            })}
          </nav>

          {/* Guest prompt */}
          {isGuest ? (
            <div className="card p-3 mt-2">
              <p className="text-sm font-semibold text-white">Mode Tamu</p>
              <p className="text-xs text-slate-500 mt-1 mb-3">Masuk untuk mengikuti lomba dan menyimpan progres.</p>
              <Link to="/register"><Button fullWidth size="sm" className="mb-2" icon={<UserPlus size={15}/>}>Daftar Gratis</Button></Link>
              <Link to="/login"><Button fullWidth size="sm" variant="outline" icon={<LogIn size={15}/>}>Masuk</Button></Link>
            </div>
          ) : user ? (
            <div className="mt-2 space-y-2 border-t border-white/5 pt-3">
              {/* Profile card — professional */}
              <Link to={`/profile/${user.username}`} className="group flex items-center gap-3 p-2.5 rounded-xl hover:bg-white/5 transition-all duration-150">
                <div className="relative shrink-0">
                  <Avatar name={user.displayName} id={user.id} size={40} src={user.profilePhoto || undefined}/>
                  <div className="absolute -bottom-0.5 -right-0.5 w-3.5 h-3.5 rounded-full bg-green-500 border-2 border-ink-950"/>
                </div>
                <div className="min-w-0 flex-1">
                  <p className="text-sm text-white font-semibold truncate group-hover:text-moss-300 transition">{user.displayName}</p>
                  <p className="text-[11px] text-slate-500 truncate">@{user.username}</p>
                </div>
              </Link>

              {/* XP card */}
              <div className="card p-3">
                <div className="flex justify-between items-center text-xs text-slate-500 mb-1.5">
                  <span>XP</span>
                  <RankBadge rank={user.rank} size="sm"/>
                </div>
                <p className="text-xl font-bold text-moss-300 tabular-nums">{user.points.toLocaleString('id-ID')}</p>
              </div>

              {/* Theme toggle + Logout */}
              <div className="flex items-center gap-2">
                <ThemeToggle className="flex-1" />
                <button onClick={logoutNow} className="flex-1 flex items-center justify-center gap-2 px-3.5 py-2.5 rounded-xl text-sm text-slate-500 hover:bg-red-500/10 hover:text-red-400 transition-all duration-150">
                  <LogOut size={16}/>
                  <span>Keluar</span>
                </button>
              </div>
            </div>
          ) : null}
        </aside>

        {/* ═══ MOBILE HEADER ═══ */}
        <div className="md:hidden fixed top-0 left-0 right-0 z-40 glass border-b border-white/5 px-4 py-3 flex justify-between items-center">
          <Link to="/home" className="flex items-center gap-2">
            <div className="w-8 h-8 rounded-lg gradient-moss flex items-center justify-center">
              <GraduationCap size={16} className="text-white"/>
            </div>
            <b className="text-white text-sm">sykabelajar</b>
          </Link>
          <div className="flex items-center gap-1.5">
            <ThemeToggle />
            <button onClick={()=>setDrawerOpen(true)} className="relative p-1.5">
              <Menu size={21} className="text-slate-300"/>
            </button>
          </div>
        </div>

        {/* ═══ MOBILE DRAWER ═══ */}
        {drawerOpen && (
          <div className="md:hidden fixed inset-0 z-50">
            <div className="absolute inset-0 bg-black/70 backdrop-blur-sm" onClick={()=>setDrawerOpen(false)}/>
            <div className="absolute left-0 top-0 bottom-0 w-72 bg-ink-900 border-r border-white/5 p-4 flex flex-col">
              <div className="flex justify-between items-center mb-5">
                <b className="text-white font-display">Menu</b>
                <button onClick={()=>setDrawerOpen(false)} className="text-slate-400 hover:text-white p-1">✕</button>
              </div>
              <nav className="space-y-0.5 flex-1 overflow-y-auto">
                {nav.map(([to,label,Icon,badge]: NavItem)=>{
                  const isActive=active(to);
                  return (
                    <Link key={to} to={to} onClick={()=>setDrawerOpen(false)} className={`flex items-center gap-3 px-3.5 py-2.5 rounded-xl text-sm font-medium transition ${isActive?'bg-moss-500/12 text-moss-300':'text-slate-400 hover:bg-white/5 hover:text-slate-200'}`}>
                      <Icon size={18}/>
                      <span className="flex-1">{label}</span>
                      {badge != null && badge > 0 && (
                        <span className="min-w-[18px] h-[18px] flex items-center justify-center text-[10px] font-bold rounded-full bg-red-500 text-white px-1">{badge>99?'99+':badge}</span>
                      )}
                    </Link>
                  );
                })}
              </nav>
            </div>
          </div>
        )}

        {/* ═══ MAIN CONTENT ═══ */}
        <main className="flex-1 min-w-0 pt-14 md:pt-0 pb-16 md:pb-0">
          <Outlet/>
        </main>
      </div>

      {/* ═══ MOBILE BOTTOM NAV ═══ */}
      {!isGuest && user && (
        <nav className="md:hidden fixed bottom-0 left-0 right-0 z-40 glass border-t border-white/5 px-2 py-1.5 flex items-center justify-around safe-area-bottom">
          {([
            [`/profile/${user.username}`,'Profil',UserIcon,undefined],
            ['/home','Beranda',Home,undefined],
            [isAdmin?'/admin':isOrganizer?'/organizer':`/profile/${user.username}`,isAdmin?'Admin':isOrganizer?'Penyelenggara':'Peringkat',isAdmin?ShieldCheck:isOrganizer?Building2:BarChart3,undefined],
            ...(isAdmin?[[`/admin/chat`,'Chat',MessageCircle,unreadChat>0?unreadChat:undefined] as NavItem]:[]),
          ] as NavItem[]).map(([to,label,Icon,badge])=>{
            const isActive=location.pathname===to||(to==='/home'&&location.pathname==='/');
            return (
              <Link key={to} to={to} className={`relative flex flex-col items-center gap-0.5 px-3 py-1.5 rounded-xl transition ${isActive?'text-moss-300':'text-slate-500'}`}>
                <Icon size={20}/>
                <span className="text-[10px] font-medium">{label}</span>
                {badge != null && badge > 0 && (
                  <span className="absolute -top-0.5 right-0 min-w-[14px] h-[14px] flex items-center justify-center text-[8px] font-bold rounded-full bg-red-500 text-white px-0.5">{badge>99?'99+':badge}</span>
                )}
              </Link>
            );
          })}
        </nav>
      )}

      {/* ═══ CHAT WIDGET ═══ */}
      {!isGuest && user && <ChatWidget />}
    </>
  );
}
