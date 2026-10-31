import { supabase } from '@/lib/supabase';

const attemptSelect = 'id,competition_id,participant_id,canonical_participant_id,collective_participant_id,status,score,submitted_at,finalized_at,attempt_number,is_preview,preview_owner_id,collective_participants:collective_participant_id(full_name,participant_code)';

export async function listGradableAttempts(competitionIds: string[]) {
  if (!competitionIds.length) return [];
  const { data, error } = await supabase
    .from('attempts')
    .select(attemptSelect)
    .in('competition_id', competitionIds)
    .in('status', ['SUBMITTED', 'GRADING'])
    .eq('is_preview', false)
    .order('submitted_at', { ascending: false });
  if (error) throw error;
  return data ?? [];
}

export async function getAttemptForGrading(attemptId: string) {
  const [
    { data: attempt, error: attemptError },
    { data: items, error: itemsError },
    { data: answers, error: answersError },
  ] = await Promise.all([
    supabase.from('attempts').select(attemptSelect).eq('id', attemptId).eq('is_preview', false).single(),
    supabase.from('grading_items').select('id,question_id,score,automatic_score,feedback,grader_id').eq('attempt_id', attemptId).order('created_at'),
    supabase.from('answers').select('question_id,answer_json').eq('attempt_id', attemptId),
  ]);
  if (attemptError) throw attemptError;
  if (itemsError) throw itemsError;
  if (answersError) throw answersError;

  const questionIds = [...new Set((items ?? []).map((item) => String(item.question_id)))];
  let limits: Array<{ question_id: string; max_score: number; question_snapshot: Record<string, unknown> | null }> = [];

  if (questionIds.length > 0) {
    const { data: limitRows, error: limitError } = await supabase.rpc(
      'get_attempt_grading_limits',
      { p_attempt_id: attemptId },
    );
    if (limitError) throw limitError;
    limits = (limitRows ?? []) as Array<{
      question_id: string;
      max_score: number;
      question_snapshot: Record<string, unknown> | null;
    }>;
  }

  const answerMap = new Map((answers ?? []).map((item) => [String(item.question_id), item.answer_json] as const));
  const limitMap = new Map(limits.map((item) => [String(item.question_id), Number(item.max_score)] as const));
  const questionMap = new Map(limits.map((item) => [
    String(item.question_id),
    {
      ...(item.question_snapshot ?? {}),
      id: String(item.question_id),
      points: Number(item.max_score ?? 0),
    },
  ] as const));

  return {
    attempt,
    items: (items ?? []).map((item) => ({
      ...item,
      automatic_score: item.automatic_score == null ? null : Number(item.automatic_score),
      score: Number(item.score ?? 0),
      question: questionMap.get(String(item.question_id)),
      answer: answerMap.get(String(item.question_id)) ?? null,
    })),
  };
}

export async function saveManualGrade(gradingItemId: string, score: number, feedback?: string) {
  const { data, error } = await supabase.rpc('save_manual_grading_item', {
    p_grading_item_id: gradingItemId,
    p_score: score,
    p_feedback: feedback?.trim() || null,
  });
  if (error) throw error;
  return data;
}

/**
 * The server owns the final score calculation. p_score is retained in the RPC
 * signature for compatibility, but the database intentionally ignores it.
 */
export async function finalizeManualAttempt(attemptId: string, reason = 'Manual grading finalized') {
  const { data, error } = await supabase.rpc('finalize_attempt_manual', {
    p_attempt_id: attemptId,
    p_score: 0,
    p_reason: reason,
  });
  if (error) throw error;
  return data;
}
