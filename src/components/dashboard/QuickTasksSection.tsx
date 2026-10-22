import React from 'react';
import { useReadAndSignRows } from '@/components/dashboard/PendingDocumentsCard';
import { useI9UploadRows } from '@/components/dashboard/I9UploadCard';
import { OpusBackgroundSync } from '@/components/dashboard/OpusBackgroundSync';
import { AssignedTemporaryTasks } from '@/components/dashboard/AssignedTemporaryTasks';
import { useCashHandlingRows } from '@/components/dashboard/CashHandlingTasks';
import { useDailySpotCheckRow } from '@/components/dashboard/DailySpotCheckTask';
import { usePinMigrationRow } from '@/components/dashboard/PinMigrationTask';
import { DashSectionTitle } from '@/components/dashboard/DashSectionTitle';
import { FEATURE_FLAGS } from '@/config/featureFlags';

interface QuickTasksSectionProps {
  locationSettings: { hours_open: string; hours_close: string } | null | undefined;
  timezone: string;
}

/** Dash "Tasks": every quick task (PIN, I-9, Read & Sign, temp tasks, events, catering, cash, spot check) is a row in one card. */
export const QuickTasksSection = React.memo(function QuickTasksSection({
  locationSettings,
  timezone,
}: QuickTasksSectionProps) {
  const hours = locationSettings ?? null;
  const pin = usePinMigrationRow();
  const i9 = useI9UploadRows();
  const docs = useReadAndSignRows();
  const cash = useCashHandlingRows({ locationHours: hours, timezone });
  const spot = useDailySpotCheckRow({ locationHours: hours, timezone });
  const extraRows = [...pin.rows, ...i9.rows, ...docs.rows, ...cash, ...spot.rows];

  return (
    <div className="quick-task-section flex flex-col gap-2 w-full">
      <DashSectionTitle>Tasks</DashSectionTitle>
      <div className="quick-task-content flex flex-col gap-1 w-full">
        {FEATURE_FLAGS.OPUS_ENABLED && <OpusBackgroundSync />}
        <AssignedTemporaryTasks
          compact
          includeEventTasks
          includeCateringOrders
          sectioned
          showCompleted
          extraRows={extraRows}
        />
      </div>
      {pin.overlay}
      {i9.overlay}
      {docs.overlay}
      {spot.overlay}
    </div>
  );
});
