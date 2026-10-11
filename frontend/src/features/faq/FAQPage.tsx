import { Box } from '@mui/material';

const FAQ_STYLES = `
.faq-page {
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
  margin: 0;
  padding: 0;
  font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, Helvetica, Arial, sans-serif;
  color: var(--text);
  background: var(--bg);
  line-height: 1.6;
  font-size: 15px;
  border-radius: 8px;
  border: 1px solid var(--border);
  position: relative;
  overflow: hidden;
}

.faq-page *,
.faq-page *::before,
.faq-page *::after {
  box-sizing: border-box;
}

.faq-page img {
  max-width: 100%;
  height: auto;
}

.faq-page a {
  color: var(--primary);
  text-decoration: none;
}

.faq-page a:hover {
  text-decoration: underline;
}

.faq-page code {
  background: var(--surface);
  padding: 1px 6px;
  border-radius: 4px;
  font-size: 13px;
  font-family: ui-monospace, "SF Mono", Menlo, Consolas, monospace;
  border: 1px solid var(--border);
  overflow-wrap: anywhere;
  word-break: break-word;
}

.faq-page .layout {
  width: 100%;
  max-width: 1180px;
  min-width: 0;
  margin: 0 auto;
  display: grid;
  grid-template-columns: minmax(0, 260px) minmax(0, 1fr);
  gap: 48px;
  padding: 32px 28px;
}

.faq-page .toc {
  position: sticky;
  top: 76px;
  align-self: start;
  min-width: 0;
  font-size: 13px;
  max-height: calc(100vh - 100px);
  overflow-y: auto;
  overflow-x: hidden;
  padding-right: 4px;
}

.faq-page .toc h4 {
  font-size: 11px;
  font-weight: 700;
  letter-spacing: .8px;
  color: var(--muted);
  text-transform: uppercase;
  margin: 0 0 12px;
}

.faq-page .toc-controls {
  display: flex;
  gap: 8px;
  margin-bottom: 12px;
  flex-wrap: wrap;
}

.faq-page .toc-controls button {
  font-size: 11px;
  font-weight: 600;
  padding: 4px 10px;
  border-radius: 4px;
  border: 1px solid var(--border);
  background: var(--bg);
  color: var(--muted);
  cursor: pointer;
  font-family: inherit;
}

.faq-page .toc-controls button:hover {
  color: var(--primary);
  border-color: var(--primary);
}

.faq-page .toc details {
  margin: 4px 0;
  min-width: 0;
}

.faq-page .toc summary {
  list-style: none;
  cursor: pointer;
  padding: 6px 0;
  font-weight: 600;
  color: var(--text);
  position: relative;
  padding-left: 22px;
  user-select: none;
  font-variant-numeric: tabular-nums;
  overflow-wrap: anywhere;
  word-break: break-word;
}

.faq-page .toc summary::-webkit-details-marker {
  display: none;
}

.faq-page .toc summary::before {
  content: "▸";
  position: absolute;
  left: 4px;
  top: 6px;
  font-size: 10px;
  color: var(--muted);
  transition: transform .12s ease;
}

.faq-page .toc details[open] > summary::before {
  transform: rotate(90deg);
}

.faq-page .toc summary:hover {
  color: var(--primary);
}

.faq-page .toc summary .sec-num {
  display: inline-block;
  min-width: 18px;
  color: var(--muted);
  margin-right: 4px;
}

.faq-page .toc details ul {
  list-style: none;
  margin: 4px 0 8px;
  padding: 0 0 0 26px;
  border-left: 1px solid var(--border);
  margin-left: 10px;
  min-width: 0;
}

.faq-page .toc details li {
  margin: 4px 0;
  min-width: 0;
}

.faq-page .toc details li a {
  color: var(--text);
  font-size: 12px;
  line-height: 1.45;
  display: block;
  padding: 3px 0;
  overflow-wrap: anywhere;
  word-break: break-word;
}

.faq-page .toc details li a:hover {
  color: var(--primary);
}

.faq-page .toc details li .qid {
  display: inline-block;
  font-weight: 700;
  color: var(--muted);
  margin-right: 6px;
  font-size: 11px;
  font-variant-numeric: tabular-nums;
}

.faq-page .content {
  min-width: 0;
  width: 100%;
  max-width: 100%;
}

.faq-page .content header {
  border-bottom: 1px solid var(--border);
  padding-bottom: 24px;
  margin-bottom: 40px;
  min-width: 0;
}

.faq-page .content header .eyebrow {
  font-size: 11px;
  font-weight: 700;
  color: var(--primary);
  letter-spacing: 1.2px;
  text-transform: uppercase;
}

.faq-page .content header h1 {
  font-size: 32px;
  line-height: 1.2;
  margin: 8px 0;
  letter-spacing: -.5px;
  font-weight: 800;
  overflow-wrap: anywhere;
}

.faq-page .content header p.lede {
  color: var(--muted);
  font-size: 16px;
  margin: 0;
  max-width: 720px;
  overflow-wrap: anywhere;
  word-break: break-word;
}

.faq-page .meta {
  display: flex;
  gap: 16px;
  margin-top: 16px;
  flex-wrap: wrap;
  font-size: 12px;
  color: var(--muted);
}

.faq-page .meta strong {
  color: var(--text);
  font-weight: 600;
}

.faq-page section {
  margin-bottom: 48px;
  scroll-margin-top: 76px;
  min-width: 0;
  max-width: 100%;
}

.faq-page section h2 {
  font-size: 22px;
  margin: 0 0 4px;
  letter-spacing: -.3px;
  font-weight: 700;
  overflow-wrap: anywhere;
}

.faq-page section .intent {
  color: var(--muted);
  margin: 0 0 20px;
  max-width: 720px;
  font-size: 14px;
  overflow-wrap: anywhere;
  word-break: break-word;
}

.faq-page .faq {
  border: 1px solid var(--border);
  border-radius: 8px;
  background: var(--bg);
  margin: 12px 0;
  overflow: hidden;
  scroll-margin-top: 76px;
  width: 100%;
  max-width: 100%;
  min-width: 0;
}

.faq-page .faq:target {
  border-color: var(--primary);
  box-shadow: 0 0 0 3px rgba(21, 101, 192, .15);
}

.faq-page .faq:target .q {
  background: #e3f2fd;
}

.faq-page .faq .q {
  display: block;
  width: 100%;
  max-width: 100%;
  min-width: 0;
  padding: 14px 18px;
  background: var(--surface);
  border-bottom: 1px solid var(--border);
  font-weight: 700;
  font-size: 15px;
  color: var(--text);
  overflow-wrap: anywhere;
  word-break: break-word;
}

.faq-page .faq .q .num {
  display: inline-block;
  font-size: 11px;
  font-weight: 700;
  color: var(--primary);
  letter-spacing: .8px;
  margin-right: 10px;
  font-variant-numeric: tabular-nums;
}

.faq-page .faq .a {
  width: 100%;
  max-width: 100%;
  min-width: 0;
  padding: 14px 18px;
  font-size: 14px;
  overflow-wrap: anywhere;
  word-break: break-word;
}

.faq-page .faq .a p {
  margin: 0 0 10px;
  max-width: 100%;
  overflow-wrap: anywhere;
  word-break: break-word;
}

.faq-page .faq .a p:last-child {
  margin-bottom: 0;
}

.faq-page .faq .a ul {
  margin: 6px 0 10px 20px;
  padding: 0;
  max-width: 100%;
}

.faq-page .faq .a li {
  margin: 4px 0;
  overflow-wrap: anywhere;
  word-break: break-word;
}

.faq-page .example {
  margin: 12px 0 0;
  border-left: 3px solid var(--success);
  background: #f0fdf4;
  padding: 10px 14px;
  border-radius: 0 6px 6px 0;
  font-size: 13px;
  max-width: 100%;
  overflow-wrap: anywhere;
  word-break: break-word;
}

.faq-page .example .label {
  display: block;
  font-size: 10px;
  font-weight: 700;
  letter-spacing: .8px;
  text-transform: uppercase;
  color: var(--success);
  margin-bottom: 4px;
}

.faq-page .formula {
  margin: 8px 0;
  padding: 10px 14px;
  background: var(--surface);
  border: 1px dashed var(--border);
  border-radius: 6px;
  font-family: ui-monospace, "SF Mono", Menlo, Consolas, monospace;
  font-size: 13px;
  color: var(--text);
  max-width: 100%;
  white-space: pre-wrap;
  overflow-wrap: anywhere;
  word-break: break-word;
  overflow-x: auto;
}

.faq-page .dot {
  display: inline-block;
  width: 10px;
  height: 10px;
  border-radius: 50%;
  vertical-align: middle;
  margin-right: 6px;
  border: 1px solid rgba(0,0,0,.08);
}

.faq-page .dot.green { background: #4caf50; }
.faq-page .dot.amber { background: #ff9800; }
.faq-page .dot.red { background: #f44336; }
.faq-page .dot.purple { background: #9c27b0; }
.faq-page .dot.teal { background: #009688; }
.faq-page .dot.blue { background: #1976d2; }
.faq-page .dot.grey {
  background: #e0e0e0;
  border-color: #c0c0c0;
}

.faq-page .figure {
  margin: 16px 0;
  border: 1px solid var(--border);
  border-radius: 8px;
  overflow: hidden;
  background: var(--bg);
  width: 100%;
  max-width: 100%;
}

.faq-page .figure img {
  display: block;
  width: 100%;
  max-width: 100%;
  height: auto;
}

.faq-page .figure .caption {
  padding: 8px 12px;
  font-size: 12px;
  color: var(--muted);
  border-top: 1px solid var(--border);
  background: var(--surface);
  font-style: italic;
  overflow-wrap: anywhere;
  word-break: break-word;
}

.faq-page .tag {
  display: inline-block;
  font-size: 10px;
  font-weight: 700;
  letter-spacing: .8px;
  text-transform: uppercase;
  padding: 2px 8px;
  border-radius: 999px;
  margin-right: 4px;
  background: #e3f2fd;
  color: #0d47a1;
}

.faq-page .table-wrapper {
  width: 100%;
  max-width: 100%;
  overflow-x: auto;
  overflow-y: hidden;
  -webkit-overflow-scrolling: touch;
  margin: 8px 0;
}

.faq-page table {
  width: 100%;
  border-collapse: collapse;
  font-size: 13px;
  margin: 8px 0;
  max-width: 100%;
}

.faq-page th,
.faq-page td {
  text-align: left;
  padding: 8px 12px;
  vertical-align: top;
  border-bottom: 1px solid var(--border);
  overflow-wrap: anywhere;
  word-break: break-word;
}

.faq-page th {
  background: var(--surface);
  font-weight: 700;
  font-size: 11px;
  text-transform: uppercase;
  letter-spacing: .8px;
  color: var(--muted);
}

.faq-page .table-wrapper table {
  min-width: 500px;
}

.faq-page footer {
  margin-top: 48px;
  padding-top: 24px;
  border-top: 1px solid var(--border);
  color: var(--muted);
  font-size: 12px;
  overflow-wrap: anywhere;
  word-break: break-word;
}

.faq-page .back-to-top {
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

.faq-page .back-to-top:hover {
  background: #0d47a1;
  transform: translateY(-1px);
}

.faq-page .back-to-top:active {
  transform: translateY(0);
}

@media (max-width: 880px) {
  .faq-page .layout {
    grid-template-columns: minmax(0, 1fr);
    padding: 20px 16px;
    gap: 24px;
  }

  .faq-page .toc {
    position: static !important;
    width: 100%;
    max-width: 100%;
    max-height: none;
    overflow: visible;
    padding-right: 0;
  }

  .faq-page .content,
  .faq-page section {
    width: 100%;
    max-width: 100%;
    min-width: 0;
  }
}

@media (max-width: 600px) {
  .faq-page {
    width: 100%;
    max-width: 100%;
    border-radius: 6px;
    font-size: 14px;
    overflow-x: hidden;
  }

  .faq-page .layout {
    width: 100%;
    max-width: 100%;
    padding: 16px 12px;
    gap: 16px;
  }

  .faq-page .content header {
    padding-bottom: 16px;
    margin-bottom: 24px;
  }

  .faq-page .content header h1 {
    font-size: 24px;
    line-height: 1.25;
    letter-spacing: -.3px;
  }

  .faq-page .content header p.lede {
    font-size: 14px;
    line-height: 1.5;
  }

  .faq-page .meta {
    gap: 8px;
    margin-top: 12px;
    font-size: 11px;
  }

  .faq-page section {
    margin-bottom: 32px;
  }

  .faq-page section h2 {
    font-size: 19px;
    line-height: 1.3;
  }

  .faq-page section .intent {
    font-size: 13px;
    margin-bottom: 14px;
  }

  .faq-page .faq {
    margin: 10px 0;
    border-radius: 6px;
    width: 100%;
    max-width: 100%;
    min-width: 0;
  }

  .faq-page .faq .q {
    padding: 11px 12px;
    font-size: 13px;
    line-height: 1.5;
  }

  .faq-page .faq .q .num {
    font-size: 10px;
    margin-right: 6px;
  }

  .faq-page .faq .a {
    padding: 12px;
    font-size: 13px;
    line-height: 1.55;
    width: 100%;
    max-width: 100%;
    min-width: 0;
    overflow-wrap: anywhere;
    word-break: break-word;
  }

  .faq-page .faq .a p {
    margin-bottom: 8px;
  }

  .faq-page .faq .a ul {
    margin-left: 18px;
    padding-left: 0;
  }

  .faq-page .example {
    padding: 9px 10px;
    font-size: 12px;
    margin-top: 10px;
  }

  .faq-page .formula {
    padding: 9px 10px;
    font-size: 11px;
    line-height: 1.5;
    white-space: pre-wrap;
    overflow-wrap: anywhere;
    word-break: break-word;
    overflow-x: auto;
  }

  .faq-page .table-wrapper {
    width: 100%;
    max-width: 100%;
    overflow-x: auto;
    -webkit-overflow-scrolling: touch;
    margin: 8px 0;
  }

  .faq-page table {
    font-size: 11px;
    width: 100%;
  }

  .faq-page th,
  .faq-page td {
    padding: 7px 8px;
    font-size: 11px;
    line-height: 1.4;
    overflow-wrap: anywhere;
    word-break: break-word;
  }

  .faq-page .table-wrapper table {
    min-width: 500px;
  }

  .faq-page .tag {
    font-size: 9px;
    padding: 2px 6px;
  }

  .faq-page .figure {
    margin: 12px 0;
  }

  .faq-page .figure .caption {
    padding: 7px 9px;
    font-size: 11px;
  }

  .faq-page .toc {
    font-size: 12px;
  }

  .faq-page .toc details li a {
    font-size: 11px;
    line-height: 1.4;
  }

  .faq-page footer {
    margin-top: 32px;
    padding-top: 18px;
    font-size: 11px;
  }

  .faq-page .back-to-top {
    right: 12px;
    bottom: 12px;
    padding: 8px 12px;
    font-size: 12px;
  }
}

@media (max-width: 380px) {
  .faq-page .layout {
    padding: 12px 8px;
  }

  .faq-page .content header h1 {
    font-size: 21px;
  }

  .faq-page section h2 {
    font-size: 17px;
  }

  .faq-page .faq .q {
    padding: 10px;
    font-size: 12px;
  }

  .faq-page .faq .a {
    padding: 10px;
    font-size: 12px;
  }

  .faq-page .formula {
    font-size: 10px;
  }

  .faq-page th,
  .faq-page td {
    padding: 6px;
    font-size: 10px;
  }

  .faq-page .back-to-top {
    right: 8px;
    bottom: 8px;
  }
}
`;

const setAllDetails = (open: boolean) => {
  document
    .querySelectorAll<HTMLDetailsElement>('.faq-page .toc details')
    .forEach(d => { d.open = open; });
};

export const FAQPage = () => {
  return (
    <Box className="faq-page">
      <style>{FAQ_STYLES}</style>
      <div className="layout">
        <nav className="toc" aria-label="Table of contents">
          <h4>On this page</h4>
          <div className="toc-controls">
            <button type="button" onClick={() => setAllDetails(true)}>Expand all</button>
            <button type="button" onClick={() => setAllDetails(false)}>Collapse all</button>
          </div>

          <details>
            <summary><span className="sec-num">1.</span>Sprint Status &amp; Progress Bar</summary>
            <ul>
              <li><a href="#q1"><span className="qid">Q1</span>How is sprint status calculated?</a></li>
              <li><a href="#q2"><span className="qid">Q2</span>Why don't Kanban projects show a sprint axis?</a></li>
              <li><a href="#q2a"><span className="qid">Q2a</span>DSR Sprint Progress bar — how to read it</a></li>
              <li><a href="#q2b"><span className="qid">Q2b</span>Program-level sprint bar (one row per project)</a></li>
              <li><a href="#q2c"><span className="qid">Q2c</span>Team Performance Sprint Progress card</a></li>
              <li><a href="#q2d"><span className="qid">Q2d</span>Sprint Summary KPI cards (Committed at Start / Final Scope / Completed / Carry Over / Scope Change / Scope Adds / Removed)</a></li>
              <li><a href="#q2e"><span className="qid">Q2e</span>Why "X / Y SP" doesn't match the original commitment</a></li>
              <li><a href="#q2f"><span className="qid">Q2f</span>Data Quality Banner on the Team Performance Report</a></li>
            </ul>
          </details>

          <details>
            <summary><span className="sec-num">2.</span>Daily Project RAG</summary>
            <ul>
              <li><a href="#q3"><span className="qid">Q3</span>What goes into the daily RAG color?</a></li>
              <li><a href="#q4"><span className="qid">Q4</span>Computed vs By-Insights vs Effective health?</a></li>
            </ul>
          </details>

          <details>
            <summary><span className="sec-num">3.</span>Weekly &amp; Monthly RAG</summary>
            <ul>
              <li><a href="#q5"><span className="qid">Q5</span>Weekly project RAG?</a></li>
              <li><a href="#q6"><span className="qid">Q6</span>Account-level weekly RAG?</a></li>
              <li><a href="#q7"><span className="qid">Q7</span>Program daily RAG?</a></li>
              <li><a href="#q8"><span className="qid">Q8</span>Monthly health?</a></li>
            </ul>
          </details>

          <details>
            <summary><span className="sec-num">4.</span>Team Performance Scores</summary>
            <ul>
              <li><a href="#q9"><span className="qid">Q9</span>Developer Execution Score?</a></li>
              <li><a href="#q10"><span className="qid">Q10</span>QA Quality Rate?</a></li>
              <li><a href="#q11"><span className="qid">Q11</span>What is Reopen Rate %?</a></li>
            </ul>
          </details>

          <details>
            <summary><span className="sec-num">5.</span>Sprint Metrics</summary>
            <ul>
              <li><a href="#q12"><span className="qid">Q12</span>Capacity, Planned and Actual?</a></li>
              <li><a href="#q13"><span className="qid">Q13</span>Productivity %?</a></li>
              <li><a href="#q14"><span className="qid">Q14</span>Carryover / Spillover %?</a></li>
              <li><a href="#q15"><span className="qid">Q15</span>Scope Creep %?</a></li>
            </ul>
          </details>

          <details>
            <summary><span className="sec-num">6.</span>Trend Charts</summary>
            <ul>
              <li><a href="#q16"><span className="qid">Q16</span>Productivity trend?</a></li>
              <li><a href="#q17"><span className="qid">Q17</span>Defect Density?</a></li>
              <li><a href="#q18"><span className="qid">Q18</span>Defect Leakage %?</a></li>
              <li><a href="#q19"><span className="qid">Q19</span>Rework / Carryover trends?</a></li>
              <li><a href="#q20"><span className="qid">Q20</span>Bug Classification stacked bar?</a></li>
            </ul>
          </details>

          <details>
            <summary><span className="sec-num">7.</span>Action Items</summary>
            <ul>
              <li><a href="#q21"><span className="qid">Q21</span>Lifecycle of an action item?</a></li>
              <li><a href="#q22"><span className="qid">Q22</span>Who can create / edit / close?</a></li>
              <li><a href="#q23"><span className="qid">Q23</span>How does action-item carryover between sprints work?</a></li>
              <li><a href="#q24"><span className="qid">Q24</span>Auto-close or auto-escalation?</a></li>
              <li><a href="#q24a"><span className="qid">Q24a</span>Can I edit or delete a comment?</a></li>
            </ul>
          </details>

          <details>
            <summary><span className="sec-num">8.</span>Risk Board</summary>
            <ul>
              <li><a href="#q25"><span className="qid">Q25</span>What do the lanes mean?</a></li>
              <li><a href="#q26"><span className="qid">Q26</span>What do priority colors mean?</a></li>
              <li><a href="#q27"><span className="qid">Q27</span>Who can be assigned a risk?</a></li>
              <li><a href="#q28"><span className="qid">Q28</span>Why is a comment required when moving a card?</a></li>
              <li><a href="#q29"><span className="qid">Q29</span>Who can mark a risk DONE?</a></li>
              <li><a href="#q30"><span className="qid">Q30</span>What does the AI summary banner show?</a></li>
              <li><a href="#q30a"><span className="qid">Q30a</span>Can I edit a risk comment?</a></li>
            </ul>
          </details>

          <details>
            <summary><span className="sec-num">9.</span>Executive Summary &amp; AI</summary>
            <ul>
              <li><a href="#q31"><span className="qid">Q31</span>How is the daily executive summary written?</a></li>
              <li><a href="#q32"><span className="qid">Q32</span>Can the AI override the calculated RAG?</a></li>
              <li><a href="#q33"><span className="qid">Q33</span>Can manager insights make a project look better?</a></li>
            </ul>
          </details>

          <details>
            <summary><span className="sec-num">10.</span>Portfolio Presentation</summary>
            <ul>
              <li><a href="#q34"><span className="qid">Q34</span>How do I generate a Portfolio Presentation?</a></li>
              <li><a href="#q34a"><span className="qid">Q34a</span>What is Presentation Mode?</a></li>
              <li><a href="#q34b"><span className="qid">Q34b</span>How does the MOM (Minutes of Meeting) workflow work?</a></li>
              <li><a href="#q34c"><span className="qid">Q34c</span>How does the per-project Health Override work?</a></li>
              <li><a href="#q34d"><span className="qid">Q34d</span>What does Refresh re-pull, and what stays frozen?</a></li>
              <li><a href="#q34e"><span className="qid">Q34e</span>What does the project visibility toggle do?</a></li>
              <li><a href="#q34f"><span className="qid">Q34f</span>What does Manage Trend Sprints do?</a></li>
              <li><a href="#q34g"><span className="qid">Q34g</span>Graph notes, reduced-capacity flags &amp; Team Capacity table</a></li>
              <li><a href="#q34h"><span className="qid">Q34h</span>Can I share a presentation with a direct link?</a></li>
              <li><a href="#q35"><span className="qid">Q35</span>Multi-sprint / boundary / in-flight windows</a></li>
              <li><a href="#q36"><span className="qid">Q36</span>How is the Live Status (in-flight) card built?</a></li>
              <li><a href="#q37"><span className="qid">Q37</span>Which slides and graphs are included?</a></li>
              <li><a href="#q38"><span className="qid">Q38</span>Why are sprint labels shortened on chart X-axes?</a></li>
              <li><a href="#q38a"><span className="qid">Q38a</span>Why did Reopen Ratio change after sprint close?</a></li>
              <li><a href="#q38b"><span className="qid">Q38b</span>What is the Invalid Bugs chart?</a></li>
            </ul>
          </details>

          <details>
            <summary><span className="sec-num">11.</span>Team Performance Report Inputs</summary>
            <ul>
              <li><a href="#q39"><span className="qid">Q39</span>What inputs do I provide?</a></li>
              <li><a href="#q40"><span className="qid">Q40</span>Live Report vs synced sprint scorecard</a></li>
              <li><a href="#q41"><span className="qid">Q41</span>Where do I find the formula behind each tile?</a></li>
            </ul>
          </details>

          <details>
            <summary><span className="sec-num">12.</span>Excel &amp; CSV Projects</summary>
            <ul>
              <li><a href="#q42"><span className="qid">Q42</span>What is an Excel-based project?</a></li>
              <li><a href="#q43"><span className="qid">Q43</span>What has to be set up before the first upload?</a></li>
              <li><a href="#q44"><span className="qid">Q44</span>Why are my story points 0?</a></li>
              <li><a href="#q45"><span className="qid">Q45</span>What is the column check before upload?</a></li>
              <li><a href="#q46"><span className="qid">Q46</span>Merge or Replace — which do I pick?</a></li>
              <li><a href="#q47"><span className="qid">Q47</span>What if I upload the same file twice?</a></li>
              <li><a href="#q48"><span className="qid">Q48</span>My export has no Sprint column</a></li>
              <li><a href="#q49"><span className="qid">Q49</span>Where do I see the data I uploaded?</a></li>
              <li><a href="#q50"><span className="qid">Q50</span>My upload failed — why?</a></li>
              <li><a href="#q51"><span className="qid">Q51</span>I fixed the mapping — must I re-upload?</a></li>
              <li><a href="#q52"><span className="qid">Q52</span>Tidying up "Custom Sprint" names</a></li>
              <li><a href="#q53"><span className="qid">Q53</span>What happens if I delete an upload?</a></li>
              <li><a href="#q54"><span className="qid">Q54</span>Daily vs sprint-based Excel projects</a></li>
            </ul>
          </details>

          <details>
            <summary><span className="sec-num">13.</span>Claude Usage &amp; Prompt Coaching</summary>
            <ul>
              <li><a href="#q55"><span className="qid">Q55</span>What is the Claude usage / monitoring tool?</a></li>
              <li><a href="#q56"><span className="qid">Q56</span>What data does it send, and what does it never send?</a></li>
              <li><a href="#q57"><span className="qid">Q57</span>Why wasn't my usage recorded today?</a></li>
              <li><a href="#q58"><span className="qid">Q58</span>What do cache hit rate, context loss, session shape, parallel work, pace and model fit mean?</a></li>
              <li><a href="#q59"><span className="qid">Q59</span>What's the difference between my Avg score and the skill-tier chip?</a></li>
              <li><a href="#q60"><span className="qid">Q60</span>What can my lead see about my usage, and what's hidden from them?</a></li>
              <li><a href="#q61"><span className="qid">Q61</span>Do I need to update the collector myself?</a></li>
              <li><a href="#q62"><span className="qid">Q62</span>Where do I install the collector, on Windows and on Mac?</a></li>
            </ul>
          </details>

          <details>
            <summary><span className="sec-num">14.</span>Recent Additions</summary>
            <ul>
              <li><a href="#q63"><span className="qid">Q63</span>Retro board — how does point carryover between retros work?</a></li>
              <li><a href="#q64"><span className="qid">Q64</span>Why does a project show a different owner/developer than Jira's assignee field?</a></li>
              <li><a href="#q65"><span className="qid">Q65</span>What does the per-project AI Dev-Assist Tool setting do?</a></li>
              <li><a href="#q66"><span className="qid">Q66</span>RAG reliability overhaul — what changed, and why did my numbers move?</a></li>
            </ul>
          </details>
        </nav>

        <main className="content">
          <header>
            <div className="eyebrow">Reference</div>
            <h1>DSR Generator — FAQ</h1>
            <p className="lede">
              Plain-English answers, with a worked example for each, to the most
              common questions about how the dashboards, DSRs and presentations
              compute their numbers.
            </p>
            <div className="meta">
              <span><strong>Audience:</strong> All users</span>
              <span><strong>Status:</strong> Living document</span>
            </div>
          </header>

          {/* 1. Sprint Status */}
          <section id="sprint-status">
            <h2>1. Sprint Status</h2>
            <p className="intent">How the on-track / at-risk / critical label is decided every day.</p>

            <div className="faq" id="q1">
              <div className="q"><span className="num">Q1</span>How is sprint status calculated?</div>
              <div className="a">
                <p>
                  We compare how much of the sprint has elapsed against how much of the
                  scope is done (weighted by stage: Done = 1.0, in QA = 0.6, in
                  progress / to-do = 0).
                </p>
                <div className="formula">offTrackPct = max(0, sprintElapsedPct − completionPct)</div>
                <p>The label is then chosen from <code>offTrackPct</code>:</p>
                <ul>
                  <li><span className="dot green"></span><strong>On-track</strong> — sprint is &lt;20% elapsed (too early to judge), or off-track is under 30%.</li>
                  <li><span className="dot amber"></span><strong>At-risk</strong> — off-track is 30%–50%.</li>
                  <li><span className="dot red"></span><strong>Critical</strong> — off-track is over 50%.</li>
                </ul>
                <div className="example">
                  <span className="label">Example</span>
                  Day 10 of a 14-day sprint (71% elapsed). Stories: 8 of 20 done
                  (40% complete weighted). Off-track = 71 − 40 = <strong>31%</strong>
                  → <strong>At-risk (Amber)</strong>.
                </div>
              </div>
            </div>

            <div className="faq" id="q2">
              <div className="q"><span className="num">Q2</span>Why don't Kanban projects show a sprint axis?</div>
              <div className="a">
                <p>
                  Kanban has no fixed sprint window, so the sprint-burndown
                  calculation is skipped for those projects. Their RAG color uses
                  only the blocked-tickets and production-bugs axes (see Section 2).
                </p>
              </div>
            </div>

            <div className="faq" id="q2a">
              <div className="q"><span className="num">Q2a</span>How do I read the sprint progress bar on the DSR?</div>
              <div className="a">
                <p>
                  The DSR shows a two-row Sprint Progress card per project. The
                  top row is calendar time, the bottom row is work progress —
                  comparing the two tells you whether the sprint is on pace.
                </p>
                <div className="figure">
                  <img src="/faq/dsr_sprint_bar.png" alt="DSR Sprint Progress bar showing Timeline 73% elapsed and Pipeline with stage breakdown" />
                  <div className="caption">DSR Sprint Progress — Daily Status Report view</div>
                </div>
                <ul>
                  <li><strong>Header</strong> — sprint name (e.g. <code>LOSAI 2026 5.1</code>), team filter (<code>Team</code>), and a status pill (<strong>ON TRACK</strong>, <strong>AT RISK</strong>, or <strong>CRITICAL</strong>) computed from how far behind the calendar the team is. See <a href="#q1">Q1</a> for the formula.</li>
                  <li><strong>Timeline row</strong> — <code>Day 8/11 ... 73%</code>. Calendar elapsed = (working days since sprint start) ÷ (total working days). No team input required, purely date-driven.</li>
                  <li><strong>Pipeline row</strong> — <code>7/22 done · 11/46 SP</code> on the left, <code>40% ticket · 24% SP</code> on the right. The stacked bar widths are proportional to <strong>SP</strong>, not tickets. The percentages on the right show both views because they can differ a lot (see the example below).</li>
                  <li><strong>Segment legend</strong> — each colored chip shows the SP currently in that stage. The DSR bundles <em>QA</em> and <em>Testing</em> statuses together as one "QA / Testing" segment to keep the bar compact.</li>
                  <li><strong>Footer line</strong> — <code>15 stories pending · 33% behind expected pace · 3 days remaining</code>. "Behind expected pace" is the gap between Timeline% and SP%; "3 days remaining" is calendar days, not working days.</li>
                </ul>
                <p>Default segment legend (per-project lane config can extend each bucket):</p>
                <table>
                  <thead><tr><th>Segment</th><th>Meaning</th><th>Default Jira statuses</th></tr></thead>
                  <tbody>
                    <tr><td><span className="dot green"></span>Done</td><td>Work delivered for this sprint</td><td>Done, Closed, Resolved, Pending Deployment</td></tr>
                    <tr><td><span className="dot amber"></span>QA / Testing</td><td>With the QA team</td><td>In QA, QA Review, QA Testing, Testing, Ready for QA</td></tr>
                    <tr><td><span className="dot teal"></span>In Review</td><td>Code / PR review or dev-complete</td><td>Dev Complete, PR Review, Code Review, In Review, Ready for Review</td></tr>
                    <tr><td><span className="dot blue"></span>In Progress</td><td>Active development</td><td>In Progress, In Development</td></tr>
                    <tr><td><span className="dot red"></span>Blocked</td><td>Cannot progress without external action</td><td>Blocked, Impediment, On Hold</td></tr>
                    <tr><td><span className="dot grey"></span>To Do</td><td>Not yet started</td><td>To Do, Open, Backlog</td></tr>
                  </tbody>
                </table>
                <div className="example">
                  <span className="label">Example — why ticket % and SP % differ</span>
                  In the screenshot the team has closed <strong>7 of 22 tickets (40%)</strong>
                  but only <strong>11 of 46 SP (24%)</strong>. That gap means
                  the closed tickets were small ones; the larger tickets are
                  still in the QA / Review / In Progress segments. Always check
                  both numbers when judging burndown.
                </div>
              </div>
            </div>

            <div className="faq" id="q2b">
              <div className="q"><span className="num">Q2b</span>How do I read the program-level sprint bar (one row per project)?</div>
              <div className="a">
                <p>
                  The program-level daily report rolls up every project in a
                  program onto one screen. Each project gets a single-line
                  sprint bar so a head can scan the full portfolio in seconds.
                </p>
                <div className="figure">
                  <img src="/faq/program_sprint_bar.png" alt="Program-level sprint progress showing LOWA, EXP and LOT projects each with their own sprint bar" />
                  <div className="caption">Program Daily Report — one bar per project in the program</div>
                </div>
                <ul>
                  <li><strong>Header pill</strong> next to each project name (<strong>Green</strong>, <strong>Amber</strong>, <strong>Red</strong>) is that project's daily RAG — computed from blocked tickets, production bugs, and sprint pace. See <a href="#q3">Q3</a>.</li>
                  <li><strong>Per-segment numbers</strong> are <em>ticket counts</em>, not SP, to keep the row compact: <code>Done: 41 · QA: 14.5 · Review: 3 · In Progress: 5 · To Do: 3</code>. (Fractional values for QA appear when role attribution splits credit between dev and QA — see Section 4.)</li>
                  <li><strong>Right-aligned label</strong> shows <code>SPRINT-NAME · day X/Y · NN%</code>. The percentage is SP-based completion (same as <a href="#q2a">Q2a</a>'s bar).</li>
                  <li><strong>Reopened</strong> appears as a separate count when stories had to go back to dev after passing QA — these <em>do not</em> reduce the Done count but flag quality risk.</li>
                  <li>The program-level RAG at the top of the card (the chip next to the date) is computed across all projects in the program. See <a href="#q7">Q7</a>.</li>
                </ul>
                <div className="example">
                  <span className="label">Example</span>
                  LOT is <strong>Green</strong> with <code>day 7/11 · 39%</code>
                  done — only 39% of SP delivered halfway through the sprint.
                  It's not Amber because LOT has no blocked tickets and no
                  open prod bugs; the sprint-burndown axis is the only thing
                  pulling it down, and it's not severe enough to escalate yet.
                  Reopened: 5 is a flag worth watching but doesn't directly
                  move the RAG.
                </div>
              </div>
            </div>

            <div className="faq" id="q2c">
              <div className="q"><span className="num">Q2c</span>How do I read the Sprint Progress card on the Team Performance Report?</div>
              <div className="a">
                <p>
                  The Team Performance Report shows the most detailed view of
                  the same data — full SP breakdown by stage, scope-change
                  alert, and an explicit velocity check.
                </p>
                <div className="figure">
                  <img src="/faq/team_performance_current_sprint.png" alt="Team Performance Sprint Progress showing full SP breakdown across Done, UAT, In QA, In Review, In Progress, To Do plus scope change alert and Velocity check" />
                  <div className="caption">Team Performance Report — current sprint detail</div>
                </div>
                <ul>
                  <li><strong>Date range row</strong> — sprint start and end dates anchor each end of the bar; the highlighted segment is calendar progress.</li>
                  <li><strong>Story Points line</strong> shows the full per-stage breakdown: <code>44 done · 20 UAT · 29.5 in QA · 11 in review · 7 in progress · 3 to do / 114.5 total</code>. Unlike the DSR, this view keeps <strong>UAT</strong> as its own segment (purple) because Team Performance audiences care about the dev → QA → UAT handoff explicitly.</li>
                  <li><strong>Scope change (Team) alert</strong> appears only when tickets were added after sprint start. <code>2 tickets (2.5 SP) added after sprint start — 12 total across all teams</code> means the tracked team took 2 of the 12 mid-sprint additions. Click the "Scope Creep Tickets" accordion to see which.</li>
                  <li><strong>Velocity check</strong> at the bottom — <strong>Behind schedule</strong> / <strong>Ahead of schedule</strong> chip with the explicit gap (<code>54pp behind</code> = SP% is 54 percentage points lower than elapsed%). This is the same comparison as <a href="#q1">Q1</a>'s offTrackPct, just shown literally.</li>
                </ul>
                <p>Default segment legend (UAT is the only segment that's not on the DSR variant):</p>
                <table>
                  <thead><tr><th>Segment</th><th>Default Jira statuses</th></tr></thead>
                  <tbody>
                    <tr><td><span className="dot green"></span>Done</td><td>Done, Closed, Resolved, Pending Deployment</td></tr>
                    <tr><td><span className="dot purple"></span>UAT</td><td>PO Review, UAT, Acceptance Testing, In UAT</td></tr>
                    <tr><td><span className="dot amber"></span>In QA</td><td>In QA, QA Review, QA Testing, Testing, Ready for QA</td></tr>
                    <tr><td><span className="dot teal"></span>In Review</td><td>Dev Complete, PR Review, Code Review, In Review, Ready for Review</td></tr>
                    <tr><td><span className="dot blue"></span>In Progress</td><td>In Progress, In Development</td></tr>
                    <tr><td><span className="dot grey"></span>To Do</td><td>To Do, Open, Backlog</td></tr>
                  </tbody>
                </table>
              </div>
            </div>

            <div className="faq" id="q2d">
              <div className="q"><span className="num">Q2d</span>What do the Sprint Summary KPI cards mean (Committed at Start / Final Scope / Completed / Carry Over / Scope Change / Scope Adds / Removed)?</div>
              <div className="a">
                <p>
                  Below the progress bar on the Team Performance Report is a row
                  of KPI cards summarising the sprint as a whole. These are what
                  stakeholders most often quote. The card set was expanded so
                  the Net Scope Change is visible at a glance alongside the
                  original commitment.
                </p>
                <div className="figure">
                  <img src="/faq/sprint_summary.png" alt="Sprint Summary KPI cards: Committed at Start, Final Scope, Total Completed, Carry Over, Scope Change (Net), Scope Adds (Team), Removed (Team)" />
                  <div className="caption">Sprint Summary cards — the headline numbers</div>
                </div>
                <table>
                  <thead><tr><th>Card</th><th>What it counts</th><th>How it's computed</th></tr></thead>
                  <tbody>
                    <tr>
                      <td><strong>Committed at Start</strong></td>
                      <td>SP in the sprint at the moment "Start Sprint" was clicked</td>
                      <td>Reconstructed from each ticket's <code>Sprint</code>-field and <code>Story Points</code>-field changelogs (both current-in-sprint and later-punted tickets). Excludes tickets that were unassigned at start AND were later removed (treated as grooming placeholders).</td>
                    </tr>
                    <tr>
                      <td><strong>Final Scope</strong> <em>(was Total Planned)</em></td>
                      <td>The end-state of the sprint — Total Completed + Carry Over</td>
                      <td>Sum of SP across every ticket in the sprint at close, excluding punted tickets. "Total Planned" was renamed because it actually represented the end-state, not the original commitment.</td>
                    </tr>
                    <tr>
                      <td><strong>Total Completed</strong></td>
                      <td>SP that landed in a Done status</td>
                      <td>Sum of SP for tickets where <code>statusCategory='done'</code> at sprint close OR <code>resolutiondate</code> falls within the sprint window (handles "Closed" statuses some boards don't put in the Done column). Captures unassigned work that the per-developer breakdown misses.</td>
                    </tr>
                    <tr>
                      <td><strong>Carry Over</strong></td>
                      <td>SP that didn't finish (and wasn't punted)</td>
                      <td>Sum of SP for tickets that ended the sprint in a not-done status with an assignee. <strong>Sub-bugs are excluded</strong> — those are counted under QA quality metrics, not developer carryover.</td>
                    </tr>
                    <tr>
                      <td><strong>Scope Change (Net)</strong> <em>(new)</em></td>
                      <td>Final Scope − Committed at Start</td>
                      <td>Headline number the Scrum Master usually reports. Caption shows the gross adds and removes that produced the net (e.g. <code>6 added · 13 removed</code>). Can be positive or negative.</td>
                    </tr>
                    <tr>
                      <td><strong>Scope Adds (Team)</strong> <em>(was Scope Creep)</em></td>
                      <td>SP added mid-sprint to V2 developers</td>
                      <td>Gross count — does NOT net out removals. Excludes carry-in from the immediately-preceding sprint. "V2 team" means the assignee is on <code>team_members.v2_member = true</code>; non-V2 adds appear in the "across all teams" caption. See <a href="#q15">Q15</a>.</td>
                    </tr>
                    <tr>
                      <td><strong>Removed (Team)</strong></td>
                      <td>Tickets explicitly pulled OUT of the sprint mid-stream</td>
                      <td>Sprint-id removed from the issue's Sprint field. Distinct from Carry Over (which stayed in the sprint but didn't finish). The smaller line ("X total across all teams") is the same metric across every team on the board.</td>
                    </tr>
                  </tbody>
                </table>
                <p>
                  <strong>Team filter:</strong> Scope Adds and Removed are
                  filtered to tickets assigned to the tracked V2 team because
                  that's the metric the team is held accountable for. Committed
                  at Start / Final Scope / Completed / Carry Over are shown
                  all-team to reflect the sprint's overall delivery.
                </p>
                <p>
                  For the exact formula per tile, cross-validation rules
                  against Jira's sprint-report API, and diagnostic steps when a
                  number doesn't match the SM's email, open <strong>"How we
                    compute Sprint Summary numbers"</strong> from the Team
                  Performance Report header — and see <a href="#q2f">Q2f</a>
                  for the Data Quality Banner.
                </p>
                <div className="example">
                  <span className="label">Example reading the screenshot</span>
                  Committed at Start = <strong>93 SP</strong>. Final Scope =
                  <strong>100 SP</strong>. 90 SP delivered → 90% delivery on
                  the final scope. 10 SP spilled over (5 tickets that didn't
                  finish). Scope Change (Net) = <strong>+7 SP</strong>
                  (<code>17 added · 10 removed</code>). The team took 17 SP of
                  mid-sprint adds (Scope Adds) and 20 SP was pulled back out
                  (Removed). A healthy sprint despite the churn — but the
                  +7 SP net scope change and 17 SP of adds are worth
                  investigating in retro.
                </div>
              </div>
            </div>

            <div className="faq" id="q2e">
              <div className="q"><span className="num">Q2e</span>Why does "X / Y SP" on the bar not match what the team committed to at sprint planning?</div>
              <div className="a">
                <p>
                  The denominator on the progress bar is the sprint's
                  <strong> current </strong>
                  scope — which includes any tickets added after sprint start
                  (i.e. scope creep) and excludes tickets removed mid-sprint.
                  It is <em>not</em> the original commitment locked in at sprint
                  planning. To reconcile against the original commitment,
                  subtract scope-creep SP from both sides.
                </p>
                <div className="formula">Original commitment = Current scope − Scope-creep SP + Removed SP</div>
                <div className="formula">Delivered vs commitment = Total done SP − Scope-creep SP that ended up done</div>
                <div className="example">
                  <span className="label">Example</span>
                  A DSR shows <strong>55 / 65 SP</strong> for a closed sprint.
                  During the sprint, 7 tickets totalling 15 SP were added
                  mid-sprint (visible in the Scope Creep list), of which 9 SP
                  ended up done. Nothing was removed. Reframing against the
                  original commitment:
                  <br /><br />
                  Original commitment = 65 − 15 = <strong>50 SP</strong><br />
                  Delivered against it = 55 − 9 = <strong>46 SP</strong><br />
                  → <strong>46 / 50 = 92%</strong> against original commitment,
                  vs. the 85% shown on the bar against current scope.
                </div>
                <p>
                  Both framings are valid — the bar deliberately uses current
                  scope so stakeholders see the team's <em>actual</em>
                  delivery against everything they ended up owning, including
                  late additions. The original-commitment view is useful for
                  retros and planning conversations and is the framing the
                  Sprint Summary cards (<a href="#q2d">Q2d</a>) make explicit
                  via the Committed at Start, Scope Adds and Removed tiles.
                </p>
              </div>
            </div>

            <div className="faq" id="q2f">
              <div className="q"><span className="num">Q2f</span>What does the Data Quality Banner on the Team Performance Report mean?</div>
              <div className="a">
                <p>
                  An expandable warning accordion appears above the KPI cards
                  whenever one of three signals fires. It surfaces gaps between
                  our changelog-reconstructed numbers and Jira's sprint-report
                  API <em>before</em> stakeholders quote them.
                </p>
                <table>
                  <thead><tr><th>Trigger</th><th>What it means</th><th>What to do</th></tr></thead>
                  <tbody>
                    <tr>
                      <td><code>unassignedCount &gt; 0</code></td>
                      <td>Unassigned tickets in the sprint are excluded from the per-developer breakdown but ARE counted in Total Completed.</td>
                      <td>If a stakeholder asks why per-dev SP doesn't add up to Total Completed, name the unassigned tickets explicitly.</td>
                    </tr>
                    <tr>
                      <td><code>committed_diff_gt_10pct</code></td>
                      <td>Our reconstructed Committed at Start differs from Jira's <code>completedIssuesInitialEstimateSum + issuesNotCompletedInitialEstimateSum</code> by more than 10%.</td>
                      <td>Most common causes: grooming or re-estimation <em>after</em> sprint start; an SM clicking Start before scope was locked. Open the banner to see both numbers and pick which one to quote.</td>
                    </tr>
                    <tr>
                      <td><code>done_diff_gt_10pct</code></td>
                      <td>Our Total Completed differs from Jira's <code>completedIssuesEstimateSum + issuesCompletedInAnotherSprintEstimateSum</code> by more than 10%.</td>
                      <td>Likely cross-sprint completion or a status-mapping gap (e.g. "Closed" isn't in the board's Done column). The Methodology Doc has the diagnostic checklist.</td>
                    </tr>
                  </tbody>
                </table>
                <p>
                  <strong>Which number do I present?</strong> Use ours by
                  default — they reconcile against changelog facts. If a
                  divergence flag is set and the stakes are high, also quote
                  Jira's number from the banner and explain the gap. For the
                  exact reconciliation rules see <strong>"How we compute
                    Sprint Summary numbers"</strong> from the Team Performance
                  Report header.
                </p>
                <div className="example">
                  <span className="label">Example</span>
                  Sprint shows Committed at Start = 93 SP. Banner reports
                  Jira's view = 78 SP, flag <code>committed_diff_gt_10pct</code>.
                  Cause: 5 stories were estimated mid-sprint after Start. Our
                  93 is the post-estimation view; Jira's 78 captures only what
                  had estimates at click-time. Quote 93 for delivery
                  conversations, 78 if the SM specifically asks for Jira's
                  number.
                </div>
              </div>
            </div>
          </section>

          {/* 2. Daily Project RAG */}
          <section id="daily-rag">
            <h2>2. Daily Project RAG</h2>
            <p className="intent">How the daily Red / Amber / Green color is computed for a single project.</p>

            <div className="faq" id="q3">
              <div className="q"><span className="num">Q3</span>What goes into the daily RAG color?</div>
              <div className="a">
                <p>Three independent axes, each scored on the same 0 / 1 / 2 scale, then summed:</p>
                <table>
                  <thead><tr><th>Axis</th><th>Trigger</th><th>Score</th></tr></thead>
                  <tbody>
                    <tr><td>Blocked tickets</td><td>≥20% of WIP blocked</td><td>+1</td></tr>
                    <tr><td>Production bugs</td><td colSpan={2}>severity-weighted — see below</td></tr>
                    <tr><td>Sprint burndown</td><td>at-risk (Amber)</td><td>+1</td></tr>
                    <tr><td>(Scrum only)</td><td>critical (Red)</td><td>+2</td></tr>
                  </tbody>
                </table>
                <p>Combine the axis scores:</p>
                <div className="formula">combined = blocked + bugs + sprint  →  0 = Green &nbsp;|&nbsp; 1 = Amber &nbsp;|&nbsp; ≥2 = Red</div>

                <p style={{ marginTop: 16 }}>
                  <strong>Production bugs, in detail</strong> (updated — a bug's contribution used to be
                  count/priority-branch logic that could only ever go <em>down</em> once a bug reached
                  QA/review/UAT, regardless of how many or how severe; it's now a severity-weighted sum
                  so severity survives being worked on instead of disappearing):
                </p>
                <table>
                  <thead><tr><th>Severity tier</th><th>Weight</th><th>Jira labels mapped to this tier (default)</th></tr></thead>
                  <tbody>
                    <tr><td>Critical</td><td>2.0</td><td>Blocker, Critical, Highest</td></tr>
                    <tr><td>High</td><td>1.5</td><td>High, Major</td></tr>
                    <tr><td>Medium</td><td>0.75</td><td>Medium, Normal, or unrecognized</td></tr>
                    <tr><td>Low</td><td>0.35</td><td>Low, Lowest, Minor, Trivial</td></tr>
                  </tbody>
                </table>
                <p>
                  A bug already in a remediation lane (in-progress, in-review, QA, or UAT) keeps{' '}
                  <strong>half</strong> its weight rather than being flattened to a fixed value —
                  engagement lowers urgency, but doesn't erase it. Weights for every fresh (not-old,
                  not-reopened) bug are summed:
                </p>
                <div className="formula">totalWeight &lt; 0.5 → +0 &nbsp;|&nbsp; totalWeight &lt; 2.0 → +1 (Amber) &nbsp;|&nbsp; totalWeight ≥ 2.0 → +2 (Red)</div>
                <p>
                  A project can override the default label→tier map in its settings if its Jira instance
                  uses non-standard priority names (e.g. P1/P2/Sev1).
                </p>
                <div className="example">
                  <span className="label">Example</span>
                  One unaddressed Critical production bug: weight 2.0 → bugs axis = +2 (Red) on its own,
                  sprint on-track = 0, no blockers = 0. Combined = 2 → <strong>Red</strong>.
                </div>
                <div className="example">
                  <span className="label">Example</span>
                  Four Blocker-severity bugs sitting in QA: each keeps half its Critical weight
                  (2.0 × 0.5 = 1.0), total = 4.0 → bugs axis = +2 (Red). One Medium-severity bug in QA:
                  0.75 × 0.5 = 0.375 → bugs axis = +0 (Green). Same lane, very different signal —
                  severity is no longer capped away once work starts.
                </div>
              </div>
            </div>

            <div className="faq" id="q4">
              <div className="q"><span className="num">Q4</span>What is "Computed vs By-Insights vs Effective" health?</div>
              <div className="a">
                <p>
                  The calculated color above is the <em>Computed</em> health.
                  A manager can add Insights that <strong>escalate</strong> the color
                  (Green→Amber, Amber→Red) — but never downgrade it.
                </p>
                <div className="formula">effective = max(computed, insightsOverride) by severity (Red &gt; Amber &gt; Green)</div>
                <div className="example">
                  <span className="label">Example</span>
                  Computed = Green, but the manager flags a client escalation in
                  insights → Insights = Amber → <strong>Effective = Amber</strong>.
                  Computed stays Green in the audit trail.
                </div>
              </div>
            </div>
          </section>

          {/* 3. Weekly & Monthly RAG */}
          <section id="weekly-monthly-rag">
            <h2>3. Weekly &amp; Monthly RAG</h2>
            <p className="intent">How project, account and program colors roll up.</p>

            <div className="faq" id="q5">
              <div className="q"><span className="num">Q5</span>How is weekly project RAG derived?</div>
              <div className="a">
                <p>
                  <strong>Updated</strong> — this used to be worst-case: any single Amber day among an
                  otherwise all-Green week pushed the whole week to Amber. It's now a proportional
                  average, so one off day doesn't taint an otherwise healthy week, while a sustained
                  pattern still shows.
                </p>
                <p>Each day's health scores 0 (Green) / 1 (Amber) / 2 (Red); Unknown days are excluded
                  from both the sum and the day count. Average the scorable days:</p>
                <div className="formula">avg &lt; 0.35 → Green &nbsp;|&nbsp; avg &lt; 1.2 → Amber &nbsp;|&nbsp; avg ≥ 1.2 → Red</div>
                <p>
                  One safety rule is kept from the old logic: if a <strong>strict majority</strong> of
                  the week's days are Red, the week is Red regardless of what the average says —
                  sustained severe badness can't be diluted away by a longer run of Green days.
                </p>
                <div className="example">
                  <span className="label">Example</span>
                  4 Green days + 1 Amber day → avg = 0.20 → <strong>Green</strong> (previously this was
                  Amber). 2 Amber days out of 5 → avg = 0.40 → <strong>Amber</strong> — a genuine pattern
                  still surfaces.
                </div>
                <p>
                  The AI summary describes <em>why</em> the week looks the way it does; the color itself
                  is deterministic — the AI's own suggested status is logged when it disagrees, but
                  never used.
                </p>
              </div>
            </div>

            <div className="faq" id="q6">
              <div className="q"><span className="num">Q6</span>How is account-level weekly RAG derived?</div>
              <div className="a">
                <p>
                  <strong>Updated</strong> — the Red rule hasn't changed; the Amber rule used to be "any
                  project Red or Amber" (a single Amber project out of fifteen was enough to make the
                  whole account Amber). It now uses <code>Account.amberThresholdPercentage</code> — a
                  real, admin-configurable field that existed before this change but was never actually
                  read by this rollup.
                </p>
                <div className="formula">redPct = redCount / activeProjects × 100 &nbsp;&nbsp;|&nbsp;&nbsp; badPct = (redCount + amberCount) / activeProjects × 100</div>
                <ul>
                  <li><span className="dot red"></span><strong>Red</strong> if <code>redPct ≥ redThreshold</code> (default 30%, configurable per account) — unchanged.</li>
                  <li><span className="dot amber"></span><strong>Amber</strong> if <code>badPct ≥ amberThreshold</code> (default 20%, configurable per account) but the Red threshold isn't met.</li>
                  <li><span className="dot green"></span><strong>Green</strong> otherwise.</li>
                </ul>
                <p>"Unknown" projects are excluded from every count and percentage. If every project is
                  Unknown, the account is Unknown too — not Green.</p>
                <div className="example">
                  <span className="label">Example</span>
                  Account with 15 active projects, redThreshold 40%, amberThreshold 30%: 0 Red / 8 Amber
                  / 7 Green → redPct = 0%, badPct = 53% ≥ 30% → <strong>Amber</strong>.
                </div>
                <div className="example">
                  <span className="label">Example</span>
                  Same account, but only 1 of 15 projects is Amber: badPct = 7% &lt; 30% →{' '}
                  <strong>Green</strong> — a single Amber project no longer taints the account.
                </div>
                <p>
                  The account's AI-written summary can no longer set this color in either direction —
                  it used to be blocked only from reporting a <em>healthier</em> state than the data
                  showed, but could still report a worse one. Now the color is fully deterministic at
                  every level; AI disagreement is logged for visibility, never applied.
                  <code>red_projects</code> on the report is likewise computed from the same project
                  statuses, not written by the AI.
                </p>
              </div>
            </div>

            <div className="faq" id="q7">
              <div className="q"><span className="num">Q7</span>How is program daily RAG derived?</div>
              <div className="a">
                <p>
                  Same rule as account-level weekly (Q6) — redPct against the program's Red threshold,
                  badPct against its Amber threshold — applied across the projects in the program.
                  Programs don't have their own Amber threshold field, so it falls back to the parent
                  account's <code>amberThresholdPercentage</code> (Red threshold already worked this
                  way: program's own value if set, else the account's, else 30%).
                </p>
              </div>
            </div>

            <div className="faq" id="q8">
              <div className="q"><span className="num">Q8</span>How is monthly health derived?</div>
              <div className="a">
                <p>
                  <strong>Updated</strong> — monthly status used to be written straight from the AI's
                  narrative with no deterministic check at all, unlike every other level. It's now
                  computed the same way weekly project status is (Q5): each week in the month scores
                  0/1/2, averaged, banded at the same 0.35 / 1.2 thresholds. Monthly account health
                  rolls up the month's project statuses the same way account-weekly does (Q6). The AI
                  still writes the narrative; it no longer decides the color at any level, project or
                  account, daily through monthly.
                </p>
              </div>
            </div>
          </section>

          {/* 4. Team Performance */}
          <section id="team-scores">
            <h2>4. Team Performance Scores</h2>
            <p className="intent">How individual scores are computed for developers and QAs.</p>

            <div className="faq" id="q9">
              <div className="q"><span className="num">Q9</span><span className="tag">Dev</span>How is a developer's Execution Score calculated?</div>
              <div className="a">
                <div className="formula">
                  Delivery % = (SP Done / SP Planned) × 100<br />
                  Rework % = (SP Rework / SP Planned) × 100<br />
                  Execution Score = Delivery % × 0.8 + (100 − Rework %) × 0.2
                </div>
                <p>Higher is better; range 0–100.</p>
                <div className="example">
                  <span className="label">Example</span>
                  Planned 40 SP, delivered 36 SP, reworked 2 SP →
                  Delivery 90%, Rework 5% → (90 × 0.8) + (95 × 0.2) =
                  72 + 19 = <strong>91.0</strong>.
                </div>
              </div>
            </div>

            <div className="faq" id="q10">
              <div className="q"><span className="num">Q10</span><span className="tag">QA</span>How is a QA's Quality Rate calculated?</div>
              <div className="a">
                <div className="formula">
                  UAT Pass Rate = 1 − (Failed SP / Cleared SP)<br />
                  In-Sprint Catch Rate = In-Sprint Bugs / Total Bugs Raised<br />
                  Composite = (0.7 × UAT Pass Rate) + (0.3 × In-Sprint Catch Rate)<br />
                  Quality Rate = (1 − Composite) × 100
                </div>
                <p>
                  Lower is better — it's a "risk" score (% of escapes / late
                  catches). Returns <code>−1</code> if the QA tested fewer than
                  5 tickets in the period (insufficient signal).
                </p>
                <div className="example">
                  <span className="label">Example</span>
                  UAT Pass Rate = 0.95, In-Sprint Catch = 0.80 →
                  Composite = (0.7 × 0.95) + (0.3 × 0.80) = 0.905 →
                  Quality Rate = (1 − 0.905) × 100 = <strong>9.5</strong>.
                </div>
              </div>
            </div>

            <div className="faq" id="q11">
              <div className="q"><span className="num">Q11</span>What is Reopen Rate %?</div>
              <div className="a">
                <div className="formula">Reopen Rate % = (Reopened Tickets / Total Tickets) × 100</div>
                <div className="example">
                  <span className="label">Example</span>
                  2 of 25 in-scope tickets reopened → <strong>8.0%</strong>.
                </div>
                <p>
                  <strong>What counts as a &ldquo;reopen&rdquo;:</strong> a ticket whose
                  status moves from a <strong>QA / UAT / Done</strong> lane back to a
                  <strong>Dev / In-Progress</strong> lane during the sprint &mdash;
                  no matter what statuses it passes through on the way back
                  (Blocked, Backlog, or a project-specific Reopened lane such as
                  &ldquo;Issues Found&rdquo; are all transparent). It is read from the
                  ticket&rsquo;s own status history; a logged sub-bug that pushed its
                  parent back to dev also counts (whichever applies).
                </p>
                <p>
                  <strong>Scope:</strong> the ratio counts <strong>Stories and standalone
                    Bugs</strong> (plus Tech Debt / Tasks). <strong>Sub-bugs are excluded</strong>
                  &mdash; a sub-bug is the evidence of a parent story&rsquo;s reopen, not a
                  separate reopened item, so counting it would double-count.
                </p>
                <p>
                  <strong>Excluded reopens (labels):</strong> when a ticket carries any of
                  <code>Invalid-Reopen</code>, <code>Bad-Data</code> or
                  <code>Scope-Change</code>, each label
                  subtracts ONE reopen event. Case and separators are normalised, so
                  <code>BadData</code>, <code>bad_data</code> and <code>Bad Data</code> all
                  match &mdash; but a <em>longer</em> label that merely starts with one of
                  them does not: <code>Scope-Change-Approved</code> never excludes a reopen.
                  Multi-reopen tickets retain the un-labeled
                  events — a ticket with 2 reopen events + 1 exclusion label still
                  counts as reopened. These rules take effect only after a full sprint
                  re-sync (the Recompute endpoint does NOT re-fetch labels).
                </p>
              </div>
            </div>
          </section>

          {/* 5. Sprint Metrics */}
          <section id="sprint-metrics">
            <h2>5. Sprint Metrics</h2>
            <p className="intent">Capacity, Productivity, Carryover and Scope Creep numbers used across the Team Performance Report and the Delivery Presentation drill-down.</p>

            <div className="faq" id="q12">
              <div className="q"><span className="num">Q12</span>How are Capacity, Planned and Actual computed?</div>
              <div className="a">
                <ul>
                  <li><strong>Capacity</strong> = ROUND(Planned SP) — integer, no decimals.</li>
                  <li><strong>Planned</strong> = sum of SP planned across all team members (1 decimal).</li>
                  <li><strong>Actual</strong> = sum of SP delivered across all team members (1 decimal).</li>
                </ul>
                <div className="example">
                  <span className="label">Example</span>
                  Team plans 40.8 SP, delivers 36.2 SP → Capacity = 41,
                  Planned = 40.8, Actual = 36.2.
                </div>
              </div>
            </div>

            <div className="faq" id="q13">
              <div className="q"><span className="num">Q13</span>What's the Productivity % formula?</div>
              <div className="a">
                <p><strong>Sprint / Scrum projects</strong> — productivity is measured against the committed sprint scope:</p>
                <div className="formula">Productivity % = (Actual SP / Planned SP) × 100</div>
                <div className="example">
                  <span className="label">Example</span>
                  36 SP delivered ÷ 40 SP planned = <strong>90.0%</strong>.
                </div>
                <p style={{ marginTop: 12 }}>
                  <strong>Kanban projects</strong> have <strong>no commitment / planned target</strong> — work flows continuously, so there is no
                  &quot;Planned SP&quot; to divide by. Instead, productivity is reported as <strong>throughput</strong>: the story points
                  the team actually <strong>completed within the span</strong> (the configured work-cycle window, e.g. one week).
                </p>
                <div className="formula">Kanban Productivity = SP completed in the span (throughput, not a %)</div>
                <div className="example">
                  <span className="label">Example</span>
                  In the week of Jun 2–8 the team moved 4 tickets to Done totalling
                  <strong> 11 SP</strong> → throughput = <strong>11 SP</strong> for that span. A Kanban span is
                  judged by comparing this number to the team&apos;s own recent average (see <a href="#q16">Q16</a>),
                  not against a target. Kanban rows in the Trends → Productivity tab are labelled with a
                  <strong> &ldquo;Kanban&rdquo;</strong> tag and show <strong>&ldquo;N SP&rdquo;</strong> rather than a percentage.
                </div>
              </div>
            </div>

            <div className="faq" id="q14">
              <div className="q"><span className="num">Q14</span>What is Carryover % (a.k.a. Spillover %)?</div>
              <div className="a">
                <div className="formula">Carryover % = (Spillover SP / Planned SP) × 100</div>
                <p>Spillover SP = story points carried over from the previous sprint.</p>
                <div className="example">
                  <span className="label">Example</span>
                  4 SP carried over ÷ 40 SP planned = <strong>10.0%</strong>.
                </div>
              </div>
            </div>

            <div className="faq" id="q15">
              <div className="q"><span className="num">Q15</span>What is Scope Creep %?</div>
              <div className="a">
                <div className="formula">Scope Creep % = (Scope Added SP / Planned SP) × 100</div>
                <div className="example">
                  <span className="label">Example</span>
                  5 SP added mid-sprint ÷ 40 SP planned = <strong>12.5%</strong>.
                </div>
              </div>
            </div>
          </section>

          {/* 6. Trend Charts */}
          <section id="trends">
            <h2>6. Trend Charts</h2>
            <p className="intent">How the multi-sprint trend lines and bars are computed.</p>

            <div className="faq" id="q16">
              <div className="q"><span className="num">Q16</span>How is the Productivity trend computed?</div>
              <div className="a">
                <div className="formula">
                  Trend % = ((Current − Avg of prior N sprints/spans) / Avg) × 100<br />
                  Direction: up if Trend % &gt; +5, down if &lt; −5, else neutral
                </div>
                <p>The trend direction is computed the same way for both project types (current vs. the average of prior periods). The <strong>health band differs</strong> because Kanban has no fixed target:</p>
                <p><strong>Sprint / Scrum</strong> — health band on the latest sprint's productivity %:</p>
                <ul>
                  <li><span className="dot green"></span><strong>Green</strong> ≥ 80%</li>
                  <li><span className="dot amber"></span><strong>Amber</strong> 60–79%</li>
                  <li><span className="dot red"></span><strong>Red</strong> &lt; 60%</li>
                </ul>
                <p><strong>Kanban</strong> — health compares the latest span's throughput (SP completed) to the project&apos;s own rolling average of prior spans (no fixed % target):</p>
                <ul>
                  <li><span className="dot green"></span><strong>Green</strong> — at or above the average (current ≥ avg)</li>
                  <li><span className="dot amber"></span><strong>Amber</strong> — within 30% below the average (≥ 70% of avg)</li>
                  <li><span className="dot red"></span><strong>Red</strong> — more than 30% below the average</li>
                </ul>
                <div className="example">
                  <span className="label">Example (Sprint)</span>
                  Current sprint 90%, prior-3 average 75% → Trend = +20%
                  → <strong>Up, Green</strong>.
                </div>
                <div className="example">
                  <span className="label">Example (Kanban)</span>
                  Latest span 139 SP, prior-4 span average 110 SP → Trend = +26%
                  → <strong>Up</strong>; 139 ≥ 110 → <strong>Green</strong>.
                </div>
              </div>
            </div>

            <div className="faq" id="q17">
              <div className="q"><span className="num">Q17</span>What is Defect Density?</div>
              <div className="a">
                <div className="formula">Defect Density = (Bugs Raised / Story Points Delivered) × 100</div>
                <div className="example">
                  <span className="label">Example</span>
                  5 bugs raised against 40 SP delivered = <strong>12.5%</strong>.
                </div>
              </div>
            </div>

            <div className="faq" id="q18">
              <div className="q"><span className="num">Q18</span>What is Defect Leakage %?</div>
              <div className="a">
                <div className="formula">Defect Leakage % = (Production Bugs Escaped / Total Bugs Raised) × 100</div>
                <p>"Production escaped" means bugs found after release; "raised" includes both in-sprint and post-release.</p>
                <div className="example">
                  <span className="label">Example</span>
                  1 production bug escaped out of 8 total bugs raised
                  = <strong>12.5%</strong>.
                </div>
              </div>
            </div>

            <div className="faq" id="q19">
              <div className="q"><span className="num">Q19</span>How are Rework and Carryover trends tracked?</div>
              <div className="a">
                <p>
                  Each sprint stores its own Rework SP and Spillover SP. The trend
                  chart simply plots those values per sprint over time — no separate
                  score, no smoothing.
                </p>
              </div>
            </div>

            <div className="faq" id="q20">
              <div className="q"><span className="num">Q20</span>What does the Bug Classification stacked bar show?</div>
              <div className="a">
                <p>
                  Bugs raised per sprint, split by category (e.g. functional,
                  regression, UAT, production). Each category is a colored stack;
                  the total bar height = total bugs that sprint.
                </p>
              </div>
            </div>
          </section>

          {/* 7. Action Items */}
          <section id="action-items">
            <h2>7. Action Items</h2>
            <p className="intent">Lifecycle and access rules for project-level action items.</p>

            <div className="faq" id="q21">
              <div className="q"><span className="num">Q21</span>What is the lifecycle of an action item?</div>
              <div className="a">
                <div className="formula">Open  →  In-Progress  →  Closed / Discarded</div>
                <p>
                  <strong>Reverse transitions are not allowed.</strong> Once an item
                  is Closed or Discarded, it stays terminal. Each transition writes
                  an entry to the status history.
                </p>
              </div>
            </div>

            <div className="faq" id="q22">
              <div className="q"><span className="num">Q22</span>Who can create, edit and close items?</div>
              <div className="a">
                <ul>
                  <li><strong>Create</strong>: any authenticated user.</li>
                  <li><strong>Edit</strong>: superuser/admin can edit any item; lead can edit only items they created.</li>
                  <li><strong>Close / Discard</strong>: requires a comment note (audit trail).</li>
                </ul>
              </div>
            </div>

            <div className="faq" id="q23">
              <div className="q"><span className="num">Q23</span>How does action-item carryover between sprints work?</div>
              <div className="a">
                <p>
                  When you link an open action item to the next sprint review
                  meeting, it is flagged <code>isCarryover</code> automatically.
                  Linking the same item twice is a no-op (de-duped). Carryover
                  items show visibly on the next Delivery Presentation deck.
                </p>
              </div>
            </div>

            <div className="faq" id="q24">
              <div className="q"><span className="num">Q24</span>Are items auto-closed or auto-escalated?</div>
              <div className="a">
                <p>
                  No. Status changes are always manual. Owners and managers are
                  expected to update items as part of their regular review cadence.
                </p>
              </div>
            </div>

            <div className="faq" id="q24a">
              <div className="q"><span className="num">Q24a</span>Can I edit or delete a comment on an action item?</div>
              <div className="a">
                <p>
                  You can edit a comment, but only under two rules (the same
                  rules apply to project, account and program action items, and
                  to <a href="#q30a">risk comments</a>):
                </p>
                <ul>
                  <li><strong>Author-only</strong> &mdash; you can edit only your own comment. There is no superuser override.</li>
                  <li><strong>Latest-only</strong> &mdash; a comment is editable only while it is the newest one in its thread. Once someone adds a follow-up, earlier comments lock.</li>
                </ul>
                <p>
                  An edited comment shows an <strong>&ldquo;(edited)&rdquo;</strong>
                  indicator. These rules keep the thread an honest audit trail
                  &mdash; you can fix your own last comment, but not rewrite
                  history once the conversation has moved on.
                </p>
              </div>
            </div>
          </section>

          {/* 8. Risk Board */}
          <section id="risk-board">
            <h2>8. Risk Board</h2>
            <p className="intent">Lane meaning, priority colors and access rules for the Kanban risk board.</p>

            <div className="faq" id="q25">
              <div className="q"><span className="num">Q25</span>What do the lanes mean?</div>
              <div className="a">
                <ul>
                  <li><strong>NEW</strong> — just raised, not yet picked up.</li>
                  <li><strong>WORK_IN_PROGRESS</strong> — actively being mitigated.</li>
                  <li><strong>STALE</strong> — manually marked as stale (no automatic timer).</li>
                  <li><strong>DONE</strong> — resolved; hidden from the board by default.</li>
                </ul>
              </div>
            </div>

            <div className="faq" id="q26">
              <div className="q"><span className="num">Q26</span>What do the priority colors mean?</div>
              <div className="a">
                <table>
                  <thead><tr><th>Priority</th><th>Color</th></tr></thead>
                  <tbody>
                    <tr><td>CRITICAL</td><td>Red</td></tr>
                    <tr><td>HIGH</td><td>Orange</td></tr>
                    <tr><td>MEDIUM</td><td>Yellow</td></tr>
                    <tr><td>LOW</td><td>Green</td></tr>
                    <tr><td>(any priority, DONE lane)</td><td>Grey</td></tr>
                  </tbody>
                </table>
              </div>
            </div>

            <div className="faq" id="q27">
              <div className="q"><span className="num">Q27</span>Who can be assigned a risk?</div>
              <div className="a">
                <p>
                  Only superusers can be assignees. The server validates this on
                  every save — assigning a non-superuser is rejected.
                </p>
              </div>
            </div>

            <div className="faq" id="q28">
              <div className="q"><span className="num">Q28</span>Why is a comment required when I move a card?</div>
              <div className="a">
                <p>
                  Every status transition (drag-drop) opens a comment dialog. The
                  transition + comment commit together so the audit trail always
                  records <em>why</em> a risk moved, not just <em>that</em> it moved.
                </p>
              </div>
            </div>

            <div className="faq" id="q29">
              <div className="q"><span className="num">Q29</span>Who can mark a risk as DONE?</div>
              <div className="a">
                <p>
                  Edit-permitted users only — superuser, admin, or the manager who
                  created it. <strong>Leads cannot close risks</strong>, even those
                  they created themselves. (They can comment and move between active
                  lanes.)
                </p>
              </div>
            </div>

            <div className="faq" id="q30">
              <div className="q"><span className="num">Q30</span>What does the AI summary banner show?</div>
              <div className="a">
                <p>
                  A Claude-generated summary of the risk's description, mitigation
                  plan and recent comments — useful for picking up context fast
                  without reading every comment. Refreshes after status changes.
                </p>
              </div>
            </div>

            <div className="faq" id="q30a">
              <div className="q"><span className="num">Q30a</span>Can I edit a risk comment?</div>
              <div className="a">
                <p>
                  Yes, with the same two guardrails used across the app
                  (see <a href="#q24a">Q24a</a>):
                </p>
                <ul>
                  <li><strong>Author-only</strong> &mdash; only the person who wrote the comment can edit it; not even a superuser can edit someone else's.</li>
                  <li><strong>Latest-only</strong> &mdash; editable only while it is the newest comment on the risk. Once a newer comment exists, it locks.</li>
                </ul>
                <p>
                  An edit stamps <code>editedAt</code> (shown as
                  &ldquo;(edited)&rdquo;) and refreshes the risk's AI summary in
                  the background.
                </p>
              </div>
            </div>
          </section>

          {/* 9. Executive Summary */}
          <section id="executive-summary">
            <h2>9. Executive Summary &amp; AI</h2>
            <p className="intent">How the AI-written narratives are produced and what they can / can't override.</p>

            <div className="faq" id="q31">
              <div className="q"><span className="num">Q31</span>How is the daily executive summary written?</div>
              <div className="a">
                <p>The AI is given:</p>
                <ul>
                  <li>Active, blocked and stale tickets (with status, assignee, priority).</li>
                  <li>The previous day's snapshot for continuity.</li>
                  <li>The deterministic health rationale (the three-axis breakdown).</li>
                  <li>Manager insights (if any).</li>
                  <li>Production bug keys, spillover flags, and sprint burndown metrics.</li>
                </ul>
                <p>
                  It then drafts the narrative. The deterministic health is then
                  re-applied on top — <strong>the AI cannot make a project look
                    healthier than the data shows</strong>.
                </p>
                <p>
                  The prompt explicitly forbids ticket IDs and verbatim ticket
                  titles in the executive summary, so the narrative reads as
                  stakeholder-facing prose rather than a Jira dump.
                </p>
              </div>
            </div>

            <div className="faq" id="q32">
              <div className="q"><span className="num">Q32</span>Can the AI override the calculated RAG color?</div>
              <div className="a">
                <p>
                  No. After every AI generation we re-check the deterministic color
                  (daily three-axis, account redPct, etc.). If the AI suggested a
                  healthier color, the deterministic value wins and a warning is
                  logged. The AI <em>can</em> add a softer narrative tone, but the
                  chip color is locked to the data.
                </p>
              </div>
            </div>

            <div className="faq" id="q33">
              <div className="q"><span className="num">Q33</span>Can manager insights make a project look better?</div>
              <div className="a">
                <p>
                  No — only worse. Insights can escalate Green → Amber or Amber → Red
                  but never the other way. This prevents masking algorithmic
                  warnings via human commentary while still allowing managers to
                  flag context the algorithm doesn't see (e.g. a client escalation).
                </p>
              </div>
            </div>
          </section>

          {/* 10. Portfolio Presentation */}
          <section id="portfolio-presentation">
            <h2>10. Portfolio Presentation</h2>
            <p className="intent">How a Portfolio (Delivery) Presentation is generated, and what it does with multi-sprint, tailing or in-flight windows.</p>

            <div className="faq" id="q34">
              <div className="q"><span className="num">Q34</span>How do I generate a Portfolio Presentation?</div>
              <div className="a">
                <p>
                  <strong>Who can see it:</strong> Superuser, Admin, Manager,
                  Lead. Manager and Lead see only presentations that include at
                  least one project they have access to; Member role does not
                  see the menu. Delete is restricted to the creator (plus
                  Superuser / Admin bypass).
                </p>
                <p>
                  Open the Portfolio Presentations list and click <strong>New
                    Delivery Presentation</strong> (or <strong>Edit</strong> on
                  an existing one). A 4-step dialog opens; each step has
                  validation, and the data is fetched from the backend once
                  Step 0 is completed.
                </p>
                <table>
                  <thead><tr><th>Step</th><th>Fields</th><th>Notes</th></tr></thead>
                  <tbody>
                    <tr>
                      <td><strong>0. Basics &amp; Scope</strong></td>
                      <td>Title, Meeting Date, <strong>Start Date / End Date</strong>, Health (G/A/R), Projects in Scope</td>
                      <td>Title, Start and End dates are required. Projects in Scope toggles between <em>Account mode</em> (checkbox grid, all on by default) and <em>Program mode</em> (pick one program, its projects are auto-selected). Clicking <strong>Next (pull data)</strong> fetches sprints, metrics, risks and action items for the window.</td>
                    </tr>
                    <tr>
                      <td><strong>1. Highlights &amp; Risks</strong></td>
                      <td>Executive Summary, Achievements, Blockers, Capacity Notes, Risks table (Project / Title / Priority / Status)</td>
                      <td>Auto-populated from the preview pull. Everything is editable. Executive Summary is regenerated if you change the date window.</td>
                    </tr>
                    <tr>
                      <td><strong>2. Action Items &amp; Tech</strong></td>
                      <td>Action Items table (Scope / Project / Title / Owner / Status / Due Date), Tech Recommendations, Additional Discussion Points</td>
                      <td>Lists pre-fill from open project + account action items. Add or remove rows freely. (The &ldquo;Discussion Points&rdquo; field was renamed to &ldquo;Additional Discussion Points&rdquo; — the data key is unchanged.)</td>
                    </tr>
                    <tr>
                      <td><strong>3. Per-Project Drilldown</strong></td>
                      <td>For each project: Health Override (Auto / G / A / R), Show in Presentation, Narrative, Sprint Metrics</td>
                      <td>
                        Sprint Metrics differ by project type — Scrum: Capacity / Planned / Actual / Rework % / Carryover %; Kanban: Tickets Completed / Avg Active / Max Blocked / Weeks Covered. Use <strong>Refresh</strong> at the top of Step 3 to re-pull data without changing the window.
                        <br /><br />
                        The drill-down slide also includes an <strong>Individual Performance Trends</strong> section per project — three sparkline panels (Developer Velocity, Reopen Ratio, Carryover Ratio). Each panel has a small info-icon explaining the formula on hover. See <a href="#q11">Q11</a> and <a href="#q14">Q14</a> for the underlying rules.
                      </td>
                    </tr>
                  </tbody>
                </table>
                <p>
                  Save publishes the presentation; from the list view you can
                  Edit, Preview, or Download as PDF.
                </p>
              </div>
            </div>

            <div className="faq" id="q34a">
              <div className="q"><span className="num">Q34a</span>What is Presentation Mode?</div>
              <div className="a">
                <p>
                  The Delivery Presentation list has a <strong>Presentation mode</strong>
                  icon (slideshow icon, to the left of the View eye icon)
                  alongside the existing View / Edit / Download actions.
                  Clicking it opens the same presentation with all editor
                  chrome hidden so it looks finished during a customer demo.
                </p>
                <ul>
                  <li><strong>Hidden in Presentation mode:</strong> Edit, Open MOM, Manage Trend Sprints, Download PDF.</li>
                  <li><strong>Still visible:</strong> Back button, title / dates / health chip, Project visibility filter.</li>
                </ul>
                <p>
                  Use <strong>Presentation mode</strong> during a customer demo
                  so the deck looks finished; use <strong>View</strong> for
                  internal review (where MOM upload and edits matter).
                </p>
              </div>
            </div>

            <div className="faq" id="q34b">
              <div className="q"><span className="num">Q34b</span>How does the MOM (Minutes of Meeting) workflow work?</div>
              <div className="a">
                <p>
                  The MOM workflow lets you attach meeting notes to the
                  presentation after the customer review:
                </p>
                <ol>
                  <li>From a saved presentation, click <strong>Open MOM</strong> to launch the MOM dialog.</li>
                  <li>Paste or type the raw meeting transcript.</li>
                  <li>Click <strong>Generate MOM</strong> &mdash; AI polishes language and formatting only; it does NOT infer new content or summarise beyond what you typed.</li>
                  <li>Review the polished draft inline. While unaccepted, the list-view status chip reads <strong>MOM draft</strong>.</li>
                  <li>Click <strong>Accept &amp; Lock</strong> to freeze the MOM and the whole presentation (<code>momStatus = accepted</code>, <code>lockedAt</code> set). The list-view chip now reads <strong>Locked</strong> &mdash; Edit and Manage Trend Sprints are disabled for everyone.</li>
                </ol>
                <p>
                  Locking is irreversible from the UI. In the PDF, MOM is
                  appended on a forced new page (see <a href="#q37">Q37</a>).
                </p>
              </div>
            </div>

            <div className="faq" id="q34c">
              <div className="q"><span className="num">Q34c</span>How does the per-project Health Override work?</div>
              <div className="a">
                <p>
                  Each project drilldown shows a <strong>Health</strong> dropdown
                  (Step 3 of the edit dialog and on the live drilldown slide).
                  The default is <strong>Auto: &lt;G/A/R&gt;</strong> where
                  <code>&lt;G/A/R&gt;</code> is the computed health for that
                  project's window. You can override it to a fixed Green / Amber
                  / Red.
                </p>
                <ul>
                  <li><strong>Auto</strong> &mdash; uses computed health from the perf data window. Re-evaluates on Refresh.</li>
                  <li><strong>Green / Amber / Red</strong> &mdash; frozen value. Refresh does NOT change it; only an explicit dropdown change does.</li>
                </ul>
                <p>
                  The overall presentation Health chip (top of the deck) is the
                  manager-set Health from Step 0 &mdash; separate from per-project
                  overrides. Use per-project overrides when the manager wants to
                  surface context the data alone can't see (e.g. a client
                  escalation the metrics haven't caught yet).
                </p>
              </div>
            </div>

            <div className="faq" id="q34d">
              <div className="q"><span className="num">Q34d</span>What does Refresh re-pull, and what stays frozen?</div>
              <div className="a">
                <p>
                  The <strong>Refresh</strong> button (top of Step 3 in the
                  editor, plus a small refresh icon on the saved view) re-pulls
                  live data from the system. It refreshes:
                </p>
                <ul>
                  <li>Sprint metrics (Capacity / Planned / Actual / Rework / Carryover for Scrum; Tickets Completed / Avg Active / Max Blocked / Weeks Covered for Kanban).</li>
                  <li>Risks pulled from project risk boards.</li>
                  <li>Action items pre-fill list.</li>
                  <li><strong>Executive Summary</strong> &mdash; regenerated by AI. Any manual edit to the summary is overwritten; the Refresh button warns you before running.</li>
                  <li>Per-developer trends data (<code>developerVelocity</code>, <code>developerTrends</code>).</li>
                  <li>Live Status / in-flight sprint card.</li>
                </ul>
                <p>It does NOT touch:</p>
                <ul>
                  <li>Per-project narrative (manual prose you typed).</li>
                  <li>Per-project Health Override (see <a href="#q34c">Q34c</a>).</li>
                  <li>Per-project visibility toggles (see <a href="#q34e">Q34e</a>).</li>
                  <li>Tech Recommendations and Additional Discussion Points.</li>
                  <li>MOM content and lock state.</li>
                  <li><strong>Jira labels on a closed sprint</strong> &mdash; these are only re-pulled by a full sprint re-sync, not by Refresh. See <a href="#q38a">Q38a</a> for why this matters to Reopen Ratio.</li>
                </ul>
                <p>
                  Practical rule: prose and overrides are frozen at save;
                  numbers and AI-generated text are re-pullable.
                </p>
              </div>
            </div>

            <div className="faq" id="q34e">
              <div className="q"><span className="num">Q34e</span>What does the project visibility toggle do?</div>
              <div className="a">
                <p>
                  On a saved presentation, an eye-icon button at the top toggles
                  individual projects ON or OFF for the current viewing session.
                  Use it during a live demo to focus on a subset of projects
                  without editing the saved data.
                </p>
                <ul>
                  <li>Hiding a project removes its Drill-down slide, its row in the Projects Overview table, and its row in the Trends charts.</li>
                  <li>The toggle does NOT delete data or modify the saved presentation &mdash; it's a render-time filter.</li>
                  <li>When you Download PDF with one or more projects hidden, the PDF respects the toggle (hidden projects are excluded from the exported deck).</li>
                  <li>Reload / re-open the presentation and the toggle resets to &ldquo;all visible&rdquo;.</li>
                </ul>
                <p>
                  This is the right tool for &ldquo;I only want to show project A
                  and C to this customer&rdquo; without forking the deck.
                </p>
              </div>
            </div>

            <div className="faq" id="q34f">
              <div className="q"><span className="num">Q34f</span>What does Manage Trend Sprints do?</div>
              <div className="a">
                <p>
                  The <strong>Manage Trend Sprints</strong> button (tune icon,
                  top of a saved presentation) opens a dialog showing the last
                  five sprint syncs feeding the per-developer sparklines and
                  the trend charts for each project.
                </p>
                <ul>
                  <li><strong>Delete one sprint</strong> &mdash; removes that sprint sync (<code>PerfSprintSync</code> row) from the trend window. Use when a sprint was synced incorrectly and you want to exclude it from the trends without re-syncing.</li>
                  <li><strong>Refresh from system</strong> &mdash; bulk action that re-pulls the trend window from the latest perf data for every project in the presentation.</li>
                </ul>
                <p>
                  Deletions here propagate to Team Performance &rarr; Trends as
                  well, because the same <code>PerfSprintSync</code> rows feed
                  both. Treat deletions as destructive &mdash; they are not just
                  a presentation-local hide. The button is hidden when the
                  presentation is <strong>Locked</strong> (post-MOM-accept).
                </p>
              </div>
            </div>

            <div className="faq" id="q34g">
              <div className="q"><span className="num">Q34g</span>What are graph notes, reduced-capacity flags, and the Team Capacity table?</div>
              <div className="a">
                <p>
                  These are three <strong>presentation-only</strong> authoring
                  controls (Step 4 of the editor). They annotate the deck for
                  the audience without changing any underlying Jira / perf data,
                  so a Refresh never overwrites them.
                </p>
                <ul>
                  <li><strong>Graph notes</strong> &mdash; a free-text note attached to any trend chart, rendered under that chart on the slide and in the PDF. Use it to explain a dip or spike in context (e.g. &ldquo;6.1 reduced capacity &mdash; two devs on leave&rdquo;).</li>
                  <li><strong>Reduced-capacity flags</strong> &mdash; mark specific sprints as reduced-capacity so they are <strong>excluded from the Velocity Trend average line</strong>. Leave isn't tracked automatically, so the presenter sets these manually; each flag can carry a short reason that annotates the chart.</li>
                  <li><strong>Team Capacity table</strong> &mdash; an optional slide (hidden by default; enable it from the graphs list). When enabled it is <strong>pre-seeded from the presentation's V2 members</strong> (name + delivered SP); you then fill in planned / unplanned leaves per member, and can add free-text rows for anyone not on a project.</li>
                </ul>
                <div className="example">
                  <span className="label">Example</span>
                  Sprint 6.1 delivered 22 SP vs a team average of 40. Flag 6.1 as
                  reduced-capacity so the Velocity average line stays honest, and
                  add a graph note &ldquo;6.1 &mdash; 2 devs on planned leave&rdquo;
                  so the customer sees why.
                </div>
              </div>
            </div>

            <div className="faq" id="q34h">
              <div className="q"><span className="num">Q34h</span>Can I share a presentation with a direct link?</div>
              <div className="a">
                <p>
                  Yes. From the Delivery Presentation list, the row menu has a
                  <strong> Copy share link</strong> action that copies a direct
                  URL of the form <code>/presentations/delivery/&lt;id&gt;</code>.
                </p>
                <ul>
                  <li>The link opens the presentation in clean <a href="#q34a">Presentation mode</a>.</li>
                  <li>It requires <strong>sign-in</strong> &mdash; anyone who opens it while logged out is sent to Login and returned to the deck afterwards.</li>
                  <li>Access is still enforced by the API: if the recipient doesn't have access to any project in the presentation, they see a <strong>404 / no-access</strong> page rather than the deck.</li>
                </ul>
                <p>
                  Use it to send a specific deck straight to a colleague instead
                  of asking them to find it in the list.
                </p>
              </div>
            </div>

            <div className="faq" id="q35">
              <div className="q"><span className="num">Q35</span>What happens when the date window contains multiple sprints, a sprint that crosses the boundary, or an in-flight sprint?</div>
              <div className="a">
                <ul>
                  <li><strong>Multiple closed sprints in the window:</strong> all are included. The Drilldown slide for that project shows a <strong>per-sprint team table</strong> (one row per sprint per member) instead of one combined table; the trend chips (Productivity, Defect Density, etc.) average across the included sprints.</li>
                  <li><strong>Sprint that started before the window but ended inside:</strong> included — selection is by <em>end date</em>, not start.</li>
                  <li><strong>"Tailing" sprint that started inside the window but ends after it:</strong> excluded from metrics — only sprints that <em>completed</em> inside the window count. It still appears in the <a href="#q36">Live Status card</a> if it is currently active.</li>
                  <li><strong>In-flight (currently open) sprint:</strong> does NOT contribute to the historical metrics. It is shown only in the Live Status card.</li>
                </ul>
                <div className="example">
                  <span className="label">Example</span>
                  Window: 2026-01-01 → 2026-03-31. Project has sprints
                  <code>4.5</code> (12/15 → 1/2, ends inside), <code>5.1</code>
                  (1/3 → 1/16), <code>5.2</code> (1/17 → 1/30),
                  <code>5.3</code> (1/31 → 2/13), and <code>5.4</code>
                  (currently in-flight, 3/28 → 4/10). The metrics chips and
                  Drilldown table aggregate 4.5–5.3. 5.4 only appears in the
                  Live Status card.
                </div>
              </div>
            </div>

            <div className="faq" id="q36">
              <div className="q"><span className="num">Q36</span>How is the Live Status (in-flight) card built?</div>
              <div className="a">
                <p>
                  The card has three data paths depending on what is available
                  for the project at presentation time:
                </p>
                <ol>
                  <li><strong>Scrum, perf row available</strong> — uses the latest <code>PerfSprintSync</code> for SP totals, enriched with snapshot lane counts plus reopened and sub-bug counts from the daily snapshot.</li>
                  <li><strong>Scrum, no perf row but daily snapshot has in-flight burndown</strong> — falls back to building from the snapshot alone. SP comes from <code>sprintBurndown</code>; lane counts come from the snapshot's per-lane V2 ticket fields.</li>
                  <li><strong>Kanban</strong> — no sprint concept; the card shows board-wide lane counts only (no SP totals, no days-remaining). Lane bucketing uses the project's LaneConfig.</li>
                </ol>
                <p>The card displays:</p>
                <ul>
                  <li>Sprint name + a single neutral <strong>RAG chip</strong> — On Track / At Risk / Critical (replaces the older colored pipeline bar).</li>
                  <li>Date range and days remaining (Scrum only).</li>
                  <li><strong>Lane breakdown table</strong>: Todo / In Progress / In Review / QA / UAT / Blocked / Reopened / Done.</li>
                  <li><strong>Reopened</strong> count — tickets that went back to dev after QA.</li>
                  <li><strong>Sub-bugs Logged</strong> count — defects raised against parent stories during the sprint.</li>
                </ul>
              </div>
            </div>

            <div className="faq" id="q37">
              <div className="q"><span className="num">Q37</span>Which slides and graphs are included in the presentation?</div>
              <div className="a">
                <p>Generated slides (on-screen view and PDF), in order:</p>
                <ol>
                  <li><strong>Title</strong> — title, meeting date, scope summary.</li>
                  <li><strong>Executive Summary</strong> — AI-drafted, editable.</li>
                  <li><strong>Highlights &amp; Risks</strong> — two-column slide combining Achievements / Capacity Notes and Blockers / Open Risks. Risks are project-scoped only — account-level risks are intentionally excluded.</li>
                  <li><strong>Action Items &amp; Tech Recommendations</strong> — open items linked to the presentation plus tech recommendations.</li>
                  <li><strong>Projects Overview table</strong> — one row per project per sprint, columns <em>Plan SP / Del SP / Spill / Scope</em> (abbreviated to fit A4 portrait).</li>
                  <li><strong>Trends</strong> — shared team-level charts: Velocity, Productivity %, Defect Density %, Reopen Ratio %, <strong>Invalid Bugs</strong> (see <a href="#q38b">Q38b</a>) and Defect Leakage %. Each chart can be hidden per presentation, and you can add a free-text <strong>graph note</strong> under any chart (see <a href="#q34g">Q34g</a>). X-axis labels shortened (see <a href="#q38">Q38</a>). Per-developer sparklines have moved into each project's Drill-down slide — they are no longer a shared slide.</li>
                  <li><strong>Team Capacity table</strong> (optional) — an editable table of planned / unplanned leaves and SP delivered per member, off by default. See <a href="#q34g">Q34g</a>.</li>
                  <li><strong>Live Status</strong> — one card per project with an in-flight sprint or Kanban board (see <a href="#q36">Q36</a>).</li>
                  <li>
                    <strong>Drill-down (per project)</strong> — per-project narrative, the per-sprint team table when 2+ sprints fall in the window, and an
                    <strong> Individual Performance Trends</strong> sub-section with three sparkline panels:
                    <ul>
                      <li><strong>Developer Velocity</strong> — one row per V2 developer × last 5 closed sprints × SP delivered (skipped for Kanban projects).</li>
                      <li><strong>Reopen Ratio</strong> — % per dev, net of <code>Invalid-Reopen</code> / <code>Bad-Data</code> / <code>Scope-Change</code> exclusion labels on the parent. See <a href="#q11">Q11</a>.</li>
                      <li><strong>Carryover Ratio</strong> — carried-over SP ÷ (planned + scope-creep SP) per dev.</li>
                    </ul>
                    Each panel has a small info-icon explaining the formula on hover.
                  </li>
                  <li><strong>Additional Discussion Points</strong> — bullet list captured in Step 2 of the edit dialog (previously labelled &ldquo;Discussion Points&rdquo;).</li>
                  <li><strong>MOM</strong> — Minutes of Meeting block appended at the end. In the PDF, MOM starts on a fresh page (forced page break).</li>
                </ol>
                <p>
                  <strong>Presentation mode</strong> hides Edit / Open MOM /
                  Manage Trend Sprints / Download PDF for a customer-facing view
                  — see <a href="#q34a">Q34a</a>.
                </p>
              </div>
            </div>

            <div className="faq" id="q38">
              <div className="q"><span className="num">Q38</span>Why are sprint labels shortened on chart X-axes?</div>
              <div className="a">
                <p>
                  Full sprint names (e.g. <code>MAV 2026 Sprint 4.2</code>) do
                  not fit a PDF A4 portrait column. A <code>shortenSprintName()</code>
                  helper strips the leading <code>&lt;Project&gt; &lt;Year&gt; Sprint</code>
                  prefix, leaving just <code>4.2</code>. The same helper is
                  used in both on-screen Recharts and PDF SVG renders, so
                  labels stay consistent between the preview and the
                  downloaded file.
                </p>
              </div>
            </div>

            <div className="faq" id="q38a">
              <div className="q"><span className="num">Q38a</span>Why did a developer's Reopen Ratio change after the sprint was already closed?</div>
              <div className="a">
                <p>Two things can move the number after a sprint is closed:</p>
                <ol>
                  <li>
                    <strong>The team added one of these labels on a parent story</strong>:
                    <code>Invalid-Reopen</code>, <code>Bad-Data</code> or
                    <code>Scope-Change</code> (case- and separator-insensitive, so
                    <code>BadData</code> matches; <code>Scope-Change-Approved</code> does not).
                    Each label subtracts ONE reopen event from that ticket.
                    Net reopens cannot go below 0. See <a href="#q11">Q11</a>
                    for the full rule.
                  </li>
                  <li>
                    <strong>A full sprint re-sync re-pulled the parent's labels.</strong>
                    The <em>Recompute</em> endpoint does NOT re-fetch labels —
                    it only re-aggregates from stored facts. To apply the
                    label-exclusion rule to a closed sprint, trigger a re-sync
                    from the project's sprint list, or run the bulk
                    <code>resyncAllPerf.ts</code> script.
                  </li>
                </ol>
                <p>
                  The Delivery Presentation's per-developer Reopen sparkline
                  picks up the corrected values the next time the presentation
                  is <strong>refreshed</strong>. A saved presentation does not
                  auto-update.
                </p>
              </div>
            </div>

            <div className="faq" id="q38b">
              <div className="q"><span className="num">Q38b</span>What is the Invalid Bugs chart? (formerly "Invalid Reopens")</div>
              <div className="a">
                <p>
                  The trend chart previously labelled <strong>Invalid Reopens</strong>
                  is now <strong>Invalid Bugs</strong> &mdash; a testing-quality
                  signal counting bugs a QA raised that turned out <em>not</em>
                  to be real defects. It is hidden by default; enable it from the
                  graphs list.
                </p>
                <p><strong>What counts as an invalid bug</strong> (either condition):</p>
                <ul>
                  <li>The ticket's Jira <strong>Root Cause</strong> field is set to <code>Invalid Bug</code>, <code>Bad Data</code> or <code>Incomplete Requirement</code> (case and separators are normalised, and trailing detail still matches &mdash; <code>Incomplete Requirements</code> and <code>Invalid Bug - Config</code> both count); or</li>
                  <li>The ticket carries a fuzzy <strong>invalid-bug label</strong> &mdash; <code>invalid-bug</code>, <code>invalidbug</code>, <code>invalid_bug</code>, <code>InvalidBugs</code>, etc. all match (case and separators are normalised).</li>
                </ul>
                <p>
                  Invalid bugs are attributed to the QA who raised them and
                  counted per sprint. Because the flag is read from Jira at sync
                  time, historical sprints only populate after a full
                  <strong> re-sync</strong> &mdash; rows synced before this field
                  existed show 0. The chart shares the same enable/disable and
                  graph-note controls as the other trend charts (see
                  <a href="#q34g">Q34g</a>).
                </p>
              </div>
            </div>
          </section>

          {/* 11. Team Performance Report Inputs */}
          <section id="team-performance-inputs">
            <h2>11. Team Performance Report Inputs</h2>
            <p className="intent">What you pick on the Team Performance Report, and how a Live Report differs from a synced scorecard.</p>

            <div className="faq" id="q39">
              <div className="q"><span className="num">Q39</span>What inputs do I provide on the Team Performance Report?</div>
              <div className="a">
                <table>
                  <thead><tr><th>Input</th><th>Required</th><th>What it controls</th></tr></thead>
                  <tbody>
                    <tr>
                      <td><strong>Account</strong></td>
                      <td>Yes</td>
                      <td>Top-level dropdown. Hidden if the page was opened from an account context.</td>
                    </tr>
                    <tr>
                      <td><strong>Project</strong></td>
                      <td>Yes</td>
                      <td>Dropdown of projects within the selected account.</td>
                    </tr>
                    <tr>
                      <td><strong>Sprint</strong></td>
                      <td>Yes (Scrum)</td>
                      <td>Dropdown of all sprints for the project with a date range, tagged <em>Active</em> or <em>Completed</em>. Auto-loads the first Active sprint if one exists. <strong>Hidden for Kanban projects</strong> — Kanban has no sprint concept.</td>
                    </tr>
                    <tr>
                      <td><strong>Team Members</strong></td>
                      <td>Yes (Active sprints, Live Report)</td>
                      <td>Multi-select autocomplete. Required only when generating a Live Report against an Active sprint.</td>
                    </tr>
                    <tr>
                      <td><strong>Generate Live Report</strong></td>
                      <td>—</td>
                      <td>Button. Enabled only when project + sprint + ≥1 member are picked.</td>
                    </tr>
                    <tr>
                      <td><strong>Sprint vs Trends sub-tab</strong></td>
                      <td>—</td>
                      <td>Driven by URL: <code>/team-performance/sprint</code> or <code>/team-performance/trends</code>. There is no in-component tab toggle.</td>
                    </tr>
                  </tbody>
                </table>
                <p>
                  The right-hand <strong>Sync History</strong> panel lists
                  every completed sprint sync for the project. Clicking an
                  entry selects that sync and renders its scorecard — no
                  inputs needed beyond the project.
                </p>
              </div>
            </div>

            <div className="faq" id="q40">
              <div className="q"><span className="num">Q40</span>How does a "Live Report" differ from a synced sprint scorecard?</div>
              <div className="a">
                <table>
                  <thead><tr><th></th><th>Live Report</th><th>Synced Scorecard</th></tr></thead>
                  <tbody>
                    <tr>
                      <td><strong>Data source</strong></td>
                      <td>Real-time Jira query for the chosen Active sprint + selected members</td>
                      <td>Pre-computed <code>perf_sprint_syncs</code> row written by the nightly scheduler</td>
                    </tr>
                    <tr>
                      <td><strong>When to use</strong></td>
                      <td>Mid-sprint check-ins, ad-hoc reviews on an open sprint</td>
                      <td>Closed sprints, historical reviews, the source for Portfolio Presentation metrics</td>
                    </tr>
                    <tr>
                      <td><strong>Committed at Start</strong></td>
                      <td>Not shown (computed from changelog only at sync time)</td>
                      <td>Shown — reconstructed from each ticket's Sprint and Story Points changelogs</td>
                    </tr>
                    <tr>
                      <td><strong>Quality Report cross-check</strong></td>
                      <td>Not run</td>
                      <td>Run against Jira's sprint-report API — surfaces the <a href="#q2f">Data Quality Banner</a> when divergence &gt; 10%</td>
                    </tr>
                    <tr>
                      <td><strong>Writes to DB</strong></td>
                      <td>No</td>
                      <td>Yes — one row per (project × sprint), with <code>committed_sp</code> and <code>quality_report</code> JSONB</td>
                    </tr>
                  </tbody>
                </table>
              </div>
            </div>

            <div className="faq" id="q41">
              <div className="q"><span className="num">Q41</span>Where do I find the formula behind each Sprint Summary tile?</div>
              <div className="a">
                <p>
                  The Sprint Summary card header on the Team Performance Report
                  has a link <strong>"How we compute Sprint Summary numbers"</strong>.
                  It opens a modal (Methodology Doc) covering:
                </p>
                <ul>
                  <li>Per-tile formulas for Committed at Start, Final Scope, Total Completed, Carry Over, Scope Change (Net), Scope Adds (Team), Removed (Team).</li>
                  <li>Cross-validation rules against Jira's sprint-report API and the divergence-flag triggers (see <a href="#q2f">Q2f</a>).</li>
                  <li>Known limitations: SM rounding, manual exclusions, mid-sprint re-estimation, "Closed" vs "Done" column.</li>
                  <li>A step-by-step diagnostic guide when our numbers don't match the SM's email — including the debug script and the <code>quality_report</code> JSONB lookup.</li>
                </ul>
                <p>
                  This page (the FAQ) covers <em>what</em> the tiles mean and
                  when to quote which number; the Methodology Doc is where you
                  go for the algorithm itself.
                </p>
              </div>
            </div>
          </section>

          {/* 12. Excel & CSV Projects */}
          <section id="excel-projects">
            <h2>12. Excel &amp; CSV Projects</h2>
            <p className="intent">
              For teams that don't work in Jira — setting up the column mapping, uploading
              spreadsheets, and reading what the app tells you before it stores anything.
            </p>

            <div className="faq" id="q42">
              <div className="q"><span className="num">Q42</span>What is an Excel-based project?</div>
              <div className="a">
                <p>
                  A project whose delivery data comes from a spreadsheet instead of Jira. The team
                  uploads the export they already produce — <code>.xlsx</code> or <code>.csv</code> —
                  on the <strong>Data Imports</strong> page, and the app generates the same daily
                  DSRs, sprint scorecards and Team Performance views it would for a Jira project.
                </p>
                <p>
                  You don't have to reshape the file. The customer's own column headers are matched
                  to our fields once, per project, and every upload after that is read the same way.
                </p>
                <p>
                  One thing to know up front: a spreadsheet is a snapshot of how things look
                  <em> right now</em>. It carries no history of how a ticket moved between statuses,
                  so metrics that are reconstructed from that history — churn, reopen rate, cycle
                  time, QA-quality signals — aren't available for these projects. Everything
                  derivable from a ticket's current state is.
                </p>
              </div>
            </div>

            <div className="faq" id="q43">
              <div className="q"><span className="num">Q43</span>What has to be set up before the first upload?</div>
              <div className="a">
                <p>Two things, both in project settings:</p>
                <ul>
                  <li>
                    <strong>Reporting frequency</strong> — <em>Daily</em> (each upload is one date's
                    snapshot) or <em>Sprint</em> (each upload belongs to a named sprint).
                  </li>
                  <li>
                    <strong>Column mapping</strong> — upload a sample of the export and tell the app
                    which of its columns holds the ticket ID, title, status, assignee, story points,
                    sprint and dates.
                  </li>
                </ul>
                <p>
                  The mapping is the part worth getting right. <strong>A field you don't map imports
                    as blank</strong> — it isn't guessed. You can change the mapping later at any time;
                  each change is saved as a new version, so it stays clear which mapping any past
                  upload was read with.
                </p>
              </div>
            </div>

            <div className="faq" id="q44">
              <div className="q"><span className="num">Q44</span>Why are my story points 0 when the file clearly has them?</div>
              <div className="a">
                <p>
                  Almost always because the <strong>Story Points field was never mapped</strong>, or
                  was mapped to a column name that isn't in the file you uploaded.
                </p>
                <p>
                  The app doesn't guess which column holds estimates. If the field is unmapped it
                  looks for a column literally called <code>Story Points</code>; if your export calls
                  it something else, nothing matches and every ticket imports with a blank estimate —
                  which shows up as <strong>0</strong> in totals and a <strong>0% delivery</strong>{' '}
                  on the scorecard.
                </p>
                <div className="example">
                  <span className="label">Example</span>
                  The export has a column <code>Estimation - SP</code>. Story Points was left unmapped
                  in project settings, so the importer looks for <code>Story Points</code>, finds no
                  such column, and stores a blank for every row. Sprint totals read
                  <strong> 0 SP</strong> even though the spreadsheet shows 84.
                  <br /><br />
                  <strong>Fix:</strong> map Story Points → <code>Estimation - SP</code> in project
                  settings, then use <strong>Resubmit</strong> on the affected uploads (see{' '}
                  <a href="#q51">Q51</a>).
                </div>
                <p>
                  You no longer have to discover this after the fact — the upload screen lists any
                  mapped column it could not find in your file <em>before</em> importing. See{' '}
                  <a href="#q45">Q45</a>.
                </p>
              </div>
            </div>

            <div className="faq" id="q45">
              <div className="q"><span className="num">Q45</span>What is the column check shown before I upload?</div>
              <div className="a">
                <p>
                  When you pick a file, the app reads it and reports what it found — before writing
                  anything. Three things appear:
                </p>
                <ul>
                  <li>
                    <span className="dot green"></span><strong>Column check</strong> — each field, the
                    header it looked for, and the column it matched. Anything not found is flagged.
                  </li>
                  <li>
                    <span className="dot amber"></span><strong>Row validation</strong> — rows missing
                    required values, and any values the app adjusted to read them (for example{' '}
                    <code>5 SP</code> read as <code>5</code>, or <code>3,5</code> as <code>3.5</code>).
                  </li>
                  <li>
                    <span className="dot blue"></span><strong>Impact summary</strong> — what would
                    change if you continue, when the sprint already holds data (<a href="#q46">Q46</a>).
                  </li>
                </ul>
                <p>
                  A flagged column is a warning, not a block — you can still import, and that field
                  will simply be blank. It's telling you the mapping needs attention.
                </p>
              </div>
            </div>

            <div className="faq" id="q46">
              <div className="q"><span className="num">Q46</span>It says the sprint already has data — do I choose Merge or Replace?</div>
              <div className="a">
                <p>
                  <strong>Merge unless you specifically want tickets removed.</strong> Merge is the
                  default and is safe: a ticket is identified by its ID within its sprint, so
                  re-uploading it <em>updates</em> that ticket rather than adding a second copy.
                  Merging can never inflate your totals.
                </p>
                <ul>
                  <li>
                    <span className="dot green"></span><strong>Merge</strong> — tickets in the file are
                    updated or added. Tickets already stored but <em>not</em> in this file are kept.
                  </li>
                  <li>
                    <span className="dot amber"></span><strong>Replace</strong> — the file is treated as
                    the complete truth for those sprints. Anything stored but missing from the file is
                    deleted.
                  </li>
                </ul>
                <p>
                  The line that decides it is <strong>"not in this file"</strong>. If your export is a
                  partial extract, Replace will delete the tickets it happens to omit.
                </p>
                <div className="example">
                  <span className="label">Example</span>
                  Sprint 12 holds 48 tickets. Your file has 50 rows: 44 update existing tickets,
                  6 are new, and <strong>4 stored tickets aren't in the file</strong>.
                  <br />
                  <strong>Merge</strong> → 54 tickets (the 4 are kept).{' '}
                  <strong>Replace</strong> → 50 tickets (the 4 are deleted).
                  <br /><br />
                  If those 4 were genuinely descoped, Replace is right. If your export was just
                  filtered, Merge is right.
                </div>
              </div>
            </div>

            <div className="faq" id="q47">
              <div className="q"><span className="num">Q47</span>What happens if I upload the same file twice by mistake?</div>
              <div className="a">
                <p>
                  Nothing bad. Every ticket updates itself in place, so the numbers are identical
                  afterwards — no duplicates, no doubled story points.
                </p>
                <p>
                  The app also recognises a byte-identical re-upload and says so on the upload screen
                  ("This looks like the same file you uploaded on …"), so you can cancel if it wasn't
                  intended.
                </p>
              </div>
            </div>

            <div className="faq" id="q48">
              <div className="q"><span className="num">Q48</span>My export has no Sprint column. What do I do?</div>
              <div className="a">
                <p>
                  Name the sprint on the upload form. For sprint-based projects there's a{' '}
                  <strong>Sprint</strong> field offering the sprints already known to the project, and
                  you can type a new name. It applies to every row whose file doesn't name a sprint
                  itself; if the file <em>does</em> have a sprint value for a row, that wins.
                </p>
                <p>
                  Picking the same sprint next time is what makes the uploads merge together — so use
                  the existing name from the dropdown rather than retyping a variant.
                </p>
                <p>
                  Daily projects don't require a sprint; rows without one are grouped under{' '}
                  <strong>No Sprint</strong>.
                </p>
              </div>
            </div>

            <div className="faq" id="q49">
              <div className="q"><span className="num">Q49</span>Where do I see the data I just uploaded?</div>
              <div className="a">
                <p>Two places, both from <strong>Data Imports</strong>:</p>
                <ul>
                  <li>
                    <strong>The rows themselves</strong> — the view icon on any upload opens exactly
                    what that file contained, row by row, including a blank story-point column if the
                    mapping was wrong.
                  </li>
                  <li>
                    <strong>The resulting report</strong> — <strong>View results</strong> opens the
                    project's Board View with the account and project already selected.
                  </li>
                </ul>
                <p>
                  The row view works for <em>every</em> past upload, not just the most recent — useful
                  for answering "what did we actually send last Tuesday?".
                </p>
              </div>
            </div>

            <div className="faq" id="q50">
              <div className="q"><span className="num">Q50</span>My upload failed — how do I find out why?</div>
              <div className="a">
                <p>
                  The upload appears in the history table with a red <code>failed</code> status and the
                  reason next to it. Nothing fails silently.
                </p>
                <p>The common causes read plainly:</p>
                <ul>
                  <li><strong>No column mapping configured</strong> — set one up in project settings first.</li>
                  <li><strong>Missing required column</strong> — a mapped column isn't in this file.</li>
                  <li>
                    <strong>Sprint required</strong> — a sprint-based project needs a sprint, either in
                    the file or chosen on the form (<a href="#q48">Q48</a>).
                  </li>
                  <li><strong>Invalid rows</strong> — listed row by row with the column at fault.</li>
                </ul>
                <p>
                  If an upload succeeded but the daily report didn't regenerate, that's noted on the
                  row too — the imported data is fine and the report can be regenerated from Daily
                  Reports.
                </p>
              </div>
            </div>

            <div className="faq" id="q51">
              <div className="q"><span className="num">Q51</span>I fixed the column mapping. Do I have to re-upload every file?</div>
              <div className="a">
                <p>
                  No — use <strong>Resubmit</strong> on each affected upload. The original file was
                  kept, so the app re-reads it with the corrected mapping. You don't need to find the
                  spreadsheet again.
                </p>
                <p>
                  <strong>One limitation:</strong> files are only retained for uploads made since this
                  was introduced. Older uploads have no stored file — their Download and Resubmit
                  actions are disabled, and those spreadsheets need uploading once more by hand.
                </p>
              </div>
            </div>

            <div className="faq" id="q52">
              <div className="q"><span className="num">Q52</span>How do I tidy up sprints named "Custom Sprint — …"?</div>
              <div className="a">
                <p>
                  Those were generated automatically, with the upload time in the name, back when a
                  file arrived without a sprint column. Because the time was part of the name, every
                  upload created another one.
                </p>
                <p>
                  Use <strong>Manage sprints</strong> on the Data Imports page: tick the auto-named
                  sprints, type the real sprint name, and apply. The tickets keep all their data —
                  only the sprint they belong to changes — and the scorecards recalculate.
                </p>
                <div className="example">
                  <span className="label">Example</span>
                  Three buckets — <code>Custom Sprint - 2026-07-14 10:22</code>,{' '}
                  <code>… 2026-07-16 09:05</code>, <code>… 2026-07-18 16:40</code> — are all really
                  Sprint 12. Select all three, rename to <strong>Sprint 12</strong>, and they become a
                  single sprint with the tickets merged.
                </div>
                <p>New uploads no longer create these; the sprint is named on the form instead.</p>
              </div>
            </div>

            <div className="faq" id="q53">
              <div className="q"><span className="num">Q53</span>What happens if I delete an upload?</div>
              <div className="a">
                <p>
                  Its contribution is undone. The remaining uploads are re-applied in order, so the
                  data returns to exactly what it would have been had that file never been imported —
                  including any tickets a later file had updated.
                </p>
                <p>
                  This makes a bad upload genuinely reversible: delete it, fix the file or the mapping,
                  upload again. The retained copy of the deleted file is removed with it.
                </p>
              </div>
            </div>

            <div className="faq" id="q54">
              <div className="q"><span className="num">Q54</span>What's different between daily and sprint-based Excel projects?</div>
              <div className="a">
                <p>The frequency chosen in project settings changes how an upload is scoped.</p>
                <table>
                  <thead>
                    <tr><th></th><th>Daily</th><th>Sprint</th></tr>
                  </thead>
                  <tbody>
                    <tr>
                      <td><strong>Each upload is</strong></td>
                      <td>One date's snapshot</td>
                      <td>One named sprint</td>
                    </tr>
                    <tr>
                      <td><strong>You provide</strong></td>
                      <td>A report date</td>
                      <td>A sprint name</td>
                    </tr>
                    <tr>
                      <td><strong>Sprint required?</strong></td>
                      <td>No — rows group under "No Sprint"</td>
                      <td>Yes</td>
                    </tr>
                    <tr>
                      <td><strong>Drives</strong></td>
                      <td>Daily DSR and health for that date</td>
                      <td>Sprint scorecard and Team Performance</td>
                    </tr>
                  </tbody>
                </table>
                <p>
                  The column mapping is identical either way — only the scoping of an upload differs.
                </p>
              </div>
            </div>
          </section>

          {/* 13. Claude Usage & Prompt Coaching */}
          <section id="claude-usage">
            <h2>13. Claude Usage &amp; Prompt Coaching</h2>
            <p className="intent">A small collector on your laptop reports how you use Claude Code, purely so you can coach your own habits — it is not a scorecard.</p>

            <div className="faq" id="q55">
              <div className="q"><span className="num">Q55</span>What is the Claude usage / monitoring tool?</div>
              <div className="a">
                <p>
                  A lightweight collector that reads your local Claude Code session logs and reports
                  usage signals to the app — <strong>My Claude Report</strong> for yourself, and
                  (if you lead a team) <strong>Team Prompt Coaching</strong> for an aggregate view.
                  My Claude Report is split into an <strong>Overview</strong> tab (Avg score,
                  skill tier, habits &amp; capabilities) and a <strong>Details</strong> tab (where
                  your tokens go — caching, context loss, session shape, and the rest).
                </p>
                <p>
                  Everything here is framed as coaching: nothing on this page feeds a review or a
                  rating, and you should compare yourself against your own trend over time, not
                  against other people. A flag or a low number means "worth a look," not "something's
                  wrong."
                </p>
              </div>
            </div>

            <div className="faq" id="q56">
              <div className="q"><span className="num">Q56</span>What data does the collector send, and what does it never send?</div>
              <div className="a">
                <p>
                  Only timestamps and token counts derived from your local session logs — how long a
                  session ran, how many prompts it carried, how much was served from cache, which
                  model answered a prompt. <strong>It never sends prompt or answer text</strong>; the
                  collector reduces everything to counts before anything leaves your laptop.
                </p>
                <p>
                  For the exact fields captured and who can see what, open <strong>"How it works &amp;
                    consent"</strong> from My Claude Report.
                </p>
              </div>
            </div>

            <div className="faq" id="q57">
              <div className="q"><span className="num">Q57</span>Why wasn't my usage recorded today?</div>
              <div className="a">
                <p>
                  The collector defers sending usage data while your machine is on VPN, as a privacy
                  safeguard — a deferred day is counted and caught up once you're off VPN, rather than
                  silently dropped. It's also worth checking whether your collector build is current;
                  an out-of-date collector can be blocked from reporting until it's updated (see{' '}
                  <a href="#q61">Q61</a>).
                </p>
              </div>
            </div>

            <div className="faq" id="q58">
              <div className="q"><span className="num">Q58</span>What do cache hit rate, context loss, session shape, parallel work, pace and model fit mean?</div>
              <div className="a">
                <p>These are the six signals behind "Where your tokens go" (Details tab) — all about waste, not effort, and none of them affect your score or skill tier:</p>
                <ul>
                  <li><strong>Cache hit rate</strong> — how much of Claude's re-reading of your conversation was served from cache instead of processed fresh. <span className="dot green"></span><strong>Healthy</strong> at 85%+, <span className="dot amber"></span><strong>partial</strong> 60–85%, <span className="dot red"></span><strong>worth a look</strong> below that. Drops when sessions are restarted often. Helps: stay in one session per task.</li>
                  <li><strong>Context loss</strong> — how many times a session outgrew its context window and had to compact (summarise and discard history). Split into <strong>automatic</strong> (ran out of room mid-task — the one worth acting on) vs <strong>manual</strong> (you triggered it deliberately, which is fine).</li>
                  <li><strong>Session shape</strong> — sessions bucketed by prompt count: 1–5, 6–20, 21–100, 100+. A healthy spread is fat in the middle; heavy on the short end means restarting too often, heavy on the long end trends toward the context-loss case.</li>
                  <li><strong>Parallel work</strong> — how many sessions overlap, and how often a prompt lands in a different session than your last one (a "switch"). Not a problem by itself; the signal worth noticing is switches within five minutes of each other.</li>
                  <li><strong>Pace between prompts</strong> — the gap between Claude finishing an answer and your next prompt, bucketed from under 10 seconds to over 30 minutes. Prompts under 10 seconds are reflex replies rather than considered ones; combined with a high rework rate it usually means ground is being re-covered at full token cost.</li>
                  <li><strong>Model fit</strong> — each prompt is classified by the kind of work it looks like (debugging, building, refactoring, reviewing, explaining) and matched against which model answered it, to spot cheaper-model opportunities. Debugging and code generation are the exception — keep those on the most capable model.</li>
                </ul>
              </div>
            </div>

            <div className="faq" id="q59">
              <div className="q"><span className="num">Q59</span>What's the difference between my Avg score and the skill-tier chip?</div>
              <div className="a">
                <p>
                  <strong>Avg score</strong> (with the Good/OK/Poor mix) measures how clearly you
                  prompt. The <strong>skill-tier chip</strong> at the top ("Strong practice", etc.) is
                  a different, separate number — it blends your score with three other habits. The two
                  are expected to disagree sometimes, by design, not as a bug.
                </p>
              </div>
            </div>

            <div className="faq" id="q60">
              <div className="q"><span className="num">Q60</span>What can my lead see about my usage, and what's hidden from them?</div>
              <div className="a">
                <p>
                  <strong>Team Prompt Coaching</strong> (visible to superuser/admin/manager/lead) shows
                  the same kind of signal as an individual report, aggregated across the team, plus
                  per-member efficiency columns (cache hit, context lost, average session size, peak
                  parallel work).
                </p>
                <p>
                  It deliberately leaves out a member's <strong>vibe-coding index</strong> and their{' '}
                  <strong>AI coaching tips</strong> — leads never see either, individually or in
                  aggregate. The members table sorts by <strong>score</strong>, not by any efficiency
                  column, so it isn't an efficiency leaderboard.
                </p>
              </div>
            </div>

            <div className="faq" id="q61">
              <div className="q"><span className="num">Q61</span>Do I need to update the collector myself?</div>
              <div className="a">
                <p>
                  The app enforces a minimum collector version — an out-of-date install can be blocked
                  from reporting usage until it's updated. If your report looks stale or usage stops
                  appearing, check for a newer collector build before assuming something else is wrong.
                </p>
              </div>
            </div>

            <div className="faq" id="q62">
              <div className="q"><span className="num">Q62</span>Where do I install the collector, on Windows and on Mac?</div>
              <div className="a">
                <p>
                  Ask your admin for the collector install package and steps (Collector Installs is
                  managed from the admin Claude Usage area). The collector runs on both Windows and
                  Mac and detects VPN differently per OS — see <a href="#q57">Q57</a> for what VPN
                  means for your recorded usage.
                </p>
              </div>
            </div>
          </section>

          {/* 14. Recent Additions */}
          <section id="recent-additions">
            <h2>14. Recent Additions</h2>
            <p className="intent">A few smaller features that shipped recently.</p>

            <div className="faq" id="q63">
              <div className="q"><span className="num">Q63</span>Retro board — how does point carryover between retros work?</div>
              <div className="a">
                <p>
                  It's automatic — nobody has to copy anything forward. When a new retro board opens
                  for a project, a Carry Forward panel pulls in the top-3 "agreed points" from that
                  project's most recently completed retro, along with their lane and any conversion
                  into a linked action item.
                </p>
                <p>
                  The one manual step is recording an <strong>outcome</strong>: the facilitator of the
                  current retro can mark a carried point <strong>Done</strong>, <strong>Still
                    Open</strong>, or <strong>Dropped</strong> (with an optional note). This annotates
                  the original agreed point rather than creating a new item — a deliberate exception
                  to the rule that a completed board's content is otherwise frozen.
                </p>
              </div>
            </div>

            <div className="faq" id="q64">
              <div className="q"><span className="num">Q64</span>Why does a project show a different owner/developer than Jira's assignee field?</div>
              <div className="a">
                <p>
                  On some Jira boards the assignee field is a work-queue pointer (it flips between dev
                  and QA as a ticket moves) rather than a stable "who owns this" field, which mis-
                  attributes work in our metrics. A project can declare, per role, which Jira field(s)
                  actually identify the Developer / QA / UAT owner — configured in project settings
                  ("Lane Config": Developer/QA/UAT owner fields, plus an Assignee Mode of Separate or
                  Shared). Projects that don't configure this keep the previous default (assignee).
                </p>
                <p>
                  The declared <strong>Developer</strong> field is what the daily report uses for
                  activity attribution, and it is also the sole basis for the <strong>Sprint Progress
                    bar's denominator</strong> (see <a href="#q2a">Q2a</a>) — so getting this field right
                  matters for both.
                </p>
              </div>
            </div>

            <div className="faq" id="q65">
              <div className="q"><span className="num">Q65</span>What does the per-project AI Dev-Assist Tool setting do?</div>
              <div className="a">
                <p>
                  A per-project setting (project settings, admin-configurable: None / Claude / Copilot
                  / OpenAI / Cursor) recording which AI coding assistant that project's team actually
                  uses. It's an eligibility gate, not a model switch — setting it to <strong>Claude</strong>{' '}
                  is what makes Claude-usage screens (nav section, dashboard card, Team Prompt
                  Coaching) appear at all for that project's members; it does not change which Claude
                  model this app itself uses to generate that project's AI summaries.
                </p>
              </div>
            </div>

            <div className="faq" id="q66">
              <div className="q"><span className="num">Q66</span>RAG reliability overhaul — what changed, and why did my numbers move?</div>
              <div className="a">
                <p>
                  A pass through daily, weekly, monthly, account, and program health scoring closed
                  several gaps where the color shown could be less reliable than it should be. See{' '}
                  <a href="#q3">Q3</a>, <a href="#q5">Q5</a>, and <a href="#q6">Q6</a> above for the
                  updated formulas in detail. Summary of what changed:
                </p>
                <ul>
                  <li>Daily production-bug scoring is now severity-weighted instead of count/priority
                    branches — a bug's severity is no longer capped away the moment work starts on it
                    (Q3).</li>
                  <li>Weekly project RAG is now a proportional average instead of worst-case — a single
                    off day no longer taints an otherwise healthy week (Q5).</li>
                  <li>Account and program RAG now use the account's actual configured Amber threshold
                    instead of "any Amber/Red project taints the whole account" (Q6).</li>
                  <li>Monthly status (project and account) is now deterministic, the same way every
                    other level already was — previously it was written straight from the AI's
                    narrative with no check at all.</li>
                  <li>Every level's AI-suggested color can now only be logged for visibility, never
                    applied — previously a few levels let the AI report a <em>worse</em> color than the
                    data showed, even though they already blocked a healthier one.</li>
                </ul>
                <p>
                  <strong>If a project or account you watch regularly shows a different color than it
                  used to for the same underlying data</strong>, that's expected exactly once per report
                  — the new rule applies going forward, not retroactively; historical daily snapshots
                  are unchanged. A week or month that was borderline under the old rules (one bad day,
                  or a small handful of Amber projects) is the case most likely to move, typically
                  toward Green.
                </p>
                <p>
                  Separately: the twice-weekly email and account-summary scripts (<code>npx ts-node
                  generateTwiceWeeklyEmail.ts</code> / <code>generateAccountReport.ts</code>) used to
                  re-implement their own version of this rollup logic independently of the app, which is
                  why a script-generated report could show a different Amber/Red/Green count than the
                  same week viewed in the app. Both scripts now call the exact same underlying functions
                  the app uses, so a script run and the app should agree on a given week's counts. If you
                  ever see them disagree again, that's a bug worth reporting, not an expected quirk.
                </p>
              </div>
            </div>
          </section>

          <footer>
            <div>
              DSR Generator FAQ — living document. If a number doesn't match what
              you see in the app, raise it with the engineering team and we'll
              update this page.
            </div>
          </footer>
        </main>
      </div>
      <button
        type="button"
        className="back-to-top"
        onClick={() => window.scrollTo({ top: 0, behavior: 'smooth' })}
        aria-label="Scroll to top of FAQ"
      >
        ↑ Top
      </button>
    </Box>
  );
};
