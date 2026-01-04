import { Zap } from 'lucide-react';

interface SmackTalkMessageProps {
  text: string;
  senderName: string;
}

const SMACK_CONFIG: Record<string, { emoji: string; gradient: string }> = {
  'WOW!': { emoji: '🤯', gradient: 'from-yellow-500 to-orange-500' },
  'Boring...': { emoji: '😴', gradient: 'from-gray-400 to-gray-600' },
  'You Suck!': { emoji: '👎', gradient: 'from-red-500 to-pink-500' },
  'Blaze On!': { emoji: '🔥', gradient: 'from-orange-500 to-red-500' },
  'Try Again': { emoji: '🎮', gradient: 'from-blue-500 to-purple-500' },
  'Game Over': { emoji: '💀', gradient: 'from-purple-600 to-gray-900' },
};

export function SmackTalkMessage({ text, senderName }: SmackTalkMessageProps) {
  const config = SMACK_CONFIG[text] || { emoji: '⚡', gradient: 'from-primary to-primary/80' };

  return (
    <div className={`
      inline-flex items-center gap-2 px-4 py-2 rounded-xl
      bg-gradient-to-r ${config.gradient}
      text-white font-bold shadow-lg
      transform hover:scale-105 transition-transform
    `}>
      <span className="text-xl">{config.emoji}</span>
      <span className="uppercase tracking-wide text-sm">{text}</span>
      <Zap className="h-4 w-4 opacity-70" />
    </div>
  );
}
