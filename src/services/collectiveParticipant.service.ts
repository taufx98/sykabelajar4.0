import { supabase } from '@/lib/supabase';

export type TeacherRoster = {
  id: string;
  name: string;
  description: string | null;
  school_id: string | null;
  is_active: boolean;
  created_at: string;
};

export type RosterStudent = {
  id: string;
  roster_id: string;
  full_name: string;
  class_name: string | null;
  grade: string | null;
  photo_url: string | null;
  external_student_ref: string | null;
  is_active: boolean;
};

export type CollectiveParticipant = {
  participant_id: string;
  competition_id: string;
  competition_title: string;
  roster_student_id: string;
  participant_code: string;
  full_name: string;
  class_name: string | null;
  grade: string | null;
  photo_url: string | null;
  status: string;
  enabled: boolean;
  password_version: number;
  last_login_at: string | null;
  created_at: string;
};

export async function listTeacherRosters() {
  const { data, error } = await supabase.from('teacher_rosters').select('id,name,description,school_id,is_active,created_at').eq('is_active', true).order('created_at', { ascending: false });
  if (error) throw error;
  return (data ?? []) as TeacherRoster[];
}

export async function createTeacherRoster(name: string, description = '', schoolId?: string | null) {
  const { data, error } = await supabase.from('teacher_rosters').insert({ name: name.trim(), description: description.trim() || null, school_id: schoolId ?? null }).select('id,name,description,school_id,is_active,created_at').single();
  if (error) throw error;
  return data as TeacherRoster;
}

export async function listRosterStudents(rosterId: string) {
  const { data, error } = await supabase.from('roster_students').select('id,roster_id,full_name,class_name,grade,photo_url,external_student_ref,is_active').eq('roster_id', rosterId).eq('is_active', true).order('full_name', { ascending: true });
  if (error) throw error;
  return (data ?? []) as RosterStudent[];
}

export async function addRosterStudent(input: { rosterId: string; fullName: string; className?: string; grade?: string; externalStudentRef?: string }) {
  const { data, error } = await supabase.from('roster_students').insert({ roster_id: input.rosterId, full_name: input.fullName.trim(), class_name: input.className?.trim() || null, grade: input.grade?.trim() || null, external_student_ref: input.externalStudentRef?.trim() || null }).select('id,roster_id,full_name,class_name,grade,photo_url,external_student_ref,is_active').single();
  if (error) throw error;
  return data as RosterStudent;
}

export async function listCollectiveCompetitions() {
  const { data, error } = await supabase.from('competitions').select('id,title,participant_mode,status,starts_at,ends_at').in('participant_mode', ['COLLECTIVE_TEACHER', 'COLLECTIVE_ORGANIZATION']).order('starts_at', { ascending: true });
  if (error) throw error;
  return data ?? [];
}

export async function createCollectiveParticipants(competitionId: string, rosterStudentIds: string[]) {
  const { data, error } = await supabase.rpc('create_collective_participants', { p_competition_id: competitionId, p_roster_student_ids: rosterStudentIds });
  if (error) throw error;
  return data ?? [];
}

export async function listTeacherCollectiveParticipants(competitionId?: string) {
  const { data, error } = await supabase.rpc('list_teacher_collective_participants', { p_competition_id: competitionId ?? null });
  if (error) throw error;
  return (data ?? []) as CollectiveParticipant[];
}

export async function regenerateCollectiveParticipantPassword(participantId: string) {
  const { data, error } = await supabase.rpc('regenerate_collective_participant_password', { p_participant_id: participantId });
  if (error) throw error;
  return Array.isArray(data) ? data[0] : data;
}

export async function verifyCollectiveParticipantAccess(code: string, password: string) {
  const { data, error } = await supabase.rpc('verify_collective_participant_access', { p_participant_code: code.trim(), p_password: password });
  if (error) throw error;
  return data as Record<string, unknown>;
}
