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
import RotatingAuthBackground from '@/components/auth/RotatingAuthBackground';

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

  

  return (
    <>
      <RotatingAuthBackground />
      <div className="flex min-h-screen flex-col items-center justify-center p-4 relative z-10">
        <Card className="w-full max-w-md shadow-2xl border-2 bg-card/80 backdrop-blur-xl hover:shadow-3xl transition-all duration-300 relative overflow-visible">
      <CardHeader className="text-center pb-2 pt-8 space-y-2">
        {/* Croo branding — now inside the card */}
        <div className="flex flex-col items-center gap-1">
          <div className="flex items-center justify-center">
            <img
              src={crooLogo}
              alt="Croo"
              width={100}
              height={40}
              className="h-10 w-auto"
            />
          </div>
          <p className="font-sans text-lg italic font-medium text-primary tracking-tight">
            Built for operators, by operators
          </p>
        </div>
      </CardHeader>
      <CardContent>
        <div className="mb-4">
          <h2 className="text-lg font-semibold text-center">Sign In</h2>
        </div>
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
          </CardContent>
        </Card>
      </div>
    </>
  );
}