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

// Icicles for winter
const WinterIcicles = () => (
  <div className="absolute -top-1 left-0 right-0 flex justify-around pointer-events-none overflow-hidden">
    {[...Array(8)].map((_, i) => (
      <svg
        key={i}
        width="20"
        height={30 + (i % 3) * 15}
        viewBox="0 0 20 60"
        className="opacity-80"
        style={{ marginTop: -2 }}
      >
        <defs>
          <linearGradient id={`icicle-${i}`} x1="0%" y1="0%" x2="0%" y2="100%">
            <stop offset="0%" stopColor="#b8e4f0" />
            <stop offset="100%" stopColor="#7dd3fc" stopOpacity="0.6" />
          </linearGradient>
        </defs>
        <path
          d={`M10 0 Q15 ${20 + (i % 2) * 10} 12 ${40 + (i % 3) * 15} Q10 ${50 + (i % 3) * 10} 10 60 Q10 ${50 + (i % 3) * 10} 8 ${40 + (i % 3) * 15} Q5 ${20 + (i % 2) * 10} 10 0`}
          fill={`url(#icicle-${i})`}
        />
      </svg>
    ))}
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

// Button decorations
export const SeasonalButtonDecor = () => {
  const season = getSeason();
  
  if (season === 'winter') {
    return (
      <div className="absolute -top-1 left-2 right-2 flex justify-around pointer-events-none">
        {[...Array(4)].map((_, i) => (
          <svg key={i} width="8" height={10 + i * 3} viewBox="0 0 8 20" className="opacity-70">
            <path
              d={`M4 0 Q6 8 5 ${15 + i * 2} Q4 ${18 + i} 4 20 Q4 ${18 + i} 3 ${15 + i * 2} Q2 8 4 0`}
              fill="#93c5fd"
            />
          </svg>
        ))}
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
          <WinterIcicles />
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
