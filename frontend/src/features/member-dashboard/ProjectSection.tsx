import type { ReactNode } from 'react';
import { Box, Chip, Paper, Typography } from '@mui/material';
import { TechNotesCallout } from './TechNotesCallout';
import { AutomationCallout } from './AutomationCallout';
import { InfoHint, Kpi } from './ui';
import { SpDeliveredChart } from './charts/SpDeliveredChart';
import { CountTrendChart } from './charts/CountTrendChart';
import { BugsLoggedChart } from './charts/BugsLoggedChart';
import { ContributionPie } from './charts/ContributionPie';
import { COLORS } from './charts/chartCommon';
import type { Contribution, MemberProjectDashboard, TrendPoint } from './types';

const ACCENT = {
  developer: COLORS.indigo,
  qa: COLORS.orange,
  kanban: '#94a3b8',
};

const sum = (pts: TrendPoint[] = []) => pts.reduce((a, p) => a + p.value, 0);

function yourShare(contribution: Contribution | null | undefined): number | null {
  if (!contribution) return null;
  const total = contribution.slices.reduce((a, s) => a + s.value, 0);
  const you = contribution.slices.find(s => s.isYou)?.value ?? 0;
  return total > 0 ? Math.round((you / total) * 100) : null;
}

function ChartCard({ title, caption, info, children }: { title: string; caption?: string; info?: string; children: ReactNode }) {
  return (
    <Box sx={{ border: '1px solid #e2e8f0', borderRadius: 3, p: 2 }}>
      <Typography sx={{ fontSize: 14, fontWeight: 700, mb: 1 }}>
        {title}
        {caption && (
          <Typography component="span" sx={{ fontSize: 12, color: 'text.secondary', fontWeight: 500, ml: 0.75 }}>
            {caption}
          </Typography>
        )}
        {info && <InfoHint text={info} />}
      </Typography>
      {children}
    </Box>
  );
}

/** "Last N completed sprints • Sprint A → Sprint B" — makes the metric window explicit. */
function ScopeNote({ sprints }: { sprints: MemberProjectDashboard['sprints'] }) {
  if (!sprints.length) return null;
  const first = sprints[0]?.sprintName;
  const last = sprints[sprints.length - 1]?.sprintName;
  const range = sprints.length > 1 ? `${first} → ${last}` : first;
  // A project that switched Scrum -> Kanban mid-history blends both period
  // types into this same window (see memberDashboardService.ts) -- call that
  // out explicitly so a viewer isn't confused why "sprint" names look mixed
  // with cycle date-range names.
  const syncTypes = new Set(sprints.map(s => s.syncType));
  const isMixedEra = syncTypes.size > 1;
  return (
    <Typography sx={{ fontSize: 12, color: 'text.secondary', mb: 1.25 }}>
      All figures cover the last {sprints.length} completed {sprints.length === 1 ? 'period' : 'periods'}
      {range ? ` (${range})` : ''} — not your all-time totals.
      {isMixedEra && ' This project recently switched from Sprint to Kanban, so the window below blends both.'}
    </Typography>
  );
}

const gridSx = { display: 'grid', gridTemplateColumns: { xs: '1fr', md: '1fr 1fr' }, gap: 2 } as const;
const kpiSx = { display: 'grid', gridTemplateColumns: { xs: 'repeat(2,1fr)', sm: 'repeat(4,1fr)' }, gap: 1.5, mb: 2 } as const;

// ─── Metric explanations (shown in info tooltips) ──────────────────────────────
const QA_INFO = {
  bugs: 'Standalone Bug tickets you reported, counted in the sprint each bug was created. Excludes Sub-bugs (shown separately).',
  subBugs: 'Sub-bug tickets you reported — defects filed under an existing story — counted in the sprint each was created.',
  tested: 'Tickets you moved out of QA into UAT/Done. You are credited as the last tester to transition each ticket in the sprint.',
  share: 'Your tickets-tested in the most recent sprint as a percentage of every QA tester on the project that sprint.',
  bugsChart: 'Per-sprint split of the standalone Bugs vs Sub-bugs you reported.',
  testedChart: 'Per-sprint count of tickets you moved from QA into UAT/Done.',
  contribution: 'How your tested tickets in the latest sprint compare with each QA teammate on the project.',
};
const DEV_INFO = {
  avgSp: 'Average story points you completed per sprint, over the sprints shown.',
  reopens: 'Your tickets that were sent back to development after reaching QA/UAT.',
  carryovers: 'Your tickets not completed in their sprint and carried into the next one.',
  share: 'Your completed story points in the most recent sprint as a percentage of the whole dev team that sprint.',
  spChart: 'Story points you completed each sprint, with your average across the window as a reference line.',
  reopensChart: 'Per-sprint count of your tickets sent back to development after QA/UAT.',
  carryoversChart: 'Per-sprint count of your tickets carried over to the next sprint.',
  contribution: 'How your completed story points in the latest sprint compare with each developer on the team.',
};

export function ProjectSection({ project }: { project: MemberProjectDashboard }) {
  // isKanban means "this project's CURRENT delivery model", not "no data
  // available" -- a project blends Scrum + Kanban history the same way Team
  // Performance Trends does (memberDashboardService.ts), so category/charts
  // render normally regardless of era once there's at least one synced period.
  const accent = ACCENT[project.category ?? 'developer'];

  return (
    <Paper
      sx={{
        borderRadius: 3.5,
        border: '1px solid #e2e8f0',
        borderLeft: `5px solid ${accent}`,
        boxShadow: '0 1px 3px rgba(0,0,0,.06)',
        p: { xs: 2, md: 2.75 },
        mb: 3.25,
      }}
    >
      <Box sx={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', flexWrap: 'wrap', gap: 1, mb: 2 }}>
        <Typography sx={{ fontSize: 18, fontWeight: 700 }}>{project.projectName}</Typography>
        <Box sx={{ display: 'flex', gap: 0.75 }}>
          {project.isKanban && (
            <Chip
              label="Kanban"
              size="small"
              sx={{ fontWeight: 700, fontSize: 11, letterSpacing: 0.4, bgcolor: '#f1f5f9', color: '#64748b' }}
            />
          )}
          <Chip
            label={project.category === 'qa' ? 'QA' : 'Developer'}
            size="small"
            sx={{
              fontWeight: 700,
              fontSize: 11,
              letterSpacing: 0.4,
              bgcolor: project.category === 'qa' ? '#fff1ec' : '#eef2ff',
              color: project.category === 'qa' ? COLORS.orange : COLORS.indigo,
            }}
          />
        </Box>
      </Box>

      {project.category == null || project.sprints.length === 0 ? (
        <Box sx={{ py: 4, textAlign: 'center', color: 'text.secondary' }}>
          <Typography sx={{ fontSize: 14 }}>
            No completed sprint data yet for this project.
          </Typography>
        </Box>
      ) : project.category === 'qa' ? (
        <>
          <AutomationCallout projectId={project.projectId} />
          <ScopeNote sprints={project.sprints} />
          <Box sx={kpiSx}>
            <Kpi value={String(project.bugsLogged?.reduce((a, b) => a + b.bugs, 0) ?? 0)} label="Bugs logged" info={QA_INFO.bugs} />
            <Kpi value={String(project.bugsLogged?.reduce((a, b) => a + b.subBugs, 0) ?? 0)} label="Sub-bugs logged" info={QA_INFO.subBugs} />
            <Kpi value={String(sum(project.ticketsTested))} label="Tested to UAT" info={QA_INFO.tested} />
            <Kpi
              value={yourShare(project.qaContribution) != null ? `${yourShare(project.qaContribution)}%` : '—'}
              label="Your share - last sprint"
              color={COLORS.orange}
              info={QA_INFO.share}
            />
          </Box>
          <Box sx={gridSx}>
            <ChartCard title="Bugs & Sub-bugs Logged" caption="per sprint" info={QA_INFO.bugsChart}>
              <BugsLoggedChart data={project.bugsLogged ?? []} />
            </ChartCard>
            <ChartCard title="Tickets Tested to UAT" caption="per sprint" info={QA_INFO.testedChart}>
              <CountTrendChart data={project.ticketsTested ?? []} color={COLORS.green} name="Tested" />
            </ChartCard>
          </Box>
          {project.qaContribution && (
            <Box sx={{ mt: 2 }}>
              <ChartCard title="Your Contribution" caption={`${project.qaContribution.sprintName} - vs QA team`} info={QA_INFO.contribution}>
                <ContributionPie contribution={project.qaContribution} accentColor={COLORS.orange} />
              </ChartCard>
            </Box>
          )}
        </>
      ) : (
        <>
          <TechNotesCallout projectId={project.projectId} />
          <AutomationCallout projectId={project.projectId} />
          <ScopeNote sprints={project.sprints} />
          <Box sx={kpiSx}>
            <Kpi value={String(project.avgSp ?? 0)} label="Avg SP / sprint" color={COLORS.indigo} info={DEV_INFO.avgSp} />
            <Kpi value={String(sum(project.reopens))} label="Re-opens" info={DEV_INFO.reopens} />
            <Kpi value={String(sum(project.carryovers))} label="Carryovers" info={DEV_INFO.carryovers} />
            <Kpi
              value={yourShare(project.contribution) != null ? `${yourShare(project.contribution)}%` : '—'}
              label="Your share - last sprint"
              color={COLORS.indigo}
              info={DEV_INFO.share}
            />
          </Box>
          <Box sx={gridSx}>
            <ChartCard title="Story Points Delivered" caption="avg line" info={DEV_INFO.spChart}>
              <SpDeliveredChart data={project.spDelivered ?? []} avg={project.avgSp ?? 0} />
            </ChartCard>
            {project.contribution ? (
              <ChartCard title="Your Contribution" caption={`${project.contribution.sprintName} - vs dev team`} info={DEV_INFO.contribution}>
                <ContributionPie contribution={project.contribution} accentColor={COLORS.indigo} />
              </ChartCard>
            ) : (
              <ChartCard title="Your Contribution" info={DEV_INFO.contribution}>
                <Box sx={{ py: 6, textAlign: 'center', color: 'text.secondary', fontSize: 13 }}>
                  No contribution data for the latest sprint.
                </Box>
              </ChartCard>
            )}
            <ChartCard title="Re-opens" caption="your tickets" info={DEV_INFO.reopensChart}>
              <CountTrendChart data={project.reopens ?? []} color={COLORS.reopen} name="Re-opens" />
            </ChartCard>
            <ChartCard title="Carryovers" caption="your tickets" info={DEV_INFO.carryoversChart}>
              <CountTrendChart data={project.carryovers ?? []} color={COLORS.carryover} name="Carryovers" />
            </ChartCard>
          </Box>
        </>
      )}
    </Paper>
  );
}
