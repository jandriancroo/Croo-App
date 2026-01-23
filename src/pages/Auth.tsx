import { useState, useEffect } from 'react';
import { useNavigate, useSearchParams, useLocation } from 'react-router-dom';
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
import CrowSplashAnimation from '@/components/CrowSplashAnimation';

export default function Auth() {
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [fullName, setFullName] = useState('');
  const [locationCode, setLocationCode] = useState('');
  const [loading, setLoading] = useState(false);
  const [showSplash, setShowSplash] = useState(false);
  const [showCrowAnimation, setShowCrowAnimation] = useState(false);
  const { signIn, signUp, user } = useAuth();
  const navigate = useNavigate();
  const location = useLocation();
  const [searchParams] = useSearchParams();
  const [activeTab, setActiveTab] = useState<string>('signin');

  const handleLocationCodeChange = (value: string) => {
    // Allow only letters and dashes, convert to lowercase
    const cleaned = value.replace(/[^a-zA-Z-]/g, '').toLowerCase();
    setLocationCode(cleaned);
  };

  // Check for password recovery token in URL hash and redirect
  useEffect(() => {
    const hashParams = new URLSearchParams(window.location.hash.substring(1));
    const type = hashParams.get('type');
    const accessToken = hashParams.get('access_token');
    
    if (type === 'recovery' && accessToken) {
      // This is a password reset link - redirect to reset password page
      navigate('/reset-password' + window.location.hash);
      return;
    }
  }, [navigate]);

  useEffect(() => {
    // Check if signup parameter is in URL
    if (searchParams.get('signup') === 'true') {
      setActiveTab('signup');
    }
  }, [searchParams]);

  useEffect(() => {
    // Don't auto-redirect if we're showing the splash screen
    if (user && !showSplash && !showCrowAnimation) {
      navigate('/dashboard');
    }
  }, [user, navigate, showSplash, showCrowAnimation]);

  const handleSignIn = async (e: React.FormEvent) => {
    e.preventDefault();
    setLoading(true);

    const { error } = await signIn(email, password);
    
    if (error) {
      toast.error(error.message);
      setLoading(false);
    } else {
      setShowCrowAnimation(true);
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
        // Check if user already exists (was invited by admin)
        if (error.message?.includes('already registered') || error.message?.includes('already exists')) {
          toast.error('This email is already registered. If you were invited, please use the link sent to your email or try signing in.');
          setActiveTab('signin');
          setLoading(false);
          return;
        }
        toast.error(error.message);
        return;
      }

      // Wait a moment for auth state to settle, then get the user
      await new Promise(resolve => setTimeout(resolve, 500));
      
      const { data: { user: newUser } } = await supabase.auth.getUser();

      if (newUser) {
        const { error: locationAssignError } = await supabase.rpc('assign_user_to_location', {
          p_user_id: newUser.id,
          p_location_id: location.id,
        });

        if (locationAssignError) {
          console.error('Failed to assign location:', locationAssignError);
          toast.error('Account created but failed to assign location. Please contact your manager.');
        }
      } else {
        console.error('User not available after signup');
        toast.error('Account created but failed to assign location. Please contact your manager.');
      }

      toast.success(`Welcome to ${location.name}! Let's finish setting up your profile.`);
      navigate('/welcome');
    } catch (error: any) {
      toast.error(error.message || 'Failed to sign up');
    } finally {
      setLoading(false);
    }
  };

  // Navigate once after successful sign-in animation trigger
  useEffect(() => {
    if (showCrowAnimation && user) {
      navigate('/dashboard', { state: { showWelcomeAnimation: true } });
    }
  }, [showCrowAnimation, user, navigate]);


  if (showSplash) {
    return <CrowSplashAnimation onComplete={handleSplashComplete} />;
  }

  return (
    <>
      <div className="flex min-h-screen flex-col items-center justify-center bg-gradient-to-br from-background via-primary/5 to-accent/10 p-4 gap-6">
        {/* Powered by Croo branding with logo - same style as punch clock */}
        <div className="flex items-center justify-center gap-3">
          <span className="text-base text-muted-foreground font-medium">Powered by</span>
          <img 
            src={crooLogo} 
            alt="Croo" 
            className="h-10 w-auto opacity-70"
          />
        </div>
        
      <Card className="w-full max-w-md shadow-2xl border-2 hover:shadow-3xl transition-all duration-300 hover:scale-[1.02]">
        <CardHeader className="text-center pb-2 pt-4">
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
                <div className="text-center">
                  <button
                    type="button"
                    onClick={() => navigate('/forgot-password')}
                    className="text-sm text-muted-foreground hover:text-primary underline"
                  >
                    Forgot your password?
                  </button>
                </div>
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
    </>
  );
}
