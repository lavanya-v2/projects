import { Box, Typography } from '@mui/material';

interface BulletItemProps {
    text: string;
    color: string;
}

/** Single dot-bullet list item. */
export const BulletItem = ({ text, color }: BulletItemProps) => (
    <Box sx={{ display: 'flex', gap: 1, mb: 0.75, alignItems: 'flex-start' }}>
        <Box sx={{ width: 5, height: 5, borderRadius: '50%', bgcolor: color, mt: '6px', flexShrink: 0 }} />
        <Typography variant="body2" sx={{ lineHeight: 1.7, color: 'text.primary' }}>
            {text}
        </Typography>
    </Box>
);
