import { supabase } from '@/lib/supabase';
import { env } from '@/lib/env';
import { getStagingBetterAuthClient, isBetterAuthFrontendEnabledForSupabase } from '@/services/betterAuthApi.client';
import {
  broadcastBetterAuthSessionEvent,
  createBetterAuthSessionBridge,
} from '@/services/betterAuthSessionBridge.mjs';
import { publishAuthSessionEvent } from '@/services/authSessionEvents.mjs';

export const LOGIN_REJECTION_SIGNOUT_KEY = 'syka_login_rejection_signout_v1';

/** True only for the exact non-production Better Auth preview + staging project. */
export function isBetterAuthEnabled(): boolean {
  return isBetterAuthFrontendEnabledForSupabase(env.supabaseUrl);
}

/** Keep password changes behind the same provider boundary as sign-in/session handling. */
export async function updatePassword(newPassword: string, currentPassword?: string): Promise<void> {
  if (isBetterAuthFrontendEnabledForSupabase(env.supabaseUrl)) {
    if (!currentPassword) throw new Error('AUTH_CURRENT_PASSWORD_REQUIRED');
    await getStagingBetterAuthClient().changePassword(currentPassword, newPassword, true);
    return;
  }

  const { error } = await supabase.auth.updateUser({ password: newPassword });
  if (error) throw error;
}

export interface ApplicationAuthSession {
  user: {
    id: string;
    email?: string;
  };
}

export type ApplicationAuthEvent =
  | 'INITIAL_SESSION'
  | 'SIGNED_IN'
  | 'SIGNED_OUT'
  | 'TOKEN_REFRESHED'
  | 'USER_UPDATED'
  | 'PASSWORD_RECOVERY'
  | 'MFA_CHALLENGE_VERIFIED';

export type ApplicationAuthListener = (
  event: ApplicationAuthEvent,
  session: ApplicationAuthSession | null,
) => void;

type ApplicationAuthSubscription = {
  data: { subscription: { unsubscribe: () => void } };
};

function toApplicationSession(
  value: Awaited<ReturnType<ReturnType<typeof getStagingBetterAuthClient>['getSession']>>,
): ApplicationAuthSession | null {
  if (!value) return null;
  return {
    user: {
      id: value.user.id,
      email: value.user.email,
    },
  };
}

export async function signIn(email: string, password: string) {
  if (isBetterAuthFrontendEnabledForSupabase(env.supabaseUrl)) {
    const client = getStagingBetterAuthClient();
    await client.signInWithEmail(email.trim(), password);
    const session = await client.getSession();
    if (!session) throw new Error('AUTH_SESSION_NOT_CREATED');
    publishAuthSessionEvent('SIGNED_IN', session.user.id);
    broadcastBetterAuthSessionEvent('SIGNED_IN');
    return { user: session.user, session: session.session };
  }

  const { data, error } = await supabase.auth.signInWithPassword({ email, password });
  if (error) throw error;
  return data;
}

export async function signInWithSocial(
  provider: 'google' | 'facebook' | 'twitter',
  callbackURL: string,
) {
  if (!isBetterAuthFrontendEnabledForSupabase(env.supabaseUrl)) {
    throw new Error('BETTER_AUTH_SOCIAL_SIGNIN_DISABLED');
  }
  const result = await getStagingBetterAuthClient().signInWithSocial(provider, callbackURL);
  if (result.url) window.location.assign(result.url);
  return result;
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
    referral_id?: string;
  },
) {
  if (isBetterAuthFrontendEnabledForSupabase(env.supabaseUrl)) {
    return getStagingBetterAuthClient().signUp({
      email,
      password,
      name: profile.full_name,
      username: profile.username,
      accountType: profile.account_type,
      ...(profile.birth_date ? { birthDate: profile.birth_date } : {}),
      ...(profile.institution ? { institution: profile.institution } : {}),
      ...(profile.grade ? { grade: profile.grade } : {}),
      ...(profile.subjects ? { subjects: profile.subjects } : {}),
      ...(profile.referral_id ? { referralCode: profile.referral_id } : {}),
    });
  }

  const { data, error } = await supabase.auth.signUp({
    email,
    password,
    options: { data: profile },
  });
  if (error) throw error;
  return data;
}

export async function signOut() {
  if (isBetterAuthFrontendEnabledForSupabase(env.supabaseUrl)) {
    await getStagingBetterAuthClient().signOut();
    publishAuthSessionEvent('SIGNED_OUT', null);
    broadcastBetterAuthSessionEvent('SIGNED_OUT');
    return;
  }

  const { error } = await supabase.auth.signOut({ scope: 'local' });
  if (error) throw error;
}

export async function getSession(): Promise<ApplicationAuthSession | null> {
  if (isBetterAuthFrontendEnabledForSupabase(env.supabaseUrl)) {
    return toApplicationSession(await getStagingBetterAuthClient().getSession());
  }

  const { data, error } = await supabase.auth.getSession();
  if (error) throw error;
  return data.session;
}

export function onAuthStateChange(
  callback: ApplicationAuthListener,
): ApplicationAuthSubscription {
  if (!isBetterAuthFrontendEnabledForSupabase(env.supabaseUrl)) {
    return supabase.auth.onAuthStateChange((event, session) => {
      callback(
        event as ApplicationAuthEvent,
        session as ApplicationAuthSession | null,
      );
    });
  }

  const client = getStagingBetterAuthClient();
  const bridge = createBetterAuthSessionBridge({
    getSession: async () => {
      const session = await client.getSession();
      return session
        ? { user: { id: session.user.id, email: session.user.email }, session: { expiresAt: session.session.expiresAt } }
        : null;
    },
    onChange: (event, session) => {
      callback(
        event as ApplicationAuthEvent,
        session ? { user: { id: session.user.id, email: session.user.email } } : null,
      );
    },
  });

  return {
    data: {
      subscription: {
        unsubscribe: () => bridge.unsubscribe(),
      },
    },
  };
}

export async function resetPassword(
  email: string,
  redirectTo = `${window.location.origin}/#/login`,
) {
  if (isBetterAuthFrontendEnabledForSupabase(env.supabaseUrl)) {
    await getStagingBetterAuthClient().requestPasswordReset(email, redirectTo);
    return;
  }

  const { error } = await supabase.auth.resetPasswordForEmail(email, { redirectTo });
  if (error) throw error;
}
