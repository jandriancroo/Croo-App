import { cn } from '@/lib/utils';

export const REACTION_EMOJIS = ['👍', '❤️', '🔥', '🎉', '😂', '👏'] as const;

interface ReactionBarProps {
  reactions: { emoji: string; count: number; mine: boolean }[];
  onToggle: (emoji: string, mine: boolean) => void;
  compact?: boolean;
}

export function ReactionBar({ reactions, onToggle, compact }: ReactionBarProps) {
  // Merge existing reactions with the preset row so users can add new ones
  const byEmoji = new Map(reactions.map(r => [r.emoji, r]));
  const shown = REACTION_EMOJIS.map(e => byEmoji.get(e) ?? { emoji: e, count: 0, mine: false });
  // Include any custom emojis not in preset (future-proof)
  for (const r of reactions) if (!REACTION_EMOJIS.includes(r.emoji as any)) shown.push(r);

  return (
    <div className={cn('flex flex-wrap items-center gap-1.5', compact && 'gap-1')}>
      {shown.map(r => (
        <button
          key={r.emoji}
          type="button"
          onClick={(e) => {
            e.stopPropagation();
            onToggle(r.emoji, r.mine);
          }}
          className={cn(
            'inline-flex items-center gap-1 rounded-full border transition-all active:scale-95',
            compact ? 'h-7 px-2 text-xs' : 'h-8 px-2.5 text-sm',
            r.mine
              ? 'border-primary bg-primary/10 text-primary'
              : r.count > 0
              ? 'border-border bg-muted/60 hover:bg-muted'
              : 'border-transparent bg-transparent text-muted-foreground hover:bg-muted/60'
          )}
          aria-label={`React with ${r.emoji}`}
        >
          <span className="text-base leading-none">{r.emoji}</span>
          {r.count > 0 && <span className="tabular-nums font-medium">{r.count}</span>}
        </button>
      ))}
    </div>
  );
}
