import { Joyride, STATUS, EVENTS, type EventData, type Controls, type Step } from 'react-joyride';
import { useUserRole } from '@/hooks/useUserRole';
import { getTourStepsForRole } from './tourSteps';

interface OnboardingTourProps {
  run: boolean;
  onComplete: (skipped: boolean) => void;
}

export function OnboardingTour({ run, onComplete }: OnboardingTourProps) {
  const { role } = useUserRole();
  const steps = getTourStepsForRole(role) as Step[];

  const handleEvent = (data: EventData, _controls: Controls) => {
    if (data.status === STATUS.FINISHED) {
      onComplete(false);
    } else if (data.status === STATUS.SKIPPED) {
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
