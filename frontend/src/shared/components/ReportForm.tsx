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
    Grid,
    FormControlLabel,
    Checkbox
} from '@mui/material';
import { useFetchProjects } from '../../features/auth/hooks';
import type { Project } from '../../types';
import { DatePicker } from '@mui/x-date-pickers/DatePicker';
import dayjs, { Dayjs } from 'dayjs';

interface ReportFormProps {
    accounts: any[];
    onGenerate: (projectName: string, date: string, isAsync: boolean) => void;
    loading: boolean;
}

export const ReportForm = ({ accounts, onGenerate, loading }: ReportFormProps) => {
    const [selectedAccount, setSelectedAccount] = useState('');
    const [projectList, setProjectList] = useState<Project[]>([]);
    const [selectedProject, setSelectedProject] = useState('');
    const [date, setDate] = useState<Dayjs | null>(dayjs());
    const [isAsync, setIsAsync] = useState(false);
    const [error, setError] = useState('');
    const fetchProjects = useFetchProjects();

    // Fetch projects when account changes
    useEffect(() => {
        const loadProjects = async () => {
            if (selectedAccount) {
                try {
                    const acc = accounts.find(a => a.name === selectedAccount || a.id === selectedAccount);
                    if (acc) {
                        const data = await fetchProjects(acc.id);
                        setProjectList(data);
                    }
                } catch (err) {
                    console.error("Failed to fetch projects", err);
                }
            } else {
                setProjectList([]);
            }
            setSelectedProject('');
        };
        loadProjects();
    }, [selectedAccount, accounts]); // eslint-disable-line react-hooks/exhaustive-deps

    const handleSubmit = (e: React.FormEvent) => {
        e.preventDefault();

        if (!selectedAccount) {
            setError("Please select an account.");
            return;
        }
        if (!selectedProject) {
            setError("Please select a project.");
            return;
        }

        if (date && !date.isValid()) {
            setError("Invalid date selected.");
            return;
        }

        setError('');
        const dateStr = date ? date.format('YYYY-MM-DD') : '';
        onGenerate(selectedProject, dateStr, isAsync);
    };

    return (
        <Paper sx={{ p: 3, mb: 4 }}>
            <Typography variant="h6" gutterBottom>Generate Daily Report</Typography>
            {error && <Alert severity="error" sx={{ mb: 2 }}>{error}</Alert>}

            <Box component="form" onSubmit={handleSubmit}>
                <Grid container spacing={2} alignItems="flex-start" sx={{ flexWrap: { xs: 'wrap', md: 'nowrap' } }}>
                    <Grid sx={{ flex: 1, minWidth: 150 }}>
                        <TextField
                            select
                            fullWidth
                            sx={{ minWidth: 150 }}
                            label="Account"
                            value={selectedAccount}
                            onChange={(e) => setSelectedAccount(e.target.value)}
                            required
                        >

                            {accounts.map((acc) => (
                                <MenuItem key={acc.id} value={acc.name}>{acc.name}</MenuItem>
                            ))}
                        </TextField>
                    </Grid>

                    <Grid sx={{ flex: 1, minWidth: 150 }}>
                        <TextField
                            select
                            fullWidth
                            sx={{ minWidth: 150 }}
                            label="Project"
                            value={selectedProject}
                            onChange={(e) => setSelectedProject(e.target.value)}
                            disabled={!selectedAccount}
                            required
                        >
                            <MenuItem value="" disabled>Select...</MenuItem>
                            {projectList.map((p) => (
                                <MenuItem key={p.code} value={p.code}>
                                    {p.name}
                                </MenuItem>
                            ))}
                        </TextField>
                    </Grid>

                    <Grid sx={{ flex: 1, minWidth: 160 }}>
                        <DatePicker
                            label="Date"
                            value={date}
                            onChange={(newValue) => setDate(newValue)}
                            slotProps={{
                                textField: {
                                    fullWidth: true,
                                    helperText: "Defaults to today."
                                }
                            }}
                        />
                    </Grid>

                    <Grid sx={{ display: 'flex', alignItems: 'center', height: '100%', ml: { xs: 0, md: 2 }, mt: { xs: 2, md: 0 } }}>
                        <FormControlLabel
                            control={
                                <Checkbox
                                    checked={isAsync}
                                    onChange={(e) => setIsAsync(e.target.checked)}
                                    name="async"
                                    color="primary"
                                />
                            }
                            label="Queue your request"
                            sx={{ margin: 0 }}
                        />
                    </Grid>

                    <Grid sx={{ display: 'flex', alignItems: 'center', height: '100%', ml: { xs: 0, md: 2 }, mt: { xs: 2, md: 0 } }}>
                        <Button
                            type="submit"
                            variant="contained"
                            size="large"
                            disabled={loading}
                            sx={{ whiteSpace: 'nowrap', height: '56px' }}
                        >
                            {loading ? <CircularProgress size={24} /> : "Generate Report"}
                        </Button>
                    </Grid>
                </Grid>
            </Box>
        </Paper>
    );
};
