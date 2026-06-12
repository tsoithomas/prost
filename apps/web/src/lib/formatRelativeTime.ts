const UNITS: { unit: Intl.RelativeTimeFormatUnit; ms: number }[] = [
  { unit: 'year', ms: 365 * 24 * 60 * 60 * 1000 },
  { unit: 'month', ms: 30 * 24 * 60 * 60 * 1000 },
  { unit: 'day', ms: 24 * 60 * 60 * 1000 },
  { unit: 'hour', ms: 60 * 60 * 1000 },
  { unit: 'minute', ms: 60 * 1000 },
];

const relativeTimeFormat = new Intl.RelativeTimeFormat('en', { numeric: 'always' });

/** Renders an ISO timestamp as "2 minutes ago", falling back to "just now" for sub-minute deltas. */
export function formatRelativeTime(iso: string): string {
  const deltaMs = new Date(iso).getTime() - Date.now();

  for (const { unit, ms } of UNITS) {
    if (Math.abs(deltaMs) >= ms) {
      return relativeTimeFormat.format(Math.round(deltaMs / ms), unit);
    }
  }

  return 'just now';
}
