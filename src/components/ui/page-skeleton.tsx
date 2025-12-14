import { Skeleton } from "@/components/ui/skeleton";
import { cn } from "@/lib/utils";

interface PageSkeletonProps {
  className?: string;
  variant?: "dashboard" | "list" | "grid" | "default";
}

export function PageSkeleton({ className, variant = "default" }: PageSkeletonProps) {
  if (variant === "dashboard") {
    return (
      <div className={cn("space-y-4 animate-fade-in", className)}>
        {/* Cards grid */}
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4">
          {[1, 2, 3].map((i) => (
            <Skeleton key={i} className="h-32 rounded-xl" />
          ))}
        </div>
        {/* Main content area */}
        <Skeleton className="h-48 rounded-xl" />
      </div>
    );
  }

  if (variant === "list") {
    return (
      <div className={cn("space-y-3 animate-fade-in", className)}>
        {[1, 2, 3, 4, 5].map((i) => (
          <Skeleton key={i} className="h-16 rounded-lg" />
        ))}
      </div>
    );
  }

  if (variant === "grid") {
    return (
      <div className={cn("grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4 animate-fade-in", className)}>
        {[1, 2, 3, 4, 5, 6].map((i) => (
          <Skeleton key={i} className="h-24 rounded-xl" />
        ))}
      </div>
    );
  }

  return (
    <div className={cn("space-y-4 animate-fade-in", className)}>
      <Skeleton className="h-8 w-48 rounded-lg" />
      <Skeleton className="h-32 rounded-xl" />
      <Skeleton className="h-24 rounded-xl" />
    </div>
  );
}
