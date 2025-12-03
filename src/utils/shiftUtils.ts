export function shiftHasBreak(startTime: string | undefined | null, endTime: string | undefined | null): boolean {
  if (!startTime || !endTime) return false;
  
  const [startHour, startMin] = startTime.split(':').map(Number);
  const [endHour, endMin] = endTime.split(':').map(Number);
  
  let hours = endHour - startHour;
  let minutes = endMin - startMin;
  
  if (minutes < 0) {
    hours -= 1;
    minutes += 60;
  }
  
  const totalHours = hours + minutes / 60;
  return totalHours > 5;
}

export function calculateShiftHours(startTime: string | undefined | null, endTime: string | undefined | null): number {
  if (!startTime || !endTime) return 0;
  
  const [startHour, startMin] = startTime.split(':').map(Number);
  const [endHour, endMin] = endTime.split(':').map(Number);
  
  let hours = endHour - startHour;
  let minutes = endMin - startMin;
  
  if (minutes < 0) {
    hours -= 1;
    minutes += 60;
  }
  
  let shiftHours = hours + minutes / 60;
  
  // Deduct 30 minutes if shift is over 5 hours
  if (shiftHours > 5) {
    shiftHours -= 0.5;
  }
  
  return shiftHours;
}
