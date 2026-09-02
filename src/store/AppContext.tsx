import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import type { Role, User, AppNotification, Order, Award, Certificate, FeedPost } from '@/types';
import { supabase } from '@/lib/supabase';
import { signIn, signUp, signOut } from '@/services/auth.service';
import { getAuthenticatedProfileById, getProfileById, updateProfile as updateProfileRecord } from '@/services/profile.service';
import { loadAwards } from '@/services/runtime.service';
import { liveAwards } from '@/data/live';
import { backendRoleToUiRole, getUserRoles, hasAllowedLoginRole, uiRoleToAccountType, type BackendRole } from '@/services/role.service';
import { getUnreadNotificationCount } from '@/services/notification.service';

interface AppState {
  user: User | null;
  isAuthenticated: boolean;
  authLoading: boolean;
  isGuest: boolean;
  notifications: AppNotification[];
  unreadNotificationCount: number;
  refreshUnreadCount: () => Promise<void>;
  awards: Award[];
  certificates: Certificate[];
  orders: Order[];
  feed: FeedPost[];
  login: (email: string, password: string, requestedRole?: Exclude<Role, 'admin'>) => Promise<{ ok: boolean; error?: string }>;
  register: (data: Partial<User> & { email: string; password: string }) => Promise<{ ok: boolean; error?: string }>;
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

function preferredRole(roles: BackendRole[]): Role {
  if (roles.includes('admin')) return 'admin';
  if (roles.includes('organizer_member')) return 'penyelenggara';
  if (roles.includes('teacher')) return 'guru';
  return 'pelajar';
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
    verified: String(profile.status ?? '') === 'ACTIVE',
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
  const [isGuest, setIsGuest] = useState(() => localStorage.getItem(GUEST_KEY) === '1');
  const [notifications, setNotifications] = useState<AppNotification[]>([]);
  const [unreadNotificationCount, setUnreadNotificationCount] = useState(0);
  const [awards, setAwards] = useState<Award[]>([]);
  const [certificates] = useState<Certificate[]>([]);
  const [orders, setOrders] = useState<Order[]>([]);
  const [feed] = useState<FeedPost[]>([]);
  const [toasts, setToasts] = useState<{ id: string; message: string; type: 'success' | 'error' | 'info' }[]>([]);

  const authUserRef = useRef(authUser);
  authUserRef.current = authUser;
  const guestRef = useRef(isGuest);
  guestRef.current = isGuest;
  const aliveRef = useRef(true);
  const loadedAwardsFor = useRef<string | null>(null);

  const clearUserState = useCallback(() => {
    setAuthUser(null);
    setUser(null);
    setNotifications([]);
    setAwards([]);
    setOrders([]);
    setUnreadNotificationCount(0);
    loadedAwardsFor.current = null;
    liveAwards.length = 0;
  }, []);

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

  const hydrateCurrentUser = useCallback(async (userId: string, email = '', roles?: BackendRole[]) => {
    const [profile, resolvedRoles] = await Promise.all([
      getAuthenticatedProfileById(userId),
      roles ? Promise.resolve(roles) : getUserRoles(userId),
    ]);
    if (!profile) throw new Error('PROFILE_NOT_FOUND');
    if (!aliveRef.current) return;

    setUser({ ...mapProfileToUser(profile, email), role: preferredRole(resolvedRoles) });
    setAuthUser({ id: userId, email: email || undefined });

    if (loadedAwardsFor.current !== userId) {
      loadedAwardsFor.current = userId;
      liveAwards.length = 0;
      try {
        await loadAwards(userId);
        if (aliveRef.current && authUserRef.current?.id === userId) setAwards([...liveAwards]);
      } catch {
        loadedAwardsFor.current = null;
        setAwards([]);
      }
    }
  }, []);

  useEffect(() => {
    aliveRef.current = true;
    let bootstrapped = false;

    const bootstrap = async () => {
      try {
        const { data, error } = await supabase.auth.getSession();
        if (error) throw error;
        const sessionUser = data.session?.user;
        if (sessionUser) {
          const email = sessionUser.email ?? '';
          setAuthUser({ id: sessionUser.id, email: email || undefined });
          setIsGuest(false);
          localStorage.removeItem(GUEST_KEY);
          await hydrateCurrentUser(sessionUser.id, email);
          void refreshUnreadCount(sessionUser.id);
        } else if (!guestRef.current) {
          clearUserState();
        }
      } catch (error) {
        console.error('[SykaBelajar] auth bootstrap failed', error);
        if (aliveRef.current) clearUserState();
      } finally {
        if (aliveRef.current) {
          bootstrapped = true;
          setAuthLoading(false);
        }
      }
    };

    void bootstrap();

    const { data: subscription } = supabase.auth.onAuthStateChange((event, session) => {
      if (!aliveRef.current) return;
      if (event === 'SIGNED_OUT') {
        clearUserState();
        return;
      }
      if (!session?.user) return;

      const email = session.user.email ?? '';
      const uid = session.user.id;
      setAuthUser({ id: uid, email: email || undefined });
      setIsGuest(false);
      localStorage.removeItem(GUEST_KEY);

      // Never execute Supabase queries directly inside the auth callback.
      // Login() performs hydration for an explicit sign-in; passive session events
      // hydrate on the next task only after the auth event has released its lock.
      if (bootstrapped) {
        window.setTimeout(() => {
          if (!aliveRef.current || authUserRef.current?.id !== uid) return;
          void hydrateCurrentUser(uid, email).catch((error) => {
            console.error('[SykaBelajar] auth user hydration failed', error);
            if (aliveRef.current && authUserRef.current?.id === uid) clearUserState();
          });
          void refreshUnreadCount(uid);
        }, 0);
      }
    });

    return () => {
      aliveRef.current = false;
      subscription.subscription.unsubscribe();
    };
  }, [clearUserState, hydrateCurrentUser, refreshUnreadCount]);

  const toast = useCallback((message: string, type: 'success' | 'error' | 'info' = 'success') => {
    const id = crypto.randomUUID();
    setToasts((items) => [...items, { id, message, type }]);
    window.setTimeout(() => setToasts((items) => items.filter((x) => x.id !== id)), 3500);
  }, []);

  const login = useCallback(async (email: string, password: string, requestedRole: Exclude<Role, 'admin'> = 'pelajar') => {
    try {
      const result = await signIn(email.trim(), password);
      if (!result.user) return { ok: false, error: 'Login gagal: sesi pengguna tidak tersedia.' };
      const roles = await getUserRoles(result.user.id);
      if (!roles.length) {
        await signOut();
        return { ok: false, error: 'Akun belum memiliki role aktif di backend.' };
      }
      if (!hasAllowedLoginRole(roles, requestedRole)) {
        await signOut();
        const roleNames = roles.map((role) => backendRoleToUiRole(role)).join(', ');
        return { ok: false, error: `Role akun adalah ${roleNames}. Pilih jenis akun yang sesuai.` };
      }
      const userEmail = result.user.email ?? email.trim();
      setAuthUser({ id: result.user.id, email: userEmail || undefined });
      setIsGuest(false);
      localStorage.removeItem(GUEST_KEY);
      await hydrateCurrentUser(result.user.id, userEmail, roles);
      void refreshUnreadCount(result.user.id);
      return { ok: true };
    } catch (error: unknown) {
      return { ok: false, error: error instanceof Error ? error.message : 'Email atau password tidak valid.' };
    }
  }, [hydrateCurrentUser, refreshUnreadCount]);

  const register = useCallback(async (data: Partial<User> & { email: string; password: string }) => {
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
      });
      return { ok: true };
    } catch (error: unknown) {
      return { ok: false, error: error instanceof Error ? error.message : 'Pendaftaran gagal.' };
    }
  }, []);

  const loginAsGuest = useCallback(() => {
    localStorage.setItem(GUEST_KEY, '1');
    setIsGuest(true);
    clearUserState();
  }, [clearUserState]);

  const logout = useCallback(async () => {
    try {
      await signOut();
    } finally {
      localStorage.removeItem(GUEST_KEY);
      setIsGuest(false);
      clearUserState();
    }
  }, [clearUserState]);

  const refreshUser = useCallback(async () => {
    const current = authUserRef.current;
    if (!current) return;
    try {
      const profile = await getAuthenticatedProfileById(current.id);
      if (!profile || !aliveRef.current || authUserRef.current?.id !== current.id) return;
      const roles = await getUserRoles(current.id).catch(() => [] as BackendRole[]);
      const mapped = mapProfileToUser(profile, current.email);
      setUser({ ...mapped, role: roles.length ? preferredRole(roles) : mapped.role });
    } catch (error) {
      console.warn('[SykaBelajar] refreshUser failed', error);
    }
  }, []);

  const updateProfile = useCallback(async (data: Partial<User>) => {
    const current = authUserRef.current;
    if (!current) return;
    const patch: Record<string, unknown> = {};
    if (data.displayName !== undefined) patch.full_name = data.displayName;
    if (data.bio !== undefined) patch.bio = data.bio;
    if (data.school !== undefined) patch.institution = data.school;
    if (data.birthDate !== undefined) patch.birth_date = data.birthDate;
    if (data.profilePhoto !== undefined) patch.avatar_url = data.profilePhoto;
    if (data.educationLevel !== undefined) patch.grade = data.educationLevel;
    if (data.favoriteCategories !== undefined) patch.subjects = Array.isArray(data.favoriteCategories) ? data.favoriteCategories.join(',') : data.favoriteCategories;
    const fresh = await updateProfileRecord(current.id, patch);
    if (!aliveRef.current || authUserRef.current?.id !== current.id) return;
    const roles = await getUserRoles(current.id).catch(() => [] as BackendRole[]);
    const mapped = mapProfileToUser(fresh, current.email);
    setUser({ ...mapped, role: roles.length ? preferredRole(roles) : mapped.role });
  }, []);

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
  }), [user, authUser, authLoading, isGuest, notifications, unreadNotificationCount, refreshUnreadCount, awards, certificates, orders, feed, login, register, loginAsGuest, logout, updateProfile, markNotificationRead, markAllNotificationsRead, addPoints, addNotification, addOrder, togglePostLike, toggleCommentLike, addComment, toast, refreshUser]);

  return (
    <AppContext.Provider value={value}>
      {children}
      <div className="fixed bottom-20 md:bottom-6 left-1/2 -translate-x-1/2 z-[100] flex flex-col gap-2 items-center pointer-events-none">
        {toasts.map((t) => (
          <div key={t.id} className={`pointer-events-auto px-4 py-3 rounded-xl shadow-pop text-sm font-medium animate-slide-up flex items-center gap-2 ${t.type === 'success' ? 'bg-moss-600 text-white' : t.type === 'error' ? 'bg-err text-white' : 'surface-elevated text-white'}`}>
            <span className="w-1.5 h-1.5 rounded-full bg-white/80" />
            {t.message}
          </div>
        ))}
      </div>
    </AppContext.Provider>
  );
}

export function useApp() {
  const ctx = useContext(AppContext);
  if (!ctx) throw new Error('useApp must be used within AppProvider');
  return ctx;
}
