import { useState, useEffect } from 'react';
import { Helmet } from 'react-helmet-async';
import { supabase } from '@/integrations/supabase/client';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Monitor, MapPin, LogIn, Loader2, CheckCircle2 } from 'lucide-react';
import { toast } from 'sonner';
import PunchClock from './PunchClock';

const KIOSK_LOCATION_KEY = 'croohq_kiosk_location';

interface KioskLocation {
  id: string;
  name: string;
  organization_id?: string;
}

function KioskSetupScreen({ onComplete }: { onComplete: (location: KioskLocation) => void }) {
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [loading, setLoading] = useState(false);
  const [locations, setLocations] = useState<KioskLocation[]>([]);
  const [step, setStep] = useState<'login' | 'select'>('login');
  const [selectedLocation, setSelectedLocation] = useState<KioskLocation | null>(null);

  const handleLogin = async (e: React.FormEvent) => {
    e.preventDefault();
    setLoading(true);

    try {
      const { data: authData, error: authError } = await supabase.auth.signInWithPassword({
        email,
        password,
      });

      if (authError) throw authError;

      const userId = authData.user?.id;
      if (!userId) throw new Error('No user ID');

      // Check if user is admin/manager
      const { data: roles } = await supabase
        .from('user_roles')
        .select('role')
        .eq('user_id', userId);

      const userRoles = roles?.map(r => r.role) || [];
      const isManagerOrAbove = userRoles.some(r =>
        ['super_admin', 'brand_admin', 'org_admin', 'admin', 'manager'].includes(r)
      );

      if (!isManagerOrAbove) {
        toast.error('Only managers can set up kiosk mode');
        await supabase.auth.signOut();
        setLoading(false);
        return;
      }

      // Fetch locations this user has access to
      const { data: userLocs } = await supabase
        .from('user_locations')
        .select('location_id, locations(id, name, organization_id)')
        .eq('user_id', userId);

      const locs = (userLocs || [])
        .map(ul => ul.locations as any)
        .filter(Boolean)
        .map((l: any) => ({ id: l.id, name: l.name, organization_id: l.organization_id }));

      if (locs.length === 0) {
        toast.error('No locations found for your account');
        await supabase.auth.signOut();
        setLoading(false);
        return;
      }

      // Sign out immediately — we only needed the session to scope locations
      await supabase.auth.signOut();

      setLocations(locs);
      setStep('select');
    } catch (err: any) {
      toast.error(err.message || 'Login failed');
    } finally {
      setLoading(false);
    }
  };

  const handleConfirm = () => {
    if (!selectedLocation) return;
    localStorage.setItem(KIOSK_LOCATION_KEY, JSON.stringify(selectedLocation));
    onComplete(selectedLocation);
  };

  return (
    <div className="min-h-screen bg-background flex items-center justify-center p-4">
      <Card className="w-full max-w-md">
        <CardHeader className="text-center space-y-3">
          <div className="mx-auto w-14 h-14 rounded-2xl bg-primary/10 flex items-center justify-center">
            <Monitor className="w-7 h-7 text-primary" />
          </div>
          <CardTitle className="text-xl">
            {step === 'login' ? 'Kiosk Setup' : 'Select Location'}
          </CardTitle>
          <p className="text-sm text-muted-foreground">
            {step === 'login'
              ? 'Manager login required for initial setup'
              : 'Choose which location this tablet will serve'}
          </p>
        </CardHeader>
        <CardContent>
          {step === 'login' ? (
            <form onSubmit={handleLogin} className="space-y-4">
              <div className="space-y-2">
                <Label htmlFor="kiosk-email">Email</Label>
                <Input
                  id="kiosk-email"
                  type="email"
                  value={email}
                  onChange={(e) => setEmail(e.target.value)}
                  placeholder="manager@company.com"
                  required
                />
              </div>
              <div className="space-y-2">
                <Label htmlFor="kiosk-password">Password</Label>
                <Input
                  id="kiosk-password"
                  type="password"
                  value={password}
                  onChange={(e) => setPassword(e.target.value)}
                  placeholder="••••••••"
                  required
                />
              </div>
              <Button type="submit" className="w-full" disabled={loading}>
                {loading ? (
                  <><Loader2 className="w-4 h-4 mr-2 animate-spin" /> Authenticating...</>
                ) : (
                  <><LogIn className="w-4 h-4 mr-2" /> Sign In</>
                )}
              </Button>
            </form>
          ) : (
            <div className="space-y-3">
              {locations.map((loc) => (
                <button
                  key={loc.id}
                  onClick={() => setSelectedLocation(loc)}
                  className={`w-full flex items-center gap-3 p-4 rounded-xl border transition-all text-left ${
                    selectedLocation?.id === loc.id
                      ? 'border-primary bg-primary/10 text-foreground'
                      : 'border-border bg-muted text-muted-foreground hover:border-primary/50'
                  }`}
                >
                  <MapPin className={`w-5 h-5 flex-shrink-0 ${
                    selectedLocation?.id === loc.id ? 'text-primary' : 'text-muted-foreground'
                  }`} />
                  <span className="font-medium">{loc.name}</span>
                  {selectedLocation?.id === loc.id && (
                    <CheckCircle2 className="w-5 h-5 text-primary ml-auto" />
                  )}
                </button>
              ))}
              <Button
                onClick={handleConfirm}
                disabled={!selectedLocation}
                className="w-full mt-4"
              >
                <Monitor className="w-4 h-4 mr-2" /> Activate Kiosk
              </Button>
            </div>
          )}
        </CardContent>
      </Card>
    </div>
  );
}

export default function KioskPunchClock() {
  const [kioskLocation, setKioskLocation] = useState<KioskLocation | null>(null);
  const [checking, setChecking] = useState(true);

  useEffect(() => {
    const stored = localStorage.getItem(KIOSK_LOCATION_KEY);
    if (stored) {
      try {
        setKioskLocation(JSON.parse(stored));
      } catch {
        localStorage.removeItem(KIOSK_LOCATION_KEY);
      }
    }
    setChecking(false);
  }, []);

  if (checking) {
    return (
      <div className="min-h-screen bg-background flex items-center justify-center">
        <Loader2 className="w-8 h-8 animate-spin text-primary" />
      </div>
    );
  }

  if (!kioskLocation) {
    return <KioskSetupScreen onComplete={setKioskLocation} />;
  }

  return (
    <>
      <Helmet>
        <link rel="manifest" href="/kiosk-manifest.json" />
      </Helmet>
      <PunchClock kioskMode kioskLocationOverride={kioskLocation} />
    </>
  );
}
