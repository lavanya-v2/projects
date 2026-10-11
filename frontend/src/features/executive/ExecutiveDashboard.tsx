import { useMemo, useState } from 'react';
import { useSearchParams, useNavigate } from 'react-router-dom';
import './executive.css';
import { useAuth } from '../../context/AuthContext';
import { usePermissions } from '../../shared/hooks/usePermissions';
import { UserMenu } from '../../layout/UserMenu';
import { PATHS } from '../../routes/paths';
import { useExecutiveQualityTrends, type ProjectQualityTrends } from './useExecutiveQualityTrends';
import { ExecutiveMetricPanel } from './ExecutiveMetricPanel';
import { ExecutiveLiveSprint } from './ExecutiveLiveSprint';
import { ExecutiveSprintDrilldown } from './ExecutiveSprintDrilldown';
import {
  METRICS, METRIC_ORDER, HEALTH_CLASS, HEALTH_HEX, InfoPopover, POPS, Sparkline, Trend, seriesTrend,
  initials, type MetricKey,
} from './executiveShared';
import { useAccount } from '../../context/UseAccount';

const TAB_TO_METRIC: Record<string, MetricKey> = {
  'productivity': 'productivity', 'bug-density': 'defectDensity', 'reopen-ratio': 'reopenRatio',
};
const chrono = <T,>(arr: T[]) => [...arr].reverse();

interface DrillTarget { projectId: number; projectName: string; syncId: number; sprintName: string; metricKey: MetricKey; }

export function ExecutiveDashboard() {
  const { activeAccount } = useAccount();
  const { user, logout } = useAuth();
  const { roleLabel } = usePermissions();
  const navigate = useNavigate();
  const [params, setParams] = useSearchParams();
  const tab = params.get('tab') ?? 'productivity';
  const [theme, setTheme] = useState<'light' | 'dark' | null>(null);

  const userInitials = `${user?.firstName?.[0] ?? ''}${user?.lastName?.[0] ?? ''}`.toUpperCase();
  const handleLogout = async () => { await logout(); navigate(PATHS.LOGIN); };

  const trendsQ = useExecutiveQualityTrends(activeAccount?.id ?? '');
  // Executive views are sprint-framed → exclude Kanban projects.
  const projects = useMemo(
    () => (trendsQ.data?.projects ?? []).filter(p => !p.isKanbanProject),
    [trendsQ.data],
  );

  const [view, setView] = useState<'all' | 'single'>('all');
  const [selectedProjectId, setSelectedProjectId] = useState<number | null>(null);
  const [drill, setDrill] = useState<DrillTarget | null>(null);

  const setTab = (value: string) => {
    const next = new URLSearchParams(params); next.set('tab', value); setParams(next, { replace: true });
  };
  const chooseSingle = () => {
    setView('single');
    if (selectedProjectId == null && projects[0]) setSelectedProjectId(projects[0].projectId);
  };

  const liveOptions = useMemo(
    () => projects.map(p => ({ id: p.projectId, name: p.projectName })),
    [projects],
  );

  const openDrill = (projectId: number, syncId: number, sprintName: string) => {
    const proj = projects.find(p => p.projectId === projectId);
    setDrill({ projectId, projectName: proj?.projectName ?? '', syncId, sprintName, metricKey: TAB_TO_METRIC[tab] ?? 'productivity' });
  };

  const acctName = activeAccount?.name ?? '';
  const acctInitials = initials(acctName) || 'AC';

  return (
    <div className="exec-root" data-theme={theme ?? undefined}>
      {/* Branded top bar */}
      <div className="topbar">
        <div className="brand">
          <div>
            <div className="name">Delivery Insights</div>
            <div className="sub">Executive View</div>
          </div>
        </div>
        <div className="spacer" />
        {acctName && <div className="acct-chip"><span className="avatar">{acctInitials}</span> {acctName}</div>}
        <button className="icon-btn" title="Toggle theme" aria-label="Toggle theme"
          onClick={() => setTheme(t => (t === 'dark' ? 'light' : t === 'light' ? 'dark'
            : (window.matchMedia('(prefers-color-scheme: dark)').matches ? 'light' : 'dark')))}>
          <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2} strokeLinecap="round">
            <circle cx="12" cy="12" r="4" /><path d="M12 2v2M12 20v2M4.9 4.9l1.4 1.4M17.7 17.7l1.4 1.4M2 12h2M20 12h2M4.9 19.1l1.4-1.4M17.7 6.3l1.4-1.4" />
          </svg>
        </button>
        <UserMenu
          firstName={user?.firstName}
          lastName={user?.lastName}
          initials={userInitials}
          roleLabel={roleLabel}
          onLogout={handleLogout}
        />
      </div>

      <div className="app">
        {/* Breadcrumbs */}
        <nav className="crumbs">
          <a onClick={() => setDrill(null)}>Delivery Performance</a>
          {drill && <><span className="sep">/</span><a onClick={() => setDrill(null)}>{drill.projectName}</a></>}
          {drill && <><span className="sep">/</span><span className="here">{drill.sprintName}</span></>}
        </nav>

        {trendsQ.isLoading ? (
          <div className="loader"><div className="spinner" /></div>
        ) : drill ? (
          <ExecutiveSprintDrilldown
            projectId={drill.projectId} projectName={drill.projectName}
            syncId={drill.syncId} sprintName={drill.sprintName} metricKey={drill.metricKey}
            onBack={() => setDrill(null)}
          />
        ) : (
          <>
            <div className="pagehead">
              <div>
                <h1>Delivery Performance</h1>
                <div className="meta">
                  Trailing <b>5 sprints</b> · <b>{projects.length} project{projects.length === 1 ? '' : 's'}</b>
                  {acctName ? <> · {acctName}</> : null}
                </div>
              </div>
              {periodLabel(projects) && <div className="period"><span className="dot" /> {periodLabel(projects)}</div>}
            </div>

            {/* KPI strip */}
            <div className="kpi-strip">
              {METRIC_ORDER.map(mk => <KpiCard key={mk} metricKey={mk} projects={projects} />)}
            </div>

            {/* Controls */}
            <div className="controls">
              <div className="tabs" role="tablist">
                <button className="tab" role="tab" aria-selected={tab === 'productivity'} onClick={() => setTab('productivity')}>Productivity</button>
                <button className="tab" role="tab" aria-selected={tab === 'bug-density'} onClick={() => setTab('bug-density')}>Bug Density</button>
                <button className="tab" role="tab" aria-selected={tab === 'reopen-ratio'} onClick={() => setTab('reopen-ratio')}>Reopen Ratio</button>
                <button className="tab tab-live" role="tab" aria-selected={tab === 'live'} onClick={() => setTab('live')}>
                  <span className="lpip" />Live Sprint
                </button>
              </div>
              {tab !== 'live' && (
                <div className="rightctl">
                  <div className="seg">
                    <button aria-pressed={view === 'all'} onClick={() => setView('all')}>All projects</button>
                    <button aria-pressed={view === 'single'} onClick={chooseSingle}>Single project</button>
                  </div>
                  {view === 'single' && (
                    <select className="select" value={selectedProjectId ?? ''} onChange={e => setSelectedProjectId(Number(e.target.value))}>
                      {projects.map(p => <option key={p.projectId} value={p.projectId}>{p.projectName}</option>)}
                    </select>
                  )}
                </div>
              )}
            </div>

            {tab === 'live' ? (
              <ExecutiveLiveSprint projectOptions={liveOptions} />
            ) : (
              <ExecutiveMetricPanel
                metricKey={TAB_TO_METRIC[tab] ?? 'productivity'}
                projects={projects}
                view={view}
                selectedProjectId={selectedProjectId}
                onSprintClick={openDrill}
              />
            )}

            <div className="foot-note">Figures refresh after each sprint sync · Click any sprint to view the team breakdown</div>
          </>
        )}
      </div>
    </div>
  );
}

function periodLabel(projects: ProjectQualityTrends[]): string {
  const all = projects.flatMap(p => p.sprints);
  if (!all.length) return '';
  const starts = all.map(s => s.startDate).filter(Boolean).sort();
  const ends = all.map(s => s.endDate).filter(Boolean).sort();
  const fmt = (d?: string) => (d ? new Date(d).toLocaleDateString(undefined, { month: 'short', day: 'numeric' }) : '');
  const start = fmt(starts[0]);
  const end = fmt(ends[ends.length - 1]);
  return start && end ? `${start} – ${end}` : '';
}

function KpiCard({ metricKey, projects }: { metricKey: MetricKey; projects: ProjectQualityTrends[] }) {
  const m = METRICS[metricKey];
  const summaries = projects.map(p => m.summary(p));
  const currents = summaries.map(s => s.current).filter((v): v is number => v != null);
  const avg = currents.length ? currents.reduce((a, b) => a + b, 0) / currents.length : null;

  // Account-level series: per-sprint average across projects (chronological).
  const perProjectSeries = projects.map(p => chrono(p.sprints).map(m.sprintValue));
  const maxLen = Math.max(0, ...perProjectSeries.map(s => s.length));
  const series: number[] = [];
  for (let i = 0; i < maxLen; i++) {
    const vals = perProjectSeries.map(s => s[i]).filter(v => v != null) as number[];
    if (vals.length) series.push(vals.reduce((a, b) => a + b, 0) / vals.length);
  }
  const trend = seriesTrend(series, m.higherBetter);
  const health = avg == null ? 'green' : m.band(avg);

  return (
    <div className="kpi">
      <div className="top">
        <span className="label">{m.label}</span>
        <InfoPopover pop={POPS[metricKey]} />
      </div>
      <div className="val">{avg == null ? '—' : m.fmt(avg)}{m.unit && <span className="unit">{m.unit}</span>}</div>
      <div className="bottom">
        <Trend improving={trend.improving} diffPct={trend.diffPct} label="vs avg" />
        <Sparkline values={series} color={HEALTH_HEX[health]} />
      </div>
      <div className="bottom">
        <span className={`pill ${HEALTH_CLASS[health]}`}><span className="d" />{m.pill(health)}</span>
        <span style={{ fontSize: 11.5, color: 'var(--faint)' }}>account avg</span>
      </div>
    </div>
  );
}
