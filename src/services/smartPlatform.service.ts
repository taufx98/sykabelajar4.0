import { supabase } from '@/lib/supabase';

export type LearningRecommendation = {
  id: string;
  title: string;
  slug: string;
  category: string | null;
  short_description: string | null;
  poster_url: string | null;
  status: string;
  registration_ends_at: string | null;
  starts_at: string | null;
  created_at: string;
};

export type LearningInsights = {
  attempt_count: number;
  average_score: number;
  best_score: number;
  focus_categories: string[];
  recommendations: LearningRecommendation[];
  generated_at: string;
};

export async function getMyLearningInsights(): Promise<LearningInsights> {
  const { data, error } = await supabase.rpc('get_my_learning_insights');
  if (error) throw error;
  const row = (data ?? {}) as Record<string, unknown>;
  return {
    attempt_count: Number(row.attempt_count ?? 0),
    average_score: Number(row.average_score ?? 0),
    best_score: Number(row.best_score ?? 0),
    focus_categories: Array.isArray(row.focus_categories) ? row.focus_categories.map(String) : [],
    recommendations: Array.isArray(row.recommendations) ? row.recommendations as LearningRecommendation[] : [],
    generated_at: String(row.generated_at ?? ''),
  };
}
