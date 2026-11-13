import { Building2, LogOut } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { useAuth } from '@/lib/auth';

/** Shown when a signed-in person is assigned only to switched-off locations. */
export const NoActiveLocationScreen = () => {
  const { signOut } = useAuth();
  return (
    <div className="flex min-h-screen items-center justify-center bg-background p-6">
      <div className="w-full max-w-sm space-y-5 rounded-2xl border bg-card p-6 text-center shadow-sm">
        <div className="mx-auto flex h-12 w-12 items-center justify-center rounded-full bg-muted">
          <Building2 className="h-6 w-6 text-muted-foreground" />
        </div>
        <div className="space-y-2">
          <h1 className="text-lg font-semibold text-foreground">Your location isn't active</h1>
          <p className="text-sm text-muted-foreground">
            Your location isn't active in CrooHQ right now. Talk to your manager.
          </p>
        </div>
        <Button variant="outline" className="w-full" onClick={() => signOut()}>
          <LogOut className="mr-2 h-4 w-4" />
          Sign out
        </Button>
      </div>
    </div>
  );
};
