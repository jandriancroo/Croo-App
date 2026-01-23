import { useEffect, useState } from 'react';
import { motion } from 'framer-motion';
import crooLogo from '@/assets/croo-logo.png';

interface AppSplashScreenProps {
  onComplete?: () => void;
  minDuration?: number;
}

export function AppSplashScreen({ onComplete, minDuration = 1800 }: AppSplashScreenProps) {
  const [phase, setPhase] = useState<'loading' | 'exit' | 'done'>('loading');

  useEffect(() => {
    const exitTimer = setTimeout(() => setPhase('exit'), minDuration - 600);
    const completeTimer = setTimeout(() => {
      setPhase('done');
      onComplete?.();
    }, minDuration + 200); // Give extra time for disperse animation

    return () => {
      clearTimeout(exitTimer);
      clearTimeout(completeTimer);
    };
  }, [onComplete, minDuration]);

  // Dots with disperse directions
  const dots = [
    { color: 'hsl(var(--primary))', exitX: -40, exitY: -30 },
    { color: 'hsl(var(--accent))', exitX: -15, exitY: -40 },
    { color: 'hsl(var(--primary))', exitX: 15, exitY: -40 },
    { color: 'hsl(var(--accent))', exitX: 40, exitY: -30 },
  ];

  return (
    <motion.div 
      className="fixed inset-0 z-[100] bg-background flex items-center justify-center"
      initial={{ opacity: 1 }}
      animate={phase === 'exit' ? { opacity: 0 } : { opacity: 1 }}
      transition={{ duration: 0.5, delay: phase === 'exit' ? 0.3 : 0 }}
    >
      <div className="relative flex flex-col items-center gap-8">
        {/* Logo - slow zoom then crossfade */}
        <motion.img 
          src={crooLogo} 
          alt="Croo" 
          className="w-24 h-24 object-contain"
          style={{ willChange: 'transform, opacity' }}
          initial={{ opacity: 1, scale: 1 }}
          animate={phase === 'exit' ? {
            opacity: 0,
            scale: 1.25,
          } : {
            opacity: 1,
            scale: 1.25,
          }}
          transition={{
            duration: phase === 'exit' ? 0.4 : minDuration / 1000,
            ease: 'easeOut',
          }}
        />
        
        {/* Bouncing dots - disperse on exit */}
        <div className="flex items-center gap-2">
          {dots.map((dot, i) => (
            <motion.div
              key={i}
              className="w-3 h-3 rounded-full"
              style={{ 
                backgroundColor: dot.color,
                willChange: 'transform, opacity',
              }}
              initial={{ opacity: 1, x: 0, y: 0 }}
              animate={phase === 'exit' ? {
                opacity: 0,
                x: dot.exitX,
                y: dot.exitY,
                scale: 0,
              } : {
                y: [0, -12, 0],
                scaleY: [1, 0.8, 1],
                scaleX: [1, 1.1, 1],
              }}
              transition={phase === 'exit' ? {
                duration: 0.4,
                delay: i * 0.05,
                ease: 'easeOut',
              } : {
                duration: 0.5,
                delay: i * 0.1,
                repeat: Infinity,
                repeatDelay: 0.3,
                ease: [0.45, 0, 0.55, 1],
              }}
            />
          ))}
        </div>
      </div>
    </motion.div>
  );
}
