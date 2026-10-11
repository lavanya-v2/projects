/* eslint-disable @typescript-eslint/no-explicit-any */
import React, { useState } from 'react';
import {
    Dialog, DialogTitle, DialogContent, DialogActions,
    Button, TextField, Tabs, Tab, Box, Typography, Paper,
    CircularProgress, Snackbar, Alert, Chip, Tooltip, IconButton,
    FormControlLabel, Checkbox, Divider,
} from '@mui/material';
import ContentCopyIcon from '@mui/icons-material/ContentCopy';
import LockIcon from '@mui/icons-material/Lock';
import CheckCircleIcon from '@mui/icons-material/CheckCircle';
import AutoFixHighIcon from '@mui/icons-material/AutoFixHigh';
import { useGeneratePortfolioMOM, useSavePortfolioMOM, useAcceptPortfolioMOM } from './hooks';
import { preventAccidentalDialogClose, VISIBLE_SCROLLBAR_SX } from '../../../shared/components/dialogProps';
import { useFullscreenContainer } from './presentation/FullscreenContainerContext';

type Step = 'input' | 'generating' | 'review';

const MAX_AI_ATTEMPTS = 3;

interface Props {
    open: boolean;
    report: any;
    onClose: () => void;
    onAccepted: (updated: any) => void;
}

export default function PortfolioMOMDialog({ open, report, onClose, onAccepted }: Props) {
    const container = useFullscreenContainer();
    const [step, setStep] = useState<Step>(() => report.momContent ? 'review' : 'input');
    const [tabIndex, setTabIndex] = useState(0);
    const [transcript, setTranscript] = useState<string>(report.meetingTranscript || '');
    const [momContent, setMomContent] = useState<string>(report.momContent || '');
    const [liveReport, setLiveReport] = useState<any>(report);
    // Both optional and OFF by default: leads often paste a finished MOM and just
    // want to save it, no AI and no presenter-note folding unless they opt in.
    const [useAI, setUseAI] = useState(false);
    const [includeNotes, setIncludeNotes] = useState(false);
    const [copied, setCopied] = useState(false);
    const [savedSnack, setSavedSnack] = useState(false);
    const [error, setError] = useState<string | null>(null);
    const generateMutation = useGeneratePortfolioMOM();
    const saveMutation = useSavePortfolioMOM();
    const acceptMutation = useAcceptPortfolioMOM();
    const accepting = acceptMutation.isPending;
    const saving = saveMutation.isPending;

    const attemptsUsed = liveReport.momGenerateAttempts || 0;
    const attemptsLeft = Math.max(0, MAX_AI_ATTEMPTS - attemptsUsed);
    const aiExhausted = attemptsLeft <= 0;

    const handleFileUpload = (e: React.ChangeEvent<HTMLInputElement>) => {
        const file = e.target.files?.[0];
        if (!file) return;
        const reader = new FileReader();
        reader.onload = (ev) => setTranscript((ev.target?.result as string) || '');
        reader.readAsText(file);
        e.target.value = '';
    };

    const handleGenerate = async () => {
        if (!transcript.trim()) {
            setError('Please enter meeting notes or upload a transcript.');
            return;
        }
        if (useAI && aiExhausted) {
            setError('AI generation limit reached (3 per presentation). Save and edit the draft manually instead.');
            return;
        }
        setError(null);
        if (useAI) setStep('generating');
        try {
            const updated = await generateMutation.mutateAsync({ id: report.id, transcript, useAI, includeNotes });
            setMomContent(updated.momContent || '');
            setLiveReport(updated);
            setStep('review');
        } catch (e: any) {
            setError(e?.response?.data?.error || 'Failed to save MOM. Please try again.');
            setStep('input');
        }
    };

    const handleSaveEdits = async () => {
        setError(null);
        try {
            const updated = await saveMutation.mutateAsync({ id: report.id, momContent });
            setLiveReport(updated);
            setSavedSnack(true);
        } catch (e: any) {
            setError(e?.response?.data?.error || 'Failed to save changes.');
        }
    };

    const handleCopy = async () => {
        try {
            await navigator.clipboard.writeText(momContent);
            setCopied(true);
        } catch {
            setError('Failed to copy to clipboard.');
        }
    };

    const handleAccept = async () => {
        setError(null);
        try {
            const updated = await acceptMutation.mutateAsync({ id: report.id, momContent });
            setLiveReport(updated);
            onAccepted(updated);
            onClose();
        } catch (e: any) {
            setError(e?.response?.data?.error || 'Failed to accept MOM.');
        }
    };

    const isAccepted = liveReport.momStatus === 'accepted';
    const lockedAt = liveReport.lockedAt;

    // Per-slide presenter notes captured live during the presentation. Folded
    // into the MOM by the backend only when "Include presenter notes" is checked;
    // we preview them read-only so the user knows what will be included.
    const SLIDE_LABELS: Record<string, string> = {
        overview: 'Delivery Overview',
        'highlights-actions': 'Highlights, Risks & Actions',
        'highlights-risks': 'Highlights & Risks',
        'actions-tech': 'Action Items & Tech',
        trends: 'Trends',
        'additional-insights': 'Additional Insights',
        discussion: 'Additional Discussion Points',
    };
    const drilldown: any[] = report.perProjectDrilldown || [];
    const labelForSlide = (slideId: string): string => {
        if (SLIDE_LABELS[slideId]) return SLIDE_LABELS[slideId];
        const m = slideId.match(/^drilldown-(\d+)$/);
        if (m) {
            const proj = drilldown.find((d: any) => String(d.projectId) === m[1]);
            return proj?.projectName ? `Project: ${proj.projectName}` : 'Project';
        }
        return slideId;
    };
    const presenterNoteEntries = Object.entries(
        (report.presenterNotes || {}) as Record<string, string>
    ).filter(([, v]) => (v ?? '').trim().length > 0);
    const hasPresenterNotes = presenterNoteEntries.length > 0;

    return (
        <>
            <Dialog open={open} onClose={preventAccidentalDialogClose(onClose)} maxWidth="md" fullWidth container={container} sx={{ zIndex: 1500 }}>
                <DialogTitle sx={{ display: 'flex', alignItems: 'center', gap: 1 }}>
                    Delivery MOM
                    {isAccepted && (
                        <Chip
                            icon={<CheckCircleIcon />}
                            label={`Accepted & Locked${lockedAt ? ' on ' + new Date(lockedAt).toLocaleDateString() : ''}`}
                            color="success"
                            size="small"
                            sx={{ ml: 1 }}
                        />
                    )}
                </DialogTitle>

                <DialogContent dividers sx={VISIBLE_SCROLLBAR_SX}>
                    {step === 'input' && (
                        <Box>
                            {report.momContent && (
                                <Box sx={{ mb: 2 }}>
                                    <Button variant="outlined" size="small" onClick={() => setStep('review')}>
                                        View Existing MOM
                                    </Button>
                                </Box>
                            )}
                            <Alert severity="info" sx={{ mb: 2 }}>
                                Type or paste your meeting notes below. Turn on <b>Polish &amp; structure with AI</b> to organize them into Discussion Points, Decisions, Action Items and a Closing Remark — or leave it off to save your MOM exactly as written. Either way, you can edit the result before locking.
                            </Alert>

                            <Paper variant="outlined" sx={{ p: 2, mb: 2 }}>
                                <FormControlLabel
                                    control={<Checkbox checked={useAI} onChange={(e) => setUseAI(e.target.checked)} disabled={aiExhausted} />}
                                    label={
                                        <Box sx={{ display: 'flex', alignItems: 'center', gap: 0.5 }}>
                                            <AutoFixHighIcon fontSize="small" color={aiExhausted ? 'disabled' : 'primary'} />
                                            <span>Polish &amp; structure with AI (optional)</span>
                                        </Box>
                                    }
                                />
                                <Typography variant="caption" color={aiExhausted ? 'error' : 'text.secondary'} sx={{ display: 'block', ml: 4, mb: 1 }}>
                                    {aiExhausted
                                        ? 'AI generation limit reached (3 per presentation). Save and edit the draft manually instead.'
                                        : `AI attempts left: ${attemptsLeft} of ${MAX_AI_ATTEMPTS}. The AI organizes and tidies your notes — it never invents content.`}
                                </Typography>
                                <FormControlLabel
                                    control={<Checkbox checked={includeNotes} onChange={(e) => setIncludeNotes(e.target.checked)} disabled={!hasPresenterNotes} />}
                                    label="Include presenter notes captured during the presentation (optional)"
                                />
                                {!hasPresenterNotes && (
                                    <Typography variant="caption" color="text.secondary" sx={{ display: 'block', ml: 4 }}>
                                        No presenter notes were captured for this presentation.
                                    </Typography>
                                )}
                            </Paper>

                            {includeNotes && hasPresenterNotes && (
                                <Paper variant="outlined" sx={{ p: 2, mb: 2, bgcolor: '#f7faff' }}>
                                    <Typography variant="subtitle2" fontWeight={700} sx={{ mb: 0.5 }}>
                                        Presenter notes to be included
                                    </Typography>
                                    <Box sx={{ display: 'flex', flexDirection: 'column', gap: 1 }}>
                                        {presenterNoteEntries.map(([slideId, text]) => (
                                            <Box key={slideId}>
                                                <Typography variant="caption" fontWeight={700} sx={{ textTransform: 'uppercase', letterSpacing: 0.4, color: '#37474f' }}>
                                                    {labelForSlide(slideId)}
                                                </Typography>
                                                <Typography sx={{ whiteSpace: 'pre-wrap', fontSize: 13 }}>{text.trim()}</Typography>
                                            </Box>
                                        ))}
                                    </Box>
                                </Paper>
                            )}

                            <Tabs value={tabIndex} onChange={(_, v) => setTabIndex(v)} sx={{ mb: 2 }}>
                                <Tab label="Type / Paste MOM" />
                                <Tab label="Upload Transcript" />
                            </Tabs>

                            {tabIndex === 0 && (
                                <TextField
                                    multiline minRows={10} fullWidth
                                    label="Meeting Notes / MOM"
                                    placeholder={useAI
                                        ? 'Type the notes you took in the meeting — discussion points, decisions, action items with owner and date, a closing remark. The AI will organize and tidy them; it will not add anything you did not write.'
                                        : 'Type or paste your finished MOM. It will be saved exactly as written — no AI. You can still edit it before locking.'}
                                    value={transcript}
                                    onChange={(e) => setTranscript(e.target.value)}
                                />
                            )}

                            {tabIndex === 1 && (
                                <Box>
                                    <Button variant="outlined" component="label" sx={{ mb: 2 }}>
                                        Choose File (.txt or .md)
                                        <input type="file" accept=".txt,.md" hidden onChange={handleFileUpload} />
                                    </Button>
                                    {transcript && (
                                        <Paper variant="outlined" sx={{ p: 2, maxHeight: 300, overflow: 'auto', mt: 1 }}>
                                            <Typography sx={{ whiteSpace: 'pre-wrap', fontSize: 13 }}>{transcript}</Typography>
                                        </Paper>
                                    )}
                                    {!transcript && (
                                        <Typography color="text.secondary" sx={{ fontSize: 13 }}>No file selected yet.</Typography>
                                    )}
                                </Box>
                            )}

                            {error && <Alert severity="error" sx={{ mt: 2 }}>{error}</Alert>}
                        </Box>
                    )}

                    {step === 'generating' && (
                        <Box sx={{ display: 'flex', flexDirection: 'column', alignItems: 'center', py: 6, gap: 2 }}>
                            <CircularProgress />
                            <Typography>AI is polishing your MOM...</Typography>
                        </Box>
                    )}

                    {step === 'review' && (
                        <Box>
                            <Box sx={{ display: 'flex', gap: 1, mb: 2, alignItems: 'center', flexWrap: 'wrap' }}>
                                <Tooltip title="Copy to clipboard">
                                    <IconButton onClick={handleCopy} size="small">
                                        <ContentCopyIcon fontSize="small" />
                                    </IconButton>
                                </Tooltip>
                                <Typography variant="caption" color="text.secondary">
                                    Edit below, then copy or lock
                                </Typography>
                                <Box sx={{ flex: 1 }} />
                                {isAccepted ? (
                                    <Chip
                                        icon={<LockIcon />}
                                        label={`Accepted & Locked${lockedAt ? ' on ' + new Date(lockedAt).toLocaleDateString() : ''}`}
                                        color="success"
                                        size="small"
                                    />
                                ) : (
                                    <>
                                        {transcript.trim() && transcript !== momContent && (
                                            <Tooltip title="Replace the AI version with your original notes.">
                                                <Button
                                                    variant="text"
                                                    size="small"
                                                    color="inherit"
                                                    onClick={() => setMomContent(transcript)}
                                                >
                                                    Use my raw notes (no AI)
                                                </Button>
                                            </Tooltip>
                                        )}
                                        <Button
                                            variant="outlined"
                                            size="small"
                                            onClick={handleSaveEdits}
                                            disabled={saving || !momContent.trim()}
                                        >
                                            {saving ? 'Saving...' : 'Save changes'}
                                        </Button>
                                        <Button
                                            startIcon={<LockIcon />}
                                            variant="contained"
                                            color="success"
                                            size="small"
                                            onClick={handleAccept}
                                            disabled={accepting || !momContent.trim()}
                                        >
                                            {accepting ? 'Accepting...' : 'Accept & Lock'}
                                        </Button>
                                    </>
                                )}
                            </Box>

                            {isAccepted ? (
                                <Paper variant="outlined" sx={{ p: 2.5, maxHeight: 500, overflow: 'auto', bgcolor: '#fafafa' }}>
                                    <Typography sx={{ whiteSpace: 'pre-wrap', fontFamily: 'monospace', fontSize: 13, lineHeight: 1.9, color: '#1a1a1a' }}>
                                        {momContent}
                                    </Typography>
                                </Paper>
                            ) : (
                                <TextField
                                    multiline minRows={16} fullWidth
                                    value={momContent}
                                    onChange={(e) => setMomContent(e.target.value)}
                                    InputProps={{ sx: { fontFamily: 'monospace', fontSize: 13, lineHeight: 1.7 } }}
                                    helperText="You can freely edit or overwrite the content. Remember to Save changes or Accept & Lock."
                                />
                            )}

                            {!isAccepted && (
                                <Box sx={{ mt: 1 }}>
                                    <Divider sx={{ my: 1 }} />
                                    <Button size="small" onClick={() => setStep('input')} color="inherit">
                                        Back to notes / re-generate
                                    </Button>
                                </Box>
                            )}

                            {error && <Alert severity="error" sx={{ mt: 2 }}>{error}</Alert>}
                        </Box>
                    )}
                </DialogContent>

                <DialogActions>
                    <Button onClick={onClose}>Close</Button>
                    {step === 'input' && (
                        <Button
                            variant="contained"
                            onClick={handleGenerate}
                            disabled={!transcript.trim() || (useAI && aiExhausted)}
                        >
                            {useAI ? 'Generate with AI' : 'Save MOM'}
                        </Button>
                    )}
                </DialogActions>
            </Dialog>

            <Snackbar
                open={copied}
                autoHideDuration={2500}
                onClose={() => setCopied(false)}
                message="Copied to clipboard!"
                anchorOrigin={{ vertical: 'top', horizontal: 'center' }}
            />
            <Snackbar
                open={savedSnack}
                autoHideDuration={2500}
                onClose={() => setSavedSnack(false)}
                message="Changes saved"
                anchorOrigin={{ vertical: 'top', horizontal: 'center' }}
            />
        </>
    );
}
