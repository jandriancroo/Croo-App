import { useState, useEffect, Suspense } from "react";
import { HelmetProvider } from "react-helmet-async";
import { lazyWithRetry } from "@/utils/lazyWithRetry";
import { Toaster } from "@/components/ui/toaster";
import { Toaster as Sonner } from "@/components/ui/sonner";
import { TooltipProvider } from "@/components/ui/tooltip";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { BrowserRouter, Routes, Route, Navigate } from "react-router-dom";
import { AuthProvider, useAuth } from "@/lib/auth";
import { LocationProvider, useLocation as useAppLocation } from "@/hooks/useLocation";
import { ProtectedRoute } from "@/components/ProtectedRoute";
import { FEATURE_FLAGS } from "@/config/featureFlags";
import { CrooCashAnimationProvider } from "@/contexts/CrooCashAnimationContext";
import { DockToastProvider } from "@/contexts/DockToastContext";
import { DiagnosticMode } from "@/components/DiagnosticMode";
import BreakOverlay from "@/components/BreakOverlay";
import PinMigrationOverlay from "@/components/PinMigrationOverlay";
import { VisualAlertStack } from "@/components/visual-alerts/VisualAlertStack";
import { useForceReload } from "@/hooks/useForceReload";
import { AppSplashScreen } from "@/components/AppSplashScreen";
import { ScrollToTop } from "./components/ScrollToTop";
import { usePrefetchDashboard } from "@/hooks/usePrefetchDashboard";
import { KioskAutoRestore } from "@/components/KioskAutoRestore";


// Critical routes - loaded eagerly (auth flow)
import Auth from "./pages/Auth";

// Lazy-loaded dashboard (optimized for faster initial page load)
const Dashboard = lazyWithRetry(() => import("./pages/Dashboard"));

// Lazy-loaded routes - only load when navigated to
const CreateChecklist = lazyWithRetry(() => import("./pages/CreateChecklist"));
const EditChecklist = lazyWithRetry(() => import("./pages/EditChecklist"));
const CompleteChecklist = lazyWithRetry(() => import("./pages/CompleteChecklist"));
const DynamicChecklistCalendar = lazyWithRetry(() => import("./pages/DynamicChecklistCalendar"));

const SubmissionDetails = lazyWithRetry(() => import("./pages/SubmissionDetails"));
const UserManagement = lazyWithRetry(() => import("./pages/UserManagement"));
const Settings = lazyWithRetry(() => import("./pages/Settings"));
const Schedule = lazyWithRetry(() => import("./pages/Schedule"));
const ShiftTemplates = lazyWithRetry(() => import("./pages/ShiftTemplates"));
const ScheduleTemplates = lazyWithRetry(() => import("./pages/ScheduleTemplates"));
const WeekTemplateBuilder = lazyWithRetry(() => import("./pages/WeekTemplateBuilder"));
const TestingChecklist = lazyWithRetry(() => import("./pages/TestingChecklist"));
const Availability = lazyWithRetry(() => import("./pages/Availability"));
const Messages = lazyWithRetry(() => import("./pages/Messages"));
const NotFound = lazyWithRetry(() => import("./pages/NotFound"));
const PunchClock = lazyWithRetry(() => import("./pages/PunchClock"));
const PayrollReview = lazyWithRetry(() => import("./pages/PayrollReview"));
const Tasks = lazyWithRetry(() => import("./pages/Tasks"));
const LogBook = lazyWithRetry(() => import("./pages/LogBook"));
const Certifications = lazyWithRetry(() => import("./pages/Certifications"));
const Alerts = lazyWithRetry(() => import("./pages/Alerts"));
const LocationProfile = lazyWithRetry(() => import("./pages/LocationProfile"));
const FontPreviewPage = lazyWithRetry(() => import("./pages/FontPreviewPage"));
const DashboardPreview = lazyWithRetry(() => import("./pages/DashboardPreview"));
const DashboardPreviewRestaurant = lazyWithRetry(() => import("./pages/DashboardPreviewRestaurant"));
const TemperatureValidation = lazyWithRetry(() => import("./pages/TemperatureValidation"));
const Home = lazyWithRetry(() => import("./pages/Home"));
const ReviewLanding = lazyWithRetry(() => import("./pages/ReviewLanding"));

const WelcomeProfile = lazyWithRetry(() => import("./pages/WelcomeProfile"));
const InstallGuide = lazyWithRetry(() => import("./pages/InstallGuide"));
const ResetPassword = lazyWithRetry(() => import("./pages/ResetPassword"));
const ForgotPassword = lazyWithRetry(() => import("./pages/ForgotPassword"));
const MyTimecard = lazyWithRetry(() => import("./pages/MyTimecard"));
const MyTeam = lazyWithRetry(() => import("./pages/MyTeam"));

const OrganizationProfile = lazyWithRetry(() => import("./pages/OrganizationProfile"));
const BrandManagement = lazyWithRetry(() => import("./pages/BrandManagement"));
const SuperAdminPlans = lazyWithRetry(() => import("./pages/SuperAdminPlans"));
const Hiring = lazyWithRetry(() => import("./pages/Hiring"));
const PublicApplication = lazyWithRetry(() => import("./pages/PublicApplication"));
const PublicJobs = lazyWithRetry(() => import("./pages/PublicJobs"));
const JobDetail = lazyWithRetry(() => import("./pages/JobDetail"));
const HiringChat = lazyWithRetry(() => import("./pages/HiringChat"));
const ApplicantPortal = lazyWithRetry(() => import("./pages/ApplicantPortal"));
const Changelog = lazyWithRetry(() => import("./pages/Changelog"));
const PunchClockCustomization = lazyWithRetry(() => import("./pages/PunchClockCustomization"));
const BrandDashboard = lazyWithRetry(() => import("./pages/BrandDashboard"));
const MyProfile = lazyWithRetry(() => import("./pages/MyProfile"));
const MultiLocationDashboard = lazyWithRetry(() => import("./pages/MultiLocationDashboard"));
const ToastPreview = lazyWithRetry(() => import("./pages/ToastPreview"));
const TimeTrackingPreview = lazyWithRetry(() => import("./pages/TimeTrackingPreview"));

const Billing = lazyWithRetry(() => import("./pages/Billing"));
const Reporting = lazyWithRetry(() => import("./pages/Reporting"));
const Terms = lazyWithRetry(() => import("./pages/Terms"));
const Privacy = lazyWithRetry(() => import("./pages/Privacy"));
const Inventory = lazyWithRetry(() => import("./pages/Inventory"));
const InventoryCount = lazyWithRetry(() => import("./pages/InventoryCount"));
const COGSReport = lazyWithRetry(() => import("./pages/COGSReport"));
const UsageModelsPage = lazyWithRetry(() => import("./pages/UsageModelsPage"));
const PeriodSelectorPreview = lazyWithRetry(() => import("./pages/PeriodSelectorPreview"));
const PromoWidgetPreview = lazyWithRetry(() => import("./pages/PromoWidgetPreview"));
const VisualAlertPreview = lazyWithRetry(() => import("./pages/VisualAlertPreview"));

const QRCodeGenerator = lazyWithRetry(() => import("./pages/QRCodeGenerator"));
const QRQuickTaskReport = lazyWithRetry(() => import("./pages/QRQuickTaskReport"));
const FeatureTree = lazyWithRetry(() => import("./pages/FeatureTree"));
const TheoPlacementPreview = lazyWithRetry(() => import("./pages/TheoPlacementPreview"));
const ArchitectureMap = lazyWithRetry(() => import("./pages/ArchitectureMap"));
const BrandInventory = lazyWithRetry(() => import("./pages/BrandInventory"));
const BrandUnpricedIngredients = lazyWithRetry(() => import("./pages/BrandUnpricedIngredients"));
const BrandPackConfigApprovals = lazyWithRetry(() => import("./pages/BrandPackConfigApprovals"));
const BrandAutoDeployLog = lazyWithRetry(() => import("./pages/BrandAutoDeployLog"));
const EmailPreview = lazyWithRetry(() => import("./pages/EmailPreview"));
const KDSBoard = lazyWithRetry(() => import("./pages/KDSBoard"));
const DemoGate = lazyWithRetry(() => import("./pages/DemoGate"));

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
  // Public/unlisted pages must paint immediately — never gate them behind the splash.
  const skipSplash =
    typeof window !== "undefined" &&
    (window.location.pathname.startsWith("/r/") || window.location.pathname === "/");
  const [showSplash, setShowSplash] = useState(!skipSplash);

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
      <KioskAutoRestore />
      {showSplash && <AppSplashScreen onComplete={handleSplashComplete} />}
      <AppContent />
      
    </>
  );
};

// Public marketing homepage for guests; signed-in users go straight to the dashboard.
const HomeRoute = () => {
  const { user, loading } = useAuth();
  if (!loading && user) return <Navigate to="/dashboard" replace />;
  return <Home />;
};

const AppContent = () => {
  return (
    <Suspense fallback={<PageLoader />}>
      <Routes>
        <Route path="/" element={<HomeRoute />} />
        <Route path="/auth" element={<Auth />} />
        <Route path="/reset-password" element={<ResetPassword />} />
        <Route path="/forgot-password" element={<ForgotPassword />} />

        {/* Unlisted review page — noindex, not linked from anywhere, not in sitemap */}
        <Route path="/r/satnight-8f3k" element={<ReviewLanding />} />
        <Route path="/demo" element={<DemoGate />} />

        
        <Route path="/install" element={<InstallGuide />} />
        <Route path="/apply/:orgSlug" element={<PublicApplication />} />
        <Route path="/jobs" element={<PublicJobs />} />
        <Route path="/jobs/:slug" element={<JobDetail />} />
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
        <Route path="/billing" element={<ProtectedRoute><Billing /></ProtectedRoute>} />
        <Route path="/reporting" element={<ProtectedRoute><Reporting /></ProtectedRoute>} />
        <Route path="/location/:locationId" element={<ProtectedRoute><LocationProfile /></ProtectedRoute>} />
        <Route path="/location/:locationId/punch-clock" element={<ProtectedRoute><PunchClockCustomization /></ProtectedRoute>} />
        <Route path="/organization/:id" element={<ProtectedRoute><OrganizationProfile /></ProtectedRoute>} />
        <Route path="/brands" element={<ProtectedRoute><BrandManagement /></ProtectedRoute>} />
        <Route path="/super-admin/plans" element={<ProtectedRoute><SuperAdminPlans /></ProtectedRoute>} />
        <Route path="/brand/:brandId/inventory" element={<ProtectedRoute><BrandInventory /></ProtectedRoute>} />
        <Route path="/brand/:brandId/inventory/unpriced" element={<ProtectedRoute><BrandUnpricedIngredients /></ProtectedRoute>} />
        <Route path="/brand/:brandId/inventory/pack-configs" element={<ProtectedRoute><BrandPackConfigApprovals /></ProtectedRoute>} />
        <Route path="/brand/:brandId/inventory/auto-deploy-log" element={<ProtectedRoute><BrandAutoDeployLog /></ProtectedRoute>} />
        <Route path="/certifications" element={<ProtectedRoute><Certifications /></ProtectedRoute>} />
        <Route path="/alerts" element={<ProtectedRoute><Alerts /></ProtectedRoute>} />
        <Route path="/font-preview" element={<ProtectedRoute><FontPreviewPage /></ProtectedRoute>} />
        <Route path="/dashboard-preview" element={<DashboardPreview />} />
        <Route path="/dashboard-preview-restaurant" element={<DashboardPreviewRestaurant />} />
        <Route path="/time-preview" element={<TimeTrackingPreview />} />
        <Route path="/email-preview" element={<ProtectedRoute><EmailPreview /></ProtectedRoute>} />
        <Route path="/temperature-validation" element={<ProtectedRoute><TemperatureValidation /></ProtectedRoute>} />
        <Route path="/my-timecard" element={<ProtectedRoute><MyTimecard /></ProtectedRoute>} />
        <Route path="/my-profile" element={<ProtectedRoute><MyProfile /></ProtectedRoute>} />
        <Route path="/hiring" element={<ProtectedRoute><Hiring /></ProtectedRoute>} />
        <Route path="/changelog" element={<ProtectedRoute><Changelog /></ProtectedRoute>} />
        <Route path="/brand-dashboard" element={<ProtectedRoute><BrandDashboard /></ProtectedRoute>} />
        <Route path="/org-dash" element={<ProtectedRoute><MultiLocationDashboard /></ProtectedRoute>} />
        {FEATURE_FLAGS.KDS_ENABLED && (
          <Route path="/kds" element={<ProtectedRoute><KDSBoard /></ProtectedRoute>} />
        )}
        <Route path="/theo-preview" element={<ProtectedRoute><TheoPlacementPreview /></ProtectedRoute>} />
        
        <Route path="/inventory/:locationId" element={<ProtectedRoute><Inventory /></ProtectedRoute>} />
        <Route path="/inventory/:locationId/count/:countId" element={<ProtectedRoute><InventoryCount /></ProtectedRoute>} />
        <Route path="/inventory/:locationId/cogs" element={<ProtectedRoute><COGSReport /></ProtectedRoute>} />
        <Route path="/inventory/:locationId/usage-models" element={<ProtectedRoute><UsageModelsPage /></ProtectedRoute>} />
        <Route path="/inventory/period-selector-preview" element={<ProtectedRoute><PeriodSelectorPreview /></ProtectedRoute>} />
        
        <Route path="/qr-generator" element={<QRCodeGenerator />} />
        <Route path="/terms" element={<Terms />} />
        <Route path="/privacy" element={<Privacy />} />
        <Route path="/feature-tree" element={<ProtectedRoute><FeatureTree /></ProtectedRoute>} />
        <Route path="/toast-preview" element={<ProtectedRoute><ToastPreview /></ProtectedRoute>} />
        <Route path="/promo-widget-preview" element={<ProtectedRoute><PromoWidgetPreview /></ProtectedRoute>} />
        <Route path="/visual-alert-preview" element={<ProtectedRoute><VisualAlertPreview /></ProtectedRoute>} />
        <Route path="/architecture-map" element={<ProtectedRoute><ArchitectureMap /></ProtectedRoute>} />
        <Route path="/testing-checklist" element={<ProtectedRoute><TestingChecklist /></ProtectedRoute>} />
        
        <Route path="*" element={<NotFound />} />
      </Routes>
    </Suspense>
  );
};

const App = () => (
  <HelmetProvider>
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
                  <VisualAlertStack />
                  <AppWithSplash />
                  <PinMigrationOverlay />
                </DockToastProvider>
              </CrooCashAnimationProvider>
            </LocationProvider>
          </AuthProvider>
        </BrowserRouter>
      </TooltipProvider>
    </QueryClientProvider>
  </HelmetProvider>
);

export default App;
