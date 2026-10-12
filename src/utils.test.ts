import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { daysSince, isDue, withinWeek } from './utils';

describe('dashboard follow-up dates', () => {
  beforeEach(() => {
    vi.useFakeTimers();
    // Use browser-local calendar dates; a time well away from midnight avoids
    // tying the test to whichever timezone the developer's computer uses.
    vi.setSystemTime(new Date(2026, 9, 10, 12, 0, 0));
  });
  afterEach(() => vi.useRealTimers());

  it('counts today and earlier scheduled dates as due', () => {
    expect(isDue('2026-10-09')).toBe(true);
    expect(isDue('2026-10-10')).toBe(true);
    expect(isDue('2026-10-11')).toBe(false);
  });

  it('includes today through seven days ahead, excluding overdue dates', () => {
    expect(withinWeek('2026-10-09')).toBe(false);
    expect(withinWeek('2026-10-10')).toBe(true);
    expect(withinWeek('2026-10-17')).toBe(true);
    expect(withinWeek('2026-10-18')).toBe(false);
  });

  it('keeps the more-than-30-day boundary distinct from exactly 30 days', () => {
    expect(daysSince('2026-09-10')).toBe(30);
    expect(daysSince('2026-09-09')).toBe(31);
    expect((daysSince('2026-09-10') ?? 0) > 30).toBe(false);
    expect((daysSince('2026-09-09') ?? 0) > 30).toBe(true);
  });

  it('keeps unknown historical dates out of due, weekly and stale counts', () => {
    expect(daysSince('')).toBeNull();
    expect(isDue('')).toBe(false);
    expect(withinWeek('')).toBe(false);
    expect((daysSince('') ?? 0) > 30).toBe(false);
  });

  it('accepts the calendar date prefix of a saved ISO timestamp', () => {
    expect(daysSince('2026-10-09T23:45:00.000Z')).toBe(1);
    expect(isDue('2026-10-10T00:01:00.000Z')).toBe(true);
    expect(withinWeek('2026-10-17T23:59:00.000Z')).toBe(true);
  });

  it('counts calendar days across a daylight saving transition', () => {
    vi.setSystemTime(new Date(2026, 2, 30, 12, 0, 0));
    expect(daysSince('2026-03-28')).toBe(2);
    expect(daysSince('2026-03-29')).toBe(1);
    expect(withinWeek('2026-04-06')).toBe(true);
    expect(withinWeek('2026-04-07')).toBe(false);
  });
});
