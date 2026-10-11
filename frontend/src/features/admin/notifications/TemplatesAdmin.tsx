import { useCallback, useEffect, useState } from 'react';
import {
    Box, Typography, Paper, Table, TableBody, TableCell, TableHead, TableRow, Chip, Button,
    Dialog, DialogTitle, DialogContent, DialogActions, TextField, Switch, FormControlLabel,
    MenuItem, IconButton, CircularProgress,
    TableContainer,
    TablePagination,
} from '@mui/material';
import EditIcon from '@mui/icons-material/Edit';
import DeleteIcon from '@mui/icons-material/Delete';
import { notificationsApi } from './api';
import type { NotificationTemplateDto, ApiResponse } from './api';
import ConfirmationDialog from '../../../shared/components/ConfirmationDialog';
import { getApiErrorMessage } from './helper';
import axios from 'axios';
import ReusableSnackbar from '../../../shared/components/ReusableSnackbar';

const emptyTemplate: Partial<NotificationTemplateDto> = {
    code: '', name: '', transport: 'email', subjectTemplate: '', bodyTemplate: '', isActive: true,
};

export function TemplatesAdmin() {
    const [page, setPage] = useState(1);
    const limit = 10;
    const [items, setItems] = useState<ApiResponse<NotificationTemplateDto>>();
    const [loading, setLoading] = useState(true);
    const [editing, setEditing] = useState<Partial<NotificationTemplateDto> | null>(null);
    const [deleteTarget, setDeleteTarget] = useState<number | null>(null);
    const [deactivateTarget, setDeactivateTarget] = useState<Partial<NotificationTemplateDto> | null>(null);
    const [isDelete, setIsDelete] = useState(false);
    const [showDeleteAlert, setShowDeleteAlert] = useState(false);
    const [showDeactivateAlert, setShowDeactivateAlert] = useState(false);

    const [snackbar, setSnackbar] = useState<{ msg: string; severity: 'success' | 'error' } | null>(null);

    // ── Notification helpers ────────────────────────────────────────────────
    const showError = (msg: string) => { setSnackbar({ msg, severity: 'error' }); };
    const showSuccess = (msg: string) => { setSnackbar({ msg, severity: 'success' }); };
  
    const loadData = useCallback(async (pageNumber: number, signal?: AbortSignal) => {
        setLoading(true);
        try {
            const templatesData = await notificationsApi.listTemplatesWithPagination(pageNumber, limit,{signal});
            setItems(templatesData);
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

    const handleSave = async () => {
        if (!editing) return;
        try{
            if (editing.id) {
                await notificationsApi.updateTemplate(editing.id, editing);
                showSuccess('Template updated.');
            } else {
                await notificationsApi.createTemplate(editing);
                showSuccess('Template created.');
            }
            setEditing(null);
            loadData(page);
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
      try {
        if (!deleteTarget) return;
        await notificationsApi.deleteTemplate(deleteTarget);
        setDeleteTarget(null);
        showSuccess("Template deleted");
        loadData(page);
        if(items?.data.length === 1){
            setPage(page - 1);
        }
      } catch (error) {
        if (axios.isAxiosError(error)) {
          const status = error.response?.status;
          if (status === 400 || status === 404 || status === 409) {
            showError(error.response?.data?.error || error.message);
          }
        } else {
          showError(getApiErrorMessage(error));
        }
      } finally {
        setShowDeleteAlert(false);
        setIsDelete(false);
      }
    };

    const totalTemplatesItems = items?.totalItems ?? 0;

    return (
        <Box>
            <ReusableSnackbar
                snackbar={snackbar} 
                setSnackbar={setSnackbar}>
            </ReusableSnackbar>
            <Box sx={{ display: 'flex', justifyContent: 'space-between', mb: 2 }}>
                <Typography variant="subtitle1" sx={{ fontWeight: 600 }}>Templates</Typography>
                <Button variant="contained" size="small" onClick={() => setEditing({ ...emptyTemplate })}>New Template</Button>
            </Box>
            <Paper>
                {loading ? (
                    <Box sx={{ p: 3, textAlign: 'center' }}><CircularProgress size={24} /></Box>
                ) : (
                    <TableContainer component={Paper}>
                    <Table size="small">
                        <TableHead>
                            <TableRow>
                                <TableCell>Code</TableCell>
                                <TableCell>Name</TableCell>
                                <TableCell>Transport</TableCell>
                                <TableCell>Active</TableCell>
                                <TableCell align="right">Actions</TableCell>
                            </TableRow>
                        </TableHead>
                        <TableBody>
                            {items?.data.map(t => (
                                <TableRow key={t.id} hover>
                                    <TableCell><code>{t.code}</code></TableCell>
                                    <TableCell>{t.name}</TableCell>
                                    <TableCell>{t.transport}</TableCell>
                                    <TableCell>
                                        <Chip size="small" label={t.isActive ? 'Active' : 'Inactive'} color={t.isActive ? 'success' : 'default'} />
                                    </TableCell>
                                    <TableCell align="right">
                                        <IconButton size="small" onClick={() => setEditing(t)}><EditIcon fontSize="small" /></IconButton>
                                        <IconButton size="small" onClick={() => { setDeleteTarget(t.id); setShowDeleteAlert(true); setIsDelete(true); }}><DeleteIcon fontSize="small" /></IconButton>
                                    </TableCell>
                                </TableRow>
                            ))}
                            {items?.data.length === 0 && (
                                <TableRow><TableCell colSpan={5} align="center">No templates yet</TableCell></TableRow>
                            )}
                        </TableBody>
                    </Table>
                    <TablePagination
                        component="div"
                        count={totalTemplatesItems}
                        page={totalTemplatesItems > 0 ? page - 1 : 0}
                        onPageChange={(_, p) => setPage(p+1)}
                        rowsPerPage={limit}
                        rowsPerPageOptions={[limit]}
                    />
                    </TableContainer>
                )}
                {(showDeleteAlert || showDeactivateAlert) && (
                    <ConfirmationDialog
                        title={isDelete ? "Delete Template?": "Deactivate Template?"}
                        message={isDelete ?  "Are you sure you want to delete this template? This action cannot be undone." : "Are you sure you want to deactivate this template?"}
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
                <DialogTitle>{editing?.id ? 'Edit Template' : 'New Template'}</DialogTitle>
                <DialogContent dividers>
                    <Box sx={{ display: 'grid', gap: 2, pt: 1 }}>
                        <TextField label="Code" size="small" value={editing?.code ?? ''}
                            disabled={!!editing?.id}
                            onChange={e => setEditing({ ...editing!, code: e.target.value })} />
                        <TextField label="Name" size="small" value={editing?.name ?? ''}
                            onChange={e => setEditing({ ...editing!, name: e.target.value })} />
                        <TextField select label="Transport" size="small" value={editing?.transport ?? 'email'}
                            onChange={e => setEditing({ ...editing!, transport: e.target.value })}>
                            <MenuItem value="email">email</MenuItem>
                        </TextField>
                        <TextField label="Subject template (Handlebars)" size="small" value={editing?.subjectTemplate ?? ''}
                            onChange={e => setEditing({ ...editing!, subjectTemplate: e.target.value })} />
                        <TextField label="Body template (Handlebars)" multiline minRows={8} value={editing?.bodyTemplate ?? ''}
                            onChange={e => setEditing({ ...editing!, bodyTemplate: e.target.value })} />
                        <FormControlLabel control={<Switch checked={editing?.isActive ?? true}
                            onChange={e => {
                                const isChecked = e.target.checked;
                                if (!isChecked) {
                                    setShowDeactivateAlert(true);
                                    setDeactivateTarget(editing); 
                                } else {
                                    setEditing({ ...editing!, isActive: true });
                                }}} /> } label="Active" />
                        <Typography variant="caption" color="text.secondary">
                            Available placeholders: &#123;&#123;count&#125;&#125;, &#123;&#123;project.name&#125;&#125;, &#123;&#123;actor.name&#125;&#125;,
                            and iterate with &#123;&#123;#each events&#125;&#125;...&#123;&#123;/each&#125;&#125;.
                        </Typography>
                    </Box>
                </DialogContent>
                <DialogActions>
                    <Button onClick={() => {setEditing(null)}}>Cancel</Button>
                    <Button variant="contained" onClick={handleSave}
                        disabled={!editing?.code || !editing?.name || !editing?.bodyTemplate}>Save</Button>
                </DialogActions>
            </Dialog>
        </Box>
    );
}
