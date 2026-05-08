export interface ActivePunchLike {
  user_id: string;
  punch_time: string;
  punch_type: string;
  notes?: string | null;
}

export interface ActivePunchState {
  isClockedIn: boolean;
  isOnBreak: boolean;
  clockInTime: string | null;
  breakStartTime: string | null;
  breakType: string | null;
}

export const getActivePunchState = <T extends Omit<ActivePunchLike, 'user_id'>>(
  userPunches: T[]
): ActivePunchState => {
  const sorted = [...userPunches].sort(
    (a, b) => new Date(a.punch_time).getTime() - new Date(b.punch_time).getTime()
  );

  const state: ActivePunchState = {
    isClockedIn: false,
    isOnBreak: false,
    clockInTime: null,
    breakStartTime: null,
    breakType: null,
  };

  sorted.forEach((punch) => {
    switch (punch.punch_type) {
      case 'clock_in': {
        if (!state.isClockedIn || !state.clockInTime) {
          state.clockInTime = punch.punch_time;
        }
        state.isClockedIn = true;
        state.isOnBreak = false;
        state.breakStartTime = null;
        state.breakType = null;
        break;
      }

      case 'break_start': {
        if (!state.isClockedIn && !state.clockInTime) break;
        state.isClockedIn = true;
        state.isOnBreak = true;
        state.breakStartTime = punch.punch_time;
        state.breakType = punch.notes || 'Break';
        break;
      }

      case 'break_end': {
        if (!state.clockInTime && !state.isClockedIn && !state.isOnBreak) break;
        state.isClockedIn = true;
        state.isOnBreak = false;
        state.breakStartTime = null;
        state.breakType = null;
        break;
      }

      case 'clock_out': {
        state.isClockedIn = false;
        state.isOnBreak = false;
        state.clockInTime = null;
        state.breakStartTime = null;
        state.breakType = null;
        break;
      }
    }
  });

  return state;
};

export const getActivePunchStatesByUser = <T extends ActivePunchLike>(punches: T[]) => {
  const userPunches = new Map<string, T[]>();

  punches.forEach((punch) => {
    const existing = userPunches.get(punch.user_id) || [];
    existing.push(punch);
    userPunches.set(punch.user_id, existing);
  });

  const states = new Map<string, ActivePunchState>();
  userPunches.forEach((entries, userId) => {
    states.set(userId, getActivePunchState(entries));
  });

  return states;
};