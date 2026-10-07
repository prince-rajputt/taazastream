import { describe, expect, it } from 'vitest';
import { looksLikeTv } from '../store/prefs';
import { qs } from './api';
import { channelsLabel, languageName, timeAgo } from './format';

describe('web helpers', () => {
  it('builds query strings and skips empty values', () => {
    expect(qs({ q: 'star wars', page: 2, empty: '', none: undefined })).toBe('?q=star+wars&page=2');
    expect(qs({})).toBe('');
  });

  it('labels languages and channels', () => {
    expect(languageName('hin')).toBe('Hindi');
    expect(languageName('xx')).toBe('XX');
    expect(languageName(null)).toBeNull();
    expect(channelsLabel(6)).toBe('5.1');
    expect(channelsLabel(2)).toBe('Stereo');
  });

  it('formats relative times', () => {
    expect(timeAgo(null)).toBe('never');
    expect(timeAgo(new Date().toISOString())).toBe('just now');
    expect(timeAgo(new Date(Date.now() - 2 * 3600_000).toISOString())).toBe('2 h ago');
  });

  it('detects Smart TV browsers', () => {
    expect(looksLikeTv('Mozilla/5.0 (Web0S; Linux/SmartTV) AppleWebKit/537.36')).toBe(true);
    expect(looksLikeTv('Mozilla/5.0 (Linux; Android 14; Pixel 7) Mobile Safari/537.36')).toBe(
      false,
    );
  });
});
