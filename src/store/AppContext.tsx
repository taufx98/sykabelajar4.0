import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import type { Role, User, AppNotification, Order, Award, Certificate, FeedPost } from '@/types';
import { supabase } from '@/lib/supabase';
import {
  signIn,
  signUp,
  signOut,
  getSession as getAuthSession,
  onAuthStateChange,
  LOGIN_REJECTION_SIGNOUT_KEY,
} from '@/services/auth.service';
import { getAuthenticatedProfileById, getProfileById, updateProfile as updateProfileRecord } from '@/services/profile.service';
import { loadAwards } from '@/services/runtime.service';
import { liveAwards } from '@/data/live';
import { getUserRoles, uiRoleToAccountType, type BackendRole } from '@/services/role.service';
import { getUnreadNotificationCount } from '@/services/notification.service';
import { toast as globalToast } from '@/lib/toast';
import { publishAuthSessionEvent } from '@/services/authSessionEvents.mjs';
import { createAuthHydrationGate } from '@/services/authHydrationGate.mjs';

interface AppState {
  user: User | null;
  isAuthenticated: boolean;
  authLoading: boolean;
  authUnavailable: boolean;
  retryAuthSession: () => Promise<void>;
  isGuest: boolean;
  notifications: AppNotification[];
  unreadNotificationCount: number;
  refreshUnreadCount: () => Promise<void>;
  awards: Award[];
  certificates: Certificate[];
  orders: Order[];
  feed: FeedPost[];
  login: (email: string, password: string) => Promise<{ ok: boolean; error?: string }>;
  register: (data: Partial<User> & { email: string; password: string; referralCode?: string }) => Promise<{ ok: boolean; error?: string }>;
  loginAsGuest: () => void;
  logout: () => Promise<void>;
  updateProfile: (data: Partial<User>) => Promise<void>;
  markNotificationRead: (id: string) => Promise<void>;
  markAllNotificationsRead: () => Promise<void>;
  addPoints: (points: number) => Promise<void>;
  addNotification: (n: Omit<AppNotification, 'id' | 'createdAt' | 'read'>) => Promise<void>;
  addOrder: (order: Order) => void;
  togglePostLike: (postId: string) => Promise<void>;
  toggleCommentLike: (postId: string, commentId: string, replyId?: string) => Promise<void>;
  addComment: (postId: string, body: string, parentId?: string) => Promise<void>;
  toast: (message: string, type?: 'success' | 'error' | 'info') => void;
  refreshUser: () => Promise<void>;
}

const AppContext = createContext<AppState | null>(null);
const GUEST_KEY = 'sykabelajar_guest_mode_v1';
const IDLE_TIMEOUT_MS = 25 * 60 * 1000;
const LAST_ACTIVITY_KEY = 'sykabelajar_last_activity_v1';
const ACTIVITY_PERSIST_INTERVAL_MS = 5000;
const AUTH_READ_RETRY_DELAYS_MS = [150, 400] as const;

function authErrorCode(error: unknown): string {
  if (!error || typeof error !== 'object') return '';
  const value = error as { code?: unknown; message?: unknown };
  const code = typeof value.code === 'string' ? value.code : '';
  const message = typeof value.message === 'string' ? value.message : '';
  return code || (/^[A-Z0-9_]{2,80}$/.test(message) ? message : '');
}

function isTransientAuthReadError(error: unknown): boolean {
  const value = error && typeof error === 'object'
    ? error as { status?: unknown; statusCode?: unknown }
    : {};
  const status = Number(value.status ?? value.statusCode ?? 0);
  const code = authErrorCode(error);
  if (status === 429 || status >= 500) return true;
  if ([
    'AUTH_REQUEST_FAILED',
    'AUTH_WORKER_UNAVAILABLE',
    'AUTH_WORKER_BAD_RESPONSE',
    'AUTH_SERVICE_UNAVAILABLE',
    'AUTH_RESOURCE_TOKEN_UNAVAILABLE',
    'AUTH_RESOURCE_TOKEN_EXCHANGE_FAILED',
    'AUTH_OAUTH_CALLBACK_TIMEOUT',
  ].includes(code)) return true;
  return error instanceof TypeError && /fetch|network|load failed/i.test(error.message);
}

function isDefinitiveAuthRejection(error: unknown): boolean {
  const code = authErrorCode(error);
  const value = error && typeof error === 'object'
    ? error as { status?: unknown; statusCode?: unknown }
    : {};
  const status = Number(value.status ?? value.statusCode ?? 0);
  return status === 401 ||
    [
      'AUTH_SESSION_EXPIRED',
      'AUTH_SESSION_REQUIRED',
      'AUTHENTICATION_REQUIRED',
      'EMAIL_VERIFICATION_REQUIRED',
      'EMAIL_NOT_VERIFIED',
      'EMAIL_NOT_CONFIRMED',
    ].includes(code);
}

function isDefinitiveIdentityFailure(error: unknown): boolean {
  const code = authErrorCode(error);
  return code === 'PROFILE_NOT_FOUND' || code === 'ROLE_NOT_ASSIGNED';
}

async function retryTransientAuthRead<T>(operation: () => Promise<T>): Promise<T> {
  for (let attempt = 0; ; attempt += 1) {
    try {
      return await operation();
    } catch (error) {
      const delay = AUTH_READ_RETRY_DELAYS_MS[attempt];
      if (!isTransientAuthReadError(error) || delay === undefined) throw error;
      await new Promise((resolve) => window.setTimeout(resolve, delay));
    }
  }
}

async function signOutRejectedLogin() {
  if (typeof window !== 'undefined') window.sessionStorage.setItem(LOGIN_REJECTION_SIGNOUT_KEY, '1');
  try {
    await signOut();
  } catch (error) {
    if (typeof window !== 'undefined') window.sessionStorage.removeItem(LOGIN_REJECTION_SIGNOUT_KEY);
    throw error;
  }
}

function preferredRole(roles: BackendRole[]): Role {
  if (roles.includes('admin')) return 'admin';
  if (roles.includes('organizer_member')) return 'penyelenggara';
  if (roles.includes('teacher')) return 'guru';
  if (roles.includes('student')) return 'pelajar';
  throw new Error('ROLE_NOT_ASSIGNED');
}

function mapProfileToUser(profile: Record<string, unknown>, email = ''): User {
  const accountType = String(profile.account_type ?? '');
  const grade = String(profile.grade ?? '').toLowerCase();
  const mappedRole: Role = accountType === 'teacher' ? 'guru' : accountType === 'organizer' ? 'penyelenggara' : 'pelajar';
  const educationLevel: User['educationLevel'] = grade.startsWith('sd') ? 'sd' : grade.startsWith('smp') ? 'smp' : grade ? 'sma' : undefined;
  const subjects = String(profile.subjects ?? '').split(',').map((item) => item.trim()).filter(Boolean);
  return {
    id: String(profile.id),
    username: String(profile.username ?? ''),
    email,
    displayName: String(profile.full_name ?? profile.username ?? 'Pengguna'),
    role: mappedRole,
    bio: profile.bio ? String(profile.bio) : undefined,
    school: profile.institution ? String(profile.institution) : undefined,
    educationLevel,
    birthDate: profile.birth_date ? String(profile.birth_date) : undefined,
    points: 0,
    rank: 0,
    joinedAt: String(profile.created_at ?? ''),
    favoriteCategories: subjects as User['favoriteCategories'],
    profilePhoto: profile.avatar_url ? String(profile.avatar_url) : undefined,
    coverPhoto: profile.cover_url ? String(profile.cover_url) : undefined,
    badges: [],
    emblems: [],
    followers: 0,
    following: 0,
    pembina: profile.pembina ? String(profile.pembina) : undefined,
    grade: profile.grade ? String(profile.grade) : undefined,
    badgeShowcase: Array.isArray(profile.badge_showcase) ? profile.badge_showcase : [],
    badgeShowcaseManual: profile.badge_showcase_manual === true,
  } as User;
}

export function AppProvider({ children }: { children: ReactNode }) {
  const [authUser, setAuthUser] = useState<{ id: string; email?: string } | null>(null);
  const [user, setUser] = useState<User | null>(null);
  const [authLoading, setAuthLoading] = useState(true);
  const [authUnavailable, setAuthUnavailable] = useState(false);
  const [isGuest, setIsGuest] = useState(() => localStorage.getItem(GUEST_KEY) === '1');
  const [notifications, setNotifications] = useState<AppNotification[]>([]);
  const [unreadNotificationCount, setUnreadNotificationCount] = useState(0);
  const [awards, setAwards] = useState<Award[]>([]);
  const [certificates] = useState<Certificate[]>([]);
  const [orders, setOrders] = useState<Order[]>([]);
  const [feed] = useState<FeedPost[]>([]);

  const authUserRef = useRef(authUser);
  authUserRef.current = authUser;
  const authHydrationGateRef = useRef<ReturnType<typeof createAuthHydrationGate> | null>(null);
  if (!authHydrationGateRef.current) authHydrationGateRef.current = createAuthHydrationGate();
  const authBootstrapGenerationRef = useRef(0);
  const guestRef = useRef(isGuest);
  guestRef.current = isGuest;
  const aliveRef = useRef(true);
  const loadedAwardsFor = useRef<string | null>(null);

  const setCurrentAuthUser = useCallback((next: { id: string; email?: string } | null) => {
    if (authUserRef.current?.id !== next?.id) authHydrationGateRef.current?.invalidate();
    authUserRef.current = next;
    setAuthUser(next);
  }, []);

  const clearUserState = useCallback(() => {
    authBootstrapGenerationRef.current += 1;
    authHydrationGateRef.current?.invalidate();
    setCurrentAuthUser(null);
    setAuthUnavailable(false);
    setUser(null);
    setNotifications([]);
    setAwards([]);
    setOrders([]);
    setUnreadNotificationCount(0);
    loadedAwardsFor.current = null;
    liveAwards.length = 0;
  }, [setCurrentAuthUser]);

  const refreshUnreadCount = useCallback(async (userIdOverride?: string) => {
    const uid = userIdOverride ?? authUserRef.current?.id;
    if (!uid || guestRef.current) {
      setUnreadNotificationCount(0);
      return;
    }
    try {
      const count = await getUnreadNotificationCount(uid);
      if (aliveRef.current && authUserRef.current?.id === uid) setUnreadNotificationCount(count);
    } catch {
      // Non-critical: preserve the last known badge value.
    }
  }, []);

  const hydrateCurrentUser = useCallback(async (
    userId: string,
    email = '',
    roles?: BackendRole[],
    hydrationRequest = authHydrationGateRef.current!.begin(),
  ) => {
    const isHydrationCurrent = () => (
      aliveRef.current &&
      authHydrationGateRef.current?.isCurrent(hydrationRequest) === true &&
      authUserRef.current?.id === userId
    );

    let profile: Awaited<ReturnType<typeof getAuthenticatedProfileById>>;
    let resolvedRoles: BackendRole[];
    try {
      [profile, resolvedRoles] = await Promise.all([
        getAuthenticatedProfileById(userId),
        roles ? Promise.resolve(roles) : getUserRoles(userId),
      ]);
    } catch (error) {
      // A request may fail after logout/account-switch, including a fresh login
      // with the same UUID. Its rejection must not clear the newer session.
      if (!isHydrationCurrent()) return;
      throw error;
    }

    if (!profile) {
      if (!isHydrationCurrent()) return;
      throw new Error('PROFILE_NOT_FOUND');
    }
    if (!isHydrationCurrent()) return;

    setUser({ ...mapProfileToUser(profile, email), role: preferredRole(resolvedRoles) });
    setCurrentAuthUser({ id: userId, email: email || undefined });
    setAuthUnavailable(false);
  }, [setCurrentAuthUser]);

  useEffect(() => {
    aliveRef.current = true;
    let effectActive = true;
    const bootstrapGeneration = ++authBootstrapGenerationRef.current;
    authHydrationGateRef.current?.invalidate();
    const isBootstrapCurrent = () => (
      effectActive &&
      aliveRef.current &&
      authBootstrapGenerationRef.current === bootstrapGeneration
    );

    const bootstrap = async () => {
      try {
        const session = await retryTransientAuthRead(() => getAuthSession());
        // An auth event, logout, guest transition, or newer bootstrap invalidates
        // this initial read. It must not restore an older provider snapshot.
        if (!isBootstrapCurrent()) return;

        const sessionUser = session?.user;
        publishAuthSessionEvent('INITIAL_SESSION', sessionUser?.id ?? null);
        if (sessionUser) {
          const email = sessionUser.email ?? '';
          setCurrentAuthUser({ id: sessionUser.id, email: email || undefined });
          setIsGuest(false);
          localStorage.removeItem(GUEST_KEY);
          await hydrateCurrentUser(sessionUser.id, email);
          void refreshUnreadCount(sessionUser.id);
        } else if (!guestRef.current) {
          clearUserState();
        }
      } catch (error) {
        console.error('[SykaBelajar] auth bootstrap failed', error);
        if (isBootstrapCurrent()) {
          // A failed network/Worker read is not proof that the cookie session
          // ended. Preserve the session snapshot and show an explicit retry
          // state instead of silently sending a signed-in user to /login.
          if (isDefinitiveAuthRejection(error) || isDefinitiveIdentityFailure(error)) {
            clearUserState();
          } else {
            setAuthUnavailable(true);
          }
        }
      } finally {
        if (effectActive && aliveRef.current) setAuthLoading(false);
      }
    };

    void bootstrap();

    const { data: subscription } = onAuthStateChange((event, session) => {
      if (!effectActive || !aliveRef.current) return;

      // Invalidate the pending bootstrap and any profile/role hydration even
      // when a renewed session belongs to the same UUID.
      const authEventGeneration = ++authBootstrapGenerationRef.current;
      authHydrationGateRef.current?.invalidate();
      publishAuthSessionEvent(event, session?.user?.id ?? null);
      if (event === 'SIGNED_OUT') {
        localStorage.removeItem(LAST_ACTIVITY_KEY);
        clearUserState();
        return;
      }
      if (!session?.user) {
        if (event === 'INITIAL_SESSION' && !guestRef.current) clearUserState();
        return;
      }

      const email = session.user.email ?? '';
      const uid = session.user.id;
      setCurrentAuthUser({ id: uid, email: email || undefined });
      setIsGuest(false);
      setAuthUnavailable(false);
      localStorage.removeItem(GUEST_KEY);

      const hydrateFromCurrentEvent = () => {
        if (
          !effectActive ||
          !aliveRef.current ||
          authBootstrapGenerationRef.current !== authEventGeneration ||
          authUserRef.current?.id !== uid
        ) return;
        const hydrationRequest = authHydrationGateRef.current!.begin();
        const isCurrentEvent = () => (
          effectActive &&
          aliveRef.current &&
          authHydrationGateRef.current?.isCurrent(hydrationRequest) === true &&
          authUserRef.current?.id === uid
        );
        void retryTransientAuthRead(() => hydrateCurrentUser(uid, email, undefined, hydrationRequest)).catch((error) => {
          console.error('[SykaBelajar] auth user hydration failed', error);
          if (isCurrentEvent()) {
            if (isDefinitiveAuthRejection(error) || isDefinitiveIdentityFailure(error)) {
              clearUserState();
            } else {
              setAuthUnavailable(true);
            }
          }
        });
        void refreshUnreadCount(uid);
      };

      // Defer PostgREST/profile work until after the provider listener returns.
      window.setTimeout(hydrateFromCurrentEvent, 0);
    });

    return () => {
      effectActive = false;
      aliveRef.current = false;
      authBootstrapGenerationRef.current += 1;
      authHydrationGateRef.current?.invalidate();
      subscription.subscription.unsubscribe();
    };
  }, [clearUserState, hydrateCurrentUser, refreshUnreadCount]);

  // Awards are secondary to authentication. Fetch them after the shell can render.
  useEffect(() => {
    const userId = user?.id;
    if (!userId || isGuest || authUser?.id !== userId || loadedAwardsFor.current === userId) return;

    loadedAwardsFor.current = userId;
    void loadAwards(userId).then(() => {
      if (aliveRef.current && authUserRef.current?.id === userId) {
        setAwards([...liveAwards]);
      }
    }).catch(() => {
      if (loadedAwardsFor.current === userId) loadedAwardsFor.current = null;
      if (aliveRef.current && authUserRef.current?.id === userId) setAwards([]);
    });
  }, [authUser?.id, user?.id, isGuest]);

  useEffect(() => {
    if (!authUser?.id || isGuest) return;

    let idleTimer: number | undefined;
    let lastActivityAt = Date.now();
    let lastPersistedAt = 0;
    let idleLogoutStarted = false;

    const clearIdleTimer = () => {
      if (idleTimer !== undefined) {
        window.clearTimeout(idleTimer);
        idleTimer = undefined;
      }
    };

    const persistActivity = (timestamp: number, force = false) => {
      if (!force && timestamp - lastPersistedAt < ACTIVITY_PERSIST_INTERVAL_MS) return;
      localStorage.setItem(LAST_ACTIVITY_KEY, String(timestamp));
      lastPersistedAt = timestamp;
    };

    const logoutForIdle = async () => {
      if (idleLogoutStarted) return;
      idleLogoutStarted = true;
      clearIdleTimer();
      localStorage.removeItem(LAST_ACTIVITY_KEY);
      try {
        await signOut();
      } catch (error) {
        console.error('[SykaBelajar] idle logout failed', error);
        if (aliveRef.current && authUserRef.current?.id === authUser.id) clearUserState();
      }
    };

    const scheduleIdleLogout = () => {
      clearIdleTimer();
      const remaining = IDLE_TIMEOUT_MS - (Date.now() - lastActivityAt);
      if (remaining <= 0) {
        void logoutForIdle();
        return;
      }
      idleTimer = window.setTimeout(() => {
        const elapsed = Date.now() - lastActivityAt;
        if (elapsed >= IDLE_TIMEOUT_MS) void logoutForIdle();
        else scheduleIdleLogout();
      }, remaining + 50);
    };

    const recordActivity = () => {
      const now = Date.now();
      lastActivityAt = now;
      persistActivity(now);
    };

    const restorePersistedActivity = () => {
      const persisted = Number(localStorage.getItem(LAST_ACTIVITY_KEY));
      if (Number.isFinite(persisted) && persisted > 0) {
        lastActivityAt = persisted;
        lastPersistedAt = persisted;
      } else {
        persistActivity(lastActivityAt, true);
      }
    };

    const handleVisibility = () => {
      if (document.hidden) {
        persistActivity(lastActivityAt, true);
        return;
      }
      scheduleIdleLogout();
    };

    const handlePageHide = () => persistActivity(lastActivityAt, true);

    const events: Array<keyof WindowEventMap> = ['pointerdown', 'pointermove', 'keydown', 'scroll', 'wheel', 'touchstart'];
    events.forEach((event) => window.addEventListener(event, recordActivity, { passive: true }));
    document.addEventListener('visibilitychange', handleVisibility);
    window.addEventListener('pagehide', handlePageHide);

    restorePersistedActivity();
    scheduleIdleLogout();

    return () => {
      clearIdleTimer();
      events.forEach((event) => window.removeEventListener(event, recordActivity));
      document.removeEventListener('visibilitychange', handleVisibility);
      window.removeEventListener('pagehide', handlePageHide);
    };
  }, [authUser?.id, isGuest, clearUserState]);

  const toast = useCallback((message: string, type: 'success' | 'error' | 'info' = 'success') => {
    // Compatibility bridge: legacy callers keep using useApp().toast,
    // but every message is rendered by the single global SYKABELAJAR ToastContainer.
    if (message.includes('Permintaan identik diblokir sampai halaman dimuat ulang atau payload berubah.')) return;
    globalToast[type](message);
  }, []);

  const login = useCallback(async (email: string, password: string) => {
    let authenticationEstablished = false;
    try {
      const result = await signIn(email.trim(), password);
      if (!result.user) return { ok: false, error: 'Login gagal: sesi pengguna tidak tersedia.' };
      authenticationEstablished = true;

      // Role eligibility is resolved from the backend only. Never accept a role
      // selected at login as evidence of authorization.
      const roles = await getUserRoles(result.user.id);
      if (!roles.length) {
        await signOutRejectedLogin();
        authenticationEstablished = false;
        return { ok: false, error: 'Akun belum memiliki role aktif di backend. Hubungi administrator.' };
      }

      const userEmail = result.user.email ?? email.trim();
      authBootstrapGenerationRef.current += 1;
      setCurrentAuthUser({ id: result.user.id, email: userEmail || undefined });
      setIsGuest(false);
      localStorage.removeItem(GUEST_KEY);
      localStorage.setItem(LAST_ACTIVITY_KEY, String(Date.now()));
      await hydrateCurrentUser(result.user.id, userEmail, roles);
      void refreshUnreadCount(result.user.id);
      authenticationEstablished = false;
      return { ok: true };
    } catch (error: unknown) {
      // If authentication succeeded but role/profile resolution failed, do not
      // leave a partially authenticated client session behind.
      if (authenticationEstablished) {
        try {
          await signOutRejectedLogin();
        } catch {
          clearUserState();
        }
      }
      return { ok: false, error: error instanceof Error ? error.message : 'Email atau password tidak valid.' };
    }
  }, [clearUserState, hydrateCurrentUser, refreshUnreadCount]);

  const register = useCallback(async (data: Partial<User> & { email: string; password: string; referralCode?: string }) => {
    try {
      const requestedRole = data.role === 'guru' || data.role === 'penyelenggara' ? data.role : 'pelajar';
      await signUp(data.email.trim(), data.password, {
        username: data.username ?? '',
        full_name: data.displayName ?? '',
        account_type: uiRoleToAccountType(requestedRole),
        birth_date: data.birthDate,
        institution: data.school,
        grade: data.educationLevel,
        subjects: Array.isArray(data.favoriteCategories) ? data.favoriteCategories.join(',') : undefined,
        referral_id: data.referralCode,
      });
      return { ok: true };
    } catch (error: unknown) {
      return { ok: false, error: error instanceof Error ? error.message : 'Pendaftaran gagal.' };
    }
  }, []);

  const loginAsGuest = useCallback(() => {
    localStorage.setItem(GUEST_KEY, '1');
    localStorage.removeItem(LAST_ACTIVITY_KEY);
    setIsGuest(true);
    clearUserState();
  }, [clearUserState]);

  const logout = useCallback(async () => {
    try {
      await signOut();
    } finally {
      localStorage.removeItem(GUEST_KEY);
      localStorage.removeItem(LAST_ACTIVITY_KEY);
      setIsGuest(false);
      clearUserState();
    }
  }, [clearUserState]);

  const retryAuthSession = useCallback(async () => {
    const requestGeneration = ++authBootstrapGenerationRef.current;
    authHydrationGateRef.current?.invalidate();
    setAuthUnavailable(false);
    setAuthLoading(true);
    try {
      const session = await retryTransientAuthRead(() => getAuthSession());
      if (authBootstrapGenerationRef.current !== requestGeneration) return;
      if (!session?.user) {
        clearUserState();
        setAuthLoading(false);
        return;
      }

      const email = session.user.email ?? '';
      setCurrentAuthUser({ id: session.user.id, email: email || undefined });
      setIsGuest(false);
      localStorage.removeItem(GUEST_KEY);
      await retryTransientAuthRead(() => hydrateCurrentUser(session.user.id, email));
      if (authBootstrapGenerationRef.current !== requestGeneration) return;
      setAuthUnavailable(false);
      void refreshUnreadCount(session.user.id);
    } catch (error) {
      if (authBootstrapGenerationRef.current !== requestGeneration) return;
      if (isDefinitiveAuthRejection(error) || isDefinitiveIdentityFailure(error)) {
        clearUserState();
      } else {
        setAuthUnavailable(true);
      }
    } finally {
      if (authBootstrapGenerationRef.current === requestGeneration) setAuthLoading(false);
    }
  }, [clearUserState, hydrateCurrentUser, refreshUnreadCount, setCurrentAuthUser]);

  const refreshUser = useCallback(async () => {
    const current = authUserRef.current;
    if (!current) return;

    const hydrationRequest = authHydrationGateRef.current!.begin();
    const isHydrationCurrent = () => (
      aliveRef.current &&
      authHydrationGateRef.current?.isCurrent(hydrationRequest) === true &&
      authUserRef.current?.id === current.id
    );

    try {
      const profile = await getAuthenticatedProfileById(current.id);
      if (!profile || !isHydrationCurrent()) return;

      const roles = await getUserRoles(current.id);
      if (!isHydrationCurrent()) return;
      if (!roles.length) {
        await signOut().catch(() => undefined);
        if (isHydrationCurrent()) clearUserState();
        return;
      }

      const mapped = mapProfileToUser(profile, current.email);
      if (!isHydrationCurrent()) return;
      setUser({ ...mapped, role: preferredRole(roles) });
    } catch (error) {
      if (isHydrationCurrent()) console.warn('[SykaBelajar] refreshUser failed', error);
    }
  }, [clearUserState]);

  const updateProfile = useCallback(async (data: Partial<User>) => {
    const current = authUserRef.current;
    if (!current) return;

    const hydrationRequest = authHydrationGateRef.current!.begin();
    const isHydrationCurrent = () => (
      aliveRef.current &&
      authHydrationGateRef.current?.isCurrent(hydrationRequest) === true &&
      authUserRef.current?.id === current.id
    );

    const patch: Record<string, unknown> = {};
    if (data.displayName !== undefined) patch.full_name = data.displayName;
    if (data.bio !== undefined) patch.bio = data.bio;
    if (data.school !== undefined) patch.institution = data.school;
    if (data.birthDate !== undefined) patch.birth_date = data.birthDate;
    if (data.profilePhoto !== undefined) patch.avatar_url = data.profilePhoto;
    if (data.educationLevel !== undefined) patch.grade = data.educationLevel;
    if (data.favoriteCategories !== undefined) patch.subjects = Array.isArray(data.favoriteCategories) ? data.favoriteCategories.join(',') : data.favoriteCategories;
    const fresh = await updateProfileRecord(current.id, patch);
    if (!isHydrationCurrent()) return;

    const roles = await getUserRoles(current.id);
    if (!isHydrationCurrent()) return;
    if (!roles.length) {
      await signOut().catch(() => undefined);
      if (isHydrationCurrent()) clearUserState();
      return;
    }

    const mapped = mapProfileToUser(fresh, current.email);
    if (!isHydrationCurrent()) return;
    setUser({ ...mapped, role: preferredRole(roles) });
  }, [clearUserState]);

  const markNotificationRead = useCallback(async (id: string) => {
    const current = authUserRef.current;
    if (!current) return;
    setNotifications((items) => items.map((n) => n.id === id ? { ...n, read: true } : n));
    setUnreadNotificationCount((count) => Math.max(0, count - 1));
    const { error } = await supabase.from('notifications').update({ read_at: new Date().toISOString() }).eq('id', id).eq('user_id', current.id);
    if (error) throw error;
  }, []);

  const markAllNotificationsRead = useCallback(async () => {
    const current = authUserRef.current;
    if (!current) return;
    setNotifications((items) => items.map((n) => ({ ...n, read: true })));
    setUnreadNotificationCount(0);
    const { error } = await supabase.from('notifications').update({ read_at: new Date().toISOString() }).eq('user_id', current.id).is('read_at', null);
    if (error) throw error;
  }, []);

  const addPoints = useCallback(async (_points: number) => {
    throw new Error('XP hanya boleh diberikan oleh backend/server-authoritative workflows.');
  }, []);

  const addNotification = useCallback(async (n: Omit<AppNotification, 'id' | 'createdAt' | 'read'>) => {
    const current = authUserRef.current;
    if (!current) return;
    const { data, error } = await supabase.from('notifications').insert({ user_id: current.id, type: n.type, title: n.title, body: n.body, data: { link: n.link, icon: n.icon } }).select('id,type,title,body,data,created_at').single();
    if (error) throw error;
    setNotifications((items) => [{ id: data.id, type: data.type, title: data.title, body: data.body ?? '', createdAt: data.created_at, read: false, link: data.data?.link }, ...items]);
    setUnreadNotificationCount((count) => count + 1);
  }, []);

  const addOrder = useCallback((order: Order) => setOrders((items) => [order, ...items]), []);

  const togglePostLike = useCallback(async (postId: string) => {
    const current = authUserRef.current;
    if (!current) return;
    const { data: existing, error: lookupError } = await supabase.from('post_likes').select('post_id').eq('post_id', postId).eq('user_id', current.id).maybeSingle();
    if (lookupError) throw lookupError;
    if (existing) {
      const { error } = await supabase.from('post_likes').delete().eq('post_id', postId).eq('user_id', current.id);
      if (error) throw error;
    } else {
      const { error } = await supabase.from('post_likes').insert({ post_id: postId, user_id: current.id });
      if (error) throw error;
    }
  }, []);

  const toggleCommentLike = useCallback(async (_postId: string, commentId: string) => {
    const current = authUserRef.current;
    if (!current) return;
    const { data: existing, error: lookupError } = await supabase.from('comment_likes').select('comment_id').eq('comment_id', commentId).eq('user_id', current.id).maybeSingle();
    if (lookupError) throw lookupError;
    if (existing) {
      const { error } = await supabase.from('comment_likes').delete().eq('comment_id', commentId).eq('user_id', current.id);
      if (error) throw error;
    } else {
      const { error } = await supabase.from('comment_likes').insert({ comment_id: commentId, user_id: current.id });
      if (error) throw error;
    }
  }, []);

  const addComment = useCallback(async (postId: string, body: string, parentId?: string) => {
    const current = authUserRef.current;
    if (!current || !body.trim()) return;
    const { error } = await supabase.from('comments').insert({ post_id: postId, user_id: current.id, parent_id: parentId ?? null, body: body.trim(), moderation_state: 'PUBLISHED' });
    if (error) throw error;
  }, []);

  const value = useMemo<AppState>(() => ({
    user,
    isAuthenticated: !!authUser,
    authLoading,
    authUnavailable,
    retryAuthSession,
    isGuest,
    notifications,
    unreadNotificationCount,
    refreshUnreadCount,
    awards,
    certificates,
    orders,
    feed,
    login,
    register,
    loginAsGuest,
    logout,
    updateProfile,
    markNotificationRead,
    markAllNotificationsRead,
    addPoints,
    addNotification,
    addOrder,
    togglePostLike,
    toggleCommentLike,
    addComment,
    toast,
    refreshUser,
  }), [user, authUser, authLoading, authUnavailable, retryAuthSession, isGuest, notifications, unreadNotificationCount, refreshUnreadCount, awards, certificates, orders, feed, login, register, loginAsGuest, logout, updateProfile, markNotificationRead, markAllNotificationsRead, addPoints, addNotification, addOrder, togglePostLike, toggleCommentLike, addComment, toast, refreshUser]);

  return (
    <AppContext.Provider value={value}>
      {children}
    </AppContext.Provider>
  );
}

export function useApp() {
  const ctx = useContext(AppContext);
  if (!ctx) throw new Error('useApp must be used within AppProvider');
  return ctx;
}
