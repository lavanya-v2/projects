import { useState, useEffect, useCallback } from 'react';
import {
    Dialog, DialogTitle, DialogContent, DialogActions,
    Button, Typography, Box, Chip, Divider, TextField,
    IconButton, Tooltip, Alert, CircularProgress,
    useMediaQuery, useTheme, Select, MenuItem, FormControl,
    InputLabel, Autocomplete,
} from '@mui/material';
import CloseIcon from '@mui/icons-material/Close';
import AddIcon from '@mui/icons-material/Add';
import DeleteIcon from '@mui/icons-material/Delete';
import CheckCircleIcon from '@mui/icons-material/CheckCircle';
import EditIcon from '@mui/icons-material/Edit';
import { AISummaryBanner } from './AISummaryBanner';
import {
    useRisk,
    useUpdateRisk,
    useAddRiskComment,
    useUpdateRiskComment,
    useAddMitigationPlan,
    useDeleteMitigationPlan,
    useMarkRiskDone,
} from './hooks';
import { useProjects } from '../auth/hooks';
import { useAuth } from '../../context/AuthContext';
import type { RiskComment, RiskMitigationPlan, RiskPriority } from '../../types/risk';
import axios from 'axios';

const PRIORITY_COLORS: Record<string, string> = {
    CRITICAL: '#e65100',
    HIGH: '#c62828',
    MEDIUM: '#f9a825',
    LOW: '#558b2f'
};

const STATUS_LABELS: Record<string, string> = {
    NEW: 'New',
    WORK_IN_PROGRESS: 'Work In Progress',
    STALE: 'Stale',
    DONE: 'Done'
};

interface RiskDetailModalProps {
    riskId: number | null;
    open: boolean;
    onClose: () => void;
    onRiskUpdated: () => void;
    viewOnly?: boolean;
}

export function RiskDetailModal({ riskId, open, onClose, onRiskUpdated, viewOnly = false }: RiskDetailModalProps) {
    const theme = useTheme();
    const isMobile = useMediaQuery(theme.breakpoints.down('sm'));
    const [error, setError] = useState('');

    // Edit mode state
    const [editMode, setEditMode] = useState(false);
    const [editPriority, setEditPriority] = useState('');
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const [editProject, setEditProject] = useState<any>(null);
    const [saving, setSaving] = useState(false);

    // Comment state
    const [commentText, setCommentText] = useState('');
    const [editingCommentId, setEditingCommentId] = useState<number | null>(null);
    const [editingCommentText, setEditingCommentText] = useState('');
    const { user } = useAuth();

    // Mitigation state
    const [mitigationText, setMitigationText] = useState('');

    // Mark done state
    const [resolutionDialogOpen, setResolutionDialogOpen] = useState(false);
    const [resolutionText, setResolutionText] = useState('');

    const { data: risk, isLoading: loading, error: riskError } = useRisk(open ? riskId : null);
    const rError = axios.isAxiosError(riskError) && riskError.response?.status === 403;
    // includeInactive=true: this modal edits an EXISTING risk, which may already
    // be linked to a now-inactive project -- without this, that project drops
    // out of the reassignment dropdown even though the risk still needs it.
    const { data: projects = [] } = useProjects(undefined, true);
    const updateRisk = useUpdateRisk();
    const addRiskComment = useAddRiskComment();
    const updateRiskComment = useUpdateRiskComment();
    const addMitigationPlan = useAddMitigationPlan();
    const deleteMitigationPlan = useDeleteMitigationPlan();
    const markRiskDone = useMarkRiskDone();

    const perms = risk?.permissions;

    useEffect(() => {
        if (open) {
            setEditMode(false);
            setError('');
        }
    }, [open, riskId]);

    const enterEditMode = useCallback(() => {
        if (!risk) return;
        setEditPriority(risk.priority);
        setEditProject(risk.project ?? null);
        setEditMode(true);
    }, [risk]);

    const handleSaveEdit = async () => {
        if (!risk) return;
        setSaving(true);
        try {
            await updateRisk.mutateAsync({
                id: risk.id,
                data: {
                    priority: editPriority as RiskPriority,
                    projectId: editProject?.id ?? undefined,
                },
            });
            setEditMode(false);
            onRiskUpdated();
        } catch {
            setError('Failed to save changes.');
        } finally {
            setSaving(false);
        }
    };

    const handleAddComment = async () => {
        if (!risk || !commentText.trim()) return;
        try {
            await addRiskComment.mutateAsync({ riskId: risk.id, comment: commentText.trim() });
            setCommentText('');
        } catch {
            setError('Failed to add comment.');
        }
    };

    const handleStartEditComment = (c: RiskComment) => {
        setError('');
        setEditingCommentId(c.id);
        setEditingCommentText(c.comment);
    };

    const handleCancelEditComment = () => {
        setEditingCommentId(null);
        setEditingCommentText('');
    };

    const handleSaveEditComment = async () => {
        if (!risk || editingCommentId == null || !editingCommentText.trim()) return;
        try {
            await updateRiskComment.mutateAsync({ riskId: risk.id, commentId: editingCommentId, comment: editingCommentText.trim() });
            setEditingCommentId(null);
            setEditingCommentText('');
        } catch {
            setError('Failed to update comment. Only your latest comment can be edited.');
        }
    };

    const handleAddMitigationPlan = async () => {
        if (!risk || !mitigationText.trim()) return;
        try {
            await addMitigationPlan.mutateAsync({ riskId: risk.id, description: mitigationText.trim() });
            setMitigationText('');
        } catch {
            setError('Failed to add mitigation plan.');
        }
    };

    const handleDeleteMitigationPlan = async (planId: number) => {
        if (!risk) return;
        try {
            await deleteMitigationPlan.mutateAsync({ riskId: risk.id, planId });
        } catch {
            setError('Failed to delete mitigation plan.');
        }
    };

    const handleMarkDoneConfirm = async () => {
        if (!risk || !resolutionText.trim()) return;
        try {
            await markRiskDone.mutateAsync({ id: risk.id, resolution: resolutionText.trim() });
            setResolutionDialogOpen(false);
            setResolutionText('');
            onRiskUpdated();
            onClose();
        } catch (err) {
            const errorWithResponse = err as { response?: { data?: { error?: string  } };};
            setError(errorWithResponse.response?.data?.error || 'Failed to close risk.');
        }
    };

    return (
        <>
        <Dialog open={open} onClose={onClose} maxWidth="md" fullWidth scroll="paper" fullScreen={isMobile}>
            {loading && (
                <>
                    <DialogTitle>Loading...</DialogTitle>
                    <DialogContent sx={{ display: 'flex', justifyContent: 'center', py: 6 }}>
                        <CircularProgress />
                    </DialogContent>
                </>
            )}
            {rError && (
                <>
                    <DialogTitle sx={{ color: 'error.main' }}>Access Denied</DialogTitle>
                    <DialogContent sx={{ py: 3 }}>
                        <Typography>
                        {"You do not have the required permissions to view this risk."}
                        </Typography>
                    </DialogContent>
                    <DialogActions>
                        <Button onClick={onClose}>Close</Button>
                    </DialogActions>
                </>
            )}
            {risk && (
            <> 
            <DialogTitle sx={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start' }}>
                <Box sx={{ flex: 1, pr: 2 }}>
                    <Typography variant="h6" fontWeight={700} lineHeight={1.3}>
                        {risk.title}
                    </Typography>
                    {!editMode && (
                        <Box sx={{ display: 'flex', gap: 1, flexWrap: 'wrap', mt: 0.75 }}>
                            <Chip
                                label={risk.priority}
                                size="small"
                                sx={{ bgcolor: PRIORITY_COLORS[risk.priority], color: '#fff', fontWeight: 700 }}
                            />
                            <Chip label={STATUS_LABELS[risk.status]} size="small" color="primary" variant="outlined" />
                            <Chip label={risk.source} size="small" sx={{ bgcolor: '#e0e0e0' }} />
                            {risk.project && (
                                <Chip label={`📁 ${risk.project.name}`} size="small" sx={{ bgcolor: '#e8f5e9' }} />
                            )}
                        </Box>
                    )}
                </Box>
                <Box sx={{ display: 'flex', gap: 0.5 }}>
                    {risk && perms?.canEdit && !viewOnly && !editMode && (
                        <Tooltip title="Edit priority / project">
                            <IconButton aria-label="Edit risk" size="small" onClick={enterEditMode}>
                                <EditIcon fontSize="small" />
                            </IconButton>
                        </Tooltip>
                    )}
                    <IconButton onClick={onClose} size="small">
                        <CloseIcon />
                    </IconButton>
                </Box>
            </DialogTitle>

            <DialogContent dividers>
                {error && <Alert severity="error" sx={{ mb: 2 }}>{error}</Alert>}

                {risk && !loading && (
                    <>
                        {/* Edit Mode: Priority + Project */}
                        {editMode && (
                            <Box sx={{ mb: 2, p: 2, border: '1px solid #e3f2fd', borderRadius: 1, bgcolor: '#f8fbff' }}>
                                <Typography variant="subtitle2" fontWeight={700} sx={{ mb: 1.5 }}>
                                    Edit Risk Fields
                                </Typography>
                                <Box sx={{ display: 'flex', gap: 2, flexWrap: 'wrap' }}>
                                    <FormControl size="small" sx={{ minWidth: 160 }}>
                                        <InputLabel>Priority</InputLabel>
                                        <Select
                                            value={editPriority}
                                            label="Priority"
                                            onChange={e => setEditPriority(e.target.value)}
                                        >
                                            {['CRITICAL', 'HIGH', 'MEDIUM', 'LOW'].map(p => (
                                                <MenuItem key={p} value={p}>
                                                    <Box sx={{ display: 'flex', alignItems: 'center', gap: 1 }}>
                                                        <Box sx={{ width: 10, height: 10, borderRadius: '50%', bgcolor: PRIORITY_COLORS[p] }} />
                                                        {p}
                                                    </Box>
                                                </MenuItem>
                                            ))}
                                        </Select>
                                    </FormControl>
                                    <Autocomplete
                                        size="small"
                                        options={projects}
                                        getOptionLabel={p => p.name}
                                        value={editProject}
                                        onChange={(_, val) => setEditProject(val)}
                                        isOptionEqualToValue={(a, b) => a.id === b.id}
                                        sx={{ minWidth: 220 }}
                                        renderInput={params => <TextField {...params} label="Linked Project (optional)" />}
                                    />
                                </Box>
                                <Box sx={{ display: 'flex', gap: 1, mt: 1.5 }}>
                                    <Button variant="contained" size="small" onClick={handleSaveEdit} disabled={saving}>
                                        {saving ? 'Saving…' : 'Save'}
                                    </Button>
                                    <Button size="small" onClick={() => setEditMode(false)} disabled={saving}>Cancel</Button>
                                </Box>
                            </Box>
                        )}

                        {/* AI Summary */}
                        <AISummaryBanner summary={risk.aiSummary} />

                        {/* Risk Details */}
                        <Box sx={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 2, mb: 2 }}>
                            <Box>
                                <Typography variant="caption" color="text.secondary">Notified Date</Typography>
                                <Typography variant="body2">{new Date(risk.notifiedDate).toLocaleDateString()}</Typography>
                            </Box>
                            <Box>
                                <Typography variant="caption" color="text.secondary">Created By</Typography>
                                <Typography variant="body2">{risk.creator.firstName} {risk.creator.lastName}</Typography>
                            </Box>
                            <Box>
                                <Typography variant="caption" color="text.secondary">Assigned To</Typography>
                                <Typography variant="body2">
                                    {risk.assignee ? `${risk.assignee.firstName} ${risk.assignee.lastName}` : 'Unassigned'}
                                </Typography>
                            </Box>
                            <Box>
                                <Typography variant="caption" color="text.secondary">Project</Typography>
                                <Typography variant="body2">{risk.project?.name || '—'}</Typography>
                            </Box>
                        </Box>

                        <Typography variant="body2" sx={{ mb: 2, whiteSpace: 'pre-wrap' }}>
                            {risk.description}
                        </Typography>

                        {/* Resolution — shown when DONE */}
                        {risk.status === 'DONE' && risk.resolution && (
                            <Box sx={{ bgcolor: '#e8f5e9', border: '1px solid #a5d6a7', borderRadius: 1, p: 1.5, mb: 2 }}>
                                <Typography variant="caption" fontWeight={700} color="#2e7d32" sx={{ display: 'block', mb: 0.5 }}>
                                    ✅ Resolution
                                </Typography>
                                <Typography variant="body2" sx={{ whiteSpace: 'pre-wrap', color: '#1b5e20' }}>
                                    {risk.resolution}
                                </Typography>
                            </Box>
                        )}

                        <Divider sx={{ my: 2 }} />

                        {/* Mitigation Plans */}
                        <Typography variant="subtitle2" fontWeight={700} sx={{ mb: 1 }}>
                            Mitigation Plans ({risk.mitigationPlans.length})
                        </Typography>
                        {risk.mitigationPlans.length === 0 && (
                            <Typography variant="body2" color="text.secondary" fontStyle="italic" sx={{ mb: 1 }}>
                                No mitigation plans yet.
                            </Typography>
                        )}
                        {risk.mitigationPlans.map((plan: RiskMitigationPlan, idx: number) => (
                            <Box
                                key={plan.id}
                                sx={{
                                    display: 'flex',
                                    alignItems: 'flex-start',
                                    gap: 1,
                                    mb: 1,
                                    p: 1,
                                    bgcolor: '#f5f5f5',
                                    borderRadius: 1
                                }}
                            >
                                <Typography variant="body2" fontWeight={600} sx={{ minWidth: 20 }}>
                                    {idx + 1}.
                                </Typography>
                                <Typography variant="body2" sx={{ flex: 1 }}>{plan.description}</Typography>
                                {!viewOnly && perms?.canEdit && (
                                    <Tooltip title="Delete plan">
                                        <IconButton size="small" onClick={() => handleDeleteMitigationPlan(plan.id)}>
                                            <DeleteIcon fontSize="small" />
                                        </IconButton>
                                    </Tooltip>
                                )}
                            </Box>
                        ))}
                        {!viewOnly && perms?.canEdit && (
                            <Box sx={{ display: 'flex', gap: 1, mt: 1 }}>
                                <TextField
                                    size="small"
                                    fullWidth
                                    placeholder="Add a mitigation plan..."
                                    value={mitigationText}
                                    onChange={e => setMitigationText(e.target.value)}
                                    onKeyDown={e => { if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); handleAddMitigationPlan(); } }}
                                    disabled={addMitigationPlan.isPending}
                                />
                                <Button
                                    variant="outlined"
                                    size="small"
                                    startIcon={<AddIcon />}
                                    onClick={handleAddMitigationPlan}
                                    disabled={!mitigationText.trim() || addMitigationPlan.isPending}
                                >
                                    Add
                                </Button>
                            </Box>
                        )}

                        <Divider sx={{ my: 2 }} />

                        {/* Comments */}
                        <Typography variant="subtitle2" fontWeight={700} sx={{ mb: 1 }}>
                            Comments ({risk.comments.length})
                        </Typography>
                        <Box sx={{ maxHeight: 240, overflowY: 'auto', mb: 1.5 }}>
                            {risk.comments.length === 0 && (
                                <Typography variant="body2" color="text.secondary" fontStyle="italic">
                                    No comments yet.
                                </Typography>
                            )}
                            {risk.comments.map((c: RiskComment, idx: number) => {
                                const isOwn = c.userId === user?.id;
                                const isLast = idx === risk.comments.length - 1;
                                const canEdit = isOwn && isLast && !viewOnly && !!perms?.canComment;
                                const isEditingThis = editingCommentId === c.id;
                                return (
                                <Box
                                    key={c.id}
                                    sx={{ mb: 1.5, p: 1.25, bgcolor: '#fafafa', borderRadius: 1, border: '1px solid #eee' }}
                                >
                                    <Box sx={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', mb: 0.5 }}>
                                        <Box sx={{ display: 'flex', alignItems: 'center', gap: 1 }}>
                                            <Typography variant="caption" fontWeight={700}>
                                                {c.user.firstName} {c.user.lastName}
                                            </Typography>
                                            {c.editedAt && (
                                                <Tooltip title={`Edited ${new Date(c.editedAt).toLocaleString('en-US', { month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit' })}`}>
                                                    <Typography variant="caption" color="text.secondary" fontStyle="italic">(edited)</Typography>
                                                </Tooltip>
                                            )}
                                        </Box>
                                        <Box sx={{ display: 'flex', alignItems: 'center', gap: 0.5 }}>
                                            <Typography variant="caption" color="text.secondary">
                                                {new Date(c.createdAt).toLocaleDateString('en-US', {
                                                    month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit'
                                                })}
                                            </Typography>
                                            {canEdit && !isEditingThis && (
                                                <Tooltip title="Edit comment">
                                                    <IconButton size="small" onClick={() => handleStartEditComment(c)} sx={{ p: 0.25 }}>
                                                        <EditIcon sx={{ fontSize: 15 }} />
                                                    </IconButton>
                                                </Tooltip>
                                            )}
                                        </Box>
                                    </Box>
                                    {isEditingThis ? (
                                        <Box sx={{ display: 'flex', flexDirection: 'column', gap: 0.75 }}>
                                            <TextField
                                                size="small" fullWidth multiline rows={2} autoFocus
                                                value={editingCommentText}
                                                onChange={e => setEditingCommentText(e.target.value)}
                                                disabled={updateRiskComment.isPending}
                                            />
                                            <Box sx={{ display: 'flex', gap: 1 }}>
                                                <Button size="small" variant="contained"
                                                    onClick={handleSaveEditComment}
                                                    disabled={!editingCommentText.trim() || updateRiskComment.isPending}
                                                    startIcon={updateRiskComment.isPending ? <CircularProgress size={12} color="inherit" /> : undefined}>
                                                    Save
                                                </Button>
                                                <Button size="small" onClick={handleCancelEditComment} disabled={updateRiskComment.isPending}>Cancel</Button>
                                            </Box>
                                        </Box>
                                    ) : (
                                        <Typography variant="body2">{c.comment}</Typography>
                                    )}
                                </Box>
                                );
                            })}
                        </Box>

                        {/* Add Comment — hidden in viewOnly mode or no permission */}
                        {!viewOnly && perms?.canComment && (
                            <Box sx={{ display: 'flex', gap: 1 }}>
                                <TextField
                                    size="small"
                                    fullWidth
                                    multiline
                                    rows={2}
                                    placeholder="Add a comment..."
                                    value={commentText}
                                    onChange={e => setCommentText(e.target.value)}
                                    disabled={addRiskComment.isPending}
                                />
                                <Button
                                    variant="contained"
                                    size="small"
                                    onClick={handleAddComment}
                                    disabled={!commentText.trim() || addRiskComment.isPending}
                                    sx={{ alignSelf: 'flex-end' }}
                                >
                                    Post
                                </Button>
                            </Box>
                        )}
                    </>
                )}
            </DialogContent>

            <DialogActions>
                {risk && risk.status !== 'DONE' && !viewOnly && perms?.canMarkDone && (
                    <Tooltip title="Close this risk">
                        <Button
                            startIcon={<CheckCircleIcon />}
                            color="success"
                            variant="outlined"
                            onClick={() => { setResolutionText(''); setResolutionDialogOpen(true); }}
                        >
                            Mark as Done
                        </Button>
                    </Tooltip>
                )}
                <Box sx={{ flex: 1 }} />
                <Button onClick={onClose}>Close</Button>
            </DialogActions> 
            </>
            )}
        </Dialog>

        {/* Resolution Dialog */}
        <Dialog open={resolutionDialogOpen} onClose={() => setResolutionDialogOpen(false)} maxWidth="sm" fullWidth>
            <DialogTitle sx={{ pb: 1 }}>
                <Box sx={{ display: 'flex', alignItems: 'center', gap: 1 }}>
                    <CheckCircleIcon sx={{ color: '#2e7d32' }} />
                    <Typography fontWeight={700}>Close Risk — Add Resolution</Typography>
                </Box>
            </DialogTitle>
            <DialogContent dividers>
                <Typography variant="body2" color="text.secondary" sx={{ mb: 2 }}>
                    Describe how this risk was resolved or mitigated. This will be saved as the resolution and added as a comment.
                </Typography>
                <TextField
                    autoFocus
                    fullWidth
                    multiline
                    rows={4}
                    label="Resolution *"
                    placeholder="e.g. Risk was mitigated by implementing automated rollback procedures and communicating the deployment plan to the client..."
                    value={resolutionText}
                    onChange={e => setResolutionText(e.target.value)}
                    disabled={markRiskDone.isPending}
                />
            </DialogContent>
            <DialogActions>
                <Button onClick={() => setResolutionDialogOpen(false)} disabled={markRiskDone.isPending}>Cancel</Button>
                <Button
                    onClick={handleMarkDoneConfirm}
                    variant="contained"
                    color="success"
                    disabled={!resolutionText.trim() || markRiskDone.isPending}
                    startIcon={<CheckCircleIcon />}
                >
                    {markRiskDone.isPending ? 'Closing...' : 'Confirm & Close Risk'}
                </Button>
            </DialogActions>
        </Dialog>
        </>
    );
}
