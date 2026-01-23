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
    <svg width="100%" height="40" viewBox="0 0 300 40" preserveAspectRatio="none">
      <defs>
        <linearGradient id="snow-gradient" x1="0%" y1="0%" x2="0%" y2="100%">
          <stop offset="0%" stopColor="#ffffff" />
          <stop offset="60%" stopColor="#e8f4f8" />
          <stop offset="100%" stopColor="#d1e7ed" />
        </linearGradient>
        <linearGradient id="icicle-grad" x1="0%" y1="0%" x2="0%" y2="100%">
          <stop offset="0%" stopColor="#e0f0f5" />
          <stop offset="40%" stopColor="#c5e4ed" />
          <stop offset="100%" stopColor="#9ed4e4" stopOpacity="0.85" />
        </linearGradient>
      </defs>
      {/* Snow cap base */}
      <path
        d="M0 8 Q10 4 25 6 Q50 2 75 8 Q100 3 125 7 Q150 2 175 6 Q200 4 225 8 Q250 3 275 6 Q290 4 300 8 L300 12 Q280 14 260 12 Q240 16 220 13 Q200 15 180 12 Q160 16 140 13 Q120 15 100 12 Q80 16 60 13 Q40 15 20 12 Q10 14 0 12 Z"
        fill="url(#snow-gradient)"
      />
      {/* Rounder, organic icicles */}
      <ellipse cx="40" cy="18" rx="5" ry="8" fill="url(#icicle-grad)" />
      <ellipse cx="40" cy="30" rx="3" ry="6" fill="url(#icicle-grad)" />
      <ellipse cx="40" cy="38" rx="1.5" ry="2" fill="url(#icicle-grad)" />
      
      <ellipse cx="85" cy="16" rx="4" ry="6" fill="url(#icicle-grad)" />
      <ellipse cx="85" cy="24" rx="2.5" ry="4" fill="url(#icicle-grad)" />
      
      <ellipse cx="130" cy="18" rx="6" ry="9" fill="url(#icicle-grad)" />
      <ellipse cx="130" cy="32" rx="3.5" ry="7" fill="url(#icicle-grad)" />
      <ellipse cx="130" cy="40" rx="1.5" ry="2" fill="url(#icicle-grad)" />
      
      <ellipse cx="170" cy="16" rx="4" ry="5" fill="url(#icicle-grad)" />
      <ellipse cx="170" cy="22" rx="2" ry="3" fill="url(#icicle-grad)" />
      
      <ellipse cx="215" cy="17" rx="5" ry="7" fill="url(#icicle-grad)" />
      <ellipse cx="215" cy="28" rx="3" ry="5" fill="url(#icicle-grad)" />
      <ellipse cx="215" cy="35" rx="1.5" ry="2" fill="url(#icicle-grad)" />
      
      <ellipse cx="260" cy="16" rx="4" ry="6" fill="url(#icicle-grad)" />
      <ellipse cx="260" cy="24" rx="2" ry="3" fill="url(#icicle-grad)" />
    </svg>
  </div>
);

// Corner snow wrapping top-left
const WinterCornerTopLeft = () => (
  <div className="absolute -top-4 -left-4 pointer-events-none" style={{ zIndex: 10 }}>
    <svg width="55" height="70" viewBox="0 0 55 70">
      <defs>
        <linearGradient id="snow-corner-tl" x1="0%" y1="0%" x2="100%" y2="100%">
          <stop offset="0%" stopColor="#ffffff" />
          <stop offset="100%" stopColor="#d1e7ed" />
        </linearGradient>
        <linearGradient id="icicle-corner" x1="0%" y1="0%" x2="0%" y2="100%">
          <stop offset="0%" stopColor="#e0f0f5" />
          <stop offset="100%" stopColor="#9ed4e4" stopOpacity="0.8" />
        </linearGradient>
      </defs>
      {/* Snow cap wrapping corner */}
      <path
        d="M55 10 Q50 8 45 12 Q35 6 25 14 Q15 10 8 18 Q4 22 2 28 L0 35 Q3 30 6 24 Q10 16 20 18 Q32 12 42 16 Q52 12 55 15 Z"
        fill="url(#snow-corner-tl)"
      />
      {/* Rounded icicle dripping from corner */}
      <ellipse cx="6" cy="38" rx="5" ry="8" fill="url(#icicle-corner)" />
      <ellipse cx="6" cy="52" rx="3.5" ry="7" fill="url(#icicle-corner)" />
      <ellipse cx="6" cy="64" rx="2" ry="4" fill="url(#icicle-corner)" />
      <ellipse cx="6" cy="70" rx="1" ry="2" fill="url(#icicle-corner)" />
      
      <ellipse cx="22" cy="20" rx="4" ry="5" fill="url(#icicle-corner)" />
      <ellipse cx="22" cy="28" rx="2.5" ry="4" fill="url(#icicle-corner)" />
    </svg>
  </div>
);

// Corner snow wrapping top-right
const WinterCornerTopRight = () => (
  <div className="absolute -top-4 -right-4 pointer-events-none" style={{ zIndex: 10 }}>
    <svg width="55" height="70" viewBox="0 0 55 70">
      <defs>
        <linearGradient id="snow-corner-tr" x1="100%" y1="0%" x2="0%" y2="100%">
          <stop offset="0%" stopColor="#ffffff" />
          <stop offset="100%" stopColor="#d1e7ed" />
        </linearGradient>
      </defs>
      {/* Snow cap wrapping corner */}
      <path
        d="M0 10 Q5 8 10 12 Q20 6 30 14 Q40 10 47 18 Q51 22 53 28 L55 35 Q52 30 49 24 Q45 16 35 18 Q23 12 13 16 Q3 12 0 15 Z"
        fill="url(#snow-corner-tr)"
      />
      {/* Rounded icicle dripping from corner */}
      <ellipse cx="49" cy="38" rx="5" ry="8" fill="url(#icicle-corner)" />
      <ellipse cx="49" cy="52" rx="3.5" ry="7" fill="url(#icicle-corner)" />
      <ellipse cx="49" cy="64" rx="2" ry="4" fill="url(#icicle-corner)" />
      <ellipse cx="49" cy="70" rx="1" ry="2" fill="url(#icicle-corner)" />
      
      <ellipse cx="33" cy="20" rx="4" ry="5" fill="url(#icicle-corner)" />
      <ellipse cx="33" cy="28" rx="2.5" ry="4" fill="url(#icicle-corner)" />
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
      <div className="absolute -top-2 left-0 right-0 pointer-events-none" style={{ zIndex: 10 }}>
        <svg width="100%" height="20" viewBox="0 0 200 20" preserveAspectRatio="none">
          <defs>
            <linearGradient id="btn-snow" x1="0%" y1="0%" x2="0%" y2="100%">
              <stop offset="0%" stopColor="#ffffff" />
              <stop offset="100%" stopColor="#e0eff4" />
            </linearGradient>
            <linearGradient id="btn-icicle" x1="0%" y1="0%" x2="0%" y2="100%">
              <stop offset="0%" stopColor="#e0f0f5" />
              <stop offset="100%" stopColor="#9ed4e4" stopOpacity="0.7" />
            </linearGradient>
          </defs>
          {/* Snow cap */}
          <path
            d="M0 6 Q15 3 30 5 Q60 2 90 6 Q120 3 150 5 Q175 2 190 6 Q198 4 200 6 L200 10 Q180 12 160 10 Q130 13 100 10 Q70 13 40 10 Q20 12 0 10 Z"
            fill="url(#btn-snow)"
          />
          {/* Rounded icicles */}
          <ellipse cx="35" cy="12" rx="3" ry="4" fill="url(#btn-icicle)" />
          <ellipse cx="35" cy="17" rx="1.5" ry="2" fill="url(#btn-icicle)" />
          
          <ellipse cx="100" cy="12" rx="3.5" ry="5" fill="url(#btn-icicle)" />
          <ellipse cx="100" cy="18" rx="2" ry="2" fill="url(#btn-icicle)" />
          
          <ellipse cx="165" cy="12" rx="3" ry="4" fill="url(#btn-icicle)" />
          <ellipse cx="165" cy="17" rx="1.5" ry="2" fill="url(#btn-icicle)" />
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
