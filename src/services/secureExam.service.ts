import { supabase } from '@/lib/supabase';

export type SecureExamPhase = 'ACTIVE' | 'TIMEOUT_DECISION' | 'OVERTIME' | 'FINISHED';
export type SecureExamQuestion = {
  id: string;
  type: string;
  prompt: string;
  points: number;
  required: boolean;
  display_order: number;
  options: Array<{ id: string; label: string }>;
  config: Record<string, unknown>;
  answer: Record<string, unknown> | null;
};
export type SecureExamState = {
  attempt_id: string;
  competition_id: string;
  attempt_status: string;
  phase: SecureExamPhase;
  position: number;
  total_questions: number;
  base_seconds: number;
  time_bank_seconds: number;
  grace_remaining_seconds: number;
  current_deadline: string | null;
  decision_deadline: string | null;
  overtime_deadline: string | null;
  exam_deadline: string;
  server_now: string;
  answered_count: number;
  skipped_count: number;
  timeout_count: number;
  current_question_status: string;
  question: SecureExamQuestion | null;
};

export function secureExamSessionKey(competitionId: string): string {
  const storageKey = 'syka_secure_exam_session_' + competitionId;
  let key = sessionStorage.getItem(storageKey);
  if (!key) {
    key = crypto.randomUUID();
    sessionStorage.setItem(storageKey, key);
  }
  return key;
}

async function rpcData<T>(name: string, args: Record<string, unknown>): Promise<T> {
  const { data, error } = await supabase.rpc(name as never, args as never);
  if (error) throw error;
  if (!data || typeof data !== 'object') throw new Error('Status ujian tidak dapat dibaca dari server.');
  return data as T;
}

function accessArgs(competitionId: string, accessToken?: string | null) {
  return {
    p_session_key: secureExamSessionKey(competitionId),
    p_access_token: accessToken || null,
  };
}

export async function startSecureExamAttempt(competitionId: string, accessToken?: string | null) {
  return rpcData<SecureExamState>('start_secure_exam_attempt', {
    p_competition_id: competitionId,
    ...accessArgs(competitionId, accessToken),
  });
}
export async function getSecureExamState(attemptId: string, competitionId: string, accessToken?: string | null) {
  return rpcData<SecureExamState>('get_secure_exam_state', {
    p_attempt_id: attemptId,
    ...accessArgs(competitionId, accessToken),
  });
}
export async function saveSecureExamAnswer(
  attemptId: string, competitionId: string, answer: Record<string, unknown>, accessToken?: string | null,
) {
  return rpcData<SecureExamState>('secure_exam_save_current_answer', {
    p_attempt_id: attemptId,
    ...accessArgs(competitionId, accessToken),
    p_answer_json: answer,
  });
}
export async function answerAndAdvanceSecureExam(
  attemptId: string, competitionId: string, answer: Record<string, unknown>, accessToken?: string | null,
) {
  return rpcData<SecureExamState>('secure_exam_answer_and_advance', {
    p_attempt_id: attemptId,
    ...accessArgs(competitionId, accessToken),
    p_answer_json: answer,
  });
}
export async function skipSecureExamQuestion(attemptId: string, competitionId: string, accessToken?: string | null) {
  return rpcData<SecureExamState>('secure_exam_skip_current', {
    p_attempt_id: attemptId,
    ...accessArgs(competitionId, accessToken),
  });
}
export async function resolveSecureExamTimeout(
  attemptId: string, competitionId: string, action: 'borrow' | 'grace' | 'skip', accessToken?: string | null,
) {
  return rpcData<SecureExamState>('secure_exam_resolve_timeout', {
    p_attempt_id: attemptId,
    ...accessArgs(competitionId, accessToken),
    p_action: action,
  });
}

export type SecureExamMonitor = {
  competition_id: string;
  server_now: string;
  attempts: Array<{
    attempt_id: string;
    participant_name: string;
    participant_type: string;
    attempt_status: string;
    phase: SecureExamPhase;
    current_position: number;
    total_questions: number;
    answered_count: number;
    skipped_count: number;
    timeout_count: number;
    questions: Array<{
      position: number;
      status: string;
      opened_at: string | null;
      closed_at: string | null;
      allocated_seconds: number;
      spent_seconds: number;
      borrowed_seconds: number;
    }>;
  }>;
};
export async function getSecureExamMonitor(competitionId: string): Promise<SecureExamMonitor> {
  return rpcData<SecureExamMonitor>('get_secure_exam_monitor', { p_competition_id: competitionId });
}
