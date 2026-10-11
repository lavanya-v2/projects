/**
 * Pure formatting helpers for the Team Performance feature. No React, no MUI.
 */

export const fmtDate = (d: string): string => {
  if (!d) return '—';
  return new Date(d).toLocaleDateString('en-GB', {
    day: '2-digit',
    month: 'short',
    year: 'numeric',
  });
};

export const fmtDatetime = (d: string): string => {
  if (!d) return '—';
  return new Date(d).toLocaleString('en-GB', {
    day: '2-digit',
    month: 'short',
    year: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
  });
};

/** Decode literal `\uXXXX` escape sequences from Jira sprint names */
export const decodeName = (s: string): string =>
  s?.replace(/\\u([0-9a-fA-F]{4})/g, (_, h) => String.fromCharCode(parseInt(h, 16))) ?? s;

/**
 * Resolve a potentially-overridden metric value from a perf score row.
 * Falls back to the raw `s[key]` if no override exists.
 */
export const metricVal = (s: any, key: string): any =>
  s.isOverridden && s.overriddenMetrics?.[key] != null ? s.overriddenMetrics[key] : s[key];
