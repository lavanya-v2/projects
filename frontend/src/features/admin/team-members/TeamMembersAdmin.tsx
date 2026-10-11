import { useState } from 'react';
import {
    Box, Button, Dialog, DialogTitle, DialogContent, DialogActions,
    TextField, Table, TableHead, TableRow, TableCell, TableBody,
    IconButton, Typography, Alert, CircularProgress, Tooltip,
    Paper, TableContainer, Chip, Stack, FormControlLabel, Switch
} from '@mui/material';
import { Add, Edit, Delete } from '@mui/icons-material';
import { useAdminTeamMembers, useAdminCreateTeamMember, useAdminUpdateTeamMember, useAdminDeleteTeamMember } from './hooks';

interface MemberForm {
    firstName: string;
    lastName: string;
    email: string;
    jiraLoginId: string;
    partnerEmailId: string;
    v2Member: boolean;
}

const empty: MemberForm = { firstName: '', lastName: '', email: '', jiraLoginId: '', partnerEmailId: '', v2Member: true };

export function TeamMembersAdmin() {
    const [error, setError] = useState('');
    const [success, setSuccess] = useState('');

    const [dialogOpen, setDialogOpen] = useState(false);
    const [editing, setEditing] = useState<any | null>(null);
    const [form, setForm] = useState<MemberForm>(empty);
    const [saving, setSaving] = useState(false);

    const [confirmDelete, setConfirmDelete] = useState<any | null>(null);

    const { data: members = [], isLoading: loading } = useAdminTeamMembers();
    const createTeamMember = useAdminCreateTeamMember();
    const updateTeamMember = useAdminUpdateTeamMember();
    const deleteTeamMember = useAdminDeleteTeamMember();

    const openCreate = () => { setEditing(null); setForm(empty); setDialogOpen(true); };
    const openEdit = (m: any) => {
        setEditing(m);
        setForm({ firstName: m.firstName, lastName: m.lastName, email: m.email, jiraLoginId: m.jiraLoginId, partnerEmailId: m.partnerEmailId || '', v2Member: m.v2Member !== false });
        setDialogOpen(true);
    };

    const handleSave = async () => {
        setSaving(true);
        setError('');
        try {
            if (editing) {
                await updateTeamMember.mutateAsync({ id: editing.id, data: form });
                setSuccess('Team member updated');
            } else {
                await createTeamMember.mutateAsync(form);
                setSuccess('Team member created');
            }
            setDialogOpen(false);
        } catch (e: any) {
            setError(e.response?.data?.message || 'Save failed');
        } finally {
            setSaving(false);
        }
    };

    const handleDelete = async () => {
        if (!confirmDelete) return;
        setError('');
        try {
            await deleteTeamMember.mutateAsync(confirmDelete.id);
            setSuccess('Team member deleted (project associations removed)');
            setConfirmDelete(null);
        } catch (e: any) {
            setError(e.response?.data?.message || 'Delete failed');
            setConfirmDelete(null);
        }
    };

    const getProjects = (member: any): string[] => {
        if (!member.accountAssociations) return [];
        return member.accountAssociations
            .filter((a: any) => a.project)
            .map((a: any) => a.project.name);
    };

    return (
        <Box>
            <Box sx={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', mb: 2 }}>
                <Typography variant="h6">Team Members</Typography>
                <Button variant="contained" startIcon={<Add />} onClick={openCreate}>Add Member</Button>
            </Box>
            {error && <Alert severity="error" sx={{ mb: 2 }} onClose={() => setError('')}>{error}</Alert>}
            {success && <Alert severity="success" sx={{ mb: 2 }} onClose={() => setSuccess('')}>{success}</Alert>}

            {loading ? <CircularProgress /> : (
                <TableContainer component={Paper} elevation={0} sx={{ border: '1px solid', borderColor: 'divider' }}>
                    <Table size="small">
                        <TableHead sx={{ bgcolor: '#f5f5f5' }}>
                            <TableRow>
                                <TableCell><b>Name</b></TableCell>
                                <TableCell><b>Email</b></TableCell>
                                <TableCell><b>Jira Login ID</b></TableCell>
                                <TableCell><b>Partner Email</b></TableCell>
                                <TableCell><b>Internal</b></TableCell>
                                <TableCell><b>Projects</b></TableCell>
                                <TableCell align="right"><b>Actions</b></TableCell>
                            </TableRow>
                        </TableHead>
                        <TableBody>
                            {members.map(m => (
                                <TableRow key={m.id} hover>
                                    <TableCell>{m.firstName} {m.lastName}</TableCell>
                                    <TableCell>{m.email}</TableCell>
                                    <TableCell><Typography variant="caption" sx={{ fontFamily: 'monospace' }}>{m.jiraLoginId}</Typography></TableCell>
                                    <TableCell>{m.partnerEmailId || '—'}</TableCell>
                                    <TableCell>
                                        <Chip
                                            label={m.v2Member !== false ? 'V2' : 'External'}
                                            size="small"
                                            color={m.v2Member !== false ? 'primary' : 'default'}
                                            variant={m.v2Member !== false ? 'filled' : 'outlined'}
                                        />
                                    </TableCell>
                                    <TableCell>
                                        <Stack direction="row" spacing={0.5} flexWrap="wrap" useFlexGap>
                                            {getProjects(m).map(p => <Chip key={p} label={p} size="small" variant="outlined" />)}
                                            {getProjects(m).length === 0 && <Typography variant="caption" color="text.secondary">None</Typography>}
                                        </Stack>
                                    </TableCell>
                                    <TableCell align="right">
                                        <Tooltip title="Edit"><IconButton size="small" onClick={() => openEdit(m)}><Edit fontSize="small" /></IconButton></Tooltip>
                                        <Tooltip title="Delete"><IconButton size="small" color="error" onClick={() => setConfirmDelete(m)}><Delete fontSize="small" /></IconButton></Tooltip>
                                    </TableCell>
                                </TableRow>
                            ))}
                            {members.length === 0 && (
                                <TableRow><TableCell colSpan={7} align="center">No team members found</TableCell></TableRow>
                            )}
                        </TableBody>
                    </Table>
                </TableContainer>
            )}

            {/* Create / Edit Dialog */}
            <Dialog open={dialogOpen} onClose={() => setDialogOpen(false)} maxWidth="sm" fullWidth>
                <DialogTitle>{editing ? 'Edit Team Member' : 'New Team Member'}</DialogTitle>
                <DialogContent sx={{ display: 'flex', flexDirection: 'column', gap: 2, pt: 2 }}>
                    <Box sx={{ display: 'flex', gap: 2 }}>
                        <TextField label="First Name" value={form.firstName} onChange={e => setForm(f => ({ ...f, firstName: e.target.value }))} required fullWidth />
                        <TextField label="Last Name" value={form.lastName} onChange={e => setForm(f => ({ ...f, lastName: e.target.value }))} required fullWidth />
                    </Box>
                    <TextField label="Email" type="email" value={form.email} onChange={e => setForm(f => ({ ...f, email: e.target.value }))} required fullWidth />
                    <TextField label="Jira Login ID" value={form.jiraLoginId} onChange={e => setForm(f => ({ ...f, jiraLoginId: e.target.value }))} required fullWidth helperText="Jira account email used for matching" />
                    <TextField label="Partner Email ID" value={form.partnerEmailId} onChange={e => setForm(f => ({ ...f, partnerEmailId: e.target.value }))} fullWidth helperText="Optional alternate email (e.g. client org)" />
                    <FormControlLabel
                        control={
                            <Switch
                                checked={form.v2Member}
                                onChange={e => setForm(f => ({ ...f, v2Member: e.target.checked }))}
                            />
                        }
                        label="Internal Team Member"
                    />
                </DialogContent>
                <DialogActions>
                    <Button onClick={() => setDialogOpen(false)}>Cancel</Button>
                    <Button variant="contained" onClick={handleSave} disabled={saving || !form.firstName || !form.lastName || !form.email || !form.jiraLoginId}>
                        {saving ? <CircularProgress size={18} /> : 'Save'}
                    </Button>
                </DialogActions>
            </Dialog>

            {/* Delete Confirmation */}
            <Dialog open={!!confirmDelete} onClose={() => setConfirmDelete(null)} maxWidth="xs" fullWidth>
                <DialogTitle>Delete Team Member?</DialogTitle>
                <DialogContent>
                    <Typography>Delete <b>{confirmDelete?.firstName} {confirmDelete?.lastName}</b>? All project assignments will also be removed.</Typography>
                </DialogContent>
                <DialogActions>
                    <Button onClick={() => setConfirmDelete(null)}>Cancel</Button>
                    <Button variant="contained" color="error" onClick={handleDelete}>Delete</Button>
                </DialogActions>
            </Dialog>
        </Box>
    );
}
