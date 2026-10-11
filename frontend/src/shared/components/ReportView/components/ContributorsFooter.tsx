import { Box, Typography, Chip } from '@mui/material';
import type { ReportWindow } from '../types';

interface ContributorsFooterProps {
    teamMembers?: string[];
    reportWindow?: ReportWindow;
}

export const ContributorsFooter = ({ teamMembers, reportWindow }: ContributorsFooterProps) => {
    if (!teamMembers?.length && !reportWindow) return null;

    return (
        <Box
            sx={{
                mt: 2.5,
                display: 'flex',
                flexWrap: 'wrap',
                justifyContent: 'space-between',
                alignItems: 'flex-start',
                gap: 1.5,
            }}
        >
            {teamMembers && teamMembers.length > 0 && (
                <Box>
                    <Box sx={{ display: 'flex', alignItems: 'center', gap: 1, mb: 0.75 }}>
                        <Box
                            sx={{
                                width: 4,
                                height: 14,
                                bgcolor: '#546e7a',
                                borderRadius: 1,
                                flexShrink: 0,
                            }}
                        />
                        <Typography
                            variant="caption"
                            fontWeight={700}
                            color="text.secondary"
                            sx={{
                                letterSpacing: 0.3,
                                textTransform: 'uppercase',
                                fontSize: '0.68rem',
                            }}
                        >
                            Contributors
                        </Typography>
                    </Box>
                    <Box sx={{ display: 'flex', flexWrap: 'wrap', gap: 0.6 }}>
                        {teamMembers.map((member, index) => (
                            <Chip
                                key={index}
                                label={member}
                                variant="outlined"
                                size="small"
                                sx={{
                                    borderColor: '#b0bec5',
                                    color: 'text.secondary',
                                    fontSize: '0.72rem',
                                }}
                            />
                        ))}
                    </Box>
                </Box>
            )}
            {reportWindow && (
                <Typography
                    variant="caption"
                    color="text.disabled"
                    sx={{ alignSelf: 'flex-end' }}
                >
                    Activity: {reportWindow.start} → {reportWindow.end} (IST)
                </Typography>
            )}
        </Box>
    );
};
