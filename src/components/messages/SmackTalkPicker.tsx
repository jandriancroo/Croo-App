import { useState } from 'react';
import { Button } from '@/components/ui/button';
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover';
import { Zap } from 'lucide-react';

import wowImage from '@/assets/smack-talk/wow.png';
import boringImage from '@/assets/smack-talk/boring.png';
import youSuckImage from '@/assets/smack-talk/you-suck.png';
import blazeOnImage from '@/assets/smack-talk/blaze-on.png';
import tryAgainImage from '@/assets/smack-talk/try-again.png';
import gameOverImage from '@/assets/smack-talk/game-over.png';

interface SmackTalkPickerProps {
  onSelect: (smackTalk: string) => void;
  disabled?: boolean;
}

export const SMACK_TALK_IMAGES: Record<string, string> = {
  'WOW!': wowImage,
  'Boring...': boringImage,
  'You Suck!': youSuckImage,
  'Blaze On!': blazeOnImage,
  'Try Again': tryAgainImage,
  'Game Over': gameOverImage,
};

const SMACK_TALKS = [
  { text: 'WOW!', image: wowImage },
  { text: 'Boring...', image: boringImage },
  { text: 'You Suck!', image: youSuckImage },
  { text: 'Blaze On!', image: blazeOnImage },
  { text: 'Try Again', image: tryAgainImage },
  { text: 'Game Over', image: gameOverImage },
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
          size="sm"
          className="h-6 px-2 text-primary hover:bg-primary/10"
          disabled={disabled}
          title="Smack Talk"
        >
          <Zap className="h-4 w-4" />
        </Button>
      </PopoverTrigger>
      <PopoverContent className="w-80 p-3" align="start">
        <div className="space-y-2">
          <p className="text-sm font-semibold text-center mb-3">⚡ Smack Talk!</p>
          <div className="grid grid-cols-3 gap-2">
            {SMACK_TALKS.map((smack) => (
              <button
                key={smack.text}
                onClick={() => handleSelect(smack.text)}
                className="relative overflow-hidden rounded-lg p-1 transform transition-all duration-200 hover:scale-110 active:scale-95"
              >
                <img 
                  src={smack.image} 
                  alt={smack.text}
                  className="w-full h-auto rounded"
                />
              </button>
            ))}
          </div>
        </div>
      </PopoverContent>
    </Popover>
  );
}
