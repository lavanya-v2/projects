import {
    Dialog,
    DialogTitle,
    DialogContent,
    DialogActions,
    Box,
    Typography,
    Card,
    Button,
    CircularProgress,
    Alert,
} from '@mui/material';
import type { InsightsEditorController } from '../hooks/useInsightsEditor';

interface SummaryPreviewDialogProps {
    insights: InsightsEditorController;
}

/** Dialog that shows current vs proposed executive summary before accepting the refresh. */
export const SummaryPreviewDialog = ({ insights }: SummaryPreviewDialogProps) => {
    const {
        previewOpen,
        closePreview,
        localExecutiveSummary,
        proposedSummary,
        handleAcceptSummary,
        isAccepting,
        isSuperuser,
    } = insights;

    return (
        <Dialog open={previewOpen} onClose={closePreview} maxWidth="md" fullWidth>
            <DialogTitle>Executive Summary Preview</DialogTitle>
            <DialogContent dividers>
                {!isSuperuser && (
                    <Alert severity="warning" sx={{ mb: 2 }}>
                        <strong>One-time save.</strong> Once you accept, the project insights for this
                        report cannot be edited or deleted. Please review carefully before continuing.
                    </Alert>
                )}
                <Typography variant="body2" color="text.secondary" sx={{ mb: 2 }}>
                    Review the proposed executive summary before accepting. The new summary incorporates your manager insights.
                </Typography>
                <Box sx={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 2 }}>
                    <Box>
                        <Typography variant="subtitle2" color="text.secondary" gutterBottom>
                            Current Summary
                        </Typography>
                        <Card variant="outlined" sx={{ p: 2, bgcolor: '#f5f5f5', minHeight: 120 }}>
                            <Typography variant="body2" sx={{ whiteSpace: 'pre-line' }}>
                                {localExecutiveSummary || 'No current summary.'}
                            </Typography>
                        </Card>
                    </Box>
                    <Box>
                        <Typography variant="subtitle2" color="success.main" gutterBottom>
                            Proposed (with your insights)
                        </Typography>
                        <Card
                            variant="outlined"
                            sx={{
                                p: 2,
                                bgcolor: '#f0fff4',
                                border: '1px solid #4caf50',
                                minHeight: 120,
                            }}
                        >
                            <Typography variant="body2" sx={{ whiteSpace: 'pre-line' }}>
                                {proposedSummary}
                            </Typography>
                        </Card>
                    </Box>
                </Box>
            </DialogContent>
            <DialogActions>
                <Button onClick={closePreview} disabled={isAccepting}>
                    Cancel
                </Button>
                <Button
                    variant="contained"
                    color="success"
                    onClick={handleAcceptSummary}
                    disabled={isAccepting}
                    startIcon={
                        isAccepting ? <CircularProgress size={16} color="inherit" /> : undefined
                    }
                >
                    Accept & Save
                </Button>
            </DialogActions>
        </Dialog>
    );
};
