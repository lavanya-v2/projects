import { Box, Typography } from '@mui/material';
import { brandColors } from '../theme/tokens';

const { navy } = brandColors;

interface PageHeaderProps {
  title: string;
}

/** Large page title + optional section subtitle, shown above routed content. */
export const PageHeader = ({ title }: PageHeaderProps) => (
  <Box sx={{ mb: 3 }}>
    <Typography
      sx={{
        fontFamily: 'Poppins, sans-serif',
        fontSize: 20,
        fontWeight: 700,
        letterSpacing: -0.3,
        color: navy,
        lineHeight: 1.25,
      }}
    >
      {title}
    </Typography>
  </Box>
);
