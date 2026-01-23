import { useState, useEffect } from "react";
import { Toaster } from "@/components/ui/toaster";
import { Toaster as Sonner } from "@/components/ui/sonner";
import { TooltipProvider } from "@/components/ui/tooltip";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { BrowserRouter, Routes, Route, Navigate } from "react-router-dom";
import { AuthProvider, useAuth } from "@/lib/auth";
import { LocationProvider } from "@/hooks/useLocation";
import { ProtectedRoute } from "@/components/ProtectedRoute";
import { usePushNotifications } from "@/hooks/usePushNotifications";
import { CrooCashAnimationProvider } from "@/contexts/CrooCashAnimationContext";
import { DockToastProvider } from "@/contexts/DockToastContext";
import { DiagnosticMode } from "@/components/DiagnosticMode";
import BreakOverlay from "@/components/BreakOverlay";
import { useForceReload } from "@/hooks/useForceReload";
import { AppSplashScreen } from "@/components/AppSplashScreen";
import Dashboard from "./pages/Dashboard";
import Auth from "./pages/Auth";
import CreateChecklist from "./pages/CreateChecklist";
import EditChecklist from "./pages/EditChecklist";
import CompleteChecklist from "./pages/CompleteChecklist";
import DynamicChecklistCalendar from "./pages/DynamicChecklistCalendar";
import History from "./pages/History";
import SubmissionDetails from "./pages/SubmissionDetails";
import UserManagement from "./pages/UserManagement";
import Settings from "./pages/Settings";
import Schedule from "./pages/Schedule";
import ShiftTemplates from "./pages/ShiftTemplates";
import ScheduleTemplates from "./pages/ScheduleTemplates";
import WeekTemplateBuilder from "./pages/WeekTemplateBuilder";
import TestingChecklist from "./pages/TestingChecklist";
import Availability from "./pages/Availability";
import Messages from "./pages/Messages";
import NotFound from "./pages/NotFound";
import PunchClock from "./pages/PunchClock";
import PayrollReview from "./pages/PayrollReview";
import Tasks from "./pages/Tasks";
import LogBook from "./pages/LogBook";
import Certifications from "./pages/Certifications";
import Alerts from "./pages/Alerts";
import LocationProfile from "./pages/LocationProfile";
import FontPreviewPage from "./pages/FontPreviewPage";
import TemperatureValidation from "./pages/TemperatureValidation";
import Index from "./pages/Index";
import WelcomeProfile from "./pages/WelcomeProfile";
import InstallGuide from "./pages/InstallGuide";
import ResetPassword from "./pages/ResetPassword";
import ForgotPassword from "./pages/ForgotPassword";
import MyWallet from "./pages/MyWallet";
import MyTeam from "./pages/MyTeam";

import CompletedStampPreview from "./pages/CompletedStampPreview";
import OrganizationProfile from "./pages/OrganizationProfile";
import BrandManagement from "./pages/BrandManagement";
import Hiring from "./pages/Hiring";
import PublicApplication from "./pages/PublicApplication";
import HiringChat from "./pages/HiringChat";
import ApplicantPortal from "./pages/ApplicantPortal";
import Changelog from "./pages/Changelog";
import PunchClockCustomization from "./pages/PunchClockCustomization";
import BrandDashboard from "./pages/BrandDashboard";
import MyProfile from "./pages/MyProfile";
import MultiLocationDashboard from "./pages/MultiLocationDashboard";
import Inventory from "./pages/Inventory";
import InventoryCount from "./pages/InventoryCount";
import Games from "./pages/Games";
import SnakeGame from "./pages/SnakeGame";
import MinesweeperGame from "./pages/MinesweeperGame";
import BasketballGame from "./pages/BasketballGame";
import PizzaPaddleGame from "./pages/PizzaPaddleGame";
import MarcManGame from "./pages/MarcManGame";
import QRCodeGenerator from "./pages/QRCodeGenerator";
import QRQuickTaskReport from "./pages/QRQuickTaskReport";
import FeatureTree from "./pages/FeatureTree";
import ArchitectureMap from "./pages/ArchitectureMap";
import RoleDashboardCustomizer from "./pages/RoleDashboardCustomizer";
import { ScrollToTop } from "./components/ScrollToTop";

const queryClient = new QueryClient();

// Component to handle force reload - separated to avoid hook ordering issues
const ForceReloadHandler = () => {
  useForceReload();
  return null;
};

// Wrapper to show splash screen during initial auth loading
const AppWithSplash = () => {
  const { loading } = useAuth();
  const [showSplash, setShowSplash] = useState(true);
  const [splashComplete, setSplashComplete] = useState(false);

  // Only show splash on initial cold start (not on every route change)
  useEffect(() => {
    // If auth is done loading and splash animation completed, hide splash
    if (!loading && splashComplete) {
      setShowSplash(false);
    }
  }, [loading, splashComplete]);

  // Handle splash animation completion
  const handleSplashComplete = () => {
    setSplashComplete(true);
  };

  return (
    <>
      <ForceReloadHandler />
      {showSplash && <AppSplashScreen onComplete={handleSplashComplete} />}
      <AppContent />
    </>
  );
};

const AppContent = () => {
  // Don't setup push notifications until user navigates to protected routes
  // This prevents blocking the auth page
  return (
        <Routes>
          <Route path="/" element={<Navigate to="/auth" replace />} />
          <Route path="/auth" element={<Auth />} />
          <Route path="/reset-password" element={<ResetPassword />} />
          <Route path="/forgot-password" element={<ForgotPassword />} />
          <Route path="/landing" element={<Index />} />
          <Route path="/stamp-preview" element={<CompletedStampPreview />} />
          <Route path="/install" element={<InstallGuide />} />
          <Route path="/apply/:orgSlug" element={<PublicApplication />} />
          <Route path="/qr/:qrCode" element={<QRQuickTaskReport />} />
          <Route path="/hiring-chat/:token" element={<HiringChat />} />
          <Route path="/my-applications" element={<ApplicantPortal />} />
          <Route path="/welcome" element={<ProtectedRoute><WelcomeProfile /></ProtectedRoute>} />
          <Route path="/dashboard" element={<ProtectedRoute><Dashboard /></ProtectedRoute>} />
      <Route path="/tasks" element={<ProtectedRoute><Tasks /></ProtectedRoute>} />
      <Route path="/logbook" element={<ProtectedRoute><LogBook /></ProtectedRoute>} />
      <Route path="/create" element={<ProtectedRoute><CreateChecklist /></ProtectedRoute>} />
      <Route path="/create-checklist" element={<ProtectedRoute><CreateChecklist /></ProtectedRoute>} />
      <Route path="/edit/:id" element={<ProtectedRoute><EditChecklist /></ProtectedRoute>} />
      <Route path="/edit-checklist/:id" element={<ProtectedRoute><EditChecklist /></ProtectedRoute>} />
      <Route path="/dynamic-checklist/:id" element={<ProtectedRoute><DynamicChecklistCalendar /></ProtectedRoute>} />
      <Route path="/complete/:id" element={<ProtectedRoute><CompleteChecklist /></ProtectedRoute>} />
      <Route path="/complete-checklist/:id" element={<ProtectedRoute><CompleteChecklist /></ProtectedRoute>} />
      <Route path="/history" element={<ProtectedRoute><History /></ProtectedRoute>} />
      <Route path="/submission/:id" element={<ProtectedRoute><SubmissionDetails /></ProtectedRoute>} />
      <Route path="/users" element={<ProtectedRoute><UserManagement /></ProtectedRoute>} />
      <Route path="/my-team" element={<ProtectedRoute><MyTeam /></ProtectedRoute>} />
      <Route path="/schedule" element={<ProtectedRoute><Schedule /></ProtectedRoute>} />
      <Route path="/shift-templates" element={<ProtectedRoute><ShiftTemplates /></ProtectedRoute>} />
      <Route path="/schedule-templates" element={<ProtectedRoute><ScheduleTemplates /></ProtectedRoute>} />
      <Route path="/week-template/:id" element={<ProtectedRoute><WeekTemplateBuilder /></ProtectedRoute>} />
      <Route path="/availability" element={<ProtectedRoute><Availability /></ProtectedRoute>} />
      <Route path="/messages" element={<ProtectedRoute><Messages /></ProtectedRoute>} />
      <Route path="/punch-clock" element={<PunchClock />} />
      <Route path="/time-tracking" element={<ProtectedRoute><PayrollReview /></ProtectedRoute>} />
      <Route path="/settings" element={<ProtectedRoute><Settings /></ProtectedRoute>} />
      <Route path="/location/:locationId" element={<ProtectedRoute><LocationProfile /></ProtectedRoute>} />
      <Route path="/location/:locationId/punch-clock" element={<ProtectedRoute><PunchClockCustomization /></ProtectedRoute>} />
      <Route path="/organization/:id" element={<ProtectedRoute><OrganizationProfile /></ProtectedRoute>} />
      <Route path="/organization/:organizationId/role-dashboard" element={<ProtectedRoute><RoleDashboardCustomizer /></ProtectedRoute>} />
      <Route path="/brands" element={<ProtectedRoute><BrandManagement /></ProtectedRoute>} />
      <Route path="/certifications" element={<ProtectedRoute><Certifications /></ProtectedRoute>} />
      <Route path="/alerts" element={<ProtectedRoute><Alerts /></ProtectedRoute>} />
      <Route path="/font-preview" element={<ProtectedRoute><FontPreviewPage /></ProtectedRoute>} />
      <Route path="/temperature-validation" element={<ProtectedRoute><TemperatureValidation /></ProtectedRoute>} />
      <Route path="/my-wallet" element={<ProtectedRoute><MyWallet /></ProtectedRoute>} />
      <Route path="/my-profile" element={<ProtectedRoute><MyProfile /></ProtectedRoute>} />
      {/* Role Management moved to Organization Profile page */}
      <Route path="/hiring" element={<ProtectedRoute><Hiring /></ProtectedRoute>} />
      <Route path="/changelog" element={<ProtectedRoute><Changelog /></ProtectedRoute>} />
      <Route path="/brand-dashboard" element={<ProtectedRoute><BrandDashboard /></ProtectedRoute>} />
      <Route path="/org-dash" element={<ProtectedRoute><MultiLocationDashboard /></ProtectedRoute>} />
      <Route path="/inventory/:locationId" element={<ProtectedRoute><Inventory /></ProtectedRoute>} />
      <Route path="/inventory/:locationId/count/:countId" element={<ProtectedRoute><InventoryCount /></ProtectedRoute>} />
      <Route path="/games" element={<ProtectedRoute><Games /></ProtectedRoute>} />
      <Route path="/games/snake" element={<ProtectedRoute><SnakeGame /></ProtectedRoute>} />
      <Route path="/games/minesweeper" element={<ProtectedRoute><MinesweeperGame /></ProtectedRoute>} />
      <Route path="/games/basketball" element={<ProtectedRoute><BasketballGame /></ProtectedRoute>} />
      <Route path="/games/pizza" element={<ProtectedRoute><PizzaPaddleGame /></ProtectedRoute>} />
      <Route path="/games/marcman" element={<ProtectedRoute><MarcManGame /></ProtectedRoute>} />
      <Route path="/qr-generator" element={<QRCodeGenerator />} />
      <Route path="/feature-tree" element={<ProtectedRoute><FeatureTree /></ProtectedRoute>} />
      <Route path="/architecture-map" element={<ProtectedRoute><ArchitectureMap /></ProtectedRoute>} />
      <Route path="/testing-checklist" element={<ProtectedRoute><TestingChecklist /></ProtectedRoute>} />
      <Route path="*" element={<NotFound />} />
    </Routes>
  );
};

const App = () => (
  <QueryClientProvider client={queryClient}>
    <TooltipProvider>
      <Toaster />
      <Sonner />
      <BrowserRouter>
        <ScrollToTop />
        <AuthProvider>
          <LocationProvider>
            <CrooCashAnimationProvider>
              <DockToastProvider>
                <DiagnosticMode />
                <BreakOverlay />
                <AppWithSplash />
              </DockToastProvider>
            </CrooCashAnimationProvider>
          </LocationProvider>
        </AuthProvider>
      </BrowserRouter>
    </TooltipProvider>
  </QueryClientProvider>
);

export default App;
