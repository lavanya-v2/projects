import { useState } from 'react';
import {
    Dialog, DialogTitle, DialogContent, DialogActions,
    Button, TextField, Typography, Box, Chip
} from '@mui/material';
import type { RiskStatus } from '../../types/risk';

interface StatusChangeCommentDialogProps {
    open: boolean;
    fromStatus: RiskStatus;
    toStatus: RiskStatus;
    onConfirm: (comment: string) => void;
    onCancel: () => void;
    loading?: boolean;
}

const STATUS_LABELS: Record<RiskStatus, string> = {
    NEW: 'New',
    WORK_IN_PROGRESS: 'Work In Progress',
    STALE: 'Stale',
    DONE: 'Done'
};

export function StatusChangeCommentDialog({
    open, fromStatus, toStatus, onConfirm, onCancel, loading
}: StatusChangeCommentDialogProps) {
    const [comment, setComment] = useState('');

    const handleConfirm = () => {
        if (!comment.trim()) return;
        onConfirm(comment.trim());
        setComment('');
    };

    const handleCancel = () => {
        setComment('');
        onCancel();
    };

    return (
        <Dialog open={open} onClose={handleCancel} maxWidth="sm" fullWidth>
            <DialogTitle>Move Risk — Comment Required</DialogTitle>
            <DialogContent dividers>
                <Box sx={{ display: 'flex', alignItems: 'center', gap: 1, mb: 2 }}>
                    <Chip label={STATUS_LABELS[fromStatus]} size="small" sx={{ bgcolor: '#e0e0e0' }} />
                    <Typography variant="body2" color="text.secondary">→</Typography>
                    <Chip label={STATUS_LABELS[toStatus]} size="small" color="primary" />
                </Box>
                <Typography variant="body2" color="text.secondary" sx={{ mb: 2 }}>
                    A comment is required to explain why this risk is being moved. This will be recorded in the comment history.
                </Typography>
                <TextField
                    autoFocus
                    multiline
                    rows={3}
                    fullWidth
                    label="Comment *"
                    placeholder="Explain why you're moving this risk..."
                    value={comment}
                    onChange={e => setComment(e.target.value)}
                    disabled={loading}
                />
            </DialogContent>
            <DialogActions>
                <Button onClick={handleCancel} disabled={loading}>Cancel</Button>
                <Button
                    onClick={handleConfirm}
                    variant="contained"
                    disabled={!comment.trim() || loading}
                >
                    {loading ? 'Moving...' : 'Confirm Move'}
                </Button>
            </DialogActions>
        </Dialog>
    );
}
