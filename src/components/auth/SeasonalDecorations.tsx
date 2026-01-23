import React from 'react';

type Season = 'winter' | 'spring' | 'summer' | 'fall';

function getSeason(): Season {
  const now = new Date();
  const month = now.getMonth() + 1; // 1-12
  const day = now.getDate();
  
  // Winter: Dec 21 - Mar 20
  if ((month === 12 && day >= 21) || month <= 2 || (month === 3 && day <= 20)) {
    return 'winter';
  }
  // Spring: Mar 21 - Jun 20
  if ((month === 3 && day >= 21) || month === 4 || month === 5 || (month === 6 && day <= 20)) {
    return 'spring';
  }
  // Summer: Jun 21 - Sep 22
  if ((month === 6 && day >= 21) || month === 7 || month === 8 || (month === 9 && day <= 22)) {
    return 'summer';
  }
  // Fall: Sep 23 - Dec 20
  return 'fall';
}

// Snow cap with icicles for the top edge
const WinterTopSnow = () => (
  <div className="absolute -top-3 left-4 right-4 pointer-events-none" style={{ zIndex: 10 }}>
    <svg width="100%" height="35" viewBox="0 0 300 35" preserveAspectRatio="none">
      <defs>
        <linearGradient id="snow-gradient" x1="0%" y1="0%" x2="0%" y2="100%">
          <stop offset="0%" stopColor="#ffffff" />
          <stop offset="60%" stopColor="#e8f4f8" />
          <stop offset="100%" stopColor="#d1e7ed" />
        </linearGradient>
        <linearGradient id="icicle-grad" x1="0%" y1="0%" x2="0%" y2="100%">
          <stop offset="0%" stopColor="#d1e7ed" />
          <stop offset="50%" stopColor="#a5d8e6" />
          <stop offset="100%" stopColor="#7cc4d8" stopOpacity="0.7" />
        </linearGradient>
      </defs>
      {/* Snow cap base */}
      <path
        d="M0 8 Q10 4 25 6 Q50 2 75 8 Q100 3 125 7 Q150 2 175 6 Q200 4 225 8 Q250 3 275 6 Q290 4 300 8 L300 12 Q280 14 260 12 Q240 16 220 13 Q200 15 180 12 Q160 16 140 13 Q120 15 100 12 Q80 16 60 13 Q40 15 20 12 Q10 14 0 12 Z"
        fill="url(#snow-gradient)"
      />
      {/* Icicles dripping down */}
      <path d="M30 12 Q32 18 31 28 Q30 32 29 28 Q28 18 30 12" fill="url(#icicle-grad)" />
      <path d="M55 13 Q58 22 56 35 Q55 30 54 35 Q52 22 55 13" fill="url(#icicle-grad)" />
      <path d="M90 12 Q92 16 91 22 Q90 24 89 22 Q88 16 90 12" fill="url(#icicle-grad)" />
      <path d="M120 13 Q123 20 121 30 Q120 32 119 30 Q117 20 120 13" fill="url(#icicle-grad)" />
      <path d="M150 12 Q152 17 151 25 Q150 27 149 25 Q148 17 150 12" fill="url(#icicle-grad)" />
      <path d="M180 13 Q183 21 181 32 Q180 35 179 32 Q177 21 180 13" fill="url(#icicle-grad)" />
      <path d="M210 12 Q212 16 211 20 Q210 22 209 20 Q208 16 210 12" fill="url(#icicle-grad)" />
      <path d="M245 13 Q248 20 246 28 Q245 30 244 28 Q242 20 245 13" fill="url(#icicle-grad)" />
      <path d="M270 12 Q272 18 271 26 Q270 28 269 26 Q268 18 270 12" fill="url(#icicle-grad)" />
    </svg>
  </div>
);

// Corner snow wrapping top-left
const WinterCornerTopLeft = () => (
  <div className="absolute -top-4 -left-4 pointer-events-none" style={{ zIndex: 10 }}>
    <svg width="50" height="60" viewBox="0 0 50 60">
      <defs>
        <linearGradient id="snow-corner-tl" x1="0%" y1="0%" x2="100%" y2="100%">
          <stop offset="0%" stopColor="#ffffff" />
          <stop offset="100%" stopColor="#d1e7ed" />
        </linearGradient>
        <linearGradient id="icicle-corner" x1="0%" y1="0%" x2="0%" y2="100%">
          <stop offset="0%" stopColor="#d1e7ed" />
          <stop offset="100%" stopColor="#7cc4d8" stopOpacity="0.6" />
        </linearGradient>
      </defs>
      {/* Snow cap wrapping corner */}
      <path
        d="M50 10 Q45 8 40 12 Q30 6 20 14 Q10 10 5 18 Q2 22 0 30 L0 35 Q5 28 8 22 Q12 16 20 18 Q30 12 40 16 Q48 12 50 15 Z"
        fill="url(#snow-corner-tl)"
      />
      {/* Icicle dripping from corner */}
      <path d="M8 30 Q12 40 10 55 Q8 60 6 55 Q4 40 8 30" fill="url(#icicle-corner)" />
      <path d="M20 18 Q22 24 21 32 Q20 34 19 32 Q18 24 20 18" fill="url(#icicle-corner)" />
    </svg>
  </div>
);

// Corner snow wrapping top-right
const WinterCornerTopRight = () => (
  <div className="absolute -top-4 -right-4 pointer-events-none" style={{ zIndex: 10 }}>
    <svg width="50" height="60" viewBox="0 0 50 60">
      <defs>
        <linearGradient id="snow-corner-tr" x1="100%" y1="0%" x2="0%" y2="100%">
          <stop offset="0%" stopColor="#ffffff" />
          <stop offset="100%" stopColor="#d1e7ed" />
        </linearGradient>
      </defs>
      {/* Snow cap wrapping corner */}
      <path
        d="M0 10 Q5 8 10 12 Q20 6 30 14 Q40 10 45 18 Q48 22 50 30 L50 35 Q45 28 42 22 Q38 16 30 18 Q20 12 10 16 Q2 12 0 15 Z"
        fill="url(#snow-corner-tr)"
      />
      {/* Icicle dripping from corner */}
      <path d="M42 30 Q46 42 44 55 Q42 60 40 55 Q38 42 42 30" fill="url(#icicle-corner)" />
      <path d="M30 18 Q32 24 31 32 Q30 34 29 32 Q28 24 30 18" fill="url(#icicle-corner)" />
    </svg>
  </div>
);

// Snowflakes floating
const WinterSnowflakes = () => (
  <div className="absolute inset-0 pointer-events-none overflow-hidden">
    {[...Array(12)].map((_, i) => (
      <div
        key={i}
        className="absolute text-sky-200/60 animate-float"
        style={{
          left: `${5 + (i * 8)}%`,
          top: `${10 + (i % 4) * 20}%`,
          animationDelay: `${i * 0.3}s`,
          animationDuration: `${3 + (i % 3)}s`,
          fontSize: `${12 + (i % 3) * 4}px`,
        }}
      >
        ❄
      </div>
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

// Button decorations - snow cap on top of button
export const SeasonalButtonDecor = () => {
  const season = getSeason();
  
  if (season === 'winter') {
    return (
      <div className="absolute -top-2 left-1 right-1 pointer-events-none" style={{ zIndex: 10 }}>
        <svg width="100%" height="18" viewBox="0 0 200 18" preserveAspectRatio="none">
          <defs>
            <linearGradient id="btn-snow" x1="0%" y1="0%" x2="0%" y2="100%">
              <stop offset="0%" stopColor="#ffffff" />
              <stop offset="100%" stopColor="#e0eff4" />
            </linearGradient>
            <linearGradient id="btn-icicle" x1="0%" y1="0%" x2="0%" y2="100%">
              <stop offset="0%" stopColor="#d1e7ed" />
              <stop offset="100%" stopColor="#7cc4d8" stopOpacity="0.5" />
            </linearGradient>
          </defs>
          {/* Snow cap */}
          <path
            d="M0 6 Q15 3 30 5 Q60 2 90 6 Q120 3 150 5 Q175 2 190 6 Q198 4 200 6 L200 10 Q180 12 160 10 Q130 13 100 10 Q70 13 40 10 Q20 12 0 10 Z"
            fill="url(#btn-snow)"
          />
          {/* Small icicles */}
          <path d="M25 10 Q26 13 25 16 Q24 13 25 10" fill="url(#btn-icicle)" />
          <path d="M70 10 Q72 14 71 18 Q70 14 70 10" fill="url(#btn-icicle)" />
          <path d="M100 10 Q101 12 100 15 Q99 12 100 10" fill="url(#btn-icicle)" />
          <path d="M130 10 Q132 14 131 18 Q130 14 130 10" fill="url(#btn-icicle)" />
          <path d="M175 10 Q176 13 175 16 Q174 13 175 10" fill="url(#btn-icicle)" />
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
          <WinterCornerTopLeft />
          <WinterCornerTopRight />
          <WinterSnowflakes />
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
