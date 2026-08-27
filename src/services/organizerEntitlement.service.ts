import { supabase } from '@/lib/supabase';

export interface OrganizerEntitlement { capability:string; limit_value:number|null; config:Record<string,unknown>; }

export async function getActiveOrganizerEntitlements(organizerId:string):Promise<{planCode:string|null;entitlements:OrganizerEntitlement[]}> {
  const { data:planRows,error:planError } = await supabase.from('organizer_plans').select('plan_code,starts_at,ends_at,is_active').eq('organizer_id',organizerId).eq('is_active',true).order('starts_at',{ascending:false}).limit(1);
  if(planError) throw planError;
  const plan = planRows?.[0];
  if(!plan) return {planCode:null,entitlements:[]};
  const { data, error } = await supabase.from('plan_entitlements').select('capability,limit_value,config').eq('plan_code',plan.plan_code).order('capability');
  if(error) throw error;
  return {planCode:String(plan.plan_code),entitlements:(data??[]).map((e:any)=>({capability:String(e.capability),limit_value:e.limit_value==null?null:Number(e.limit_value),config:(e.config??{}) as Record<string,unknown>}))};
}
