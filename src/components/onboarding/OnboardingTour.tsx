import { useEffect, useRef } from 'react';
import { Joyride, STATUS, EVENTS, type EventData, type Controls, type Step } from 'react-joyride';
import { useUserRole } from '@/hooks/useUserRole';
import { getTourStepsForRole } from './tourSteps';
import { openMenuForTour, closeMenuForTour } from './tourMenuBridge';

interface OnboardingTourProps {
  run: boolean;
  onComplete: (skipped: boolean) => void;
}

export function OnboardingTour({ run, onComplete }: OnboardingTourProps) {
  const { role } = useUserRole();
  const steps = getTourStepsForRole(role) as Step[];
  const menuOpenedByTour = useRef(false);

  // Close menu if tour stops while we opened it
  useEffect(() => {
    return () => {
      if (menuOpenedByTour.current) {
        closeMenuForTour();
        menuOpenedByTour.current = false;
      }
    };
  }, []);

  const handleEvent = (data: EventData, _controls: Controls) => {
    const { status, type, step } = data as EventData & { step?: Step };

    // Before showing a step, open/close the menu as needed
    if (type === EVENTS.STEP_BEFORE && step) {
      const needsMenu = (step as any).data?.requiresMenu;
      if (needsMenu) {
        openMenuForTour();
        menuOpenedByTour.current = true;
      } else if (menuOpenedByTour.current) {
        closeMenuForTour();
        menuOpenedByTour.current = false;
      }
    }

    if (status === STATUS.FINISHED) {
      if (menuOpenedByTour.current) {
        closeMenuForTour();
        menuOpenedByTour.current = false;
      }
      onComplete(false);
    } else if (status === STATUS.SKIPPED) {
      if (menuOpenedByTour.current) {
        closeMenuForTour();
        menuOpenedByTour.current = false;
      }
      onComplete(true);
    }
  };

  if (!steps.length) return null;

  return (
    <Joyride
      steps={steps}
      run={run}
      continuous
      scrollToFirstStep
      onEvent={handleEvent}
      options={{
        overlayColor: 'rgba(0, 0, 0, 0.6)',
        primaryColor: 'hsl(150, 40%, 40%)',
        zIndex: 10000,
      }}
    />
  );
}
