import { Box, Typography } from '@mui/material';

interface SectionHeaderProps {
    color: string;
    title: string;
}

/** Accent-dot section header: a thin vertical bar next to a bold label. */
export const SectionHeader = ({ color, title }: SectionHeaderProps) => (
    <Box sx={{ display: 'flex', alignItems: 'center', gap: 1, mb: 1.5 }}>
        <Box sx={{ width: 4, height: 18, bgcolor: color, borderRadius: 1, flexShrink: 0 }} />
        <Typography variant="subtitle1" fontWeight={700} sx={{ letterSpacing: 0.2 }}>
            {title}
        </Typography>
    </Box>
);
