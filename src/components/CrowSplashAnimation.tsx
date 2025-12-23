import React, { useEffect, useState } from 'react';
import crooLogo from '@/assets/croo-logo.png';

const CrowSplashAnimation: React.FC<{ onComplete: () => void }> = ({ onComplete }) => {
  const [fadeOut, setFadeOut] = useState(false);
  const [showWelcome, setShowWelcome] = useState(false);

  useEffect(() => {
    const welcomeTimer = setTimeout(() => setShowWelcome(true), 200);
    const fadeTimer = setTimeout(() => setFadeOut(true), 1500);
    const completeTimer = setTimeout(() => onComplete(), 2000);
    
    return () => {
      clearTimeout(welcomeTimer);
      clearTimeout(fadeTimer);
      clearTimeout(completeTimer);
    };
  }, [onComplete]);

  return (
    <div 
      className={`fixed inset-0 z-50 flex flex-col items-center justify-center overflow-hidden transition-opacity duration-500 ${
        fadeOut ? 'opacity-0' : 'opacity-100'
      }`}
      style={{
        background: 'linear-gradient(135deg, #ff6b35 0%, #f7931e 30%, #fbb034 60%, #ffdd00 100%)'
      }}
    >
      {/* Logo */}
      <div className="animate-fade-in">
        <img 
          src={crooLogo} 
          alt="Croo Logo" 
          className="h-28 w-auto drop-shadow-lg"
        />
      </div>

      {/* Welcome text */}
      <div 
        className={`mt-4 transition-all duration-700 ${
          showWelcome 
            ? 'opacity-100 translate-y-0' 
            : 'opacity-0 translate-y-4'
        }`}
      >
        <span 
          className="font-pacifico text-5xl md:text-6xl text-[#1a1a1a] drop-shadow-md"
        >
          welcome
        </span>
      </div>
    </div>
  );
};

export default CrowSplashAnimation;
