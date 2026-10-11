import { Box, Typography, Button } from '@mui/material';
import { useNavigate } from 'react-router-dom';
import { PATHS } from '../../routes/paths';

interface Props {
  /** Optional message shown under the 404 heading. */
  message?: string;
}

/**
 * Full-page "not found / no access" fallback. Used for deep links the current
 * user isn't allowed to see (the API returns 403/404) or that don't exist.
 */
export const NotFound = ({ message }: Props) => {
  const navigate = useNavigate();
  return (
    <Box
      sx={{
        minHeight: '100vh',
        display: 'flex',
        flexDirection: 'column',
        alignItems: 'center',
        justifyContent: 'center',
        textAlign: 'center',
        px: 3,
        gap: 1,
      }}
    >
      <Typography sx={{ fontSize: 72, fontWeight: 700, color: '#0d1b2e', lineHeight: 1 }}>404</Typography>
      <Typography variant="h6" fontWeight={600}>Page not found</Typography>
      <Typography variant="body2" color="text.secondary" sx={{ maxWidth: 420, mb: 2 }}>
        {message ?? "This page doesn't exist, or you don't have access to it."}
      </Typography>
      <Button variant="contained" onClick={() => navigate(PATHS.DASHBOARD)}>
        Back to Dashboard
      </Button>
    </Box>
  );
};
