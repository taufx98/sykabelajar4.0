import { initials, avatarGradient } from '@/lib/utils';
import { optimizedCloudinaryUrl } from '@/services/cloudinary.service';
export function Avatar({name,id,size=40,src,ring=false,shape='circle'}:{name:string;id:string;size?:number;src?:string;ring?:boolean;shape?:'circle'|'square'}){
  const fontSize=Math.max(10,size*0.38); const radius=shape==='square'?'rounded-xl':'rounded-full';
  if(src) return <img src={optimizedCloudinaryUrl(src,{width:150})} alt={name} width={size} height={size} className={`${radius} object-cover ${ring?'ring-2 ring-moss-500/50':''}`} style={{width:size,height:size}}/>;
  return <div className={`${radius} bg-gradient-to-br ${avatarGradient(id)} flex items-center justify-center font-semibold text-white shrink-0 ${ring?'ring-2 ring-moss-500/50':''}`} style={{width:size,height:size,fontSize}}>{initials(name)}</div>;
}
