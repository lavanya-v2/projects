import { useState } from 'react';
import {
  Alert,
  Box,
  Button,
  Chip,
  CircularProgress,
  Dialog,
  DialogActions,
  DialogContent,
  DialogTitle,
  Tab,
  Table,
  TableBody,
  TableCell,
  TableContainer,
  TableHead,
  TableRow,
  Tabs,
  Tooltip,
  Typography,
} from '@mui/material';
import { usePerfTicketFacts } from './hooks';

interface Props {
  projectId: number;
  syncId: number;
  score: any;
  sprintStartDate?: string;
  sprintEndDate?: string;
  onClose: () => void;
}

const fmtHrs = (v: any) => (v != null ? `${Number(v).toFixed(1)}h` : '—');

const priorityColor = (p: string) => {
  if (p === 'Critical') return 'error';
  if (p === 'High') return 'warning';
  return 'default';
};

export function PerfTicketDrilldownModal({ projectId, syncId, score, sprintStartDate, sprintEndDate, onClose }: Props) {
  const factsQuery = usePerfTicketFacts(projectId, syncId, score.jiraLoginId);
  const facts = (factsQuery.data ?? []) as any[];
  const loading = factsQuery.isLoading;
  const error = factsQuery.isError ? 'Failed to load ticket facts' : '';

  const isDev = score.memberCategory !== 'qa';
  const [qaTab, setQaTab] = useState<'tested' | 'raised' | 'uatFailed'>('tested');

  // For Dev: only tickets assigned to this member (exclude ones they only reported or tested)
  const devFacts = isDev ? facts.filter((f: any) => f.assigneeJiraId === score.jiraLoginId) : [];

  // For QA: split facts into tickets tested vs bugs raised. "Bugs raised" must
  // match the scorecard's bugsRaisedCount — only bugs whose Jira created date
  // falls inside the sprint window. Carryover bugs (created in an earlier sprint
  // but still appearing in this sprint's facts) are excluded.
  const testedFacts = isDev ? [] : facts.filter((f: any) => f.qaTesterJiraId === score.jiraLoginId);
  const raisedFacts = isDev ? [] : facts.filter((f: any) => {
    if (f.reporterJiraId !== score.jiraLoginId) return false;
    if (!(f.issueType ?? '').toLowerCase().includes('bug')) return false;
    if (!sprintStartDate || !sprintEndDate) return true;
    if (!f.jiraCreatedAt) return false;
    const created = new Date(f.jiraCreatedAt).toISOString().slice(0, 10);
    return created >= sprintStartDate && created <= sprintEndDate;
  });
  // UAT Failed: tickets this QA cleared to Done/UAT that later regressed back
  // from a UAT status. These are the tickets whose SP feeds uatFailedSP and pull
  // the Quality rating down — a subset of tickets tested.
  const uatFailedFacts = isDev ? [] : testedFacts.filter((f: any) => f.wasUatRejected);
  const qaFacts = qaTab === 'tested' ? testedFacts : qaTab === 'raised' ? raisedFacts : uatFailedFacts;

  return (
    <Dialog open onClose={onClose} maxWidth="md" fullWidth>
      <DialogTitle>
        Ticket Breakdown
        <Typography variant="body2" color="text.secondary" sx={{ mt: 0.25 }}>
          {score.memberName} &middot; {isDev ? 'Developer' : 'QA'}
        </Typography>
      </DialogTitle>

      <DialogContent dividers sx={{ p: 0 }}>
        {loading && (
          <Box sx={{ textAlign: 'center', py: 4 }}>
            <CircularProgress />
          </Box>
        )}
        {error && <Alert severity="error" sx={{ m: 2 }}>{error}</Alert>}

        {!loading && !error && isDev && (
          <TableContainer>
            <Table size="small">
              <TableHead>
                <TableRow sx={{ bgcolor: '#f5f5f5' }}>
                  <TableCell sx={{ fontWeight: 700 }}>Key</TableCell>
                  <TableCell sx={{ fontWeight: 700 }}>Summary</TableCell>
                  <TableCell align="center" sx={{ fontWeight: 700 }}>Type</TableCell>
                  <TableCell align="center" sx={{ fontWeight: 700 }}>SP</TableCell>
                  <TableCell align="center" sx={{ fontWeight: 700 }}>Done</TableCell>
                  <TableCell align="center" sx={{ fontWeight: 700 }}>Reopened</TableCell>
                  <TableCell align="center" sx={{ fontWeight: 700 }}>Scope +</TableCell>
                  <TableCell align="center" sx={{ fontWeight: 700 }}>Cycle</TableCell>
                </TableRow>
              </TableHead>
              <TableBody>
                {devFacts.map(f => (
                  <TableRow key={f.jiraKey} hover>
                    <TableCell>
                      <Typography variant="body2" fontWeight={600} color="primary.main">
                        {f.jiraKey}
                      </Typography>
                    </TableCell>
                    <TableCell sx={{ maxWidth: 280 }}>
                      <Tooltip title={f.summary}>
                        <Typography variant="body2" noWrap>{f.summary}</Typography>
                      </Tooltip>
                    </TableCell>
                    <TableCell align="center">
                      <Chip label={f.issueType} size="small" variant="outlined" />
                    </TableCell>
                    <TableCell align="center">
                      {f.storyPoints != null ? f.storyPoints : '—'}
                    </TableCell>
                    <TableCell align="center">
                      {f.wasCompleted
                        ? <Chip label="Yes" size="small" color="success" />
                        : <Chip label="No" size="small" variant="outlined" />}
                    </TableCell>
                    <TableCell align="center">
                      {f.wasReopened
                        ? <Chip label="Yes" size="small" color="error" />
                        : <Typography variant="caption" color="text.secondary">—</Typography>}
                    </TableCell>
                    <TableCell align="center">
                      {f.wasScopeChange
                        ? <Chip label="Yes" size="small" color="warning" />
                        : <Typography variant="caption" color="text.secondary">—</Typography>}
                    </TableCell>
                    <TableCell align="center">
                      <Typography variant="body2">{fmtHrs(f.cycleTimeHours)}</Typography>
                    </TableCell>
                  </TableRow>
                ))}

                {devFacts.length === 0 && (
                  <TableRow>
                    <TableCell colSpan={8} align="center">
                      <Typography variant="body2" color="text.secondary" sx={{ py: 2 }}>
                        No ticket facts found for this member.
                      </Typography>
                    </TableCell>
                  </TableRow>
                )}
              </TableBody>
            </Table>
          </TableContainer>
        )}

        {!loading && !error && !isDev && (
          <>
            {/* QA tabs: Tickets Tested vs Bugs Raised */}
            <Box sx={{ borderBottom: 1, borderColor: 'divider' }}>
              <Tabs value={qaTab} onChange={(_, v) => setQaTab(v)} sx={{ minHeight: 36 }}>
                <Tab label={`Tickets Tested (${testedFacts.length})`} value="tested"
                  sx={{ minHeight: 36, textTransform: 'none', fontWeight: 600, fontSize: 13 }} />
                <Tab label={`Bugs Raised (${raisedFacts.length})`} value="raised"
                  sx={{ minHeight: 36, textTransform: 'none', fontWeight: 600, fontSize: 13 }} />
                <Tab label={`UAT Failed (${uatFailedFacts.length})`} value="uatFailed"
                  sx={{ minHeight: 36, textTransform: 'none', fontWeight: 600, fontSize: 13 }} />
              </Tabs>
            </Box>

            <TableContainer>
              <Table size="small">
                <TableHead>
                  <TableRow sx={{ bgcolor: '#f5f5f5' }}>
                    <TableCell sx={{ fontWeight: 700 }}>Key</TableCell>
                    <TableCell sx={{ fontWeight: 700 }}>Summary</TableCell>
                    <TableCell align="center" sx={{ fontWeight: 700 }}>Type</TableCell>
                    <TableCell align="center" sx={{ fontWeight: 700 }}>SP</TableCell>
                    {(qaTab === 'tested' || qaTab === 'uatFailed') && (
                      <TableCell align="center" sx={{ fontWeight: 700 }}>QA Time</TableCell>
                    )}
                    {qaTab !== 'uatFailed' && (
                      <>
                        <TableCell align="center" sx={{ fontWeight: 700 }}>Priority</TableCell>
                        <TableCell align="center" sx={{ fontWeight: 700 }}>Prod Bug</TableCell>
                      </>
                    )}
                    {qaTab === 'raised' && (
                      <TableCell sx={{ fontWeight: 700 }}>Assignee</TableCell>
                    )}
                  </TableRow>
                </TableHead>
                <TableBody>
                  {qaFacts.map((f: any) => (
                    <TableRow key={f.jiraKey + qaTab} hover>
                      <TableCell>
                        <Typography variant="body2" fontWeight={600} color="primary.main">
                          {f.jiraKey}
                        </Typography>
                      </TableCell>
                      <TableCell sx={{ maxWidth: 280 }}>
                        <Tooltip title={f.summary}>
                          <Typography variant="body2" noWrap>{f.summary}</Typography>
                        </Tooltip>
                      </TableCell>
                      <TableCell align="center">
                        <Chip label={f.issueType} size="small" variant="outlined" />
                      </TableCell>
                      <TableCell align="center">
                        {f.storyPoints != null ? f.storyPoints : '—'}
                      </TableCell>
                      {(qaTab === 'tested' || qaTab === 'uatFailed') && (
                        <TableCell align="center">
                          <Typography variant="body2">{fmtHrs(f.timeInQaHours)}</Typography>
                        </TableCell>
                      )}
                      {qaTab !== 'uatFailed' && (
                        <>
                          <TableCell align="center">
                            {f.bugPriority
                              ? <Chip label={f.bugPriority} size="small" color={priorityColor(f.bugPriority) as any} />
                              : <Typography variant="caption" color="text.secondary">—</Typography>}
                          </TableCell>
                          <TableCell align="center">
                            {f.isProductionBug
                              ? <Chip label="Prod" size="small" color="error" />
                              : <Typography variant="caption" color="text.secondary">—</Typography>}
                          </TableCell>
                        </>
                      )}
                      {qaTab === 'raised' && (
                        <TableCell>
                          <Typography variant="body2">{f.assigneeName ?? '—'}</Typography>
                        </TableCell>
                      )}
                    </TableRow>
                  ))}

                  {qaFacts.length === 0 && (
                    <TableRow>
                      <TableCell colSpan={8} align="center">
                        <Typography variant="body2" color="text.secondary" sx={{ py: 2 }}>
                          {qaTab === 'tested'
                          ? 'No tickets tested by this member.'
                          : qaTab === 'raised'
                            ? 'No bugs raised by this member.'
                            : 'No UAT-failed tickets for this member.'}
                        </Typography>
                      </TableCell>
                    </TableRow>
                  )}
                </TableBody>
              </Table>
            </TableContainer>
          </>
        )}
      </DialogContent>

      <DialogActions>
        <Button onClick={onClose}>Close</Button>
      </DialogActions>
    </Dialog>
  );
}
