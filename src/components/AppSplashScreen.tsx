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
    const revealTimer = setTimeout(() => {
      setPhase('reveal');
    }, 1200);

    const completeTimer = setTimeout(() => {
      setPhase('done');
      onComplete?.();
    }, minDuration);

    return () => {
      clearTimeout(revealTimer);
      clearTimeout(completeTimer);
    };
  }, [onComplete, minDuration]);

  // Orbiting dots configuration
  const orbitDots = [
    { delay: 0, size: 10 },
    { delay: 0.25, size: 8 },
    { delay: 0.5, size: 6 },
    { delay: 0.75, size: 8 },
  ];

  return (
    <div className="fixed inset-0 z-[100] bg-background flex items-center justify-center">
      <div className="relative flex flex-col items-center gap-6">
        {/* Logo container with orbiting dots */}
        <div className="relative w-40 h-40 flex items-center justify-center">
          
          {/* Orbiting dots */}
          <div 
            className={`absolute inset-0 transition-opacity duration-300 ${
              phase === 'reveal' ? 'opacity-0' : 'opacity-100'
            }`}
          >
            {orbitDots.map((dot, i) => (
              <motion.div
                key={i}
                className="absolute rounded-full bg-primary"
                style={{
                  width: dot.size,
                  height: dot.size,
                  left: '50%',
                  top: '50%',
                  marginLeft: -dot.size / 2,
                  marginTop: -dot.size / 2,
                }}
                animate={{
                  x: [
                    Math.cos(0) * 60,
                    Math.cos(Math.PI / 2) * 50,
                    Math.cos(Math.PI) * 60,
                    Math.cos((3 * Math.PI) / 2) * 50,
                    Math.cos(2 * Math.PI) * 60,
                  ],
                  y: [
                    Math.sin(0) * 40,
                    Math.sin(Math.PI / 2) * 50,
                    Math.sin(Math.PI) * 40,
                    Math.sin((3 * Math.PI) / 2) * 50,
                    Math.sin(2 * Math.PI) * 40,
                  ],
                  opacity: [0.4, 1, 0.4, 1, 0.4],
                  scale: [0.8, 1.2, 0.8, 1.2, 0.8],
                }}
                transition={{
                  duration: 2,
                  delay: dot.delay,
                  repeat: Infinity,
                  ease: 'easeInOut',
                }}
              />
            ))}
          </div>

          {/* Soft glow pulse */}
          <motion.div
            className="absolute inset-0 rounded-full"
            style={{
              background: 'radial-gradient(circle, hsl(var(--primary)/0.15) 0%, transparent 70%)',
            }}
            animate={{
              scale: [1, 1.3, 1],
              opacity: [0.5, 0.8, 0.5],
            }}
            transition={{
              duration: 2,
              repeat: Infinity,
              ease: 'easeInOut',
            }}
          />

          {/* The actual logo */}
          <motion.img 
            src={crooLogo} 
            alt="Croo" 
            className="w-24 h-24 object-contain relative z-10"
            initial={{ opacity: 0.6, scale: 0.9 }}
            animate={phase === 'reveal' ? {
              opacity: 1,
              scale: 1,
            } : {
              opacity: [0.6, 0.8, 0.6],
              scale: [0.9, 0.95, 0.9],
            }}
            transition={phase === 'reveal' ? {
              duration: 0.4,
              ease: 'easeOut',
            } : {
              duration: 2,
              repeat: Infinity,
              ease: 'easeInOut',
            }}
          />
        </div>
        
        {/* Subtle loading text */}
        <motion.div 
          className={`flex items-center gap-1 text-muted-foreground text-sm transition-opacity duration-300 ${
            phase === 'reveal' ? 'opacity-0' : 'opacity-100'
          }`}
          initial={{ opacity: 0 }}
          animate={{ opacity: phase === 'loading' ? 0.7 : 0 }}
          transition={{ delay: 0.3 }}
        >
          <span>Loading</span>
          <motion.span
            animate={{ opacity: [0, 1, 0] }}
            transition={{ duration: 1.5, repeat: Infinity }}
          >
            ...
          </motion.span>
        </motion.div>
      </div>
    </div>
  );
}
