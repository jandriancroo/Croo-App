import { describe, expect, it } from 'vitest';
import { safeHeaders, hasPunchColumns, safeProbeError } from '../../supabase/functions/aloha-service/probeMetadata';

describe('Aloha labor probe metadata boundary', () => {
  it('never returns employee names, identifiers, wages or secret-bearing values as headers', () => {
    expect(safeHeaders(['Employee Name', 'Time In', 'Time Out', 'Jane Private', '123456', '$24.50', 'sessionManagerID=secret', 'Hours']))
      .toEqual(['Employee Name', 'Time In', 'Time Out', 'Hours']);
  });
  it('reports both punch-time columns only when actually present', () => {
    expect(hasPunchColumns(['Time In', 'Time Out'])).toEqual({ timeIn: true, timeOut: true });
    expect(hasPunchColumns(['Employee', 'Hours', 'Wages'])).toEqual({ timeIn: false, timeOut: false });
  });
  it('does not echo portal errors containing credentials or employee data', () => {
    expect(safeProbeError(new Error('Jane Private cookie=secret password=secret'))).toBe('Portal request failed');
    expect(safeProbeError(new Error('HTTP 403 session=secret'))).toBe('HTTP 403');
    expect(safeProbeError(new Error('login rejected password=secret'))).toBe('Portal login/session unavailable');
  });
});