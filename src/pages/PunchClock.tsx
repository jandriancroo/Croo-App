import { useState, useEffect, useRef, useCallback, useMemo } from 'react';
import { useClock } from '@/hooks/useClock';
import { AnimatePresence } from 'framer-motion';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { supabase } from '@/integrations/supabase/client';
import { toast } from 'sonner';
import { format, differenceInDays } from 'date-fns';
import { Clock, Coffee, LogOut, AlertTriangle } from 'lucide-react';
import { Alert, AlertDescription, AlertTitle } from '@/components/ui/alert';
import crooLogo from '@/assets/croo-logo.webp';
import crooLogoInverted from '/croo-logo-inverted-transparent.png';

import { useLocation as useAppLocation } from '@/hooks/useLocation';
import { useLocationTimezone } from '@/hooks/useLocationTimezone';
import { getTodayInPST, getDateInPSTOffset } from '@/utils/dateUtils';
import { getTodayInTimezone, toISOStringInTimezone, DEFAULT_TIMEZONE } from '@/utils/timezoneUtils';
import { PostClockInTasks } from '@/components/punchclock/PostClockInTasks';
import { AlarmTaskOverlay } from '@/components/punchclock/AlarmTaskOverlay';
import { QRTaskReportOverlay } from '@/components/punchclock/QRTaskReportOverlay';
import { ManagerDashboardOverlay } from '@/components/punchclock/ManagerDashboardOverlay';
import { ShiftSummaryCard } from '@/components/punchclock/ShiftSummaryCard';
import { SwipePagerHint } from '@/components/punchclock/SwipePagerHint';
import { ThemeToggleIcons } from '@/components/punchclock/ThemeToggleIcons';
import { BuildVersionStamp } from '@/components/punchclock/BuildVersionStamp';

import { useSwipe } from '@/hooks/useSwipe';
import {
  isPaired,
  exitKioskMode,
  refreshDeviceSession,
  repairDeviceSession,
  sendDeviceHeartbeat,
  isPairingLockBusy,
  withTimeout,
} from '@/lib/punchDevicePairing';
import { LOADED_VERSION, getBuildLoadedAt, fetchServerVersion, reloadToVersion } from '@/utils/buildVersion';


// Function to calculate average brightness of an image
const getImageBrightness = (imageUrl: string): Promise<number> => {
  return new Promise((resolve) => {
    const img = new Image();
    img.crossOrigin = "anonymous";
    img.onload = () => {
      const canvas = document.createElement('canvas');
      const ctx = canvas.getContext('2d');
      if (!ctx) {
        resolve(128); // Default to middle brightness
        return;
      }
      
      // Sample at smaller size for performance
      canvas.width = 50;
      canvas.height = 50;
      ctx.drawImage(img, 0, 0, 50, 50);
      
      try {
        const imageData = ctx.getImageData(0, 0, 50, 50);
        const data = imageData.data;
        let totalBrightness = 0;
        
        for (let i = 0; i < data.length; i += 4) {
          // Calculate perceived brightness using standard formula
          const brightness = (data[i] * 299 + data[i + 1] * 587 + data[i + 2] * 114) / 1000;
          totalBrightness += brightness;
        }
        
        const avgBrightness = totalBrightness / (data.length / 4);
        resolve(avgBrightness);
      } catch (e) {
        resolve(128); // Default on CORS or other errors
      }
    };
    img.onerror = () => resolve(128);
    img.src = imageUrl;
  });
};

// Nature landscapes - high resolution beautiful nature images
const NATURE_IMAGES = [
  "https://images.unsplash.com/photo-1506905925346-21bda4d32df4?w=1920&q=90", // Swiss Alps
  "https://images.unsplash.com/photo-1501785888041-af3ef285b470?w=1920&q=90", // Mountain lake
  "https://images.unsplash.com/photo-1469474968028-56623f02e42e?w=1920&q=90", // Misty mountains
  "https://images.unsplash.com/photo-1433086966358-54859d0ed716?w=1920&q=90", // Waterfall
  "https://images.unsplash.com/photo-1518837695005-2083093ee35b?w=1920&q=90", // Ocean sunset
  "https://images.unsplash.com/photo-1507525428034-b723cf961d3e?w=1920&q=90", // Tropical beach
  "https://images.unsplash.com/photo-1470071459604-3b5ec3a7fe05?w=1920&q=90", // Foggy forest
  "https://images.unsplash.com/photo-1441974231531-c6227db76b6e?w=1920&q=90", // Sunlit forest
  "https://images.unsplash.com/photo-1472214103451-9374bd1c798e?w=1920&q=90", // Green valley
  "https://images.unsplash.com/photo-1504893524553-b855bce32c67?w=1920&q=90", // River canyon
];

// Historical landmarks - high resolution images
const HISTORICAL_IMAGES = [
  "https://images.unsplash.com/photo-1499856871958-5b9627545d1a?w=1920&q=90", // Eiffel Tower
  "https://images.unsplash.com/photo-1552832230-c0197dd311b5?w=1920&q=90", // Colosseum
  "https://images.unsplash.com/photo-1564507592333-c60657eea523?w=1920&q=90", // Taj Mahal
  "https://images.unsplash.com/photo-1548013146-72479768bada?w=1920&q=90", // Great Wall
  "https://images.unsplash.com/photo-1526711657229-e7e080ed7aa1?w=1920&q=90", // Machu Picchu
  "https://images.unsplash.com/photo-1555921015-5532091f6026?w=1920&q=90", // Parthenon
  "https://images.unsplash.com/photo-1539037116277-4db20889f2d4?w=1920&q=90", // Pyramids
  "https://images.unsplash.com/photo-1513635269975-59663e0ac1ad?w=1920&q=90", // Tower Bridge
  "https://images.unsplash.com/photo-1518509562904-e7ef99cdbc86?w=1920&q=90", // Stonehenge
  "https://images.unsplash.com/photo-1583417267826-aebc4d1542e1?w=1920&q=90", // Angkor Wat
];

// Wise quotes for historical theme
const WISE_QUOTES = [
  '"The only way to do great work is to love what you do." - Steve Jobs',
  '"In the middle of difficulty lies opportunity." - Albert Einstein',
  '"Success is not final, failure is not fatal: it is the courage to continue that counts." - Winston Churchill',
  '"The future belongs to those who believe in the beauty of their dreams." - Eleanor Roosevelt',
  '"It does not matter how slowly you go as long as you do not stop." - Confucius',
  '"The best time to plant a tree was 20 years ago. The second best time is now." - Chinese Proverb',
  '"Be the change you wish to see in the world." - Mahatma Gandhi',
  '"The only thing we have to fear is fear itself." - Franklin D. Roosevelt',
  '"To improve is to change; to be perfect is to change often." - Winston Churchill',
  '"What lies behind us and what lies before us are tiny matters compared to what lies within us." - Ralph Waldo Emerson',
];

const ALL_FACTS = [
  { fact: "Honey never spoils. Archaeologists have found 3,000-year-old honey in Egyptian tombs that was still perfectly edible.", category: "Nature" },
  { fact: "Octopuses have three hearts, blue blood, and can taste with their arms.", category: "Animals" },
  { fact: "A day on Venus is longer than a year on Venus. It takes 243 Earth days to rotate once but only 225 Earth days to orbit the Sun.", category: "Space" },
  { fact: "Bananas are berries, but strawberries are not. Botanically speaking, a berry has seeds inside the flesh.", category: "Science" },
  { fact: "The shortest war in history lasted 38 to 45 minutes between Britain and Zanzibar on August 27, 1896.", category: "History" },
  { fact: "A group of flamingos is called a 'flamboyance'.", category: "Animals" },
  { fact: "The Eiffel Tower can grow more than 6 inches during summer due to thermal expansion of the iron.", category: "Engineering" },
  { fact: "Cows have best friends and get stressed when they are separated from them.", category: "Animals" },
  { fact: "There are more possible iterations of a game of chess than there are atoms in the known universe.", category: "Math" },
  { fact: "The inventor of the Pringles can is buried in one. Fredric Baur requested his ashes be stored in a Pringles can.", category: "Quirky" },
  { fact: "Scotland's national animal is the unicorn. It has been a Scottish heraldic symbol since the 12th century.", category: "Culture" },
  { fact: "The heart of a blue whale is so big that a small child could swim through its arteries.", category: "Animals" },
  { fact: "There's a species of jellyfish that is biologically immortal. Turritopsis dohrnii can revert to its juvenile form.", category: "Nature" },
  { fact: "The moon is slowly drifting away from Earth at about 1.5 inches per year.", category: "Space" },
  { fact: "A single strand of spaghetti is called a 'spaghetto'.", category: "Language" },
  { fact: "Hot water freezes faster than cold water in certain conditions. This is called the Mpemba effect.", category: "Science" },
  { fact: "Nintendo was founded in 1889 as a playing card company, over 100 years before video games.", category: "History" },
  { fact: "A cloud can weigh more than a million pounds. They float because the droplets are spread over a huge area.", category: "Nature" },
  { fact: "Cleopatra lived closer in time to the Moon landing than to the construction of the Great Pyramid.", category: "History" },
  { fact: "Your brain uses about 20% of your total energy and oxygen intake, despite being only 2% of your body weight.", category: "Science" },
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
  const { currentLocation, refetchLocations } = useAppLocation();
  const { timezone, closeTime } = useLocationTimezone();

  const [pin, setPin] = useState('');
  const [pinError, setPinError] = useState(false);
  const [currentUser, setCurrentUser] = useState<any>(null);
  const [currentUserRole, setCurrentUserRole] = useState<string | null>(null);
  const [todayShift, setTodayShift] = useState<any>(null);
  const [lastPunch, setLastPunch] = useState<any>(null);
  const isPunchingRef = useRef(false); // Prevent double-tap duplicate punches
  const currentTime = useClock(1000);
  // Active meeting event (if user is assigned to one happening now)
  const [activeMeetingEvent, setActiveMeetingEvent] = useState<any>(null);
  // Labor rules for clock-in restrictions
  const [laborRules, setLaborRules] = useState<{
    allow_unscheduled_clock_in: boolean;
    allow_early_clock_in: boolean;
    early_clock_in_minutes: number;
  } | null>(null);
  // Master exit code - reserved, cannot be used as employee PIN
  const [expiringCerts, setExpiringCerts] = useState<any[]>([]);
  const [currentFactIndex, setCurrentFactIndex] = useState(0);
  const [pinShake, setPinShake] = useState(false);
  
  // Debounce ref to prevent rapid key presses
  const lastKeyPressRef = useRef<number>(0);
  const DEBOUNCE_MS = 150;
  const [birthdayEmployees, setBirthdayEmployees] = useState<any[]>([]);
  const [currentImageIndex, setCurrentImageIndex] = useState(0);
  
  // Post clock-in task display
  const [showPostClockInTasks, setShowPostClockInTasks] = useState(false);
  
  
  // Custom punch clock settings
  const [customBackground, setCustomBackground] = useState<string | null>(null);
  const [customOverlayText, setCustomOverlayText] = useState<string | null>(null);
  const [customTextColor, setCustomTextColor] = useState("#FFFFFF");
  const [birthdayEventsEnabled, setBirthdayEventsEnabled] = useState(true);
  const [textShadowEnabled, setTextShadowEnabled] = useState(false);
  const [textPosition, setTextPosition] = useState<'overlay' | 'below'>('overlay');
  const [isImageDark, setIsImageDark] = useState(true); // Track if current background is dark
  
  // Multi-slide custom theme support
  const [customBackgroundUrls, setCustomBackgroundUrls] = useState<string[]>([]);
  const [customOverlayTexts, setCustomOverlayTexts] = useState<string[]>([]);
  const [customSlideIndex, setCustomSlideIndex] = useState(0);
  const [slideDuration, setSlideDuration] = useState(10); // seconds
  
  // Crossfade state - track which layer is active (true = layer A, false = layer B)
  const [crossfadeActive, setCrossfadeActive] = useState(true);
  const [prevNatureImage, setPrevNatureImage] = useState(NATURE_IMAGES[0]);
  const [prevHistoricalImage, setPrevHistoricalImage] = useState(HISTORICAL_IMAGES[0]);
  const [prevCustomImage, setPrevCustomImage] = useState<string | null>(null);

  const currentFact = DAILY_FACTS[currentFactIndex];
  const currentNatureImage = NATURE_IMAGES[currentImageIndex % NATURE_IMAGES.length];
  const currentHistoricalImage = HISTORICAL_IMAGES[currentImageIndex % HISTORICAL_IMAGES.length];
  const currentQuote = WISE_QUOTES[currentImageIndex % WISE_QUOTES.length];
  
  // Current custom slide based on rotation
  const currentCustomImage = customBackgroundUrls.length > 0 
    ? customBackgroundUrls[customSlideIndex % customBackgroundUrls.length] 
    : customBackground;
  const currentCustomText = customOverlayTexts.length > 0 
    ? customOverlayTexts[customSlideIndex % customOverlayTexts.length] 
    : customOverlayText;

  // Manager Dashboard state
  const [showManagerDashboard, setShowManagerDashboard] = useState(false);
  const [isDayMode, setIsDayMode] = useState(() => localStorage.getItem('punch-clock-day-mode') === 'true');
  const activeCrooLogo = isDayMode ? crooLogo : crooLogoInverted;

  // Swipe pager — swipe LEFT on the punch clock to reveal the manager dashboard
  const keypadSwipeRef = useRef<HTMLDivElement>(null);
  const shiftSwipeRef = useRef<HTMLDivElement>(null);
  useSwipe(keypadSwipeRef, { onSwipeLeft: () => setShowManagerDashboard(true) });
  useSwipe(shiftSwipeRef, { onSwipeLeft: () => setShowManagerDashboard(true) });

  // Track whether a human is mid-session (PIN entered) so nothing reloads or
  // repairs underneath them.
  const onPinScreenRef = useRef(true);
  onPinScreenRef.current = !currentUser;

  // Last touch/tap/keypress — used only to decide "this kiosk is idle".
  const lastInteractionRef = useRef(Date.now());
  useEffect(() => {
    const touch = () => { lastInteractionRef.current = Date.now(); };
    const events: (keyof DocumentEventMap)[] = ['pointerdown', 'keydown', 'touchstart'];
    events.forEach((e) => document.addEventListener(e, touch, { passive: true }));
    return () => events.forEach((e) => document.removeEventListener(e, touch));
  }, []);

  // Wake/visibility trigger — ONE handler does all three kiosk chores:
  //   1. Keep the paired device session fresh (stale token = frozen clock).
  //   2. Heartbeat (telemetry only — never expires a device).
  //   3. Ask the SERVER whether a newer build is published, and reload the
  //      tablet only while it is idle on the PIN screen.
  // Deliberately not a separate background timer: iOS suspends timers when the
  // PWA is backgrounded, which is the same class of bug as the token freeze.
  useEffect(() => {
    let last = 0;

    const maybeReloadForNewBuild = async () => {
      if (!onPinScreenRef.current) return;                                  // never mid-punch
      if (Date.now() - lastInteractionRef.current < 3 * 60 * 1000) return;  // never mid-PIN
      if (isPairingLockBusy()) return;                                      // repair in flight
      const serverVersion = await fetchServerVersion();
      if (!serverVersion || serverVersion === LOADED_VERSION) return;
      if (!onPinScreenRef.current || isPairingLockBusy()) return;           // re-check after await
      console.log(`[PunchClock] New build ${serverVersion} published (running ${LOADED_VERSION}) — reloading idle kiosk.`);
      reloadToVersion(serverVersion);
    };

    const onWake = () => {
      if (document.visibilityState !== 'visible') return;
      if (Date.now() - last < 60 * 1000) return;
      last = Date.now();
      if (isPaired()) {
        refreshDeviceSession().catch(() => {});
        sendDeviceHeartbeat().catch(() => {});
      }
      maybeReloadForNewBuild().catch(() => {});
    };

    document.addEventListener('visibilitychange', onWake);
    window.addEventListener('focus', onWake);
    const id = window.setInterval(onWake, 5 * 60 * 1000);
    onWake();
    return () => {
      document.removeEventListener('visibilitychange', onWake);
      window.removeEventListener('focus', onWake);
      window.clearInterval(id);
    };
  }, []);

  /**
   * Write a punch with a bounded wait and ONE automatic repair-and-retry.
   * This is the freeze fix: a dead mid-shift session no longer spins forever —
   * it renews itself and retries once, or returns a real error.
   */
  const insertPunch = useCallback(async (row: Record<string, any>): Promise<{ error: { message: string } | null }> => {
    const attempt = () =>
      withTimeout(
        (supabase.from('time_punches') as any).insert(row) as Promise<any>,
        12000,
        'Punch timed out',
      );


    let needsRepair = false;
    try {
      const first: any = await attempt();
      if (!first?.error) return { error: null };
      const msg = String(first.error?.message || '');
      needsRepair = /jwt|token|expired|unauthor|not authenticated|permission|row-level/i.test(msg);
      if (!needsRepair) return { error: first.error };
    } catch {
      needsRepair = true; // hung request — treat as a dead session
    }

    if (!needsRepair || !isPaired()) {
      return { error: { message: 'Could not reach the punch clock. Check the tablet’s internet and try again.' } };
    }

    const repaired = await repairDeviceSession();
    if (!repaired) {
      return { error: { message: 'This tablet lost its connection to CrooHQ. Tell a manager — your time will be added manually.' } };
    }

    try {
      const second: any = await attempt();
      if (second?.error) return { error: second.error };
      return { error: null };
    } catch {
      return { error: { message: 'Punch timed out. Check the tablet’s internet and try again.' } };
    }
  }, []);


  // Listen for localStorage changes from ManagerDashboardOverlay
  useEffect(() => {
    const handleStorage = () => {
      setIsDayMode(localStorage.getItem('punch-clock-day-mode') === 'true');
    };
    window.addEventListener('storage', handleStorage);
    return () => window.removeEventListener('storage', handleStorage);
  }, []);

  // Re-read isDayMode when manager dashboard closes
  useEffect(() => {
    if (!showManagerDashboard) {
      setIsDayMode(localStorage.getItem('punch-clock-day-mode') === 'true');
    }
  }, [showManagerDashboard]);

  // Fetch brand logo for location badge
  const [brandLogoUrl, setBrandLogoUrl] = useState<string | null>(null);
  useEffect(() => {
    const fetchBrandLogo = async () => {
      if (!currentLocation?.organization_id) return;
      const { data: org } = await supabase
        .from('organizations')
        .select('logo_url, brand_id, brands(logo_url)')
        .eq('id', currentLocation.organization_id)
        .single();
      if (org) {
        setBrandLogoUrl(org.logo_url || (org.brands as any)?.logo_url || null);
      }
    };
    fetchBrandLogo();
  }, [currentLocation?.organization_id]);

  

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

    // Paired-device path: leave kiosk UI and land on /auth so an admin can log
    // in with their own email/password. Pairing credentials stay intact so Time
    // > Punch Clock (or a force-quit) can re-enter kiosk mode without re-pairing.
    if (isPaired()) {
      await exitKioskMode();
      window.location.href = '/auth';
      return;
    }

    // Unpaired legacy path: unchanged (goes to / which redirects to /auth
    // for signed-out users, or dashboard for signed-in ones).
    window.location.href = '/';
  };




  // Rotate facts and custom slides with crossfade (using dynamic slideDuration)
  useEffect(() => {
    const durationMs = slideDuration * 1000;
    const factTimer = setInterval(() => {
      // Store current images as previous before updating
      setPrevNatureImage(NATURE_IMAGES[currentImageIndex % NATURE_IMAGES.length]);
      setPrevHistoricalImage(HISTORICAL_IMAGES[currentImageIndex % HISTORICAL_IMAGES.length]);
      if (customBackgroundUrls.length > 0) {
        setPrevCustomImage(customBackgroundUrls[customSlideIndex % customBackgroundUrls.length]);
      }
      
      // Toggle crossfade layer
      setCrossfadeActive(prev => !prev);
      
      // Update indices
      setCurrentFactIndex((prev) => (prev + 1) % DAILY_FACTS.length);
      setCurrentImageIndex((prev) => (prev + 1) % 10);
      setCustomSlideIndex((prev) => prev + 1);
    }, durationMs);
    return () => clearInterval(factTimer);
  }, [currentImageIndex, customSlideIndex, customBackgroundUrls, slideDuration]);

  // Detect brightness of current background image
  useEffect(() => {
    const detectBrightness = async () => {
      let imageUrl: string | null = null;
      
      if (customBackground === "historical_quotes") {
        imageUrl = currentHistoricalImage;
      } else if (customBackground === "nature_facts" || !customBackground) {
        imageUrl = currentNatureImage;
      } else if (customBackgroundUrls.length > 0) {
        imageUrl = currentCustomImage;
      } else if (customBackground) {
        imageUrl = customBackground;
      }
      
      if (imageUrl) {
        const brightness = await getImageBrightness(imageUrl);
        setIsImageDark(brightness < 128); // Below 128 is considered dark
      }
    };
    
    detectBrightness();
  }, [customBackground, currentImageIndex, customSlideIndex, currentNatureImage, currentHistoricalImage, currentCustomImage, customBackgroundUrls.length]);

  // Fetch punch clock settings, labor rules, and check birthdays on mount
  useEffect(() => {
    fetchPunchClockSettings();
    fetchLaborRules();
  }, [currentLocation?.id]);

  const fetchLaborRules = async () => {
    if (!currentLocation?.id) return;
    
    try {
      const { data, error } = await supabase
        .from('labor_rules')
        .select('allow_unscheduled_clock_in, allow_early_clock_in, early_clock_in_minutes')
        .eq('location_id', currentLocation.id)
        .limit(1)
        .maybeSingle();
      
      if (error) throw error;
      
      if (data) {
        setLaborRules({
          allow_unscheduled_clock_in: data.allow_unscheduled_clock_in ?? true,
          allow_early_clock_in: data.allow_early_clock_in ?? true,
          early_clock_in_minutes: data.early_clock_in_minutes ?? 30,
        });
      }
    } catch (error) {
      console.error('Error fetching labor rules:', error);
    }
  };

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
        .select("background_url, overlay_text, text_color, background_urls, overlay_texts, text_shadow, text_position, slide_duration, start_at, end_at")
        .eq("location_id", currentLocation.id)
        .eq("is_active", true)
        .not("start_at", "is", null)
        .lte("start_at", now)
        .gte("end_at", now)
        .order("start_at", { ascending: false })
        .limit(1)
        .maybeSingle();

      if (templateError) throw templateError;

      // If active scheduled template exists, use it
      if (activeTemplate) {
        const bgUrls = (activeTemplate.background_urls as string[]) || [];
        const texts = (activeTemplate.overlay_texts as string[]) || [];
        
        if (bgUrls.length > 0) {
          setCustomBackgroundUrls(bgUrls);
          setCustomOverlayTexts(texts);
          setCustomBackground("custom_multi");
        } else {
          setCustomBackground(activeTemplate.background_url);
          setCustomOverlayText(activeTemplate.overlay_text);
        }
        setCustomTextColor(activeTemplate.text_color || "#FFFFFF");
        setTextShadowEnabled((activeTemplate as any).text_shadow ?? false);
        setTextPosition((activeTemplate as any).text_position || 'overlay');
        setSlideDuration((activeTemplate as any).slide_duration ?? 10);
      } else {
        // Otherwise, check for default theme from location settings
        const { data, error } = await supabase
          .from("location_settings")
          .select("punch_clock_background_url, punch_clock_overlay_text, punch_clock_text_color, birthday_events_enabled, punch_clock_text_shadow")
          .eq("location_id", currentLocation.id)
          .maybeSingle();

        if (error) throw error;

        if (data) {
          const selectedThemeId = data.punch_clock_background_url;
          
          // Check if it's a custom theme ID (not a built-in theme)
          if (selectedThemeId && !["nature_facts", "historical_quotes"].includes(selectedThemeId)) {
            // Fetch the custom theme
            const { data: customTheme } = await supabase
              .from("punch_clock_templates")
              .select("background_url, overlay_text, text_color, background_urls, overlay_texts, text_shadow, text_position, slide_duration")
              .eq("id", selectedThemeId)
              .maybeSingle();
            
            if (customTheme) {
              const bgUrls = (customTheme.background_urls as string[]) || [];
              const texts = (customTheme.overlay_texts as string[]) || [];
              
              if (bgUrls.length > 0) {
                setCustomBackgroundUrls(bgUrls);
                setCustomOverlayTexts(texts);
                setCustomBackground("custom_multi");
              } else {
                setCustomBackground(customTheme.background_url);
                setCustomOverlayText(customTheme.overlay_text);
              }
              setCustomTextColor(customTheme.text_color || "#FFFFFF");
              setTextShadowEnabled((customTheme as any).text_shadow ?? false);
              setTextPosition((customTheme as any).text_position || 'overlay');
              setSlideDuration((customTheme as any).slide_duration ?? 10);
            } else {
              // Theme not found, fall back to nature
              setCustomBackground("nature_facts");
            }
          } else {
            setCustomBackground(selectedThemeId);
            setCustomOverlayText(data.punch_clock_overlay_text);
            setCustomTextColor(data.punch_clock_text_color || "#FFFFFF");
            setTextShadowEnabled((data as any).punch_clock_text_shadow ?? false);
          }
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
    // Detect if running as an installed PWA (standalone mode).
    // In standalone mode the app is already fullscreen — calling
    // requestFullscreen() is redundant AND triggers the browser's
    // "CrooHQ is in full screen" badge with an X button, which staff
    // could tap to escape kiosk mode. Skip it entirely for PWAs.
    const isStandalonePWA =
      window.matchMedia('(display-mode: standalone)').matches ||
      // iOS Safari
      (window.navigator as any).standalone === true;

    const enterFullscreen = async () => {
      if (isStandalonePWA) return;
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

  // Fetch all user data in parallel after PIN verification.
  // IMPORTANT: also depend on currentLocation?.id — if the location hydrates
  // AFTER the user enters their PIN, we must re-run checkTodayShift, otherwise
  // it queries with an undefined location_id and falsely reports "Not scheduled today".
  useEffect(() => {
    if (currentUser && currentLocation?.id) {
      Promise.all([
        checkTodayShift(),
        checkLastPunch(),
        checkExpiringCertifications(),
        checkActiveMeetingEvent()
      ]);
    }
  }, [currentUser, currentLocation?.id]);

  // Self-heal: if the user PINs in but currentLocation is missing (e.g. the
  // PWA went idle during a break and Supabase spuriously wiped auth state),
  // proactively refetch locations instead of forcing them to log out.
  useEffect(() => {
    if (currentUser && !currentLocation?.id) {
      console.warn('[PunchClock] currentLocation missing after PIN — refetching');
      refetchLocations().catch(() => {});
    }
  }, [currentUser, currentLocation?.id, refetchLocations]);

  // On tab becoming visible again (kiosk woken from sleep), if location is
  // missing, refetch. This prevents the "Location not loaded yet" trap.
  useEffect(() => {
    const onVisible = () => {
      if (document.visibilityState === 'visible' && !currentLocation?.id) {
        refetchLocations().catch(() => {});
      }
    };
    document.addEventListener('visibilitychange', onVisible);
    return () => document.removeEventListener('visibilitychange', onVisible);
  }, [currentLocation?.id, refetchLocations]);

  // Keep a ref of the live location so async flows (PIN verify, punches) can read
  // the freshly hydrated value instead of a stale closure.
  const currentLocationRef = useRef(currentLocation);
  useEffect(() => {
    currentLocationRef.current = currentLocation;
  }, [currentLocation]);

  // GUARD: on-demand location recovery. If a PIN entry or a punch happens while
  // the kiosk has no location context (cold reload, woken tablet, network blip),
  // force a refetch and wait for it to hydrate instead of failing the action.
  const ensureLocationLoaded = useCallback(async (): Promise<boolean> => {
    if (currentLocationRef.current?.id) return true;
    for (let attempt = 0; attempt < 3; attempt++) {
      try {
        await refetchLocations();
      } catch {
        /* keep retrying */
      }
      for (let tick = 0; tick < 12; tick++) {
        if (currentLocationRef.current?.id) return true;
        await new Promise((r) => setTimeout(r, 200));
      }
    }
    return !!currentLocationRef.current?.id;
  }, [refetchLocations]);



  const checkAllBirthdays = async () => {
    try {
      if (!currentLocation?.id) return;

      // Only fetch profiles assigned to this location
      const { data: locationUsers, error: luError } = await supabase
        .from('user_locations')
        .select('user_id')
        .eq('location_id', currentLocation.id);

      if (luError) throw luError;
      const userIds = (locationUsers || []).map(u => u.user_id);
      if (userIds.length === 0) {
        setBirthdayEmployees([]);
        return;
      }

      const { data, error } = await supabase
        .from('profiles')
        .select('id, full_name, birthday')
        .eq('is_active', true)
        .not('birthday', 'is', null)
        .in('id', userIds);

      if (error) throw error;

      // Use timezone-aware today to avoid date drift
      const todayStr = getTodayInTimezone(timezone);
      const [, todayMonthStr, todayDayStr] = todayStr.split('-');
      const todayMonth = parseInt(todayMonthStr, 10);
      const todayDay = parseInt(todayDayStr, 10);

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

  // Play feedback sounds
  const playSuccessSound = useCallback(() => {
    const audio = new Audio('data:audio/wav;base64,UklGRnoGAABXQVZFZm10IBAAAAABAAEAQB8AAEAfAAABAAgAZGF0YQoGAACBhYqFbF1fdJivrJBhNjVgodDbq2EcBj+a2teleQwINJLU8LR8MBgVWpDE9Ll8FQsAQ4LC+sKAHQQ1aLfi+bZ+Ig0nSJW/8MaBOhkqPHjC49emXToeLlNsmMnWvHVJODB8fJauxbZqNRYcV3+XrLioVBoNJV2Inbm3ilAJAhxNeZ64t5dRBwAdQmuNpq+RVRALA0FSeY6bqIxQCQBBQF56h5GOXRQGEkFYbHyJin4wCQYsPE1ldH2LVBYIFA0kOk1aXX5uOR4OFQ4gMz5PWHV0RikVGhceKzZBV2dsVzYmIBsYJC00R1liZVg/LCkqJy0yOUJSXGJdUkQyLzA0NTo+RE1WWF1bVU0+NTMwMTI0ODtBRktPUlVTUU5LRUE9Ojg4OTw/Q0lNUVNTUU9MR0I+Ozo5Ojw/REhNT1BQUE1KRkJAPDo5ODk8QERITFBSUlFPTEhEQD07Ojk6PD9CRkpOUFFQTkxIRUA9Ozk5Ojs+QURHS0xNTk1MS0dDPzw5ODY2');
    audio.volume = 0.3;
    audio.play().catch(() => {});
  }, []);

  const playErrorSound = useCallback(() => {
    const audio = new Audio('data:audio/wav;base64,UklGRl9vT19teleQwINJLU8LR8MBgVWpDE9Ll8FQsAQ4LC+sKAHQQ1aLfi+bZ+Ig0nSJW/8MaBOhkqPHjC49emXToeLlNsmMnWvHVJODB8fJauxbZqNRYcV3+XrLioVBoNJV2Inbm3ilAJAhxNeZ64t5dRBwAdQmuNpq+RVRALA0FSeY6bqIxQCQBBQF56h5GOXRQGEkFYbHyJin4wCQYsPE1ldH2LVBYIFA0kOk1aXX5uOR4OFQ4gMz5PWHV0RikVGhceKzZBV2dsVzYmIBsYJC00R1liZVg/LCkqJy0yOUJSXGJdUkQyLzA0NTo+RE1WWF1bVU0+NTMwMTI0ODtBRktPUlVTUU5LRUE9Ojg4OTw/Q0lNUVNTUU9MR0I+Ozo5Ojw/REhNT1BQUE1KRkJAPDo5ODk8QERITFBSUlFPTEhEQD07Ojk6PD9CRkpOUFFQTkxIRUA9Ozk5Ojs+QURHS0xNTk1MS0dDPzw5ODY2');
    audio.volume = 0.2;
    audio.play().catch(() => {});
  }, []);

  const handleNumberClick = (num: string) => {
    // Debounce protection - prevent rapid taps
    const now = Date.now();
    if (now - lastKeyPressRef.current < DEBOUNCE_MS) {
      return;
    }
    lastKeyPressRef.current = now;

    if (pin.length < 4) {
      const newPin = pin + num;
      setPin(newPin);
      
      // Auto-submit when 4 digits entered
      if (newPin.length === 4) {
        verifyPin(newPin);
      }
    }
  };

  const handleClear = () => {
    setPin('');
  };

  const handleBackspace = () => {
    setPin(pin.slice(0, -1));
  };

  // Log attempt to database with shift-based guessing
  const logPunchAttempt = async (pinEntered: string, success: boolean, matchedUserId: string | null) => {
    if (!currentLocation?.id) return;
    
    try {
      // Get employees scheduled around this time (±2 hours)
      const now = new Date();
      const today = format(now, 'yyyy-MM-dd');
      const currentHour = now.getHours();
      const twoHoursBefore = `${String(Math.max(0, currentHour - 2)).padStart(2, '0')}:00:00`;
      const twoHoursAfter = `${String(Math.min(23, currentHour + 2)).padStart(2, '0')}:59:59`;
      
      const { data: scheduledShifts } = await supabase
        .from('scheduled_shifts')
        .select('user_id, profiles!inner(id, full_name)')
        .eq('shift_date', today)
        .gte('start_time', twoHoursBefore)
        .lte('start_time', twoHoursAfter);
      
      const guessedUserIds: string[] = [];
      const guessedUserNames: string[] = [];
      
      if (scheduledShifts) {
        scheduledShifts.forEach((shift: any) => {
          if (shift.profiles && shift.profiles.id) {
            guessedUserIds.push(shift.profiles.id);
            guessedUserNames.push(shift.profiles.full_name || 'Unknown');
          }
        });
      }
      
      await supabase.from('punch_clock_attempts').insert({
        location_id: currentLocation.id,
        pin_entered: pinEntered,
        success,
        matched_user_id: matchedUserId,
        guessed_user_ids: guessedUserIds,
        guessed_user_names: guessedUserNames,
        attempt_time: now.toISOString()
      });
    } catch (err) {
      console.error('Failed to log punch attempt:', err);
    }
  };

  const verifyPin = async (pinToVerify?: string) => {
    const pinValue = pinToVerify || pin;
    
    if (pinValue.length !== 4) {
      toast.error('Please enter a 4-digit PIN');
      return;
    }

    // Privacy-safe lookup. The RPC runs inside the database and returns only
    // id / full_name / profile_photo_url — never wage, phone, birthday, email
    // or the PIN itself. The kiosk has no direct read access to those columns.
    let data: any = null;
    let error: any = null;

    // GUARD: repair a missing location before the lookup, otherwise the RPC is
    // scoped to null and downstream screens falsely report "Not scheduled today".
    if (!currentLocation?.id) {
      await ensureLocationLoaded();
    }

    const rpc = await (supabase as any).rpc('punch_clock_lookup_pin', {
      _pin: pinValue,
      _location_id: currentLocationRef.current?.id ?? null,
    });
    if (rpc.error) {
      error = rpc.error;
    } else if (rpc.data && rpc.data.length > 0) {
      data = rpc.data[0];
    }


    if (error || !data) {
      // Log failed attempt with shift-based guessing
      logPunchAttempt(pinValue, false, null);
      
      console.error('[PunchClock] PIN verification failed:', {
        pin_entered: pinValue,
        location: currentLocation?.name,
        location_id: currentLocation?.id,
        timestamp: new Date().toISOString(),
        error: error?.message || 'No matching profile found'
      });
      
      // Visual and audio feedback for wrong PIN
      setPinError(true);
      setPinShake(true);
      playErrorSound();
      setPin('');
      
      // Clear shake after animation completes
      setTimeout(() => setPinShake(false), 500);
      // Clear error message after 3 seconds
      setTimeout(() => setPinError(false), 3000);
      return;
    }


    // Log successful attempt and play success sound
    logPunchAttempt(pinValue, true, data.id);
    playSuccessSound();
    
    // Fetch user role for event filtering
    const { data: roleData } = await supabase.rpc('punch_clock_get_role', { _user_id: data.id });
    const role = (roleData as string) || 'team_member';
    
    setCurrentUser(data);
    setCurrentUserRole(role);
  };


  const checkTodayShift = async () => {
    if (!currentUser) return;
    // Guard: without a location we cannot filter the schedule. Running the query
    // anyway returns zero rows and falsely flags the user as "Not scheduled today".
    // Bail and let the useEffect re-run once currentLocation hydrates.
    if (!currentLocation?.id) {
      console.warn('[PunchClock] checkTodayShift skipped — location not loaded yet');
      return;
    }

    // CRITICAL: Use location timezone, not device local time.
    // Device clocks can drift to UTC and silently roll "today" past midnight,
    // making valid shifts disappear from the kiosk.
    const today = getTodayInTimezone(timezone || DEFAULT_TIMEZONE);
    const { data } = await supabase
      .from('scheduled_shifts')
      .select('*, schedules!inner(location_id)')
      .eq('user_id', currentUser.id)
      .eq('shift_date', today)
      .eq('schedules.location_id', currentLocation.id)
      .order('start_time', { ascending: true })
      .limit(1);

    setTodayShift(data?.[0] ?? null);
  };

  const checkLastPunch = async () => {
    if (!currentUser) return;

    // Use a 16-hour lookback to correctly handle overnight shifts
    // This ensures we find punches from a shift that started yesterday but is still active
    const now = new Date();
    const lookbackTime = new Date(now.getTime() - 16 * 60 * 60 * 1000);
    
    const { data } = await supabase
      .from('time_punches')
      .select('*')
      .eq('user_id', currentUser.id)
      .gte('punch_time', lookbackTime.toISOString())
      .order('punch_time', { ascending: false })
      .limit(1)
      .maybeSingle();

    // If the last punch is a clock_out from more than 8 hours ago, treat as no active shift
    if (data && data.punch_type === 'clock_out') {
      const punchTime = new Date(data.punch_time);
      const hoursSincePunch = (now.getTime() - punchTime.getTime()) / (1000 * 60 * 60);
      if (hoursSincePunch > 8) {
        setLastPunch(null);
        return;
      }
    }

    setLastPunch(data || null);
    
    console.log('[PunchClock] checkLastPunch result:', {
      userId: currentUser.id,
      userName: currentUser.full_name,
      lookbackTime: lookbackTime.toISOString(),
      lastPunch: data ? {
        id: data.id,
        punch_type: data.punch_type,
        punch_time: data.punch_time
      } : null
    });
  };

  // Check if user is assigned to an active meeting event that allows punch-in
  const checkActiveMeetingEvent = async () => {
    if (!currentUser || !currentLocation?.id) {
      setActiveMeetingEvent(null);
      return;
    }

    try {
      const now = new Date();
      const today = format(now, 'yyyy-MM-dd');
      const currentTime = format(now, 'HH:mm:ss');
      const dayOfWeek = (now.getDay() + 6) % 7; // Convert to Monday=0 format

      // Find meeting events the user is assigned to that are active now
      // An event is active if:
      // 1. It's marked as is_meeting = true
      // 2. It's today (one-time) or recurring on this day of week
      // 3. Current time is within event_time to event_end_time (or 2 hours after start if no end time)
      
      const { data: attendeeRecords, error: attendeeError } = await supabase
        .from('event_attendees')
        .select('event_id')
        .eq('user_id', currentUser.id);

      if (attendeeError) throw attendeeError;

      if (!attendeeRecords || attendeeRecords.length === 0) {
        setActiveMeetingEvent(null);
        return;
      }

      const eventIds = attendeeRecords.map((a: { event_id: string }) => a.event_id);

      // Fetch meeting events
      const { data: events, error: eventsError } = await supabase
        .from('schedule_events')
        .select('*')
        .in('id', eventIds)
        .eq('is_meeting', true)
        .eq('location_id', currentLocation.id);

      if (eventsError) throw eventsError;

      // Find an active meeting
      const activeMeeting = (events || []).find((event: any) => {
        // Check if event applies today
        const isToday = event.is_recurring
          ? (event.days_of_week?.includes(dayOfWeek) || event.day_of_week === dayOfWeek)
          : event.event_date === today;

        if (!isToday) return false;

        // Check time window
        const eventStartTime = event.event_time;
        const eventEndTime = event.event_end_time;

        // If no end time, use 2 hours after start
        if (!eventEndTime) {
          const [startH, startM] = eventStartTime.split(':').map(Number);
          const startMinutes = startH * 60 + startM;
          const endMinutes = startMinutes + 120; // 2 hours
          const [nowH, nowM] = currentTime.split(':').map(Number);
          const nowMinutes = nowH * 60 + nowM;
          return nowMinutes >= startMinutes && nowMinutes <= endMinutes;
        }

        return currentTime >= eventStartTime && currentTime <= eventEndTime;
      });

      setActiveMeetingEvent(activeMeeting || null);

      if (activeMeeting) {
        console.log('[PunchClock] Active meeting found:', activeMeeting.event_name);
      }
    } catch (error) {
      console.error('Error checking meeting events:', error);
      setActiveMeetingEvent(null);
    }
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
    // Cannot clock in if already clocked in
    if (lastPunch?.punch_type === 'clock_in') return false;
    
    // Cannot clock in if on break - must end break first
    if (lastPunch?.punch_type === 'break_start') return false;
    
    // Cannot clock in if just returned from break (already in shift)
    if (lastPunch?.punch_type === 'break_end') return false;
    
    // MEETING OVERRIDE: If user is assigned to an active meeting event, allow clock-in
    if (activeMeetingEvent) {
      return true;
    }
    
    // Check if clocking in without a schedule is allowed
    if (!todayShift) {
      // Use labor rules setting, default to true if not configured
      return laborRules?.allow_unscheduled_clock_in ?? true;
    }
    
    // Check if early clock-in is allowed
    const now = new Date();
    // CRITICAL: build shiftStart in the location's timezone so a device clock
    // set to UTC (or any other zone) cannot shift the comparison window.
    const tz = timezone || DEFAULT_TIMEZONE;
    const startHHmm = String(todayShift.start_time).slice(0, 5);
    const shiftStart = new Date(toISOStringInTimezone(todayShift.shift_date, startHHmm, tz));

    if (!laborRules?.allow_early_clock_in) {
      // Early clock-in disabled - can only clock in at or after shift start
      return now >= shiftStart;
    }

    // Early clock-in allowed - use configured minutes
    const earlyMinutes = laborRules?.early_clock_in_minutes ?? 30;
    const earliestClockIn = new Date(shiftStart.getTime() - earlyMinutes * 60000);

    return now >= earliestClockIn;
  };

  const handleClockIn = async () => {
    // Prevent double-tap
    if (isPunchingRef.current) return;
    isPunchingRef.current = true;
    try {
    // HARD GUARD: never write a punch with NULL location_id
    if (!(await ensureLocationLoaded())) {
      toast.error('Reconnecting to your location — try again in a moment.');
      return;
    }
    // Block if already clocked in
    if (lastPunch?.punch_type === 'clock_in') {
      toast.error('You are already clocked in');
      return;
    }
    
    // Block if on break - must end break first
    if (lastPunch?.punch_type === 'break_start') {
      toast.error('You are on break. Please end your break first.');
      return;
    }
    
    // Block if just returned from break (already in active shift)
    if (lastPunch?.punch_type === 'break_end') {
      toast.error('You are already clocked in');
      return;
    }

    // CRITICAL: Fetch FRESH schedule data to avoid stale cache issues
    // This ensures we always validate against the latest schedule, even if
    // a manager just updated it seconds ago
    // CRITICAL: Use the LOCATION's timezone for "today" and shift start.
    // The kiosk device clock can be set to UTC or drift, which silently
    // rolls the date past midnight and makes valid shifts disappear.
    const tz = timezone || DEFAULT_TIMEZONE;
    const today = getTodayInTimezone(tz);
    const { data: freshShifts } = await supabase
      .from('scheduled_shifts')
      .select('*, schedules!inner(location_id)')
      .eq('user_id', currentUser.id)
      .eq('shift_date', today)
      .eq('schedules.location_id', currentLocation?.id)
      .order('start_time', { ascending: true })
      .limit(1);
    
    const freshShift = freshShifts?.[0] ?? null;
    // Update local state with fresh data
    setTodayShift(freshShift);

    // MEETING OVERRIDE: If user is assigned to an active meeting, skip normal validation
    const isMeetingPunchIn = !!activeMeetingEvent;
    
    if (!isMeetingPunchIn) {
      // Check if clocking in without a scheduled shift
      if (!freshShift) {
        if (laborRules && !laborRules.allow_unscheduled_clock_in) {
          toast.error('You do not have a shift scheduled today. Please contact your manager.');
          return;
        }
        // Allowed - will be flagged for payroll review
      } else {
        // Check if clocking in early for a scheduled shift
        const now = new Date();
        const startHHmm = String(freshShift.start_time).slice(0, 5);
        const shiftStart = new Date(toISOStringInTimezone(freshShift.shift_date, startHHmm, tz));
        
        if (!laborRules?.allow_early_clock_in) {
          // Early clock-in disabled
          if (now < shiftStart) {
            toast.error('You cannot clock in early. Please wait until your shift starts.');
            return;
          }
        } else {
          // Early clock-in allowed with configured limit
          const earlyMinutes = laborRules?.early_clock_in_minutes ?? 30;
          const earliestClockIn = new Date(shiftStart.getTime() - earlyMinutes * 60000);
          
          if (now < earliestClockIn) {
            toast.error(`You cannot clock in yet. Please wait until ${earlyMinutes} minutes before your shift.`);
            return;
          }
        }
      }
    }

    // Use timezone-aware timestamp for punch recording
    const { getNowISOString } = await import('@/utils/timezoneUtils');
    
    // Add note if this is a meeting punch-in
    const punchNotes = isMeetingPunchIn 
      ? `Meeting: ${activeMeetingEvent.event_name}` 
      : undefined;
    
    const { error } = await insertPunch({
      user_id: currentUser.id,
      shift_id: freshShift?.id || null,
      punch_type: 'clock_in',
      punch_time: getNowISOString(),
      location_id: currentLocation?.id,
      created_by: currentUser.id, // Self-punch
      notes: punchNotes
    });

    if (error) {
      toast.error(error.message || 'Failed to clock in');
      return;
    }


    toast.success('Clocked in successfully!');
    
    // Show post clock-in tasks instead of immediately returning to PIN screen
    setShowPostClockInTasks(true);
    } finally { isPunchingRef.current = false; }
  };

  const handlePostClockInDismiss = () => {
    setShowPostClockInTasks(false);
    setCurrentUser(null);
    setPin('');
    setTodayShift(null);
    setLastPunch(null);
  };

  const handleBreak = async (type: 'break_start' | 'break_end', duration: number) => {
    // Prevent double-tap
    if (isPunchingRef.current) return;
    isPunchingRef.current = true;
    try {
    if (!(await ensureLocationLoaded())) {
      toast.error('Reconnecting to your location — try again in a moment.');
      return;
    }
    // Use timezone-aware timestamp for punch recording
    const { getNowISOString } = await import('@/utils/timezoneUtils');
    
    // IMPORTANT: Use shift_id from last punch for shift continuity across midnight
    const activeShiftId = lastPunch?.shift_id ?? todayShift?.id;
    
    const { error } = await insertPunch({
      user_id: currentUser.id,
      shift_id: activeShiftId,
      punch_type: type,
      punch_time: getNowISOString(),
      notes: `${duration} minute ${duration === 30 ? 'unpaid' : 'paid'} break`,
      location_id: currentLocation?.id,
      created_by: currentUser.id // Self-punch
    });


    if (error) {
      toast.error(error.message || 'Failed to record break');
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
    } finally { isPunchingRef.current = false; }
  };

  // Check if user is currently on break and calculate time remaining
  // Buffer of 10 seconds ensures recorded breaks are always ≥30 min (or ≥10 min for short breaks)
  const BREAK_BUFFER_SECONDS = 10;
  
  const getBreakStatus = () => {
    if (!lastPunch || lastPunch.punch_type !== 'break_start') return null;
    
    // Detect break duration from notes - check for "30 minute" first, then fallback to "unpaid"/"meal"
    // This handles both new format ("30 minute unpaid break") and legacy format ("unpaid break")
    const notes = lastPunch.notes?.toLowerCase() || '';
    const is30MinBreak = notes.includes('30 minute') || notes.includes('unpaid') || notes.includes('meal');
    const breakDuration = is30MinBreak ? 30 : 10;
    const breakStartTime = new Date(lastPunch.punch_time);
    // Add buffer to ensure recorded duration meets minimum
    const breakEndTime = new Date(breakStartTime.getTime() + (breakDuration * 60000) + (BREAK_BUFFER_SECONDS * 1000));
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
    // Prevent double-tap
    if (isPunchingRef.current) return;
    isPunchingRef.current = true;
    try {
    if (!(await ensureLocationLoaded())) {
      toast.error('Reconnecting to your location — try again in a moment.');
      return;
    }
    if (!breakStatus?.canEnd) {
      const mins = Math.floor(breakStatus!.remaining / 60);
      const secs = breakStatus!.remaining % 60;
      toast.error(`Please wait ${mins}:${secs.toString().padStart(2, '0')} before ending your break`);
      return;
    }

    // IMPORTANT: Use the active (open) shift_id from the last punch.
    // After midnight, "todayShift" may switch to the next day's scheduled shift,
    // which can incorrectly link break_end/clock_out to the wrong shift.
    const activeShiftId = lastPunch?.shift_id ?? todayShift?.id;

    // Use timezone-aware timestamp for punch recording
    const { getNowISOString } = await import('@/utils/timezoneUtils');
    
    const { error } = await insertPunch({
      user_id: currentUser.id,
      shift_id: activeShiftId,
      punch_type: 'break_end',
      punch_time: getNowISOString(),
      location_id: currentLocation?.id,
      created_by: currentUser.id // Self-punch
    });

    if (error) {
      toast.error(error.message || 'Failed to end break');
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
    } finally { isPunchingRef.current = false; }
  };

  const handleClockOut = async () => {
    // Prevent double-tap
    if (isPunchingRef.current) return;
    isPunchingRef.current = true;
    try {
    if (!(await ensureLocationLoaded())) {
      toast.error('Reconnecting to your location — try again in a moment.');
      return;
    }
    // Use the open shift_id from the last punch (handles overnight shifts).
    const activeShiftId = lastPunch?.shift_id ?? todayShift?.id;

    // Use timezone-aware timestamp for punch recording
    const { getNowISOString } = await import('@/utils/timezoneUtils');
    
    const { error } = await insertPunch({
      user_id: currentUser.id,
      shift_id: activeShiftId,
      punch_type: 'clock_out',
      punch_time: getNowISOString(),
      location_id: currentLocation?.id,
      created_by: currentUser.id // Self-punch
    });

    if (error) {
      toast.error(error.message || 'Failed to clock out');
      return;
    }


    toast.success('Clocked out successfully!');
    
    // Check if user is admin - if not, return to PIN screen after 2 seconds
    const { data: userRole } = await supabase.rpc('punch_clock_get_role', { _user_id: currentUser.id });

    const isAdmin = userRole === 'admin';
    
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
    } finally { isPunchingRef.current = false; }
  };

// User is considered "clocked in" if last punch is clock_in OR break_end (returned from break)
const isClockedIn = lastPunch?.punch_type === 'clock_in' || lastPunch?.punch_type === 'break_end';

  return (
    <>
      
      {/* Alarm Task Overlay */}
      {currentLocation?.id && (
        <AlarmTaskOverlay locationId={currentLocation.id} />
      )}
      
      {/* QR Task Report Overlay */}
      {currentLocation?.id && (
        <QRTaskReportOverlay locationId={currentLocation.id} />
      )}
      
      

      {!currentUser ? (
        <div ref={keypadSwipeRef} className={`relative min-h-screen flex flex-col items-center justify-center p-4 overflow-hidden touch-none ${isDayMode ? 'bg-background' : 'bg-neutral-900'}`} style={{ touchAction: 'none' }}>
          {/* Build stamp — corner, inert, out of the thumb zone */}
          <BuildVersionStamp isDayMode={isDayMode} />


          <div className="w-full max-w-5xl relative">
            {/* Location tab — visually merges with the page background and cuts into the card without a seam */}
            {currentLocation && (
              <div
                className={`absolute left-1/2 top-0 -translate-x-1/2 z-30 flex items-center gap-3 px-8 py-3.5 rounded-b-[24px] ${
                  isDayMode ? 'bg-background' : 'bg-neutral-900'
                }`}
                style={{ clipPath: 'inset(0 round 0 0 24px 24px)' }}
              >
                {brandLogoUrl && (
                  <img src={brandLogoUrl} alt="Brand" className="h-8 w-8 object-contain rounded-md" />
                )}
                <div className={`w-2 h-2 rounded-full animate-pulse ${isDayMode ? 'bg-primary' : 'bg-primary'}`} />
                <span className={`text-base font-semibold tracking-wide ${isDayMode ? 'text-foreground' : 'text-white'}`}>
                  {currentLocation.name}
                </span>
              </div>
            )}
            <Card
              className={`w-full overflow-hidden relative !shadow-none border-0 ${isDayMode ? '' : 'bg-neutral-800'}`}
              style={{ boxShadow: 'none' }}
            >
            <div className="grid md:grid-cols-2">

              {/* Left Side - Image and Quote or Birthday Message */}
              {birthdayEmployees.length > 0 ? (
                <div className="relative h-full min-h-[600px] bg-gradient-to-br from-primary via-accent to-primary">
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
              ) : customBackground === "historical_quotes" ? (
                // Historical theme with rotating landmarks and quotes - dual layer crossfade
                <div className="relative h-full min-h-[600px] overflow-hidden">
                  {/* Layer A */}
                  <div 
                    className={`absolute inset-0 bg-cover bg-center transition-opacity duration-[10000ms] ${crossfadeActive ? 'opacity-100' : 'opacity-0'}`}
                    style={{ backgroundImage: `url(${crossfadeActive ? currentHistoricalImage : prevHistoricalImage})` }}
                  />
                  {/* Layer B */}
                  <div 
                    className={`absolute inset-0 bg-cover bg-center transition-opacity duration-[10000ms] ${crossfadeActive ? 'opacity-0' : 'opacity-100'}`}
                    style={{ backgroundImage: `url(${crossfadeActive ? prevHistoricalImage : currentHistoricalImage})` }}
                  />
                  <div className="absolute inset-0 bg-gradient-to-t from-black/80 via-black/40 to-transparent" />
                  <div className="absolute inset-0 flex flex-col justify-end p-8 text-white">
                    <p className="text-xl font-medium italic drop-shadow-lg">{currentQuote}</p>
                  </div>
                </div>
              ) : customBackground === "nature_facts" || !customBackground ? (
                // Nature theme with rotating landscapes and facts (default) - dual layer crossfade
                <div className="relative h-full min-h-[600px] overflow-hidden">
                  {/* Layer A */}
                  <div 
                    className={`absolute inset-0 bg-cover bg-center transition-opacity duration-[10000ms] ${crossfadeActive ? 'opacity-100' : 'opacity-0'}`}
                    style={{ backgroundImage: `url(${crossfadeActive ? currentNatureImage : prevNatureImage})` }}
                  />
                  {/* Layer B */}
                  <div 
                    className={`absolute inset-0 bg-cover bg-center transition-opacity duration-[10000ms] ${crossfadeActive ? 'opacity-0' : 'opacity-100'}`}
                    style={{ backgroundImage: `url(${crossfadeActive ? prevNatureImage : currentNatureImage})` }}
                  />
                  <div className="absolute inset-0 bg-gradient-to-t from-black/80 via-black/40 to-transparent" />
                  <div className="absolute inset-0 flex flex-col justify-end p-8 text-white">
                    <h2 className="text-3xl font-bold mb-3 drop-shadow-lg">Did You Know?</h2>
                    <div className="space-y-2">
                      <p className="text-xl font-medium drop-shadow-lg">{currentFact.fact}</p>
                      <p className="text-sm opacity-90 drop-shadow">📚 {currentFact.category}</p>
                    </div>
                  </div>
                </div>
              ) : customBackground === "custom_multi" && customBackgroundUrls.length > 0 ? (
                // Multi-slide custom theme - dual layer crossfade
                <div className="relative h-full min-h-[600px] flex flex-col overflow-hidden">
                  {/* Image layers for crossfade */}
                  {textPosition === 'below' ? (
                    // For "below" position, image takes flex-1
                    <div className="relative flex-1 overflow-hidden">
                      {/* Layer A */}
                      <div 
                        className={`absolute inset-0 bg-cover bg-center transition-opacity duration-[10000ms] ${crossfadeActive ? 'opacity-100' : 'opacity-0'}`}
                        style={{ backgroundImage: `url(${crossfadeActive ? currentCustomImage : prevCustomImage || currentCustomImage})` }}
                      />
                      {/* Layer B */}
                      <div 
                        className={`absolute inset-0 bg-cover bg-center transition-opacity duration-[10000ms] ${crossfadeActive ? 'opacity-0' : 'opacity-100'}`}
                        style={{ backgroundImage: `url(${crossfadeActive ? prevCustomImage || currentCustomImage : currentCustomImage})` }}
                      />
                    </div>
                  ) : (
                    // For "overlay" position, image is absolute
                    <>
                      {/* Layer A */}
                      <div 
                        className={`absolute inset-0 bg-cover bg-center transition-opacity duration-[10000ms] ${crossfadeActive ? 'opacity-100' : 'opacity-0'}`}
                        style={{ backgroundImage: `url(${crossfadeActive ? currentCustomImage : prevCustomImage || currentCustomImage})` }}
                      />
                      {/* Layer B */}
                      <div 
                        className={`absolute inset-0 bg-cover bg-center transition-opacity duration-[10000ms] ${crossfadeActive ? 'opacity-0' : 'opacity-100'}`}
                        style={{ backgroundImage: `url(${crossfadeActive ? prevCustomImage || currentCustomImage : currentCustomImage})` }}
                      />
                      <div className="absolute inset-0 bg-gradient-to-t from-black/60 via-black/30 to-transparent" />
                    </>
                  )}
                  {currentCustomText && textPosition === 'overlay' && (
                    <div className="absolute inset-0 z-10 flex flex-col justify-center items-center p-8">
                      <h2 
                        className={`text-4xl font-bold text-center ${textShadowEnabled ? '' : 'drop-shadow-lg'}`}
                        style={{ 
                          color: customTextColor,
                          textShadow: textShadowEnabled ? '2px 2px 4px rgba(0,0,0,0.9), -1px -1px 2px rgba(0,0,0,0.5), 0 0 20px rgba(0,0,0,0.8)' : undefined
                        }}
                      >
                        {currentCustomText}
                      </h2>
                    </div>
                  )}
                  {/* Text pinned below image - white box with black text */}
                  {currentCustomText && textPosition === 'below' && (
                    <div className={`border-t px-6 py-4 ${isDayMode ? 'bg-background border-border' : 'bg-neutral-800 border-neutral-700'}`}>
                      <h2 className={`text-2xl font-bold text-center break-words whitespace-pre-wrap max-w-[calc(100%-6rem)] mx-auto ${isDayMode ? 'text-foreground' : 'text-white'}`}>
                        {currentCustomText}
                      </h2>
                    </div>
                  )}
                </div>
              ) : (
                // Single image custom background (legacy) - only custom text, no time
                <div className="relative h-full min-h-[600px] flex flex-col overflow-hidden">
                  {/* Image area - takes full height for overlay, partial for below */}
                  <div 
                    className={`bg-cover bg-center ${textPosition === 'below' ? 'flex-1' : 'absolute inset-0'}`}
                    style={{ backgroundImage: `url(${customBackground})` }}
                  >
                    {textPosition === 'overlay' && (
                      <div className="absolute inset-0 bg-gradient-to-t from-black/60 via-black/30 to-transparent" />
                    )}
                  </div>
                  {customOverlayText && textPosition === 'overlay' && (
                    <div className="absolute inset-0 z-10 flex flex-col justify-center items-center p-8">
                      <h2 
                        className={`text-4xl font-bold text-center ${textShadowEnabled ? '' : 'drop-shadow-lg'}`}
                        style={{ 
                          color: customTextColor,
                          textShadow: textShadowEnabled ? '2px 2px 4px rgba(0,0,0,0.9), -1px -1px 2px rgba(0,0,0,0.5), 0 0 20px rgba(0,0,0,0.8)' : undefined
                        }}
                      >
                        {customOverlayText}
                      </h2>
                    </div>
                  )}
                  {/* Text pinned below image - white box with black text */}
                  {customOverlayText && textPosition === 'below' && (
                    <div className={`border-t px-6 py-4 ${isDayMode ? 'bg-background border-border' : 'bg-neutral-800 border-neutral-700'}`}>
                      <h2 className={`text-2xl font-bold text-center break-words whitespace-pre-wrap max-w-[calc(100%-6rem)] mx-auto ${isDayMode ? 'text-foreground' : 'text-white'}`}>
                        {customOverlayText}
                      </h2>
                    </div>
                  )}
                </div>
              )}

              {/* Right Side - Number Pad */}
              <CardContent className={`p-8 flex flex-col justify-center ${isDayMode ? '' : 'bg-neutral-800'}`}>
                <div className="space-y-4">
                  {/* Time Display - moved from image side */}
                  <div className="text-center pb-2">
                    <div className={`text-4xl sm:text-5xl font-bold tracking-tight ${isDayMode ? 'text-foreground' : 'text-white'}`}>
                      {format(currentTime, 'h:mm:ss a')}
                    </div>
                    <p className={`text-sm mt-1 ${isDayMode ? 'text-muted-foreground' : 'text-neutral-400'}`}>
                      {format(currentTime, 'EEEE, MMMM d')}
                    </p>
                  </div>
                  
                  <div>
                    <h3 className={`text-base font-medium mb-3 text-center transition-colors duration-200 ${pinError ? 'text-destructive font-semibold' : isDayMode ? 'text-muted-foreground' : 'text-neutral-400'}`}>
                      {pinError ? 'Wrong PIN - Try Again' : 'Enter Your PIN'}
                    </h3>
                    <div className="text-center mb-4">
                      <div 
                        className={`flex items-center justify-center gap-3 h-14 ${pinShake ? 'animate-shake' : ''}`}
                        style={pinShake ? { animation: 'shake 0.5s ease-in-out' } : undefined}
                      >
                        {[0, 1, 2, 3].map((i) => (
                          <div
                            key={i}
                            className={`w-11 h-11 rounded-xl border-2 flex items-center justify-center text-xl font-bold transition-all duration-200 ${
                              pinError
                                ? 'bg-destructive/20 border-destructive'
                                : pin.length > i 
                                  ? 'bg-primary border-primary text-primary-foreground scale-105 shadow-lg' 
                                  : isDayMode ? 'bg-muted/50 border-border' : 'bg-neutral-700/50 border-neutral-600'
                            }`}
                          >
                            {pin.length > i ? '•' : ''}
                          </div>
                        ))}
                      </div>
                    </div>
                  </div>
                  
                  <div className="grid grid-cols-3 gap-2">
                    {[1, 2, 3, 4, 5, 6, 7, 8, 9].map((num) => (
                      <Button
                        key={num}
                        variant="outline"
                        size="lg"
                        className={`h-16 text-2xl font-bold rounded-xl border-2 hover:bg-primary hover:text-primary-foreground hover:border-primary hover:scale-[1.02] active:scale-95 transition-all duration-150 shadow-sm hover:shadow-md ${isDayMode ? 'bg-card' : 'bg-neutral-700 border-neutral-600 text-white'}`}
                        onClick={() => handleNumberClick(num.toString())}
                      >
                        {num}
                      </Button>
                    ))}
                    <Button
                      variant="ghost"
                      size="lg"
                      className={`h-16 text-sm font-medium rounded-xl hover:bg-destructive/10 hover:text-destructive active:scale-95 transition-all duration-150 ${isDayMode ? '' : 'text-neutral-400'}`}
                      onClick={handleClear}
                    >
                      Clear
                    </Button>
                    <Button
                      variant="outline"
                      size="lg"
                      className={`h-16 text-2xl font-bold rounded-xl border-2 hover:bg-primary hover:text-primary-foreground hover:border-primary hover:scale-[1.02] active:scale-95 transition-all duration-150 shadow-sm hover:shadow-md ${isDayMode ? 'bg-card' : 'bg-neutral-700 border-neutral-600 text-white'}`}
                      onClick={() => handleNumberClick('0')}
                    >
                      0
                    </Button>
                    <Button
                      variant="ghost"
                      size="lg"
                      className={`h-16 text-xl font-medium rounded-xl hover:bg-muted active:scale-95 transition-all duration-150 ${isDayMode ? '' : 'text-neutral-400 hover:bg-neutral-700'}`}
                      onClick={handleBackspace}
                    >
                      ⌫
                    </Button>
                  </div>

                  {/* Powered by Croo branding */}
                  <div className="flex items-center justify-center gap-3 pt-6 mt-auto">
                    <span className={`text-base font-medium ${isDayMode ? 'text-muted-foreground' : 'text-neutral-500'}`}>Powered by</span>
                    <img 
                      src={activeCrooLogo} 
                      alt="Croo" 
                      className="h-10 w-auto opacity-70"
                    />
                  </div>
                </div>
              </CardContent>
            </div>

          </Card>
          </div>


          {/* Pager hint — replaces old teal swap button */}
          {currentLocation?.id && timezone && !showManagerDashboard && (
            <SwipePagerHint
              page="punch"
              isDayMode={isDayMode}
              onDotClick={(target) => target === 'dashboard' && setShowManagerDashboard(true)}
            />
          )}

          {/* Theme toggle (bottom right) */}
          <ThemeToggleIcons
            isDayMode={isDayMode}
            onChange={(next) => {
              setIsDayMode(next);
              localStorage.setItem('punch-clock-day-mode', String(next));
            }}
          />
        </div>
      ) : (
        <div ref={shiftSwipeRef} className={`min-h-screen flex flex-col items-center justify-center p-4 overflow-hidden touch-none ${isDayMode ? 'bg-background' : 'bg-neutral-900'}`} style={{ touchAction: 'none' }}>
          {/* Logo - larger size */}
          <div className="mb-8">
            <img src={activeCrooLogo} alt="Croo" className="h-24 w-auto" />
          </div>
          
          {/* Certification Expiry Alerts */}
          {expiringCerts.length > 0 && (
            <Alert variant="destructive" className="mb-4 max-w-md text-left">
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
          
          {showPostClockInTasks ? (
            <Card className="w-full max-w-md">
              <CardContent className="p-6">
                <PostClockInTasks
                  userId={currentUser.id}
                  locationId={currentLocation?.id || ''}
                  timezone={timezone}
                  closeTime={closeTime}
                  userRole={currentUserRole as any}
                  onDismiss={handlePostClockInDismiss}
                />
              </CardContent>
            </Card>
          ) : (
            <ShiftSummaryCard
              user={{
                id: currentUser.id,
                full_name: currentUser.full_name,
                profile_photo_url: currentUser.profile_photo_url,
              }}
              todayShift={todayShift}
              lastPunch={lastPunch}
              breakStatus={breakStatus}
              locationId={currentLocation?.id || ''}
              timezone={timezone}
              onClockIn={handleClockIn}
              onBreak={handleBreak}
              onClockOut={handleClockOut}
              onEndBreak={handleEndBreak}
              onBack={() => {
                setCurrentUser(null);
                setPin('');
                setTodayShift(null);
                setLastPunch(null);
              }}
              canClockIn={canClockIn()}
              isClockedIn={isClockedIn}
              isOnBreak={isOnBreak}
              isDayMode={isDayMode}
              userRole={currentUserRole}
              onExitPunchClock={handleMasterExit}
            />

          )}
          {currentLocation?.id && timezone && !showManagerDashboard && (
            <SwipePagerHint
              page="punch"
              isDayMode={isDayMode}
              onDotClick={(target) => target === 'dashboard' && setShowManagerDashboard(true)}
            />
          )}
        </div>
      )}

      {/* Manager Dashboard Overlay */}
      <AnimatePresence>
        {showManagerDashboard && currentLocation?.id && timezone && (
          <ManagerDashboardOverlay
            locationId={currentLocation.id}
            timezone={timezone}
            closeTime={closeTime}
            onClose={() => setShowManagerDashboard(false)}
            isDayMode={isDayMode}
            onThemeChange={(next) => {
              setIsDayMode(next);
              localStorage.setItem('punch-clock-day-mode', String(next));
            }}
          />
        )}
      </AnimatePresence>
    </>
  );
}