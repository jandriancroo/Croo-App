import * as React from "react";
import { memo, useCallback } from "react";
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

// Memoized tab button to prevent re-renders
const TabButton = memo(function TabButton({
  tab,
  isActive,
  index,
  onClick,
}: {
  tab: FolderTab;
  isActive: boolean;
  index: number;
  onClick: () => void;
}) {
  return (
    <button
      onClick={onClick}
      className={cn(
        "relative px-5 py-3 text-sm font-semibold transition-colors duration-150",
        "rounded-t-xl min-w-[140px]",
        isActive
          ? "bg-card text-foreground -mb-[1px] z-20 border-t border-l border-r border-border/40 shadow-[0_-4px_12px_-6px_rgba(0,0,0,0.15)]"
          : "bg-muted/50 text-muted-foreground hover:bg-muted/70 hover:text-foreground z-10 translate-y-[3px] border border-transparent",
        index > 0 && "-ml-[2px]"
      )}
    >
      <span className="flex items-center gap-2 justify-center whitespace-nowrap">
        {tab.icon}
        {tab.label}
      </span>
    </button>
  );
});

export const FolderTabs = memo(function FolderTabs({
  tabs,
  activeTab,
  onTabChange,
  children,
  className,
}: FolderTabsProps) {
  const handleTabClick = useCallback((tabId: string) => {
    onTabChange(tabId);
  }, [onTabChange]);

  return (
    <div className={cn("w-full", className)}>
      {/* Tab bar */}
      <div className="flex items-end relative">
        {tabs.map((tab, index) => (
          <TabButton
            key={tab.id}
            tab={tab}
            isActive={tab.id === activeTab}
            index={index}
            onClick={() => handleTabClick(tab.id)}
          />
        ))}
        
        {/* Fill remaining space with subtle border continuation */}
        <div className="flex-1 border-b border-border/40 mb-[0px]" />
      </div>
      
      {/* Content area - neumorphic card that connects to active tab */}
      <div className="bg-card rounded-b-xl rounded-tr-xl border border-t-0 border-border/40 shadow-neumorphic p-5">
        {children}
      </div>
    </div>
  );
});

interface FolderTabContentProps {
  value: string;
  activeValue: string;
  children: React.ReactNode;
  /** Keep content mounted but hidden for faster switching (default: false) */
  keepMounted?: boolean;
}

export const FolderTabContent = memo(function FolderTabContent({ 
  value, 
  activeValue, 
  children,
  keepMounted = false,
}: FolderTabContentProps) {
  const isActive = value === activeValue;
  
  // For heavy content, use CSS visibility instead of unmounting
  if (keepMounted) {
    return (
      <div 
        className={isActive ? "block" : "hidden"}
        aria-hidden={!isActive}
      >
        {children}
      </div>
    );
  }
  
  // Default: unmount inactive tabs (lighter content)
  if (!isActive) return null;
  return <>{children}</>;
});
