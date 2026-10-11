import {
  Accordion,
  AccordionDetails,
  AccordionSummary,
  Box,
  Card,
  CardContent,
  Chip,
  Grid,
  LinearProgress,
  Paper,
  Table,
  TableBody,
  TableCell,
  TableContainer,
  TableHead,
  TableRow,
  Typography,
  Tooltip,
} from '@mui/material';
import {
  ExpandMore as ExpandMoreIcon,
  WarningAmber,
} from '@mui/icons-material';
import { deliveryColor } from "./perfColors";
import { fmtDate, fmtDatetime } from "./perfFormatters";
import type { TeamPerformanceResult } from './types';


interface SprintReport {
    reportResult: TeamPerformanceResult;
    expandedBacklogRows: Set<string>;
    toggleBacklogRow: (val: string) => void;

}

export function ActiveSprintReport({reportResult,expandedBacklogRows, toggleBacklogRow}: SprintReport){
    return (
        <>
            <Box sx={{ display: 'flex', alignItems: 'center', gap: 1, mb: 1.5 }}>
                <Typography variant="subtitle1" fontWeight={700}>
                    {reportResult.sprintName} &mdash; {fmtDate(reportResult.sprintStartDate)} to {fmtDate(reportResult.sprintEndDate)}
                </Typography>
                {reportResult.isHistorical
                    ? <Chip label={'Historical \u2014 status at sprint end'} size="small" color="info" variant="outlined" />
                    : <Chip label={'Live \u2014 current status'} size="small" color="success" variant="outlined" />
                }
            </Box>

            {/* Summary Cards */}
            <Grid container spacing={2} sx={{ mb: 3 }}>
                <Grid size={{ xs: 12, sm: 6, md: 3 }}>
                <Card variant="outlined">
                <CardContent sx={{ textAlign: 'center', py: 2 }}>
                    <Typography variant="caption" color="text.secondary" display="block" gutterBottom>Overall Delivery</Typography>
                    <Typography variant="h4" fontWeight={700}>{reportResult.overallDeliveryPct}%</Typography>
                    <Typography variant="caption" color="text.secondary">{reportResult.overallSpDone} / {reportResult.overallSpPlanned} SP</Typography>
                    <Box sx={{ mt: 0.5 }}>
                    <Chip label={reportResult.overallDeliveryPct >= 80 ? 'On Track' : reportResult.overallDeliveryPct >= 60 ? 'At Risk' : 'Off Track'}
                        color={deliveryColor(reportResult.overallDeliveryPct)} size="small" />
                    </Box>
                </CardContent>
                </Card>
            </Grid>
            <Grid size={{ xs: 12, sm: 6, md: 3 }}>
                <Card variant="outlined">
                    <CardContent sx={{ textAlign: 'center', py: 2 }}>
                        <Typography variant="caption" color="text.secondary" display="block" gutterBottom>Team Delivery</Typography>
                        <Typography variant="h4" fontWeight={700}>{reportResult.v2DeliveryPct}%</Typography>
                        <Typography variant="caption" color="text.secondary">{reportResult.v2SpDone} / {reportResult.v2SpPlanned} SP</Typography>
                        <Box sx={{ mt: 0.5 }}>
                        <Chip label={reportResult.v2DeliveryPct >= 80 ? 'On Track' : reportResult.v2DeliveryPct >= 60 ? 'At Risk' : 'Off Track'}
                            color={deliveryColor(reportResult.v2DeliveryPct)} size="small" />
                        </Box>
                    </CardContent>
                </Card>
            </Grid>
            <Grid size={{ xs: 12, sm: 6, md: 3 }}>
                <Card variant="outlined">
                    <CardContent sx={{ textAlign: 'center', py: 2 }}>
                        <Typography variant="caption" color="text.secondary" display="block" gutterBottom>
                        {reportResult.isHistorical ? 'Total Spillover' : 'Total Remaining'}
                        </Typography>
                        <Typography variant="h4" fontWeight={700} color={reportResult.totalSpilloverSp > 0 ? 'warning.main' : 'success.main'}>
                        {reportResult.totalSpilloverSp} SP
                        </Typography>
                        <Typography variant="caption" color="text.secondary">
                        {reportResult.totalSpilloverCount} {reportResult.isHistorical ? 'issues spilled over' : 'issues not yet done'} (all team)
                        </Typography>
                    </CardContent>
                </Card>
            </Grid>
            <Grid size={{ xs: 12, sm: 6, md: 3 }}>
                <Card variant="outlined">
                    <CardContent sx={{ textAlign: 'center', py: 2 }}>
                        <Typography variant="caption" color="text.secondary" display="block" gutterBottom>
                        {reportResult.isHistorical ? 'Team Spillover' : 'Team Remaining'}
                        </Typography>
                        <Typography variant="h4" fontWeight={700} color={reportResult.v2SpilloverSp > 0 ? 'warning.main' : 'success.main'}>
                        {reportResult.v2SpilloverSp} SP
                        </Typography>
                        <Typography variant="caption" color="text.secondary">
                        {reportResult.v2SpilloverCount} {reportResult.isHistorical ? 'issues spilled over' : 'issues not yet done'} (team members)
                        </Typography>
                    </CardContent>
                </Card>
            </Grid>
            </Grid>

            {/* Historical Sprint Summary — completed sprints only (reportResult is always sprint, never kanban) */}
            {reportResult.isHistorical && (
            <Paper sx={{ mb: 3, p: 2 }}>
                <Typography variant="subtitle2" fontWeight={700} sx={{ mb: 1.5 }}>Sprint Summary</Typography>
                <Box sx={{ display: 'flex', gap: 2, flexWrap: 'wrap' }}>
                    {/* Total Planned */}
                    <Box sx={{ flex: '1 1 160px', p: 1.5, borderRadius: 1, bgcolor: '#f5f5f5', textAlign: 'center' }}>
                        <Typography variant="caption" color="text.secondary" display="block">Total Planned</Typography>
                        <Typography variant="h5" fontWeight={700}>{reportResult.overallSpPlanned} SP</Typography>
                    </Box>
                    {/* Total Completed */}
                    <Box sx={{ flex: '1 1 160px', p: 1.5, borderRadius: 1, bgcolor: '#e8f5e9', textAlign: 'center' }}>
                        <Typography variant="caption" color="text.secondary" display="block">Total Completed</Typography>
                        <Typography variant="h5" fontWeight={700} color="success.main">{reportResult.overallSpDone} SP</Typography>
                        <Typography variant="caption" color="text.secondary">{reportResult.overallDeliveryPct}% delivery</Typography>
                    </Box>
                    {/* Carry Over */}
                    <Box sx={{ flex: '1 1 160px', p: 1.5, borderRadius: 1, bgcolor: reportResult.totalSpilloverSp > 0 ? '#fff8e1' : '#f5f5f5', textAlign: 'center' }}>
                        <Typography variant="caption" color="text.secondary" display="block">Carry Over</Typography>
                        <Typography variant="h5" fontWeight={700} color={reportResult.totalSpilloverSp > 0 ? 'warning.main' : 'text.primary'}>
                        {reportResult.totalSpilloverSp} SP
                        </Typography>
                        <Typography variant="caption" color="text.secondary">
                        {reportResult.totalSpilloverCount} {reportResult.totalSpilloverCount === 1 ? 'ticket' : 'tickets'} spilled over
                        </Typography>
                    </Box>
                    {/* Scope Creep */}
                    <Box sx={{ flex: '1 1 160px', p: 1.5, borderRadius: 1, bgcolor: (reportResult.v2ScopeChangeCount ?? 0) > 0 ? '#fff8e1' : '#f5f5f5', textAlign: 'center' }}>
                        <Typography variant="caption" color="text.secondary" display="block">Scope Creep (Team)</Typography>
                        {(reportResult.v2ScopeChangeCount ?? 0) > 0 ? (
                        <>
                            <Typography variant="h5" fontWeight={700} color="warning.main">{reportResult.v2ScopeChangeCount} tickets</Typography>
                            <Typography variant="caption" color="text.secondary">{reportResult.v2ScopeChangeSp ?? 0} SP added mid-sprint</Typography>
                        </>
                        ) : (
                        <Typography variant="h5" fontWeight={700} color="success.main">None</Typography>
                        )}
                        {(reportResult.scopeChangeCount ?? 0) > (reportResult.v2ScopeChangeCount ?? 0) && (
                        <Typography variant="caption" color="text.disabled" display="block">{reportResult.scopeChangeCount} total across all teams</Typography>
                        )}
                    </Box>
                </Box>
            </Paper>
            )}

            {/* Active Sprint Progress */}
            {!reportResult.isHistorical && (() => {
            const countWeekdays = (from: Date, to: Date): number => {
                let count = 0;
                const cur = new Date(from);
                cur.setHours(0, 0, 0, 0);
                const end = new Date(to);
                end.setHours(0, 0, 0, 0);
                while (cur <= end) {
                const d = cur.getDay();
                if (d !== 0 && d !== 6) count++;
                cur.setDate(cur.getDate() + 1);
                }
                return count;
            };

            const now = new Date();
            const start = new Date(reportResult.sprintStartDate);
            const end = new Date(reportResult.sprintEndDate);
            const totalDays = countWeekdays(start, end);
            const daysElapsed = now >= end ? totalDays : Math.min(totalDays, countWeekdays(start, now));
            const timePct = totalDays > 0 ? Math.min(100, (daysElapsed / totalDays) * 100) : 0;
            const donePct = reportResult.overallSpPlanned > 0 ? (reportResult.overallSpDone / reportResult.overallSpPlanned) * 100 : 0;
            const inUatPct = reportResult.overallSpPlanned > 0 ? ((reportResult.inUatSp ?? 0) / reportResult.overallSpPlanned) * 100 : 0;
            const inQaPct = reportResult.overallSpPlanned > 0 ? ((reportResult.inQaSp ?? 0) / reportResult.overallSpPlanned) * 100 : 0;
            const inReviewPct = reportResult.overallSpPlanned > 0 ? ((reportResult.inReviewSp ?? 0) / reportResult.overallSpPlanned) * 100 : 0;
            const inProgressPct = reportResult.overallSpPlanned > 0 ? (reportResult.inProgressSp / reportResult.overallSpPlanned) * 100 : 0;
            const isAhead = donePct >= timePct;

            return (
                <Paper sx={{ mb: 3, p: 2.5 }}>
                <Typography variant="subtitle2" fontWeight={700} gutterBottom>Sprint Progress</Typography>
                <Box sx={{ mb: 2.5 }}>
                    <Box sx={{ display: 'flex', justifyContent: 'space-between', mb: 0.5 }}>
                    <Typography variant="caption" color="text.secondary">{fmtDate(reportResult.sprintStartDate)}</Typography>
                    <Typography variant="caption" fontWeight={600}>Day {daysElapsed} of {totalDays} &nbsp;&middot;&nbsp; {Math.round(timePct)}% elapsed</Typography>
                    <Typography variant="caption" color="text.secondary">{fmtDate(reportResult.sprintEndDate)}</Typography>
                    </Box>
                    <LinearProgress variant="determinate" value={timePct} color="info" sx={{ height: 10, borderRadius: 5 }} />
                </Box>
                <Box sx={{ mb: 2 }}>
                    <Box sx={{ display: 'flex', justifyContent: 'space-between', mb: 0.5 }}>
                    <Typography variant="caption" color="text.secondary">Story Points</Typography>
                    <Typography variant="caption" fontWeight={600}>
                        {reportResult.overallSpDone} done
                        {(reportResult.inUatSp ?? 0) > 0 && ` \u00b7 ${reportResult.inUatSp} UAT`}
                        {(reportResult.inQaSp ?? 0) > 0 && ` \u00b7 ${reportResult.inQaSp} in QA`}
                        {(reportResult.inReviewSp ?? 0) > 0 && ` \u00b7 ${reportResult.inReviewSp} in review`}
                        {reportResult.inProgressSp > 0 && ` \u00b7 ${reportResult.inProgressSp} in progress`}
                        {(reportResult.blockedSp ?? 0) > 0 && ` \u00b7 ${reportResult.blockedSp} blocked`}
                        {reportResult.todoSp > 0 && ` \u00b7 ${reportResult.todoSp} to do`}
                        &nbsp;/ {reportResult.overallSpPlanned} total
                    </Typography>
                    </Box>
                    <Box sx={{ display: 'flex', height: 10, borderRadius: 5, overflow: 'hidden', bgcolor: '#e0e0e0' }}>
                    <Box sx={{ width: `${donePct}%`, bgcolor: '#4caf50', transition: 'width 0.4s' }} />
                    <Box sx={{ width: `${inUatPct}%`, bgcolor: '#9c27b0', transition: 'width 0.4s' }} />
                    <Box sx={{ width: `${inQaPct}%`, bgcolor: '#ff9800', transition: 'width 0.4s' }} />
                    <Box sx={{ width: `${inReviewPct}%`, bgcolor: '#009688', transition: 'width 0.4s' }} />
                    <Box sx={{ width: `${inProgressPct}%`, bgcolor: '#1976d2', transition: 'width 0.4s' }} />
                    </Box>
                    <Box sx={{ display: 'flex', gap: 2, mt: 0.75, flexWrap: 'wrap' }}>
                    {([['#4caf50', 'Done'], (reportResult.inUatSp ?? 0) > 0 ? ['#9c27b0', 'UAT'] : null, (reportResult.inQaSp ?? 0) > 0 ? ['#ff9800', 'In QA'] : null, (reportResult.inReviewSp ?? 0) > 0 ? ['#009688', 'In Review'] : null, reportResult.inProgressSp > 0 ? ['#1976d2', 'In Progress'] : null, (reportResult.blockedSp ?? 0) > 0 ? ['#f44336', 'Blocked'] : null, ['#e0e0e0', 'To Do']] as (string[] | null)[]).filter((x): x is string[] => x !== null).map(([color, label]) => (
                        <Box key={label as string} sx={{ display: 'flex', alignItems: 'center', gap: 0.5 }}>
                        <Box sx={{ width: 10, height: 10, borderRadius: '50%', bgcolor: color as string }} />
                        <Typography variant="caption" color="text.secondary">{label as string}</Typography>
                        </Box>
                    ))}
                    </Box>
                </Box>
                {(reportResult.scopeChangeCount ?? 0) > 0 && (
                    <Box sx={{ display: 'flex', alignItems: 'center', gap: 1, mb: 2, p: 1, bgcolor: '#fff8e1', borderRadius: 1, border: '1px solid #ffe082' }}>
                    <WarningAmber sx={{ fontSize: 16, color: '#f57f17' }} />
                    <Typography variant="caption" color="text.secondary">
                        <strong style={{ color: '#f57f17' }}>Scope change (Team):</strong>{' '}
                        {reportResult.v2ScopeChangeCount ?? 0} {(reportResult.v2ScopeChangeCount ?? 0) === 1 ? 'ticket' : 'tickets'} ({reportResult.v2ScopeChangeSp ?? 0} SP) added after sprint start
                        {(reportResult.scopeChangeCount ?? 0) > (reportResult.v2ScopeChangeCount ?? 0) && (
                        <> &mdash; {reportResult.scopeChangeCount} total across all teams</>
                        )}
                    </Typography>
                    </Box>
                )}
                <Box sx={{ display: 'flex', alignItems: 'center', gap: 1, flexWrap: 'wrap' }}>
                    <Typography variant="body2" color="text.secondary">Velocity check:</Typography>
                    <Chip label={isAhead ? 'Ahead of schedule' : 'Behind schedule'} color={isAhead ? 'success' : 'warning'} size="small" />
                    <Typography variant="caption" color="text.secondary">
                    {Math.round(timePct)}% of sprint elapsed &nbsp;&middot;&nbsp; {Math.round(donePct)}% SP completed
                    {isAhead ? ` \u2014 ${Math.round(donePct - timePct)}pp ahead` : ` \u2014 ${Math.round(timePct - donePct)}pp behind`}
                    </Typography>
                </Box>
                </Paper>
            );
            })()}

            {/* Scope Creep Tickets — collapsed by default; click banner to expand */}
            {(reportResult.scopeCreepTickets ?? []).length > 0 && (
            <Accordion
                defaultExpanded={false}
                elevation={1}
                sx={{ mb: 3, borderRadius: '8px !important', '&:before': { display: 'none' } }}
            >
                <AccordionSummary
                expandIcon={<ExpandMoreIcon />}
                sx={{ px: 2, py: 1.5, minHeight: 0,
                        '& .MuiAccordionSummary-content': { my: 0, alignItems: 'center', gap: 1 } }}
                >
                <WarningAmber sx={{ color: '#f57f17', fontSize: 18 }} />
                <Typography variant="subtitle2" fontWeight={700}>Scope Creep Tickets</Typography>
                <Typography variant="caption" color="text.secondary">(added to sprint after it started)</Typography>
                <Chip
                    label={(reportResult.scopeCreepTickets ?? []).length}
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
                        <TableCell sx={{ maxWidth: 280 }}><strong>Summary</strong></TableCell>
                        <TableCell><strong>Assignee</strong></TableCell>
                        <TableCell align="center"><strong>SP</strong></TableCell>
                        <TableCell><strong>Status</strong></TableCell>
                        <TableCell><strong>Added At</strong></TableCell>
                        </TableRow>
                    </TableHead>
                    <TableBody>
                        {(reportResult.scopeCreepTickets ?? []).map((t) => (
                        <TableRow key={t.key} hover sx={t.isV2Member ? { borderLeft: '3px solid #f57f17' } : undefined}>
                            <TableCell><Typography variant="body2" fontWeight={600} color="primary">{t.key}</Typography></TableCell>
                            <TableCell sx={{ maxWidth: 280 }}><Typography variant="body2" noWrap title={t.summary}>{t.summary}</Typography></TableCell>
                            <TableCell>
                            <Box sx={{ display: 'flex', alignItems: 'center', gap: 0.5 }}>
                                {t.assignee}
                                {t.isV2Member && <Chip label="V2" size="small" color="warning" sx={{ height: 16, fontSize: 9 }} />}
                            </Box>
                            </TableCell>
                            <TableCell align="center">{t.sp || '—'}</TableCell>
                            <TableCell>{t.currentStatus}</TableCell>
                            <TableCell><Typography variant="caption">{fmtDatetime(t.addedAt)}</Typography></TableCell>
                        </TableRow>
                        ))}
                    </TableBody>
                    </Table>
                </TableContainer>
                </AccordionDetails>
            </Accordion>
            )}

            {/* Member Performance Table */}
            <Paper sx={{ mb: 3 }}>
            <Box sx={{ p: 2, borderBottom: '1px solid', borderColor: 'divider' }}>
                <Typography variant="subtitle2" fontWeight={700}>Member Performance</Typography>
            </Box>
            <TableContainer>
                <Table size="small">
                <TableHead>
                    <TableRow>
                    <TableCell>Member</TableCell>
                    <TableCell align="center">
                        <Tooltip title="Sprint SP Done. If the developer also worked backlog tickets, +N appears below.">
                        <span>SP Done</span>
                        </Tooltip>
                    </TableCell>
                    <TableCell align="center">
                        <Tooltip title={reportResult.isHistorical ? 'Story points not completed when the sprint closed \u2014 carried into the next sprint' : 'Story points still not Done as of now'}>
                        <span>{reportResult.isHistorical ? 'SP Carried Over' : 'SP Remaining'}</span>
                        </Tooltip>
                    </TableCell>
                    {!reportResult.isHistorical && <TableCell>Pipeline Breakdown</TableCell>}
                    <TableCell align="center">Done %</TableCell>
                    <TableCell align="center">
                        <Tooltip title={'Issues re-opened during the sprint \u2014 a quality concern'}>
                        <span>Reopened</span>
                        </Tooltip>
                    </TableCell>
                    </TableRow>
                </TableHead>
                <TableBody>
                    {reportResult.memberStats.map((m) => {
                    const total = m.storyPointsDone + m.storyPointsCarriedOver;
                    const donePct = total > 0 ? Math.round((m.storyPointsDone / total) * 100) : 0;
                    const bd = m.breakdown;
                    const memberBacklogTickets = (reportResult.backlogContributions ?? [])
                        .filter((c) => c.memberId === m.jiraLoginId);
                    const isExpanded = expandedBacklogRows.has(m.jiraLoginId);
                    return (
                        <>
                        <TableRow key={m.jiraLoginId} hover>
                            <TableCell>
                            <Box sx={{ display: 'flex', alignItems: 'center', gap: 1, flexWrap: 'wrap' }}>
                                {m.displayName}
                                {memberBacklogTickets.length > 0 && (
                                <Chip
                                    size="small"
                                    label={`${isExpanded ? '\u25bc' : '\u25b6'} ${memberBacklogTickets.length} backlog`}
                                    onClick={() => toggleBacklogRow(m.jiraLoginId)}
                                    sx={{ fontSize: 10, fontWeight: 700, color: '#1976d2', bgcolor: '#f3f8ff', border: '1px solid #bbdefb', cursor: 'pointer', '&:hover': { bgcolor: '#e3f2fd' } }}
                                />
                                )}
                            </Box>
                            </TableCell>
                            <TableCell align="center">
                            {m.storyPointsDone > 0 ? <Typography fontWeight={600} color="success.main">{m.storyPointsDone}</Typography> : '\u2014'}
                            </TableCell>
                            <TableCell align="center">
                            {m.storyPointsCarriedOver > 0 ? <Typography fontWeight={600} color="warning.main">{m.storyPointsCarriedOver}</Typography> : '0'}
                            </TableCell>
                            {!reportResult.isHistorical && (
                            <TableCell>
                                {bd ? (
                                <Box sx={{ display: 'flex', gap: 0.5, flexWrap: 'wrap' }}>
                                    {bd.done > 0 && <Chip label={`${bd.done} Done`} size="small" sx={{ bgcolor: '#e8f5e9', color: '#2e7d32', fontWeight: 600, fontSize: 11 }} />}
                                    {bd.inUat > 0 && <Tooltip title="Awaiting customer/PO acceptance"><Chip label={`${bd.inUat} UAT`} size="small" sx={{ bgcolor: '#f3e5f5', color: '#7b1fa2', fontWeight: 600, fontSize: 11 }} /></Tooltip>}
                                    {bd.inQa > 0 && <Chip label={`${bd.inQa} QA`} size="small" sx={{ bgcolor: '#fff3e0', color: '#e65100', fontWeight: 600, fontSize: 11 }} />}
                                    {bd.inReview > 0 && <Chip label={`${bd.inReview} In Review`} size="small" sx={{ bgcolor: '#e0f2f1', color: '#00695c', fontWeight: 600, fontSize: 11 }} />}
                                    {bd.inProgress > 0 && <Chip label={`${bd.inProgress} In Progress`} size="small" sx={{ bgcolor: '#e3f2fd', color: '#1565c0', fontWeight: 600, fontSize: 11 }} />}
                                    {bd.blocked > 0 && <Chip label={`${bd.blocked} Blocked`} size="small" sx={{ bgcolor: '#ffebee', color: '#c62828', fontWeight: 600, fontSize: 11 }} />}
                                    {bd.todo > 0 && <Chip label={`${bd.todo} To Do`} size="small" sx={{ bgcolor: '#f5f5f5', color: '#616161', fontWeight: 600, fontSize: 11 }} />}
                                    {memberBacklogTickets.length > 0 && (
                                    <Chip label={`${memberBacklogTickets.length} backlog`} size="small" sx={{ bgcolor: '#e0f2f1', color: '#00695c', border: '1px solid #80cbc4', fontWeight: 700, fontSize: 11 }} />
                                    )}
                                    {bd.done === 0 && bd.inUat === 0 && bd.inQa === 0 && bd.inReview === 0 && bd.inProgress === 0 && bd.blocked === 0 && bd.todo === 0 && memberBacklogTickets.length === 0 && (
                                    <Typography variant="caption" color="text.disabled">No tickets assigned</Typography>
                                    )}
                                </Box>
                                ) : <Typography variant="caption" color="text.disabled">&mdash;</Typography>}
                            </TableCell>
                            )}
                            <TableCell align="center">
                            <Chip label={`${donePct}%`} color={deliveryColor(donePct)} size="small" variant="outlined" />
                            </TableCell>
                            <TableCell align="center">
                            {m.reopenedCount > 0
                                ? <Chip label={`${m.reopenedCount} reopened`} color="error" size="small" />
                                : <Typography color="text.secondary" variant="caption">&mdash;</Typography>}
                            </TableCell>
                        </TableRow>
                        {memberBacklogTickets.length > 0 && isExpanded && (
                            <TableRow key={`${m.jiraLoginId}-backlog`}>
                            <TableCell colSpan={reportResult.isHistorical ? 5 : 6} sx={{ p: 0, bgcolor: '#f0faf9', borderBottom: '2px solid #80cbc4' }}>
                                <Box sx={{ pl: 4, pr: 2, py: 1.5 }}>
                                <Typography variant="caption" sx={{ fontWeight: 700, color: '#00695c', textTransform: 'uppercase', letterSpacing: .5, display: 'block', mb: 1 }}>
                                    Backlog tickets progressed during this sprint (not in sprint board, not counted in totals)
                                </Typography>
                                <Table size="small">
                                    <TableHead>
                                    <TableRow>
                                        <TableCell sx={{ py: 0.5 }}><strong>Key</strong></TableCell>
                                        <TableCell sx={{ py: 0.5, maxWidth: 260 }}><strong>Summary</strong></TableCell>
                                        <TableCell sx={{ py: 0.5 }} align="center"><strong>SP</strong></TableCell>
                                        <TableCell sx={{ py: 0.5 }}><strong>Progress</strong></TableCell>
                                        <TableCell sx={{ py: 0.5 }}><strong>Current Status</strong></TableCell>
                                        <TableCell sx={{ py: 0.5 }}><strong>When</strong></TableCell>
                                    </TableRow>
                                    </TableHead>
                                    <TableBody>
                                    {memberBacklogTickets.map((c) => (
                                        <TableRow key={c.key}>
                                        <TableCell><Typography variant="body2" fontWeight={600} color="primary">{c.key}</Typography></TableCell>
                                        <TableCell sx={{ maxWidth: 260 }}><Typography variant="body2" noWrap title={c.summary}>{c.summary}</Typography></TableCell>
                                        <TableCell align="center">{c.sp || '—'}</TableCell>
                                        <TableCell><Typography variant="caption" color="text.secondary">{c.progressedFrom} &rarr; {c.progressedTo}</Typography></TableCell>
                                        <TableCell>{c.currentStatus}</TableCell>
                                        <TableCell><Typography variant="caption">{fmtDatetime(c.movedAt)}</Typography></TableCell>
                                        </TableRow>
                                    ))}
                                    </TableBody>
                                </Table>
                                </Box>
                            </TableCell>
                            </TableRow>
                        )}
                        </>
                    );
                    })}
                </TableBody>
                </Table>
            </TableContainer>
            </Paper>

            {/* Late QA Movers */}
            <Paper sx={{ mb: 3 }}>
            <Box sx={{ p: 2, borderBottom: '1px solid', borderColor: 'divider', display: 'flex', alignItems: 'center', gap: 1 }}>
                <WarningAmber sx={{ color: '#ff9800', fontSize: 18 }} />
                <Typography variant="subtitle2" fontWeight={700}>Late QA Movers</Typography>
                <Typography variant="caption" color="text.secondary">(tickets moved to QA in the last 2 days of the sprint)</Typography>
                {reportResult.lateQaMovers.length > 0 && <Chip label={reportResult.lateQaMovers.length} color="warning" size="small" sx={{ ml: 'auto' }} />}
            </Box>
            {reportResult.lateQaMovers.length === 0 ? (
                <Box sx={{ p: 2 }}><Typography variant="body2" color="text.secondary">No late QA movers detected.</Typography></Box>
            ) : (
                <TableContainer>
                <Table size="small">
                    <TableHead>
                    <TableRow sx={{ bgcolor: '#fff8e1' }}>
                        <TableCell><strong>Issue Key</strong></TableCell>
                        <TableCell><strong>Summary</strong></TableCell>
                        <TableCell><strong>Assignee</strong></TableCell>
                        <TableCell><strong>Moved to QA Status</strong></TableCell>
                        <TableCell><strong>Moved At</strong></TableCell>
                        <TableCell><strong>Current Status</strong></TableCell>
                    </TableRow>
                    </TableHead>
                    <TableBody>
                    {reportResult.lateQaMovers.map((m) => (
                        <TableRow key={m.key} hover>
                        <TableCell><Typography variant="body2" fontWeight={600} color="primary">{m.key}</Typography></TableCell>
                        <TableCell sx={{ maxWidth: 320 }}><Typography variant="body2" noWrap title={m.summary}>{m.summary}</Typography></TableCell>
                        <TableCell>{m.assignee}</TableCell>
                        <TableCell><Chip label={m.movedToQaStatus} color="warning" size="small" variant="outlined" /></TableCell>
                        <TableCell><Typography variant="caption">{fmtDatetime(m.movedToQaAt)}</Typography></TableCell>
                        <TableCell>{m.currentStatus}</TableCell>
                        </TableRow>
                    ))}
                    </TableBody>
                </Table>
                </TableContainer>
            )}
            </Paper>
        
        </>
    )
}