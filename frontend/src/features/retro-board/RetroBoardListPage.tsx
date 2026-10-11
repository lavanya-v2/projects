import { useEffect, useMemo, useState } from 'react';
import { useNavigate, useSearchParams } from 'react-router-dom';
import {
  Box, Button, Card, CardActionArea, CardContent, Chip, CircularProgress,
  Alert, MenuItem, Tab, Tabs, TextField, Typography,
} from '@mui/material';
import { AddRounded } from '@mui/icons-material';
import { useRetroBoards } from './hooks';
import AgreedPointsHistory from './AgreedPointsHistory';
import { useProjects } from '../auth/hooks';
import RetroBoardCreateModal from './RetroBoardCreateModal';
import { usePermissions } from '../../shared/hooks/usePermissions';
import { retroBoardUrl } from '../../routes/paths';
import { STATUS_COLORS, STATUS_LABELS, type RetroBoard } from './types';
import { useAccount } from '../../context/UseAccount';

export default function RetroBoardListPage() {
  const navigate = useNavigate();
  const { canCreateRetroBoard } = usePermissions();
  const boardsQuery = useRetroBoards();
  const { activeAccount } = useAccount();
  const projectsQuery = useProjects(activeAccount?.id);
  const [creating, setCreating] = useState(false);
  const [projectFilter, setProjectFilter] = useState<'ALL' | number>('ALL');

  const [searchParams, setSearchParams] = useSearchParams();
  const rawParamTab = searchParams.get('tab') || "boards";
  const tab = rawParamTab;

  useEffect(()=>{
    if(!searchParams.get('tab')){
      setSearchParams({tab: 'boards'},{replace: true});
    }
  },[searchParams,setSearchParams])

  const open = (board: RetroBoard) => navigate(retroBoardUrl(board.shareToken));

  /**
   * Group the boards by project.
   *
   * The project list is derived from the boards themselves rather than from
   * useProjects: it costs no extra request, and it can never offer a project
   * that has no retros, so choosing a filter option always shows something.
   *
   * Projects are ordered by their most recent retro so whatever the team is
   * actively running floats to the top. Within a project the API already
   * returns meetingDate DESC, so no re-sort is needed here.
   */
  const groups = useMemo(() => {
    const byProject = new Map<number, { projectId: number; projectName: string; boards: RetroBoard[] }>();

    for (const board of boardsQuery.data ?? []) {
      const existing = byProject.get(board.projectId);
      if (existing) existing.boards.push(board);
      else byProject.set(board.projectId, {
        projectId: board.projectId,
        projectName: board.projectName ?? `Project #${board.projectId}`,
        boards: [board],
      });
    }

    return [...byProject.values()].sort(
      (a, b) => (b.boards[0]?.meetingDate ?? '').localeCompare(a.boards[0]?.meetingDate ?? '')
    );
  }, [boardsQuery.data]);

  // Most people are on one project; a filter reading "All projects" above a
  // single heading is noise, so the grouping chrome only appears when it earns
  // its place.
  const multiProject = groups.length > 1;
  const visibleGroups = projectFilter === 'ALL'
    ? groups
    : groups.filter(g => g.projectId === projectFilter);

  return (
    <Box sx={{ width: '100%'}}>
      {/* A sub-view of retros rather than a peer of them, so it lives here as a
          tab instead of adding a fourth entry to the Management nav. */}
      <Tabs value={tab} onChange={(_, v) => setSearchParams({tab: v})} sx={{ mb: 2, minHeight: 40 }}>
        <Tab label="Boards" value="boards" sx={{ minHeight: 40 }} data-testid="tab-boards" />
        <Tab label="Agreed Points" value="agreed-points" sx={{ minHeight: 40 }} data-testid="tab-agreed-points" />
      </Tabs>

      {tab === 'agreed-points' && <AgreedPointsHistory projects={projectsQuery.data ?? []} />}

      {tab === 'boards' && (
      <>
      {boardsQuery.isLoading && (
        <Box sx={{ display: 'flex', justifyContent: 'center', mt: 6 }}><CircularProgress /></Box>
      )}

      {boardsQuery.isError && <Alert severity="error">Could not load retro boards.</Alert>}

      {boardsQuery.data?.length === 0 && (
        <Alert severity="info" data-testid="no-boards">
          No retro boards yet.
          {canCreateRetroBoard
            ? ' Create one to get started — participants join with the share link.'
            : ' Your team lead can create one and share the link with you.'}
        </Alert>
      )}
      <Box 
        sx={{ 
          display: 'flex', 
          alignItems: 'center', 
          justifyContent: 'space-between',
          width: '100%',
          mb: 2
        }}
      >
        {multiProject ? (
          <TextField
            select 
            size="small" 
            label="Project" 
            sx={{ minWidth: 240 }}
            value={projectFilter}
            onChange={e => setProjectFilter(e.target.value === 'ALL' ? 'ALL' : Number(e.target.value))}
            inputProps={{ 'data-testid': 'board-project-filter' }}
          >
            <MenuItem value="ALL">All projects</MenuItem>
            {groups.map(g => (
              <MenuItem key={g.projectId} value={g.projectId}>
                {g.projectName} ({g.boards.length})
              </MenuItem>
            ))}
          </TextField>
        ) : (
          <Box />
        )}

        {canCreateRetroBoard && (
          <Button
            variant="contained" 
            startIcon={<AddRounded />}
            onClick={() => setCreating(true)} 
            data-testid="new-retro"
          >
            New Retro
          </Button>
        )}
      </Box>


      {visibleGroups.map(group => (
        <Box key={group.projectId} sx={{ mb: 3 }} data-testid={`project-group-${group.projectId}`}>
          {/* Headings only make sense when there is more than one project to
              tell apart. */}
          {multiProject && (
            <Box sx={{ display: 'flex', alignItems: 'center', gap: 1, mb: 1 }}>
              <Typography
                variant="overline"
                sx={{ fontWeight: 700, letterSpacing: 0.6, color: 'text.secondary' }}
                data-testid={`project-heading-${group.projectId}`}
              >
                {group.projectName}
              </Typography>
              <Chip size="small" label={group.boards.length} sx={{ height: 18, fontSize: 10 }} />
            </Box>
          )}

          <Box sx={{ display: 'grid', gridTemplateColumns: { xs: '1fr', sm: '1fr 1fr', md: '1fr 1fr 1fr' }, gap: 2 }}>
            {group.boards.map(board => (
              <Card key={board.id} variant="outlined" data-testid={`board-card-${board.id}`}>
                <CardActionArea onClick={() => open(board)}>
                  <CardContent>
                    <Box sx={{ display: 'flex', alignItems: 'center', gap: 1, mb: 1 }}>
                      <Chip
                        size="small" label={STATUS_LABELS[board.status]}
                        sx={{ bgcolor: STATUS_COLORS[board.status], color: '#fff', fontWeight: 600 }}
                      />
                      {board.isFacilitator && <Chip size="small" variant="outlined" label="You facilitate" />}
                    </Box>
                    <Typography variant="subtitle1" sx={{ fontWeight: 600 }}>{board.title}</Typography>
                    {/* Redundant under a project heading, but the anchor a
                        single-project user still needs. */}
                    {!multiProject && (
                      <Typography variant="body2" color="text.secondary">
                        {board.projectName ?? `Project #${board.projectId}`}
                      </Typography>
                    )}
                    <Typography variant="caption" color="text.secondary">
                      {board.meetingDate} at {board.meetingTime}
                    </Typography>
                  </CardContent>
                </CardActionArea>
              </Card>
            ))}
          </Box>
        </Box>
      ))}
      </>
      )}

      {creating && (
        <RetroBoardCreateModal
          onClose={() => setCreating(false)}
          onCreated={board => { setCreating(false); open(board); }}
        />
      )}
    </Box>
  );
}
