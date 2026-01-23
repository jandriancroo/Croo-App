import React, { useEffect, useState } from 'react';
import { motion } from 'framer-motion';
import crooLogo from '@/assets/croo-logo.png';

interface CrowSplashAnimationProps {
  onComplete: () => void;
}

const CrowSplashAnimation: React.FC<CrowSplashAnimationProps> = ({ onComplete }) => {
  const [phase, setPhase] = useState<'loading' | 'welcome' | 'exit'>('loading');

  const loadingDuration = 1000; // How long the loading phase lasts

  useEffect(() => {
    const welcomeTimer = setTimeout(() => setPhase('welcome'), loadingDuration);
    const exitTimer = setTimeout(() => setPhase('exit'), loadingDuration + 600);
    const completeTimer = setTimeout(() => onComplete(), loadingDuration + 1000);
    
    return () => {
      clearTimeout(welcomeTimer);
      clearTimeout(exitTimer);
      clearTimeout(completeTimer);
    };
  }, [onComplete]);

  // Dots with disperse directions
  const dots = [
    { color: 'hsl(var(--primary))', exitX: -40, exitY: -30 },
    { color: 'hsl(var(--accent))', exitX: -15, exitY: -40 },
    { color: 'hsl(var(--primary))', exitX: 15, exitY: -40 },
    { color: 'hsl(var(--accent))', exitX: 40, exitY: -30 },
  ];

  return (
    <motion.div 
      className="fixed inset-0 z-50 flex flex-col items-center justify-center overflow-hidden bg-background"
      style={{ willChange: 'opacity' }}
      initial={{ opacity: 1 }}
      animate={phase === 'exit' ? { opacity: 0 } : { opacity: 1 }}
      transition={{ duration: 0.4, ease: 'easeOut' }}
    >
      <div className="relative flex flex-col items-center gap-8">
        {/* Logo - slow zoom then crossfade when welcome appears */}
        <motion.img 
          src={crooLogo} 
          alt="Logo" 
          className="h-28 w-auto"
          style={{ willChange: 'transform, opacity' }}
          initial={{ opacity: 1, scale: 1 }}
          animate={phase === 'loading' ? {
            opacity: 1,
            scale: 1.25,
          } : {
            opacity: 0,
            scale: 1.25,
          }}
          transition={{
            duration: phase === 'loading' ? loadingDuration / 1000 : 0.3,
            ease: 'easeOut',
          }}
        />
        
        {/* Bouncing dots - disperse when welcome appears */}
        <motion.div 
          className="flex items-center gap-2"
          initial={{ opacity: 1 }}
          animate={phase !== 'loading' ? { opacity: 0 } : { opacity: 1 }}
          transition={{ duration: 0.2 }}
        >
          {dots.map((dot, i) => (
            <motion.div
              key={i}
              className="w-3 h-3 rounded-full"
              style={{ 
                backgroundColor: dot.color,
                willChange: 'transform, opacity',
              }}
              initial={{ x: 0, y: 0 }}
              animate={phase !== 'loading' ? {
                x: dot.exitX,
                y: dot.exitY,
                scale: 0,
                opacity: 0,
              } : {
                y: [0, -12, 0],
                scaleY: [1, 0.8, 1],
                scaleX: [1, 1.1, 1],
              }}
              transition={phase !== 'loading' ? {
                duration: 0.25,
                delay: i * 0.02,
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
        </motion.div>

        {/* Welcome text - appears after logo/dots fade */}
        <motion.div 
          className="absolute inset-0 flex items-center justify-center"
          style={{ willChange: 'transform, opacity' }}
          initial={{ opacity: 0, scale: 0.9 }}
          animate={phase !== 'loading' ? { 
            opacity: 1, 
            scale: 1,
          } : {
            opacity: 0,
            scale: 0.9,
          }}
          transition={{ duration: 0.4, ease: 'easeOut' }}
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
