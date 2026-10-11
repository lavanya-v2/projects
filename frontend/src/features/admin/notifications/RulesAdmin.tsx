import { useCallback, useEffect, useState } from 'react';
import {
    Box, Typography, Paper, Table, TableBody, TableCell, TableHead, TableRow, Chip, Button,
    Dialog, DialogTitle, DialogContent, DialogActions, TextField, Switch, FormControlLabel,
    MenuItem, IconButton, CircularProgress,
    TableContainer,
    TablePagination,
    Checkbox,
    ListItemText,
} from '@mui/material';
import EditIcon from '@mui/icons-material/Edit';
import DeleteIcon from '@mui/icons-material/Delete';
import { notificationsApi } from './api';
import type { NotificationRuleDto, NotificationTemplateDto, NotificationEventDto } from './api';
import { useRoles } from '../users/hooks';
import type { ApiResponse } from './api';
import ConfirmationDialog from '../../../shared/components/ConfirmationDialog';
import { getApiErrorMessage } from './helper';
import axios from 'axios';
import ReusableSnackbar from '../../../shared/components/ReusableSnackbar';

const emptyRule: Partial<NotificationRuleDto> = {
    eventCode: '',
    templateId: undefined,
    transport: 'email',
    recipientsConfig: { roles: ['manager', 'lead'], scope: 'project' },
    ccConfig: null,
    scopeConfig: null,
    coalesceWindowSeconds: 300,
    coalesceKeyConfig: ['projectId'],
    isActive: true,
    priority: 0,
};

interface EditState extends Partial<NotificationRuleDto> {
    _roles?: string[];
    _ccEmails?: string;
    _scopeProjectIds?: string;
    _scopeAccountIds?: string;
    _coalesceKeys?: string;
}

function toEdit(r: Partial<NotificationRuleDto>): EditState {
    return {
        ...r,
        _roles: (r.recipientsConfig?.roles ?? []),
        _ccEmails: (r.ccConfig?.emails ?? []).join(','),
        _scopeProjectIds: (r.scopeConfig?.projectIds ?? []).join(','),
        _scopeAccountIds: (r.scopeConfig?.accountIds ?? []).join(','),
        _coalesceKeys: (r.coalesceKeyConfig ?? []).join(','),
    };
}

function fromEdit(e: EditState): Partial<NotificationRuleDto> {
    const { _roles, _ccEmails, _scopeProjectIds, _scopeAccountIds, _coalesceKeys, ...rest } = e;
    const roles = (_roles ?? []).map(s => s.trim()).filter(Boolean);
    const ccEmails = (_ccEmails ?? '').split(',').map(s => s.trim()).filter(Boolean);
    const projectIds = (_scopeProjectIds ?? '').split(',').map(s => parseInt(s.trim())).filter(n => !isNaN(n));
    const accountIds = (_scopeAccountIds ?? '').split(',').map(s => parseInt(s.trim())).filter(n => !isNaN(n));
    const coalesceKeys = (_coalesceKeys ?? '').split(',').map(s => s.trim()).filter(Boolean);

    return {
        ...rest,
        recipientsConfig: { roles, scope: e.recipientsConfig?.scope ?? 'project' },
        ccConfig: ccEmails.length > 0 ? { emails: ccEmails } : null,
        scopeConfig: (projectIds.length > 0 || accountIds.length > 0)
            ? { projectIds: projectIds.length > 0 ? projectIds : undefined, accountIds: accountIds.length > 0 ? accountIds : undefined }
            : null,
        coalesceKeyConfig: coalesceKeys.length > 0 ? coalesceKeys : null,
    };
}

export function RulesAdmin() {
    const [page, setPage] = useState(1);
    const limit = 10;
    const [rules, setRules] = useState<ApiResponse<NotificationRuleDto>>();
    const [templates, setTemplates] = useState<NotificationTemplateDto[]>([]);
    const [events, setEvents] = useState<NotificationEventDto[]>([]);
    const [loading, setLoading] = useState(true);
    const [editing, setEditing] = useState<EditState | null>(null);
    const [deleteTarget, setDeleteTarget] = useState<number | null>(null);
    const [deactivateTarget, setDeactivateTarget] = useState<EditState | null>(null);
    const { data: rolesData = [] } = useRoles();
    const [showDeleteAlert, setShowDeleteAlert] = useState(false);
    const [showDeactivateAlert, setShowDeactivateAlert] = useState(false);
    const [isDelete, setIsDelete] = useState(false);
    const [snackbar, setSnackbar] = useState<{ msg: string; severity: 'success' | 'error' } | null>(null);

    // ── Notification helpers ────────────────────────────────────────────────
    const showError = (msg: string) => { setSnackbar({ msg, severity: 'error' }); };
    const showSuccess = (msg: string) => { setSnackbar({ msg, severity: 'success' }); };


    const loadData = useCallback(async (pageNumber: number, signal?: AbortSignal) => {
        setLoading(true);
        try {
            const rulesData = await notificationsApi.listRules(pageNumber, limit, { signal });
            setRules(rulesData);
        } catch (error) {
            if (axios.isCancel(error)) return;
            showError(getApiErrorMessage(error)); 
        } finally {
            setLoading(false);
        }
    }, [limit]);

    const loadFormData = useCallback(async (signal?: AbortSignal) => {
        try {
            const [templatesData, eventsData] = await Promise.all([
                notificationsApi.listTemplatesWithoutPagination({ signal }),
                notificationsApi.listEventsWithoutPagination({ signal }),
            ]);
            setTemplates(templatesData);
            setEvents(eventsData);
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

    const handleSave = async () => {
        if (!editing) return;
        const body = fromEdit(editing);
        try {
            if (editing.id) {
              await notificationsApi.updateRule(editing.id, body);
              showSuccess('Rule updated.');
            } else { 
              await notificationsApi.createRule(body);
              showSuccess('Rule created.');
            }
            setEditing(null);
            loadData(page)
            loadFormData();
        } catch(error){
            if (axios.isAxiosError(error)) {
                const status = error.response?.status;
                if (status === 400 || status === 404) {
                    showError(error.response?.data?.error || error.message)   
                }
            } else {
                showError(getApiErrorMessage(error));
            }
        }
    };

    const handleDeactivate = () => {
        if (deactivateTarget) {
            setEditing({ ...deactivateTarget, isActive: false });
        }
        setDeactivateTarget(null);
        setShowDeactivateAlert(false);
    };

    const handleDelete = async () => {
        if(!deleteTarget) return;
        await notificationsApi.deleteRule(deleteTarget);
        showSuccess('Rule deleted');
        setDeleteTarget(null);
        setShowDeleteAlert(false);
        setIsDelete(false);
        if(rules?.data.length === 1){
            setPage(page -1);
        }
        loadData(page);
    };

    const totalProgItems = rules?.totalItems ?? 0;

    const listOfRoles = editing?._roles ?? [];

    return (
        <Box>
            <ReusableSnackbar
                snackbar={snackbar} 
                setSnackbar={setSnackbar}>
            </ReusableSnackbar>
            <Box sx={{ display: 'flex', justifyContent: 'space-between', mb: 2 }}>
                <Typography variant="subtitle1" sx={{ fontWeight: 600 }}>Notification Rules</Typography>
                <Button variant="contained" size="small" onClick={() => setEditing(toEdit(emptyRule))}>New Rule</Button>
            </Box>
            <Paper>
                {loading ? (
                    <Box sx={{ p: 3, textAlign: 'center' }}><CircularProgress size={24} /></Box>
                ) : (
                     <TableContainer component={Paper}>
                    <Table size="small">
                        <TableHead>
                            <TableRow>
                                <TableCell>Event</TableCell>
                                <TableCell>Template</TableCell>
                                <TableCell>Roles</TableCell>
                                <TableCell>CC</TableCell>
                                <TableCell>Coalesce</TableCell>
                                <TableCell>Active</TableCell>
                                <TableCell align="right">Actions</TableCell>
                            </TableRow>
                        </TableHead>
                        <TableBody>
                            {rules?.data.map(r => (
                                <TableRow key={r.id} hover>
                                    <TableCell><code>{r.eventCode}</code></TableCell>
                                    <TableCell>{r.template?.name ?? `#${r.templateId}`}</TableCell>
                                    <TableCell>{(r.recipientsConfig?.roles ?? []).join(', ')}</TableCell>
                                    <TableCell>{(r.ccConfig?.emails ?? []).join(', ')}</TableCell>
                                    <TableCell>{r.coalesceWindowSeconds ? `${r.coalesceWindowSeconds}s` : '—'}</TableCell>
                                    <TableCell>
                                        <Chip size="small" label={r.isActive ? 'Active' : 'Inactive'} color={r.isActive ? 'success' : 'default'} />
                                    </TableCell>
                                    <TableCell align="right">
                                        <IconButton size="small" onClick={() => setEditing(toEdit(r))}><EditIcon fontSize="small" /></IconButton>
                                        <IconButton size="small" onClick={() => { setDeleteTarget(r.id); setShowDeleteAlert(true); setIsDelete(true); }}><DeleteIcon fontSize="small" /></IconButton>
                                    </TableCell>
                                </TableRow>
                            ))}
                            {rules?.data.length === 0 && (
                                <TableRow><TableCell colSpan={7} align="center">No rules yet</TableCell></TableRow>
                            )}
                        </TableBody>
                    </Table>
                    <TablePagination
                        component="div"
                        count={totalProgItems}
                        page={totalProgItems > 0 ? page - 1 : 0}
                        onPageChange={(_, p) => setPage(p+1)}
                        rowsPerPage={limit}
                        rowsPerPageOptions={[limit]}
                    />
                    </TableContainer>
                )}
                {(showDeleteAlert || showDeactivateAlert) && (
                <ConfirmationDialog
                    title={isDelete ? "Delete Rule?": "Deactivate Rule?"}
                    message={isDelete ?  "Are you sure you want to delete this rule? This action cannot be undone." : "Are you sure you want to deactivate this rule?"}
                    action={isDelete ? "Delete" : "Deactivate"}
                    closeButtonText="Cancel"
                    ActionButtonColor={isDelete? "error" : "primary"}
                    confirm={isDelete ? handleDelete : handleDeactivate}
                    setShowAlert={isDelete ? setShowDeleteAlert : setShowDeactivateAlert}
                    onClose={() => {
                        const deleteOption = () => {setShowDeleteAlert(false); setIsDelete(false)};
                        /* eslint-disable @typescript-eslint/no-unused-expressions*/
                        isDelete ? deleteOption() : setShowDeactivateAlert(false);
                    }}
                />
                )}
            </Paper>

            <Dialog open={!!editing} onClose={() => {setEditing(null)}} fullWidth maxWidth="md">
                <DialogTitle>{editing?.id ? 'Edit Rule' : 'New Rule'}</DialogTitle>
                <DialogContent dividers>
                    <Box sx={{ display: 'grid', gap: 2, pt: 1 }}>
                        <TextField select label="Event" size="small" value={editing?.eventCode ?? ''}
                            onChange={e => setEditing({ ...editing!, eventCode: e.target.value })}>
                            {events.map(ev => <MenuItem key={ev.code} value={ev.code}>{ev.code}</MenuItem>)}
                        </TextField>
                        <TextField select label="Template" size="small" value={editing?.templateId ?? ''}
                            onChange={e => setEditing({ ...editing!, templateId: parseInt(e.target.value) })}>
                            {templates.map(t => <MenuItem key={t.id} value={t.id}>{t.name} ({t.transport})</MenuItem>)}
                        </TextField>
                        <TextField select label="Transport" size="small" value={editing?.transport ?? 'email'}
                            onChange={e => setEditing({ ...editing!, transport: e.target.value })}>
                            <MenuItem value="email">email</MenuItem>
                        </TextField>
                        <TextField select label="Roles" size="small" value={editing?._roles ?? []}
                            slotProps={{
                                select: {
                                multiple: true,
                                renderValue: (selected) =>
                                    (selected as string[])
                                    .map((role) => role.charAt(0).toUpperCase() + role.slice(1))
                                    .join(', ')
                                }
                            }}
                            onChange={e => {
                                const val = e.target.value;
                                const roles = Array.isArray(val) ? val : (val as string).split(',').map(s => s.trim()).filter(Boolean);
                                setEditing({ ...editing!, _roles: roles });
                            }}>
                            {rolesData.map(r => 
                            <MenuItem key={r.id} value={r.name} sx={{ textTransform: 'capitalize' }}>
                                <Checkbox checked={listOfRoles.indexOf(r.name) > -1} size='small' />
                                <ListItemText primary={r.name} />
                            </MenuItem>)}
                        </TextField>
                        <TextField select label="Scope" size="small"
                            value={editing?.recipientsConfig?.scope ?? 'project'}
                            onChange={e => setEditing({ ...editing!, recipientsConfig: { ...editing!.recipientsConfig, scope: e.target.value as string } })}>
                            <MenuItem value="project">project</MenuItem>
                            <MenuItem value="account">account</MenuItem>
                            <MenuItem value="global">global</MenuItem>
                        </TextField>
                        <TextField label="CC emails (comma separated)" size="small"
                            value={editing?._ccEmails ?? ''}
                            onChange={e => setEditing({ ...editing!, _ccEmails: e.target.value })} />
                        <TextField label="Scope project IDs (comma separated; blank = all)" size="small"
                            value={editing?._scopeProjectIds ?? ''}
                            onChange={e => setEditing({ ...editing!, _scopeProjectIds: e.target.value })} />
                        <TextField label="Scope account IDs (comma separated; blank = all)" size="small"
                            value={editing?._scopeAccountIds ?? ''}
                            onChange={e => setEditing({ ...editing!, _scopeAccountIds: e.target.value })} />
                        <TextField label="Coalesce window (seconds, 0 = immediate)" size="small" type="number"
                            value={editing?.coalesceWindowSeconds ?? 0}
                            onChange={e => setEditing({ ...editing!, coalesceWindowSeconds: parseInt(e.target.value) || 0 })} />
                        <TextField label="Coalesce key fields (comma separated)" size="small"
                            helperText="e.g. projectId — events with same key are bundled together"
                            value={editing?._coalesceKeys ?? ''}
                            onChange={e => setEditing({ ...editing!, _coalesceKeys: e.target.value })} />
                        <TextField label="Priority" size="small" type="number"
                            value={editing?.priority ?? 0}
                            onChange={e => setEditing({ ...editing!, priority: parseInt(e.target.value) || 0 })} />
                        <FormControlLabel control={<Switch checked={editing?.isActive ?? true}
                            onChange={e => {
                                const isChecked = e.target.checked;
                                if (!isChecked) {
                                    setShowDeactivateAlert(true);
                                    setDeactivateTarget(editing); 
                                } else {
                                    setEditing({ ...editing!, isActive: true });
                                }}} /> } label="Active" />
                    </Box>
                </DialogContent>
                <DialogActions>
                    <Button onClick={() => {setEditing(null)}}>Cancel</Button>
                    <Button variant="contained" onClick={handleSave}
                        disabled={!editing?.eventCode || !editing?.templateId}>Save</Button>
                </DialogActions>
            </Dialog>
        </Box>
    );
}
