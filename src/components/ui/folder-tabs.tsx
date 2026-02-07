import * as React from "react";
import { cn } from "@/lib/utils";

interface FolderTab {
  id: string;
  label: string;
  icon?: React.ReactNode;
}

interface FolderTabsProps {
  tabs: FolderTab[];
  activeTab: string;
  onTabChange: (tabId: string) => void;
  children: React.ReactNode;
  className?: string;
}

export function FolderTabs({
  tabs,
  activeTab,
  onTabChange,
  children,
  className,
}: FolderTabsProps) {
  return (
    <div className={cn("w-full", className)}>
      {/* Tab bar */}
      <div className="flex items-end relative">
        {tabs.map((tab, index) => {
          const isActive = tab.id === activeTab;
          
          return (
            <button
              key={tab.id}
              onClick={() => onTabChange(tab.id)}
              className={cn(
                "relative px-5 py-3 text-sm font-semibold transition-all duration-200",
                "rounded-t-xl min-w-[140px]",
                // Active tab styling - raised, connected, neumorphic
                isActive
                  ? "bg-card text-foreground -mb-[1px] z-20 border-t border-l border-r border-border/40"
                  : "bg-muted/50 text-muted-foreground hover:bg-muted/70 hover:text-foreground z-10 translate-y-[3px] border border-transparent",
                // Shadow for active tab only
                isActive && "shadow-[0_-4px_12px_-6px_rgba(0,0,0,0.15)]",
                // Overlap for folder effect
                index > 0 && "-ml-[2px]"
              )}
            >
              <span className="flex items-center gap-2 justify-center whitespace-nowrap">
                {tab.icon}
                {tab.label}
              </span>
            </button>
          );
        })}
        
        {/* Fill remaining space with subtle border continuation */}
        <div className="flex-1 border-b border-border/40 mb-[0px]" />
      </div>
      
      {/* Content area - neumorphic card that connects to active tab */}
      <div className="bg-card rounded-b-xl rounded-tr-xl border border-t-0 border-border/40 shadow-neumorphic p-5">
        {children}
      </div>
    </div>
  );
}

interface FolderTabContentProps {
  value: string;
  activeValue: string;
  children: React.ReactNode;
}

export function FolderTabContent({ value, activeValue, children }: FolderTabContentProps) {
  if (value !== activeValue) return null;
  return <>{children}</>;
}
