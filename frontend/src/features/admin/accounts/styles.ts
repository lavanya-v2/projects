import { brandColors } from '../../../theme/tokens';

const { navy, orange } = brandColors;

/** Shared sx objects for admin tables and buttons. */

export const thSx = {
  fontFamily: 'Inter, sans-serif',
  fontSize: 11,
  fontWeight: 700,
  color: 'rgba(8, 1, 1, 0.85)',
  textTransform: 'uppercase' as const,
  letterSpacing: '0.06em',
  py: 1.5,
  borderBottom: 'none',
};

export const tdSx = {
  fontFamily: 'Inter, sans-serif',
  fontSize: 13,
  color: '#374151',
  py: 1.25,
  borderBottom: '1px solid #f0f4f8',
};

export const primaryBtnSx = {
  bgcolor: orange,
  fontFamily: 'Inter, sans-serif',
  fontWeight: 600,
  fontSize: 13,
  textTransform: 'none' as const,
  borderRadius: 1.5,
  boxShadow: 'none',
  '&:hover': { bgcolor: '#d44e1f', boxShadow: 'none' },
};

export const outlinedBtnSx = {
  fontFamily: 'Inter, sans-serif',
  fontWeight: 500,
  fontSize: 12,
  textTransform: 'none' as const,
  borderColor: '#e0e4ea',
  color: navy,
  borderRadius: 1.5,
  '&:hover': { borderColor: navy, bgcolor: 'rgba(0,46,91,0.04)' },
};

export const destructiveOutlinedBtnSx = {
  ...outlinedBtnSx,
  borderColor: '#fecaca',
  color: '#ef4444',
  '&:hover': { borderColor: '#ef4444', bgcolor: 'rgba(239,68,68,0.04)' },
};

export const tableWrapperSx = {
  border: '1px solid #e0e4ea',
  borderRadius: 2,
  overflow: 'hidden',
};
