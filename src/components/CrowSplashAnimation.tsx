import React, { useEffect, useState } from 'react';

interface CrowProps {
  delay: number;
  startX: number;
  startY: number;
  endX: number;
  endY: number;
}

const Crow: React.FC<CrowProps> = ({ delay, startX, startY, endX, endY }) => {
  return (
    <div
      className="absolute text-2xl animate-fly-crow"
      style={{
        '--start-x': `${startX}vw`,
        '--start-y': `${startY}vh`,
        '--end-x': `${endX}vw`,
        '--end-y': `${endY}vh`,
        animationDelay: `${delay}ms`,
      } as React.CSSProperties}
    >
      <svg
        width="24"
        height="24"
        viewBox="0 0 24 24"
        fill="currentColor"
        className="text-foreground animate-flap"
        style={{ animationDelay: `${delay}ms` }}
      >
        <path d="M12 4C8 4 4 8 4 12C4 14 5 16 7 17.5L6 20L9 19C10 19.5 11 20 12 20C16 20 20 16 20 12C20 8 16 4 12 4Z" />
        <path d="M2 8L6 10L4 6L2 8Z" className="origin-right animate-wing-left" />
        <path d="M22 8L18 10L20 6L22 8Z" className="origin-left animate-wing-right" />
      </svg>
    </div>
  );
};

// Positions for crows to spell "hello" - simplified pattern
const helloPattern = [
  // H
  { endX: 15, endY: 35 }, { endX: 15, endY: 42 }, { endX: 15, endY: 50 },
  { endX: 20, endY: 42 },
  { endX: 25, endY: 35 }, { endX: 25, endY: 42 }, { endX: 25, endY: 50 },
  // E
  { endX: 32, endY: 35 }, { endX: 37, endY: 35 },
  { endX: 32, endY: 42 }, { endX: 36, endY: 42 },
  { endX: 32, endY: 50 }, { endX: 37, endY: 50 },
  // L
  { endX: 44, endY: 35 }, { endX: 44, endY: 42 }, { endX: 44, endY: 50 },
  { endX: 49, endY: 50 },
  // L
  { endX: 56, endY: 35 }, { endX: 56, endY: 42 }, { endX: 56, endY: 50 },
  { endX: 61, endY: 50 },
  // O
  { endX: 70, endY: 35 }, { endX: 75, endY: 37 },
  { endX: 68, endY: 42 }, { endX: 77, endY: 42 },
  { endX: 70, endY: 50 }, { endX: 75, endY: 48 },
];

const CrowSplashAnimation: React.FC<{ onComplete: () => void }> = ({ onComplete }) => {
  const [fadeOut, setFadeOut] = useState(false);

  useEffect(() => {
    const fadeTimer = setTimeout(() => setFadeOut(true), 2200);
    const completeTimer = setTimeout(() => onComplete(), 2800);
    
    return () => {
      clearTimeout(fadeTimer);
      clearTimeout(completeTimer);
    };
  }, [onComplete]);

  return (
    <div 
      className={`fixed inset-0 z-50 bg-background flex items-center justify-center overflow-hidden transition-opacity duration-500 ${
        fadeOut ? 'opacity-0' : 'opacity-100'
      }`}
    >
      {helloPattern.map((pos, index) => (
        <Crow
          key={index}
          delay={index * 50}
          startX={Math.random() > 0.5 ? -10 : 110}
          startY={Math.random() * 100}
          endX={pos.endX}
          endY={pos.endY}
        />
      ))}
    </div>
  );
};

export default CrowSplashAnimation;
