import { useState } from 'react';
import { Box, Paper, Typography, Chip, CircularProgress, Alert, LinearProgress } from '@mui/material';
import AssignmentIcon from '@mui/icons-material/Assignment';
import WarningAmberIcon from '@mui/icons-material/WarningAmber';
import EventNoteIcon from '@mui/icons-material/EventNote';
import { InsightsWidget } from './InsightsWidget';
import { RiskDetailModal } from '../risk-management/RiskDetailModal';

const HEALTH_COLORS: Record<string, string> = {
    Green: '#4caf50',
    Amber: '#ff9800',
    Red: '#f44336',
};

const HEALTH_CHIP_COLOR: Record<string, 'success' | 'warning' | 'error'> = {
    Green: 'success',
    Amber: 'warning',
    Red: 'error',
};

const SPRINT_STATUS_COLOR: Record<string, 'success' | 'warning' | 'error' | 'default'> = {
    'on-track': 'success',
    'at-risk': 'warning',
    'critical': 'error',
    // On-the-go assignment model -- sprint pace deliberately not scored, neutral grey.
    'not-tracked': 'default',
};

const SPRINT_STATUS_LABEL: Record<string, string> = {
    'on-track': 'On Track',
    'at-risk': 'At Risk',
    'critical': 'Critical',
    'not-tracked': 'Pace Not Tracked',
};

// Thin stacked bar segment
function StackedSegment({ value, total, color, label }: { value: number; total: number; color: string; label: string }) {
    const flex = total > 0 ? value / total : 0;
    if (value === 0) return null;
    return (
        <Box
            title={`${label}: ${value}`}
            sx={{ flex, bgcolor: color, minWidth: 4, height: '100%' }}
        />
    );
}

interface Props {
    data: any;
    loading: boolean;
    error: string;
    readOnly?: boolean;
}

export const LeadDashboard = ({ data, loading, error, readOnly }: Props) => {
    const [viewRiskId, setViewRiskId] = useState<number | null>(null);
    const [riskModalOpen, setRiskModalOpen] = useState(false);

    if (loading) return (
        <Box sx={{ display: 'flex', justifyContent: 'center', py: 6 }}>
            <CircularProgress />
        </Box>
    );

    if (error) return <Alert severity="error">{error}</Alert>;

    const project = data?.project;
    if (!project) return (
        <Alert severity="info">No project assigned. Contact your administrator.</Alert>
    );

    const snap = project.latestSnapshot;
    const effectiveHealth = snap?.insightsHealth ?? snap?.overallHealth;
    const borderColor = HEALTH_COLORS[effectiveHealth ?? ''] ?? '#e2e8f0';

    // A bypassed marker carries no metrics (the sprint did not exist on that date), so it
    // must read as "no burndown" rather than as zeros.
    const rawBurndown = snap?.sprintBurndown as any;
    const burndown = rawBurndown?.bypassed ? null : rawBurndown;
    const sprintProgress = burndown?.completionPct ?? null;
    const sprintProgressSP = burndown?.completionPctSP ?? null;
    const completedSP = burndown?.completedV2SP ?? 0;
    const totalSP = burndown?.totalV2SP ?? 0;
    const inProgressSP = burndown?.inProgressSP ?? burndown?.inProgressV2SP ?? 0;
    const inQaSP = burndown?.inQaSP ?? 0;
    const blockedSP = burndown?.blockedSP ?? 0;
    const todoSP = burndown?.todoSP ?? 0;
    const daysElapsed = burndown?.daysElapsed ?? null;
    const daysTotal = burndown?.daysTotal ?? null;
    const sprintName = burndown?.sprintName ?? null;
    const sprintStatus: string | null = burndown?.onTrackStatus ?? null;
    const isKanban = project.workMode === 'kanban';

    const openAIs: any[] = project.openAIs ?? [];
    const overdueAICount: number = project.overdueAICount ?? 0;
    const activeRisks: any[] = project.activeRisks ?? [];
    const criticalRiskCount = activeRisks.filter((r: any) => r.priority === 'CRITICAL').length;

    const blockedTickets: any[] = snap?.blockedTickets ?? [];
    const executivePlan: string = snap?.executivePlan ?? '';

    const totalBarSP = completedSP + inProgressSP + inQaSP + blockedSP + todoSP;

    return (
        <Box>

            {/* ── Page header ─────────────────────────────────── */}
            <Box sx={{ display: 'flex', alignItems: 'flex-start', justifyContent: 'space-between', mb: 2.5, gap: 1 }}>
                <Box>
                    <Typography sx={{ fontSize: 22, fontWeight: 800, color: '#0f172a', letterSpacing: -0.5, lineHeight: 1.2 }}>
                        {project.name}
                    </Typography>
                    <Typography sx={{ fontSize: 13, color: '#64748b', mt: 0.5 }}>
                        {project.account?.name}{project.account?.name && ' · '}{isKanban ? 'Kanban' : 'Sprint'} Project
                    </Typography>
                </Box>
                <Box sx={{ display: 'flex', gap: 1, flexShrink: 0, mt: 0.5 }}>
                    {effectiveHealth && (
                        <Chip label={effectiveHealth} color={HEALTH_CHIP_COLOR[effectiveHealth]} sx={{ fontWeight: 700 }} />
                    )}
                    {sprintStatus && SPRINT_STATUS_LABEL[sprintStatus] && (
                        <Chip label={SPRINT_STATUS_LABEL[sprintStatus]} color={SPRINT_STATUS_COLOR[sprintStatus]} variant="outlined" />
                    )}
                </Box>
            </Box>

            {/* ── 4 Stat Cards ────────────────────────────────── */}
            <Box sx={{ display: 'grid', gridTemplateColumns: 'repeat(4, 1fr)', gap: 2, mb: 3 }}>
                {/* Sprint Progress */}
                <Paper sx={{
                    p: 2.25, borderRadius: 2,
                    borderLeft: `4px solid ${borderColor}`,
                    border: '1px solid #e2e8f0', boxShadow: '0 1px 3px rgba(0,0,0,.06)',
                }}>
                    <Typography sx={{ fontSize: 28, fontWeight: 800, color: '#0f172a', letterSpacing: -1, lineHeight: 1 }}>
                        {sprintProgress !== null ? `${sprintProgress}%` : '—'}
                    </Typography>
                    <Typography sx={{ fontSize: 12, color: '#94a3b8', mt: 0.5, fontWeight: 500, textTransform: 'uppercase', letterSpacing: .5 }}>
                        Sprint Progress (ticket)
                    </Typography>
                    <Typography sx={{ fontSize: 11, color: '#475569', mt: 0.25 }}>
                        {totalSP
                            ? `${completedSP}/${totalSP} SP${sprintProgressSP !== null ? ` · ${sprintProgressSP}% SP` : ''}`
                            : daysElapsed !== null ? `Day ${daysElapsed}/${daysTotal}` : '—'}
                    </Typography>
                </Paper>

                {/* Active Risks */}
                <Paper sx={{
                    p: 2.25, borderRadius: 2,
                    borderLeft: `4px solid ${activeRisks.length > 1 ? '#f44336' : activeRisks.length > 0 ? '#ff9800' : '#4caf50'}`,
                    border: '1px solid #e2e8f0', boxShadow: '0 1px 3px rgba(0,0,0,.06)',
                }}>
                    <Typography sx={{ fontSize: 28, fontWeight: 800, color: '#0f172a', letterSpacing: -1, lineHeight: 1 }}>
                        {activeRisks.length}
                    </Typography>
                    <Typography sx={{ fontSize: 12, color: '#94a3b8', mt: 0.5, fontWeight: 500, textTransform: 'uppercase', letterSpacing: .5 }}>
                        Active Risks
                    </Typography>
                    <Typography sx={{ fontSize: 11, color: '#475569', mt: 0.25 }}>
                        {criticalRiskCount > 0 ? `${criticalRiskCount} Critical` : 'None critical'}
                    </Typography>
                </Paper>

                {/* Open Action Items */}
                <Paper sx={{
                    p: 2.25, borderRadius: 2,
                    borderLeft: `4px solid ${openAIs.length > 3 ? '#ff9800' : '#1976d2'}`,
                    border: '1px solid #e2e8f0', boxShadow: '0 1px 3px rgba(0,0,0,.06)',
                }}>
                    <Typography sx={{ fontSize: 28, fontWeight: 800, color: '#0f172a', letterSpacing: -1, lineHeight: 1 }}>
                        {openAIs.length}
                    </Typography>
                    <Typography sx={{ fontSize: 12, color: '#94a3b8', mt: 0.5, fontWeight: 500, textTransform: 'uppercase', letterSpacing: .5 }}>
                        Open Action Items
                    </Typography>
                    <Typography sx={{ fontSize: 11, color: overdueAICount > 0 ? '#c62828' : '#475569', mt: 0.25 }}>
                        {overdueAICount > 0 ? `⏰ ${overdueAICount} Overdue` : 'All on track'}
                    </Typography>
                </Paper>

                {/* Today's Health */}
                <Paper sx={{
                    p: 2.25, borderRadius: 2,
                    borderLeft: `4px solid ${HEALTH_COLORS[effectiveHealth ?? ''] ?? '#e2e8f0'}`,
                    border: '1px solid #e2e8f0', boxShadow: '0 1px 3px rgba(0,0,0,.06)',
                }}>
                    <Typography sx={{ fontSize: 28, fontWeight: 800, color: HEALTH_COLORS[effectiveHealth ?? ''] ?? '#94a3b8', letterSpacing: -1, lineHeight: 1 }}>
                        {effectiveHealth ?? '—'}
                    </Typography>
                    <Typography sx={{ fontSize: 12, color: '#94a3b8', mt: 0.5, fontWeight: 500, textTransform: 'uppercase', letterSpacing: .5 }}>
                        Today's Health
                    </Typography>
                    <Typography sx={{ fontSize: 11, color: '#475569', mt: 0.25 }}>
                        {snap?.date ? new Date(snap.date).toLocaleDateString('en-IN', { day: 'numeric', month: 'short', year: 'numeric' }) : '—'}
                    </Typography>
                </Paper>
            </Box>

            {/* ── Sprint Overview ──────────────────────────────── */}
            {burndown && (
                <Paper sx={{ borderRadius: 2, border: '1px solid #e2e8f0', boxShadow: '0 1px 3px rgba(0,0,0,.08)', mb: 3, p: 2.5 }}>
                    <Typography sx={{ fontSize: 11, fontWeight: 700, textTransform: 'uppercase', color: '#94a3b8', letterSpacing: .6, mb: 1.5 }}>
                        {isKanban ? 'Kanban Status' : 'Sprint Progress'}
                    </Typography>

                    {isKanban ? (
                        <Box sx={{ display: 'grid', gridTemplateColumns: 'repeat(3, 1fr)', gap: 1.5 }}>
                            {[
                                { label: 'Done', value: completedSP, color: '#4caf50' },
                                { label: 'In Progress', value: inProgressSP, color: '#1976d2' },
                                { label: 'Blocked', value: blockedSP, color: '#f44336' },
                            ].map(s => (
                                <Box key={s.label} sx={{ textAlign: 'center', p: 1.5, bgcolor: '#f8fafc', borderRadius: 1.5 }}>
                                    <Typography sx={{ fontSize: 24, fontWeight: 700, color: s.color }}>{s.value}</Typography>
                                    <Typography sx={{ fontSize: 11, color: '#94a3b8', mt: 0.25 }}>{s.label}</Typography>
                                </Box>
                            ))}
                        </Box>
                    ) : (
                        <>
                            <Typography sx={{ fontSize: 12, color: '#64748b', mb: 1 }}>
                                {sprintName} · Day {daysElapsed ?? '?'}/{daysTotal ?? '?'}
                            </Typography>
                            <LinearProgress
                                variant="determinate"
                                value={Math.min(sprintProgress ?? 0, 100)}
                                sx={{
                                    height: 10, borderRadius: 5, mb: 1,
                                    bgcolor: '#e2e8f0',
                                    '& .MuiLinearProgress-bar': {
                                        bgcolor: (sprintProgress ?? 0) >= 80 ? '#4caf50' : (sprintProgress ?? 0) >= 50 ? '#ff9800' : '#f44336',
                                        borderRadius: 5,
                                    },
                                }}
                            />
                            <Box sx={{ display: 'flex', justifyContent: 'space-between', fontSize: 12, mb: 2 }}>
                                <Typography sx={{ fontSize: 12 }}>
                                    <strong>{completedSP}</strong> SP done of <strong>{totalSP}</strong>
                                </Typography>
                            </Box>

                            {/* Stacked SP bar */}
                            {totalBarSP > 0 && (
                                <>
                                    <Box sx={{ display: 'flex', height: 18, borderRadius: 1, overflow: 'hidden', mb: 1 }}>
                                        <StackedSegment value={completedSP} total={totalBarSP} color="#4caf50" label="Done" />
                                        <StackedSegment value={inProgressSP} total={totalBarSP} color="#1976d2" label="In Progress" />
                                        <StackedSegment value={inQaSP} total={totalBarSP} color="#ff9800" label="In QA" />
                                        <StackedSegment value={blockedSP} total={totalBarSP} color="#f44336" label="Blocked" />
                                        <StackedSegment value={todoSP} total={totalBarSP} color="#9e9e9e" label="Todo" />
                                    </Box>
                                    <Box sx={{ display: 'flex', flexWrap: 'wrap', gap: 1.5 }}>
                                        {[
                                            { label: 'Done', value: completedSP, color: '#4caf50' },
                                            { label: 'In Progress', value: inProgressSP, color: '#1976d2' },
                                            { label: 'In QA', value: inQaSP, color: '#ff9800' },
                                            { label: 'Blocked', value: blockedSP, color: '#f44336' },
                                            { label: 'Todo', value: todoSP, color: '#9e9e9e' },
                                        ].filter(s => s.value > 0).map(s => (
                                            <Box key={s.label} sx={{ display: 'flex', alignItems: 'center', gap: 0.5 }}>
                                                <Box sx={{ width: 10, height: 10, borderRadius: .5, bgcolor: s.color }} />
                                                <Typography sx={{ fontSize: 12, color: '#475569' }}>
                                                    {s.label}: <strong>{s.value}</strong>
                                                </Typography>
                                            </Box>
                                        ))}
                                    </Box>
                                </>
                            )}
                        </>
                    )}
                </Paper>
            )}

            {/* ── Latest DSR Snapshot ──────────────────────────── */}
            {snap?.execSummarySnippet && (
                <Paper sx={{ borderRadius: 2, border: '1px solid #e2e8f0', boxShadow: '0 1px 3px rgba(0,0,0,.08)', mb: 3, p: 2.5 }}>
                    <Box sx={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', mb: 1.5 }}>
                        <Box sx={{ display: 'flex', alignItems: 'center', gap: 1 }}>
                            <EventNoteIcon sx={{ fontSize: 16, color: '#94a3b8' }} />
                            <Typography sx={{ fontSize: 11, fontWeight: 700, textTransform: 'uppercase', color: '#94a3b8', letterSpacing: .6 }}>
                                Latest DSR{snap.date ? ` — ${new Date(snap.date).toLocaleDateString('en-IN', { day: 'numeric', month: 'short', year: 'numeric' })}` : ''}
                            </Typography>
                        </Box>
                        {effectiveHealth && (
                            <Chip label={effectiveHealth} size="small" color={HEALTH_CHIP_COLOR[effectiveHealth]} sx={{ fontSize: 11, fontWeight: 700 }} />
                        )}
                    </Box>

                    <Typography sx={{ fontSize: 13, color: '#475569', lineHeight: 1.65, mb: 1.5 }}>
                        {snap.execSummarySnippet.slice(0, 300)}{snap.execSummarySnippet.length > 300 ? '...' : ''}
                    </Typography>

                    {/* Blocked tickets */}
                    {blockedTickets.length > 0 && (
                        <Box sx={{ mt: 1.5 }}>
                            <Typography sx={{ fontSize: 10, fontWeight: 700, textTransform: 'uppercase', color: '#94a3b8', letterSpacing: .6, mb: 1 }}>
                                Blocked Tickets ({blockedTickets.length})
                            </Typography>
                            {blockedTickets.map((b: any, i: number) => (
                                <Box key={i} sx={{ display: 'flex', alignItems: 'center', gap: 1, mb: 0.75, flexWrap: 'wrap' }}>
                                    <Chip label={b.key ?? b.ticketKey ?? `#${i + 1}`} size="small" color="error" sx={{ fontSize: 10, fontWeight: 700 }} />
                                    {b.lane && <Chip label={b.lane} size="small" sx={{ fontSize: 10, bgcolor: '#f1f5f9', color: '#64748b' }} />}
                                    {b.status && <Chip label={b.status} size="small" sx={{ fontSize: 10, bgcolor: '#f1f5f9', color: '#64748b' }} />}
                                    {b.assignee && <Chip label={b.assignee} size="small" sx={{ fontSize: 10, bgcolor: '#f1f5f9', color: '#64748b' }} />}
                                    <Typography sx={{ fontSize: 12, color: '#64748b' }} noWrap>
                                        {(b.summary ?? '').slice(0, 80)}
                                    </Typography>
                                </Box>
                            ))}
                        </Box>
                    )}

                    {/* Executive plan for next day */}
                    {executivePlan && (
                        <Box sx={{ mt: 1.5, pt: 1.5, borderTop: '1px solid #f1f5f9' }}>
                            <Typography sx={{ fontSize: 10, fontWeight: 700, textTransform: 'uppercase', color: '#94a3b8', letterSpacing: .6, mb: 0.75 }}>
                                Plan for Tomorrow
                            </Typography>
                            <Typography sx={{ fontSize: 12, color: '#475569', lineHeight: 1.6 }}>
                                {executivePlan}
                            </Typography>
                        </Box>
                    )}
                </Paper>
            )}

            {/* ── Risks + Action Items (2-col) ─────────────────── */}
            <Box sx={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 2, mb: 3 }}>
                {/* Active Risks */}
                <Paper sx={{ borderRadius: 2, border: '1px solid #e2e8f0', boxShadow: '0 1px 3px rgba(0,0,0,.08)' }}>
                    <Box sx={{ px: 2.5, py: 1.5, borderBottom: '1px solid #f1f5f9', display: 'flex', alignItems: 'center', gap: 1 }}>
                        <WarningAmberIcon sx={{ fontSize: 16, color: '#e65100' }} />
                        <Typography sx={{ fontSize: 13, fontWeight: 700, color: '#0f172a' }}>
                            Active Risks ({activeRisks.length})
                        </Typography>
                    </Box>
                    <Box sx={{ p: 2 }}>
                        {activeRisks.length === 0 ? (
                            <Typography sx={{ fontSize: 13, color: '#94a3b8' }}>No active risks.</Typography>
                        ) : activeRisks.map((risk: any) => (
                            <Box
                                key={risk.id}
                                onClick={() => { setViewRiskId(risk.id); setRiskModalOpen(true); }}
                                sx={{
                                    display: 'flex', gap: 1, py: 0.75,
                                    borderBottom: '1px solid #f8fafc', '&:last-child': { borderBottom: 'none' },
                                    cursor: 'pointer', borderRadius: 1, px: 0.5,
                                    '&:hover': { bgcolor: '#f8fafc' },
                                }}
                            >
                                <Typography sx={{ fontSize: 14, mt: 0.1, flexShrink: 0 }}>
                                    {risk.priority === 'CRITICAL' ? '🔴' : risk.priority === 'HIGH' ? '🟠' : '🟡'}
                                </Typography>
                                <Box sx={{ flex: 1, minWidth: 0 }}>
                                    <Typography sx={{ fontSize: 13, color: '#0f172a', fontWeight: 500 }} noWrap title={risk.title}>
                                        {risk.title}
                                    </Typography>
                                    <Box sx={{ display: 'flex', gap: 0.75, mt: 0.5, flexWrap: 'wrap' }}>
                                        {risk.priority && <Chip label={risk.priority} size="small" sx={{ fontSize: 10, height: 18 }} />}
                                        {risk.status && <Chip label={risk.status} size="small" variant="outlined" sx={{ fontSize: 10, height: 18 }} />}
                                    </Box>
                                </Box>
                            </Box>
                        ))}
                    </Box>
                </Paper>

                {/* Open Action Items */}
                <Paper sx={{ borderRadius: 2, border: '1px solid #e2e8f0', boxShadow: '0 1px 3px rgba(0,0,0,.08)' }}>
                    <Box sx={{ px: 2.5, py: 1.5, borderBottom: '1px solid #f1f5f9', display: 'flex', alignItems: 'center', gap: 1 }}>
                        <AssignmentIcon sx={{ fontSize: 16, color: '#6a1b9a' }} />
                        <Typography sx={{ fontSize: 13, fontWeight: 700, color: '#0f172a' }}>
                            Action Items ({openAIs.length} shown)
                        </Typography>
                    </Box>
                    <Box sx={{ p: 2 }}>
                        {openAIs.length === 0 ? (
                            <Typography sx={{ fontSize: 13, color: '#94a3b8' }}>No open action items.</Typography>
                        ) : openAIs.map((ai: any) => {
                            const overdue = ai.dueDate && new Date(ai.dueDate) < new Date();
                            return (
                                <Box key={ai.id} sx={{
                                    display: 'flex', gap: 1, py: 0.75,
                                    borderBottom: '1px solid #f8fafc', '&:last-child': { borderBottom: 'none' },
                                    bgcolor: overdue ? '#fff5f5' : 'transparent', borderRadius: 0.5,
                                }}>
                                    <Box sx={{ flex: 1, minWidth: 0 }}>
                                        <Typography sx={{ fontSize: 13, color: '#0f172a', fontWeight: 500 }} noWrap title={ai.title}>
                                            {ai.title}
                                        </Typography>
                                        <Typography sx={{ fontSize: 11, color: '#94a3b8' }}>
                                            {ai.owner}{ai.dueDate ? ` · Due ${ai.dueDate}` : ''}
                                        </Typography>
                                    </Box>
                                    <Box sx={{ flexShrink: 0, textAlign: 'right' }}>
                                        <Chip
                                            label={ai.status}
                                            size="small"
                                            color={ai.status === 'In-Progress' ? 'warning' : 'default'}
                                            sx={{ fontSize: 10 }}
                                        />
                                        {overdue && (
                                            <Typography sx={{ fontSize: 10, color: '#c62828', fontWeight: 700, mt: 0.25 }}>
                                                ⏰ Overdue
                                            </Typography>
                                        )}
                                    </Box>
                                </Box>
                            );
                        })}
                    </Box>
                </Paper>
            </Box>

            {/* ── Insights Widget ──────────────────────────────── */}
            <Paper sx={{ borderRadius: 2, border: '1px solid #e2e8f0', boxShadow: '0 1px 3px rgba(0,0,0,.08)' }}>
                <InsightsWidget projectId={project.id} readOnly={readOnly} />
            </Paper>

            {/* Risk view-only modal */}
            <RiskDetailModal
                riskId={viewRiskId}
                open={riskModalOpen}
                onClose={() => { setRiskModalOpen(false); setViewRiskId(null); }}
                onRiskUpdated={() => {}}
                viewOnly
            />
        </Box>
    );
};
