import { useState, useEffect, type ReactNode } from 'react';
import { BrowserRouter, Routes, Route, Navigate, useLocation } from 'react-router-dom';
import { AppProvider, useApp } from '@/store/AppContext';
import { AppLayout } from '@/components/layout/AppLayout';
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
import { AdminChatPageV2 } from '@/pages/AdminChatPageV2';
import { AdminOrganizersPage } from '@/pages/AdminOrganizersPage';
import { AdminCurrencyPage } from '@/pages/AdminCurrencyPage';
import { ToastContainer } from '@/components/ui/ToastContainer';
import { getUserRoles } from '@/services/role.service';
import { supabase } from '@/lib/supabase';

function AuthGuard({ children }: { children: ReactNode }) { const { isAuthenticated, authLoading, isGuest } = useApp(); const location = useLocation(); if (authLoading) return <div className="min-h-screen flex items-center justify-center surface-bg"><div className="flex flex-col items-center gap-3"><div className="w-8 h-8 border-2 border-moss-500/30 border-t-moss-500 rounded-full animate-spin" /><p className="text-xs text-slate-500">Memuat sesi...</p></div></div>; if (isAuthenticated || isGuest) return <>{children}</>; return <Navigate to={`/login?redirect=${encodeURIComponent(location.pathname)}`} replace />; }
function RoleRoute({ role, children }: { role: 'admin' | 'organizer_member'; children: ReactNode }) { const { isAuthenticated } = useApp(); const [allowed,setAllowed]=useState<boolean|null>(null); useEffect(()=>{let on=true;if(!isAuthenticated){setAllowed(false);return()=>{on=false;};}(async()=>{const {data}=await supabase.auth.getUser();if(!data.user){if(on)setAllowed(false);return;}const roles=await getUserRoles(data.user.id);if(on)setAllowed(roles.includes(role)||roles.includes('admin'));})().catch(()=>on&&setAllowed(false));return()=>{on=false;};},[isAuthenticated,role]);if(!isAuthenticated)return <div className="min-h-screen flex items-center justify-center surface-bg"><p className="text-xs text-slate-500">Memeriksa sesi...</p></div>;if(allowed===null)return <div className="min-h-screen flex items-center justify-center surface-bg"><p className="text-xs text-slate-500">Memeriksa akses…</p></div>;if(!allowed)return <Navigate to="/home" replace/>;return <>{children}</>; }
function OrganizerShellRoute({ children }: { children: ReactNode }) { return <RoleRoute role="organizer_member"><OrganizerShell>{children}</OrganizerShell></RoleRoute>; }
function RuntimeGlobals(){const{toast}=useApp();useEffect(()=>{globalThis.toast=toast;return()=>{globalThis.toast=undefined;};},[toast]);return null;}
function AppRoutes(){return <Routes>
  <Route path="/" element={<LandingPage/>}/><Route path="/register" element={<RegisterPage/>}/><Route path="/login" element={<LoginPage/>}/><Route path="/verify/:code" element={<VerifyPage/>}/>
  <Route element={<AuthGuard><AppLayout/></AuthGuard>}>
    <Route path="/home" element={<HomePage/>}/><Route path="/feed" element={<SocialFeedPage/>}/><Route path="/lomba/:slug" element={<CompetitionDetailPage/>}/><Route path="/lomba/:slug/kerja" element={<CompetitionWorkPage/>}/><Route path="/lomba/:slug/twibbon" element={<TwibbonPage/>}/><Route path="/daily-tasks" element={<DailyTasksPage/>}/><Route path="/leaderboard" element={<LeaderboardPage/>}/><Route path="/awards" element={<AwardsPage/>}/><Route path="/profile/:username" element={<ProfilePage/>}/><Route path="/profile/edit" element={<EditProfilePage/>}/><Route path="/notifications" element={<NotificationsPage/>}/><Route path="/orders" element={<OrdersPage/>}/>
    <Route path="/organizer" element={<OrganizerShellRoute><OrganizerPage/></OrganizerShellRoute>}/><Route path="/organizer/question-bank/:bankId" element={<OrganizerShellRoute><OrganizerQuestionEditorPage/></OrganizerShellRoute>}/><Route path="/organizer/registrations" element={<OrganizerShellRoute><OrganizerRegistrationsPage/></OrganizerShellRoute>}/><Route path="/organizer/members" element={<OrganizerShellRoute><OrganizerMembersPage/></OrganizerShellRoute>}/><Route path="/organizer/competition/:id/config" element={<OrganizerShellRoute><OrganizerCompetitionConfigPage/></OrganizerShellRoute>}/><Route path="/organizer/grading" element={<OrganizerShellRoute><OrganizerGradingPage/></OrganizerShellRoute>}/><Route path="/organizer/plan" element={<OrganizerShellRoute><OrganizerPlanPage/></OrganizerShellRoute>}/><Route path="/organizer/ads" element={<OrganizerShellRoute><OrganizerAdRequestPage/></OrganizerShellRoute>}/>
    <Route path="/admin" element={<RoleRoute role="admin"><AdminPage/></RoleRoute>}/><Route path="/admin/roles" element={<RoleRoute role="admin"><AdminRolesPage/></RoleRoute>}/><Route path="/admin/orders/review" element={<RoleRoute role="admin"><AdminOrdersReviewPage/></RoleRoute>}/><Route path="/admin/operations" element={<RoleRoute role="admin"><AdminOperationsPage/></RoleRoute>}/><Route path="/admin/operations/certificates" element={<RoleRoute role="admin"><CertificateLifecyclePage/></RoleRoute>}/><Route path="/admin/awards" element={<RoleRoute role="admin"><AdminAwardsPage/></RoleRoute>}/><Route path="/admin/moderation" element={<RoleRoute role="admin"><AdminModerationPage/></RoleRoute>}/><Route path="/admin/fulfillment" element={<RoleRoute role="admin"><AdminFulfillmentPage/></RoleRoute>}/><Route path="/admin/banners" element={<RoleRoute role="admin"><AdminBannersPage/></RoleRoute>}/><Route path="/admin/chat" element={<AdminChatPageV2/>}/><Route path="/admin/organizers" element={<RoleRoute role="admin"><AdminOrganizersPage/></RoleRoute>}/><Route path="/admin/currency" element={<RoleRoute role="admin"><AdminCurrencyPage/></RoleRoute>}/>
  </Route><Route path="*" element={<Navigate to="/" replace/>}/>
</Routes>;}
function ChatAwareApp(){return <><AppRoutes/><ChatUXBridge/></>;}
export default function App(){return <AppProvider><BrowserRouter><RuntimeGlobals/><ChatAwareApp/><ToastContainer/></BrowserRouter></AppProvider>;}
