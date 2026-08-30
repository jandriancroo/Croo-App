import { createContext, useContext, useEffect, useState, ReactNode, useRef } from 'react';
import { User, Session } from '@supabase/supabase-js';
import { supabase } from '@/integrations/supabase/client';
import { useNavigate } from 'react-router-dom';
import { useQueryClient } from '@tanstack/react-query';
import { isPunchDeviceUser } from '@/lib/punchDevicePairing';

interface AuthContextType {
  user: User | null;
  session: Session | null;
  signIn: (email: string, password: string) => Promise<{ error: any }>;
  signUp: (email: string, password: string, fullName: string, profilePhotoUrl?: string) => Promise<{ error: any }>;
  signOut: () => Promise<void>;
  loading: boolean;
}

const AuthContext = createContext<AuthContextType | undefined>(undefined);

const AUTH_TIMEOUT_MS = 15_000;

const authNetworkError = (message = 'Login request timed out. Please check your connection and try again.') => ({
  name: 'AuthNetworkError',
  message,
});

const withTimeout = async <T,>(promise: Promise<T>, timeoutMs: number, timeoutMessage?: string): Promise<T> => {
  let timeoutId: ReturnType<typeof setTimeout> | undefined;
  try {
    return await Promise.race([
      promise,
      new Promise<never>((_, reject) => {
        timeoutId = setTimeout(() => reject(authNetworkError(timeoutMessage)), timeoutMs);
      }),
    ]);
  } finally {
    if (timeoutId) clearTimeout(timeoutId);
  }
};

const normalizeAuthError = (error: unknown) => {
  if (error && typeof error === 'object' && 'message' in error) return error;
  return authNetworkError('Login failed before reaching the auth server. Please refresh and try again.');
};

// Check if this is the user's first login and update last_login_at
// Returns true if this is the user's first login
const checkFirstLogin = async (userId: string): Promise<boolean> => {
  try {
    const { data: profile } = await supabase
      .from('profiles')
      .select('first_login_at')
      .eq('id', userId)
      .single();

    const isFirstLogin = profile && !profile.first_login_at;

    const updatePayload: Record<string, string> = {
      last_login_at: new Date().toISOString(),
    };
    if (isFirstLogin) {
      updatePayload.first_login_at = new Date().toISOString();
      console.log('First login detected, setting first_login_at...');
    }

    await supabase
      .from('profiles')
      .update(updatePayload)
      .eq('id', userId);

    if (isFirstLogin) {
      supabase.functions.invoke('hiring-email-service', {
        body: { action: 'employee_joined', userId }
      }).catch(err => console.warn('employee-joined notification failed:', err));
    }

    return !!isFirstLogin;
  } catch (error) {
    console.error('Error checking first login:', error);
    return false;
  }
};

const isDeviceSession = (session: Session | null | undefined) => isPunchDeviceUser(session?.user);

export const DEACTIVATED_MESSAGE =
  'This account has been deactivated. Please contact your manager if you believe this is a mistake.';

// Returns true when the profile is deactivated. Fails open on network errors so a
// transient failure never locks out a legitimate active user.
const isDeactivatedProfile = async (userId: string): Promise<boolean> => {
  try {
    const { data, error } = await supabase
      .from('profiles')
      .select('is_active')
      .eq('id', userId)
      .maybeSingle();
    if (error) return false;
    return data ? data.is_active === false : false;
  } catch {
    return false;
  }
};

export const AuthProvider = ({ children }: { children: ReactNode }) => {
  const [user, setUser] = useState<User | null>(null);
  const [session, setSession] = useState<Session | null>(null);
  const [loading, setLoading] = useState(true);
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const checkedFirstLoginRef = useRef<Set<string>>(new Set());

  useEffect(() => {
    // Set up auth state listener
    const { data: { subscription } } = supabase.auth.onAuthStateChange(
      (event, session) => {
        setSession(session);
        setUser(session?.user ?? null);
        setLoading(false);

        // Update last_login_at on sign in (not token refresh)
        if (session?.user && event === 'SIGNED_IN' && !isDeviceSession(session)) {
          const userId = session.user.id;
          if (!checkedFirstLoginRef.current.has(userId)) {
            checkedFirstLoginRef.current.add(userId);
            setTimeout(async () => {
              // Never stamp a login for a deactivated account.
              if (await isDeactivatedProfile(userId)) return;
              const isFirst = await checkFirstLogin(userId);
              if (isFirst) {
                navigate('/welcome');
              }
            }, 0);
          }
        }
      }
    );

    // Check for existing session. Do not let a failed/blocked refresh token request
    // keep the whole app stuck in auth loading forever.
    withTimeout(
      supabase.auth.getSession(),
      AUTH_TIMEOUT_MS,
      'Session check timed out. Please refresh and try again.'
    )
      .then(async ({ data: { session } }) => {
        // A stored session can be structurally invalid (e.g. missing `sub` claim).
        // supabase-js then falls back to the anon key for PostgREST calls, which
        // produces "permission denied for table profiles/user_roles" everywhere.
        // Validate the token once and tear down a broken session instead.
        if (session?.user) {
          // Fail OPEN: only a definitive "this token is not valid" answer tears the
          // session down. A network blip, 5xx or slow auth endpoint must never sign a
          // legitimate user out, and must never hang startup either.
          let userError: any = null;
          let validated = true;
          try {
            const res = await withTimeout(
              supabase.auth.getUser(),
              AUTH_TIMEOUT_MS,
              'Session validation timed out'
            );
            userError = res.error;
          } catch {
            validated = false; // timed out — keep the stored session
          }
          const status = (userError as any)?.status;
          const isDefinitivelyInvalid =
            validated && !!userError && (status === 401 || status === 403 || status === 400);
          if (isDefinitivelyInvalid) {
            console.warn('Stored session is invalid, signing out:', userError.message);
            await supabase.auth.signOut({ scope: 'local' }).catch(() => {});
            setSession(null);
            setUser(null);
            navigate('/auth');
            return;
          }
        }


        // Deactivated accounts must not keep a live session around.
        if (session?.user && !isDeviceSession(session)) {
          if (await isDeactivatedProfile(session.user.id)) {
            await supabase.auth.signOut();
            setSession(null);
            setUser(null);
            navigate('/auth?deactivated=1');
            return;
          }
        }


        setSession(session);
        setUser(session?.user ?? null);

        // Also check first login for existing sessions
        if (session?.user && !isDeviceSession(session) && !checkedFirstLoginRef.current.has(session.user.id)) {
          checkedFirstLoginRef.current.add(session.user.id);
          setTimeout(() => {
            checkFirstLogin(session.user.id);
          }, 0);
        }
      })
      .catch((error) => {
        console.warn('Initial auth session check failed:', error);
        setSession(null);
        setUser(null);
      })
      .finally(() => {
        setLoading(false);
      });

    return () => subscription.unsubscribe();
  }, []);

  const signIn = async (email: string, password: string) => {
    try {
      const { data, error } = await withTimeout(
        supabase.auth.signInWithPassword({
          email,
          password,
        }),
        AUTH_TIMEOUT_MS,
        'Login is not reaching the auth server. Please refresh and try again.'
      );

      if (!error && data.session) {
        // Block deactivated employees: tear the session down immediately.
        if (!isDeviceSession(data.session) && (await isDeactivatedProfile(data.session.user.id))) {
          await supabase.auth.signOut();
          setSession(null);
          setUser(null);
          return { error: { name: 'AccountDeactivated', message: DEACTIVATED_MESSAGE } };
        }

        setSession(data.session);
        setUser(data.user ?? null);
      }

      return { error };
    } catch (error) {
      console.error('Sign in failed:', error);
      return { error: normalizeAuthError(error) };
    }
  };

  const signUp = async (email: string, password: string, fullName: string, profilePhotoUrl?: string) => {
    const redirectUrl = `${window.location.origin}/`;
    
    const { error } = await supabase.auth.signUp({
      email,
      password,
      options: {
        emailRedirectTo: redirectUrl,
        data: {
          full_name: fullName,
          profile_photo_url: profilePhotoUrl,
        },
      },
    });
    return { error };
  };

  const signOut = async () => {
    // Clear all cached data on logout
    queryClient.invalidateQueries({ queryKey: ['user-role'] });
    queryClient.invalidateQueries({ queryKey: ['locations'] });
    queryClient.resetQueries();
    
    await supabase.auth.signOut();
    navigate('/auth');
  };

  return (
    <AuthContext.Provider value={{ user, session, signIn, signUp, signOut, loading }}>
      {children}
    </AuthContext.Provider>
  );
};

export const useAuth = () => {
  const context = useContext(AuthContext);
  if (context === undefined) {
    throw new Error('useAuth must be used within an AuthProvider');
  }
  return context;
};
