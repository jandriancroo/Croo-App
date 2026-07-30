import React from 'react';
import { UnreadAnnouncementsAlert } from '@/components/dashboard/UnreadAnnouncementsAlert';
import { PendingDocumentsCard } from '@/components/dashboard/PendingDocumentsCard';
import { I9UploadCard } from '@/components/dashboard/I9UploadCard';
import { OpusBackgroundSync } from '@/components/dashboard/OpusBackgroundSync';
import { AssignedTemporaryTasks } from '@/components/dashboard/AssignedTemporaryTasks';
import { CashHandlingTasks } from '@/components/dashboard/CashHandlingTasks';
import { DailySpotCheckTask } from '@/components/dashboard/DailySpotCheckTask';
import { CateringOrdersAlert } from '@/components/dashboard/CateringOrdersAlert';
import { PinMigrationTask } from '@/components/dashboard/PinMigrationTask';
import { DashSectionTitle } from '@/components/dashboard/DashSectionTitle';
import { FEATURE_FLAGS } from '@/config/featureFlags';

interface QuickTasksSectionProps {
  locationSettings: { hours_open: string; hours_close: string } | null | undefined;
  timezone: string;
}

export const QuickTasksSection = React.memo(function QuickTasksSection({
  locationSettings,
  timezone,
}: QuickTasksSectionProps) {
  return (
    <div className="quick-task-section flex flex-col gap-1 w-full">
      <DashSectionTitle>Quick Tasks</DashSectionTitle>
      <div className="quick-task-content flex flex-col gap-1 w-full">


        <UnreadAnnouncementsAlert />
        <PinMigrationTask />
        <PendingDocumentsCard />
        <I9UploadCard />
        {FEATURE_FLAGS.OPUS_ENABLED && <OpusBackgroundSync />}
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
        <CateringOrdersAlert />
      </div>
    </div>
  );
});
