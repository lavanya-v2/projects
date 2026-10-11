import { useState } from 'react';
import { Box, Typography, Avatar, Menu, MenuItem, Snackbar, Alert } from '@mui/material';
import { LogoutRounded, PersonRounded } from '@mui/icons-material';
import { brandColors } from '../theme/tokens';
import { ProfileDialog } from '../features/profile/ProfileDialog';

const { navy } = brandColors;

interface UserMenuProps {
  firstName?: string;
  lastName?: string;
  initials: string;
  roleLabel: string;
  onLogout: () => void;
}

/** Avatar + dropdown in the topbar's right zone. Owns its own anchor state. */
export const UserMenu = ({ firstName, lastName, initials, roleLabel, onLogout }: UserMenuProps) => {
  const [anchor, setAnchor] = useState<null | HTMLElement>(null);
  const [profileOpen, setProfileOpen] = useState(false);
  const [snackbarOpen, setSnackbarOpen] = useState(false);
  const [success, setSuccess] = useState<string | null>(null);

  const handleLogout = () => {
    setAnchor(null);
    onLogout();
  };

  const handleOpenProfile = () => {
    setAnchor(null);
    setProfileOpen(true);
  };

  return (
    <>
      <Box
        sx={{ display: 'flex', alignItems: 'center', gap: 1, cursor: 'pointer' }}
        onClick={(e) => setAnchor(e.currentTarget)}
      >
        <Box sx={{ textAlign: 'right', display: { xs: 'none', sm: 'block' } }}>
          <Typography sx={{ fontFamily: 'Inter, sans-serif', fontSize: 12, fontWeight: 600, color: navy, lineHeight: 1.2 }}>
            {firstName} {lastName}
          </Typography>
          {roleLabel && (
            <Typography
              sx={{
                fontFamily: 'Inter, sans-serif',
                fontSize: 10,
                color: '#9ca3af',
                textTransform: 'capitalize',
                lineHeight: 1.3,
              }}
            >
              {roleLabel}
            </Typography>
          )}
        </Box>
        <Avatar sx={{ width: 30, height: 30, bgcolor: navy, fontSize: 11, fontWeight: 700, flexShrink: 0 }}>
          {initials}
        </Avatar>
      </Box>

      <Menu
        open={!!anchor}
        anchorEl={anchor}
        onClose={() => setAnchor(null)}
        anchorOrigin={{ vertical: 'bottom', horizontal: 'right' }}
        transformOrigin={{ vertical: 'top', horizontal: 'right' }}
        PaperProps={{
          sx: {
            width: 200,
            mt: 0.5,
            borderRadius: 2,
            boxShadow: '0 8px 32px rgba(0,46,91,0.12)',
            border: '1px solid #e1e8f0',
          },
        }}
      >
        <Box sx={{ px: 2, py: 1.5, borderBottom: '1px solid #f0f4f8' }}>
          <Typography sx={{ fontFamily: 'Inter, sans-serif', fontSize: 13, fontWeight: 600, color: navy }}>
            {firstName} {lastName}
          </Typography>
          <Typography
            sx={{ fontFamily: 'Inter, sans-serif', fontSize: 11, color: '#9ca3af', textTransform: 'capitalize' }}
          >
            {roleLabel}
          </Typography>
        </Box>
        <MenuItem
          onClick={handleOpenProfile}
          sx={{ gap: 1, py: 1.25, mx: 0.5, borderRadius: 1, color: navy, fontSize: 13, mt: 0.5 }}
        >
          <PersonRounded sx={{ fontSize: 16 }} /> Profile
        </MenuItem>
        <MenuItem
          onClick={handleLogout}
          sx={{ gap: 1, py: 1.25, mx: 0.5, borderRadius: 1, color: '#ef4444', fontSize: 13 }}
        >
          <LogoutRounded sx={{ fontSize: 16 }} /> Sign Out
        </MenuItem>
      </Menu>

      <ProfileDialog open={profileOpen} onClose={() => setProfileOpen(false)}
        setSuccess={setSuccess}
        setSnackbarOpen={setSnackbarOpen} />

      <Snackbar
        open={snackbarOpen}
        autoHideDuration={3000}
        onClose={() => setSnackbarOpen(false)}
        anchorOrigin={{
          vertical: "top",
          horizontal: "center",
        }}
      >
        <Alert severity="success" variant="filled" onClose={() => setSnackbarOpen(false)}>
          {success}
        </Alert>
      </Snackbar>
    </>
  );
};
