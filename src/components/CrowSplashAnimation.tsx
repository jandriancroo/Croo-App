import React, { useEffect, useState } from 'react';
import crooLogo from '@/assets/croo-logo.png';

interface CrowSplashAnimationProps {
  onComplete: () => void;
}

const CrowSplashAnimation: React.FC<CrowSplashAnimationProps> = ({ onComplete }) => {
  const [fadeOut, setFadeOut] = useState(false);
  const [showWelcome, setShowWelcome] = useState(false);

  useEffect(() => {
    const welcomeTimer = setTimeout(() => setShowWelcome(true), 100);
    const fadeTimer = setTimeout(() => setFadeOut(true), 1200);
    const completeTimer = setTimeout(() => onComplete(), 1700);
    
    return () => {
      clearTimeout(welcomeTimer);
      clearTimeout(fadeTimer);
      clearTimeout(completeTimer);
    };
  }, [onComplete]);

  return (
    <div 
      className={`fixed inset-0 z-50 flex flex-col items-center justify-center overflow-hidden transition-all duration-500 ease-out ${
        fadeOut ? '-translate-y-full opacity-0' : 'translate-y-0 opacity-100'
      }`}
      style={{
        background: 'linear-gradient(135deg, hsl(var(--primary)) 0%, hsl(var(--primary)/0.8) 50%, hsl(var(--accent)) 100%)'
      }}
    >
      {/* Logo */}
      <div className="animate-fade-in">
        <img 
          src={crooLogo} 
          alt="Logo" 
          className="h-28 w-auto drop-shadow-lg"
        />
      </div>

      {/* Welcome text */}
      <div 
        className={`mt-4 transition-all duration-400 ${
          showWelcome 
            ? 'opacity-100 translate-y-0' 
            : 'opacity-0 translate-y-4'
        }`}
      >
        <span 
          className="font-pacifico text-5xl md:text-6xl text-primary-foreground drop-shadow-md"
        >
          welcome
        </span>
      </div>
    </div>
  );
};

export default CrowSplashAnimation;
