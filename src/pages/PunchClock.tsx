import { useState, useEffect } from 'react';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { supabase } from '@/integrations/supabase/client';
import { toast } from 'sonner';
import { format } from 'date-fns';
import { Clock, Coffee, LogOut } from 'lucide-react';
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from '@/components/ui/dialog';
import { Input } from '@/components/ui/input';

const DAILY_QUOTES = [
  { quote: "Do your work heartily, as for the Lord", verse: "Colossians 3:23", image: "https://images.unsplash.com/photo-1506905925346-21bda4d32df4?w=800&q=80" },
  { quote: "Whatever you do, work at it with all your heart", verse: "Colossians 3:23", image: "https://images.unsplash.com/photo-1469474968028-56623f02e42e?w=800&q=80" },
  { quote: "The Lord will provide", verse: "Genesis 22:14", image: "https://images.unsplash.com/photo-1501785888041-af3ef285b470?w=800&q=80" },
  { quote: "Trust in the Lord with all your heart", verse: "Proverbs 3:5", image: "https://images.unsplash.com/photo-1472214103451-9374bd1c798e?w=800&q=80" },
  { quote: "I can do all things through Christ", verse: "Philippians 4:13", image: "https://images.unsplash.com/photo-1475924156734-496f6cac6ec1?w=800&q=80" },
  { quote: "Be strong and courageous", verse: "Joshua 1:9", image: "https://images.unsplash.com/photo-1441974231531-c6227db76b6e?w=800&q=80" },
  { quote: "This is the day the Lord has made", verse: "Psalm 118:24", image: "https://images.unsplash.com/photo-1470071459604-3b5ec3a7fe05?w=800&q=80" },
];

export default function PunchClock() {
  const [pin, setPin] = useState('');
  const [currentUser, setCurrentUser] = useState<any>(null);
  const [todayShift, setTodayShift] = useState<any>(null);
  const [lastPunch, setLastPunch] = useState<any>(null);
  const [currentTime, setCurrentTime] = useState(new Date());
  const [exitPin, setExitPin] = useState('');
  const [showExitDialog, setShowExitDialog] = useState(false);

  const dailyQuote = DAILY_QUOTES[new Date().getDay()];

  const handleExit = () => {
    setShowExitDialog(true);
  };

  const handleExitConfirm = () => {
    if (exitPin === '0223') {
      setPin('');
      setCurrentUser(null);
      setTodayShift(null);
      setLastPunch(null);
      setShowExitDialog(false);
      setExitPin('');
      window.location.href = '/';
    } else {
      toast.error('Invalid exit code');
      setExitPin('');
    }
  };

  useEffect(() => {
    const timer = setInterval(() => setCurrentTime(new Date()), 1000);
    return () => clearInterval(timer);
  }, []);

  useEffect(() => {
    if (currentUser) {
      checkTodayShift();
      checkLastPunch();
    }
  }, [currentUser]);

  const handleNumberClick = (num: string) => {
    if (pin.length < 4) {
      setPin(pin + num);
    }
  };

  const handleClear = () => {
    setPin('');
  };

  const handleBackspace = () => {
    setPin(pin.slice(0, -1));
  };

  const verifyPin = async () => {
    if (pin.length !== 4) {
      toast.error('Please enter a 4-digit PIN');
      return;
    }

    const { data, error } = await supabase
      .from('profiles')
      .select('*')
      .eq('employee_pin', pin)
      .single();

    if (error || !data) {
      toast.error('Invalid PIN');
      setPin('');
      return;
    }

    setCurrentUser(data);
  };

  const checkTodayShift = async () => {
    if (!currentUser) return;

    const today = format(new Date(), 'yyyy-MM-dd');
    const { data } = await supabase
      .from('scheduled_shifts')
      .select('*')
      .eq('user_id', currentUser.id)
      .eq('shift_date', today)
      .single();

    setTodayShift(data);
  };

  const checkLastPunch = async () => {
    if (!currentUser) return;

    const today = format(new Date(), 'yyyy-MM-dd');
    const { data } = await supabase
      .from('time_punches')
      .select('*')
      .eq('user_id', currentUser.id)
      .gte('punch_time', today)
      .order('punch_time', { ascending: false })
      .limit(1)
      .single();

    setLastPunch(data || null);
  };

  const canClockIn = () => {
    if (!todayShift) return false;
    if (lastPunch?.punch_type === 'clock_in') return false;
    
    const now = new Date();
    const shiftStart = new Date(`${todayShift.shift_date}T${todayShift.start_time}`);
    const thirtyMinsBefore = new Date(shiftStart.getTime() - 30 * 60000);
    
    return now >= thirtyMinsBefore;
  };

  const handleClockIn = async () => {
    if (!canClockIn()) {
      toast.error('You cannot clock in yet. Please wait until 30 minutes before your shift.');
      return;
    }

    const { error } = await supabase
      .from('time_punches')
      .insert({
        user_id: currentUser.id,
        shift_id: todayShift.id,
        punch_type: 'clock_in',
        punch_time: new Date().toISOString()
      });

    if (error) {
      toast.error('Failed to clock in');
      return;
    }

    toast.success('Clocked in successfully!');
    checkLastPunch();
  };

  const handleBreak = async (type: 'break_start' | 'break_end', duration: number) => {
    const { error } = await supabase
      .from('time_punches')
      .insert({
        user_id: currentUser.id,
        shift_id: todayShift?.id,
        punch_type: type,
        punch_time: new Date().toISOString(),
        notes: `${duration} minute ${duration === 30 ? 'unpaid' : 'paid'} break`
      });

    if (error) {
      toast.error('Failed to record break');
      return;
    }

    toast.success(`${type === 'break_start' ? 'Starting' : 'Ending'} ${duration} minute break`);
    checkLastPunch();
  };

  const handleClockOut = async () => {
    const { error } = await supabase
      .from('time_punches')
      .insert({
        user_id: currentUser.id,
        shift_id: todayShift?.id,
        punch_type: 'clock_out',
        punch_time: new Date().toISOString()
      });

    if (error) {
      toast.error('Failed to clock out');
      return;
    }

    toast.success('Clocked out successfully!');
    setTimeout(() => setShowExitDialog(true), 500);
  };

const isClockedIn = lastPunch?.punch_type === 'clock_in';

  return (
    <>
      {/* Exit Dialog - Always rendered */}
      <Dialog open={showExitDialog} onOpenChange={setShowExitDialog}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Exit Punch Clock</DialogTitle>
          </DialogHeader>
          <div className="space-y-4">
            <p className="text-sm text-muted-foreground">Enter the 4-digit exit code to leave</p>
            <Input
              type="password"
              maxLength={4}
              placeholder="••••"
              value={exitPin}
              onChange={(e) => setExitPin(e.target.value)}
              className="text-center text-2xl tracking-widest"
            />
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => {
              setShowExitDialog(false);
              setExitPin('');
            }}>
              Cancel
            </Button>
            <Button onClick={handleExitConfirm} disabled={exitPin.length !== 4}>
              Exit
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {!currentUser ? (
        <div className="min-h-screen flex items-center justify-center bg-gradient-to-br from-primary/10 via-background to-secondary/10 p-4">
          {/* Exit Button */}
          <Button
            size="sm"
            variant="destructive"
            onClick={handleExit}
            className="fixed top-4 left-4 z-50"
          >
            Exit
          </Button>
          
          <Card className="w-full max-w-5xl overflow-hidden">
...
          </Card>
        </div>
      ) : (
        <div className="min-h-screen flex flex-col items-center justify-center bg-gradient-to-br from-primary/10 via-background to-secondary/10 p-4">
          {/* Exit Button */}
          <Button
            size="sm"
            variant="destructive"
            onClick={handleExit}
            className="fixed top-4 left-4 z-50"
          >
            Exit
          </Button>
          
          <Card className="w-full max-w-md">
...
          </Card>
        </div>
      )}
    </>
  );
}