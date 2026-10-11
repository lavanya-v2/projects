import { useMemo } from 'react';
import type { ProjectQualityTrends } from './useExecutiveQualityTrends';
import { METRICS, HEALTH_CLASS, InfoPopover, POPS, Trend, seriesTrend, type MetricKey, type Health } from './executiveShared';

interface Props {
  metricKey: MetricKey;
  projects: ProjectQualityTrends[];
  view: 'all' | 'single';
  selectedProjectId: number | null;
  onSprintClick: (projectId: number, syncId: number, sprintName: string) => void;
}

/** Oldest → newest (backend returns newest-first). */
const chrono = <T,>(arr: T[]) => [...arr].reverse();

export function ExecutiveMetricPanel({ metricKey, projects, view, selectedProjectId, onSprintClick }: Props) {
  const m = METRICS[metricKey];
  const maxVal = useMemo(() => Math.max(1, ...projects.flatMap(p => p.sprints.map(m.sprintValue))), [projects, metricKey]);
  const single = view === 'single' ? projects.find(p => p.projectId === selectedProjectId) ?? null : null;

  return (
    <div className="panel">
      <div className="panel-head">
        <div className="h">
          <h2>{single ? `${single.projectName} — ${m.label.toLowerCase()}` : `${m.label} — last 5 sprints`}</h2>
          <InfoPopover pop={POPS[metricKey]} />
        </div>
        <div>
          {single ? (
            single.sprints.length > 0 && (
              <span className={`pill ${HEALTH_CLASS[(m.summary(single).health ?? 'green') as Health]}`}>
                <span className="d" />{m.pill((m.summary(single).health ?? 'green') as Health)}
              </span>
            )
          ) : (
            <div className="legend">
              <span><span className="sw" style={{ background: 'var(--accent)', opacity: 0.3 }} /> prior</span>
              <span><span className="sw" style={{ background: 'var(--accent)' }} /> current</span>
            </div>
          )}
        </div>
      </div>

      {single ? (
        <SingleProjectChart project={single} metricKey={metricKey} onSprintClick={onSprintClick} />
      ) : (
        <div className="cmp">
          {projects.map(p => (
            <ProjectRow key={p.projectId} project={p} metricKey={metricKey} maxVal={maxVal} onSprintClick={onSprintClick} />
          ))}
          {projects.length === 0 && (
            <div style={{ padding: 40, textAlign: 'center', color: 'var(--faint)' }}>
              No sprint data available yet for your projects.
            </div>
          )}
        </div>
      )}
    </div>
  );
}

function ProjectRow({ project, metricKey, maxVal, onSprintClick }: {
  project: ProjectQualityTrends; metricKey: MetricKey; maxVal: number; onSprintClick: Props['onSprintClick'];
}) {
  const m = METRICS[metricKey];
  const summary = m.summary(project);
  const sprints = chrono(project.sprints);
  const values = sprints.map(m.sprintValue);
  const trend = seriesTrend(values, m.higherBetter);
  const healthClass = HEALTH_CLASS[(summary.health ?? 'green') as Health];

  return (
    <div className="cmp-row">
      <div className="cmp-proj">
        <span className="hd" style={{ background: `var(--${healthClass === 'good' ? 'good' : healthClass === 'warn' ? 'warn' : 'crit'})` }} />
        <div style={{ minWidth: 0 }}>
          <div className="nm">{project.projectName}</div>
        </div>
      </div>
      <div className="cmp-cur">
        <span className="n">{summary.current == null ? '—' : m.fmt(summary.current)}</span>
        <span className="u">{m.unit}</span>
      </div>
      <div className="minibars">
        {sprints.map((s, i) => {
          const v = m.sprintValue(s);
          const isCur = i === sprints.length - 1;
          const h = Math.max(8, (v / maxVal) * 100);
          return (
            <div
              key={s.syncId}
              className={`bar ${isCur ? 'cur' : ''}`}
              style={{ height: `${h}%` }}
              data-tip={`${s.sprintName}: ${m.fmt(v)}${m.unit}`}
              onClick={() => onSprintClick(project.projectId, s.syncId, s.sprintName)}
            >
              <i />
            </div>
          );
        })}
      </div>
      <div className="cmp-trend">
        <Trend improving={trend.improving} diffPct={trend.diffPct} />
      </div>
    </div>
  );
}

function SingleProjectChart({ project, metricKey, onSprintClick }: {
  project: ProjectQualityTrends; metricKey: MetricKey; onSprintClick: Props['onSprintClick'];
}) {
  const m = METRICS[metricKey];
  const sprints = chrono(project.sprints);
  if (sprints.length === 0) {
    return <div style={{ padding: 40, textAlign: 'center', color: 'var(--faint)' }}>No sprint data yet.</div>;
  }
  const W = 860, H = 300, padL = 44, padR = 20, padT = 26, padB = 46;
  const iw = W - padL - padR, ih = H - padT - padB;
  const values = sprints.map(m.sprintValue);
  const max = Math.max(...values) * 1.18 || 1;
  const min = 0;
  const avg = values.length > 1 ? values.slice(0, -1).reduce((a, b) => a + b, 0) / (values.length - 1) : null;
  const y = (v: number) => padT + ih - ((v - min) / (max - min)) * ih;
  const step = iw / values.length;
  const bw = step * 0.52;
  const healthClass = HEALTH_CLASS[(m.summary(project).health ?? 'green') as Health];
  const curHex = healthClass === 'good' ? 'var(--good)' : healthClass === 'warn' ? 'var(--warn)' : 'var(--crit)';

  const gridLines = [0, 0.25, 0.5, 0.75, 1].map(f => {
    const gy = padT + ih - f * ih;
    const gv = min + f * (max - min);
    return (
      <g key={f}>
        <line className="grid" x1={padL} y1={gy} x2={W - padR} y2={gy} />
        <text className="axislbl" x={padL - 8} y={gy + 3.5} textAnchor="end">{m.fmt(gv)}</text>
      </g>
    );
  });

  return (
    <div className="single">
      <div className="chartwrap">
        <svg className="barsvg" viewBox={`0 0 ${W} ${H}`} preserveAspectRatio="xMidYMid meet" role="img"
          aria-label={`${project.projectName} ${m.label} over ${values.length} sprints`}>
          {gridLines}
          {avg != null && (
            <>
              <line className="avgline" x1={padL} y1={y(avg)} x2={W - padR} y2={y(avg)} />
              <text className="avgtag" x={W - padR} y={y(avg) - 6} textAnchor="end">prior avg {m.fmt(avg)}{m.unit}</text>
            </>
          )}
          {sprints.map((s, i) => {
            const v = m.sprintValue(s);
            const cx = padL + step * i + step / 2;
            const isCur = i === values.length - 1;
            const by = y(v), bh = Math.max(2, padT + ih - by);
            return (
              <g key={s.syncId} className="vbar" onClick={() => onSprintClick(project.projectId, s.syncId, s.sprintName)}>
                <rect x={cx - bw / 2} y={by} width={bw} height={bh} rx={6} fill={isCur ? curHex : 'var(--accent)'} fillOpacity={isCur ? 1 : 0.32} />
                <text className="vlbl" x={cx} y={by - 9}>{m.fmt(v)}{m.unit}</text>
                <text className="xlbl" x={cx} y={H - padB + 20}>{s.sprintName.replace('Sprint ', 'S')}</text>
                <text className="xdate" x={cx} y={H - padB + 35}>{fmtRange(s.startDate, s.endDate)}</text>
              </g>
            );
          })}
        </svg>
      </div>
      <div className="foot">
        <span>{project.projectName} · {m.label}</span>
        <span className="clickhint">
          <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2} strokeLinecap="round" strokeLinejoin="round">
            <path d="M9 11.5V4.5a1.5 1.5 0 013 0V11m0-1v-.5a1.5 1.5 0 013 0V11m0-.5a1.5 1.5 0 013 0V15a5 5 0 01-5 5h-1.5a5 5 0 01-4-2l-3-4a1.5 1.5 0 012.4-1.8L12 14" />
          </svg>
          Click a bar to open the sprint breakdown
        </span>
      </div>
    </div>
  );
}

const fmtRange = (start?: string, end?: string) => {
  if (!start) return '';
  const s = start.slice(5, 10), e = end?.slice(5, 10);
  return e ? `${s}–${e}` : s;
};
