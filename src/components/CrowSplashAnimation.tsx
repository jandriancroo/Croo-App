import React, { useEffect, useState } from 'react';
import { motion } from 'framer-motion';
import crooLogo from '@/assets/croo-logo.png';

interface CrowSplashAnimationProps {
  onComplete: () => void;
}

const CrowSplashAnimation: React.FC<CrowSplashAnimationProps> = ({ onComplete }) => {
  const [phase, setPhase] = useState<'morphing' | 'welcome' | 'exit'>('morphing');

  useEffect(() => {
    const welcomeTimer = setTimeout(() => setPhase('welcome'), 600);
    const exitTimer = setTimeout(() => setPhase('exit'), 1400);
    const completeTimer = setTimeout(() => onComplete(), 1900);
    
    return () => {
      clearTimeout(welcomeTimer);
      clearTimeout(exitTimer);
      clearTimeout(completeTimer);
    };
  }, [onComplete]);

  return (
    <motion.div 
      className="fixed inset-0 z-50 flex flex-col items-center justify-center overflow-hidden"
      style={{
        background: 'linear-gradient(135deg, hsl(var(--primary)) 0%, hsl(var(--primary)/0.8) 50%, hsl(var(--accent)) 100%)'
      }}
      initial={{ opacity: 1 }}
      animate={phase === 'exit' ? { 
        opacity: 0,
        scale: 1.1,
      } : { opacity: 1 }}
      transition={{ duration: 0.5, ease: 'easeInOut' }}
    >
      {/* Ripple effects */}
      <div className="absolute inset-0 flex items-center justify-center pointer-events-none">
        {[...Array(3)].map((_, i) => (
          <motion.div
            key={i}
            className="absolute rounded-full border-2 border-primary-foreground/20"
            initial={{ width: 80, height: 80, opacity: 0 }}
            animate={{ 
              width: [80, 400, 600],
              height: [80, 400, 600],
              opacity: [0, 0.4, 0],
            }}
            transition={{
              duration: 2,
              delay: i * 0.3,
              repeat: Infinity,
              ease: 'easeOut',
            }}
          />
        ))}
      </div>

      {/* Liquid blob morphing into logo */}
      <motion.div
        className="relative z-10"
        initial={{ scale: 0.3, opacity: 0 }}
        animate={{ 
          scale: phase === 'morphing' ? [0.3, 1.15, 1] : 1,
          opacity: 1,
        }}
        transition={{ 
          duration: 0.6, 
          ease: [0.34, 1.56, 0.64, 1], // Bouncy spring
        }}
      >
        {/* Glow behind logo */}
        <motion.div
          className="absolute inset-0 blur-2xl"
          style={{
            background: 'radial-gradient(circle, hsl(var(--primary-foreground)/0.3) 0%, transparent 70%)',
          }}
          initial={{ scale: 0.5, opacity: 0 }}
          animate={{ scale: 1.5, opacity: 1 }}
          transition={{ duration: 0.8, delay: 0.2 }}
        />
        
        {/* Logo */}
        <motion.img 
          src={crooLogo} 
          alt="Logo" 
          className="h-28 w-auto drop-shadow-lg relative z-10"
          initial={{ filter: 'blur(20px)' }}
          animate={{ filter: 'blur(0px)' }}
          transition={{ duration: 0.4, delay: 0.2 }}
        />
      </motion.div>

      {/* Welcome text */}
      <motion.div 
        className="mt-6 relative z-10"
        initial={{ opacity: 0, y: 20, scale: 0.9 }}
        animate={phase !== 'morphing' ? { 
          opacity: 1, 
          y: 0, 
          scale: 1,
        } : {}}
        transition={{ duration: 0.4, ease: 'easeOut' }}
      >
        <span 
          className="font-pacifico text-5xl md:text-6xl text-primary-foreground drop-shadow-md"
        >
          welcome
        </span>
      </motion.div>
    </motion.div>
  );
};

export default CrowSplashAnimation;
