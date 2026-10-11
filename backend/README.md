# DSR Generator - Backend

Jira Daily Status Report Generator with AI-powered analysis.

## Tech Stack

- **Runtime**: Node.js + TypeScript
- **Framework**: Express.js
- **Database**: PostgreSQL + Sequelize ORM
- **AI**: Anthropic Claude
- **Scheduler**: node-schedule
- **Production**: PM2, Docker

## Project Structure

```
backend/
├── src/
│   ├── modules/
│   │   ├── reports/         # Report generation module
│   │   ├── jira/            # Jira integration
│   │   ├── ai/              # AI analysis
│   │   ├── performanceReview/ # Review cycles, identity resolution, lead review, scoring
│   │   └── scheduler/       # Cron scheduler
│   ├── common/
│   │   ├── types/           # TypeScript types
│   │   └── utils/           # Utilities (Excel, JSON generators)
│   ├── config/              # Configuration
│   ├── models/              # Sequelize models
│   ├── app.ts               # Express app
│   └── server.ts            # Entry point
├── Dockerfile.dev
├── Dockerfile.prod
└── package.json
```

## Setup

### 1. Install Dependencies

```bash
cd backend
npm install
```

### 2. Configure Environment

```bash
cp .env.example .env
# Edit .env with your credentials
```

### 3. Database Setup

Make sure PostgreSQL is running and create the database:

```bash
createdb jira_daily_reports
```

### 4. Run Migrations (if any)

```bash
npm run migrate
```

## Development

```bash
npm run dev
```

Server runs on http://localhost:3000

## Report Generation Logic

### 1. Daily Status Report (DSR)
**Goal:** Track daily progress, risks, and health.
**Trigger:** Scheduled Cron (6:30 PM IST) or Manual API trigger.
**Logic:**
- **Time Window:** Captures activity from the *end of the previous report* up to the *current execution time*. 
  - If a report exists for yesterday, the window starts from yesterday's report timestamp.
  - If no recent report exists, it defaults to a 24-hour lookback.
- **Activity Tracking:**
  - **Jira Integration:** Fetches tickets from configured boards.
  - **Activity Criteria:** Tickets are included if they have *status changes* or *comments* within the time window.
  - **Weekend Logic:** If run on Monday, it auto-detects and includes activity from Friday night, Saturday, and Sunday.
- **AI Analysis:** 
  - Categorizes work into "Work Done", "Key Risks", "Plan for Tomorrow".
  - Extracts "Team Members" working on active tickets.

### 2. Project Weekly Report
**Goal:** Executive summary of the week's delivery, trends, and risks.
**Trigger:** Manual or Scheduled (End of Week).
**Logic:**
- **Data Source:** Aggregates all *Daily Status Reports* (DSRs) for the target week (Sunday to Saturday).
- **Trend Analysis:**
  - Calculates metrics: Average Active Tickets, Max Blocked Tickets, Approximate Throughput.
  - Compares these metrics against the *previous 2 weeks* to identify trends (e.g., "Velocity up 10%").
- **Executive Summary:** Generates a high-level 8-10 line summary focusing on achievements and critical risks for senior leadership.
- **Risk Assessment:** 
  - Highlights stale tickets (>3 days in progress).
  - **Health**: proportional average of the week's daily health (each day scores 0/1/2,
    averaged; Green if avg<0.35, Amber if avg<1.2, else Red — plus a majority-Red safety
    escalation). A single off day no longer taints an otherwise-Green week; a genuine pattern
    still does. See the root `README.md` → "Project Health Scoring" for the full daily formula,
    including the severity-weighted production-bug axis.

### 3. Account Weekly Report (Portfolio View)
**Goal:** Consolidated view of all projects under an account (e.g., "V2Solutions").
**Logic:**
- **Aggregation:** Fetches the latest *Project Weekly Report* for every project associated with the account.
- **Health Calculation (fully deterministic — AI can never set this color, up or down):**
  - **Red Threshold:** Configurable per account (`red_threshold_percentage`, default 30%). If `redCount / activeProjects ≥` this threshold, the account is **Red**.
  - **Amber Threshold:** Configurable per account (`amber_threshold_percentage`, default 20%). If `(redCount + amberCount) / activeProjects ≥` this threshold (and Red's threshold isn't met), the account is **Amber**. A single Amber project out of many no longer taints the whole account on its own.
  - `Unknown`-status projects are excluded from every count; if all projects are Unknown, the account is Unknown, not Green.
  - `red_projects` in the output is computed from project statuses, not AI-authored.
- **Output:**
  - **Project Table:** Summary, Status, and Risks for each project.
  - **Executive Narrative:** Portfolio-level observations and strategic recommendations.

### 4. Monthly Project Report
**Goal:** High-level monthly retrospective.
**Logic:**
- Aggregates all *Project Weekly Reports* for the calendar month.
- Synthesizes achievements and persistent risks.
- **Health**: deterministic, same proportional-average rule as weekly (each week in the month
  scores 0/1/2, averaged). Previously this was written straight from the AI's narrative with no
  check at all — now the AI writes the narrative only; the color is computed.

## API Endpoints

### Generate Report

```bash
POST /api/report
Content-Type: application/json

{
  "projectName": "LOWA",
  "boardId": 197
}
```

### Health Check

```bash
GET /api/health
```

## Docker

### Development

```bash
docker-compose up
```

### Production

```bash
docker-compose -f docker-compose.prod.yml up -d
```

## Production Deployment

```bash
npm run build
npm run prod
```

### PM2 Commands

```bash
npm run prod:stop
npm run prod:restart
npm run prod:logs
npm run prod:monit
```

## Scripts

- `npm run dev` - Development mode with auto-reload
- `npm run build` - Build TypeScript to JavaScript
- `npm start` - Run production build
- `npm run lint` - Run ESLint
- `npm run format` - Format code with Prettier
- `npm test` - Run tests
- `npm run migrate` - Run database migrations

## Environment Variables

See `.env.example` for all required environment variables.

## License

MIT
