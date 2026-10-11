import { Box, Tooltip } from '@mui/material';
import {
  GridViewRounded,
  AdminPanelSettingsRounded,
  MenuBookRounded,
  HelpOutlineRounded,
} from '@mui/icons-material';
import { brandColors } from '../theme/tokens';
import { PATHS } from '../routes/paths';
import { RAIL_W, TOPBAR_H } from './constants';
import { LensMark } from './LensMark';
import type { SectionDef, Section } from './navigation';

const { navy, orange, blueMid } = brandColors;

const railItemSx = (active: boolean) => ({
  width: 40,
  height: 40,
  borderRadius: active ? '0 8px 8px 0' : 2,
  display: 'flex',
  alignItems: 'center',
  justifyContent: 'center',
  cursor: 'pointer',
  color: active ? '#fff' : blueMid,
  bgcolor: active ? 'rgba(241,90,36,0.22)' : 'transparent',
  borderLeft: active ? `3px solid ${orange}` : '3px solid transparent',
  ml: active ? '-1px' : 0,
  transition: 'all 0.12s ease',
  '&:hover': {
    bgcolor: active ? 'rgba(241,90,36,0.22)' : 'rgba(255,255,255,0.08)',
    color: '#fff',
  },
});

interface DesktopRailProps {
  currentPath: string;
  activeSection: Section | null;
  sections: SectionDef[];
  isAdminPath: boolean;
  canSeeUserMgmt: boolean;
  onNavigate: (path: string) => void;
  onSectionClick: (section: Section) => void;
}

/** Fixed 48px-wide icon rail on the left edge (desktop only). */
export const DesktopRail = ({
  currentPath,
  activeSection,
  sections,
  isAdminPath,
  canSeeUserMgmt,
  onNavigate,
  onSectionClick,
}: DesktopRailProps) => (
  <Box
    sx={{
      position: 'fixed',
      top: 0,
      left: 0,
      width: RAIL_W,
      height: '100vh',
      bgcolor: navy,
      display: 'flex',
      flexDirection: 'column',
      alignItems: 'center',
      zIndex: 1200,
    }}
  >
    <Box
      sx={{
        width: RAIL_W,
        height: TOPBAR_H,
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        borderBottom: '1px solid rgba(255,255,255,0.08)',
        flexShrink: 0,
      }}
    >
      <LensMark />
    </Box>

    <Box
      sx={{
        flex: 1,
        display: 'flex',
        flexDirection: 'column',
        alignItems: 'center',
        pt: 1,
        width: '100%',
        gap: 0.5,
      }}
    >
      <Tooltip title="Dashboard" placement="right" arrow>
        <Box onClick={() => onNavigate(PATHS.DASHBOARD)} sx={railItemSx(currentPath === PATHS.DASHBOARD)}>
          <GridViewRounded sx={{ fontSize: 20 }} />
        </Box>
      </Tooltip>

      {sections.map(({ id, icon, label }) => (
        <Tooltip key={id} title={label} placement="right" arrow>
          <Box onClick={() => onSectionClick(id)} sx={railItemSx(activeSection === id)}>
            {icon}
          </Box>
        </Tooltip>
      ))}

      <Box sx={{ flex: 1 }} />

      <Tooltip title="Engineering SOP" placement="right" arrow>
        <Box onClick={() => onNavigate(PATHS.ENGINEERING_SOP)} sx={railItemSx(currentPath === PATHS.ENGINEERING_SOP)}>
          <MenuBookRounded sx={{ fontSize: 20 }} />
        </Box>
      </Tooltip>

      <Tooltip title="FAQ" placement="right" arrow>
        <Box onClick={() => onNavigate(PATHS.FAQ)} sx={railItemSx(currentPath === PATHS.FAQ)}>
          <HelpOutlineRounded sx={{ fontSize: 20 }} />
        </Box>
      </Tooltip>

      {canSeeUserMgmt && (
        <Tooltip title="Administration" placement="right" arrow>
          <Box onClick={() => onNavigate(PATHS.ADMIN_ACCOUNTS)} sx={railItemSx(isAdminPath)}>
            <AdminPanelSettingsRounded sx={{ fontSize: 20 }} />
          </Box>
        </Tooltip>
      )}

    </Box>
  </Box>
);
