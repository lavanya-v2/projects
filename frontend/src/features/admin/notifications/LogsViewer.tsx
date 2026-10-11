import { useCallback, useEffect, useState } from 'react';
import {
    Box, Paper, Table, TableBody, TableCell, TableHead, TableRow, Chip, TextField, MenuItem,
    Dialog, DialogTitle, DialogContent, DialogActions, Button, CircularProgress, Typography,
    TablePagination, Tabs, Tab, Tooltip, IconButton,
    Alert,
} from '@mui/material';
import RefreshIcon from '@mui/icons-material/Refresh';
import { notificationsApi } from './api';
import type { NotificationEventDto, NotificationLogDto, NotificationPendingDto } from './api';
import { useAdminAccounts } from '../accounts/hooks';
import { useAdminProjects } from '../projects/hooks';
import type { Project } from '../../../types';
import { getApiErrorMessage } from './helper';
import axios from 'axios';
import ReusableSnackbar from '../../../shared/components/ReusableSnackbar';

const IST_FMT: Intl.DateTimeFormatOptions = {
    timeZone: 'Asia/Kolkata',
    year: 'numeric', month: '2-digit', day: '2-digit',
    hour: '2-digit', minute: '2-digit', second: '2-digit',
    hour12: false,
};

function istLabel(iso: string | null | undefined): string {
    if (!iso) return '—';
    const d = new Date(iso);
    return `${d.toLocaleString('en-IN', IST_FMT)} IST`;
}

function relative(ms: number): string {
    const abs = Math.abs(ms);
    const s = Math.floor(abs / 1000);
    if (s < 60) return `${s}s`;
    const m = Math.floor(s / 60);
    if (m < 60) return `${m}m ${s % 60}s`;
    const h = Math.floor(m / 60);
    return `${h}h ${m % 60}m`;
}
type statusType = 'SENT' | 'FAILED' | 'QUEUED' | 'SKIPPED';
type statusColor = 'success' | 'error' | 'default' | 'warning';
const STATUS_COLORS: Record<statusType, statusColor> = {
    SENT: 'success', FAILED: 'error', QUEUED: 'default', SKIPPED: 'warning',
};

const LOGS_CAP = 100;

type Sub = 'sent' | 'pending';

export function LogsViewer() {
    const [tab, setTab] = useState<Sub>('sent');
    return (
        <Box>
            <Tabs value={tab} onChange={(_, v) => setTab(v)} sx={{ mb: 2 }}>
                <Tab value="sent" label="Sent / Failed" />
                <Tab value="pending" label="Pending (coalescing)" />
            </Tabs>
            {tab === 'sent' && <SentLogs />}
            {tab === 'pending' && <PendingAggregates />}
        </Box>
    );
}

function SentLogs() {
    const {data: accounts = []} = useAdminAccounts();
    const {data: projects = []} = useAdminProjects();
    const [items, setItems] = useState<NotificationLogDto[]>([]);
    const [loading, setLoading] = useState(true);
    const [page, setPage] = useState(1);
    const limit = 10;
    const [statusFilter, setStatusFilter] = useState('all');
    const [eventFilter, setEventFilter] = useState('all');
    const [accountFilter, setAccountFilter] = useState<string | number >('all');
    const [projectFilter, setProjectFilter] = useState<string | number >('all');
    const [detail, setDetail] = useState<NotificationLogDto | null>(null);
    const [count, setCount] = useState(0);
    const [eventCode, setEventCode] = useState<NotificationEventDto[]>([]);
    const [snackbar, setSnackbar] = useState<{ msg: string; severity: 'success' | 'error' } | null>(null);

    const showError = (msg: string) => { setSnackbar({ msg, severity: 'error' }); };

     const loadData = useCallback(async (pageNumber: number, signal?: AbortSignal) => {
        setLoading(true);
        try {
            const logsData = await  notificationsApi.listLogs({
                cap: LOGS_CAP,
                status: statusFilter === 'all' ? undefined : statusFilter,
                eventCode: eventFilter === 'all' ? undefined : eventFilter,
                accountId: accountFilter === 'all' ? undefined : accountFilter,
                projectId: projectFilter === 'all' ? undefined : projectFilter,
                page: pageNumber,
                limit: limit,
            },{signal});
            setItems(logsData.data);
            setCount(logsData.count);
        } catch (error) {
            if (axios.isCancel(error)) return;
            showError(getApiErrorMessage(error)); 
        } finally {
            setLoading(false);
        }
    }, [limit,statusFilter,accountFilter,eventFilter,projectFilter]);
    
    const loadFormData = useCallback(async (signal?: AbortSignal) => {
        try {
            const eventsData = await  notificationsApi.listEventsWithoutPagination({signal});
            setEventCode(eventsData);
        } catch (error) {
            if (axios.isCancel(error)) return;
            showError(getApiErrorMessage(error)); 
        }
    }, []);
    
    useEffect(() => {
        const controller = new AbortController();
        loadFormData(controller.signal);

        return () => controller.abort(); 
    }, [loadFormData]);

    useEffect(() => {
        const controller = new AbortController();
        loadData(page, controller.signal);

        return () => controller.abort();
    }, [page, loadData]);

    return (
        <Box>
            <ReusableSnackbar 
                snackbar={snackbar} 
                setSnackbar={setSnackbar}>
            </ReusableSnackbar>
            <Box sx={{ display: 'flex', gap: 2, mb: 2, alignItems: 'center' }}>
                <TextField select size="small" label="Status" value={statusFilter}
                    onChange={e => { setStatusFilter(e.target.value); setPage(1); }} sx={{ minWidth: 150 }}>
                    <MenuItem value="all">All</MenuItem>
                    <MenuItem value="QUEUED">QUEUED</MenuItem>
                    <MenuItem value="SENT">SENT</MenuItem>
                    <MenuItem value="FAILED">FAILED</MenuItem>
                    <MenuItem value="SKIPPED">SKIPPED</MenuItem>
                </TextField>
                <TextField select size="small" label="Event code" value={eventFilter} 
                    onChange={e=> {setEventFilter(e.target.value); setPage(1);}} sx={{minWidth: 220}}>
                        <MenuItem value='all'>All</MenuItem>
                        {eventCode.map(r=><MenuItem key={r.code}  value={r.code}>{r.code}</MenuItem>)}
                </TextField>
                <TextField select size="small" label="Account" value={accountFilter} 
                    onChange={e=> {setAccountFilter(e.target.value); setProjectFilter('all'); setPage(1);}} sx={{minWidth: 220}}>
                        <MenuItem value='all'>All Accounts</MenuItem>
                        {accounts.map(r=><MenuItem key={r.id}  value={r.id}>{r.name}</MenuItem>)}
                </TextField>
                <TextField select size="small" label="Project" value={projectFilter} 
                    onChange={e=> {setProjectFilter(e.target.value); setPage(1);}} sx={{minWidth: 220}} 
                    slotProps={{
                        select:{
                            MenuProps: {
                                sx: {maxHeight: 400}
                            }
                        }
                    }}>
                        <MenuItem value='all'>All Projects</MenuItem>
                        { accountFilter === 'all' ? projects.map(r=><MenuItem key={r.id}  value={r.id}>{r.name}</MenuItem>): 
                            projects
                                .filter((project: Project) => String(project.accountId) === String(accountFilter))
                                .map((a: Project) => (
                                    <MenuItem key={a.id} value={a.id}>
                                        {a.name}
                                    </MenuItem>
                                ))
                        }
                </TextField>
                <Tooltip title="Refresh"><IconButton onClick={()=> loadData(page)}><RefreshIcon /></IconButton></Tooltip>
                <Typography variant="caption" color="text.secondary" sx={{ ml: 'auto' }}>
                    Showing last {count} of up to {LOGS_CAP}. All times IST.
                </Typography>
            </Box>
            <Paper>
                {loading ? (
                    <Box sx={{ p: 3, textAlign: 'center' }}><CircularProgress size={24} /></Box>
                ) : (
                    <>
                        <Table size="small">
                            <TableHead>
                                <TableRow>
                                    <TableCell>When (IST)</TableCell>
                                    <TableCell>Event</TableCell>
                                    <TableCell>Status</TableCell>
                                    <TableCell>To</TableCell>
                                    <TableCell>Subject</TableCell>
                                    <TableCell>Account / Project</TableCell>
                                </TableRow>
                            </TableHead>
                            <TableBody>
                                {items.map(l => (
                                    <TableRow key={l.id} hover sx={{ cursor: 'pointer' }} onClick={() => setDetail(l)}>
                                        <TableCell>{istLabel(l.createdAt)}</TableCell>
                                        <TableCell><code>{l.eventCode}</code></TableCell>
                                        <TableCell><Chip size="small" label={l.status} color={STATUS_COLORS[l.status] ?? 'default'} /></TableCell>
                                        <TableCell>{(l.recipients ?? []).slice(0, 2).join(', ')}{(l.recipients?.length ?? 0) > 2 ? ` +${(l.recipients.length - 2)}` : ''}</TableCell>
                                        <TableCell>{l.subject}</TableCell>
                                        <TableCell>
                                            {l.accountName || l.projectName
                                                ? `${l.accountName ?? '—'} / ${l.projectName ?? '—'}`
                                                : '—'}
                                        </TableCell>
                                    </TableRow>
                                ))}
                                {items.length === 0 && (
                                    <TableRow><TableCell colSpan={6} align="center">No logs</TableCell></TableRow>
                                )}
                            </TableBody>
                        </Table>
                        <TablePagination
                            component="div"
                            count={count}
                            page={count > 0 ? page-1 : 0}
                            onPageChange={(_, p) => setPage(p+1)}
                            rowsPerPage={limit}
                            rowsPerPageOptions={[limit]}
                            onRowsPerPageChange={() => undefined}
                        />
                    </>
                )}
            </Paper>

            <Dialog open={!!detail} onClose={() => setDetail(null)} fullWidth maxWidth="md">
                <DialogTitle>Notification Log #{detail?.id}</DialogTitle>
                <DialogContent dividers>
                    {detail && (
                        <Box sx={{ display: 'grid', gap: 1.5 }}>
                            <Typography variant="body2"><strong>Event:</strong> <code>{detail.eventCode}</code></Typography>
                            <Typography variant="body2"><strong>Status:</strong> {detail.status}</Typography>
                            <Typography variant="body2"><strong>Created:</strong> {istLabel(detail.createdAt)}</Typography>
                            <Typography variant="body2"><strong>Account / Project:</strong> {(detail.accountName || detail.projectName) ? `${detail.accountName ?? '—'} / ${detail.projectName ?? '—'}` : '—'}</Typography>
                            <Typography variant="body2"><strong>Sent at:</strong> {detail.sentAt ? istLabel(detail.sentAt) : '—'}</Typography>
                            <Typography variant="body2"><strong>To:</strong> {(detail.recipients ?? []).join(', ') || '—'}</Typography>
                            <Typography variant="body2"><strong>CC:</strong> {(detail.cc ?? []).join(', ') || '—'}</Typography>
                            <Typography variant="body2"><strong>Subject:</strong> {detail.subject}</Typography>
                            <Typography variant="body2" sx={{ fontWeight: 600, mt: 1 }}>Body:</Typography>
                            <Paper variant="outlined" sx={{ p: 1.5, whiteSpace: 'pre-wrap', fontFamily: 'monospace', fontSize: 12 }}>
                                {detail.body}
                            </Paper>
                            {detail.error && (
                                <>
                                    <Typography variant="body2" color="error" sx={{ fontWeight: 600 }}>Error:</Typography>
                                    <Paper variant="outlined" sx={{ p: 1.5, whiteSpace: 'pre-wrap', fontFamily: 'monospace', fontSize: 12, color: 'error.main' }}>
                                        {detail.error}
                                    </Paper>
                                </>
                            )}
                            <Typography variant="body2" sx={{ fontWeight: 600, mt: 1 }}>Payload snapshot:</Typography>
                            <Paper variant="outlined" sx={{ p: 1.5, whiteSpace: 'pre-wrap', fontFamily: 'monospace', fontSize: 11 }}>
                                {JSON.stringify(detail.payloadSnapshot, null, 2)}
                            </Paper>
                        </Box>
                    )}
                </DialogContent>
                <DialogActions><Button onClick={() => setDetail(null)}>Close</Button></DialogActions>
            </Dialog>
        </Box>
    );
}

function PendingAggregates() {
    const [items, setItems] = useState<NotificationPendingDto[]>([]);
    const [loading, setLoading] = useState(true);
    const [now, setNow] = useState(()=>Date.now());
    const [error, setError] = useState<string|null>(null);

    const loadData = useCallback(async (signal?: AbortSignal) => {
        setLoading(true);
        try {
            const pendingLogsData = await notificationsApi.listPending({signal});
            setItems(pendingLogsData.items);
            setError(null);
        } catch (error) {
            if (axios.isCancel(error)) return;
            setError(getApiErrorMessage(error)); 
        } finally {
            setLoading(false);
        }
    }, []);
    
    useEffect(() => {
        const controller = new AbortController();
        loadData(controller.signal);

        return () => controller.abort(); 
    }, [loadData]);

    // Tick every second for countdown, and auto-refresh every 15s
    useEffect(() => {
        const tick = setInterval(() => setNow(Date.now()), 1000);
        const refresh = setInterval(loadData, 15000);
        return () => { clearInterval(tick); clearInterval(refresh); };
    }, [loadData]);

    return (
        <Box>
            {error && <Alert severity="error" sx={{ mb: 3, borderRadius: 2, fontSize: 13 }}>{error}</Alert>}
            <Box sx={{ display: 'flex', alignItems: 'center', mb: 2, gap: 2 }}>
                <Typography variant="body2" color="text.secondary">
                    Aggregated events waiting for their coalesce window to elapse. All times IST.
                </Typography>
                <Tooltip title="Refresh"><IconButton onClick={()=>loadData()}><RefreshIcon /></IconButton></Tooltip>
            </Box>
            <Paper>
                {loading ? (
                    <Box sx={{ p: 3, textAlign: 'center' }}><CircularProgress size={24} /></Box>
                ) : (
                    <Table size="small">
                        <TableHead>
                            <TableRow>
                                <TableCell>Event</TableCell>
                                <TableCell>Bucket key</TableCell>
                                <TableCell>Events</TableCell>
                                <TableCell>Created (IST)</TableCell>
                                <TableCell>Will fire at (IST)</TableCell>
                                <TableCell>In</TableCell>
                            </TableRow>
                        </TableHead>
                        <TableBody>
                            {items.map(p => {
                                const flush = new Date(p.flushAt).getTime();
                                const delta = flush - now;
                                const overdue = delta <= 0;
                                return (
                                    <TableRow key={p.id} hover>
                                        <TableCell><code>{p.eventCode}</code></TableCell>
                                        <TableCell><code>{p.coalesceKey}</code></TableCell>
                                        <TableCell>{p.eventCount}</TableCell>
                                        <TableCell>{istLabel(p.createdAt)}</TableCell>
                                        <TableCell>{istLabel(p.flushAt)}</TableCell>
                                        <TableCell>
                                            <Chip
                                                size="small"
                                                label={overdue ? `firing (${relative(delta)})` : `${relative(delta)}`}
                                                color={overdue ? 'warning' : 'primary'}
                                                variant={overdue ? 'filled' : 'outlined'}
                                            />
                                        </TableCell>
                                    </TableRow>
                                );
                            })}
                            {items.length === 0 && (
                                <TableRow><TableCell colSpan={6} align="center">Nothing pending</TableCell></TableRow>
                            )}
                        </TableBody>
                    </Table>
                )}
            </Paper>
        </Box>
    );
}
