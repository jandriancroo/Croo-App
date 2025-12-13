import { useState, useEffect, useCallback } from 'react';
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription } from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import { supabase } from '@/integrations/supabase/client';
import { useAuth } from '@/lib/auth';
import { toast } from 'sonner';
import { Check, X, Loader2, Bell, Database, Wifi, User, MapPin } from 'lucide-react';

// Export a hook for other components to open diagnostic mode
let openDiagnosticFn: (() => void) | null = null;
export const openDiagnosticMode = () => openDiagnosticFn?.();

const SECRET_PASSPHRASE = 'ellie';

interface TestResult {
  name: string;
  status: 'pending' | 'running' | 'success' | 'error';
  message?: string;
}

export function DiagnosticMode() {
  const [isOpen, setIsOpen] = useState(false);
  const [inputBuffer, setInputBuffer] = useState('');
  const [tests, setTests] = useState<TestResult[]>([]);
  const [isRunning, setIsRunning] = useState(false);
  const [isSuperAdmin, setIsSuperAdmin] = useState(false);
  const { user } = useAuth();

  // Register the open function for external use
  useEffect(() => {
    openDiagnosticFn = () => setIsOpen(true);
    return () => { openDiagnosticFn = null; };
  }, []);

  // Check if user is super_admin
  useEffect(() => {
    const checkSuperAdmin = async () => {
      if (!user) {
        setIsSuperAdmin(false);
        return;
      }
      const { data } = await supabase.rpc('has_role', { _user_id: user.id, _role: 'super_admin' });
      setIsSuperAdmin(data === true);
    };
    checkSuperAdmin();
  }, [user]);

  // Listen for passphrase typed anywhere (desktop)
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.target instanceof HTMLInputElement || e.target instanceof HTMLTextAreaElement) {
        return;
      }
      
      const newBuffer = (inputBuffer + e.key).slice(-SECRET_PASSPHRASE.length);
      setInputBuffer(newBuffer);
      
      if (newBuffer === SECRET_PASSPHRASE && isSuperAdmin) {
        setIsOpen(true);
        setInputBuffer('');
      }
    };

    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [inputBuffer, isSuperAdmin]);

  // Clear buffer after 2 seconds of no input
  useEffect(() => {
    if (inputBuffer) {
      const timeout = setTimeout(() => setInputBuffer(''), 2000);
      return () => clearTimeout(timeout);
    }
  }, [inputBuffer]);

  const updateTest = useCallback((name: string, status: TestResult['status'], message?: string) => {
    setTests(prev => prev.map(t => t.name === name ? { ...t, status, message } : t));
  }, []);

  const sendTestToUsers = async (userIds: string[], label: string) => {
    try {
      const { data, error } = await supabase.functions.invoke('send-push-notification', {
        body: {
          user_ids: userIds,
          title: '🧪 Test Notification',
          body: `Diagnostic test at ${new Date().toLocaleTimeString()} - if you see this, push is working!`,
          notification_type: 'test',
          data: { type: 'test' }
        }
      });
      if (error) throw error;
      if (data?.error) throw new Error(data.error);
      toast.success(`Sent to ${label}: ${data?.successful || 0} success, ${data?.failed || 0} failed`);
    } catch (err: any) {
      toast.error(`Failed: ${err.message}`);
    }
  };

  const sendTestToJordanAndJosh = async () => {
    // Jordan Andrian and Joshua Haro user IDs
    const userIds = [
      'a2e81a39-0e0b-47b1-a1aa-0e53f3869d37', // Jordan
      '43341bf3-b1b9-4b59-9213-142a79006016'  // Josh Haro
    ];
    await sendTestToUsers(userIds, 'Jordan & Josh');
  };

  const runTests = async () => {
    if (!user) {
      toast.error('Must be logged in to run tests');
      return;
    }

    setIsRunning(true);
    setTests([
      { name: 'Database Connection', status: 'pending' },
      { name: 'User Profile', status: 'pending' },
      { name: 'Location Access', status: 'pending' },
      { name: 'Push Token Registration', status: 'pending' },
      { name: 'Push Notification Delivery', status: 'pending' },
      { name: 'Edge Function (send-push)', status: 'pending' },
    ]);

    // Test 1: Database Connection
    updateTest('Database Connection', 'running');
    try {
      const { data, error } = await supabase.from('profiles').select('id').limit(1);
      if (error) throw error;
      updateTest('Database Connection', 'success', 'Connected successfully');
    } catch (err: any) {
      updateTest('Database Connection', 'error', err.message);
    }

    // Test 2: User Profile
    updateTest('User Profile', 'running');
    try {
      const { data, error } = await supabase
        .from('profiles')
        .select('id, full_name, email')
        .eq('id', user.id)
        .single();
      if (error) throw error;
      updateTest('User Profile', 'success', `Logged in as ${data.full_name || data.email}`);
    } catch (err: any) {
      updateTest('User Profile', 'error', err.message);
    }

    // Test 3: Location Access
    updateTest('Location Access', 'running');
    try {
      const { data, error } = await supabase
        .from('user_locations')
        .select('location_id, locations(name)')
        .eq('user_id', user.id);
      if (error) throw error;
      const locationNames = data?.map((l: any) => l.locations?.name).filter(Boolean);
      updateTest('Location Access', 'success', `Access to: ${locationNames?.join(', ') || 'None'}`);
    } catch (err: any) {
      updateTest('Location Access', 'error', err.message);
    }

    // Test 4: Push Token Registration
    updateTest('Push Token Registration', 'running');
    try {
      const { data, error } = await supabase
        .from('push_notification_tokens')
        .select('id, platform, created_at')
        .eq('user_id', user.id);
      if (error) throw error;
      if (!data || data.length === 0) {
        updateTest('Push Token Registration', 'error', 'No push tokens registered');
      } else {
        const platforms = data.map(t => t.platform).join(', ');
        updateTest('Push Token Registration', 'success', `${data.length} token(s): ${platforms}`);
      }
    } catch (err: any) {
      updateTest('Push Token Registration', 'error', err.message);
    }

    // Test 5: Push Notification Delivery
    updateTest('Push Notification Delivery', 'running');
    try {
      const { data, error } = await supabase.functions.invoke('send-push-notification', {
        body: {
          user_ids: [user.id],
          title: '🧪 Test Notification',
          body: `Diagnostic test at ${new Date().toLocaleTimeString()}`,
          notification_type: 'test',
          data: { type: 'test' }
        }
      });
      if (error) throw error;
      if (data?.error) throw new Error(data.error);
      updateTest('Push Notification Delivery', 'success', `Sent: ${data?.successful || 0} success, ${data?.failed || 0} failed`);
    } catch (err: any) {
      updateTest('Push Notification Delivery', 'error', err.message);
    }

    // Test 6: Edge Function (send-push-notification - since check-alerts requires cron secret)
    // Match EXACTLY what a real chat notification sends - plain text title, no emojis
    updateTest('Edge Function (send-push)', 'running');
    try {
      const { data, error } = await supabase.functions.invoke('send-push-notification', {
        body: {
          user_ids: [user.id],
          title: 'Diagnostic Test',  // Plain text - edge function will add 💬
          body: 'If you see this, push notifications work!',
          notification_type: 'chat_messages',
          data: { 
            chat_id: 'diagnostic-test',  // Match real chat structure
            type: 'message'  // Match real chat type
          }
        }
      });
      if (error) throw error;
      updateTest('Edge Function (send-push)', 'success', 'Function executed successfully');
    } catch (err: any) {
      updateTest('Edge Function (send-push)', 'error', err.message);
    }

    setIsRunning(false);
    toast.success('Diagnostic tests complete');
  };

  const getStatusIcon = (status: TestResult['status']) => {
    switch (status) {
      case 'pending':
        return <div className="w-4 h-4 rounded-full bg-muted" />;
      case 'running':
        return <Loader2 className="w-4 h-4 animate-spin text-primary" />;
      case 'success':
        return <Check className="w-4 h-4 text-green-500" />;
      case 'error':
        return <X className="w-4 h-4 text-red-500" />;
    }
  };

  const getTestIcon = (name: string) => {
    if (name.includes('Database')) return <Database className="w-4 h-4" />;
    if (name.includes('User')) return <User className="w-4 h-4" />;
    if (name.includes('Location')) return <MapPin className="w-4 h-4" />;
    if (name.includes('Push') || name.includes('Notification')) return <Bell className="w-4 h-4" />;
    return <Wifi className="w-4 h-4" />;
  };

  return (
    <Dialog open={isOpen} onOpenChange={setIsOpen}>
        <DialogContent className="sm:max-w-md">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2">
              🔧 Diagnostic Mode
            </DialogTitle>
            <DialogDescription>
              Run system tests to verify functionality
            </DialogDescription>
          </DialogHeader>

          <div className="space-y-4">
            <div className="grid grid-cols-2 gap-2">
              <Button 
                onClick={runTests} 
                disabled={isRunning || !user}
                className="w-full"
              >
                {isRunning ? (
                  <>
                    <Loader2 className="w-4 h-4 mr-2 animate-spin" />
                    Running...
                  </>
                ) : (
                  'Run All Tests'
                )}
              </Button>
              <Button 
                onClick={sendTestToJordanAndJosh} 
                disabled={!user}
                variant="outline"
                className="w-full"
              >
                <Bell className="w-4 h-4 mr-2" />
                Test Jordan & Josh
              </Button>
            </div>

            {tests.length > 0 && (
              <div className="space-y-2 mt-4">
                {tests.map((test) => (
                  <div 
                    key={test.name}
                    className={`flex items-center gap-3 p-3 rounded-lg border ${
                      test.status === 'error' ? 'border-red-500/50 bg-red-500/10' :
                      test.status === 'success' ? 'border-green-500/50 bg-green-500/10' :
                      'border-border bg-muted/30'
                    }`}
                  >
                    <div className="text-muted-foreground">
                      {getTestIcon(test.name)}
                    </div>
                    <div className="flex-1 min-w-0">
                      <div className="font-medium text-sm">{test.name}</div>
                      {test.message && (
                        <div className={`text-xs truncate ${
                          test.status === 'error' ? 'text-red-400' : 'text-muted-foreground'
                        }`}>
                          {test.message}
                        </div>
                      )}
                    </div>
                    {getStatusIcon(test.status)}
                  </div>
                ))}
              </div>
            )}

            {!user && (
              <p className="text-sm text-muted-foreground text-center">
                Please log in to run diagnostic tests
              </p>
            )}
          </div>
        </DialogContent>
      </Dialog>
  );
}
