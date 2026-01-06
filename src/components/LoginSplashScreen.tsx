import { useEffect, useState } from 'react';

export function LoginSplashScreen({ onComplete }: { onComplete: () => void }) {
  const [phase, setPhase] = useState<'flying' | 'done'>('flying');

  useEffect(() => {
    // Complete animation after crow flies across
    const timer = setTimeout(() => {
      setPhase('done');
      onComplete();
    }, 800);

    return () => clearTimeout(timer);
  }, [onComplete]);

  return (
    <div className="fixed inset-0 z-50 bg-gradient-to-br from-background via-primary/10 to-accent/20 flex items-center justify-center overflow-hidden">
      {/* Flying crow */}
      <div 
        className="absolute animate-fly-across"
        style={{
          animation: 'flyAcross 0.8s ease-in-out forwards',
        }}
      >
        <svg
          width="120"
          height="120"
          viewBox="0 0 120 120"
          className="drop-shadow-2xl"
        >
          {/* Cartoon crow body */}
          <ellipse cx="60" cy="65" rx="30" ry="25" fill="#2C3E50" />
          
          {/* Head */}
          <circle cx="85" cy="50" r="18" fill="#2C3E50" />
          
          {/* Beak */}
          <polygon points="103,50 118,52 103,55" fill="#E67E22" />
          
          {/* Eye */}
          <circle cx="90" cy="47" r="6" fill="white" />
          <circle cx="92" cy="46" r="3" fill="#1a1a2e" />
          <circle cx="93" cy="45" r="1" fill="white" />
          
          {/* Wings - animated flapping */}
          <g className="animate-flap origin-center" style={{ transformOrigin: '50px 60px' }}>
            {/* Left wing */}
            <path
              d="M30 65 Q10 40 25 30 Q40 45 45 60"
              fill="#34495E"
              className="animate-wing-flap"
            />
          </g>
          <g className="animate-flap-delayed origin-center" style={{ transformOrigin: '70px 60px' }}>
            {/* Right wing (top) */}
            <path
              d="M50 55 Q45 25 70 15 Q75 35 65 55"
              fill="#34495E"
              className="animate-wing-flap-reverse"
            />
          </g>
          
          {/* Tail feathers */}
          <path
            d="M30 70 Q15 75 10 85 Q25 80 35 75"
            fill="#34495E"
          />
          <path
            d="M32 73 Q20 80 18 92 Q30 85 38 78"
            fill="#2C3E50"
          />
          
          {/* Feet (tucked in flight) */}
          <path d="M55 88 L52 95 M60 88 L60 95 M65 88 L68 95" stroke="#E67E22" strokeWidth="2" fill="none" />
        </svg>
      </div>

      {/* Trail particles */}
      <div className="absolute inset-0 pointer-events-none">
        {[...Array(8)].map((_, i) => (
          <div
            key={i}
            className="absolute w-2 h-2 rounded-full bg-primary/30"
            style={{
              animation: `particle ${0.8 + i * 0.1}s ease-out forwards`,
              animationDelay: `${i * 0.1}s`,
              left: '20%',
              top: '50%',
            }}
          />
        ))}
      </div>

      <style>{`
        @keyframes flyAcross {
          0% {
            transform: translateX(-150px) translateY(20px) rotate(-5deg);
            opacity: 0;
          }
          15% {
            opacity: 1;
          }
          50% {
            transform: translateX(0px) translateY(-30px) rotate(0deg);
          }
          85% {
            opacity: 1;
          }
          100% {
            transform: translateX(calc(100vw + 150px)) translateY(10px) rotate(5deg);
            opacity: 0;
          }
        }

        @keyframes wingFlap {
          0%, 100% {
            transform: rotate(-15deg) scaleY(1);
          }
          50% {
            transform: rotate(15deg) scaleY(0.8);
          }
        }

        @keyframes particle {
          0% {
            transform: translateX(0) translateY(0) scale(1);
            opacity: 0.6;
          }
          100% {
            transform: translateX(100px) translateY(var(--y, 0)) scale(0);
            opacity: 0;
          }
        }

        .animate-wing-flap {
          animation: wingFlap 0.15s ease-in-out infinite;
        }

        .animate-wing-flap-reverse {
          animation: wingFlap 0.15s ease-in-out infinite reverse;
        }

        .animate-flap {
          animation: wingFlap 0.15s ease-in-out infinite;
        }

        .animate-flap-delayed {
          animation: wingFlap 0.15s ease-in-out infinite;
          animation-delay: 0.075s;
        }
      `}</style>
    </div>
  );
}
