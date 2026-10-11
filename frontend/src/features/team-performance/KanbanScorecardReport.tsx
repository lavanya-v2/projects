/* eslint-disable @typescript-eslint/no-explicit-any */
import {
  Accordion,
  AccordionDetails,
  AccordionSummary,
  Alert,
  Box,
  Card,
  Chip,
  CircularProgress,
  Grid,
  IconButton,
  Paper,
  Table,
  TableBody,
  TableCell,
  TableContainer,
  TableHead,
  TableRow,
  ToggleButton,
  ToggleButtonGroup,
  Typography,
  Tooltip,
} from '@mui/material';
import {
  BugReport,
  CalculateOutlined as CalculateIcon,
  CheckCircle,
  EmojiEvents,
  ExpandMore as ExpandMoreIcon,
  FormatListBulleted as ListIcon,
  InfoOutlined as InfoOutlinedIcon,
  Speed,
  Verified,
} from '@mui/icons-material';
import { fmtDate, metricVal } from './perfFormatters';
import { deliveryHex, effectiveQualityRate, qaRatingHex, qualityBandLabel } from './perfColors';
import { BUG_ESCAPE_HIGH, REWORK_HIGH, SHOW_KANBAN_LIVE_SPAN } from './perfConstants';
import { ScoreBadge } from './ScoreBadge';
import { DeliveryCell } from './DeliveryCell';
import { InFlightSpCell } from './InFlightSpCell';
import { KanbanDeveloperCard } from './KanbanDeveloperCard';
import { KanbanQaCard } from './KanbanQaCard';
import type { TrendsHistoryState } from './useKanbanTrendsHistory';
import type { UseQueryResult } from '@tanstack/react-query';
import type { LiveKanbanSpanState } from './useLiveKanbanSpan';
import { QaColumnGuide } from './QaColumnGuide';
import type { PerfSyncs } from './types';


interface ScorecardReport {
  kanbanLive: boolean;
  kanbanScorecard: any;
  kanbanScorecardLoading: boolean;
  perfSyncs: PerfSyncs[];
  perfSyncsLoading: boolean;
  cycleSyncEnabled: boolean;
  selectedSyncId: number | "";
  perfView: 'scorecard' | 'trends';
  setPerfView: (val: 'scorecard' | 'trends') => void;
  projectHasCommitment: boolean;
  kanbanTrends: TrendsHistoryState;
  kanbanSpanTicketsQuery: UseQueryResult<any[], Error>;
  kanbanSpanMode: 'live' | 'history';
  setKanbanSpanMode: (val: 'live' | 'history') => void;
  liveSpan: LiveKanbanSpanState;
  setBreakdownTarget: (val: any) => void;
  setDrilldownTarget: (val: any) => void;
}

interface KanbanTicket {
  jiraKey: string;
  summary: string;
  assigneeName?: string | null;
  issueType?: string | null;
  storyPoints?: number | null;
  wasCompleted: boolean;
}

const qaHasBoardActivity = (s: any): boolean =>
  Number(metricVal(s, 'ticketsTestedCount') ?? 0) > 0 ||
  Number(metricVal(s, 'bugsRaisedCount') ?? 0) > 0;

/**
 * Order Kanban developer cards so the most consistently active come first,
 * matching how the sprint view orders by sprints-on-the-board. A Kanban card
 * carries an entry for every period whether or not anything was delivered, so
 * `periods.length` says nothing — count the periods with actual delivery.
 * Deliberately a sort, not a filter: this is the internal view, where hiding a
 * low-participation developer defeats the point.
 */
function kanbanCardsByParticipation(cards: any[]): any[] {
  const activePeriods = (c: any) =>
    (c.periods ?? []).filter((p: any) => Number(p?.storiesDelivered ?? 0) > 0).length;
  return [...cards].sort((a, b) => {
    const d = activePeriods(b) - activePeriods(a);
    if (d !== 0) return d;
    const s = Number(b.avgStoriesPerPeriod ?? 0) - Number(a.avgStoriesPerPeriod ?? 0);
    return s !== 0 ? s : (a.displayName ?? '').localeCompare(b.displayName ?? '');
  });
}

export function KanbanScorecardReport({kanbanLive, kanbanScorecard,kanbanScorecardLoading, perfSyncs,perfSyncsLoading, cycleSyncEnabled, selectedSyncId, perfView, projectHasCommitment, kanbanTrends, kanbanSpanTicketsQuery, kanbanSpanMode, setKanbanSpanMode, liveSpan, setPerfView, setBreakdownTarget, setDrilldownTarget}: ScorecardReport){
    const kanbanResult = kanbanTrends.data;
    const kanbanLoading = kanbanTrends.loading;
    const kanbanError = kanbanTrends.error;
    const setKanbanError = kanbanTrends.setError;
    return(
        <>
          {perfSyncsLoading && (
            <Box sx={{ display: 'flex', justifyContent: 'center', py: 4 }}>
              <CircularProgress />
            </Box>
          )}
          {!perfSyncsLoading && !cycleSyncEnabled && perfSyncs.filter((s) => s.syncStatus === 'done').length === 0 && (
            <Paper sx={{ p: 4, textAlign: 'center' }}>
              <Typography variant="h6" color="text.secondary" gutterBottom>No performance data yet</Typography>
              <Typography variant="body2" color="text.secondary">
                Use the "Sync Period" button in the panel on the right to import data.
              </Typography>
            </Paper>
          )}

          {/* Kanban span-mode toggle \u2014 current in-progress span (live) vs a completed synced span.
              Hidden behind SHOW_KANBAN_LIVE_SPAN: with only "Completed spans" left there is
              nothing to toggle between, and the mode already defaults to 'history'. */}
          {cycleSyncEnabled && SHOW_KANBAN_LIVE_SPAN && (
            <Box sx={{ mb: 2, display: 'flex', alignItems: 'center', gap: 1.5 }}>
              <ToggleButtonGroup
                size="small"
                value={kanbanSpanMode}
                exclusive
                onChange={(_, v) => { if (v) setKanbanSpanMode(v); }}
              >
                <ToggleButton value="live">Current span (live)</ToggleButton>
                <ToggleButton value="history">Completed spans</ToggleButton>
              </ToggleButtonGroup>
              {kanbanSpanMode === 'live' && (
                <Typography variant="caption" color="text.secondary">
                  Always-fresh read of the in-progress cycle (cycle start to today).
                </Typography>
              )}
            </Box>
          )}

          {/* Kanban inline scorecard \u2014 live current span, or a selected completed span */}
          {(kanbanLive || selectedSyncId !== '') && (
            <Paper sx={{ mb: 3 }}>
              <Box sx={{ p: 2, borderBottom: '1px solid', borderColor: 'divider', display: 'flex', alignItems: 'center', gap: 1.5, flexWrap: 'wrap' }}>
                <Typography variant="subtitle1" fontWeight={700}>
                  {kanbanLive
                    ? (kanbanScorecard?.sync?.periodLabel ?? 'Current span')
                    : (perfSyncs.find((s) => s.id === selectedSyncId)?.periodLabel || perfSyncs.find((s) => s.id === selectedSyncId)?.sprintName)}{' \u2014 '}Scorecard
                </Typography>
                {kanbanLive && (
                  <Chip label="LIVE" size="small" color="success" sx={{ fontSize: 10, height: 18, fontWeight: 700 }} />
                )}
                <Box sx={{ ml: 'auto' }}>
                  <ToggleButtonGroup size="small" value={perfView} exclusive
                    onChange={(_, v) => { if (v) setPerfView(v); }}>
                    <ToggleButton value="scorecard">Scorecard</ToggleButton>
                    <ToggleButton value="trends">Trends</ToggleButton>
                  </ToggleButtonGroup>
                </Box>
              </Box>
              {kanbanScorecardLoading && (
                <Box sx={{ display: 'flex', justifyContent: 'center', py: 4 }}><CircularProgress /></Box>
              )}
              {kanbanLive && !kanbanScorecardLoading && liveSpan.error && (
                <Alert severity="error" sx={{ m: 2 }}>{liveSpan.error}</Alert>
              )}
              {!kanbanScorecardLoading && perfView === 'scorecard' && kanbanScorecard && (() => {
                const devScores = kanbanScorecard.scores.filter((s: any) => s.memberCategory !== 'qa');
                const qaScores = kanbanScorecard.scores.filter((s: any) => s.memberCategory === 'qa').filter(qaHasBoardActivity);
                const avgDelivery = devScores.length > 0
                  ? Math.round(devScores.reduce((sum: number, s: any) => sum + (metricVal(s, 'deliveryPct') ?? 0), 0) / devScores.length)
                  : null;
                // Exec Score bakes Delivery% in by construction (Delivery% x 0.8 +
                // (100 - Rework%) x 0.2) -- with no commitment target, that "score"
                // has no real meaning either, so it's nulled alongside Delivery%.
                const avgExec = (devScores.length > 0 && projectHasCommitment)
                  ? Math.round(devScores.reduce((sum: number, s: any) => sum + (metricVal(s, 'executionScore') ?? 0), 0) / devScores.length)
                  : null;
                const totalSpDelivered = devScores.length > 0
                  ? devScores.reduce((sum: number, s: any) => sum + (Number(s.spDone) || 0), 0)
                  : null;
                const totalBugs = qaScores.reduce((sum: number, s: any) => sum + (metricVal(s, 'bugsRaisedCount') ?? 0), 0);
                const ratedQrs = qaScores
                  .map((s: any) => effectiveQualityRate(metricVal(s, 'qualityRate'), metricVal(s, 'ticketsTestedCount')))
                  .filter((v: number | null) => v != null && v >= 0) as number[];
                const avgQuality = ratedQrs.length > 0
                  ? ratedQrs.reduce((sum, v) => sum + v, 0) / ratedQrs.length
                  : null;
                const qaRatingLabel = qualityBandLabel(avgQuality);
                const kDeliveryHex = deliveryHex(avgDelivery);
                return (
                  <Box sx={{ p: 2 }}>
                    <Box sx={{ mb: 2, display: 'flex', alignItems: 'center', gap: 1.5, flexWrap: 'wrap' }}>
                      <Typography variant="caption" color="text.secondary">
                        {fmtDate(kanbanScorecard.sync.startDate)}{' \u2013 '}{fmtDate(kanbanScorecard.sync.endDate)}
                      </Typography>
                      <Typography variant="caption" sx={{ color: 'success.main', fontWeight: 600 }}>
                        {kanbanLive ? 'Live \u2014 as of now' : `Synced ${fmtDate(kanbanScorecard.sync.syncedAt || kanbanScorecard.sync.createdAt)}`}
                      </Typography>
                    </Box>
                    <Grid container spacing={2} sx={{ mb: 2 }}>
                      <Grid size={projectHasCommitment ? { xs: 6, sm: 3 } : { xs: 6, sm: 4 }}>
                        <Card elevation={1} sx={{ borderRadius: 2, overflow: 'hidden' }}>
                          <Box sx={{ height: 4, background: kDeliveryHex === '#2e7d32' ? 'linear-gradient(90deg,#059669,#34d399)' : kDeliveryHex === '#ed6c02' ? 'linear-gradient(90deg,#d97706,#fbbf24)' : kDeliveryHex === '#d32f2f' ? 'linear-gradient(90deg,#dc2626,#f87171)' : 'linear-gradient(90deg,#94a3b8,#cbd5e1)' }} />
                          <Box sx={{ px: 2.25, pt: 2, pb: 1.75 }}>
                            {projectHasCommitment ? (
                              <>
                                <Tooltip title="Average, across developers, of each person's completed-vs-carried-over ratio this cycle. Kanban has no commitment target, so this is a WIP snapshot \u2014 not a percentage of the SP total shown in Trends, and the two figures are not expected to relate arithmetically.">
                                  <Box sx={{ display: 'flex', alignItems: 'center', gap: 0.75, mb: 1, cursor: 'help' }}>
                                    <Speed sx={{ fontSize: 13, color: kDeliveryHex }} />
                                    <Typography sx={{ fontSize: 9, fontWeight: 700, textTransform: 'uppercase', letterSpacing: '0.8px', color: '#94a3b8' }}>Avg Completion Ratio</Typography>
                                  </Box>
                                </Tooltip>
                                <Typography sx={{ fontSize: 32, fontWeight: 900, lineHeight: 1, letterSpacing: '-1px', color: kDeliveryHex }}>
                                  {avgDelivery != null ? `${avgDelivery}%` : '\u2014'}
                                </Typography>
                              </>
                            ) : (
                              <>
                                <Tooltip title="Total story points delivered by the team this cycle. This project has no committed sprint target, so there's no baseline to measure a percentage against \u2014 this is the raw throughput number.">
                                  <Box sx={{ display: 'flex', alignItems: 'center', gap: 0.75, mb: 1, cursor: 'help' }}>
                                    <Speed sx={{ fontSize: 13, color: '#4f46e5' }} />
                                    <Typography sx={{ fontSize: 9, fontWeight: 700, textTransform: 'uppercase', letterSpacing: '0.8px', color: '#94a3b8' }}>Total SP Delivered</Typography>
                                  </Box>
                                </Tooltip>
                                <Typography sx={{ fontSize: 32, fontWeight: 900, lineHeight: 1, letterSpacing: '-1px', color: '#4f46e5' }}>
                                  {totalSpDelivered != null ? totalSpDelivered : '\u2014'}
                                </Typography>
                              </>
                            )}
                          </Box>
                        </Card>
                      </Grid>
                      {projectHasCommitment && (
                        <Grid size={{ xs: 6, sm: 3 }}>
                          <Card elevation={1} sx={{ borderRadius: 2, overflow: 'hidden' }}>
                            <Box sx={{ height: 4, background: 'linear-gradient(90deg,#4f46e5,#818cf8)' }} />
                            <Box sx={{ px: 2.25, pt: 2, pb: 1.75 }}>
                              <Box sx={{ display: 'flex', alignItems: 'center', gap: 0.75, mb: 1 }}>
                                <EmojiEvents sx={{ fontSize: 13, color: '#4f46e5' }} />
                                <Typography sx={{ fontSize: 9, fontWeight: 700, textTransform: 'uppercase', letterSpacing: '0.8px', color: '#94a3b8' }}>Avg Exec Score</Typography>
                              </Box>
                              <Typography sx={{ fontSize: 32, fontWeight: 900, lineHeight: 1, letterSpacing: '-1px', color: '#4f46e5' }}>
                                {avgExec != null ? avgExec : '\u2014'}
                              </Typography>
                            </Box>
                          </Card>
                        </Grid>
                      )}
                      <Grid size={projectHasCommitment ? { xs: 6, sm: 3 } : { xs: 6, sm: 4 }}>
                        <Card elevation={1} sx={{ borderRadius: 2, overflow: 'hidden' }}>
                          <Box sx={{ height: 4, background: 'linear-gradient(90deg,#6366f1,#a5b4fc)' }} />
                          <Box sx={{ px: 2.25, pt: 2, pb: 1.75 }}>
                            <Tooltip title="Bugs and sub-bugs first logged during this sprint. Carryover bugs from prior sprints are excluded.">
                              <Box sx={{ display: 'flex', alignItems: 'center', gap: 0.75, mb: 1, cursor: 'help' }}>
                                <BugReport sx={{ fontSize: 13, color: '#6366f1' }} />
                                <Typography sx={{ fontSize: 9, fontWeight: 700, textTransform: 'uppercase', letterSpacing: '0.8px', color: '#94a3b8' }}>New Bugs</Typography>
                              </Box>
                            </Tooltip>
                            <Typography sx={{ fontSize: 32, fontWeight: 900, lineHeight: 1, letterSpacing: '-1px', color: '#6366f1' }}>{totalBugs > 0 ? totalBugs : '\u2014'}</Typography>
                          </Box>
                        </Card>
                      </Grid>
                      <Grid size={projectHasCommitment ? { xs: 6, sm: 3 } : { xs: 6, sm: 4 }}>
                        <Card elevation={1} sx={{ borderRadius: 2, overflow: 'hidden' }}>
                          <Box sx={{ height: 4, background: 'linear-gradient(90deg,#059669,#6ee7b7)' }} />
                          <Box sx={{ px: 2.25, pt: 2, pb: 1.75 }}>
                            <Box sx={{ display: 'flex', alignItems: 'center', gap: 0.75, mb: 1 }}>
                              <Verified sx={{ fontSize: 13, color: '#059669' }} />
                              <Typography sx={{ fontSize: 9, fontWeight: 700, textTransform: 'uppercase', letterSpacing: '0.8px', color: '#94a3b8' }}>QA Rating</Typography>
                            </Box>
                            <Typography sx={{ fontSize: qaRatingLabel.length > 3 ? 22 : 32, fontWeight: 900, lineHeight: 1, letterSpacing: '-1px', color: '#059669' }}>{qaRatingLabel}</Typography>
                          </Box>
                        </Card>
                      </Grid>
                    </Grid>
                    {devScores.length > 0 && (
                      <Paper sx={{ mb: 2 }}>
                        <Box sx={{
                          px: 2.5, py: 1.75,
                          background: 'linear-gradient(180deg, #f8fafc 0%, #fff 100%)',
                          borderBottom: '1px solid #e2e8f0',
                          display: 'flex', alignItems: 'center', gap: 1.25,
                        }}>
                          <Box sx={{ width: 4, height: 22, bgcolor: 'primary.main', borderRadius: 0.5, flexShrink: 0 }} />
                          <Typography sx={{ fontSize: 13, fontWeight: 700, color: '#0f172a' }}>Developer Performance</Typography>
                          <Tooltip
                            arrow
                            componentsProps={{ tooltip: { sx: { maxWidth: 480, fontSize: 11, lineHeight: 1.5, whiteSpace: 'pre-line' } } }}
                            title={
                              'Execution Score = Delivery% × 0.8 + (100 − Rework%) × 0.2. Higher is better.\n' +
                              '\n' +
                              '• Delivery% = SP Done / SP Planned × 100.\n' +
                              '\n' +
                              '• Rework% = SP Rework / SP Planned × 100 (lower is better). Rework SP = story points on tickets reopened or bounced back from QA/UAT for the same developer.\n' +
                              '\n' +
                              '• Cycle time = avg hours from In Progress to first QA handoff.\n' +
                              '\n' +
                              'Low-delivery flag: members with very few SP completed are tagged with an amber warning icon on the row.'
                            }
                          >
                            <InfoOutlinedIcon sx={{ fontSize: 16, color: '#64748b', cursor: 'help' }} />
                          </Tooltip>
                          <Box sx={{ flex: 1 }} />
                          <Chip label={`${devScores.length} members`} size="small" variant="outlined" sx={{ fontSize: 11 }} />
                        </Box>
                        <TableContainer>
                          <Table size="small">
                            <TableHead>
                              <TableRow>
                                <TableCell>Member</TableCell>
                                <TableCell align="center">Score</TableCell>
                                <TableCell align="center">{projectHasCommitment ? 'SP Done/Planned' : 'SP Done'}</TableCell>
                                <TableCell align="center">
                                  {projectHasCommitment ? 'Delivery %' : (
                                    <Box sx={{ display: 'inline-flex', alignItems: 'center', gap: 0.4 }}>
                                      SP In Flight
                                      <Tooltip arrow componentsProps={{ tooltip: { sx: { maxWidth: 420 } } }} title={
                                        <Box sx={{ p: 0.5 }}>
                                          <Typography variant="caption" component="div" sx={{ mb: 0.5 }}>
                                            Story points still in flight: work that <strong>moved during this cycle</strong>
                                            {' '}and had not finished by the end of it &mdash; not a snapshot of everything
                                            currently open.
                                          </Typography>
                                          <Typography variant="caption" component="div" sx={{ mb: 0.5 }}>
                                            <strong>Excludes</strong> work finished this cycle, sub-bugs (counted on the QA
                                            side, so the same defect is not counted twice), and administrative
                                            reassignments &mdash; a ticket handed over while already awaiting release,
                                            with no work done on it.
                                          </Typography>
                                          <Typography variant="caption" component="div">
                                            Includes work carried over from earlier cycles, so this is the full pending
                                            load. Cycles synced before this figure existed show an open-ticket count
                                            instead; re-sync to replace it with points.
                                          </Typography>
                                        </Box>
                                      }>
                                        <InfoOutlinedIcon sx={{ fontSize: 14, color: 'text.disabled', cursor: 'help' }} />
                                      </Tooltip>
                                    </Box>
                                  )}
                                </TableCell>
                                <TableCell align="center">Rework %</TableCell>
                                {!kanbanLive && <TableCell align="center">Actions</TableCell>}
                              </TableRow>
                            </TableHead>
                            <TableBody>
                              {devScores.map((s: any) => {
                                const exec = projectHasCommitment ? metricVal(s, 'executionScore') : null;
                                const dp = Number(metricVal(s, 'deliveryPct') ?? 0);
                                const rr = Number(metricVal(s, 'reworkFactor') ?? 0);
                                return (
                                  <TableRow key={s.jiraLoginId} hover>
                                    <TableCell>
                                      <Box sx={{ display: 'flex', alignItems: 'center', gap: 0.5 }}>
                                        {s.displayName}
                                        {s.isOverridden && (
                                          <Chip label="edited" size="small" sx={{ fontSize: 9, height: 16, bgcolor: '#e3f2fd', color: '#1565c0' }} />
                                        )}
                                      </Box>
                                    </TableCell>
                                    <TableCell align="center">
                                      {exec != null ? <ScoreBadge score={Number(exec)} /> : '\u2014'}
                                    </TableCell>
                                    <TableCell align="center">
                                      <strong>{s.spDone ?? '\u2014'}</strong>
                                      {/* No "/ planned" on a Kanban board: spPlanned is just done + still-open,
                                          a derived total of what was touched, not anything the team committed to. */}
                                      {projectHasCommitment && (
                                        <Typography component="span" variant="caption" color="text.secondary"> / {s.spPlanned ?? '\u2014'}</Typography>
                                      )}
                                    </TableCell>
                                    <TableCell align="center">
                                      {projectHasCommitment
                                        ? (dp > 0 ? <DeliveryCell pct={dp} /> : '\u2014')
                                        : <InFlightSpCell
                                            spOpen={metricVal(s, 'spOpen') as number | null | undefined}
                                            openTickets={Number(s.spilloverCount) || 0}
                                          />}
                                    </TableCell>
                                    <TableCell align="center">
                                      <Typography variant="caption" fontWeight={600}
                                        sx={{ color: rr === 0 ? '#2e7d32' : rr > REWORK_HIGH ? '#d32f2f' : '#ed6c02' }}>
                                        {rr.toFixed(1)}%
                                      </Typography>
                                    </TableCell>
                                    {!kanbanLive && (
                                      <TableCell align="center">
                                        <Tooltip title="Explain score">
                                          <IconButton size="small" onClick={() => setBreakdownTarget(s)}>
                                            <CalculateIcon fontSize="small" />
                                          </IconButton>
                                        </Tooltip>
                                        <Tooltip title="View tickets">
                                          <IconButton size="small" onClick={() => setDrilldownTarget(s)}>
                                            <ListIcon fontSize="small" />
                                          </IconButton>
                                        </Tooltip>
                                      </TableCell>
                                    )}
                                  </TableRow>
                                );
                              })}
                            </TableBody>
                          </Table>
                        </TableContainer>
                      </Paper>
                    )}
                    {qaScores.length > 0 && (
                      <Paper sx={{ mb: 2 }}>
                        <Box sx={{
                          px: 2.5, py: 1.75,
                          background: 'linear-gradient(180deg, #f8fafc 0%, #fff 100%)',
                          borderBottom: '1px solid #e2e8f0',
                          display: 'flex', alignItems: 'center', gap: 1.25,
                        }}>
                          <Box sx={{ width: 4, height: 22, bgcolor: '#059669', borderRadius: 0.5, flexShrink: 0 }} />
                          <Typography sx={{ fontSize: 13, fontWeight: 700, color: '#0f172a' }}>QA Performance</Typography>
                          <Box sx={{ flex: 1 }} />
                          <Chip label={`${qaScores.length} members`} size="small" variant="outlined" sx={{ fontSize: 11 }} />
                        </Box>
                        <QaColumnGuide />
                        <TableContainer>
                          <Table size="small">
                            <TableHead>
                              <TableRow>
                                <TableCell>Member</TableCell>
                                <TableCell align="center">
                                  <Tooltip title="Bugs and sub-bugs first logged during this span. Carryover bugs from prior spans are excluded.">
                                    <span style={{ cursor: 'help' }}>New Bugs</span>
                                  </Tooltip>
                                </TableCell>
                                <TableCell align="center">Weighted</TableCell>
                                <TableCell align="center">Quality</TableCell>
                                <TableCell align="center">Tested</TableCell>
                                <TableCell align="center">QA Cycle</TableCell>
                                <TableCell align="center">Escape %</TableCell>
                                {!kanbanLive && <TableCell align="center">Actions</TableCell>}
                              </TableRow>
                            </TableHead>
                            <TableBody>
                              {qaScores.map((s: any) => {
                                const qrRaw = metricVal(s, 'qualityRate');
                                const testedForRating = metricVal(s, 'ticketsTestedCount');
                                const qrVal = effectiveQualityRate(qrRaw, testedForRating);
                                const er = metricVal(s, 'bugEscapeRatePct');
                                const qrNum = Number(qrVal ?? 0);
                                const qrLabel = qualityBandLabel(qrVal);
                                const qrTextColor = qrVal == null ? 'text.secondary' : qaRatingHex(qrNum);
                                const ws = metricVal(s, 'weightedBugScore');
                                return (
                                  <TableRow key={s.jiraLoginId} hover>
                                    <TableCell>
                                      <Box sx={{ display: 'flex', alignItems: 'center', gap: 0.5 }}>
                                        {s.displayName}
                                        {s.isOverridden && (
                                          <Chip label="edited" size="small" sx={{ fontSize: 9, height: 16, bgcolor: '#e3f2fd', color: '#1565c0' }} />
                                        )}
                                      </Box>
                                    </TableCell>
                                    <TableCell align="center">{metricVal(s, 'bugsRaisedCount') ?? '—'}</TableCell>
                                    <TableCell align="center">{ws != null ? Number(ws).toFixed(1) : '—'}</TableCell>
                                    <TableCell align="center">
                                      {qrVal != null ? (
                                        <Typography variant="body2" fontWeight={700} sx={{ color: qrTextColor }}>{qrLabel}</Typography>
                                      ) : <Typography variant="caption" color="text.secondary">&mdash;</Typography>}
                                    </TableCell>
                                    <TableCell align="center">{metricVal(s, 'ticketsTestedCount') ?? '—'}</TableCell>
                                    <TableCell align="center">
                                      {metricVal(s, 'avgQaCycleTimeHours') != null
                                        ? `${Number(metricVal(s, 'avgQaCycleTimeHours')).toFixed(1)}h`
                                        : '—'}
                                    </TableCell>
                                    <TableCell align="center">
                                      {er != null ? (() => {
                                        const n = Number(er);
                                        const color = n > BUG_ESCAPE_HIGH ? '#d32f2f' : n > 0 ? '#ed6c02' : '#2e7d32';
                                        return (
                                          <Typography variant="caption" fontWeight={700} sx={{ color }}>{n.toFixed(1)}%</Typography>
                                        );
                                      })() : <Typography variant="caption" color="text.secondary">&mdash;</Typography>}
                                    </TableCell>
                                    {!kanbanLive && (
                                      <TableCell align="center">
                                        <Tooltip title="Explain score">
                                          <IconButton size="small" onClick={() => setBreakdownTarget(s)}>
                                            <CalculateIcon fontSize="small" />
                                          </IconButton>
                                        </Tooltip>
                                        <Tooltip title="View tickets">
                                          <IconButton size="small" onClick={() => setDrilldownTarget(s)}>
                                            <ListIcon fontSize="small" />
                                          </IconButton>
                                        </Tooltip>
                                      </TableCell>
                                    )}
                                  </TableRow>
                                );
                              })}
                            </TableBody>
                          </Table>
                        </TableContainer>
                      </Paper>
                    )}
                    {!kanbanLive && (() => {
                      const allTickets = (kanbanSpanTicketsQuery.data ?? []) as KanbanTicket[];
                      const completed = allTickets.filter((t) => t.wasCompleted);
                      if (completed.length === 0) return null;
                      return (
                        <Accordion elevation={1} sx={{ mb: 2, borderRadius: '8px !important', '&:before': { display: 'none' } }}>
                          <AccordionSummary expandIcon={<ExpandMoreIcon />} sx={{ px: 2, py: 1.5, minHeight: 0, '& .MuiAccordionSummary-content': { my: 0, alignItems: 'center', gap: 1 } }}>
                            <CheckCircle sx={{ color: '#2e7d32', fontSize: 18 }} />
                            <Typography variant="subtitle2" fontWeight={700}>Completed Tickets</Typography>
                            <Typography variant="caption" color="text.secondary">(moved to Done in this span)</Typography>
                            <Chip label={completed.length} color="success" size="small" sx={{ ml: 'auto', mr: 1 }} />
                          </AccordionSummary>
                          <AccordionDetails sx={{ p: 0 }}>
                            <TableContainer>
                              <Table size="small">
                                <TableHead>
                                  <TableRow sx={{ bgcolor: '#f5f5f5' }}>
                                    <TableCell sx={{ fontWeight: 700 }}>Key</TableCell>
                                    <TableCell sx={{ fontWeight: 700 }}>Summary</TableCell>
                                    <TableCell sx={{ fontWeight: 700 }}>Assignee</TableCell>
                                    <TableCell align="center" sx={{ fontWeight: 700 }}>Type</TableCell>
                                    <TableCell align="center" sx={{ fontWeight: 700 }}>SP</TableCell>
                                  </TableRow>
                                </TableHead>
                                <TableBody>
                                  {completed.map((t) => (
                                    <TableRow key={t.jiraKey} hover>
                                      <TableCell>
                                        <Typography variant="body2" fontWeight={600} color="primary.main">{t.jiraKey}</Typography>
                                      </TableCell>
                                      <TableCell sx={{ maxWidth: 320 }}>
                                        <Tooltip title={t.summary}>
                                          <Typography variant="body2" noWrap>{t.summary}</Typography>
                                        </Tooltip>
                                      </TableCell>
                                      <TableCell>
                                        <Typography variant="body2">{t.assigneeName ?? '—'}</Typography>
                                      </TableCell>
                                      <TableCell align="center">
                                        <Chip label={t.issueType} size="small" variant="outlined" />
                                      </TableCell>
                                      <TableCell align="center">{t.storyPoints != null ? t.storyPoints : '—'}</TableCell>
                                    </TableRow>
                                  ))}
                                </TableBody>
                              </Table>
                            </TableContainer>
                          </AccordionDetails>
                        </Accordion>
                      );
                    })()}
                  </Box>
                );
              })()}
              {perfView === 'trends' && (
                <Box sx={{ p: 2 }}>
                  <Typography variant="caption" color="text.secondary" sx={{ display: 'block', mb: 2 }}>
                    {/* Was reading `scorecard` (the sprint-path state, always empty in
                        Kanban live mode) instead of `kanbanScorecard`, so this line was
                        blank whenever there was no persisted selectedSyncId. */}
                    {kanbanScorecard?.sync?.startDate} – {kanbanScorecard?.sync?.endDate}
                  </Typography>
                  {kanbanLoading && <Box sx={{ display: 'flex', justifyContent: 'center', py: 4 }}><CircularProgress /></Box>}
                  {kanbanError && <Alert severity="error" onClose={() => setKanbanError('')} sx={{ mb: 2 }}>{kanbanError}</Alert>}
                  {!kanbanLoading && kanbanResult && (kanbanResult.developers.length > 0 || kanbanResult.qa.length > 0) && (
                    <>
                      {kanbanResult.developers.length > 0 && (
                        <>
                          <Typography variant="subtitle2" fontWeight={700} sx={{ mb: 1 }}>Developers</Typography>
                          <Grid container spacing={2} sx={{ mb: 2 }}>
                            {/* Same ordering intent as the sprint view: most
                                consistently active first. Kanban has a period
                                entry even when nothing was delivered, so count
                                periods with actual delivery rather than length. */}
                            {kanbanCardsByParticipation(kanbanResult.developers).map((card: any) => (
                              <Grid size={{ xs: 12, sm: 6, md: 4 }} key={card.jiraLoginId}>
                                <KanbanDeveloperCard card={card} />
                              </Grid>
                            ))}
                          </Grid>
                        </>
                      )}
                      {kanbanResult.qa.length > 0 && (
                        <>
                          <Typography variant="subtitle2" fontWeight={700} sx={{ mb: 1 }}>QA</Typography>
                          <Grid container spacing={2}>
                            {kanbanResult.qa.map((card) => (
                              <Grid size={{ xs: 12, sm: 6, md: 4 }} key={card.jiraLoginId}>
                                <KanbanQaCard card={card} />
                              </Grid>
                            ))}
                          </Grid>
                        </>
                      )}
                    </>
                  )}
                </Box>
              )}
            </Paper>
          )}
        </>
    )
}