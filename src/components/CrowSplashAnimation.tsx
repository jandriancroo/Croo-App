import React, { useEffect, useState } from 'react';
import { motion } from 'framer-motion';
import crooLogo from '@/assets/croo-logo.png';

interface CrowSplashAnimationProps {
  onComplete: () => void;
}

const CrowSplashAnimation: React.FC<CrowSplashAnimationProps> = ({ onComplete }) => {
  const [phase, setPhase] = useState<'loading' | 'welcome' | 'exit'>('loading');

  useEffect(() => {
    const welcomeTimer = setTimeout(() => setPhase('welcome'), 800);
    const exitTimer = setTimeout(() => setPhase('exit'), 1600);
    const completeTimer = setTimeout(() => onComplete(), 2000);
    
    return () => {
      clearTimeout(welcomeTimer);
      clearTimeout(exitTimer);
      clearTimeout(completeTimer);
    };
  }, [onComplete]);

  // Google-style bouncing dots with brand colors
  const dots = [
    { color: 'hsl(var(--primary))' },
    { color: 'hsl(var(--accent))' },
    { color: 'hsl(var(--primary))' },
    { color: 'hsl(var(--accent))' },
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
        {/* Logo with breathing zoom while loading */}
        <motion.img 
          src={crooLogo} 
          alt="Logo" 
          className="h-28 w-auto"
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
        
        {/* Bouncing dots - fade out when welcome appears */}
        <div 
          className={`flex items-center gap-2 transition-opacity duration-300 ${
            phase !== 'loading' ? 'opacity-0' : 'opacity-100'
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
                ease: [0.45, 0, 0.55, 1],
              }}
            />
          ))}
        </div>

        {/* Welcome text - appears after dots */}
        <motion.div 
          className="absolute -bottom-4"
          style={{ willChange: 'transform, opacity' }}
          initial={{ opacity: 0, y: 10, scale: 0.95 }}
          animate={phase !== 'loading' ? { 
            opacity: 1, 
            y: 0, 
            scale: 1,
          } : {
            opacity: 0,
            y: 10,
            scale: 0.95,
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
