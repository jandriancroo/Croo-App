import { useState } from 'react';
import { Button } from '@/components/ui/button';
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover';
import { Zap } from 'lucide-react';

interface SmackTalkPickerProps {
  onSelect: (smackTalk: string) => void;
  disabled?: boolean;
}

const SMACK_TALKS = [
  { text: 'WOW!', emoji: '🤯', color: 'from-yellow-500 to-orange-500' },
  { text: 'Boring...', emoji: '😴', color: 'from-gray-400 to-gray-600' },
  { text: 'You Suck!', emoji: '👎', color: 'from-red-500 to-pink-500' },
  { text: 'Blaze On!', emoji: '🔥', color: 'from-orange-500 to-red-500' },
  { text: 'Try Again', emoji: '🎮', color: 'from-blue-500 to-purple-500' },
  { text: 'Game Over', emoji: '💀', color: 'from-purple-600 to-black' },
];

export function SmackTalkPicker({ onSelect, disabled }: SmackTalkPickerProps) {
  const [open, setOpen] = useState(false);

  const handleSelect = (text: string) => {
    onSelect(text);
    setOpen(false);
  };

  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger asChild>
        <Button
          type="button"
          variant="ghost"
          size="icon"
          className="h-10 w-10 text-primary hover:bg-primary/10"
          disabled={disabled}
          title="Smack Talk"
        >
          <Zap className="h-5 w-5" />
        </Button>
      </PopoverTrigger>
      <PopoverContent className="w-72 p-3" align="start">
        <div className="space-y-2">
          <p className="text-sm font-semibold text-center mb-3">⚡ Smack Talk!</p>
          <div className="grid grid-cols-2 gap-2">
            {SMACK_TALKS.map((smack) => (
              <button
                key={smack.text}
                onClick={() => handleSelect(smack.text)}
                className={`
                  relative overflow-hidden rounded-lg p-3 text-center font-bold text-white
                  bg-gradient-to-br ${smack.color}
                  transform transition-all duration-200
                  hover:scale-105 hover:shadow-lg
                  active:scale-95
                `}
              >
                <span className="text-lg">{smack.emoji}</span>
                <span className="block text-xs mt-1 uppercase tracking-wide">{smack.text}</span>
              </button>
            ))}
          </div>
        </div>
      </PopoverContent>
    </Popover>
  );
}
