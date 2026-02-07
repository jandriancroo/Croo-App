import { useEffect, useState } from 'react';
import { motion } from 'framer-motion';
import crooLogo from '@/assets/croo-logo.webp';

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
    }, minDuration + 200);

    return () => {
      clearTimeout(exitTimer);
      clearTimeout(completeTimer);
    };
  }, [onComplete, minDuration]);

  // Dots with disperse directions - pre-calculated for GPU
  const dots = [
    { color: 'hsl(var(--primary))', exitX: -40, exitY: -30 },
    { color: 'hsl(var(--accent))', exitX: -15, exitY: -40 },
    { color: 'hsl(var(--primary))', exitX: 15, exitY: -40 },
    { color: 'hsl(var(--accent))', exitX: 40, exitY: -30 },
  ];

  return (
    <motion.div 
      className="fixed inset-0 z-[100] bg-background flex items-center justify-center"
      style={{ 
        willChange: 'opacity',
        contain: 'layout style paint',
      }}
      initial={{ opacity: 1 }}
      animate={{ opacity: phase === 'exit' ? 0 : 1 }}
      transition={{ 
        duration: 0.5, 
        delay: phase === 'exit' ? 0.3 : 0,
        ease: 'linear', // Linear is smoothest for opacity
      }}
    >
      <div 
        className="relative flex flex-col items-center gap-8"
        style={{ contain: 'layout style' }}
      >
        {/* Logo - GPU layer with transform3d */}
        <motion.img 
          src={crooLogo} 
          alt="Croo" 
          className="w-24 h-24 object-contain"
          style={{ 
            willChange: 'transform, opacity',
            transform: 'translateZ(0)', // Force GPU layer
            backfaceVisibility: 'hidden',
          }}
          initial={{ opacity: 1, scale: 1 }}
          animate={{
            opacity: phase === 'exit' ? 0 : 1,
            scale: 1.25,
          }}
          transition={{
            opacity: { duration: 0.4, ease: 'linear' },
            scale: { 
              duration: phase === 'exit' ? 0.4 : minDuration / 1000,
              ease: [0.25, 0.1, 0.25, 1], // CSS ease equivalent - very smooth
            },
          }}
        />
        
        {/* Bouncing dots - each on its own GPU layer */}
        <div className="flex items-center gap-2">
          {dots.map((dot, i) => (
            <motion.div
              key={i}
              className="w-3 h-3 rounded-full"
              style={{ 
                backgroundColor: dot.color,
                willChange: 'transform, opacity',
                transform: 'translateZ(0)',
                backfaceVisibility: 'hidden',
              }}
              initial={{ opacity: 1, x: 0, y: 0, scale: 1 }}
              animate={phase === 'exit' ? {
                opacity: 0,
                x: dot.exitX,
                y: dot.exitY,
                scale: 0,
              } : {
                y: [0, -12, 0],
                scale: [1, 0.9, 1],
              }}
              transition={phase === 'exit' ? {
                duration: 0.4,
                delay: i * 0.05,
                ease: [0.25, 0.1, 0.25, 1],
              } : {
                duration: 0.6,
                delay: i * 0.1,
                repeat: Infinity,
                repeatDelay: 0.2,
                ease: [0.45, 0, 0.55, 1],
              }}
            />
          ))}
        </div>
      </div>
    </motion.div>
  );
}
