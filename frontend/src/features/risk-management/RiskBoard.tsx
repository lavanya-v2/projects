import { useState } from 'react';
import {
    Box, Typography, Snackbar, Alert, Fab, Tooltip,
    Select, MenuItem, FormControl, InputLabel, Chip,
    Dialog, DialogTitle, DialogContent, DialogActions, Button, TextField
} from '@mui/material';
import AddIcon from '@mui/icons-material/Add';
import FilterListIcon from '@mui/icons-material/FilterList';
import {
    DndContext,
    DragOverlay,
    closestCenter,
    PointerSensor,
    useSensor,
    useSensors
} from '@dnd-kit/core';
import type { DragStartEvent, DragEndEvent } from '@dnd-kit/core';
import { RiskLane } from './RiskLane';
import { RiskCard } from './RiskCard';
import { RiskDetailModal } from './RiskDetailModal';
import { RiskCreateModal } from './RiskCreateModal';
import { StatusChangeCommentDialog } from './StatusChangeCommentDialog';
import { useRisks, useTransitionRiskStatus, useMarkRiskDone } from './hooks';
import { useAuth } from '../../context/AuthContext';
import type { Risk, RiskStatus, RiskSource } from '../../types/risk';

const ALL_STATUSES: RiskStatus[] = ['NEW', 'WORK_IN_PROGRESS', 'STALE', 'DONE'];
const ACTIVE_STATUSES: RiskStatus[] = ['NEW', 'WORK_IN_PROGRESS', 'STALE'];

interface PendingTransition {
    riskId: number;
    fromStatus: RiskStatus;
    toStatus: RiskStatus;
}

export function RiskBoard() {
    const { user } = useAuth();
    const [activeRisk, setActiveRisk] = useState<Risk | null>(null);
    const [pendingTransition, setPendingTransition] = useState<PendingTransition | null>(null);
    const [movingStatus, setMovingStatus] = useState(false);

    const [selectedRiskId, setSelectedRiskId] = useState<number | null>(null);
    const [detailOpen, setDetailOpen] = useState(false);
    const [createOpen, setCreateOpen] = useState(false);

    // Drag-to-DONE resolution
    const [pendingDoneRiskId, setPendingDoneRiskId] = useState<number | null>(null);
    const [doneResolution, setDoneResolution] = useState('');

    // Filters
    const [filterSource, setFilterSource] = useState<RiskSource | string>('all');

    const [snackbar, setSnackbar] = useState<{ msg: string; severity: 'success' | 'error' } | null>(null);
    const sourceFilter = filterSource === 'all' ? undefined : filterSource
    const { data: risks = [], isLoading: loading } = useRisks(sourceFilter);
    const transitionRiskStatus = useTransitionRiskStatus();
    const markRiskDone = useMarkRiskDone();
    const sensors = useSensors(
        useSensor(PointerSensor, { activationConstraint: { distance: 8 } })
    );

    const clearFilters = () => {
        setFilterSource('all');
    };

    const handleDragStart = (event: DragStartEvent) => {
        const risk = risks.find(r => r.id === event.active.id);
        setActiveRisk(risk || null);
    };

    const handleDragEnd = (event: DragEndEvent) => {
        setActiveRisk(null);
        const { active, over } = event;
        if (!over) return;

        const risk = risks.find(r => r.id === active.id);
        const newStatus = over.id as RiskStatus;

        if (!risk || risk.status === newStatus) return;

        // Check transition permission
        if (!risk.permissions?.canTransition) {
            setSnackbar({ msg: 'You do not have permission to move this risk.', severity: 'error' });
            return;
        }

        // Dragging to DONE: requires resolution text + canMarkDone
        if (newStatus === 'DONE') {
            if (!risk.permissions?.canMarkDone) {
                setSnackbar({ msg: 'You do not have permission to close this risk.', severity: 'error' });
                return;
            }
            setDoneResolution('');
            setPendingDoneRiskId(risk.id);
            return;
        }

        // Dragging between active lanes: require a comment
        if (!ACTIVE_STATUSES.includes(newStatus)) return;

        setPendingTransition({
            riskId: risk.id,
            fromStatus: risk.status,
            toStatus: newStatus
        });
    };

    const handleStatusChangeConfirm = async (comment: string) => {
        if (!pendingTransition) return;
        setMovingStatus(true);
        try {
            await transitionRiskStatus.mutateAsync({ id: pendingTransition.riskId, status: pendingTransition.toStatus, comment });
            setPendingTransition(null);
            setSnackbar({ msg: 'Risk moved successfully.', severity: 'success' });
        } catch (err) {
            const error = (err as { response?: { data?: { error?: string } } })?.response?.data;
            setSnackbar({ msg: error?.error || 'Failed to close risk.', severity: 'error' });
        } finally {
            setMovingStatus(false);
        }
    };

    const handleDoneConfirm = async () => {
        if (!pendingDoneRiskId || !doneResolution.trim()) return;
        try {
            await markRiskDone.mutateAsync({ id: pendingDoneRiskId, resolution: doneResolution.trim() });
            setPendingDoneRiskId(null);
            setDoneResolution('');
            setSnackbar({ msg: 'Risk closed successfully.', severity: 'success' });
        } catch (err) {
            const error = (err as { response?: { data?: { error?: string } } })?.response?.data;
            setSnackbar({ msg: error?.error || 'Failed to close risk.', severity: 'error' });
        }
    };

    const handleCardClick = (risk: Risk) => {
        setSelectedRiskId(risk.id);
        setDetailOpen(true);
    };

    const risksByStatus = (status: RiskStatus) => risks.filter(r => r.status === status);

    const activeRisks = risks.filter(r => r.status !== 'DONE');
    const criticalCount = activeRisks.filter(r => r.priority === 'CRITICAL').length;

    return (
        <Box sx={{ height: '100%' }}>
            {/* Board Header */}
            <Box sx={{ display: 'flex', alignItems: { xs: 'flex-start', sm: 'center' }, justifyContent: 'space-between', mb: 2, flexWrap: 'wrap', gap: 1 }}>
                <Box>
                    <Typography variant="h5" fontWeight={700} color="#1a2332">
                        Risk Management Board
                    </Typography>
                    <Box sx={{ display: 'flex', gap: 2, mt: 0.5, flexWrap: 'wrap' }}>
                        <Typography variant="body2" color="text.secondary">
                            {activeRisks.length} active risk{activeRisks.length !== 1 ? 's' : ''} · {risks.filter(r => r.status === 'DONE').length} closed
                            {sourceFilter && ' (filtered)'}
                        </Typography>
                        {criticalCount > 0 && (
                            <Typography variant="body2" sx={{ color: '#e65100', fontWeight: 700 }}>
                                ⚠️ {criticalCount} critical
                            </Typography>
                        )}
                    </Box>
                </Box>
                <Tooltip title="Create new risk">
                    <Fab
                        color="primary"
                        size="medium"
                        onClick={() => setCreateOpen(true)}
                        sx={{ boxShadow: 3, flexShrink: 0 }}
                    >
                        <AddIcon />
                    </Fab>
                </Tooltip>
            </Box>

            {/* Filter Bar */}
            <Box sx={{ display: 'flex', gap: 1.5, mb: 2.5, alignItems: { xs: 'stretch', sm: 'center' }, flexWrap: 'wrap', flexDirection: { xs: 'column', sm: 'row' } }}>
                <FilterListIcon sx={{ color: '#888', fontSize: 20, display: { xs: 'none', sm: 'block' } }} />

                <FormControl size="small" sx={{ minWidth: { xs: '100%', sm: 140 } }}>
                    <InputLabel>Source</InputLabel>
                    <Select
                        label="Source"
                        value={filterSource}
                        onChange={e => setFilterSource(e.target.value as RiskSource)}
                    >
                        <MenuItem value="all">All Sources</MenuItem>
                        <MenuItem value="CLIENT">👤 Client</MenuItem>
                        <MenuItem value="INTERNAL">🏢 Internal</MenuItem>
                    </Select>
                </FormControl>

                {sourceFilter && (
                    <Chip
                        label="Clear filters"
                        size="small"
                        onDelete={clearFilters}
                        onClick={clearFilters}
                        sx={{ fontSize: '0.72rem' }}
                    />
                )}
            </Box>

            {loading ? (
                <Box sx={{ display: 'flex', justifyContent: 'center', py: 8 }}>
                    <Typography color="text.secondary">Loading risks...</Typography>
                </Box>
            ) : (
                <DndContext
                    sensors={sensors}
                    collisionDetection={closestCenter}
                    onDragStart={handleDragStart}
                    onDragEnd={handleDragEnd}
                >
                    <Box
                        sx={{
                            display: 'flex',
                            gap: 1.5,
                            alignItems: 'flex-start',
                            overflowX: 'auto',
                            pb: 2
                        }}
                    >
                        {ALL_STATUSES.map(status => (
                            <RiskLane
                                key={status}
                                status={status}
                                risks={risksByStatus(status)}
                                onCardClick={handleCardClick}
                                droppable={true}
                            />
                        ))}
                    </Box>

                    <DragOverlay>
                        {activeRisk && (
                            <Box sx={{ transform: 'rotate(3deg)', opacity: 0.95 }}>
                                <RiskCard risk={activeRisk} onClick={() => {}} />
                            </Box>
                        )}
                    </DragOverlay>
                </DndContext>
            )}

            {/* Active-lane status change (requires comment) */}
            {pendingTransition && (
                <StatusChangeCommentDialog
                    open={!!pendingTransition}
                    fromStatus={pendingTransition.fromStatus}
                    toStatus={pendingTransition.toStatus}
                    onConfirm={handleStatusChangeConfirm}
                    onCancel={() => setPendingTransition(null)}
                    loading={movingStatus}
                />
            )}

            {/* Drag-to-DONE resolution dialog */}
            <Dialog
                open={!!pendingDoneRiskId}
                onClose={() => { if (!markRiskDone.isPending) setPendingDoneRiskId(null); }}
                maxWidth="sm"
                fullWidth
            >
                <DialogTitle sx={{ pb: 1 }}>
                    <Box sx={{ display: 'flex', alignItems: 'center', gap: 1 }}>
                        <Typography sx={{ fontSize: '1.2rem' }}>✅</Typography>
                        <Typography fontWeight={700}>Close Risk — Add Resolution</Typography>
                    </Box>
                </DialogTitle>
                <DialogContent dividers>
                    <Typography variant="body2" color="text.secondary" sx={{ mb: 2 }}>
                        Describe how this risk was resolved or mitigated. This will be saved as the resolution.
                    </Typography>
                    <TextField
                        autoFocus
                        fullWidth
                        multiline
                        rows={4}
                        label="Resolution *"
                        placeholder="e.g. Risk was mitigated by implementing automated rollback procedures..."
                        value={doneResolution}
                        onChange={e => setDoneResolution(e.target.value)}
                        disabled={markRiskDone.isPending}
                    />
                </DialogContent>
                <DialogActions>
                    <Button onClick={() => setPendingDoneRiskId(null)} disabled={markRiskDone.isPending}>Cancel</Button>
                    <Button
                        onClick={handleDoneConfirm}
                        variant="contained"
                        color="success"
                        disabled={!doneResolution.trim() || markRiskDone.isPending}
                    >
                        {markRiskDone.isPending ? 'Closing...' : 'Confirm & Close Risk'}
                    </Button>
                </DialogActions>
            </Dialog>

            {/* Risk Detail Modal */}
            <RiskDetailModal
                riskId={selectedRiskId}
                open={detailOpen}
                onClose={() => { setDetailOpen(false); setSelectedRiskId(null); }}
                onRiskUpdated={() => {}}
            />

            {/* Create Risk Modal */}
            <RiskCreateModal
                open={createOpen}
                onClose={() => setCreateOpen(false)}
                onCreated={() => { setCreateOpen(false); setSnackbar({ msg: 'Risk created.', severity: 'success' }); }}
                user={user ?? undefined}
            />

            <Snackbar
                open={!!snackbar}
                autoHideDuration={4000}
                onClose={() => setSnackbar(null)}
                anchorOrigin={{ vertical: 'top', horizontal: 'center' }}
            >
                <Alert severity={snackbar?.severity} variant="filled" onClose={() => setSnackbar(null)} sx={{ width: '100%' }}>
                    {snackbar?.msg}
                </Alert>
            </Snackbar>
        </Box>
    );
}
