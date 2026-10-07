import { useEffect, useLayoutEffect, useRef } from 'react';
import { cn } from '@/lib/utils';
import { parseTokens, findField, type SmartField } from '@/lib/smartFields';

interface Props {
  value: string;
  onChange: (value: string) => void;
  fields: SmartField[];
  /** Fields recognised as pills (default = fields). Pills not in `fields` show red: this target lacks them. */
  parseFields?: SmartField[];
  multiline?: boolean;
  maxLength?: number;
  placeholder?: string;
  ariaLabel: string;
  id?: string;
  className?: string;
}

const PILL_CLASS = 'inline-block rounded-full bg-primary/10 text-primary px-1.5 font-semibold mx-px select-none';
const BAD_PILL_CLASS = 'inline-block rounded-full bg-destructive/10 text-destructive px-1.5 font-semibold mx-px select-none';

function makePill(raw: string, label: string, bad = false) {
  const s = document.createElement('span');
  s.contentEditable = 'false';
  s.dataset.token = raw;
  s.dataset.raw = raw;
  s.className = bad ? BAD_PILL_CLASS : PILL_CLASS;
  s.textContent = label;
  if (bad) s.title = `This item doesn't have ${label}. Remove it.`;
  return s;
}

/** DOM -> plain text with the exact token text each pill came from. */
function serializeNode(root: Node): string {
  let out = '';
  root.childNodes.forEach((n, i) => {
    if (n.nodeType === Node.TEXT_NODE) out += n.textContent ?? '';
    else if (n instanceof HTMLElement) {
      if (n.dataset.raw !== undefined) out += n.dataset.raw;
      else if (n.tagName === 'BR') out += '\n';
      else {
        // Browser-made line wrappers (div/p) start a new line.
        if ((n.tagName === 'DIV' || n.tagName === 'P') && i > 0) out += '\n';
        out += serializeNode(n);
      }
    }
  });
  return out;
}

function renderInto(el: HTMLElement, text: string, parse: SmartField[], allowed: SmartField[]) {
  el.innerHTML = '';
  for (const seg of parseTokens(text, parse)) {
    if (seg.type === 'text') el.appendChild(document.createTextNode(seg.text));
    else el.appendChild(makePill(seg.raw, seg.label, !allowed.some((f) => f.token === seg.token)));
  }
}

export function SmartFieldEditor({ value, onChange, fields, parseFields, multiline = false, maxLength, placeholder, ariaLabel, id, className }: Props) {
  const ref = useRef<HTMLDivElement>(null);
  const lastEmitted = useRef<string | null>(null);
  const savedRange = useRef<Range | null>(null);
  const parse = parseFields ?? fields;

  // Re-render only when the value changed from outside (keeps the caret steady while typing).
  useLayoutEffect(() => {
    const el = ref.current;
    if (!el) return;
    if (value === lastEmitted.current && el.dataset.allowed === fields.map((f) => f.token).join()) return;
    renderInto(el, value, parse, fields);
    el.dataset.allowed = fields.map((f) => f.token).join();
    lastEmitted.current = value;
  }, [value, fields, parse]);

  useEffect(() => {
    const onSel = () => {
      const sel = window.getSelection();
      if (sel && sel.rangeCount && ref.current?.contains(sel.anchorNode)) savedRange.current = sel.getRangeAt(0).cloneRange();
    };
    document.addEventListener('selectionchange', onSel);
    return () => document.removeEventListener('selectionchange', onSel);
  }, []);

  const emit = () => {
    const el = ref.current;
    if (!el) return;
    const text = serializeNode(el);
    lastEmitted.current = text;
    onChange(text);
  };

  const rangeInEditor = (): Range => {
    const el = ref.current!;
    const sel = window.getSelection();
    if (sel && sel.rangeCount && el.contains(sel.anchorNode)) return sel.getRangeAt(0);
    if (savedRange.current && el.contains(savedRange.current.startContainer)) return savedRange.current;
    const r = document.createRange();
    r.selectNodeContents(el);
    r.collapse(false);
    return r;
  };

  const placeCaretAfter = (node: Node) => {
    const sel = window.getSelection();
    const r = document.createRange();
    r.setStartAfter(node);
    r.collapse(true);
    sel?.removeAllRanges();
    sel?.addRange(r);
    savedRange.current = r.cloneRange();
  };

  const insertNodes = (nodes: Node[]) => {
    const el = ref.current;
    if (!el || !nodes.length) return;
    el.focus();
    const r = rangeInEditor();
    r.deleteContents();
    const frag = document.createDocumentFragment();
    nodes.forEach((n) => frag.appendChild(n));
    const lastNode = nodes[nodes.length - 1];
    r.insertNode(frag);
    placeCaretAfter(lastNode);
    emit();
  };

  const nodesFromText = (text: string): Node[] =>
    parseTokens(text, parse).map((seg) => (seg.type === 'text' ? document.createTextNode(seg.text) : makePill(seg.raw, seg.label, !fields.some((f) => f.token === seg.token))));

  const insertField = (f: SmartField) => insertNodes([makePill(f.token, f.label)]);

  const pillBeside = (dir: 'back' | 'fwd'): HTMLElement | null => {
    const sel = window.getSelection();
    if (!sel || !sel.rangeCount || !sel.isCollapsed) return null;
    const { startContainer: c, startOffset: o } = sel.getRangeAt(0);
    let sib: Node | null = null;
    if (c.nodeType === Node.TEXT_NODE) {
      const len = c.textContent?.length ?? 0;
      if (dir === 'back' && o === 0) sib = c.previousSibling;
      if (dir === 'fwd' && o === len) sib = c.nextSibling;
    } else {
      sib = dir === 'back' ? c.childNodes[o - 1] ?? null : c.childNodes[o] ?? null;
    }
    return sib instanceof HTMLElement && sib.dataset.raw !== undefined ? sib : null;
  };

  const onKeyDown = (e: React.KeyboardEvent<HTMLDivElement>) => {
    if (e.key === 'Enter') {
      e.preventDefault();
      if (multiline) insertNodes([document.createTextNode('\n')]);
      return;
    }
    if (e.key === 'Backspace' || e.key === 'Delete') {
      const pill = pillBeside(e.key === 'Backspace' ? 'back' : 'fwd');
      if (pill) {
        e.preventDefault();
        const prev = pill.previousSibling;
        pill.remove();
        if (prev) placeCaretAfter(prev);
        emit();
      }
    }
  };

  const onPaste = (e: React.ClipboardEvent<HTMLDivElement>) => {
    e.preventDefault();
    let text = e.clipboardData.getData('text/plain').replace(/\r\n?/g, '\n');
    if (!multiline) text = text.replace(/\n+/g, ' ');
    insertNodes(nodesFromText(text));
  };

  const length = value.length;
  const over = maxLength != null && length > maxLength;

  return (
    <div className={cn('space-y-2', className)}>
      <div className="flex flex-wrap gap-1.5" aria-label="Insert a field">
        {fields.map((f) => (
          <button
            key={f.token}
            type="button"
            onMouseDown={(e) => e.preventDefault()}
            onClick={() => insertField(f)}
            className="rounded-full border border-border bg-muted/50 px-2.5 py-1 text-xs font-medium text-foreground hover:bg-muted"
          >
            + {f.label}
          </button>
        ))}
      </div>
      <div className="relative">
        <div
          ref={ref}
          id={id}
          role="textbox"
          aria-label={ariaLabel}
          aria-multiline={multiline}
          contentEditable
          suppressContentEditableWarning
          onInput={emit}
          onKeyDown={onKeyDown}
          onPaste={onPaste}
          onDrop={(e) => e.preventDefault()}
          className={cn(
            'w-full rounded-md border border-input bg-background px-3 py-2 text-sm ring-offset-background focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring whitespace-pre-wrap break-words',
            multiline ? 'min-h-[160px]' : 'min-h-10',
            over && 'border-destructive'
          )}
        />
        {!value && placeholder && (
          <div className="pointer-events-none absolute left-3 top-2 text-sm text-muted-foreground">{placeholder}</div>
        )}
      </div>
      {maxLength != null && (
        <div className={cn('text-right text-xs', over ? 'text-destructive' : 'text-muted-foreground')}>{length}/{maxLength}</div>
      )}
    </div>
  );
}

/** Read-only text with fields shown as pills (never braces). */
export function SmartFieldPreview({ text, fields, className }: { text: string; fields: SmartField[]; className?: string }) {
  return (
    <span className={cn('whitespace-pre-wrap', className)}>
      {parseTokens(text, fields).map((s, i) =>
        s.type === 'text' ? <span key={i}>{s.text}</span> : <span key={i} className={PILL_CLASS}>{s.label}</span>
      )}
    </span>
  );
}

export { findField };
