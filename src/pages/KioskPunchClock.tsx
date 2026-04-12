import { useState, useEffect, useCallback, createContext, useContext } from 'react';
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

// Minimal location context for kiosk mode — same shape as useLocation hook
const KioskLocationContext = createContext<{
  currentLocation: KioskLocation | null;
  locations: KioskLocation[];
  setCurrentLocation: (loc: KioskLocation) => void;
  loading: boolean;
  refetchLocations: () => Promise<void>;
  isChecklistOnlyLocation: boolean;
  organizationId: string | null;
  isSwitching: boolean;
  switchingTo: KioskLocation | null;
} | undefined>(undefined);

function KioskLocationProvider({ location, children }: { location: KioskLocation; children: React.ReactNode }) {
  return (
    <KioskLocationContext.Provider
      value={{
        currentLocation: location,
        locations: [location],
        setCurrentLocation: () => {},
        loading: false,
        refetchLocations: async () => {},
        isChecklistOnlyLocation: false,
        organizationId: location.organization_id || null,
        isSwitching: false,
        switchingTo: null,
      }}
    >
      {children}
    </KioskLocationContext.Provider>
  );
}

// We need to override the LocationContext used by useLocation hook
// The simplest way: re-export the context from useLocation and provide it here
// But since LocationContext isn't exported, we'll use a different approach:
// Wrap PunchClock in a component that patches the context

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

  const handleSelectLocation = (loc: KioskLocation) => {
    setSelectedLocation(loc);
  };

  const handleConfirm = () => {
    if (!selectedLocation) return;
    localStorage.setItem(KIOSK_LOCATION_KEY, JSON.stringify(selectedLocation));
    onComplete(selectedLocation);
  };

  return (
    <div className="min-h-screen bg-neutral-950 flex items-center justify-center p-4">
      <Card className="w-full max-w-md bg-neutral-900 border-neutral-800">
        <CardHeader className="text-center space-y-3">
          <div className="mx-auto w-14 h-14 rounded-2xl bg-primary/10 flex items-center justify-center">
            <Monitor className="w-7 h-7 text-primary" />
          </div>
          <CardTitle className="text-xl text-white">
            {step === 'login' ? 'Kiosk Setup' : 'Select Location'}
          </CardTitle>
          <p className="text-sm text-neutral-400">
            {step === 'login'
              ? 'Manager login required for initial setup'
              : 'Choose which location this tablet will serve'}
          </p>
        </CardHeader>
        <CardContent>
          {step === 'login' ? (
            <form onSubmit={handleLogin} className="space-y-4">
              <div className="space-y-2">
                <Label htmlFor="email" className="text-neutral-300">Email</Label>
                <Input
                  id="email"
                  type="email"
                  value={email}
                  onChange={(e) => setEmail(e.target.value)}
                  placeholder="manager@company.com"
                  required
                  className="bg-neutral-800 border-neutral-700 text-white"
                />
              </div>
              <div className="space-y-2">
                <Label htmlFor="password" className="text-neutral-300">Password</Label>
                <Input
                  id="password"
                  type="password"
                  value={password}
                  onChange={(e) => setPassword(e.target.value)}
                  placeholder="••••••••"
                  required
                  className="bg-neutral-800 border-neutral-700 text-white"
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
                  onClick={() => handleSelectLocation(loc)}
                  className={`w-full flex items-center gap-3 p-4 rounded-xl border transition-all text-left ${
                    selectedLocation?.id === loc.id
                      ? 'border-primary bg-primary/10 text-white'
                      : 'border-neutral-700 bg-neutral-800 text-neutral-300 hover:border-neutral-600'
                  }`}
                >
                  <MapPin className={`w-5 h-5 flex-shrink-0 ${
                    selectedLocation?.id === loc.id ? 'text-primary' : 'text-neutral-500'
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
      <div className="min-h-screen bg-neutral-950 flex items-center justify-center">
        <Loader2 className="w-8 h-8 animate-spin text-primary" />
      </div>
    );
  }

  if (!kioskLocation) {
    return <KioskSetupScreen onComplete={setKioskLocation} />;
  }

  // Render PunchClock in kiosk mode
  // The challenge: PunchClock uses useAppLocation() which reads from LocationContext
  // We need to provide the location through that same context
  return <PunchClock kioskMode kioskLocationOverride={kioskLocation} />;
}
