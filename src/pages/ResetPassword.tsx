import { useState, useEffect } from 'react';
import { useNavigate } from 'react-router-dom';
import { supabase } from '@/integrations/supabase/client';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { toast } from 'sonner';
import crooLogo from '@/assets/croo-logo.webp';
import { KeyRound } from 'lucide-react';

export default function ResetPassword() {
  const [password, setPassword] = useState('');
  const [confirmPassword, setConfirmPassword] = useState('');
  const [loading, setLoading] = useState(false);
  const [isValidSession, setIsValidSession] = useState(false);
  const [checking, setChecking] = useState(true);
  const [tokenHash, setTokenHash] = useState<string | null>(null);
  const [expired, setExpired] = useState(false);
  const [resendEmail, setResendEmail] = useState('');
  const [resending, setResending] = useState(false);
  const [resent, setResent] = useState(false);
  const navigate = useNavigate();

  useEffect(() => {
    const checkSession = async () => {
      // New-style invite/reset links: token is redeemed only on submit,
      // so email scanners that pre-open links can't use it up.
      const qs = new URLSearchParams(window.location.search);
      const th = qs.get('token_hash');
      if (th) {
        setTokenHash(th);
        setIsValidSession(true);
        setChecking(false);
        return;
      }
      // Check URL hash for recovery token
      const hashParams = new URLSearchParams(window.location.hash.substring(1));
      const type = hashParams.get('type');
      const accessToken = hashParams.get('access_token');
      const refreshToken = hashParams.get('refresh_token');
      
      if (type === 'recovery' && accessToken) {
        // Set the session using the tokens from the URL
        try {
          const { data, error } = await supabase.auth.setSession({
            access_token: accessToken,
            refresh_token: refreshToken || '',
          });
          
          if (error) {
            console.error('Session error:', error);
            setExpired(true);
            setChecking(false);
            return;
          }
          
          if (data.session) {
            setIsValidSession(true);
            // Clear the hash from URL for cleaner appearance
            window.history.replaceState(null, '', window.location.pathname);
          }
        } catch (err) {
          console.error('Error setting session:', err);
          toast.error('Failed to process reset link');
          navigate('/auth');
        }
      } else {
        // No recovery token - check if there's an existing session from PASSWORD_RECOVERY event
        const { data: { session } } = await supabase.auth.getSession();
        if (session) {
          setIsValidSession(true);
        } else {
          setExpired(true);
        }
      }
      setChecking(false);
    };

    checkSession();

    // Listen for auth state changes (recovery link)
    const { data: { subscription } } = supabase.auth.onAuthStateChange((event, session) => {
      if (event === 'PASSWORD_RECOVERY') {
        setIsValidSession(true);
        setChecking(false);
      }
    });

    return () => subscription.unsubscribe();
  }, [navigate]);

  const handleResetPassword = async (e: React.FormEvent) => {
    e.preventDefault();

    if (password !== confirmPassword) {
      toast.error('Passwords do not match');
      return;
    }

    if (password.length < 6) {
      toast.error('Password must be at least 6 characters');
      return;
    }

    setLoading(true);

    try {
      if (tokenHash) {
        const { error: vErr } = await supabase.auth.verifyOtp({ token_hash: tokenHash, type: 'recovery' });
        if (vErr) {
          setExpired(true);
          setIsValidSession(false);
          return;
        }
      }
      const { error } = await supabase.auth.updateUser({ password });

      if (error) {
        throw error;
      }

      toast.success('Password updated successfully!');
      
      // Sign out and redirect to login
      await supabase.auth.signOut();
      navigate('/auth');
    } catch (error: any) {
      toast.error(error.message || 'Failed to reset password');
    } finally {
      setLoading(false);
    }
  };

  if (checking) {
    return (
      <div className="flex min-h-screen items-center justify-center bg-gradient-to-br from-background via-primary/5 to-accent/10">
        <div className="text-lg text-muted-foreground">Verifying reset link...</div>
      </div>
    );
  }

  const handleResend = async (e: React.FormEvent) => {
    e.preventDefault();
    setResending(true);
    try {
      await supabase.auth.resetPasswordForEmail(resendEmail.trim(), {
        redirectTo: `${window.location.origin}/reset-password`,
      });
      setResent(true);
    } finally {
      setResending(false);
    }
  };

  if (expired || !isValidSession) {
    return (
      <div className="flex min-h-screen items-center justify-center bg-gradient-to-br from-background via-primary/5 to-accent/10 p-4">
        <Card className="w-full max-w-md shadow-2xl border-2">
          <CardHeader className="space-y-1 text-center">
            <img src={crooLogo} alt="Croo Logo" className="h-24 w-auto mx-auto" />
            <CardTitle className="text-2xl">This link has expired</CardTitle>
            <CardDescription>
              {resent
                ? 'Check your email for a fresh link. It can take a minute to arrive.'
                : 'No problem — enter your email and we\'ll send you a new link to set your password.'}
            </CardDescription>
          </CardHeader>
          <CardContent>
            {!resent ? (
              <form onSubmit={handleResend} className="space-y-4">
                <div className="space-y-2">
                  <Label htmlFor="resendEmail">Email</Label>
                  <Input id="resendEmail" type="email" required value={resendEmail}
                    onChange={(e) => setResendEmail(e.target.value)} placeholder="you@restaurant.com" />
                </div>
                <Button type="submit" className="w-full" disabled={resending}>
                  {resending ? 'Sending...' : 'Send me a new link'}
                </Button>
              </form>
            ) : null}
            <Button variant="ghost" className="w-full mt-2" onClick={() => navigate('/auth')}>Back to sign in</Button>
          </CardContent>
        </Card>
      </div>
    );
  }

  return (
    <div className="flex min-h-screen items-center justify-center bg-gradient-to-br from-background via-primary/5 to-accent/10 p-4">
      <Card className="w-full max-w-md shadow-2xl border-2">
        <CardHeader className="space-y-1 text-center">
          <div className="mx-auto">
            <img src={crooLogo} alt="Croo Logo" className="h-24 w-auto mx-auto" />
          </div>
          <CardTitle className="text-2xl flex items-center justify-center gap-2">
            <KeyRound className="h-6 w-6" />
            Reset Password
          </CardTitle>
          <CardDescription>
            Please enter your new password below
          </CardDescription>
        </CardHeader>
        <CardContent>
          <form onSubmit={handleResetPassword} className="space-y-4">
            <div className="space-y-2">
              <Label htmlFor="password">New Password</Label>
              <Input
                id="password"
                type="password"
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                required
                minLength={6}
                placeholder="Enter new password"
              />
            </div>
            <div className="space-y-2">
              <Label htmlFor="confirmPassword">Confirm Password</Label>
              <Input
                id="confirmPassword"
                type="password"
                value={confirmPassword}
                onChange={(e) => setConfirmPassword(e.target.value)}
                required
                minLength={6}
                placeholder="Confirm new password"
              />
            </div>
            <Button type="submit" className="w-full" disabled={loading}>
              {loading ? 'Updating...' : 'Update Password'}
            </Button>
          </form>
        </CardContent>
      </Card>
    </div>
  );
}