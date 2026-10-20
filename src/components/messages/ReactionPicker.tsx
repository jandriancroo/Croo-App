import { useState } from 'react';
import { Button } from '@/components/ui/button';
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover';
import { Smile } from 'lucide-react';

interface ReactionPickerProps {
  onSelect: (reaction: string) => void;
}

const REACTIONS = [
  { id: 'thumbs_up', emoji: '👍', label: 'Thumbs up' },
  { id: 'thumbs_down', emoji: '👎', label: 'Thumbs down' },
  { id: 'smile', emoji: '😊', label: 'Smile' },
  { id: 'laugh', emoji: '😂', label: 'Laugh' },
  { id: 'heart', emoji: '❤️', label: 'Heart' },
  { id: 'fire', emoji: '🔥', label: 'Fire' },
];

export function ReactionPicker({ onSelect }: ReactionPickerProps) {
  const [open, setOpen] = useState(false);

  const handleSelect = (reactionId: string) => {
    onSelect(reactionId);
    setOpen(false);
  };

  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger asChild>
        <Button size="icon-sm" variant="ghost" className="">
          <Smile className="h-4 w-4" />
        </Button>
      </PopoverTrigger>
      <PopoverContent className="w-auto p-2" align="start">
        <div className="flex gap-1">
          {REACTIONS.map((reaction) => (
            <Button size="xs"
              key={reaction.id}
              variant="ghost"
              className="p-0 text-lg hover:scale-125 transition-transform"
              onClick={() => handleSelect(reaction.id)}
              title={reaction.label}
            >
              {reaction.emoji}
            </Button>
          ))}
        </div>
      </PopoverContent>
    </Popover>
  );
}
