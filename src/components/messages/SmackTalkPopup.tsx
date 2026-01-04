import { useEffect, useState } from 'react';

interface SmackTalkPopupProps {
  text: string;
  senderName: string;
  onComplete: () => void;
}

const SMACK_CONFIG: Record<string, { emoji: string; bgColor: string; textColor: string; shadowColor: string }> = {
  'WOW!': { emoji: '🤯', bgColor: 'from-yellow-400 via-orange-500 to-red-500', textColor: 'text-white', shadowColor: 'shadow-orange-500/50' },
  'Boring...': { emoji: '😴', bgColor: 'from-gray-400 via-gray-500 to-gray-700', textColor: 'text-white', shadowColor: 'shadow-gray-500/50' },
  'You Suck!': { emoji: '👎', bgColor: 'from-red-500 via-pink-500 to-purple-500', textColor: 'text-white', shadowColor: 'shadow-red-500/50' },
  'Blaze On!': { emoji: '🔥', bgColor: 'from-orange-500 via-red-500 to-yellow-500', textColor: 'text-white', shadowColor: 'shadow-orange-500/50' },
  'Try Again': { emoji: '🎮', bgColor: 'from-blue-500 via-purple-500 to-pink-500', textColor: 'text-white', shadowColor: 'shadow-blue-500/50' },
  'Game Over': { emoji: '💀', bgColor: 'from-purple-700 via-gray-900 to-black', textColor: 'text-white', shadowColor: 'shadow-purple-700/50' },
};

export function SmackTalkPopup({ text, senderName, onComplete }: SmackTalkPopupProps) {
  const [phase, setPhase] = useState<'enter' | 'show' | 'exit'>('enter');
  
  const config = SMACK_CONFIG[text] || SMACK_CONFIG['WOW!'];

  useEffect(() => {
    // Enter animation
    const enterTimer = setTimeout(() => setPhase('show'), 50);
    
    // Stay visible
    const showTimer = setTimeout(() => setPhase('exit'), 2000);
    
    // Complete and unmount
    const exitTimer = setTimeout(() => onComplete(), 2500);
    
    return () => {
      clearTimeout(enterTimer);
      clearTimeout(showTimer);
      clearTimeout(exitTimer);
    };
  }, [onComplete]);

  return (
    <div className="fixed inset-0 z-50 pointer-events-none flex items-center justify-center">
      {/* Backdrop flash */}
      <div 
        className={`absolute inset-0 bg-black/30 transition-opacity duration-300 ${
          phase === 'show' ? 'opacity-100' : 'opacity-0'
        }`}
      />
      
      {/* Comic burst container */}
      <div 
        className={`
          relative transform transition-all duration-300 ease-out
          ${phase === 'enter' ? 'scale-0 rotate-12' : ''}
          ${phase === 'show' ? 'scale-100 rotate-0' : ''}
          ${phase === 'exit' ? 'scale-150 opacity-0 rotate-[-5deg]' : ''}
        `}
      >
        {/* Starburst background */}
        <div className="absolute inset-0 -m-8">
          <svg viewBox="0 0 200 200" className="w-full h-full animate-spin" style={{ animationDuration: '20s' }}>
            <polygon
              points="100,10 110,80 180,60 120,100 180,140 110,120 100,190 90,120 20,140 80,100 20,60 90,80"
              fill="white"
              className="opacity-90"
            />
          </svg>
        </div>
        
        {/* Main popup */}
        <div 
          className={`
            relative bg-gradient-to-br ${config.bgColor}
            rounded-2xl px-8 py-6 min-w-[200px]
            shadow-2xl ${config.shadowColor}
            border-4 border-white
            transform
          `}
          style={{
            clipPath: 'polygon(5% 0%, 95% 0%, 100% 5%, 100% 95%, 95% 100%, 5% 100%, 0% 95%, 0% 5%)'
          }}
        >
          {/* Emoji burst */}
          <div className="text-5xl text-center mb-2 animate-bounce">
            {config.emoji}
          </div>
          
          {/* Main text with comic styling */}
          <div 
            className={`
              text-3xl font-black text-center ${config.textColor}
              uppercase tracking-wider
              drop-shadow-lg
            `}
            style={{
              textShadow: '3px 3px 0 rgba(0,0,0,0.3), -1px -1px 0 rgba(255,255,255,0.3)',
              fontFamily: 'Impact, Haettenschweiler, Arial Narrow Bold, sans-serif'
            }}
          >
            {text}
          </div>
          
          {/* Sender name */}
          <div className="text-center mt-2 text-white/80 text-sm font-medium">
            — {senderName}
          </div>
        </div>
        
        {/* Decorative action lines */}
        <div className="absolute -inset-4 pointer-events-none">
          {[...Array(8)].map((_, i) => (
            <div
              key={i}
              className="absolute w-1 h-8 bg-white/60 rounded-full"
              style={{
                left: '50%',
                top: '50%',
                transform: `rotate(${i * 45}deg) translateY(-80px)`,
                transformOrigin: 'center center',
              }}
            />
          ))}
        </div>
      </div>
    </div>
  );
}
