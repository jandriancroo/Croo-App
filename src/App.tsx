import { useState, useEffect, lazy, Suspense } from "react";
import { Toaster } from "@/components/ui/toaster";
import { Toaster as Sonner } from "@/components/ui/sonner";
import { TooltipProvider } from "@/components/ui/tooltip";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { BrowserRouter, Routes, Route, Navigate } from "react-router-dom";
import { AuthProvider, useAuth } from "@/lib/auth";
import { LocationProvider, useLocation as useAppLocation } from "@/hooks/useLocation";
import { ProtectedRoute } from "@/components/ProtectedRoute";
import { CrooCashAnimationProvider } from "@/contexts/CrooCashAnimationContext";
import { DockToastProvider } from "@/contexts/DockToastContext";
import { DiagnosticMode } from "@/components/DiagnosticMode";
import BreakOverlay from "@/components/BreakOverlay";
import { useForceReload } from "@/hooks/useForceReload";
import { AppSplashScreen } from "@/components/AppSplashScreen";
import { ScrollToTop } from "./components/ScrollToTop";
import { usePrefetchDashboard } from "@/hooks/usePrefetchDashboard";

// Critical routes - loaded eagerly (auth flow)
import Auth from "./pages/Auth";

// Lazy-loaded dashboard (optimized for faster initial page load)
const Dashboard = lazy(() => import("./pages/Dashboard"));

// Lazy-loaded routes - only load when navigated to
const CreateChecklist = lazy(() => import("./pages/CreateChecklist"));
const EditChecklist = lazy(() => import("./pages/EditChecklist"));
const CompleteChecklist = lazy(() => import("./pages/CompleteChecklist"));
const DynamicChecklistCalendar = lazy(() => import("./pages/DynamicChecklistCalendar"));

const SubmissionDetails = lazy(() => import("./pages/SubmissionDetails"));
const UserManagement = lazy(() => import("./pages/UserManagement"));
const Settings = lazy(() => import("./pages/Settings"));
const Schedule = lazy(() => import("./pages/Schedule"));
const ShiftTemplates = lazy(() => import("./pages/ShiftTemplates"));
const ScheduleTemplates = lazy(() => import("./pages/ScheduleTemplates"));
const WeekTemplateBuilder = lazy(() => import("./pages/WeekTemplateBuilder"));
const TestingChecklist = lazy(() => import("./pages/TestingChecklist"));
const Availability = lazy(() => import("./pages/Availability"));
const Messages = lazy(() => import("./pages/Messages"));
const NotFound = lazy(() => import("./pages/NotFound"));
const PunchClock = lazy(() => import("./pages/PunchClock"));
const PayrollReview = lazy(() => import("./pages/PayrollReview"));
const Tasks = lazy(() => import("./pages/Tasks"));
const LogBook = lazy(() => import("./pages/LogBook"));
const Certifications = lazy(() => import("./pages/Certifications"));
const Alerts = lazy(() => import("./pages/Alerts"));
const LocationProfile = lazy(() => import("./pages/LocationProfile"));
const FontPreviewPage = lazy(() => import("./pages/FontPreviewPage"));
const TemperatureValidation = lazy(() => import("./pages/TemperatureValidation"));
const Index = lazy(() => import("./pages/Index"));
const WelcomeProfile = lazy(() => import("./pages/WelcomeProfile"));
const InstallGuide = lazy(() => import("./pages/InstallGuide"));
const ResetPassword = lazy(() => import("./pages/ResetPassword"));
const ForgotPassword = lazy(() => import("./pages/ForgotPassword"));
const MyWallet = lazy(() => import("./pages/MyWallet"));
const MyTeam = lazy(() => import("./pages/MyTeam"));
const CompletedStampPreview = lazy(() => import("./pages/CompletedStampPreview"));
const OrganizationProfile = lazy(() => import("./pages/OrganizationProfile"));
const BrandManagement = lazy(() => import("./pages/BrandManagement"));
const Hiring = lazy(() => import("./pages/Hiring"));
const PublicApplication = lazy(() => import("./pages/PublicApplication"));
const HiringChat = lazy(() => import("./pages/HiringChat"));
const ApplicantPortal = lazy(() => import("./pages/ApplicantPortal"));
const Changelog = lazy(() => import("./pages/Changelog"));
const PunchClockCustomization = lazy(() => import("./pages/PunchClockCustomization"));
const BrandDashboard = lazy(() => import("./pages/BrandDashboard"));
const MyProfile = lazy(() => import("./pages/MyProfile"));
const MultiLocationDashboard = lazy(() => import("./pages/MultiLocationDashboard"));
const Inventory = lazy(() => import("./pages/Inventory"));
const InventoryCount = lazy(() => import("./pages/InventoryCount"));
const Games = lazy(() => import("./pages/Games"));
const SnakeGame = lazy(() => import("./pages/SnakeGame"));
const MinesweeperGame = lazy(() => import("./pages/MinesweeperGame"));
const BasketballGame = lazy(() => import("./pages/BasketballGame"));
const PizzaPaddleGame = lazy(() => import("./pages/PizzaPaddleGame"));
const MarcManGame = lazy(() => import("./pages/MarcManGame"));
const QRCodeGenerator = lazy(() => import("./pages/QRCodeGenerator"));
const QRQuickTaskReport = lazy(() => import("./pages/QRQuickTaskReport"));
const FeatureTree = lazy(() => import("./pages/FeatureTree"));
const ArchitectureMap = lazy(() => import("./pages/ArchitectureMap"));
const RoleDashboardCustomizer = lazy(() => import("./pages/RoleDashboardCustomizer"));
const DockStylePreview = lazy(() => import("./pages/DockStylePreview"));
const DesignStylePreview = lazy(() => import("./pages/DesignStylePreview"));
const AvailabilityRequestPreview = lazy(() => import("./pages/AvailabilityRequestPreview"));
const VisionOSPreview = lazy(() => import("./pages/VisionOSPreview"));
const EmailPreview = lazy(() => import("./pages/EmailPreview"));
const SalesDesignPreview = lazy(() => import("./pages/SalesDesignPreview"));
const SalesPreviewVariations = lazy(() => import("./pages/SalesPreviewVariations"));
const TabStylePreview = lazy(() => import("./pages/TabStylePreview"));
const ChatListPreview = lazy(() => import("./pages/ChatListPreview"));

const queryClient = new QueryClient();

// Loading fallback for lazy routes
const PageLoader = () => (
  <div className="flex items-center justify-center min-h-screen bg-background">
    <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-primary"></div>
  </div>
);

// Component to handle force reload - separated to avoid hook ordering issues
const ForceReloadHandler = () => {
  useForceReload();
  return null;
};

// Wrapper to show splash screen during initial auth loading
const AppWithSplash = () => {
  const { loading, user } = useAuth();
  const { currentLocation } = useAppLocation();
  const [showSplash, setShowSplash] = useState(true);
  const [splashComplete, setSplashComplete] = useState(false);

  // Prefetch dashboard data while splash is visible (runs in background)
  // Uses America/Los_Angeles as default timezone - will be refined when location loads
  const timezone = 'America/Los_Angeles';
  usePrefetchDashboard(user?.id, currentLocation?.id, timezone);

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
  return (
    <Suspense fallback={<PageLoader />}>
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
        <Route path="/dock-style-preview" element={<ProtectedRoute><DockStylePreview /></ProtectedRoute>} />
        <Route path="/design-style-preview" element={<ProtectedRoute><DesignStylePreview /></ProtectedRoute>} />
        <Route path="/availability-request-preview" element={<AvailabilityRequestPreview />} />
        <Route path="/vision-preview" element={<ProtectedRoute><VisionOSPreview /></ProtectedRoute>} />
        <Route path="/email-preview" element={<ProtectedRoute><EmailPreview /></ProtectedRoute>} />
        <Route path="/sales-design-preview" element={<ProtectedRoute><SalesDesignPreview /></ProtectedRoute>} />
        <Route path="/sales-preview-variations" element={<ProtectedRoute><SalesPreviewVariations /></ProtectedRoute>} />
        <Route path="/tab-style-preview" element={<ProtectedRoute><TabStylePreview /></ProtectedRoute>} />
        <Route path="/chat-list-preview" element={<ProtectedRoute><ChatListPreview /></ProtectedRoute>} />
        
        <Route path="*" element={<NotFound />} />
      </Routes>
    </Suspense>
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
