import { useState, useEffect } from 'react';
import { useNavigate, useSearchParams, useLocation } from 'react-router-dom';
import { useAuth } from '@/lib/auth';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Card, CardContent, CardHeader } from '@/components/ui/card';
import { toast } from 'sonner';
import crooLogo from '@/assets/croo-logo.webp';
import CrowSplashAnimation from '@/components/CrowSplashAnimation';
import { SeasonalCardDecor, SeasonalButtonDecor, WinterSnowfall, getSeason } from '@/components/auth/SeasonalDecorations';

export default function Auth() {
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [loading, setLoading] = useState(false);
  const [showSplash, setShowSplash] = useState(false);
  const [showCrowAnimation, setShowCrowAnimation] = useState(false);
  const { signIn, user } = useAuth();
  const navigate = useNavigate();
  const location = useLocation();

  // Check for password recovery token in URL hash and redirect
  useEffect(() => {
    const hashParams = new URLSearchParams(window.location.hash.substring(1));
    const type = hashParams.get('type');
    const accessToken = hashParams.get('access_token');
    
    if (type === 'recovery' && accessToken) {
      navigate('/reset-password' + window.location.hash);
      return;
    }
  }, [navigate]);

  useEffect(() => {
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

  // Navigate once after successful sign-in animation trigger
  useEffect(() => {
    if (showCrowAnimation && user) {
      navigate('/dashboard', { state: { showWelcomeAnimation: true } });
    }
  }, [showCrowAnimation, user, navigate]);

  if (showSplash) {
    return <CrowSplashAnimation onComplete={handleSplashComplete} />;
  }

  const season = getSeason();

  return (
    <>
      {season === 'winter' && <WinterSnowfall />}
      
      <div className="flex min-h-screen flex-col items-center justify-center p-4 gap-6 relative z-10 bg-gradient-to-br from-background via-primary/15 to-accent/25">
        {/* Powered by Croo branding with large logo */}
        <div className="flex flex-col items-center gap-2">
          <div className="flex items-center justify-center gap-3">
            <span className="text-base text-muted-foreground font-medium">Powered by</span>
            <img 
              src={crooLogo} 
              alt="Croo" 
              width={200}
              height={96}
              className="h-24 w-auto"
            />
          </div>
          <p className="font-pacifico text-2xl text-[#E67E22] drop-shadow-sm">
            food service made smart
          </p>
        </div>
        
        <Card className="w-full max-w-md shadow-2xl border-2 hover:shadow-3xl transition-all duration-300 hover:scale-[1.02] relative overflow-visible">
          <SeasonalCardDecor />
          <CardHeader className="text-center pb-2 pt-6">
            <h2 className="text-xl font-semibold">Sign In</h2>
          </CardHeader>
          <CardContent>
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
              <div className="relative">
                <SeasonalButtonDecor />
                <Button type="submit" className="w-full" disabled={loading}>
                  {loading ? 'Signing in...' : 'Sign In'}
                </Button>
              </div>
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
          </CardContent>
        </Card>
      </div>
    </>
  );
}