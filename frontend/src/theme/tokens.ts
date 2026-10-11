/**
 * Design tokens — semantic colour, spacing, and typography primitives.
 * Theme variants (light/dark) reference these tokens via the MUI palette.
 */

export const brandColors = {
  navy:    '#002e5b',
  orange:  '#f15a24',
  blueMid: '#6c98e1',
};

export const lightPalette = {
  primary: {
    main: '#4f46e5',
    dark: '#3730a3',
    light: '#818cf8',
    contrastText: '#ffffff',
  },
  secondary: {
    main: brandColors.orange,
    dark: '#c4471a',
    light: '#f47b4a',
    contrastText: '#ffffff',
  },
  error:   { main: '#ef4444', dark: '#b91c1c', light: '#f87171' },
  warning: { main: '#f59e0b', dark: '#b45309', light: '#fbbf24' },
  info:    { main: '#3b82f6', dark: '#1d4ed8', light: '#60a5fa' },
  success: { main: '#10b981', dark: '#047857', light: '#34d399' },
  background: {
    default: '#f1f5f9',
    paper:   '#ffffff',
  },
  text: {
    primary:   brandColors.navy,
    secondary: '#475569',
    disabled:  '#94a3b8',
  },
  divider: '#e2e8f0',
};

export const darkPalette = {
  primary: {
    main: '#818cf8',
    dark: '#4f46e5',
    light: '#a5b4fc',
    contrastText: '#0f172a',
  },
  secondary: {
    main: '#f47b4a',
    dark: '#f15a24',
    light: '#fb9268',
    contrastText: '#0f172a',
  },
  error:   { main: '#f87171', dark: '#ef4444', light: '#fca5a5' },
  warning: { main: '#fbbf24', dark: '#f59e0b', light: '#fde047' },
  info:    { main: '#60a5fa', dark: '#3b82f6', light: '#93c5fd' },
  success: { main: '#34d399', dark: '#10b981', light: '#6ee7b7' },
  background: {
    default: '#0f172a',
    paper:   '#1e293b',
  },
  text: {
    primary:   '#f1f5f9',
    secondary: '#cbd5e1',
    disabled:  '#64748b',
  },
  divider: '#334155',
};

export const typography = {
  fontFamily: "'Inter', -apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif",
  h1: { fontSize: '2.25rem', fontWeight: 700, letterSpacing: '-0.02em' },
  h2: { fontSize: '1.875rem', fontWeight: 700, letterSpacing: '-0.01em' },
  h3: { fontSize: '1.5rem',  fontWeight: 600 },
  h4: { fontSize: '1.25rem', fontWeight: 600 },
  h5: { fontSize: '1.125rem', fontWeight: 600 },
  h6: { fontSize: '1rem',     fontWeight: 600 },
  body1: { fontSize: '0.875rem' },
  body2: { fontSize: '0.8125rem' },
  button: { fontWeight: 600, textTransform: 'none' as const },
};

export const shape = { borderRadius: 10 };

export const STATUS_COLORS: Record<string, 'default' | 'warning' | 'success' | 'error'> = {
  'Open': 'default',
  'In-Progress': 'warning',
  'Closed': 'success',
  'Discarded': 'error',
};

export const CATEGORY_COLORS: Record<string, string> = {
  'Task': '#1565c0',
  'Follow-up': '#6a1b9a',
  'Decision Required': '#e65100',
  'Issue': '#c62828',
  'Risk & Mitigation': '#f57f17',
  'Dependency': '#2e7d32',
};
