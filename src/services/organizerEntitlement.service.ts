import { supabase } from '@/lib/supabase';

export interface OrganizerEntitlement { capability:string; limit_value:number|null; config:Record<string,unknown>; }
export interface ActiveOrganizerPlan { planCode:string; startsAt:string; endsAt:string|null; isActive:boolean; }

export async function getActiveOrganizerPlan(organizerId:string):Promise<ActiveOrganizerPlan|null> {
  const now = new Date().toISOString();
  const { data:planRows,error:planError } = await supabase
    .from('organizer_plans')
    .select('plan_code,starts_at,ends_at,is_active')
    .eq('organizer_id',organizerId)
    .eq('is_active',true)
    .lte('starts_at',now)
    .or(`ends_at.is.null,ends_at.gt.${now}`)
    .order('starts_at',{ascending:false})
    .limit(1);
  if(planError) throw planError;
  const plan = planRows?.[0];
  if(!plan) return null;
  return { planCode:String(plan.plan_code), startsAt:String(plan.starts_at), endsAt:plan.ends_at ? String(plan.ends_at) : null, isActive:true };
}

export async function getActiveOrganizerEntitlements(organizerId:string):Promise<{planCode:string|null;entitlements:OrganizerEntitlement[];plan:ActiveOrganizerPlan|null}> {
  const plan = await getActiveOrganizerPlan(organizerId);
  if(!plan) return {planCode:null,entitlements:[],plan:null};
  const { data, error } = await supabase.from('plan_entitlements').select('capability,limit_value,config').eq('plan_code',plan.planCode).order('capability');
  if(error) throw error;
  return {planCode:plan.planCode,plan,entitlements:(data??[]).map((e:any)=>({capability:String(e.capability),limit_value:e.limit_value==null?null:Number(e.limit_value),config:(e.config??{}) as Record<string,unknown>}))};
}
