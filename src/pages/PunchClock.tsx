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
import { useLocation as useAppLocation } from '@/hooks/useLocation';
import { getTodayInPST, getDateInPSTOffset } from '@/utils/dateUtils';

const ALL_FACTS = [
  { fact: "Honey never spoils. Archaeologists have found 3,000-year-old honey in Egyptian tombs that was still perfectly edible.", category: "Nature", image: "https://images.unsplash.com/photo-1587049352846-4a222e784d38?w=800&q=80" },
  { fact: "Octopuses have three hearts, blue blood, and can taste with their arms.", category: "Animals", image: "https://images.unsplash.com/photo-1545671913-b89ac1b4ac10?w=800&q=80" },
  { fact: "A day on Venus is longer than a year on Venus. It takes 243 Earth days to rotate once but only 225 Earth days to orbit the Sun.", category: "Space", image: "https://images.unsplash.com/photo-1614732414444-096e5f1122d5?w=800&q=80" },
  { fact: "Bananas are berries, but strawberries are not. Botanically speaking, a berry has seeds inside the flesh.", category: "Science", image: "https://images.unsplash.com/photo-1571771894821-ce9b6c11b08e?w=800&q=80" },
  { fact: "The shortest war in history lasted 38 to 45 minutes between Britain and Zanzibar on August 27, 1896.", category: "History", image: "https://images.unsplash.com/photo-1461360370896-922624d12a74?w=800&q=80" },
  { fact: "A group of flamingos is called a 'flamboyance'.", category: "Animals", image: "https://images.unsplash.com/photo-1497206365907-f5e630693df0?w=800&q=80" },
  { fact: "The Eiffel Tower can grow more than 6 inches during summer due to thermal expansion of the iron.", category: "Engineering", image: "https://images.unsplash.com/photo-1511739001486-6bfe10ce65f4?w=800&q=80" },
  { fact: "Cows have best friends and get stressed when they are separated from them.", category: "Animals", image: "https://images.unsplash.com/photo-1527153857715-3908f2bae5e8?w=800&q=80" },
  { fact: "There are more possible iterations of a game of chess than there are atoms in the known universe.", category: "Math", image: "https://images.unsplash.com/photo-1529699211952-734e80c4d42b?w=800&q=80" },
  { fact: "The inventor of the Pringles can is buried in one. Fredric Baur requested his ashes be stored in a Pringles can.", category: "Quirky", image: "https://images.unsplash.com/photo-1621447504864-d8686e12698c?w=800&q=80" },
  { fact: "Scotland's national animal is the unicorn. It has been a Scottish heraldic symbol since the 12th century.", category: "Culture", image: "https://images.unsplash.com/photo-1518709268805-4e9042af9f23?w=800&q=80" },
  { fact: "The heart of a blue whale is so big that a small child could swim through its arteries.", category: "Animals", image: "https://images.unsplash.com/photo-1568430462989-44163eb1752f?w=800&q=80" },
  { fact: "There's a species of jellyfish that is biologically immortal. Turritopsis dohrnii can revert to its juvenile form.", category: "Nature", image: "https://images.unsplash.com/photo-1545671913-b89ac1b4ac10?w=800&q=80" },
  { fact: "The moon is slowly drifting away from Earth at about 1.5 inches per year.", category: "Space", image: "https://images.unsplash.com/photo-1532693322450-2cb5c511067d?w=800&q=80" },
  { fact: "A single strand of spaghetti is called a 'spaghetto'.", category: "Language", image: "https://images.unsplash.com/photo-1551183053-bf91a1d81141?w=800&q=80" },
  { fact: "Hot water freezes faster than cold water in certain conditions. This is called the Mpemba effect.", category: "Science", image: "https://images.unsplash.com/photo-1489549132488-d00b7eee80f1?w=800&q=80" },
  { fact: "Nintendo was founded in 1889 as a playing card company, over 100 years before video games.", category: "History", image: "https://images.unsplash.com/photo-1612287230202-1ff1d85d1bdf?w=800&q=80" },
  { fact: "A cloud can weigh more than a million pounds. They float because the droplets are spread over a huge area.", category: "Nature", image: "https://images.unsplash.com/photo-1517483000871-1dbf64a6e1c6?w=800&q=80" },
  { fact: "Cleopatra lived closer in time to the Moon landing than to the construction of the Great Pyramid.", category: "History", image: "https://images.unsplash.com/photo-1539768942893-daf53e448371?w=800&q=80" },
  { fact: "Your brain uses about 20% of your total energy and oxygen intake, despite being only 2% of your body weight.", category: "Science", image: "https://images.unsplash.com/photo-1559757175-5700dde675bc?w=800&q=80" },
];

// Select 5 facts for today based on the day of year
const getDailyFacts = () => {
  const today = new Date();
  const dayOfYear = Math.floor((today.getTime() - new Date(today.getFullYear(), 0, 0).getTime()) / 86400000);
  const startIndex = (dayOfYear * 5) % ALL_FACTS.length;
  const selectedFacts = [];
  
  for (let i = 0; i < 5; i++) {
    selectedFacts.push(ALL_FACTS[(startIndex + i) % ALL_FACTS.length]);
  }
  
  return selectedFacts;
};

const DAILY_FACTS = getDailyFacts();

export default function PunchClock() {
  const { currentLocation } = useAppLocation();
  const [pin, setPin] = useState('');
  const [currentUser, setCurrentUser] = useState<any>(null);
  const [todayShift, setTodayShift] = useState<any>(null);
  const [lastPunch, setLastPunch] = useState<any>(null);
  const [currentTime, setCurrentTime] = useState(new Date());
  // Master exit code - reserved, cannot be used as employee PIN
  const [expiringCerts, setExpiringCerts] = useState<any[]>([]);
  const [currentFactIndex, setCurrentFactIndex] = useState(0);
  const [birthdayEmployees, setBirthdayEmployees] = useState<any[]>([]);
  
  // Custom punch clock settings
  const [customBackground, setCustomBackground] = useState<string | null>(null);
  const [customOverlayText, setCustomOverlayText] = useState<string | null>(null);
  const [customTextColor, setCustomTextColor] = useState("#FFFFFF");
  const [birthdayEventsEnabled, setBirthdayEventsEnabled] = useState(true);

  const currentFact = DAILY_FACTS[currentFactIndex];

  const MASTER_EXIT_CODE = '0223';

  const handleMasterExit = async () => {
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
    window.location.href = '/';
  };

  useEffect(() => {
    const timer = setInterval(() => setCurrentTime(new Date()), 1000);
    return () => clearInterval(timer);
  }, []);

  // Rotate facts every 30 seconds
  useEffect(() => {
    const factTimer = setInterval(() => {
      setCurrentFactIndex((prev) => (prev + 1) % DAILY_FACTS.length);
    }, 30000);
    return () => clearInterval(factTimer);
  }, []);

  // Fetch punch clock settings and check birthdays on mount
  useEffect(() => {
    fetchPunchClockSettings();
  }, [currentLocation?.id]);

  useEffect(() => {
    if (birthdayEventsEnabled) {
      checkAllBirthdays();
    } else {
      setBirthdayEmployees([]);
    }
  }, [birthdayEventsEnabled]);

  const fetchPunchClockSettings = async () => {
    if (!currentLocation?.id) return;

    try {
      // First check for any active scheduled template
      const now = new Date().toISOString();
      const { data: activeTemplate, error: templateError } = await supabase
        .from("punch_clock_templates")
        .select("background_url, overlay_text, text_color")
        .eq("location_id", currentLocation.id)
        .eq("is_active", true)
        .lte("start_at", now)
        .gte("end_at", now)
        .order("start_at", { ascending: false })
        .limit(1)
        .maybeSingle();

      if (templateError) throw templateError;

      // If active template exists, use it
      if (activeTemplate) {
        setCustomBackground(activeTemplate.background_url);
        setCustomOverlayText(activeTemplate.overlay_text);
        setCustomTextColor(activeTemplate.text_color || "#FFFFFF");
      } else {
        // Otherwise, fall back to default location settings
        const { data, error } = await supabase
          .from("location_settings")
          .select("punch_clock_background_url, punch_clock_overlay_text, punch_clock_text_color, birthday_events_enabled")
          .eq("location_id", currentLocation.id)
          .maybeSingle();

        if (error) throw error;

        if (data) {
          setCustomBackground(data.punch_clock_background_url);
          setCustomOverlayText(data.punch_clock_overlay_text);
          setCustomTextColor(data.punch_clock_text_color || "#FFFFFF");
          setBirthdayEventsEnabled(data.birthday_events_enabled ?? true);
        }
      }

      // Always fetch birthday setting from location_settings
      const { data: locationSettings } = await supabase
        .from("location_settings")
        .select("birthday_events_enabled")
        .eq("location_id", currentLocation.id)
        .maybeSingle();
      
      if (locationSettings) {
        setBirthdayEventsEnabled(locationSettings.birthday_events_enabled ?? true);
      }
    } catch (error) {
      console.error("Error fetching punch clock settings:", error);
    }
  };

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

  const checkAllBirthdays = async () => {
    try {
      const { data, error } = await supabase
        .from('profiles')
        .select('id, full_name, birthday')
        .eq('is_active', true)
        .not('birthday', 'is', null);

      if (error) throw error;

      const today = new Date();
      const todayMonth = today.getMonth() + 1;
      const todayDay = today.getDate();

      const employeesWithBirthdays = (data || []).filter(profile => {
        if (!profile.birthday) return false;
        const [year, month, day] = profile.birthday.split('-').map(Number);
        return month === todayMonth && day === todayDay;
      });

      setBirthdayEmployees(employeesWithBirthdays);
    } catch (error) {
      console.error('Error checking birthdays:', error);
    }
  };

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

    // Check for master exit code
    if (pin === MASTER_EXIT_CODE) {
      handleMasterExit();
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
      const todayPST = getTodayInPST();
      const thirtyDaysFromNowPST = getDateInPSTOffset(30);

      const { data, error } = await supabase
        .from('certifications')
        .select('*')
        .eq('user_id', currentUser.id)
        .eq('status', 'approved')
        .lte('expiration_date', thirtyDaysFromNowPST)
        .gte('expiration_date', todayPST);

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
        punch_time: new Date().toISOString(),
        location_id: currentLocation?.id
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
        notes: `${duration} minute ${duration === 30 ? 'unpaid' : 'paid'} break`,
        location_id: currentLocation?.id
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

  // Check if user is currently on break and calculate time remaining
  const getBreakStatus = () => {
    if (!lastPunch || lastPunch.punch_type !== 'break_start') return null;
    
    const breakDuration = lastPunch.notes?.includes('30 minute') ? 30 : 10;
    const breakStartTime = new Date(lastPunch.punch_time);
    const breakEndTime = new Date(breakStartTime.getTime() + breakDuration * 60000);
    const now = new Date();
    const remainingMs = breakEndTime.getTime() - now.getTime();
    
    if (remainingMs <= 0) {
      return { canEnd: true, remaining: 0, breakDuration };
    }
    
    return {
      canEnd: false,
      remaining: Math.ceil(remainingMs / 1000),
      breakDuration
    };
  };

  const breakStatus = getBreakStatus();
  const isOnBreak = lastPunch?.punch_type === 'break_start';

  // Update break timer every second
  const [, forceUpdate] = useState({});
  useEffect(() => {
    if (isOnBreak && breakStatus && !breakStatus.canEnd) {
      const timer = setInterval(() => forceUpdate({}), 1000);
      return () => clearInterval(timer);
    }
  }, [isOnBreak, breakStatus?.canEnd]);

  const handleEndBreak = async () => {
    if (!breakStatus?.canEnd) {
      const mins = Math.floor(breakStatus!.remaining / 60);
      const secs = breakStatus!.remaining % 60;
      toast.error(`Please wait ${mins}:${secs.toString().padStart(2, '0')} before ending your break`);
      return;
    }

    const { error } = await supabase
      .from('time_punches')
      .insert({
        user_id: currentUser.id,
        shift_id: todayShift?.id,
        punch_type: 'break_end',
        punch_time: new Date().toISOString(),
        location_id: currentLocation?.id
      });

    if (error) {
      toast.error('Failed to end break');
      return;
    }

    toast.success('Break ended!');
    
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
        punch_time: new Date().toISOString(),
        location_id: currentLocation?.id
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
      {/* Master code 0223 on keypad exits to dashboard */}

      {!currentUser ? (
        <div className="min-h-screen flex flex-col items-center justify-center bg-background p-4 overflow-hidden touch-none" style={{ touchAction: 'none' }}>
          {/* Logo */}
          <div className="mb-8">
            <img src={crooLogo} alt="Croo" className="h-24 w-auto" />
          </div>
          
          
          <Card className="w-full max-w-5xl overflow-hidden">
            <div className="grid md:grid-cols-2">
              {/* Left Side - Image and Quote or Birthday Message */}
              {birthdayEmployees.length > 0 ? (
                <div className="relative h-full min-h-[500px] bg-gradient-to-br from-primary via-accent to-primary">
                  <div className="absolute inset-0 flex flex-col items-center justify-center p-8 text-white">
                    <div className="text-9xl mb-6 animate-bounce">🎂</div>
                    <h2 className="text-6xl font-bold mb-4 text-center">Happy Birthday!</h2>
                    <div className="text-4xl font-semibold mb-6 text-center">
                      {birthdayEmployees.map((emp, idx) => (
                        <div key={emp.id}>
                          {emp.full_name}
                          {idx < birthdayEmployees.length - 1 && ' & '}
                        </div>
                      ))}
                    </div>
                    <div className="text-5xl font-bold">
                      {format(currentTime, 'h:mm:ss a')}
                    </div>
                    <p className="text-2xl mt-6 text-center italic">
                      Wishing you a wonderful day full of joy and blessings!
                    </p>
                  </div>
                </div>
              ) : customBackground ? (
                // Custom background from location settings
                <div className="relative h-full min-h-[500px] bg-cover bg-center" style={{ backgroundImage: `url(${customBackground})` }}>
                  <div className="absolute inset-0 bg-gradient-to-t from-black/60 via-black/30 to-transparent" />
                  <div className="absolute inset-0 flex flex-col justify-center items-center p-8">
                    {customOverlayText && (
                      <h2 
                        className="text-4xl font-bold mb-6 text-center drop-shadow-lg"
                        style={{ color: customTextColor }}
                      >
                        {customOverlayText}
                      </h2>
                    )}
                    <div 
                      className="text-5xl font-bold drop-shadow-lg"
                      style={{ color: customTextColor }}
                    >
                      {format(currentTime, 'h:mm:ss a')}
                    </div>
                  </div>
                </div>
              ) : (
                // Default: Fun facts
                <div className="relative h-full min-h-[500px] bg-cover bg-center transition-all duration-1000" style={{ backgroundImage: `url(${currentFact.image})` }}>
                  <div className="absolute inset-0 bg-gradient-to-t from-black/80 via-black/40 to-transparent" />
                  <div className="absolute inset-0 flex flex-col justify-end p-8 text-white">
                    <div className="text-5xl font-bold mb-4">
                      {format(currentTime, 'h:mm:ss a')}
                    </div>
                    <h2 className="text-3xl font-bold mb-4">Did You Know?</h2>
                    <div className="space-y-2">
                      <p className="text-xl font-medium">{currentFact.fact}</p>
                      <p className="text-sm opacity-90">📚 {currentFact.category}</p>
                    </div>
                  </div>
                </div>
              )}

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
              ) : isOnBreak ? (
                <div className="space-y-3">
                  {/* On Break UI */}
                  <div className="text-center py-4 bg-amber-500/10 rounded-lg border border-amber-500/20">
                    <Coffee className="h-8 w-8 mx-auto mb-2 text-amber-600" />
                    <p className="text-lg font-semibold text-amber-700 dark:text-amber-400">
                      On {breakStatus?.breakDuration} Min Break
                    </p>
                    {!breakStatus?.canEnd ? (
                      <div className="mt-2">
                        <p className="text-2xl font-mono font-bold text-amber-600">
                          {Math.floor(breakStatus!.remaining / 60)}:{(breakStatus!.remaining % 60).toString().padStart(2, '0')}
                        </p>
                        <p className="text-xs text-muted-foreground mt-1">until you can clock back in</p>
                      </div>
                    ) : (
                      <p className="text-sm text-green-600 font-medium mt-2">Ready to clock back in!</p>
                    )}
                  </div>
                  
                  <Button
                    variant={breakStatus?.canEnd ? 'default' : 'outline'}
                    className={`w-full h-14 ${!breakStatus?.canEnd ? 'opacity-50' : ''}`}
                    onClick={handleEndBreak}
                    disabled={!breakStatus?.canEnd}
                  >
                    <Coffee className="mr-2 h-5 w-5" />
                    {breakStatus?.canEnd ? 'End Break & Clock Back In' : `Wait ${Math.floor(breakStatus!.remaining / 60)}:${(breakStatus!.remaining % 60).toString().padStart(2, '0')}`}
                  </Button>
                  
                  <Button variant="ghost" onClick={() => setCurrentUser(null)} className="w-full">
                    Back
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