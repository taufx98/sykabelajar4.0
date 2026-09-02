import { useEffect, type ReactNode } from 'react';
import { BrowserRouter, Navigate, Route, Routes, useLocation } from 'react-router-dom';
import { AppProvider, useApp } from '@/store/AppContext';
import { AppLayout } from '@/components/layout/AppLayout';
import { MobileNavigationOverride } from '@/components/layout/MobileNavigationOverride';
import { ChatUXBridge } from '@/components/chat/ChatUXBridge';
import { OrganizerShell } from '@/components/layout/OrganizerShell';
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
import { ProfilePageV3 } from '@/pages/ProfilePageV3';
import { ProfileInterfaceSettingsPage } from '@/pages/ProfileInterfaceSettingsPage';
import { EditProfilePage } from '@/pages/EditProfilePage';
import { NotificationsPageV2 } from '@/pages/NotificationsPageV2';
import { OrdersPage } from '@/pages/OrdersPage';
import { ReferralPage } from '@/pages/ReferralPage';
import { SocialFeedPage } from '@/pages/SocialFeedPage';
import { TwibbonPage } from '@/pages/TwibbonPage';
import { MessagesPageV6 } from '@/pages/MessagesPageV6';
import { AdminChatConsolePage } from '@/pages/AdminChatConsolePage';
import { AdminPage } from '@/pages/AdminPage';
import { AdminControlCenterPage } from '@/pages/AdminControlCenterPage';
import { AdminRolesPage } from '@/pages/AdminRolesPage';
import { AdminOrdersReviewPage } from '@/pages/AdminOrdersReviewPage';
import { AdminOperationsPage } from '@/pages/AdminOperationsPage';
import { AdminFulfillmentPage } from '@/pages/AdminFulfillmentPage';
import { AdminAwardsPage } from '@/pages/AdminAwardsPage';
import { AdminModerationPage } from '@/pages/AdminModerationPage';
import { CertificateLifecyclePage } from '@/pages/CertificateLifecyclePage';
import { AdminBannersPage } from '@/pages/AdminBannersPage';
import { AdminOrganizersPage } from '@/pages/AdminOrganizersPage';
import { AdminCurrencyPage } from '@/pages/AdminCurrencyPage';
import { AdminSocialNotificationSettingsPage } from '@/pages/AdminSocialNotificationSettingsPage';
import { AdminPlanUsagePage } from '@/pages/AdminPlanUsagePage';
import { AdminDailyTaskPage } from '@/pages/AdminDailyTaskPage';
import { OrganizerControlCenterPage } from '@/pages/OrganizerControlCenterPage';
import { OrganizerQuestionEditorPage } from '@/pages/OrganizerQuestionEditorPage';
import { OrganizerRegistrationsPage } from '@/pages/OrganizerRegistrationsPage';
import { OrganizerMembersPage } from '@/pages/OrganizerMembersPage';
import { OrganizerCompetitionConfigPage } from '@/pages/OrganizerCompetitionConfigPage';
import { OrganizerCompetitionCreatePage } from '@/pages/OrganizerCompetitionCreatePage';
import { OrganizerGradingPage } from '@/pages/OrganizerGradingPage';
import { OrganizerPlanPage } from '@/pages/OrganizerPlanPage';
import { OrganizerSerialsPage } from '@/pages/OrganizerSerialsPage';
import { OrganizerPage } from '@/pages/OrganizerPage';
import { OrganizerAdRequestPage } from '@/pages/OrganizerAdRequestPage';
import { ToastContainer } from '@/components/ui/ToastContainer';

function AuthGuard({ children }: { children: ReactNode }) {
  const { isAuthenticated, authLoading, isGuest } = useApp();
  const location = useLocation();
  if (authLoading) return <div className="min-h-screen flex items-center justify-center surface-bg"><p className="text-xs text-fg-muted">Memuat sesi...</p></div>;
  if (isAuthenticated || isGuest) return <>{children}</>;
  return <Navigate to={`/login?redirect=${encodeURIComponent(location.pathname)}`} replace />;
}

function RoleRoute({ role, children }: { role: 'admin' | 'organizer_member'; children: ReactNode }) {
  const { isAuthenticated, authLoading, user } = useApp();
  const allowed = !!user && (role === 'admin' ? user.role === 'admin' : user.role === 'penyelenggara' || user.role === 'admin');
  if (authLoading) return <div className="min-h-screen flex items-center justify-center surface-bg"><p className="text-xs text-fg-muted">Memuat sesi...</p></div>;
  if (!isAuthenticated) return <Navigate to="/login" replace />;
  if (!allowed) return <Navigate to="/home" replace />;
  return <>{children}</>;
}

function OrganizerShellRoute({ children }: { children: ReactNode }) {
  return <RoleRoute role="organizer_member"><OrganizerShell>{children}</OrganizerShell></RoleRoute>;
}

function RuntimeGlobals() { useEffect(() => undefined, []); return <MobileNavigationOverride />; }

function AppRoutes() {
  return <Routes>
    <Route path="/" element={<LandingPage />} />
    <Route path="/register" element={<RegisterPage />} />
    <Route path="/login" element={<LoginPage />} />
    <Route path="/verify/:code" element={<VerifyPage />} />
    <Route element={<AuthGuard><AppLayout /></AuthGuard>}>
      <Route path="/home" element={<HomePage />} />
      <Route path="/feed" element={<SocialFeedPage />} />
      <Route path="/lomba/:slug" element={<CompetitionDetailPage />} />
      <Route path="/lomba/:slug/kerja" element={<CompetitionWorkPage />} />
      <Route path="/lomba/:slug/twibbon" element={<TwibbonPage />} />
      <Route path="/daily-tasks" element={<DailyTasksPage />} />
      <Route path="/leaderboard" element={<LeaderboardPage />} />
      <Route path="/awards" element={<AwardsPage />} />
      <Route path="/referrals" element={<ReferralPage />} />
      <Route path="/profile/:username" element={<ProfilePageV3 />} />
      <Route path="/profile/interface-settings" element={<ProfileInterfaceSettingsPage />} />
      <Route path="/profile/edit" element={<EditProfilePage />} />
      <Route path="/notifications" element={<NotificationsPageV2 />} />
      <Route path="/orders" element={<OrdersPage />} />
      <Route path="/pesan" element={<MessagesPageV6 />} />
      <Route path="/organizer" element={<OrganizerShellRoute><OrganizerControlCenterPage /></OrganizerShellRoute>} />
      <Route path="/organizer/legacy" element={<OrganizerShellRoute><OrganizerPage /></OrganizerShellRoute>} />
      <Route path="/organizer/competition/new" element={<OrganizerShellRoute><OrganizerCompetitionCreatePage /></OrganizerShellRoute>} />
      <Route path="/organizer/question-bank/:bankId" element={<OrganizerShellRoute><OrganizerQuestionEditorPage /></OrganizerShellRoute>} />
      <Route path="/organizer/registrations" element={<OrganizerShellRoute><OrganizerRegistrationsPage /></OrganizerShellRoute>} />
      <Route path="/organizer/members" element={<OrganizerShellRoute><OrganizerMembersPage /></OrganizerShellRoute>} />
      <Route path="/organizer/competition/:id/config" element={<OrganizerShellRoute><OrganizerCompetitionConfigPage /></OrganizerShellRoute>} />
      <Route path="/organizer/grading" element={<OrganizerShellRoute><OrganizerGradingPage /></OrganizerShellRoute>} />
      <Route path="/organizer/plan" element={<OrganizerShellRoute><OrganizerPlanPage /></OrganizerShellRoute>} />
      <Route path="/organizer/serials" element={<OrganizerShellRoute><OrganizerSerialsPage /></OrganizerShellRoute>} />
      <Route path="/organizer/ads" element={<OrganizerShellRoute><OrganizerAdRequestPage /></OrganizerShellRoute>} />
      <Route path="/admin" element={<RoleRoute role="admin"><AdminControlCenterPage /></RoleRoute>} />
      <Route path="/admin/core" element={<RoleRoute role="admin"><AdminPage /></RoleRoute>} />
      <Route path="/admin/roles" element={<RoleRoute role="admin"><AdminRolesPage /></RoleRoute>} />
      <Route path="/admin/orders/review" element={<RoleRoute role="admin"><AdminOrdersReviewPage /></RoleRoute>} />
      <Route path="/admin/operations" element={<RoleRoute role="admin"><AdminOperationsPage /></RoleRoute>} />
      <Route path="/admin/operations/certificates" element={<RoleRoute role="admin"><CertificateLifecyclePage /></RoleRoute>} />
      <Route path="/admin/awards" element={<RoleRoute role="admin"><AdminAwardsPage /></RoleRoute>} />
      <Route path="/admin/moderation" element={<RoleRoute role="admin"><AdminModerationPage /></RoleRoute>} />
      <Route path="/admin/fulfillment" element={<RoleRoute role="admin"><AdminFulfillmentPage /></RoleRoute>} />
      <Route path="/admin/banners" element={<RoleRoute role="admin"><AdminBannersPage /></RoleRoute>} />
      <Route path="/admin/chat" element={<RoleRoute role="admin"><AdminChatConsolePage /></RoleRoute>} />
      <Route path="/admin/organizers" element={<RoleRoute role="admin"><AdminOrganizersPage /></RoleRoute>} />
      <Route path="/admin/currency" element={<RoleRoute role="admin"><AdminCurrencyPage /></RoleRoute>} />
      <Route path="/admin/social-notification-settings" element={<RoleRoute role="admin"><AdminSocialNotificationSettingsPage /></RoleRoute>} />
      <Route path="/admin/plan-usage" element={<RoleRoute role="admin"><AdminPlanUsagePage /></RoleRoute>} />
      <Route path="/admin/daily-tasks" element={<RoleRoute role="admin"><AdminDailyTaskPage /></RoleRoute>} />
    </Route>
    <Route path="*" element={<Navigate to="/" replace />} />
  </Routes>;
}

function ChatAwareApp() { return <><AppRoutes /><ChatUXBridge /></>; }
export default function App() { return <AppProvider><BrowserRouter><RuntimeGlobals /><ChatAwareApp /><ToastContainer /></BrowserRouter></AppProvider>; }