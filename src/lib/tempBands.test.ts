import { describe, expect, it } from 'vitest';
import { classifyTemp, cutDecimal, safeRangeText, TEMP_BANDS, EQUIPMENT_TYPES } from '../../supabase/functions/_shared/tempBands';
import { planManualTemperature, planPhotoReading } from './checklistTemperature';
import { equipmentAlertCopy } from '../../supabase/functions/_shared/equipmentCheck';
import { applyBands, decideReads, decideTemperature } from '../../supabase/functions/ai-extraction-service/temperatureDecision';

const photoRow = { id: 'r1', response_image_url: 'https://a/1.jpg', response_text: null };

describe('equipment bands (shared config)', () => {
  it('has exactly the six tags', () =>
    expect(EQUIPMENT_TYPES).toEqual(['freezer', 'refrigerator', 'walk_in', 'line', 'hot_holding', 'reheating']));

  it('cold compliance: freezer -20..20, refrigerator/line/walk-in 30..41 (41 included)', () => {
    expect(classifyTemp('freezer', -20)).toBe('pass');
    expect(classifyTemp('freezer', 20)).toBe('pass');
    expect(classifyTemp('freezer', 21)).toBe('fail');
    expect(classifyTemp('freezer', -25)).toBe('fail');
    for (const t of ['refrigerator', 'line', 'walk_in'] as const) {
      expect(classifyTemp(t, 30)).toBe('pass');
      expect(classifyTemp(t, 41)).toBe('pass');
      expect(classifyTemp(t, 41.5)).toBe('fail');
      expect(classifyTemp(t, 29)).toBe('fail');
    }
  });

  it('possible range guards bad reads: walk-in up to 55, fridge/line 20..60, freezer -40..45', () => {
    expect(classifyTemp('walk_in', 55)).toBe('fail');
    expect(classifyTemp('walk_in', 56)).toBe('implausible');
    expect(classifyTemp('walk_in', 19)).toBe('implausible');
    expect(classifyTemp('refrigerator', 60)).toBe('fail');
    expect(classifyTemp('line', 61)).toBe('implausible');
    expect(classifyTemp('freezer', 45)).toBe('fail');
    expect(classifyTemp('freezer', 46)).toBe('implausible');
    expect(classifyTemp('freezer', -41)).toBe('implausible');
  });

  it('untagged keeps today broad check (-60..250, <=41 or >=135)', () => {
    expect(classifyTemp(null, 75)).toBe('fail');
    expect(classifyTemp(null, 38)).toBe('pass');
    expect(classifyTemp(null, 140)).toBe('pass');
    expect(classifyTemp(null, 251)).toBe('implausible');
  });

  it('hot holding: pass >=135, 130–134.x borderline, <130 fail, outside 60..250 implausible', () => {
    expect(classifyTemp('hot_holding', 135)).toBe('pass');
    expect(classifyTemp('hot_holding', 151)).toBe('pass');
    expect(classifyTemp('hot_holding', 130)).toBe('borderline');
    expect(classifyTemp('hot_holding', 134.9)).toBe('borderline');
    expect(classifyTemp('hot_holding', 129.9)).toBe('fail');
    expect(classifyTemp('hot_holding', 59)).toBe('implausible');
    expect(classifyTemp('hot_holding', 251)).toBe('implausible');
    expect(safeRangeText('hot_holding')).toBe('135°F or hotter');
  });

  it('reheating: pass >=165, 160–164.x borderline, <160 fail, outside 60..250 implausible', () => {
    expect(classifyTemp('reheating', 165)).toBe('pass');
    expect(classifyTemp('reheating', 160)).toBe('borderline');
    expect(classifyTemp('reheating', 164.9)).toBe('borderline');
    expect(classifyTemp('reheating', 159)).toBe('fail');
    expect(classifyTemp('reheating', 40)).toBe('implausible');
    expect(classifyTemp('reheating', 300)).toBe('implausible');
  });

  it('decimal cut truncates, never rounds up (134.9 → 134 fails hot holding)', () => {
    expect(cutDecimal(41.7)).toBe(41);
    expect(cutDecimal(134.9)).toBe(134);
    const d = decideReads({ value: 134.9, tenthsSure: false }, { value: 134.9, tenthsSure: false });
    expect(d.temperature).toBe(134);
    expect(applyBands(d, 'hot_holding')).toMatchObject({ temperature: 134, isValid: false, verdict: 'borderline' });
  });

  it('server: upside-down Sparks ~75 on a walk-in is not saved (implausible)', () =>
    expect(applyBands(decideTemperature(75.9, 73.9), 'walk_in')).toMatchObject({ temperature: null, reason: 'implausible' }));
});

describe('photo reading plan (client)', () => {
  for (const [tag, borderline, pass, fail, implausible] of [
    ['hot_holding', 132, 140, 120, 300],
    ['reheating', 162, 170, 150, 30],
  ] as const) {
    it(`${tag}: pass saves, borderline asks one retake then saves failed, fail saves failed, implausible saves nothing`, () => {
      expect(planPhotoReading({ temperature: pass, equipmentType: tag, borderlineRetakeUsed: false })).toEqual({ kind: 'save', tempF: pass, valid: true });
      expect(planPhotoReading({ temperature: borderline, equipmentType: tag, borderlineRetakeUsed: false }).kind).toBe('retake_borderline');
      expect(planPhotoReading({ temperature: borderline, equipmentType: tag, borderlineRetakeUsed: true })).toEqual({ kind: 'save', tempF: borderline, valid: false });
      expect(planPhotoReading({ temperature: fail, equipmentType: tag, borderlineRetakeUsed: false })).toEqual({ kind: 'save', tempF: fail, valid: false });
      expect(planPhotoReading({ temperature: implausible, equipmentType: tag, borderlineRetakeUsed: false }).kind).toBe('no_number');
      expect(planPhotoReading({ temperature: null, reason: 'implausible', equipmentType: tag, borderlineRetakeUsed: false }).kind).toBe('no_number');
    });

    it(`${tag}: a typed borderline number saves as failed; implausible typed number is refused`, () => {
      const typed = planManualTemperature({ tempText: String(borderline), existing: photoRow, canFixLegacy: false, equipmentType: tag });
      expect(typed).toMatchObject({ kind: 'update', valid: false });
      expect(planManualTemperature({ tempText: String(pass), existing: photoRow, canFixLegacy: false, equipmentType: tag })).toMatchObject({ kind: 'update', valid: true });
      expect(planManualTemperature({ tempText: String(implausible), existing: photoRow, canFixLegacy: false, equipmentType: tag }).kind).toBe('invalid');
    });
  }

  it('cold tags never get a borderline retake', () =>
    expect(planPhotoReading({ temperature: 42, equipmentType: 'walk_in', borderlineRetakeUsed: false })).toEqual({ kind: 'save', tempF: 42, valid: false }));

  it('untagged typed numbers keep the old 41/135 rule', () =>
    expect(planManualTemperature({ tempText: '60', existing: photoRow, canFixLegacy: false })).toMatchObject({ kind: 'update', valid: false }));
});

describe('equipment-check copy', () => {
  const row = {
    unit_name: 'TEMP - Walk-In Cooler', location_name: 'Sparks', equipment_type: 'walk_in', timezone: 'America/Los_Angeles',
    readings: [{ temp: 44.8, at: '2026-11-17T16:05:00Z' }, { temp: 46.2, at: '2026-11-16T22:10:00Z' }],
  };
  it('subject, push and body follow the agreed wording', () => {
    const c = equipmentAlertCopy(row);
    expect(c.subject).toBe('Please check equipment: TEMP - Walk-In Cooler, Sparks');
    expect(c.pushBody).toBe('TEMP - Walk-In Cooler at Sparks failed temp checks 2 days in a row (44.8°F).');
    expect(c.paragraph).toContain('46.2°F on Mon Nov 16, 2:10 PM and 44.8°F on Tue Nov 17, 8:05 AM');
    expect(c.rangeLabel).toBe(`Safe range for ${TEMP_BANDS.walk_in.plural}: 30–41°F`);
    expect(c.paragraph).toContain('door seal');
  });
});
