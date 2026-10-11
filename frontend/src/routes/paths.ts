export const PATHS = {
  LOGIN: "/login",
  DASHBOARD: "/dashboard",
  REPORTS_DAILY: "/reports/daily",
  REPORTS_WEEKLY_PROJECT: "/reports/weekly-project",
  REPORTS_WEEKLY_ACCOUNT: "/reports/weekly-account",
  REPORTS_MONTHLY_PROJECT: "/reports/monthly-project",
  REPORTS_MONTHLY_ACCOUNT: "/reports/monthly-account",
  REPORTS_CUSTOM_RANGE: "/reports/custom-range",
  REPORTS_DAILY_PROGRAM: "/reports/daily-program",
  REPORTS_WEEKLY_PROGRAM: "/reports/weekly-program",
  REPORTS_MONTHLY_PROGRAM: "/reports/monthly-program",
  PORTFOLIO_PRESENTATION: "/presentations/delivery",
  PORTFOLIO_PRESENTATION_VIEW: "/presentations/delivery/:mode/:id",
  PORTFOLIO_PRESENTATION_CREATE: "/presentation/delivery/create",
  PORTFOLIO_PRESENTATION_EDIT: "/presentation/delivery/presentation/:id",
  ACTION_ITEMS: "/action-items",
  RISK_MANAGEMENT: "/risk-management",
  RETRO_BOARDS: "/retro",
  RETRO_BOARD_VIEW: "/retro/b/:token",
  TEAM_PERFORMANCE: "/team-performance",
  TEAM_PERFORMANCE_SPRINT: "/team-performance/sprint",
  TEAM_PERFORMANCE_TRENDS: "/team-performance/trends",
  TEAM_REVIEWS: "/team-performance/reviews",
  MY_PERFORMANCE_REVIEW: "/team-performance/my-review",
  EXECUTIVE_DASHBOARD: "/executive",
  DATA_IMPORTS: "/data-imports",
  ADMIN: "/admin",
  ADMIN_ACCOUNTS: "/admin/accounts",
  ADMIN_PROJECTS: "/admin/projects",
  ADMIN_TEAM_MEMBERS: "/admin/team-members",
  ADMIN_USER_MANAGEMENT: "/admin/user-management",
  ADMIN_PROGRAMS: "/admin/programs",
  ADMIN_NOTIFICATIONS: "/admin/notifications",
  ADMIN_USAGE: "/admin/usage",
  ADMIN_CLAUDE_PRICING: "/admin/claude-usage-admin",
  ENGINEERING_SOP: "/engineering-sop",
  FAQ: "/faq",
  MY_CLAUDE_REPORT: "/claude-usage/me",
  TEAM_CLAUDE_REPORT: "/claude-usage/team",
  TEAM_MEMBER_DETAIL: "/claude-usage/team/:userId",
  CLAUDE_USAGE_GUIDE: "/claude-usage/guide",
  ADMIN_AI_SPEND: "/admin/ai-spend"
} as const;

/** Build the concrete deep-link URL for a specific delivery presentation. */
export const portfolioPresentationViewUrl = (
  mode: string,
  id: number | string,
) => `/presentations/delivery/${mode}/${id}`;
export const portfolioPresentationCreateUrl = () =>
  `/presentation/delivery/create`;
export const portfolioPresentationEditUrl = (id: number | string) =>
  `/presentation/delivery/presentation/${id}`;

/**
 * Build the shareable deep-link URL for a retro board.
 *
 * The token is not a credential — opening this link still goes through the
 * project-team access check on the API. It only keeps the URL unguessable.
 */
export const retroBoardUrl = (token: string) => `/retro/b/${token}`;

/** Build the URL for a lead's click-through to one team member's Claude usage
 * detail. Access is enforced server-side (the target must be in the caller's
 * own team roster) — the id in the URL isn't itself a secret. */
export const teamMemberDetailUrl = (userId: number | string) => `/claude-usage/team/${userId}`;

/**
 * Labels for routes whose last path segment is an opaque id or token.
 *
 * Without these, the breadcrumb falls back to the final URL segment and renders
 * something like "ec021ffc-bf13-4951-b0ed-64cfc7797632" as the page heading.
 */
const DYNAMIC_PATH_LABELS: Array<{ test: RegExp; label: string }> = [
  { test: /^\/retro\/b\/[^/]+$/, label: "Retro Board" },
  {
    test: /^\/presentations\/delivery\/[^/]+$/,
    label: "Delivery Presentation",
  },
  { test: /^\/claude-usage\/team\/[^/]+$/, label: "Member Detail" },
];

/** Map a path to its parent section label for breadcrumbs */
export const PATH_SECTION: Partial<Record<string, string>> = {
  [PATHS.REPORTS_DAILY]: "Reports",
  [PATHS.REPORTS_WEEKLY_PROJECT]: "Reports",
  [PATHS.REPORTS_WEEKLY_ACCOUNT]: "Reports",
  [PATHS.REPORTS_MONTHLY_PROJECT]: "Reports",
  [PATHS.REPORTS_MONTHLY_ACCOUNT]: "Reports",
  [PATHS.REPORTS_CUSTOM_RANGE]: "Reports",
  [PATHS.REPORTS_DAILY_PROGRAM]: "Reports",
  [PATHS.REPORTS_WEEKLY_PROGRAM]: "Reports",
  [PATHS.REPORTS_MONTHLY_PROGRAM]: "Reports",
  [PATHS.PORTFOLIO_PRESENTATION]: "Presentation",
  [PATHS.TEAM_PERFORMANCE]: "Team Performance",
  [PATHS.TEAM_PERFORMANCE_SPRINT]: "Team Performance",
  [PATHS.TEAM_PERFORMANCE_TRENDS]: "Team Performance",
  [PATHS.TEAM_REVIEWS]: "Team Performance",
  [PATHS.MY_PERFORMANCE_REVIEW]: "Team Performance",
  [PATHS.ACTION_ITEMS]: "Management",
  [PATHS.RISK_MANAGEMENT]: "Management",
  [PATHS.RETRO_BOARDS]: "Management",
  [PATHS.DATA_IMPORTS]: "Data Imports",
  [PATHS.ADMIN_ACCOUNTS]: "Administration",
  [PATHS.ADMIN_PROJECTS]: "Administration",
  [PATHS.ADMIN_TEAM_MEMBERS]: "Administration",
  [PATHS.ADMIN_USER_MANAGEMENT]: "Administration",
  [PATHS.ADMIN_PROGRAMS]: "Administration",
  [PATHS.ADMIN_NOTIFICATIONS]: "Administration",
  [PATHS.ADMIN_USAGE]: "Administration",
  [PATHS.ADMIN_CLAUDE_PRICING]: "Administration",
  [PATHS.ADMIN_AI_SPEND]: "Administration",
};

/** Map a path to its display label for breadcrumbs and page headers */
export const PATH_LABEL: Partial<Record<string, string>> = {
  [PATHS.DASHBOARD]: "Dashboard",
  [PATHS.REPORTS_DAILY]: "Daily Reports",
  [PATHS.REPORTS_WEEKLY_PROJECT]: "Weekly Project",
  [PATHS.REPORTS_WEEKLY_ACCOUNT]: "Weekly Account",
  [PATHS.REPORTS_MONTHLY_PROJECT]: "Monthly Project",
  [PATHS.REPORTS_MONTHLY_ACCOUNT]: "Monthly Account",
  [PATHS.REPORTS_CUSTOM_RANGE]: "Custom Range Report",
  [PATHS.REPORTS_DAILY_PROGRAM]: "Daily Program",
  [PATHS.REPORTS_WEEKLY_PROGRAM]: "Weekly Program",
  [PATHS.REPORTS_MONTHLY_PROGRAM]: "Monthly Program",
  [PATHS.PORTFOLIO_PRESENTATION]: "Delivery Presentation",
  [PATHS.ACTION_ITEMS]: "Action Items",
  [PATHS.RISK_MANAGEMENT]: "Risk Board",
  [PATHS.RETRO_BOARDS]: "Retro Boards",
  [PATHS.TEAM_PERFORMANCE]: "Team Performance",
  [PATHS.TEAM_PERFORMANCE_SPRINT]: "Board View",
  [PATHS.TEAM_PERFORMANCE_TRENDS]: "Trends",
  [PATHS.TEAM_REVIEWS]: "Team Reviews",
  [PATHS.MY_PERFORMANCE_REVIEW]: "My Review",
  [PATHS.EXECUTIVE_DASHBOARD]: "Executive Dashboard",
  [PATHS.DATA_IMPORTS]: "Daily Data Uploads",
  [PATHS.ADMIN]: "Administration",
  [PATHS.ADMIN_ACCOUNTS]: "Accounts",
  [PATHS.ADMIN_PROJECTS]: "Projects",
  [PATHS.ADMIN_TEAM_MEMBERS]: "Team Members",
  [PATHS.ADMIN_USER_MANAGEMENT]: "User Management",
  [PATHS.ADMIN_PROGRAMS]: "Programs",
  [PATHS.ADMIN_NOTIFICATIONS]: "Notifications",
  [PATHS.ADMIN_USAGE]: "Usage & Adoption",
  [PATHS.ADMIN_CLAUDE_PRICING]: "Claude Usage Admin",
  [PATHS.ADMIN_AI_SPEND]: "AI Spend",
  [PATHS.ENGINEERING_SOP]: "Engineering SOP",
  [PATHS.FAQ]: "FAQ",
  [PATHS.MY_CLAUDE_REPORT]: "My Claude Report",
  [PATHS.TEAM_CLAUDE_REPORT]: "Team Prompt Coaching",
  [PATHS.CLAUDE_USAGE_GUIDE]: "Understanding Your Report",
};

/** Map a URL ?tab= query parameter value to its display tab label */
export const TAB_LABEL: Record<string, string> = {
  "project-items": "Project Items",
  "program-items": "Program Items",
  "account-items": "Account Items",
  productivity: "Productivity",
  "defect-density": "Defect Density",
  "defect-leakage": "Defect Leakage",
  "reopen-ratio": "Reopen Ratio",
  rules: "Rules",
  templates: "Templates",
  events: "Events",
  logs: "Logs",
  "boards": "Boards",
  "agreed-points": "Agreed Points",
  "claude-pricing": "Cost Model",
  "monitored-orgs": "Monitored Orgs",
  "data-quality": "Data Quality",
  "ingest-rate-limit": "Ingest Rate Limit",
  "audit-log": "Audit Log",
  "installs":"Installs"
};

/**
 * Human label for a path, for breadcrumbs and the page heading.
 *
 * Falls back to the last URL segment only when nothing else matches — which is
 * correct for simple static routes but never for id/token routes, hence
 * DYNAMIC_PATH_LABELS above.
 */
export function resolvePageLabel(path: string): string {
  const exact = PATH_LABEL[path];
  if (exact) return exact;
  const dynamic = DYNAMIC_PATH_LABELS.find((d) => d.test.test(path));
  if (dynamic) return dynamic.label;
  return path.split("/").pop() ?? "";
}
