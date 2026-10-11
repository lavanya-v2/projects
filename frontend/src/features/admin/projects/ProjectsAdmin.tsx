import { useState } from 'react';
import {
    Box, Button, Dialog, DialogTitle, DialogContent, DialogActions,
    TextField, Table, TableHead, TableRow, TableCell, TableBody,
    IconButton, Typography, Alert, CircularProgress, Tooltip,
    Paper, TableContainer, Select, MenuItem, FormControl, InputLabel,
    Switch, FormControlLabel, Divider, Chip, Autocomplete,
    Accordion, AccordionSummary, AccordionDetails, RadioGroup, Radio, FormLabel
} from '@mui/material';
import { Add, Edit, Delete, Group, ArrowBack, CheckCircle, Error as ErrorIcon, ExpandMore } from '@mui/icons-material';
import {
    useAdminProjects, useAdminCreateProject, useAdminUpdateProject, useAdminDeleteProject,
    useAdminAddProjectMember, useAdminRemoveProjectMember, useTestJira,
} from './hooks';
import { useAdminAccounts } from '../accounts/hooks';
import { useAdminTeamMembers } from '../team-members/hooks';
import { client } from '../../../api/client';
import { closeOnEscapeOnly, DialogCloseButton } from '../../../shared/components/dialogHelpers';

interface LaneFormConfig {
    assigneeMode: 'separate' | 'shared';
    todo: string;
    in_progress: string;
    blocked: string;
    in_review: string;
    qa: string;
    uat: string;
    done: string;
    reopened: string;
}

type LaneKey = 'todo' | 'in_progress' | 'blocked' | 'in_review' | 'qa' | 'uat' | 'done' | 'reopened';

const LANE_DEFAULTS: Record<LaneKey, string> = {
    todo: 'TODO, To Do, Backlog',
    in_progress: 'In Progress, In Development',
    blocked: 'Blocked, Impediment',
    in_review: 'DEV COMPLETE, PR REVIEW, Code Review',
    qa: 'QA, Testing, In QA',
    uat: 'PO REVIEW, UAT, Acceptance Testing',
    done: 'DONE, Done, Closed',
    reopened: 'REOPENED, Reopened, Issues Found',
};

const LANE_LABELS: Record<LaneKey, string> = {
    todo: 'To Do',
    in_progress: 'In Progress',
    blocked: 'Blocked',
    in_review: 'In Review',
    qa: 'QA / Testing',
    uat: 'UAT / Acceptance',
    done: 'Done',
    reopened: 'Reopened',
};

const emptyLaneConfig = (): LaneFormConfig => ({ assigneeMode: 'separate', todo: '', in_progress: '', blocked: '', in_review: '', qa: '', uat: '', done: '', reopened: '' });

function laneConfigFromProject(jiraLaneConfig: any): LaneFormConfig {
    if (!jiraLaneConfig) return emptyLaneConfig();
    const toStr = (v: any) => Array.isArray(v) ? v.join(', ') : (v || '');
    return {
        assigneeMode: jiraLaneConfig.assigneeMode === 'shared' ? 'shared' : 'separate',
        todo: toStr(jiraLaneConfig.todo),
        in_progress: toStr(jiraLaneConfig.in_progress),
        blocked: toStr(jiraLaneConfig.blocked),
        in_review: toStr(jiraLaneConfig.in_review),
        qa: toStr(jiraLaneConfig.qa),
        uat: toStr(jiraLaneConfig.uat),
        done: toStr(jiraLaneConfig.done),
        reopened: toStr(jiraLaneConfig.reopened),
    };
}

function laneConfigToPayload(lc: LaneFormConfig): Record<string, any> | null {
    const result: Record<string, any> = {};
    if (lc.assigneeMode === 'shared') result.assigneeMode = 'shared';
    (Object.keys(LANE_LABELS) as LaneKey[]).forEach(key => {
        const vals = lc[key].split(',').map(s => s.trim()).filter(Boolean);
        if (vals.length > 0) result[key] = vals;
    });
    return Object.keys(result).length > 0 ? result : null;
}

interface ProjectForm {
    name: string;
    code: string;
    accountId: number | '';
    jiraBoardId: number | '';
    jiraName: string;
    jiraBaseUrl: string;
    jiraEmail: string;
    jiraApiToken: string;
    isSharedTeam: boolean;
    isKanbanProject: boolean;
    piiRedactionEnabled: boolean;
    kanbanDoneStatuses: string;
    laneConfig: LaneFormConfig;
}

const emptyForm = (): ProjectForm => ({
    name: '', code: '', accountId: '', jiraBoardId: '', jiraName: '',
    jiraBaseUrl: '', jiraEmail: '', jiraApiToken: '',
    isSharedTeam: false, isKanbanProject: false, piiRedactionEnabled: true, kanbanDoneStatuses: '',
    laneConfig: emptyLaneConfig(),
});

type View = 'list' | 'members';

export function ProjectsAdmin() {
    const [view, setView] = useState<View>('list');
    const [error, setError] = useState('');
    const [success, setSuccess] = useState('');

    const { data: projects = [], isLoading: projectsLoading } = useAdminProjects();
    const { data: accounts = [], isLoading: accountsLoading } = useAdminAccounts();
    const { data: allMembers = [] } = useAdminTeamMembers();
    const loading = projectsLoading || accountsLoading;

    const createProject = useAdminCreateProject();
    const updateProject = useAdminUpdateProject();
    const deleteProject = useAdminDeleteProject();
    const addProjectMember = useAdminAddProjectMember();
    const removeProjectMember = useAdminRemoveProjectMember();
    const testJira = useTestJira();

    // Project CRUD
    const [dialogOpen, setDialogOpen] = useState(false);
    const [editing, setEditing] = useState<any | null>(null);
    const [form, setForm] = useState<ProjectForm>(emptyForm());
    const [saving, setSaving] = useState(false);
    const [confirmDelete, setConfirmDelete] = useState<any | null>(null);

    // Jira test connection
    const [testingJira, setTestingJira] = useState(false);
    const [jiraTestResult, setJiraTestResult] = useState<{ ok: boolean; label: string } | null>(null);

    // Team member view
    const [selectedProject, setSelectedProject] = useState<any | null>(null);
    const [members, setMembers] = useState<any[]>([]);
    const [membersLoading, setMembersLoading] = useState(false);
    const [addMemberId, setAddMemberId] = useState<any | null>(null);
    const [addMemberRole, setAddMemberRole] = useState('Backend Developer');
    const [addMemberOpen, setAddMemberOpen] = useState(false);

    const openCreate = () => { setEditing(null); setForm(emptyForm()); setJiraTestResult(null); setDialogOpen(true); };
    const openEdit = (p: any) => {
        setEditing(p);
        setForm({
            name: p.name, code: p.code, accountId: p.accountId,
            jiraBoardId: p.jiraBoardId, jiraName: p.jiraName || '',
            jiraBaseUrl: p.jiraBaseUrl || '', jiraEmail: p.jiraEmail || '',
            jiraApiToken: p.jiraApiToken || '',
            isSharedTeam: !!p.isSharedTeam, isKanbanProject: !!p.isKanbanProject,
            // !== false, not !!: rows fetched before the API change would otherwise read as opted-out.
            piiRedactionEnabled: p.piiRedactionEnabled !== false,
            kanbanDoneStatuses: Array.isArray(p.kanbanDoneStatuses) ? p.kanbanDoneStatuses.join(', ') : (p.kanbanDoneStatuses || ''),
            laneConfig: laneConfigFromProject(p.jiraLaneConfig),
        });
        setJiraTestResult(null);
        setDialogOpen(true);
    };

    const handleTestJira = async () => {
        setTestingJira(true);
        setJiraTestResult(null);
        try {
            const result = await testJira.mutateAsync({
                jiraBaseUrl: form.jiraBaseUrl,
                jiraEmail: form.jiraEmail,
                jiraApiToken: form.jiraApiToken,
                jiraBoardId: Number(form.jiraBoardId),
            });
            setJiraTestResult({ ok: true, label: `Connected: "${result.boardName}" (${result.boardType})` });
        } catch (e: any) {
            const msg = e.response?.data?.message || 'Connection failed';
            setJiraTestResult({ ok: false, label: msg });
        } finally {
            setTestingJira(false);
        }
    };

    const handleSave = async () => {
        setSaving(true);
        setError('');
        try {
            const { laneConfig, ...rest } = form;
            const payload = {
                ...rest,
                kanbanDoneStatuses: form.kanbanDoneStatuses
                    ? form.kanbanDoneStatuses.split(',').map(s => s.trim()).filter(Boolean)
                    : null,
                jiraLaneConfig: laneConfigToPayload(laneConfig),
            };
            if (editing) {
                await updateProject.mutateAsync({ id: editing.id, data: payload });
                setSuccess('Project updated');
            } else {
                await createProject.mutateAsync(payload);
                setSuccess('Project created');
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
            await deleteProject.mutateAsync(confirmDelete.id);
            setSuccess('Project deleted');
            setConfirmDelete(null);
        } catch (e: any) {
            setError(e.response?.data?.message || 'Delete failed');
            setConfirmDelete(null);
        }
    };

    // Member management
    const openMembers = async (project: any) => {
        setSelectedProject(project);
        setMembersLoading(true);
        setView('members');
        try {
            const res = await client.get<any>(`/admin/projects/${project.id}/members`);
            setMembers(res.data.data);
        } catch (e: any) {
            setError(e.response?.data?.message || 'Failed to load members');
        } finally {
            setMembersLoading(false);
        }
    };

    const handleAddMember = async () => {
        if (!addMemberId || !selectedProject) return;
        setError('');
        try {
            await addProjectMember.mutateAsync({ projectId: selectedProject.id, teamMemberId: addMemberId.id, role: addMemberRole });
            setSuccess('Member added');
            setAddMemberOpen(false);
            setAddMemberId(null);
            setAddMemberRole('Backend Developer');
            const res = await client.get<any>(`/admin/projects/${selectedProject.id}/members`);
            setMembers(res.data.data);
        } catch (e: any) {
            setError(e.response?.data?.message || 'Add failed');
        }
    };

    const handleRemoveMember = async (memberId: number) => {
        if (!selectedProject) return;
        setError('');
        try {
            await removeProjectMember.mutateAsync({ projectId: selectedProject.id, teamMemberId: memberId });
            setSuccess('Member removed');
            setMembers(prev => prev.filter(m => m.id !== memberId));
        } catch (e: any) {
            setError(e.response?.data?.message || 'Remove failed');
        }
    };

    const assignedIds = new Set(members.map(m => m.id));
    const availableToAdd = allMembers.filter(m => !assignedIds.has(m.id));

    if (view === 'members' && selectedProject) {
        return (
            <Box>
                <Box sx={{ display: 'flex', alignItems: 'center', gap: 1, mb: 2 }}>
                    <IconButton onClick={() => setView('list')}><ArrowBack /></IconButton>
                    <Box>
                        <Typography variant="h6">{selectedProject.name} — Team Members</Typography>
                        <Typography variant="caption" color="text.secondary">{selectedProject.code} · {selectedProject.account?.name}</Typography>
                    </Box>
                    <Box sx={{ ml: 'auto' }}>
                        <Button variant="contained" startIcon={<Add />} onClick={() => setAddMemberOpen(true)} disabled={availableToAdd.length === 0}>
                            Add Member
                        </Button>
                    </Box>
                </Box>
                {error && <Alert severity="error" sx={{ mb: 2 }} onClose={() => setError('')}>{error}</Alert>}
                {success && <Alert severity="success" sx={{ mb: 2 }} onClose={() => setSuccess('')}>{success}</Alert>}

                {membersLoading ? <CircularProgress /> : (
                    <TableContainer component={Paper} elevation={0} sx={{ border: '1px solid', borderColor: 'divider' }}>
                        <Table size="small">
                            <TableHead sx={{ bgcolor: '#f5f5f5' }}>
                                <TableRow>
                                    <TableCell><b>Name</b></TableCell>
                                    <TableCell><b>Email</b></TableCell>
                                    <TableCell><b>Jira Login ID</b></TableCell>
                                    <TableCell><b>Role</b></TableCell>
                                    <TableCell align="right"><b>Actions</b></TableCell>
                                </TableRow>
                            </TableHead>
                            <TableBody>
                                {members.map(m => (
                                    <TableRow key={m.id} hover>
                                        <TableCell>{m.firstName} {m.lastName}</TableCell>
                                        <TableCell>{m.email}</TableCell>
                                        <TableCell><Typography variant="caption" sx={{ fontFamily: 'monospace' }}>{m.jiraLoginId}</Typography></TableCell>
                                        <TableCell><Chip label={m.role || 'Developer'} size="small" variant="outlined" /></TableCell>
                                        <TableCell align="right">
                                            <Tooltip title="Remove from project">
                                                <IconButton size="small" color="error" onClick={() => handleRemoveMember(m.id)}><Delete fontSize="small" /></IconButton>
                                            </Tooltip>
                                        </TableCell>
                                    </TableRow>
                                ))}
                                {members.length === 0 && (
                                    <TableRow><TableCell colSpan={5} align="center">No members assigned to this project</TableCell></TableRow>
                                )}
                            </TableBody>
                        </Table>
                    </TableContainer>
                )}

                {/* Add Member Dialog */}
                <Dialog open={addMemberOpen} onClose={closeOnEscapeOnly(() => setAddMemberOpen(false))} maxWidth="sm" fullWidth>
                    <DialogTitle sx={{ pr: 6 }}>
                      Add Team Member to {selectedProject.name}
                      <DialogCloseButton onClick={() => setAddMemberOpen(false)} />
                    </DialogTitle>
                    <DialogContent sx={{ display: 'flex', flexDirection: 'column', gap: 2, pt: 2 }}>
                        <Autocomplete
                            options={availableToAdd}
                            getOptionLabel={(m: any) => `${m.firstName} ${m.lastName} (${m.email})`}
                            value={addMemberId}
                            onChange={(_, v) => setAddMemberId(v)}
                            renderInput={(params) => <TextField {...params} label="Team Member" required />}
                        />
                        <FormControl fullWidth>
                            <InputLabel>Role in Project</InputLabel>
                            <Select value={addMemberRole} label="Role in Project" onChange={e => setAddMemberRole(e.target.value)}>
                                {['Developer', 'Backend Developer', 'VueJS Developer', 'CSS Developer', 'Database', 'QA', 'DevOps', 'RPA', 'Data Engineer'].map(r => (
                                    <MenuItem key={r} value={r}>{r}</MenuItem>
                                ))}
                            </Select>
                        </FormControl>
                    </DialogContent>
                    <DialogActions>
                        <Button onClick={() => setAddMemberOpen(false)}>Cancel</Button>
                        <Button variant="contained" onClick={handleAddMember} disabled={!addMemberId}>Add</Button>
                    </DialogActions>
                </Dialog>
            </Box>
        );
    }

    return (
        <Box>
            <Box sx={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', mb: 2 }}>
                <Typography variant="h6">Projects</Typography>
                <Button variant="contained" startIcon={<Add />} onClick={openCreate}>Add Project</Button>
            </Box>
            {error && <Alert severity="error" sx={{ mb: 2 }} onClose={() => setError('')}>{error}</Alert>}
            {success && <Alert severity="success" sx={{ mb: 2 }} onClose={() => setSuccess('')}>{success}</Alert>}

            {loading ? <CircularProgress /> : (
                <TableContainer component={Paper} elevation={0} sx={{ border: '1px solid', borderColor: 'divider' }}>
                    <Table size="small">
                        <TableHead sx={{ bgcolor: '#f5f5f5' }}>
                            <TableRow>
                                <TableCell><b>Name</b></TableCell>
                                <TableCell><b>Code</b></TableCell>
                                <TableCell><b>Account</b></TableCell>
                                <TableCell><b>Board ID</b></TableCell>
                                <TableCell><b>Type</b></TableCell>
                                <TableCell align="right"><b>Actions</b></TableCell>
                            </TableRow>
                        </TableHead>
                        <TableBody>
                            {projects.map(p => (
                                <TableRow key={p.id} hover>
                                    <TableCell>{p.name}</TableCell>
                                    <TableCell><code>{p.code}</code></TableCell>
                                    <TableCell>{p.account?.name || '—'}</TableCell>
                                    <TableCell>{p.jiraBoardId}</TableCell>
                                    <TableCell>
                                        {p.isKanbanProject
                                            ? <Chip label="Kanban" size="small" color="secondary" />
                                            : <Chip label="Scrum" size="small" color="primary" variant="outlined" />}
                                        {p.isSharedTeam && <Chip label="Shared" size="small" sx={{ ml: 0.5 }} />}
                                    </TableCell>
                                    <TableCell align="right">
                                        <Tooltip title="Manage team members">
                                            <IconButton size="small" onClick={() => openMembers(p)}><Group fontSize="small" /></IconButton>
                                        </Tooltip>
                                        <Tooltip title="Edit">
                                            <IconButton size="small" onClick={() => openEdit(p)}><Edit fontSize="small" /></IconButton>
                                        </Tooltip>
                                        <Tooltip title="Delete">
                                            <IconButton size="small" color="error" onClick={() => setConfirmDelete(p)}><Delete fontSize="small" /></IconButton>
                                        </Tooltip>
                                    </TableCell>
                                </TableRow>
                            ))}
                            {projects.length === 0 && (
                                <TableRow><TableCell colSpan={6} align="center">No projects found</TableCell></TableRow>
                            )}
                        </TableBody>
                    </Table>
                </TableContainer>
            )}

            {/* Create / Edit Dialog */}
            <Dialog open={dialogOpen} onClose={closeOnEscapeOnly(() => setDialogOpen(false))} maxWidth="md" fullWidth>
                <DialogTitle sx={{ pr: 6 }}>
                  {editing ? 'Edit Project' : 'New Project'}
                  <DialogCloseButton onClick={() => setDialogOpen(false)} />
                </DialogTitle>
                <DialogContent sx={{ display: 'flex', flexDirection: 'column', gap: 2, pt: 2 }}>
                    <Box sx={{ display: 'flex', gap: 2 }}>
                        <TextField label="Project Name" value={form.name} onChange={e => setForm(f => ({ ...f, name: e.target.value }))} required fullWidth />
                        <TextField label="Code" value={form.code} onChange={e => setForm(f => ({ ...f, code: e.target.value.toUpperCase() }))} required fullWidth helperText="Short unique code (e.g. SC)" />
                    </Box>
                    <FormControl required fullWidth>
                        <InputLabel>Account</InputLabel>
                        <Select value={form.accountId} label="Account" onChange={e => setForm(f => ({ ...f, accountId: Number(e.target.value) }))}>
                            {accounts.map(a => <MenuItem key={a.id} value={a.id}>{a.name}</MenuItem>)}
                        </Select>
                    </FormControl>
                    <Divider><Typography variant="caption" color="text.secondary">Jira Configuration</Typography></Divider>
                    <Box sx={{ display: 'flex', gap: 2 }}>
                        <TextField label="Jira Board ID" type="number" value={form.jiraBoardId} onChange={e => setForm(f => ({ ...f, jiraBoardId: Number(e.target.value) }))} required fullWidth />
                        <TextField label="Jira Name" value={form.jiraName} onChange={e => setForm(f => ({ ...f, jiraName: e.target.value }))} fullWidth helperText="Display name in Jira" />
                    </Box>
                    <TextField label="Jira Base URL" value={form.jiraBaseUrl} onChange={e => setForm(f => ({ ...f, jiraBaseUrl: e.target.value }))} required fullWidth placeholder="https://yourorg.atlassian.net" />
                    <Box sx={{ display: 'flex', gap: 2 }}>
                        <TextField label="Jira Email" type="email" value={form.jiraEmail} onChange={e => { setForm(f => ({ ...f, jiraEmail: e.target.value })); setJiraTestResult(null); }} fullWidth />
                        <TextField label="Jira API Token" type="password" value={form.jiraApiToken} onChange={e => { setForm(f => ({ ...f, jiraApiToken: e.target.value })); setJiraTestResult(null); }} fullWidth />
                    </Box>
                    <Box sx={{ display: 'flex', alignItems: 'center', gap: 2 }}>
                        <Button
                            variant="outlined" size="small"
                            onClick={handleTestJira}
                            disabled={testingJira || !form.jiraBaseUrl || !form.jiraEmail || !form.jiraApiToken || !form.jiraBoardId}
                        >
                            {testingJira ? <CircularProgress size={14} sx={{ mr: 1 }} /> : null}
                            Test Jira Connection
                        </Button>
                        {jiraTestResult && (
                            <Box sx={{ display: 'flex', alignItems: 'center', gap: 0.5 }}>
                                {jiraTestResult.ok
                                    ? <CheckCircle fontSize="small" color="success" />
                                    : <ErrorIcon fontSize="small" color="error" />}
                                <Typography variant="caption" color={jiraTestResult.ok ? 'success.main' : 'error.main'}>
                                    {jiraTestResult.label}
                                </Typography>
                            </Box>
                        )}
                    </Box>
                    <Divider><Typography variant="caption" color="text.secondary">Settings</Typography></Divider>
                    <Box sx={{ display: 'flex', gap: 4 }}>
                        <FormControlLabel control={<Switch checked={form.isKanbanProject} onChange={e => setForm(f => ({ ...f, isKanbanProject: e.target.checked }))} />} label="Kanban project (no sprint tracking)" />
                        <FormControlLabel control={<Switch checked={form.isSharedTeam} onChange={e => setForm(f => ({ ...f, isSharedTeam: e.target.checked }))} />} label="Shared team" />
                    </Box>
                    <FormControlLabel
                        control={<Switch checked={form.piiRedactionEnabled} onChange={e => setForm(f => ({ ...f, piiRedactionEnabled: e.target.checked }))} />}
                        label="Redact personal data from ticket titles (recommended)"
                    />
                    <TextField
                        label="Done Statuses (override)"
                        value={form.kanbanDoneStatuses}
                        onChange={e => setForm(f => ({ ...f, kanbanDoneStatuses: e.target.value }))}
                        fullWidth
                        helperText="Comma-separated Jira status names that count as Done for this project. Overrides Jira's default status-category detection — use this when a board's terminal column (e.g. &quot;Closed&quot;) differs from a status Jira itself marks Done (e.g. &quot;Resolved&quot;). Leave blank to use Jira's defaults."
                    />
                    <Accordion disableGutters elevation={0} sx={{ border: '1px solid', borderColor: 'divider', '&:before': { display: 'none' } }}>
                        <AccordionSummary expandIcon={<ExpandMore />}>
                            <Typography variant="body2" fontWeight={500}>Lane Configuration</Typography>
                            <Typography variant="caption" color="text.secondary" sx={{ ml: 1, alignSelf: 'center' }}>
                                {(form.laneConfig.assigneeMode === 'shared' || (Object.keys(LANE_LABELS) as LaneKey[]).some(k => form.laneConfig[k])) ? 'Custom' : 'Using defaults'}
                            </Typography>
                        </AccordionSummary>
                        <AccordionDetails>
                            <Box sx={{ mb: 2 }}>
                                <FormLabel component="legend">
                                    <Typography variant="caption" fontWeight={500}>Assignee Mode</Typography>
                                </FormLabel>
                                <RadioGroup
                                    row
                                    value={form.laneConfig.assigneeMode}
                                    onChange={e => setForm(f => ({ ...f, laneConfig: { ...f.laneConfig, assigneeMode: e.target.value as 'separate' | 'shared' } }))}
                                >
                                    <FormControlLabel value="separate" control={<Radio size="small" />} label={<Typography variant="caption">Separate — Dev and QA are different Jira users (default)</Typography>} />
                                    <FormControlLabel value="shared" control={<Radio size="small" />} label={<Typography variant="caption">Shared — Same assignee field for Dev and QA; changelog used to find developer</Typography>} />
                                </RadioGroup>
                            </Box>
                            <Typography variant="caption" color="text.secondary" sx={{ display: 'block', mb: 2 }}>
                                Map Jira status names to workflow lanes. Leave blank to use system defaults. Comma-separated, case-insensitive.
                            </Typography>
                            <Box sx={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 2 }}>
                                {(Object.keys(LANE_LABELS) as LaneKey[]).map(lane => (
                                    <TextField
                                        key={lane}
                                        label={LANE_LABELS[lane]}
                                        value={form.laneConfig[lane]}
                                        onChange={e => setForm(f => ({ ...f, laneConfig: { ...f.laneConfig, [lane]: e.target.value } }))}
                                        fullWidth
                                        size="small"
                                        placeholder={LANE_DEFAULTS[lane]}
                                    />
                                ))}
                            </Box>
                        </AccordionDetails>
                    </Accordion>
                </DialogContent>
                <DialogActions>
                    <Button onClick={() => setDialogOpen(false)}>Cancel</Button>
                    <Button variant="contained" onClick={handleSave} disabled={saving || !form.name || !form.code || !form.accountId || !form.jiraBoardId || !form.jiraBaseUrl}>
                        {saving ? <CircularProgress size={18} /> : 'Save'}
                    </Button>
                </DialogActions>
            </Dialog>

            {/* Delete Confirmation */}
            <Dialog open={!!confirmDelete} onClose={closeOnEscapeOnly(() => setConfirmDelete(null))} maxWidth="xs" fullWidth>
                <DialogTitle sx={{ pr: 6 }}>
                  Delete Project?
                  <DialogCloseButton onClick={() => setConfirmDelete(null)} />
                </DialogTitle>
                <DialogContent>
                    <Typography>Delete <b>{confirmDelete?.name}</b>? This cannot be undone.</Typography>
                </DialogContent>
                <DialogActions>
                    <Button onClick={() => setConfirmDelete(null)}>Cancel</Button>
                    <Button variant="contained" color="error" onClick={handleDelete}>Delete</Button>
                </DialogActions>
            </Dialog>
        </Box>
    );
}
