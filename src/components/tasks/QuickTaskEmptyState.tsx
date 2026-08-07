import { Plus, ArrowRight, Zap } from "lucide-react";

const EXAMPLES: { what: string; who: string; then: string }[] = [
  { what: "Check lobby for trash", who: "Johnny Appleseed", then: "Send notification" },
  { what: "Restock cold case", who: "Opening crew", then: "Photo proof" },
  { what: "Call vendor about order", who: "Shift manager", then: "Due 4:00 PM" },
];

/**
 * Faint "formula" style illustration teaching what a quick task can be.
 * Purely presentational.
 */
export function QuickTaskEmptyState({ onCreate }: { onCreate?: () => void }) {
  return (
    <div className="py-8 px-3 select-none">
      <div className="mx-auto max-w-md space-y-3">
        {EXAMPLES.map((ex, i) => (
          <div
            key={ex.what}
            className="flex flex-wrap items-center justify-center gap-x-2 gap-y-1 text-[11px] sm:text-xs font-mono text-muted-foreground/45"
            style={{ opacity: 1 - i * 0.22 }}
          >
            <span className="rounded-md border border-dashed border-muted-foreground/25 px-2 py-1">
              {ex.what}
            </span>
            <Plus className="h-3 w-3 shrink-0 text-muted-foreground/35" />
            <span className="rounded-md border border-dashed border-muted-foreground/25 px-2 py-1">
              {ex.who}
            </span>
            <ArrowRight className="h-3 w-3 shrink-0 text-muted-foreground/35" />
            <span className="rounded-md border border-dashed border-muted-foreground/25 px-2 py-1">
              {ex.then}
            </span>
          </div>
        ))}

        <div className="pt-3 text-center">
          <p className="text-xs text-muted-foreground/70">
            No active quick tasks — mix a task, a person, and what happens next.
          </p>
          {onCreate && (
            <button
              type="button"
              onClick={onCreate}
              className="mt-2 inline-flex items-center gap-1.5 text-xs font-medium text-primary hover:underline"
            >
              <Zap className="h-3.5 w-3.5" />
              Create quick task
            </button>
          )}
        </div>
      </div>
    </div>
  );
}
