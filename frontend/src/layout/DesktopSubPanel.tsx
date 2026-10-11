import { Box, Typography } from '@mui/material';
import { brandColors } from '../theme/tokens';
import { RAIL_W, PANEL_W, TOPBAR_H } from './constants';
import { SECTION_LABEL } from './navigation';
import type { Section, SubItem } from './navigation';

const { navy, orange } = brandColors;

interface DesktopSubPanelProps {
  section: Section;
  items: SubItem[];
  currentPath: string;
  onNavigate: (path: string) => void;
}

/** Secondary nav panel shown to the right of the rail when a section is active. */
export const DesktopSubPanel = ({
  section,
  items,
  currentPath,
  onNavigate,
}: DesktopSubPanelProps) => (
  <Box
    sx={{
      position: 'fixed',
      top: 0,
      left: RAIL_W,
      width: PANEL_W,
      height: '100vh',
      bgcolor: '#f5f7fa',
      borderRight: '1px solid #e0e4ea',
      display: 'flex',
      flexDirection: 'column',
      zIndex: 1100,
    }}
  >
    <Box
      sx={{
        height: TOPBAR_H,
        display: 'flex',
        alignItems: 'center',
        px: 2,
        borderBottom: '1px solid #e0e4ea',
        flexShrink: 0,
      }}
    >
      <Typography
        sx={{
          fontFamily: 'Inter, sans-serif',
          fontSize: 11,
          fontWeight: 700,
          color: navy,
          letterSpacing: '0.08em',
          textTransform: 'uppercase',
        }}
      >
        {SECTION_LABEL[section]}
      </Typography>
    </Box>

    <Box sx={{ flex: 1, overflowY: 'auto', py: 0.5 }}>
      {items.map(item => {
        const isActive = currentPath === item.path;
        return (
          <Box
            key={item.path}
            onClick={() => onNavigate(item.path)}
            sx={{
              display: 'flex',
              alignItems: 'center',
              gap: 1.25,
              height: 38,
              px: 2,
              cursor: 'pointer',
              borderLeft: isActive ? `3px solid ${orange}` : '3px solid transparent',
              bgcolor: isActive ? 'rgba(241,90,36,0.08)' : 'transparent',
              color: isActive ? orange : '#374151',
              fontFamily: 'Inter, sans-serif',
              fontSize: 13,
              fontWeight: isActive ? 500 : 400,
              transition: 'all 0.12s ease',
              '&:hover': {
                bgcolor: isActive ? 'rgba(241,90,36,0.08)' : '#eef2f8',
                color: isActive ? orange : navy,
              },
            }}
          >
            <Box sx={{ color: 'inherit', display: 'flex', alignItems: 'center', opacity: isActive ? 1 : 0.7 }}>
              {item.icon}
            </Box>
            <Typography
              sx={{
                fontFamily: 'inherit',
                fontSize: 'inherit',
                fontWeight: 'inherit',
                color: 'inherit',
                lineHeight: 1,
              }}
            >
              {item.label}
            </Typography>
          </Box>
        );
      })}
    </Box>
  </Box>
);
