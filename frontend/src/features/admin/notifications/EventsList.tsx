import { useCallback, useEffect, useState } from 'react';
import { Box, Typography, Paper, Table, TableBody, TableCell, TableHead, TableRow, Chip, CircularProgress, TablePagination, TableContainer } from '@mui/material';
import { notificationsApi } from './api';
import type { ApiResponse, NotificationEventDto } from './api';
import { getApiErrorMessage } from './helper';
import axios from 'axios';
import ReusableSnackbar from '../../../shared/components/ReusableSnackbar';

export function EventsList() {
    const [page,setPage] = useState(1);
    const limit = 10;
    const [events, setEvents] = useState<ApiResponse<NotificationEventDto>>();
    const [snackbar, setSnackbar] = useState<{ msg: string; severity: 'success' | 'error' } | null>(null);
    const [loading, setLoading] = useState(true);

    const showError = (msg: string) => { setSnackbar({ msg, severity: 'error' }); };

    const loadData = useCallback(async (pageNumber: number, signal?: AbortSignal) => {
        setLoading(true);
        try {
            const eventsData = await notificationsApi.listEventsWithPagination(pageNumber, limit,{signal});
            setEvents(eventsData);
        } catch (error) {
            if (axios.isCancel(error)) return;
            showError(getApiErrorMessage(error)); 
        } finally {
            setLoading(false);
        }
    }, [limit]);

    useEffect(() => {
        const controller = new AbortController();
        loadData(page, controller.signal);

        return () => controller.abort();
    }, [page, loadData]);

    if (loading) return <Box sx={{ p: 3, textAlign: 'center' }}><CircularProgress size={24} /></Box>;

    const totalEventItems = events?.totalItems ?? 0;

    return (
        <Paper sx={{ p: 0, overflow: 'hidden' }}>
            <ReusableSnackbar 
                snackbar={snackbar} 
                setSnackbar={setSnackbar}>
            </ReusableSnackbar>
            <Box sx={{ p: 2, borderBottom: '1px solid #e0e4ea' }}>
                <Typography variant="subtitle1" sx={{ fontWeight: 600 }}>Registered Events</Typography>
                <Typography variant="caption" color="text.secondary">Event codes that domain code emits. Read-only.</Typography>
            </Box>
           
            <TableContainer component={Paper}>
            <Table size="small">
                <TableHead>
                    <TableRow>
                        <TableCell>Code</TableCell>
                        <TableCell>Description</TableCell>
                        <TableCell>Active</TableCell>
                    </TableRow>
                </TableHead>
                <TableBody>
                    {events?.data.map(e => (
                        <TableRow key={e.code}>
                            <TableCell><code>{e.code}</code></TableCell>
                            <TableCell>{e.description}</TableCell>
                            <TableCell>
                                <Chip size="small" label={e.isActive ? 'Active' : 'Inactive'} color={e.isActive ? 'success' : 'default'} />
                            </TableCell>
                        </TableRow>
                    ))}
                    {events?.data.length === 0 && (
                        <TableRow><TableCell colSpan={3} align="center">No events registered</TableCell></TableRow>
                    )}
                </TableBody>
            </Table>
            <TablePagination
                component="div"
                count={totalEventItems}
                page={totalEventItems > 0 ? page - 1 : 0}
                onPageChange={(_, p) => setPage(p+1)}
                rowsPerPage={limit}
                rowsPerPageOptions={[limit]}
            />
            </TableContainer>
        </Paper>
    );
}
