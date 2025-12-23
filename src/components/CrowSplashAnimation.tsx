import React, { useEffect, useState } from 'react';

const CrowSplashAnimation: React.FC<{ onComplete: () => void }> = ({ onComplete }) => {
  const [fadeOut, setFadeOut] = useState(false);
  const [showText, setShowText] = useState(false);

  useEffect(() => {
    // Small delay before starting text animation
    const textTimer = setTimeout(() => setShowText(true), 200);
    const fadeTimer = setTimeout(() => setFadeOut(true), 2500);
    const completeTimer = setTimeout(() => onComplete(), 3000);
    
    return () => {
      clearTimeout(textTimer);
      clearTimeout(fadeTimer);
      clearTimeout(completeTimer);
    };
  }, [onComplete]);

  return (
    <div 
      className={`fixed inset-0 z-50 flex items-center justify-center overflow-hidden transition-opacity duration-500 ${
        fadeOut ? 'opacity-0' : 'opacity-100'
      }`}
      style={{
        background: 'linear-gradient(135deg, #ff6b35 0%, #f7931e 30%, #fbb034 60%, #ffdd00 100%)'
      }}
    >
      {/* Flying crows in background */}
      <div className="absolute inset-0 overflow-hidden">
        {[...Array(8)].map((_, i) => (
          <div
            key={i}
            className="absolute animate-fly-across"
            style={{
              top: `${15 + (i * 10)}%`,
              animationDelay: `${i * 0.15}s`,
              animationDuration: '2s',
            }}
          >
            <svg
              width="32"
              height="32"
              viewBox="0 0 24 24"
              fill="currentColor"
              className="text-black/80"
            >
              {/* Bird body */}
              <ellipse cx="12" cy="12" rx="4" ry="2.5" />
              {/* Head */}
              <circle cx="16" cy="11" r="1.5" />
              {/* Beak */}
              <path d="M17.5 11 L20 10.5 L17.5 11.5 Z" />
              {/* Wings */}
              <path 
                d="M8 12 Q4 8, 2 10 Q6 10, 8 12" 
                className="origin-right"
                style={{
                  animation: 'flapWing 0.2s ease-in-out infinite alternate'
                }}
              />
              <path 
                d="M8 12 Q4 16, 2 14 Q6 14, 8 12" 
                className="origin-right"
                style={{
                  animation: 'flapWing 0.2s ease-in-out infinite alternate-reverse'
                }}
              />
              {/* Tail */}
              <path d="M8 12 L4 13 L4 11 Z" />
            </svg>
          </div>
        ))}
      </div>

      {/* Hello text with handwritten animation */}
      <div className={`relative z-10 transition-all duration-700 ${showText ? 'opacity-100 scale-100' : 'opacity-0 scale-90'}`}>
        <svg 
          viewBox="0 0 400 120" 
          className="w-[80vw] max-w-[400px] h-auto"
        >
          <text
            x="50%"
            y="50%"
            dominantBaseline="middle"
            textAnchor="middle"
            className="font-pacifico"
            style={{
              fontSize: '72px',
              fill: 'none',
              stroke: '#1a1a1a',
              strokeWidth: '2',
              strokeDasharray: '500',
              strokeDashoffset: showText ? '0' : '500',
              transition: 'stroke-dashoffset 1.5s ease-out',
            }}
          >
            hello
          </text>
          <text
            x="50%"
            y="50%"
            dominantBaseline="middle"
            textAnchor="middle"
            className="font-pacifico"
            style={{
              fontSize: '72px',
              fill: '#1a1a1a',
              opacity: showText ? 1 : 0,
              transition: 'opacity 0.5s ease-out 1s',
            }}
          >
            hello
          </text>
        </svg>
      </div>

      {/* Additional floating crows */}
      <div className="absolute inset-0 pointer-events-none">
        {[...Array(5)].map((_, i) => (
          <div
            key={`float-${i}`}
            className="absolute"
            style={{
              left: `${20 + i * 15}%`,
              top: `${60 + (i % 3) * 10}%`,
              animation: `floatCrow ${2 + i * 0.3}s ease-in-out infinite`,
              animationDelay: `${i * 0.2}s`,
            }}
          >
            <svg
              width="24"
              height="24"
              viewBox="0 0 24 24"
              fill="currentColor"
              className="text-black/60"
            >
              <ellipse cx="12" cy="12" rx="3" ry="2" />
              <circle cx="15" cy="11" r="1" />
              <path d="M9 12 Q6 9, 4 11 Q7 11, 9 12" />
              <path d="M9 12 Q6 15, 4 13 Q7 13, 9 12" />
            </svg>
          </div>
        ))}
      </div>
    </div>
  );
};

export default CrowSplashAnimation;
