import { useEffect, useState } from 'react';
import {
  Box, Paper, Typography, MenuItem, TextField, Alert, Chip,
  Table, TableHead, TableBody, TableRow, TableCell, CircularProgress, Tooltip,
} from '@mui/material';
import { useExcelSprints, useExcelScorecard } from './hooks';

interface Props {
  projectId: number;
}

const Tile = ({ label, value, caption, bgcolor, color }: {
  label: string; value: string; caption?: string; bgcolor?: string; color?: string;
}) => (
  <Box sx={{ flex: '1 1 150px', p: 1.5, borderRadius: 1, bgcolor: bgcolor ?? '#f5f5f5', textAlign: 'center' }}>
    <Typography variant="caption" color="text.secondary" display="block">{label}</Typography>
    <Typography variant="h5" fontWeight={700} color={color}>{value}</Typography>
    {caption && <Typography variant="caption" color="text.secondary">{caption}</Typography>}
  </Box>
);

const fmtRange = (start: string | null, end: string | null) =>
  start && end ? `${start} – ${end}` : start || end || '';

/**
 * Reduced per-sprint delivery board for Excel (dataSourceType='excel') projects.
 * Flat snapshots carry no changelog, so churn/reopen/cycle/QA-quality metrics that the
 * Jira Board View reconstructs are intentionally absent — this shows the derivable subset.
 */
export const ExcelSprintBoard = ({ projectId }: Props) => {
  const sprintsQuery = useExcelSprints(projectId);
  // eslint-disable-next-line react-hooks/exhaustive-deps
  const sprints = sprintsQuery.data ?? [];
  const [selectedSprint, setSelectedSprint] = useState<string>('');

  // Default to the newest sprint once the list loads.
  useEffect(() => {
    if (!selectedSprint && sprints.length > 0) {
      setSelectedSprint(sprints[0].sprintName);
    }
  }, [sprints, selectedSprint]);

  const scorecardQuery = useExcelScorecard(projectId, selectedSprint || null);
  const sc = scorecardQuery.data;

  // Delivery basis is derived on the client from fields always present in the response,
  // so bug/QA sprints with no story points show ticket-based delivery even against an
  // older backend that doesn't send hasStoryPoints/ticketDeliveryPct.
  const hasSp = (sc?.totals.finalScopeSp ?? 0) > 0;
  const ticketDeliveryPct = sc && sc.totals.ticketCount > 0
    ? Math.round((sc.totals.completedCount / sc.totals.ticketCount) * 100)
    : 0;

  return (
    <Box>
      <Alert severity="info" sx={{ mb: 2, fontSize: 13 }}>
        Reduced metric set — this project's data comes from uploaded Excel snapshots.
        Churn, reopen, cycle-time and QA-quality metrics require Jira change-history and are
        unavailable for Excel projects.
      </Alert>

      <Box sx={{ display: 'flex', gap: 2, alignItems: 'flex-start', mb: 2, flexWrap: 'wrap' }}>
        <TextField
          select size="small" label="Sprint"
          value={selectedSprint}
          onChange={e => setSelectedSprint(e.target.value)}
          sx={{ minWidth: 280 }}
          disabled={sprintsQuery.isLoading || sprints.length === 0}
          helperText={!sprintsQuery.isLoading && sprints.length === 0 ? 'No Excel sprint uploads for this project yet' : undefined}
        >
          {sprints.map(s => (
            <MenuItem key={s.sprintName} value={s.sprintName}>
              {s.sprintName}{fmtRange(s.start, s.end) ? ` (${fmtRange(s.start, s.end)})` : ''}
            </MenuItem>
          ))}
        </TextField>
      </Box>

      {(sprintsQuery.isLoading || scorecardQuery.isLoading) && (
        <Box sx={{ p: 6, textAlign: 'center' }}><CircularProgress /></Box>
      )}

      {scorecardQuery.isError && (
        <Alert severity="error">Failed to load the sprint scorecard.</Alert>
      )}

      {sc && !scorecardQuery.isLoading && (
        <>
          {/* Headline tiles. For bug/QA sprints with no story points, delivery is measured
              by tickets done rather than SP (which would always read 0%). */}
          <Paper variant="outlined" sx={{ p: 2, mb: 2 }}>
            <Box sx={{ display: 'flex', gap: 1.5, flexWrap: 'wrap' }}>
              <Tile
                label="Delivery"
                value={`${hasSp ? sc.totals.deliveryPct : ticketDeliveryPct}%`}
                caption={hasSp ? 'by story points' : 'by tickets (no SP)'}
                bgcolor="#eef2ff"
              />
              <Tile
                label="Tickets Done"
                value={`${sc.totals.completedCount} / ${sc.totals.ticketCount}`}
                caption={`${ticketDeliveryPct}% done`}
                bgcolor="#e8f5e9"
                color="success.main"
              />
              <Tile
                label="Story Points"
                value={`${sc.totals.completedSp} / ${sc.totals.finalScopeSp} SP`}
                caption={hasSp ? `${sc.totals.deliveryPct}% delivered` : 'no SP in this sprint'}
              />
              <Tile
                label="Spillover"
                value={`${sc.totals.spilloverCount} ${sc.totals.spilloverCount === 1 ? 'ticket' : 'tickets'}`}
                caption={sc.totals.spilloverSp > 0 ? `${sc.totals.spilloverSp} SP not done` : 'not done'}
                bgcolor={sc.totals.spilloverCount > 0 ? '#fff8e1' : '#f5f5f5'}
                color={sc.totals.spilloverCount > 0 ? 'warning.main' : undefined}
              />
              <Tile label="Bugs" value={`${sc.totals.bugCount}`} caption="tickets" />
              <Tile
                label="Unassigned"
                value={`${sc.totals.unassignedCount}`}
                caption="tickets"
                bgcolor={sc.totals.unassignedCount > 0 ? '#fff8e1' : '#f5f5f5'}
                color={sc.totals.unassignedCount > 0 ? 'warning.main' : undefined}
              />
            </Box>

            {sc.totals.typeBreakdown.length > 0 && (
              <Box sx={{ display: 'flex', gap: 1, flexWrap: 'wrap', mt: 2 }}>
                {sc.totals.typeBreakdown.map(t => (
                  <Chip key={t.type} size="small" variant="outlined" label={`${t.type}: ${t.count} (${t.sp} SP)`} />
                ))}
              </Box>
            )}

            {sc.dataQuality.rowsMissingSp > 0 && (
              <Typography variant="caption" color="text.secondary" display="block" sx={{ mt: 1 }}>
                Note: {sc.dataQuality.rowsMissingSp} ticket{sc.dataQuality.rowsMissingSp === 1 ? '' : 's'} had no story points and count as 0 SP.
              </Typography>
            )}

            {/*
              Containers carry no effort of their own, so counting them as tickets understated
              delivery and inflated "Unassigned". They are still visible in the uploaded rows.
            */}
            {!!sc.dataQuality.containersExcluded && sc.dataQuality.containersExcluded > 0 && (
              <Typography variant="caption" color="text.secondary" display="block" sx={{ mt: 0.5 }}>
                Note: {sc.dataQuality.containersExcluded} Epic/Feature container
                {sc.dataQuality.containersExcluded === 1 ? '' : 's'} excluded — their effort sits on
                their child tickets.
              </Typography>
            )}

            {/*
              A mapping change does not re-parse uploads that already landed, so figures here can mix
              parses. Saying so is the honest alternative to silently presenting them as equivalent.
            */}
            {!!sc.dataQuality.staleMappingTickets && sc.dataQuality.staleMappingTickets > 0 && (
              <Typography variant="caption" color="warning.main" display="block" sx={{ mt: 0.5 }}>
                Note: {sc.dataQuality.staleMappingTickets} ticket
                {sc.dataQuality.staleMappingTickets === 1 ? ' was' : 's were'} imported under an
                earlier column mapping. Re-upload those files to parse them with the current one.
              </Typography>
            )}
          </Paper>

          {/* Developer table */}
          <Paper variant="outlined" sx={{ p: 2 }}>
            <Typography variant="subtitle2" fontWeight={700} sx={{ mb: 1 }}>Developer Performance</Typography>
            {sc.developers.length === 0 ? (
              <Typography variant="body2" color="text.secondary">No tickets in this sprint.</Typography>
            ) : (
              <Table size="small">
                <TableHead>
                  <TableRow>
                    <TableCell>Member</TableCell>
                    <Tooltip title="Story points of tickets assigned to this member in the sprint"><TableCell align="right">SP Planned</TableCell></Tooltip>
                    <Tooltip title="Story points of their tickets currently in a Done status"><TableCell align="right">SP Done</TableCell></Tooltip>
                    <Tooltip title="Story-point delivery (0% when the developer's tickets carry no story points)"><TableCell align="right">Delivery %</TableCell></Tooltip>
                    <Tooltip title="Tickets done / total assigned in this sprint"><TableCell align="right">Tickets</TableCell></Tooltip>
                    <TableCell align="right">Bugs</TableCell>
                  </TableRow>
                </TableHead>
                <TableBody>
                  {sc.developers.map(d => (
                    <TableRow key={d.assignee || '__unassigned__'} hover>
                      <TableCell>{d.assignee || <em>Unassigned</em>}</TableCell>
                      <TableCell align="right">{d.spPlanned}</TableCell>
                      <TableCell align="right">{d.spDone}</TableCell>
                      <TableCell align="right">{d.deliveryPct}%</TableCell>
                      <TableCell align="right">{d.completedCount} / {d.ticketCount}</TableCell>
                      <TableCell align="right">{d.bugCount}</TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            )}
          </Paper>
        </>
      )}
    </Box>
  );
};
