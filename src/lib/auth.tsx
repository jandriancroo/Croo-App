import { createContext, useContext, useEffect, useState, ReactNode, useRef } from 'react';
import { User, Session } from '@supabase/supabase-js';
import { supabase } from '@/integrations/supabase/client';
import { useNavigate } from 'react-router-dom';
import { useQueryClient } from '@tanstack/react-query';

interface AuthContextType {
  user: User | null;
  session: Session | null;
  signIn: (email: string, password: string) => Promise<{ error: any }>;
  signUp: (email: string, password: string, fullName: string, profilePhotoUrl?: string) => Promise<{ error: any }>;
  signOut: () => Promise<void>;
  loading: boolean;
}

const AuthContext = createContext<AuthContextType | undefined>(undefined);

// Check if this is the user's first login and update last_login_at
const checkFirstLogin = async (userId: string) => {
  try {
    // Check if first_login_at is already set
    const { data: profile } = await supabase
      .from('profiles')
      .select('first_login_at')
      .eq('id', userId)
      .single();

    const isFirstLogin = profile && !profile.first_login_at;

    // Always update last_login_at; also set first_login_at if first time
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
      // Also try to notify managers (non-blocking)
      supabase.functions.invoke('hiring-email-service', {
        body: { action: 'employee_joined', userId }
      }).catch(err => console.warn('employee-joined notification failed:', err));
    }
  } catch (error) {
    console.error('Error checking first login:', error);
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
        if (session?.user && event === 'SIGNED_IN') {
          const userId = session.user.id;
          if (!checkedFirstLoginRef.current.has(userId)) {
            checkedFirstLoginRef.current.add(userId);
            setTimeout(() => {
              checkFirstLogin(userId);
            }, 0);
          }
        }
      }
    );

    // Check for existing session
    supabase.auth.getSession().then(({ data: { session } }) => {
      setSession(session);
      setUser(session?.user ?? null);
      setLoading(false);

      // Also check first login for existing sessions
      if (session?.user && !checkedFirstLoginRef.current.has(session.user.id)) {
        checkedFirstLoginRef.current.add(session.user.id);
        setTimeout(() => {
          checkFirstLogin(session.user.id);
        }, 0);
      }
    });

    return () => subscription.unsubscribe();
  }, []);

  const signIn = async (email: string, password: string) => {
    const { error } = await supabase.auth.signInWithPassword({
      email,
      password,
    });
    return { error };
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
