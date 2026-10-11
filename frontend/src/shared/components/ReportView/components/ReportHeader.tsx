import {
    Box,
    Typography,
    Chip,
    Button,
    Menu,
    MenuItem,
    ListItemIcon,
    Tooltip,
} from '@mui/material';
import DownloadIcon from '@mui/icons-material/Download';
import DescriptionIcon from '@mui/icons-material/Description';
import TableChartIcon from '@mui/icons-material/TableChart';
import InfoOutlinedIcon from '@mui/icons-material/InfoOutlined';
import { effectiveHealth, healthChipColor, severityOf } from '../utils/health';
import { parseHealthRationale } from '../utils/parseHealthRationale';
import type { ReportDownloadController } from '../hooks/useReportDownload';

interface ReportHeaderProps {
    title: string;
    computedHealth: string;
    insightsHealthOverride: string;
    healthRationale?: string;
    teamMemberAttribution?: Record<string, string[]> | null;
    download: ReportDownloadController;
}

export const ReportHeader = ({
    title,
    computedHealth,
    insightsHealthOverride,
    healthRationale,
    teamMemberAttribution,
    download,
}: ReportHeaderProps) => {
    const displayedHealth = effectiveHealth(computedHealth, insightsHealthOverride);
    const isEscalated =
        !!insightsHealthOverride &&
        severityOf(insightsHealthOverride) > severityOf(computedHealth);

    return (
        <Box sx={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', mb: 2 }}>
            <Box sx={{ display: 'flex', alignItems: 'center', gap: 1.5, flexWrap: 'wrap' }}>
                <Typography variant="h5" fontWeight={600}>
                    {title}
                </Typography>
                <Chip
                    label={displayedHealth}
                    color={healthChipColor(displayedHealth)}
                    size="small"
                    sx={{ fontWeight: 700 }}
                />
                {isEscalated && (
                    <Tooltip
                        title={`Computed: ${computedHealth} · Escalated by manager insights to ${insightsHealthOverride}`}
                    >
                        <Typography
                            variant="caption"
                            color="text.secondary"
                            sx={{ cursor: 'help', fontStyle: 'italic' }}
                        >
                            (escalated)
                        </Typography>
                    </Tooltip>
                )}
                {healthRationale && (
                    <HealthRationaleTooltip
                        rationale={healthRationale}
                        teamMemberAttribution={teamMemberAttribution}
                    />
                )}
            </Box>
            <Button
                variant="outlined"
                color="primary"
                size="small"
                startIcon={<DownloadIcon />}
                onClick={download.handleOpen}
            >
                Download
            </Button>
            <Menu anchorEl={download.anchorEl} open={download.open} onClose={download.handleClose}>
                <MenuItem onClick={() => download.handleDownload('text')}>
                    <ListItemIcon>
                        <DescriptionIcon fontSize="small" color="primary" />
                    </ListItemIcon>
                    Download Text
                </MenuItem>
                <MenuItem onClick={() => download.handleDownload('csv')}>
                    <ListItemIcon>
                        <TableChartIcon fontSize="small" color="primary" />
                    </ListItemIcon>
                    Download CSV
                </MenuItem>
            </Menu>
        </Box>
    );
};

const HealthRationaleTooltip = ({
    rationale,
    teamMemberAttribution,
}: {
    rationale: string;
    teamMemberAttribution?: Record<string, string[]> | null;
}) => {
    const lines = parseHealthRationale(rationale);
    const attributionEntries = Object.entries(teamMemberAttribution ?? {});
    const ATTRIBUTION_LIMIT = 10;
    const visibleAttribution = attributionEntries.slice(0, ATTRIBUTION_LIMIT);
    const hiddenAttributionCount = Math.max(0, attributionEntries.length - ATTRIBUTION_LIMIT);
    return (
        <Tooltip
            title={
                <Box sx={{ p: 0.5, minWidth: 260, maxWidth: 360 }}>
                    {lines.map((line, i) =>
                        line.dotColor ? (
                            <Box
                                key={i}
                                sx={{
                                    display: 'flex',
                                    alignItems: 'flex-start',
                                    gap: 1,
                                    mb: i < lines.length - 1 ? 1 : 0,
                                }}
                            >
                                <Box
                                    sx={{
                                        width: 8,
                                        height: 8,
                                        borderRadius: '50%',
                                        bgcolor: line.dotColor,
                                        flexShrink: 0,
                                        mt: '3px',
                                    }}
                                />
                                <Typography variant="caption" sx={{ lineHeight: 1.55 }}>
                                    {line.text}
                                </Typography>
                            </Box>
                        ) : (
                            <Typography
                                key={i}
                                variant="caption"
                                display="block"
                                sx={{ lineHeight: 1.6, mb: i < lines.length - 1 ? 0.5 : 0 }}
                            >
                                {line.text}
                            </Typography>
                        ),
                    )}
                    {visibleAttribution.length > 0 && (
                        <Box sx={{ mt: 1.25, pt: 1, borderTop: '1px solid rgba(255,255,255,0.18)' }}>
                            <Typography
                                variant="caption"
                                sx={{ fontWeight: 700, display: 'block', mb: 0.5 }}
                            >
                                V2 owner per ticket at report time
                            </Typography>
                            {visibleAttribution.map(([key, names]) => (
                                <Typography
                                    key={key}
                                    variant="caption"
                                    display="block"
                                    sx={{ lineHeight: 1.5 }}
                                >
                                    {key} — {names.join(', ')}
                                </Typography>
                            ))}
                            {hiddenAttributionCount > 0 && (
                                <Typography
                                    variant="caption"
                                    display="block"
                                    sx={{ lineHeight: 1.5, fontStyle: 'italic', opacity: 0.8 }}
                                >
                                    + {hiddenAttributionCount} more
                                </Typography>
                            )}
                        </Box>
                    )}
                </Box>
            }
            placement="bottom-start"
            arrow
        >
            <InfoOutlinedIcon
                sx={{ fontSize: 15, color: 'text.secondary', cursor: 'help', ml: 0.5 }}
            />
        </Tooltip>
    );
};
