import { describe, it, expect } from 'vitest';
import { parseTokens, serializeSegments, HIRING_FIELDS, NUDGE_FIELDS } from './smartFields';

const round = (t: string, f = HIRING_FIELDS) => serializeSegments(parseTokens(t, f));

describe('smart fields round-trip', () => {
  const samples = [
    'Dear {{first_name}},\n\nThanks from {{organization}}.\r\n',
    'Hi {{First_Name}} and {{ NAME }}',
    'Unknown {{favorite_color}} and {single} stay',
    '',
    'No tokens at all\n\n\n',
  ];
  for (const s of samples) it(JSON.stringify(s).slice(0, 40), () => expect(round(s)).toBe(s));

  it('mixed case stays as written and is a pill', () => {
    const seg = parseTokens('{{First_Name}}', HIRING_FIELDS);
    expect(seg).toEqual([{ type: 'field', token: '{{first_name}}', raw: '{{First_Name}}', label: 'Applicant first name' }]);
  });
  it('unknown tokens stay literal text', () => expect(parseTokens('{{x}} {y}', HIRING_FIELDS)).toEqual([{ type: 'text', text: '{{x}} {y}' }]));
  it('brace style must match the field', () => {
    expect(parseTokens('{first_name}', HIRING_FIELDS)[0].type).toBe('text');
    expect(parseTokens('{{checklist}}', NUDGE_FIELDS)[0].type).toBe('text');
    expect(parseTokens('{Checklist}', NUDGE_FIELDS)[0].type).toBe('field');
    expect(parseTokens('{Event_Time}', NUDGE_FIELDS)[0].type).toBe('field');
  });
  it('{checklist} parses to the Item pill and round-trips byte-identical', () => {
    const t = 'The {checklist} and {Checklist} and {item}';
    const seg = parseTokens(t, NUDGE_FIELDS);
    expect(seg.filter((x) => x.type === 'field').map((x: any) => [x.label, x.raw])).toEqual([['Item', '{checklist}'], ['Item', '{Checklist}'], ['Item', '{item}']]);
    expect(round(t, NUDGE_FIELDS)).toBe(t);
  });
  it('nudge round-trip', () => { const t = "Hey {recipient_first_name}, {sender_first_name} here. {done}/{total}"; expect(round(t, NUDGE_FIELDS)).toBe(t); });
  it('hiring default template round-trips unchanged', () => {
    const body = `Dear {{first_name}},

Thank you for taking the time to apply to {{organization}}. After careful consideration, we have decided to move forward with other candidates whose experience more closely matches our current needs.

We appreciate your interest in our team and encourage you to apply again in the future.

Best regards,
The {{organization}} Team`;
    expect(round(body)).toBe(body);
    expect(round('Thank you for your application')).toBe('Thank you for your application');
  });
});
