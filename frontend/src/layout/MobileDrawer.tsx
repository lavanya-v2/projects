import { useState } from 'react';
import {
  Drawer,
  Box,
  Typography,
  Divider,
  List,
  ListItemButton,
  ListItemIcon,
  ListItemText,
  Collapse,
} from '@mui/material';
import {
  GridViewRounded,
  AdminPanelSettingsRounded,
  LogoutRounded,
  ExpandLess,
  ExpandMore,
  MenuBookRounded,
  HelpOutlineRounded,
} from '@mui/icons-material';
import { brandColors } from '../theme/tokens';
import { PATHS } from '../routes/paths';
import { LensMark } from './LensMark';
import type { SectionDef, SubItem, Section } from './navigation';

const { navy } = brandColors;

const mobileItemSx = (active: boolean) => ({
  py: 0.85,
  px: 2,
  mx: 0.75,
  borderRadius: 1.5,
  color: active ? '#a5b4fc' : 'rgba(148,163,184,0.85)',
  bgcolor: active ? 'rgba(79,70,229,0.15)' : 'transparent',
  borderLeft: active ? '3px solid #818cf8' : '3px solid transparent',
  '&:hover': { bgcolor: 'rgba(255,255,255,0.06)', color: '#e2e8f0' },
  transition: 'all 0.12s',
});

const mobileSectionSx = {
  py: 0.85,
  px: 2,
  mx: 0.75,
  borderRadius: 1.5,
  color: 'rgba(148,163,184,0.6)',
  '&:hover': { bgcolor: 'rgba(255,255,255,0.04)', color: 'rgba(148,163,184,0.9)' },
};

interface MobileNavSectionProps {
  section: SectionDef;
  items: SubItem[];
  currentPath: string;
  defaultOpen?: boolean;
  onNavigate: (path: string) => void;
}

/** One collapsible section in the mobile drawer. Manages its own open state. */
const MobileNavSection = ({
  section,
  items,
  currentPath,
  defaultOpen = false,
  onNavigate,
}: MobileNavSectionProps) => {
  const [open, setOpen] = useState(defaultOpen);
  if (items.length === 0) return null;

  return (
    <>
      <ListItemButton onClick={() => setOpen(v => !v)} sx={mobileSectionSx}>
        <ListItemIcon sx={{ minWidth: 32, color: 'inherit' }}>{section.icon}</ListItemIcon>
        <ListItemText
          primary={section.label}
          primaryTypographyProps={{ fontFamily: 'Inter, sans-serif', fontSize: 13, fontWeight: 500 }}
        />
        {open ? <ExpandLess sx={{ fontSize: 16 }} /> : <ExpandMore sx={{ fontSize: 16 }} />}
      </ListItemButton>
      <Collapse in={open}>
        {items.map(item => (
          <ListItemButton
            key={item.path}
            onClick={() => onNavigate(item.path)}
            sx={{ ...mobileItemSx(currentPath === item.path), pl: 4 }}
          >
            <ListItemIcon sx={{ minWidth: 28, color: 'inherit' }}>{item.icon}</ListItemIcon>
            <ListItemText
              primary={item.label}
              primaryTypographyProps={{
                fontFamily: 'Inter, sans-serif',
                fontSize: 12,
                fontWeight: currentPath === item.path ? 600 : 400,
              }}
            />
          </ListItemButton>
        ))}
      </Collapse>
    </>
  );
};

interface MobileDrawerProps {
  open: boolean;
  onClose: () => void;
  currentPath: string;
  isAdminPath: boolean;
  sections: SectionDef[];
  getSubItems: (section: Section) => SubItem[];
  canSeeUserMgmt: boolean;
  onNavigate: (path: string) => void;
  onLogout: () => void;
}

export const MobileDrawer = ({
  open,
  onClose,
  currentPath,
  isAdminPath,
  sections,
  getSubItems,
  canSeeUserMgmt,
  onNavigate,
  onLogout,
}: MobileDrawerProps) => (
  <Drawer
    open={open}
    onClose={onClose}
    ModalProps={{ keepMounted: true }}
    sx={{ '& .MuiDrawer-paper': { width: 240, bgcolor: navy } }}
  >
    <Box sx={{ bgcolor: navy, height: '100%', display: 'flex', flexDirection: 'column' }}>
      <Box
        sx={{
          px: 2,
          py: 1.5,
          borderBottom: '1px solid rgba(255,255,255,0.08)',
          display: 'flex',
          alignItems: 'center',
          gap: 1.5,
        }}
      >
        <LensMark />
        <Box>
          <Typography
            sx={{ fontFamily: 'Poppins, sans-serif', fontWeight: 700, fontSize: 16, color: '#fff', lineHeight: 1.2 }}
          >
            Lens
          </Typography>
          <Typography
            sx={{
              fontFamily: 'Inter, sans-serif',
              fontSize: 10,
              color: 'rgba(255,255,255,0.4)',
              letterSpacing: '0.06em',
            }}
          >
            by V2Solutions
          </Typography>
        </Box>
      </Box>

      <List disablePadding
        sx={{
          flex: 1,
          minHeight: 0,
          overflowY: 'auto',
          py: 1,
        }}>
        <ListItemButton
          onClick={() => onNavigate(PATHS.DASHBOARD)}
          sx={mobileItemSx(currentPath === PATHS.DASHBOARD)}
        >
          <ListItemIcon sx={{ minWidth: 32, color: 'inherit' }}>
            <GridViewRounded sx={{ fontSize: 18 }} />
          </ListItemIcon>
          <ListItemText
            primary="Dashboard"
            primaryTypographyProps={{
              fontFamily: 'Inter, sans-serif',
              fontSize: 13,
              fontWeight: currentPath === PATHS.DASHBOARD ? 600 : 400,
            }}
          />
        </ListItemButton>

        {sections.map((section, idx) => (
          <MobileNavSection
            key={section.id}
            section={section}
            items={getSubItems(section.id)}
            currentPath={currentPath}
            defaultOpen={idx === 0}
            onNavigate={onNavigate}
          />
        ))}

        <ListItemButton
          onClick={() => onNavigate(PATHS.ENGINEERING_SOP)}
          sx={mobileItemSx(currentPath === PATHS.ENGINEERING_SOP)}
        >
          <ListItemIcon sx={{ minWidth: 32, color: 'inherit' }}>
            <MenuBookRounded sx={{ fontSize: 18 }} />
          </ListItemIcon>
          <ListItemText
            primary="Engineering SOP"
            primaryTypographyProps={{
              fontFamily: 'Inter, sans-serif',
              fontSize: 13,
              fontWeight: currentPath === PATHS.ENGINEERING_SOP ? 600 : 400,
            }}
          />
        </ListItemButton>

        <ListItemButton
          onClick={() => onNavigate(PATHS.FAQ)}
          sx={mobileItemSx(currentPath === PATHS.FAQ)}
        >
          <ListItemIcon sx={{ minWidth: 32, color: 'inherit' }}>
            <HelpOutlineRounded sx={{ fontSize: 18 }} />
          </ListItemIcon>
          <ListItemText
            primary="FAQ"
            primaryTypographyProps={{
              fontFamily: 'Inter, sans-serif',
              fontSize: 13,
              fontWeight: currentPath === PATHS.FAQ ? 600 : 400,
            }}
          />
        </ListItemButton>

        {canSeeUserMgmt && (
          <ListItemButton
            onClick={() => onNavigate(PATHS.ADMIN_ACCOUNTS)}
            sx={mobileItemSx(isAdminPath)}
          >
            <ListItemIcon sx={{ minWidth: 32, color: 'inherit' }}>
              <AdminPanelSettingsRounded sx={{ fontSize: 18 }} />
            </ListItemIcon>
            <ListItemText
              primary="Administration"
              primaryTypographyProps={{
                fontFamily: 'Inter, sans-serif',
                fontSize: 13,
                fontWeight: isAdminPath ? 600 : 400,
              }}
            />
          </ListItemButton>
        )}
      </List>

      <Box sx={{ flexShrink: 0 }}>
        <Divider sx={{ borderColor: 'rgba(255,255,255,0.08)' }} />

        <ListItemButton
          onClick={onLogout}
          sx={{
            py: 1.25,
            mx: 0.75,
            mb: 0.75,
            borderRadius: 1.5,
            color: 'rgba(148,163,184,0.8)',
            '&:hover': {
              bgcolor: 'rgba(239,68,68,0.12)',
              color: '#f87171',
            },
          }}
        >
          <ListItemIcon sx={{ minWidth: 32, color: 'inherit' }}>
            <LogoutRounded sx={{ fontSize: 18 }} />
          </ListItemIcon>
        </ListItemButton>
      </Box>
    </Box>
  </Drawer>
);
