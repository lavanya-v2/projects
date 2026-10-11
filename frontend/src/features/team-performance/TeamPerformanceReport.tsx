/* eslint-disable @typescript-eslint/no-explicit-any */
import { useEffect, useRef, useState } from 'react';
import { useSearchParams } from 'react-router-dom';
import {
  Alert,
  Box,
  Button,
  Chip,
  CircularProgress,
  FormControl,
  Grid,
  IconButton,
  MenuItem,
  Paper,
  Select,
  Typography,
  Skeleton,
  Tooltip,
} from '@mui/material';
import {
  CheckCircle,
  Delete as DeleteIcon,
  Sync as SyncIcon,
} from '@mui/icons-material';
import { MethodologyDoc } from './MethodologyDoc';
import { PerfOverrideModal } from './PerfOverrideModal';
import { PerfTicketDrilldownModal } from './PerfTicketDrilldownModal';
import { PerfScoreBreakdownModal } from './PerfScoreBreakdownModal';
import { useProjects } from '../auth/hooks';
import { usePermissions } from '../../shared/hooks/usePermissions';
import {
  useTeamPerformanceSprints,
  useProjectTeamMembers,
  usePerfSyncHistory,
  useGenerateTeamPerformanceReport,
  useTriggerPerfSprintSync,
  useTriggerPerfKanbanSync,
  useKanbanCycles,
  useTriggerPerfKanbanCycleSync,
  useRecomputePerfScores,
  useRetryPerfSync,
  useDeletePerfSync,
  usePerfTicketFacts,
} from './hooks';
import type { KanbanCycle, ProjectTeamMembers, TeamPerformanceSprint } from './types';
import type { Account } from '../admin/accounts/types';

// Extracted modules — see refactor plan
import { decodeName, fmtDate } from './perfFormatters';
import { MembersAutocomplete } from './MembersAutocomplete';
import { ExcelSprintBoard } from './ExcelSprintBoard';
import { useTeamPerfScorecard } from './useTeamPerfScorecard';
import { useTeamPerfSyncPolling } from './useTeamPerfSyncPolling';
import { useSprintTrendsHistory } from './useSprintTrendsHistory';
import { useKanbanTrendsHistory } from './useKanbanTrendsHistory';
import { useLiveKanbanSpan } from './useLiveKanbanSpan';
import { TrendsView } from './TrendsView';
import axios from 'axios';
import type { Project } from '../../types';
import { CompletedSprintReport } from './CompletedSprintReport';
import { KanbanScorecardReport } from './KanbanScorecardReport';
import ConfirmationDialog from '../../shared/components/ConfirmationDialog';
import { DefinitionOfDoneNote } from './DefinitionOfDoneNote';
import { SprintSyncDialog } from './SprintSyncDialog';
import { KanbanSyncDialog } from './KanbanSyncDialog';
import { ActiveSprintReport } from './ActiveSprintReport';

interface Props {
  accounts: Account[];
  selectedAccount?: Account | null;
  mainTab?: 'sprint' | 'trends';
}


export function TeamPerformanceReport({ accounts, selectedAccount: propAccount, mainTab = 'sprint' }: Props) {
  // ── Shared state ─────────────────────────────────────────────────────────────
  const [selectedAccountId, setSelectedAccountId] = useState<number | ''>(propAccount?.id || '');
  const [selectedProjectId, setSelectedProjectId] = useState<number | ''>('');
  const [sharedError, setSharedError] = useState('');

  /*
   * Deep link from the Data Imports page: after an upload the user could previously only find the
   * result by navigating here and re-selecting the account and project by hand, since neither page
   * shares state. Accepting the selection as query params closes that loop.
   */
  const [searchParams, setSearchParams] = useSearchParams();
  useEffect(() => {
    const account = searchParams.get('accountId');
    const project = searchParams.get('projectId');
    if (!account && !project) return;
    if (account) setSelectedAccountId(Number(account));
    if (project) setSelectedProjectId(Number(project));
    // Consume them so a later manual selection is not overwritten on re-render.
    setSearchParams({}, { replace: true });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Members get read-only access: they can view scorecards/trends but cannot trigger writes.
  const { isMember } = usePermissions();

  const projectsQuery = useProjects(selectedAccountId ? (selectedAccountId as number) : undefined);
  // Inactive (retired) projects are hidden from the Team Performance picker; their
  // historical data remains viewable from the report sections.
  const projects = selectedAccountId ? (projectsQuery.data ?? []).filter((p: Project) => p.isActive !== false) : [];

  // Excel projects use a separate reduced Board View (ExcelSprintBoard) and must NOT hit
  // any Jira perf/* endpoint — disable those queries by passing a 0 project id for them.
  const selectedProjectIsExcel = selectedProjectId !== '' &&
    (projects as { id: number; dataSourceType: string }[]).find(p => p.id === selectedProjectId)?.dataSourceType === 'excel';
  const jiraProjectId = selectedProjectId && !selectedProjectIsExcel ? (selectedProjectId as number) : 0;

  const sprintsQuery = useTeamPerformanceSprints(jiraProjectId);
  const jiraSprints = (jiraProjectId ? (sprintsQuery.data ?? []) : []) as TeamPerformanceSprint[];
  const sprintsLoading = !!jiraProjectId && sprintsQuery.isLoading;

  const membersQuery = useProjectTeamMembers(jiraProjectId);
  const teamMembers = (jiraProjectId ? (membersQuery.data ?? []) : []) as ProjectTeamMembers[];
  const membersLoading = !!jiraProjectId && membersQuery.isLoading;

  const perfSyncsQuery = usePerfSyncHistory(jiraProjectId);
  // eslint-disable-next-line react-hooks/exhaustive-deps
  const perfSyncs = (jiraProjectId ? (perfSyncsQuery.data ?? []) : []) as any[];
  const perfSyncsLoading = !!jiraProjectId && perfSyncsQuery.isLoading;

  const generateReportMutation = useGenerateTeamPerformanceReport();
  const triggerSprintSyncMutation = useTriggerPerfSprintSync();
  const triggerKanbanSyncMutation = useTriggerPerfKanbanSync();
  const triggerKanbanCycleSyncMutation = useTriggerPerfKanbanCycleSync();
  const recomputeScoresMutation = useRecomputePerfScores();
  const retrySyncMutation = useRetryPerfSync();
  const deleteSyncMutation = useDeletePerfSync();

  // ── Main tab is driven by the route (sub-menu under Team Performance) ────────
  const [methodologyOpen, setMethodologyOpen] = useState(false);

  // ── View state ────────────────────────────────────────────────────────────────
  const autoLoadedForProject = useRef<number | ''>('');
  const kanbanAutoSelectedFor = useRef<number | ''>('');

  // Tab 0 — Sprint Report
  const [selectedSprintId, setSelectedSprintId] = useState<number | ''>('');
  const [selectedMembers, setSelectedMembers] = useState<ProjectTeamMembers[]>([]);
  const [reportResult, setReportResult] = useState<any | null>(null);
  const [reportLoading, setReportLoading] = useState(false);
  const [reportError, setReportError] = useState('');

  // Tab 1 — Performance Scorecard (selection only — data lives in useTeamPerfScorecard)
  const [selectedSyncId, setSelectedSyncId] = useState<number | ''>('');
  const [overrideTarget, setOverrideTarget] = useState<any | null>(null);
  const [drilldownTarget, setDrilldownTarget] = useState<any | null>(null);
  const [breakdownTarget, setBreakdownTarget] = useState<any | null>(null);

  // Tab 1 — Performance view toggle
  const [perfView, setPerfView] = useState<'scorecard' | 'trends'>('scorecard');
  // Kanban: current in-progress span (live) vs a completed synced span (history)
  const [kanbanSpanMode, setKanbanSpanMode] = useState<'live' | 'history'>('history');

  // Sync dialog state
  const [syncHistoryError, setSyncHistoryError] = useState('');
  const [showAllSyncs, setShowAllSyncs] = useState(false);
  const [expandedBacklogRows, setExpandedBacklogRows] = useState<Set<string>>(new Set());
  const toggleBacklogRow = (memberId: string) =>
    setExpandedBacklogRows(prev => {
      const next = new Set(prev);
      // eslint-disable-next-line @typescript-eslint/no-unused-expressions
      next.has(memberId) ? next.delete(memberId) : next.add(memberId);
      return next;
    });
  const [sprintSyncOpen, setSprintSyncOpen] = useState(false);
  const [kanbanSyncOpen, setKanbanSyncOpen] = useState(false);
  const [syncTriggerLoading, setSyncTriggerLoading] = useState(false);
  const [syncSprintPickId, setSyncSprintPickId] = useState<number | ''>('');
  const [kanbanSyncFrom, setKanbanSyncFrom] = useState('');
  const [kanbanSyncTo, setKanbanSyncTo] = useState('');
  const [kanbanSyncLabel, setKanbanSyncLabel] = useState('');
  const [selectedCycleIndex, setSelectedCycleIndex] = useState<number | ''>('');
  const [kanbanUseCustomRange, setKanbanUseCustomRange] = useState(false);

  const resetAllTabState = () => {
    setSelectedSprintId('');
    setSelectedMembers([]);
    setReportResult(null);
    setReportError('');
    setSelectedSyncId('');
    setSyncHistoryError('');
    setShowAllSyncs(false);
    setPerfView('scorecard');
    setKanbanSpanMode('history');
    autoLoadedForProject.current = '';
    kanbanAutoSelectedFor.current = '';
  };

  // ── Derived constants (before effects) ───────────────────────────────────────
  const selectedSprint = jiraSprints.find(s => s.id === selectedSprintId);
  const selectedProject = (projects as any[]).find(p => p.id === selectedProjectId);
  // Was `jiraSprints.length === 0` -- derived from whether the board's sprint
  // query happened to come back empty, rather than the project's actual
  // configuration. That meant (a) a Scrum board with a permissions error or a
  // slow/failed sprint fetch rendered the whole Kanban UI, and (b) this couldn't
  // resolve until the sprints query settled, so the Kanban UI had a multi-second
  // blank/wrong-mode window on every project switch even though the project's
  // own record (already loaded) already knows the answer.
  const isKanban = !selectedProjectIsExcel && selectedProjectId !== '' && !!selectedProject?.isKanbanProject;
  const cycleSyncEnabled = isKanban && !!selectedProject?.kanbanCycleEnabled;
  // False only for a Kanban project with no tracked commitment (e.g. LS) -- there's
  // no real target for "delivery %" to be measured against, so the Kanban Scorecard
  // below shows raw SP delivered instead of a manufactured ratio. Always true for
  // sprint projects and for Kanban projects that opted into commitment tracking.
  const projectHasCommitment = !isKanban || !!selectedProject?.tracksCommitment;

  const kanbanCyclesQuery = useKanbanCycles(selectedProjectId ? (selectedProjectId as number) : 0, cycleSyncEnabled);
  const kanbanCycles = (cycleSyncEnabled ? (kanbanCyclesQuery.data ?? []) : []) as KanbanCycle[];
  const hasActiveSync = perfSyncs.some((s: any) => s.syncStatus === 'pending' || s.syncStatus === 'running');
  const selectedSprintIsActive = selectedSprint?.state === 'active';
  const completedSprintSync = !selectedSprintIsActive && selectedSprintId !== ''
    ? perfSyncs.find((s: any) => s.jiraSprintId === selectedSprintId && s.syncStatus === 'done') ?? null
    : null;
  // The specific sync currently selected (via Sync History, or auto-selected),
  // independent of the sprint-dropdown mechanism above -- used to pick the
  // SCORECARD TEMPLATE by the record's own type, not the project's current mode.
  const selectedSync = perfSyncs.find((s: any) => s.id === selectedSyncId);

  // ── Scorecard / trends hooks (replace inline effects) ────────────────────────
  const scorecardState = useTeamPerfScorecard(selectedProjectId, selectedSyncId);
  const scorecard = scorecardState.data;
  const scorecardLoading = scorecardState.loading;

  const sprintTrends = useSprintTrendsHistory({
    enabled: perfView === 'trends' && !isKanban,
    projectId: selectedProjectId,
    syncs: perfSyncs,
  });

  const kanbanTrends = useKanbanTrendsHistory({
    enabled: perfView === 'trends' && isKanban,
    projectId: selectedProjectId,
    syncs: perfSyncs,
    selectedSyncId,
  });

  // Kanban current-span (live) — fetched only when the "Current span" view is active.
  const liveSpan = useLiveKanbanSpan(selectedProjectId, isKanban && cycleSyncEnabled && kanbanSpanMode === 'live');
  // Effective scorecard data/loading for the kanban branch: live or the selected synced period.
  const kanbanLive = isKanban && cycleSyncEnabled && kanbanSpanMode === 'live';
  // Which SCORECARD TEMPLATE to render (rich Scrum vs simple Kanban), keyed to
  // the SELECTED RECORD's own type -- not the project's current mode -- so a
  // project that switched Scrum -> Kanban mid-history (e.g. WO) still shows
  // the rich template for its old sprint syncs. Live-span mode has no
  // persisted sync yet (always Kanban-shaped); nothing selected yet falls
  // back to the project's current mode, matching today's initial-load
  // behavior (auto-select picks the most recent sync of the project's mode).
  const selectedSyncIsKanban = kanbanLive ? true : (selectedSync ? selectedSync.syncType === 'kanban' : isKanban);
  const kanbanScorecard = kanbanLive ? liveSpan.data : scorecard;
  const kanbanScorecardLoading = kanbanLive ? liveSpan.loading : scorecardLoading;
  // Span-level ticket facts for the Kanban "Completed tickets" accordion. Only for
  // completed (synced) spans — the live span has no persisted syncId, so this no-ops.
  const kanbanSpanTicketsQuery = usePerfTicketFacts(
    selectedProjectId ? (selectedProjectId as number) : 0,
    kanbanLive || selectedSyncId === '' ? undefined : (selectedSyncId as number),
  );

  useTeamPerfSyncPolling(perfSyncs, !!selectedProjectId, perfSyncsQuery);

  // Sync global account selection
  useEffect(() => {
    if (propAccount?.id) setSelectedAccountId(propAccount.id);
  }, [propAccount?.id]);

  // Account → reset project
  useEffect(() => {
    if (!selectedAccountId) { setSelectedProjectId(''); return; }
    setSelectedProjectId(''); resetAllTabState();
  }, [selectedAccountId]);

  // Project changed → reset tab state
  useEffect(() => {
    resetAllTabState();
  }, [selectedProjectId]);

  // Surface query errors
  useEffect(() => {
    if (projectsQuery.isError) setSharedError('Failed to load projects');
    else if (sprintsQuery.isError) {
      if(axios.isAxiosError(sprintsQuery.error) && sprintsQuery.error.response?.status === 500) {
        setSharedError('Failed to load Jira sprints: Please check the Jira project configuration.');
      }
      else {
        setSharedError('Failed to load Jira sprints');
      }
    }
    else if (membersQuery.isError) setSharedError('Failed to load team members');
  }, [projectsQuery.isError, sprintsQuery.isError, sprintsQuery.error, membersQuery.isError]);

  useEffect(() => {
    if (perfSyncsQuery.isError) setSyncHistoryError('Failed to load performance sync history');
  }, [perfSyncsQuery.isError]);

  const [showAlert, setShowAlert] = useState(false);

  // ── Handlers ──────────────────────────────────────────────────────────────────
  const handleGenerate = async () => {
    if (!selectedProjectId || !selectedSprintId || selectedMembers.length === 0) {
      setReportError('Please select a project, sprint, and at least one team member.');
      return;
    }
    setReportLoading(true); setReportError(''); setReportResult(null);
    try {
      const result = await generateReportMutation.mutateAsync({
        projectId: selectedProjectId as number,
        body: {
          sprintId: selectedSprintId,
          memberJiraIds: selectedMembers.map((m: any) => m.jiraLoginId),
        },
      });
      setReportResult(result);
    } catch (e: any) {
      setReportError(e?.response?.data?.error ?? 'Failed to generate report');
    } finally { setReportLoading(false); }
  };

  const reloadPerfSyncs = async () => {
    if (!selectedProjectId) return;
    await perfSyncsQuery.refetch();
  };

  // Auto-select most recent completed sprint on project load
  useEffect(() => {
    if (isKanban || !selectedProjectId || jiraSprints.length === 0) return;
    if (autoLoadedForProject.current === selectedProjectId) return;
    autoLoadedForProject.current = selectedProjectId;
    const completed = jiraSprints.filter((s) => s.state !== 'active');
    const target = completed[0] ?? jiraSprints.find((s) => s.state === 'active');
    if (!target) return;
    setSelectedSprintId(target.id);
  }, [selectedProjectId, jiraSprints.length, isKanban]); // eslint-disable-line react-hooks/exhaustive-deps

  // Auto-set selectedSyncId when a synced completed sprint is selected
  useEffect(() => {
    if (completedSprintSync) {
      setSelectedSyncId(completedSprintSync.id);
    }
  }, [completedSprintSync?.id]); // eslint-disable-line react-hooks/exhaustive-deps

  // Kanban: auto-select the most recent completed span on project load (mirrors
  // the sprint auto-select). Re-runs per project via the shared ref; a manual
  // selection sticks because we only act when nothing is selected yet.
  useEffect(() => {
    if (!isKanban || !selectedProjectId) return;
    if (kanbanAutoSelectedFor.current === selectedProjectId) return;
    const doneKanban = perfSyncs
      .filter((s: any) => s.syncStatus === 'done' && s.syncType === 'kanban')
      .sort((a: any, b: any) => new Date(b.startDate).getTime() - new Date(a.startDate).getTime());
    if (doneKanban.length === 0) return;
    kanbanAutoSelectedFor.current = selectedProjectId;
    setSelectedSyncId(doneKanban[0].id);
    setKanbanSpanMode('history');
  }, [isKanban, selectedProjectId, perfSyncs]);

  const handleTriggerSprintSync = async () => {
    if (!syncSprintPickId) return;
    setSyncTriggerLoading(true);
    try {
      await triggerSprintSyncMutation.mutateAsync({ projectId: selectedProjectId as number, jiraSprintId: syncSprintPickId as number });
      setSprintSyncOpen(false); setSyncSprintPickId('');
      await perfSyncsQuery.refetch();
    } catch (e: any) {
      setSyncHistoryError(e?.response?.data?.error ?? 'Failed to trigger sprint sync');
    } finally { setSyncTriggerLoading(false); }
  };

  const handleTriggerKanbanSync = async () => {
    if (!kanbanSyncFrom || !kanbanSyncTo) return;
    setSyncTriggerLoading(true);
    try {
      const label = kanbanSyncLabel.trim() || `${kanbanSyncFrom} to ${kanbanSyncTo}`;
      await triggerKanbanSyncMutation.mutateAsync({ projectId: selectedProjectId as number, fromDate: kanbanSyncFrom, toDate: kanbanSyncTo, label });
      setKanbanSyncOpen(false); setKanbanSyncFrom(''); setKanbanSyncTo(''); setKanbanSyncLabel('');
      await perfSyncsQuery.refetch();
    } catch (e: any) {
      setSyncHistoryError(e?.response?.data?.error ?? 'Failed to trigger kanban sync');
    } finally { setSyncTriggerLoading(false); }
  };

  const handleTriggerKanbanCycleSync = async () => {
    if (selectedCycleIndex === '') return;
    setSyncTriggerLoading(true);
    try {
      await triggerKanbanCycleSyncMutation.mutateAsync({ projectId: selectedProjectId as number, cycleIndex: selectedCycleIndex as number });
      setKanbanSyncOpen(false); setSelectedCycleIndex('');
      await perfSyncsQuery.refetch();
    } catch (e: any) {
      setSyncHistoryError(e?.response?.data?.error ?? 'Failed to trigger cycle sync');
    } finally { setSyncTriggerLoading(false); }
  };

  const handleRecompute = async (syncId: number) => {
    try {
      await recomputeScoresMutation.mutateAsync({ projectId: selectedProjectId as number, syncId });
      await reloadPerfSyncs();
      if (selectedSyncId === syncId) {
        await scorecardState.reload();
      }
    } catch (e: any) {
      setSyncHistoryError(e?.response?.data?.error ?? 'Failed to recompute scores');
    }
  };

  const handleRetry = async (syncId: number) => {
    try {
      await retrySyncMutation.mutateAsync({ projectId: selectedProjectId as number, syncId });
      await reloadPerfSyncs();
    } catch (e: any) {
      setSyncHistoryError(e?.response?.data?.error ?? 'Failed to retry sync');
    }
  };

  const [deleteConfirmId, setDeleteConfirmId] = useState<number | null>(null);

  const handleDeleteSync = async() => {
    if(!deleteConfirmId) return;
    try {
      await deleteSyncMutation.mutateAsync({ projectId: selectedProjectId as number, syncId: deleteConfirmId });
      setDeleteConfirmId(null);
      setShowAlert(false);
      if (selectedSyncId === deleteConfirmId) {
        setSelectedSyncId('');
      }
      await reloadPerfSyncs();
    } catch (e: any) {
      setSyncHistoryError(e?.response?.data?.error ?? 'Failed to delete sync');
    }
  };

  const handleOverrideSaved = async () => {
    setOverrideTarget(null);
    await scorecardState.reload();
  };

  return (
    <Box>
      {/* ── Account selector ────────────────────────────────────────────────── */}
      {!propAccount && (
        <Box sx={{ display: 'flex', gap: 2, mb: 2, alignItems: 'center', flexWrap: 'wrap' }}>
          <Box data-testid="team-performance-account-select" sx={{ minWidth: 180 }}>
            <FormControl size="small" fullWidth>
              <Select
                value={selectedAccountId}
                onChange={e => setSelectedAccountId(e.target.value as number)}
                displayEmpty
              >
                <MenuItem value=""><em>Select Account</em></MenuItem>
                {accounts.map(a => <MenuItem key={a.id} value={a.id}>{a.name}</MenuItem>)}
              </Select>
            </FormControl>
          </Box>
        </Box>
      )}

      {/* ── Trends tab ────────────────────────────────────────────────────── */}
      {mainTab === 'trends' && (
        <TrendsView accountId={selectedAccountId} />
      )}

      {/* ── Sprint View tab ─────────────────────────────────────────────────── */}
      {mainTab === 'sprint' && (
      <>
      {/* ── Sprint filter row ───────────────────────────────────────────────── */}
      <Box sx={{ display: 'flex', gap: 2, mb: 3, alignItems: 'center', flexWrap: 'wrap' }}>
        <FormControl size="small" sx={{ minWidth: 220 }} disabled={!selectedAccountId}>
          <Select value={selectedProjectId} onChange={e => setSelectedProjectId(e.target.value as number)} displayEmpty>
            <MenuItem value=""><em>Select Project</em></MenuItem>
            {projects.filter(p => !p.isSharedTeam).map(p => <MenuItem key={p.id} value={p.id}>{p.name}</MenuItem>)}
          </Select>
        </FormControl>
        {isKanban && (
          <Alert severity="info" icon={false} sx={{ flexBasis: '100%', py: 0.5, fontSize: 13 }}>
            This is a Kanban project. {cycleSyncEnabled
              ? <>Use the <strong>Sync Period</strong> button on the right to sync a configured work cycle{selectedProject?.kanbanAutoSync ? ' (cycles also sync automatically when they end)' : ''}.</>
              : <>Use the <strong>Sync Period</strong> button on the right to import a date range of data.</>}
            {' '}Once synced, select a period to view scorecards. To view team delivery history, select members and a date range in the section below.
          </Alert>
        )}
        {selectedProjectId !== '' && !selectedProjectIsExcel && (
          <DefinitionOfDoneNote isKanban={isKanban} project={selectedProject} />
        )}
        {!isKanban && !selectedProjectIsExcel && selectedProjectId !== '' && (
          <FormControl size="small" sx={{ minWidth: 280 }} disabled={!selectedProjectId || sprintsLoading}>
            <Select value={selectedSprintId} onChange={e => { setSelectedSprintId(e.target.value as number); setReportResult(null); }} displayEmpty>
              <MenuItem value=""><em>{sprintsLoading ? 'Loading sprints...' : 'Select Sprint'}</em></MenuItem>
              {jiraSprints.map(s => (
                <MenuItem key={s.id} value={s.id}>
                  <Box>
                    <Typography variant="body2" fontWeight={500}>{decodeName(s.name)}</Typography>
                    <Typography variant="caption" color="text.secondary">
                      {fmtDate(s.startDate)} – {fmtDate(s.endDate)}
                      {s.state === 'active' ? ' · Active' : ' · Completed'}
                    </Typography>
                  </Box>
                </MenuItem>
              ))}
            </Select>
          </FormControl>
        )}
        {selectedSprintIsActive && (
          <MembersAutocomplete
            teamMembers={teamMembers} value={selectedMembers}
            onChange={setSelectedMembers} loading={membersLoading} disabled={!selectedProjectId}
          />
        )}
        {selectedSprintIsActive && <Chip label="Live" size="small" color="success" sx={{ height: 20, fontSize: 11 }} />}
        {!selectedSprintIsActive && completedSprintSync && (
          <Chip icon={<CheckCircle />} label="Scorecard loaded automatically" color="success" size="small" variant="outlined" />
        )}
        {(sprintsLoading || membersLoading) && <CircularProgress size={18} />}
        {selectedSprintIsActive && (
          <Button
            variant="contained"
            onClick={handleGenerate}
            disabled={reportLoading || !selectedProjectId || !selectedSprintId || selectedMembers.length === 0}
            startIcon={reportLoading ? <CircularProgress size={16} color="inherit" /> : undefined}
          >
            {reportLoading ? 'Generating...' : 'Generate Live Report'}
          </Button>
        )}
        {sharedError && <Alert severity="error" sx={{ flex: '0 0 100%' }} onClose={() => setSharedError('')}>{sharedError}</Alert>}
      </Box>

      {/* Excel projects use the reduced, snapshot-derived board instead of the Jira perf pipeline. */}
      {selectedProjectId !== '' && selectedProjectIsExcel && (
        <ExcelSprintBoard projectId={selectedProjectId as number} />
      )}

      {/* ── Split panel: left = content, right = Sync History ───────────────── */}
      {selectedProjectId !== '' && !selectedProjectIsExcel && (
        <Box sx={{ display: 'flex', gap: 3, alignItems: 'flex-start' }}>
          <Box sx={{ flex: 1, minWidth: 0 }}>

      {/* ── Sprint result area ─────────────────────────────────────────────────── */}
      {/* Scorecard content (Case A/B/C below) picks its template by the SELECTED
          RECORD's own type (selectedSyncIsKanban); the Trends tab nested inside
          this same block stays keyed to the PROJECT's current mode (isKanban) --
          it's an aggregate-across-last-5 view, not per-record, and its data
          source (useSprintTrendsHistory/useKanbanTrendsHistory above) is already
          fetched that way. Without this split, viewing Trends while an old
          Scrum sync is selected on a now-Kanban project would show a blank tab
          (neither trends block's outer gate would be active). */}
      {(perfView === 'trends' ? !isKanban : !selectedSyncIsKanban) && (
        <>
          {reportError && <Alert severity="error" onClose={() => setReportError('')} sx={{ mb: 2 }}>{reportError}</Alert>}

          {/* Skeleton loading for active sprint Jira call */}
          {reportLoading && (
            <Box sx={{ mb: 3 }}>
              <Box sx={{ display: 'flex', gap: 1, mb: 2, alignItems: 'center' }}>
                <CircularProgress size={14} />
                <Typography variant="caption" color="text.secondary">Fetching live data from Jira...</Typography>
              </Box>
              <Grid container spacing={2} sx={{ mb: 2.5 }}>
                {[0, 1, 2, 3].map(i => (
                  <Grid key={i} size={{ xs: 6, sm: 3 }}>
                    <Skeleton variant="rounded" height={108} />
                  </Grid>
                ))}
              </Grid>
              <Skeleton variant="rounded" height={260} />
            </Box>
          )}

          {/* Case A: Active sprint live report */}
          {reportResult && (
            <ActiveSprintReport
              reportResult={reportResult}
              expandedBacklogRows={expandedBacklogRows}
              toggleBacklogRow={toggleBacklogRow}
            />
          )}

          {/* Case B: Completed sprint with synced scorecard — inline, no scrolling.
              Keyed on selectedSync directly (not completedSprintSync, which only
              ever gets set via the sprint dropdown -- hidden entirely for Kanban
              projects, which would make this permanently unreachable for a
              project that switched Scrum -> Kanban mid-history, like WO). */}
          {!reportResult && selectedSync && selectedSync.syncStatus === 'done' && (
            <CompletedSprintReport
              isKanban={isKanban}
              isMember={isMember}
              perfSyncs={perfSyncs}
              scorecardState={scorecardState}
              sprintTrends={sprintTrends}
              perfView={perfView}
              selectedSyncId={selectedSyncId}
              completedSprintSync={selectedSync}
              selectedSprint={selectedSprint}
              teamMembers={teamMembers}
              setPerfView={setPerfView}
              setMethodologyOpen={setMethodologyOpen}
              setOverrideTarget={setOverrideTarget}
              setDrilldownTarget={setDrilldownTarget}
              setBreakdownTarget={setBreakdownTarget}
            />
          )}

          {/* Case C: Completed sprint with NO sync */}
          {!reportResult && selectedSprintId !== '' && !selectedSprintIsActive && !completedSprintSync && !sprintsLoading && !perfSyncsLoading && (
            <Paper sx={{ p: 4, textAlign: 'center', bgcolor: '#fafafa', mb: 3 }}>
              <Typography variant="body1" color="text.secondary" gutterBottom>
                No performance data has been synced for <strong>{decodeName(selectedSprint?.name ?? '')}</strong> yet.
              </Typography>
              {!isMember && (
                <Button variant="contained" startIcon={<SyncIcon />} sx={{ mt: 1 }}
                  onClick={() => { setSyncSprintPickId(selectedSprintId as number); setSprintSyncOpen(true); }}>
                  Sync This Sprint
                </Button>
              )}
            </Paper>
          )}
        </>
      )}

      {/* Kanban: sync list or empty state */}
      {/* Same split as the Scrum block above: Trends stays project-mode-keyed,
          Scorecard content becomes selected-record-type-keyed. */}
      {(perfView === 'trends' ? isKanban : selectedSyncIsKanban) && (
        <KanbanScorecardReport
          kanbanLive={kanbanLive}
          kanbanScorecard={kanbanScorecard}
          kanbanScorecardLoading={kanbanScorecardLoading}
          perfSyncs={perfSyncs}
          perfSyncsLoading={perfSyncsLoading}
          cycleSyncEnabled={cycleSyncEnabled}
          selectedSyncId={selectedSyncId}
          perfView={perfView}
          setPerfView={setPerfView}
          projectHasCommitment={projectHasCommitment}
          kanbanTrends={kanbanTrends}
          kanbanSpanTicketsQuery={kanbanSpanTicketsQuery}
          kanbanSpanMode={kanbanSpanMode}
          setKanbanSpanMode={setKanbanSpanMode}
          liveSpan={liveSpan}
          setBreakdownTarget={setBreakdownTarget}
          setDrilldownTarget={setDrilldownTarget}
        />
      )}

        </Box>{/* end left panel */}

          {/* RIGHT — Sync History 300px panel */}
          <Box sx={{ width: 300, flexShrink: 0 }}>
            <Paper sx={{ overflow: 'hidden' }}>
              {/* Gradient header */}
              <Box sx={{
                px: 2, py: 1.75,
                background: 'linear-gradient(135deg, #4f46e5 0%, #7c3aed 100%)',
                display: 'flex', alignItems: 'center', gap: 1,
              }}>
                <Typography sx={{ color: '#fff', fontWeight: 700, fontSize: 13, flex: 1 }}>Sync History</Typography>
                {hasActiveSync && (
                  <Chip label="Running" size="small" sx={{ height: 18, fontSize: 10, bgcolor: 'rgba(255,255,255,0.2)', color: '#fff' }} />
                )}
                {!isMember && (
                <Tooltip title={hasActiveSync ? 'A sync is already in progress — wait for it to complete.' : ''}>
                  <span>
                    {isKanban ? (
                      <Button size="small" variant="outlined"
                        sx={{ color: '#fff', borderColor: 'rgba(255,255,255,0.5)', fontSize: 11, py: 0.25, px: 1, minWidth: 0 }}
                        onClick={() => setKanbanSyncOpen(true)} disabled={!selectedProjectId || hasActiveSync}
                        startIcon={<SyncIcon sx={{ fontSize: '14px !important' }} />}>
                        Sync Period
                      </Button>
                    ) : (
                      <Button size="small" variant="outlined"
                        sx={{ color: '#fff', borderColor: 'rgba(255,255,255,0.5)', fontSize: 11, py: 0.25, px: 1, minWidth: 0 }}
                        onClick={() => setSprintSyncOpen(true)} disabled={!selectedProjectId || sprintsLoading || hasActiveSync}
                        startIcon={<SyncIcon sx={{ fontSize: '14px !important' }} />}>
                        Sync Sprint
                      </Button>
                    )}
                  </span>
                </Tooltip>
                )}
              </Box>

              {syncHistoryError && <Alert severity="error" onClose={() => setSyncHistoryError('')} sx={{ mx: 1, my: 0.5 }}>{syncHistoryError}</Alert>}
              {hasActiveSync && (
                <Alert severity="info" icon={<CircularProgress size={14} />}
                  sx={{ mx: 1, my: 0.5, py: 0.5, '& .MuiAlert-message': { fontSize: 11 } }}>
                  Sync running — auto-refreshing...
                </Alert>
              )}

              {perfSyncsLoading && (
                <Box sx={{ display: 'flex', justifyContent: 'center', py: 3 }}>
                  <CircularProgress size={20} />
                </Box>
              )}
              {!perfSyncsLoading && perfSyncs.length === 0 && (
                <Box sx={{ p: 2 }}>
                  <Typography variant="caption" color="text.secondary">
                    No syncs yet. Use the button above to import data.
                  </Typography>
                </Box>
              )}
              {!perfSyncsLoading && (showAllSyncs ? perfSyncs : perfSyncs.slice(0, 5)).map((sync) => (
                <Box key={sync.id}
                  sx={{
                    px: 2, py: 1.25,
                    borderLeft: selectedSyncId === sync.id ? '3px solid #4f46e5' : '3px solid transparent',
                    bgcolor: selectedSyncId === sync.id ? '#f5f3ff' : 'transparent',
                    '&:hover': { bgcolor: selectedSyncId === sync.id ? '#f5f3ff' : '#fafafa' },
                    borderBottom: '1px solid #f1f5f9',
                    display: 'flex', alignItems: 'center', gap: 1,
                  }}>
                  {/* Clickable name area */}
                  <Box
                    onClick={() => {
                      if (sync.syncStatus !== 'done') return;
                      setSelectedSyncId(sync.id);
                      setPerfView('scorecard');
                      setKanbanSpanMode('history'); // selecting a span exits the live current-span view
                      setReportResult(null);
                      // For sprint boards: sync the dropdown to this sprint so Case B renders the clicked sprint's scorecard
                      if (!isKanban && sync.jiraSprintId) {
                        setSelectedSprintId(sync.jiraSprintId);
                      }
                    }}
                    sx={{
                      flex: 1, minWidth: 0,
                      cursor: sync.syncStatus === 'done' ? 'pointer' : 'default',
                    }}>
                    <Typography sx={{
                      fontSize: 12, fontWeight: 600,
                      overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap',
                      color: sync.syncStatus === 'done'
                        ? (selectedSyncId === sync.id ? '#4f46e5' : 'text.primary')
                        : 'text.disabled',
                      '&:hover': sync.syncStatus === 'done' ? { textDecoration: 'underline' } : {},
                    }}>
                      {decodeName(sync.sprintName || sync.periodLabel || '')}
                    </Typography>
                    <Typography sx={{ fontSize: 11, color: '#94a3b8' }}>
                      {sync.syncStatus === 'done'
                        ? `Synced ${fmtDate(sync.syncedAt || sync.createdAt)}`
                        : sync.syncStatus === 'error' ? 'Sync failed'
                        : sync.syncStatus === 'running' ? 'Syncing...'
                        : 'Pending'}
                    </Typography>
                    {sync.syncStatus === 'done' && sync.startDate && (
                      <Typography sx={{ fontSize: 10, color: '#b0bec5' }}>
                        {fmtDate(sync.startDate)}{' \u2013 '}{fmtDate(sync.endDate)}
                      </Typography>
                    )}
                  </Box>
                  {/* Status chip */}
                  {sync.syncStatus === 'running' && <Chip label="Running" color="info" size="small" />}
                  {sync.syncStatus === 'pending' && <Chip label="Pending" color="default" size="small" />}
                  {sync.syncStatus === 'error' && (
                    <Tooltip title={sync.errorMessage ?? 'Unknown error'}>
                      <Chip label="Error" color="error" size="small" />
                    </Tooltip>
                  )}
                  {/* Action buttons (write actions hidden for read-only members) */}
                  {!isMember && (
                    <>
                      {sync.syncStatus === 'done' && (
                        <Tooltip title="Recompute scores">
                          <IconButton size="small" onClick={e => { e.stopPropagation(); handleRecompute(sync.id); }}>
                            <SyncIcon sx={{ fontSize: 14 }} />
                          </IconButton>
                        </Tooltip>
                      )}
                      {sync.syncStatus === 'error' && (
                        <Tooltip title="Retry sync">
                          <IconButton size="small" color="warning" onClick={e => { e.stopPropagation(); handleRetry(sync.id); }}>
                            <SyncIcon sx={{ fontSize: 14 }} />
                          </IconButton>
                        </Tooltip>
                      )}
                      <Tooltip title="Delete">
                        <IconButton size="small" color="error" onClick={e => { e.stopPropagation(); setDeleteConfirmId(sync.id); setShowAlert(true) }}>
                          <DeleteIcon sx={{ fontSize: 14 }} />
                        </IconButton>
                      </Tooltip>
                    </>
                  )}
                </Box>
              ))}
              {!perfSyncsLoading && perfSyncs.length > 5 && (
                <Box sx={{ px: 2, py: 1, textAlign: 'center', borderTop: '1px solid #f1f5f9' }}>
                  <Button size="small" onClick={() => setShowAllSyncs(!showAllSyncs)}
                    sx={{ fontSize: 11, textTransform: 'none', color: '#4f46e5' }}>
                    {showAllSyncs ? 'Show less' : `Show ${perfSyncs.length - 5} more`}
                  </Button>
                </Box>
              )}
            </Paper>
          </Box>
        </Box>
      )}{/* end split panel */}

      {/* ── Sprint Sync Dialog ─────────────────────────────────────────────────── */}
      {sprintSyncOpen && (
        <SprintSyncDialog
          title="Sync Sprint Performance"
          message="Select a closed sprint to import its performance data into the local database."
          closeButtonText="Cancel"
          ActionButtonColor="primary"
          jiraSprints={jiraSprints}
          syncSprintPickId={syncSprintPickId}
          syncTriggerLoading={syncTriggerLoading}
          sprintsLoading={sprintsLoading}
          handleTriggerSprintSync={handleTriggerSprintSync}
          setSyncSprintPickId={setSyncSprintPickId}
          setShowAlert={setSprintSyncOpen}
          onClose={() => {
              setSprintSyncOpen(false);
              setSyncSprintPickId('');
          }}
        />
      )}

      {/* ── Kanban Sync Dialog ─────────────────────────────────────────────────── */}

    {kanbanSyncOpen && (
      <KanbanSyncDialog
        closeButtonText="Cancel"
        ActionButtonColor="primary"
        syncTriggerLoading={syncTriggerLoading}
        cycleSyncEnabled={cycleSyncEnabled}
        kanbanUseCustomRange={kanbanUseCustomRange}
        kanbanSyncFrom={kanbanSyncFrom}
        kanbanSyncTo={kanbanSyncTo}
        kanbanSyncLabel={kanbanSyncLabel}
        setKanbanSyncFrom={setKanbanSyncFrom}
        setKanbanSyncTo={setKanbanSyncTo}
        setKanbanSyncLabel={setKanbanSyncLabel}
        handleTriggerKanbanSync={handleTriggerKanbanSync}
        handleTriggerKanbanCycleSync={handleTriggerKanbanCycleSync}
        setKanbanUseCustomRange={setKanbanUseCustomRange}
        kanbanCycles={kanbanCycles}
        kanbanCyclesQuery={kanbanCyclesQuery}
        selectedCycleIndex={selectedCycleIndex}
        setSelectedCycleIndex={setSelectedCycleIndex}
        setShowAlert={setKanbanSyncOpen}
        onClose={()=>{
          setKanbanSyncOpen(false);
          setKanbanSyncFrom('');
          setKanbanSyncTo('');
          setKanbanSyncLabel('');
          setSelectedCycleIndex('');
        }}
      />
    )}

      </>
      )}

      {/* ── Override Modal ─────────────────────────────────────────────────────── */}
      {overrideTarget && selectedProjectId && selectedSyncId && (
        <PerfOverrideModal
          projectId={selectedProjectId as number}
          syncId={selectedSyncId as number}
          score={overrideTarget}
          onClose={() => setOverrideTarget(null)}
          onSaved={handleOverrideSaved}
        />
      )}

      {/* ── Ticket Drilldown Modal ─────────────────────────────────────────────── */}
      {drilldownTarget && selectedProjectId && selectedSyncId && (
        <PerfTicketDrilldownModal
          projectId={selectedProjectId as number}
          syncId={selectedSyncId as number}
          score={drilldownTarget}
          sprintStartDate={scorecard?.sync?.startDate}
          sprintEndDate={scorecard?.sync?.endDate}
          onClose={() => setDrilldownTarget(null)}
        />
      )}

      {breakdownTarget && selectedProjectId && selectedSyncId && (
        <PerfScoreBreakdownModal
          projectId={selectedProjectId as number}
          syncId={selectedSyncId as number}
          score={breakdownTarget}
          sprintStartDate={scorecard?.sync?.startDate}
          sprintEndDate={scorecard?.sync?.endDate}
          hasCommitment={projectHasCommitment}
          onClose={() => setBreakdownTarget(null)}
        />
      )}

      <MethodologyDoc open={methodologyOpen} onClose={() => setMethodologyOpen(false)} />

      {/* ── Delete Sync Confirmation Dialog ───────────────────────────────────── */}
      {showAlert && (
        <ConfirmationDialog
          title="Delete Sync"
          message="Are you sure you want to delete this sync? All ticket facts and member scores will be permanently removed."
          action="Delete"
          closeButtonText="Cancel"
          ActionButtonColor="primary"
          confirm={handleDeleteSync}
          setShowAlert={setShowAlert}
          onClose={() => {
            setShowAlert(false);
          }}
        />
      )}
    </Box>
  );
}