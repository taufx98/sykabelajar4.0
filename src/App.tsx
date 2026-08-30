import { useState, useEffect, type ReactNode } from 'react';
import { BrowserRouter, Routes, Route, Navigate } from 'react-router-dom';
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
import { ToastContainer } from '@/components/ui/ToastContainer';
import { getUserRoles } from '@/services/role.service';
import { supabase } from '@/lib/supabase';

/**
 * AuthGuard — wraps protected routes.
 * Rules:
 *   1. While auth is loading → render children (no redirect, no flash)
 *   2. Auth loaded + (authenticated or guest) → render children
 *   3. Auth loaded + not authenticated + not guest → redirect to /
 * Never redirects during loading. Never overrides user navigation.
 */
function AuthGuard({ children }: { children: ReactNode }) {
  const { isAuthenticated, authLoading, isGuest } = useApp();

  // Still checking auth → show page anyway (don't flash landing)
  if (authLoading) return <>{children}</>;

  // Authenticated or guest → allowed
  if (isAuthenticated || isGuest) return <>{children}</>;

  // Not authenticated, not guest → save current path and redirect to login
  const currentPath = window.location.pathname + window.location.search;
  const loginUrl = currentPath && currentPath !== '/'
    ? `/login?redirect=${encodeURIComponent(currentPath)}`
    : '/login';
  return <Navigate to={loginUrl} replace />;
}

/**
 * RoleRoute — wraps role-specific routes (admin, organizer).
 * Checks role after auth is confirmed by AuthGuard.
 */
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
    {/* Public routes — no auth guard */}
    <Route path="/" element={<LandingPage />} />
    <Route path="/register" element={<RegisterPage />} />
    <Route path="/login" element={<LoginPage />} />
    <Route path="/verify/:code" element={<VerifyPage />} />

    {/* Protected routes — wrapped in AuthGuard */}
    <Route element={<AuthGuard><AppLayout /></AuthGuard>}>
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

    {/* Catch-all → landing page */}
    <Route path="*" element={<Navigate to="/" replace />} />
  </Routes>;
}

export default function App() {
  return (
    <AppProvider>
      <BrowserRouter>
        <RuntimeGlobals />
        <AppRoutes />
        <ToastContainer />
      </BrowserRouter>
    </AppProvider>
  );
}
