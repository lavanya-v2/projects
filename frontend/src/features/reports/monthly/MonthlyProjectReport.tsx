import { useState, useEffect } from 'react';
import {
    Box,
    Button,
    TextField,
    MenuItem,
    CircularProgress,
    Alert,
    Paper,
    Typography,
    Chip,
    Divider,
    Pagination,
    Dialog,
    DialogTitle,
    DialogContent,
    DialogActions,
    IconButton,
    Card,
    useMediaQuery,
    useTheme,
} from '@mui/material';
import { useFetchProjects } from '../../auth/hooks';
import { useProjectMonthlyReports, useGenerateMonthlyProjectReport } from './hooks';
import { useAcceptInsights, usePreviewInsights } from '../daily/hooks';
import { useAuth } from '../../../context/AuthContext';
import AutorenewIcon from '@mui/icons-material/Autorenew';
import AddIcon from '@mui/icons-material/Add';
import EditIcon from '@mui/icons-material/Edit';
import SaveIcon from '@mui/icons-material/Save';
import { DatePicker } from '@mui/x-date-pickers/DatePicker';
import dayjs, { Dayjs } from 'dayjs';
import utc from 'dayjs/plugin/utc';
import timezone from 'dayjs/plugin/timezone';
import type { Account } from '../../admin/accounts/types';
import type { Project } from '../../../types';

dayjs.extend(utc);
dayjs.extend(timezone);

interface MonthlyReportProps {
    accounts: Account[];
    selectedAccount?: Account | null;
}

export const MonthlyProjectReport = ({ accounts, selectedAccount: propAccount }: MonthlyReportProps) => {
    const { user } = useAuth();
    const theme = useTheme();
    const isMobile = useMediaQuery(theme.breakpoints.down('sm'));
    const isLead = user?.roleName === 'lead';

    // Filters & Pagination State
    const [selectedAccount, setSelectedAccount] = useState<string>(propAccount?.id ? String(propAccount.id) : '');
    const [projectList, setProjectList] = useState<Project[]>([]);
    const [selectedProject, setSelectedProject] = useState<string>('');
    const [statusFilter, setStatusFilter] = useState<string>('All');
    const [page, setPage] = useState<number>(1);
    const limit = 10;

    // Reports Data State
    const [error, setError] = useState('');
    const [successMessage, setSuccessMessage] = useState('');

    const fetchProjects = useFetchProjects();
    const generateMonthlyMutation = useGenerateMonthlyProjectReport();
    const acceptInsightsMutation = useAcceptInsights();
    const previewInsightsMutation = usePreviewInsights();

    const projectMonthlyQuery = useProjectMonthlyReports(
        selectedProject ? parseInt(selectedProject) : 0,
        page,
        limit,
        statusFilter,
    );
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const reports: any[] = selectedProject ? (projectMonthlyQuery.data?.reports ?? []) : [];
    const loading = !!selectedProject && projectMonthlyQuery.isFetching;
    const totalPages = selectedProject ? (projectMonthlyQuery.data?.totalPages ?? 1) : 1;

    // Inline selected report
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const [currentViewReport, setCurrentViewReport] = useState<any | null>(null);

    // Manager Insights state
    const [insightsText, setInsightsText] = useState<string>('');
    const [isInsightsEditing, setIsInsightsEditing] = useState(false);
    const [isInsightsSaving, setIsInsightsSaving] = useState(false);
    const [isInsightsRefreshing, setIsInsightsRefreshing] = useState(false);
    const [insightsSaveSuccess, setInsightsSaveSuccess] = useState(false);
    const [insightsSaveError, setInsightsSaveError] = useState('');
    const [localWorkSummary, setLocalWorkSummary] = useState<string>('');
    const [insightsPreviewOpen, setInsightsPreviewOpen] = useState(false);
    const [proposedSummary, setProposedSummary] = useState('');
    const [isInsightsAccepting, setIsInsightsAccepting] = useState(false);

    // Generate Form State
    const [isGenerateDialogOpen, setIsGenerateDialogOpen] = useState(false);
    const [genDate, setGenDate] = useState<Dayjs | null>(dayjs());
    const [genLoading, setGenLoading] = useState(false);

    // Month selection error
    const [monthError, setMonthError] = useState('');

    // Sync global account selection
    useEffect(() => {
        if (propAccount?.id) setSelectedAccount(String(propAccount.id));
    }, [propAccount?.id]);

    // Fetch projects when account changes
    useEffect(() => {
        const loadProjects = async () => {
            if (selectedAccount) {
                try {
                    const acc = accounts.find(a => a.name === selectedAccount || parseInt(String(a.id)) === parseInt(selectedAccount));
                    if (acc) {
                        const data = await fetchProjects(acc.id);
                        // Sprint-cadence projects report per-sprint (Board View), not monthly.
                        setProjectList(data.filter(p => (p as { reportingFrequency?: string }).reportingFrequency !== 'sprint'));
                    }
                } catch (err) {
                    console.error("Failed to fetch projects", err);
                }
            } else {
                setProjectList([]);
            }
            setSelectedProject('');
            setCurrentViewReport(null);
            setPage(1);
        };
        loadProjects();
    }, [selectedAccount, accounts]); // eslint-disable-line react-hooks/exhaustive-deps

    // Surface query errors
    useEffect(() => {
        if (projectMonthlyQuery.isError) {
            const err = projectMonthlyQuery.error;
            const errorWithResponse = err as { response?: { data?: { error?: string } }; message?: string };
            setError(errorWithResponse?.response?.data?.error || errorWithResponse?.message || 'Failed to fetch reports.');
        }
    }, [projectMonthlyQuery.isError, projectMonthlyQuery.error]);

    // Auto-select most recent when list updates
    useEffect(() => {
        if (!selectedProject) { setCurrentViewReport(null); return; }
        if (reports.length > 0) handleView(reports[0]);
        else setCurrentViewReport(null);
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [selectedProject, projectMonthlyQuery.dataUpdatedAt]);

    const handleGenerateSubmit = async () => {
        setError('');
        setSuccessMessage('');

        if (!selectedProject || !genDate) {
            setError("Project and Month/Year are required.");
            return;
        }

        setGenLoading(true);
        try {
            const p = projectList.find(proj => parseInt(String(proj.id)) === parseInt(selectedProject));
            if (!p) throw new Error("Project not found");

            const m = genDate.month() + 1;
            const y = genDate.year();

            const data = await generateMonthlyMutation.mutateAsync({ projectId: p.id, month: m, year: y, force: true });

            if (data?.isAsync) {
                setSuccessMessage(data.message || 'Processing your request...');
                setIsGenerateDialogOpen(false);
            } else {
                setSuccessMessage("Report generated successfully!");
                setIsGenerateDialogOpen(false);
            }
        } catch (err) {
            console.error("Generate Report Error:", err);
            const errorWithResponse = err as { response?: { data?: { error?: string } }; message?: string };
            setError(errorWithResponse?.response?.data?.error || errorWithResponse?.message || 'Failed to generate report.');
        } finally {
            setGenLoading(false);
        }
    };

    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const handleRegenerate = async (report: any) => {
        setError('');
        setSuccessMessage('');
        try {
            const p = projectList.find(proj => parseInt(String(proj.id)) === parseInt(selectedProject));
            if (!p) throw new Error("Project not found");

            const data = await generateMonthlyMutation.mutateAsync({ projectId: p.id, month: report.month, year: report.year, force: true });
            if (data?.isAsync) {
                setSuccessMessage(`Regeneration queued for ${dayjs().month(report.month - 1).format('MMMM')} ${report.year}.`);
            } else {
                setSuccessMessage("Report regenerated successfully!");
            }
        } catch (err) {
            const errorWithResponse = err as { response?: { data?: { error?: string } }; message?: string };
            setError(errorWithResponse?.response?.data?.error || errorWithResponse?.message || 'Failed to regenerate report.');
        }
    };

    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const handleView = (report: any) => {
        setCurrentViewReport(report);
        setLocalWorkSummary(report.workSummary || '');
        setInsightsText(report.managerInsights || '');
        setIsInsightsEditing(false);
        setInsightsSaveSuccess(false);
        setInsightsSaveError('');
    };

    const handleSaveInsights = async () => {
        if (!currentViewReport?.id) return;
        setIsInsightsSaving(true);
        setInsightsSaveError('');
        setInsightsSaveSuccess(false);
        try {
            await acceptInsightsMutation.mutateAsync({ reportType: 'monthly_project', id: currentViewReport.id, insights: insightsText, newSummary: localWorkSummary });
            setIsInsightsEditing(false);
            setInsightsSaveSuccess(true);
            setTimeout(() => setInsightsSaveSuccess(false), 3000);
        } catch (err) {
            const errorWithResponse = err as { response?: { data?: { error?: string } }; message?: string };
            setInsightsSaveError(errorWithResponse?.response?.data?.error || errorWithResponse?.message || 'Failed to save accepted insights.');
        } finally {
            setIsInsightsSaving(false);
        }
    };

    const handleRefreshSummary = async () => {
        if (!currentViewReport?.id || !insightsText.trim()) return;
        setIsInsightsRefreshing(true);
        setInsightsSaveError('');
        try {
            const result = await previewInsightsMutation.mutateAsync({ reportType: 'monthly_project', id: currentViewReport.id, insights: insightsText });
            setProposedSummary(result.newSummary);
            setInsightsPreviewOpen(true);
        } catch (err) {
            const errorWithResponse = err as { response?: { data?: { error?: string } }; message?: string };
            setInsightsSaveError(errorWithResponse?.response?.data?.error || errorWithResponse?.message || 'Failed to generate refreshed summary.');
        } finally {
            setIsInsightsRefreshing(false);
        }
    };

    const handleAcceptSummary = async () => {
        if (!currentViewReport?.id) return;
        setIsInsightsAccepting(true);
        try {
            await acceptInsightsMutation.mutateAsync({ reportType: 'monthly_project', id: currentViewReport.id, insights: insightsText, newSummary: proposedSummary });
            setLocalWorkSummary(proposedSummary);
            setIsInsightsEditing(false);
            setInsightsPreviewOpen(false);
            setInsightsSaveSuccess(true);
            setTimeout(() => setInsightsSaveSuccess(false), 3000);
        } catch (err) {
            const errorWithResponse = err as { response?: { data?: { error?: string } }; message?: string };
            setInsightsSaveError(errorWithResponse?.response?.data?.error || errorWithResponse?.message || 'Failed to save accepted summary.');
        } finally {
            setIsInsightsAccepting(false);
        }
    };

    const handleGenMonth = (reportDate: dayjs.Dayjs | null) => {
        if (reportDate && reportDate.isValid()) {
            setGenDate(reportDate);
            if (reportDate && dayjs(reportDate).isAfter(dayjs())) {
                setMonthError('Date cannot be future.');
            } else if (reportDate && dayjs(reportDate).isBefore(dayjs().subtract(6, 'M'))) {
                setMonthError('Date not valid.');
            } else {
                setMonthError('');
            }
        } else if (!reportDate) {
            setGenDate(null);
            setMonthError('');
        }
        return reportDate;
    }

    const getStatusColor = (status: string) => {
        switch (status?.toLowerCase()) {
            case 'green': return 'success';
            case 'amber': return 'warning';
            case 'red': return 'error';
            default: return 'default';
        }
    };

    return (
        <Box>
            {/* Alerts */}
            {error && <Alert severity="error" sx={{ mb: 2 }} onClose={() => setError('')}>{error}</Alert>}
            {successMessage && <Alert severity="success" sx={{ mb: 2 }} onClose={() => setSuccessMessage('')}>{successMessage}</Alert>}

            {/* Compact filter row */}
            <Box sx={{ display: 'flex', gap: 2, mb: 3, alignItems: 'center', flexWrap: 'wrap' }}>
                {!propAccount && (
                    <TextField select size="small" label="Account" value={selectedAccount}
                        onChange={e => setSelectedAccount(e.target.value)} sx={{ minWidth: 180 }}>
                        <MenuItem value=""><em>Select account</em></MenuItem>
                        {accounts.map(acc => (
                            <MenuItem key={acc.id} value={acc.id} sx={acc.hasFullAccess === false ? { opacity: 0.8 } : {}}>
                                {acc.hasFullAccess === false ? `${acc.name} (Restricted)` : acc.name}
                            </MenuItem>
                        ))}
                    </TextField>
                )}
                <TextField select size="small" label="Project" value={selectedProject}
                    onChange={e => { setSelectedProject(e.target.value); setPage(1); }}
                    disabled={!selectedAccount || projectList.length === 0} sx={{ minWidth: 200 }}>
                    <MenuItem value="" disabled>Select project</MenuItem>
                    {projectList.map(p => <MenuItem key={p.id} value={p.id}>{p.name}</MenuItem>)}
                </TextField>
                <Box sx={{ flex: 1 }} />
                {!isLead && (
                    <Button variant="contained" size="small" startIcon={<AddIcon />}
                        onClick={() => { setIsGenerateDialogOpen(true); setGenDate(dayjs()); setMonthError(''); }} disabled={!selectedProject}>
                        Generate Report
                    </Button>
                )}
            </Box>

            {/* Two-column body */}
            <Box sx={{
                display: 'flex', gap: 3, alignItems: 'flex-start', flexDirection: { xs: 'column', md: 'row' },
                width: '100%',
            }}>
                {/* LEFT — inline report content */}
                <Box sx={{ flex: 1, minWidth: 0 }}>
                    {!selectedProject && (
                        <Paper sx={{ p: 4, textAlign: 'center', border: '1px dashed #e2e8f0' }} elevation={0}>
                            <Typography sx={{ color: '#94a3b8', fontSize: 14 }}>Select a project to view reports</Typography>
                        </Paper>
                    )}
                    {selectedProject && loading && (
                        <Box sx={{ display: 'flex', justifyContent: 'center', p: 6 }}>
                            <CircularProgress />
                        </Box>
                    )}
                    {selectedProject && !loading && !currentViewReport && (
                        <Paper sx={{ p: 4, textAlign: 'center', border: '1px dashed #e2e8f0' }} elevation={0}>
                            <Typography sx={{ color: '#94a3b8', fontSize: 14 }}>No reports found. Generate one to get started.</Typography>
                        </Paper>
                    )}
                    {currentViewReport && (
                        <Box>
                            {/* Health chip */}
                            <Box sx={{ mb: 2.5, display: 'flex', alignItems: 'center', gap: 1.5 }}>
                                <Typography sx={{ fontSize: 13, color: '#64748b' }}>
                                    {dayjs().month(currentViewReport.month - 1).format('MMMM')} {currentViewReport.year}
                                </Typography>
                                <Chip
                                    label={currentViewReport.status || 'Unknown'}
                                    color={getStatusColor(currentViewReport.status)}
                                    sx={{ fontWeight: 700 }}
                                />
                            </Box>

                            {/* Hero Paper: work summary + risks/achievements */}
                            <Paper elevation={2} sx={{ borderRadius: 2, overflow: 'hidden' }}>
                                <Box sx={{ px: { xs: 2.5, md: 3.5 }, pt: 3, pb: 2.5 }}>
                                    <Box sx={{ display: 'flex', alignItems: 'center', gap: 1, mb: 1.5 }}>
                                        <Box sx={{ width: 4, height: 18, bgcolor: '#1976d2', borderRadius: 1, flexShrink: 0 }} />
                                        <Typography variant="subtitle1" fontWeight={700}>Work Summary</Typography>
                                    </Box>
                                    <Typography variant="body2" sx={{ whiteSpace: 'pre-wrap', lineHeight: 1.9, color: 'text.primary' }}>{localWorkSummary}</Typography>
                                </Box>

                                <Divider />

                                <Box sx={{ display: 'grid', gridTemplateColumns: { xs: '1fr', md: currentViewReport.achievements ? '1fr 1fr' : '1fr' } }}>
                                    <Box sx={{
                                        px: { xs: 2.5, md: 3 }, py: 2.5,
                                        borderRight: currentViewReport.achievements ? { md: '1px solid #f0f0f0' } : undefined,
                                        borderBottom: { xs: currentViewReport.achievements ? '1px solid #f0f0f0' : 'none', md: 'none' },
                                    }}>
                                        <Box sx={{ display: 'flex', alignItems: 'center', gap: 1, mb: 1.5 }}>
                                            <Box sx={{ width: 4, height: 18, bgcolor: '#c62828', borderRadius: 1, flexShrink: 0 }} />
                                            <Typography variant="subtitle1" fontWeight={700}>Risks</Typography>
                                        </Box>
                                        <Typography variant="body2" sx={{ whiteSpace: 'pre-wrap', lineHeight: 1.8, color: currentViewReport.risks ? 'text.primary' : 'text.secondary' }}>
                                            {currentViewReport.risks || 'None identified.'}
                                        </Typography>
                                    </Box>

                                    {currentViewReport.achievements && (
                                        <Box sx={{ px: { xs: 2.5, md: 3 }, py: 2.5 }}>
                                            <Box sx={{ display: 'flex', alignItems: 'center', gap: 1, mb: 1.5 }}>
                                                <Box sx={{ width: 4, height: 18, bgcolor: '#2e7d32', borderRadius: 1, flexShrink: 0 }} />
                                                <Typography variant="subtitle1" fontWeight={700}>Achievements</Typography>
                                            </Box>
                                            <Typography variant="body2" sx={{ whiteSpace: 'pre-wrap', lineHeight: 1.8 }}>{currentViewReport.achievements}</Typography>
                                        </Box>
                                    )}
                                </Box>
                            </Paper>

                            {/* Manager Insights */}
                            <Paper elevation={1} sx={{ px: { xs: 2, md: 3 }, py: 2.5, borderRadius: 2, mt: 2 }}>
                                <Box sx={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', mb: 1 }}>
                                    <Box sx={{ display: 'flex', alignItems: 'center', gap: 1 }}>
                                        <Box sx={{ width: 4, height: 18, bgcolor: '#9c27b0', borderRadius: 1, flexShrink: 0 }} />
                                        <Typography variant="subtitle1" fontWeight={700}>Manager Insights</Typography>
                                    </Box>
                                    {!isInsightsEditing && (
                                        <IconButton size="small" onClick={() => setIsInsightsEditing(true)} title="Edit insights">
                                            <EditIcon fontSize="small" />
                                        </IconButton>
                                    )}
                                </Box>
                                <Typography variant="caption" color="text.secondary" sx={{ display: 'block', mb: 1.5 }}>
                                    Add context not captured in Jira — blockers, customer feedback, delivery concerns.
                                </Typography>
                                {insightsSaveSuccess && <Alert severity="success" sx={{ mb: 1.5 }}>Saved successfully.</Alert>}
                                {insightsSaveError && <Alert severity="error" sx={{ mb: 1.5 }} onClose={() => setInsightsSaveError('')}>{insightsSaveError}</Alert>}
                                {isInsightsEditing ? (
                                    <>
                                        <TextField
                                            multiline minRows={3} maxRows={8} fullWidth variant="outlined" size="small"
                                            placeholder="Enter observations, customer concerns, delivery blockers not in Jira..."
                                            value={insightsText}
                                            onChange={(e) => setInsightsText(e.target.value)}
                                            sx={{ mb: 1.5 }}
                                        />
                                        <Box sx={{ display: 'flex', gap: 1, flexWrap: 'wrap' }}>
                                            <Button variant="contained" color="secondary" size="small"
                                                startIcon={isInsightsSaving ? <CircularProgress size={14} color="inherit" /> : <SaveIcon />}
                                                onClick={handleSaveInsights}
                                                disabled={isInsightsSaving || isInsightsRefreshing || !insightsText.trim()}>
                                                Save Insights
                                            </Button>
                                            <Button variant="outlined" color="secondary" size="small"
                                                startIcon={isInsightsRefreshing ? <CircularProgress size={14} color="inherit" /> : <AutorenewIcon />}
                                                onClick={handleRefreshSummary}
                                                disabled={isInsightsSaving || isInsightsRefreshing || !insightsText.trim()}>
                                                Refresh Summary
                                            </Button>
                                            <Button variant="text" size="small"
                                                onClick={() => { setIsInsightsEditing(false); setInsightsText(currentViewReport?.managerInsights || ''); setInsightsSaveError(''); }}
                                                disabled={isInsightsSaving || isInsightsRefreshing}>
                                                Cancel
                                            </Button>
                                        </Box>
                                    </>
                                ) : (
                                    <Typography variant="body2" sx={{ whiteSpace: 'pre-line', lineHeight: 1.8, color: insightsText ? 'text.primary' : 'text.disabled', fontStyle: insightsText ? 'normal' : 'italic' }}>
                                        {insightsText || 'No manager insights added yet. Click the edit icon to add context.'}
                                    </Typography>
                                )}
                            </Paper>
                        </Box>
                    )}
                </Box>

                {/* RIGHT — recent reports list (300px) */}
                {selectedProject && (
                    <Box sx={{ width: { xs: '100%', md: 300 }, flexShrink: 0, maxWidth: '100%' }}>
                        <Paper sx={{ overflow: 'hidden' }}>
                            <Box sx={{
                                px: 2.5, py: 1.5,
                                background: 'linear-gradient(180deg, #f8fafc 0%, #fff 100%)',
                                borderBottom: '1px solid #e2e8f0',
                                display: 'flex', alignItems: 'center', gap: 1.25,
                            }}>
                                <Box sx={{ width: 4, height: 22, bgcolor: 'primary.main', borderRadius: 0.5, flexShrink: 0 }} />
                                <Typography sx={{ fontSize: 13, fontWeight: 700, color: '#0f172a', flex: 1 }}>Recent Reports</Typography>
                            </Box>

                            {/* Health filter */}
                            <Box sx={{ px: 2, py: 1, borderBottom: '1px solid #f1f5f9', display: 'flex', alignItems: 'center', gap: 1 }}>
                                <Typography sx={{ fontSize: 11, color: '#94a3b8', fontWeight: 600, textTransform: 'uppercase', letterSpacing: 0.5, flexShrink: 0 }}>Filter</Typography>
                                <TextField
                                    select size="small" value={statusFilter}
                                    onChange={e => { setStatusFilter(e.target.value); setPage(1); }}
                                    sx={{ flex: 1, '& .MuiInputBase-input': { fontSize: 12, py: 0.75 } }}
                                    variant="outlined"
                                >
                                    <MenuItem value="All">All</MenuItem>
                                    <MenuItem value="Green">Green</MenuItem>
                                    <MenuItem value="Amber">Amber</MenuItem>
                                    <MenuItem value="Red">Red</MenuItem>
                                </TextField>
                            </Box>

                            {reports.length === 0 && !loading && (
                                <Box sx={{ px: 2, py: 2 }}>
                                    <Typography sx={{ fontSize: 13, color: '#94a3b8' }}>No reports found.</Typography>
                                </Box>
                            )}

                            {reports.map(report => {
                                const isActive = currentViewReport?.id === report.id;
                                return (
                                    <Box key={report.id} onClick={() => handleView(report)}
                                        sx={{
                                            px: 2, py: 1.5,
                                            borderBottom: '1px solid #f1f5f9',
                                            borderLeft: isActive ? '3px solid #4f46e5' : '3px solid transparent',
                                            bgcolor: isActive ? '#f5f3ff' : 'transparent',
                                            '&:hover': { bgcolor: isActive ? '#f5f3ff' : '#f8faff' },
                                            cursor: 'pointer',
                                            display: 'flex', alignItems: 'center', gap: 0.75,
                                        }}>
                                        <Box sx={{ flex: 1, minWidth: 0 }}>
                                            <Typography sx={{ fontSize: 13, fontWeight: 600, color: '#0f172a' }}>
                                                {dayjs().month(report.month - 1).format('MMMM')} {report.year}
                                            </Typography>
                                        </Box>
                                        <Chip label={report.status || '—'} color={getStatusColor(report.status)}
                                            size="small" sx={{ fontSize: 10, height: 20 }} />
                                        {!isLead && (
                                            <IconButton size="small" onClick={e => { e.stopPropagation(); handleRegenerate(report); }}>
                                                <AutorenewIcon sx={{ fontSize: 16 }} />
                                            </IconButton>
                                        )}
                                    </Box>
                                );
                            })}

                            {totalPages > 1 && (
                                <Box sx={{ display: 'flex', justifyContent: 'center', py: 1.5 }}>
                                    <Pagination count={totalPages} page={page}
                                        onChange={(_, p) => setPage(p)} color="primary" size="small" />
                                </Box>
                            )}
                        </Paper>
                    </Box>
                )}
            </Box>

            {/* GENERATE DIALOG */}
            <Dialog open={isGenerateDialogOpen} onClose={() => !genLoading && setIsGenerateDialogOpen(false)} maxWidth="sm" fullWidth>
                <DialogTitle>Generate New Report</DialogTitle>
                <DialogContent dividers>
                    {error && <Alert severity="error" sx={{ mb: 2 }}>{error}</Alert>}
                    <Box sx={{ display: 'flex', flexDirection: 'column', gap: 3, mt: 1 }}>
                        <Box sx={{ display: 'flex', gap: 2, flexWrap: 'wrap' }}>
                            <Box sx={{ flex: 1, minWidth: '200px' }}>
                                <DatePicker label="Month & Year" views={['year', 'month']}
                                    value={genDate} onChange={handleGenMonth}
                                    minDate={dayjs().subtract(6, 'M')} maxDate={dayjs()}
                                    slotProps={{ textField: { fullWidth: true, required: true, helperText: monthError, error: Boolean(monthError) } }} />
                            </Box>
                        </Box>
                    </Box>
                </DialogContent>
                <DialogActions>
                    <Button onClick={() => setIsGenerateDialogOpen(false)} disabled={genLoading}>Cancel</Button>
                    <Button onClick={handleGenerateSubmit} variant="contained" disabled={genLoading || !genDate || Boolean(monthError)}>
                        {genLoading ? <CircularProgress size={24} /> : "Generate"}
                    </Button>
                </DialogActions>
            </Dialog>

            {/* Summary Preview Dialog */}
            <Dialog open={insightsPreviewOpen} onClose={() => !isInsightsAccepting && setInsightsPreviewOpen(false)} maxWidth="md" fullWidth>
                <DialogTitle>Work Summary Preview</DialogTitle>
                <DialogContent dividers>
                    <Typography variant="body2" color="text.secondary" sx={{ mb: 2 }}>
                        Review the proposed work summary before accepting. It incorporates your manager insights.
                    </Typography>
                    <Box sx={{ display: 'grid', gridTemplateColumns: isMobile ? '1fr' : '1fr 1fr', gap: 2 }}>
                        <Box>
                            <Typography variant="subtitle2" color="text.secondary" gutterBottom>Current Summary</Typography>
                            <Card variant="outlined" sx={{ p: 2, bgcolor: '#f5f5f5', minHeight: 120 }}>
                                <Typography variant="body2" sx={{ whiteSpace: 'pre-line' }}>{localWorkSummary || 'No current summary.'}</Typography>
                            </Card>
                        </Box>
                        <Box>
                            <Typography variant="subtitle2" color="success.main" gutterBottom>Proposed (with your insights)</Typography>
                            <Card variant="outlined" sx={{ p: 2, bgcolor: '#f0fff4', border: '1px solid #4caf50', minHeight: 120 }}>
                                <Typography variant="body2" sx={{ whiteSpace: 'pre-line' }}>{proposedSummary}</Typography>
                            </Card>
                        </Box>
                    </Box>
                </DialogContent>
                <DialogActions>
                    <Button onClick={() => setInsightsPreviewOpen(false)} disabled={isInsightsAccepting}>Cancel</Button>
                    <Button variant="contained" color="success" onClick={handleAcceptSummary} disabled={isInsightsAccepting}
                        startIcon={isInsightsAccepting ? <CircularProgress size={16} color="inherit" /> : undefined}>
                        Accept & Save
                    </Button>
                </DialogActions>
            </Dialog>

        </Box>
    );
};
