import { useEffect, useRef, useState } from 'react';
import { Joyride, STATUS, EVENTS, ACTIONS, type EventData, type Controls, type Step } from 'react-joyride';
import { useUserRole } from '@/hooks/useUserRole';
import { getTourStepsForRole } from './tourSteps';
import { openMenuForTour, closeMenuForTour } from './tourMenuBridge';

interface OnboardingTourProps {
  run: boolean;
  onComplete: (skipped: boolean) => void;
}

const MENU_ANIMATION_MS = 350;
const MENU_CLOSE_MS = 150;

export function OnboardingTour({ run, onComplete }: OnboardingTourProps) {
  const { role } = useUserRole();
  const steps = getTourStepsForRole(role) as Step[];
  const [stepIndex, setStepIndex] = useState(0);
  const menuOpenedByTour = useRef(false);
  const transitionTimer = useRef<number | null>(null);

  const clearTransitionTimer = () => {
    if (transitionTimer.current !== null) {
      window.clearTimeout(transitionTimer.current);
      transitionTimer.current = null;
    }
  };

  const cleanupMenu = () => {
    clearTransitionTimer();
    if (menuOpenedByTour.current) {
      closeMenuForTour();
      menuOpenedByTour.current = false;
    }
  };

  const goToStep = (nextIndex: number) => {
    if (nextIndex < 0) {
      setStepIndex(0);
      return;
    }

    if (nextIndex >= steps.length) {
      cleanupMenu();
      onComplete(false);
      return;
    }

    clearTransitionTimer();

    const needsMenu = Boolean((steps[nextIndex] as Step & { data?: { requiresMenu?: boolean } }).data?.requiresMenu);

    if (needsMenu) {
      openMenuForTour();
      menuOpenedByTour.current = true;
      transitionTimer.current = window.setTimeout(() => {
        setStepIndex(nextIndex);
        transitionTimer.current = null;
      }, MENU_ANIMATION_MS);
      return;
    }

    if (menuOpenedByTour.current) {
      closeMenuForTour();
      menuOpenedByTour.current = false;
      transitionTimer.current = window.setTimeout(() => {
        setStepIndex(nextIndex);
        transitionTimer.current = null;
      }, MENU_CLOSE_MS);
      return;
    }

    setStepIndex(nextIndex);
  };

  useEffect(() => {
    if (run) {
      setStepIndex(0);
    } else {
      cleanupMenu();
    }

    return () => {
      cleanupMenu();
    };
  }, [run]);

  const handleEvent = (data: EventData, _controls: Controls) => {
    const { status, type, action, index = 0 } = data as EventData & {
      action?: string;
      index?: number;
    };

    if (status === STATUS.FINISHED) {
      cleanupMenu();
      onComplete(false);
      return;
    }

    if (status === STATUS.SKIPPED) {
      cleanupMenu();
      onComplete(true);
      return;
    }

    if (type === EVENTS.STEP_AFTER || type === EVENTS.TARGET_NOT_FOUND) {
      const direction = action === ACTIONS.PREV ? -1 : 1;
      goToStep(index + direction);
    }
  };

  if (!steps.length) return null;

  return (
    <Joyride
      steps={steps}
      run={run}
      stepIndex={stepIndex}
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
