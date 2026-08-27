import { supabase } from '@/lib/supabase';

export interface LiveDailyTask {
  id: string;
  title: string;
  description: string;
  taskType: string;
  points: number;
  exp: number;
  startsAt: string | null;
  endsAt: string | null;
  maxClaimsPerUser: number | null;
  completed: boolean;
  claimStatus: string | null;
  claimedAt: string | null;
  completedAt: string | null;
}

export async function getDailyTasks(): Promise<LiveDailyTask[]> {
  const { data: userData } = await supabase.auth.getUser();
  if (!userData.user) throw new Error('LOGIN_REQUIRED');

  const [{ data: tasks, error: taskError }, { data: claims, error: claimError }] = await Promise.all([
    supabase.from('daily_tasks').select('*').eq('is_active', true).order('sort_order', { ascending: true }),
    supabase.from('daily_task_claims').select('*').eq('user_id', userData.user.id).eq('claim_date', new Date().toISOString().slice(0, 10)),
  ]);

  if (taskError) throw taskError;
  if (claimError) throw claimError;

  const byTask = new Map((claims ?? []).map((claim: any) => [claim.task_id, claim]));
  const now = Date.now();

  return (tasks ?? [])
    .filter((task: any) => {
      const start = task.starts_at ? new Date(task.starts_at).getTime() : -Infinity;
      const end = task.ends_at ? new Date(task.ends_at).getTime() : Infinity;
      return start <= now && end >= now;
    })
    .map((task: any) => {
      const claim: any = byTask.get(task.id);
      return {
        id: task.id,
        title: task.title,
        description: task.description ?? '',
        taskType: task.task_type ?? 'assignment',
        points: Number(task.points ?? 0),
        exp: Number(task.exp ?? 0),
        startsAt: task.starts_at,
        endsAt: task.ends_at,
        maxClaimsPerUser: task.max_claims_per_user,
        completed: claim?.status === 'COMPLETED',
        claimStatus: claim?.status ?? null,
        claimedAt: claim?.claimed_at ?? null,
        completedAt: claim?.completed_at ?? null,
      };
    });
}

export async function completeDailyTask(taskId: string) {
  const { data, error } = await supabase.rpc('complete_daily_task', { p_task_id: taskId });
  if (error) throw error;
  return data;
}

export async function claimAndCompleteDailyTask(taskId: string) {
  const { error: claimError } = await supabase.rpc('claim_daily_task', { p_task_id: taskId });
  if (claimError) throw claimError;
  return completeDailyTask(taskId);
}
