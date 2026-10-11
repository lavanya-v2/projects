/* eslint-disable @typescript-eslint/no-explicit-any */
import { useState, useEffect, useRef } from 'react';
import {
    Box,
    Button,
    TextField,
    MenuItem,
    CircularProgress,
    Alert,
    Paper,
    Typography,
    Link,
    Chip,
    Pagination,
    Dialog,
    DialogTitle,
    DialogContent,
    DialogActions,
    IconButton,
    Tooltip,
} from '@mui/material';
import { useFetchProjects } from '../../auth/hooks';
import { useDailyReports, useGenerateAsyncDailyReport } from './hooks';
import { useAuth } from '../../../context/AuthContext';
import { usePermissions } from '../../../shared/hooks/usePermissions';
import type { Project } from '../../../types';
import ArrowBackIcon from '@mui/icons-material/ArrowBack';
import AutorenewIcon from '@mui/icons-material/Autorenew';
import AddIcon from '@mui/icons-material/Add';
import { DatePicker } from '@mui/x-date-pickers/DatePicker';
import dayjs, { Dayjs } from 'dayjs';
import utc from 'dayjs/plugin/utc';
import timezone from 'dayjs/plugin/timezone';
import { ReportView } from '../../../shared/components/ReportView';
import type { Account } from '../../admin/accounts/types';
import type { User } from '../../admin/users/types';

dayjs.extend(utc);
dayjs.extend(timezone);

interface DailyReportProps {
    accounts: Account[];
    selectedAccount?: Account | null;
    initialProjectId?: number | null;
    onProjectSelected?: () => void;
    onBack?: () => void;
}

const formatReportForView = (report: any) => ({
    boardName: report.boardName,
    sprintBurndown: report.sprintBurndown || null,
    analysis: {
        health: report.overallHealth,
        executiveSummary: report.executiveSummary,
        executivePlan: report.executivePlan,
        keyRisks: report.executiveRisks,
        workSummary: report.workSummary,
        risks: report.executiveRisks,
        planForTomorrow: report.executivePlan,
        teamMembers: report.teamMembers,
        managerInsights: report.managerInsights || '',
        insightsHealth: report.insightsHealth || '',
        insightsHealthReason: report.insightsHealthReason || '',
        originalExecutiveSummary: report.originalExecutiveSummary || '',
        dataQualityFlags: report.dataQualityFlags || null,
        healthRationale: report.healthRationale || null,
        ticketDetails: report.ticketDetails || null,
        ticketKeys: report.ticketKeys ?? null,
        ticketDetailsStructured: report.ticketDetailsStructured ?? null,
        reportWindow: report.reportWindow ?? { start: report.date + ' 00:00:00', end: report.date + ' 23:59:59' },
        teamNotes: report.teamNotes || [],
    },
});

export const DailyReport = ({ accounts, selectedAccount: propAccount, initialProjectId, onProjectSelected, onBack }: DailyReportProps) => {
    const { user } = useAuth();
    const isLead = (user as User | null)?.roleName === 'lead';
    const { isMember } = usePermissions();

    // Filters & Pagination
    const [selectedAccount, setSelectedAccount] = useState<string>(propAccount?.id ? String(propAccount.id) : '');
    const [projectList, setProjectList] = useState<Project[]>([]);
    const [selectedProject, setSelectedProject] = useState<string>('');
    const [startDate, setStartDate] = useState<Dayjs | null>(dayjs().subtract(7, 'day'));
    const [endDate, setEndDate] = useState<Dayjs | null>(dayjs());
    const [showDateRange, setShowDateRange] = useState<boolean>(false);
    const [page, setPage] = useState<number>(1);
    const limit = 10;

    // Reports
    const [error, setError] = useState('');
    const [successMessage, setSuccessMessage] = useState('');

    const fetchProjects = useFetchProjects();
    const generateAsyncMutation = useGenerateAsyncDailyReport();

    const startStr = startDate ? startDate.format('YYYY-MM-DD') : undefined;
    const endStr = endDate ? endDate.format('YYYY-MM-DD') : undefined;
    const dailyQuery = useDailyReports({
        projectId: selectedProject ? parseInt(selectedProject) : 0,
        page,
        limit,
        startDate: startStr,
        endDate: endStr,
    });
    const reports: any[] = selectedProject ? (dailyQuery.data?.reports ?? []) : [];
    const loading = !!selectedProject && dailyQuery.isFetching;
    const totalPages = selectedProject ? (dailyQuery.data?.totalPages ?? 1) : 1;

    // Inline selected report (shown on the left)
    const [selectedReport, setSelectedReport] = useState<{ data: any; date: string; reportId: number } | null>(null);

    // Generate dialog
    const [isGenerateDialogOpen, setIsGenerateDialogOpen] = useState(false);
    const [genDate, setGenDate] = useState<Dayjs | null>(dayjs());
    const [dateError, setDateError] = useState('');
    const [genLoading, setGenLoading] = useState(false);
    const minAllowedDate = dayjs('2026-01-15');

    // Ref to prevent the account-change useEffect from clearing project during auto-select
    const skipProjectResetRef = useRef(false);

    // Sync global account selection
    useEffect(() => {
        if (propAccount?.id) setSelectedAccount(String(propAccount.id));
    }, [propAccount?.id]);

    // Auto-select project when navigated from dashboard (initialProjectId)
    useEffect(() => {
        if (!initialProjectId) return;
        const autoSelect = async () => {
            try {
                const allProjects: Project[] = await fetchProjects();
                const found = allProjects.find(p => p.id === initialProjectId);
                if (!found) return;
                const accountId = (found as any).accountId;
                if (accountId) {
                    const accProjects: Project[] = await fetchProjects(accountId);
                    skipProjectResetRef.current = true;
                    setSelectedAccount(String(accountId));
                    // Sprint-cadence projects report per-sprint (Board View), not daily.
                    setProjectList(accProjects.filter(p => (p as any).reportingFrequency !== 'sprint'));
                }
                setSelectedProject(String(initialProjectId));
                onProjectSelected?.();
            } catch (err) {
                console.error('Failed to auto-select project', err);
            }
        };
        autoSelect();
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [initialProjectId]);

    // Fetch projects when account changes
    useEffect(() => {
        const loadProjects = async () => {
            if (skipProjectResetRef.current) {
                skipProjectResetRef.current = false;
                return;
            }
            if (selectedAccount) {
                try {
                    const acc = accounts.find(a => a.name === selectedAccount || parseInt(String(a.id)) === parseInt(selectedAccount));
                    if (acc) {
                        const data = await fetchProjects(acc.id);
                        // Sprint-cadence projects report per-sprint (Board View), not daily.
                        setProjectList(data.filter(p => (p as any).reportingFrequency !== 'sprint'));
                    }
                } catch (err) {
                    console.error('Failed to fetch projects', err);
                }
            } else {
                setProjectList([]);
            }
            setSelectedProject('');
            setSelectedReport(null);
            setPage(1);
        };
        loadProjects();
    }, [selectedAccount, accounts]); // eslint-disable-line react-hooks/exhaustive-deps

    // Surface query errors
    useEffect(() => {
        if (dailyQuery.isError) {
            const err: any = dailyQuery.error;
            setError(err?.response?.data?.error || err?.message || 'Failed to fetch reports.');
        }
    }, [dailyQuery.isError, dailyQuery.error]);

    // Auto-select the most recent report when the list changes
    useEffect(() => {
        if (!selectedProject) { setSelectedReport(null); return; }
        if (reports.length > 0) {
            setSelectedReport({ data: formatReportForView(reports[0]), date: reports[0].date, reportId: reports[0].id });
        } else {
            setSelectedReport(null);
        }
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [selectedProject, dailyQuery.dataUpdatedAt]);

    const handleSelectReport = (report: any) => {
        setSelectedReport({ data: formatReportForView(report), date: report.date, reportId: report.id });
    };

    const handleClearFilter = () => {
        setStartDate(dayjs().subtract(7, 'day'));
        setEndDate(dayjs());
        setShowDateRange(false);
        setPage(1);
    };

    const handleGenerateSubmit = async () => {
        setError('');
        setSuccessMessage('');
        if (!selectedProject || !genDate) { setError('Project and Date are required.'); return; }
        setGenLoading(true);
        try {
            const p = projectList.find(proj => String(proj.id) === String(selectedProject));
            if (!p) throw new Error('Project not found');
            const response = await generateAsyncMutation.mutateAsync({ projectName: p.code, date: genDate.format('YYYY-MM-DD') });
            setSuccessMessage(response.message || 'Processing your request...');
            setIsGenerateDialogOpen(false);
        } catch (err: any) {
            setError(err.response?.data?.error || err.message || 'Failed to generate report.');
        } finally {
            setGenLoading(false);
        }
    };

    const handleRegenerate = async (report: any) => {
        setError('');
        setSuccessMessage('');
        try {
            const p = projectList.find(proj => String(proj.id) === String(selectedProject));
            if (!p) throw new Error('Project not found');
            setSuccessMessage(`Queuing regeneration for ${report.date}...`);
            const response = await generateAsyncMutation.mutateAsync({ projectName: p.code, date: report.date });
            setSuccessMessage(response.message || 'Processing your request...');
        } catch (err: any) {
            setError(err.response?.data?.error || err.message || 'Failed to regenerate report.');
        }
    };

    const Datehandler = (reportDate: dayjs.Dayjs | null) => {
        if (reportDate && reportDate.isValid()) {
            setGenDate(reportDate);
            if (reportDate && dayjs(reportDate).isAfter(dayjs())) {
                setDateError('Date cannot be future.');
            } else if (reportDate && dayjs(reportDate).isBefore(minAllowedDate)) {
                setDateError('Date not valid.');
            } else {
                setDateError('');
            }
        } else if (!reportDate) {
            setGenDate(null);
            setDateError('');
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

    const activeProject = projectList.find(p => String(p.id) === String(selectedProject));

    return (
        <Box>
            {onBack && (
                <Button
                    startIcon={<ArrowBackIcon />}
                    onClick={onBack}
                    size="small"
                    sx={{ mb: 1.5, color: '#475569', fontWeight: 600, textTransform: 'none', fontSize: 13 }}
                >
                    Back to Dashboard
                </Button>
            )}
            {/* Alerts */}
            {error && <Alert severity="error" sx={{ mb: 2 }} onClose={() => setError('')}>{error}</Alert>}
            {successMessage && <Alert severity="success" sx={{ mb: 2 }} onClose={() => setSuccessMessage('')}>{successMessage}</Alert>}

            {/* Compact filter row */}
            <Box sx={{ display: 'flex', gap: 2, mb: 3, alignItems: 'center', flexWrap: 'wrap' }}>
                {!propAccount && (
                    <TextField
                        select size="small" label="Account" value={selectedAccount}
                        onChange={e => setSelectedAccount(e.target.value)}
                        sx={{ width: { xs: '100%', sm: 180 } }}
                    >
                        <MenuItem value=""><em>Select account</em></MenuItem>
                        {accounts.map(acc => (
                            <MenuItem key={acc.id} value={acc.id} sx={acc.hasFullAccess === false ? { opacity: 0.8 } : {}}>
                                {acc.hasFullAccess === false ? `${acc.name} (Restricted)` : acc.name}
                            </MenuItem>
                        ))}
                    </TextField>
                )}
                <TextField
                    select size="small" label="Project" value={selectedProject}
                    onChange={e => { setSelectedProject(e.target.value); setPage(1); }}
                    disabled={!selectedAccount || projectList.length === 0}
                    sx={{ width: { xs: '100%', sm: 180 } }}
                >
                    <MenuItem value="" disabled>Select project</MenuItem>
                    {projectList.map(p => <MenuItem key={p.id} value={p.id}>{p.name}</MenuItem>)}
                </TextField>
                <Box sx={{ flex: 1, display: { xs: 'none', sm: 'block' } }} />
                {!isLead && !isMember && (
                    <Button
                        variant="contained" startIcon={<AddIcon />}
                        onClick={() => { setIsGenerateDialogOpen(true); setGenDate(dayjs()); setDateError(''); }}
                        disabled={!selectedProject}
                    >
                        Generate DSR
                    </Button>
                )}
            </Box>

            {/* Two-column body */}
            <Box sx={{
                display: 'flex', gap: 3, alignItems: 'flex-start', flexDirection: { xs: 'column', md: 'row' },
                width: '100%',
            }}>

                {/* LEFT — inline report viewer */}
                <Box sx={{ flex: 1, minWidth: 0 }}>
                    {!selectedProject && (
                        <Paper sx={{ p: 8, textAlign: 'center', border: '1px dashed #cbd5e1' }} elevation={0}>
                            <Typography sx={{ fontSize: 14, color: '#94a3b8' }}>
                                Select an account and project to view reports
                            </Typography>
                        </Paper>
                    )}
                    {selectedProject && loading && (
                        <Box sx={{ display: 'flex', justifyContent: 'center', p: 8 }}>
                            <CircularProgress />
                        </Box>
                    )}
                    {selectedProject && !loading && !selectedReport && (
                        <Paper sx={{ p: 8, textAlign: 'center', border: '1px dashed #cbd5e1' }} elevation={0}>
                            <Typography sx={{ fontSize: 14, color: '#94a3b8' }}>
                                No reports found for this period.
                            </Typography>
                        </Paper>
                    )}
                    {selectedReport && (
                        <ReportView
                            key={selectedReport.reportId}
                            data={{
                                ...(selectedReport.data.analysis ? selectedReport.data : { boardName: selectedReport.data.boardName, analysis: selectedReport.data }),
                                estimationType: activeProject?.estimationType,
                            }}
                            projectCode={activeProject?.code || ''}
                            projectName={activeProject?.name || 'Project'}
                            date={selectedReport.date}
                            type="daily"
                            reportId={selectedReport.reportId}
                            isLead={isLead}
                        />
                    )}
                </Box>

                {/* RIGHT — recent reports list */}
                {selectedProject && (
                    <Box sx={{
                        width: { xs: '100%', md: 300 },
                        flexShrink: 0,
                        maxWidth: '100%',
                    }}>
                        <Paper sx={{ overflow: 'hidden' }}>
                            {/* Card header */}
                            <Box sx={{
                                px: 2.5, py: 1.5,
                                background: 'linear-gradient(180deg, #f8fafc 0%, #fff 100%)',
                                borderBottom: '1px solid #e2e8f0',
                                display: 'flex', alignItems: 'center', gap: 1.25,
                            }}>
                                <Box sx={{ width: 4, height: 22, bgcolor: 'primary.main', borderRadius: 0.5, flexShrink: 0 }} />
                                <Typography sx={{ fontSize: 13, fontWeight: 700, color: '#0f172a', flex: 1 }}>Recent Reports</Typography>
                            </Box>

                            {/* List */}
                            {loading ? (
                                <Box sx={{ p: 3, textAlign: 'center' }}><CircularProgress size={20} /></Box>
                            ) : reports.length === 0 ? (
                                <Box sx={{ p: 3 }}>
                                    <Typography variant="body2" color="text.secondary" textAlign="center">No reports found.</Typography>
                                </Box>
                            ) : (
                                reports.map(report => {
                                    const computed = report.overallHealth || 'Unknown';
                                    const insights = report.insightsHealth || '';
                                    const sev = (h: string) => h === 'Red' ? 3 : h === 'Amber' ? 2 : 1;
                                    const effective = (insights && sev(insights) > sev(computed)) ? insights : computed;
                                    const differs = effective !== computed;
                                    const isActive = selectedReport?.reportId === report.id;
                                    return (
                                        <Box
                                            key={report.id}
                                            onClick={() => handleSelectReport(report)}
                                            sx={{
                                                px: 2, py: 1.5,
                                                borderBottom: '1px solid #f1f5f9',
                                                borderLeft: isActive ? '3px solid #4f46e5' : '3px solid transparent',
                                                cursor: 'pointer',
                                                bgcolor: isActive ? '#f5f3ff' : 'transparent',
                                                '&:hover': { bgcolor: isActive ? '#f5f3ff' : '#f8faff' },
                                                display: 'flex', alignItems: 'center', gap: 1,
                                            }}
                                        >
                                            <Box sx={{ flex: 1, minWidth: 0 }}>
                                                <Typography sx={{ fontSize: 13, fontWeight: 600, color: '#0f172a' }}>{report.date}</Typography>
                                                {report.updatedAt && (
                                                    <Typography sx={{ fontSize: 11, color: '#94a3b8' }}>
                                                        {dayjs.utc(report.updatedAt).tz('Asia/Kolkata').format('HH:mm')}
                                                    </Typography>
                                                )}
                                            </Box>
                                            {differs ? (
                                                <Tooltip title={`Computed: ${computed} | Insights: ${insights}`}>
                                                    <Chip label={effective} color={getStatusColor(effective)} size="small" sx={{ cursor: 'help', fontSize: 11 }} />
                                                </Tooltip>
                                            ) : (
                                                <Chip label={computed} color={getStatusColor(computed)} size="small" sx={{ fontSize: 11 }} />
                                            )}
                                            {!isLead && !isMember && (
                                                <Tooltip title="Regenerate">
                                                    <IconButton size="small" onClick={e => { e.stopPropagation(); handleRegenerate(report); }}>
                                                        <AutorenewIcon sx={{ fontSize: 15 }} />
                                                    </IconButton>
                                                </Tooltip>
                                            )}
                                        </Box>
                                    );
                                })
                            )}

                            {totalPages > 1 && (
                                <Box sx={{ p: 1.5, display: 'flex', justifyContent: 'center', borderTop: '1px solid #f1f5f9' }}>
                                    <Pagination size="small" count={totalPages} page={page}
                                        onChange={(_, p) => setPage(p)} color="primary" />
                                </Box>
                            )}
                        </Paper>

                        {/* Date range filter — collapsible below the list */}
                        <Box sx={{ mt: 2 }}>
                            <Link
                                component="button" variant="body2"
                                onClick={() => setShowDateRange(!showDateRange)}
                                disabled={!selectedProject}
                                sx={{ fontSize: 12, textDecoration: 'none', color: 'text.secondary', cursor: 'pointer' }}
                            >
                                {showDateRange ? 'Hide date filter' : 'Search other dates...'}
                            </Link>
                            {showDateRange && (
                                <Box sx={{ mt: 1.5, display: 'flex', flexDirection: 'column', gap: 1.5 }}>
                                    <DatePicker
                                        label="Start Date" value={startDate} minDate={minAllowedDate}
                                        onChange={val => setStartDate(val)} disabled={!selectedProject}
                                        slotProps={{ textField: { size: 'small', fullWidth: true } }}
                                    />
                                    <DatePicker
                                        label="End Date" value={endDate} minDate={startDate || minAllowedDate}
                                        onChange={val => setEndDate(val)} disabled={!selectedProject}
                                        slotProps={{ textField: { size: 'small', fullWidth: true } }}
                                    />
                                    <Button size="small" variant="text" color="inherit" onClick={handleClearFilter}>Reset to last 7 days</Button>
                                </Box>
                            )}
                        </Box>
                    </Box>
                )}
            </Box>

            {/* GENERATE DIALOG */}
            <Dialog open={isGenerateDialogOpen} onClose={() => !genLoading && setIsGenerateDialogOpen(false)} maxWidth="sm" fullWidth>
                <DialogTitle>Generate New Daily Report</DialogTitle>
                <DialogContent dividers>
                    <Box sx={{ mt: 1 }}>
                        <DatePicker
                            label="Date" value={genDate}
                            onChange={Datehandler}
                            minDate={minAllowedDate}
                            maxDate={dayjs()}
                            slotProps={{ textField: { fullWidth: true, helperText: dateError, error: Boolean(dateError) } }}
                        />
                    </Box>
                </DialogContent>
                <DialogActions>
                    <Button onClick={() => setIsGenerateDialogOpen(false)} disabled={genLoading}>Cancel</Button>
                    <Button onClick={handleGenerateSubmit} variant="contained" disabled={genLoading || !genDate || Boolean(dateError)}>
                        {genLoading ? <CircularProgress size={24} /> : 'Generate'}
                    </Button>
                </DialogActions>
            </Dialog>
        </Box>
    );
};
