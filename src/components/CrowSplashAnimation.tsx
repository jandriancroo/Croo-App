import React, { useEffect, useState } from 'react';
import { motion } from 'framer-motion';
import crooLogo from '@/assets/croo-logo.webp';

interface CrowSplashAnimationProps {
  onComplete: () => void;
}

const CrowSplashAnimation: React.FC<CrowSplashAnimationProps> = ({ onComplete }) => {
  const [phase, setPhase] = useState<'loading' | 'welcome' | 'exit'>('loading');

  const loadingDuration = 1000;

  useEffect(() => {
    const welcomeTimer = setTimeout(() => setPhase('welcome'), loadingDuration);
    const exitTimer = setTimeout(() => setPhase('exit'), loadingDuration + 800);
    const completeTimer = setTimeout(() => onComplete(), loadingDuration + 1300);
    
    return () => {
      clearTimeout(welcomeTimer);
      clearTimeout(exitTimer);
      clearTimeout(completeTimer);
    };
  }, [onComplete]);

  // Dots with disperse directions - pre-calculated
  const dots = [
    { color: 'hsl(var(--primary))', exitX: -40, exitY: -30 },
    { color: 'hsl(var(--accent))', exitX: -15, exitY: -40 },
    { color: 'hsl(var(--primary))', exitX: 15, exitY: -40 },
    { color: 'hsl(var(--accent))', exitX: 40, exitY: -30 },
  ];

  return (
    <motion.div 
      className="fixed inset-0 z-50 flex flex-col items-center justify-center overflow-hidden bg-background"
      style={{ 
        willChange: 'opacity',
        contain: 'layout style paint',
      }}
      initial={{ opacity: 1 }}
      animate={{ opacity: phase === 'exit' ? 0 : 1 }}
      transition={{ 
        duration: 0.4, 
        ease: 'linear',
      }}
    >
      <div 
        className="relative flex flex-col items-center gap-8"
        style={{ contain: 'layout style' }}
      >
        {/* Logo - GPU accelerated with slow zoom */}
        <motion.img 
          src={crooLogo} 
          alt="Logo" 
          className="h-28 w-auto"
          style={{ 
            willChange: 'transform, opacity',
            transform: 'translateZ(0)',
            backfaceVisibility: 'hidden',
          }}
          initial={{ opacity: 1, scale: 1 }}
          animate={{
            opacity: phase === 'loading' ? 1 : 0,
            scale: 1.25,
          }}
          transition={{
            opacity: { duration: 0.3, ease: 'linear' },
            scale: { 
              duration: loadingDuration / 1000,
              ease: [0.25, 0.1, 0.25, 1],
            },
          }}
        />
        
        {/* Bouncing dots - GPU layers */}
        <motion.div 
          className="flex items-center gap-2"
          style={{ willChange: 'opacity' }}
          initial={{ opacity: 1 }}
          animate={{ opacity: phase !== 'loading' ? 0 : 1 }}
          transition={{ duration: 0.2, ease: 'linear' }}
        >
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
              initial={{ x: 0, y: 0, scale: 1 }}
              animate={phase !== 'loading' ? {
                x: dot.exitX,
                y: dot.exitY,
                scale: 0,
                opacity: 0,
              } : {
                y: [0, -12, 0],
                scale: [1, 0.9, 1],
              }}
              transition={phase !== 'loading' ? {
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
        </motion.div>

        {/* Welcome text - GPU accelerated */}
        <motion.div 
          className="absolute inset-0 flex items-center justify-center"
          style={{ 
            willChange: 'transform, opacity',
            transform: 'translateZ(0)',
            backfaceVisibility: 'hidden',
          }}
          initial={{ opacity: 0, scale: 0.9 }}
          animate={phase !== 'loading' ? { 
            opacity: 1, 
            scale: 1,
          } : {
            opacity: 0,
            scale: 0.9,
          }}
          transition={{ 
            duration: 0.4, 
            ease: [0.25, 0.1, 0.25, 1],
          }}
        >
          <span className="font-pacifico text-5xl md:text-6xl text-primary drop-shadow-sm">
            welcome
          </span>
        </motion.div>
      </div>
    </motion.div>
  );
};

export default CrowSplashAnimation;
