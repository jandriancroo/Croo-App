import React, { useEffect, useState } from 'react';

const CrowSplashAnimation: React.FC<{ onComplete: () => void }> = ({ onComplete }) => {
  const [fadeOut, setFadeOut] = useState(false);
  const [progress, setProgress] = useState(0);

  useEffect(() => {
    // Animate progress from 0 to 100
    const startTime = Date.now();
    const duration = 2000; // 2 seconds to draw
    
    const animate = () => {
      const elapsed = Date.now() - startTime;
      const newProgress = Math.min(100, (elapsed / duration) * 100);
      setProgress(newProgress);
      
      if (elapsed < duration) {
        requestAnimationFrame(animate);
      }
    };
    
    requestAnimationFrame(animate);
    
    const fadeTimer = setTimeout(() => setFadeOut(true), 2500);
    const completeTimer = setTimeout(() => onComplete(), 3000);
    
    return () => {
      clearTimeout(fadeTimer);
      clearTimeout(completeTimer);
    };
  }, [onComplete]);

  // SVG path for "welcome" in cursive
  const welcomePath = "M 30,60 Q 35,40 40,60 Q 45,80 50,60 Q 55,40 60,60 L 65,60 Q 70,40 80,60 Q 85,80 90,40 L 95,60 Q 100,80 105,60 Q 110,40 115,55 Q 118,60 120,55 Q 125,45 135,60 Q 140,70 145,60 Q 150,50 155,60 L 160,40 L 160,80 Q 165,60 175,60 Q 185,60 185,50 Q 185,40 175,40 Q 165,40 165,50 Q 165,60 175,65 L 195,60 Q 200,40 205,60 Q 210,80 215,60 Q 218,50 225,55 Q 230,60 235,50 Q 240,40 250,60 Q 255,70 260,60 Q 265,50 270,60";
  
  const pathLength = 800;
  const dashOffset = pathLength - (progress / 100) * pathLength;

  return (
    <div 
      className={`fixed inset-0 z-50 flex items-center justify-center overflow-hidden transition-opacity duration-500 ${
        fadeOut ? 'opacity-0' : 'opacity-100'
      }`}
      style={{
        background: 'linear-gradient(135deg, #ff6b35 0%, #f7931e 30%, #fbb034 60%, #ffdd00 100%)'
      }}
    >
      {/* The welcome text being drawn */}
      <svg 
        viewBox="0 0 300 120" 
        className="w-[90vw] max-w-[500px] h-auto"
        style={{ overflow: 'visible' }}
      >
        {/* Shadow/glow effect */}
        <path
          d={welcomePath}
          fill="none"
          stroke="rgba(0,0,0,0.2)"
          strokeWidth="6"
          strokeLinecap="round"
          strokeLinejoin="round"
          strokeDasharray={pathLength}
          strokeDashoffset={dashOffset}
          style={{ filter: 'blur(4px)' }}
        />
        
        {/* Main stroke */}
        <path
          d={welcomePath}
          fill="none"
          stroke="#1a1a1a"
          strokeWidth="4"
          strokeLinecap="round"
          strokeLinejoin="round"
          strokeDasharray={pathLength}
          strokeDashoffset={dashOffset}
        />
        
        {/* Crow at the tip of the brush */}
        {progress < 100 && (
          <g 
            style={{
              transform: `translateX(${30 + (progress / 100) * 240}px) translateY(${55 + Math.sin(progress * 0.1) * 10}px)`,
            }}
          >
            {/* Bird body */}
            <ellipse cx="0" cy="0" rx="8" ry="5" fill="#1a1a1a" />
            {/* Head */}
            <circle cx="6" cy="-2" r="4" fill="#1a1a1a" />
            {/* Beak */}
            <path d="M 9,-2 L 14,-3 L 9,-1 Z" fill="#1a1a1a" />
            {/* Wing up */}
            <path 
              d="M -2,0 Q -8,-8 -12,-4" 
              stroke="#1a1a1a" 
              strokeWidth="3" 
              fill="none"
              style={{
                transform: `rotate(${Math.sin(Date.now() * 0.02) * 20}deg)`,
                transformOrigin: '-2px 0'
              }}
            />
            {/* Wing down */}
            <path 
              d="M -2,0 Q -8,8 -12,4" 
              stroke="#1a1a1a" 
              strokeWidth="3" 
              fill="none"
              style={{
                transform: `rotate(${-Math.sin(Date.now() * 0.02) * 20}deg)`,
                transformOrigin: '-2px 0'
              }}
            />
            {/* Tail feathers */}
            <path d="M -8,0 L -14,2 M -8,0 L -14,0 M -8,0 L -14,-2" stroke="#1a1a1a" strokeWidth="2" />
          </g>
        )}
      </svg>

      {/* Trail of small crows following behind */}
      {[...Array(6)].map((_, i) => {
        const crowProgress = Math.max(0, progress - (i + 1) * 8);
        const x = 30 + (crowProgress / 100) * 240;
        const y = 55 + Math.sin(crowProgress * 0.15 + i) * 15;
        const opacity = crowProgress > 0 ? Math.min(1, (100 - crowProgress) / 30) : 0;
        
        return (
          <div
            key={i}
            className="absolute pointer-events-none"
            style={{
              left: '50%',
              top: '50%',
              transform: `translate(calc(-50% + ${(x - 150) * 1.5}px), calc(-50% + ${(y - 60) * 1.5}px))`,
              opacity: opacity * 0.6,
            }}
          >
            <svg width="20" height="20" viewBox="-10 -10 20 20">
              <ellipse cx="0" cy="0" rx="5" ry="3" fill="#1a1a1a" />
              <circle cx="4" cy="-1" r="2" fill="#1a1a1a" />
              <path d="M -3,0 Q -6,-4 -8,-2" stroke="#1a1a1a" strokeWidth="1.5" fill="none" />
              <path d="M -3,0 Q -6,4 -8,2" stroke="#1a1a1a" strokeWidth="1.5" fill="none" />
            </svg>
          </div>
        );
      })}
    </div>
  );
};

export default CrowSplashAnimation;
