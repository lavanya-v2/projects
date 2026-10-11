# DSR Generator (Jira Daily Status Report Generator)

AI-powered daily status report generator for Jira boards with TypeScript backend.

## Features

- 📊 **Jira Integration**: Fetch issues from Jira boards and sprints
- 🤖 **AI Analysis**: Claude AI generates comprehensive status summaries
- 📅 **Smart Calendar**: Intuitive date selection with IST default support
- 📈 **Data-Driven Insights**: Automated trend analysis and health scoring
- 📑 **Multiple Formats**: Excel, PPT, and JSON report generation
- 💾 **PostgreSQL Storage**: Historical snapshot tracking
- 🐳 **Docker Ready**: Containerized deployment
- 🔄 **TypeScript**: Type-safe, production-ready codebase
- 🏢 **Executive-Ready Summaries**: AI summaries describe work in business themes only — no Jira ticket IDs or titles
- 💬 **Manager Insights**: Layered human context (escalations, customer feedback) flows from daily → weekly → account reports
- 👥 **Team Performance Analytics**: Per-member sprint delivery metrics, velocity trends, pipeline breakdown, and Kanban date-range history with configurable period slicing
- 🏆 **Performance Scoreboard**: Automated per-member, per-sprint scoring pipeline — Jira ticket facts are ETL'd into computed scores covering completed SP, rework SP, carryover, and defects; async BullMQ sync queue; manager override with justification; ticket-level drilldown for full auditability; scope change and backlog work tracking
- 📝 **Performance Review**: HR-facing periodic reviews — account-scoped review cycles blend automatic delivery data (built on the Performance Scoreboard pipeline) with a lead's competency ratings into one composite score per person per period; roster-driven identity resolution, a guided superuser setup wizard, versioned competency templates, and member/lead dashboards with pending-review alerts
- 🛡️ **Risk Management**: Kanban-style risk board (NEW / WORK_IN_PROGRESS / STALE) with priority-based AI summaries, mitigation plans, comment threads (author-editable), and status-change audit trail
- 🎯 **Executive Dashboard**: Role-aware dashboard — superusers see a Top Risks panel (up to 5, CRITICAL-first) + prioritised Project Health list; managers see project tiles with drill-down; leads see their single project detail; members see a personal developer dashboard
- ✅ **Action Items (Project / Account / Program)**: Lifecycle-managed action items (Open → In Progress → Closed) across three scopes, linked to bi-weekly reports, with editable comment threads, status history, and server-side pagination/filtering
- 🖥️ **Delivery (Portfolio) Presentation**: Customer-facing multi-project delivery deck — AI executive summary, per-project drill-down, trend charts, live in-flight status, MOM workflow, WYSIWYG PDF export, presentation mode, and shareable deep links
- 📆 **Bi-Weekly Report**: Customer-facing bi-weekly presentation built from synced performance data, with trend overlays and MOM (Minutes of Meeting) capture
- 🗂️ **Program-Level Reporting**: Program scope (a grouping of projects under an account) with rolled-up daily / weekly / monthly reports and program-scoped action items
- 📥 **Excel / CSV Data Import**: Run projects that aren't in Jira from an uploaded `.xlsx` or `.csv` export — map the customer's own column headers once, then upload; every file is retained, viewable and re-runnable
- 🔔 **Notifications**: Configurable notification templates, rules, and pending-aggregate digests for risk and action-item events (superuser admin)
- ⏱️ **Hours-Based Estimation**: Projects can estimate in hours instead of story points; units are never summed across projects in rollups
- ❓ **In-App FAQ / Help**: A living, searchable FAQ page explaining every RAG, metric, chart, and workflow with worked examples
- 🧭 **Claude Usage & Prompt Coaching**: A laptop-side collector reports session-shape, prompt-caching, pace, and model-fit signals for individual coaching (My Claude Report) and team-level aggregates (Team Prompt Coaching) — never prompt/answer text, deferred while on VPN, gated by an enforced minimum collector version and a per-project opt-in
- 🔁 **Retro Board**: Lane-based sprint retros with automatic carryover of the prior retro's top-3 agreed points into the next one, plus outcome tracking (Done / Still Open / Dropped)
- 🧩 **Per-Project Ticket-Ownership Fields**: Declare which Jira field(s) identify the true Developer / QA / UAT owner per project (Lane Config), so the daily report and the Sprint Progress denominator aren't thrown off by boards where `assignee` is a work-queue pointer rather than a stable owner

## Report Generation Logic

### 1. Daily Report
- **Input**: Project Name, Date (Default: Today IST)
- **Data Source**: Fetches Jira tickets updated within the 24-hour window (or since last snapshot).
- **Filtering**: Includes tickets with status changes, comments, or worklogs. Excludes stale tickets.
- **AI Processing**: Generates Executive Summary, Key Risks, and Blockers.
- **Output**: JSON report saved to DB.

### 2. Weekly Project Report
- **Input**: Project Name, Start Date, End Date
- **Data Source**: Aggregates Daily Reports for the specified date range.
- **Analysis**:
    - **Executive Summary**: High-level overview of the week's progress.
    - **Work Summary**: Bulleted list of completed tasks.
    - **Key Achievements**: Major milestones hit.
    - **Prod Bugs**: Automatically flags critical bugs created/updated in the week.
    - **Team Members**: Aggregates active contributors from daily tickets.
- **Health**: Determined by a **proportional-average algorithm** across the week's daily health
  snapshots (updated — this used to be worst-case, where a single Amber day tainted an
  otherwise-Green week):
    - Each day scores 0 (Green) / 1 (Amber) / 2 (Red); `Unknown` days are excluded from both the
      sum and the day count.
    - `avg = sum / scorableDays` → **Green** if `avg < 0.35`, **Amber** if `avg < 1.2`, else **Red**.
    - Safety rule retained from the old logic: a **strict majority** of Red days forces Red
      regardless of the average.
    - Example: 4 Green + 1 Amber → avg 0.20 → **Green** (previously Amber). 2 Amber days out of
      5 → avg 0.40 → **Amber** — a genuine pattern still surfaces.
    - A `weeklyHealthRationale` string is stored with the day-by-day breakdown and the computed
      average, displayed as a tooltip in the UI.
    - The AI's own suggested status is logged when it disagrees with the computed value, but is
      never used — see `[WSRHealthGuard]` in the logs.

### 3. Account Weekly Report (Portfolio View)
- **Input**: Account Name, Start Date, End Date
- **Data Source**: Aggregates Weekly Project Reports for all projects in the account.
- **Algorithm**:
    - **Health Calculation**: Each project contributes a status (Green / Amber / Red) determined
      by the daily/weekly health algorithm above.
    - **Red Threshold**: Account turns Red if `≥ red_threshold_percentage` of active projects are
      Red (configurable per account, default 30%). Unchanged.
    - **Amber Threshold** (updated — this used to be "any project Red or Amber", so a single
      Amber project out of fifteen made the whole account Amber): Account turns Amber if
      `(redCount + amberCount) / activeProjects ≥ amber_threshold_percentage` (configurable per
      account, default 20%) but the Red threshold isn't met.
    - `Unknown`-status projects are excluded from every count and percentage; if every project is
      Unknown, the account is `Unknown`, not Green.
    - **Risk Analysis**: Structured `{ summary, items[] }` format with explicit "Red Projects"
      listing — computed from project statuses, not AI-authored.
    - **Action Items**: AI-generated recommended actions based on identified risks.
    - The account color is fully deterministic — AI disagreement is logged (`[AccountHealthGuard]`)
      but never applied, in either direction. (Previously the guard only blocked the AI from
      reporting a *healthier* color than the data showed; it could still report a worse one.)
- **Output**: JSON, Excel, and PowerPoint (PPTX) with summary tables and overflow handling.

### 4. Monthly Project Report
- **Input**: Project, Month/Year
- **Data Source**: Aggregates Weekly Reports for the month.
- **Analysis**: Long-term trend analysis, delivery performance, and strategic recommendations.
- **Health** (updated — this used to be written straight from the AI's narrative with no
  deterministic check at all): computed the same proportional-average rule as weekly project
  health (§2), one level up — each week in the month scores 0/1/2 and is averaged. A
  `monthlyHealthRationale` string records the computation. Monthly account health rolls up the
  month's project statuses the same way account-weekly does (§3).

### 5. Program-Level Reports (Rollup)
A **Program** is a grouping of projects under an account (managed under **Programs**). Program reports roll up their member projects into a single daily / weekly / monthly view so a program head can scan the whole portfolio at once.

- **Scope**: Every project assigned to the program.
- **Daily / Weekly / Monthly**: Each level aggregates the corresponding project reports; program
  RAG uses the same red/amber threshold rule as account rollups (§3). A program's own
  `red_threshold_percentage` is used if set, else its account's, else 30%. Programs have no
  Amber threshold of their own — that always falls back to the parent account's
  `amber_threshold_percentage` (default 20%).
- **Generation**: Synchronous (`POST /api/report/program/:programId/{daily|weekly|monthly}`) or async via the queue (`.../queue`). Leads are blocked from generating program reports.
- **Access**: Program owners (plus superuser / admin) see the program; `listAccessible` drives the picker.

### Standalone scripts (twice-weekly email / account summary)
`backend/generateTwiceWeeklyEmail.ts` and `backend/generateAccountReport.ts` (invoked by
`scripts/twice_weekly.sh`) generate the same reports outside the app's own weekly cadence, for
an arbitrary date range instead of the app's fixed Friday–Thursday week. They call the exact
same rollup and health functions the app uses (`rangeRollupService`, `healthMath`,
`aiService.generateRangeProjectSummary` / `generateRangeAccountBriefing`) — previously each
script re-implemented its own version of this logic, which is why a script-generated report
could show a different Amber/Red/Green count than the same week viewed in the app. Both now
share one implementation with the app, so they agree by construction, not by coincidence.

---

## Executive-Ready Summaries

All AI-generated executive summaries are written for senior leadership who have no Jira access. The AI is explicitly instructed to:

- **Describe work in functional/business themes** ("authentication improvements", "payment integration", "UAT cycle")
- **Never include Jira ticket IDs** (e.g. PROJ-123) or raw ticket titles in `executiveSummary`, `keyRisks`, or `executivePlan` — IDs are only permitted in `workSummary` and the per-ticket `ticketDetails` field
- **No generic praise** — phrases like "the team made excellent progress" or "outstanding delivery" are forbidden. Every sentence must name specific features, modules, or factual outcomes
- This applies to daily, weekly, and account-level summaries

### Per-Ticket Detail Section (DSR)

Daily reports include a collapsed **Ticket-Level Details** accordion that shows a per-ticket activity log (the only place ticket IDs appear). Format: `- KEY: [issuetype] brief description of what was done today, current status`. This is generated by AI and stored in the `ticket_details` column.

### Health Rationale Tooltip

Every daily and weekly report shows a small ⓘ icon next to the health chip. Hovering it reveals the deterministic rationale — exact numbers used, which axes fired, which thresholds were crossed — so health decisions are always explainable, not opaque.

---

## Manager Insights

A layered annotation system lets team leads and managers add human context that Jira data alone cannot capture — escalations, customer concerns, verbal feedback from stakeholders.

### How It Works

```
Daily (manual entry — no AI)
  ↓ AI collates during WSR generation
Weekly Project (AI-generated from daily insights → editable → baked into executive summary)
  ↓ AI collates during account WSR generation
Account Weekly (AI-generated from project weekly insights → editable → baked into account summary)
```

### Behavior by Level

| Level | How Insights Are Set | AI Involvement |
|---|---|---|
| **Daily** | Team lead types free text directly | None — pure human input |
| **Weekly Project** | Auto-generated by AI collating daily insights from Mon–Fri | Yes — then editable |
| **Account Weekly** | Auto-generated by AI collating project weekly insights | Yes — then editable |

- At weekly and account levels, if insights are present when the report is generated, they are **incorporated into the executive summary** in the same AI call (not as a post-processing step).
- If a manager edits insights after the report is generated, a **preview → accept** flow lets them see old vs. new summary side-by-side before committing.

### API Endpoints

| Method | Endpoint | Description |
|---|---|---|
| `PATCH` | `/api/report/daily/:id/insights` | Save daily insights (no AI) |
| `POST` | `/api/report/:reportType/:id/insights/preview` | Preview refreshed summary with new insights |
| `PATCH` | `/api/report/:reportType/:id/insights/accept` | Accept and save new insights + summary |

`reportType` is `daily`, `weekly_project`, or `weekly_account`.

---

## Project Health Scoring

Every daily project report runs a **deterministic three-axis health calculation** *before*
passing data to the AI. The three axis scores (0/1/2 each) are summed; the AI narrates the
result but cannot change it — `[HealthGuard]` in the logs records (and discards) any
disagreement.

```
combined = blockedScore + bugScore + sprintScore  →  0 = Green | 1 = Amber | ≥2 = Red
```

### Axis 1 — Blocked Ticket %

Counts tickets in **In Progress + In Review + QA** lanes (the WIP pool). **UAT tickets are excluded entirely** — once a ticket reaches UAT, V2's development work is internally complete (only customer/PO sign-off remains). Blocked % = blocked tickets ÷ WIP pool × 100. If this exceeds the account's `amber_threshold_percentage` (default **20%**), Axis 1 scores **+1**; otherwise **+0**.

> A single blocked ticket will **not** trigger Amber unless the WIP pool is tiny (< 5 tickets). The threshold ensures external dependency blocks don't unfairly penalise a team.

### Axis 2 — Production Bug Score (severity-weighted)

Counts Jira tickets where `issuetype = Bug` or `Sub-bug` and environment = Production. Only
**fresh** bugs (created within 15 days of sprint start for Scrum, or within 15 days of week
start Monday for Kanban) are scored. Bugs outside that window are treated as intentionally
planned and excluded, same as before.

**Special cases (excluded from scoring, unchanged):**
- **Re-opened sub-bugs**: A `Sub-bug` whose parent story is still active on the board → treated as rework on an ongoing story. Mentioned in AI output as "re-opened" but does NOT affect health.
- **Spillover bugs**: A bug that was in a previous sprint but wasn't resolved → forces Axis 2 to at least Amber and is flagged as a Risk in the AI output.
- **UAT bugs**: Bugs that have reached UAT status → on plan, not a concern, excluded.

**Scoring itself is new** (`backend/src/modules/reports/services/bugSeverityMath.ts`). The old
count/priority-branch logic could only ever go *down* once a bug reached a remediation lane
(in-progress/review/QA/UAT), regardless of count or severity — four Blocker-severity bugs in QA
scored the same as one Medium-severity bug in QA. Each fresh bug now contributes a
severity-weighted score instead:

| Severity tier | Weight | Jira labels mapped to this tier (default) |
|---|---|---|
| Critical | 2.0 | Blocker, Critical, Highest |
| High | 1.5 | High, Major |
| Medium | 0.75 | Medium, Normal, or an unrecognized label |
| Low | 0.35 | Low, Lowest, Minor, Trivial |

A bug already in a remediation lane (in-progress/review/QA/UAT) keeps **half** its weight
instead of being flattened to a fixed contribution — engagement lowers urgency, but doesn't
erase it. Weights are summed across every fresh bug:

```
totalWeight < 0.5  → Axis 2 = +0
totalWeight < 2.0  → Axis 2 = +1 (Amber)
totalWeight ≥ 2.0  → Axis 2 = +2 (Red)
```

A project can override the default label→tier map in its settings (`bug_priority_map`, nullable
JSONB on `projects`) if its Jira instance uses non-standard priority names (e.g. P1/P2/Sev1);
null uses the built-in map above.

> **Age rule (unchanged)**: Bugs created more than 15 days before the sprint start date are considered intentionally planned by the product team and are completely excluded from health scoring. Only bugs raised within that 15-day pre-sprint window (or after sprint start) are tracked.

### Axis 3 — Sprint Burndown (Scrum only)

Off-track percentage (days elapsed vs. stories done) scores **+1** at-risk, **+2** critical; on
track scores **+0**. Skipped for Kanban projects (`sprintScore = 0`).

### Configuring Thresholds

| Column | Table | Default | Description |
|---|---|---|---|
| `amber_threshold_percentage` | `accounts` | `20` | Blocked % above which Axis 1 = Amber; also the account/program Amber-rollup threshold (see §3 above) |
| `red_threshold_percentage` | `accounts` | `30` | % of Red projects above which Account = Red |
| `bug_priority_map` | `projects` | `null` (default map) | Per-project override of the Jira-priority-label → severity-tier map |

Update directly in the database — no code change needed:
```sql
UPDATE accounts SET amber_threshold_percentage = 25 WHERE code = 'CCMH';
```

### Sprint Burndown — QA Partial Credit

The sprint burndown uses **weighted completion** to avoid penalising teams whose work is late-stage but nearly done:

| Ticket status | Completion weight |
|---|---|
| Done / UAT | 1.0 (fully counted) |
| QA / Testing | 0.6 (partial credit — nearly done) |
| In Review, In Progress, Blocked, etc. | 0.0 |

`completionPct = Σ(weights) / totalV2Tickets × 100`

This means a sprint with 8 tickets — 4 Done + 4 in QA — shows 70% completion rather than 50%, accurately reflecting that the team is in final validation, not mid-development.

### Log Output (per report)
```
[HealthCalc] EXP: green|No blockers — the team is working freely | amber|1 new production bug not yet in progress — needs attention (severity: 1 high, weight 1.50) | green|Sprint is on track — 24 of 38 stories done, 4 working days to go → FINAL: Amber
```

---

## Team Performance Analytics

The Team Performance module provides sprint-level and historical delivery metrics per developer, separate from the automated daily/weekly report pipeline.

> **Estimation units:** Projects can estimate in **hours** instead of story points. The stored field is unit-agnostic; the UI labels it per project. Rollups never sum values across different units.

### Tab 0 — Sprint Report

Select a sprint and one or more team members to generate a per-sprint breakdown:

- **Summary cards**: total SP planned, SP done, delivery %, spillover count
- **Sprint progress bar**: percentage of sprint window elapsed vs. work done
- **Member table**: per-developer SP planned / SP done / delivery % / pipeline breakdown (In Progress, QA, UAT, Done)
- **Late QA movers**: tickets that moved into QA after the sprint midpoint
- **Scope changes**: tickets added or removed after sprint start

### Tab 1 — Team History

Shows the last 3 closed sprints plus the current active sprint per developer as a visual card grid:

- **Bar chart**: Planned SP vs. Done SP side-by-side for each closed sprint (colour-coded green / amber / red by delivery %)
- **Current sprint tile**: SP done / SP planned so far, delivery %, and live pipeline breakdown chips

**Kanban projects** (no sprints) show a date-range history view instead:

- **Date range selector**: custom start date → end date
- **Period slice selector**: break the range into N-day windows (e.g. 15 days)
- **Bar chart**: tickets delivered per period per developer
- **Average velocity**: avg tickets and story points per period
- **Current open tickets**: pipeline breakdown of work currently in flight

---

## Performance Scoreboard

The Performance Scoreboard automates the collection and calculation of per-member, per-sprint delivery quality metrics — going beyond raw story points to capture rework, carryover, and defect contribution.

### How It Works

```
Jira API (ticket data for a sprint)
  ↓  ETL via BullMQ async queue (perfSyncQueue)
PerfTicketFact (raw per-ticket facts stored in DB)
  ↓  Aggregation
PerfMemberScore (computed scores per member per sprint)
  ↓  Rendered in TeamPerformanceReport UI
Score cards + drilldown + manager overrides
```

A sync can be triggered manually from the UI or runs automatically on a schedule via the `schedulerService`. Each sync is idempotent — re-syncing a sprint updates existing facts rather than duplicating them.

### Metrics Computed per Member

| Metric | Description |
|---|---|
| **Completed SP** | Story points in Done/UAT by sprint end |
| **Rework SP** | Story points on tickets that were reopened or had bugs filed against them |
| **Carryover** | Tickets not completed by sprint end |
| **Defects raised** | Production bugs attributed to the member's work |
| **Scope change** | Tickets added to the sprint after it started (tracked separately) |
| **Backlog work** | Tickets pulled from backlog mid-sprint |
| **Invalid bugs** | Bugs a QA raised that weren't real defects — Jira Root Cause = `Invalid Bug` or a fuzzy `invalid-bug` label |

### Defect Quality Signals — Reopens & Invalid Bugs

- **Reopen detection** is sequence-aware and windowed: a ticket counts as reopened only when it moves from a QA / UAT / Done lane back to Dev during the sprint. Standalone Bugs are included; Sub-bugs are excluded (they are the evidence of a parent reopen, not a separate item).
- **Exclusion labels** — `invalid-reopen`, `bad-data`, `scope-change` (exact match) each subtract one reopen event from a parent ticket.
- **Invalid bugs** — captured from Jira's `Root Cause` custom field (`customfield_10414`) or a fuzzy `invalid-bug` label, stored on `perf_ticket_facts` (`root_cause`, `invalid_bug`) and aggregated per QA (`invalid_bugs_count`). Surfaced as the **Invalid Bugs** trend chart in the Delivery Presentation.
- Both signals only reflect on **closed** sprints after a full re-sync — the Recompute endpoint does not re-fetch Jira labels.

### Database Tables

| Table | Purpose |
|---|---|
| `perf_sprint_syncs` | Tracks per-sprint sync state (last synced at, status) |
| `perf_ticket_facts` | Raw Jira ticket facts per sync (type, SP, resolution, assignee) |
| `perf_member_scores` | Aggregated per-member, per-sprint scores including SP rework columns |

### Manager Features

- **Score Override** (`PerfOverrideModal`): A manager can manually override a computed member score with a written justification. The original computed score is preserved alongside the override for transparency.
- **Ticket Drilldown** (`PerfTicketDrilldownModal`): Expands any member's score card to show the raw `PerfTicketFact` rows behind the number — every individual ticket, its type, SP, and resolution that contributed to the score.
- **Scope Change & Backlog Details**: Dedicated endpoints and UI views show exactly which tickets were scope-added or pulled from backlog, so sprint scope inflation is visible to managers.

### API Endpoints

| Method | Endpoint | Description |
|---|---|---|
| `POST` | `/api/report/project/:projectId/perf-sync` | Trigger async sync for a sprint |
| `GET` | `/api/report/project/:projectId/perf-scores` | Fetch computed member scores |
| `PUT` | `/api/report/perf-score/:id/override` | Save a manager score override |
| `GET` | `/api/report/perf-score/:id/scope-changes` | Scope-change ticket details |
| `GET` | `/api/report/perf-score/:id/backlog-work` | Backlog-pulled ticket details |

### UAT Handling

- **Blocked axis**: UAT tickets are excluded entirely from the WIP pool. Once a ticket reaches UAT, V2's development work is complete, so it cannot contribute to blocked percentage regardless of assignee.
- **Sprint burndown**: UAT tickets count as 100% complete (weight = 1.0), same as Done.
- **AI summaries**: AI may note sprint formal closure depends on customer/PO sign-off for UAT tickets — framed as a schedule dependency, not a team shortcoming. If a UAT ticket is assigned to a V2 team member, AI may flag it as a minor note.

---

## Performance Review

A periodic, HR-facing review — not to be confused with the Performance Scoreboard above, which feeds it. Each review cycle blends two independent factors into one composite score per person, built to support real appraisals: every number must be independently verifiable, and a score is never manufactured from missing data.

### How It Works

```
Roster-driven identity resolution (which Jira/Excel identity is this person?)
  ↓
Review cycle opens (monthly/quarterly, account-scoped)
  ↓  attaches completed sprints/kanban windows in the period
System factor (from Performance Scoreboard data)  +  Lead factor (competency ratings)
  ↓  weighted blend, per the account's configured split
Composite score, coverage %, and a Provisional flag if a factor is missing/thin
  ↓
Lead publishes → visible to the member, feeds the trend/consolidated view
```

### Cycles Are Account-Scoped, Not Project-Scoped

A person working across several projects gets **one** review per period, not one per project — measured necessity, since on a real pilot account over half the roster works across two or more projects. Which projects feed a cycle is a configurable scope list per account. A cycle's project scope is **snapshotted once**, the moment it first opens, and never re-read from account config afterward — a published score must not silently imply a different scope later. A project added to scope after a period has already opened can never retroactively appear in that period; a **catch-up cycle** (a one-off period spanning several already-closed months, superuser-created) is the only way to get a retrospective number for it.

### Missing Data Never Manufactures a Score

- A factor with no data scores **100 at 0% coverage**, flagged `Provisional` — never a 0, and never mistaken for a real, final number.
- An identity nobody has confirmed is simply **absent** from scoring until confirmed — never blocks the rest of the project's rollout, and joins an already-open cycle automatically the next time it recomputes.
- A reviewer is never auto-assigned to review their own record, even if they'd otherwise be the project's unambiguous default reviewer.
- QA's `-1` "insufficient activity" sentinel, and any factor below its volume floor, are excluded from every aggregation — never averaged in as if it were a real, terrible score.

### Setup (Superuser)

A guided 7-step wizard (Project → Cadence → Team members → Reviewer → Template → Launch → Done) walks a superuser through bringing one project onto Performance Review — reusing the account's shared cadence once it's set, roster-driven identity confirmation, a real eligible-reviewer picker (login + lead-or-above role + actual project access, not free-text roster roles), and competency template selection. Launching a period is an explicit, undoable-before-commit choice from the periods that have actually completed, not a hidden heuristic. New accounts default to a forward-only view (no silent backfill of pre-setup history); a superuser can still opt into seeing — and reviewing — older, skipped months via a catch-up cycle.

### Lead, Member, and Dashboard Views

- **Lead** — a worklist of assigned reviews per cycle, a competency rating form with the full delivery-data drill-down behind each score, and a per-team-member history across every cycle they've ever been part of (including periods under a different lead, redacted to score-only).
- **Member** — their own trend since the beginning, plus a "Single period / All periods together" toggle to read every published period's narrative and ratings at once, with the same evidence drill-down the lead rated against.
- **Dashboards** — a small card on both the Member and Lead dashboards surfaces the latest published rating and a pending-review nudge in whichever direction applies, so the two sides can follow up with each other directly.

### Database Tables

| Table | Purpose |
|---|---|
| `perf_identity_links` | Roster member → delivery identity, confirmed before anything is scored |
| `review_cycle_configs` | Per-account cadence, weighting, scope, and setup date |
| `review_cycles` | One materialised period (`scheduled → open → locked → published → archived`), snapshotted weights/template/scope |
| `review_cycle_sources` | Which synced sprints/kanban windows feed a period |
| `review_cycle_participants` | Frozen roster + assigned reviewer for a period |
| `review_member_scores` | Composite/system/lead scores, coverage, trend, and cumulative YTD per person per period |
| `competency_templates` / `competency_template_items` | Versioned rating templates |
| `lead_reviews` / `lead_review_ratings` | A lead's draft → submitted → published review and its ratings |
| `review_project_settings` | Per-project template override and default reviewer |

### API Endpoints

| Method | Endpoint | Description |
|---|---|---|
| `GET/PUT` | `/api/performance-review/config/account/:accountId` | Account cadence/weighting/scope + per-project rollout |
| `POST` | `/api/performance-review/cycles/generate` | Materialise periods from the account's setup date forward |
| `POST` | `/api/performance-review/cycles/catch-up` | Create a one-off period covering several skipped months |
| `GET` | `/api/performance-review/cycles` | List periods (`includeHistorical` to reveal pre-setup ones) |
| `POST` | `/api/performance-review/cycles/:cycleId/transition` | Open / lock / publish / archive a period |
| `GET/PUT` | `/api/performance-review/project-settings/:projectId` | Template override, default reviewer, and eligible-reviewer list |
| `GET/PUT` | `/api/performance-review/lead-reviews/:id` | Draft, save, submit, publish a review |
| `GET` | `/api/performance-review/me/reviews` | The signed-in member's published reviews + trend |
| `GET` | `/api/performance-review/me/pending-status` | Dashboard-sized pending-review summary (member and/or lead) |

---

## Delivery (Portfolio) Presentation

A customer-facing, multi-project delivery deck generated from live system data. Built through a multi-step editor and rendered both on-screen (Recharts) and as a WYSIWYG PDF.

### Authoring flow

Open **Portfolio Presentations** and click **New Delivery Presentation**. The editor collects:

1. **Basics & Scope** — title, meeting date, start/end window, overall health, and projects in scope (Account mode = checkbox grid, or Program mode = pick a program). Clicking **Next (pull data)** fetches sprints, metrics, risks, and action items for the window.
2. **Highlights & Risks** — AI executive summary, achievements, blockers, capacity notes, and a project-scoped risks table (all editable).
3. **Action Items & Tech** — pulls open **project + program** action items (not account), plus tech recommendations and discussion points.
4. **Per-Project Drilldown** — per-project health override (Auto / G / A / R), visibility toggle, narrative, sprint metrics, and per-developer trend sparklines.

### Slides & charts

Title → Executive Summary → Highlights & Risks → Action Items & Tech → Projects Overview table → **Trends** → **Live Status** (in-flight sprint / Kanban board) → per-project **Drill-down** → Additional Discussion Points → **MOM**.

Trend charts: Velocity, Productivity %, Defect Density %, Reopen Ratio %, **Invalid Bugs** (renamed from "Invalid Reopens"), Defect Leakage %, plus an optional **Team Capacity** table.

### Presentation-only authoring controls

These annotate the deck without changing source data:

- **Graph notes** — a free-text note per trend chart, rendered under the chart on-slide and in the PDF (`graphNotes` JSONB).
- **Velocity reduced-capacity flags** — mark specific sprints as reduced-capacity so they are excluded from the Velocity Trend average line (`velocityCapacityFlags` JSONB).
- **Team Capacity table** — an optional slide (`teamCapacityRows` JSONB) pre-seeded from V2 members, with manual planned/unplanned-leave entry.

### Workflow features

- **Refresh** re-pulls metrics, risks, action items, developer trends, and the AI summary; manual prose, health overrides, visibility toggles, and MOM stay frozen.
- **MOM (Minutes of Meeting)** — attach and AI-polish meeting notes, then **Accept & Lock** to freeze the whole presentation.
- **Presentation mode** — a clean, chrome-free view for customer demos.
- **Shareable deep links** — `/presentations/delivery/:id` (auth-only; the API enforces project access, and any denial renders an in-app 404). A **Copy share link** action is on the list view.
- **Clone**, **search / filter / pagination**, and **PDF download** are available from the list.

### Access & API

Visible to Superuser / Admin / Manager / Lead (Manager and Lead see only presentations that include a project they can access); Members do not see the menu. Delete is creator-only (superuser/admin bypass). Access is enforced by `requirePortfolioPresentationAccess`.

| Method | Endpoint | Description |
|---|---|---|
| `POST` | `/api/report/account/:accountId/portfolio-presentation/preview` | Pull live data for the window |
| `GET/POST` | `/api/report/account/:accountId/portfolio-presentation` | List / create presentations |
| `GET/PUT/DELETE` | `/api/report/portfolio-presentation/:id` | Read / update / delete |
| `POST` | `/api/report/portfolio-presentation/:id/refresh` | Re-pull live data |
| `POST` | `/api/report/portfolio-presentation/:id/duplicate` | Clone |
| `POST` | `/api/report/portfolio-presentation/:id/mom/{generate,accept}` | MOM workflow |

---

## Bi-Weekly Report

A customer-facing bi-weekly presentation built from synced performance data (`BiweeklyReport`, `BiweeklyPerfSync`). It renders trend charts with per-sprint overlays, links project action items into the deck, and supports the same MOM (generate → accept) workflow as the Delivery Presentation.

| Method | Endpoint | Description |
|---|---|---|
| `GET/POST` | `/api/report/project/:projectId/biweekly` | List / create reports |
| `GET` | `/api/report/project/:projectId/biweekly/available-perf-syncs` | Sprint syncs available to include |
| `GET` | `/api/report/project/:projectId/biweekly/trend` | Trend history |
| `PATCH` | `/api/report/project/:projectId/perf-sync/:syncId/overlays` | Save chart overlays |
| `GET/PUT/DELETE` | `/api/report/biweekly/:id` | Read / update / delete |
| `POST` | `/api/report/biweekly/:id/mom/{generate,accept}` | MOM workflow |
| `GET/POST/DELETE` | `/api/report/biweekly/:id/action-items` | Manage linked action items |

---

## Risk Management

The Risk Board provides a structured way for superusers and admins to track project risks across all accounts.

### Board Lanes

| Lane | Meaning |
|---|---|
| **NEW** | Newly identified risk, not yet being worked |
| **WORK_IN_PROGRESS** | Actively being mitigated |
| **STALE** | No activity for > 14 days — needs attention |
| **DONE** | Resolved — hidden from board, accessible via history |

### Key Rules

- Only superusers and admins can access the Risk Board — managers and leads cannot see cross-project risks.
- Moving a risk between lanes requires a comment explaining the status change (enforced server-side in an atomic transaction).
- Marking a risk Done is restricted to the risk's creator.
- Each risk can be linked to a specific project (optional — account-level risks have no project link).

### AI Summary (Persistent)

Every risk has an AI Summary generated by Claude. The summary is generated **once on write** (when a risk is created, a comment is added, or the risk is marked done) and stored in the database. Opening a risk modal reads the stored value — no LLM call is made on read, so the modal opens instantly.

- If a risk was just created and the background generation hasn't completed yet, the banner shows *"No analysis available yet. Summary generates after the first update."*
- After adding a comment or updating the risk, the summary refreshes in the background without blocking the API response.

### API Endpoints

| Method | Endpoint | Description |
|---|---|---|
| `GET` | `/api/risks` | List all active risks (superuser only) |
| `POST` | `/api/risks` | Create a new risk |
| `GET` | `/api/risks/:id` | Get risk detail (includes `aiSummary`) |
| `PUT` | `/api/risks/:id` | Update risk fields |
| `DELETE` | `/api/risks/:id` | Delete a risk |
| `POST` | `/api/risks/:id/comments` | Add a comment (triggers AI summary refresh) |
| `POST` | `/api/risks/:id/mark-done` | Mark risk as done (creator only) |

---

## Executive Dashboard

The dashboard is role-aware and shows a different layout per user type.

### Superuser / Admin View

- **Top Risks panel**: Displays up to 5 active risks sorted by priority (CRITICAL → HIGH → MEDIUM → LOW), then by creation date. Each row is clickable and opens the risk detail in a read-only modal. A "View All →" link navigates to the Risk Management tab when there are more risks than shown.
- **Project Health list**: All accounts' projects sorted by health severity (Red and Amber always shown in full; Green projects capped at 3 with an expand toggle for the rest). Each row shows:
  - Project name (clickable — navigates to the project's daily report) + account name
  - Health as a coloured dot + text label (Green / Amber / Red) with a tooltip showing the rationale
  - Sprint status as plain coloured text (On Track / At Risk / Critical)
  - Active risks count and open action items count

### Manager View

Tile-based layout — one card per project. Clicking a tile drills into the project detail dashboard within the same page. Action item rows are clickable and open the full `ActionItemDetailModal`.

### Lead View

Single-project detail view auto-loaded on login. Action item rows are clickable and open a read-only `ActionItemDetailModal`.

### Back to Dashboard Navigation

When a superuser clicks a project name in the Project Health list, the Daily Report for that project opens with the project pre-selected. A **"← Back to Dashboard"** button appears at the top of the report. Clicking it returns to the Executive Dashboard. The button is only shown when navigating from the dashboard — it does not appear when the user opens Daily Reports manually from the sidebar.

---

## Action Items (Project / Account / Program)

Action items provide a structured task-tracking layer separate from Jira issues — typically follow-ups from bi-weekly or delivery reviews. They exist at **three scopes**, each with its own access rule:

| Scope | Access | Endpoint prefix |
|---|---|---|
| **Project** | Anyone with the project | `/api/report/project/:projectId/action-items` |
| **Account** | Account read/write access | `/api/report/account/:accountId/action-items` |
| **Program** | Program-report visibility | `/api/report/program/:programId/action-items` |

The Action Items page has tabs for Project (0), Program (1), and Account (2), with server-side pagination, multi-filter search, and a clickable applied-filter count.

### Status Lifecycle

```
Open → In Progress → Closed   (one-way — no reverse transitions)
```

Each transition is recorded in `action_item_status_history` with the actor and timestamp.

### Comments

Every scope supports threaded comments. A comment is **editable by its author only** (no superuser override) and **only while it is the newest comment in its thread** — once a follow-up exists, earlier comments lock. Edits stamp `edited_at`, which drives an "(edited)" indicator. The same author-only / latest-only rule applies to **Risk** comments.

### Bi-Weekly & Delivery Integration

Project (and program) action items can be linked to bi-weekly reports and are pulled into the Delivery Presentation. The bi-weekly presentation renders linked action items with their current status and carryover context.

### API Endpoints (project scope shown; account/program mirror the pattern)

| Method | Endpoint | Description |
|---|---|---|
| `GET/POST` | `/api/report/project/:projectId/action-items` | List / create |
| `GET/PUT/DELETE` | `/api/report/action-item/:id` | Read / update / delete |
| `POST` | `/api/report/action-item/:id/transition` | Move to next status |
| `POST` | `/api/report/action-item/:id/comments` | Add a comment |
| `PUT/DELETE` | `/api/report/action-item/comment/:commentId` | Edit / delete a comment |
| `GET` | `/api/report/my/{project,account,program}-action-items` | Items assigned to me |
| `GET/POST/DELETE` | `/api/report/biweekly/:id/action-items` | Manage bi-weekly ↔ action item links |

---

## Excel / CSV Data Import

Not every delivery team works in Jira. A project can instead be fed from a spreadsheet the team
already produces — an `.xlsx` or `.csv` export uploaded on the **Data Imports** page. Once uploaded,
that project behaves like any other: the same daily DSRs, sprint scorecards and Team Performance
views are generated from it, and Jira-only UI is hidden.

The customer's export is used as-is. There is no requirement to reshape it into our format — column
headers are mapped once, per project.

### Setting Up a Project

1. **Create the project** with data source **Excel**, and choose a reporting frequency:
   - **Daily** — each upload is a snapshot for one date.
   - **Sprint** — each upload belongs to a named sprint, and re-uploading that sprint updates it.
2. **Map the columns.** In project settings, upload a sample of the customer's export and match each
   of their headers to the corresponding field (external ID, title, status, assignee, story points,
   sprint, dates). A downloadable reference template is also available if the team would rather
   adopt our layout.
   > **A field left unmapped imports as blank.** This is the most common setup mistake — an unmapped
   > estimate column is why story points come through as zero. The upload screen now names any
   > column it could not find, before the data is written.
3. **Adjust later if the export changes.** The mapping can be edited at any time; each change is
   kept as a new version, so it stays clear which mapping a past upload was read with.

### Uploading Data

Choose the file and the app checks it before anything is stored, showing:

- **Column check** — which field resolved to which column, and any mapped column missing from the
  file.
- **Row validation** — malformed or incomplete rows, and any values it adjusted (for example `5 SP`
  read as `5`).
- **Impact summary** — if the target sprint already holds data: how many tickets would be updated,
  how many are new, and how many stored tickets are *absent* from this file. You then choose:
  - **Merge** (default) — update matching tickets, add new ones, keep the rest. Re-uploading the
    same file changes nothing; tickets are never duplicated.
  - **Replace** — treat the file as the full truth for those sprints; stored tickets missing from it
    are removed.

Sprint-based projects name the sprint at upload, so an export with no sprint column still lands in
the right place — and the next upload of that sprint merges with it.

### What You Get

Excel-backed projects feed the same outputs as Jira-backed ones: daily DSRs and health, sprint
scorecards, per-developer delivery breakdowns, and the Team Performance and portfolio views.

One expectation to set: a spreadsheet is a point-in-time snapshot with no change history. Metrics
reconstructed from a ticket's changelog — churn, reopen rate, cycle time and QA-quality signals —
are therefore unavailable for these projects. Everything derivable from the current state of a
ticket (scope, completion, spillover, defect counts, per-developer delivery) is present.

### Uploaded Files

Every upload is kept. From the Data Imports page you can view the rows exactly as they were
imported, download the original file, or re-run a retained file against the current column mapping —
so a mapping correction does not mean hunting down the spreadsheet again. Deleting an upload reverts
its effect without disturbing the others.

Retained files are written under `UPLOAD_PATH` (see [Setup](#setup)), **which must point at a
persistent volume in production** — otherwise files are lost on redeploy.

Common questions — including why story points import as zero, and when to choose Merge over
Replace — are answered in **section 12 of the in-app FAQ** (`/faq`).

---

## Notifications

A configurable notification system for risk and action-item events (superuser admin, mounted at `/api/admin/notifications`). It manages **templates**, **rules**, **event logs**, and **pending aggregates** so multiple events can be batched into a single digest rather than firing one message each.

| Method | Endpoint | Description |
|---|---|---|
| `GET` | `/api/admin/notifications/events` | Available event types |
| `GET/POST/PUT/DELETE` | `/api/admin/notifications/templates` | Manage message templates |
| `GET/POST/PUT/DELETE` | `/api/admin/notifications/rules` | Manage delivery rules |
| `GET` | `/api/admin/notifications/logs`, `/logs/pending`, `/logs/:id` | Delivery logs and pending digests |

---

## Claude Usage & Prompt Coaching

A collector running on each developer's laptop reads local Claude Code session logs (timestamps and token counts only — **never prompt or answer text**) and reports usage signals into the app, framed explicitly as coaching, not a scorecard or ranking.

### Individual & Team Views

- **My Claude Report** — split into an **Overview** tab (Avg score, Good/OK/Poor mix, a separate skill-tier chip, habits & capabilities like skills/MCP/plan-mode/subagent usage) and a **Details** tab ("where your tokens go": prompt-caching hit rate, context loss from compaction, session shape, parallel work / session switches, pace between prompts, and model fit).
- **Team Prompt Coaching** (superuser / admin / manager / lead) — the same signal aggregated across a team, plus per-member efficiency columns (cache hit, context lost, avg session size, peak parallel work). It deliberately never surfaces a member's vibe-coding index or personal AI coaching tips, and the member table sorts by score, not efficiency.
- **Claude Usage Guide** — an in-app orientation page explaining what each section means and how to act on it (see the in-app FAQ's Claude Usage section for the same content in Q&A form).

### Privacy & Eligibility Safeguards

- VPN privacy safeguard — usage is not recorded while a laptop is on VPN; deferred days are tracked (`vpn_deferrals`) and caught up once off VPN.
- Collector version enforcement — an out-of-date collector build can be blocked from reporting until updated (`CollectorVersionPolicy`).
- Per-project opt-in — a project only shows Claude-usage screens (nav, dashboard card, Team Prompt Coaching) to its members once its **Dev Assistant AI Tool** setting (project settings) is set to `Claude`; it defaults to `None`.
- Ingest audit log — Claude usage ingest events are logged for integrity checks, with IP address intentionally excluded from that log.

### Admin Views

- **AI Spend** — tracks the app's own Anthropic API token spend (superuser), separate from the collector-based developer coaching data above.
- **Claude Pricing**, **Data Integrity**, **Collector Installs**, **Monitored Orgs** — admin screens for model pricing config, ingest data-quality checks, collector install/version tracking, and which orgs are monitored.

### Collector Tool

The collector itself lives in `tools/claude-usage-collector/` with its own [README](tools/claude-usage-collector/README.md) and `TESTING.md` — covering per-OS install (Windows and Mac), VPN detection, and configuration.

---

## E2E Test Suite

Playwright-based end-to-end tests live in `e2e/` and cover all major user flows.

### Running Tests

```bash
cd e2e
npx playwright test                    # run all tests
npx playwright test tests/risk-editing.spec.ts  # run one file
npx playwright test --reporter=html    # generate HTML report
```

The test suite expects the frontend dev server (`http://localhost:5173`) and backend (`http://localhost:3000`) to be running. The Playwright config starts the frontend dev server automatically via `webServer` if it is not already running.

### Test Data Seeding

Tests that require data (e.g. risk board tests, dashboard panel tests) seed records via the backend REST API before the suite runs and tear them down after. All seeded records are tagged with `[E2E-TEST]` in the title so they are easy to identify.

**Orphan protection** — seeded IDs are persisted to `/tmp/dsr-e2e-seeds.json` immediately after creation. Three layers of cleanup ensure test data never remains in the database permanently:

1. **`afterAll` hook** — runs after each describe block, deletes records created by that suite.
2. **`cleanupOrphanedSeeds()`** — called at the start of each `beforeAll`, deletes any IDs left over from a previous crashed run.
3. **Global teardown** — Playwright runs `e2e/global-teardown.ts` after the entire suite finishes, clearing any remaining records and removing the state file.

### Test Coverage

| File | What It Tests |
|---|---|
| `auth.spec.ts` | Login / logout / session |
| `risk-editing.spec.ts` | Risk board CRUD, edit modal, AI summary |
| `dashboard-superuser.spec.ts` | Top Risks panel, Project Health list layout |
| `dashboard-risk-viewer.spec.ts` | Read-only risk modal from dashboard |
| `dashboard-action-items.spec.ts` | Top Risks panel, AI summary persistence, project health navigation |
| `dashboard-manager.spec.ts` | Manager tile view, project drill-down |
| `dashboard-lead.spec.ts` | Lead single-project view |
| `project-insights.spec.ts` | Manager insights widget |
| `action-item-comments.spec.ts` | Action item comment thread |
| `nav-access.spec.ts` | Role-based navigation access control |

---

## Project Structure

```
dsr-generator/
├── frontend/             # React 19 + Vite + MUI v7 frontend
│   ├── src/
│   │   ├── features/             # Feature-based UI modules
│   │   │   ├── reports/          # Reports + portfolio presentation + bi-weekly
│   │   │   ├── risk-management/  # Risk Kanban board + detail modal + AI summary
│   │   │   ├── action-items/     # Project/account/program action items + comments
│   │   │   ├── performance-review/ # Review cycles: admin wizard, lead review, member view
│   │   │   ├── faq/              # In-app FAQ / Help page
│   │   │   └── ...               # Dashboard, TeamPerformance, user management, etc.
│   │   ├── routes/               # Route tree, PATHS, ProtectedRoute, deep links
│   │   ├── api/                  # Axios API client (JWT interceptor)
│   │   ├── shared/               # Shared components (NotFound, custom sections)
│   │   └── types/                # Shared TypeScript interfaces
│   └── package.json
├── backend/              # Node.js + Express + TypeScript backend
│   ├── src/
│   │   ├── modules/
│   │   │   ├── reports/          # Daily/Weekly/Account/Program/Biweekly + Portfolio Presentation
│   │   │   ├── risks/            # Risk board service + controller + routes
│   │   │   ├── programs/         # Program (project grouping) CRUD + ownership
│   │   │   ├── notifications/    # Templates, rules, logs, pending aggregates + queue
│   │   │   ├── projects/         # Project CRUD
│   │   │   ├── performanceReview/ # Review cycles, identity resolution, lead review, scoring
│   │   │   ├── accounts/ admin/ member/  # Account CRUD, admin, member dashboard
│   │   │   └── team/             # Team performance sync
│   │   ├── models/               # Sequelize-TypeScript models
│   │   ├── migrations/           # Sequelize migration files
│   │   ├── middleware/           # Auth + role middleware
│   │   └── config/               # DB connection + model registration
│   └── package.json
├── e2e/                  # Playwright end-to-end test suite
│   ├── tests/
│   │   ├── api-seed.ts           # API-based test data seeding with orphan protection
│   │   ├── helpers.ts            # Shared login helpers
│   │   └── *.spec.ts             # Test files per feature area
│   ├── global-teardown.ts        # Post-suite cleanup
│   └── playwright.config.ts
└── reports/              # Generated reports (Excel & JSON, gitignored)
```

## Quick Start

### Prerequisites

- Node.js 18+
- PostgreSQL 14+
- Jira account with API token
- Anthropic API key (for AI analysis)

### Setup

1. **Navigate to backend:**
   ```bash
   cd backend
   ```

2. **Install dependencies:**
   ```bash
   npm install
   ```

3. **Configure environment:**
   ```bash
   cp .env.example .env
   # Edit .env with your credentials
   ```
   Alongside the credentials, set the two filesystem paths: `REPORTS_PATH` (generated reports) and
   `UPLOAD_PATH` (retained Excel/CSV uploads). In production both should be persistent volumes —
   `UPLOAD_PATH` especially, since uploaded files are served back to users for download and
   re-import.

4. **Create database:**
   ```bash
   createdb jira_daily_reports
   ```

5. **Run migrations:**
   ```bash
   npx sequelize-cli db:migrate
   ```

6. **Run development server:**
   ```bash
   npm run dev
   ```

Server runs on http://localhost:3000

## Tech Stack

- **Frontend**: React 19 + TypeScript + Vite + Material UI v7 + Recharts + React Router v6 + TanStack Query + dayjs
- **Backend**: Node.js + TypeScript + Express + BullMQ + Redis
- **Database**: PostgreSQL + Sequelize ORM v6
- **AI**: Anthropic Claude (Context Caching Enabled)
- **Reports**: ExcelJS + PptxGenJS (server); html2canvas + jsPDF for WYSIWYG presentation PDF export (client)
- **Drag & Drop**: @dnd-kit (Risk Board Kanban)
- **Testing**: Playwright (E2E) with API-based seeding
- **Production**: Docker + npm start

## License

MIT
