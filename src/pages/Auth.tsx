import { useState, useEffect } from 'react';
import { useNavigate, useSearchParams } from 'react-router-dom';
import { useAuth } from '@/lib/auth';
import { supabase } from '@/integrations/supabase/client';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { toast } from 'sonner';
import crooLogo from '@/assets/croo-logo.png';
import { LoginSplashScreen } from '@/components/LoginSplashScreen';

export default function Auth() {
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [fullName, setFullName] = useState('');
  const [locationCode, setLocationCode] = useState('');
  const [loading, setLoading] = useState(false);
  const [showSplash, setShowSplash] = useState(false);
  const { signIn, signUp, user } = useAuth();
  const navigate = useNavigate();
  const [searchParams] = useSearchParams();
  const [activeTab, setActiveTab] = useState<string>('signin');

  const handleLocationCodeChange = (value: string) => {
    // Allow only letters and dashes, convert to lowercase
    const cleaned = value.replace(/[^a-zA-Z-]/g, '').toLowerCase();
    setLocationCode(cleaned);
  };

  useEffect(() => {
    // Check if signup parameter is in URL
    if (searchParams.get('signup') === 'true') {
      setActiveTab('signup');
    }
  }, [searchParams]);

  useEffect(() => {
    // Don't auto-redirect if we're showing the splash screen
    if (user && !showSplash) {
      navigate('/dashboard');
    }
  }, [user, navigate, showSplash]);

  const handleSignIn = async (e: React.FormEvent) => {
    e.preventDefault();
    setLoading(true);

    const { error } = await signIn(email, password);
    
    if (error) {
      toast.error(error.message);
      setLoading(false);
    } else {
      setShowSplash(true);
    }
  };

  const handleSplashComplete = () => {
    toast.success('Signed in successfully');
    navigate('/dashboard');
  };


  const handleSignUp = async (e: React.FormEvent) => {
    e.preventDefault();

    if (!locationCode.trim()) {
      toast.error('Please enter a location code');
      return;
    }

    setLoading(true);

    try {
      // Validate location code via backend function (case-insensitive)
      const { data: locationData, error: locationError } = await supabase.rpc('validate_location_code', {
        p_code: locationCode.trim(),
      });

      const location = Array.isArray(locationData) && locationData.length > 0 ? locationData[0] : null;

      if (locationError || !location) {
        toast.error('Invalid location code. Please check with your manager.');
        setLoading(false);
        return;
      }

      const { error } = await signUp(email, password, fullName);

      if (error) {
        toast.error(error.message);
        return;
      }

      const { data: { user } } = await supabase.auth.getUser();

      if (user) {
        const { error: locationAssignError } = await supabase.rpc('assign_user_to_location', {
          p_user_id: user.id,
          p_location_id: location.id,
        });

        if (locationAssignError) {
          console.error('Failed to assign location:', locationAssignError);
        }
      }

      toast.success(`Welcome to ${location.name}! Let's finish setting up your profile.`);
      navigate('/welcome');
    } catch (error: any) {
      toast.error(error.message || 'Failed to sign up');
    } finally {
      setLoading(false);
    }
  };

  if (showSplash) {
    return <LoginSplashScreen onComplete={handleSplashComplete} />;
  }

  return (
    <div className="flex min-h-screen items-center justify-center bg-gradient-to-br from-background via-primary/5 to-accent/10 p-4">
      <Card className="w-full max-w-md shadow-2xl border-2 hover:shadow-3xl transition-all duration-300 hover:scale-[1.02]">
        <CardHeader className="space-y-1 text-center">
          <div className="mx-auto">
            <img src={crooLogo} alt="Croo Logo" className="h-24 w-auto mx-auto" />
          </div>
          <p className="font-pacifico text-2xl text-[#E67E22] drop-shadow-sm">
            food service made smart
          </p>
        </CardHeader>
        <CardContent>
          <Tabs value={activeTab} onValueChange={setActiveTab} className="w-full">
            <TabsList className="grid w-full grid-cols-2">
              <TabsTrigger value="signin">Sign In</TabsTrigger>
              <TabsTrigger value="signup">Sign Up</TabsTrigger>
            </TabsList>
            <TabsContent value="signin">
              <form onSubmit={handleSignIn} className="space-y-4">
                <div className="space-y-2">
                  <Label htmlFor="email">Email</Label>
                  <Input
                    id="email"
                    type="email"
                    placeholder="you@restaurant.com"
                    value={email}
                    onChange={(e) => setEmail(e.target.value)}
                    required
                  />
                </div>
                <div className="space-y-2">
                  <Label htmlFor="password">Password</Label>
                  <Input
                    id="password"
                    type="password"
                    value={password}
                    onChange={(e) => setPassword(e.target.value)}
                    required
                  />
                </div>
                <Button type="submit" className="w-full" disabled={loading}>
                  {loading ? 'Signing in...' : 'Sign In'}
                </Button>
              </form>
            </TabsContent>
            <TabsContent value="signup">
              <form onSubmit={handleSignUp} className="space-y-4">
                <div className="space-y-2">
                  <Label htmlFor="fullname">Full Name</Label>
                  <Input
                    id="fullname"
                    type="text"
                    placeholder="John Doe"
                    value={fullName}
                    onChange={(e) => setFullName(e.target.value)}
                    required
                  />
                </div>
                <div className="space-y-2">
                  <Label htmlFor="locationCode">Location Code</Label>
                  <Input
                    id="locationCode"
                    type="text"
                    placeholder="happy-river-eagle"
                    value={locationCode}
                    onChange={(e) => handleLocationCodeChange(e.target.value)}
                    required
                  />
                  <p className="text-xs text-muted-foreground">
                    Enter the 3-word code provided by your manager
                  </p>
                </div>
                <div className="space-y-2">
                  <Label htmlFor="signup-email">Email</Label>
                  <Input
                    id="signup-email"
                    type="email"
                    placeholder="you@restaurant.com"
                    value={email}
                    onChange={(e) => setEmail(e.target.value)}
                    required
                  />
                </div>
                <div className="space-y-2">
                  <Label htmlFor="signup-password">Password</Label>
                  <Input
                    id="signup-password"
                    type="password"
                    value={password}
                    onChange={(e) => setPassword(e.target.value)}
                    required
                    minLength={6}
                  />
                </div>
                <Button type="submit" className="w-full" disabled={loading}>
                  {loading ? 'Creating account...' : 'Create Account'}
                </Button>
              </form>
            </TabsContent>
          </Tabs>
        </CardContent>
      </Card>
    </div>
  );
}
