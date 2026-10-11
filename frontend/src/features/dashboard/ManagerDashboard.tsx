import { useState } from 'react';
import { Box, Typography, CircularProgress, Alert, Paper, Chip, Button } from '@mui/material';
import { ProjectTile } from './ProjectTile';
import { InsightsWidget } from './InsightsWidget';
import { ActionItemDetailModal } from '../action-items/ActionItemDetailModal';
import { RiskDetailModal } from '../risk-management/RiskDetailModal';
import { useRisks } from '../risk-management/hooks';
import { useActionItem } from '../action-items/hooks';
import type { DashboardProject } from '../../types';
import type { Risk, RiskPriority } from '../../types/risk';
import dayjs from 'dayjs';

const AI_STATUS_COLOR: Record<string, 'warning' | 'info' | 'default'> = {
    Open: 'warning',
    'In-Progress': 'info',
    Closed: 'default',
};

const PRIORITY_ORDER: Record<RiskPriority, number> = { CRITICAL: 1, HIGH: 2, MEDIUM: 3, LOW: 4 };
const PRIORITY_COLORS: Record<string, string> = { CRITICAL: '#e65100', HIGH: '#c62828', MEDIUM: '#f9a825', LOW: '#558b2f' };

interface Props {
    data: any;
    loading: boolean;
    error: string;
    user?: any;
    onProjectClick?: (projectId: number) => void;
    onNavigateToActionItems?: () => void;
    onNavigateToRisks?: () => void;
}

function greeting(): string {
    const h = new Date().getHours();
    if (h < 12) return 'Good morning';
    if (h < 17) return 'Good afternoon';
    return 'Good evening';
}

function daysOverdue(dateStr: string | null): number {
    if (!dateStr) return 0;
    const diff = Math.floor((Date.now() - new Date(dateStr).getTime()) / 86400000);
    return diff > 0 ? diff : 0;
}

export const ManagerDashboard = ({ data, loading, error, user, onProjectClick, onNavigateToActionItems, onNavigateToRisks }: Props) => {
    const [aiModalOpen, setAIModalOpen] = useState(false);
    const [viewRiskId, setViewRiskId] = useState<number | null>(null);
    const [riskModalOpen, setRiskModalOpen] = useState(false);
    const [selectedAIId, setSelectedAIId] = useState<number | null>(null);

    const { data: allRisks = [] } = useRisks();
    const { data: fetchedAI } = useActionItem(selectedAIId);

    const topRisks: Risk[] = allRisks
        .filter(r => r.status !== 'DONE' && r.status !== 'STALE')
        .sort((a, b) => {
            const pa = PRIORITY_ORDER[a.priority] ?? 99;
            const pb = PRIORITY_ORDER[b.priority] ?? 99;
            if (pa !== pb) return pa - pb;
            return new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime();
        })
        .slice(0, 5);

    const handleOpenAI = (id: number) => {
        setSelectedAIId(id);
        setAIModalOpen(true);
    };

    if (loading) return (
        <Box sx={{ display: 'flex', justifyContent: 'center', py: 6 }}>
            <CircularProgress />
        </Box>
    );

    if (error) return <Alert severity="error">{error}</Alert>;

    const projects: DashboardProject[] = data?.projects ?? [];
    const topActionItems: any[] = data?.topActionItems ?? [];
    const recentActionItems: any[] = data?.recentActionItems ?? [];
    // Use recentActionItems (top 5 by createdAt DESC) for the list when available
    const displayActionItems = recentActionItems.length > 0 ? recentActionItems : topActionItems;

    if (projects.length === 0) return (
        <Alert severity="info">No projects assigned. Contact your administrator.</Alert>
    );

    const criticalProject = projects.find(
        (p: any) => p.latestSnapshot?.overallHealth === 'Red' || p.latestSnapshot?.insightsHealth === 'Red'
    );
    const totalOverdue = projects.reduce((sum: number, p: any) => sum + (p.overdueAICount ?? 0), 0);
    const today = new Date().toLocaleDateString('en-US', { weekday: 'long', month: 'long', day: 'numeric', year: 'numeric' });

    const openCount = topActionItems.filter((a: any) => a.status === 'Open').length;
    const inProgressCount = topActionItems.filter((a: any) => a.status === 'In-Progress').length;
    const overdueCount = topActionItems.filter((a: any) => daysOverdue(a.dueDate) > 0).length;

    return (
        <Box>
            {/* ── Greeting header ──────────────────────────────── */}
            <Box sx={{ mb: 2.5 }}>
                <Typography sx={{ fontSize: 22, fontWeight: 800, color: '#0f172a', letterSpacing: -0.5 }}>
                    {greeting()}, {user?.firstName ?? 'there'} 👋
                </Typography>
                <Typography sx={{ fontSize: 13, color: '#475569', mt: 0.5 }}>
                    {today}
                </Typography>
            </Box>

            {/* ── Contextual alerts ────────────────────────────── */}
            {criticalProject && (
                <Alert severity="error" sx={{ mb: 2 }}>
                    <strong>{criticalProject.name}</strong> is in critical health — review immediately.
                </Alert>
            )}
            {totalOverdue > 0 && (
                <Alert severity="warning" sx={{ mb: 2.5 }}>
                    <strong>{totalOverdue} action item{totalOverdue !== 1 ? 's' : ''}</strong> across your projects {totalOverdue !== 1 ? 'are' : 'is'} past due.
                </Alert>
            )}

            {/* ── Section label ────────────────────────────────── */}
            <Typography sx={{ fontSize: 11, fontWeight: 700, textTransform: 'uppercase', color: '#94a3b8', letterSpacing: '.8px', mb: 1.5 }}>
                Your Projects ({projects.length})
            </Typography>

            {/* ── Project tile grid ────────────────────────────── */}
            <Box sx={{ display: 'grid', gridTemplateColumns: { xs: '1fr', sm: 'repeat(2, 1fr)', lg: 'repeat(3, 1fr)' }, gap: 2.5, mb: 3 }}>
                {projects.map(project => (
                    <Box key={project.id}>
                        <ProjectTile
                            project={project}
                            onClick={() => onProjectClick?.(project.id)}
                        />
                        {/* Insights widget attached below each tile */}
                        <Paper sx={{
                            borderRadius: '0 0 8px 8px',
                            border: '1px solid #e2e8f0',
                            borderTop: 'none',
                            boxShadow: '0 1px 3px rgba(0,0,0,.08)',
                            mt: '-8px',
                            pt: '8px',
                        }}>
                            <InsightsWidget projectId={project.id} readOnly={false} />
                        </Paper>
                    </Box>
                ))}
            </Box>

            {/* ── 60/40 bottom panels ──────────────────────────── */}
            <Box sx={{ display: 'grid', gridTemplateColumns: { xs: '1fr', md: '1fr .65fr' }, gap: 2 }}>

                {/* Action Items panel (60%) */}
                <Paper sx={{ borderRadius: 2, border: '1px solid #e2e8f0', boxShadow: '0 1px 3px rgba(0,0,0,.08)', p: 2.5 }}>
                    <Box sx={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', mb: 2 }}>
                        <Typography sx={{ fontSize: 11, fontWeight: 700, textTransform: 'uppercase', color: '#94a3b8', letterSpacing: '.6px' }}>
                            Action Items
                        </Typography>
                        {onNavigateToActionItems && (
                            <Button size="small" onClick={onNavigateToActionItems} sx={{ fontSize: 11, textTransform: 'none' }}>
                                View All
                            </Button>
                        )}
                    </Box>
                    <Box sx={{ display: 'flex', gap: 1, mb: 2, flexWrap: 'wrap' }}>
                        <Chip label={`Open: ${openCount}`} color="warning" size="small" />
                        <Chip label={`In-Progress: ${inProgressCount}`} color="info" size="small" />
                        {overdueCount > 0 && <Chip label={`Overdue: ${overdueCount}`} color="error" size="small" />}
                    </Box>
                    {displayActionItems.length === 0 ? (
                        <Typography sx={{ fontSize: 13, color: '#94a3b8' }}>No open action items.</Typography>
                    ) : (
                        <Box>
                            {displayActionItems.map((ai: any) => {
                                const od = daysOverdue(ai.dueDate);
                                return (
                                    <Box key={ai.id} onClick={() => handleOpenAI(ai.id)} sx={{
                                        display: 'flex', alignItems: 'flex-start', gap: 1,
                                        py: 1, borderBottom: '1px solid #f1f5f9',
                                        bgcolor: od > 0 ? '#fff8f8' : 'transparent',
                                        borderRadius: od > 0 ? 0.5 : 0,
                                        px: od > 0 ? 0.5 : 0,
                                        '&:last-child': { borderBottom: 'none' },
                                        cursor: 'pointer',
                                        '&:hover': { bgcolor: '#f8fafc' },
                                    }}>
                                        <Box sx={{ flex: 1, minWidth: 0 }}>
                                            <Typography sx={{ fontSize: 13, fontWeight: 500, color: '#0f172a' }} noWrap title={ai.title}>
                                                {ai.title}
                                            </Typography>
                                            <Typography sx={{ fontSize: 11, color: '#94a3b8' }}>
                                                {ai.owner ?? '—'}
                                                {ai.project?.name ? ` · ${ai.project.name}` : ''}
                                            </Typography>
                                        </Box>
                                        <Box sx={{ flexShrink: 0, textAlign: 'right' }}>
                                            <Chip
                                                label={ai.status}
                                                size="small"
                                                color={AI_STATUS_COLOR[ai.status] ?? 'default'}
                                                sx={{ fontSize: 10 }}
                                            />
                                            {od > 0 ? (
                                                <Typography sx={{ fontSize: 10, color: '#c62828', fontWeight: 700, mt: 0.25 }}>
                                                    ⏰ {od}d
                                                </Typography>
                                            ) : ai.dueDate ? (
                                                <Typography sx={{ fontSize: 10, color: '#94a3b8', mt: 0.25 }}>
                                                    {dayjs(ai.dueDate).format('MMM D')}
                                                </Typography>
                                            ) : null}
                                        </Box>
                                    </Box>
                                );
                            })}
                        </Box>
                    )}
                </Paper>

                {/* Top Risks panel (40%) */}
                <Paper sx={{ borderRadius: 2, border: '1px solid #e2e8f0', boxShadow: '0 1px 3px rgba(0,0,0,.08)', p: 2.5 }}>
                    <Box sx={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', mb: 2 }}>
                        <Typography sx={{ fontSize: 11, fontWeight: 700, textTransform: 'uppercase', color: '#94a3b8', letterSpacing: '.6px' }}>
                            Top Risks
                        </Typography>
                        {onNavigateToRisks && (
                            <Button size="small" onClick={onNavigateToRisks} sx={{ fontSize: 11, textTransform: 'none' }}>
                                View More
                            </Button>
                        )}
                    </Box>
                    {topRisks.length === 0 ? (
                        <Typography sx={{ fontSize: 13, color: '#94a3b8' }}>No active risks.</Typography>
                    ) : (
                        <Box sx={{ display: 'flex', flexDirection: 'column', gap: 1.25 }}>
                            {topRisks.map((r) => (
                                <Paper key={r.id} variant="outlined" sx={{
                                    p: 1.5, borderRadius: 1.5,
                                    cursor: 'pointer', transition: 'all .15s',
                                    borderLeft: `4px solid ${PRIORITY_COLORS[r.priority] ?? '#ccc'}`,
                                    '&:hover': { borderColor: '#1976d2', boxShadow: '0 2px 8px rgba(0,0,0,.08)', borderLeftColor: PRIORITY_COLORS[r.priority] },
                                }} onClick={() => { setViewRiskId(r.id); setRiskModalOpen(true); }}>
                                    <Box sx={{ display: 'flex', alignItems: 'center', gap: 0.75, mb: 0.5 }}>
                                        <Chip
                                            label={r.priority}
                                            size="small"
                                            sx={{ fontSize: 9, height: 18, fontWeight: 700, bgcolor: PRIORITY_COLORS[r.priority], color: '#fff' }}
                                        />
                                        <Chip label={r.source === 'CLIENT' ? 'Client' : 'Internal'} size="small" sx={{ fontSize: 9, height: 18 }} />
                                        {r.project && (
                                            <Typography sx={{ fontSize: 10, color: '#94a3b8', ml: 'auto' }}>
                                                {r.project.name}
                                            </Typography>
                                        )}
                                    </Box>
                                    <Typography sx={{ fontSize: 13, fontWeight: 600, color: '#0f172a', lineHeight: 1.3, display: '-webkit-box', WebkitLineClamp: 2, WebkitBoxOrient: 'vertical', overflow: 'hidden' }}>
                                        {r.title}
                                    </Typography>
                                    <Typography sx={{ fontSize: 10, color: '#94a3b8', mt: 0.5 }}>
                                        {dayjs(r.createdAt).format('MMM D, YYYY')}
                                    </Typography>
                                </Paper>
                            ))}
                        </Box>
                    )}
                </Paper>
            </Box>

            {fetchedAI && (
                <ActionItemDetailModal
                    item={fetchedAI}
                    open={aiModalOpen}
                    onClose={() => { setAIModalOpen(false); setSelectedAIId(null); }}
                    onUpdated={() => {}}
                    readOnly={false}
                />
            )}

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
