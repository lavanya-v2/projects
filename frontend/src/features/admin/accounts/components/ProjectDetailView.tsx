import { useState } from 'react';
import {
  Box, Typography, Button, Paper, Chip, IconButton, Tooltip, CircularProgress,
  Table, TableHead, TableBody, TableRow, TableCell, TableContainer
} from '@mui/material';
import { Add, Edit, Delete, CloudUpload } from '@mui/icons-material';
import { brandColors } from '../../../../theme/tokens';
import { useProjectMembers, useAdminRemoveProjectMember } from '../../projects/hooks';
import { thSx, tdSx, primaryBtnSx, outlinedBtnSx, destructiveOutlinedBtnSx, tableWrapperSx } from '../styles';
import { ExcelUploadDialog } from '../../../data-imports/components/ExcelUploadDialog';
import type { Project } from '../../../../types';
import { ConfirmDeleteDialog } from './dialogs/ConfirmDeleteDialog';

const { navy } = brandColors;

interface TeamMember {
  id: number;
  firstName: string;
  lastName: string;
  email: string;
  jiraLoginId: string;
  role?: string;
  dailyCapacityHours?: number | null;
}

interface ProjectDetailViewProps {
  project: Project;
  allMembers: TeamMember[];
  onEditProject: (p: Project) => void;
  onDeleteProject: (p: Project) => void;
  onAddProjectMember: (availableMembers: TeamMember[]) => void;
  onEditRole: (memberId: number, currentRole: string, currentDailyCapacity?: number | null) => void;
  onError: (msg: string) => void;
  onSuccess: (msg: string) => void;
}

/** Project detail: info card + project members table. Reads members from useProjectMembers. */
export const ProjectDetailView = ({
  project,
  allMembers,
  onEditProject,
  onDeleteProject,
  onAddProjectMember,
  onEditRole,
  onError,
  onSuccess,
}: ProjectDetailViewProps) => {
  const { data: projectMembers = [], isLoading } = useProjectMembers(project.id);
  const removeMember = useAdminRemoveProjectMember();
  const [excelOpen, setExcelOpen] = useState(false);
  const isHours = (project).estimationType === 'hours';
  const [memberId, setMemberId] = useState<number | null>(null);
  const [fullName, setFullName] = useState<string | null>(null);
  const [isOpen, setIsOpen] = useState(false);

  const assignedIds = new Set(projectMembers.map((m) => m.id));
  const availableToAdd = allMembers.filter(m => !assignedIds.has(m.id));

  const handleRemove = async (memberId: number | null) => {
    if (!memberId) return;
    try {
      await removeMember.mutateAsync({ projectId: project.id, teamMemberId: memberId });
      setMemberId(null);
      setIsOpen(false);
      onSuccess('Member removed');
    } catch (err) {
      const errorWithResponse = err as { response?: { data?: { error?: string } }; message?: string };
      onError(errorWithResponse?.response?.data?.error || 'Remove failed');
    }
  };

  return (
    <Box>
      {/* Project info card */}
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
            {project.name}
          </Typography>
          <Typography sx={{ fontFamily: 'Inter, sans-serif', fontSize: 12, color: '#6b7280', mt: 0.25 }}>
            <code>{project.code}</code>
            {' · '}Source: {project.dataSourceType === 'azure_devops' ? 'Azure DevOps' : project.dataSourceType === 'excel' ? 'Excel' : 'Jira'}
            {project.dataSourceType === 'jira' && project.jiraBoardId ? ` · Board: ${project.jiraBoardId}` : ''}
            {' · '}{project.isKanbanProject ? 'Kanban' : 'Scrum'}
            {project.isSharedTeam ? ' · Shared Team' : ''}
          </Typography>
        </Box>
        <Box sx={{ display: 'flex', gap: 1 }}>
          {project.dataSourceType === 'excel' && (
            <Button
              variant="outlined"
              startIcon={<CloudUpload />}
              size="small"
              onClick={() => setExcelOpen(true)}
              sx={outlinedBtnSx}
            >
              Upload Excel
            </Button>
          )}
          <Button
            variant="outlined"
            startIcon={<Edit />}
            size="small"
            onClick={() => onEditProject(project)}
            sx={outlinedBtnSx}
          >
            Edit
          </Button>
          <Button
            variant="outlined"
            startIcon={<Delete />}
            size="small"
            onClick={() => onDeleteProject(project)}
            sx={destructiveOutlinedBtnSx}
          >
            Delete
          </Button>
        </Box>
      </Box>

      <ExcelUploadDialog
        open={excelOpen}
        projectId={project.id}
        projectName={project.name}
        estimationType={(project).estimationType}
        onClose={() => setExcelOpen(false)}
        onSuccess={msg => { onSuccess(msg); }}
      />

      {/* Members section */}
      <Box sx={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', mb: 1.5 }}>
        <Typography sx={{ fontFamily: 'Poppins, sans-serif', fontSize: 14, fontWeight: 700, color: navy }}>
          Team Members ({projectMembers.length})
        </Typography>
        <Button
          variant="contained"
          size="small"
          startIcon={<Add />}
          onClick={() => onAddProjectMember(availableToAdd)}
          disabled={availableToAdd.length === 0}
          sx={primaryBtnSx}
        >
          Add Member
        </Button>
      </Box>

      {isLoading ? (
        <Box sx={{ display: 'flex', justifyContent: 'center', p: 4 }}>
          <CircularProgress size={28} sx={{ color: navy }} />
        </Box>
      ) : (
        <Box sx={tableWrapperSx}>
          <TableContainer component={Paper} elevation={0}>
            <Table size="small">
              <TableHead sx={{ bgcolor: navy }}>
                <TableRow>
                  <TableCell sx={thSx}>Name</TableCell>
                  <TableCell sx={thSx}>Email</TableCell>
                  <TableCell sx={thSx}>Jira Login ID</TableCell>
                  <TableCell sx={thSx}>Role</TableCell>
                  {isHours && <TableCell sx={thSx}>Hrs/day</TableCell>}
                  <TableCell align="right" sx={thSx}>Actions</TableCell>
                </TableRow>
              </TableHead>
              <TableBody>
                {projectMembers.map((m) => (
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
                      <Chip
                        label={m.role || 'Developer'}
                        size="small"
                        sx={{ bgcolor: '#f0f4f8', color: navy, fontFamily: 'Inter, sans-serif', fontSize: 11, fontWeight: 500 }}
                      />
                    </TableCell>
                    {isHours && (
                      <TableCell sx={tdSx}>
                        {m.dailyCapacityHours != null
                          ? m.dailyCapacityHours
                          : <span style={{ color: '#9ca3af' }}>{(project).defaultDailyCapacityHours ?? 8} (default)</span>}
                      </TableCell>
                    )}
                    <TableCell align="right" sx={tdSx}>
                      <Tooltip title="Edit role">
                        <IconButton
                          size="small"
                          onClick={() => onEditRole(m.id, m.role || 'Backend Developer', m.dailyCapacityHours)}
                          sx={{ color: navy, '&:hover': { bgcolor: 'rgba(0,46,91,0.08)' } }}
                        >
                          <Edit fontSize="small" />
                        </IconButton>
                      </Tooltip>
                      <Tooltip title="Remove from project">
                        <IconButton
                          size="small"
                          onClick={() => { setIsOpen(true); setFullName(`${m.firstName} ${m.lastName}`); setMemberId(m.id); }}
                          sx={{ color: '#ef4444', '&:hover': { bgcolor: 'rgba(239,68,68,0.08)' } }}
                        >
                          <Delete fontSize="small" />
                        </IconButton>
                      </Tooltip>
                    </TableCell>
                  </TableRow>
                ))}
                {projectMembers.length === 0 && (
                  <TableRow>
                    <TableCell
                      colSpan={5}
                      align="center"
                      sx={{ py: 4, fontFamily: 'Inter, sans-serif', fontSize: 13, color: '#9ca3af' }}
                    >
                      No members assigned
                    </TableCell>
                  </TableRow>
                )}
              </TableBody>
            </Table>
          </TableContainer>
        
          <ConfirmDeleteDialog
            open={isOpen}
            title="Remove Member"
            message={<>Do you want to remove <b>{fullName}</b> from this project?</>   }
            confirmLabel="Confirm"
            onConfirm={() => handleRemove(memberId)}
            onClose={() => setIsOpen(false)}
          />

        </Box>
      )}
    </Box>
  );
};
