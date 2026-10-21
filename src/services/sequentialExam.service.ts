import { supabase } from '@/lib/supabase';
import { collectiveAccessToken } from '@/services/collectiveParticipant.service';

export type ExamMode = 'individual' | 'collective';
export type ExamPhase = 'ACTIVE' | 'TIMEOUT_DECISION' | 'OVERTIME' | 'COMPLETED';

export interface SequentialQuestion {
  id: string;
  index: number;
  type: string;
  prompt: string;
  points: number;
  required: boolean;
  config: Record<string, unknown>;
  options: Array<{ id: string; label: string }>;
}

export interface SequentialExamState {
  attempt_id: string;
  attempt_status: string;
  state: ExamPhase;
  question_index: number;
  question_count: number;
  base_seconds: number;
  time_bank_seconds: number;
  current_allocated_seconds: number;
  question_deadline: string | null;
  decision_deadline: string | null;
  overtime_deadline: string | null;
  overtime_type: 'NONE' | 'BORROW' | 'GRACE';
  borrow_seconds: number;
  can_borrow: boolean;
  server_now: string;
  question: SequentialQuestion | null;
  saved_answer: string | string[] | null;
}

export interface OrganizerExamConfig {
  competition_id: string;
  duration_seconds: number;
  question_count: number | null;
  attempt_limit: number;
  randomize_questions: boolean;
  randomize_options: boolean;
  decision_window_seconds: number;
  borrow_seconds: number;
  overtime_grace_seconds: number;
  min_next_question_seconds: number;
  frozen_at: string | null;
  frozen: boolean;
  published_question_count: number;
}

export interface OrganizerExamMonitor {
  total: number;
  active: number;
  completed: number;
  timed_out: number;
  skipped: number;
  sessions: Array<{
    attempt_id: string;
    attempt_status: string;
    participant_name: string;
    participant_code: string | null;
    started_at: string | null;
    submitted_at: string | null;
    current_question_index: number | null;
    question_count: number;
    exam_state: string;
    current_question_deadline: string | null;
    answered_count: number;
    timeout_count: number;
    skipped_count: number;
    questions: Array<{
      question_index: number;
      state: string;
      allocated_seconds: number;
      elapsed_seconds: number;
      borrowed_seconds: number;
      grace_seconds_used: number;
      opened_at: string | null;
      closed_at: string | null;
    }>;
  }>;
}

function token() {
  const value = collectiveAccessToken();
  if (!value) throw new Error('Sesi peserta kolektif telah berakhir. Silakan masuk kembali.');
  return value;
}

function unwrapState(data: unknown): SequentialExamState {
  if (!data || typeof data !== 'object' || Array.isArray(data)) {
    throw new Error('Server tidak mengembalikan status ujian yang valid.');
  }
  return data as SequentialExamState;
}

export async function startSequentialExam(competitionId: string, mode: ExamMode): Promise<SequentialExamState> {
  const { data, error } = mode === 'collective'
    ? await supabase.rpc('start_collective_sequential_exam', { p_access_token: token(), p_competition_id: competitionId })
    : await supabase.rpc('start_sequential_exam', { p_competition_id: competitionId });
  if (error) throw error;
  return unwrapState(data);
}

export async function getSequentialExamState(attemptId: string, mode: ExamMode): Promise<SequentialExamState> {
  const { data, error } = mode === 'collective'
    ? await supabase.rpc('get_collective_sequential_exam_state', { p_access_token: token(), p_attempt_id: attemptId })
    : await supabase.rpc('get_sequential_exam_state', { p_attempt_id: attemptId });
  if (error) throw error;
  return unwrapState(data);
}

export async function saveSequentialExamAnswer(
  attemptId: string,
  questionId: string,
  value: string | string[],
  mode: ExamMode,
): Promise<SequentialExamState> {
  const answer = Array.isArray(value) ? { values: value } : { value };
  const { data, error } = mode === 'collective'
    ? await supabase.rpc('save_collective_sequential_exam_answer', {
        p_access_token: token(), p_attempt_id: attemptId, p_question_id: questionId, p_answer_json: answer,
      })
    : await supabase.rpc('save_sequential_exam_answer', {
        p_attempt_id: attemptId, p_question_id: questionId, p_answer_json: answer,
      });
  if (error) throw error;
  return unwrapState(data);
}

export async function advanceSequentialExam(attemptId: string, mode: ExamMode): Promise<SequentialExamState> {
  const { data, error } = mode === 'collective'
    ? await supabase.rpc('advance_collective_sequential_exam_question', { p_access_token: token(), p_attempt_id: attemptId })
    : await supabase.rpc('advance_sequential_exam_question', { p_attempt_id: attemptId });
  if (error) throw error;
  return unwrapState(data);
}

export async function resolveSequentialExamTimeout(
  attemptId: string,
  action: 'BORROW' | 'CONTINUE',
  mode: ExamMode,
): Promise<SequentialExamState> {
  const { data, error } = mode === 'collective'
    ? await supabase.rpc('resolve_collective_sequential_exam_timeout', {
        p_access_token: token(), p_attempt_id: attemptId, p_action: action,
      })
    : await supabase.rpc('resolve_sequential_exam_timeout', { p_attempt_id: attemptId, p_action: action });
  if (error) throw error;
  return unwrapState(data);
}

export async function getOrganizerExamConfig(competitionId: string): Promise<OrganizerExamConfig> {
  const { data, error } = await supabase.rpc('get_organizer_exam_config', { p_competition_id: competitionId });
  if (error) throw error;
  if (!data || typeof data !== 'object') throw new Error('Konfigurasi ujian tidak tersedia.');
  return data as OrganizerExamConfig;
}

export async function saveOrganizerExamConfig(competitionId: string, config: Partial<OrganizerExamConfig>): Promise<OrganizerExamConfig> {
  const { data, error } = await supabase.rpc('save_organizer_exam_config', {
    p_competition_id: competitionId,
    p_config: config,
  });
  if (error) throw error;
  return data as OrganizerExamConfig;
}

export async function getOrganizerExamMonitor(competitionId: string): Promise<OrganizerExamMonitor> {
  const { data, error } = await supabase.rpc('get_organizer_exam_monitor', { p_competition_id: competitionId });
  if (error) throw error;
  if (!data || typeof data !== 'object') return { total: 0, active: 0, completed: 0, timed_out: 0, skipped: 0, sessions: [] };
  return data as OrganizerExamMonitor;
}
