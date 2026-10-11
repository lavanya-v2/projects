import { Box } from '@mui/material';

const SOP_STYLES = `
.sop-page {
  --bg: #ffffff;
  --surface: #f8fafc;
  --border: #e2e8f0;
  --text: #0f172a;
  --muted: #64748b;
  --primary: #1565c0;
  --success: #2e7d32;
  --warning: #ed6c02;
  --danger: #c62828;
  --accent: #f1f5f9;
  width: 100%;
  max-width: 100%;
  min-width: 0;
  font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, Helvetica, Arial, sans-serif;
  color: var(--text);
  background: var(--bg);
  line-height: 1.6;
  font-size: 15px;
  border-radius: 8px;
  border: 1px solid var(--border);
  position: relative;
  overflow-x: hidden;
}

.sop-page *,
.sop-page *::before,
.sop-page *::after {
  box-sizing: border-box;
  max-width: 100%;
}

.sop-page a {
  color: var(--primary);
  text-decoration: none;
}

.sop-page a:hover {
  text-decoration: underline;
}

.sop-page code {
  background: var(--surface);
  padding: 1px 6px;
  border-radius: 4px;
  font-size: 13px;
  font-family: ui-monospace, "SF Mono", Menlo, Consolas, monospace;
  overflow-wrap: anywhere;
  word-break: break-word;
}

.sop-page .layout {
  width: 100%;
  max-width: 1180px;
  min-width: 0;
  margin: 0 auto;
  display: grid;
  grid-template-columns: minmax(0, 240px) minmax(0, 1fr);
  gap: 48px;
  padding: 32px 28px;
}

.sop-page .toc {
  position: sticky;
  top: 76px;
  align-self: start;
  min-width: 0;
  font-size: 13px;
}

.sop-page .toc h4 {
  font-size: 11px;
  font-weight: 700;
  letter-spacing: .8px;
  color: var(--muted);
  text-transform: uppercase;
  margin: 0 0 12px;
}

.sop-page .toc ol {
  list-style: none;
  margin: 0;
  padding: 0;
  counter-reset: toc;
}

.sop-page .toc li {
  counter-increment: toc;
  margin: 4px 0;
  min-width: 0;
  overflow-wrap: anywhere;
  word-break: break-word;
}

.sop-page .toc li::before {
  content: counter(toc) ".";
  color: var(--muted);
  margin-right: 8px;
  font-variant-numeric: tabular-nums;
}

.sop-page .toc a {
  color: var(--text);
  overflow-wrap: anywhere;
  word-break: break-word;
}

.sop-page .content {
  min-width: 0;
  width: 100%;
  max-width: 100%;
}

.sop-page .content header {
  border-bottom: 1px solid var(--border);
  padding-bottom: 24px;
  margin-bottom: 40px;
  min-width: 0;
  max-width: 100%;
}

.sop-page .content header .eyebrow {
  font-size: 11px;
  font-weight: 700;
  color: var(--primary);
  letter-spacing: 1.2px;
  text-transform: uppercase;
}

.sop-page .content header h1 {
  font-size: 32px;
  line-height: 1.2;
  margin: 8px 0;
  letter-spacing: -.5px;
  font-weight: 800;
  overflow-wrap: anywhere;
  word-break: break-word;
}

.sop-page .content header p.lede {
  color: var(--muted);
  font-size: 16px;
  margin: 0;
  max-width: 720px;
  overflow-wrap: anywhere;
  word-break: break-word;
}

.sop-page .meta {
  display: flex;
  gap: 16px;
  margin-top: 16px;
  flex-wrap: wrap;
  font-size: 12px;
  color: var(--muted);
  min-width: 0;
}

.sop-page .meta span {
  display: inline-flex;
  align-items: center;
  gap: 6px;
  min-width: 0;
  overflow-wrap: anywhere;
}

.sop-page .meta strong {
  color: var(--text);
  font-weight: 600;
}

.sop-page section {
  margin-bottom: 56px;
  scroll-margin-top: 76px;
  min-width: 0;
  max-width: 100%;
}

.sop-page section h2 {
  font-size: 22px;
  margin: 0 0 8px;
  letter-spacing: -.3px;
  font-weight: 700;
  overflow-wrap: anywhere;
  word-break: break-word;
}

.sop-page section .intent {
  color: var(--muted);
  margin: 0 0 24px;
  max-width: 720px;
  overflow-wrap: anywhere;
  word-break: break-word;
}

.sop-page h3 {
  font-size: 15px;
  margin: 24px 0 8px;
  font-weight: 700;
  overflow-wrap: anywhere;
  word-break: break-word;
}

.sop-page p,
.sop-page li,
.sop-page div {
  overflow-wrap: anywhere;
  word-break: break-word;
}

.sop-page .callout {
  width: 100%;
  max-width: 100%;
  min-width: 0;
  border-left: 3px solid var(--primary);
  background: var(--accent);
  padding: 14px 18px;
  border-radius: 0 8px 8px 0;
  margin: 16px 0;
  font-size: 14px;
  overflow-wrap: anywhere;
  word-break: break-word;
}

.sop-page .callout.warning {
  border-color: var(--warning);
  background: #fff7ed;
}

.sop-page .callout.success {
  border-color: var(--success);
  background: #f0fdf4;
}

.sop-page .callout strong {
  display: block;
  margin-bottom: 4px;
  font-weight: 700;
}

.sop-page .principle-grid {
  display: grid;
  grid-template-columns: repeat(auto-fit, minmax(min(180px, 100%), 1fr));
  gap: 12px;
  width: 100%;
  min-width: 0;
}

.sop-page .principle {
  min-width: 0;
  border: 1px solid var(--border);
  border-radius: 8px;
  padding: 14px 16px;
  background: var(--bg);
}

.sop-page .principle .label {
  font-size: 11px;
  color: var(--primary);
  font-weight: 700;
  text-transform: uppercase;
  letter-spacing: .8px;
  overflow-wrap: anywhere;
}

.sop-page .principle .body {
  margin-top: 6px;
  font-size: 13px;
  color: var(--text);
  line-height: 1.5;
  overflow-wrap: anywhere;
  word-break: break-word;
}

.sop-page .table-wrapper {
  width: 100%;
  max-width: 100%;
  min-width: 0;
  overflow-x: auto;
  overflow-y: hidden;
  -webkit-overflow-scrolling: touch;
  margin: 8px 0;
}

.sop-page table {
  width: 100%;
  max-width: 100%;
  border-collapse: collapse;
  font-size: 13px;
}

.sop-page th,
.sop-page td {
  text-align: left;
  padding: 10px 12px;
  vertical-align: top;
  border-bottom: 1px solid var(--border);
  overflow-wrap: anywhere;
  word-break: break-word;
}

.sop-page th {
  background: var(--surface);
  font-weight: 700;
  font-size: 11px;
  text-transform: uppercase;
  letter-spacing: .8px;
  color: var(--muted);
}

.sop-page td:first-child {
  font-weight: 600;
  white-space: normal;
  overflow-wrap: anywhere;
  word-break: break-word;
}

.sop-page ul.checklist,
.sop-page ul.avoid {
  list-style: none;
  padding: 0;
  margin: 12px 0;
  min-width: 0;
}

.sop-page ul.checklist li,
.sop-page ul.avoid li {
  padding: 6px 0 6px 28px;
  position: relative;
  font-size: 14px;
  min-width: 0;
  overflow-wrap: anywhere;
  word-break: break-word;
}

.sop-page ul.checklist li::before {
  content: "";
  position: absolute;
  left: 4px;
  top: 11px;
  width: 14px;
  height: 14px;
  border: 1.5px solid var(--success);
  border-radius: 3px;
  background: #fff;
}

.sop-page ul.checklist li::after {
  content: "\\2713";
  position: absolute;
  left: 6px;
  top: 6px;
  color: var(--success);
  font-weight: 700;
  font-size: 11px;
}

.sop-page ul.avoid li::before {
  content: "";
  position: absolute;
  left: 4px;
  top: 11px;
  width: 14px;
  height: 14px;
  border: 1.5px solid var(--danger);
  border-radius: 3px;
  background: #fff;
}

.sop-page ul.avoid li::after {
  content: "\\2715";
  position: absolute;
  left: 6px;
  top: 5px;
  color: var(--danger);
  font-weight: 700;
  font-size: 12px;
}

.sop-page .timeline {
  border-left: 2px solid var(--border);
  margin-left: 12px;
  padding-left: 24px;
  min-width: 0;
}

.sop-page .timeline .step {
  position: relative;
  padding-bottom: 18px;
  min-width: 0;
}

.sop-page .timeline .step:last-child {
  padding-bottom: 0;
}

.sop-page .timeline .step::before {
  content: "";
  position: absolute;
  left: -32px;
  top: 5px;
  width: 12px;
  height: 12px;
  border-radius: 50%;
  background: var(--primary);
  border: 3px solid #fff;
  box-shadow: 0 0 0 1px var(--primary);
}

.sop-page .timeline .step .when {
  font-size: 11px;
  font-weight: 700;
  color: var(--primary);
  text-transform: uppercase;
  letter-spacing: .8px;
}

.sop-page .timeline .step .what {
  font-size: 15px;
  font-weight: 700;
  margin: 2px 0;
  overflow-wrap: anywhere;
  word-break: break-word;
}

.sop-page .timeline .step .detail {
  font-size: 13px;
  color: var(--muted);
  overflow-wrap: anywhere;
  word-break: break-word;
}

.sop-page .kpi-grid {
  display: grid;
  grid-template-columns: repeat(auto-fit, minmax(min(220px, 100%), 1fr));
  gap: 12px;
  width: 100%;
  min-width: 0;
}

.sop-page .kpi {
  min-width: 0;
  border: 1px solid var(--border);
  border-radius: 8px;
  padding: 14px;
  background: var(--bg);
}

.sop-page .kpi .name {
  font-size: 11px;
  color: var(--muted);
  font-weight: 700;
  text-transform: uppercase;
  letter-spacing: .5px;
  overflow-wrap: anywhere;
}

.sop-page .kpi .target {
  font-size: 14px;
  font-weight: 700;
  margin-top: 4px;
  color: var(--text);
  line-height: 1.4;
  overflow-wrap: anywhere;
  word-break: break-word;
}

.sop-page .kpi .where {
  font-size: 12px;
  color: var(--primary);
  margin-top: 6px;
  overflow-wrap: anywhere;
  word-break: break-word;
}

.sop-page .tag {
  display: inline-block;
  font-size: 10px;
  font-weight: 700;
  letter-spacing: .8px;
  text-transform: uppercase;
  padding: 2px 8px;
  border-radius: 999px;
  margin-right: 4px;
  max-width: 100%;
}

.sop-page .tag.dev {
  background: #e3f2fd;
  color: #0d47a1;
}

.sop-page .tag.qa {
  background: #e8f5e9;
  color: #1b5e20;
}

.sop-page .tag.lead {
  background: #fff3e0;
  color: #bf360c;
}

.sop-page .tbd {
  background: #fff3cd;
  color: #7a4e00;
  padding: 1px 8px;
  border-radius: 4px;
  font-weight: 700;
  font-size: 11px;
  letter-spacing: .4px;
  border: 1px dashed #d97706;
  text-transform: uppercase;
  max-width: 100%;
  overflow-wrap: anywhere;
}

.sop-page .note {
  width: 100%;
  max-width: 100%;
  min-width: 0;
  font-size: 13px;
  color: var(--muted);
  padding: 10px 14px;
  border: 1px dashed var(--border);
  border-radius: 6px;
  background: var(--surface);
  margin: 12px 0;
  overflow-wrap: anywhere;
  word-break: break-word;
}

.sop-page footer {
  margin-top: 64px;
  padding-top: 24px;
  border-top: 1px solid var(--border);
  color: var(--muted);
  font-size: 12px;
  max-width: 100%;
  overflow-wrap: anywhere;
  word-break: break-word;
}

.sop-page footer .row {
  display: flex;
  justify-content: space-between;
  flex-wrap: wrap;
  gap: 12px;
  min-width: 0;
}

.sop-page .changelog .version {
  font-weight: 700;
  color: var(--text);
}

.sop-page .back-to-top {
  position: fixed;
  bottom: 24px;
  right: 24px;
  z-index: 10;
  background: var(--primary);
  color: #fff;
  border: 0;
  border-radius: 999px;
  padding: 10px 16px;
  font-size: 13px;
  font-weight: 600;
  box-shadow: 0 4px 12px rgba(0,0,0,.18);
  cursor: pointer;
  font-family: inherit;
  display: inline-flex;
  align-items: center;
  gap: 6px;
  transition: background-color .15s ease, transform .15s ease;
}

.sop-page .back-to-top:hover {
  background: #0d47a1;
  transform: translateY(-1px);
}

.sop-page .back-to-top:active {
  transform: translateY(0);
}

@media (max-width: 880px) {
  .sop-page .layout {
    grid-template-columns: minmax(0, 1fr);
    padding: 20px 16px;
    gap: 24px;
  }

  .sop-page .toc {
    position: static !important;
    width: 100%;
    max-width: 100%;
  }

  .sop-page .content {
    width: 100%;
    max-width: 100%;
    min-width: 0;
  }
}

@media (max-width: 600px) {
  .sop-page {
    width: 100%;
    max-width: 100%;
    font-size: 14px;
    border-radius: 6px;
    overflow-x: hidden;
  }

  .sop-page .layout {
    width: 100%;
    max-width: 100%;
    padding: 16px 12px;
    gap: 16px;
  }

  .sop-page .content header {
    padding-bottom: 16px;
    margin-bottom: 24px;
  }

  .sop-page .content header h1 {
    font-size: 24px;
    line-height: 1.25;
  }

  .sop-page .content header p.lede {
    font-size: 14px;
  }

  .sop-page .meta {
    gap: 8px;
    margin-top: 12px;
    font-size: 11px;
  }

  .sop-page section {
    margin-bottom: 32px;
  }

  .sop-page section h2 {
    font-size: 19px;
    line-height: 1.3;
  }

  .sop-page section .intent {
    font-size: 13px;
    margin-bottom: 16px;
  }

  .sop-page h3 {
    font-size: 14px;
    margin: 20px 0 8px;
  }

  .sop-page .callout {
    padding: 11px 12px;
    font-size: 13px;
    margin: 12px 0;
  }

  .sop-page .principle-grid {
    grid-template-columns: minmax(0, 1fr);
  }

  .sop-page .principle {
    padding: 12px;
  }

  .sop-page .principle .body {
    font-size: 12px;
  }

  .sop-page .table-wrapper {
    width: 100%;
    max-width: 100%;
    overflow-x: auto;
    -webkit-overflow-scrolling: touch;
  }

  .sop-page table {
    width: 100%;
    min-width: 500px;
    font-size: 11px;
  }

  .sop-page th,
  .sop-page td {
    padding: 7px 8px;
    font-size: 11px;
    line-height: 1.4;
  }

  .sop-page td:first-child {
    white-space: normal;
  }

  .sop-page ul.checklist li,
  .sop-page ul.avoid li {
    font-size: 13px;
    padding-left: 26px;
  }

  .sop-page .timeline {
    margin-left: 8px;
    padding-left: 18px;
  }

  .sop-page .timeline .step::before {
    left: -26px;
  }

  .sop-page .timeline .step .what {
    font-size: 14px;
  }

  .sop-page .timeline .step .detail {
    font-size: 12px;
  }

  .sop-page .kpi-grid {
    grid-template-columns: minmax(0, 1fr);
  }

  .sop-page .kpi {
    padding: 12px;
  }

  .sop-page .kpi .target {
    font-size: 13px;
  }

  .sop-page .note {
    padding: 9px 10px;
    font-size: 12px;
  }

  .sop-page footer {
    margin-top: 32px;
    padding-top: 18px;
    font-size: 11px;
  }

  .sop-page .back-to-top {
    right: 12px;
    bottom: 12px;
    padding: 8px 12px;
    font-size: 12px;
  }
}

@media (max-width: 380px) {
  .sop-page .layout {
    padding: 12px 8px;
  }

  .sop-page .content header h1 {
    font-size: 21px;
  }

  .sop-page section h2 {
    font-size: 17px;
  }

  .sop-page .faq .q,
  .sop-page .faq .a {
    padding: 10px;
  }

  .sop-page th,
  .sop-page td {
    padding: 6px;
    font-size: 10px;
  }

  .sop-page .back-to-top {
    right: 8px;
    bottom: 8px;
  }
}
`;
export const EngineeringSopPage = () => {
  return (
    <Box className="sop-page">
      <style>{SOP_STYLES}</style>
      <div className="layout">
        <nav className="toc" aria-label="Table of contents">
          <h4>On this page</h4>
          <ol>
            <li><a href="#purpose">Purpose</a></li>
            <li><a href="#principles">Core Principles</a></li>
            <li><a href="#roles">Roles &amp; Responsibilities</a></li>
            <li><a href="#lifecycle">Our Part in the Sprint</a></li>
            <li><a href="#engineering">Engineering Standards</a></li>
            <li><a href="#qa">QA Standards</a></li>
            <li><a href="#collab">Collaboration Norms</a></li>
            <li><a href="#learning">Learning &amp; Domain Knowledge</a></li>
            <li><a href="#ai">AI Tools Policy</a></li>
            <li><a href="#metrics">Metrics &amp; Accountability</a></li>
            <li><a href="#self-check">Self-checks &amp; Things to Avoid</a></li>
          </ol>
        </nav>

        <main className="content">
          <header>
            <div className="eyebrow">Engineering Standards · CCMH Portfolio</div>
            <h1>CCMH Engineering SOP</h1>
            <p className="lede">A living working agreement for every CCMH engineering pod — Sales, Operations, Services, and beyond. Predictable delivery, with quality, owned end-to-end. Written by engineers, for engineers.</p>
            <div className="meta">
              <span><strong>Version</strong> v1.0 (draft)</span>
              <span><strong>Last updated</strong> 28 Apr 2026</span>
              <span><strong>Owners</strong> Engineering Team</span>
              <span><strong>Audience</strong> All CCMH Devs · QAs · Leads</span>
            </div>
          </header>

          <section id="purpose">
            <h2>1. Purpose</h2>
            <p className="intent">This is how CCMH engineering pods operate — how we plan, build, test, ship, and report. It exists to make our delivery predictable and our quality non-negotiable, regardless of which pod you sit in.</p>
            <div className="callout">
              <strong>This is a living document.</strong>
              Practices evolve. If something here is out of date or unclear, raise it with your Pod Lead and it'll feed into the next revision.
            </div>
            <div className="callout warning">
              <strong>Items marked <span className="tbd">TBD</span> are pending team consensus.</strong>
              Specific timing thresholds will be confirmed before this document goes to general adoption. The structure and intent are stable; only the numbers move.
            </div>
          </section>

          <section id="principles">
            <h2>2. Core Principles</h2>
            <p className="intent">Every rule below ladders up to one of these five. When something here doesn't fit your situation, fall back to the principle — the rule serves the principle, not the other way around.</p>
            <div className="principle-grid">
              <div className="principle"><div className="label">Ownership</div><div className="body">See your work through to production. "It's done on my side" is not done.</div></div>
              <div className="principle"><div className="label">Product mindset</div><div className="body">We deliver business outcomes, not story points. Ask why before how.</div></div>
              <div className="principle"><div className="label">No surprises</div><div className="body">Surface risk the day you see it — never the day before the demo.</div></div>
              <div className="principle"><div className="label">Data-driven</div><div className="body">Velocity, burndown, escape rate. Decisions backed by what the dashboard actually shows.</div></div>
              <div className="principle"><div className="label">Collaboration</div><div className="body">Onsite, offshore, dev, QA — one team, one outcome. No silos.</div></div>
            </div>
          </section>

          <section id="roles">
            <h2>3. Roles &amp; Responsibilities</h2>
            <p className="intent">Each role carries explicit ownership across the sprint. The Pod Lead is the accountable single point — but every member is responsible for their lane.</p>
            <table>
              <thead>
                <tr><th>Role</th><th>Pre-Sprint</th><th>During Sprint</th><th>Post-Sprint</th></tr>
              </thead>
              <tbody>
                <tr>
                  <td><span className="tag lead">Lead</span> Pod Lead</td>
                  <td>Backlog readiness, capacity check, risk identification, sprint goal articulation.</td>
                  <td>Daily progress + blocker resolution; protect the team from scope creep; drive PR reviews.</td>
                  <td>Retro facilitation; metric review; commitments for next sprint.</td>
                </tr>
                <tr>
                  <td><span className="tag dev">Dev</span> Developer</td>
                  <td>Refinement participation; raise unknowns; question vague ACs.</td>
                  <td>Daily updates; PRs raised early; pair on integration; never block QA.</td>
                  <td>Post-mortem on missed estimates; refactor learnings; documentation closeout.</td>
                </tr>
                <tr>
                  <td><span className="tag qa">QA</span> Quality</td>
                  <td>Test case drafts on top stories; clarify ACs; flag testability concerns.</td>
                  <td>Test cases ready by Day 2; daily test execution; bug logging promptly after detection.</td>
                  <td>UAT sign-off; defect leakage analysis; regression suite refresh.</td>
                </tr>
              </tbody>
            </table>
          </section>

          <section id="lifecycle">
            <h2>4. Our Part in the Sprint</h2>
            <p className="intent">CCM owns the scrum cadence and the formal ceremonies. This section describes what our pods contribute at each step — how we show up prepared, how we participate, and what we commit to within the cadence we operate in.</p>
            <div className="timeline">
              <div className="step"><div className="when">Backlog handoff</div><div className="what">Read it before the call</div><div className="detail">When CCM hands the backlog over, the team reviews ACs, dependencies, and any obvious gaps before the refinement call — not during it.</div></div>
              <div className="step"><div className="when">Pre-grooming &amp; refinement</div><div className="what">Full team attends</div><div className="detail">All pod members join refinement calls. Everyone is expected to surface unknowns, edge cases, and testability concerns. Stories we cannot size are flagged back, not guessed.</div></div>
              <div className="step"><div className="when">Grooming</div><div className="what">Push back on ambiguity</div><div className="detail">ACs locked. We push back on vague stories rather than absorbing the ambiguity into estimates.</div></div>
              <div className="step"><div className="when">Sprint planning</div><div className="what">Honest commitments</div><div className="detail">Capacity validated against velocity trend. Owners assigned. We accept commitments only when they're realistic — we don't pad to please, we don't overcommit to look good.</div></div>
              <div className="step"><div className="when">Day 1</div><div className="what">Execution begins</div><div className="detail">Devs pick top-priority stories. QA drafts test cases for in-flight stories.</div></div>
              <div className="step"><div className="when">Day 2</div><div className="what">QA Readiness checkpoint</div><div className="detail">Test cases reviewed with devs. Mismatches caught here, not on Day 9.</div></div>
              <div className="step"><div className="when">Daily</div><div className="what">Standup + Lens</div><div className="detail">15 minutes max. Yesterday / today / blockers. Update Lens with your insights if there is any mismatch with the dashboard's view.</div></div>
              <div className="step"><div className="when">Day 8</div><div className="what">Dev Complete cutoff</div><div className="detail">Code merged. Anything not merged is at risk and must be flagged today.</div></div>
              <div className="step"><div className="when">Day 9 – 10</div><div className="what">QA + UAT support</div><div className="detail">Full regression. UAT defects triaged within the same day they're raised. Devs stay available to support QA — this is not "someone else's problem".</div></div>
              <div className="step"><div className="when">Day 10</div><div className="what">Closure &amp; retro</div><div className="detail">Demo to stakeholders. Retro: keep / start / stop. Action items go into the next sprint.</div></div>
            </div>
          </section>

          <section id="engineering">
            <h2>5. Engineering Standards</h2>
            <p className="intent">Quality is non-negotiable. Every PR clears the same bar.</p>
            <h3>Code &amp; commits</h3>
            <ul className="checklist">
              <li>TypeScript strict mode; no <code>any</code> without justification.</li>
              <li>Linter clean; no committed console logs or commented-out code.</li>
              <li>Commit messages explain the <em>why</em>, not just the <em>what</em>.</li>
              <li>Branch naming follows <code>feature/JIRA-123-short-desc</code>.</li>
            </ul>
            <h3>Pull request reviews</h3>
            <ul className="checklist">
              <li>Every PR goes through <strong>two rounds of AI review</strong> before being assigned to a peer reviewer. Address findings between rounds — don't batch them at peer review.</li>
              <li>After AI rounds, <strong>peer-to-peer review</strong> by at least one reviewer outside the original story owner's pair.</li>
              <li>First peer-reviewer response within <span className="tbd">TBD</span> of PR open.</li>
              <li>Non-blocker PRs merged within <span className="tbd">TBD</span>.</li>
              <li><strong>No self-merges.</strong></li>
            </ul>
            <h3>Tests &amp; documentation</h3>
            <ul className="checklist">
              <li>Critical paths covered by unit + integration tests.</li>
              <li>New endpoints documented in the API spec in the same PR.</li>
              <li>Architectural decisions captured in Jira (linked from the originating story).</li>
              <li>READMEs updated when setup or env vars change.</li>
            </ul>
            <div className="callout warning">
              <strong>Anti-patterns to avoid</strong>
              Backwards-compat shims, dead-code feature flags, premature abstraction, untested error-handling for cases that can't happen.
            </div>
          </section>

          <section id="qa">
            <h2>6. QA Standards</h2>
            <p className="intent">QA is engaged from Day 1, not as a final gate. The goal is zero criticals to UAT and zero criticals to prod.</p>
            <ul className="checklist">
              <li>Test case drafts on the top half of the sprint backlog by <strong>Day 1</strong>.</li>
              <li>Test cases reviewed jointly with the dev owner by <strong>Day 2</strong>.</li>
              <li>Negative-path coverage explicitly listed; not implied.</li>
              <li>Bugs logged in Jira with reproduction steps + screenshots, promptly after detection.</li>
              <li>Smoke test executed in every deployable environment after release.</li>
              <li>Regression suite refreshed at the end of every sprint based on bugs caught.</li>
            </ul>
            <div className="note">
              <strong>Severity / priority is owned by the business.</strong>
              Our team does not set priority on defects — CCM does. Our discipline is in how quickly we triage, reproduce, and fix once a priority has been assigned. We do not negotiate with the priority field.
            </div>
          </section>

          <section id="collab">
            <h2>7. Collaboration Norms</h2>
            <p className="intent">Distance is not an excuse for distance. Tight communication is a discipline.</p>
            <ul className="checklist">
              <li>Onsite-offshore sync <strong>twice weekly</strong> at the agreed slot — calendar fixed, no skips without prior notice.</li>
              <li>Camera <strong>ON</strong> in standups and syncs. Presence matters.</li>
              <li>Update Lens with your insights if there is any mismatch between the dashboard's view and what's actually happening on the ground.</li>
              <li>Async-first: write decisions down. Teams (or chat in general) is sync; email is formal; Jira is status.</li>
              <li>Response SLA: <span className="tbd">TBD</span> for messages, <span className="tbd">TBD</span> for decisions requiring review.</li>
              <li>Block-first conventions: ask early, escalate sooner. Specific thresholds <span className="tbd">TBD</span>.</li>
            </ul>
          </section>

          <section id="learning">
            <h2>8. Learning &amp; Domain Knowledge</h2>
            <p className="intent">CCMH is a mortgage origination domain. We can't build for what we don't understand. Continuous learning is part of the job, not an extra.</p>
            <h3>How we learn</h3>
            <ul className="checklist">
              <li><strong>Internal trainings</strong> — led by senior pod members or in-house domain SMEs, run on a recurring cadence. Recorded so anyone can catch up.</li>
              <li><strong>Cross-portfolio sessions</strong> — Sales, Operations, Services, and other pods share what they own end-to-end so the boundaries don't become silos.</li>
              <li><strong>Within-portfolio deep-dives</strong> — scheduled walkthroughs for new joiners and rotators inside a pod, focused on the specific flows that pod owns.</li>
              <li><strong>Internal references first</strong> — training recordings, glossaries, runbooks, and architecture notes are the first stop before reaching outside the team.</li>
            </ul>
            <h3>How we keep it current</h3>
            <ul className="checklist">
              <li>Each pod is responsible for keeping its own training material current. Last-updated date visible on every doc.</li>
              <li>Knowledge-share is everyone's responsibility — not just senior members'. If you learned something this sprint, write it up.</li>
              <li>Domain glossary lives in pod wiki. Asking domain questions is normal, not embarrassing.</li>
              <li>Each pod owns end-to-end flow knowledge for its product area (Sales, Operations, Services, etc.).</li>
            </ul>
          </section>

          <section id="ai">
            <h2>9. AI Tools Policy</h2>
            <p className="intent">AI is a force multiplier when used responsibly. It is also a leak vector when used carelessly.</p>
            <div className="callout success">
              <strong>Approved tools</strong>
              Claude Code (CLI / IDE), GitHub Copilot Business, Cursor (with company SSO), and the Anthropic API on company-issued credentials.
            </div>
            <div className="callout warning">
              <strong>Forbidden</strong>
              Personal ChatGPT / Claude / Gemini accounts on any company code. Pasting customer data, credentials, secrets, or PII into any prompt — approved or not.
            </div>
            <h3>Working norms</h3>
            <ul className="checklist">
              <li>Treat AI output like a junior engineer's PR — verify, don't trust blindly.</li>
              <li>Run AI-generated code through the same review + test bar as any other code.</li>
              <li>Don't paste production data into prompts; use synthetic or anonymised data.</li>
              <li>Disclose meaningful AI assistance in the PR description when behaviour was non-trivially generated.</li>
            </ul>
          </section>

          <section id="metrics">
            <h2>10. Metrics &amp; Accountability</h2>
            <p className="intent">If we don't measure it, we don't manage it. These are the metrics every pod is reviewed against — and where each lives in the app.</p>
            <div className="kpi-grid">
              <div className="kpi"><div className="name">Velocity</div><div className="target">Stable or trending up sprint over sprint</div><div className="where">Team Performance → Trends</div></div>
              <div className="kpi"><div className="name">Burndown</div><div className="target">On-track at the daily checkpoint</div><div className="where">Project Detail Dashboard</div></div>
              <div className="kpi"><div className="name">PR Turnaround</div><div className="target">First review &amp; merge SLAs <span className="tbd">TBD</span></div><div className="where">GitHub Insights</div></div>
              <div className="kpi"><div className="name">QA Readiness</div><div className="target">100% top-half stories test-cased by Day 2</div><div className="where">Day-2 checkpoint</div></div>
              <div className="kpi"><div className="name">Defect Density</div><div className="target">Trend down sprint over sprint</div><div className="where">Team Performance → Trends</div></div>
              <div className="kpi"><div className="name">Defect Leakage</div><div className="target">Zero criticals to UAT; zero criticals to prod</div><div className="where">Team Performance → Trends</div></div>
              <div className="kpi"><div className="name">QA Quality Rating</div><div className="target">Excellent (≤ 10)</div><div className="where">Team Performance scorecard</div></div>
              <div className="kpi"><div className="name">UAT Pass Rate</div><div className="target">Target <span className="tbd">TBD</span> by SP</div><div className="where">Bi-weekly Report</div></div>
            </div>
          </section>

          <section id="self-check">
            <h2>11. Self-checks &amp; Things to Avoid</h2>
            <p className="intent">This is a working agreement, not a policing exercise. The pod holds itself to it. Use the checks weekly; treat the things-to-avoid as tells that we're slipping.</p>
            <h3>Weekly self-checks</h3>
            <ul className="checklist">
              <li>Did I follow the AC, or did I quietly guess at it?</li>
              <li>Did my PR get the right number of eyes — both AI rounds plus a peer outside my pair?</li>
              <li>Did QA see my work early enough to draft cases, or did I drop it on them on Day 8?</li>
              <li>Did I flag risk the day I saw it, or did I hope it would resolve on its own?</li>
              <li>Did I update Lens with insights when something on the ground didn't match the dashboard?</li>
              <li>Did I leave the domain glossary or training material better than I found it this sprint?</li>
            </ul>
            <h3>Things to avoid</h3>
            <ul className="avoid">
              <li>Self-approving your own PR.</li>
              <li>Skipping the AI review rounds because "it's a small change".</li>
              <li>Going dark on a blocker. Silence is not a status.</li>
              <li>Closing tickets without QA sign-off.</li>
              <li>Pasting customer data, credentials, or PII into any AI prompt.</li>
              <li>Estimating without reading the full AC.</li>
              <li>Absorbing AC ambiguity into a higher estimate instead of pushing back.</li>
              <li>Skipping standups or onsite-offshore syncs without prior notice.</li>
              <li>"Demo-driven dev" — only finishing what's visible in the demo.</li>
              <li>Letting domain questions sit unanswered for days when the glossary or a colleague could clear them in minutes.</li>
              <li>Treating QA as the final gate instead of a Day-1 partner.</li>
              <li>Negotiating with the priority field on a defect. Priority is set by the business.</li>
            </ul>
          </section>

          <footer>
            <div className="row">
              <div className="changelog">
                <span className="version">v1.0 (draft)</span> · 28 Apr 2026 · Initial publication for review.
              </div>
              <div>Feedback: ping your Pod Lead.</div>
            </div>
          </footer>
        </main>
      </div>
      <button
        type="button"
        className="back-to-top"
        onClick={() => window.scrollTo({ top: 0, behavior: 'smooth' })}
        aria-label="Scroll to top of SOP"
      >
        ↑ Top
      </button>
    </Box>
  );
};
