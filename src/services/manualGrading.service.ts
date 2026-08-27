import { supabase } from '@/lib/supabase';

export async function listGradableAttempts(competitionIds: string[]) {
  if (!competitionIds.length) return [];
  const { data, error } = await supabase.from('attempts').select('id,competition_id,participant_id,status,submitted_at,attempt_number').in('competition_id', competitionIds).in('status', ['SUBMITTED','GRADING']).order('submitted_at', { ascending: false });
  if (error) throw error;
  return data ?? [];
}

export async function getAttemptForGrading(attemptId: string) {
  const [{ data: attempt, error: attemptError }, { data: items, error: itemsError }, { data: answers, error: answersError }] = await Promise.all([
    supabase.from('attempts').select('id,competition_id,participant_id,status,submitted_at,attempt_number').eq('id', attemptId).single(),
    supabase.from('grading_items').select('id,question_id,score,feedback,grader_id').eq('attempt_id', attemptId).order('created_at'),
    supabase.from('answers').select('question_id,answer_json').eq('attempt_id', attemptId),
  ]);
  if (attemptError) throw attemptError;
  if (itemsError) throw itemsError;
  if (answersError) throw answersError;
  const questionIds = [...new Set((items ?? []).map((x: any) => x.question_id))];
  const { data: questions, error: questionsError } = questionIds.length
    ? await supabase.from('questions').select('id,prompt,type,points,display_order').in('id', questionIds).order('display_order')
    : { data: [], error: null };
  if (questionsError) throw questionsError;
  const answerMap = new Map((answers ?? []).map((x: any) => [String(x.question_id), x.answer_json]));
  const questionMap = new Map((questions ?? []).map((x: any) => [String(x.id), x]));
  return {
    attempt,
    items: (items ?? []).map((item: any) => ({ ...item, question: questionMap.get(String(item.question_id)), answer: answerMap.get(String(item.question_id)) ?? null })),
  };
}

export async function saveManualGrade(gradingItemId: string, score: number, feedback?: string) {
  const { data, error } = await supabase.rpc('save_manual_grading_item', { p_grading_item_id: gradingItemId, p_score: score, p_feedback: feedback?.trim() || null });
  if (error) throw error;
  return data;
}

export async function finalizeManualAttempt(attemptId: string, reason = 'Manual grading finalized') {
  const { data: items, error: itemsError } = await supabase.from('grading_items').select('score').eq('attempt_id', attemptId);
  if (itemsError) throw itemsError;
  const score = (items ?? []).reduce((sum: number, item: any) => sum + Number(item.score ?? 0), 0);
  const { data, error } = await supabase.rpc('finalize_attempt_manual', { p_attempt_id: attemptId, p_score: score, p_reason: reason });
  if (error) throw error;
  return data;
}
