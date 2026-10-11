import { useRef, useState } from 'react';
import {
  Box, Typography, Button, Paper, Chip, IconButton, Tooltip, TextField, InputAdornment,
  Table, TableHead, TableBody, TableRow, TableCell, TableContainer,
  CircularProgress,TablePagination,
} from '@mui/material';
import { Add, Edit, Delete } from '@mui/icons-material';
import { brandColors } from '../../../../theme/tokens';
import { tdSx, primaryBtnSx, outlinedBtnSx, destructiveOutlinedBtnSx, tableWrapperSx } from '../styles';
import type { Account, ProjectMembers } from '../types';
import SearchIcon from '@mui/icons-material/Search';
import ClearIcon from '@mui/icons-material/Clear';
import { useAdminAccountTeamMembers } from '../../team-members/hooks';
import type { Project } from '../../../../types';
import { useAdminAccountProjects } from '../../projects/hooks';

const { navy, orange } = brandColors;

// JS Date.getDay() convention: 0=Sun...6=Sat.
const DAY_ABBREV = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];

interface AccountDetailViewProps {
  account: Account;
  onEditAccount: (acc: Account) => void;
  onDeleteAccount: (acc: Account) => void;
  onCreateProject: () => void;
  onEditProject: (p: Project) => void;
  onDeleteProject: (p: Project) => void;
  onSelectProject: (p: Project) => void;
  onAddMember: () => void;
  onEditMember: (m: ProjectMembers) => void;
  onDeleteMember: (m: ProjectMembers) => void;
}

/** Account detail: info card + projects table + account-level members table. */
export const AccountDetailView = ({
  account,
  onEditAccount,
  onDeleteAccount,
  onCreateProject,
  onEditProject,
  onDeleteProject,
  onSelectProject,
  onAddMember,
  onEditMember,
  onDeleteMember,
}: AccountDetailViewProps) => {
  const [searchValue, setSearchValue] = useState('');
  const searchValueFilter = searchValue.trim() === '' ? undefined : searchValue;
  const [projectPage, setProjectPage] = useState(1);
  const [teamMemberPage, setTeamMemberPage] = useState(1);
  const limit = 10;
  const { data: allAccountProjects, isLoading: projectLoading } = useAdminAccountProjects(account.id, projectPage, limit);
  const { data: allAccountMembers, isLoading: memberLoading} = useAdminAccountTeamMembers(searchValueFilter, account.id, teamMemberPage, limit )
  
  const paginatedProjects = allAccountProjects?.data?? [];
  const totalProjects = allAccountProjects?.total ?? 0;
  
  const paginatedMembers = allAccountMembers?.data ?? [];
  const totalMembers = allAccountMembers?.total ?? 0;

  const searchRef = useRef<HTMLInputElement>(null);
  
  const handleSearch = () => {
    const currentInputValue = searchRef.current?.value || '';
  
    if (!currentInputValue.trim()) {
      setSearchValue('');
    } else {
      setSearchValue(currentInputValue); 
    }
  };
  const handleClear = () => {
    if (searchRef.current) {
      searchRef.current.value = '';
    }
    setSearchValue('');
  }
  
  return (
    <Box>
      {/* Account info card */}
      <Box
        sx={{
          border: '1px solid #e0e4ea',
          borderRadius: 2,
          p: 2,
          mb: 3,
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'space-between',
          bgcolor: '#fff',
        }}
      >
        <Box>
          <Typography sx={{ fontFamily: 'Poppins, sans-serif', fontSize: 16, fontWeight: 700, color: navy }}>
            {account.name}
          </Typography>
          <Typography sx={{ fontFamily: 'Inter, sans-serif', fontSize: 12, color: '#6b7280', mt: 0.25 }}>
            Code: <code>{account.code}</code>
            {' · '}Amber: {account.amberThresholdPercentage}%
            {' · '}Red: {account.redThresholdPercentage}%
            {' · '}Red Floor: {account.redProjectCountFloor}
            {account.redCeilingBadPercentage != null ? ` · Red Ceiling: ${account.redCeilingBadPercentage}%` : ''}
            {' · '}Week: {DAY_ABBREV[account.weekStartDay]}-{DAY_ABBREV[(account.weekStartDay + 6) % 7]}
            {account.description ? ` · ${account.description}` : ''}
          </Typography>
        </Box>
        <Box sx={{ display: 'flex', gap: 1 }}>
          <Button variant="outlined" startIcon={<Edit />} size="small" onClick={() => onEditAccount(account)} sx={outlinedBtnSx}>
            Edit
          </Button>
          <Button
            variant="outlined"
            startIcon={<Delete />}
            size="small"
            onClick={() => onDeleteAccount(account)}
            sx={destructiveOutlinedBtnSx}
          >
            Delete
          </Button>
        </Box>
      </Box>

      {/* Projects section */}
      <Box sx={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', mb: 1.5 }}>
        <Typography sx={{ fontFamily: 'Poppins, sans-serif', fontSize: 14, fontWeight: 700, color: navy }}>
          Projects ({totalProjects})
        </Typography>
        <Button variant="contained" size="small" startIcon={<Add />} onClick={onCreateProject} sx={primaryBtnSx}>
          Add Project
        </Button>
      </Box>
      {projectLoading ? (
        <Box sx={{ display: 'flex', justifyContent: 'center', p: 4 }}>
          <CircularProgress size={28} sx={{ color: navy }} />
        </Box>) : (
        <Box sx={{ ...tableWrapperSx, mb: 3 }}>
          <TableContainer component={Paper} elevation={0}>
            <Table size="small">
              <TableHead>
                <TableRow>
                  <TableCell>Name</TableCell>
                  <TableCell>Code</TableCell>
                  <TableCell>Board ID</TableCell>
                  <TableCell>Type</TableCell>
                  <TableCell>Members</TableCell>
                  <TableCell align="right">Actions</TableCell>
                </TableRow>
              </TableHead>
              <TableBody>
                {paginatedProjects.map((p) => (
                  <TableRow
                    key={p.id}
                    hover
                    sx={{
                      cursor: 'pointer',
                      '&:hover': { bgcolor: '#f8fafc' },
                      '&:last-child td': { borderBottom: 'none' },
                    }}
                    onClick={() => onSelectProject(p)}
                  >
                    <TableCell sx={tdSx}>
                      <Box sx={{ display: 'flex', alignItems: 'center', gap: 0.75 }}>
                        <Typography sx={{ fontFamily: 'Inter, sans-serif', fontSize: 13, fontWeight: 600, color: navy }}>
                          {p.name}
                        </Typography>
                        {p.isActive === false && (
                          <Tooltip title={p.inactiveSince ? `Inactive since ${new Date(p.inactiveSince).toLocaleDateString()}` : 'Inactive'}>
                            <Chip
                              label={p.inactiveSince ? `Inactive · ${new Date(p.inactiveSince).toLocaleDateString()}` : 'Inactive'}
                              size="small"
                              sx={{
                                bgcolor: '#fef2f2',
                                color: '#b91c1c',
                                fontFamily: 'Inter, sans-serif',
                                fontSize: 11,
                                fontWeight: 600,
                              }}
                            />
                          </Tooltip>
                        )}
                      </Box>
                    </TableCell>
                    <TableCell sx={{ ...tdSx, fontFamily: 'monospace', fontSize: 12, color: '#6b7280' }}>
                      {p.code}
                    </TableCell>
                    <TableCell sx={tdSx}>{p.jiraBoardId}</TableCell>
                    <TableCell sx={tdSx}>
                      {p.isKanbanProject ? (
                        <Chip
                          label="Kanban"
                          size="small"
                          sx={{
                            bgcolor: 'rgba(108,152,225,0.12)',
                            color: '#002e5b',
                            fontFamily: 'Inter, sans-serif',
                            fontSize: 11,
                            fontWeight: 600,
                          }}
                        />
                      ) : (
                        <Chip
                          label="Scrum"
                          size="small"
                          sx={{
                            bgcolor: 'rgba(241,90,36,0.1)',
                            color: orange,
                            fontFamily: 'Inter, sans-serif',
                            fontSize: 11,
                            fontWeight: 600,
                          }}
                        />
                      )}
                      {p.isSharedTeam && (
                        <Chip
                          label="Shared"
                          size="small"
                          sx={{
                            ml: 0.5,
                            bgcolor: '#f0f4f8',
                            color: '#6b7280',
                            fontFamily: 'Inter, sans-serif',
                            fontSize: 11,
                          }}
                        />
                      )}
                    </TableCell>
                    <TableCell sx={tdSx}>
                      {p.memberCounts}
                    </TableCell>
                    <TableCell align="right" sx={tdSx} onClick={e => e.stopPropagation()}>
                      <Tooltip title="Edit">
                        <IconButton
                          size="small"
                          onClick={() => onEditProject(p)}
                          sx={{ color: navy, '&:hover': { bgcolor: 'rgba(0,46,91,0.08)' } }}
                        >
                          <Edit fontSize="small" />
                        </IconButton>
                      </Tooltip>
                      <Tooltip title="Delete">
                        <IconButton
                          size="small"
                          onClick={() => onDeleteProject(p)}
                          sx={{ color: '#ef4444', '&:hover': { bgcolor: 'rgba(239,68,68,0.08)' } }}
                        >
                          <Delete fontSize="small" />
                        </IconButton>
                      </Tooltip>
                    </TableCell>
                  </TableRow>
                ))}
                {paginatedProjects.length === 0 && (
                  <TableRow>
                    <TableCell
                      colSpan={6}
                      align="center"
                      sx={{ py: 4, fontFamily: 'Inter, sans-serif', fontSize: 13, color: '#9ca3af' }}
                    >
                      No projects in this account
                    </TableCell>
                  </TableRow>
                )}
              </TableBody>
            </Table>
            <TablePagination
              component="div"
              count={totalProjects}
              page={totalProjects > 0 ? projectPage - 1 : 0}
              onPageChange={(_, p) => setProjectPage(p + 1)}
              rowsPerPage={limit}
              rowsPerPageOptions={[limit]}
            />
          </TableContainer>
        </Box>
        )
      }

      {/* Team Members section */}
      <Box sx={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', mb: 1.5 }}>
        <Typography sx={{ fontFamily: 'Poppins, sans-serif', fontSize: 14, fontWeight: 700, color: navy }}>
          Team Members ({totalMembers})
        </Typography>
        <Button variant="contained" size="small" startIcon={<Add />} onClick={onAddMember} sx={primaryBtnSx}>
          Add Member
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
        <TextField
          inputRef={searchRef}
          size="small"
          placeholder="Search with name, email or jiraId"
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
                  {searchValue && (
                    <IconButton
                      onClick={handleClear}
                      size="small"
                    >
                      <ClearIcon fontSize='small' sx={{ color: '#9ca3af' }} />
                    </IconButton>
                  )}
                </InputAdornment>
              )
            },
          }}
        />

        <Button
            variant="contained"
            startIcon={<SearchIcon />}
            onClick={() => {
              handleSearch();
              setTeamMemberPage(1);
            }}
            size="small"
        >
            Search
        </Button>
    </Box>
    {memberLoading ? (
      <Box sx={{ display: 'flex', justifyContent: 'center', p: 4 }}>
        <CircularProgress size={28} sx={{ color: navy }} />
      </Box>) : (
      <Box sx={tableWrapperSx}>
        <TableContainer component={Paper} elevation={0}>
        <Table size="small">
          <TableHead sx={{ bgcolor: navy }}>
            <TableRow>
              <TableCell>Name</TableCell>
              <TableCell>Email</TableCell>
              <TableCell>Jira Login ID</TableCell>
              <TableCell>Projects</TableCell>
              <TableCell align="right">Actions</TableCell>
            </TableRow>
          </TableHead>
          <TableBody>
            {paginatedMembers.map(m => {
              return (
                <TableRow
                  key={m.id}
                  hover
                  sx={{ '&:hover': { bgcolor: '#f8fafc' }, '&:last-child td': { borderBottom: 'none' } }}
                >
                  <TableCell sx={tdSx}>{m.firstName} {m.lastName}</TableCell>
                  <TableCell sx={{ ...tdSx, color: '#6b7280' }}>{m.email}</TableCell>
                  <TableCell sx={{ ...tdSx, fontFamily: 'monospace', fontSize: 12, color: '#6b7280' }}>
                    {m.jiraLoginId}
                  </TableCell>
                  <TableCell sx={tdSx}>
                   {m?.accountAssociations
                    ?.filter(proj => proj?.project?.name)
                    ?.map(proj => (
                      <Chip
                        key={proj.project.name}
                        label={proj.project.name}
                        size="small"
                        sx={{ mr: 0.5, bgcolor: '#f0f4f8', color: '#374151', fontFamily: 'Inter, sans-serif', fontSize: 11 }}
                      />
                    ))}
                  </TableCell>
                  <TableCell align="right" sx={{ ...tdSx, whiteSpace: 'nowrap' }}>
                    <Tooltip title="Edit member">
                      <IconButton
                        size="small"
                        onClick={() => onEditMember(m)}
                        sx={{ color: navy, '&:hover': { bgcolor: 'rgba(0,46,91,0.08)' } }}
                      >
                        <Edit fontSize="small" />
                      </IconButton>
                    </Tooltip>
                    <Tooltip title="Delete member">
                      <IconButton
                        size="small"
                        onClick={() => onDeleteMember(m)}
                        sx={{ color: '#ef4444', '&:hover': { bgcolor: 'rgba(239,68,68,0.08)' } }}
                      >
                        <Delete fontSize="small" />
                      </IconButton>
                    </Tooltip>
                  </TableCell>
                </TableRow>
              );
            })}
            {totalMembers === 0 && (
              <TableRow>
                <TableCell
                  colSpan={5}
                  align="center"
                  sx={{ py: 4, fontFamily: 'Inter, sans-serif', fontSize: 13, color: '#9ca3af' }}
                >
                  No team members assigned to any project in this account
                </TableCell>
              </TableRow>
            )}
          </TableBody>
        </Table>
        <TablePagination
          component="div"
          count={totalMembers}
          page={totalMembers > 0 ? teamMemberPage - 1 : 0}
          onPageChange={(_, p) => setTeamMemberPage(p + 1)}
          rowsPerPage={limit}
          rowsPerPageOptions={[limit]}
        />
        </TableContainer>
      </Box>
      )
    }
    </Box>
  );
};
