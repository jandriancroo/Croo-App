// The shared navigation dock is available on the page that starts the tour.
export function tourStepDestination(index: number, page?: string): string | null {
  return index === 0 ? null : page ?? null;
}