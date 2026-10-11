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
    Accordion,
    AccordionSummary,
    AccordionDetails,
} from '@mui/material';
import ExpandMoreIcon from '@mui/icons-material/ExpandMore';
import {
    useAccountWeeklyReports,
    useGenerateAccountWeeklyReport,
    useDownloadAccountWeeklyReport,
} from './hooks';
import { useAcceptInsights, usePreviewInsights } from '../daily/hooks';
import { useAuth } from '../../../context/AuthContext';
import DownloadIcon from '@mui/icons-material/Download';
import AutorenewIcon from '@mui/icons-material/Autorenew';
import AddIcon from '@mui/icons-material/Add';
import EditIcon from '@mui/icons-material/Edit';
import SaveIcon from '@mui/icons-material/Save';
import { DatePicker } from '@mui/x-date-pickers/DatePicker';
import dayjs, { Dayjs } from 'dayjs';
import utc from 'dayjs/plugin/utc';
import timezone from 'dayjs/plugin/timezone';
import ReportCompletenessBanner from '../shared/ReportCompletenessBanner';
import type { Account } from '../../admin/accounts/types';

dayjs.extend(utc);
dayjs.extend(timezone);

const DAY_NAMES = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'];

interface AccountWeeklyReportProps {
    accounts: Account[];
    selectedAccount?: Account | null;
}

export const AccountWeeklyReport = ({ accounts, selectedAccount: propAccount }: AccountWeeklyReportProps) => {
    const { user } = useAuth();

    // Filters & Pagination State
    const [selectedAccount, setSelectedAccount] = useState<string>(propAccount?.id ? String(propAccount.id) : '');
    const [healthFilter, setHealthFilter] = useState<string>('All');
    const [page, setPage] = useState<number>(1);
    const limit = 10;

    // Reports Data State
    const [error, setError] = useState('');
    const [successMessage, setSuccessMessage] = useState('');

    const generateAccountMutation = useGenerateAccountWeeklyReport();
    const downloadAccountMutation = useDownloadAccountWeeklyReport();
    const acceptInsightsMutation = useAcceptInsights();
    const previewInsightsMutation = usePreviewInsights();

    const accForQuery = selectedAccount
        ? accounts.find(a => a.name === selectedAccount || parseInt(String(a.id)) === parseInt(selectedAccount))
        : null;
    const accountWeeklyQuery = useAccountWeeklyReports(
        accForQuery ? parseInt(String(accForQuery.id)) : 0,
        page,
        limit,
        undefined,
        healthFilter,
    );
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const reports: any[] = accForQuery
        ? (accountWeeklyQuery.data?.reports ?? []).map((r) => ({ ...r, isMissing: false }))
        : [];
    const loading = !!accForQuery && accountWeeklyQuery.isFetching;
    const totalPages = accForQuery ? (accountWeeklyQuery.data?.totalPages ?? 1) : 1;

    // Inline selected report
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const [currentViewReport, setCurrentViewReport] = useState<any | null>(null);

    // Manager Insights state (account level)
    const [accountInsightsText, setAccountInsightsText] = useState<string>('');
    const [isInsightsEditing, setIsInsightsEditing] = useState(false);
    const [isInsightsSaving, setIsInsightsSaving] = useState(false);
    const [isInsightsRefreshing, setIsInsightsRefreshing] = useState(false);
    const [insightsSaveSuccess, setInsightsSaveSuccess] = useState(false);
    const [insightsSaveError, setInsightsSaveError] = useState('');
    const [localAccountSummary, setLocalAccountSummary] = useState<string>('');
    const [insightsPreviewOpen, setInsightsPreviewOpen] = useState(false);
    const [proposedAccountSummary, setProposedAccountSummary] = useState('');
    const [isInsightsAccepting, setIsInsightsAccepting] = useState(false);

    // Generate Form State — default to the most recent complete week of the selected account's
    // configured cycle (Account.weekStartDay; defaults to Friday when no account is selected yet).
    const weekStartDay = accForQuery?.weekStartDay ?? 5;
    const expectedEndDayOfWeek = (weekStartDay + 6) % 7;
    const [isGenerateDialogOpen, setIsGenerateDialogOpen] = useState(false);
    const [dateError, setDateError] = useState('');
    const [startDate, setStartDate] = useState<Dayjs | null>(null);
    const [endDate, setEndDate] = useState<Dayjs | null>(null);
    const [startDateError, setStartDateError] = useState('');
    const [endDateError, setEndDateError] = useState('');
    const _awrToday = dayjs();
    const _awrDiffToFriday = ((_awrToday.day() - weekStartDay + 7) % 7) + 7;
    const [genStartDate, setGenStartDate] = useState<Dayjs | null>(_awrToday.subtract(_awrDiffToFriday, 'day'));
    const [genEndDate, setGenEndDate] = useState<Dayjs | null>(_awrToday.subtract(_awrDiffToFriday, 'day').add(6, 'day'));
    const [genLoading, setGenLoading] = useState(false);

    const CUTOFF_DATE = dayjs().subtract(21, 'day');

    // Sync global account selection
    useEffect(() => {
        if (propAccount?.id) setSelectedAccount(String(propAccount.id));
    }, [propAccount?.id]);

    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const handleView = (report: any) => {
        setCurrentViewReport(report);
        setAccountInsightsText(report.managerInsights || '');
        setLocalAccountSummary(report.summary || '');
        setIsInsightsEditing(false);
        setInsightsSaveSuccess(false);
        setInsightsSaveError('');
    };

    // Surface query errors
    useEffect(() => {
        if (accountWeeklyQuery.isError) {
            const err = accountWeeklyQuery.error;
            const errorWithResponse = err as { response?: { data?: { error?: string } }; message?: string };
            setError(errorWithResponse?.response?.data?.error || errorWithResponse?.message || 'Failed to fetch report.');
        }
    }, [accountWeeklyQuery.isError, accountWeeklyQuery.error]);

    // Auto-select first report when list updates
    useEffect(() => {
        if (!selectedAccount) { setCurrentViewReport(null); return; }
        if (reports.length > 0) handleView(reports[0]);
        else setCurrentViewReport(null);
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [selectedAccount, accountWeeklyQuery.dataUpdatedAt]);

    const StartDateHandler = (startDate: dayjs.Dayjs | null) => {
        setDateError('');
        if (startDate && startDate.isValid()) {
            setStartDate(startDate);
            if (startDate && dayjs(startDate).isAfter(dayjs())) {
                setStartDateError('Date cannot be future.');
            } else if (startDate && dayjs(startDate).isBefore(dayjs().subtract(21, 'day'))) {
                setStartDateError('Date not valid.');
            } else {
                setGenStartDate(startDate);
                setStartDateError('');
            }
        } else if (!startDate) {
            setStartDate(null);
            setStartDateError('Start Date is required.');
        }
        return startDate;
    }

    const EndDateHandler = (endDate: dayjs.Dayjs | null) => {
        setDateError('');
        if (endDate && endDate.isValid()) {
            setEndDate(endDate);
            if (endDate && dayjs(endDate).isAfter(dayjs())) {
                setEndDateError('Date cannot be future.');
            } else if (endDate && dayjs(endDate).isBefore(dayjs().subtract(21, 'day'))) {
                setEndDateError('Date not valid.');
            } else {
                setGenEndDate(endDate);
                setEndDateError('');
            }
        } else if (!endDate) {
            setEndDate(null);
            setEndDateError('End Date is required.');
        }
        return endDate;
    }

    const handleGenerateSubmit = async () => {
        setError('');
        setSuccessMessage('');

        if (!selectedAccount || !genStartDate || !genEndDate) {
            setDateError('Account, Start Date, and End Date are required.');
            return;
        }

        if (genStartDate.isBefore(CUTOFF_DATE)) {
            setDateError(`Cannot generate reports for dates prior to the system cut-off (${CUTOFF_DATE.format('DD MMM YYYY')}).`);
            return;
        }

        if (genStartDate.isAfter(genEndDate, 'day')) {
            setDateError('Start Date cannot be after End Date.');
            return;
        }

        if (genStartDate.day() !== weekStartDay) {
            setStartDateError(`Start date must be a ${DAY_NAMES[weekStartDay]}.`);
            return;
        }

        if (genEndDate.day() !== expectedEndDayOfWeek) {
            setEndDateError(`End date must be a ${DAY_NAMES[expectedEndDayOfWeek]}.`);
            return;
        }

        setGenLoading(true);
        try {
            const acc = accounts.find(a => a.name === selectedAccount || parseInt(String(a.id)) === parseInt(selectedAccount));
            if (!acc) throw new Error('Invalid Account selected');

            const startStr = genStartDate.format('YYYY-MM-DD');
            const endStr = genEndDate.format('YYYY-MM-DD');

            const data = await generateAccountMutation.mutateAsync({ accountId: acc.id, startDate: startStr, endDate: endStr, force: true });

            if (data?.isAsync) {
                setSuccessMessage(data.message);
                setIsGenerateDialogOpen(false);
            } else {
                setSuccessMessage('Report generated successfully!');
                setIsGenerateDialogOpen(false);
            }
        } catch (err) {
            const errorWithResponse = err as { response?: { data?: { error?: string } }; message?: string };
            setDateError(errorWithResponse?.response?.data?.error || errorWithResponse?.message || 'Failed to generate report.');
        } finally {
            setGenLoading(false);
        }
    };

    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const handleRegenerate = async (report: any) => {
        setError('');
        setSuccessMessage('');
        try {
            const data = await generateAccountMutation.mutateAsync({ accountId: report.accountId, startDate: report.startDate, endDate: report.endDate, force: true });
            if (data?.isAsync) {
                setSuccessMessage(`Regeneration queued for Week ${report.weekNumber} (${report.startDate} to ${report.endDate}).`);
            } else {
                setSuccessMessage('Report regenerated successfully!');
            }
        } catch (err) {
            const errorWithResponse = err as { response?: { data?: { error?: string } }; message?: string };
            setError(errorWithResponse?.response?.data?.error || errorWithResponse?.message || 'Failed to regenerate report.');
        }
    };

    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const handleDownload = async (report: any) => {
        try {
            await downloadAccountMutation.mutateAsync({ accountId: report.accountId, weekNumber: report.weekNumber, year: report.year });
        } catch (err) {
            console.error('Download failed', err);
            setError('Failed to trigger download.');
        }
    };

    const handleSaveAccountInsights = async () => {
        if (!currentViewReport?.id) return;
        setIsInsightsSaving(true);
        setInsightsSaveError('');
        setInsightsSaveSuccess(false);
        try {
            await acceptInsightsMutation.mutateAsync({ reportType: 'weekly_account', id: currentViewReport.id, insights: accountInsightsText, newSummary: localAccountSummary });
            setIsInsightsEditing(false);
            setInsightsSaveSuccess(true);
            setTimeout(() => setInsightsSaveSuccess(false), 3000);
        } catch (err) {
            const errorWithResponse = err as { response?: { data?: { error?: string } }; message?: string };
            setInsightsSaveError(errorWithResponse?.response?.data?.error || errorWithResponse?.message || 'Failed to save insights.');
        } finally {
            setIsInsightsSaving(false);
        }
    };

    const handleRefreshAccountSummary = async () => {
        if (!currentViewReport?.id || !accountInsightsText.trim()) return;
        setIsInsightsRefreshing(true);
        setInsightsSaveError('');
        try {
            const result = await previewInsightsMutation.mutateAsync({ reportType: 'weekly_account', id: currentViewReport.id, insights: accountInsightsText });
            setProposedAccountSummary(result.newSummary);
            setInsightsPreviewOpen(true);
        } catch (err) {
            const errorWithResponse = err as { response?: { data?: { error?: string } }; message?: string };
            setInsightsSaveError(errorWithResponse?.response?.data?.error || errorWithResponse?.message || 'Failed to generate refreshed summary.');
        } finally {
            setIsInsightsRefreshing(false);
        }
    };

    const handleAcceptAccountSummary = async () => {
        if (!currentViewReport?.id) return;
        setIsInsightsAccepting(true);
        try {
            await acceptInsightsMutation.mutateAsync({ reportType: 'weekly_account', id: currentViewReport.id, insights: accountInsightsText, newSummary: proposedAccountSummary });
            setLocalAccountSummary(proposedAccountSummary);
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

    const getStatusColor = (status: string) => {
        switch (status?.toLowerCase()) {
            case 'green': return 'success';
            case 'amber': return 'warning';
            case 'red': return 'error';
            default: return 'default';
        }
    };

    const isAccountRestricted = selectedAccount
        ? accounts.find(a => a.name === selectedAccount || parseInt(String(a.id)) === parseInt(selectedAccount))?.hasFullAccess === false
        : false;

    return (
        <Box>
            {error && <Alert severity="error" sx={{ mb: 2 }} onClose={() => setError('')}>{error}</Alert>}
            {successMessage && <Alert severity="success" sx={{ mb: 2 }} onClose={() => setSuccessMessage('')}>{successMessage}</Alert>}

            {/* Compact filter row */}
            <Box sx={{ display: 'flex', gap: 2, mb: 3, alignItems: 'center', flexWrap: 'wrap' }}>
                {!propAccount && (
                    <TextField
                        select size="small" label="Select Account" value={selectedAccount}
                        onChange={e => { setSelectedAccount(e.target.value); setPage(1); }}
                        sx={{ minWidth: 180 }}
                    >
                        <MenuItem value=""><em>None Selected</em></MenuItem>
                        {accounts.map(acc => (
                            <MenuItem key={acc.id} value={acc.id}>
                                {acc.hasFullAccess === false ? `${acc.name} (View Only)` : acc.name}
                            </MenuItem>
                        ))}
                    </TextField>
                )}
                <Box sx={{ flex: 1 }} />
                <Button
                    variant="contained"
                    startIcon={<AddIcon />}
                    onClick={() => {
                        setIsGenerateDialogOpen(true);
                        setStartDate(_awrToday.subtract(_awrDiffToFriday, 'day'));
                        setEndDate(_awrToday.subtract(_awrDiffToFriday, 'day').add(6, 'day'));
                        setStartDateError('');
                        setEndDateError('');
                        setDateError('')
                    }}
                    disabled={!selectedAccount || isAccountRestricted}
                >
                    Generate New Report
                </Button>
            </Box>

            {user?.role !== 'SUPERUSER' && (
                <Typography variant="caption" color="textSecondary" sx={{ mb: 2, display: 'block' }}>
                    * Note: You can view and download account-level reports for any account you have access to. Generating reports requires full access to all projects in the account.
                </Typography>
            )}

            {loading ? (
                <Box sx={{ display: 'flex', justifyContent: 'center', p: 4 }}>
                    <CircularProgress />
                </Box>
            ) : (
                <Box sx={{
                    display: 'flex', gap: 3, alignItems: 'flex-start', flexDirection: { xs: 'column', md: 'row' },
                    width: '100%',
                }}>
                    {/* LEFT — inline report content */}
                    <Box sx={{ flex: 1, minWidth: 0 }}>
                        {!selectedAccount && (
                            <Box sx={{ textAlign: 'center', py: 8 }}>
                                <Typography color="text.secondary">Please select an account to view reports.</Typography>
                            </Box>
                        )}
                        {selectedAccount && !currentViewReport && (
                            <Box sx={{ textAlign: 'center', py: 8 }}>
                                <Typography color="text.secondary">No reports found. Generate one to get started.</Typography>
                            </Box>
                        )}
                        {currentViewReport && (
                            <>
                                {/* Health chip + Download PPT */}
                                <Box sx={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', mb: 2.5 }}>
                                    <Chip
                                        label={currentViewReport.health || 'Unknown'}
                                        color={getStatusColor(currentViewReport.health)}
                                        sx={{ fontWeight: 700 }}
                                    />
                                    <Button variant="outlined" size="small" startIcon={<DownloadIcon />}
                                        onClick={() => handleDownload(currentViewReport)} disabled={!currentViewReport.filePath}>
                                        Download PPT
                                    </Button>
                                </Box>

                                <ReportCompletenessBanner projectsMissing={currentViewReport.projectsMissing} />

                                {/* Hero Paper: Executive Summary top full-width, Risks + Accomplishments 50/50 below */}
                                <Paper elevation={2} sx={{ borderRadius: 2, overflow: 'hidden' }}>
                                    <Box sx={{ px: { xs: 2.5, md: 3.5 }, pt: 3, pb: 2.5 }}>
                                        <Box sx={{ display: 'flex', alignItems: 'center', gap: 1, mb: 1.5 }}>
                                            <Box sx={{ width: 4, height: 18, bgcolor: '#1976d2', borderRadius: 1, flexShrink: 0 }} />
                                            <Typography variant="subtitle1" fontWeight={700}>Executive Summary</Typography>
                                        </Box>
                                        <Typography variant="body2" sx={{ whiteSpace: 'pre-wrap', lineHeight: 1.9, color: 'text.primary' }}>
                                            {localAccountSummary || 'No summary available.'}
                                        </Typography>
                                    </Box>

                                    <Divider />

                                    <Box sx={{ display: 'grid', gridTemplateColumns: { xs: '1fr', md: '1fr 1fr' } }}>
                                        {/* Key Risks & Red Projects */}
                                        <Box sx={{
                                            px: { xs: 2.5, md: 3 }, py: 2.5,
                                            borderRight: { md: '1px solid #f0f0f0' },
                                            borderBottom: { xs: '1px solid #f0f0f0', md: 'none' },
                                        }}>
                                            <Box sx={{ display: 'flex', alignItems: 'center', gap: 1, mb: 1.5 }}>
                                                <Box sx={{ width: 4, height: 18, bgcolor: '#c62828', borderRadius: 1, flexShrink: 0 }} />
                                                <Typography variant="subtitle1" fontWeight={700}>Key Risks & Red Projects</Typography>
                                            </Box>
                                            {currentViewReport.redProjects && currentViewReport.redProjects.length > 0 && (
                                                <Box sx={{ mb: 1.5, p: 1.5, border: '1px solid', borderColor: 'error.light', borderRadius: 1, bgcolor: '#fff5f5' }}>
                                                    <Typography variant="caption" color="error" fontWeight={700} sx={{ display: 'block', mb: 0.5 }}>Projects in RED Status</Typography>
                                                    <Box sx={{ display: 'flex', flexWrap: 'wrap', gap: 0.5 }}>
                                                        {currentViewReport.redProjects.map((p: string, i: number) => (
                                                            <Chip key={i} label={p} size="small" color="error" variant="outlined" sx={{ fontSize: '0.72rem' }} />
                                                        ))}
                                                    </Box>
                                                </Box>
                                            )}
                                            {currentViewReport.risks ? (
                                                <Box>
                                                    {(!Array.isArray(currentViewReport.risks) && typeof currentViewReport.risks === 'object') && currentViewReport.risks.summary && (
                                                        <Typography variant="body2" sx={{ mb: 1, fontWeight: 600 }}>{currentViewReport.risks.summary}</Typography>
                                                    )}
                                                    {(() => {
                                                        let items: string[] = [];
                                                        if (!Array.isArray(currentViewReport.risks) && typeof currentViewReport.risks === 'object') {
                                                            items = currentViewReport.risks.items || [];
                                                        } else if (Array.isArray(currentViewReport.risks)) {
                                                            items = currentViewReport.risks;
                                                        } else if (typeof currentViewReport.risks === 'string') {
                                                            items = currentViewReport.risks.split('\n');
                                                        }
                                                        return items.map((line: string, i: number) => {
                                                            const cleanLine = line.replace(/[\u{1F300}-\u{1F9FF}\u{2600}-\u{26FF}\u{2700}-\u{27BF}]/gu, '')
                                                                .replace(/^[\s*\-•]+/, '').replace(/\*\*/g, '').trim();
                                                            if (!cleanLine) return null;
                                                            return (
                                                                <Box key={i} sx={{ display: 'flex', gap: 1, mb: 0.75, alignItems: 'flex-start' }}>
                                                                    <Box sx={{ width: 5, height: 5, borderRadius: '50%', bgcolor: '#c62828', mt: '6px', flexShrink: 0 }} />
                                                                    <Typography variant="body2" sx={{ lineHeight: 1.7 }}>{cleanLine}</Typography>
                                                                </Box>
                                                            );
                                                        });
                                                    })()}
                                                </Box>
                                            ) : <Typography variant="body2" color="text.secondary">None identified.</Typography>}
                                        </Box>

                                        {/* Key Accomplishments */}
                                        <Box sx={{ px: { xs: 2.5, md: 3 }, py: 2.5 }}>
                                            <Box sx={{ display: 'flex', alignItems: 'center', gap: 1, mb: 1.5 }}>
                                                <Box sx={{ width: 4, height: 18, bgcolor: '#2e7d32', borderRadius: 1, flexShrink: 0 }} />
                                                <Typography variant="subtitle1" fontWeight={700}>Key Accomplishments</Typography>
                                            </Box>
                                            {currentViewReport.keyAccomplishments ? (
                                                <Box>
                                                    {(Array.isArray(currentViewReport.keyAccomplishments)
                                                        ? currentViewReport.keyAccomplishments
                                                        : currentViewReport.keyAccomplishments.split('\n')
                                                    ).map((line: string, i: number) => {
                                                        const cleanLine = line.replace(/^[-•*]\s*/, '').trim();
                                                        if (!cleanLine) return null;
                                                        return (
                                                            <Box key={i} sx={{ display: 'flex', gap: 1, mb: 0.75, alignItems: 'flex-start' }}>
                                                                <Box sx={{ width: 5, height: 5, borderRadius: '50%', bgcolor: '#2e7d32', mt: '6px', flexShrink: 0 }} />
                                                                <Typography variant="body2" sx={{ lineHeight: 1.7 }}>{cleanLine}</Typography>
                                                            </Box>
                                                        );
                                                    })}
                                                </Box>
                                            ) : <Typography variant="body2" color="text.secondary">None</Typography>}
                                        </Box>
                                    </Box>
                                </Paper>

                                {/* Manager Insights */}
                                <Paper elevation={1} sx={{ px: { xs: 2, md: 3 }, py: 2.5, borderRadius: 2, mt: 2 }}>
                                    <Box sx={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', mb: 1 }}>
                                        <Box sx={{ display: 'flex', alignItems: 'center', gap: 1 }}>
                                            <Box sx={{ width: 4, height: 18, bgcolor: '#9c27b0', borderRadius: 1, flexShrink: 0 }} />
                                            <Typography variant="subtitle1" fontWeight={700}>Manager Insights</Typography>
                                        </Box>
                                        {!isInsightsEditing && !isAccountRestricted && (
                                            <IconButton size="small" onClick={() => setIsInsightsEditing(true)} title="Edit insights">
                                                <EditIcon fontSize="small" />
                                            </IconButton>
                                        )}
                                    </Box>
                                    <Typography variant="caption" color="text.secondary" sx={{ display: 'block', mb: 1.5 }}>
                                        {isAccountRestricted
                                            ? 'View only — editing insights requires full account access.'
                                            : 'Account-level context collated from project insights. Add or refine to capture escalations and cross-project concerns.'}
                                    </Typography>
                                    {insightsSaveSuccess && <Alert severity="success" sx={{ mb: 1.5 }}>Saved successfully.</Alert>}
                                    {insightsSaveError && <Alert severity="error" sx={{ mb: 1.5 }} onClose={() => setInsightsSaveError('')}>{insightsSaveError}</Alert>}
                                    {isInsightsEditing && !isAccountRestricted ? (
                                        <>
                                            <TextField
                                                multiline minRows={3} maxRows={8} fullWidth variant="outlined" size="small"
                                                placeholder="Enter account-level observations, cross-project concerns, customer escalations..."
                                                value={accountInsightsText}
                                                onChange={(e) => setAccountInsightsText(e.target.value)}
                                                sx={{ mb: 1.5 }}
                                            />
                                            <Box sx={{ display: 'flex', gap: 1, flexWrap: 'wrap' }}>
                                                <Button variant="contained" color="secondary" size="small"
                                                    startIcon={isInsightsSaving ? <CircularProgress size={14} color="inherit" /> : <SaveIcon />}
                                                    onClick={handleSaveAccountInsights}
                                                    disabled={isInsightsSaving || isInsightsRefreshing || !accountInsightsText.trim()}>
                                                    Save Insights
                                                </Button>
                                                <Button variant="outlined" color="secondary" size="small"
                                                    startIcon={isInsightsRefreshing ? <CircularProgress size={14} color="inherit" /> : <AutorenewIcon />}
                                                    onClick={handleRefreshAccountSummary}
                                                    disabled={isInsightsSaving || isInsightsRefreshing || !accountInsightsText.trim()}>
                                                    Refresh Summary
                                                </Button>
                                                <Button variant="text" size="small"
                                                    onClick={() => { setIsInsightsEditing(false); setAccountInsightsText(currentViewReport?.managerInsights || ''); setInsightsSaveError(''); }}
                                                    disabled={isInsightsSaving || isInsightsRefreshing}>
                                                    Cancel
                                                </Button>
                                            </Box>
                                        </>
                                    ) : (
                                        <Typography variant="body1" sx={{ whiteSpace: 'pre-line', lineHeight: 1.7, fontSize: '1rem', fontWeight: 500, color: accountInsightsText ? '#1a1a1a' : 'text.disabled', fontStyle: accountInsightsText ? 'normal' : 'italic' }}>
                                            {accountInsightsText || ('No manager insights added yet.' + (isAccountRestricted ? '' : ' Click the edit icon to add context.'))}
                                        </Typography>
                                    )}
                                </Paper>

                                {/* Action Items accordion */}
                                {currentViewReport.actionItems && currentViewReport.actionItems.length > 0 && (
                                    <Accordion defaultExpanded={false} elevation={1} sx={{ mt: 2, borderRadius: '8px !important', '&:before': { display: 'none' } }}>
                                        <AccordionSummary expandIcon={<ExpandMoreIcon />} sx={{ px: { xs: 2, md: 3 }, py: 1.5, minHeight: 0, '& .MuiAccordionSummary-content': { my: 0 } }}>
                                            <Box sx={{ display: 'flex', alignItems: 'center', gap: 1 }}>
                                                <Box sx={{ width: 4, height: 16, bgcolor: '#1976d2', borderRadius: 1, flexShrink: 0 }} />
                                                <Typography variant="subtitle1" fontWeight={700}>Recommended Action Items</Typography>
                                            </Box>
                                        </AccordionSummary>
                                        <AccordionDetails sx={{ px: { xs: 2, md: 3 }, pt: 0, pb: 3 }}>
                                            <Divider sx={{ mb: 2 }} />
                                            <Box>
                                                {currentViewReport.actionItems.map((item: string, i: number) => (
                                                    <Box key={i} sx={{ display: 'flex', gap: 1, mb: 0.75, alignItems: 'flex-start' }}>
                                                        <Box sx={{ width: 5, height: 5, borderRadius: '50%', bgcolor: '#1976d2', mt: '6px', flexShrink: 0 }} />
                                                        <Typography variant="body2" sx={{ lineHeight: 1.7 }}>{item}</Typography>
                                                    </Box>
                                                ))}
                                            </Box>
                                        </AccordionDetails>
                                    </Accordion>
                                )}

                                {/* Projects footer chip row */}
                                <Box sx={{ mt: 2.5, display: 'flex', alignItems: 'center', gap: 0.75, flexWrap: 'wrap' }}>
                                    <Box sx={{ display: 'flex', alignItems: 'center', gap: 0.75, mr: 0.5 }}>
                                        <Box sx={{ width: 4, height: 14, bgcolor: '#546e7a', borderRadius: 1, flexShrink: 0 }} />
                                        <Typography variant="caption" fontWeight={700} color="text.secondary" sx={{ letterSpacing: 0.3, textTransform: 'uppercase', fontSize: '0.68rem' }}>
                                            Projects
                                        </Typography>
                                    </Box>
                                    {currentViewReport.projectsIncluded && currentViewReport.projectsIncluded.map((p: string) => (
                                        <Chip key={p} label={p} size="small" variant="outlined" sx={{ borderColor: '#b0bec5', color: 'text.secondary', fontSize: '0.75rem' }} />
                                    ))}
                                    {currentViewReport.projectsMissing && currentViewReport.projectsMissing.map((p: string) => (
                                        <Chip key={p} label={`${p} (Missing)`} size="small" color="error" variant="outlined" sx={{ fontSize: '0.75rem' }} />
                                    ))}
                                </Box>
                            </>
                        )}
                    </Box>

                    {/* RIGHT — 300px recent reports list */}
                    {selectedAccount && (
                        <Box sx={{ width: { xs: '100%', md: 300 }, flexShrink: 0, maxWidth: '100%' }}>
                            <Paper sx={{ overflow: 'hidden' }}>
                                {/* Card header */}
                                <Box sx={{
                                    px: 2.5, py: 1.75,
                                    background: 'linear-gradient(180deg, #f8fafc 0%, #fff 100%)',
                                    borderBottom: '1px solid #e2e8f0',
                                    display: 'flex', alignItems: 'center', gap: 1.25,
                                }}>
                                    <Box sx={{ width: 4, height: 22, bgcolor: 'primary.main', borderRadius: 0.5, flexShrink: 0 }} />
                                    <Typography sx={{ fontSize: 13, fontWeight: 700, color: '#0f172a' }}>Recent Reports</Typography>
                                </Box>

                                {/* Health filter */}
                                <Box sx={{ px: 2, py: 1, borderBottom: '1px solid #f1f5f9', display: 'flex', alignItems: 'center', gap: 1 }}>
                                    <Typography sx={{ fontSize: 11, color: '#94a3b8', fontWeight: 600, textTransform: 'uppercase', letterSpacing: 0.5, flexShrink: 0 }}>Filter</Typography>
                                    <TextField
                                        select size="small" value={healthFilter}
                                        onChange={e => { setHealthFilter(e.target.value); setPage(1); }}
                                        sx={{ flex: 1, '& .MuiInputBase-input': { fontSize: 12, py: 0.75 } }}
                                        variant="outlined"
                                    >
                                        <MenuItem value="All">All</MenuItem>
                                        <MenuItem value="Green">Green</MenuItem>
                                        <MenuItem value="Amber">Amber</MenuItem>
                                        <MenuItem value="Red">Red</MenuItem>
                                    </TextField>
                                </Box>

                                {reports.length === 0 ? (
                                    <Box sx={{ p: 3, textAlign: 'center' }}>
                                        <Typography variant="body2" color="text.secondary">No reports found.</Typography>
                                    </Box>
                                ) : (
                                    reports.map((report) => {
                                        const isActive = currentViewReport?.id === report.id;
                                        return (
                                            <Box
                                                key={report.id}
                                                onClick={() => handleView(report)}
                                                sx={{
                                                    px: 2, py: 1.5,
                                                    borderBottom: '1px solid #f1f5f9',
                                                    borderLeft: isActive ? '3px solid #4f46e5' : '3px solid transparent',
                                                    bgcolor: isActive ? '#f5f3ff' : 'transparent',
                                                    cursor: 'pointer',
                                                    display: 'flex', alignItems: 'center', gap: 1,
                                                    '&:hover': { bgcolor: isActive ? '#f5f3ff' : '#f8fafc' },
                                                }}
                                            >
                                                <Box sx={{ flex: 1, minWidth: 0 }}>
                                                    <Typography sx={{ fontSize: 13, fontWeight: 600, color: '#0f172a' }}>
                                                        Wk {report.weekNumber} / {report.year}
                                                    </Typography>
                                                    <Typography sx={{ fontSize: 11, color: '#94a3b8' }}>
                                                        {report.startDate} – {report.endDate}
                                                    </Typography>
                                                </Box>
                                                <Chip
                                                    label={report.health || 'Unknown'}
                                                    color={getStatusColor(report.health)}
                                                    size="small"
                                                    sx={{ fontWeight: 600 }}
                                                />
                                                <IconButton
                                                    size="small"
                                                    onClick={(e) => { e.stopPropagation(); handleRegenerate(report); }}
                                                    disabled={isAccountRestricted}
                                                    title="Regenerate"
                                                >
                                                    <AutorenewIcon fontSize="small" />
                                                </IconButton>
                                                <IconButton
                                                    size="small"
                                                    onClick={(e) => { e.stopPropagation(); handleDownload(report); }}
                                                    disabled={!report.filePath}
                                                    title="Download PPT"
                                                >
                                                    <DownloadIcon fontSize="small" />
                                                </IconButton>
                                            </Box>
                                        );
                                    })
                                )}

                                {totalPages > 1 && (
                                    <Box sx={{ display: 'flex', justifyContent: 'center', py: 1.5, borderTop: '1px solid #f1f5f9' }}>
                                        <Pagination
                                            count={totalPages}
                                            page={page}
                                            onChange={(_, newPage) => setPage(newPage)}
                                            size="small"
                                            color="primary"
                                        />
                                    </Box>
                                )}
                            </Paper>
                        </Box>
                    )}
                </Box>
            )}

            {/* GENERATE DIALOG */}
            <Dialog open={isGenerateDialogOpen} onClose={() => !genLoading && setIsGenerateDialogOpen(false)} maxWidth="sm" fullWidth>
                <DialogTitle>Generate New Report</DialogTitle>
                <DialogContent dividers>
                    {dateError && <Alert severity="error" sx={{ mb: 2 }}>{dateError}</Alert>}
                    <Box sx={{ display: 'flex', flexDirection: 'column', gap: 3, mt: 1 }}>
                        <Box sx={{ display: 'flex', gap: 2, flexWrap: 'wrap' }}>
                            <Box sx={{ flex: 1, minWidth: 200 }}>
                                <DatePicker
                                    label="Start Date"
                                    value={startDate}
                                    onChange={StartDateHandler}
                                    slotProps={{ textField: { fullWidth: true, required: true, helperText: startDateError, error: Boolean(startDateError) } }}
                                    maxDate={dayjs()}
                                    minDate={CUTOFF_DATE.add(1, 'day')}
                                />
                            </Box>
                            <Box sx={{ flex: 1, minWidth: 200 }}>
                                <DatePicker
                                    label="End Date"
                                    value={endDate}
                                    onChange={EndDateHandler}
                                    slotProps={{ textField: { fullWidth: true, required: true, helperText: endDateError, error: Boolean(endDateError) } }}
                                    maxDate={dayjs()}
                                    minDate={CUTOFF_DATE.add(1, 'day')}
                                />
                            </Box>
                        </Box>
                        <Typography variant="caption" color="textSecondary">
                            Note: You cannot generate reports for dates older than {CUTOFF_DATE.format('MMM DD, YYYY')}.
                            This account's report week runs {DAY_NAMES[weekStartDay]} to {DAY_NAMES[expectedEndDayOfWeek]}.
                        </Typography>
                    </Box>
                </DialogContent>
                <DialogActions>
                    <Button onClick={() => setIsGenerateDialogOpen(false)} disabled={genLoading}>Cancel</Button>
                    <Button onClick={handleGenerateSubmit} variant="contained" disabled={genLoading || !startDate || !endDate || Boolean(startDateError) || Boolean(endDateError) || Boolean(dateError)}>
                        {genLoading ? <CircularProgress size={24} /> : 'Generate'}
                    </Button>
                </DialogActions>
            </Dialog>

            {/* Account Summary Preview Dialog */}
            <Dialog open={insightsPreviewOpen} onClose={() => !isInsightsAccepting && setInsightsPreviewOpen(false)} maxWidth="md" fullWidth>
                <DialogTitle>Executive Summary Preview</DialogTitle>
                <DialogContent dividers>
                    <Typography variant="body2" color="text.secondary" sx={{ mb: 2 }}>
                        Review the proposed executive summary before accepting. The new summary incorporates your manager insights.
                    </Typography>
                    <Box sx={{ display: 'grid', gridTemplateColumns: { xs: '1fr', sm: '1fr 1fr' }, gap: 2 }}>
                        <Box>
                            <Typography variant="subtitle2" color="text.secondary" gutterBottom>Current Summary</Typography>
                            <Card variant="outlined" sx={{ p: 2, bgcolor: '#f5f5f5', minHeight: 120 }}>
                                <Typography variant="body2" sx={{ whiteSpace: 'pre-line' }}>{localAccountSummary || 'No current summary.'}</Typography>
                            </Card>
                        </Box>
                        <Box>
                            <Typography variant="subtitle2" color="success.main" gutterBottom>Proposed (with your insights)</Typography>
                            <Card variant="outlined" sx={{ p: 2, bgcolor: '#f0fff4', border: '1px solid #4caf50', minHeight: 120 }}>
                                <Typography variant="body2" sx={{ whiteSpace: 'pre-line' }}>{proposedAccountSummary}</Typography>
                            </Card>
                        </Box>
                    </Box>
                </DialogContent>
                <DialogActions>
                    <Button onClick={() => setInsightsPreviewOpen(false)} disabled={isInsightsAccepting}>Cancel</Button>
                    <Button variant="contained" color="success" onClick={handleAcceptAccountSummary} disabled={isInsightsAccepting}
                        startIcon={isInsightsAccepting ? <CircularProgress size={16} color="inherit" /> : undefined}>
                        Accept & Save
                    </Button>
                </DialogActions>
            </Dialog>
        </Box>
    );
};
