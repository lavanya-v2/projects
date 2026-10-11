import { useState, useEffect } from 'react';
import {
    Dialog, DialogTitle, DialogContent, DialogActions,
    Button, TextField, MenuItem, Alert, Box, Typography,
    Autocomplete, useMediaQuery, useTheme,
} from '@mui/material';
import { useCreateRisk, useRiskSuperusers } from './hooks';
import { useAccountsQuery } from '../admin/accounts/hooks';
import { useProjects } from '../auth/hooks';
import type { RiskSource, RiskPriority, CreateRiskPayload } from '../../types/risk';
import { DatePicker } from '@mui/x-date-pickers';
import dayjs from 'dayjs';
import z from 'zod';
import { Controller, useForm } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';

interface Account {
    id: number;
    name: string;
}

interface User {
    id: number;
    userId: string;
    firstName: string;
    lastName: string;
    role: 'USER' | 'SUPERUSER';
    password: string;
    roleName?: string;
}

interface RiskCreateModalProps {
    open: boolean;
    onClose: () => void;
    onCreated: () => void;
    user?: User ;
}

const riskSchema = z.object({
    title: z.string().min(1, {message: 'Title is required'}),
    description: z.string().min(1,{message: 'Description is required'}),
    source: z.custom<RiskSource>((val) => typeof val === 'string'),
    priority: z.custom<RiskPriority>((val) => typeof val === 'string'),
    notifiedDate: z
        .string()
        .refine((value) => {
            if (!value) return true;
            const today = dayjs();
            const pastDate = today.subtract(1, 'day');
            const notifiedDate = dayjs(value);
            return notifiedDate.isAfter(pastDate);
        }, {
            message: "Notified date cannot be past date from today's date",
        })
        .refine((value) => {
            if (!value) return true;
            const today = dayjs();
            const maxDate = today.add(4, 'month');
            const notifiedDate = dayjs(value);
            return notifiedDate.isBefore(maxDate);
        }, {
            message: "Notified date should be within 4 months from today",
        }),
    assigneeId: z.number().optional(),
    projectId: z.number().optional()
})

const SOURCES: RiskSource[] = ['CLIENT', 'INTERNAL'];
const PRIORITIES: RiskPriority[] = ['CRITICAL', 'HIGH', 'MEDIUM', 'LOW'];

export function RiskCreateModal({ open, onClose, onCreated, user }: RiskCreateModalProps) {
    const theme = useTheme();
    const isMobile = useMediaQuery(theme.breakpoints.down('sm'));
    const roleName = user?.role === 'SUPERUSER' ? '' : user?.roleName === 'Admin' ? '' : user?.roleName;
    const requiresProject = roleName === 'manager' || roleName === 'lead';
    const [selectedAccount, setSelectedAccount] = useState<Account | null>(null);
    const [error, setError] = useState('');

    const { data: accounts = [] } = useAccountsQuery();
    const { data: superusers = [] } = useRiskSuperusers();
    const { data: projects = [] } = useProjects(selectedAccount?.id);
    const createRisk = useCreateRisk();

    const {
    register,
    handleSubmit,
    watch,
    reset,
    control,
    formState: { errors },
  } = useForm<CreateRiskPayload>({
    mode: "onChange",
    defaultValues: {
      title: '',
      description: '',
      source: 'CLIENT',
      priority: 'MEDIUM',
      notifiedDate: dayjs().toISOString(),
      assigneeId: undefined,
      projectId: undefined
    },
    resolver: zodResolver(riskSchema)
  });
    useEffect(() => {
        if (!open) return;
        setSelectedAccount(null);
        reset(),
        setError('');
    }, [open]);

    const handleSave = async (data: CreateRiskPayload) => {
        setError('');
        try {
            await createRisk.mutateAsync(data);
            onCreated();
            onClose();
        } catch (err) {
            const error = (err as { response?: { data?: { error?: string } } })?.response?.data;
            setError(error?.error || 'Failed to create risk.');
        }
    };

    return (
        <Dialog open={open} onClose={onClose} maxWidth="sm" fullWidth fullScreen={isMobile}>
            <DialogTitle>New Risk</DialogTitle>
            <DialogContent dividers>
                {error && <Alert severity="error" sx={{ mb: 2 }}>{error}</Alert>}

                <Box sx={{ display: 'flex', flexDirection: 'column', gap: 2 }}>
                    <TextField
                        label="Title *"
                        fullWidth
                        size="small"
                        error={!!errors.title}
                        helperText={errors.title?.message}
                        {...register('title')}
                        placeholder="Brief summary of the risk"
                    />

                    <TextField
                        label="Description *"
                        fullWidth
                        size="small"
                        multiline
                        rows={3}
                        error={!!errors.description}
                        helperText={errors.description?.message}
                        {...register('description')}
                        placeholder="Detailed description of the risk"
                    />

                    <Box sx={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 2 }}>
                        <TextField
                            select
                            label="Source *"
                            size="small"
                            value={watch('source')}
                            error={!!errors.source}
                            helperText={errors.source?.message}
                            {...register('source')}
                        >
                            {SOURCES.map(s => (
                                <MenuItem key={s} value={s}>{s === 'CLIENT' ? 'Client' : 'Internal'}</MenuItem>
                            ))}
                        </TextField>

                        <TextField
                            select
                            label="Priority *"
                            size="small"
                            value={watch('priority')}
                            error={!!errors.priority}
                            helperText={errors.priority?.message}
                            {...register('priority')}
                        >
                            {PRIORITIES.map(p => (
                                <MenuItem key={p} value={p}>{p.charAt(0) + p.slice(1).toLowerCase()}</MenuItem>
                            ))}
                        </TextField>
                    </Box>

                    <Controller
                        name="notifiedDate"
                        control={control}
                        render={({ field }) => (
                            <DatePicker
                                label="Notified Date"
                                value={field.value ? dayjs(field.value) : dayjs()}
                                onChange={(date) => {
                                    field.onChange(
                                        date ? date.format('YYYY-MM-DD') : dayjs()
                                    );
                                }}
                                slotProps={{
                                    textField: {
                                        size: 'small',
                                        error: !!errors.notifiedDate,
                                        helperText: errors.notifiedDate?.message,
                                    }}}
                                minDate={dayjs()}
                                maxDate={dayjs().add(4,'months')} 
                                sx={{ minWidth: 160 }} 
                            />
                        )}
                    />

                    {/* Account + Project selectors */}
                    <Box>
                        <Typography variant="caption" color="text.secondary" sx={{ display: 'block', mb: 0.5 }}>
                            Link to Project {requiresProject ? '*' : '(optional)'}
                        </Typography>
                        <Box sx={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 2 }}>
                            <TextField
                                select
                                label="Account"
                                size="small"
                                value={selectedAccount?.id || ''}
                                onChange={e => {
                                    const acc = accounts.find(a => a.id === Number(e.target.value)) || null;
                                    setSelectedAccount(acc);
                                    setError('');
                                }}
                            >
                                <MenuItem value="">— None —</MenuItem>
                                {accounts.map(a => (
                                    <MenuItem key={a.id} value={a.id}>{a.name}</MenuItem>
                                ))}
                            </TextField>

                            <Controller
                                name="projectId"
                                control={control}
                                render={({ field }) => (
                                    <TextField
                                        {...field}
                                        select
                                        label="Project"
                                        size="small"
                                        value={field.value ?? ""} 
                                        onChange={(e) => {
                                            const val = e.target.value;
                                            field.onChange(val ? Number(val) : ""); 
                                        }}
                                        disabled={!selectedAccount || projects.length === 0}
                                        helperText={!selectedAccount ? 'Select account to view projects' : ''}
                                    >
                                        <MenuItem value="">— None —</MenuItem>
                                            {projects
                                                .filter((p) => (p.dataSourceType ?? 'jira') !== 'excel')
                                                .map(p => (
                                                <MenuItem key={p.id} value={p.id}>{p.name}</MenuItem>
                                            ))}
                                    </TextField> 
                                )}
                            />
                        </Box>
                    </Box>

                    {/* Assignee */}
                    <Controller
                        control={control}
                        name="assigneeId"
                        render={({ field: { onChange, value } }) => (
                            <Autocomplete
                                options={superusers}
                                getOptionLabel={(u) => `${u.firstName} ${u.lastName}`}
                                value={superusers.find((u) => u.id === value) || null}
                                onChange={(_, newValue) => {
                                    onChange(newValue ? newValue.id : null);
                                }}
                                renderInput={(params) => (
                                    <TextField {...params} label="Assign To (optional)" size="small" />
                                )}
                                noOptionsText="No superusers found"
                            />
                        )}
                    />
                </Box>
            </DialogContent>
            <DialogActions>
                <Button onClick={onClose} disabled={createRisk.isPending}>Cancel</Button>
                <Button onClick={handleSubmit(handleSave)} variant="contained" disabled={createRisk.isPending || Boolean(error)}>
                    {createRisk.isPending ? 'Creating...' : 'Create Risk'}
                </Button>
            </DialogActions>
        </Dialog>
    );
}
