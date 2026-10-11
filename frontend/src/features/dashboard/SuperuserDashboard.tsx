import { useState } from 'react';
import {
    Box, Typography, CircularProgress, Alert, Paper, Tooltip, Chip,
    Table, TableBody, TableCell, TableContainer, TableHead, TableRow, Button,
} from '@mui/material';
import { AccountTile } from './AccountTile';
import { RiskDetailModal } from '../risk-management/RiskDetailModal';
import type { DashboardAccount } from '../../types';
import dayjs from 'dayjs';

interface Props {
    data: DashboardData;
    loading: boolean;
    error: string;
    isAdmin?: boolean;
    onNavigateToProject?: (projectId: number) => void;
    onNavigateToRisks?: () => void;
    onNavigateToActionItems?: () => void;

}

interface DashboardRisk {
    id: number;
    priority: string;
    title: string;
    status: string;
    project?: { name: string };
}

interface DashboardActionItem {
    id: number;
    title: string;
    project?: { name: string };
    owner?: string;
    status: string;
    createdAt: string;
}

interface ProjectHealth {
    id: number;
    name: string;
    accountName?: string | null;
    health: string;
    insightsHealth: string;
    latestSnapshot?: {
        healthRationale?: string;
        insightsHealthReason?: string;
    } | null;
    sprintStatus?: string | null;
    activeRiskCount: number;
    openAICount: number;
}

interface DashboardData {
    accounts?: DashboardAccount[];
    topRisks?: DashboardRisk[];
    totalActiveRisks?: number;
    longPendingAIs?: DashboardActionItem[];
    projectHealthList?: ProjectHealth[];
    recentActionItems?: DashboardActionItem[];
}

const HEALTH_DOT_COLOR: Record<string, string> = {
    Green: '#4caf50',
    Amber: '#ff9800',
    Red: '#f44336',
};

const HEALTH_RANK: Record<string, number> = { Red: 0, Amber: 1, Green: 2 };
const SPRINT_RANK: Record<string, number> = { critical: 0, 'at-risk': 1, 'on-track': 2 };
const SPRINT_TEXT_COLOR: Record<string, string> = {
    'on-track': '#2e7d32',
    'at-risk': '#e65100',
    'critical': '#c62828',
};
const SPRINT_LABEL: Record<string, string> = {
    'on-track': 'On Track',
    'at-risk': 'At Risk',
    'critical': 'Critical',
};

const PRIORITY_ICON: Record<string, string> = {
    CRITICAL: '🔴',
    HIGH: '🟠',
    MEDIUM: '🟡',
    LOW: '🟢',
};

function effectiveHealth(p: { health: string; insightsHealth: string; }): string {
    if (!p.health && !p.insightsHealth) return '';
    const SEVERITY: Record<string, number> = { Red: 2, Amber: 1, Green: 0 };
    const h = p.health ?? '';
    const ih = p.insightsHealth ?? '';
    return (SEVERITY[ih] ?? -1) > (SEVERITY[h] ?? -1) ? ih : h;
}

function buildHealthTooltip(snap: { healthRationale?: string; insightsHealthReason?: string }): string {
    return [
        snap?.healthRationale ?? null,
        snap?.insightsHealthReason ? `Escalated: ${snap.insightsHealthReason}` : null,
    ].filter(Boolean).join('\n\n');
}

export const SuperuserDashboard = ({ data, loading, error, isAdmin, onNavigateToProject, onNavigateToRisks, onNavigateToActionItems }: Props) => {
    const [viewRiskId, setViewRiskId] = useState<number | null>(null);
    const [riskModalOpen, setRiskModalOpen] = useState(false);
    const [showAllGreen, setShowAllGreen] = useState(false);

    if (loading) return (
        <Box sx={{ display: 'flex', justifyContent: 'center', py: 6 }}>
            <CircularProgress />
        </Box>
    );

    if (error) return <Alert severity="error">{error}</Alert>;

    const accounts: DashboardAccount[] = data?.accounts ?? [];
    const topRisks = data?.topRisks ?? [];
    const totalActiveRisks: number = data?.totalActiveRisks ?? 0;
    const longPendingAIs = data?.longPendingAIs ?? [];
    const projectHealthList = data?.projectHealthList ?? [];
    const recentActionItems = data?.recentActionItems ?? [];

    const criticalRisks = topRisks.filter(r => r.priority === 'CRITICAL');
    const today = new Date().toLocaleDateString('en-US', { weekday: 'long', month: 'long', day: 'numeric', year: 'numeric' });

    const openRisk = (riskId: number) => {
        setViewRiskId(riskId);
        setRiskModalOpen(true);
    };

    // Sort project health list: Red → Amber → Green, then by sprint status
    const sortedHealthList = [...projectHealthList].sort((a, b) => {
        const ha = HEALTH_RANK[effectiveHealth(a)] ?? 3;
        const hb = HEALTH_RANK[effectiveHealth(b)] ?? 3;
        if (ha !== hb) return ha - hb;
        return (SPRINT_RANK[a.sprintStatus ?? ''] ?? 3) - (SPRINT_RANK[b.sprintStatus ?? ''] ?? 3);
    });

    const badHealth = sortedHealthList.filter(p => {
        const h = effectiveHealth(p);
        return h === 'Red' || h === 'Amber';
    });
    const greenHealth = sortedHealthList.filter(p => {
        const h = effectiveHealth(p);
        return h !== 'Red' && h !== 'Amber';
    });
    const visibleGreen = showAllGreen ? greenHealth : greenHealth.slice(0, 3);
    const hiddenGreenCount = greenHealth.length - 3;
    const visibleHealthList = [...badHealth, ...visibleGreen];

    return (
        <Box>
            {/* ── Executive Overview header ────────────────────── */}
            <Box sx={{ mb: 2.5 }}>
                <Typography sx={{ fontSize: 22, fontWeight: 800, color: '#0f172a', letterSpacing: -0.5 }}>
                    Executive Overview {isAdmin ? '(Admin)' : ''}
                </Typography>
                <Typography sx={{ fontSize: 13, color: '#475569', mt: 0.5 }}>
                    All Accounts · {today}
                </Typography>
            </Box>

            {/* ── Alerts ──────────────────────────────────────── */}
            {criticalRisks.length > 0 && (
                <Alert severity="error" sx={{ mb: 1.5 }}>
                    🚨 <strong>{criticalRisks.length} CRITICAL risk{criticalRisks.length !== 1 ? 's' : ''}</strong> active across all accounts — immediate attention required.
                </Alert>
            )}
            {longPendingAIs.length > 0 && (
                <Alert severity="warning" sx={{ mb: 2.5 }}>
                    ⏰ <strong>{longPendingAIs.length} action item{longPendingAIs.length !== 1 ? 's' : ''}</strong> are long-pending across all projects.
                </Alert>
            )}

            {/* ── Account tiles ────────────────────────────────── */}
            {accounts.length === 0 ? (
                <Alert severity="info">No accounts found.</Alert>
            ) : (
                <>
                    <Typography sx={{ fontSize: 11, fontWeight: 700, textTransform: 'uppercase', color: '#94a3b8', letterSpacing: '.8px', mb: 1.5 }}>
                        Accounts ({accounts.length})
                    </Typography>
                    <Box sx={{ display: 'grid', gridTemplateColumns: { xs: '1fr', sm: 'repeat(2, 1fr)', lg: 'repeat(3, 1fr)' }, gap: 2.5, mb: 4 }}>
                        {accounts.map(account => (
                            <AccountTile key={account.id} account={account} />
                        ))}
                    </Box>
                </>
            )}

            {/* ── 2-col middle section ─────────────────────────── */}
            <Box sx={{ mb: 3 }}>

                {/* Project Health List */}
                {projectHealthList.length > 0 && (
                    <Paper sx={{ borderRadius: 2, border: '1px solid #e2e8f0', boxShadow: '0 1px 3px rgba(0,0,0,.08)', overflow: 'hidden' }}>
                        <Box sx={{ px: 2.5, py: 1.5, borderBottom: '1px solid #e2e8f0', display: 'flex', alignItems: 'center', gap: 1.25 }}>
                            <Box sx={{ width: 4, height: 20, bgcolor: '#1976d2', borderRadius: 0.5 }} />
                            <Typography sx={{ fontSize: 13, fontWeight: 700, color: '#0f172a' }}>
                                Project Health
                            </Typography>
                        </Box>
                        <TableContainer>
                            <Table size="small">
                                <TableHead>
                                    <TableRow sx={{ bgcolor: '#f8fafc' }}>
                                        <TableCell sx={{ fontSize: 10, fontWeight: 700, textTransform: 'uppercase', letterSpacing: .5, color: '#94a3b8' }}>Project</TableCell>
                                        <TableCell sx={{ fontSize: 10, fontWeight: 700, textTransform: 'uppercase', letterSpacing: .5, color: '#94a3b8' }}>Health</TableCell>
                                        <TableCell sx={{ fontSize: 10, fontWeight: 700, textTransform: 'uppercase', letterSpacing: .5, color: '#94a3b8', display: { xs: 'none', md: 'table-cell' } }}>Sprint</TableCell>
                                        <TableCell sx={{ fontSize: 10, fontWeight: 700, textTransform: 'uppercase', letterSpacing: .5, color: '#94a3b8' }}>Risks / AIs</TableCell>
                                    </TableRow>
                                </TableHead>
                                <TableBody>
                                    {visibleHealthList.map((p) => {
                                        const health = effectiveHealth(p);
                                        const healthTip = buildHealthTooltip(p.latestSnapshot || {});
                                        const dotColor = HEALTH_DOT_COLOR[health] ?? '#94a3b8';
                                        const sprintColor = SPRINT_TEXT_COLOR[p.sprintStatus ?? ''] ?? '#94a3b8';
                                        return (
                                            <TableRow key={p.id} hover sx={{ cursor: 'default' }}>
                                                <TableCell>
                                                    {onNavigateToProject ? (
                                                        <Typography
                                                            onClick={() => onNavigateToProject(p.id)}
                                                            sx={{ fontSize: 13, fontWeight: 600, color: '#1976d2', cursor: 'pointer', '&:hover': { textDecoration: 'underline' } }}
                                                            noWrap
                                                        >
                                                            {p.name}
                                                        </Typography>
                                                    ) : (
                                                        <Typography sx={{ fontSize: 13, fontWeight: 600 }} noWrap>{p.name}</Typography>
                                                    )}
                                                    {p.accountName && (
                                                        <Typography sx={{ fontSize: 10, color: '#94a3b8' }} noWrap>{p.accountName}</Typography>
                                                    )}
                                                </TableCell>
                                                <TableCell>
                                                    {health ? (
                                                        <Tooltip title={healthTip} arrow disableHoverListener={!healthTip}>
                                                            <Box sx={{ display: 'flex', alignItems: 'center', gap: 0.75 }}>
                                                                <Box sx={{ width: 8, height: 8, borderRadius: '50%', bgcolor: dotColor, flexShrink: 0 }} />
                                                                <Typography sx={{ fontSize: 12, color: dotColor, fontWeight: 600 }}>{health}</Typography>
                                                            </Box>
                                                        </Tooltip>
                                                    ) : <Typography sx={{ fontSize: 12, color: '#94a3b8' }}>—</Typography>}
                                                </TableCell>
                                                <TableCell sx={{ display: { xs: 'none', md: 'table-cell' } }}>
                                                    {p.sprintStatus && SPRINT_LABEL[p.sprintStatus] ? (
                                                        <Typography sx={{ fontSize: 12, color: sprintColor, fontWeight: 600 }}>
                                                            {SPRINT_LABEL[p.sprintStatus]}
                                                        </Typography>
                                                    ) : <Typography sx={{ fontSize: 12, color: '#94a3b8' }}>—</Typography>}
                                                </TableCell>
                                                <TableCell>
                                                    <Box sx={{ display: 'flex', alignItems: 'center', gap: 0.5 }}>
                                                        {p.activeRiskCount > 0 ? (
                                                            <Typography sx={{ fontSize: 12, color: p.activeRiskCount > 1 ? '#c62828' : '#e65100', fontWeight: 700 }}>
                                                                ⚠ {p.activeRiskCount}
                                                            </Typography>
                                                        ) : (
                                                            <Typography sx={{ fontSize: 12, color: '#94a3b8' }}>—</Typography>
                                                        )}
                                                        {p.openAICount > 0 && (
                                                            <Typography sx={{ fontSize: 12, color: '#1976d2', fontWeight: 600 }}>
                                                                · {p.openAICount} AIs
                                                            </Typography>
                                                        )}
                                                    </Box>
                                                </TableCell>
                                            </TableRow>
                                        );
                                    })}
                                </TableBody>
                            </Table>
                        </TableContainer>
                        {!showAllGreen && hiddenGreenCount > 0 && (
                            <Box sx={{ px: 2.5, py: 1.25, borderTop: '1px solid #f1f5f9' }}>
                                <Button
                                    size="small"
                                    onClick={() => setShowAllGreen(true)}
                                    sx={{ fontSize: 12, color: '#475569', textTransform: 'none', p: 0 }}
                                >
                                    Show {hiddenGreenCount} more healthy project{hiddenGreenCount !== 1 ? 's' : ''} ▾
                                </Button>
                            </Box>
                        )}
                    </Paper>
                )}

                {/* Top Risks panel */}
                <Paper sx={{ borderRadius: 2, border: '1px solid #e2e8f0', mt: 3, boxShadow: '0 1px 3px rgba(0,0,0,.08)' }}>
                    <Box sx={{ px: 2.5, py: 1.5, borderBottom: '1px solid #e2e8f0', display: 'flex', alignItems: 'center', gap: 1.25 }}>
                        <Box sx={{ width: 4, height: 20, bgcolor: '#e65100', borderRadius: 0.5 }} />
                        <Typography sx={{ fontSize: 13, fontWeight: 700, color: '#0f172a', flex: 1 }}>
                            Top Risks
                            {totalActiveRisks > 0 && (
                                <Box component="span" sx={{ ml: 1, px: 0.75, py: 0.1, bgcolor: '#fff3e0', color: '#e65100', borderRadius: 1, fontSize: 11, fontWeight: 700 }}>
                                    {totalActiveRisks}
                                </Box>
                            )}
                        </Typography>
                        {totalActiveRisks > topRisks.length && onNavigateToRisks && (
                            <Button
                                size="small"
                                onClick={onNavigateToRisks}
                                sx={{ fontSize: 11, color: '#1976d2', textTransform: 'none', fontWeight: 600, minWidth: 0, p: 0 }}
                            >
                                View All →
                            </Button>
                        )}
                    </Box>
                    <Box sx={{ p: 2 }}>
                        {topRisks.length === 0 ? (
                            <Box sx={{ py: 3, textAlign: 'center' }}>
                                <Typography sx={{ fontSize: 13, color: '#94a3b8' }}>No active risks</Typography>
                            </Box>
                        ) : topRisks.map((r) => (
                            <Box
                                key={r.id}
                                onClick={() => openRisk(r.id)}
                                sx={{
                                    display: 'flex', gap: 1.5, py: 1,
                                    borderBottom: '1px solid #f1f5f9', '&:last-child': { borderBottom: 'none' },
                                    cursor: 'pointer', borderRadius: 1,
                                    '&:hover': { bgcolor: '#f8fafc' },
                                    px: 0.5,
                                }}
                            >
                                <Typography sx={{ fontSize: 16, mt: 0.1, flexShrink: 0 }}>
                                    {PRIORITY_ICON[r.priority] ?? '⚪'}
                                </Typography>
                                <Box sx={{ flex: 1, minWidth: 0 }}>
                                    <Typography sx={{ fontSize: 13, fontWeight: 600, color: '#0f172a' }} noWrap title={r.title}>
                                        {r.title}
                                    </Typography>
                                    <Box sx={{ display: 'flex', gap: 1, mt: 0.25, alignItems: 'center' }}>
                                        <Typography sx={{ fontSize: 11, color: '#94a3b8' }}>
                                            {r.project?.name ?? 'No project'}
                                        </Typography>
                                        <Typography sx={{
                                            fontSize: 10, fontWeight: 700,
                                            color: r.status === 'WORK_IN_PROGRESS' ? '#e65100' : r.status === 'STALE' ? '#c62828' : '#1976d2',
                                            bgcolor: r.status === 'WORK_IN_PROGRESS' ? '#fff3e0' : r.status === 'STALE' ? '#fff5f5' : '#e3f2fd',
                                            px: 0.75, py: 0.1, borderRadius: 0.75,
                                        }}>
                                            {r.status?.replace('_', ' ')}
                                        </Typography>
                                    </Box>
                                </Box>
                            </Box>
                        ))}
                    </Box>
                </Paper>
            </Box>

            {/* ── Recent Action Items ──────────────────────────── */}
            {recentActionItems.length > 0 && (
                <Paper sx={{ borderRadius: 2, border: '1px solid #e2e8f0', boxShadow: '0 1px 3px rgba(0,0,0,.08)', mb: 2 }}>
                    <Box sx={{
                        px: 2.5, py: 1.5,
                        background: 'linear-gradient(180deg, #f8fafc 0%, #fff 100%)',
                        borderBottom: '1px solid #e2e8f0',
                        display: 'flex', alignItems: 'center', gap: 1.25,
                    }}>
                        <Box sx={{ width: 4, height: 22, bgcolor: '#1565c0', borderRadius: 0.5 }} />
                        <Typography sx={{ fontSize: 13, fontWeight: 700, color: '#0f172a' }}>
                            Recent Action Items
                        </Typography>
                        <Box sx={{ flex: 1 }} />
                        {onNavigateToActionItems && (
                            <Button size="small" onClick={onNavigateToActionItems} sx={{ fontSize: 11, textTransform: 'none' }}>
                                View All
                            </Button>
                        )}
                    </Box>
                    <TableContainer>
                        <Table size="small">
                            <TableHead>
                                <TableRow sx={{ bgcolor: '#f8fafc' }}>
                                    <TableCell sx={{ fontSize: 10, fontWeight: 700, textTransform: 'uppercase', letterSpacing: .5, color: '#94a3b8' }}>Title</TableCell>
                                    <TableCell sx={{ fontSize: 10, fontWeight: 700, textTransform: 'uppercase', letterSpacing: .5, color: '#94a3b8', display: { xs: 'none', md: 'table-cell' } }}>Project</TableCell>
                                    <TableCell sx={{ fontSize: 10, fontWeight: 700, textTransform: 'uppercase', letterSpacing: .5, color: '#94a3b8', display: { xs: 'none', sm: 'table-cell' } }}>Owner</TableCell>
                                    <TableCell sx={{ fontSize: 10, fontWeight: 700, textTransform: 'uppercase', letterSpacing: .5, color: '#94a3b8' }}>Status</TableCell>
                                    <TableCell sx={{ fontSize: 10, fontWeight: 700, textTransform: 'uppercase', letterSpacing: .5, color: '#94a3b8' }}>Created</TableCell>
                                </TableRow>
                            </TableHead>
                            <TableBody>
                                {recentActionItems.map((ai) => (
                                    <TableRow key={ai.id} hover>
                                        <TableCell>
                                            <Typography sx={{ fontSize: 13, maxWidth: 300 }} noWrap title={ai.title}>
                                                {ai.title}
                                            </Typography>
                                        </TableCell>
                                        <TableCell sx={{ display: { xs: 'none', md: 'table-cell' } }}>
                                            <Typography sx={{ fontSize: 12, color: '#94a3b8' }}>
                                                {ai.project?.name ?? '-'}
                                            </Typography>
                                        </TableCell>
                                        <TableCell sx={{ display: { xs: 'none', sm: 'table-cell' } }}>
                                            <Typography sx={{ fontSize: 12, color: '#94a3b8' }}>
                                                {ai.owner ?? '-'}
                                            </Typography>
                                        </TableCell>
                                        <TableCell>
                                            <Chip label={ai.status} size="small" color={ai.status === 'Open' ? 'warning' : ai.status === 'In-Progress' ? 'info' : 'default'} sx={{ fontSize: 10 }} />
                                        </TableCell>
                                        <TableCell>
                                            <Typography sx={{ fontSize: 12, color: '#64748b' }}>
                                                {dayjs(ai.createdAt).format('MMM D, YYYY')}
                                            </Typography>
                                        </TableCell>
                                    </TableRow>
                                ))}
                            </TableBody>
                        </Table>
                    </TableContainer>
                </Paper>
            )}

            {/* ── Long-pending action items table ─────────────── */}
            {longPendingAIs.length > 0 && (
                <Paper sx={{ borderRadius: 2, border: '1px solid #e2e8f0', boxShadow: '0 1px 3px rgba(0,0,0,.08)' }}>
                    <Box sx={{
                        px: 2.5, py: 1.5,
                        background: 'linear-gradient(180deg, #f8fafc 0%, #fff 100%)',
                        borderBottom: '1px solid #e2e8f0',
                        display: 'flex', alignItems: 'center', gap: 1.25,
                    }}>
                        <Box sx={{ width: 4, height: 22, bgcolor: '#c62828', borderRadius: 0.5 }} />
                        <Typography sx={{ fontSize: 13, fontWeight: 700, color: '#0f172a' }}>
                            Long-Pending Action Items (&gt;30 days open)
                        </Typography>
                    </Box>
                    <TableContainer>
                        <Table size="small">
                            <TableHead>
                                <TableRow sx={{ bgcolor: '#f8fafc' }}>
                                    <TableCell sx={{ fontSize: 10, fontWeight: 700, textTransform: 'uppercase', letterSpacing: .5, color: '#94a3b8' }}>Title</TableCell>
                                    <TableCell sx={{ fontSize: 10, fontWeight: 700, textTransform: 'uppercase', letterSpacing: .5, color: '#94a3b8', display: { xs: 'none', md: 'table-cell' } }}>Project</TableCell>
                                    <TableCell sx={{ fontSize: 10, fontWeight: 700, textTransform: 'uppercase', letterSpacing: .5, color: '#94a3b8', display: { xs: 'none', sm: 'table-cell' } }}>Owner</TableCell>
                                    <TableCell sx={{ fontSize: 10, fontWeight: 700, textTransform: 'uppercase', letterSpacing: .5, color: '#94a3b8' }}>Open Since</TableCell>
                                </TableRow>
                            </TableHead>
                            <TableBody>
                                {longPendingAIs.map((ai) => (
                                    <TableRow key={ai.id} hover sx={{ bgcolor: '#fff5f5' }}>
                                        <TableCell>
                                            <Typography sx={{ fontSize: 13, maxWidth: 300 }} noWrap title={ai.title}>
                                                {ai.title}
                                            </Typography>
                                        </TableCell>
                                        <TableCell sx={{ display: { xs: 'none', md: 'table-cell' } }}>
                                            <Typography sx={{ fontSize: 12, color: '#94a3b8' }}>
                                                {ai.project?.name ?? '—'}
                                            </Typography>
                                        </TableCell>
                                        <TableCell sx={{ display: { xs: 'none', sm: 'table-cell' } }}>
                                            <Typography sx={{ fontSize: 12, color: '#94a3b8' }}>
                                                {ai.owner ?? '—'}
                                            </Typography>
                                        </TableCell>
                                        <TableCell>
                                            <Typography sx={{ fontSize: 12, color: '#c62828', fontWeight: 600 }}>
                                                {dayjs(ai.createdAt).format('MMM D, YYYY')}
                                            </Typography>
                                        </TableCell>
                                    </TableRow>
                                ))}
                            </TableBody>
                        </Table>
                    </TableContainer>
                </Paper>
            )}

            {/* Risk view-only modal */}
            <RiskDetailModal
                riskId={viewRiskId}
                open={riskModalOpen}
                onClose={() => { setRiskModalOpen(false); setViewRiskId(null); }}
                onRiskUpdated={() => { }}
                viewOnly
            />
        </Box>
    );
};
