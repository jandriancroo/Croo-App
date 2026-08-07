import { useEffect, useMemo, useRef, useState } from 'react';
import { useNavigate, useSearchParams, useLocation } from 'react-router-dom';
import { useAuth } from '@/lib/auth';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Card, CardContent, CardHeader } from '@/components/ui/card';
import { toast } from 'sonner';
import crooLogo from '@/assets/croo-logo.webp';
import { PunchDeviceEntry } from '@/components/punchclock/PunchDeviceEntry';
import CrowSplashAnimation from '@/components/CrowSplashAnimation';
import RotatingAuthBackground from '@/components/auth/RotatingAuthBackground';
import { PWAInstallTutorial } from '@/components/PWAInstallTutorial';
import { isKioskExitActive, isPunchDeviceUser } from '@/lib/punchDevicePairing';
import beachDay from '@/assets/auth-bg/beach-day.jpg.asset.json';
import cityDay from '@/assets/auth-bg/city-day.jpg.asset.json';
import desDay from '@/assets/auth-bg/des-day.jpg.asset.json';
import mtnDay from '@/assets/auth-bg/mtn-day.jpg.asset.json';
import townDay from '@/assets/auth-bg/town-day.jpg.asset.json';
import beachNight from '@/assets/auth-bg/beach-night.jpg.asset.json';
import cityNight from '@/assets/auth-bg/city-night.jpg.asset.json';
import desNight from '@/assets/auth-bg/des-night.jpg.asset.json';
import mtnNight from '@/assets/auth-bg/mtn-night.jpg.asset.json';
import townNight from '@/assets/auth-bg/town-night.jpg.asset.json';
import july4Day from '@/assets/auth-bg/july4-day.jpg.asset.json';
import july4Night from '@/assets/auth-bg/july4-night.jpg.asset.json';

const BASE_DAY = [beachDay.url, cityDay.url, desDay.url, mtnDay.url, townDay.url];
const BASE_NIGHT = [beachNight.url, cityNight.url, desNight.url, mtnNight.url, townNight.url];

// Holiday image packs — prepended to the rotation when the holiday window is active.
type HolidayPack = { name: string; day: string[]; night: string[]; isActive: (d: Date) => boolean };
const HOLIDAYS: HolidayPack[] = [
  {
    name: 'July 4th',
    day: [july4Day.url],
    night: [july4Night.url],
    // Active July 1 – July 5 (local time)
    isActive: (d) => d.getMonth() === 6 && d.getDate() >= 1 && d.getDate() <= 5,
  },
];

function getActiveImages(isDay: boolean, now = new Date()): string[] {
  const base = isDay ? BASE_DAY : BASE_NIGHT;
  const holidayImgs = HOLIDAYS
    .filter((h) => h.isActive(now))
    .flatMap((h) => (isDay ? h.day : h.night));
  return [...holidayImgs, ...base];
}

const ROTATE_MS = 60_000;
const SWIPE_THRESHOLD = 40;

function isDaytime(d = new Date()) {
  const h = d.getHours();
  return h >= 6 && h < 19; // 6am - 7pm local
}

export default function Auth() {
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [loading, setLoading] = useState(false);
  const [showSplash, setShowSplash] = useState(false);
  const [showCrowAnimation, setShowCrowAnimation] = useState(false);
  const { signIn, user } = useAuth();
  const navigate = useNavigate();
  const location = useLocation();

  const [isDay, setIsDay] = useState(isDaytime());
  const images = useMemo(() => getActiveImages(isDay), [isDay]);
  const [index, setIndex] = useState(() => Math.floor(Math.random() * images.length));
  const activeIndex = images.length ? index % images.length : 0;
  const touchStartX = useRef<number | null>(null);
  const containerRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (new URLSearchParams(location.search).get('deactivated') === '1') {
      toast.error(DEACTIVATED_MESSAGE);
    }
  }, [location.search]);

  useEffect(() => {
    const id = setInterval(() => setIsDay(isDaytime()), 5 * 60_000);
    return () => clearInterval(id);
  }, []);

  useEffect(() => {
    const id = setInterval(() => {
      setIndex((i) => (i + 1) % images.length);
    }, ROTATE_MS);
    return () => clearInterval(id);
  }, [images.length]);

  useEffect(() => {
    const next = images[(index + 1) % images.length];
    const img = new Image();
    img.src = next;
  }, [index, images]);

  const goTo = (i: number) => setIndex(i);
  const next = () => setIndex((i) => (i + 1) % images.length);
  const prev = () => setIndex((i) => (i - 1 + images.length) % images.length);

  const onTouchStart = (e: React.TouchEvent) => {
    touchStartX.current = e.changedTouches[0].screenX;
  };

  const onTouchEnd = (e: React.TouchEvent) => {
    if (touchStartX.current === null) return;
    const endX = e.changedTouches[0].screenX;
    const delta = endX - touchStartX.current;
    if (delta < -SWIPE_THRESHOLD) next();
    else if (delta > SWIPE_THRESHOLD) prev();
    touchStartX.current = null;
  };

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
      if (isPunchDeviceUser(user)) {
        if (isKioskExitActive()) return;
        navigate('/punch-clock', { replace: true });
        return;
      }
      navigate('/dashboard');
    }
  }, [user, navigate, showSplash, showCrowAnimation]);

  const handleSignIn = async (e: React.FormEvent) => {
    e.preventDefault();
    setLoading(true);
    try {
      const { error } = await signIn(email, password);
      
      if (error) {
        toast.error(error.message || 'Unable to sign in. Please try again.');
        setLoading(false);
      } else {
        setShowCrowAnimation(true);
      }
    } catch (error: any) {
      console.error('Unexpected sign in error:', error);
      toast.error(error?.message || 'Unable to sign in. Please try again.');
      setLoading(false);
    }
  };

  const handleSplashComplete = () => {
    toast.success('Signed in successfully');
    if (isPunchDeviceUser(user)) {
      if (isKioskExitActive()) return;
      navigate('/punch-clock', { replace: true });
      return;
    }
    navigate('/dashboard');
  };

  // Navigate once after successful sign-in animation trigger
  useEffect(() => {
    if (showCrowAnimation && user) {
      if (isPunchDeviceUser(user)) {
        if (isKioskExitActive()) return;
        navigate('/punch-clock', { replace: true });
        return;
      }
      navigate('/dashboard', { state: { showWelcomeAnimation: true } });
    }
  }, [showCrowAnimation, user, navigate]);

  if (showSplash) {
    return <CrowSplashAnimation onComplete={handleSplashComplete} />;
  }

  return (
    <>
      <RotatingAuthBackground images={images} index={index} isDay={isDay} />
      <div
        ref={containerRef}
        data-auth-content
        onTouchStart={onTouchStart}
        onTouchEnd={onTouchEnd}
        className="flex min-h-dvh flex-col items-center justify-center p-4 relative z-10"
      >
        <Card className="w-full max-w-md shadow-2xl border-2 bg-card/80 backdrop-blur-xl hover:shadow-3xl transition-all duration-300 relative overflow-visible">
          <CardHeader className="text-center pb-0 pt-8 space-y-0.5">
            {/* Croo branding — now inside the card */}
            <div className="flex flex-col items-center gap-0">
              <div className="flex items-center justify-center">
                <img
                  src={crooLogo}
                  alt="Croo"
                  width={100}
                  height={40}
                  className="h-10 w-auto"
                />
              </div>
              <p className="font-sans text-lg italic font-medium text-primary tracking-tight leading-tight">
                Built for operators, by operators
              </p>
            </div>
          </CardHeader>
          <CardContent>
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
              <div className="text-center pt-1 border-t border-border/40">
                <PunchDeviceEntry />
              </div>
            </form>
          </CardContent>
        </Card>

        <PWAInstallTutorial />

        {/* Background image switcher */}
        <div className="fixed bottom-[calc(env(safe-area-inset-bottom,0px)+1.25rem)] left-0 right-0 flex items-center justify-center gap-2 z-30">
          {images.map((src, i) => (
            <button
              key={src}
              type="button"
              data-auth-bg-dot
              aria-label={`Show background ${i + 1}`}
              aria-current={i === activeIndex ? 'true' : undefined}
              onClick={() => goTo(i)}
              className={`h-2.5 rounded-full transition-all duration-300 ${
                i === activeIndex
                  ? 'w-6 bg-primary shadow-sm'
                  : 'w-2.5 bg-card/75 hover:bg-card shadow-sm'
              }`}
            />
          ))}
        </div>
      </div>
    </>
  );
}
