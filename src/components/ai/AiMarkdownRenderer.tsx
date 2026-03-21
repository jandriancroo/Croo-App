import ReactMarkdown from 'react-markdown';
import remarkGfm from 'remark-gfm';
import type { Components } from 'react-markdown';
import { cn } from '@/lib/utils';

const markdownComponents: Components = {
  table: ({ children, ...props }) => (
    <div className="my-2 overflow-x-auto rounded-lg border border-border/50 bg-background/50">
      <table className="w-full text-xs" {...props}>
        {children}
      </table>
    </div>
  ),
  thead: ({ children, ...props }) => (
    <thead className="bg-muted/70 text-muted-foreground" {...props}>
      {children}
    </thead>
  ),
  tbody: ({ children, ...props }) => (
    <tbody className="divide-y divide-border/30" {...props}>
      {children}
    </tbody>
  ),
  tr: ({ children, ...props }) => (
    <tr className="transition-colors hover:bg-muted/30" {...props}>
      {children}
    </tr>
  ),
  th: ({ children, ...props }) => (
    <th
      className="px-2.5 py-1.5 text-left text-[11px] font-semibold uppercase tracking-wider text-muted-foreground whitespace-nowrap"
      {...props}
    >
      {children}
    </th>
  ),
  td: ({ children, ...props }) => (
    <td className="px-2.5 py-1.5 text-xs whitespace-nowrap" {...props}>
      {children}
    </td>
  ),
  ul: ({ children, ...props }) => (
    <ul className="my-1.5 ml-3 space-y-0.5 list-disc marker:text-primary/50" {...props}>
      {children}
    </ul>
  ),
  ol: ({ children, ...props }) => (
    <ol className="my-1.5 ml-3 space-y-0.5 list-decimal marker:text-primary/50" {...props}>
      {children}
    </ol>
  ),
  li: ({ children, ...props }) => (
    <li className="text-xs leading-relaxed pl-0.5" {...props}>
      {children}
    </li>
  ),
  h1: ({ children, ...props }) => (
    <h1 className="text-sm font-bold mt-3 mb-1.5 text-foreground" {...props}>{children}</h1>
  ),
  h2: ({ children, ...props }) => (
    <h2 className="text-[13px] font-semibold mt-2.5 mb-1 text-foreground" {...props}>{children}</h2>
  ),
  h3: ({ children, ...props }) => (
    <h3 className="text-xs font-semibold mt-2 mb-0.5 text-foreground" {...props}>{children}</h3>
  ),
  p: ({ children, ...props }) => (
    <p className="my-1 text-xs leading-relaxed" {...props}>{children}</p>
  ),
  strong: ({ children, ...props }) => (
    <strong className="font-semibold text-foreground" {...props}>{children}</strong>
  ),
  code: ({ children, className, ...props }) => {
    const isInline = !className;
    if (isInline) {
      return (
        <code className="rounded bg-muted px-1 py-0.5 text-[11px] font-mono text-primary" {...props}>
          {children}
        </code>
      );
    }
    return (
      <code className={cn("block rounded-lg bg-muted/70 p-2 text-[11px] font-mono overflow-x-auto my-1.5", className)} {...props}>
        {children}
      </code>
    );
  },
  hr: (props) => (
    <hr className="my-2 border-border/40" {...props} />
  ),
  blockquote: ({ children, ...props }) => (
    <blockquote className="my-1.5 border-l-2 border-primary/40 pl-2.5 text-xs italic text-muted-foreground" {...props}>
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
      <ReactMarkdown components={markdownComponents}>{content}</ReactMarkdown>
    </div>
  );
}
