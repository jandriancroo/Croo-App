import React from 'react';
import { UnreadAnnouncementsAlert } from '@/components/dashboard/UnreadAnnouncementsAlert';
import { PendingDocumentsCard } from '@/components/dashboard/PendingDocumentsCard';
import { I9UploadCard } from '@/components/dashboard/I9UploadCard';
import { OpusBackgroundSync } from '@/components/dashboard/OpusBackgroundSync';
import { AssignedTemporaryTasks } from '@/components/dashboard/AssignedTemporaryTasks';
import { CashHandlingTasks } from '@/components/dashboard/CashHandlingTasks';
import { DailySpotCheckTask } from '@/components/dashboard/DailySpotCheckTask';
import { DataStreamTask } from '@/components/dashboard/DataStreamTask';
import { CateringOrdersAlert } from '@/components/dashboard/CateringOrdersAlert';

interface QuickTasksSectionProps {
  locationSettings: { hours_open: string; hours_close: string } | null | undefined;
  timezone: string;
}

export const QuickTasksSection = React.memo(function QuickTasksSection({ 
  locationSettings, 
  timezone 
}: QuickTasksSectionProps) {
  return (
    <div className="flex flex-col gap-2 w-full">
      <UnreadAnnouncementsAlert />
      <PendingDocumentsCard />
      <I9UploadCard />
      <OpusBackgroundSync />
      <AssignedTemporaryTasks
        compact
        includeEventTasks
        afterEventsContent={
          <>
            <CashHandlingTasks locationHours={locationSettings} timezone={timezone} />
            <DailySpotCheckTask locationHours={locationSettings} timezone={timezone} />
          </>
        }
      />
      <DataStreamTask />
      <CateringOrdersAlert />
    </div>
  );
});
