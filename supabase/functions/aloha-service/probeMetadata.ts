const HEADER_NAMES = /^(?:employee(?: name| number| id| #)?|name|job(?: code| title)?|position|department|date|business date|store(?: name| number| id)?|time\s*in|time\s*out|clock\s*in|clock\s*out|in\s*time|out\s*time|punch\s*in|punch\s*out|hours|regular hours|overtime hours|ot hours|total hours|wage|wages|rate|pay rate|regular pay|overtime pay|total pay|labor cost|cost|tips|break|break start|break end|id|number|labor hours|labor dollars|ot labor cost|ot labor hours)$/i;

export function safeHeaders(values: string[]): string[] {
  // Only recognized schema labels may leave the server, even if a malformed
  // report marks an employee/wage cell as a header.
  return [...new Set(values.map(v => v.replace(/\s+/g, ' ').trim())
    .filter(v => HEADER_NAMES.test(v)))];
}

export function hasPunchColumns(headers: string[]) {
  return {
    timeIn: headers.some(v => /^(?:time\s*in|clock\s*in|in\s*time|punch\s*in)$/i.test(v)),
    timeOut: headers.some(v => /^(?:time\s*out|clock\s*out|out\s*time|punch\s*out)$/i.test(v)),
  };
}

export function safeProbeError(error: unknown): string {
  const message = error instanceof Error ? error.message : '';
  const status = message.match(/HTTP\s+(\d{3})/i)?.[1];
  if (status) return `HTTP ${status}`;
  if (/locked/i.test(message)) return 'Portal account locked';
  if (/captcha/i.test(message)) return 'Portal login requires verification';
  if (/login|session|credentials/i.test(message)) return 'Portal login/session unavailable';
  if (/timeout|abort/i.test(message)) return 'Portal request timed out';
  return 'Portal request failed';
}