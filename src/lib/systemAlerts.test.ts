import { describe, expect, it } from 'vitest';
import { safeAlertLink, systemAlertIsDeliverable, validateSystemAlert, videoEmbedUrl } from './systemAlerts';

const alert = { title: 'New feature', body: 'Ready to try.', action_label: 'Got it', action_kind: 'none', action_value: null, video_url: null };
describe('System Alerts safety and actions', () => {
  it('delivers published alerts only; drafts and retired announcements never deliver', () => {
    expect(systemAlertIsDeliverable('published')).toBe(true);
    expect(systemAlertIsDeliverable('draft')).toBe(false);
    expect(systemAlertIsDeliverable('retired')).toBe(false);
  });
  it('supports theme alerts with existing themes only', () => {
    expect(validateSystemAlert({ ...alert, action_kind: 'theme', action_value: 'spookified' })).toBeNull();
    expect(validateSystemAlert({ ...alert, action_kind: 'theme', action_value: 'unknown' })).toBe('Choose a theme.');
  });
  it('supports app and secure feature links, not executable or protocol-relative links', () => {
    expect(safeAlertLink('/settings')).toBe(true);
    expect(safeAlertLink('https://croohq.com/settings')).toBe(true);
    expect(safeAlertLink('javascript:alert(1)')).toBe(false);
    expect(safeAlertLink('//example.com')).toBe(false);
    expect(safeAlertLink('/\\example.com')).toBe(false);
  });
  it('supports optional secure training videos', () => {
    expect(validateSystemAlert({ ...alert, video_url: 'https://example.com/training.mp4' })).toBeNull();
    expect(validateSystemAlert({ ...alert, video_url: 'http://example.com/training.mp4' })).toBe('Use a secure https video link.');
    expect(videoEmbedUrl('https://youtu.be/dQw4w9WgXcQ')).toBe('https://www.youtube-nocookie.com/embed/dQw4w9WgXcQ');
    expect(videoEmbedUrl('https://example.com/embed')).toBeNull();
  });
});