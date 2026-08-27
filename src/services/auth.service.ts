import { supabase } from '@/lib/supabase';

export async function signIn(email: string, password: string) {
  const { data, error } = await supabase.auth.signInWithPassword({ email, password });
  if (error) throw error;
  return data;
}

export async function signUp(
  email: string,
  password: string,
  profile: {
    username: string;
    full_name: string;
    account_type: 'student' | 'teacher' | 'organizer';
    birth_date?: string;
    institution?: string;
    grade?: string;
    subjects?: string;
  },
) {
  const { data, error } = await supabase.auth.signUp({
    email,
    password,
    options: { data: profile },
  });
  if (error) throw error;
  return data;
}

export async function signOut() {
  const { error } = await supabase.auth.signOut();
  if (error) throw error;
}

export async function getSession() {
  const { data, error } = await supabase.auth.getSession();
  if (error) throw error;
  return data.session;
}

export function onAuthStateChange(callback: Parameters<typeof supabase.auth.onAuthStateChange>[0]) {
  return supabase.auth.onAuthStateChange(callback);
}

export async function resetPassword(email: string, redirectTo = `${window.location.origin}/#/login`) {
  const { error } = await supabase.auth.resetPasswordForEmail(email, { redirectTo });
  if (error) throw error;
}
