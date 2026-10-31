import { supabase } from '@/lib/supabase';

export interface TeacherAchievementCertificate {
  certificate_id: string;
  certificate_type: 'INDIVIDUAL' | 'COLLECTIVE';
  serial_number: string | null;
  certificate_url: string | null;
  issued_at: string | null;
}

export interface TeacherAchievementCompetition {
  competition_id: string;
  competition_title: string;
  competition_slug: string | null;
  competition_status: string;
  attempt_status: string;
  result_published: boolean;
  score: number | null;
  rank: number | null;
  certificates: TeacherAchievementCertificate[];
}

export interface TeacherPublicAward {
  award_id: string;
  title: string;
  rank_code: string | null;
  points: number;
  competition_id: string | null;
  competition_title: string | null;
  issued_at: string;
}

export interface TeacherAchievementStudent {
  student_id: string;
  full_name: string;
  class_name: string | null;
  grade: string | null;
  photo_url: string | null;
  is_active: boolean;
  roster_name: string;
  total_competitions: number;
  published_results: number;
  certificates_issued: number;
  public_awards: number;
  best_score: number | null;
  best_rank: number | null;
  average_score: number | null;
  competitions: TeacherAchievementCompetition[];
  awards: TeacherPublicAward[];
}

export interface TeacherAchievementSummary {
  students_total: number;
  active_students: number;
  competition_entries: number;
  published_results: number;
  certificates_issued: number;
  public_awards: number;
  average_score: number | null;
}

export interface TeacherAchievementReport {
  summary: TeacherAchievementSummary;
  students: TeacherAchievementStudent[];
  total_students: number;
  limit: number;
  offset: number;
  generated_at: string;
}

export async function getTeacherAchievementReport(input: {
  limit?: number;
  offset?: number;
  search?: string;
} = {}): Promise<TeacherAchievementReport> {
  const { data, error } = await supabase.rpc('get_teacher_achievement_report', {
    p_limit: input.limit ?? 50,
    p_offset: input.offset ?? 0,
    p_search: input.search?.trim() || null,
  });

  if (error) throw error;
  if (!data || typeof data !== 'object' || !('summary' in data) || !('students' in data)) {
    throw new Error('Format laporan prestasi guru dari server tidak valid.');
  }

  return data as TeacherAchievementReport;
}
