import { Joyride, STATUS, type EventData, type Step } from 'react-joyride';
import { useUserRole } from '@/hooks/useUserRole';
import { getTourStepsForRole } from './tourSteps';

interface OnboardingTourProps {
  run: boolean;
  onComplete: (skipped: boolean) => void;
}

export function OnboardingTour({ run, onComplete }: OnboardingTourProps) {
  const { role } = useUserRole();
  const steps = getTourStepsForRole(role) as Step[];

  const handleCallback = (data: EventData) => {
    const { status } = data;
    
    if (status === STATUS.FINISHED) {
      onComplete(false);
    } else if (status === STATUS.SKIPPED) {
      onComplete(true);
    }
  };

  if (!steps.length) return null;

  return (
    <Joyride
      steps={steps}
      run={run}
      continuous
      showSkipButton
      showProgress
      scrollToFirstStep
      disableOverlayClose
      callback={handleCallback}
      locale={{
        back: 'Back',
        close: 'Close',
        last: 'Done!',
        next: 'Next',
        skip: 'Skip Tour',
      }}
      styles={{
        options: {
          arrowColor: 'hsl(var(--card))',
          backgroundColor: 'hsl(var(--card))',
          textColor: 'hsl(var(--card-foreground))',
          primaryColor: 'hsl(var(--primary))',
          overlayColor: 'rgba(0, 0, 0, 0.6)',
          spotlightShadow: '0 0 20px rgba(0, 0, 0, 0.5)',
          zIndex: 10000,
          width: 340,
        },
        tooltip: {
          borderRadius: '0.75rem',
          padding: '1.25rem',
          fontSize: '0.875rem',
        },
        tooltipTitle: {
          fontSize: '1rem',
          fontWeight: 600,
          marginBottom: '0.5rem',
        },
        tooltipContent: {
          padding: '0.5rem 0',
          lineHeight: 1.5,
        },
        buttonNext: {
          borderRadius: '0.5rem',
          padding: '0.5rem 1.25rem',
          fontSize: '0.875rem',
          fontWeight: 500,
        },
        buttonBack: {
          color: 'hsl(var(--muted-foreground))',
          fontSize: '0.875rem',
        },
        buttonSkip: {
          color: 'hsl(var(--muted-foreground))',
          fontSize: '0.8rem',
        },
        spotlight: {
          borderRadius: '0.75rem',
        },
      }}
    />
  );
}
