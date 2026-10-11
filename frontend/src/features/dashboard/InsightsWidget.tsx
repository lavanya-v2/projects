import { useState, useEffect } from 'react';
import {
    Box, Typography, TextField, Button, CircularProgress,
    Alert, Collapse, Chip,
} from '@mui/material';
import EditNoteIcon from '@mui/icons-material/EditNote';
import ExpandMoreIcon from '@mui/icons-material/ExpandMore';
import ExpandLessIcon from '@mui/icons-material/ExpandLess';
import CheckIcon from '@mui/icons-material/Check';
import CloseIcon from '@mui/icons-material/Close';
import { useDailyReports, useSaveDailyInsights, useApplyInsightsHealth } from '../reports/daily/hooks';

interface Props {
    projectId: number;
    readOnly?: boolean;
}

export const InsightsWidget = ({ projectId, readOnly = false }: Props) => {
    const [expanded, setExpanded] = useState(false);
    const [text, setText] = useState('');
    const [saved, setSaved] = useState(false);
    const [error, setError] = useState('');
    const [healthSuggestion, setHealthSuggestion] = useState<{ suggestedHealth: string; reason: string } | null>(null);
    const [textInitialized, setTextInitialized] = useState(false);

    const { data: reportData, isLoading: loading } = useDailyReports({
        projectId,
        page: 1,
        limit: 1,
    });
    const saveDailyInsights = useSaveDailyInsights();
    const applyInsightsHealth = useApplyInsightsHealth();

    const snapshot = reportData?.reports?.[0] ?? null;

    useEffect(() => {
        if (snapshot && !textInitialized) {
            setText(snapshot.managerInsights ?? '');
            setTextInitialized(true);
        }
    }, [snapshot, textInitialized]);

    const handleSave = async () => {
        if (!snapshot) return;
        setError('');
        setHealthSuggestion(null);
        try {
            const result = await saveDailyInsights.mutateAsync({ id: snapshot.id, insights: text });
            setSaved(true);
            setTimeout(() => setSaved(false), 3000);
            if (result?.healthSuggestion) {
                setHealthSuggestion(result.healthSuggestion);
            }
        } catch {
            setError('Failed to save insights.');
        }
    };

    const handleAcceptHealth = async () => {
        if (!snapshot || !healthSuggestion) return;
        try {
            await applyInsightsHealth.mutateAsync({ id: snapshot.id, insightsHealth: healthSuggestion.suggestedHealth, reason: healthSuggestion.reason });
            setHealthSuggestion(null);
        } catch {
            setError('Failed to apply health suggestion.');
        }
    };

    const dateLabel = snapshot?.date
        ? (() => {
            const today = new Date().toISOString().slice(0, 10);
            const yesterday = new Date(Date.now() - 86400000).toISOString().slice(0, 10);
            if (snapshot.date === today) return `Today (${snapshot.date})`;
            if (snapshot.date === yesterday) return `Yesterday (${snapshot.date})`;
            return snapshot.date;
        })()
        : null;

    return (
        <Box sx={{ borderTop: '1px solid #e2e8f0', mt: 1 }}>
            <Box
                onClick={() => setExpanded(e => !e)}
                sx={{
                    px: 2.5, py: 1, display: 'flex', alignItems: 'center', gap: 1,
                    cursor: 'pointer', color: '#6a1b9a',
                    '&:hover': { bgcolor: 'rgba(106,27,154,.04)' },
                }}
            >
                <EditNoteIcon sx={{ fontSize: 16 }} />
                <Typography sx={{ fontSize: 12, fontWeight: 600, flex: 1 }}>Project Insights</Typography>
                {expanded ? <ExpandLessIcon sx={{ fontSize: 16 }} /> : <ExpandMoreIcon sx={{ fontSize: 16 }} />}
            </Box>

            <Collapse in={expanded}>
                <Box sx={{ px: 2.5, pb: 2 }}>
                    {loading && <CircularProgress size={18} sx={{ my: 1 }} />}
                    {error && <Alert severity="error" sx={{ mb: 1, py: 0.5, fontSize: 12 }}>{error}</Alert>}

                    {snapshot && (
                        <>
                            {dateLabel && (
                                <Chip
                                    label={`Insights for: ${dateLabel}`}
                                    size="small"
                                    sx={{ mb: 1.25, fontSize: 11, bgcolor: '#f3e5f5', color: '#6a1b9a', fontWeight: 600 }}
                                />
                            )}

                            <TextField
                                multiline
                                minRows={readOnly ? 2 : 3}
                                fullWidth
                                size="small"
                                placeholder="Add context, observations or updates for this DSR day..."
                                value={text}
                                onChange={e => setText(e.target.value)}
                                disabled={readOnly || saveDailyInsights.isPending}
                                sx={{ mb: 1, '& .MuiInputBase-root': { fontSize: 13 } }}
                            />

                            {!readOnly && (
                                <Box sx={{ display: 'flex', alignItems: 'center', gap: 1 }}>
                                    <Button
                                        size="small"
                                        variant="contained"
                                        onClick={handleSave}
                                        disabled={saveDailyInsights.isPending || !text.trim()}
                                        sx={{ bgcolor: '#6a1b9a', '&:hover': { bgcolor: '#4a148c' }, fontSize: 12 }}
                                        startIcon={saveDailyInsights.isPending ? <CircularProgress size={12} color="inherit" /> : undefined}
                                    >
                                        {saveDailyInsights.isPending ? 'Saving…' : 'Save'}
                                    </Button>
                                    {saved && (
                                        <Typography sx={{ fontSize: 12, color: '#4caf50', display: 'flex', alignItems: 'center', gap: 0.5 }}>
                                            <CheckIcon sx={{ fontSize: 14 }} /> Saved
                                        </Typography>
                                    )}
                                </Box>
                            )}

                            {healthSuggestion && (
                                <Alert
                                    severity="warning"
                                    sx={{ mt: 1.5, fontSize: 12 }}
                                    action={
                                        <Box sx={{ display: 'flex', gap: 0.5 }}>
                                            <Button
                                                size="small"
                                                color="warning"
                                                startIcon={applyInsightsHealth.isPending ? <CircularProgress size={12} /> : <CheckIcon />}
                                                onClick={handleAcceptHealth}
                                                disabled={applyInsightsHealth.isPending}
                                                sx={{ fontSize: 11 }}
                                            >
                                                Accept
                                            </Button>
                                            <Button
                                                size="small"
                                                startIcon={<CloseIcon />}
                                                onClick={() => setHealthSuggestion(null)}
                                                sx={{ fontSize: 11 }}
                                            >
                                                Dismiss
                                            </Button>
                                        </Box>
                                    }
                                >
                                    <b>Health suggestion: {healthSuggestion.suggestedHealth}</b> — {healthSuggestion.reason}
                                </Alert>
                            )}
                        </>
                    )}

                    {!loading && !snapshot && !error && (
                        <Typography sx={{ fontSize: 12, color: '#94a3b8' }}>No DSR snapshot available for this project.</Typography>
                    )}
                </Box>
            </Collapse>
        </Box>
    );
};
