import { supabase } from '@/lib/supabase';

export type LinearExamPhase = 'ACTIVE' | 'DECISION' | 'GRACE' | 'COMPLETED';
export type LinearExamAnswer = Record<string, unknown>;

export interface LinearExamOption {
  id: string;
  label: string;
}
export interface LinearExamQuestion {
  id: string;
  type: string;
  prompt: string;
  points: number;
  required: boolean;
  display_order: number;
  options: LinearExamOption[];
}
export interface LinearExamState {
  attempt_id: string;
  attempt_status: string;
  phase: LinearExamPhase;
  position: number;
  total_questions: number;
  question?: LinearExamQuestion;
  question_state?: string;
  question_deadline?: string | null;
  decision_deadline?: string | null;
  grace_deadline?: string | null;
  grace_kind?: 'BORROWED' | 'FREE' | null;
  can_borrow?: boolean;
  time_bank_seconds?: number;
  global_deadline?: string;
  answer?: LinearExamAnswer;
  answered_count: number;
  skipped_count: number;
  timeout_count: number;
  server_now: string;
  message?: string;
}
export type LinearExamActivityEvent = {
  position: number | null;
  event_type: string;
  occurred_at: string;
  metadata: Record<string, unknown>;
};
export type LinearExamActivityParticipant = {
  attempt_id: string;
  participant_name: string;
  participant_kind: 'INDIVIDUAL' | 'COLLECTIVE';
  attempt_status: string;
  phase: LinearExamPhase;
  current_position: number;
  total_questions: number;
  answered_count: number;
  skipped_count: number;
  timeout_count: number;
  current_question_deadline: string | null;
  events: LinearExamActivityEvent[];
};
export type LinearExamActivity = {
  competition_id: string;
  generated_at: string;
  total_count: number;
  page_size: number;
  offset: number;
  has_more: boolean;
  participants: LinearExamActivityParticipant[];
};

function expectState(value: unknown): LinearExamState {
  if (!value || typeof value !== 'object' || !('attempt_id' in value) || !('phase' in value)) {
    throw new Error('Respons mesin ujian tidak valid. Muat ulang halaman dan coba lagi.');
  }
  return value as LinearExamState;
}
async function rpcState(name: string, args: Record<string, unknown>): Promise<LinearExamState> {
  const { data, error } = await supabase.rpc(name, args);
  if (error) throw error;
  return expectState(data);
}
function collectiveArgs(accessToken: string) {
  if (!accessToken) throw new Error('Sesi peserta kolektif berakhir. Silakan login kembali.');
  return { p_access_token: accessToken };
}

export async function startLinearExamAttempt(competitionId: string) {
  return rpcState('start_linear_exam_attempt', { p_competition_id: competitionId });
}

export async function startOrganizerExamPreviewAttempt(competitionId: string) {
  return rpcState('start_organizer_exam_preview', { p_competition_id: competitionId });
}
export async function getLinearExamState(attemptId: string) {
  return rpcState('get_linear_exam_state', { p_attempt_id: attemptId });
}
export async function saveLinearExamDraft(attemptId: string, questionId: string, answer: LinearExamAnswer) {
  return rpcState('save_linear_exam_draft', { p_attempt_id: attemptId, p_question_id: questionId, p_answer_json: answer });
}
export async function answerLinearExamQuestion(attemptId: string, questionId: string, answer: LinearExamAnswer) {
  return rpcState('answer_linear_exam_question', { p_attempt_id: attemptId, p_question_id: questionId, p_answer_json: answer, p_skip: false });
}
export async function chooseLinearExamTimeout(attemptId: string, decision: 'BORROW' | 'CONTINUE') {
  return rpcState('choose_linear_exam_timeout', { p_attempt_id: attemptId, p_decision: decision });
}
export async function resolveLinearExamTimeout(attemptId: string) {
  return rpcState('resolve_linear_exam_timeout', { p_attempt_id: attemptId });
}

export async function startCollectiveLinearExamAttempt(competitionId: string, accessToken: string) {
  return rpcState('start_collective_linear_exam_attempt', { p_competition_id: competitionId, ...collectiveArgs(accessToken) });
}
export async function getCollectiveLinearExamState(attemptId: string, accessToken: string) {
  return rpcState('get_collective_linear_exam_state', { p_attempt_id: attemptId, ...collectiveArgs(accessToken) });
}
export async function saveCollectiveLinearExamDraft(attemptId: string, accessToken: string, questionId: string, answer: LinearExamAnswer) {
  return rpcState('save_collective_linear_exam_draft', { p_attempt_id: attemptId, ...collectiveArgs(accessToken), p_question_id: questionId, p_answer_json: answer });
}
export async function answerCollectiveLinearExamQuestion(attemptId: string, accessToken: string, questionId: string, answer: LinearExamAnswer) {
  return rpcState('answer_collective_linear_exam_question', { p_attempt_id: attemptId, ...collectiveArgs(accessToken), p_question_id: questionId, p_answer_json: answer, p_skip: false });
}
export async function chooseCollectiveLinearExamTimeout(attemptId: string, accessToken: string, decision: 'BORROW' | 'CONTINUE') {
  return rpcState('choose_collective_linear_exam_timeout', { p_attempt_id: attemptId, ...collectiveArgs(accessToken), p_decision: decision });
}
export async function resolveCollectiveLinearExamTimeout(attemptId: string, accessToken: string) {
  return rpcState('resolve_collective_linear_exam_timeout', { p_attempt_id: attemptId, ...collectiveArgs(accessToken) });
}

export async function getLinearExamActivity(competitionId: string, offset = 0, limit = 100): Promise<LinearExamActivity> {
  const { data, error } = await supabase.rpc('get_linear_exam_activity', { p_competition_id: competitionId, p_limit: limit, p_offset: offset });
  if (error) throw error;
  if (!data || typeof data !== 'object') throw new Error('Data pemantauan ujian tidak valid.');
  return data as LinearExamActivity;
}
