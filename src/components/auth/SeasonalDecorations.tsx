import React from 'react';

type Season = 'winter' | 'spring' | 'summer' | 'fall';

function getSeason(): Season {
  // TEMP: Force spring for preview
  return 'spring';
}

// Thick snow cap for the top edge - no icicles, with stronger drop shadow
const WinterTopSnow = () => (
  <div className="absolute -top-5 left-2 right-2 pointer-events-none" style={{ zIndex: 10, filter: 'drop-shadow(0 6px 10px rgba(0,0,0,0.25))' }}>
    <svg width="100%" height="28" viewBox="0 0 300 28" preserveAspectRatio="none">
      <defs>
        <linearGradient id="snow-gradient" x1="0%" y1="0%" x2="0%" y2="100%">
          <stop offset="0%" stopColor="#ffffff" />
          <stop offset="40%" stopColor="#f5fbfc" />
          <stop offset="100%" stopColor="#e0eff4" />
        </linearGradient>
      </defs>
      {/* Thick puffy snow cap */}
      <path
        d="M0 14 C10 8 20 12 35 6 C55 0 75 10 100 4 C125 -2 145 12 170 6 C195 0 215 10 240 5 C265 0 285 10 300 14 L300 20 C285 24 265 18 240 22 C215 26 195 18 170 22 C145 26 125 18 100 22 C75 26 55 18 35 22 C15 26 5 20 0 22 Z"
        fill="url(#snow-gradient)"
      />
    </svg>
  </div>
);

// Full page snowfall - GPU-accelerated simple circles for 120hz performance
export const WinterSnowfall = () => (
  <div className="fixed inset-0 pointer-events-none overflow-hidden z-50">
    {[...Array(35)].map((_, i) => (
      <div
        key={i}
        className="absolute rounded-full bg-white/80 animate-snowfall"
        style={{
          left: `${Math.random() * 100}%`,
          top: `-2%`,
          width: `${4 + Math.random() * 6}px`,
          height: `${4 + Math.random() * 6}px`,
          animationDelay: `${Math.random() * 8}s`,
          animationDuration: `${7 + Math.random() * 5}s`,
          willChange: 'transform',
        }}
      />
    ))}
  </div>
);

// Sunflowers for spring
const SpringSunflowers = () => (
  <>
    <div className="absolute -bottom-4 -left-8 pointer-events-none">
      <svg width="80" height="100" viewBox="0 0 80 100">
        {/* Stem */}
        <path d="M40 100 Q35 70 40 50" stroke="#22c55e" strokeWidth="4" fill="none" />
        {/* Leaves */}
        <ellipse cx="30" cy="75" rx="12" ry="6" fill="#22c55e" transform="rotate(-30 30 75)" />
        <ellipse cx="50" cy="65" rx="10" ry="5" fill="#22c55e" transform="rotate(25 50 65)" />
        {/* Petals */}
        {[...Array(12)].map((_, i) => (
          <ellipse
            key={i}
            cx="40"
            cy="30"
            rx="6"
            ry="15"
            fill="#fbbf24"
            transform={`rotate(${i * 30} 40 40) translate(0 -15)`}
          />
        ))}
        {/* Center */}
        <circle cx="40" cy="40" r="12" fill="#92400e" />
      </svg>
    </div>
    <div className="absolute -bottom-4 -right-6 pointer-events-none">
      <svg width="60" height="80" viewBox="0 0 60 80">
        <path d="M30 80 Q28 55 30 40" stroke="#22c55e" strokeWidth="3" fill="none" />
        <ellipse cx="22" cy="60" rx="8" ry="4" fill="#22c55e" transform="rotate(-25 22 60)" />
        {[...Array(10)].map((_, i) => (
          <ellipse
            key={i}
            cx="30"
            cy="25"
            rx="5"
            ry="12"
            fill="#fcd34d"
            transform={`rotate(${i * 36} 30 32) translate(0 -12)`}
          />
        ))}
        <circle cx="30" cy="32" r="10" fill="#a16207" />
      </svg>
    </div>
  </>
);

// Butterflies for spring
const SpringButterflies = () => (
  <div className="absolute inset-0 pointer-events-none overflow-hidden">
    {[...Array(4)].map((_, i) => (
      <div
        key={i}
        className="absolute animate-float"
        style={{
          left: `${10 + i * 25}%`,
          top: `${15 + (i % 2) * 30}%`,
          animationDelay: `${i * 0.5}s`,
          animationDuration: `${4 + i}s`,
        }}
      >
        <span className="text-2xl" style={{ filter: 'drop-shadow(0 2px 2px rgba(0,0,0,0.1))' }}>
          {i % 2 === 0 ? '🦋' : '🌸'}
        </span>
      </div>
    ))}
  </div>
);

// Sun for summer
const SummerSun = () => (
  <div className="absolute -top-10 -right-10 pointer-events-none">
    <svg width="100" height="100" viewBox="0 0 100 100" className="animate-spin-slow">
      {/* Rays */}
      {[...Array(12)].map((_, i) => (
        <line
          key={i}
          x1="50"
          y1="50"
          x2="50"
          y2="10"
          stroke="#fbbf24"
          strokeWidth="3"
          strokeLinecap="round"
          transform={`rotate(${i * 30} 50 50)`}
        />
      ))}
    </svg>
    <div className="absolute inset-0 flex items-center justify-center">
      <div className="w-12 h-12 rounded-full bg-gradient-to-br from-yellow-300 to-orange-400 shadow-lg" />
    </div>
  </div>
);

// Cactuses for summer
const SummerCactuses = () => (
  <>
    <div className="absolute -bottom-2 -left-4 pointer-events-none">
      <svg width="50" height="70" viewBox="0 0 50 70">
        {/* Main body */}
        <rect x="18" y="20" width="14" height="50" rx="7" fill="#22c55e" />
        {/* Left arm */}
        <rect x="5" y="35" width="18" height="8" rx="4" fill="#22c55e" />
        <rect x="5" y="25" width="8" height="18" rx="4" fill="#22c55e" />
        {/* Right arm */}
        <rect x="27" y="45" width="15" height="8" rx="4" fill="#22c55e" />
        <rect x="35" y="35" width="8" height="18" rx="4" fill="#22c55e" />
        {/* Pot */}
        <path d="M12 70 L15 60 L35 60 L38 70 Z" fill="#dc7958" />
      </svg>
    </div>
    <div className="absolute -bottom-2 -right-3 pointer-events-none">
      <svg width="40" height="55" viewBox="0 0 40 55">
        <rect x="14" y="15" width="12" height="40" rx="6" fill="#16a34a" />
        <rect x="3" y="30" width="14" height="7" rx="3.5" fill="#16a34a" />
        <rect x="3" y="22" width="7" height="15" rx="3.5" fill="#16a34a" />
        <path d="M10 55 L12 47 L28 47 L30 55 Z" fill="#b45a3c" />
      </svg>
    </div>
  </>
);

// Fall leaves
const FallLeaves = () => (
  <div className="absolute inset-0 pointer-events-none overflow-hidden">
    {[...Array(8)].map((_, i) => (
      <div
        key={i}
        className="absolute animate-fall"
        style={{
          left: `${5 + i * 12}%`,
          top: `-10%`,
          animationDelay: `${i * 0.4}s`,
          animationDuration: `${4 + (i % 3)}s`,
        }}
      >
        <span 
          className="text-2xl"
          style={{ 
            filter: 'drop-shadow(0 2px 2px rgba(0,0,0,0.1))',
            transform: `rotate(${i * 30}deg)`,
          }}
        >
          {['🍂', '🍁', '🍃'][i % 3]}
        </span>
      </div>
    ))}
  </div>
);

// Pumpkins for fall
const FallPumpkins = () => (
  <>
    <div className="absolute -bottom-3 -left-6 pointer-events-none text-4xl">
      🎃
    </div>
    <div className="absolute -bottom-2 -right-4 pointer-events-none text-3xl">
      🎃
    </div>
  </>
);

// Button decorations - thick snow cap on top of button, no icicles
export const SeasonalButtonDecor = () => {
  const season = getSeason();
  
  if (season === 'winter') {
    return (
      <div className="absolute -top-4 -left-1 -right-1 pointer-events-none" style={{ zIndex: 10, filter: 'drop-shadow(0 3px 4px rgba(0,0,0,0.12))' }}>
        <svg width="100%" height="18" viewBox="0 0 200 18" preserveAspectRatio="none">
          <defs>
            <linearGradient id="btn-snow" x1="0%" y1="0%" x2="0%" y2="100%">
              <stop offset="0%" stopColor="#ffffff" />
              <stop offset="100%" stopColor="#e8f4f7" />
            </linearGradient>
          </defs>
          {/* Thick puffy snow cap */}
          <path
            d="M0 10 C15 5 30 12 50 6 C75 0 100 10 125 5 C150 0 175 10 190 6 C198 8 200 10 200 10 L200 14 C185 17 170 12 150 15 C125 18 100 12 75 16 C50 19 25 13 10 16 C3 17 0 15 0 15 Z"
            fill="url(#btn-snow)"
          />
        </svg>
      </div>
    );
  }
  
  return null;
};

// Main card decorations
export const SeasonalCardDecor = () => {
  const season = getSeason();
  
  return (
    <>
      {season === 'winter' && (
        <>
          <WinterTopSnow />
        </>
      )}
      {season === 'spring' && (
        <>
          <SpringSunflowers />
          <SpringButterflies />
        </>
      )}
      {season === 'summer' && (
        <>
          <SummerSun />
          <SummerCactuses />
        </>
      )}
      {season === 'fall' && (
        <>
          <FallLeaves />
          <FallPumpkins />
        </>
      )}
    </>
  );
};

export { getSeason };
export type { Season };
