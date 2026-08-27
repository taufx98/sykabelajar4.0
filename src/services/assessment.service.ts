import { supabase } from '@/lib/supabase';
import type { Question } from '@/types';

export interface ParticipantQuestion extends Question {
  displayOrder?: number;
  config?: Record<string, unknown>;
}

export interface Attempt {
  id: string;
  competition_id: string;
  participant_id: string;
  registration_id: string;
  attempt_number: number;
  status: string;
  started_at: string;
  expires_at: string | null;
  submitted_at: string | null;
}

export async function getParticipantQuestions(competitionId: string): Promise<ParticipantQuestion[]> {
  const { data, error } = await supabase.rpc('get_participant_questions', { p_competition_id: competitionId });
  if (error) throw error;
  return ((data ?? []) as Array<Record<string, unknown>>).map((q) => ({
    id: String(q.id),
    type: String(q.type) as Question['type'],
    prompt: String(q.prompt ?? ''),
    points: Number(q.points ?? 0),
    required: Boolean(q.required),
    displayOrder: Number(q.display_order ?? 0),
    options: Array.isArray(q.options) ? q.options.map((o: any) => ({ id: String(o.id), label: String(o.label ?? '') })) : [],
    config: (q.config && typeof q.config === 'object' ? q.config : {}) as Record<string, unknown>,
  }));
}

export async function startAttempt(competitionId: string): Promise<Attempt> {
  const { data, error } = await supabase.rpc('start_competition_attempt', { p_competition_id: competitionId });
  if (error) throw error;
  if (!data) throw new Error('Attempt tidak berhasil dibuat.');
  return data as Attempt;
}

export async function getAttemptAnswers(attemptId: string) {
  const { data, error } = await supabase.from('answers').select('question_id,answer_json').eq('attempt_id', attemptId);
  if (error) throw error;
  return Object.fromEntries(((data ?? []) as any[]).map((row) => [String(row.question_id), String(row.answer_json?.value ?? row.answer_json ?? '')]));
}

export async function saveAnswer(attemptId: string, questionId: string, value: string) {
  const { data, error } = await supabase.rpc('save_attempt_answer', {
    p_attempt_id: attemptId,
    p_question_id: questionId,
    p_answer_json: { value },
  });
  if (error) throw error;
  return data;
}

export async function submitAttempt(attemptId: string): Promise<Attempt> {
  const idempotencyKey = crypto.randomUUID();
  const { data, error } = await supabase.rpc('submit_competition_attempt', {
    p_attempt_id: attemptId,
    p_idempotency_key: idempotencyKey,
  });
  if (error) throw error;
  if (!data) throw new Error('Attempt tidak berhasil dikirim.');
  return data as Attempt;
}
