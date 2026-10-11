/* eslint-disable @typescript-eslint/no-explicit-any */
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
    Pagination,
    Dialog,
    DialogTitle,
    DialogContent,
    DialogActions,
    IconButton,
    Tooltip,
    Autocomplete,
    Select,
    FormControl,
    InputLabel
} from '@mui/material';
import { useFetchProjects } from '../../auth/hooks';
import {
    useProjectWeeklyReports,
    useFetchProjectWeeklyReports,
    useGenerateWeeklyReport,
    useBulkDownloadWeeklyReports,
} from './hooks';
import { useAuth } from '../../../context/AuthContext';
import { usePermissions } from '../../../shared/hooks/usePermissions';
import AutorenewIcon from '@mui/icons-material/Autorenew';
import FolderZipIcon from '@mui/icons-material/FolderZip';
import AddIcon from '@mui/icons-material/Add';
import CloseIcon from '@mui/icons-material/Close';
import WarningAmberIcon from '@mui/icons-material/WarningAmber';
import InfoOutlinedIcon from '@mui/icons-material/InfoOutlined';
import { DatePicker } from '@mui/x-date-pickers/DatePicker';
import dayjs, { Dayjs } from 'dayjs';
import utc from 'dayjs/plugin/utc';
import timezone from 'dayjs/plugin/timezone';
import { ReportView } from '../../../shared/components/ReportView';
import type { Account } from '../../admin/accounts/types';

dayjs.extend(utc);
dayjs.extend(timezone);

const DAY_NAMES = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'];

interface WeeklyReportProps {
    accounts: Account[];
    selectedAccount?: Account | null;
}

export const WeeklyReport = ({ accounts, selectedAccount: propAccount }: WeeklyReportProps) => {
    const { user } = useAuth();
    const isLead = user?.roleName === 'lead';
    const { isMember } = usePermissions();

    // Filters & Pagination State
    const [selectedAccount, setSelectedAccount] = useState<string>(propAccount?.id ? String(propAccount.id) : '');
    const [projectList, setProjectList] = useState<any[]>([]);
    const [selectedProject, setSelectedProject] = useState<string>('');
    const [statusFilter, setStatusFilter] = useState<string>('All');
    const [page, setPage] = useState<number>(1);
    const limit = 10;

    // Reports Data State
    const [error, setError] = useState('');
    const [successMessage, setSuccessMessage] = useState('');

    const fetchProjects = useFetchProjects();
    const fetchProjectWeeklyReportsMutation = useFetchProjectWeeklyReports();
    const generateWeeklyMutation = useGenerateWeeklyReport();
    const bulkDownloadMutation = useBulkDownloadWeeklyReports();

    const projectWeeklyQuery = useProjectWeeklyReports(
        selectedProject ? parseInt(selectedProject) : 0,
        page,
        limit,
        statusFilter,
    );
    const reports: any[] = selectedProject ? (projectWeeklyQuery.data?.reports ?? []) : [];
    const loading = !!selectedProject && projectWeeklyQuery.isFetching;
    const totalPages = selectedProject ? (projectWeeklyQuery.data?.totalPages ?? 1) : 1;

    // Inline selected report (shown on the left)
    const [selectedReport, setSelectedReport] = useState<any | null>(null);

    // Generate Form State — default to the most recent complete week of the selected account's
    // configured cycle (Account.weekStartDay; defaults to Friday when no account is selected yet).
    const accForQuery = selectedAccount
        ? accounts.find(a => a.name === selectedAccount || parseInt(String(a.id)) === parseInt(selectedAccount))
        : null;
    const weekStartDay = accForQuery?.weekStartDay ?? 5;
    const expectedEndDayOfWeek = (weekStartDay + 6) % 7;
    const [isGenerateDialogOpen, setIsGenerateDialogOpen] = useState(false);
    const [dateError, setDateError] = useState('');
    const [startDate, setStartDate] = useState<Dayjs | null>(null);
    const [endDate, setEndDate] = useState<Dayjs | null>(null);
    const [startDateError, setStartDateError] = useState('');
    const [endDateError, setEndDateError] = useState('');
    const _today = dayjs();
    const _diffToFriday = ((_today.day() - weekStartDay + 7) % 7) + 7;
    const [genStartDate, setGenStartDate] = useState<Dayjs | null>(_today.subtract(_diffToFriday, 'day'));
    const [genEndDate, setGenEndDate] = useState<Dayjs | null>(_today.subtract(_diffToFriday, 'day').add(6, 'day'));
    const [genLoading, setGenLoading] = useState(false);

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
                        // Sprint-cadence projects report per-sprint (Board View), not weekly.
                        setProjectList(data.filter(p => (p as any).reportingFrequency !== 'sprint'));
                    }
                } catch (err) {
                    console.error("Failed to fetch projects", err);
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
        if (projectWeeklyQuery.isError) {
            const err = projectWeeklyQuery.error;
            const errorWithResponse = err as { response?: { data?: { error?: string } }; message?: string };
            setError(errorWithResponse?.response?.data?.error || errorWithResponse?.message || 'Failed to fetch report.');
        }
    }, [projectWeeklyQuery.isError, projectWeeklyQuery.error]);

    // Auto-select most recent when list updates
    useEffect(() => {
        if (!selectedProject) { setSelectedReport(null); return; }
        if (reports.length > 0) setSelectedReport(reports[0]);
        else setSelectedReport(null);
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [selectedProject, projectWeeklyQuery.dataUpdatedAt]);


    // Bulk download dialog state
    const [isBulkDialogOpen, setIsBulkDialogOpen] = useState(false);
    const [bulkAccount, setBulkAccount] = useState<any>(null);
    const [bulkProjectList, setBulkProjectList] = useState<any[]>([]);
    const [bulkProjectsLoading, setBulkProjectsLoading] = useState(false);
    const [bulkProjects, setBulkProjects] = useState<any[]>([]);
    const [availableWeeks, setAvailableWeeks] = useState<{ startDate: string; endDate: string }[]>([]);
    const [weeksLoading, setWeeksLoading] = useState(false);
    const [bulkWeek, setBulkWeek] = useState<string>('');
    const [bulkFormat, setBulkFormat] = useState<'text' | 'csv' | 'ppt'>('ppt');
    const [bulkLoading, setBulkLoading] = useState(false);
    const [bulkError, setBulkError] = useState('');

    const SELECT_ALL_OPTION = { id: '__all__', name: 'Select All', code: '__all__' };

    useEffect(() => {
        if (!bulkAccount) {
            setBulkProjectList([]);
            setBulkProjects([]);
            setAvailableWeeks([]);
            setBulkWeek('');
            return;
        }
        const fetchBulkProjects = async () => {
            setBulkProjectsLoading(true);
            try {
                const data = await fetchProjects(bulkAccount.id);
                // Sprint-cadence projects report per-sprint (Board View), not weekly.
                setBulkProjectList(data.filter(p => (p as any).reportingFrequency !== 'sprint'));
            } catch (err) {
                console.error('Failed to fetch projects for bulk download', err);
            } finally {
                setBulkProjectsLoading(false);
            }
        };
        setBulkProjects([]);
        setAvailableWeeks([]);
        setBulkWeek('');
        fetchBulkProjects();
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [bulkAccount]);

    const handleBulkProjectChange = (_: any, val: any[]) => {
        if (val.some(v => v.id === '__all__')) {
            setBulkProjects(bulkProjects.length === bulkProjectList.length ? [] : [...bulkProjectList]);
        } else {
            setBulkProjects(val);
        }
    };

    useEffect(() => {
        if (!isBulkDialogOpen || bulkProjects.length === 0) {
            setAvailableWeeks([]);
            setBulkWeek('');
            return;
        }
        const fetchWeeks = async () => {
            setWeeksLoading(true);
            try {
                const weekMap = new Map<string, { startDate: string; endDate: string }>();
                for (const p of bulkProjects) {
                    const data = await fetchProjectWeeklyReportsMutation.mutateAsync({ projectId: parseInt(p.id), page: 1, limit: 100, status: 'All' });
                    for (const r of (data.reports || [])) {
                        const key = `${r.startDate}|${r.endDate}`;
                        if (!weekMap.has(key)) weekMap.set(key, { startDate: r.startDate, endDate: r.endDate });
                    }
                }
                const sorted = Array.from(weekMap.values()).sort((a, b) => b.startDate.localeCompare(a.startDate));
                setAvailableWeeks(sorted);
                setBulkWeek(sorted.length > 0 ? `${sorted[0].startDate}|${sorted[0].endDate}` : '');
            } finally {
                setWeeksLoading(false);
            }
        };
        fetchWeeks();
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [bulkProjects, isBulkDialogOpen]);

    const handleBulkDownload = async () => {
        if (bulkProjects.length === 0 || !bulkWeek) return;
        const [startDate, endDate] = bulkWeek.split('|');
        setBulkLoading(true);
        setBulkError('');
        try {
            await bulkDownloadMutation.mutateAsync({
                reports: bulkProjects.map(p => ({ projectName: p.code, startDate, endDate })),
                format: bulkFormat,
            });
            setIsBulkDialogOpen(false);
        } catch (err) {
            const errorWithResponse = err as { response?: { data?: { error?: string } }; message?: string };
            setBulkError(errorWithResponse?.response?.data?.error || errorWithResponse?.message || 'Bulk download failed.');
        } finally {
            setBulkLoading(false);
        }
    };

    const StartDateHandler = (startDate: dayjs.Dayjs | null) => {
        setDateError('');
        if (startDate && startDate.isValid()) {
            setStartDate(startDate);
            if (startDate && dayjs(startDate).isAfter(dayjs())) {
                setStartDateError('Date cannot be future.');
            } else if (startDate && dayjs(startDate).isBefore(dayjs().subtract(91, 'day'))) {
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
            } else if (endDate && dayjs(endDate).isBefore(dayjs().subtract(91, 'day'))) {
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

        if (!selectedProject || !genStartDate || !genEndDate) {
            setDateError("Project, Start Date, and End Date are required.");
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
            const p = projectList.find(proj => parseInt(proj.id) === parseInt(selectedProject));
            if (!p) throw new Error("Project not found");

            const startStr = genStartDate.format('YYYY-MM-DD');
            const endStr = genEndDate.format('YYYY-MM-DD');

            const data = await generateWeeklyMutation.mutateAsync({ projectName: p.code, startDate: startStr, endDate: endStr, force: true });

            if (data?.isAsync) {
                setSuccessMessage(data.message || 'Processing your request asynchronously...');
                setIsGenerateDialogOpen(false);
            } else {
                setSuccessMessage("Report queued / generated successfully!");
                setIsGenerateDialogOpen(false);
            }
        } catch (err) {
            console.error("Generate Report Error:", err);
            const errorWithResponse = err as { response?: { data?: { error?: string } }; message?: string };
            setDateError(errorWithResponse?.response?.data?.error || errorWithResponse?.message || 'Failed to generate report.');
        } finally {
            setGenLoading(false);
        }
    };

    const handleRegenerate = async (report: any) => {
        setError('');
        setSuccessMessage('');
        try {
            const p = projectList.find(proj => parseInt(proj.id) === parseInt(selectedProject));
            if (!p) throw new Error("Project not found");

            const data = await generateWeeklyMutation.mutateAsync({ projectName: p.code, startDate: report.startDate, endDate: report.endDate, force: true });
            if (data?.isAsync) {
                setSuccessMessage(`Regeneration queued for week ${report.startDate} to ${report.endDate}.`);
            } else {
                setSuccessMessage("Report regenerated successfully!");
            }
        } catch (err) {
            const errorWithResponse = err as { response?: { data?: { error?: string } }; message?: string };
            setError(errorWithResponse?.response?.data?.error || errorWithResponse?.message || 'Failed to regenerate report.');
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

    const activeProject = projectList.find(p => String(p.id) === String(selectedProject));

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
                {!isMember && (
                    <Button variant="outlined" color="secondary" size="small" startIcon={<FolderZipIcon />}
                        onClick={() => setIsBulkDialogOpen(true)}>
                        Bulk Download
                    </Button>
                )}
                {!isLead && !isMember && (
                    <Button variant="contained" size="small" startIcon={<AddIcon />}
                        onClick={() => {
                            setIsGenerateDialogOpen(true);
                            setStartDate(_today.subtract(_diffToFriday, 'day'));
                            setEndDate(_today.subtract(_diffToFriday, 'day').add(6, 'day'));
                            setStartDateError('');
                            setEndDateError('');
                            setDateError('');
                        }}
                        disabled={!selectedProject}>
                        Generate WSR
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
                        <Paper sx={{ p: 4, textAlign: 'center', border: '1px dashed #e2e8f0' }} elevation={0}>
                            <Typography sx={{ color: '#94a3b8', fontSize: 14 }}>Select a project to view reports</Typography>
                        </Paper>
                    )}
                    {selectedProject && loading && (
                        <Box sx={{ display: 'flex', justifyContent: 'center', p: 6 }}>
                            <CircularProgress />
                        </Box>
                    )}
                    {selectedProject && !loading && !selectedReport && (
                        <Paper sx={{ p: 4, textAlign: 'center', border: '1px dashed #e2e8f0' }} elevation={0}>
                            <Typography sx={{ color: '#94a3b8', fontSize: 14 }}>No reports found. Generate one to get started.</Typography>
                        </Paper>
                    )}
                    {selectedReport && (
                        <ReportView
                            key={selectedReport.id}
                            type="weekly"
                            data={selectedReport}
                            projectCode={activeProject?.code || ''}
                            projectName={activeProject?.name || 'Project'}
                            startDate={selectedReport.startDate}
                            endDate={selectedReport.endDate}
                            reportId={selectedReport.id}
                            isLead={isLead}
                        />
                    )}
                </Box>

                {/* RIGHT — recent reports list (300px) */}
                {selectedProject && (
                    <Box sx={{ width: { xs: '100%', md: 300 }, flexShrink: 0, maxWidth: '100%' }}>
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
                                const isActive = selectedReport?.id === report.id;
                                return (
                                    <Box
                                        key={report.id}
                                        onClick={() => setSelectedReport(report)}
                                        sx={{
                                            px: 2, py: 1.5,
                                            borderBottom: '1px solid #f1f5f9',
                                            borderLeft: isActive ? '3px solid #4f46e5' : '3px solid transparent',
                                            bgcolor: isActive ? '#f5f3ff' : 'transparent',
                                            '&:hover': { bgcolor: isActive ? '#f5f3ff' : '#f8faff' },
                                            cursor: 'pointer',
                                            display: 'flex', alignItems: 'center', gap: 0.75,
                                        }}
                                    >
                                        <Box sx={{ flex: 1, minWidth: 0 }}>
                                            <Typography sx={{ fontSize: 12, fontWeight: 600, color: '#0f172a', lineHeight: 1.4 }}>
                                                {report.startDate}
                                            </Typography>
                                            <Typography sx={{ fontSize: 11, color: '#94a3b8', lineHeight: 1.3 }}>
                                                to {report.endDate}
                                            </Typography>
                                        </Box>
                                        <Box sx={{ display: 'flex', alignItems: 'center', gap: 0.25 }}>
                                            <Chip
                                                label={report.status || '—'}
                                                color={getStatusColor(report.status)}
                                                size="small"
                                                sx={{ fontSize: 10, height: 20 }}
                                            />
                                            {report.insightsStaleSince && (
                                                <Tooltip title="A daily report's health was updated after this weekly report was generated. Consider regenerating.">
                                                    <WarningAmberIcon sx={{ fontSize: 14, color: 'warning.main' }} />
                                                </Tooltip>
                                            )}
                                            {report.weeklyHealthRationale && (
                                                <Tooltip title={report.weeklyHealthRationale} placement="bottom-start" arrow>
                                                    <InfoOutlinedIcon sx={{ fontSize: 13, color: 'text.secondary' }} />
                                                </Tooltip>
                                            )}
                                        </Box>
                                        {!isLead && !isMember && (
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

            {/* BULK DOWNLOAD DIALOG */}
            <Dialog open={isBulkDialogOpen} onClose={() => { if (!bulkLoading) { setIsBulkDialogOpen(false); setBulkAccount(null); } }} maxWidth="sm" fullWidth>
                <DialogTitle sx={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                    Bulk Download Weekly Reports
                    <IconButton onClick={() => { setIsBulkDialogOpen(false); setBulkAccount(null); }} disabled={bulkLoading}><CloseIcon /></IconButton>
                </DialogTitle>
                <DialogContent dividers>
                    {bulkError && <Alert severity="error" sx={{ mb: 2 }}>{bulkError}</Alert>}
                    <Box sx={{ display: 'flex', flexDirection: 'column', gap: 3, mt: 1 }}>
                        <Autocomplete
                            options={accounts}
                            getOptionLabel={(option) => option.name}
                            value={bulkAccount}
                            onChange={(_: any, val: any) => setBulkAccount(val)}
                            isOptionEqualToValue={(opt: any, val: any) => opt.id === val.id}
                            renderInput={(params) => <TextField {...params} label="Select Account" required />}
                        />
                        <Autocomplete
                            multiple
                            disabled={!bulkAccount || bulkProjectsLoading}
                            options={[SELECT_ALL_OPTION, ...bulkProjectList]}
                            getOptionLabel={(option: any) => option.name}
                            value={bulkProjects}
                            onChange={handleBulkProjectChange}
                            isOptionEqualToValue={(opt: any, val: any) => opt.id === val.id}
                            renderOption={(props, option: any) => (
                                <li {...props} key={option.id}>
                                    {option.id === '__all__'
                                        ? <Typography fontWeight="bold">{bulkProjects.length === bulkProjectList.length ? 'Deselect All' : 'Select All'}</Typography>
                                        : option.name}
                                </li>
                            )}
                            renderInput={(params) => (
                                <TextField
                                    {...params}
                                    label="Select Projects"
                                    placeholder={bulkProjects.length === 0 ? (!bulkAccount ? 'Select an account first' : 'Pick one or more projects') : ''}
                                    required
                                    InputProps={{ ...params.InputProps, endAdornment: <>{bulkProjectsLoading && <CircularProgress size={16} sx={{ mr: 1 }} />}{params.InputProps.endAdornment}</> }}
                                />
                            )}
                            renderTags={(value, getTagProps) =>
                                value.map((option, index) => (
                                    <Chip label={option.name} {...getTagProps({ index })} key={option.id} size="small" />
                                ))
                            }
                        />
                        <FormControl fullWidth disabled={bulkProjects.length === 0}>
                            <InputLabel>Week</InputLabel>
                            <Select value={bulkWeek} label="Week" onChange={(e) => setBulkWeek(e.target.value)}
                                startAdornment={weeksLoading ? <CircularProgress size={16} sx={{ mr: 1 }} /> : null}>
                                {availableWeeks.length === 0 && !weeksLoading && (
                                    <MenuItem value="" disabled>
                                        {bulkProjects.length === 0 ? 'Select projects first' : 'No reports found'}
                                    </MenuItem>
                                )}
                                {availableWeeks.map(w => (
                                    <MenuItem key={`${w.startDate}|${w.endDate}`} value={`${w.startDate}|${w.endDate}`}>
                                        {w.startDate} to {w.endDate}
                                    </MenuItem>
                                ))}
                            </Select>
                        </FormControl>
                        <FormControl fullWidth>
                            <InputLabel>Format</InputLabel>
                            <Select value={bulkFormat} label="Format" onChange={(e) => setBulkFormat(e.target.value as 'text' | 'csv' | 'ppt')}>
                                <MenuItem value="ppt">PPT (PowerPoint)</MenuItem>
                                <MenuItem value="csv">CSV</MenuItem>
                                <MenuItem value="text">Text</MenuItem>
                            </Select>
                        </FormControl>
                        <Typography variant="caption" color="text.secondary">
                            Reports for the selected week will be bundled into a single ZIP file.
                        </Typography>
                    </Box>
                </DialogContent>
                <DialogActions>
                    <Button onClick={() => { setIsBulkDialogOpen(false); setBulkAccount(null); }} disabled={bulkLoading}>Cancel</Button>
                    <Button onClick={handleBulkDownload} variant="contained" color="secondary"
                        disabled={bulkLoading || bulkProjects.length === 0 || !bulkWeek}
                        startIcon={bulkLoading ? <CircularProgress size={20} /> : <FolderZipIcon />}>
                        Download ZIP
                    </Button>
                </DialogActions>
            </Dialog>

            {/* GENERATE DIALOG */}
            <Dialog open={isGenerateDialogOpen} onClose={() => !genLoading && setIsGenerateDialogOpen(false)} maxWidth="sm" fullWidth>
                <DialogTitle>Generate New Report</DialogTitle>
                <DialogContent dividers>
                    {dateError && <Alert severity="error" sx={{ mb: 2 }}>{dateError}</Alert>}
                    <Box sx={{ display: 'flex', flexDirection: 'column', gap: 3, mt: 1 }}>
                        <Box sx={{ display: 'flex', gap: 2, flexWrap: 'wrap', flexDirection: { xs: 'column', sm: 'row' } }}>
                            <Box sx={{ flex: 1, minWidth: { xs: '100%', sm: '200px' } }}>
                                <DatePicker
                                    label="Start Date"
                                    value={startDate}
                                    onChange={StartDateHandler}
                                    slotProps={{ textField: { fullWidth: true, required: true, helperText: startDateError, error: Boolean(startDateError) } }}
                                    minDate={dayjs().subtract(90, 'day')}
                                    maxDate={dayjs()} />
                            </Box>
                            <Box sx={{ flex: 1, minWidth: { xs: '100%', sm: '200px' } }}>
                                <DatePicker
                                    label="End Date"
                                    value={endDate}
                                    onChange={EndDateHandler}
                                    slotProps={{ textField: { fullWidth: true, required: true, helperText: endDateError, error: Boolean(endDateError) } }}
                                    minDate={dayjs().subtract(90, 'day')}
                                    maxDate={dayjs()} />
                            </Box>
                        </Box>
                        <Typography variant="caption" color="textSecondary">
                            This account's report week runs {DAY_NAMES[weekStartDay]} to {DAY_NAMES[expectedEndDayOfWeek]}.
                        </Typography>
                    </Box>
                </DialogContent>
                <DialogActions>
                    <Button onClick={() => setIsGenerateDialogOpen(false)} disabled={genLoading}>Cancel</Button>
                    <Button onClick={handleGenerateSubmit} variant="contained" disabled={genLoading || !startDate || !endDate || Boolean(startDateError) || Boolean(endDateError) || Boolean(dateError)}>
                        {genLoading ? <CircularProgress size={24} /> : "Generate"}
                    </Button>
                </DialogActions>
            </Dialog>

        </Box>
    );
};
