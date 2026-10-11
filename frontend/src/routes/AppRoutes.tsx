import { lazy, Suspense } from 'react';
import { Routes, Route, Navigate, Outlet, useNavigate, useSearchParams, useLocation } from 'react-router-dom';
import { Box, CircularProgress } from '@mui/material';
import { PATHS } from './paths';
import { ProtectedRoute } from './ProtectedRoute';
import { useAuth } from '../context/AuthContext';
import { useClaudeUsageAccess } from '../features/claude-usage/hooks';
import { useActiveAccountProjects } from '../shared/hooks/useActiveAccountProjects';
import { ClaudeUsageComingSoon } from '../features/claude-usage/ClaudeUsageComingSoon';

// Eagerly loaded: Login (pre-auth landing) and Dashboard (post-auth landing).
// Loading these lazily would add a round-trip to the most critical paths.
import { Login } from '../features/auth/LoginPage';
import { Dashboard } from '../features/dashboard/Dashboard';
import { PortfolioPresentationEditPage } from '../features/reports/portfolio/PortfolioPresentationEditPage';
import { PortfolioPresentationViewPage } from '../features/reports/portfolio/PortfolioPresentationViewPage';
import { useAccount } from '../context/UseAccount';

// Everything else is code-split. Each route becomes its own chunk so users
// only download the pages they actually visit, and role-gated pages
// (admin, sprints) never reach non-privileged sessions.
const DailyReport = lazy(() =>
  import('../features/reports/daily/DailyReport').then(m => ({ default: m.DailyReport }))
);
const CustomRangeReport = lazy(() =>
  import('../features/reports/customRange/CustomRangeReport').then(m => ({ default: m.CustomRangeReport }))
);
const WeeklyReport = lazy(() =>
  import('../features/reports/weekly/WeeklyReport').then(m => ({ default: m.WeeklyReport }))
);
const AccountWeeklyReport = lazy(() =>
  import('../features/reports/weekly/AccountWeeklyReport').then(m => ({ default: m.AccountWeeklyReport }))
);
const MonthlyProjectReport = lazy(() =>
  import('../features/reports/monthly/MonthlyProjectReport').then(m => ({ default: m.MonthlyProjectReport }))
);
const MonthlyAccountReport = lazy(() =>
  import('../features/reports/monthly/MonthlyAccountReport').then(m => ({ default: m.MonthlyAccountReport }))
);
const WeeklyProgramReport = lazy(() =>
  import('../features/reports/program/WeeklyProgramReport').then(m => ({ default: m.WeeklyProgramReport }))
);
const MonthlyProgramReport = lazy(() =>
  import('../features/reports/program/MonthlyProgramReport').then(m => ({ default: m.MonthlyProgramReport }))
);
const DailyProgramReport = lazy(() =>
  import('../features/reports/program/DailyProgramReport').then(m => ({ default: m.DailyProgramReport }))
);
const PortfolioPresentationList = lazy(() =>
  import('../features/reports/portfolio/PortfolioPresentationList').then(m => ({ default: m.PortfolioPresentationList }))
);
const ActionItemsPage = lazy(() =>
  import('../features/action-items/ActionItemsPage').then(m => ({ default: m.ActionItemsPage }))
);
const RetroBoardListPage = lazy(() => import('../features/retro-board/RetroBoardListPage'));
const RetroBoardPage = lazy(() => import('../features/retro-board/RetroBoardPage'));
const RiskBoard = lazy(() =>
  import('../features/risk-management/RiskBoard').then(m => ({ default: m.RiskBoard }))
);
const TeamPerformanceReport = lazy(() =>
  import('../features/team-performance/TeamPerformanceReport').then(m => ({ default: m.TeamPerformanceReport }))
);
const LeadReviewWorkspace = lazy(() =>
  import('../features/performance-review/lead/LeadReviewWorkspace').then(m => ({ default: m.LeadReviewWorkspace }))
);
const MyPerformanceReview = lazy(() =>
  import('../features/performance-review/member/MyPerformanceReview').then(m => ({ default: m.MyPerformanceReview }))
);
const ExecutiveDashboard = lazy(() =>
  import('../features/executive/ExecutiveDashboard').then(m => ({ default: m.ExecutiveDashboard }))
);
const DataImportsPage = lazy(() =>
  import('../features/data-imports/DataImportsPage').then(m => ({ default: m.DataImportsPage }))
);
const AdminPage = lazy(() =>
  import('../features/admin/AdminPage').then(m => ({ default: m.AdminPage }))
);
const EngineeringSopPage = lazy(() =>
  import('../features/sop/EngineeringSopPage').then(m => ({ default: m.EngineeringSopPage }))
);
const FAQPage = lazy(() =>
  import('../features/faq/FAQPage').then(m => ({ default: m.FAQPage }))
);
const MyClaudeReport = lazy(() =>
  import('../features/claude-usage/MyClaudeReport').then(m => ({ default: m.MyClaudeReport }))
);
const TeamClaudeReport = lazy(() =>
  import('../features/claude-usage/TeamClaudeReport').then(m => ({ default: m.TeamClaudeReport }))
);
const ClaudeUsageGuide = lazy(() =>
  import('../features/claude-usage/ClaudeUsageGuide').then(m => ({ default: m.ClaudeUsageGuide }))
);
const TeamMemberDetail = lazy(() =>
  import('../features/claude-usage/TeamMemberDetail').then(m => ({ default: m.TeamMemberDetail }))
);

const RouteFallback = () => (
  <Box sx={{ display: 'flex', justifyContent: 'center', alignItems: 'center', p: 6 }}>
    <CircularProgress />
  </Box>
);

// ─── Helpers ──────────────────────────────────────────────────────────────────

// Used as the index route inside ProtectedRoute. Authenticated users land here
// from "/" and get sent to the dashboard, preserving any query string so flags
// like ?expired=true survive the redirect chain (relevant when unauthenticated
// users hit "/?expired=true" and bounce out via ProtectedRoute → Login).
function IndexRedirect() {
  const location = useLocation();
  const { user } = useAuth();
  const isExecutive = (user)?.roleName === 'executive';
  // Executives never see the internal Dashboard — send them straight to their view.
  const target = isExecutive ? PATHS.EXECUTIVE_DASHBOARD : PATHS.DASHBOARD;
  return <Navigate to={`${target}${location.search}`} replace />;
}

// The /login route. When an authenticated user lands here, send them back to the
// location they were originally trying to reach (set by ProtectedRoute as
// location.state.from) — this makes shared deep links work after a login prompt.
// Falls back to the Dashboard when there's no return target.
// Pilot gate for the Claude Usage feature's OWN report (`/claude-usage/me` only —
// ADDENDUM 23: the Team route no longer uses this guard at all, since team view
// doesn't depend on the viewer's own enrollment; see backend/src/modules/member/routes).
// Renders nothing until the allowlist check resolves; shows a friendly "coming soon"
// screen in place rather than a silent redirect for non-pilot users.
function ClaudeUsageGuard() {
  const { data, isLoading } = useClaudeUsageAccess();
  if (isLoading) return <RouteFallback />;
  if (!data?.enabled) return <ClaudeUsageComingSoon />;
  return <Outlet />;
}

// Project-level gate (ADDENDUM 25): does the viewer have access to at least
// one project whose Dev Assistant AI Tool is set to Claude? If not, EVERY
// Claude-usage route redirects silently to the dashboard — no message, not
// even "coming soon", since that project genuinely isn't using Claude at
// all. This sits OUTSIDE ClaudeUsageGuard (project relevance first, then the
// existing per-user pilot enrollment), and wraps Team Prompt Coaching /
// member-detail on its own — those never had a Claude-specific guard before.
function ClaudeProjectGuard() {
  const { hasClaudeProjects, loading } = useActiveAccountProjects();
  if (loading) return <RouteFallback />;
  if (!hasClaudeProjects) return <Navigate to={PATHS.DASHBOARD} replace />;
  return <Outlet />;
}

function LoginRoute() {
  const { isAuthenticated, isLoading } = useAuth();
  const location = useLocation();
  const from = (location.state as { from?: { pathname: string; search: string } } | null)?.from;

  if (!isLoading && isAuthenticated) {
    const target = from ? `${from.pathname}${from.search}` : PATHS.DASHBOARD;
    return <Navigate to={target} replace />;
  }
  return <Login />;
}

// ─── Page wrappers ────────────────────────────────────────────────────────────
// Each wrapper translates URL context (searchParams, navigate) into the props
// the existing components expect. Components themselves are unchanged.

function DashboardPage() {
  const navigate = useNavigate();
  const { user } = useAuth();
  const { accounts, activeAccount } = useAccount();
  // Guard the internal Dashboard against executives reaching it by URL.
  if ((user)?.roleName === 'executive') {
    return <Navigate to={PATHS.EXECUTIVE_DASHBOARD} replace />;
  }
  return (
    <Dashboard
      accounts={accounts}
      selectedAccount={activeAccount}
      user={user}
      onNavigateToProject={(projectId?: number) =>
        navigate(`${PATHS.REPORTS_DAILY}?projectId=${projectId ?? ''}&from=dashboard`)
      }
      onNavigateToRisks={() => navigate(PATHS.RISK_MANAGEMENT)}
      onNavigateToActionItems={() => navigate(PATHS.ACTION_ITEMS)}
    />
  );
}

function DailyReportPage() {
  const navigate = useNavigate();
  const [searchParams, setSearchParams] = useSearchParams();
  const { accounts, activeAccount } = useAccount();

  const projectId = searchParams.get('projectId') ? Number(searchParams.get('projectId')) : null;
  const from = searchParams.get('from');

  return (
    <DailyReport
      accounts={accounts}
      selectedAccount={activeAccount}
      initialProjectId={projectId}
      onProjectSelected={() => {
        searchParams.delete('projectId');
        searchParams.delete('from');
        setSearchParams(searchParams);
      }}
      onBack={from === 'dashboard' ? () => navigate(PATHS.DASHBOARD) : undefined}
    />
  );
}

function WeeklyProjectPage() {
  const { accounts, activeAccount } = useAccount();
  return <WeeklyReport accounts={accounts} selectedAccount={activeAccount} />;
}

function WeeklyAccountPage() {
  const { accounts, activeAccount } = useAccount();
  return <AccountWeeklyReport accounts={accounts} selectedAccount={activeAccount} />;
}

function MonthlyProjectPage() {
  const { accounts, activeAccount } = useAccount();
  return <MonthlyProjectReport accounts={accounts} selectedAccount={activeAccount} />;
}

function MonthlyAccountPage() {
  const { accounts, activeAccount } = useAccount();
  return <MonthlyAccountReport accounts={accounts} selectedAccount={activeAccount} />;
}

function WeeklyProgramPage() {
  const { accounts, activeAccount } = useAccount();
  return <WeeklyProgramReport accounts={accounts} selectedAccount={activeAccount} />;
}

function MonthlyProgramPage() {
  const { accounts, activeAccount } = useAccount();
  return <MonthlyProgramReport accounts={accounts} selectedAccount={activeAccount} />;
}

function DailyProgramPage() {
  const { accounts, activeAccount } = useAccount();
  return <DailyProgramReport accounts={accounts} selectedAccount={activeAccount} />;
}

function PortfolioPresentationPage() {
  const { accounts, activeAccount } = useAccount();
  return <PortfolioPresentationList accounts={accounts} selectedAccount={activeAccount} />;
}


function ActionItemsRoutePage() {
  const { accounts, activeAccount } = useAccount();
  return <ActionItemsPage accounts={accounts} selectedAccount={activeAccount} />;
}

function TeamPerformancePage({ mainTab }: { mainTab: 'sprint' | 'trends' }) {
  const { accounts, activeAccount } = useAccount();
  return <TeamPerformanceReport accounts={accounts} selectedAccount={activeAccount} mainTab={mainTab} />;
}

function DataImportsRoutePage() {
  const { accounts, activeAccount } = useAccount();
  return <DataImportsPage accounts={accounts} selectedAccount={activeAccount} />;
}

// ─── Route tree ───────────────────────────────────────────────────────────────

export const AppRoutes = () => {
  const { isAuthenticated } = useAuth();

  // While auth is loading, ProtectedRoute renders its own spinner
  return (
    <Routes>
      {/* Public */}
      <Route path={PATHS.LOGIN} element={<LoginRoute />} />

      {/* Protected layout shell (App.tsx renders Outlet). One Suspense
          boundary covers every code-split route below. */}
      <Route
        element={
          <Suspense fallback={<RouteFallback />}>
            <ProtectedRoute />
          </Suspense>
        }
      >
        <Route index element={<IndexRedirect />} />
        <Route path={PATHS.DASHBOARD} element={<DashboardPage />} />

        {/* Executive Dashboard — customer-facing, read-only. Superuser can preview. */}
        <Route element={<ProtectedRoute allowedRoles={['superuser', 'executive']} />}>
          <Route path={PATHS.EXECUTIVE_DASHBOARD} element={<ExecutiveDashboard />} />
        </Route>

        {/* Reports */}
        <Route path={PATHS.REPORTS_DAILY} element={<DailyReportPage />} />
        <Route path={PATHS.REPORTS_WEEKLY_PROJECT} element={<WeeklyProjectPage />} />
        <Route path={PATHS.REPORTS_MONTHLY_PROJECT} element={<MonthlyProjectPage />} />

        {/* Custom Range Report — lead and above; backend scopes to assigned projects */}
        <Route element={<ProtectedRoute allowedRoles={['superuser', 'admin', 'manager', 'lead']} />}>
          <Route path={PATHS.REPORTS_CUSTOM_RANGE} element={<CustomRangeReport />} />
        </Route>

        {/* Account-level reports — not for leads */}
        <Route element={<ProtectedRoute allowedRoles={['superuser', 'admin', 'manager']} />}>
          <Route path={PATHS.REPORTS_WEEKLY_ACCOUNT} element={<WeeklyAccountPage />} />
          <Route path={PATHS.REPORTS_MONTHLY_ACCOUNT} element={<MonthlyAccountPage />} />
        </Route>

        {/* Program-level reports — superuser, admin, manager (program owners are managers).
            Backend additionally restricts to designated owners only — see Phase 6. */}
        <Route element={<ProtectedRoute allowedRoles={['superuser', 'admin', 'manager']} />}>
          <Route path={PATHS.REPORTS_DAILY_PROGRAM} element={<DailyProgramPage />} />
          <Route path={PATHS.REPORTS_WEEKLY_PROGRAM} element={<WeeklyProgramPage />} />
          <Route path={PATHS.REPORTS_MONTHLY_PROGRAM} element={<MonthlyProgramPage />} />
        </Route>

        {/* Portfolio Presentation — superuser, admin, manager, lead.
            Backend additionally enforces per-project access (≥1 included project)
            for non-superuser/non-admin users. */}
        <Route element={<ProtectedRoute allowedRoles={['superuser', 'admin', 'manager', 'lead']} />}>
          <Route path={PATHS.PORTFOLIO_PRESENTATION} element={<PortfolioPresentationPage />} />
        </Route>

         <Route element={<ProtectedRoute allowedRoles={['superuser', 'admin', 'manager', 'lead']} />}>
          <Route path={PATHS.PORTFOLIO_PRESENTATION_CREATE} element={<PortfolioPresentationEditPage />} />
          <Route path={PATHS.PORTFOLIO_PRESENTATION_EDIT} element={<PortfolioPresentationEditPage />} />
        {/* Shareable deep link to a single presentation. Authentication-only —
            role/project access is enforced by the API, and any denial (403/404)
            renders the in-page 404 instead of redirecting to Dashboard. */}
          <Route path={PATHS.PORTFOLIO_PRESENTATION_VIEW} element={<PortfolioPresentationViewPage />} />
        </Route>




        {/* Management — Action Items hidden from members */}
        <Route element={<ProtectedRoute allowedRoles={['superuser', 'admin', 'manager', 'lead']} />}>
          <Route path={PATHS.ACTION_ITEMS} element={<ActionItemsRoutePage />} />
        </Route>
        {/* Board View exposes derived scores — keep it to internal roles, exclude executives */}
        <Route element={<ProtectedRoute allowedRoles={['superuser', 'admin', 'manager', 'lead', 'member']} />}>
          <Route path={PATHS.TEAM_PERFORMANCE_SPRINT} element={<TeamPerformancePage mainTab="sprint" />} />
        </Route>
        {/* A member's own review — every role can have one, so this is normally open to
            everyone who is not executive (customer-facing, never a reviewee).
            Hidden from everyone but superusers for now (pre-launch); original
            allowedRoles to restore later: ['superuser','admin','manager','lead','member']. */}
        <Route element={<ProtectedRoute allowedRoles={['superuser']} />}>
          <Route path={PATHS.MY_PERFORMANCE_REVIEW} element={<MyPerformanceReview />} />
        </Route>
        {/* Trends is a cross-project org-wide view — not for members */}
        <Route element={<ProtectedRoute allowedRoles={['superuser', 'admin', 'manager', 'lead']} />}>
          <Route path={PATHS.TEAM_PERFORMANCE_TRENDS} element={<TeamPerformancePage mainTab="trends" />} />
        </Route>
        {/* The reviewer's worklist. Members reach their own review elsewhere and must
            never see a roster of other people's reviews. Hidden from everyone but
            superusers for now (pre-launch); original allowedRoles to restore later:
            ['superuser','admin','manager','lead']. */}
        <Route element={<ProtectedRoute allowedRoles={['superuser']} />}>
          <Route path={PATHS.TEAM_REVIEWS} element={<LeadReviewWorkspace />} />
        </Route>
        <Route path={PATHS.TEAM_PERFORMANCE} element={<Navigate to={PATHS.TEAM_PERFORMANCE_SPRINT} replace />} />
        <Route element={<ProtectedRoute allowedRoles={['superuser', 'admin', 'manager', 'lead']} />}>
          <Route path={PATHS.RISK_MANAGEMENT} element={<RiskBoard />} />
        </Route>

        {/* Retro Boards. The LIST is lead-and-above, because only they create
            boards. The BOARD ITSELF is authentication-only, following the
            presentation deep-link precedent above: members are participants and
            must be able to open a shared link. Project-team access is enforced
            by the API, and a denial renders in-page rather than bouncing. */}
        {/* Members included: a retro belongs to the whole project team, and the
            API already scopes the list per user. This must stay in step with
            canSeeRetroBoard (!isExecutive) in usePermissions — when the two
            diverged, members saw the nav entry and were then redirected away.
            Executives are excluded on purpose: customer-facing read-only role,
            internal retro content is not for them. */}
        <Route element={<ProtectedRoute allowedRoles={['superuser', 'admin', 'manager', 'lead', 'member']} />}>
          <Route path={PATHS.RETRO_BOARDS} element={<RetroBoardListPage />} />
        </Route>
        <Route path={PATHS.RETRO_BOARD_VIEW} element={<RetroBoardPage />} />

        {/* Data Imports — same audience as Presentation/Risk Board (Superuser/Admin/Manager/Lead) */}
        <Route element={<ProtectedRoute allowedRoles={['superuser', 'admin', 'manager', 'lead']} />}>
          <Route path={PATHS.DATA_IMPORTS} element={<DataImportsRoutePage />} />
        </Route>

        {/* Administration — superuser and admin only */}
        <Route element={<ProtectedRoute allowedRoles={['superuser', 'admin']} />}>
          <Route path={PATHS.ADMIN} element={<Navigate to={PATHS.ADMIN_ACCOUNTS} replace />} />
          <Route path={`${PATHS.ADMIN}/*`} element={<AdminPage />} />
        </Route>

        {/* My Claude Report — internal roles, a project on Claude, AND in the pilot
            allowlist. ClaudeProjectGuard (project-level, ADDENDUM 25) sits OUTSIDE
            ClaudeUsageGuard (per-user pilot) — a project not on Claude redirects
            silently to the dashboard, no message; only once a Claude project exists
            does the pilot gate get a chance to show "coming soon". */}
        <Route element={<ProtectedRoute allowedRoles={['superuser', 'admin', 'manager', 'lead', 'member']} />}>
          <Route element={<ClaudeProjectGuard />}>
            <Route element={<ClaudeUsageGuard />}>
              <Route path={PATHS.MY_CLAUDE_REPORT} element={<MyClaudeReport />} />
              {/* One-page "how to read this" orientation — same pilot gate as the
                  report itself; its own sidebar entry, below My Claude Report and
                  Team Prompt Coaching. */}
              <Route path={PATHS.CLAUDE_USAGE_GUIDE} element={<ClaudeUsageGuide />} />
            </Route>
          </Route>
        </Route>
        {/* Team Prompt Coaching — lead and above. ADDENDUM 23: role alone is the gate,
            no per-user pilot check. ADDENDUM 25 adds ClaudeProjectGuard on its own
            (no pilot layer here either, matching the existing role-only precedent) —
            a lead with no Claude project redirects silently, same as My Claude Report. */}
        <Route element={<ProtectedRoute allowedRoles={['superuser', 'admin', 'manager', 'lead']} />}>
          <Route element={<ClaudeProjectGuard />}>
            <Route path={PATHS.TEAM_CLAUDE_REPORT} element={<TeamClaudeReport />} />
            {/* One team member's detail — same role tier as the roster above;
                access to the SPECIFIC member is enforced server-side. */}
            <Route path={PATHS.TEAM_MEMBER_DETAIL} element={<TeamMemberDetail />} />
          </Route>
        </Route>

        {/* Engineering SOP — open to every authenticated user */}
        <Route path={PATHS.ENGINEERING_SOP} element={<EngineeringSopPage />} />

        {/* FAQ — open to every authenticated user */}
        <Route path={PATHS.FAQ} element={<FAQPage />} />
      </Route>

      {/* Catch-all */}
      <Route
        path="*"
        element={
          isAuthenticated
            ? <Navigate to={PATHS.DASHBOARD} replace />
            : <Navigate to={PATHS.LOGIN} replace />
        }
      />
    </Routes>
  );
};
