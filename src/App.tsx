import { BrowserRouter, Navigate, Route, Routes, useLocation } from 'react-router-dom';
import { lazy, Suspense, type ReactNode, useEffect } from 'react';
import { AppProvider, useApp } from '@/store/AppContext';
import { supabase } from '@/lib/supabase';
import { AppLayout } from '@/components/layout/AppLayout';
import { MobileNavigationOverride } from '@/components/layout/MobileNavigationOverride';
import { ChatUXBridge } from '@/components/chat/ChatUXBridge';
import { OrganizerShell } from '@/components/layout/OrganizerShell';
import { LandingPage } from '@/pages/LandingPage';
import { RegisterPage } from '@/pages/RegisterPage';
import { LoginPage } from '@/pages/LoginPage';
import { HomePage } from '@/pages/HomePage';
import { VerifyPage } from '@/pages/VerifyPage';
import { ToastContainer } from '@/components/ui/ToastContainer';

const CompetitionDetailPage = lazy(() => import('@/pages/CompetitionDetailPage').then((module) => ({ default: module.CompetitionDetailPage })));
const CompetitionWorkPage = lazy(() => import('@/pages/CompetitionWorkPage').then((module) => ({ default: module.CompetitionWorkPage })));
const DailyTasksPage = lazy(() => import('@/pages/DailyTasksPage').then((module) => ({ default: module.DailyTasksPage })));
const LeaderboardPage = lazy(() => import('@/pages/LeaderboardPage').then((module) => ({ default: module.LeaderboardPage })));
const AwardsPage = lazy(() => import('@/pages/AwardsPage').then((module) => ({ default: module.AwardsPage })));
const ProfilePage = lazy(() => import('@/pages/ProfilePage').then((module) => ({ default: module.ProfilePage })));
const ProfileInterfaceSettingsPage = lazy(() => import('@/pages/ProfileInterfaceSettingsPage').then((module) => ({ default: module.ProfileInterfaceSettingsPage })));
const EditProfilePage = lazy(() => import('@/pages/EditProfilePage').then((module) => ({ default: module.EditProfilePage })));
const NotificationsPage = lazy(() => import('@/pages/NotificationsPage').then((module) => ({ default: module.NotificationsPage })));
const OrdersPage = lazy(() => import('@/pages/OrdersPage').then((module) => ({ default: module.OrdersPage })));
const ReferralPage = lazy(() => import('@/pages/ReferralPage').then((module) => ({ default: module.ReferralPage })));
const SocialFeedPage = lazy(() => import('@/pages/SocialFeedPage').then((module) => ({ default: module.SocialFeedPage })));
const TwibbonPage = lazy(() => import('@/pages/TwibbonPage').then((module) => ({ default: module.TwibbonPage })));
const MessagesPage = lazy(() => import('@/pages/MessagesPage').then((module) => ({ default: module.MessagesPage })));
const CollectiveMessagesPage = lazy(() => import('@/pages/CollectiveMessagesPage').then((module) => ({ default: module.CollectiveMessagesPage })));
const AdminChatConsolePage = lazy(() => import('@/pages/AdminChatConsolePage').then((module) => ({ default: module.AdminChatConsolePage })));
const AdminPage = lazy(() => import('@/pages/AdminPage').then((module) => ({ default: module.AdminPage })));
const AdminControlCenterPage = lazy(() => import('@/pages/AdminControlCenterPage').then((module) => ({ default: module.AdminControlCenterPage })));
const AdminErrorIntelligencePage = lazy(() => import('@/pages/AdminErrorIntelligencePage').then((module) => ({ default: module.AdminErrorIntelligencePage })));
const AdminRolesPage = lazy(() => import('@/pages/AdminRolesPage').then((module) => ({ default: module.AdminRolesPage })));
const AdminBadgesPage = lazy(() => import('@/pages/AdminBadgesPage').then((module) => ({ default: module.AdminBadgesPage })));
const AdminOrdersReviewPage = lazy(() => import('@/pages/AdminOrdersReviewPage').then((module) => ({ default: module.AdminOrdersReviewPage })));
const AdminOperationsPage = lazy(() => import('@/pages/AdminOperationsPage').then((module) => ({ default: module.AdminOperationsPage })));
const AdminFulfillmentPage = lazy(() => import('@/pages/AdminFulfillmentPage').then((module) => ({ default: module.AdminFulfillmentPage })));
const AdminAwardsPage = lazy(() => import('@/pages/AdminAwardsPage').then((module) => ({ default: module.AdminAwardsPage })));
const AdminModerationPage = lazy(() => import('@/pages/AdminModerationPage').then((module) => ({ default: module.AdminModerationPage })));
const CertificateLifecyclePage = lazy(() => import('@/pages/CertificateLifecyclePage').then((module) => ({ default: module.CertificateLifecyclePage })));
const AdminBannersPage = lazy(() => import('@/pages/AdminBannersPage').then((module) => ({ default: module.AdminBannersPage })));
const AdminOrganizersPage = lazy(() => import('@/pages/AdminOrganizersPage').then((module) => ({ default: module.AdminOrganizersPage })));
const AdminCurrencyPage = lazy(() => import('@/pages/AdminCurrencyPage').then((module) => ({ default: module.AdminCurrencyPage })));
const AdminSocialNotificationSettingsPage = lazy(() => import('@/pages/AdminSocialNotificationSettingsPage').then((module) => ({ default: module.AdminSocialNotificationSettingsPage })));
const AdminPlanUsagePage = lazy(() => import('@/pages/AdminPlanUsagePage').then((module) => ({ default: module.AdminPlanUsagePage })));
const AdminPaymentSettingsPage = lazy(() => import('@/pages/AdminPaymentSettingsPage').then((module) => ({ default: module.AdminPaymentSettingsPage })));
const AdminDailyTaskPage = lazy(() => import('@/pages/AdminDailyTaskPage').then((module) => ({ default: module.AdminDailyTaskPage })));
const AdminCollectiveCertificateSettingsPage = lazy(() => import('@/pages/AdminCollectiveCertificateSettingsPage').then((module) => ({ default: module.AdminCollectiveCertificateSettingsPage })));
const OrganizerControlCenterPage = lazy(() => import('@/pages/OrganizerControlCenterPage').then((module) => ({ default: module.OrganizerControlCenterPage })));
const OrganizerQuestionEditorPage = lazy(() => import('@/pages/OrganizerQuestionEditorPage').then((module) => ({ default: module.OrganizerQuestionEditorPage })));
const OrganizerRegistrationsPage = lazy(() => import('@/pages/OrganizerRegistrationsPage').then((module) => ({ default: module.OrganizerRegistrationsPage })));
const OrganizerMembersPage = lazy(() => import('@/pages/OrganizerMembersPage').then((module) => ({ default: module.OrganizerMembersPage })));
const OrganizerCompetitionConfigPage = lazy(() => import('@/pages/OrganizerCompetitionConfigPage').then((module) => ({ default: module.OrganizerCompetitionConfigPage })));
const OrganizerCompetitionCreatePage = lazy(() => import('@/pages/OrganizerCompetitionCreatePage').then((module) => ({ default: module.OrganizerCompetitionCreatePage })));
const OrganizerGradingPage = lazy(() => import('@/pages/OrganizerGradingPage').then((module) => ({ default: module.OrganizerGradingPage })));
const OrganizerPlanPage = lazy(() => import('@/pages/OrganizerPlanPage').then((module) => ({ default: module.OrganizerPlanPage })));
const OrganizerSerialsPage = lazy(() => import('@/pages/OrganizerSerialsPage').then((module) => ({ default: module.OrganizerSerialsPage })));
const OrganizerAdRequestPage = lazy(() => import('@/pages/OrganizerAdRequestPage').then((module) => ({ default: module.OrganizerAdRequestPage })));
const GuruCollectivePage = lazy(() => import('@/pages/GuruCollectivePage').then((module) => ({ default: module.GuruCollectivePage })));
const GuruAccessCardsPage = lazy(() => import('@/pages/GuruAccessCardsPage').then((module) => ({ default: module.GuruAccessCardsPage })));
const GuruCollectiveMonitoringPage = lazy(() => import('@/pages/GuruCollectiveMonitoringPage').then((module) => ({ default: module.GuruCollectiveMonitoringPage })));
const GuruCollectiveRegistrationWizardPage = lazy(() => import('@/pages/GuruCollectiveRegistrationWizardPage').then((module) => ({ default: module.GuruCollectiveRegistrationWizardPage })));
const CollectiveParticipantPortalPage = lazy(() => import('@/pages/CollectiveParticipantPortalPage').then((module) => ({ default: module.CollectiveParticipantPortalPage })));
const CollectiveParticipantWorkPage = lazy(() => import('@/pages/CollectiveParticipantWorkPage').then((module) => ({ default: module.CollectiveParticipantWorkPage })));
const CollectiveParticipantClaimPage = lazy(() => import('@/pages/CollectiveParticipantClaimPage').then((module) => ({ default: module.CollectiveParticipantClaimPage })));
const CollectiveHistoryPage = lazy(() => import('@/pages/CollectiveHistoryPage').then((module) => ({ default: module.CollectiveHistoryPage })));
const CollectiveCertificatePage = lazy(() => import('@/pages/CollectiveCertificatePage').then((module) => ({ default: module.CollectiveCertificatePage })));
const CollectiveParticipantLoginPage = lazy(() => import('@/pages/CollectiveParticipantLoginPage').then((module) => ({ default: module.CollectiveParticipantLoginPage })));

function AuthGuard({ children }: { children: ReactNode }) {
  const { isAuthenticated, authLoading, isGuest } = useApp();
  const location = useLocation();
  const collectiveChatSession = location.pathname === '/pesan' && typeof window !== 'undefined' && Boolean(sessionStorage.getItem('syka_collective_access_token'));
  if (authLoading) return <div className="min-h-screen flex items-center justify-center surface-bg"><p className="text-xs text-fg-muted">Memuat sesi...</p></div>;
  if (isAuthenticated || isGuest || collectiveChatSession) return <>{children}</>;
  return <Navigate to={`/login?redirect=${encodeURIComponent(location.pathname)}`} replace />;
}

function RoleRoute({ role, children }: { role: 'admin' | 'organizer_member' | 'teacher'; children: ReactNode }) {
  const { isAuthenticated, authLoading, user } = useApp();
  const allowed = !!user && (role === 'admin' ? user.role === 'admin' : role === 'teacher' ? user.role === 'guru' || user.role === 'admin' : user.role === 'penyelenggara' || user.role === 'admin');
  if (authLoading) return <div className="min-h-screen flex items-center justify-center surface-bg"><p className="text-xs text-fg-muted">Memuat sesi...</p></div>;
  if (!isAuthenticated) return <Navigate to="/login" replace />;
  if (!allowed) return <Navigate to="/home" replace />;
  return <>{children}</>;
}

function OrganizerShellRoute({ children }: { children: ReactNode }) {
  return <RoleRoute role="organizer_member"><OrganizerShell>{children}</OrganizerShell></RoleRoute>;
}

function RuntimeGlobals() {
  return <MobileNavigationOverride />;
}

function ChatSessionIsolation() {
  useEffect(() => {
    let previousUserId: string | null = null;
    let reloading = false;
    const loadInitial = async () => {
      const { data } = await supabase.auth.getSession();
      previousUserId = data.session?.user?.id ?? null;
    };
    void loadInitial();
    const { data: listener } = supabase.auth.onAuthStateChange((event, session) => {
      const nextUserId = session?.user?.id ?? null;
      if (event === 'SIGNED_OUT' || (event === 'SIGNED_IN' && previousUserId !== null && nextUserId !== previousUserId)) {
        if (!reloading) {
          reloading = true;
          window.location.reload();
        }
        return;
      }
      previousUserId = nextUserId;
    });
    return () => listener.subscription.unsubscribe();
  }, []);
  return null;
}

function RouteLoading() {
  return (
    <div className="min-h-[45vh] flex items-center justify-center px-4" aria-live="polite" aria-busy="true">
      <div className="w-full max-w-sm rounded-2xl surface-card-bg surface-border border p-5 shadow-sm">
        <div className="h-3 w-24 rounded-full bg-fg-muted/15 animate-pulse" />
        <div className="mt-3 h-6 w-3/4 rounded-lg bg-fg-muted/15 animate-pulse" />
        <div className="mt-4 h-3 w-full rounded-full bg-fg-muted/10 animate-pulse" />
        <div className="mt-2 h-3 w-5/6 rounded-full bg-fg-muted/10 animate-pulse" />
      </div>
    </div>
  );
}

function MessagesEntryPage() {
  const { user, authLoading } = useApp();
  const collectiveChatSession = typeof window !== 'undefined' && Boolean(sessionStorage.getItem('syka_collective_access_token')) && !user;
  if (authLoading) return <RouteLoading />;
  return collectiveChatSession ? <CollectiveMessagesPage /> : <MessagesPage />;
}

function AppRoutes() {
  return (
    <Suspense fallback={<RouteLoading />}>
      <Routes>
        <Route path="/" element={<LandingPage />} />
        <Route path="/register" element={<RegisterPage />} />
        <Route path="/login" element={<LoginPage />} />
        <Route path="/verify/:code" element={<VerifyPage />} />
        <Route path="/sertifikat-kolektif/:code" element={<CollectiveCertificatePage />} />
        <Route path="/peserta-kolektif/login" element={<CollectiveParticipantLoginPage />} />
        <Route path="/peserta-kolektif" element={<CollectiveParticipantPortalPage />} />
        <Route path="/peserta-kolektif/kerja" element={<CollectiveParticipantWorkPage />} />
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
          <Route path="/profile/:username" element={<ProfilePage />} />
          <Route path="/profile/interface-settings" element={<ProfileInterfaceSettingsPage />} />
          <Route path="/profile/edit" element={<EditProfilePage />} />
          <Route path="/notifications" element={<NotificationsPage />} />
          <Route path="/orders" element={<OrdersPage />} />
          <Route path="/pesan" element={<MessagesEntryPage />} />
          <Route path="/claim-peserta-kolektif" element={<CollectiveParticipantClaimPage />} />
          <Route path="/profile/collective-history" element={<CollectiveHistoryPage />} />
          <Route path="/guru" element={<RoleRoute role="teacher"><GuruCollectivePage /></RoleRoute>} />
          <Route path="/guru/daftar" element={<RoleRoute role="teacher"><GuruCollectiveRegistrationWizardPage /></RoleRoute>} />
          <Route path="/guru/kartu" element={<RoleRoute role="teacher"><GuruAccessCardsPage /></RoleRoute>} />
          <Route path="/guru/monitoring" element={<RoleRoute role="teacher"><GuruCollectiveMonitoringPage /></RoleRoute>} />
          <Route path="/organizer" element={<OrganizerShellRoute><OrganizerControlCenterPage /></OrganizerShellRoute>} />
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
          <Route path="/admin/error-intelligence" element={<RoleRoute role="admin"><AdminErrorIntelligencePage /></RoleRoute>} />
          <Route path="/admin/roles" element={<RoleRoute role="admin"><AdminRolesPage /></RoleRoute>} />
          <Route path="/admin/badges" element={<RoleRoute role="admin"><AdminBadgesPage /></RoleRoute>} />
          <Route path="/admin/orders/review" element={<RoleRoute role="admin"><AdminOrdersReviewPage /></RoleRoute>} />
          <Route path="/admin/operations" element={<RoleRoute role="admin"><AdminOperationsPage /></RoleRoute>} />
          <Route path="/admin/operations/certificates" element={<RoleRoute role="admin"><CertificateLifecyclePage /></RoleRoute>} />
          <Route path="/admin/collective-certificates/settings" element={<RoleRoute role="admin"><AdminCollectiveCertificateSettingsPage /></RoleRoute>} />
          <Route path="/admin/awards" element={<RoleRoute role="admin"><AdminAwardsPage /></RoleRoute>} />
          <Route path="/admin/moderation" element={<RoleRoute role="admin"><AdminModerationPage /></RoleRoute>} />
          <Route path="/admin/fulfillment" element={<RoleRoute role="admin"><AdminFulfillmentPage /></RoleRoute>} />
          <Route path="/admin/banners" element={<RoleRoute role="admin"><AdminBannersPage /></RoleRoute>} />
          <Route path="/admin/chat" element={<RoleRoute role="admin"><AdminChatConsolePage /></RoleRoute>} />
          <Route path="/admin/organizers" element={<RoleRoute role="admin"><AdminOrganizersPage /></RoleRoute>} />
          <Route path="/admin/currency" element={<RoleRoute role="admin"><AdminCurrencyPage /></RoleRoute>} />
          <Route path="/admin/social-notification-settings" element={<RoleRoute role="admin"><AdminSocialNotificationSettingsPage /></RoleRoute>} />
          <Route path="/admin/plan-usage" element={<RoleRoute role="admin"><AdminPlanUsagePage /></RoleRoute>} />
          <Route path="/admin/payment-settings" element={<RoleRoute role="admin"><AdminPaymentSettingsPage /></RoleRoute>} />
          <Route path="/admin/daily-tasks" element={<RoleRoute role="admin"><AdminDailyTaskPage /></RoleRoute>} />
        </Route>
        <Route path="*" element={<Navigate to="/" replace />} />
      </Routes>
    </Suspense>
  );
}

function ChatAwareApp() {
  return <><AppRoutes /><ChatUXBridge /></>;
}

export default function App() {
  return <AppProvider><BrowserRouter><RuntimeGlobals /><ChatSessionIsolation /><ChatAwareApp /><ToastContainer /></BrowserRouter></AppProvider>;
}
