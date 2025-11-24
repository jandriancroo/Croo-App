import { Toaster } from "@/components/ui/toaster";
import { Toaster as Sonner } from "@/components/ui/sonner";
import { TooltipProvider } from "@/components/ui/tooltip";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { BrowserRouter, Routes, Route } from "react-router-dom";
import { AuthProvider } from "@/lib/auth";
import { ProtectedRoute } from "@/components/ProtectedRoute";
import { usePushNotifications } from "@/hooks/usePushNotifications";
import Dashboard from "./pages/Dashboard";
import Auth from "./pages/Auth";
import CreateChecklist from "./pages/CreateChecklist";
import EditChecklist from "./pages/EditChecklist";
import CompleteChecklist from "./pages/CompleteChecklist";
import History from "./pages/History";
import SubmissionDetails from "./pages/SubmissionDetails";
import UserManagement from "./pages/UserManagement";
import Settings from "./pages/Settings";
import Schedule from "./pages/Schedule";
import ShiftTemplates from "./pages/ShiftTemplates";
import Availability from "./pages/Availability";
import Messages from "./pages/Messages";
import NotFound from "./pages/NotFound";
import PunchClock from "./pages/PunchClock";
import PayrollReview from "./pages/PayrollReview";
import Tasks from "./pages/Tasks";
import LogBook from "./pages/LogBook";
import Certifications from "./pages/Certifications";

const queryClient = new QueryClient();

const AppContent = () => {
  usePushNotifications();
  return (
    <Routes>
      <Route path="/auth" element={<Auth />} />
      <Route path="/" element={<ProtectedRoute><Dashboard /></ProtectedRoute>} />
      <Route path="/tasks" element={<ProtectedRoute><Tasks /></ProtectedRoute>} />
      <Route path="/logbook" element={<ProtectedRoute><LogBook /></ProtectedRoute>} />
      <Route path="/create" element={<ProtectedRoute><CreateChecklist /></ProtectedRoute>} />
      <Route path="/create-checklist" element={<ProtectedRoute><CreateChecklist /></ProtectedRoute>} />
      <Route path="/edit/:id" element={<ProtectedRoute><EditChecklist /></ProtectedRoute>} />
      <Route path="/edit-checklist/:id" element={<ProtectedRoute><EditChecklist /></ProtectedRoute>} />
      <Route path="/complete/:id" element={<ProtectedRoute><CompleteChecklist /></ProtectedRoute>} />
      <Route path="/complete-checklist/:id" element={<ProtectedRoute><CompleteChecklist /></ProtectedRoute>} />
      <Route path="/history" element={<ProtectedRoute><History /></ProtectedRoute>} />
      <Route path="/submission/:id" element={<ProtectedRoute><SubmissionDetails /></ProtectedRoute>} />
      <Route path="/users" element={<ProtectedRoute><UserManagement /></ProtectedRoute>} />
      <Route path="/schedule" element={<ProtectedRoute><Schedule /></ProtectedRoute>} />
      <Route path="/shift-templates" element={<ProtectedRoute><ShiftTemplates /></ProtectedRoute>} />
      <Route path="/availability" element={<ProtectedRoute><Availability /></ProtectedRoute>} />
      <Route path="/messages" element={<ProtectedRoute><Messages /></ProtectedRoute>} />
      <Route path="/punch-clock" element={<PunchClock />} />
      <Route path="/payroll-review" element={<ProtectedRoute><PayrollReview /></ProtectedRoute>} />
      <Route path="/settings" element={<ProtectedRoute><Settings /></ProtectedRoute>} />
      <Route path="/certifications" element={<ProtectedRoute><Certifications /></ProtectedRoute>} />
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
        <AuthProvider>
          <AppContent />
        </AuthProvider>
      </BrowserRouter>
    </TooltipProvider>
  </QueryClientProvider>
);

export default App;
