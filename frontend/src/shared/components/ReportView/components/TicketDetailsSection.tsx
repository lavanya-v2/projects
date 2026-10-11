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
import {
    parseTicketDetails,
    typeColor,
    detectStatus,
    statusColor,
    type DetectedStatus,
} from '../utils/parseTicketDetails';

export interface TicketDetailStructuredEntry {
    key: string;
    issueType: string;
    status: string;
    description: string;
}

interface TicketDetailsSectionProps {
    ticketDetails: string;
    ticketKeys?: Record<string, string> | null;
    ticketDetailsStructured?: TicketDetailStructuredEntry[] | null;
}

export const TicketDetailsSection = ({
    ticketDetails,
    ticketKeys,
    ticketDetailsStructured,
}: TicketDetailsSectionProps) => (
    <Accordion
        defaultExpanded={false}
        elevation={1}
        sx={{ mt: 1.5, borderRadius: '8px !important', '&:before': { display: 'none' } }}
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
                        bgcolor: '#546e7a',
                        borderRadius: 1,
                        flexShrink: 0,
                    }}
                />
                <Typography variant="subtitle1" fontWeight={700}>
                    Ticket-Level Details
                </Typography>
            </Box>
        </AccordionSummary>
        <AccordionDetails sx={{ px: { xs: 2, md: 3 }, pt: 0, pb: 3 }}>
            <Divider sx={{ mb: 2 }} />
            <TicketDetailsBody
                ticketDetails={ticketDetails}
                ticketKeys={ticketKeys}
                ticketDetailsStructured={ticketDetailsStructured}
            />
        </AccordionDetails>
    </Accordion>
);

// A row shape both the structured (Jira-accurate) and legacy (AI-text-parsed) paths render
// through identically — only how each row is built differs.
interface TicketRow {
    key: string;
    type: string;
    description: string;
}

const TicketDetailsBody = ({
    ticketDetails,
    ticketKeys,
    ticketDetailsStructured,
}: {
    ticketDetails: string;
    ticketKeys?: Record<string, string> | null;
    ticketDetailsStructured?: TicketDetailStructuredEntry[] | null;
}) => {
    // Prefer the structured, Jira-derived field when present — it never depends on the AI
    // reproducing an exact `[Type]` format, so no issue type (Spike or otherwise) can silently
    // fall through to plain text. Older snapshots (generated before this field existed) fall
    // back to the legacy text-parsing path unchanged.
    if (ticketDetailsStructured && ticketDetailsStructured.length > 0) {
        return (
            <Box sx={{ display: 'flex', flexDirection: 'column', gap: 0.75 }}>
                {ticketDetailsStructured.map((t, i) => (
                    <TicketRowView
                        key={i}
                        row={{ key: t.key, type: t.issueType, description: t.description }}
                        status={t.status ? { label: t.status, color: statusColor(t.status) } : null}
                    />
                ))}
            </Box>
        );
    }

    const { lines, parsed, hasValid } = parseTicketDetails(ticketDetails);

    if (!hasValid) {
        return (
            <Typography variant="body2" sx={{ whiteSpace: 'pre-line', lineHeight: 1.8 }}>
                {ticketDetails}
            </Typography>
        );
    }

    return (
        <Box sx={{ display: 'flex', flexDirection: 'column', gap: 0.75 }}>
            {parsed.map((t, i) => {
                if (!t) {
                    return (
                        <Typography
                            key={i}
                            variant="caption"
                            color="text.secondary"
                            sx={{ pl: 0.5 }}
                        >
                            {lines[i]}
                        </Typography>
                    );
                }
                const realStatus = ticketKeys?.[t.key];
                const status = realStatus
                    ? { label: realStatus, color: statusColor(realStatus) }
                    : detectStatus(t.description);
                return (
                    <TicketRowView
                        key={i}
                        row={{ key: t.key, type: t.type, description: t.description }}
                        status={status}
                    />
                );
            })}
        </Box>
    );
};

const TicketRowView = ({
    row,
    status,
}: {
    row: TicketRow;
    status: DetectedStatus | null;
}) => {
    const tc = typeColor(row.type);
    return (
        <Box
            sx={{
                display: 'flex',
                alignItems: 'flex-start',
                gap: 1,
                px: 1.5,
                py: 0.75,
                borderRadius: 1.5,
                bgcolor: '#fafafa',
                border: '1px solid #f0f0f0',
                '&:hover': { bgcolor: '#f0f4ff' },
            }}
        >
            <Chip
                label={row.type}
                size="small"
                sx={{
                    bgcolor: tc,
                    color: '#fff',
                    fontWeight: 700,
                    fontSize: '0.62rem',
                    height: 18,
                    flexShrink: 0,
                    mt: 0.25,
                    borderRadius: '4px',
                    '& .MuiChip-label': { px: 0.75 },
                }}
            />
            <Chip
                label={row.key}
                size="small"
                variant="outlined"
                sx={{
                    borderColor: tc,
                    color: tc,
                    fontWeight: 700,
                    fontSize: '0.62rem',
                    height: 18,
                    fontFamily: 'monospace',
                    flexShrink: 0,
                    mt: 0.25,
                    borderRadius: '4px',
                    '& .MuiChip-label': { px: 0.75 },
                }}
            />
            <Typography
                variant="caption"
                sx={{ flex: 1, lineHeight: 1.6, pt: 0.15, color: 'text.primary' }}
            >
                {row.description}
            </Typography>
            {status && (
                <Chip
                    label={status.label}
                    size="small"
                    sx={{
                        bgcolor: status.color + '15',
                        color: status.color,
                        border: `1px solid ${status.color}50`,
                        fontWeight: 700,
                        fontSize: '0.62rem',
                        height: 18,
                        flexShrink: 0,
                        mt: 0.25,
                        borderRadius: '4px',
                        '& .MuiChip-label': { px: 0.75 },
                    }}
                />
            )}
        </Box>
    );
};
