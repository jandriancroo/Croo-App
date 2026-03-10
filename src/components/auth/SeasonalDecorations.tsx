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

// Palm trees for spring
const SpringPalmTrees = () => (
  <>
    {/* Left palm tree */}
    <div className="absolute -bottom-4 -left-6 pointer-events-none">
      <svg width="90" height="120" viewBox="0 0 90 120">
        {/* Trunk */}
        <path d="M45 120 Q42 95 44 70 Q46 50 45 35" stroke="#8B6914" strokeWidth="6" fill="none" strokeLinecap="round" />
        <path d="M45 120 Q42 95 44 70 Q46 50 45 35" stroke="#A0782C" strokeWidth="4" fill="none" strokeLinecap="round" />
        {/* Trunk texture lines */}
        <path d="M41 110 Q45 108 49 110" stroke="#6B4F0A" strokeWidth="1" fill="none" />
        <path d="M41 100 Q45 98 49 100" stroke="#6B4F0A" strokeWidth="1" fill="none" />
        <path d="M42 90 Q45 88 48 90" stroke="#6B4F0A" strokeWidth="1" fill="none" />
        <path d="M42 80 Q45 78 48 80" stroke="#6B4F0A" strokeWidth="1" fill="none" />
        {/* Fronds - animated swaying */}
        <g style={{ transformOrigin: '45px 35px' }} className="animate-palm-sway">
          <path d="M45 35 Q25 20 5 25 Q20 15 45 30" fill="#228B22" />
          <path d="M45 35 Q30 10 15 5 Q30 8 45 28" fill="#2E8B2E" />
          <path d="M45 35 Q55 8 75 3 Q60 10 45 28" fill="#228B22" />
          <path d="M45 35 Q65 18 85 22 Q68 15 45 30" fill="#2E8B2E" />
          <path d="M45 35 Q45 5 50 -5 Q48 10 45 28" fill="#1E7B1E" />
        </g>
        {/* Coconuts */}
        <circle cx="42" cy="38" r="4" fill="#8B4513" />
        <circle cx="48" cy="40" r="3.5" fill="#7B3F13" />
      </svg>
    </div>
    {/* Right palm tree (smaller) */}
    <div className="absolute -bottom-3 -right-5 pointer-events-none">
      <svg width="70" height="100" viewBox="0 0 70 100">
        {/* Trunk */}
        <path d="M35 100 Q38 80 36 58 Q34 42 35 30" stroke="#8B6914" strokeWidth="5" fill="none" strokeLinecap="round" />
        <path d="M35 100 Q38 80 36 58 Q34 42 35 30" stroke="#A0782C" strokeWidth="3" fill="none" strokeLinecap="round" />
        {/* Trunk texture */}
        <path d="M32 90 Q35 88 38 90" stroke="#6B4F0A" strokeWidth="1" fill="none" />
        <path d="M32 80 Q35 78 38 80" stroke="#6B4F0A" strokeWidth="1" fill="none" />
        <path d="M33 70 Q35 68 37 70" stroke="#6B4F0A" strokeWidth="1" fill="none" />
        {/* Fronds - slightly different sway timing */}
        <g style={{ transformOrigin: '35px 30px' }} className="animate-palm-sway-delayed">
          <path d="M35 30 Q18 18 2 22 Q16 12 35 26" fill="#228B22" />
          <path d="M35 30 Q25 8 12 2 Q24 6 35 24" fill="#2E8B2E" />
          <path d="M35 30 Q45 8 60 4 Q48 10 35 24" fill="#228B22" />
          <path d="M35 30 Q52 16 66 20 Q52 12 35 26" fill="#2E8B2E" />
          <path d="M35 30 Q36 5 38 -2 Q37 8 35 24" fill="#1E7B1E" />
        </g>
        {/* Coconuts */}
        <circle cx="33" cy="33" r="3.5" fill="#8B4513" />
        <circle cx="38" cy="34" r="3" fill="#7B3F13" />
      </svg>
    </div>
    <style>{`
      @keyframes palmSway {
        0%, 100% { transform: rotate(-3deg); }
        50% { transform: rotate(3deg); }
      }
      .animate-palm-sway {
        animation: palmSway 3s ease-in-out infinite;
      }
      .animate-palm-sway-delayed {
        animation: palmSway 3.5s ease-in-out infinite;
        animation-delay: 0.5s;
      }
    `}</style>
  </>
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
          <SpringPalmTrees />
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
