import { useState } from 'react';
import { usePerfScorecard, usePerfTicketFacts } from '../team-performance/hooks';
import { InfoPopover, POPS, initials, type MetricKey } from './executiveShared';

interface Props {
  projectId: number;
  projectName: string;
  syncId: number;
  sprintName: string;
  metricKey: MetricKey;
  onBack: () => void;
}

const isBugType = (t?: string | null) => !!t && t.toLowerCase().includes('bug');
const isSubBug = (t?: string | null) => !!t && t.toLowerCase().includes('bug') && t.toLowerCase() !== 'bug';

const band = (s: number) => (s >= 85 ? 'good' : s >= 70 ? 'warn' : 'crit');
const num = (v: any, digits = 0) => (v == null || Number.isNaN(Number(v)) ? '—' : Number(v).toFixed(digits));

export function ExecutiveSprintDrilldown({ projectId, projectName, syncId, sprintName, metricKey, onBack }: Props) {
  const { data, isLoading, isError } = usePerfScorecard(projectId, syncId);
  // Reopen / Bug drilldowns list raw tickets for the whole sprint (no member filter).
  const wantTickets = metricKey === 'reopenRatio' || metricKey === 'defectDensity';
  const ticketsQ = usePerfTicketFacts(projectId, wantTickets ? syncId : null);
  const allTickets: any[] = ticketsQ.data ?? [];
  const scores: any[] = data?.scores ?? [];
  const devs = scores.filter(s => s.memberCategory !== 'qa');
  const qas = scores.filter(s => s.memberCategory === 'qa' && ((s.ticketsTestedCount ?? 0) > 0 || (s.bugsRaisedCount ?? 0) > 0));

  const committed = data?.committedSp ?? null;
  const delivered = data?.totalCompletedSp ?? 0;
  const productivity = committed ? Math.round((delivered / committed) * 100) : null;
  const bugsLogged = scores.reduce((a, s) => a + (s.bugsRaisedCount ?? 0), 0);

  return (
    <div className="view">
      <button className="back" onClick={onBack}>
        <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2.2} strokeLinecap="round" strokeLinejoin="round"><path d="M15 18l-6-6 6-6" /></svg>
        Back to Delivery Performance
      </button>

      <div className="sprintcard" style={{ marginTop: 12 }}>
        <div className="big">
          <div className="t">{sprintName}</div>
          <div className="d">{projectName}</div>
        </div>
        {data && (
          <>
            <div className="divid" />
            <div className="stat"><span className="k">Committed</span><span className="v">{committed == null ? '—' : <>{committed} <small>SP</small></>}</span></div>
            <div className="stat"><span className="k">Delivered</span><span className="v">{delivered} <small>SP</small></span></div>
            <div className="stat"><span className="k">Productivity</span><span className="v">{productivity == null ? '—' : <>{productivity}<small>%</small></>}</span></div>
            <div className="stat"><span className="k">Bugs logged</span><span className="v">{bugsLogged}</span></div>
            <div className="stat"><span className="k">Team</span><span className="v" style={{ fontSize: 15 }}>{devs.length} DEV · {qas.length} QA</span></div>
          </>
        )}
      </div>

      {isLoading && <div className="loader"><div className="spinner" /></div>}
      {isError && (
        <div className="empty-prompt">This sprint hasn’t been synced yet, so a team breakdown isn’t available.</div>
      )}

      {metricKey === 'reopenRatio' && <ReopenedCard tickets={allTickets} loading={ticketsQ.isLoading} />}
      {metricKey === 'defectDensity' && <BugCard tickets={allTickets} loading={ticketsQ.isLoading} />}

      {data && metricKey === 'productivity' && (
        <div className="score-grid">
          <div className="card">
            <div className="card-head">
              <div className="l">
                <span className="tag dev">Developers</span>
                <h3>Execution</h3>
                <InfoPopover pop={POPS.score} />
              </div>
              <span className="cnt">{devs.length} contributors</span>
            </div>
            <div className="tbl-scroll">
              <table className="sc">
                <thead><tr>
                  <th className="lft">Member</th><th>Score</th><th>SP done</th><th>Delivery</th><th>Rework</th><th>Cycle</th>
                </tr></thead>
                <tbody>
                  {devs.map(d => (
                    <MemberRow key={d.jiraLoginId} projectId={projectId} syncId={syncId} member={d} colSpan={6}
                      cells={[
                        <span className={`scorebadge ${band(d.executionScore ?? 0)}`}>{Math.round(d.executionScore ?? 0)}</span>,
                        <span className="sp-cell">{num(d.spDone)} <small>/ {num(d.spPlanned)}</small></span>,
                        `${num(d.deliveryPct)}%`, `${num(d.reworkFactor)}%`, `${num(d.avgCycleTimeHours)}h`,
                      ]}
                    />
                  ))}
                  {devs.length === 0 && <tr><td colSpan={6} style={{ textAlign: 'center', color: 'var(--faint)', padding: 24 }}>No developer activity recorded.</td></tr>}
                </tbody>
              </table>
            </div>
          </div>

          <div className="card">
            <div className="card-head">
              <div className="l">
                <span className="tag qa">Quality Assurance</span>
                <h3>Testing &amp; quality</h3>
                <InfoPopover pop={POPS.quality} />
              </div>
              <span className="cnt">{qas.length} testers</span>
            </div>
            <div className="tbl-scroll">
              <table className="sc">
                <thead><tr>
                  <th className="lft">Member</th><th>New bugs</th><th>Weighted</th><th>Quality</th><th>Tested</th><th>QA cycle</th><th>Escape</th>
                </tr></thead>
                <tbody>
                  {qas.map(q => {
                    const qr = q.qualityRate;
                    return (
                      <MemberRow key={q.jiraLoginId} projectId={projectId} syncId={syncId} member={q} colSpan={7}
                        cells={[
                          num(q.bugsRaisedCount), num(q.weightedBugScore, 1),
                          qr == null || qr < 0 ? '—' : <span className={`qval ${band(qr)}`}>{Math.round(qr)}</span>,
                          num(q.ticketsTestedCount), `${num(q.avgQaCycleTimeHours)}h`, `${num(q.bugEscapeRatePct)}%`,
                        ]}
                      />
                    );
                  })}
                  {qas.length === 0 && <tr><td colSpan={7} style={{ textAlign: 'center', color: 'var(--faint)', padding: 24 }}>No QA activity recorded.</td></tr>}
                </tbody>
              </table>
            </div>
          </div>
        </div>
      )}

      <div className="foot-note">
        {metricKey === 'productivity'
          ? 'Expand a member to see their tickets · Scores reflect delivery execution, not individual appraisal'
          : metricKey === 'reopenRatio'
            ? 'Stories that were sent back to development during this sprint. UAT-assignee identity is not captured by the sync — only the QA transitioner and UAT rejection status are shown.'
            : 'Bugs recorded in this sprint. Sub-bugs are linked to their parent ticket.'}
      </div>
    </div>
  );
}

/** Reopen Ratio drilldown — list of reopened tickets with owner, QA + UAT detail. */
function ReopenedCard({ tickets, loading }: { tickets: any[]; loading: boolean }) {
  const rows = tickets.filter(t => t.wasReopened);
  return (
    <div className="card">
      <div className="card-head">
        <div className="l">
          <span className="tag qa">Reopened</span>
          <h3>Reopened tickets</h3>
          <InfoPopover pop={POPS.reopenRatio} />
        </div>
        <span className="cnt">{rows.length} ticket{rows.length === 1 ? '' : 's'}</span>
      </div>
      <div className="tbl-scroll">
        <table className="sc">
          <thead><tr>
            <th className="lft">Ticket</th><th className="lft">Summary</th><th className="lft">Assignee</th>
            <th className="lft">QA assignee</th><th className="lft">UAT</th>
          </tr></thead>
          <tbody>
            {loading ? (
              <tr><td colSpan={5} style={{ textAlign: 'center', color: 'var(--faint)', padding: 24 }}>Loading tickets…</td></tr>
            ) : rows.length === 0 ? (
              <tr><td colSpan={5} style={{ textAlign: 'center', color: 'var(--faint)', padding: 24 }}>No reopened tickets in this sprint.</td></tr>
            ) : rows.map(t => (
              <tr key={t.jiraKey}>
                <td className="lft"><span className="tk-key">{t.jiraKey}</span></td>
                <td className="lft" style={{ color: 'var(--ink-2)', whiteSpace: 'normal' }}>{t.summary}</td>
                <td className="lft">{t.assigneeName || <span className="muted">—</span>}</td>
                <td className="lft">{t.qaTesterName || <span className="muted">—</span>}</td>
                <td className="lft">
                  {t.wasUatRejected ? <span className="badge reopen">Rejected</span> : <span className="muted">—</span>}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}

/** Bug Density drilldown — list of bugs with type, parent, and owner. */
function BugCard({ tickets, loading }: { tickets: any[]; loading: boolean }) {
  const rows = tickets.filter(t => isBugType(t.issueType));
  return (
    <div className="card">
      <div className="card-head">
        <div className="l">
          <span className="tag dev">Bugs</span>
          <h3>Bugs this sprint</h3>
          <InfoPopover pop={POPS.defectDensity} />
        </div>
        <span className="cnt">{rows.length} bug{rows.length === 1 ? '' : 's'}</span>
      </div>
      <div className="tbl-scroll">
        <table className="sc">
          <thead><tr>
            <th className="lft">Ticket</th><th className="lft">Summary</th><th className="lft">Type</th>
            <th className="lft">Parent</th><th className="lft">Owner</th><th className="lft">Reporter</th><th>Priority</th>
          </tr></thead>
          <tbody>
            {loading ? (
              <tr><td colSpan={7} style={{ textAlign: 'center', color: 'var(--faint)', padding: 24 }}>Loading bugs…</td></tr>
            ) : rows.length === 0 ? (
              <tr><td colSpan={7} style={{ textAlign: 'center', color: 'var(--faint)', padding: 24 }}>No bugs recorded in this sprint.</td></tr>
            ) : rows.map(t => (
              <tr key={t.jiraKey}>
                <td className="lft"><span className="tk-key">{t.jiraKey}</span></td>
                <td className="lft" style={{ color: 'var(--ink-2)', whiteSpace: 'normal' }}>{t.summary}</td>
                <td className="lft"><span className={`badge ${isSubBug(t.issueType) ? 'subbug' : 'bug'}`}>{isSubBug(t.issueType) ? 'Sub-bug' : 'Bug'}</span></td>
                <td className="lft">{t.parentKey ? <span className="tk-key">{t.parentKey}</span> : <span className="muted">—</span>}</td>
                <td className="lft">{t.assigneeName || <span className="muted">—</span>}</td>
                <td className="lft">{t.reporterName || <span className="muted">—</span>}</td>
                <td>{t.bugPriority || <span className="muted">—</span>}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}

function MemberRow({ projectId, syncId, member, cells, colSpan }: {
  projectId: number; syncId: number; member: any; cells: React.ReactNode[]; colSpan: number;
}) {
  const [open, setOpen] = useState(false);
  return (
    <>
      <tr className={`mrow ${open ? 'open' : ''}`} onClick={() => setOpen(o => !o)}>
        <td className="lft">
          <div className="member">
            <span className="chev"><svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2.4} strokeLinecap="round" strokeLinejoin="round"><path d="M9 6l6 6-6 6" /></svg></span>
            <span className="av" style={{ background: '#6366f1' }}>{initials(member.displayName || '')}</span>
            <span className="mn">{member.displayName}</span>
          </div>
        </td>
        {cells.map((c, i) => <td key={i}>{c}</td>)}
      </tr>
      {open && <MemberTickets projectId={projectId} syncId={syncId} jiraLoginId={member.jiraLoginId} colSpan={colSpan} />}
    </>
  );
}

function MemberTickets({ projectId, syncId, jiraLoginId, colSpan }: {
  projectId: number; syncId: number; jiraLoginId: string; colSpan: number;
}) {
  const { data: tickets, isLoading } = usePerfTicketFacts(projectId, syncId, jiraLoginId);
  return (
    <tr className="subrow">
      <td colSpan={colSpan}>
        <div className="tickets">
          {isLoading ? (
            <div className="th">Loading tickets…</div>
          ) : !tickets || tickets.length === 0 ? (
            <div className="th">No tickets for this member.</div>
          ) : (
            <>
              <div className="th">{tickets.length} tickets</div>
              <table className="tk">
                <tbody>
                  {tickets.map((t: any) => (
                    <tr key={t.jiraKey}>
                      <td className="lft"><span className="tk-key">{t.jiraKey}</span></td>
                      <td className="lft"><span className={`badge ${/bug/i.test(t.issueType) ? 'bug' : 'story'}`}>{/bug/i.test(t.issueType) ? 'Bug' : 'Story'}</span></td>
                      <td className="lft" style={{ width: '99%', color: 'var(--ink-2)' }}>{t.summary}</td>
                      <td>{t.storyPoints ? `${t.storyPoints} SP` : <span className="muted">—</span>}</td>
                      <td>
                        <span className={`badge ${t.wasCompleted ? 'done' : 'spill'}`}>{t.wasCompleted ? 'Done' : 'Open'}</span>
                        {t.wasReopened ? <> <span className="badge reopen">Reopened</span></> : null}
                      </td>
                      <td>{t.cycleTimeHours != null ? `${Math.round(t.cycleTimeHours)}h` : <span className="muted">—</span>}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </>
          )}
        </div>
      </td>
    </tr>
  );
}
