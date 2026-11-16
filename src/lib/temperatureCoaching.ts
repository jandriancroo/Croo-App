// Short tips shown when the thermometer photo is too unclear to read.
// The server only ever sends one of these fixed values.
export type TempCoaching = 'too_far' | 'too_dark' | 'blurry' | 'glare';

const TIPS: Record<TempCoaching, string> = {
  too_far: 'Move closer so the numbers fill more of the photo.',
  too_dark: 'Add light so the numbers are easy to see.',
  glare: 'Tilt the thermometer or turn off glare so the numbers show.',
  blurry: 'Hold steady and tap to focus before you take the photo.',
};

export function tempCoachingTip(reason: unknown): string {
  return typeof reason === 'string' && reason in TIPS ? TIPS[reason as TempCoaching] : TIPS.blurry;
}
