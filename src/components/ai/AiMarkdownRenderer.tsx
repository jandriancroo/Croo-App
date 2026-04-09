import ReactMarkdown from 'react-markdown';
import remarkGfm from 'remark-gfm';
import type { Components } from 'react-markdown';
import { cn } from '@/lib/utils';
import { User } from 'lucide-react';
import React from 'react';

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
  table: ({ children, ...props }) => (
    <div className="my-2.5 overflow-x-auto rounded-xl border border-border/40 bg-card/80 shadow-sm">
      <table className="w-full text-xs" {...props}>
        {children}
      </table>
    </div>
  ),
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
    <ul className="my-1.5 ml-3.5 space-y-1 list-disc marker:text-primary/40" {...props}>
      {children}
    </ul>
  ),
  ol: ({ children, ...props }) => (
    <ol className="my-1.5 ml-3.5 space-y-1 list-decimal marker:text-primary/40" {...props}>
      {children}
    </ol>
  ),
  li: ({ children, ...props }) => (
    <li className="text-xs leading-relaxed pl-0.5" {...props}>
      {withEmployeeBadges(children)}
    </li>
  ),
  h1: ({ children, ...props }) => (
    <h1 className="text-sm font-bold mt-3 mb-1.5 text-foreground tracking-tight" {...props}>{children}</h1>
  ),
  h2: ({ children, ...props }) => (
    <h2 className="text-[13px] font-semibold mt-2.5 mb-1 text-foreground tracking-tight" {...props}>{children}</h2>
  ),
  h3: ({ children, ...props }) => (
    <h3 className="text-xs font-semibold mt-2 mb-0.5 text-foreground" {...props}>{children}</h3>
  ),
  p: ({ children, ...props }) => (
    <p className="my-1 text-xs leading-[1.6]" {...props}>{withEmployeeBadges(children)}</p>
  ),
  strong: ({ children, ...props }) => (
    <strong className="font-semibold text-foreground" {...props}>{withEmployeeBadges(children)}</strong>
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
    <hr className="my-2.5 border-border/30" {...props} />
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
    <div className="ai-markdown max-w-none">
      <ReactMarkdown remarkPlugins={[remarkGfm]} components={markdownComponents}>{content}</ReactMarkdown>
    </div>
  );
}