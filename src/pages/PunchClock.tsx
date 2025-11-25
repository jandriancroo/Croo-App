import { useState, useEffect } from 'react';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { supabase } from '@/integrations/supabase/client';
import { toast } from 'sonner';
import { format, differenceInDays } from 'date-fns';
import { Clock, Coffee, LogOut, AlertTriangle } from 'lucide-react';
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from '@/components/ui/dialog';
import { Input } from '@/components/ui/input';
import { Alert, AlertDescription, AlertTitle } from '@/components/ui/alert';
import crooLogo from '@/assets/croo-logo.png';

const ALL_QUOTES = [
  { quote: "Whatever you do, work heartily, as for the Lord and not for men, knowing that from the Lord you will receive the inheritance as your reward", verse: "Colossians 3:23-24", image: "https://images.unsplash.com/photo-1506905925346-21bda4d32df4?w=800&q=80" },
  { quote: "Trust in the Lord with all your heart, and do not lean on your own understanding. In all your ways acknowledge him, and he will make straight your paths", verse: "Proverbs 3:5-6", image: "https://images.unsplash.com/photo-1469474968028-56623f02e42e?w=800&q=80" },
  { quote: "I can do all things through Christ who strengthens me", verse: "Philippians 4:13", image: "https://images.unsplash.com/photo-1501785888041-af3ef285b470?w=800&q=80" },
  { quote: "Have I not commanded you? Be strong and courageous. Do not be frightened, and do not be dismayed, for the Lord your God is with you wherever you go", verse: "Joshua 1:9", image: "https://images.unsplash.com/photo-1472214103451-9374bd1c798e?w=800&q=80" },
  { quote: "This is the day that the Lord has made; let us rejoice and be glad in it", verse: "Psalm 118:24", image: "https://images.unsplash.com/photo-1475924156734-496f6cac6ec1?w=800&q=80" },
  { quote: "For I know the plans I have for you, declares the Lord, plans for welfare and not for evil, to give you a future and a hope", verse: "Jeremiah 29:11", image: "https://images.unsplash.com/photo-1441974231531-c6227db76b6e?w=800&q=80" },
  { quote: "The Lord is my shepherd; I shall not want. He makes me lie down in green pastures. He leads me beside still waters", verse: "Psalm 23:1-2", image: "https://images.unsplash.com/photo-1470071459604-3b5ec3a7fe05?w=800&q=80" },
  { quote: "Come to me, all who labor and are heavy laden, and I will give you rest. Take my yoke upon you, and learn from me", verse: "Matthew 11:28-29", image: "https://images.unsplash.com/photo-1519681393784-d120267933ba?w=800&q=80" },
  { quote: "But they who wait for the Lord shall renew their strength; they shall mount up with wings like eagles; they shall run and not be weary", verse: "Isaiah 40:31", image: "https://images.unsplash.com/photo-1506905925346-21bda4d32df4?w=800&q=80" },
  { quote: "The Lord bless you and keep you; the Lord make his face to shine upon you and be gracious to you", verse: "Numbers 6:24-25", image: "https://images.unsplash.com/photo-1469474968028-56623f02e42e?w=800&q=80" },
  { quote: "Commit your work to the Lord, and your plans will be established", verse: "Proverbs 16:3", image: "https://images.unsplash.com/photo-1501785888041-af3ef285b470?w=800&q=80" },
  { quote: "Do not be anxious about anything, but in everything by prayer and supplication with thanksgiving let your requests be made known to God", verse: "Philippians 4:6", image: "https://images.unsplash.com/photo-1472214103451-9374bd1c798e?w=800&q=80" },
  { quote: "And we know that for those who love God all things work together for good, for those who are called according to his purpose", verse: "Romans 8:28", image: "https://images.unsplash.com/photo-1475924156734-496f6cac6ec1?w=800&q=80" },
  { quote: "The steadfast love of the Lord never ceases; his mercies never come to an end; they are new every morning; great is your faithfulness", verse: "Lamentations 3:22-23", image: "https://images.unsplash.com/photo-1441974231531-c6227db76b6e?w=800&q=80" },
  { quote: "Be still, and know that I am God. I will be exalted among the nations, I will be exalted in the earth", verse: "Psalm 46:10", image: "https://images.unsplash.com/photo-1470071459604-3b5ec3a7fe05?w=800&q=80" },
  { quote: "The name of the Lord is a strong tower; the righteous man runs into it and is safe", verse: "Proverbs 18:10", image: "https://images.unsplash.com/photo-1519681393784-d120267933ba?w=800&q=80" },
  { quote: "Cast all your anxieties on him, because he cares for you", verse: "1 Peter 5:7", image: "https://images.unsplash.com/photo-1506905925346-21bda4d32df4?w=800&q=80" },
  { quote: "Let all that you do be done in love", verse: "1 Corinthians 16:14", image: "https://images.unsplash.com/photo-1469474968028-56623f02e42e?w=800&q=80" },
  { quote: "May the God of hope fill you with all joy and peace in believing, so that by the power of the Holy Spirit you may abound in hope", verse: "Romans 15:13", image: "https://images.unsplash.com/photo-1501785888041-af3ef285b470?w=800&q=80" },
  { quote: "Let your light shine before others, so that they may see your good works and give glory to your Father who is in heaven", verse: "Matthew 5:16", image: "https://images.unsplash.com/photo-1472214103451-9374bd1c798e?w=800&q=80" },
];

// Select 5 quotes for today based on the day of year
const getDailyQuotes = () => {
  const today = new Date();
  const dayOfYear = Math.floor((today.getTime() - new Date(today.getFullYear(), 0, 0).getTime()) / 86400000);
  const startIndex = (dayOfYear * 5) % ALL_QUOTES.length;
  const selectedQuotes = [];
  
  for (let i = 0; i < 5; i++) {
    selectedQuotes.push(ALL_QUOTES[(startIndex + i) % ALL_QUOTES.length]);
  }
  
  return selectedQuotes;
};

const DAILY_QUOTES = getDailyQuotes();

export default function PunchClock() {
  const [pin, setPin] = useState('');
  const [currentUser, setCurrentUser] = useState<any>(null);
  const [todayShift, setTodayShift] = useState<any>(null);
  const [lastPunch, setLastPunch] = useState<any>(null);
  const [currentTime, setCurrentTime] = useState(new Date());
  const [exitPin, setExitPin] = useState('');
  const [showExitDialog, setShowExitDialog] = useState(false);
  const [expiringCerts, setExpiringCerts] = useState<any[]>([]);
  const [currentQuoteIndex, setCurrentQuoteIndex] = useState(0);

  const currentQuote = DAILY_QUOTES[currentQuoteIndex];

  const handleExit = () => {
    setShowExitDialog(true);
  };

  const handleExitConfirm = async () => {
    if (exitPin === '0223') {
      // Exit fullscreen before navigating away
      if (document.fullscreenElement) {
        await document.exitFullscreen().catch(error => {
          console.error('Failed to exit fullscreen:', error);
        });
      }
      
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

  // Rotate quotes every 30 seconds
  useEffect(() => {
    const quoteTimer = setInterval(() => {
      setCurrentQuoteIndex((prev) => (prev + 1) % DAILY_QUOTES.length);
    }, 30000);
    return () => clearInterval(quoteTimer);
  }, []);

  // Enter fullscreen on mount, exit on unmount
  useEffect(() => {
    const enterFullscreen = async () => {
      try {
        await document.documentElement.requestFullscreen();
      } catch (error) {
        console.error('Failed to enter fullscreen:', error);
      }
    };

    enterFullscreen();

    // Prevent swipe down to exit fullscreen
    const preventPullToRefresh = (e: TouchEvent) => {
      // Only prevent if we're at the top of the page
      if (window.scrollY === 0) {
        e.preventDefault();
      }
    };

    const preventScroll = (e: Event) => {
      e.preventDefault();
    };

    // Add event listeners to prevent swipe gestures
    document.addEventListener('touchmove', preventPullToRefresh, { passive: false });
    document.addEventListener('gesturestart', preventScroll, { passive: false });
    document.addEventListener('gesturechange', preventScroll, { passive: false });
    document.addEventListener('gestureend', preventScroll, { passive: false });
    
    // Prevent default scroll behavior
    document.body.style.overflow = 'hidden';
    document.body.style.touchAction = 'none';

    return () => {
      if (document.fullscreenElement) {
        document.exitFullscreen().catch(error => {
          console.error('Failed to exit fullscreen:', error);
        });
      }
      
      // Clean up event listeners
      document.removeEventListener('touchmove', preventPullToRefresh);
      document.removeEventListener('gesturestart', preventScroll);
      document.removeEventListener('gesturechange', preventScroll);
      document.removeEventListener('gestureend', preventScroll);
      
      // Restore default behavior
      document.body.style.overflow = '';
      document.body.style.touchAction = '';
    };
  }, []);

  useEffect(() => {
    if (currentUser) {
      checkTodayShift();
      checkLastPunch();
      checkExpiringCertifications();
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

  const checkExpiringCertifications = async () => {
    if (!currentUser) return;

    try {
      // Get date 30 days from now
      const thirtyDaysFromNow = new Date();
      thirtyDaysFromNow.setDate(thirtyDaysFromNow.getDate() + 30);

      const { data, error } = await supabase
        .from('certifications')
        .select('*')
        .eq('user_id', currentUser.id)
        .eq('status', 'approved')
        .lte('expiration_date', thirtyDaysFromNow.toISOString().split('T')[0])
        .gte('expiration_date', new Date().toISOString().split('T')[0]);

      if (error) throw error;

      setExpiringCerts(data || []);
    } catch (error) {
      console.error('Error checking certifications:', error);
    }
  };

  const canClockIn = () => {
    if (lastPunch?.punch_type === 'clock_in') return false;
    
    // Allow clocking in without a schedule (will be flagged in payroll)
    if (!todayShift) return true;
    
    const now = new Date();
    const shiftStart = new Date(`${todayShift.shift_date}T${todayShift.start_time}`);
    const thirtyMinsBefore = new Date(shiftStart.getTime() - 30 * 60000);
    
    return now >= thirtyMinsBefore;
  };

  const handleClockIn = async () => {
    if (lastPunch?.punch_type === 'clock_in') {
      toast.error('You are already clocked in');
      return;
    }

    // Check if clocking in early for a scheduled shift
    if (todayShift) {
      const now = new Date();
      const shiftStart = new Date(`${todayShift.shift_date}T${todayShift.start_time}`);
      const thirtyMinsBefore = new Date(shiftStart.getTime() - 30 * 60000);
      
      if (now < thirtyMinsBefore) {
        toast.error('You cannot clock in yet. Please wait until 30 minutes before your shift.');
        return;
      }
    }

    const { error } = await supabase
      .from('time_punches')
      .insert({
        user_id: currentUser.id,
        shift_id: todayShift?.id || null,
        punch_type: 'clock_in',
        punch_time: new Date().toISOString()
      });

    if (error) {
      toast.error('Failed to clock in');
      return;
    }

    toast.success('Clocked in successfully!');
    
    // Return to PIN screen after 2 seconds
    setTimeout(() => {
      setCurrentUser(null);
      setPin('');
      setTodayShift(null);
      setLastPunch(null);
    }, 2000);
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
    
    // Return to PIN screen after 2 seconds
    setTimeout(() => {
      setCurrentUser(null);
      setPin('');
      setTodayShift(null);
      setLastPunch(null);
    }, 2000);
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
    
    // Check if user is admin - if not, return to PIN screen after 2 seconds
    const { data: userRole } = await supabase
      .from('user_roles')
      .select('role')
      .eq('user_id', currentUser.id)
      .single();

    const isAdmin = userRole?.role === 'admin';
    
    if (!isAdmin) {
      setTimeout(() => {
        setCurrentUser(null);
        setPin('');
        setTodayShift(null);
        setLastPunch(null);
      }, 2000);
    } else {
      // For admins, just refresh the punch data
      checkLastPunch();
    }
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
        <div className="min-h-screen flex flex-col items-center justify-center bg-background p-4 overflow-hidden touch-none" style={{ touchAction: 'none' }}>
          {/* Logo */}
          <div className="mb-8">
            <img src={crooLogo} alt="Croo" className="h-24 w-auto" />
          </div>
          
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
            <div className="grid md:grid-cols-2">
              {/* Left Side - Image and Quote */}
              <div className="relative h-full min-h-[500px] bg-cover bg-center transition-all duration-1000" style={{ backgroundImage: `url(${currentQuote.image})` }}>
                <div className="absolute inset-0 bg-gradient-to-t from-black/80 via-black/40 to-transparent" />
                <div className="absolute inset-0 flex flex-col justify-end p-8 text-white">
                  <div className="text-5xl font-bold mb-4">
                    {format(currentTime, 'h:mm:ss a')}
                  </div>
                  <h2 className="text-3xl font-bold mb-4">Welcome to Work!</h2>
                  <div className="space-y-2">
                    <p className="text-xl font-medium italic">"{currentQuote.quote}"</p>
                    <p className="text-sm opacity-90">- {currentQuote.verse}</p>
                  </div>
                </div>
              </div>

              {/* Right Side - Number Pad */}
              <CardContent className="p-8 flex flex-col justify-center">
                <div className="space-y-6">
                  <div>
                    <h3 className="text-xl font-semibold mb-4 text-center">Enter Your PIN</h3>
                    <div className="text-center mb-6">
                      <div className="text-3xl font-mono tracking-widest h-16 flex items-center justify-center border-2 border-primary/20 rounded-lg bg-muted/50">
                        {pin.padEnd(4, '•')}
                      </div>
                    </div>
                  </div>
                  
                  <div className="grid grid-cols-3 gap-3">
                    {[1, 2, 3, 4, 5, 6, 7, 8, 9].map((num) => (
                      <Button
                        key={num}
                        variant="outline"
                        size="lg"
                        className="h-16 text-2xl font-semibold hover:bg-primary hover:text-primary-foreground transition-colors"
                        onClick={() => handleNumberClick(num.toString())}
                      >
                        {num}
                      </Button>
                    ))}
                    <Button
                      variant="ghost"
                      size="lg"
                      className="h-16 text-base"
                      onClick={handleClear}
                    >
                      Clear
                    </Button>
                    <Button
                      variant="outline"
                      size="lg"
                      className="h-16 text-2xl font-semibold hover:bg-primary hover:text-primary-foreground transition-colors"
                      onClick={() => handleNumberClick('0')}
                    >
                      0
                    </Button>
                    <Button
                      variant="ghost"
                      size="lg"
                      className="h-16 text-base"
                      onClick={handleBackspace}
                    >
                      ←
                    </Button>
                  </div>

                  <Button
                    className="w-full h-14 text-lg"
                    onClick={verifyPin}
                    disabled={pin.length !== 4}
                  >
                    Enter
                  </Button>
                </div>
              </CardContent>
            </div>
          </Card>
        </div>
      ) : (
        <div className="min-h-screen flex flex-col items-center justify-center bg-background p-4 overflow-hidden touch-none" style={{ touchAction: 'none' }}>
          {/* Logo */}
          <div className="mb-8">
            <img src={crooLogo} alt="Croo" className="h-24 w-auto" />
          </div>
          
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
            <CardHeader className="text-center space-y-2">
              <div className="text-4xl font-bold text-primary">
                {format(currentTime, 'h:mm:ss a')}
              </div>
              <CardTitle className="text-xl">Hello, {currentUser.full_name}!</CardTitle>
              
              {/* Certification Expiry Alerts */}
              {expiringCerts.length > 0 && (
                <Alert variant="destructive" className="mt-4 text-left">
                  <AlertTriangle className="h-4 w-4" />
                  <AlertTitle>Certification Expiring Soon!</AlertTitle>
                  <AlertDescription>
                    {expiringCerts.map((cert) => {
                      const daysUntilExpiry = differenceInDays(
                        new Date(cert.expiration_date),
                        new Date()
                      );
                      const certTypeName = cert.certification_type === 'food_handlers' 
                        ? 'Food Handlers Card' 
                        : 'ServSafe Certification';
                      
                      return (
                        <div key={cert.id} className="mt-1">
                          Your <strong>{certTypeName}</strong> expires in{' '}
                          <strong>{daysUntilExpiry} day{daysUntilExpiry !== 1 ? 's' : ''}</strong>
                          {' '}({format(new Date(cert.expiration_date), 'MMM d, yyyy')}).
                          Please upload your renewed certificate.
                        </div>
                      );
                    })}
                  </AlertDescription>
                </Alert>
              )}
              {todayShift && !isClockedIn && (
                <p className="text-sm text-muted-foreground">
                  Scheduled: {format(new Date(`2000-01-01T${todayShift.start_time}`), 'h:mm a')} - {format(new Date(`2000-01-01T${todayShift.end_time}`), 'h:mm a')}
                </p>
              )}
              {!todayShift && !isClockedIn && (
                <p className="text-sm text-amber-600 font-medium">
                  ⚠ Not scheduled today - punch will be flagged
                </p>
              )}
              {todayShift && isClockedIn && (
                <div className="mt-2 p-3 bg-primary/10 rounded-lg">
                  <p className="text-sm font-medium mb-1">Today's Shift</p>
                  <p className="text-lg font-bold">
                    {format(new Date(`2000-01-01T${todayShift.start_time}`), 'h:mm a')} - {format(new Date(`2000-01-01T${todayShift.end_time}`), 'h:mm a')}
                  </p>
                </div>
              )}
            </CardHeader>
            <CardContent className="space-y-4">
              {!isClockedIn ? (
                <div className="space-y-4">
                  <Button
                    className="w-full h-16 text-lg"
                    onClick={handleClockIn}
                    disabled={!canClockIn()}
                  >
                    <Clock className="mr-2 h-5 w-5" />
                    Clock In
                  </Button>
                  {!todayShift && (
                    <p className="text-xs text-center text-muted-foreground">
                      You can clock in without a scheduled shift, but it will require admin approval in payroll.
                    </p>
                  )}
                  <Button variant="outline" onClick={() => setCurrentUser(null)} className="w-full">
                    Cancel
                  </Button>
                </div>
              ) : (
                <div className="space-y-3">
                  {!todayShift && (
                    <div className="text-center py-2 bg-amber-500/10 rounded-lg border border-amber-500/20">
                      <p className="text-sm font-medium text-amber-700 dark:text-amber-400">⚠ No Scheduled Shift</p>
                    </div>
                  )}
                  {todayShift && (
                    <div className="text-center py-2 bg-primary/10 rounded-lg">
                      <p className="text-sm font-medium">Currently Clocked In</p>
                    </div>
                  )}
                  
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
                  
                  <Button variant="ghost" onClick={() => setCurrentUser(null)} className="w-full">
                    Back
                  </Button>
                </div>
              )}
            </CardContent>
          </Card>
        </div>
      )}
    </>
  );
}