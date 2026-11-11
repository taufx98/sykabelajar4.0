import type { AuthWorkerEnv } from "./env";
import { isAllowedOrigin } from "./security.mjs";
import { BetterAuthAdminAuthError, isBetterAuthTokenForIssuer, resolveBetterAuthAdminIdentity } from "./email-admin-auth.mjs";

type RuntimePolicy = { email_verification_required: number; updated_at: string; updated_by: string };
type AdminIdentity = { id: string; email: string };
type AdminCheck = { user: AdminIdentity } | { response: Response };
const json=(data:unknown,status=200)=>new Response(JSON.stringify(data),{status,headers:{"Content-Type":"application/json; charset=utf-8","Cache-Control":"no-store"}});

async function requireAdmin(request:Request,env:AuthWorkerEnv):Promise<AdminCheck>{
 const origin=request.headers.get("Origin");
 if(!isAllowedOrigin(origin,[env.APP_ORIGIN,...(env.DEV_APP_ORIGIN?[env.DEV_APP_ORIGIN]:[])]))return {response:json({ok:false,error:"ORIGIN_NOT_ALLOWED"},403)};
 const token=request.headers.get("Authorization")?.replace(/^Bearer\s+/,"").trim();
 if(!token||token.length>8192||!isBetterAuthTokenForIssuer(token,env.BETTER_AUTH_URL))return {response:json({ok:false,error:"AUTH_REQUIRED"},401)};
 try{return {user:await resolveBetterAuthAdminIdentity({accessToken:token,authBaseUrl:env.BETTER_AUTH_URL,resourceAudience:env.SUPABASE_RESOURCE_AUDIENCE,supabaseUrl:env.SUPABASE_PROVISIONING_URL??"",publishableKey:env.SUPABASE_PROVISIONING_PUBLISHABLE_KEY??"")}}catch(e){
  const code=e instanceof BetterAuthAdminAuthError?e.code:"";
  return {response:json({ok:false,error:code==="BETTER_AUTH_ADMIN_REQUIRED"?"ADMIN_REQUIRED":"ADMIN_AUTH_UNAVAILABLE"},code==="BETTER_AUTH_ADMIN_REQUIRED"?403:503)};
 }
}
export async function readEmailVerificationPolicy(env:AuthWorkerEnv):Promise<boolean>{
 try{const row=await env.DB.prepare("SELECT email_verification_required FROM auth_runtime_settings WHERE id=1").first<{email_verification_required:number}>();return row?.email_verification_required!==0;}catch{return true;}
}
export async function handleAuthRuntimeSettings(request:Request,env:AuthWorkerEnv):Promise<Response>{
 const checked=await requireAdmin(request,env);if("response"in checked)return checked.response;
 if(request.method==="GET"){
  try{const row=await env.DB.prepare("SELECT email_verification_required,updated_at,updated_by FROM auth_runtime_settings WHERE id=1").first<RuntimePolicy>();if(!row)return json({ok:false,error:"AUTH_RUNTIME_SETTINGS_NOT_MIGRATED"},503);return json({ok:true,emailVerificationRequired:row.email_verification_required===1,updatedAt:row.updated_at,updatedBy:row.updated_by});}catch{return json({ok:false,error:"AUTH_RUNTIME_SETTINGS_NOT_MIGRATED"},503)}
 }
 if(request.method!=="PUT")return json({ok:false,error:"METHOD_NOT_ALLOWED"},405);
 const body=await request.json().catch(()=>null) as {emailVerificationRequired?:unknown}|null;
 if(typeof body?.emailVerificationRequired!=="boolean")return json({ok:false,error:"EMAIL_VERIFICATION_POLICY_INVALID"},422);
 try{await env.DB.prepare("UPDATE auth_runtime_settings SET email_verification_required=?1,updated_at=strftime('%Y-%m-%dT%H:%M:%fZ','now'),updated_by=?2 WHERE id=1").bind(body.emailVerificationRequired?1:0,checked.user.id).run();
 const row=await env.DB.prepare("SELECT email_verification_required,updated_at,updated_by FROM auth_runtime_settings WHERE id=1").first<RuntimePolicy>();return json({ok:true,emailVerificationRequired:row?.email_verification_required===1,updatedAt:row?.updated_at,updatedBy:row?.updated_by});}catch{return json({ok:false,error:"AUTH_RUNTIME_SETTINGS_SAVE_FAILED"},503)}
}
