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
  return (
    <Popover>
      <PopoverTrigger asChild>
        <Button variant="ghost" size="sm" className="h-6 px-2">
          <Smile className="h-4 w-4" />
        </Button>
      </PopoverTrigger>
      <PopoverContent className="w-auto p-2" align="start">
        <div className="flex gap-1">
          {REACTIONS.map((reaction) => (
            <Button
              key={reaction.id}
              variant="ghost"
              size="sm"
              className="h-8 w-8 p-0 text-lg hover:scale-125 transition-transform"
              onClick={() => onSelect(reaction.id)}
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