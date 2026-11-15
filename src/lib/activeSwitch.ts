/** Seconds the "Make Inactive" button stays locked after the safety box opens. */
export const DEACTIVATE_COOLDOWN_SECONDS = 10;

/** The typed name must match exactly (ignoring outside spaces) and the countdown must be done. */
export function canConfirmDeactivate(typed: string, name: string, secondsLeft: number): boolean {
  return secondsLeft <= 0 && typed.trim() === name.trim() && name.trim().length > 0;
}
