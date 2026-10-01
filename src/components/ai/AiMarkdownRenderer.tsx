import ReactMarkdown from 'react-markdown';
import remarkGfm from 'remark-gfm';
import type { Components } from 'react-markdown';
import { cn } from '@/lib/utils';
import { User } from 'lucide-react';
import React from 'react';

type HastNode = {
  type?: string;
  tagName?: string;
  value?: string;
  children?: HastNode[];
};

function nodeText(node: HastNode | undefined): string {
  if (!node) return '';
  if (node.type === 'text') return node.value || '';
  return (node.children || []).map(nodeText).reduce((text, part) => {
    const needsSpace = /[A-Za-z0-9]$/.test(text) && /^[A-Za-z0-9]/.test(part);
    return `${text}${needsSpace ? ' ' : ''}${part}`;
  }, '');
}

function getTwoColumnRows(node: HastNode | undefined): Array<[string, string]> | null {
  const sections = node?.children?.filter((child) => child.type === 'element') || [];
  const rowNodes = sections.flatMap((section) =>
    section.tagName === 'tr'
      ? [section]
      : (section.children || []).filter((child) => child.tagName === 'tr')
  );
  if (rowNodes.length < 2) return null;
  const rows = rowNodes.map((row) =>
    (row.children || []).filter((child) => child.tagName === 'th' || child.tagName === 'td')
  );
  if (rows.some((row) => row.length !== 2)) return null;
  return rows.slice(1).map((row) => [nodeText(row[0]).replace(/\*\*/g, '').trim(), nodeText(row[1]).trim()]);
}

// Parse [[employee:Name]] tags in text and render as badges
function renderWithEmployeeBadges(text: string): React.ReactNode[] {
  const parts = text.split(/(\[\[employee:[^\]]+\]\])/g);
  return parts.map((part, i) => {
    const match = part.match(/^\[\[employee:(.+)\]\]$/);
    if (match) {
      return (
        <span
          key={i}
          className="inline-flex items-center gap-1 px-1.5 py-0.5 rounded-md bg-blue-500/15 text-blue-400 text-[11px] font-semibold border border-blue-500/20 mx-0.5 whitespace-nowrap"
        >
          <User className="h-2.5 w-2.5" />
          {match[1]}
        </span>
      );
    }
    return <React.Fragment key={i}>{part}</React.Fragment>;
  });
}

// Wrap a component to process employee tags in its text children
function withEmployeeBadges(children: React.ReactNode): React.ReactNode {
  return React.Children.map(children, (child) => {
    if (typeof child === 'string') {
      if (child.includes('[[employee:')) {
        return <>{renderWithEmployeeBadges(child)}</>;
      }
      return child;
    }
    if (React.isValidElement(child) && child.props.children) {
      return React.cloneElement(child as React.ReactElement<any>, {
        children: withEmployeeBadges(child.props.children),
      });
    }
    return child;
  });
}

const markdownComponents: Components = {
  table: ({ children, node, ...props }) => {
    const tileRows = getTwoColumnRows(node as HastNode | undefined);
    if (tileRows) {
      return (
        <div className="mt-2 flex flex-wrap gap-2">
          {tileRows.map(([label, value], index) => {
            const isLong = value.length > 12;
            return (
              <div
                key={`${label}-${index}`}
                className={cn(
                  'min-w-0 rounded-xl bg-background px-3 py-2.5',
                  isLong ? 'basis-full' : 'flex-[1_1_calc(33.333%-0.5rem)]'
                )}
              >
                <div className="text-[11px] font-semibold text-muted-foreground">{label}</div>
                <div className={cn(
                  'tabular-nums text-foreground',
                  isLong ? 'text-sm font-semibold leading-[1.4] whitespace-normal' : 'text-[18px] font-bold leading-[1.3]'
                )}>
                  {value}
                </div>
              </div>
            );
          })}
        </div>
      );
    }
    return (
      <div className="my-2.5 overflow-x-auto rounded-xl border border-border/40 bg-card/80 shadow-sm">
        <table className="w-full text-xs" {...props}>{children}</table>
      </div>
    );
  },
  thead: ({ children, ...props }) => (
    <thead className="bg-muted/50 text-muted-foreground" {...props}>
      {children}
    </thead>
  ),
  tbody: ({ children, ...props }) => (
    <tbody className="divide-y divide-border/20" {...props}>
      {children}
    </tbody>
  ),
  tr: ({ children, ...props }) => (
    <tr className="transition-colors hover:bg-muted/20" {...props}>
      {children}
    </tr>
  ),
  th: ({ children, ...props }) => (
    <th
      className="px-2.5 py-2 text-left text-[11px] font-semibold uppercase tracking-wider text-muted-foreground whitespace-nowrap"
      {...props}
    >
      {children}
    </th>
  ),
  td: ({ children, ...props }) => (
    <td className="px-2.5 py-2 text-xs whitespace-nowrap" {...props}>
      {withEmployeeBadges(children)}
    </td>
  ),
  ul: ({ children, ...props }) => (
    <ul className="mt-2 list-none space-y-1.5 pl-0 [&_ul]:mt-1.5 [&_ul>li]:before:bg-primary/50" {...props}>
      {children}
    </ul>
  ),
  ol: ({ children, ...props }) => (
    <ol className="mt-2 list-decimal space-y-1.5 pl-5 text-sm leading-[1.6] marker:font-bold marker:text-primary [&>li]:pl-0 [&>li]:before:hidden" {...props}>
      {children}
    </ol>
  ),
  li: ({ children, ...props }) => (
    <li className="relative pl-4 text-sm leading-[1.6] before:absolute before:left-0 before:top-[9px] before:h-1.5 before:w-1.5 before:rounded-full before:bg-primary" {...props}>
      {withEmployeeBadges(children)}
    </li>
  ),
  h1: ({ children, ...props }) => (
    <h1 {...props}>{children}</h1>
  ),
  h2: ({ children, ...props }) => (
    <h2 {...props}>{children}</h2>
  ),
  h3: ({ children, ...props }) => (
    <h3 {...props}>{children}</h3>
  ),
  p: ({ children, ...props }) => (
    <p className="mt-3 text-sm leading-[1.6]" {...props}>{withEmployeeBadges(children)}</p>
  ),
  strong: ({ children, ...props }) => (
    <strong className="font-bold text-foreground" {...props}>{withEmployeeBadges(children)}</strong>
  ),
  code: ({ children, className, ...props }) => {
    const isInline = !className;
    if (isInline) {
      return (
        <code className="rounded-md bg-primary/8 px-1.5 py-0.5 text-[11px] font-mono text-primary border border-primary/10" {...props}>
          {children}
        </code>
      );
    }
    return (
      <code className={cn("block rounded-xl bg-muted/60 p-3 text-[11px] font-mono overflow-x-auto my-2 border border-border/30", className)} {...props}>
        {children}
      </code>
    );
  },
  hr: (props) => (
    <hr className="mt-4 border-t border-muted" {...props} />
  ),
  blockquote: ({ children, ...props }) => (
    <blockquote className="my-2 border-l-2 border-primary/30 pl-3 text-xs italic text-muted-foreground bg-primary/3 rounded-r-lg py-1" {...props}>
      {children}
    </blockquote>
  ),
};

interface AiMarkdownRendererProps {
  content: string;
}

export function AiMarkdownRenderer({ content }: AiMarkdownRendererProps) {
  return (
    <div className="ai-markdown max-w-none text-foreground [&>*:first-child]:mt-0 [&>p:first-child]:text-[15px] [&>p:first-child]:leading-[1.5]">
      <ReactMarkdown remarkPlugins={[remarkGfm]} components={markdownComponents}>{content}</ReactMarkdown>
    </div>
  );
}