import { useState } from 'react';
import { DateTime } from 'luxon';
import { ChevronDown } from 'lucide-react';
import { DataCube3D } from '@/components/dashboard/DataCube3D';
import { QuickTasksSection } from '@/components/dashboard/QuickTasksSection';
import { ChecklistsGrid } from '@/components/dashboard/ChecklistsGrid';
import { TrainingAssignmentsSection } from '@/components/dashboard/TrainingAssignmentsSection';
import { PromoTrackerSection } from '@/components/dashboard/promo/PromoTrackerSection';
import { OvationScoreTab } from '@/components/dashboard/OvationScorePopover';
import { LocationPickerDialog } from '@/components/LocationPickerDialog';
import { useLocation as useAppLocation } from '@/hooks/useLocation';
import { TonightGauge } from './TonightGauge';
import type { DuoLabData } from './useDuoLabData';

type Variant = 'front' | 'full';

function TopBar({ d, variant }: { d: DuoLabData; variant: Variant }) {
  const { setCurrentLocation } = useAppLocation();
  const [pickerOpen, setPickerOpen] = useState(false);
  const [ovationOpen, setOvationOpen] = useState(false);
  const date = DateTime.now().setZone(d.timezone || 'America/Los_Angeles').toFormat('cccc, LLL d').toUpperCase();
  return (
    <div className="h-[58px] shrink-0 bg-primary text-primary-foreground flex items-center gap-3 px-3">
      <div className="w-[58px] shrink-0 flex flex-col items-center justify-center leading-none">
        {d.logo ? (
          <img src={d.logo} alt="" className="h-7 w-7 rounded-md object-contain bg-background/90 p-0.5" />
        ) : (
          <div className="h-7 w-7 rounded-md bg-primary-foreground/20" />
        )}
        <span className="mt-1 text-[10px] font-semibold truncate max-w-[58px]">{d.currentLocation?.name}</span>
      </div>
      <div className="min-w-0 flex-1">
        <div className="truncate whitespace-nowrap text-[11px] font-semibold tracking-wider opacity-85">{date}</div>
        <div className="text-2xl font-bold leading-tight">Dash</div>
      </div>
      {variant === 'front' && (
        <>
          <button
            type="button"
            onClick={() => setPickerOpen(true)}
            className="h-11 max-w-[120px] px-3 rounded-full bg-primary-foreground/15 text-sm font-semibold flex items-center gap-1"
          >
            <span className="truncate">{d.currentLocation?.name ?? 'Store'}</span>
            <ChevronDown className="h-4 w-4 shrink-0" />
          </button>
          <OvationScoreTab bare expanded={ovationOpen} onToggle={() => setOvationOpen(o => !o)} />
          <LocationPickerDialog
            open={pickerOpen}
            onOpenChange={setPickerOpen}
            currentLocationId={d.currentLocation?.id}
            onSelectLocation={(loc) => { setCurrentLocation(loc as any, '/duo-lab'); setPickerOpen(false); }}
          />
        </>
      )}
    </div>
  );
}

function Cubes({ d }: { d: DuoLabData }) {
  if (d.cubes.length === 0) return null;
  return (
    <div className="grid grid-cols-2 gap-3">
      {d.cubes.map(c => (
        <div key={c.id} className="aspect-square">
          <DataCube3D title={c.title} faces={c.faces} accentColor={c.accentColor} salesData={d.sales} isLoading={d.sales === null} />
        </div>
      ))}
    </div>
  );
}

function Checklists({ d }: { d: DuoLabData }) {
  return (
    <ChecklistsGrid
      checklists={d.checklists}
      getCompletionData={d.getCompletionData}
      timezone={d.timezone}
      trainingRemaining={d.trainingRemaining}
      trainingTotal={d.trainingTotal}
      trainingRows={
        <TrainingAssignmentsSection
          locationId={d.currentLocation?.id}
          userId={d.userId}
          timezone={d.timezone}
          canApprove={d.canApproveTraining}
        />
      }
    />
  );
}

/** Lab-only Dash layout. width = the screen width it lives in (frame or real Duo). */
export function DuoLabDash({ d, variant, width, colRight }: { d: DuoLabData; variant: Variant; width: number; colRight: number }) {
  const gauge = (large?: boolean) => (
    <TonightGauge
      large={large}
      salesSoFar={d.salesSoFar}
      projection={d.projection}
      pace={d.pace}
      laborPct={d.laborPct}
      behind={d.behind}
      caption={d.sentence}
    />
  );
  const quick = <QuickTasksSection locationSettings={d.locationSettings} timezone={d.timezone} />;

  if (variant === 'front') {
    return (
      <div className="h-full flex flex-col bg-background" style={{ paddingRight: colRight }}>
        <TopBar d={d} variant="front" />
        <div className="flex-1 overflow-y-auto p-3 space-y-3">
          {gauge()}
          {quick}
          <Cubes d={d} />
          <Checklists d={d} />
          <PromoTrackerSection />
        </div>
      </div>
    );
  }

  // Full: crease is a 40px gutter centered at 50% of the whole screen.
  const leftW = width / 2 - 20;
  return (
    <div className="h-full flex flex-col bg-background" style={{ paddingRight: colRight }}>
      <TopBar d={d} variant="full" />
      <div className="flex-1 min-h-0 grid" style={{ gridTemplateColumns: `${leftW}px 40px minmax(0,1fr)` }}>
        <div className="overflow-y-auto p-3 space-y-3 min-w-0" data-duo-lab-page="left">
          {gauge(true)}
          <Cubes d={d} />
        </div>
        <div aria-hidden="true" className="bg-muted/40" data-duo-lab-crease />
        <div className="overflow-y-auto p-3 space-y-3 min-w-0" data-duo-lab-page="right">
          {quick}
          <PromoTrackerSection />
          <Checklists d={d} />
        </div>
      </div>
    </div>
  );
}
