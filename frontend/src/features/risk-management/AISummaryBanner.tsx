import { Box, Typography, Paper, Chip } from '@mui/material';
import AutoAwesomeIcon from '@mui/icons-material/AutoAwesome';

interface AISummaryBannerProps {
    summary?: string | null;
}

export function AISummaryBanner({ summary }: AISummaryBannerProps) {
    return (
        <Paper
            elevation={0}
            sx={{
                p: 2,
                mb: 2,
                bgcolor: '#f0f4ff',
                border: '1px solid #c5d4ff',
                borderRadius: 2,
            }}
        >
            <Box sx={{ display: 'flex', alignItems: 'center', gap: 1, mb: 1 }}>
                <AutoAwesomeIcon sx={{ color: '#3949ab', fontSize: 18 }} />
                <Typography variant="subtitle2" fontWeight={700} color="#3949ab">
                    AI Summary
                </Typography>
                <Chip label="Claude" size="small" sx={{ height: 16, fontSize: '0.6rem', bgcolor: '#e8eaf6' }} />
            </Box>

            {summary ? (
                <Typography variant="body2" color="#1a2332" lineHeight={1.6}>
                    {summary}
                </Typography>
            ) : (
                <Typography variant="body2" color="text.secondary" fontStyle="italic">
                    No analysis available yet. Summary generates after the first update.
                </Typography>
            )}
        </Paper>
    );
}
