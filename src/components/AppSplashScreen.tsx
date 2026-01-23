import { useEffect, useState } from 'react';
import { motion } from 'framer-motion';
import crooLogo from '@/assets/croo-logo.png';

interface AppSplashScreenProps {
  onComplete?: () => void;
  minDuration?: number;
}

export function AppSplashScreen({ onComplete, minDuration = 1800 }: AppSplashScreenProps) {
  const [phase, setPhase] = useState<'loading' | 'reveal' | 'done'>('loading');

  useEffect(() => {
    const revealTimer = setTimeout(() => setPhase('reveal'), 1200);
    const completeTimer = setTimeout(() => {
      setPhase('done');
      onComplete?.();
    }, minDuration);

    return () => {
      clearTimeout(revealTimer);
      clearTimeout(completeTimer);
    };
  }, [onComplete, minDuration]);

  // Google-style bouncing dots with brand colors
  const dots = [
    { color: 'hsl(var(--primary))' },
    { color: 'hsl(var(--accent))' },
    { color: 'hsl(var(--primary))' },
    { color: 'hsl(var(--accent))' },
  ];

  return (
    <div className="fixed inset-0 z-[100] bg-background flex items-center justify-center">
      <div className="relative flex flex-col items-center gap-8">
        {/* Logo with breathing zoom while loading */}
        <motion.img 
          src={crooLogo} 
          alt="Croo" 
          className="w-24 h-24 object-contain"
          style={{ willChange: 'transform, opacity' }}
          initial={{ opacity: 0, scale: 0.6 }}
          animate={phase === 'loading' ? {
            opacity: 1,
            scale: [0.9, 1.08, 0.9],
          } : {
            opacity: 1,
            scale: 1,
          }}
          transition={phase === 'loading' ? {
            opacity: { duration: 0.3 },
            scale: {
              duration: 1.2,
              repeat: Infinity,
              ease: 'easeInOut',
            },
          } : {
            duration: 0.3,
            ease: 'easeOut',
          }}
        />
        
        {/* Google-style bouncing dots */}
        <div 
          className={`flex items-center gap-2 transition-opacity duration-300 ${
            phase === 'reveal' ? 'opacity-0' : 'opacity-100'
          }`}
          style={{ willChange: 'opacity' }}
        >
          {dots.map((dot, i) => (
            <motion.div
              key={i}
              className="w-3 h-3 rounded-full"
              style={{ 
                backgroundColor: dot.color,
                willChange: 'transform',
              }}
              animate={{
                y: [0, -12, 0],
                scaleY: [1, 0.8, 1],
                scaleX: [1, 1.1, 1],
              }}
              transition={{
                duration: 0.5,
                delay: i * 0.1,
                repeat: Infinity,
                repeatDelay: 0.3,
                ease: [0.45, 0, 0.55, 1], // Custom ease for snappy bounce
              }}
            />
          ))}
        </div>
      </div>
    </div>
  );
}
