import { Box, Typography, Chip, Tooltip } from '@mui/material';
import type { SprintBurndown } from '../types';
import { unitLabels } from '../../../utils/estimationUnit';
import type { EstimationType } from '../../../utils/estimationUnit';

interface SprintProgressStripProps {
    sb: SprintBurndown;
    // Informational extras (not in RAG). Snapshot-side counts surfaced alongside
    // the strip so the team can see sub-bug pressure and rework load at a glance.
    subBugsLoggedCount?: number | null;
    reopenedTicketsCount?: number | null;
    estimationType?: EstimationType;
}

interface Segment {
    key: string;
    label: string;
    sp: number;
    color: string;
}

// 'not-tracked' = on-the-go assignment model (see Project.sprintAssignmentModel) --
// genuinely neutral grey, never green/amber/red, since no pace assessment is being made.
const statusColorOf = (status: string): string =>
    status === 'critical' ? '#c62828' : status === 'at-risk' ? '#e65100' : status === 'not-tracked' ? '#757575' : '#2e7d32';
const statusLabelOf = (status: string): string =>
    status === 'critical' ? 'CRITICAL' : status === 'at-risk' ? 'AT RISK' : status === 'not-tracked' ? 'PACE NOT TRACKED' : 'ON TRACK';

/** The sprint burndown strip pinned to the bottom of the daily hero Paper. */
export const SprintProgressStrip = ({ sb, subBugsLoggedCount, reopenedTicketsCount, estimationType }: SprintProgressStripProps) => {
    const statusColor = statusColorOf(sb.onTrackStatus);
    const statusLabel = statusLabelOf(sb.onTrackStatus);
    const unit = unitLabels(estimationType).short;

    const doneSP = sb.completedV2SP ?? 0;
    const uatSP = sb.inUatSP ?? 0;
    const qaSP = sb.inQaSP ?? 0;
    const reviewSP = sb.inReviewSP ?? 0;
    const ipSP = sb.inProgressSP ?? 0;
    const blkSP = sb.blockedSP ?? 0;
    const reopSP = sb.reopenedSP ?? 0;
    const tdSP = sb.todoSP ?? 0;
    const totalBarSP = sb.totalV2SP ?? 0;
    const useSP = !!sb.usedSP && totalBarSP > 0;

    const pct = (val: number) => (totalBarSP > 0 ? Math.min((val / totalBarSP) * 100, 100) : 0);

    const segments: Segment[] = [
        { key: 'done',     label: 'Done',         sp: doneSP,   color: '#4caf50' },
        { key: 'uat',      label: 'UAT',          sp: uatSP,    color: '#9c27b0' },
        { key: 'qa',       label: 'QA / Testing', sp: qaSP,     color: '#ff9800' },
        { key: 'review',   label: 'In Review',    sp: reviewSP, color: '#009688' },
        { key: 'progress', label: 'In Progress',  sp: ipSP,     color: '#1976d2' },
        { key: 'blocked',  label: 'Blocked',      sp: blkSP,    color: '#f44336' },
        { key: 'reopened', label: 'Reopened',     sp: reopSP,   color: '#e64a19' },
        { key: 'todo',     label: 'To Do',        sp: tdSP,     color: '#9e9e9e' },
    ];

    return (
        <Box sx={{ borderTop: '1px solid #f0f0f0', px: { xs: 2.5, md: 3.5 }, py: 2.5 }}>
            <Box
                sx={{
                    display: 'flex',
                    alignItems: 'center',
                    justifyContent: 'space-between',
                    mb: 1.5,
                }}
            >
                <Box sx={{ display: 'flex', alignItems: 'center', gap: 1 }}>
                    <Box sx={{ width: 4, height: 16, bgcolor: statusColor, borderRadius: 1, flexShrink: 0 }} />
                    <Typography variant="subtitle2" fontWeight={700}>
                        Sprint Progress
                    </Typography>
                    <Typography variant="caption" color="text.secondary">
                        {sb.sprintName} · Team
                    </Typography>
                </Box>
                <Chip
                    label={statusLabel}
                    size="small"
                    sx={{
                        bgcolor: statusColor,
                        color: '#fff',
                        fontWeight: 700,
                        fontSize: '0.68rem',
                        letterSpacing: 0.4,
                    }}
                />
            </Box>
            <Box sx={{ display: 'flex', flexDirection: 'column', gap: 1 }}>
                <TimelineRow sb={sb} />
                <PipelineRow
                    sb={sb}
                    statusColor={statusColor}
                    segments={segments}
                    useSP={useSP}
                    pct={pct}
                    unit={unit}
                />
            </Box>
            {sb.onTrackStatus === 'not-tracked' && (
                <Typography variant="caption" color="text.disabled" sx={{ display: 'block', mt: 0.5, fontStyle: 'italic' }}>
                    Reflects the whole board&rsquo;s movement, not just this team&rsquo;s assigned tickets.
                </Typography>
            )}
            {useSP && (
                <Box
                    sx={{
                        display: 'flex',
                        alignItems: 'center',
                        gap: 1.5,
                        mt: 1,
                        flexWrap: 'wrap',
                    }}
                >
                    {segments
                        .filter(s => s.sp > 0)
                        .map(seg => (
                            <Box
                                key={seg.key}
                                sx={{ display: 'flex', alignItems: 'center', gap: 0.5 }}
                            >
                                <Box
                                    sx={{
                                        width: 8,
                                        height: 8,
                                        bgcolor: seg.color,
                                        borderRadius: '50%',
                                        flexShrink: 0,
                                    }}
                                />
                                <Typography variant="caption" color="text.secondary">
                                    {seg.label} ({seg.sp} {unit})
                                </Typography>
                            </Box>
                        ))}
                </Box>
            )}
            <Box
                sx={{
                    display: 'flex',
                    alignItems: 'center',
                    gap: 1,
                    mt: 1,
                    flexWrap: 'wrap',
                }}
            >
                <Typography variant="caption" color="text.secondary">
                    {sb.storiesPending} {sb.storiesPending === 1 ? 'story' : 'stories'} pending
                </Typography>
                <Typography variant="caption" color="text.disabled">·</Typography>
                {sb.onTrackStatus === 'not-tracked' ? (
                    <Typography variant="caption" color="text.secondary">
                        Pace not scored for this team&rsquo;s working model
                        {' · '}This team contributed {sb.v2CurrentCompletedSP ?? 0} {unit} to done
                        {sb.inProgressV2SP != null && sb.inProgressV2SP > 0 && (
                            <> · has {sb.inProgressV2SP} {unit} in progress</>
                        )}
                    </Typography>
                ) : (
                    <Typography
                        variant="caption"
                        fontWeight={600}
                        sx={{ color: sb.offTrackPct > 0 ? statusColor : '#2e7d32' }}
                    >
                        {sb.offTrackPct > 0
                            ? `${sb.offTrackPct}% behind expected pace`
                            : 'On expected pace'}
                    </Typography>
                )}
                <Typography variant="caption" color="text.disabled">·</Typography>
                <Typography variant="caption" color="text.secondary">
                    {sb.daysPending} {sb.daysPending === 1 ? 'day' : 'days'} remaining
                </Typography>
                {subBugsLoggedCount != null && (
                    <>
                        <Typography variant="caption" color="text.disabled">·</Typography>
                        <Typography variant="caption" color="text.secondary">
                            {subBugsLoggedCount} sub-bug{subBugsLoggedCount === 1 ? '' : 's'} logged
                        </Typography>
                    </>
                )}
                {reopenedTicketsCount != null && (
                    <>
                        <Typography variant="caption" color="text.disabled">·</Typography>
                        <Typography variant="caption" color="text.secondary">
                            {reopenedTicketsCount} tkt{reopenedTicketsCount === 1 ? '' : 's'} in reopened lane
                        </Typography>
                    </>
                )}
            </Box>
            {sb.doneStatusLabels && sb.doneStatusLabels.length > 0 && (
                <Typography variant="caption" color="text.disabled" sx={{ display: 'block', mt: 0.5 }}>
                    Done = {sb.doneStatusLabels.join(', ')}
                </Typography>
            )}
        </Box>
    );
};

const TimelineRow = ({ sb }: { sb: SprintBurndown }) => (
    <Box sx={{ display: 'flex', alignItems: 'center', gap: 1.5 }}>
        <Typography variant="caption" color="text.secondary" sx={{ minWidth: 68, flexShrink: 0 }}>
            Timeline
        </Typography>
        <Typography variant="caption" color="text.secondary" sx={{ minWidth: 72, flexShrink: 0 }}>
            Day {sb.daysElapsed}/{sb.daysTotal}
        </Typography>
        <Box sx={{ flex: 1, position: 'relative', height: 7, bgcolor: '#e8eaf6', borderRadius: 4 }}>
            <Box
                sx={{
                    position: 'absolute',
                    left: 0,
                    top: 0,
                    height: '100%',
                    width: `${Math.min(sb.sprintElapsedPct, 100)}%`,
                    bgcolor: '#7986cb',
                    borderRadius: 4,
                    transition: 'width 0.4s',
                }}
            />
        </Box>
        <Typography
            variant="caption"
            color="text.secondary"
            sx={{ minWidth: 32, textAlign: 'right', flexShrink: 0 }}
        >
            {sb.sprintElapsedPct}%
        </Typography>
    </Box>
);

const PipelineRow = ({
    sb,
    statusColor,
    segments,
    useSP,
    pct,
    unit,
}: {
    sb: SprintBurndown;
    statusColor: string;
    segments: Segment[];
    useSP: boolean;
    pct: (val: number) => number;
    unit: string;
}) => {
    // On-the-go assignment model: the bar shows TEAM-WIDE committed scope (the whole
    // sprint), not this team's own slice -- with this team's contribution to "done"
    // highlighted within the done fill. See Project.sprintAssignmentModel doc.
    if (sb.onTrackStatus === 'not-tracked') {
        const totalSprintSP = sb.totalSprintSP ?? 0;
        const completedSprintSP = sb.completedSprintSP ?? 0;
        const v2Contribution = Math.min(sb.v2CurrentCompletedSP ?? 0, completedSprintSP);
        const othersContribution = Math.max(0, completedSprintSP - v2Contribution);
        const teamPct = (val: number) => (totalSprintSP > 0 ? Math.min((val / totalSprintSP) * 100, 100) : 0);

        return (
            <Box sx={{ display: 'flex', alignItems: 'center', gap: 1.5 }}>
                <Typography variant="caption" color="text.secondary" sx={{ minWidth: 68, flexShrink: 0 }}>
                    Pipeline
                </Typography>
                <Typography variant="caption" color="text.secondary" sx={{ minWidth: 72, flexShrink: 0 }}>
                    {sb.completedSprintTickets ?? 0}/{sb.totalSprintTickets ?? 0} done
                    {totalSprintSP > 0 && <> · {completedSprintSP}/{totalSprintSP} {unit}</>}
                </Typography>
                <Box
                    sx={{
                        flex: 1,
                        position: 'relative',
                        height: 10,
                        bgcolor: '#eeeeee',
                        borderRadius: 4,
                        display: 'flex',
                        overflow: 'hidden',
                    }}
                >
                    {v2Contribution > 0 && (
                        <Tooltip title={`This team's contribution to done: ${v2Contribution} ${unit}`} arrow>
                            <Box sx={{ width: `${teamPct(v2Contribution)}%`, height: '100%', bgcolor: '#2e7d32', flexShrink: 0 }} />
                        </Tooltip>
                    )}
                    {othersContribution > 0 && (
                        <Tooltip title={`Completed by the rest of the team: ${othersContribution} ${unit}`} arrow>
                            <Box sx={{ width: `${teamPct(othersContribution)}%`, height: '100%', bgcolor: '#a5d6a7', flexShrink: 0 }} />
                        </Tooltip>
                    )}
                </Box>
                <Box sx={{ display: 'flex', flexDirection: 'column', alignItems: 'flex-end', minWidth: 60, flexShrink: 0 }}>
                    <Typography variant="caption" fontWeight={700} sx={{ lineHeight: 1.2, color: statusColor }}>
                        {sb.completionPct}% ticket
                    </Typography>
                    {sb.completionPctSP != null && (
                        <Typography variant="caption" sx={{ lineHeight: 1.2, color: 'text.secondary', fontSize: '0.65rem' }}>
                            {sb.completionPctSP}% {unit}
                        </Typography>
                    )}
                </Box>
            </Box>
        );
    }

    return (
    <Box sx={{ display: 'flex', alignItems: 'center', gap: 1.5 }}>
        <Typography variant="caption" color="text.secondary" sx={{ minWidth: 68, flexShrink: 0 }}>
            Pipeline
        </Typography>
        <Typography variant="caption" color="text.secondary" sx={{ minWidth: 72, flexShrink: 0 }}>
            {sb.completedV2Tickets}/{sb.totalV2Tickets} done
            {useSP && sb.completedV2SP != null && sb.totalV2SP != null && (
                <> · {sb.completedV2SP}/{sb.totalV2SP} {unit}</>
            )}
        </Typography>
        {useSP ? (
            <Box
                sx={{
                    flex: 1,
                    position: 'relative',
                    height: 10,
                    bgcolor: '#eeeeee',
                    borderRadius: 4,
                    display: 'flex',
                    overflow: 'hidden',
                }}
            >
                {segments.map((seg, idx) => {
                    const w = pct(seg.sp);
                    if (w <= 0) return null;
                    const visibleBefore = segments.slice(0, idx).some(s => s.sp > 0);
                    const visibleAfter = segments.slice(idx + 1).some(s => s.sp > 0);
                    return (
                        <Tooltip key={seg.key} title={`${seg.label}: ${seg.sp} ${unit}`} arrow>
                            <Box
                                sx={{
                                    width: `${w}%`,
                                    height: '100%',
                                    bgcolor: seg.color,
                                    borderRadius:
                                        !visibleBefore && !visibleAfter
                                            ? 4
                                            : !visibleBefore
                                                ? '4px 0 0 4px'
                                                : !visibleAfter
                                                    ? '0 4px 4px 0'
                                                    : 0,
                                    cursor: 'default',
                                    flexShrink: 0,
                                }}
                            />
                        </Tooltip>
                    );
                })}
                <ExpectedMarker sprintElapsedPct={sb.sprintElapsedPct} />
            </Box>
        ) : (
            /* Fallback: simple ticket-count completion bar when no SP */
            <Box
                sx={{
                    flex: 1,
                    position: 'relative',
                    height: 10,
                    bgcolor: '#eeeeee',
                    borderRadius: 4,
                    overflow: 'visible',
                }}
            >
                <Box
                    sx={{
                        position: 'absolute',
                        left: 0,
                        top: 0,
                        height: '100%',
                        width: `${
                            sb.totalV2Tickets > 0
                                ? Math.min((sb.completedV2Tickets / sb.totalV2Tickets) * 100, 100)
                                : 0
                        }%`,
                        bgcolor: statusColor,
                        borderRadius: 4,
                        transition: 'width 0.4s',
                    }}
                />
                <ExpectedMarker sprintElapsedPct={sb.sprintElapsedPct} />
            </Box>
        )}
        <Box sx={{ display: 'flex', flexDirection: 'column', alignItems: 'flex-end', minWidth: 60, flexShrink: 0 }}>
            <Typography
                variant="caption"
                fontWeight={700}
                sx={{ lineHeight: 1.2, color: statusColor }}
            >
                {sb.completionPct}% ticket
            </Typography>
            {sb.completionPctSP != null && (
                <Typography
                    variant="caption"
                    sx={{ lineHeight: 1.2, color: 'text.secondary', fontSize: '0.65rem' }}
                >
                    {sb.completionPctSP}% {unit}
                </Typography>
            )}
        </Box>
    </Box>
    );
};

const ExpectedMarker = ({ sprintElapsedPct }: { sprintElapsedPct: number }) => (
    <Tooltip title={`Expected by now: ${sprintElapsedPct}%`}>
        <Box
            sx={{
                position: 'absolute',
                top: -2,
                height: 14,
                width: 2,
                bgcolor: '#616161',
                borderRadius: 1,
                cursor: 'help',
                zIndex: 2,
                left: `${Math.min(sprintElapsedPct, 98)}%`,
            }}
        />
    </Tooltip>
);
