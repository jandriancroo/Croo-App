import { useEffect } from 'react';
import { useNavigate } from 'react-router-dom';
import { useAuth } from '@/lib/auth';
import { useOptionalLocation } from '@/hooks/useLocation';
import { useUserRole } from '@/hooks/useUserRole';
import { NoActiveLocationScreen } from '@/components/NoActiveLocationScreen';

export const ProtectedRoute = ({ children }: { children: React.ReactNode }) => {
  const { user, loading } = useAuth();
  const navigate = useNavigate();
  const locationCtx = useOptionalLocation();
  const { isSuperAdmin, loading: roleLoading } = useUserRole();

  useEffect(() => {
    if (!loading && !user) {
      navigate('/auth');
    }
  }, [user, loading, navigate]);

  if (loading) {
    return (
      <div className="flex min-h-screen items-center justify-center">
        <div className="text-lg text-muted-foreground">Loading...</div>
      </div>
    );
  }

  if (!user) {
    return null;
  }

  // Everyone they work at is switched off (super admin is never blocked).
  if (locationCtx && !locationCtx.loading && locationCtx.onlyInactiveLocations && !roleLoading && !isSuperAdmin) {
    return <NoActiveLocationScreen />;
  }

  return <>{children}</>;
};
