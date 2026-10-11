import { Box, Paper, Typography, Chip, LinearProgress, Tooltip } from '@mui/material';
import TrendingUpIcon from '@mui/icons-material/TrendingUp';
import AssignmentIcon from '@mui/icons-material/Assignment';
import WarningAmberIcon from '@mui/icons-material/WarningAmber';
import type { DashboardProject } from '../../types';

const HEALTH_COLORS: Record<string, string> = {
    Green: '#4caf50',
    Amber: '#ff9800',
    Red: '#f44336',
};

const HEALTH_CHIP_COLOR: Record<string, 'success' | 'warning' | 'error' | 'default'> = {
    Green: 'success',
    Amber: 'warning',
    Red: 'error',
};

const SPRINT_STATUS_LABEL: Record<string, string> = {
    'on-track': 'On Track',
    'at-risk': 'At Risk',
    'critical': 'Critical',
    'not-tracked': 'Pace Not Tracked',
};

const SPRINT_STATUS_COLOR: Record<string, 'success' | 'warning' | 'error' | 'default'> = {
    'on-track': 'success',
    'at-risk': 'warning',
    'critical': 'error',
    // On-the-go assignment model -- sprint pace deliberately not scored, neutral grey.
    'not-tracked': 'default',
};

interface Props {
    project: DashboardProject;
    onClick?: () => void;
}

export const ProjectTile = ({ project, onClick }: Props) => {
    const snap = project.latestSnapshot;
    const effectiveHealth = snap?.insightsHealth
        ? (snap.insightsHealth > (snap.overallHealth ?? '') ? snap.insightsHealth : snap.overallHealth)
        : snap?.overallHealth;

    const borderColor = HEALTH_COLORS[effectiveHealth ?? ''] ?? '#e2e8f0';

    // A bypassed marker carries no metrics (the sprint did not exist on that date), so it
    // must read as "no burndown" rather than as zeros.
    const rawBurndown = snap?.sprintBurndown as any;
    const burndown = rawBurndown?.bypassed ? null : rawBurndown;
    // Use stored completionPct — completedV2SP / totalV2SP
    const sprintProgress = burndown?.completionPct ?? null;
    const sprintProgressSP = burndown?.completionPctSP ?? null;
    const completedSP = burndown?.completedV2SP ?? null;
    const totalSP = burndown?.totalV2SP ?? null;
    const sprintName = burndown?.sprintName ?? null;
    const daysElapsed = burndown?.daysElapsed ?? null;
    const daysTotal = burndown?.daysTotal ?? null;
    const sprintStatus: string | null = (project as any).sprintStatus ?? burndown?.onTrackStatus ?? null;
    const isKanban = (project as any).workMode === 'kanban';

    const healthTooltip = [
        (snap as any)?.healthRationale ?? null,
        (snap as any)?.insightsHealthReason ? `Escalated: ${(snap as any).insightsHealthReason}` : null,
    ].filter(Boolean).join('\n\n');

    return (
        <Paper
            onClick={onClick}
            sx={{
                borderRadius: 2,
                border: '1px solid #e2e8f0',
                borderLeft: `4px solid ${borderColor}`,
                boxShadow: '0 1px 3px rgba(0,0,0,.08)',
                cursor: onClick ? 'pointer' : 'default',
                transition: 'box-shadow .15s, transform .15s',
                '&:hover': onClick ? { boxShadow: '0 4px 12px rgba(0,0,0,.12)', transform: 'translateY(-1px)' } : {},
                overflow: 'hidden',
            }}
        >
            {/* Header */}
            <Box sx={{ px: 2.5, pt: 2, pb: 0.5 }}>
                <Box sx={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', mb: 0.5 }}>
                    <Typography sx={{ fontSize: 15, fontWeight: 700, color: '#0f172a', lineHeight: 1.3, flex: 1, mr: 1 }}>
                        {project.name}
                    </Typography>
                    {effectiveHealth && (
                        <Tooltip title={healthTooltip} arrow disableHoverListener={!healthTooltip}>
                            <Chip
                                label={effectiveHealth}
                                size="small"
                                color={HEALTH_CHIP_COLOR[effectiveHealth] ?? 'default'}
                                sx={{ fontSize: 11, fontWeight: 700, flexShrink: 0 }}
                            />
                        </Tooltip>
                    )}
                </Box>
                {project.account && (
                    <Typography sx={{ fontSize: 11, color: '#94a3b8', mb: 0.75 }}>{project.account.name}</Typography>
                )}
            </Box>

            {/* Sprint info label + progress */}
            {sprintProgress !== null && (
                <Box sx={{ px: 2.5, pb: 1.5 }}>
                    {/* "Sprint 24 · Day 7 of 14" or "Kanban · 3 days in" */}
                    {(sprintName || daysElapsed !== null) && (
                        <Typography sx={{ fontSize: 11, color: '#94a3b8', mb: 0.75 }}>
                            {isKanban
                                ? `Kanban · ${daysElapsed ?? '?'} days in`
                                : `${sprintName ?? 'Sprint'} · Day ${daysElapsed ?? '?'} of ${daysTotal ?? '?'}`}
                        </Typography>
                    )}

                    {/* Progress row: "31/50 SP · 62%" + status chip */}
                    <Box sx={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', mb: 0.5 }}>
                        <Typography sx={{ fontSize: 11, color: '#64748b', display: 'flex', alignItems: 'center', gap: 0.5 }}>
                            <TrendingUpIcon sx={{ fontSize: 13 }} />
                            {isKanban
                                ? `${completedSP ?? 0} done`
                                : `${completedSP ?? 0}/${totalSP ?? '?'} SP`}
                        </Typography>
                        <Box sx={{ display: 'flex', alignItems: 'center', gap: 0.75 }}>
                            <Typography sx={{ fontSize: 11, fontWeight: 700, color: '#0f172a' }}>
                                {sprintProgress}% ticket
                                {sprintProgressSP !== null && (
                                    <Box component="span" sx={{ fontWeight: 500, color: '#64748b', ml: 0.5 }}>
                                        · {sprintProgressSP}% SP
                                    </Box>
                                )}
                            </Typography>
                            {sprintStatus && SPRINT_STATUS_LABEL[sprintStatus] && (
                                <Chip
                                    label={SPRINT_STATUS_LABEL[sprintStatus]}
                                    size="small"
                                    color={SPRINT_STATUS_COLOR[sprintStatus]}
                                    sx={{ fontSize: 10, height: 18, '& .MuiChip-label': { px: 0.75 } }}
                                />
                            )}
                        </Box>
                    </Box>

                    <LinearProgress
                        variant="determinate"
                        value={Math.min(sprintProgress, 100)}
                        sx={{
                            height: 6, borderRadius: 3,
                            bgcolor: '#e2e8f0',
                            '& .MuiLinearProgress-bar': {
                                bgcolor: sprintProgress >= 80 ? '#4caf50' : sprintProgress >= 50 ? '#ff9800' : '#f44336',
                                borderRadius: 3,
                            },
                        }}
                    />
                </Box>
            )}

            {/* DSR snippet */}
            {snap?.execSummarySnippet && (
                <Box sx={{ px: 2.5, pb: 1.5 }}>
                    <Typography
                        sx={{
                            fontSize: 12, color: '#475569', lineHeight: 1.5,
                            display: '-webkit-box', WebkitLineClamp: 2,
                            WebkitBoxOrient: 'vertical', overflow: 'hidden',
                            fontStyle: 'italic',
                        }}
                    >
                        "{snap.execSummarySnippet}"
                    </Typography>
                </Box>
            )}

            {/* Footer */}
            <Box sx={{ px: 2.5, pb: 2, display: 'flex', gap: 1.5, alignItems: 'center', borderTop: '1px solid #f1f5f9', pt: 1.25 }}>
                {snap?.date && (
                    <Typography sx={{ fontSize: 11, color: '#94a3b8', flex: 1 }}>
                        {new Date(snap.date).toLocaleDateString('en-IN', { day: 'numeric', month: 'short' })}
                    </Typography>
                )}
                {project.openAICount > 0 && (
                    <Tooltip title={`${project.openAICount} open action items`}>
                        <Box sx={{ display: 'flex', alignItems: 'center', gap: 0.4, color: '#64748b' }}>
                            <AssignmentIcon sx={{ fontSize: 13 }} />
                            <Typography sx={{ fontSize: 11, fontWeight: 600 }}>{project.openAICount}</Typography>
                        </Box>
                    </Tooltip>
                )}
                {(project as any).overdueAICount > 0 && (
                    <Tooltip title={`${(project as any).overdueAICount} overdue`}>
                        <Box sx={{ display: 'flex', alignItems: 'center', gap: 0.4, color: '#c62828' }}>
                            <Typography sx={{ fontSize: 11, fontWeight: 700 }}>⏰ {(project as any).overdueAICount}</Typography>
                        </Box>
                    </Tooltip>
                )}
                {project.activeRiskCount > 0 && (
                    <Tooltip title={`${project.activeRiskCount} active risks`}>
                        <Box sx={{ display: 'flex', alignItems: 'center', gap: 0.4, color: '#e65100' }}>
                            <WarningAmberIcon sx={{ fontSize: 13 }} />
                            <Typography sx={{ fontSize: 11, fontWeight: 600 }}>{project.activeRiskCount}</Typography>
                        </Box>
                    </Tooltip>
                )}
            </Box>
        </Paper>
    );
};
