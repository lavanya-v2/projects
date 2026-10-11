import {
    Accordion,
    AccordionSummary,
    AccordionDetails,
    Box,
    Typography,
    Chip,
    Divider,
} from '@mui/material';
import ExpandMoreIcon from '@mui/icons-material/ExpandMore';
import { parseWorkSummary, matchTicketEntry } from '../utils/parseWorkSummary';

interface WorkSummarySectionProps {
    workSummary?: string;
}

/** Collapsed accordion that renders parsed work-summary sections with ticket chips. */
export const WorkSummarySection = ({ workSummary }: WorkSummarySectionProps) => (
    <Accordion
        defaultExpanded={false}
        elevation={1}
        sx={{ mt: 2, borderRadius: '8px !important', '&:before': { display: 'none' } }}
    >
        <AccordionSummary
            expandIcon={<ExpandMoreIcon />}
            sx={{
                px: { xs: 2, md: 3 },
                py: 1.5,
                minHeight: 0,
                '& .MuiAccordionSummary-content': { my: 0 },
            }}
        >
            <Box sx={{ display: 'flex', alignItems: 'center', gap: 1 }}>
                <Box
                    sx={{
                        width: 4,
                        height: 16,
                        bgcolor: '#1976d2',
                        borderRadius: 1,
                        flexShrink: 0,
                    }}
                />
                <Typography variant="subtitle1" fontWeight={700}>
                    Detailed Work Summary
                </Typography>
            </Box>
        </AccordionSummary>
        <AccordionDetails sx={{ px: { xs: 2, md: 3 }, pt: 0, pb: 3 }}>
            <Divider sx={{ mb: 2 }} />
            <WorkSummaryBody workSummary={workSummary} />
        </AccordionDetails>
    </Accordion>
);

const WorkSummaryBody = ({ workSummary }: { workSummary?: string }) => {
    if (!workSummary) {
        return (
            <Typography variant="body2" color="text.secondary">
                No detailed work summary available.
            </Typography>
        );
    }

    const sections = parseWorkSummary(workSummary);

    return (
        <>
            {sections.map((section, si) => (
                <Box
                    key={si}
                    sx={{
                        mb: 1.5,
                        pb: 1.5,
                        borderBottom: si < sections.length - 1 ? '1px solid #f0f0f0' : 'none',
                    }}
                >
                    {section.title && (
                        <Box
                            sx={{ display: 'flex', alignItems: 'center', gap: 0.75, mb: 0.75 }}
                        >
                            <Box
                                sx={{
                                    width: 3,
                                    height: 13,
                                    bgcolor: '#1565c0',
                                    borderRadius: 1,
                                    flexShrink: 0,
                                }}
                            />
                            <Typography
                                variant="subtitle2"
                                sx={{ fontWeight: 700, color: '#1565c0', fontSize: '0.8rem' }}
                            >
                                {section.title}
                            </Typography>
                        </Box>
                    )}
                    <Box
                        sx={{
                            display: 'flex',
                            flexDirection: 'column',
                            gap: 0.35,
                            pl: section.title ? 1.5 : 0,
                        }}
                    >
                        {section.entries.map((entry, ei) => {
                            const ticket = matchTicketEntry(entry);
                            if (ticket) {
                                return (
                                    <Box
                                        key={ei}
                                        sx={{
                                            display: 'flex',
                                            alignItems: 'baseline',
                                            gap: 0.75,
                                        }}
                                    >
                                        <Chip
                                            label={ticket.key}
                                            size="small"
                                            variant="outlined"
                                            sx={{
                                                borderColor: '#1565c0',
                                                color: '#1565c0',
                                                fontWeight: 700,
                                                fontSize: '0.6rem',
                                                height: 16,
                                                fontFamily: 'monospace',
                                                flexShrink: 0,
                                                borderRadius: '3px',
                                                '& .MuiChip-label': { px: 0.6 },
                                            }}
                                        />
                                        <Typography
                                            variant="body2"
                                            sx={{
                                                lineHeight: 1.5,
                                                flex: 1,
                                                fontSize: '0.82rem',
                                            }}
                                        >
                                            {ticket.description}
                                        </Typography>
                                    </Box>
                                );
                            }
                            return (
                                <Typography
                                    key={ei}
                                    variant="body2"
                                    sx={{
                                        lineHeight: 1.5,
                                        fontSize: '0.82rem',
                                        color: 'text.secondary',
                                    }}
                                >
                                    {entry}
                                </Typography>
                            );
                        })}
                    </Box>
                </Box>
            ))}
        </>
    );
};
