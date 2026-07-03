import React from 'react';

interface DashSectionTitleProps {
  children: React.ReactNode;
  action?: React.ReactNode;
  className?: string;
}

/**
 * Text-based section label used across the Dash page (QUICK TASKS,
 * CUBES, CHECKLISTS, SUMMARY, PROMO). Small uppercase muted title.
 */
export const DashSectionTitle = React.memo(function DashSectionTitle({
  children,
  action,
  className,
}: DashSectionTitleProps) {
  return (
    <div className={`dash-section-title ${className ?? ''}`}>
      <span className="dash-section-title__label">{children}</span>
      {action ? <span className="dash-section-title__action">{action}</span> : null}
    </div>
  );
});
