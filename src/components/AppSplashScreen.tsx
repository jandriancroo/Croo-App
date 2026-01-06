import { useEffect, useState } from 'react';

interface AppSplashScreenProps {
  onComplete?: () => void;
  minDuration?: number;
}

export function AppSplashScreen({ onComplete, minDuration = 1800 }: AppSplashScreenProps) {
  const [phase, setPhase] = useState<'drawing' | 'filling' | 'done'>('drawing');

  useEffect(() => {
    // Phase 1: Logo draws (stroke animation)
    const drawTimer = setTimeout(() => {
      setPhase('filling');
    }, 1200);

    // Phase 2: Complete and callback
    const completeTimer = setTimeout(() => {
      setPhase('done');
      onComplete?.();
    }, minDuration);

    return () => {
      clearTimeout(drawTimer);
      clearTimeout(completeTimer);
    };
  }, [onComplete, minDuration]);

  return (
    <div className="fixed inset-0 z-[100] bg-background flex items-center justify-center">
      <div className="relative flex flex-col items-center gap-6">
        {/* Animated Crow Logo */}
        <div className="relative w-24 h-24">
          <svg
            viewBox="0 0 100 100"
            className="w-full h-full"
          >
            {/* Crow body - drawn with stroke animation */}
            <path
              d="M50 20 
                 C35 20 25 35 25 50 
                 C25 65 35 80 50 85 
                 C65 80 75 65 75 50 
                 C75 35 65 20 50 20"
              fill={phase === 'filling' ? 'currentColor' : 'none'}
              stroke="currentColor"
              strokeWidth="2"
              strokeLinecap="round"
              strokeLinejoin="round"
              className={`text-foreground transition-all duration-500 ${
                phase === 'drawing' ? 'animate-draw-logo' : ''
              }`}
              style={{
                strokeDasharray: 200,
                strokeDashoffset: phase === 'drawing' ? 200 : 0,
              }}
            />
            
            {/* Wing left */}
            <path
              d="M30 45 C15 40 10 50 15 60 C20 55 28 52 35 55"
              fill={phase === 'filling' ? 'currentColor' : 'none'}
              stroke="currentColor"
              strokeWidth="2"
              className={`text-foreground transition-all duration-500 delay-200`}
              style={{
                strokeDasharray: 80,
                strokeDashoffset: phase === 'drawing' ? 80 : 0,
                opacity: phase === 'drawing' ? 0.7 : 1,
              }}
            />
            
            {/* Wing right */}
            <path
              d="M70 45 C85 40 90 50 85 60 C80 55 72 52 65 55"
              fill={phase === 'filling' ? 'currentColor' : 'none'}
              stroke="currentColor"
              strokeWidth="2"
              className={`text-foreground transition-all duration-500 delay-300`}
              style={{
                strokeDasharray: 80,
                strokeDashoffset: phase === 'drawing' ? 80 : 0,
                opacity: phase === 'drawing' ? 0.7 : 1,
              }}
            />
            
            {/* Beak */}
            <path
              d="M50 50 L58 55 L50 60 Z"
              fill={phase === 'filling' ? 'hsl(var(--primary))' : 'none'}
              stroke="hsl(var(--primary))"
              strokeWidth="2"
              className="transition-all duration-300 delay-500"
              style={{
                strokeDasharray: 40,
                strokeDashoffset: phase === 'drawing' ? 40 : 0,
              }}
            />
            
            {/* Eye */}
            <circle
              cx="42"
              cy="42"
              r="4"
              fill={phase === 'filling' ? 'currentColor' : 'none'}
              stroke="currentColor"
              strokeWidth="2"
              className="text-foreground transition-all duration-300 delay-700"
              style={{
                opacity: phase === 'drawing' ? 0 : 1,
              }}
            />
          </svg>
          
          {/* Spinning ring loader */}
          <div className="absolute inset-0 flex items-center justify-center">
            <div 
              className="w-28 h-28 border-2 border-transparent border-t-primary rounded-full animate-spin-slow"
              style={{ animationDuration: '1s' }}
            />
          </div>
        </div>
        
        {/* Loading dots */}
        <div className="flex gap-1">
          <div className="w-2 h-2 rounded-full bg-primary animate-bounce" style={{ animationDelay: '0ms' }} />
          <div className="w-2 h-2 rounded-full bg-primary animate-bounce" style={{ animationDelay: '150ms' }} />
          <div className="w-2 h-2 rounded-full bg-primary animate-bounce" style={{ animationDelay: '300ms' }} />
        </div>
      </div>

      <style>{`
        @keyframes drawLogo {
          0% {
            stroke-dashoffset: 200;
          }
          100% {
            stroke-dashoffset: 0;
          }
        }
        
        .animate-draw-logo {
          animation: drawLogo 1.2s ease-out forwards;
        }
        
        .animate-spin-slow {
          animation: spin 1s linear infinite;
        }
      `}</style>
    </div>
  );
}
