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

// Snow cap with icicles for the top edge - cartoon style like reference
const WinterTopSnow = () => (
  <div className="absolute -top-3 left-4 right-4 pointer-events-none" style={{ zIndex: 10 }}>
    <svg width="100%" height="45" viewBox="0 0 300 45" preserveAspectRatio="none">
      <defs>
        <linearGradient id="snow-gradient" x1="0%" y1="0%" x2="0%" y2="100%">
          <stop offset="0%" stopColor="#ffffff" />
          <stop offset="50%" stopColor="#f0f8fa" />
          <stop offset="100%" stopColor="#daeef3" />
        </linearGradient>
        <linearGradient id="icicle-grad" x1="0%" y1="0%" x2="0%" y2="100%">
          <stop offset="0%" stopColor="#daeef3" />
          <stop offset="30%" stopColor="#c2e4ed" />
          <stop offset="70%" stopColor="#a8dae8" />
          <stop offset="100%" stopColor="#8ccfdf" />
        </linearGradient>
      </defs>
      {/* Snow cap base - puffy rounded */}
      <path
        d="M0 10 C15 6 25 8 40 5 C60 2 80 9 100 6 C120 3 140 8 160 5 C180 2 200 7 220 6 C240 4 260 8 280 5 C295 7 300 10 300 10 L300 14 C280 16 260 13 240 15 C220 17 200 13 180 15 C160 17 140 14 120 16 C100 18 80 14 60 16 C40 18 20 14 0 16 Z"
        fill="url(#snow-gradient)"
      />
      {/* Cartoon icicles - bulbous top, tapered point */}
      <path d="M25 14 C30 14 32 18 31 24 C30 30 28 38 26 42 C26 42 25 44 24 42 C22 38 20 30 19 24 C18 18 20 14 25 14" fill="url(#icicle-grad)" />
      <path d="M55 15 C59 15 61 18 60 22 C59 26 58 30 56 33 C56 33 55 34 54 33 C52 30 51 26 50 22 C49 18 51 15 55 15" fill="url(#icicle-grad)" />
      <path d="M90 14 C95 14 98 19 96 26 C94 34 91 40 88 45 C88 45 87 45 86 45 C83 40 80 34 78 26 C76 19 79 14 84 14 C86 14 88 14 90 14" fill="url(#icicle-grad)" />
      <path d="M125 15 C128 15 130 17 129 21 C128 25 127 28 126 30 C126 30 125 31 124 30 C123 28 122 25 121 21 C120 17 122 15 125 15" fill="url(#icicle-grad)" />
      <path d="M155 14 C160 14 163 18 161 25 C159 32 156 38 153 42 C153 42 152 43 151 42 C148 38 145 32 143 25 C141 18 144 14 149 14 C151 14 153 14 155 14" fill="url(#icicle-grad)" />
      <path d="M190 15 C194 15 196 18 195 23 C194 28 192 32 190 35 C190 35 189 36 188 35 C186 32 184 28 183 23 C182 18 184 15 188 15 C189 15 190 15 190 15" fill="url(#icicle-grad)" />
      <path d="M220 14 C225 14 228 19 226 27 C224 35 220 42 217 45 C217 45 216 45 215 45 C212 42 208 35 206 27 C204 19 207 14 212 14 C215 14 218 14 220 14" fill="url(#icicle-grad)" />
      <path d="M250 15 C253 15 255 17 254 21 C253 25 252 28 251 30 C251 30 250 31 249 30 C248 28 247 25 246 21 C245 17 247 15 250 15" fill="url(#icicle-grad)" />
      <path d="M275 14 C279 14 281 17 280 22 C279 27 277 32 275 36 C275 36 274 37 273 36 C271 32 269 27 268 22 C267 17 269 14 273 14 C274 14 275 14 275 14" fill="url(#icicle-grad)" />
    </svg>
  </div>
);

// Corner snow wrapping top-left with cartoon icicles
const WinterCornerTopLeft = () => (
  <div className="absolute -top-4 -left-5 pointer-events-none" style={{ zIndex: 10 }}>
    <svg width="60" height="75" viewBox="0 0 60 75">
      <defs>
        <linearGradient id="snow-corner-tl" x1="0%" y1="0%" x2="100%" y2="100%">
          <stop offset="0%" stopColor="#ffffff" />
          <stop offset="100%" stopColor="#daeef3" />
        </linearGradient>
        <linearGradient id="icicle-corner-l" x1="0%" y1="0%" x2="0%" y2="100%">
          <stop offset="0%" stopColor="#daeef3" />
          <stop offset="50%" stopColor="#b5dfea" />
          <stop offset="100%" stopColor="#8ccfdf" />
        </linearGradient>
      </defs>
      {/* Snow cap wrapping corner - puffy */}
      <path
        d="M60 12 C55 10 50 14 42 10 C34 6 26 12 18 10 C12 8 6 14 3 20 C1 26 0 32 0 38 L0 40 C2 34 5 26 8 20 C12 14 18 14 26 16 C34 12 44 16 52 14 C58 12 60 14 60 14 Z"
        fill="url(#snow-corner-tl)"
      />
      {/* Big corner icicle */}
      <path d="M6 38 C12 38 15 44 13 54 C11 64 8 72 5 75 C5 75 4 75 3 75 C0 72 -3 64 -1 54 C1 44 0 38 6 38" fill="url(#icicle-corner-l)" />
      {/* Smaller icicle */}
      <path d="M22 16 C26 16 28 20 27 26 C26 32 24 36 22 38 C22 38 21 38 20 38 C18 36 16 32 15 26 C14 20 16 16 20 16 C21 16 22 16 22 16" fill="url(#icicle-corner-l)" />
    </svg>
  </div>
);

// Corner snow wrapping top-right with cartoon icicles
const WinterCornerTopRight = () => (
  <div className="absolute -top-4 -right-5 pointer-events-none" style={{ zIndex: 10 }}>
    <svg width="60" height="75" viewBox="0 0 60 75">
      <defs>
        <linearGradient id="snow-corner-tr" x1="100%" y1="0%" x2="0%" y2="100%">
          <stop offset="0%" stopColor="#ffffff" />
          <stop offset="100%" stopColor="#daeef3" />
        </linearGradient>
        <linearGradient id="icicle-corner-r" x1="0%" y1="0%" x2="0%" y2="100%">
          <stop offset="0%" stopColor="#daeef3" />
          <stop offset="50%" stopColor="#b5dfea" />
          <stop offset="100%" stopColor="#8ccfdf" />
        </linearGradient>
      </defs>
      {/* Snow cap wrapping corner - puffy */}
      <path
        d="M0 12 C5 10 10 14 18 10 C26 6 34 12 42 10 C48 8 54 14 57 20 C59 26 60 32 60 38 L60 40 C58 34 55 26 52 20 C48 14 42 14 34 16 C26 12 16 16 8 14 C2 12 0 14 0 14 Z"
        fill="url(#snow-corner-tr)"
      />
      {/* Big corner icicle */}
      <path d="M54 38 C60 38 63 44 61 54 C59 64 56 72 53 75 C53 75 52 75 51 75 C48 72 45 64 47 54 C49 44 48 38 54 38" fill="url(#icicle-corner-r)" />
      {/* Smaller icicle */}
      <path d="M38 16 C42 16 44 20 43 26 C42 32 40 36 38 38 C38 38 37 38 36 38 C34 36 32 32 31 26 C30 20 32 16 36 16 C37 16 38 16 38 16" fill="url(#icicle-corner-r)" />
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

// Button decorations - snow cap on top of button with cartoon icicles
export const SeasonalButtonDecor = () => {
  const season = getSeason();
  
  if (season === 'winter') {
    return (
      <div className="absolute -top-3 left-0 right-0 pointer-events-none" style={{ zIndex: 10 }}>
        <svg width="100%" height="22" viewBox="0 0 200 22" preserveAspectRatio="none">
          <defs>
            <linearGradient id="btn-snow" x1="0%" y1="0%" x2="0%" y2="100%">
              <stop offset="0%" stopColor="#ffffff" />
              <stop offset="100%" stopColor="#e8f4f7" />
            </linearGradient>
            <linearGradient id="btn-icicle" x1="0%" y1="0%" x2="0%" y2="100%">
              <stop offset="0%" stopColor="#daeef3" />
              <stop offset="100%" stopColor="#a8dae8" />
            </linearGradient>
          </defs>
          {/* Puffy snow cap */}
          <path
            d="M0 8 C20 5 40 9 60 6 C80 3 100 8 120 5 C140 3 160 7 180 5 C195 6 200 8 200 8 L200 11 C180 13 160 10 140 12 C120 14 100 11 80 13 C60 15 40 11 20 13 C5 14 0 12 0 12 Z"
            fill="url(#btn-snow)"
          />
          {/* Cartoon icicles */}
          <path d="M40 11 C44 11 46 13 45 17 C44 20 42 22 40 22 C38 22 36 20 35 17 C34 13 36 11 40 11" fill="url(#btn-icicle)" />
          <path d="M100 11 C105 11 107 14 106 18 C105 21 102 22 100 22 C98 22 95 21 94 18 C93 14 95 11 100 11" fill="url(#btn-icicle)" />
          <path d="M160 11 C164 11 166 13 165 17 C164 20 162 22 160 22 C158 22 156 20 155 17 C154 13 156 11 160 11" fill="url(#btn-icicle)" />
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
