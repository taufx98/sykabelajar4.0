import { useEffect, useState, type ReactNode } from 'react';
import { BrowserRouter, Routes, Route, Navigate, useLocation } from 'react-router-dom';
import { AppProvider, useApp } from '@/store/AppContext';
import { AppLayout } from '@/components/layout/AppLayout';
import { LandingPage } from '@/pages/LandingPage';
import { RegisterPage } from '@/pages/RegisterPage';
import { LoginPage } from '@/pages/LoginPage';
import { HomePage } from '@/pages/HomePage';
import { CompetitionDetailPage } from '@/pages/CompetitionDetailPage';
import { CompetitionWorkPage } from '@/pages/CompetitionWorkPage';
import { DailyTasksPage } from '@/pages/DailyTasksPage';
import { LeaderboardPage } from '@/pages/LeaderboardPage';
import { AwardsPage } from '@/pages/AwardsPage';
import { VerifyPage } from '@/pages/VerifyPage';
import { ProfilePage } from '@/pages/ProfilePage';
import { EditProfilePage } from '@/pages/EditProfilePage';
import { NotificationsPage } from '@/pages/NotificationsPage';
import { OrdersPage } from '@/pages/OrdersPage';
import { AdminPage } from '@/pages/AdminPage';
import { AdminRolesPage } from '@/pages/AdminRolesPage';
import { AdminOrdersReviewPage } from '@/pages/AdminOrdersReviewPage';
import { AdminOperationsPage } from '@/pages/AdminOperationsPage';
import { AdminFulfillmentPage } from '@/pages/AdminFulfillmentPage';
import { AdminAwardsPage } from '@/pages/AdminAwardsPage';
import { AdminModerationPage } from '@/pages/AdminModerationPage';
import { OrganizerPage } from '@/pages/OrganizerPage';
import { OrganizerQuestionEditorPage } from '@/pages/OrganizerQuestionEditorPage';
import { OrganizerRegistrationsPage } from '@/pages/OrganizerRegistrationsPage';
import { OrganizerMembersPage } from '@/pages/OrganizerMembersPage';
import { OrganizerCompetitionConfigPage } from '@/pages/OrganizerCompetitionConfigPage';
import { OrganizerGradingPage } from '@/pages/OrganizerGradingPage';
import { OrganizerPlanPage } from '@/pages/OrganizerPlanPage';
import { CertificateLifecyclePage } from '@/pages/CertificateLifecyclePage';
import { SocialFeedPage } from '@/pages/SocialFeedPage';
import { TwibbonPage } from '@/pages/TwibbonPage';
import { AdminBannersPage } from '@/pages/AdminBannersPage';
import { OrganizerAdRequestPage } from '@/pages/OrganizerAdRequestPage';
import { AdminChatPage } from '@/pages/AdminChatPage';
import { getUserRoles } from '@/services/role.service';
import { supabase } from '@/lib/supabase';
import { ToastContainer } from '@/components/ui/ToastContainer';

// Save/restore last route
const LAST_ROUTE_KEY = 'sykabelajar_last_route';
const GUEST_KEY = 'sykabelajar_guest_mode_v1';
const PUBLIC_ROUTES = ['/', '/login', '/register'];

function saveLastRoute(pathname: string) {
  if (!PUBLIC_ROUTES.includes(pathname)) {
    localStorage.setItem(LAST_ROUTE_KEY, pathname);
  }
}

function getLastRoute(): string {
  return localStorage.getItem(LAST_ROUTE_KEY) || '/home';
}

function AppRoute({ children }: { children: ReactNode }) {
  const { isAuthenticated, authLoading, authRevalidating, isGuest } = useApp();
  const location = useLocation();
  useEffect(() => { saveLastRoute(location.pathname); }, [location.pathname]);

  // CRITICAL: Never redirect while auth is loading or revalidating — just render the page
  // This prevents the flash of landing page during auth resolution or tab switch
  if (authLoading || authRevalidating) return <>{children}</>;

  // Auth loaded: check if user is allowed
  if (isAuthenticated || isGuest) return <>{children}</>;

  // Auth loaded, not authenticated, not guest → redirect to landing
  return <Navigate to="/" state={{ from: location }} replace />;
}

function RootEntry() {
  const { isAuthenticated, authLoading, isGuest, user } = useApp();
  const hasStoredSession = typeof window !== 'undefined' && (
    localStorage.getItem('sb-jrfogwueytiddnanetth-auth-token') !== null ||
    localStorage.getItem(GUEST_KEY) === '1'
  );

  // CRITICAL: While auth is loading, redirect immediately to last route (no flash)
  if (authLoading) {
    // If has stored session OR guest → go to last route instantly
    if (hasStoredSession || isGuest) return <Navigate to={getLastRoute()} replace />;
    // First visit → show spinner briefly
    return (
      <div className="min-h-screen bg-ink-950 flex items-center justify-center">
        <div className="w-10 h-10 rounded-xl gradient-moss flex items-center justify-center animate-pulse">
          <div className="w-5 h-5 bg-white/30 rounded" />
        </div>
      </div>
    );
  }

  // Auth loaded + has session OR guest OR authenticated → go to last route
  if ((hasStoredSession && isAuthenticated) || isGuest || (isAuthenticated && user)) {
    return <Navigate to={getLastRoute()} replace />;
  }

  // Auth loaded, no session, not authenticated → landing page
  return <LandingPage />;
}

function RoleRoute({ role, children }: { role: 'admin' | 'organizer_member'; children: ReactNode }) {
  const { isAuthenticated } = useApp();
  const [allowed, setAllowed] = useState<boolean | null>(null);
  useEffect(() => {
    let on = true;
    if (!isAuthenticated) { setAllowed(false); return () => { on = false; }; }
    (async () => {
      const { data } = await supabase.auth.getUser();
      if (!data.user) { if (on) setAllowed(false); return; }
      const roles = await getUserRoles(data.user.id);
      if (on) setAllowed(roles.includes(role) || roles.includes('admin'));
    })().catch(() => on && setAllowed(false));
    return () => { on = false; };
  }, [isAuthenticated, role]);
  if (!isAuthenticated) return <Navigate to="/login" replace />;
  if (allowed === null) return <div className="min-h-screen flex items-center justify-center text-slate-500">Memeriksa akses…</div>;
  if (!allowed) return <Navigate to="/home" replace />;
  return <>{children}</>;
}

function RuntimeGlobals() {
  const { toast } = useApp();
  useEffect(() => { globalThis.toast = toast; return () => { globalThis.toast = undefined; }; }, [toast]);
  return null;
}

function AppRoutes() {
  return <Routes>
    <Route path="/" element={<RootEntry />} />
    <Route path="/register" element={<RegisterPage />} />
    <Route path="/login" element={<LoginPage />} />
    <Route path="/verify/:code" element={<VerifyPage />} />
    <Route element={<AppRoute><AppLayout /></AppRoute>}>
      <Route path="/home" element={<HomePage />} />
      <Route path="/feed" element={<SocialFeedPage />} />
      <Route path="/lomba/:slug" element={<CompetitionDetailPage />} />
      <Route path="/lomba/:slug/kerja" element={<CompetitionWorkPage />} />
      <Route path="/lomba/:slug/twibbon" element={<TwibbonPage />} />
      <Route path="/daily-tasks" element={<DailyTasksPage />} />
      <Route path="/leaderboard" element={<LeaderboardPage />} />
      <Route path="/awards" element={<AwardsPage />} />
      <Route path="/profile/:username" element={<ProfilePage />} />
      <Route path="/profile/edit" element={<EditProfilePage />} />
      <Route path="/notifications" element={<NotificationsPage />} />
      <Route path="/orders" element={<OrdersPage />} />
      <Route path="/organizer" element={<RoleRoute role="organizer_member"><OrganizerPage /></RoleRoute>} />
      <Route path="/organizer/question-bank/:bankId" element={<RoleRoute role="organizer_member"><OrganizerQuestionEditorPage /></RoleRoute>} />
      <Route path="/organizer/registrations" element={<RoleRoute role="organizer_member"><OrganizerRegistrationsPage /></RoleRoute>} />
      <Route path="/organizer/members" element={<RoleRoute role="organizer_member"><OrganizerMembersPage /></RoleRoute>} />
      <Route path="/organizer/competition/:id/config" element={<RoleRoute role="organizer_member"><OrganizerCompetitionConfigPage /></RoleRoute>} />
      <Route path="/organizer/grading" element={<RoleRoute role="organizer_member"><OrganizerGradingPage /></RoleRoute>} />
      <Route path="/organizer/plan" element={<RoleRoute role="organizer_member"><OrganizerPlanPage /></RoleRoute>} />
      <Route path="/organizer/ads" element={<RoleRoute role="organizer_member"><OrganizerAdRequestPage /></RoleRoute>} />
      <Route path="/admin" element={<RoleRoute role="admin"><AdminPage /></RoleRoute>} />
      <Route path="/admin/roles" element={<RoleRoute role="admin"><AdminRolesPage /></RoleRoute>} />
      <Route path="/admin/orders/review" element={<RoleRoute role="admin"><AdminOrdersReviewPage /></RoleRoute>} />
      <Route path="/admin/operations" element={<RoleRoute role="admin"><AdminOperationsPage /></RoleRoute>} />
      <Route path="/admin/operations/certificates" element={<RoleRoute role="admin"><CertificateLifecyclePage /></RoleRoute>} />
      <Route path="/admin/awards" element={<RoleRoute role="admin"><AdminAwardsPage /></RoleRoute>} />
      <Route path="/admin/moderation" element={<RoleRoute role="admin"><AdminModerationPage /></RoleRoute>} />
      <Route path="/admin/fulfillment" element={<RoleRoute role="admin"><AdminFulfillmentPage /></RoleRoute>} />
      <Route path="/admin/banners" element={<RoleRoute role="admin"><AdminBannersPage /></RoleRoute>} />
      <Route path="/admin/chat" element={<RoleRoute role="admin"><AdminChatPage /></RoleRoute>} />
    </Route>
    <Route path="*" element={<Navigate to="/" replace />} />
  </Routes>;
}

export default function App() { return <AppProvider><BrowserRouter><RuntimeGlobals /><AppRoutes /><ToastContainer /></BrowserRouter></AppProvider>; }
