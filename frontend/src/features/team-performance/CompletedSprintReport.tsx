/* eslint-disable @typescript-eslint/no-explicit-any */
import {
  Accordion,
  AccordionDetails,
  AccordionSummary,
  Alert,
  Box,
  Card,
  Chip,
  Grid,
  IconButton,
  Link,
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
  CircularProgress,
  FormControlLabel,
  Switch,
} from '@mui/material';
import {
  BugReport,
  CalculateOutlined as CalculateIcon,
  Edit as EditIcon,
  EmojiEvents,
  ExpandMore as ExpandMoreIcon,
  FormatListBulleted as ListIcon,
  InfoOutlined as InfoOutlinedIcon,
  Speed,
  Verified,
  WarningAmber,
} from '@mui/icons-material';
import { deliveryHex, effectiveQualityRate, qaRatingHex, qualityBandLabel } from './perfColors';
import { decodeName, fmtDate, metricVal } from './perfFormatters';
import { BUG_ESCAPE_HIGH, LOW_SP_THRESHOLD, REWORK_HIGH } from './perfConstants';
import { useState } from 'react';
import { ScoreBadge } from './ScoreBadge';
import { DeliveryCell } from './DeliveryCell';
import { QaColumnGuide } from './QaColumnGuide';
import { DeveloperCard } from './DeveloperCard';
import type { ScorecardState } from './useTeamPerfScorecard';
import type { TrendsHistoryState } from './useSprintTrendsHistory';
import type { PerfSyncs, ProjectTeamMembers, TeamPerformanceSprint } from './types';


interface SprintReport {
    isKanban: boolean;
    isMember: boolean;
    perfSyncs: PerfSyncs[];
    scorecardState: ScorecardState;
    sprintTrends: TrendsHistoryState;
    perfView: 'scorecard' | 'trends';
    selectedSyncId: number | "";
    completedSprintSync: any;
    selectedSprint: TeamPerformanceSprint | undefined;
    teamMembers: ProjectTeamMembers[];
    setPerfView: (val: 'scorecard' | 'trends') => void;
    setMethodologyOpen: (val: boolean) => void;
    setOverrideTarget: (val:any) => void;
    setDrilldownTarget: (val: any) => void;
    setBreakdownTarget: (val: any) => void;
}

const qaHasBoardActivity = (s: any): boolean =>
  Number(metricVal(s, 'ticketsTestedCount') ?? 0) > 0 ||
  Number(metricVal(s, 'bugsRaisedCount') ?? 0) > 0;


export function CompletedSprintReport ({isKanban, isMember, perfSyncs, scorecardState, sprintTrends, perfView,selectedSyncId, completedSprintSync, selectedSprint,teamMembers, setPerfView, setMethodologyOpen,setOverrideTarget, setDrilldownTarget, setBreakdownTarget}: SprintReport){
    // Scorecard (Developer/QA Performance) scope: V2-only vs whole team. Default whole.
    const [scorecardV2Only, setScorecardV2Only] = useState(false);
    // activeSyncMeta: whichever sync is currently displayed — either the one the user
    // clicked in the right panel (selectedSyncId) or the one auto-selected for this sprint.
    const activeSyncMeta = perfSyncs.find((s) => s.id === selectedSyncId) ?? completedSprintSync;
    const scorecard = scorecardState.data;
    const scorecardLoading = scorecardState.loading;
    const scorecardError = scorecardState.error;
    const setScorecardError = scorecardState.setError;
    const historyResult = sprintTrends.data;
    const historyLoading = sprintTrends.loading;
    const historyError = sprintTrends.error;
    const setHistoryError = sprintTrends.setError;
    const [trendsV2Only, setTrendsV2Only] = useState(false);
    return (
        <Paper sx={{ mb: 3 }}>
            {/* Header */}
            <Box sx={{ px: 3, py: 2,
            background: 'linear-gradient(90deg, #f5f7ff 0%, #ffffff 100%)',
            borderBottom: '1px solid', borderColor: 'divider',
            display: 'flex', alignItems: 'center', gap: 1.5, flexWrap: 'wrap' }}>
            <Box sx={{ width: 4, height: 32, bgcolor: 'primary.main', borderRadius: 1, flexShrink: 0 }} />
            <Typography variant="h6" fontWeight={700} sx={{ flex: 1 }}>
                {decodeName(activeSyncMeta?.sprintName ?? selectedSprint?.name ?? '')}
            </Typography>
            <Chip
                label={`Synced ${fmtDate(activeSyncMeta?.syncedAt || activeSyncMeta?.createdAt)}`}
                color="success" size="small" variant="outlined"
            />
            <ToggleButtonGroup size="small" value={perfView} exclusive
                onChange={(_, v) => { if (v) setPerfView(v); }}>
                <ToggleButton value="scorecard">Scorecard</ToggleButton>
                <ToggleButton value="trends">Trends</ToggleButton>
            </ToggleButtonGroup>
            </Box>

            {/* Loading */}
            {scorecardLoading && (
            <Box sx={{ display: 'flex', justifyContent: 'center', py: 4 }}>
                <CircularProgress />
            </Box>
            )}

            {/* Scorecard view */}
            {!scorecardLoading && perfView === 'scorecard' && (
            <>
                {scorecardError && <Alert severity="error" onClose={() => setScorecardError('')} sx={{ m: 2 }}>{scorecardError}</Alert>}
                {!scorecard && !scorecardError && (
                <Alert severity="info" sx={{ m: 2 }}>Loading scorecard data\u2026</Alert>
                )}
            </>
            )}

            {!scorecardLoading && perfView === 'scorecard' && scorecard && (() => {
            // V2-only toggle (Developer/QA Performance tables). Backend tags each
            // score with isV2 via the name-matcher (member-score login ids are
            // Jira account ids, so a client-side roster match would miss). Toggle
            // is only meaningful when at least one V2 member is present.
            const hasV2Scores = scorecard.scores.some((s: any) => s.isV2);
            const scopedScores = (scorecardV2Only && hasV2Scores)
                ? scorecard.scores.filter((s: any) => s.isV2)
                : scorecard.scores;
            const devScores = scopedScores.filter((s: any) => s.memberCategory !== 'qa');
            const qaScores = scopedScores.filter((s: any) => s.memberCategory === 'qa').filter(qaHasBoardActivity);
            // Unfiltered presence, independent of the V2-only toggle — used to gate
            // the panels (and the toggle control itself) so a V2-only filter that
            // legitimately matches nobody shows an empty state instead of unmounting
            // the whole panel, which also took the toggle out of the DOM with it.
            const hasAnyDevScores = scorecard.scores.some((s: any) => s.memberCategory !== 'qa');
            const hasAnyQaScores = scorecard.scores
                .filter((s: any) => s.memberCategory === 'qa')
                .some(qaHasBoardActivity);
            const devSpDone = devScores.reduce((sum: number, s: any) => sum + (metricVal(s, 'spDone') ?? 0), 0);
            const devSpPlanned = devScores.reduce((sum: number, s: any) => sum + (metricVal(s, 'spPlanned') ?? 0), 0);
            const avgDelivery = devScores.length > 0
                ? Math.round(devScores.reduce((sum: number, s: any) => sum + (metricVal(s, 'deliveryPct') ?? 0), 0) / devScores.length)
                : null;
            const avgExec = devScores.length > 0
                ? Math.round(devScores.reduce((sum: number, s: any) => sum + (metricVal(s, 'executionScore') ?? 0), 0) / devScores.length)
                : null;
            const totalBugs = qaScores.reduce((sum: number, s: any) => sum + (metricVal(s, 'bugsRaisedCount') ?? 0), 0);
            const ratedQrs = qaScores
                .map((s: any) => effectiveQualityRate(metricVal(s, 'qualityRate'), metricVal(s, 'ticketsTestedCount')))
                .filter((v: any) => v != null && v >= 0) as number[];
            const avgQualityRate = ratedQrs.length > 0
                ? ratedQrs.reduce((sum, v) => sum + v, 0) / ratedQrs.length
                : null;
            const qaRatingLabel = qualityBandLabel(avgQualityRate);

            // Sprint Summary aggregates — derived from per-member sync scores
            const syncSpPlanned = scorecard.scores.reduce((sum: number, s: any) => sum + (metricVal(s, 'spPlanned') ?? 0), 0);
            const syncSpDone = scorecard.scores.reduce((sum: number, s: any) => sum + (metricVal(s, 'spDone') ?? 0), 0);
            const syncCarryOverSp = scorecard.scores.reduce((sum: number, s: any) => sum + (metricVal(s, 'spCarriedOver') ?? 0), 0);
            const syncCarryOverCount = scorecard.scores.reduce((sum: number, s: any) => sum + (metricVal(s, 'spilloverCount') ?? 0), 0);
            const syncScopeCreepCount: number = scorecard.scopeCreepCount ?? 0;
            const syncScopeCreepSp: number = scorecard.scopeCreepSp ?? 0;
            const syncV2ScopeCreepCount: number = scorecard.v2ScopeCreepCount ?? 0;
            const syncV2ScopeCreepSp: number = scorecard.v2ScopeCreepSp ?? 0;
            const syncPuntedCount: number = scorecard.puntedCount ?? 0;
            const syncPuntedSp: number = scorecard.puntedSp ?? 0;
            const syncV2PuntedCount: number = scorecard.v2PuntedCount ?? 0;
            const syncV2PuntedSp: number = scorecard.v2PuntedSp ?? 0;
            const syncCommittedSp: number | null = scorecard.committedSp ?? null;
            const syncNetScopeChangeSp: number | null = scorecard.netScopeChangeSp ?? null;
            const syncTotalCompletedSp: number = scorecard.totalCompletedSp ?? syncSpDone;
            const syncFinalScopeSp: number = scorecard.finalScopeSp ?? syncSpPlanned;
            const syncUnassignedCount: number = scorecard.unassignedTicketCount ?? 0;
            const syncQualityFlags: string[] = scorecard.qualityReport?.divergenceFlags ?? [];
            // Delivery % uses raw totalCompletedSp / finalScopeSp (captures unassigned work)
            const effectiveDeliveryPct = syncFinalScopeSp > 0
                ? Math.round((syncTotalCompletedSp / syncFinalScopeSp) * 100)
                : 0;

            const dHex = deliveryHex(avgDelivery);
            const qHex = qaRatingHex(avgQualityRate);
            const showDataQualityBanner = syncUnassignedCount > 0 || syncQualityFlags.length > 0;
            const renderDataQualityBanner = () => {
                if (!showDataQualityBanner) return null;
                type Block = { headline: string; cause?: string; recommend?: string };
                const blocks: Block[] = [];
                if (syncUnassignedCount > 0) {
                blocks.push({
                    headline: `${syncUnassignedCount} unassigned ticket${syncUnassignedCount === 1 ? '' : 's'} in this sprint — Scrum Master may exclude these. Expand the Carry-Over / Removed accordions to inspect.`,
                });
                }
                const qr = scorecard.qualityReport;
                if (syncQualityFlags.includes('committed_diff_gt_10pct') && qr) {
                const jiraEq = (qr.jiraInitialCompletedSp ?? 0) + (qr.jiraInitialNotCompletedSp ?? 0);
                const ours = qr.ourCommittedSp ?? 0;
                const overcounting = ours > jiraEq;
                blocks.push({
                    headline: `Committed differs: ${ours} SP (ours) vs ${jiraEq} SP (Jira sprint-report).`,
                    cause: overcounting
                    ? 'Team groomed scope after sprint start — we capture the pre-grooming state, Jira/SM uses the post-grooming state. Common when planning ceremony runs concurrently with sprint kickoff.'
                    : 'Jira\'s "initial estimate" includes scope-added tickets that already had SP when they were added; ours captures only what was in the sprint at the literal start moment.',
                    recommend: overcounting
                    ? `Use Jira's ${jiraEq} SP if presenting (matches SM's typical report).`
                    : `Our ${ours} SP is closer to SM's planning-time commitment.`,
                });
                }
                if (syncQualityFlags.includes('done_diff_gt_10pct') && qr) {
                const jiraEq = (qr.jiraCompletedSp ?? 0) + (qr.jiraCompletedInAnotherSp ?? 0);
                const ours = qr.ourCompletedSp ?? 0;
                const undercounting = ours < jiraEq;
                blocks.push({
                    headline: `Total Completed differs: ${ours} SP (ours) vs ${jiraEq} SP (Jira sprint-report).`,
                    cause: undercounting
                    ? 'Jira credits tickets started in this sprint but completed in another (issuesCompletedInAnotherSprint). Our resolutiondate-window rule may not catch these if resolution happened after sprint end.'
                    : 'Some tickets are in "Closed" status that this Jira board doesn\'t map to its Done column. Our fallback (resolutiondate within sprint window) credits them.',
                    recommend: undercounting
                    ? `Use Jira's ${jiraEq} SP if SM counts cross-sprint completion.`
                    : `Our ${ours} SP is correct for actual delivered work.`,
                });
                }
                return (
                <Accordion
                    defaultExpanded={false}
                    elevation={0}
                    disableGutters
                    sx={{
                    mb: 2,
                    borderRadius: '4px !important',
                    bgcolor: '#fffbeb',
                    border: '1px solid #fde68a',
                    '&:before': { display: 'none' },
                    }}
                >
                    <AccordionSummary
                    expandIcon={<ExpandMoreIcon sx={{ color: '#92400e' }} fontSize="small" />}
                    sx={{ px: 1.5, py: 0.5, minHeight: 0,
                            '& .MuiAccordionSummary-content': { my: 0.5, alignItems: 'center', gap: 1 } }}
                    >
                    <WarningAmber sx={{ color: '#d97706', fontSize: 20 }} />
                    <Typography variant="caption" fontWeight={700} sx={{ color: '#92400e' }}>
                        Data quality notes for this sprint
                    </Typography>
                    <Typography variant="caption" sx={{ color: '#92400e', opacity: 0.7 }}>
                        ({blocks.length} {blocks.length === 1 ? 'note' : 'notes'})
                    </Typography>
                    </AccordionSummary>
                    <AccordionDetails sx={{ px: 1.5, pt: 0, pb: 1.25 }}>
                    {blocks.map((b, i) => (
                        <Box key={i} sx={{ mb: i < blocks.length - 1 ? 0.75 : 0 }}>
                        <Typography variant="caption" display="block" sx={{ color: '#78350f', fontWeight: 600 }}>
                            • {b.headline}
                        </Typography>
                        {b.cause && (
                            <Typography variant="caption" display="block" sx={{ color: '#78350f', pl: 1.5 }}>
                            <Typography component="span" variant="caption" fontWeight={700}>Likely cause: </Typography>
                            {b.cause}
                            </Typography>
                        )}
                        {b.recommend && (
                            <Typography variant="caption" display="block" sx={{ color: '#78350f', pl: 1.5 }}>
                            <Typography component="span" variant="caption" fontWeight={700}>If presenting: </Typography>
                            {b.recommend}
                            </Typography>
                        )}
                        </Box>
                    ))}
                    </AccordionDetails>
                </Accordion>
                );
            };
            return (
                <Box sx={{ p: 2 }}>
                {renderDataQualityBanner()}
                {/* Sprint Summary — completed sprint stats */}
                <Paper variant="outlined" sx={{ mb: 2.5, p: 2 }}>
                    <Box sx={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', mb: 1.5 }}>
                    <Typography variant="subtitle2" fontWeight={700}>Sprint Summary</Typography>
                    </Box>
                    <Accordion
                    defaultExpanded={false}
                    elevation={0}
                    disableGutters
                    sx={{ mb: 1.5, bgcolor: 'transparent', '&:before': { display: 'none' } }}
                    >
                    <AccordionSummary
                        expandIcon={<ExpandMoreIcon fontSize="small" />}
                        sx={{ px: 0, py: 0, minHeight: 0,
                            '& .MuiAccordionSummary-content': { my: 0, alignItems: 'center', gap: 0.5 } }}
                    >
                        <InfoOutlinedIcon fontSize="small" sx={{ color: 'text.secondary' }} />
                        <Typography variant="caption" color="text.secondary">What do these mean?</Typography>
                    </AccordionSummary>
                    <AccordionDetails sx={{ px: 0, pt: 1, pb: 0 }}>
                        <Box component="dl" sx={{ m: 0, display: 'grid', gridTemplateColumns: 'max-content 1fr', columnGap: 1.5, rowGap: 0.5 }}>
                        <Typography component="dt" variant="caption" fontWeight={700}>Committed at Start</Typography>
                        <Typography component="dd" variant="caption" color="text.secondary" sx={{ m: 0 }}>
                            SP that was in this sprint at the moment it started, reconstructed from Jira changelog. Matches what the Scrum Master committed to at planning.
                        </Typography>

                        <Typography component="dt" variant="caption" fontWeight={700}>Final Scope</Typography>
                        <Typography component="dd" variant="caption" color="text.secondary" sx={{ m: 0 }}>
                            SP in the sprint when it closed. Equals Committed at Start + Scope Change (Net). Excludes punted tickets.
                        </Typography>

                        <Typography component="dt" variant="caption" fontWeight={700}>Total Completed</Typography>
                        <Typography component="dd" variant="caption" color="text.secondary" sx={{ m: 0 }}>
                            SP that finished within the sprint window (status in Done / Closed / Resolved / Released / Deployed etc.). Sum of every developer's delivered SP.
                        </Typography>

                        <Typography component="dt" variant="caption" fontWeight={700}>Carry Over</Typography>
                        <Typography component="dd" variant="caption" color="text.secondary" sx={{ m: 0 }}>
                            SP that stayed in the sprint at close but did not finish (developer's spillover into the next sprint).
                        </Typography>

                        <Typography component="dt" variant="caption" fontWeight={700}>Scope Change (Net)</Typography>
                        <Typography component="dd" variant="caption" color="text.secondary" sx={{ m: 0 }}>
                            Final Scope − Committed at Start. The headline number SMs report. Caption shows gross adds and removes that produced the net.
                        </Typography>

                        <Typography component="dt" variant="caption" fontWeight={700}>Scope Adds (Team)</Typography>
                        <Typography component="dd" variant="caption" color="text.secondary" sx={{ m: 0 }}>
                            Tickets added mid-sprint to V2-team developers, excluding carry-in from the prior sprint. Gross count — does not net out removals.
                        </Typography>

                        <Typography component="dt" variant="caption" fontWeight={700}>Removed (Team)</Typography>
                        <Typography component="dd" variant="caption" color="text.secondary" sx={{ m: 0 }}>
                            Tickets explicitly pulled out of the sprint mid-stream (punted). Different from Carry Over: punted = removed from sprint; carry-over = stayed in sprint but didn't finish.
                        </Typography>
                        </Box>
                        <Box sx={{ mt: 1.5 }}>
                        <Link
                            component="button"
                            variant="caption"
                            underline="hover"
                            onClick={() => setMethodologyOpen(true)}
                            sx={{ color: '#1e3a8a', fontWeight: 600 }}
                        >
                            View full methodology →
                        </Link>
                        </Box>
                    </AccordionDetails>
                    </Accordion>
                    <Box sx={{ display: 'flex', gap: 2, flexWrap: 'wrap' }}>
                    <Tooltip title="SP that was in this sprint at sprint-start time, reconstructed from Jira changelog. Matches SM's 'Committed at Start'.">
                        <Box sx={{ flex: '1 1 140px', p: 1.5, borderRadius: 1, bgcolor: '#eef2ff', textAlign: 'center' }}>
                        <Typography variant="caption" color="text.secondary" display="block">Committed at Start</Typography>
                        <Typography variant="h5" fontWeight={700}>
                            {syncCommittedSp != null ? `${syncCommittedSp} SP` : '—'}
                        </Typography>
                        {syncCommittedSp == null && (
                            <Typography variant="caption" color="text.disabled" display="block">not yet computed</Typography>
                        )}
                        </Box>
                    </Tooltip>
                    <Box sx={{ flex: '1 1 140px', p: 1.5, borderRadius: 1, bgcolor: '#f5f5f5', textAlign: 'center' }}>
                        <Typography variant="caption" color="text.secondary" display="block">Final Scope</Typography>
                        <Typography variant="h5" fontWeight={700}>{syncFinalScopeSp} SP</Typography>
                        <Typography variant="caption" color="text.secondary">at sprint close</Typography>
                    </Box>
                    <Box sx={{ flex: '1 1 140px', p: 1.5, borderRadius: 1, bgcolor: '#e8f5e9', textAlign: 'center' }}>
                        <Typography variant="caption" color="text.secondary" display="block">Total Completed</Typography>
                        <Typography variant="h5" fontWeight={700} color="success.main">{syncTotalCompletedSp} SP</Typography>
                        <Typography variant="caption" color="text.secondary">{effectiveDeliveryPct}% delivery</Typography>
                    </Box>
                    <Box sx={{ flex: '1 1 140px', p: 1.5, borderRadius: 1, bgcolor: syncCarryOverSp > 0 ? '#fff8e1' : '#f5f5f5', textAlign: 'center' }}>
                        <Typography variant="caption" color="text.secondary" display="block">Carry Over</Typography>
                        <Typography variant="h5" fontWeight={700} color={syncCarryOverSp > 0 ? 'warning.main' : 'text.primary'}>{syncCarryOverSp} SP</Typography>
                        <Typography variant="caption" color="text.secondary">{syncCarryOverCount} {syncCarryOverCount === 1 ? 'ticket' : 'tickets'} spilled over</Typography>
                    </Box>
                    <Tooltip title="Net scope change during the sprint = Final Scope − Committed at Start. It is the sum of tickets added mid-sprint, minus tickets removed (punted), plus any story-point re-estimates on tickets already in the sprint. The caption shows that breakdown so the parts always reconcile to the net.">
                        <Box sx={{ flex: '1 1 160px', p: 1.5, borderRadius: 1, bgcolor: (syncNetScopeChangeSp ?? 0) !== 0 ? '#fff8e1' : '#f5f5f5', textAlign: 'center' }}>
                        <Typography variant="caption" color="text.secondary" display="block">Scope Change (Net)</Typography>
                        {syncNetScopeChangeSp == null
                            ? <Typography variant="h5" fontWeight={700} color="text.disabled">—</Typography>
                            : <Typography variant="h5" fontWeight={700} color={syncNetScopeChangeSp > 0 ? 'warning.main' : syncNetScopeChangeSp < 0 ? 'error.main' : 'success.main'}>
                                {syncNetScopeChangeSp > 0 ? '+' : ''}{syncNetScopeChangeSp} SP
                            </Typography>
                        }
                        {/* Reconciling breakdown: added − removed + re-estimated = net.
                            Re-estimated = the residual (estimate changes on tickets already
                            in the sprint), so the displayed parts always sum to the net. */}
                        {(() => {
                            const reEstimated = syncNetScopeChangeSp == null
                            ? 0
                            : Math.round((syncNetScopeChangeSp - syncScopeCreepSp + syncPuntedSp) * 10) / 10;
                            return (
                            <Typography variant="caption" color="text.secondary" display="block">
                                {syncScopeCreepSp} added &middot; {syncPuntedSp} removed
                                {reEstimated !== 0 && <> &middot; {reEstimated > 0 ? '+' : ''}{reEstimated} re-estimated</>}
                            </Typography>
                            );
                        })()}
                        </Box>
                    </Tooltip>
                    <Box sx={{ flex: '1 1 140px', p: 1.5, borderRadius: 1, bgcolor: syncV2ScopeCreepCount > 0 ? '#fff8e1' : '#f5f5f5', textAlign: 'center' }}>
                        <Typography variant="caption" color="text.secondary" display="block">Scope Adds (Team)</Typography>
                        {syncV2ScopeCreepCount === 0
                        ? <Typography variant="h5" fontWeight={700} color="success.main">None</Typography>
                        : <>
                            <Typography variant="h5" fontWeight={700} color="warning.main">{syncV2ScopeCreepSp} SP</Typography>
                            <Typography variant="caption" color="text.secondary">{syncV2ScopeCreepCount} {syncV2ScopeCreepCount === 1 ? 'ticket' : 'tickets'} added mid-sprint</Typography>
                            </>
                        }
                        {syncScopeCreepCount > syncV2ScopeCreepCount && (
                        <Typography variant="caption" color="text.disabled" display="block">{syncScopeCreepCount} total ({syncScopeCreepSp} SP) across all teams</Typography>
                        )}
                    </Box>
                    <Box sx={{ flex: '1 1 140px', p: 1.5, borderRadius: 1, bgcolor: syncV2PuntedCount > 0 ? '#fce4ec' : '#f5f5f5', textAlign: 'center' }}>
                        <Typography variant="caption" color="text.secondary" display="block">Removed (Team)</Typography>
                        {syncV2PuntedCount === 0
                        ? <Typography variant="h5" fontWeight={700} color="success.main">None</Typography>
                        : <>
                            <Typography variant="h5" fontWeight={700} color="error.main">{syncV2PuntedSp} SP</Typography>
                            <Typography variant="caption" color="text.secondary">{syncV2PuntedCount} {syncV2PuntedCount === 1 ? 'ticket' : 'tickets'} removed mid-sprint</Typography>
                            </>
                        }
                        {syncPuntedCount > syncV2PuntedCount && (
                        <Typography variant="caption" color="text.disabled" display="block">{syncPuntedCount} total ({syncPuntedSp} SP) across all teams</Typography>
                        )}
                    </Box>
                    </Box>
                </Paper>

                {/* Carry Over Tickets — collapsed; click to expand */}
                {(scorecard.carryOverTickets ?? []).length > 0 && (
                    <Accordion
                    defaultExpanded={false}
                    elevation={1}
                    sx={{ mb: 2, borderRadius: '8px !important', '&:before': { display: 'none' } }}
                    >
                    <AccordionSummary
                        expandIcon={<ExpandMoreIcon />}
                        sx={{ px: 2, py: 1.5, minHeight: 0,
                            '& .MuiAccordionSummary-content': { my: 0, alignItems: 'center', gap: 1 } }}
                    >
                        <WarningAmber sx={{ color: '#f57f17', fontSize: 18 }} />
                        <Typography variant="subtitle2" fontWeight={700}>Carry Over Tickets</Typography>
                        <Typography variant="caption" color="text.secondary">(spilled over to next sprint)</Typography>
                        <Chip
                        label={(scorecard.carryOverTickets ?? []).length}
                        color="warning"
                        size="small"
                        sx={{ ml: 'auto', mr: 1 }}
                        />
                    </AccordionSummary>
                    <AccordionDetails sx={{ p: 0 }}>
                        <TableContainer>
                        <Table size="small">
                            <TableHead>
                            <TableRow>
                                <TableCell><strong>Key</strong></TableCell>
                                <TableCell sx={{ maxWidth: 320 }}><strong>Summary</strong></TableCell>
                                <TableCell><strong>Assignee</strong></TableCell>
                                <TableCell><strong>Issue Type</strong></TableCell>
                                <TableCell align="center"><strong>SP</strong></TableCell>
                            </TableRow>
                            </TableHead>
                            <TableBody>
                            {(scorecard.carryOverTickets ?? []).map((t: any) => (
                                <TableRow key={t.jiraKey} hover sx={t.isV2 ? { borderLeft: '3px solid #f57f17' } : undefined}>
                                <TableCell><Typography variant="body2" fontWeight={600} color="primary">{t.jiraKey}</Typography></TableCell>
                                <TableCell sx={{ maxWidth: 320 }}><Typography variant="body2" noWrap title={t.summary}>{t.summary}</Typography></TableCell>
                                <TableCell>
                                    <Box sx={{ display: 'flex', alignItems: 'center', gap: 0.5 }}>
                                    {t.assigneeName ?? '—'}
                                    {t.isV2 && <Chip label="V2" size="small" color="warning" sx={{ height: 16, fontSize: 9 }} />}
                                    </Box>
                                </TableCell>
                                <TableCell><Typography variant="caption">{t.issueType || '—'}</Typography></TableCell>
                                <TableCell align="center">{t.storyPoints || '—'}</TableCell>
                                </TableRow>
                            ))}
                            </TableBody>
                        </Table>
                        </TableContainer>
                    </AccordionDetails>
                    </Accordion>
                )}

                {/* Scope Creep Tickets — collapsed; click to expand */}
                {(scorecard.scopeCreepTickets ?? []).length > 0 && (
                    <Accordion
                    defaultExpanded={false}
                    elevation={1}
                    sx={{ mb: 2.5, borderRadius: '8px !important', '&:before': { display: 'none' } }}
                    >
                    <AccordionSummary
                        expandIcon={<ExpandMoreIcon />}
                        sx={{ px: 2, py: 1.5, minHeight: 0,
                            '& .MuiAccordionSummary-content': { my: 0, alignItems: 'center', gap: 1 } }}
                    >
                        <WarningAmber sx={{ color: '#f57f17', fontSize: 18 }} />
                        <Typography variant="subtitle2" fontWeight={700}>Scope Creep Tickets</Typography>
                        <Typography variant="caption" color="text.secondary">(added mid-sprint, excluding carry-in from prior sprint)</Typography>
                        <Chip
                        label={(scorecard.scopeCreepTickets ?? []).length}
                        color="warning"
                        size="small"
                        sx={{ ml: 'auto', mr: 1 }}
                        />
                    </AccordionSummary>
                    <AccordionDetails sx={{ p: 0 }}>
                        <TableContainer>
                        <Table size="small">
                            <TableHead>
                            <TableRow>
                                <TableCell><strong>Key</strong></TableCell>
                                <TableCell sx={{ maxWidth: 320 }}><strong>Summary</strong></TableCell>
                                <TableCell><strong>Assignee</strong></TableCell>
                                <TableCell><strong>Issue Type</strong></TableCell>
                                <TableCell align="center"><strong>SP</strong></TableCell>
                            </TableRow>
                            </TableHead>
                            <TableBody>
                            {(scorecard.scopeCreepTickets ?? []).map((t: any) => (
                                <TableRow key={t.jiraKey} hover sx={t.isV2 ? { borderLeft: '3px solid #f57f17' } : undefined}>
                                <TableCell><Typography variant="body2" fontWeight={600} color="primary">{t.jiraKey}</Typography></TableCell>
                                <TableCell sx={{ maxWidth: 320 }}><Typography variant="body2" noWrap title={t.summary}>{t.summary}</Typography></TableCell>
                                <TableCell>
                                    <Box sx={{ display: 'flex', alignItems: 'center', gap: 0.5 }}>
                                    {t.assigneeName ?? '—'}
                                    {t.isV2 && <Chip label="V2" size="small" color="warning" sx={{ height: 16, fontSize: 9 }} />}
                                    </Box>
                                </TableCell>
                                <TableCell><Typography variant="caption">{t.issueType || '—'}</Typography></TableCell>
                                <TableCell align="center">{t.storyPoints || '—'}</TableCell>
                                </TableRow>
                            ))}
                            </TableBody>
                        </Table>
                        </TableContainer>
                    </AccordionDetails>
                    </Accordion>
                )}

                <Grid container spacing={2} sx={{ mb: 2.5 }}>
                    <Grid size={{ xs: 6, sm: 3 }}>
                    <Card elevation={1} sx={{ borderRadius: 2, overflow: 'hidden' }}>
                        <Box sx={{ height: 4, background: dHex === '#2e7d32' ? 'linear-gradient(90deg,#059669,#34d399)' : dHex === '#ed6c02' ? 'linear-gradient(90deg,#d97706,#fbbf24)' : dHex === '#d32f2f' ? 'linear-gradient(90deg,#dc2626,#f87171)' : 'linear-gradient(90deg,#94a3b8,#cbd5e1)' }} />
                        <Box sx={{ px: 2.25, pt: 2, pb: 1.75 }}>
                        <Box sx={{ display: 'flex', alignItems: 'center', gap: 0.75, mb: 1 }}>
                            <Speed sx={{ fontSize: 13, color: dHex }} />
                            <Typography sx={{ fontSize: 9, fontWeight: 700, textTransform: 'uppercase', letterSpacing: '0.8px', color: '#94a3b8' }}>Team Delivery</Typography>
                        </Box>
                        <Typography sx={{ fontSize: 32, fontWeight: 900, lineHeight: 1, letterSpacing: '-1px', color: dHex, mb: 0.5 }}>
                            {avgDelivery != null ? `${avgDelivery}%` : '\u2014'}
                        </Typography>
                        <Typography sx={{ fontSize: 11, color: '#475569' }}>{devScores.length} developer{devScores.length !== 1 ? 's' : ''}</Typography>
                        </Box>
                    </Card>
                    </Grid>
                    <Grid size={{ xs: 6, sm: 3 }}>
                    <Card elevation={1} sx={{ borderRadius: 2, overflow: 'hidden' }}>
                        <Box sx={{ height: 4, background: 'linear-gradient(90deg,#4f46e5,#818cf8)' }} />
                        <Box sx={{ px: 2.25, pt: 2, pb: 1.75 }}>
                        <Box sx={{ display: 'flex', alignItems: 'center', gap: 0.75, mb: 1 }}>
                            <EmojiEvents sx={{ fontSize: 13, color: '#4f46e5' }} />
                            <Typography sx={{ fontSize: 9, fontWeight: 700, textTransform: 'uppercase', letterSpacing: '0.8px', color: '#94a3b8' }}>Avg Exec Score</Typography>
                        </Box>
                        <Typography sx={{ fontSize: 32, fontWeight: 900, lineHeight: 1, letterSpacing: '-1px', color: '#4f46e5', mb: 0.5 }}>
                            {avgExec != null ? avgExec : '\u2014'}
                        </Typography>
                        <Typography sx={{ fontSize: 11, color: '#475569' }}>delivery + quality weighted</Typography>
                        </Box>
                    </Card>
                    </Grid>
                    <Grid size={{ xs: 6, sm: 3 }}>
                    <Card elevation={1} sx={{ borderRadius: 2, overflow: 'hidden' }}>
                        <Box sx={{ height: 4, background: 'linear-gradient(90deg,#6366f1,#a5b4fc)' }} />
                        <Box sx={{ px: 2.25, pt: 2, pb: 1.75 }}>
                        <Tooltip title="Bugs and sub-bugs first logged during this sprint. Carryover bugs from prior sprints are excluded.">
                            <Box sx={{ display: 'flex', alignItems: 'center', gap: 0.75, mb: 1, cursor: 'help' }}>
                            <BugReport sx={{ fontSize: 13, color: '#6366f1' }} />
                            <Typography sx={{ fontSize: 9, fontWeight: 700, textTransform: 'uppercase', letterSpacing: '0.8px', color: '#94a3b8' }}>New Bugs</Typography>
                            </Box>
                        </Tooltip>
                        <Typography sx={{ fontSize: 32, fontWeight: 900, lineHeight: 1, letterSpacing: '-1px', color: '#6366f1', mb: 0.5 }}>
                            {qaScores.length > 0 ? totalBugs : '\u2014'}
                        </Typography>
                        <Typography sx={{ fontSize: 11, color: '#475569' }}>{qaScores.length} QA member{qaScores.length !== 1 ? 's' : ''}</Typography>
                        </Box>
                    </Card>
                    </Grid>
                    <Grid size={{ xs: 6, sm: 3 }}>
                    <Card elevation={1} sx={{ borderRadius: 2, overflow: 'hidden' }}>
                        <Box sx={{ height: 4, background: qHex === '#2e7d32' ? 'linear-gradient(90deg,#059669,#6ee7b7)' : qHex === '#ed6c02' ? 'linear-gradient(90deg,#d97706,#fbbf24)' : qHex === '#d32f2f' ? 'linear-gradient(90deg,#dc2626,#f87171)' : 'linear-gradient(90deg,#94a3b8,#cbd5e1)' }} />
                        <Box sx={{ px: 2.25, pt: 2, pb: 1.75 }}>
                        <Box sx={{ display: 'flex', alignItems: 'center', gap: 0.75, mb: 1 }}>
                            <Verified sx={{ fontSize: 13, color: qHex }} />
                            <Typography sx={{ fontSize: 9, fontWeight: 700, textTransform: 'uppercase', letterSpacing: '0.8px', color: '#94a3b8' }}>QA Rating</Typography>
                        </Box>
                        <Typography sx={{ fontSize: qaRatingLabel.length > 3 ? 22 : 32, fontWeight: 900, lineHeight: 1, letterSpacing: '-1px', color: qHex, mb: 0.5 }}>{qaRatingLabel}</Typography>
                        <Typography sx={{ fontSize: 11, color: '#475569' }}>avg quality band</Typography>
                        </Box>
                    </Card>
                    </Grid>
                </Grid>

                {scorecard.scores.length === 0 && (
                    <Alert severity="warning" sx={{ mb: 2 }}>No scores found. The sync may still be running or no team members were matched.</Alert>
                )}

                {/* Metrics Legend */}
                {(hasAnyDevScores || hasAnyQaScores) && (
                    <Accordion defaultExpanded={false} sx={{ mb: 2, '&:before': { display: 'none' }, boxShadow: 'none', border: '1px solid #e0e0e0', borderRadius: '8px !important' }}>
                    <AccordionSummary expandIcon={<ExpandMoreIcon />} sx={{ minHeight: 40, '& .MuiAccordionSummary-content': { my: 0.5 } }}>
                        <Typography sx={{ fontSize: 13, fontWeight: 600, color: '#546e7a' }}>Metrics Legend</Typography>
                    </AccordionSummary>
                    <AccordionDetails sx={{ pt: 0, pb: 1.5 }}>
                        <Grid container spacing={3}>
                        {devScores.length > 0 && (
                            <Grid size={{ xs: 12, md: 6 }}>
                            <Typography sx={{ fontSize: 12, fontWeight: 700, color: '#1565c0', mb: 0.75 }}>Developer Metrics</Typography>
                            {[
                                ['Score', 'Delivery% × 0.8 + (100 − Rework%) × 0.2. Higher is better.'],
                                ['SP', 'SP Done / SP Planned'],
                                ['Delivery', 'SP Done / SP Planned x 100'],
                                ['Rework %', 'SP Rework / SP Planned x 100 (lower is better)'],
                                ['Cycle', 'Avg hours from In Progress to first QA handoff'],
                            ].map(([col, desc]) => (
                                <Box key={col} sx={{ display: 'flex', gap: 1, mb: 0.25 }}>
                                <Typography sx={{ fontSize: 11, fontWeight: 700, color: '#37474f', minWidth: 70 }}>{col}</Typography>
                                <Typography sx={{ fontSize: 11, color: '#607d8b' }}>{desc}</Typography>
                                </Box>
                            ))}
                            </Grid>
                        )}
                        {qaScores.length > 0 && (
                            <Grid size={{ xs: 12, md: 6 }}>
                            <Typography sx={{ fontSize: 12, fontWeight: 700, color: '#2e7d32', mb: 0.75 }}>QA Metrics</Typography>
                            {[
                                ['Bugs', 'Total bug tickets logged'],
                                ['Weighted', 'Critical x3 + High x2 + Medium x1.5 + Low x1'],
                                ['Quality', 'Composite QA rating: (1 − [0.70×UAT pass rate + 0.30×in-sprint catch]) × 100. Lower is better. Excellent ≤10 · Good ≤25 · Fair ≤40 · Low >40. N/A when fewer than 5 tickets tested.'],
                                ['Tested', 'Count of tickets signed off through QA'],
                                ['QA Cycle', 'Avg hours a ticket spent in QA before sign-off'],
                                ['Escape %', 'Prod bugs / (prod + QA-caught) x 100 (lower is better)'],
                            ].map(([col, desc]) => (
                                <Box key={col} sx={{ display: 'flex', gap: 1, mb: 0.25 }}>
                                <Typography sx={{ fontSize: 11, fontWeight: 700, color: '#37474f', minWidth: 70 }}>{col}</Typography>
                                <Typography sx={{ fontSize: 11, color: '#607d8b' }}>{desc}</Typography>
                                </Box>
                            ))}
                            </Grid>
                        )}
                        </Grid>
                    </AccordionDetails>
                    </Accordion>
                )}

                {/* Developer table */}
                {hasAnyDevScores && (
                    <Paper sx={{ mb: 3 }}>
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
                        {hasV2Scores && (
                        <ToggleButtonGroup
                            size="small"
                            exclusive
                            value={scorecardV2Only ? 'v2' : 'all'}
                            onChange={(_e, val) => { if (val) setScorecardV2Only(val === 'v2'); }}
                            sx={{ '& .MuiToggleButton-root': { px: 1.25, py: 0.25, fontSize: 11, fontWeight: 700, textTransform: 'none' } }}
                        >
                            <ToggleButton value="all">Whole Team</ToggleButton>
                            <ToggleButton value="v2">V2 Only</ToggleButton>
                        </ToggleButtonGroup>
                        )}
                        <Chip
                        label={`${devScores.length} ${scorecardV2Only && hasV2Scores ? 'V2 ' : ''}member${devScores.length !== 1 ? 's' : ''} · ${Math.round(devSpDone * 10) / 10}/${Math.round(devSpPlanned * 10) / 10} SP`}
                        size="small" variant="outlined" sx={{ fontSize: 11 }}
                        />
                    </Box>
                    {devScores.length === 0 ? (
                        <Alert severity="info" sx={{ m: 2 }}>
                        No V2 developers matched for this sprint. Switch back to "Whole Team" to see all members.
                        </Alert>
                    ) : (
                    <TableContainer>
                        <Table size="small">
                        <TableHead>
                            <TableRow>
                            <TableCell>Member</TableCell>
                            <TableCell align="center">Score</TableCell>
                            <TableCell align="center">SP</TableCell>
                            <TableCell>Delivery</TableCell>
                            <TableCell align="center">Rework %</TableCell>
                            <TableCell align="center">Cycle</TableCell>
                            <TableCell align="center">Actions</TableCell>
                            </TableRow>
                        </TableHead>
                        <TableBody>
                            {devScores.map((s: any) => {
                            const lowDelivery = (s.spDone ?? 0) <= LOW_SP_THRESHOLD;
                            const exec = metricVal(s, 'executionScore');
                            const dp = Number(metricVal(s, 'deliveryPct') ?? 0);
                            const rr = Number(metricVal(s, 'reworkFactor') ?? 0);
                            const ct = metricVal(s, 'avgCycleTimeHours');
                            return (
                                <TableRow key={s.jiraLoginId} hover
                                sx={lowDelivery ? { borderLeft: '3px solid #ff9800' } : undefined}>
                                <TableCell>
                                    <Box sx={{ display: 'flex', alignItems: 'center', gap: 0.5 }}>
                                    {s.displayName}
                                    {lowDelivery && (
                                        <Tooltip title={`Low delivery \u2014 only ${s.spDone ?? 0} SP completed (threshold: >${LOW_SP_THRESHOLD} SP)`}>
                                        <WarningAmber sx={{ fontSize: 14, color: '#f57c00' }} />
                                        </Tooltip>
                                    )}
                                    {s.isOverridden && (
                                        <Tooltip title={`Overridden. Reason: ${s.overrideReason}`}>
                                        <Chip label="edited" size="small" sx={{ fontSize: 9, height: 16, bgcolor: '#e3f2fd', color: '#1565c0', cursor: 'help' }} />
                                        </Tooltip>
                                    )}
                                    </Box>
                                </TableCell>
                                <TableCell align="center">
                                    {exec != null ? (
                                    <ScoreBadge score={Number(exec)} />
                                    ) : <Typography variant="caption" color="text.secondary">&mdash;</Typography>}
                                </TableCell>
                                <TableCell align="center">
                                    <Typography variant="body2">
                                    <strong>{s.spDone ?? '\u2014'}</strong>
                                    <Typography component="span" variant="caption" color="text.secondary"> / {s.spPlanned ?? '\u2014'}</Typography>
                                    </Typography>
                                </TableCell>
                                <TableCell>
                                    {dp > 0 ? (
                                    <DeliveryCell pct={dp} />
                                    ) : <Typography variant="caption" color="text.secondary">&mdash;</Typography>}
                                </TableCell>
                                <TableCell align="center">
                                    {rr === 0
                                    ? <Typography variant="caption" sx={{ color: '#2e7d32' }}>0%</Typography>
                                    : <Typography variant="caption" fontWeight={600}
                                        sx={{ color: rr > REWORK_HIGH ? '#d32f2f' : '#ed6c02' }}>
                                        {rr.toFixed(1)}%
                                        </Typography>
                                    }
                                </TableCell>
                                <TableCell align="center">
                                    {ct != null
                                    ? <Typography variant="body2">{Number(ct).toFixed(1)}h</Typography>
                                    : <Typography variant="caption" color="text.secondary">&mdash;</Typography>}
                                </TableCell>
                                <TableCell align="center">
                                    <Box sx={{ display: 'flex', gap: 0.5, justifyContent: 'center' }}>
                                    {!isMember && (
                                        <Tooltip title="Override metrics">
                                        <IconButton size="small" onClick={() => setOverrideTarget(s)}>
                                            <EditIcon fontSize="small" />
                                        </IconButton>
                                        </Tooltip>
                                    )}
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
                                    </Box>
                                </TableCell>
                                </TableRow>
                            );
                            })}
                        </TableBody>
                        </Table>
                    </TableContainer>
                    )}
                    </Paper>
                )}

                {/* QA table */}
                {qaScores.length > 0 && (
                    <Paper sx={{ mb: 3 }}>
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
                                <Tooltip title="Bugs and sub-bugs first logged during this sprint. Carryover bugs from prior sprints are excluded.">
                                <span style={{ cursor: 'help' }}>New Bugs</span>
                                </Tooltip>
                            </TableCell>
                            <TableCell align="center">Weighted</TableCell>
                            <TableCell align="center">Quality</TableCell>
                            <TableCell align="center">Tested</TableCell>
                            <TableCell align="center">QA Cycle</TableCell>
                            <TableCell align="center">Escape %</TableCell>
                            <TableCell align="center">Actions</TableCell>
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
                                        <Tooltip title={`Overridden. Reason: ${s.overrideReason}`}>
                                        <Chip label="edited" size="small" sx={{ fontSize: 9, height: 16, bgcolor: '#e3f2fd', color: '#1565c0', cursor: 'help' }} />
                                        </Tooltip>
                                    )}
                                    </Box>
                                </TableCell>
                                <TableCell align="center">{metricVal(s, 'bugsRaisedCount') ?? '\u2014'}</TableCell>
                                <TableCell align="center">
                                    {ws != null ? Number(ws).toFixed(1) : '\u2014'}
                                </TableCell>
                                <TableCell align="center">
                                    {qrVal != null ? (
                                    <Typography variant="body2" fontWeight={700} sx={{ color: qrTextColor }}>{qrLabel}</Typography>
                                    ) : <Typography variant="caption" color="text.secondary">&mdash;</Typography>}
                                </TableCell>
                                <TableCell align="center">{metricVal(s, 'ticketsTestedCount') ?? '\u2014'}</TableCell>
                                <TableCell align="center">
                                    {metricVal(s, 'avgQaCycleTimeHours') != null
                                    ? `${Number(metricVal(s, 'avgQaCycleTimeHours')).toFixed(1)}h`
                                    : '\u2014'}
                                </TableCell>
                                <TableCell align="center">
                                    {er != null ? (() => {
                                    const n = Number(er);
                                    const color = n > BUG_ESCAPE_HIGH ? '#d32f2f' : n > 0 ? '#ed6c02' : '#2e7d32';
                                    return (
                                        <Typography variant="caption" fontWeight={700} sx={{ color }}>
                                        {n.toFixed(1)}%
                                        </Typography>
                                    );
                                    })() : <Typography variant="caption" color="text.secondary">&mdash;</Typography>}
                                </TableCell>
                                <TableCell align="center">
                                    <Box sx={{ display: 'flex', gap: 0.5, justifyContent: 'center' }}>
                                    {!isMember && (
                                        <Tooltip title="Override metrics">
                                        <IconButton size="small" onClick={() => setOverrideTarget(s)}>
                                            <EditIcon fontSize="small" />
                                        </IconButton>
                                        </Tooltip>
                                    )}
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
                                    </Box>
                                </TableCell>
                                </TableRow>
                            );
                            })}
                        </TableBody>
                        </Table>
                    </TableContainer>
                    </Paper>
                )}
                </Box>
            );
            })()}

            {/* Trends view (inline) */}
            {perfView === 'trends' && !isKanban && (
            <Box sx={{ p: 2 }}>
                {historyError && <Alert severity="error" onClose={() => setHistoryError('')} sx={{ mb: 2 }}>{historyError}</Alert>}
                {historyLoading && (
                <Box sx={{ display: 'flex', justifyContent: 'center', py: 4 }}>
                    <CircularProgress />
                </Box>
                )}
                {!historyLoading && !historyResult && (
                <Alert severity="info">No synced sprint data available for trends. Import sprints using the Sync History section below.</Alert>
                )}
                {!historyLoading && historyResult && historyResult.length > 0 && (() => {
                // V2 filter: match developer display names against team member names
                const v2Names = trendsV2Only
                    ? new Set(teamMembers.filter((m: any) => m.v2Member).map((m: any) =>
                        ((m.firstName ?? '') + ' ' + (m.lastName ?? '')).trim().toLowerCase()
                    ))
                    : null;
                const matched = v2Names
                    ? historyResult.filter((card: any) =>
                        v2Names.has((card.displayName ?? '').replace(/_ext$/i, '').trim().toLowerCase())
                    )
                    : historyResult;
                // Sort by how many of the last 5 sprints the developer was
                // actually on the board (completedSprints only gets an entry
                // when a score row exists), so full contributors lead and
                // occasional ones sink to the bottom. Deliberately a sort and
                // not a filter — this is the internal delivery-manager view,
                // where hiding low participation defeats the purpose.
                const filtered = [...matched].sort((a: any, b: any) => {
                    const d = (b.completedSprints?.length ?? 0) - (a.completedSprints?.length ?? 0);
                    return d !== 0 ? d : (a.displayName ?? '').localeCompare(b.displayName ?? '');
                });
                return (
                <>
                    <Box sx={{ display: 'flex', alignItems: 'center', gap: 2, mb: 2 }}>
                    <Typography variant="body2" color="text.secondary">
                        {filtered.length} developer{filtered.length !== 1 ? 's' : ''} — last 5 sprints
                    </Typography>
                    <FormControlLabel
                        control={<Switch size="small" checked={trendsV2Only} onChange={(_, v) => setTrendsV2Only(v)} />}
                        label={<Typography sx={{ fontSize: 12, fontWeight: 600 }}>{trendsV2Only ? 'V2 Only' : 'All Members'}</Typography>}
                    />
                    </Box>
                    <Grid container spacing={2}>
                    {filtered.map((card: any) => (
                        <Grid size={{ xs: 12, sm: 6, md: 4 }} key={card.jiraLoginId}>
                        <DeveloperCard card={card} />
                        </Grid>
                    ))}
                    </Grid>
                </>
                );
                })()}
            </Box>
            )}
        </Paper>
    );
}