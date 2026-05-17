import { useRef } from 'react';
import { Textarea } from '@/components/ui/textarea';
import { Button } from '@/components/ui/button';
import { List, ListOrdered } from 'lucide-react';

interface NotesTextareaProps {
  value: string;
  onChange: (value: string) => void;
  placeholder?: string;
  rows?: number;
  className?: string;
}

/**
 * Textarea with tiny toolbar buttons that prepend "- " or "1. " to the
 * current line (or each selected line). Stored as plain text — renders
 * as-is anywhere we use `whitespace-pre-wrap`.
 */
export function NotesTextarea({ value, onChange, placeholder, rows = 2, className }: NotesTextareaProps) {
  const ref = useRef<HTMLTextAreaElement>(null);

  const applyListPrefix = (mode: 'bullet' | 'number') => {
    const el = ref.current;
    if (!el) return;
    const text = value || '';
    const selStart = el.selectionStart ?? text.length;
    const selEnd = el.selectionEnd ?? text.length;

    // Expand selection to full lines
    const lineStart = text.lastIndexOf('\n', selStart - 1) + 1;
    const nextNewline = text.indexOf('\n', selEnd);
    const lineEnd = nextNewline === -1 ? text.length : nextNewline;

    const before = text.slice(0, lineStart);
    const middle = text.slice(lineStart, lineEnd);
    const after = text.slice(lineEnd);

    const lines = middle.split('\n');
    let counter = 1;
    const newLines = lines.map((line) => {
      // Strip existing list prefix to allow toggling between styles
      const stripped = line.replace(/^(\s*)(?:[-•]\s+|\d+\.\s+)/, '$1');
      if (mode === 'bullet') return `- ${stripped}`;
      const out = `${counter}. ${stripped}`;
      counter += 1;
      return out;
    });

    const newMiddle = newLines.join('\n');
    const newText = before + newMiddle + after;
    onChange(newText);

    // Restore focus + selection over the modified block
    requestAnimationFrame(() => {
      el.focus();
      const newEnd = before.length + newMiddle.length;
      el.setSelectionRange(before.length, newEnd);
    });
  };

  return (
    <div className="space-y-1">
      <div className="flex items-center gap-1">
        <Button
          type="button"
          variant="ghost"
          size="icon"
          className="h-6 w-6"
          onClick={() => applyListPrefix('bullet')}
          title="Bulleted list"
        >
          <List className="h-3.5 w-3.5" />
        </Button>
        <Button
          type="button"
          variant="ghost"
          size="icon"
          className="h-6 w-6"
          onClick={() => applyListPrefix('number')}
          title="Numbered list"
        >
          <ListOrdered className="h-3.5 w-3.5" />
        </Button>
      </div>
      <Textarea
        ref={ref}
        value={value}
        onChange={(e) => onChange(e.target.value)}
        placeholder={placeholder}
        rows={rows}
        className={className}
      />
    </div>
  );
}
