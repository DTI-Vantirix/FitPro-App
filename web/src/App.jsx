import { Toaster } from "@/components/ui/toaster"
import { QueryClientProvider } from '@tanstack/react-query'
import { queryClientInstance } from '@/lib/query-client'
import { BrowserRouter as Router, Route, Routes } from 'react-router-dom';
import PageNotFound from './lib/PageNotFound';
import { AuthProvider, useAuth } from '@/lib/AuthContext';
import UserNotRegisteredError from '@/components/UserNotRegisteredError';
import ScrollToTop from './components/ScrollToTop';
import { Navigate } from 'react-router-dom';
import ProtectedRoute from '@/components/ProtectedRoute';
import AppShell from '@/components/layout/AppShell';
import Login from '@/pages/Login';
import Register from '@/pages/Register';
import ForgotPassword from '@/pages/ForgotPassword';
import ResetPassword from '@/pages/ResetPassword';
import Mfa from '@/pages/Mfa';
import Privacy from '@/pages/Privacy';
import Terms from '@/pages/Terms';
import ConsentGate from '@/components/ConsentGate';
import AccessGate from '@/components/access/AccessGate';
import Home from '@/pages/Home';
import RoutesPage from '@/pages/Routes';
import RouteBuilder from '@/pages/RouteBuilder';
import LiveRun from '@/pages/LiveRun';
import Analytics from '@/pages/Analytics';
import Zones from '@/pages/Zones';
import Settings from '@/pages/Settings';
import Devices from '@/pages/Devices';
import Feed from '@/pages/Feed';
import Friends from '@/pages/Friends';
import Challenges from '@/pages/Challenges';
import ChallengeDetail from '@/pages/ChallengeDetail';
// Add page imports here

const AuthenticatedApp = () => {
  const { isLoadingAuth, isLoadingPublicSettings, authError, navigateToLogin } = useAuth();

  // Show loading spinner while checking app public settings or auth
  if (isLoadingPublicSettings || isLoadingAuth) {
    return (
      <div className="fixed inset-0 flex items-center justify-center">
        <div className="w-8 h-8 border-4 border-border border-t-primary rounded-full animate-spin"></div>
      </div>
    );
  }

  // Handle authentication errors
  if (authError) {
    if (authError.type === 'user_not_registered') {
      return <UserNotRegisteredError />;
    } else if (authError.type === 'auth_required') {
      // Redirect to login automatically
      navigateToLogin();
      return null;
    }
  }

  // Render the main app
  return (
    <Routes>
      <Route path="/login" element={<Login />} />
      <Route path="/register" element={<Register />} />
      <Route path="/forgot-password" element={<ForgotPassword />} />
      <Route path="/reset-password" element={<ResetPassword />} />
      <Route path="/mfa" element={<Mfa />} />
      <Route path="/privacy" element={<Privacy />} />
      <Route path="/terms" element={<Terms />} />
      <Route element={<ProtectedRoute unauthenticatedElement={<Navigate to="/login" replace />} />}>
        <Route element={<AccessGate />}>
        <Route element={<ConsentGate />}>
          <Route element={<AppShell />}>
            <Route path="/" element={<Home />} />
            <Route path="/routes" element={<RoutesPage />} />
            <Route path="/routes/new" element={<RouteBuilder />} />
            <Route path="/run" element={<LiveRun />} />
            <Route path="/workouts" element={<Navigate to="/" replace />} />
            <Route path="/analytics" element={<Analytics />} />
            <Route path="/zones" element={<Zones />} />
            <Route path="/settings" element={<Settings />} />
            <Route path="/devices" element={<Devices />} />
            <Route path="/feed" element={<Feed />} />
            <Route path="/friends" element={<Friends />} />
            <Route path="/challenges" element={<Challenges />} />
            <Route path="/challenges/:id" element={<ChallengeDetail />} />
          </Route>
        </Route>
        </Route>
      </Route>
      <Route path="*" element={<PageNotFound />} />
    </Routes>
  );
};


function App() {

  return (
    <AuthProvider>
      <QueryClientProvider client={queryClientInstance}>
        <Router>
          <ScrollToTop />
          <AuthenticatedApp />
        </Router>
        <Toaster />
      </QueryClientProvider>
    </AuthProvider>
  )
}

export default App