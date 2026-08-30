import { useEffect, useState } from 'react';
import { Link, useParams } from 'react-router-dom';
import {
  Edit2, Calendar, Trophy, Award, GraduationCap, BarChart3, TrendingUp,
  CheckCircle2, User, UserPlus, UserMinus, MessageCircle, School,
  Coins, Flame, Lock, ChevronRight, Wallet,
} from 'lucide-react';
import { Card } from '@/components/ui/Card';
import { Button } from '@/components/ui/Button';
import { Badge } from '@/components/ui/Badge';
import { Avatar } from '@/components/ui/Avatar';
import { useApp } from '@/store/AppContext';
import { supabase } from '@/lib/supabase';
import { uploadProfileImage } from '@/services/cloudinary.service';
import { formatShortDate } from '@/lib/utils';
import { CATEGORY_LABELS, GRADE_OPTIONS } from '@/data/catalog';
import { removeFollow, requestFollow, getFollowStatus, type FollowStatus } from '@/services/chat.service';

type Tab = 'prestasi' | 'lomba' | 'statistik';
interface UserCompetition { id:string; competitionId:string; status:string; submittedAt:string; title:string; category:string; posterUrl:string|null; competitionStatus:string; score:number|null; rank:number|null; }

export function ProfilePage() {
  const { username } = useParams();
  const { user: currentUser, toast } = useApp();
  const [profile,setProfile]=useState<any>(null);
  const [awards,setAwards]=useState<any[]>([]);
  const [loading,setLoading]=useState(true);
  const [activeTab,setActiveTab]=useState<Tab>('prestasi');
  const [competitions,setCompetitions]=useState<UserCompetition[]>([]);
  const [compLoading,setCompLoading]=useState(false);
  const [stats,setStats]=useState({diikuti:0,dimenangkan:0,dailyTasks:0,streak:0,avgScore:0});
  const [catDistribution,setCatDistribution]=useState<{category:string;label:string;pct:number}[]>([]);
  const [totalPoints,setTotalPoints]=useState(0);
  const [rank,setRank]=useState(0);
  const [followers,setFollowers]=useState(0);
  const [following,setFollowing]=useState(0);
  const [isFollowing,setIsFollowing]=useState(false);
  const [followStatus,setFollowStatus]=useState<FollowStatus>('none');
  const [followBusy,setFollowBusy]=useState(false);
  const isOwn=currentUser?.username===username;
  const [eduCoin,setEduCoin]=useState(0);

  useEffect(()=>{
    let alive=true;
    (async()=>{
      setLoading(true);
      try{
        const {data:p,error}=await supabase.from('profiles').select('*').eq('username',username||'').maybeSingle();
        if(error)throw error;
        if(!p){if(alive)setProfile(null);return;}
        const {data:a}=await supabase.from('awards').select('*').eq('user_id',p.id).order('issued_at',{ascending:false});
        const {data:lb}=await supabase.rpc('get_public_leaderboard',{p_limit:100});
        const userRow=(lb??[]).find((r:any)=>String(r.user_id)===String(p.id));
        const xp=Number(userRow?.xp??0); const userRank=Number(userRow?.rank??0);
        const {data:social}=await supabase.rpc('get_public_profile_social',{p_profile_id:p.id});
        const socialRow=Array.isArray(social)?social[0]:social;
        let status:FollowStatus='none';
        if(currentUser&&currentUser.id!==p.id){try{status=await getFollowStatus(currentUser.id,p.id);}catch{status=(socialRow?.follow_status as FollowStatus)||'none';}}
        if(alive){
          setProfile(p); setAwards(a||[]); setTotalPoints(xp); setRank(userRank);
          setFollowers(Number(socialRow?.follower_count??0)); setFollowing(Number(socialRow?.following_count??0));
          setFollowStatus(status); setIsFollowing(status==='approved'||status==='auto'); setEduCoin(Number(p.edu_coin??0));
        }
      }catch(e:any){if(alive)toast(e?.message||'Profil gagal dimuat.','error');}
      finally{if(alive)setLoading(false);}
    })();
    return()=>{alive=false;};
  },[username,toast,currentUser]);

  useEffect(()=>{
    if(activeTab!=='lomba'||!profile?.id)return;
    let alive=true;
    (async()=>{
      setCompLoading(true);
      try{
        const {data:regs,error}=await supabase.from('registrations').select('id,competition_id,status,submitted_at').eq('user_id',profile.id).order('created_at',{ascending:false});
        if(error)throw error;
        if(!regs?.length){if(alive)setCompetitions([]);return;}
        const compIds=[...new Set(regs.map((r:any)=>String(r.competition_id)))];
        const {data:comps}=await supabase.from('competitions').select('id,title,category,poster_url,status').in('id',compIds);
        const compMap=new Map((comps??[]).map((c:any)=>[String(c.id),c]));
        if(alive)setCompetitions(regs.map((r:any)=>{const comp=compMap.get(String(r.competition_id));return {id:r.id,competitionId:r.competition_id,status:r.status,submittedAt:r.submitted_at,title:comp?.title||'Lomba',category:comp?.category||'',posterUrl:comp?.poster_url||null,competitionStatus:comp?.status||'',score:null,rank:null};}));
      }catch(e:any){if(alive)toast(e?.message||'Gagal memuat lomba.','error');}
      finally{if(alive)setCompLoading(false);}
    })();
    return()=>{alive=false;};
  },[activeTab,profile?.id,toast]);

  useEffect(()=>{
    if(activeTab!=='statistik'||!profile?.id)return;
    let alive=true;
    (async()=>{try{
      const {count:diikuti}=await supabase.from('registrations').select('id',{count:'exact',head:true}).eq('user_id',profile.id);
      const {count:dimenangkan}=await supabase.from('awards').select('id',{count:'exact',head:true}).eq('user_id',profile.id);
      const {count:dailyTasks}=await supabase.from('daily_task_claims').select('id',{count:'exact',head:true}).eq('user_id',profile.id);
      const {data:attScores}=await supabase.from('attempts').select('score').eq('participant_id',profile.id).eq('status','GRADED');
      const scores=(attScores??[]).map((a:any)=>Number(a.score??0)).filter((s:number)=>s>0);
      const avgScore=scores.length?Math.round(scores.reduce((a:number,b:number)=>a+b,0)/scores.length):0;
      const {data:regs}=await supabase.from('registrations').select('competition_id').eq('user_id',profile.id);
      const regCompIds=[...new Set((regs??[]).map((r:any)=>String(r.competition_id)))];
      const catCounts:Record<string,number>={};
      if(regCompIds.length){const {data:catComps}=await supabase.from('competitions').select('id,category').in('id',regCompIds);for(const c of (catComps??[]) as any[]){const cat=String(c.category??'');catCounts[cat]=(catCounts[cat]||0)+1;}}
      const total=Object.values(catCounts).reduce((a,b)=>a+b,0)||1;
      const distribution=Object.entries(catCounts).map(([cat,count])=>({category:cat,label:CATEGORY_LABELS[cat]||cat,pct:Math.round((count/total)*100)})).sort((a,b)=>b.pct-a.pct);
      if(alive)setStats({diikuti:diikuti??0,dimenangkan:dimenangkan??0,dailyTasks:dailyTasks??0,streak:0,avgScore});
      if(alive)setCatDistribution(distribution);
    }catch(e){console.warn('[Profile] stats failed',e);}}
    )();
    return()=>{alive=false;};
  },[activeTab,profile?.id]);

  const uploadCover=async(e:React.ChangeEvent<HTMLInputElement>)=>{
    const file=e.target.files?.[0]; if(!file||!currentUser||!isOwn)return;
    try{
      const oldCoverId=profile?.cover_public_id as string|undefined;
      const coverPublicId=oldCoverId||`sykabelajar/${profile.username}/cover`;
      const result=await uploadProfileImage(file,'cover',profile.username,coverPublicId);
      const {error}=await supabase.from('profiles').update({cover_url:result.secure_url,cover_public_id:result.public_id,updated_at:new Date().toISOString()}).eq('id',currentUser.id);
      if(error)throw error;
      toast('Sampul diperbarui.','success'); setProfile((prev:any)=>prev?{...prev,cover_url:result.secure_url,cover_public_id:result.public_id}:prev);
    }catch(e:any){toast(e?.message||'Upload gagal.','error');}finally{e.target.value='';}
  };

  const toggleFollow=async()=>{
    if(!currentUser||isOwn||!profile?.id||followBusy)return;
    setFollowBusy(true);
    try{
      if(followStatus==='approved'||followStatus==='auto'){
        await removeFollow(profile.id); setFollowStatus('none'); setIsFollowing(false); setFollowers(v=>Math.max(0,v-1));
      }else{
        const result=await requestFollow(profile.id); const next=(result.status as FollowStatus)||'pending'; setFollowStatus(next); setIsFollowing(next==='approved'||next==='auto'); if(next==='approved'||next==='auto')setFollowers(v=>v+1);
      }
    }catch(e:any){toast(e?.message||'Gagal memperbarui pengikutan.','error');}
    finally{setFollowBusy(false);}
  };

  if(loading)return <div className="p-6 text-sm text-fg-muted">Memuat profil…</div>;
  if(!profile)return <div className="p-6"><Card className="p-8 text-center text-fg-muted">Profil tidak ditemukan.</Card></div>;

  const gradeLabel=(()=>{const g=profile.grade||'';const found=GRADE_OPTIONS.find(o=>o.value===g);if(found)return found.label;if(g==='sd')return'SD';if(g==='smp')return'SMP';if(g==='sma')return'SMA';if(g==='alumni')return'Alumni';return g||'';})();
  const emblems=profile.emblems??[]; const badgeShowcase:string[]=profile.badge_showcase??[]; const badgeShowcaseManual=profile.badge_showcase_manual??false;
  const displayBadges=badgeShowcaseManual&&badgeShowcase.length>0?badgeShowcase:(profile.badges??[]).slice(0,3);
  const favoriteCategories=(profile.subjects??'').split(',').map((s:string)=>s.trim()).filter(Boolean);

  return <div className="w-full">
    <div className="relative h-32 md:h-44 surface-bg overflow-hidden">{profile.cover_url&&<img src={profile.cover_url} alt="" className="w-full h-full object-cover"/>}<div className="absolute inset-x-0 bottom-0 h-20 bg-gradient-to-t from-surface to-transparent"/>{isOwn&&<label className="absolute bottom-3 right-3 px-3 py-1.5 rounded-lg bg-black/50 backdrop-blur-sm text-[11px] text-white cursor-pointer hover:bg-black/70 transition z-10">Ganti Sampul<input type="file" accept="image/*" className="hidden" onChange={uploadCover}/></label>}</div>
    <div className="px-4 md:px-8 -mt-14 md:-mt-16 relative text-center pb-4 md:pb-6"><div className="flex justify-center"><div className="relative"><Avatar name={profile.full_name||profile.username||'U'} id={profile.id} size={88} ring src={profile.avatar_url||undefined}/><div className="absolute -bottom-0.5 -right-0.5 w-4 h-4 rounded-full bg-green-500 border-2 surface-bg"/></div></div>
      <div className="flex items-center justify-center gap-1.5 mt-3"><h1 className="font-display text-xl md:text-2xl font-bold text-fg">{profile.full_name||profile.username}</h1>{profile.status==='ACTIVE'&&<CheckCircle2 size={18} className="text-accent"/>}</div>
      <p className="text-sm text-fg-muted mt-0.5">@{profile.username}</p>{profile.bio&&<p className="text-sm text-fg-secondary mt-2 max-w-lg mx-auto leading-relaxed">{profile.bio}</p>}
      <div className="flex flex-wrap items-center justify-center gap-x-4 gap-y-1 mt-3 text-[11px] text-fg-muted">{profile.institution&&<span className="flex items-center gap-1"><School size={12}/>{profile.institution}</span>}{gradeLabel&&<span className="flex items-center gap-1"><GraduationCap size={12}/>{gradeLabel}</span>}{profile.birth_date&&<span className="flex items-center gap-1"><Calendar size={12}/>Lahir {new Date(profile.birth_date).toLocaleDateString('id-ID',{day:'numeric',month:'long',year:'numeric'})}</span>}</div>
      {profile.pembina&&<p className="text-[11px] text-fg-muted mt-1.5 flex items-center justify-center gap-1"><User size={12}/>Pembina: {profile.pembina}</p>}
      <div className="flex items-center justify-center gap-6 mt-3"><span className="text-sm"><span className="font-bold text-fg">{following}</span> <span className="text-fg-muted">Mengikuti</span></span><span className="text-sm"><span className="font-bold text-fg">{followers}</span> <span className="text-fg-muted">Pengikut</span></span></div>
      <div className="flex justify-center mt-4 gap-2">{isOwn?<><Link to="/profile/edit"><Button size="sm" variant="outline" icon={<Edit2 size={14}/>}>Edit Profil</Button></Link><Link to="/awards"><Button size="sm" variant="ghost" icon={<Award size={14}/>}>Lihat Semua Piagam</Button></Link></>:currentUser?<div data-syka-profile-actions-host className="min-h-9" aria-live="polite"/>:null}</div>
    </div>

    {isOwn&&<div className="px-4 md:px-8 pb-4"><div className="max-w-2xl mx-auto grid grid-cols-1 md:grid-cols-2 gap-3"><Card className="p-4"><div className="flex items-center gap-3"><div className="w-10 h-10 rounded-xl bg-purple-500/15 flex items-center justify-center"><Coins size={18} className="text-purple-400"/></div><div className="flex-1"><p className="text-[11px] text-fg-muted">EduCoin</p><p className="text-lg font-bold text-fg tabular-nums">{eduCoin.toLocaleString('id-ID')}</p></div><Link to="/leaderboard"><Button size="sm" variant="ghost" icon={<Wallet size={14}/>}>Lihat</Button></Link></div></Card><Card className="p-4"><div className="flex items-center gap-3 mb-2"><div className="w-10 h-10 rounded-xl bg-amber-500/15 flex items-center justify-center"><TrendingUp size={18} className="text-amber-400"/></div><div className="flex-1"><p className="text-[11px] text-fg-muted">Level {Math.floor(totalPoints/1000)+1}</p><p className="text-lg font-bold text-fg tabular-nums">{totalPoints.toLocaleString('id-ID')} XP</p></div><Flame size={16} className="text-orange-400"/></div><div className="h-1.5 surface-elevated rounded-full overflow-hidden"><div className="h-full bg-gradient-to-r from-amber-500 to-orange-500 rounded-full transition-all duration-700" style={{width:`${(totalPoints%1000)/10}%`}}/></div><p className="text-[10px] text-fg-muted mt-1">{1000-(totalPoints%1000)} XP lagi ke Level {Math.floor(totalPoints/1000)+2}</p></Card></div></div>}

    <div className="px-4 md:px-8 pb-2"><div className={`grid gap-3 max-w-2xl mx-auto ${isOwn?'grid-cols-2 md:grid-cols-4':'grid-cols-3'}`}><div className="surface-card-bg border surface-border rounded-2xl p-4 text-center"><p className="text-xl font-bold text-fg">{totalPoints.toLocaleString('id-ID')}</p><p className="text-[10px] text-fg-muted mt-0.5">Total Poin</p></div><div className="surface-card-bg border surface-border rounded-2xl p-4 text-center"><div className="w-8 h-8 rounded-full bg-accent-muted flex items-center justify-center mx-auto mb-1"><span className="text-sm font-bold text-accent">{rank||'—'}</span></div><p className="text-[10px] text-fg-muted">Peringkat #{rank||'—'}</p></div><div className="surface-card-bg border surface-border rounded-2xl p-4 text-center"><p className="text-xl font-bold text-fg">{awards.length}</p><p className="text-[10px] text-fg-muted mt-0.5">Awards</p></div>{isOwn&&<div className="surface-card-bg border surface-border rounded-2xl p-4 text-center"><p className="text-xl font-bold text-fg">{eduCoin.toLocaleString('id-ID')}</p><p className="text-[10px] text-fg-muted mt-0.5">EduCoin</p></div>}</div></div>

    <div className="px-4 md:px-8 py-4"><div className="max-w-6xl mx-auto flex flex-col lg:flex-row gap-5"><aside className="w-full lg:w-[35%] lg:max-w-xs space-y-3 shrink-0 order-2 lg:order-1">
      {emblems.length>0&&<Card className="p-4"><div className="flex items-center gap-2 mb-3"><Award size={16} className="text-accent"/><h3 className="text-sm font-bold text-fg">Emblem ({emblems.length})</h3></div><div className="flex gap-2.5">{emblems.slice(0,6).map((e:any,i:number)=><div key={i} className="w-10 h-10 rounded-xl bg-accent-muted flex items-center justify-center"><Award size={18} className="text-accent"/></div>)}</div></Card>}
      <Card className="p-4"><div className="flex items-center gap-2 mb-3"><Award size={16} className="text-accent"/><h3 className="text-sm font-bold text-fg">Badge</h3></div>{isOwn?<div className="space-y-2">{(profile.badges??[]).length>0&&<div className="flex flex-wrap gap-2">{(profile.badges??[]).map((b:string,i:number)=><span key={i} className="chip flex items-center gap-1"><CheckCircle2 size={10} className="text-accent"/>{b}</span>)}</div>}{['Pemburu Sertifikat','Raja Streak','Top 10 Global','Ahli Matematika','Social Butterfly'].filter(b=>!(profile.badges??[]).includes(b)).map((b,i)=><span key={i} className="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-full text-xs font-medium bg-slate-500/10 text-slate-500 border border-slate-500/20 opacity-50"><Lock size={10}/>{b}</span>)}{!(profile.badges??[]).length&&<p className="text-xs text-fg-muted">Selesaikan tantangan untuk membuka badge!</p>}</div>:<div className="flex flex-wrap gap-2">{displayBadges.map((b:string,i:number)=><span key={i} className="chip">{b}</span>)}{!displayBadges.length&&<p className="text-xs text-fg-muted">Belum ada badge.</p>}</div>}</Card>
      {favoriteCategories.length>0&&<Card className="p-4"><h3 className="text-sm font-bold text-fg mb-3">Kategori Favorit</h3><div className="flex flex-wrap gap-2">{favoriteCategories.map((cat:string,i:number)=><span key={i} className="chip">{CATEGORY_LABELS[cat]||cat}</span>)}</div></Card>}
    </aside>
    <div className="flex-1 min-w-0 order-1 lg:order-2"><div className="border-b surface-border mb-4 -mx-1"><div className="flex overflow-x-auto no-scrollbar gap-0">{([['prestasi','Prestasi'],['lomba','Lomba'],['statistik','Statistik']] as const).map(([key,label])=><button key={key} onClick={()=>setActiveTab(key)} className={`relative px-5 py-3 text-sm font-medium transition whitespace-nowrap ${activeTab===key?'text-accent':'text-fg-muted hover:text-fg-secondary'}`}>{label}{activeTab===key&&<div className="absolute bottom-0 left-2 right-2 h-0.5 bg-accent rounded-full"/>}</button>)}</div></div>
      {activeTab==='prestasi'&&<div className="space-y-3">{awards.slice(0,5).map((a:any)=><Card key={a.id} className="p-4"><div className="flex items-center gap-3"><div className={`w-11 h-11 rounded-xl flex items-center justify-center shrink-0 ${a.rank_code==='1'?'bg-amber-500/15':a.rank_code==='2'?'bg-slate-400/15':a.rank_code==='3'?'bg-orange-500/15':'bg-accent-muted'}`}><Award size={18} className={a.rank_code==='1'?'text-amber-400':a.rank_code==='2'?'text-fg-secondary':a.rank_code==='3'?'text-orange-400':'text-accent'}/></div><div className="flex-1 min-w-0"><p className="text-sm font-bold text-fg truncate">{a.title}</p><p className="text-xs text-fg-muted">{a.subtitle||a.rank_code||'Penghargaan'}</p></div><div className="text-right shrink-0"><p className="text-sm font-bold text-accent">+{a.points??0}</p><p className="text-[10px] text-fg-muted mt-0.5">{a.issued_at?formatShortDate(a.issued_at):'—'}</p></div></div></Card>)}{!awards.length&&<div className="text-center py-10 text-sm text-fg-muted">Belum ada penghargaan.</div>}{isOwn&&awards.length>5&&<Link to="/awards" className="flex items-center justify-center gap-1 py-3 text-sm text-accent hover:underline">Lihat Semua Piagam Saya<ChevronRight size={14}/></Link>}</div>}
      {activeTab==='lomba'&&<div className="space-y-3">{compLoading&&<div className="text-center py-10 text-sm text-fg-muted">Memuat lomba…</div>}{!compLoading&&!competitions.length&&<div className="text-center py-10 text-sm text-fg-muted">Belum ada lomba yang diikuti.</div>}{!compLoading&&competitions.map(comp=><Link key={comp.id} to={`/lomba/${comp.competitionId}`} className="block"><Card className="p-4 flex items-center gap-4 hover:border-accent/30"><div className="w-12 h-12 rounded-xl surface-elevated overflow-hidden shrink-0 flex items-center justify-center">{comp.posterUrl?<img src={comp.posterUrl} alt="" className="w-full h-full object-cover"/>:<Trophy size={20} className="text-accent/40"/>}</div><div className="flex-1 min-w-0"><p className="text-sm font-semibold text-fg truncate">{comp.title}</p><p className="text-[11px] text-fg-muted">{CATEGORY_LABELS[comp.category]||comp.category||'Umum'}</p></div><Badge color={comp.competitionStatus==='LIVE'?'moss':comp.competitionStatus==='REGISTRATION_OPEN'?'info':'default'}>{comp.competitionStatus==='LIVE'?'Berlangsung':comp.competitionStatus==='REGISTRATION_OPEN'?'Terbuka':comp.competitionStatus==='RESULT_PUBLISHED'?'Selesai':comp.competitionStatus}</Badge></Card></Link>)}</div>}
      {activeTab==='statistik'&&<div className="space-y-4"><Card className="p-5"><div className="flex items-center gap-2 mb-4"><BarChart3 size={17} className="text-accent"/><h3 className="font-display font-bold text-fg text-sm">Statistik Performa</h3></div><div className="space-y-4"><StatBar label="Uji kompetensi diikuti" value={stats.diikuti} max={Math.max(stats.diikuti,stats.dimenangkan*3,10)} color="bg-accent"/><StatBar label="Uji kompetensi dimenangkan" value={stats.dimenangkan} max={Math.max(stats.diikuti,stats.dimenangkan*3,10)} color="bg-sky-400"/><StatBar label="Daily tasks selesai" value={stats.dailyTasks} max={Math.max(stats.dailyTasks,50)} color="bg-accent"/><StatBar label="Rata-rata skor" value={stats.avgScore} max={100} suffix="%" color="bg-accent"/></div></Card>{catDistribution.length>0&&<Card className="p-5"><div className="flex items-center gap-2 mb-4"><TrendingUp size={17} className="text-sky-400"/><h3 className="font-display font-bold text-fg text-sm">Distribusi Kategori</h3></div><div className="space-y-3">{catDistribution.map(cat=><div key={cat.category} className="flex items-center gap-3"><p className="text-xs text-fg-muted w-28 shrink-0">{cat.label}</p><div className="flex-1 h-2 surface-elevated rounded-full overflow-hidden"><div className="h-full bg-sky-400 rounded-full" style={{width:`${cat.pct}%`}}/></div><span className="text-xs text-fg-muted font-medium w-10 text-right">{cat.pct}%</span></div>)}</div></Card>}{!stats.diikuti&&!stats.dimenangkan&&!stats.dailyTasks&&<div className="text-center py-10 text-sm text-fg-muted">Belum ada data statistik.</div>}</div>}
    </div></div></div>
  </div>;
}

function StatBar({label,value,max,suffix='',color}:{label:string;value:number;max:number;suffix?:string;color:string}){const pct=max>0?Math.min((value/max)*100,100):0;return <div><div className="flex items-center justify-between mb-1.5"><p className="text-sm text-fg-secondary">{label}</p><p className="text-sm font-semibold text-fg">{value.toLocaleString('id-ID')}{suffix}</p></div><div className="h-2 surface-elevated rounded-full overflow-hidden"><div className={`h-full ${color} rounded-full`} style={{width:`${Math.max(pct,2)}%`}}/></div></div>;}
