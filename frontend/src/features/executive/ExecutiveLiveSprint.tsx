import { useEffect, useMemo, useState } from 'react';
import { useTeamPerformanceSprints, useProjectTeamMembers, useGenerateTeamPerformanceReport } from '../team-performance/hooks';
import { InfoPopover, POPS, initials } from './executiveShared';

interface Props {
  projectOptions: { id: number; name: string }[];
}

type PipeKey = 'todo' | 'inProgress' | 'inReview' | 'inQa' | 'inUat' | 'blocked' | 'done';
interface MemberStat {
  jiraLoginId: string;
  displayName: string;
  storyPointsDone: number;
  storyPointsCarriedOver: number;
  reopenedCount: number;
  breakdown?: Partial<Record<PipeKey, number>>;
}

// key → chip class + stacked-bar class + label
const PIPE: Record<PipeKey, { chip: string; bar: string; label: string }> = {
  todo: { chip: 'todo', bar: 'st-todo', label: 'To Do' },
  inProgress: { chip: 'prog', bar: 'st-prog', label: 'In Progress' },
  inReview: { chip: 'review', bar: 'st-review', label: 'In Review' },
  inQa: { chip: 'qa', bar: 'st-qa', label: 'In QA' },
  inUat: { chip: 'uat', bar: 'st-uat', label: 'UAT' },
  blocked: { chip: 'block', bar: 'st-block', label: 'Blocked' },
  done: { chip: 'done', bar: 'st-done', label: 'Done' },
};
const PIPE_ORDER: PipeKey[] = ['todo', 'inProgress', 'inReview', 'inQa', 'inUat', 'blocked', 'done'];
const doneBand = (pct: number) => (pct >= 80 ? 'good' : pct >= 60 ? 'warn' : 'crit');

export function ExecutiveLiveSprint({ projectOptions }: Props) {
  const [projectId, setProjectId] = useState<number | ''>(projectOptions[0]?.id ?? '');
  const [form, setForm] = useState<Set<string>>(new Set());
  const [submitted, setSubmitted] = useState<MemberStat[] | null>(null);

  const sprintsQ = useTeamPerformanceSprints(projectId as number);
  const membersQ = useProjectTeamMembers(projectId as number);
  const report = useGenerateTeamPerformanceReport();

  const activeSprint = useMemo(() => (sprintsQ.data ?? []).find(s => s.state === 'active') ?? null, [sprintsQ.data]);
  const selectableMembers = useMemo(
    () => (membersQ.data ?? [])
      .filter((m: any) => !!m.jiraLoginId)
      .map((m: any) => ({ jiraLoginId: m.jiraLoginId as string, name: [m.firstName, m.lastName].filter(Boolean).join(' ').trim() || m.email || m.jiraLoginId })),
    [membersQ.data],
  );

  useEffect(() => { setForm(new Set()); setSubmitted(null); report.reset(); /* eslint-disable-next-line */ }, [projectId]);

  const toggle = (id: string) => setForm(prev => { const n = new Set(prev); n.has(id) ? n.delete(id) : n.add(id); return n; });
  const selectAll = () => setForm(new Set(selectableMembers.map(m => m.jiraLoginId)));
  const clearAll = () => setForm(new Set());

  const submit = () => {
    if (!form.size || !activeSprint || !projectId) return;
    report.mutate(
      { projectId: projectId as number, body: { sprintId: activeSprint.id, memberJiraIds: [...form] } },
      { onSuccess: (data: any) => setSubmitted((data?.memberStats ?? []) as MemberStat[]) },
    );
  };

  // board-status graph from the loaded rows
  const board = useMemo(() => {
    if (!submitted) return null;
    const agg: Record<string, number> = {};
    let done = 0, remaining = 0;
    for (const m of submitted) {
      done += m.storyPointsDone || 0;
      remaining += m.storyPointsCarriedOver || 0;
      for (const k of PIPE_ORDER) agg[k] = (agg[k] || 0) + (m.breakdown?.[k] || 0);
    }
    const committed = done + remaining;
    const total = PIPE_ORDER.reduce((a, k) => a + (agg[k] || 0), 0);
    return { agg, done, committed, pct: committed ? Math.round((done / committed) * 100) : 0, total };
  }, [submitted]);

  return (
    <div className="panel">
      <div className="panel-head">
        <div className="h">
          <h2>Live Sprint{projectOptions.find(p => p.id === projectId) ? ` — ${projectOptions.find(p => p.id === projectId)!.name}` : ''}</h2>
          <InfoPopover pop={POPS.live} />
        </div>
        <select className="select" value={projectId === '' ? '' : String(projectId)} onChange={e => setProjectId(Number(e.target.value))}>
          {projectOptions.length === 0 && <option value="">No projects</option>}
          {projectOptions.map(p => <option key={p.id} value={p.id}>{p.name}</option>)}
        </select>
      </div>

      <div className="live-wrap">
        {sprintsQ.isLoading ? (
          <div className="loader">
            <div className="spinner" />
            <div className="jira"><span className="badge-jira">JIRA</span> Fetching the active sprint…</div>
          </div>
        ) : !activeSprint ? (
          <div className="empty-prompt">No active sprint right now for this project.</div>
        ) : (
          <>
            <div className="live-top">
              <div className="live-sprint">
                <span className="t">{activeSprint.name}</span>
                <span className="d">{activeSprint.startDate?.slice(0, 10)} – {activeSprint.endDate?.slice(0, 10)}</span>
              </div>
            </div>

            {/* member-selection form */}
            <div className="memform">
              <div className="memform-head">
                <h4 className="mstitle">
                  <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2} strokeLinecap="round" strokeLinejoin="round"><path d="M17 21v-2a4 4 0 00-4-4H5a4 4 0 00-4 4v2M9 11a4 4 0 100-8 4 4 0 000 8zM23 21v-2a4 4 0 00-3-3.9M16 3.1a4 4 0 010 7.8" /></svg>
                  Select team members
                </h4>
                <div className="memform-actions">
                  <button className="linkbtn" onClick={selectAll} disabled={!selectableMembers.length}>Select all</button>
                  <button className="linkbtn" onClick={clearAll} disabled={!form.size}>Clear</button>
                  <span className="selcount">{form.size} of {selectableMembers.length} selected</span>
                  <button className="submitbtn" onClick={submit} disabled={!form.size || report.isPending}>
                    {report.isPending
                      ? <><span className="spinner" style={{ width: 14, height: 14, borderWidth: 2 }} /> Loading…</>
                      : <><svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2.3} strokeLinecap="round" strokeLinejoin="round"><path d="M5 12h14M13 6l6 6-6 6" /></svg> Load live data</>}
                  </button>
                </div>
              </div>

              {membersQ.isLoading ? (
                <div className="formhint">Loading team…</div>
              ) : (
                <div className="memchecks">
                  {selectableMembers.map(m => {
                    const on = form.has(m.jiraLoginId);
                    return (
                      <label key={m.jiraLoginId} className={`mcheck ${on ? 'on' : ''}`} onClick={e => { e.preventDefault(); toggle(m.jiraLoginId); }}>
                        <span className="box">{on ? '✓' : ''}</span>
                        <span className="av" style={{ background: '#6366f1' }}>{initials(m.name)}</span>
                        <span className="mn">{m.name}</span>
                      </label>
                    );
                  })}
                  {selectableMembers.length === 0 && <div className="formhint">No Jira-linked members found for this project.</div>}
                </div>
              )}
              <div className="formhint">Live data is fetched from Jira for the members you select — pick all or a subset, then load.</div>
            </div>

            {/* result */}
            <div className="memresult">
              {report.isPending ? (
                <div className="live-loader"><div className="spinner" /> Loading live data for {form.size} member{form.size === 1 ? '' : 's'} from Jira…</div>
              ) : report.isError ? (
                <div className="formhint" style={{ color: 'var(--crit)' }}>Couldn’t load live data. Please try again.</div>
              ) : !submitted ? (
                <div className="empty-prompt">
                  <svg width="26" height="26" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={1.8} strokeLinecap="round" strokeLinejoin="round"><path d="M9 11l3 3L22 4M21 12v7a2 2 0 01-2 2H5a2 2 0 01-2-2V5a2 2 0 012-2h11" /></svg>
                  Select team members above and choose <b>Load live data</b> to see their live sprint breakdown.
                </div>
              ) : (
                <>
                  {board && board.committed > 0 && (
                    <div style={{ marginBottom: 18 }}>
                      <div className="progress-block" style={{ marginBottom: 14 }}>
                        <div className="pbtop"><span>Sprint completion (selected members)</span><span><b>{board.pct}%</b></span></div>
                        <div className="progress"><i style={{ width: `${board.pct}%` }} /></div>
                      </div>
                      {board.total > 0 && (
                        <div className="statusrow">
                          <div className="lbl">Board status · {board.total} SP</div>
                          <div className="statusbar">
                            {PIPE_ORDER.filter(k => (board.agg[k] || 0) > 0).map(k => (
                              <span key={k} className={PIPE[k].bar} style={{ flex: board.agg[k] }} title={`${PIPE[k].label}: ${board.agg[k]}`} />
                            ))}
                          </div>
                          <div className="status-legend">
                            {PIPE_ORDER.filter(k => (board.agg[k] || 0) > 0).map(k => (
                              <span key={k}><span className={`sw ${PIPE[k].bar}`} />{PIPE[k].label} <b>{board.agg[k]}</b></span>
                            ))}
                          </div>
                        </div>
                      )}
                    </div>
                  )}
                  <MembersTable rows={submitted} />
                </>
              )}
            </div>
          </>
        )}
      </div>
    </div>
  );
}

function MembersTable({ rows }: { rows: MemberStat[] }) {
  return (
    <div className="live-tablewrap">
      <table className="live-members">
        <thead>
          <tr>
            <th className="lft">Member</th><th>SP Done</th><th>SP Remaining</th>
            <th className="lft">Pipeline Breakdown</th><th>Done %</th><th>Reopened</th>
          </tr>
        </thead>
        <tbody>
          {rows.map(m => {
            const bd = m.breakdown ?? {};
            const done = m.storyPointsDone || 0;
            const rem = m.storyPointsCarriedOver || 0;
            const total = done + rem;
            const pct = total ? Math.round((done / total) * 100) : 0;
            const chips = PIPE_ORDER.filter(k => (bd[k] || 0) > 0);
            return (
              <tr key={m.jiraLoginId}>
                <td className="lft">
                  <div className="lm-member">
                    <span className="av" style={{ background: '#6366f1' }}>{initials(m.displayName || '')}</span>
                    <span className="mn">{m.displayName}</span>
                  </div>
                </td>
                <td><span className={`lm-sp ${done ? '' : 'dim'}`}>{done || '—'}</span></td>
                <td><span className={`lm-sp ${rem ? '' : 'dim'}`}>{rem || '—'}</span></td>
                <td className="lft">
                  {chips.length ? (
                    <div className="pipe-cell">
                      {chips.map(k => (
                        <span key={k} className={`pchip ${PIPE[k].chip}`}><span className="n">{bd[k]}</span> {PIPE[k].label}</span>
                      ))}
                    </div>
                  ) : <span className="noassign">No tickets assigned</span>}
                </td>
                <td>{total ? <span className={`donepct ${doneBand(pct)}`}>{pct}%</span> : <span className="muted">—</span>}</td>
                <td>{m.reopenedCount > 0 ? m.reopenedCount : <span className="muted">—</span>}</td>
              </tr>
            );
          })}
        </tbody>
      </table>
    </div>
  );
}
