import { Box, Typography, IconButton } from '@mui/material';
import { Menu as MenuIcon, ChevronRight } from '@mui/icons-material';
import { useAuth } from '../context/AuthContext';
import { usePermissions } from '../shared/hooks/usePermissions';
import { brandColors } from '../theme/tokens';
import { TOPBAR_H } from './constants';
import { AccountSwitcherMenu } from './AccountSwitcherMenu';
import { UserMenu } from './UserMenu';
import { useAccount } from '../context/UseAccount';

const { navy } = brandColors;

interface TopBarProps {
  isMobile: boolean;
  contentLeft: number;
  sectionLabel: string | null;
  pageLabel: string;
  tabLabel: string | null;
  onMobileMenuOpen: () => void;
  onLogout: () => void;
}

/** Fixed top bar: breadcrumb on the left, user controls on the right. */
export const TopBar = ({
  isMobile,
  contentLeft,
  sectionLabel,
  pageLabel,
  tabLabel,
  onMobileMenuOpen,
  onLogout,
}: TopBarProps) => {
  const { user } = useAuth();
  const { accounts, activeAccount, setActiveAccount } = useAccount();
  const { roleLabel } = usePermissions();

  const userInitials = `${user?.firstName?.[0] ?? ''}${user?.lastName?.[0] ?? ''}`.toUpperCase();

  return (
    <Box
      sx={{
        position: 'fixed',
        top: 0,
        right: 0,
        left: { xs: 0, md: contentLeft },
        height: TOPBAR_H,
        bgcolor: '#fff',
        borderBottom: '1px solid #e8ecf0',
        boxShadow: '0 1px 3px rgba(0,0,0,0.05)',
        display: 'flex',
        alignItems: 'center',
        px: { xs: 2, md: 2.5 },
        gap: 1,
        zIndex: 1050,
        transition: 'left 200ms cubic-bezier(0.4,0,0.2,1)',
      }}
    >
      {isMobile && (
        <IconButton size="small" onClick={onMobileMenuOpen} sx={{ mr: 0.5, color: navy }}>
          <MenuIcon fontSize="small" />
        </IconButton>
      )}

      <Box sx={{ display: 'flex', alignItems: 'center', gap: 0.75, flex: 1, minWidth: 0 }}>
        {sectionLabel && (
          <>
            <Typography sx={{ fontFamily: 'Inter, sans-serif', fontSize: 13, fontWeight: 600, color: '#9ca3af', whiteSpace: 'nowrap' }}>
              {sectionLabel}
            </Typography>
            <ChevronRight sx={{ fontSize: 14, color: '#cbd5e1' }} />
          </>
        )}
        <Typography
          sx={{
            fontFamily: 'Inter, sans-serif',
            fontSize: 13,
            fontWeight: 600,
            color: tabLabel ? '#9ca3af' : navy,
            whiteSpace: 'nowrap',
            overflow: 'hidden',
            textOverflow: 'ellipsis',
          }}
        >
          {pageLabel}
        </Typography>
        {tabLabel && (
          <>
            <ChevronRight sx={{ fontSize: 14, color: '#cbd5e1' }} />
            <Typography
              sx={{
                fontFamily: 'Inter, sans-serif',
                fontSize: 13,
                fontWeight: 600,
                color: navy,
                whiteSpace: 'nowrap',
                overflow: 'hidden',
                textOverflow: 'ellipsis',
              }}
            >
              {tabLabel}
            </Typography>
          </>
        )}
      </Box>

      <Box sx={{ display: 'flex', alignItems: 'center', gap: 1, flexShrink: 0 }}>
        <AccountSwitcherMenu
          accounts={accounts}
          activeAccount={activeAccount}
          onSelect={setActiveAccount}
        />

        <UserMenu
          firstName={user?.firstName}
          lastName={user?.lastName}
          initials={userInitials}
          roleLabel={roleLabel}
          onLogout={onLogout}
        />
      </Box>
    </Box>
  );
};
