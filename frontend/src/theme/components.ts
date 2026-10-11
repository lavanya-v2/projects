import type { Components, Theme } from '@mui/material/styles';
import type {} from '@mui/x-date-pickers/themeAugmentation';

/**
 * Component-level overrides shared by light and dark themes.
 * These reference the active theme's palette so they automatically
 * adapt to mode changes.
 */
export const getComponentOverrides = (mode: 'light' | 'dark'): Components<Theme> => {
  const isDark = mode === 'dark';

  const tableHeadBg     = isDark ? '#0f172a' : '#f8fafc';
  const tableHeadColor  = isDark ? '#94a3b8' : '#94a3b8';
  const tableHeadBorder = isDark ? '#334155' : '#e2e8f0';
  const tableBodyBorder = isDark ? '#1e293b' : '#f1f5f9';
  const tableHoverBg    = isDark ? '#1e293b' : '#f8faff';
  const paperBorder     = isDark ? '#334155' : '#e2e8f0';
  const scrollThumb     = isDark ? '#475569' : '#cbd5e1';

  return {
    MuiButton: {
      styleOverrides: {
        root: { textTransform: 'none', fontWeight: 600, borderRadius: 8 },
      },
    },
    MuiChip: {
      styleOverrides: { root: { fontWeight: 600 } },
    },
    MuiTableCell: {
      styleOverrides: {
        head: {
          fontSize: 10,
          fontWeight: 700,
          textTransform: 'uppercase',
          letterSpacing: '0.6px',
          color: tableHeadColor,
          backgroundColor: tableHeadBg,
          borderBottom: `1.5px solid ${tableHeadBorder}`,
          whiteSpace: 'nowrap',
          paddingTop: 9,
          paddingBottom: 9,
        },
        body: {
          fontSize: 13,
          borderBottom: `1px solid ${tableBodyBorder}`,
        },
      },
    },
    MuiTableRow: {
      styleOverrides: {
        root: {
          '&:last-child .MuiTableCell-body': { borderBottom: 'none' },
          '&:hover .MuiTableCell-body': { backgroundColor: tableHoverBg },
        },
      },
    },
    MuiPaper: {
      styleOverrides: {
        elevation1: {
          boxShadow: isDark
            ? '0 1px 3px rgba(0,0,0,.4), 0 1px 2px rgba(0,0,0,.3)'
            : '0 1px 3px rgba(0,0,0,.06), 0 1px 2px rgba(0,0,0,.04)',
          border: `1px solid ${paperBorder}`,
        },
        outlined: {
          border: `1px solid ${paperBorder}`,
        },
      },
    },
    MuiCssBaseline: {
      styleOverrides: {
        '*::-webkit-scrollbar': { width: 5, height: 5 },
        '*::-webkit-scrollbar-thumb': { background: scrollThumb, borderRadius: 3 },
        '*::-webkit-scrollbar-track': { background: 'transparent' },
      },
    },
    MuiDatePicker: {
      defaultProps: {
        slotProps: {
          popper: {
            placement: 'bottom-end', 
          },
        },
      },
    },
  };
};
