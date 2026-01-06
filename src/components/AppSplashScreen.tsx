import { useEffect, useState } from 'react';
import crooLogo from '@/assets/croo-logo.png';

interface AppSplashScreenProps {
  onComplete?: () => void;
  minDuration?: number;
}

export function AppSplashScreen({ onComplete, minDuration = 1800 }: AppSplashScreenProps) {
  const [phase, setPhase] = useState<'loading' | 'reveal' | 'done'>('loading');

  useEffect(() => {
    // Phase 1: Spin the loader
    const revealTimer = setTimeout(() => {
      setPhase('reveal');
    }, 1000);

    // Phase 2: Complete and callback
    const completeTimer = setTimeout(() => {
      setPhase('done');
      onComplete?.();
    }, minDuration);

    return () => {
      clearTimeout(revealTimer);
      clearTimeout(completeTimer);
    };
  }, [onComplete, minDuration]);

  return (
    <div className="fixed inset-0 z-[100] bg-background flex items-center justify-center">
      <div className="relative flex flex-col items-center gap-6">
        {/* Logo with spinning ring */}
        <div className="relative w-32 h-32 flex items-center justify-center">
          {/* The actual logo */}
          <img 
            src={crooLogo} 
            alt="Croo" 
            className={`w-24 h-24 object-contain transition-all duration-500 ${
              phase === 'loading' ? 'opacity-50 scale-90' : 'opacity-100 scale-100'
            }`}
          />
          
          {/* Spinning ring around logo */}
          <div 
            className={`absolute inset-0 transition-opacity duration-300 ${
              phase === 'reveal' ? 'opacity-0' : 'opacity-100'
            }`}
          >
            <svg className="w-full h-full animate-spin" style={{ animationDuration: '0.8s' }} viewBox="0 0 128 128">
              {/* Background track */}
              <circle
                cx="64"
                cy="64"
                r="58"
                fill="none"
                stroke="currentColor"
                strokeWidth="3"
                className="text-muted-foreground/20"
              />
              {/* Animated arc */}
              <circle
                cx="64"
                cy="64"
                r="58"
                fill="none"
                stroke="currentColor"
                strokeWidth="3"
                strokeLinecap="round"
                className="text-primary"
                strokeDasharray="120 364"
                style={{
                  transform: 'rotate(-90deg)',
                  transformOrigin: 'center',
                }}
              />
            </svg>
          </div>
        </div>
        
        {/* Loading dots */}
        <div className={`flex gap-1 transition-opacity duration-300 ${phase === 'reveal' ? 'opacity-0' : 'opacity-100'}`}>
          <div className="w-2 h-2 rounded-full bg-primary animate-bounce" style={{ animationDelay: '0ms' }} />
          <div className="w-2 h-2 rounded-full bg-primary animate-bounce" style={{ animationDelay: '150ms' }} />
          <div className="w-2 h-2 rounded-full bg-primary animate-bounce" style={{ animationDelay: '300ms' }} />
        </div>
      </div>
    </div>
  );
}
