import React, { useState } from 'react';
import {
    Box,
    Typography,
    Table,
    TableBody,
    TableCell,
    TableContainer,
    TableHead,
    TableRow,
    Button,
    Chip,
    CircularProgress,
    Alert,
    Avatar,
    TextField,
    InputAdornment,
    MenuItem,
    FormControl,
    InputLabel,
    OutlinedInput,
    Select,
    TablePagination,
    IconButton,
    Popover,
    Stack,
    Badge,
    FormHelperText,
    Snackbar,
    Checkbox,
    ListItemText,
    TableSortLabel,
} from '@mui/material';
import { Add as AddIcon, Edit as EditIcon, Block as BlockIcon, } from '@mui/icons-material';
import PersonAddIcon from '@mui/icons-material/PersonAdd';
import type { Role, User } from './types';
import { useUsers, useDeactivateUser, useRoles, useActivateUser, useGetUser } from './hooks';
import UserModal from './UserModal';
import { useAdminAccounts } from '../accounts/hooks';
import { useAdminProjects } from '../projects/hooks';
import type { Account } from '../accounts/types';
import type { Project } from '../../../types';
import SearchIcon from '@mui/icons-material/Search';
import ClearIcon from '@mui/icons-material/Clear';
import FilterAltIcon from '@mui/icons-material/FilterAlt';
import ConfirmationDialog from '../../../shared/components/ConfirmationDialog';
import './UserManagement.css';

const NAVY = '#002e5b';
const ORANGE = '#f15a24';

const thSx = {
    fontFamily: 'Inter, sans-serif',
    fontSize: 11,
    fontWeight: 700,
    color: 'rgba(8, 1, 1, 0.85)',
    textTransform: 'uppercase' as const,
    letterSpacing: '0.06em',
    py: 1.5,
    borderBottom: 'none',
};

const tdSx = {
    fontFamily: 'Inter, sans-serif',
    fontSize: 13,
    color: '#374151',
    py: 1.25,
    borderBottom: '1px solid #f0f4f8',
};

export interface SortConfig {
    column: 'firstName' | 'userId' | 'role';
    direction: 'ASC' | 'DESC';
}

const UserManagement: React.FC = () => {
    const { data: accounts = [] } = useAdminAccounts();
    const { data: allProjects = [] } = useAdminProjects();
    const { data: rolesData = [] } = useRoles();
    const [modalOpen, setModalOpen] = useState(false);
    const [searchValue, setSearchValue] = useState('');
    const [memberSearch, setMemberSearch] = useState('');
    const [selectedUser, setSelectedUser] = useState<User | null>(null);
    const [selectedAccountId, setSelectedAccountId] = useState<number | ''>('');
    const [selectedProjectName, setSelectedProjectName] = useState<string[]>([]);
    const [selectedRoleName, setSelectedRoleName] = useState<string[]>([]);
    const [selectedAccountName, setSelectedAccountName] = useState<string>('');
    const [projectNames, setProjectNames] = useState<string[]>([]);
    const [roleNames, setRoleNames] = useState<string[]>([]);
    const [statusFilter, setStatusFilter] = useState<string>('');
    const [statusFilterValue, setStatusFilterValue] = useState<string>('');
    const [page, setPage] = useState(1);
    const [anchorEl, setAnchorEl] = useState<HTMLButtonElement | null>(null);
    const [isExpanded, setIsExpanded] = useState(false);
    const [deleteTarget, setDeleteTarget] = useState<number | null>(null);
    const [activateTarget, setActivateTarget] = useState<User | null>(null);
    const [snackBar, setSnackBar] = useState<{ msg: string; severity: 'success' | 'error' } | null>(null);
    const [snackbarOpen, setSnackbarOpen] = useState(false);
    const [sortConfig, setSortConfig] = useState<SortConfig>({ column: 'firstName', direction: 'ASC' });
    const [showAlert, setShowAlert] = useState(false);
    const limit = 10;

    const open = Boolean(anchorEl);
    const fetchUser = useGetUser();

    const { data: apiRes, isLoading: loading, isError, error: queryError } = useUsers(memberSearch, selectedAccountName, projectNames, roleNames, statusFilterValue, page, limit, sortConfig);
    const usersList: User[] = apiRes?.data ?? [];
    const totalItems: number = apiRes?.totalItems ?? 0;
    const error = isError ? ((queryError as { response?: { data?: { error?: string } } })?.response?.data?.error || 'Failed to fetch users') : null;
    const activateUser = useActivateUser();
    const deactivateUser = useDeactivateUser();

    const handleCreate = () => { setSelectedUser(null); setModalOpen(true); };
    const handleEdit = async (user: User) => {
        try {
            const userDetails = await fetchUser.mutateAsync({ id: user.id });
            setSelectedUser(userDetails);
            setModalOpen(true);
        } catch (err) {
            console.error("Failed to fetch user details", err);
        }
    };

    const handleClick = (event: React.MouseEvent<HTMLButtonElement>) => {
        setAnchorEl(event.currentTarget);
        const accObj = accounts.find((acc: Account) => acc.name === selectedAccountName)
        setSelectedAccountId(accObj ? accObj.id : null);
        setSelectedProjectName(projectNames);
        setSelectedRoleName(roleNames);
    };

    const handleClose = () => {
        setAnchorEl(null);
        setSelectedProjectName([]);
        setSelectedAccountId('');
        setSelectedRoleName([]);
    };

    const handleSearch = () => {
        setPage(1);
        setMemberSearch(searchValue)
    }

    const handleClear = () => {
        setSearchValue('');
        setMemberSearch('');
    }

    const handleFilters = () => {
        setAnchorEl(null);
        setPage(1);
        const accObj = accounts.find((acc: Account) => acc.id === selectedAccountId);
        setSelectedAccountName(accObj ? accObj.name : '');
        setProjectNames(selectedProjectName);
        setRoleNames(selectedRoleName);
        setStatusFilterValue(statusFilter);
    };

    const handleClearFilters = () => {
        setSelectedAccountId('');
        setSelectedProjectName([]);
        setSelectedRoleName([]);
        setSelectedAccountName('');
        setProjectNames([]);
        setRoleNames([]);
        setIsExpanded(false);
        setStatusFilter('');
        setStatusFilterValue('');
    }

    const activeFilters = [
        ...(selectedAccountName ? [{ type: 'account', label: selectedAccountName }] : []),
        ...projectNames.map((proj) => ({ type: 'project', label: proj })),
        ...roleNames.map((role) => ({ type: 'role', label: role })),
        ...(statusFilterValue ? [{ type: 'status', label: statusFilterValue }] : [])
    ];
    const visibleFilters = isExpanded ? activeFilters : activeFilters.slice(0, 5);
    const remainingCount = activeFilters.length - 5;

    const isAnyFilterActive = !!selectedAccountName || (projectNames && projectNames.length > 0) || (roleNames && roleNames.length > 0) || !!statusFilterValue;
    const isAnyFilterSelected = !!selectedAccountId || (selectedProjectName && selectedProjectName.length > 0) || (selectedRoleName && selectedRoleName.length > 0) || !!statusFilter;

    const handleClearFilter = (filterType: string, value: string) => {
        if (filterType === 'account') {
            setSelectedAccountId('');
            setSelectedAccountName('');
            setProjectNames([]);
            setSelectedProjectName([]);
        }
        if (filterType === 'project') {
            setSelectedProjectName(prevValue => prevValue.filter(projName => projName !== value));
            setProjectNames(prevValue => prevValue.filter(projName => projName !== value));
        }
        if (filterType === 'role') {
            setSelectedRoleName(prevValue => prevValue.filter(roleName => roleName !== value));
            setRoleNames(prevValue => prevValue.filter(roleName => roleName !== value));
        }
        if (filterType === 'status') {
            setStatusFilter('');
            setStatusFilterValue('');
        }
        if (isExpanded && remainingCount <= 1) {
            setIsExpanded(false);
        }
    }
    const handleDeactivate = async () => {
        if (!deleteTarget) return;
        try {
            await deactivateUser.mutateAsync(deleteTarget);
            setSnackBar({ msg: 'User deactivated successfully', severity: 'success' });
            setShowAlert(false);
        } catch (err) {
            const errorWithResponse = err as { response?: { data?: { error?: string } }; };
            setSnackBar({ msg: errorWithResponse.response?.data?.error || 'Failed to deactivate user', severity: 'error' });
        } finally {
            setSnackbarOpen(true);
            setDeleteTarget(null);
        }
    };

    const handleActivate = async () => {
        if (!activateTarget) return;
        try {
            const activatePayload = { ...activateTarget, isActive: 'true' } as Partial<User> & { isActive: string };
            await activateUser.mutateAsync({ id: activateTarget.id, data: activatePayload });
            setSnackBar({ msg: 'User activated successfully', severity: 'success' });
            setShowAlert(false);
        } catch (err) {
            const errorWithResponse = err as { response?: { data?: { error?: string } }; };
            setSnackBar({ msg: errorWithResponse.response?.data?.error || 'Failed to activate user', severity: 'error' });
        } finally {
            setSnackbarOpen(true);
            setActivateTarget(null);
        }
    };

    const handleSortRequest = (columnName: "firstName" | "userId" | "role") => {
        let direction: "ASC" | "DESC" = "ASC";
        if (sortConfig.column === columnName && sortConfig.direction === "ASC") {
            direction = "DESC";
        }
        setPage(1);
        setSortConfig({ column: columnName, direction });
    };

    return (
        <Box>
            <Box sx={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', mb: 3 }}>
                <Box>
                    <Typography sx={{ fontFamily: 'Poppins, sans-serif', fontSize: 16, fontWeight: 700, color: NAVY }}>
                        User Management
                    </Typography>
                    <Typography sx={{ fontFamily: 'Inter, sans-serif', fontSize: 12, color: '#9ca3af', mt: 0.25 }}>
                        {totalItems} user{totalItems !== 1 ? 's' : ''} total
                    </Typography>
                </Box>
                <Button
                    variant="contained"
                    startIcon={<AddIcon />}
                    onClick={handleCreate}
                    sx={{
                        bgcolor: ORANGE, fontFamily: 'Inter, sans-serif', fontWeight: 600,
                        fontSize: 13, textTransform: 'none', borderRadius: 1.5,
                        boxShadow: 'none', px: 2,
                        '&:hover': { bgcolor: '#d44e1f', boxShadow: 'none' },
                    }}
                >
                    Add User
                </Button>
            </Box>
            <Box sx={{ display: 'flex', alignItems: 'flex-start', flexWrap: 'wrap', gap: 2 }}>
                <Box
                    sx={{
                        display: 'flex',
                        gap: 1.5,
                        mb: 2.5,
                        alignItems: { xs: 'stretch', sm: 'center' },
                        flexWrap: 'wrap',
                        flexDirection: { xs: 'column', sm: 'row' }
                    }}
                >
                    <TextField
                        size="small"
                        placeholder="Search by name or email"
                        value={searchValue}
                        onChange={e => setSearchValue(e.target.value)}
                        sx={{
                            width: { xs: '100%', sm: 300 },
                            '& .MuiOutlinedInput-root': {
                                borderRadius: 1.5,
                                fontSize: 13,
                                fontFamily: 'Inter, sans-serif',
                                '& fieldset': { borderColor: '#e0e4ea' },
                                '&:hover fieldset': { borderColor: '#9ca3af' },
                                '&.Mui-focused fieldset': { borderColor: 'navy' },
                            },
                        }}
                        slotProps={{
                            input: {
                                startAdornment: (
                                    <InputAdornment position="start">
                                        <SearchIcon fontSize="small" sx={{ color: '#9ca3af' }} />
                                    </InputAdornment>
                                ),
                                endAdornment: (
                                    <InputAdornment position="end">
                                        {memberSearch && (
                                            <IconButton
                                                onClick={handleClear}
                                                size="small"
                                            >
                                                <ClearIcon fontSize='small' sx={{ color: '#9ca3af' }} />
                                            </IconButton>
                                        )}
                                        <IconButton onClick={handleClick} color={open ? 'primary' : 'default'}>
                                            <Badge
                                                variant="dot"
                                                color="error"
                                                invisible={!isAnyFilterActive}
                                                anchorOrigin={{
                                                    vertical: 'top',
                                                    horizontal: 'right',
                                                }}
                                            >
                                                <FilterAltIcon />
                                            </Badge>
                                        </IconButton>
                                    </InputAdornment>
                                )
                            },
                        }}
                    />

                    <Button
                        variant="contained"
                        startIcon={<SearchIcon />}
                        onClick={handleSearch}
                        size="small"
                    >
                        Search
                    </Button>
                </Box>
                <Box
                    sx={{
                        display: 'flex',
                        gap: 1.5,
                        mb: 2.5,
                        alignItems: { xs: 'stretch', sm: 'center' },
                        flexWrap: 'wrap',
                        flexDirection: { xs: 'column', sm: 'row' }
                    }}
                >
                    <Popover
                        open={open}
                        anchorEl={anchorEl}
                        onClose={handleClose}
                        anchorOrigin={{
                            vertical: 'bottom',
                            horizontal: 'left'
                        }}
                        transformOrigin={{
                            vertical: 'top',
                            horizontal: 'left'
                        }}
                        slotProps={{
                            paper: {
                                sx: { p: 2.5, minWidth: { xs: '100%', sm: 140 } }
                            }
                        }}
                    >
                        <Typography variant="subtitle1" sx={{ fontWeight: 'bold', mb: 2 }}>
                            Filters
                        </Typography>
                        <Stack direction="row" spacing={2.5}>
                            <FormControl size="small" sx={{ minWidth: { xs: '100%', sm: 140 } }}>
                                <InputLabel id="account-select-label">Account</InputLabel>
                                <Select
                                    labelId="account-select-label"
                                    id="account-select"
                                    value={selectedAccountId ?? ""}
                                    onChange={e => {
                                        setSelectedAccountId(e.target.value);
                                        setSelectedProjectName([]);
                                    }}
                                    input={<OutlinedInput label="Account" />}
                                >
                                    {accounts.map((a: Account) => (
                                        <MenuItem key={a.id} value={a.id}>{a.name}</MenuItem>
                                    ))}
                                </Select>
                            </FormControl>
                            <FormControl size="small" sx={{ minWidth: { xs: '100%', sm: 200 }, maxWidth: { xs: '100%', sm: 240 } }} disabled={!selectedAccountId}>
                                <InputLabel id="project-select-label">Projects</InputLabel>
                                <Select
                                    sx={{ width: 200 }}
                                    labelId="project-select-label"
                                    aria-describedby="project-helper-text"
                                    id="project-select"
                                    multiple
                                    value={selectedProjectName}
                                    onChange={(e) => setSelectedProjectName(e.target.value as string[])}
                                    input={<OutlinedInput label="Projects" />}
                                    renderValue={(selected) => (selected as string[]).join(', ')}
                                    MenuProps={{
                                        PaperProps: {
                                            sx: {
                                                maxHeight: 260,
                                            },
                                        },
                                    }}
                                >
                                    {(
                                        allProjects
                                            .filter((project: Project) => String(project.accountId) === String(selectedAccountId))
                                            .map((a: Project) => (
                                                <MenuItem key={a.id} value={a.name}>
                                                    <Checkbox checked={selectedProjectName.indexOf(a.name) > -1} size='small' />
                                                    <ListItemText primary={a.name} />
                                                </MenuItem>
                                            ))
                                    )}
                                </Select>
                                {!selectedAccountId && <FormHelperText id={"project-helper-text"} sx={{ ml: 0 }}>
                                    Select an account for project filters
                                </FormHelperText>}
                            </FormControl>
                            <FormControl size="small" sx={{ minWidth: { xs: '100%', sm: 140 }, maxWidth: { xs: '100%', sm: 200 } }}>
                                <InputLabel id="roles-select-label">Roles</InputLabel>
                                <Select
                                    sx={{ width: 200 }}
                                    labelId="roles-select-label"
                                    id="roles-select"
                                    multiple
                                    value={selectedRoleName}
                                    onChange={(e) => setSelectedRoleName(e.target.value as string[])}
                                    input={<OutlinedInput label="Roles" />}
                                    renderValue={(selected) =>
                                        (selected as string[])
                                            .map((role) => role.charAt(0).toUpperCase() + role.slice(1))
                                            .join(', ')
                                    }
                                >
                                    {rolesData.map((a: Role) => (
                                        <MenuItem key={a.id} value={a.name} sx={{ textTransform: 'capitalize' }}>
                                            <Checkbox checked={selectedRoleName.indexOf(a.name) > -1} size='small' />
                                            <ListItemText primary={a.name} />
                                        </MenuItem>
                                    ))}
                                </Select>
                            </FormControl>
                            <FormControl size="small" sx={{ minWidth: { xs: '100%', sm: 140 } }}>
                                <InputLabel id="status-label">Status</InputLabel>
                                <Select
                                    labelId="status-label"
                                    id="status"
                                    value={statusFilter}
                                    onChange={e => {
                                        setStatusFilter(e.target.value)
                                    }}
                                    input={<OutlinedInput label="Status" />}
                                >
                                    <MenuItem value="active">Active</MenuItem>
                                    <MenuItem value="inactive">Inactive</MenuItem>
                                </Select>
                            </FormControl>
                        </Stack>
                        <Stack direction="row" spacing={1} justifyContent="space-between" sx={{ pt: 1 }}>
                            <Button
                                size="small"
                                color="error"
                                onClick={handleClearFilters}
                            >
                                Clear All
                            </Button>
                            <Button variant="contained" size="small" disabled={!isAnyFilterSelected} onClick={handleFilters}>
                                Apply
                            </Button>
                        </Stack>
                    </Popover>

                </Box>
            </Box>

            {isAnyFilterActive && <Box sx={{ display: 'flex', alignItems: 'flex-start', flexWrap: 'wrap', gap: 1, pb: 2 }}>
                {visibleFilters.map((filter, index) => (
                    <Chip
                        key={`${filter.type}-${index}`}
                        label={filter.label}
                        size="small"
                        onDelete={() => { handleClearFilter(filter.type, filter.label) }}
                        sx={{
                            fontFamily: 'Inter, sans-serif',
                            fontSize: 11,
                            fontWeight: 600,
                            bgcolor: 'rgba(156, 163, 175, 0.15)',
                            color: '#6b7280',
                            border: 'none',
                            height: 22,
                        }}
                    />
                ))}

                {!isExpanded && remainingCount > 0 && (
                    <Chip
                        label={`+${remainingCount}`}
                        size="small"
                        clickable
                        onClick={() => setIsExpanded(true)}
                        sx={{
                            fontFamily: 'Inter, sans-serif',
                            fontSize: 11,
                            fontWeight: 600,
                            bgcolor: 'rgba(156, 163, 175, 0.15)',
                            color: '#6b7280',
                            border: 'none',
                            height: 22,
                        }}
                    />
                )}

                {isExpanded && activeFilters.length > 5 && (
                    <Chip
                        label="Show less"
                        size="small"
                        clickable
                        onClick={() => setIsExpanded(false)}
                        sx={{
                            fontFamily: 'Inter, sans-serif',
                            fontSize: 11,
                            fontWeight: 600,
                            bgcolor: 'rgba(156, 163, 175, 0.1)',
                            color: '#6b7280',
                            border: '1px #d1d5db',
                            height: 22,
                            '&:hover': { bgcolor: 'rgba(156, 163, 175, 0.2)' }
                        }}
                    />
                )}
                {activeFilters.length > 0 && (
                    <Chip
                        label="Clear All"
                        size="small"
                        onClick={handleClearFilters}
                        sx={{
                            fontFamily: 'Inter, sans-serif',
                            fontSize: 11,
                            fontWeight: 600,
                            bgcolor: 'rgba(156, 163, 175, 0.1)',
                            color: '#6b7280',
                            border: '1px #d1d5db',
                            height: 22,
                            '&:hover': { bgcolor: 'rgba(156, 163, 175, 0.2)' }
                        }}
                    />
                )}
            </Box>}

            {error && <Alert severity="error" sx={{ mb: 3, borderRadius: 2, fontSize: 13 }}>{error}</Alert>}

            <Box sx={{ border: '1px solid #e0e4ea', borderRadius: 2, overflow: 'hidden' }}>
                <TableContainer>
                    {loading ? (
                        <Box sx={{ display: 'flex', justifyContent: 'center', p: 5 }}>
                            <CircularProgress size={26} sx={{ color: NAVY }} />
                        </Box>
                    ) : (
                        <Table size="small">
                            <TableHead sx={{ bgcolor: NAVY }}>
                                <TableRow>
                                    <TableCell sx={thSx}>User
                                        <TableSortLabel sx={{ fontSize: 10 }}
                                            active={sortConfig.column === 'firstName'}
                                            direction={sortConfig.direction === 'DESC' ? 'desc' : 'asc'}
                                            onClick={() => handleSortRequest('firstName')}>
                                        </TableSortLabel>
                                    </TableCell>
                                    <TableCell sx={thSx}>User ID
                                        <TableSortLabel sx={{ fontSize: 10 }}
                                            active={sortConfig.column === 'userId'}
                                            direction={sortConfig.direction === 'DESC' ? 'desc' : 'asc'}
                                            onClick={() => handleSortRequest('userId')}>
                                        </TableSortLabel>
                                    </TableCell>
                                    <TableCell sx={thSx}>Role
                                        <TableSortLabel sx={{ fontSize: 10 }}
                                            active={sortConfig.column === 'role'}
                                            direction={sortConfig.direction === 'DESC' ? 'desc' : 'asc'}
                                            onClick={() => handleSortRequest('role')}>
                                        </TableSortLabel>
                                    </TableCell>
                                    <TableCell sx={thSx}>Status</TableCell>
                                    <TableCell sx={thSx}>Accounts</TableCell>
                                    <TableCell sx={thSx}>Projects</TableCell>
                                    <TableCell sx={thSx}>Actions</TableCell>
                                </TableRow>
                            </TableHead>
                            <TableBody>
                                {usersList.length === 0 ? (
                                    <TableRow>
                                        <TableCell colSpan={6} align="center" sx={{ py: 4, fontFamily: 'Inter, sans-serif', fontSize: 13, color: '#9ca3af' }}>
                                            No users found.
                                        </TableCell>
                                    </TableRow>
                                ) : (
                                    usersList.map((user) => (
                                        <TableRow key={user.id} hover sx={{ '&:hover': { bgcolor: '#f8fafc' }, '&:last-child td': { borderBottom: 'none' } }}>
                                            <TableCell sx={tdSx}>
                                                <Box sx={{ display: 'flex', alignItems: 'center', gap: 1.25 }}>
                                                    <Avatar sx={{ width: 28, height: 28, bgcolor: NAVY, fontSize: 11, fontWeight: 700 }}>
                                                        {user.firstName?.[0]}{user.lastName?.[0]}
                                                    </Avatar>
                                                    <Typography sx={{ fontFamily: 'Inter, sans-serif', fontSize: 13, fontWeight: 500, color: NAVY }}>
                                                        {user.firstName} {user.lastName}
                                                    </Typography>
                                                </Box>
                                            </TableCell>
                                            <TableCell sx={{ ...tdSx, color: '#6b7280', fontFamily: 'monospace', fontSize: 12 }}>
                                                {user.userId}
                                            </TableCell>
                                            <TableCell sx={{ ...tdSx, color: '#6b7280', fontFamily: 'monospace', fontSize: 12, textTransform: 'capitalize' }}>
                                                {user.roleName}
                                            </TableCell>
                                            <TableCell sx={tdSx}>
                                                <Chip
                                                    label={user.isActive ? 'Active' : 'Inactive'}
                                                    size="small"
                                                    sx={{
                                                        fontFamily: 'Inter, sans-serif',
                                                        fontSize: 11, fontWeight: 600,
                                                        bgcolor: user.isActive ? 'rgba(16,185,129,0.1)' : 'rgba(156,163,175,0.15)',
                                                        color: user.isActive ? '#059669' : '#6b7280',
                                                        border: 'none',
                                                        height: 22,
                                                    }}
                                                />
                                            </TableCell>
                                            <TableCell sx={{ ...tdSx, maxWidth: 180, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                                                {user.accounts || <span style={{ color: '#d1d5db' }}>—</span>}
                                            </TableCell>
                                            <TableCell sx={{ ...tdSx, maxWidth: 180, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                                                {user.projects || <span style={{ color: '#d1d5db' }}>—</span>}
                                            </TableCell>
                                            <TableCell sx={tdSx}>
                                                <Button
                                                    size="small"
                                                    startIcon={<EditIcon sx={{ fontSize: '14px !important' }} />}
                                                    onClick={() => handleEdit(user)}
                                                    sx={{
                                                        fontFamily: 'Inter, sans-serif', fontSize: 12, fontWeight: 500,
                                                        textTransform: 'none', color: NAVY, mr: 0.5,
                                                        '&:hover': { bgcolor: 'rgba(0,46,91,0.07)' },
                                                    }}
                                                >
                                                    Edit
                                                </Button>
                                                {user.isActive ? (
                                                    <Button
                                                        size="small"
                                                        startIcon={<BlockIcon sx={{ fontSize: '14px !important' }} />}
                                                        onClick={() => { setDeleteTarget(user.id); setShowAlert(true); }}
                                                        className="user-action-button deactivate"
                                                    >
                                                        Deactivate
                                                    </Button>) : (<Button
                                                        size="small"
                                                        startIcon={<PersonAddIcon sx={{ fontSize: '14px !important' }} />}
                                                        onClick={() => { setActivateTarget(user); setShowAlert(true); }}
                                                        className="user-action-button activate"
                                                    >
                                                        Activate
                                                    </Button>)
                                                }
                                            </TableCell>
                                        </TableRow>
                                    ))
                                )}
                            </TableBody>
                        </Table>
                    )}
                    <TablePagination
                        component="div"
                        count={totalItems}
                        page={totalItems > 0 ? page - 1 : 0}
                        onPageChange={(_, p) => setPage(p + 1)}
                        rowsPerPage={limit}
                        rowsPerPageOptions={[limit]}
                    />
                </TableContainer>
                {showAlert && (deleteTarget ? (
                    <ConfirmationDialog
                        title="Confirm To Deactivate this user"
                        message="Please Confirm! You want to deactivate this user?"
                        action="Deactivate"
                        closeButtonText="Cancel"
                        ActionButtonColor="primary"
                        confirm={handleDeactivate}
                        setShowAlert={setShowAlert}
                        onClose={() => {
                            setShowAlert(false);
                        }}
                    />) : (
                    <ConfirmationDialog
                        title="Confirm To Activate this user"
                        message="Please Confirm! You want to Activate this user?"
                        action="Activate"
                        closeButtonText="Cancel"
                        ActionButtonColor="primary"
                        confirm={handleActivate}
                        setShowAlert={setShowAlert}
                        onClose={() => {
                            setShowAlert(false);
                        }}
                    />
                ))}
            </Box>

            {modalOpen && (
                <UserModal
                    accounts={accounts}
                    projects={allProjects}
                    roles={rolesData}
                    open={modalOpen}
                    onClose={() => { setModalOpen(false); }}
                    onSuccess={() => { setModalOpen(false); }}
                    setSnackBar={setSnackBar}
                    setSnackBarOpen={setSnackbarOpen}
                    user={selectedUser}
                />
            )}
            <Snackbar
                open={snackbarOpen}
                autoHideDuration={3000}
                onClose={() => setSnackbarOpen(false)}
                anchorOrigin={{ vertical: 'top', horizontal: 'center' }}
            >
                <Alert severity={snackBar?.severity} variant="filled" onClose={() => setSnackbarOpen(false)}>
                    {snackBar?.msg}
                </Alert>
            </Snackbar>
        </Box>
    );
};

export default UserManagement;
