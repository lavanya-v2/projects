import {
    Paper,
    Box,
    Typography,
    IconButton,
    Alert,
    TextField,
    Button,
    CircularProgress,
    Collapse,
    Card,
    Dialog,
    DialogTitle,
    DialogContent,
    DialogActions,
} from '@mui/material';
import EditIcon from '@mui/icons-material/Edit';
import SaveIcon from '@mui/icons-material/Save';
import AutorenewIcon from '@mui/icons-material/Autorenew';
import ExpandMoreIcon from '@mui/icons-material/ExpandMore';
import ExpandLessIcon from '@mui/icons-material/ExpandLess';
import type { InsightsEditorController } from '../hooks/useInsightsEditor';
import type { TeamNotesController } from '../hooks/useTeamNotes';
import { TeamNotesSection } from './TeamNotesSection';

interface ProjectInsightsPanelProps {
    type: 'daily' | 'weekly';
    isLead: boolean;
    insights: InsightsEditorController;
    notes: TeamNotesController;
}

/** Locked / editable project insights card + original AI summary reveal + team notes. */
export const ProjectInsightsPanel = ({
    type,
    isLead,
    insights,
    notes,
}: ProjectInsightsPanelProps) => {
    if (!insights.resolvedReportId) return null;

    const {
        canEditInsights,
        insightsAuthorName,
        hasSavedInsights,
        baseRoleEligible,
        isSuperuser,
        isEditing,
        beginEdit,
        cancelEdit,
        insightsText,
        setInsightsText,
        isSaving,
        isRefreshing,
        insightsSaveError,
        insightsSaveSuccess,
        dismissSaveError,
        handleSaveInsights,
        handleRefreshSummary,
        originalExecutiveSummary,
        showOriginalSummary,
        toggleOriginalSummary,
        confirmSaveOpen,
        requestSave,
        cancelConfirmSave,
    } = insights;

    return (
        <Paper elevation={1} sx={{ px: { xs: 2, md: 3 }, py: 2.5, borderRadius: 2, mt: 2 }}>
            <Box
                sx={{
                    display: 'flex',
                    alignItems: 'center',
                    justifyContent: 'space-between',
                    mb: 1,
                }}
            >
                <Box sx={{ display: 'flex', alignItems: 'center', gap: 1 }}>
                    <Box
                        sx={{
                            width: 4,
                            height: 18,
                            bgcolor: '#9c27b0',
                            borderRadius: 1,
                            flexShrink: 0,
                        }}
                    />
                    <Typography variant="subtitle1" fontWeight={700} sx={{ letterSpacing: 0.2 }}>
                        Project Insights
                    </Typography>
                </Box>
                {!isEditing && canEditInsights && (
                    <IconButton size="small" onClick={beginEdit} title="Edit insights">
                        <EditIcon fontSize="small" />
                    </IconButton>
                )}
            </Box>

            {insightsAuthorName && (
                <Typography
                    variant="caption"
                    sx={{ display: 'block', mb: 1, color: '#7b1fa2', fontWeight: 600 }}
                >
                    ✍️ Written by {insightsAuthorName}
                </Typography>
            )}

            {!canEditInsights && hasSavedInsights && insightsAuthorName && (
                <Alert severity="info" sx={{ mb: 1.5, py: 0.5 }}>
                    Project Insights have already been saved by {insightsAuthorName} and cannot be edited.
                    Add additional observations in Team Notes below.
                </Alert>
            )}
            {!canEditInsights && !hasSavedInsights && !baseRoleEligible && !isLead && (
                <Alert severity="info" sx={{ mb: 1.5, py: 0.5 }}>
                    Your role does not permit editing
                    {type === 'daily' ? ' daily ' : ' weekly project '}
                    insights. Add your observations in Team Notes below.
                </Alert>
            )}

            <Typography variant="caption" color="text.secondary" sx={{ display: 'block', mb: 1.5 }}>
                Add context not captured in Jira — escalations, customer concerns, verbal feedback, team observations.
                {type === 'weekly' &&
                    ' For weekly reports, insights are auto-populated from daily entries and can be refined here.'}
                {!hasSavedInsights && canEditInsights && !isSuperuser && (
                    <Box component="span" sx={{ display: 'block', mt: 0.5, color: '#b26500', fontWeight: 600 }}>
                        Heads up: only one insight can be saved per report. Once saved it cannot be edited.
                    </Box>
                )}
            </Typography>

            {insightsSaveSuccess && (
                <Alert severity="success" sx={{ mb: 1.5 }}>
                    Saved successfully.
                </Alert>
            )}
            {insightsSaveError && (
                <Alert severity="error" sx={{ mb: 1.5 }} onClose={dismissSaveError}>
                    {insightsSaveError}
                </Alert>
            )}

            {isEditing ? (
                <>
                    <TextField
                        multiline
                        minRows={3}
                        maxRows={10}
                        fullWidth
                        variant="outlined"
                        size="small"
                        placeholder="Enter your observations, escalations, customer feedback, or any context relevant to this report period..."
                        value={insightsText}
                        onChange={e => setInsightsText(e.target.value)}
                        sx={{ mb: 1.5 }}
                    />
                    <Box sx={{ display: 'flex', gap: 1, flexWrap: 'wrap' }}>
                        <Button
                            variant="contained"
                            color="secondary"
                            size="small"
                            startIcon={
                                isSaving ? (
                                    <CircularProgress size={14} color="inherit" />
                                ) : (
                                    <SaveIcon />
                                )
                            }
                            onClick={requestSave}
                            disabled={isSaving || isRefreshing || !insightsText.trim()}
                        >
                            Save Insights
                        </Button>
                        <Button
                            variant="outlined"
                            color="secondary"
                            size="small"
                            startIcon={
                                isRefreshing ? (
                                    <CircularProgress size={14} color="inherit" />
                                ) : (
                                    <AutorenewIcon />
                                )
                            }
                            onClick={handleRefreshSummary}
                            disabled={isSaving || isRefreshing || !insightsText.trim()}
                            title="Generate a refreshed executive summary that incorporates your insights"
                        >
                            Refresh Summary
                        </Button>
                        <Button
                            variant="text"
                            size="small"
                            onClick={cancelEdit}
                            disabled={isSaving || isRefreshing}
                        >
                            Cancel
                        </Button>
                    </Box>
                </>
            ) : (
                <Typography
                    variant="body1"
                    sx={{
                        whiteSpace: 'pre-line',
                        lineHeight: 1.7,
                        fontSize: '1rem',
                        fontWeight: 500,
                        color: insightsText ? '#1a1a1a' : 'text.disabled',
                        fontStyle: insightsText ? 'normal' : 'italic',
                    }}
                >
                    {insightsText ||
                        (canEditInsights
                            ? 'No project insights yet. Click the edit icon to add context.'
                            : 'No project insights added yet.')}
                </Typography>
            )}

            {originalExecutiveSummary && (
                <Box sx={{ mt: 2, borderTop: '1px dashed #e0e0e0', pt: 1 }}>
                    <Button
                        size="small"
                        variant="text"
                        color="secondary"
                        onClick={toggleOriginalSummary}
                        endIcon={showOriginalSummary ? <ExpandLessIcon /> : <ExpandMoreIcon />}
                    >
                        {showOriginalSummary ? 'Hide' : 'View'} original AI summary
                    </Button>
                    <Collapse in={showOriginalSummary}>
                        <Card variant="outlined" sx={{ p: 2, mt: 1, bgcolor: '#fafafa' }}>
                            <Typography
                                variant="caption"
                                color="text.secondary"
                                display="block"
                                gutterBottom
                            >
                                Original AI-generated summary (before project insights were applied)
                            </Typography>
                            <Typography
                                variant="body1"
                                sx={{ whiteSpace: 'pre-line', fontStyle: 'italic', fontSize: '0.95rem', color: '#37474f', lineHeight: 1.65 }}
                            >
                                {originalExecutiveSummary}
                            </Typography>
                        </Card>
                    </Collapse>
                </Box>
            )}

            <TeamNotesSection notes={notes} />

            {/* One-and-done confirmation for the direct "Save Insights" button. */}
            <Dialog
                open={confirmSaveOpen}
                onClose={() => !isSaving && cancelConfirmSave()}
                maxWidth="xs"
                fullWidth
            >
                <DialogTitle>Save Project Insights?</DialogTitle>
                <DialogContent dividers>
                    <Alert severity="warning" sx={{ mb: 2 }}>
                        <strong>This cannot be undone.</strong> Only one insight can be saved per
                        {type === 'daily' ? ' daily report ' : ' weekly project report '}
                        per project. After saving, you will not be able to edit or delete this insight.
                    </Alert>
                    <Typography variant="body2" color="text.secondary">
                        Make sure your insight is complete and accurate before continuing.
                    </Typography>
                </DialogContent>
                <DialogActions>
                    <Button onClick={cancelConfirmSave} disabled={isSaving}>
                        Review again
                    </Button>
                    <Button
                        variant="contained"
                        color="secondary"
                        onClick={() => {
                            void handleSaveInsights();
                        }}
                        disabled={isSaving}
                        startIcon={
                            isSaving ? (
                                <CircularProgress size={16} color="inherit" />
                            ) : (
                                <SaveIcon />
                            )
                        }
                    >
                        Yes, save now
                    </Button>
                </DialogActions>
            </Dialog>
        </Paper>
    );
};
