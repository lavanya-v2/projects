import { useState } from 'react';
import {
  Alert, Box, Chip, CircularProgress, MenuItem, Paper, TextField, Tooltip, Typography,
} from '@mui/material';
import { WarningAmberRounded, RepeatRounded } from '@mui/icons-material';
import { useAgreedPoints } from './hooks';
import { OUTCOME_COLORS, OUTCOME_LABELS, type RetroOutcome } from './types';

interface Project { id: number; name: string }

interface Props {
  projects: Project[];
}

/**
 * Everything a project has ever agreed to work on, grouped by theme.
 *
 * The reason this view exists is the recurring case: a point raised in three
 * consecutive retros that nobody ever actioned. Per-board views cannot show
 * that — you only see it by looking across retros — and it is the single most
 * useful thing the data can tell a lead.
 */
export default function AgreedPointsHistory({ projects }: Props) {
  const [projectId, setProjectId] = useState<number | ''>(projects[0]?.id ?? '');
  const history = useAgreedPoints(projectId || null);

  return (
    <Box>
      <TextField
        select size="small" label="Project" sx={{ minWidth: 260, mb: 2 }}
        value={projectId}
        onChange={e => setProjectId(Number(e.target.value))}
        inputProps={{ 'data-testid': 'agreed-project-select' }}
      >
        {projects.map(p => <MenuItem key={p.id} value={p.id}>{p.name}</MenuItem>)}
      </TextField>

      {history.isLoading && (
        <Box sx={{ display: 'flex', justifyContent: 'center', mt: 4 }}><CircularProgress /></Box>
      )}

      {history.isError && <Alert severity="error">Could not load agreed points.</Alert>}

      {history.data && history.data.totalPoints === 0 && (
        <Alert severity="info" data-testid="no-agreed-points">
          No agreed points recorded yet for this project. They appear here once a retro confirms its top 3.
        </Alert>
      )}

      {history.data && history.data.totalPoints > 0 && (
        <>
          <Typography variant="caption" color="text.secondary" sx={{ display: 'block', mb: 1.5 }}>
            {history.data.totalPoints} agreed point{history.data.totalPoints === 1 ? '' : 's'} across
            {' '}{history.data.themes.length} theme{history.data.themes.length === 1 ? '' : 's'}
          </Typography>

          {history.data.themes.map((theme, idx) => (
            <Paper
              key={idx}
              variant="outlined"
              data-testid={`agreed-theme-${idx}`}
              sx={{
                p: 1.75, mb: 1.5,
                borderLeft: theme.unresolvedRepeat ? '4px solid #d32f2f'
                  : theme.isRepeat ? '4px solid #ed6c02' : undefined,
              }}
            >
              <Box sx={{ display: 'flex', alignItems: 'center', gap: 1, mb: 1, flexWrap: 'wrap' }}>
                <Typography variant="body2" sx={{ fontWeight: 600, flexGrow: 1 }}>
                  {theme.label}
                </Typography>

                {theme.isRepeat && (
                  <Chip
                    size="small"
                    icon={<RepeatRounded sx={{ fontSize: 14 }} />}
                    label={`agreed in ${theme.occurrences.length} retros`}
                    data-testid={`repeat-badge-${idx}`}
                    sx={{ height: 22, fontSize: 11, bgcolor: '#fff3e0', color: '#e65100', fontWeight: 600 }}
                  />
                )}

                {theme.unresolvedRepeat && (
                  <Tooltip title="Raised more than once, and still nobody has actioned or closed it">
                    <Chip
                      size="small"
                      icon={<WarningAmberRounded sx={{ fontSize: 14 }} />}
                      label="never actioned"
                      data-testid={`unresolved-badge-${idx}`}
                      sx={{ height: 22, fontSize: 11, bgcolor: '#ffebee', color: '#c62828', fontWeight: 600 }}
                    />
                  </Tooltip>
                )}
              </Box>

              {theme.occurrences.map(o => (
                <Box
                  key={o.itemId}
                  sx={{ display: 'flex', alignItems: 'center', gap: 1, py: 0.4, flexWrap: 'wrap' }}
                >
                  <Typography variant="caption" color="text.secondary" sx={{ minWidth: 92 }}>
                    {o.meetingDate}
                  </Typography>
                  <Chip size="small" label={`#${o.topPickRank}`} sx={{ height: 18, fontSize: 10 }} />
                  <Typography variant="caption" sx={{ flexGrow: 1 }}>
                    {o.content}
                  </Typography>

                  {o.outcome && (
                    <Chip
                      size="small"
                      label={OUTCOME_LABELS[o.outcome as RetroOutcome]}
                      sx={{
                        height: 18, fontSize: 10, color: '#fff',
                        bgcolor: OUTCOME_COLORS[o.outcome as RetroOutcome],
                      }}
                    />
                  )}

                  {o.convertedType && (
                    <Chip
                      size="small" variant="outlined"
                      label={`${o.convertedType === 'RISK' ? 'Risk' : 'Action'} #${o.convertedRefId}`}
                      sx={{ height: 18, fontSize: 10 }}
                    />
                  )}
                </Box>
              ))}
            </Paper>
          ))}
        </>
      )}
    </Box>
  );
}
