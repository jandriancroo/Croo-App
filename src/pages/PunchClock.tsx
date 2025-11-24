import { useState, useEffect } from 'react';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { supabase } from '@/integrations/supabase/client';
import { toast } from 'sonner';
import { format } from 'date-fns';
import { Clock, Coffee, LogOut } from 'lucide-react';

const DAILY_QUOTES = [
  { quote: "Do your work heartily, as for the Lord", verse: "Colossians 3:23" },
  { quote: "Whatever you do, work at it with all your heart", verse: "Colossians 3:23" },
  { quote: "The Lord will provide", verse: "Genesis 22:14" },
  { quote: "Trust in the Lord with all your heart", verse: "Proverbs 3:5" },
  { quote: "I can do all things through Christ", verse: "Philippians 4:13" },
  { quote: "Be strong and courageous", verse: "Joshua 1:9" },
  { quote: "This is the day the Lord has made", verse: "Psalm 118:24" },
];

export default function PunchClock() {
  const [pin, setPin] = useState('');
  const [currentUser, setCurrentUser] = useState<any>(null);
  const [todayShift, setTodayShift] = useState<any>(null);
  const [lastPunch, setLastPunch] = useState<any>(null);
  const [currentTime, setCurrentTime] = useState(new Date());

  const dailyQuote = DAILY_QUOTES[new Date().getDay()];

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
    setCurrentUser(null);
    setTodayShift(null);
    setLastPunch(null);
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
    setTimeout(() => handleClear(), 2000);
  };

  if (!currentUser) {
    return (
      <div className="min-h-screen flex flex-col items-center justify-center bg-gradient-to-br from-primary/10 via-background to-secondary/10 p-4">
        <Card className="w-full max-w-md">
          <CardHeader className="text-center space-y-4">
            <div className="text-6xl font-bold text-primary">
              {format(currentTime, 'h:mm:ss a')}
            </div>
            <CardTitle className="text-2xl">Welcome to Work! 🎉</CardTitle>
            <div className="text-center space-y-1">
              <p className="text-lg font-medium italic">"{dailyQuote.quote}"</p>
              <p className="text-sm text-muted-foreground">- {dailyQuote.verse}</p>
            </div>
          </CardHeader>
          <CardContent className="space-y-6">
            <div>
              <div className="text-center mb-4">
                <div className="text-2xl font-mono tracking-widest h-12 flex items-center justify-center border-2 border-primary/20 rounded-lg bg-muted/50">
                  {pin.padEnd(4, '•')}
                </div>
              </div>
              
              <div className="grid grid-cols-3 gap-3">
                {[1, 2, 3, 4, 5, 6, 7, 8, 9].map((num) => (
                  <Button
                    key={num}
                    variant="outline"
                    size="lg"
                    className="h-16 text-2xl font-semibold"
                    onClick={() => handleNumberClick(num.toString())}
                  >
                    {num}
                  </Button>
                ))}
                <Button
                  variant="ghost"
                  size="lg"
                  className="h-16 text-lg"
                  onClick={handleClear}
                >
                  Clear
                </Button>
                <Button
                  variant="outline"
                  size="lg"
                  className="h-16 text-2xl font-semibold"
                  onClick={() => handleNumberClick('0')}
                >
                  0
                </Button>
                <Button
                  variant="ghost"
                  size="lg"
                  className="h-16 text-lg"
                  onClick={handleBackspace}
                >
                  ←
                </Button>
              </div>
            </div>

            <Button
              className="w-full h-14 text-lg"
              onClick={verifyPin}
              disabled={pin.length !== 4}
            >
              Enter
            </Button>
          </CardContent>
        </Card>
      </div>
    );
  }

  const isClockedIn = lastPunch?.punch_type === 'clock_in';

  return (
    <div className="min-h-screen flex flex-col items-center justify-center bg-gradient-to-br from-primary/10 via-background to-secondary/10 p-4">
      <Card className="w-full max-w-md">
        <CardHeader className="text-center space-y-2">
          <div className="text-4xl font-bold text-primary">
            {format(currentTime, 'h:mm:ss a')}
          </div>
          <CardTitle className="text-xl">Hello, {currentUser.full_name}!</CardTitle>
          {todayShift && (
            <p className="text-sm text-muted-foreground">
              Scheduled: {format(new Date(`2000-01-01T${todayShift.start_time}`), 'h:mm a')} - {format(new Date(`2000-01-01T${todayShift.end_time}`), 'h:mm a')}
            </p>
          )}
        </CardHeader>
        <CardContent className="space-y-4">
          {!todayShift ? (
            <div className="text-center py-8">
              <p className="text-muted-foreground">You are not scheduled to work today.</p>
              <Button variant="ghost" onClick={handleClear} className="mt-4">
                Back
              </Button>
            </div>
          ) : !isClockedIn ? (
            <div className="space-y-4">
              <Button
                className="w-full h-16 text-lg"
                onClick={handleClockIn}
                disabled={!canClockIn()}
              >
                <Clock className="mr-2 h-5 w-5" />
                Clock In
              </Button>
              <Button variant="outline" onClick={handleClear} className="w-full">
                Cancel
              </Button>
            </div>
          ) : (
            <div className="space-y-3">
              <div className="text-center py-2 bg-primary/10 rounded-lg">
                <p className="text-sm font-medium">Currently Clocked In</p>
              </div>
              
              <Button
                variant="outline"
                className="w-full h-14"
                onClick={() => handleBreak('break_start', 30)}
              >
                <Coffee className="mr-2 h-5 w-5" />
                30 Min Meal Break (Unpaid)
              </Button>
              
              <Button
                variant="outline"
                className="w-full h-14"
                onClick={() => handleBreak('break_start', 10)}
              >
                <Coffee className="mr-2 h-5 w-5" />
                10 Min Break (Paid)
              </Button>
              
              <Button
                variant="destructive"
                className="w-full h-14"
                onClick={handleClockOut}
              >
                <LogOut className="mr-2 h-5 w-5" />
                Clock Out
              </Button>
              
              <Button variant="ghost" onClick={handleClear} className="w-full">
                Back
              </Button>
            </div>
          )}
        </CardContent>
      </Card>
    </div>
  );
}