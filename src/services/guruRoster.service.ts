import { supabase } from '@/lib/supabase';

export type GuruRosterStudent = {
  id: string;
  roster_id: string;
  full_name: string;
  class_name: string | null;
  grade: string | null;
  photo_url: string | null;
  external_student_ref: string | null;
  is_active: boolean;
  created_at: string;
  updated_at: string;
};

const projection = 'id,roster_id,full_name,class_name,grade,photo_url,external_student_ref,is_active,created_at,updated_at';

export async function getRosterStudent(studentId: string) {
  const { data, error } = await supabase
    .from('roster_students')
    .select(projection)
    .eq('id', studentId)
    .single();
  if (error) throw error;
  return data as GuruRosterStudent;
}

export async function updateRosterStudent(input: {
  id: string;
  fullName: string;
  className?: string;
  grade?: string;
  externalStudentRef?: string;
  photoUrl?: string | null;
}) {
  const { data, error } = await supabase
    .from('roster_students')
    .update({
      full_name: input.fullName.trim(),
      class_name: input.className?.trim() || null,
      grade: input.grade?.trim() || null,
      external_student_ref: input.externalStudentRef?.trim() || null,
      photo_url: input.photoUrl ?? null,
      updated_at: new Date().toISOString(),
    })
    .eq('id', input.id)
    .select(projection)
    .single();
  if (error) throw error;
  return data as GuruRosterStudent;
}

export async function archiveRosterStudent(studentId: string) {
  const { data, error } = await supabase
    .from('roster_students')
    .update({ is_active: false, updated_at: new Date().toISOString() })
    .eq('id', studentId)
    .select('id,roster_id,is_active')
    .single();
  if (error) throw error;
  return data as Pick<GuruRosterStudent, 'id' | 'roster_id' | 'is_active'>;
}
