/**
 * Centralised query key factories for TanStack Query.
 *
 * Using factories prevents key collisions and makes invalidation explicit:
 *   queryClient.invalidateQueries({ queryKey: actionItemKeys.list(projectId) });
 */

export const accountKeys = {
  all: ['accounts'] as const,
  list: () => [...accountKeys.all, 'list'] as const,
};

export const projectKeys = {
  all: ['projects'] as const,
  list: (accountId?: number, includeInactive?: boolean) => [...projectKeys.all, 'list', { accountId, includeInactive }] as const,
  members: (projectId: number) => [...projectKeys.all, projectId, 'members'] as const,
};

export const usageKeys = {
  all: ['usage'] as const,
  summary: (from: string, to: string) => [...usageKeys.all, 'summary', { from, to }] as const,
  trend: (from: string, to: string) => [...usageKeys.all, 'trend', { from, to }] as const,
  users: (from: string, to: string, role?: string) =>
    [...usageKeys.all, 'users', { from, to, role }] as const,
  features: (from: string, to: string) => [...usageKeys.all, 'features', { from, to }] as const,
};

export const dashboardKeys = {
  all: ['dashboard'] as const,
  overview: () => [...dashboardKeys.all, 'overview'] as const,
  project: (projectId: number) => [...dashboardKeys.all, 'project', projectId] as const,
};

export const dailyReportKeys = {
  all: ['daily-reports'] as const,
  byProject: (projectId: number, page: number, limit: number, startDate?: string, endDate?: string) =>
    [...dailyReportKeys.all, 'byProject', projectId, { page, limit, startDate, endDate }] as const,
};

export const weeklyReportKeys = {
  all: ['weekly-reports'] as const,
  byProject: (projectId: number, page: number, limit: number, status?: string) =>
    [...weeklyReportKeys.all, 'byProject', projectId, { page, limit, status }] as const,
  byAccount: (accountId: number, page: number, limit: number, status?: string, health?: string) =>
    [...weeklyReportKeys.all, 'byAccount', accountId, { page, limit, status, health }] as const,
};

export const monthlyReportKeys = {
  all: ['monthly-reports'] as const,
  byProject: (projectId: number, page: number, limit: number, status?: string) =>
    [...monthlyReportKeys.all, 'byProject', projectId, { page, limit, status }] as const,
  byAccount: (accountId: number, page: number, limit: number, health?: string) =>
    [...monthlyReportKeys.all, 'byAccount', accountId, { page, limit, health }] as const,
};

export const portfolioPresentationKeys = {
  all: ['portfolio-presentation'] as const,
  list: (accountId: number, projectId?: number | string | undefined) => [...portfolioPresentationKeys.all, 'list', accountId, projectId] as const,
  detail: (id: number) => [...portfolioPresentationKeys.all, 'detail', id] as const,
};

export const actionItemKeys = {
  all: ['action-items'] as const,
  list: (projectId: number, status?: string) =>
    [...actionItemKeys.all, 'list', projectId, { status }] as const,
  detail: (id: number) => [...actionItemKeys.all, 'detail', id] as const,
};

export const accountActionItemKeys = {
  all: ['account-action-items'] as const,
  list: (accountId: number, status?: string) =>
    [...accountActionItemKeys.all, 'list', accountId, { status }] as const,
  detail: (id: number) => [...accountActionItemKeys.all, 'detail', id] as const,
};

export const programActionItemKeys = {
  all: ['program-action-items'] as const,
  list: (programId: number, status?: string) =>
    [...programActionItemKeys.all, 'list', programId, { status }] as const,
  detail: (id: number) => [...programActionItemKeys.all, 'detail', id] as const,
};

export const riskKeys = {
  all: ['risks'] as const,
  list: (sourceFilter?: string) => [...riskKeys.all, 'list', sourceFilter] as const,
  detail: (id: number) => [...riskKeys.all, 'detail', id] as const,
  superusers: () => [...riskKeys.all, 'superusers'] as const,
};

export const teamPerformanceKeys = {
  all: ['team-performance'] as const,
  members: (projectId: number) => [...teamPerformanceKeys.all, 'members', projectId] as const,
  sprints: (projectId: number) => [...teamPerformanceKeys.all, 'sprints', projectId] as const,
  syncHistory: (projectId: number) => [...teamPerformanceKeys.all, 'syncHistory', projectId] as const,
  scorecard: (projectId: number, syncId: number) =>
    [...teamPerformanceKeys.all, 'scorecard', projectId, syncId] as const,
  ticketFacts: (projectId: number, syncId: number, jiraLoginId?: string) =>
    [...teamPerformanceKeys.all, 'ticketFacts', projectId, syncId, { jiraLoginId }] as const,
  kanbanCycles: (projectId: number) => [...teamPerformanceKeys.all, 'kanbanCycles', projectId] as const,
  excelSprints: (projectId: number) => [...teamPerformanceKeys.all, 'excelSprints', projectId] as const,
  excelScorecard: (projectId: number, sprint: string) =>
    [...teamPerformanceKeys.all, 'excelScorecard', projectId, sprint] as const,
};

export const userKeys = {
  all: ['users'] as const,
  list: () => [...userKeys.all, 'list'] as const,
  roles: () => [...userKeys.all, 'roles'] as const,
};

export const programKeys = {
  all: ['programs'] as const,
  byAccount: (accountId: number, nonEmptyOnly?: boolean) =>
    [...programKeys.all, 'byAccount', accountId, { nonEmptyOnly }] as const,
  byAccountWithPagination: (accountId: number, pageNumber?: number, pageLimit?: number) =>
    [...programKeys.all, 'byAccount', accountId, pageNumber, pageLimit] as const,
  accessible: () => [...programKeys.all, 'accessible'] as const,
  detail: (programId: number) => [...programKeys.all, 'detail', programId] as const,
  owners: (programId: number) => [...programKeys.all, 'owners', programId] as const,
  weeklyReports: (programId: number, page: number, limit: number) =>
    [...programKeys.all, 'weekly', programId, { page, limit }] as const,
  monthlyReports: (programId: number, page: number, limit: number) =>
    [...programKeys.all, 'monthly', programId, { page, limit }] as const,
};

export const profileKeys = {
  all: ['profile'] as const,
  me: () => [...profileKeys.all, 'me'] as const,
};

export const claudeUsageKeys = {
  all: ['claude-usage'] as const,
  access: () => [...claudeUsageKeys.all, 'access'] as const,
  myReport: (from: string, to: string) => [...claudeUsageKeys.all, 'my-report', { from, to }] as const,
  teamReport: (from: string, to: string, search: string, page: number, pageSize: number) =>
    [...claudeUsageKeys.all, 'team-report', { from, to, search, page, pageSize }] as const,
  memberDetail: (userId: number, from: string, to: string) =>
    [...claudeUsageKeys.all, 'member-detail', userId, { from, to }] as const,
  token: () => [...claudeUsageKeys.all, 'token'] as const,
  consent: () => [...claudeUsageKeys.all, 'consent'] as const,
  meta: () => [...claudeUsageKeys.all, 'meta'] as const,
};

export const memberDashboardKeys = {
  all: ['member-dashboard'] as const,
  dashboard: () => [...memberDashboardKeys.all, 'dashboard'] as const,
  techNotesGap: (projectId: number) => [...memberDashboardKeys.all, 'tech-notes-gap', projectId] as const,
  automationLabels: (projectId: number) => [...memberDashboardKeys.all, 'automation-labels', projectId] as const,
};

export const performanceReviewKeys = {
  all: ['performance-review'] as const,
  identity: (projectId: number) => [...performanceReviewKeys.all, 'identity', projectId] as const,
  identityCoverage: (projectId: number) =>
    [...performanceReviewKeys.all, 'identity-coverage', projectId] as const,
  config: (accountId: number) => [...performanceReviewKeys.all, 'config', accountId] as const,
  previewCycles: (accountId: number, from: string, to: string) =>
    [...performanceReviewKeys.all, 'preview-cycles', accountId, { from, to }] as const,
  cycles: (accountId: number, year?: string) =>
    [...performanceReviewKeys.all, 'cycles', accountId, { year }] as const,
  templates: (accountId?: number) =>
    [...performanceReviewKeys.all, 'templates', { accountId }] as const,
  template: (id: number) => [...performanceReviewKeys.all, 'template', id] as const,
  assignments: (cycleId: number) => [...performanceReviewKeys.all, 'assignments', cycleId] as const,
  leadReview: (reviewId: number) => [...performanceReviewKeys.all, 'lead-review', reviewId] as const,
  myReviews: () => [...performanceReviewKeys.all, 'my-reviews'] as const,
};

export const retroKeys = {
  all: ['retro'] as const,
  boards: (projectId?: number) => [...retroKeys.all, 'boards', { projectId }] as const,
  board: (boardId: number) => [...retroKeys.all, 'board', boardId] as const,
  byToken: (token: string) => [...retroKeys.all, 'byToken', token] as const,
  comments: (itemId: number) => [...retroKeys.all, 'comments', itemId] as const,
  summary: (boardId: number) => [...retroKeys.all, 'summary', boardId] as const,
  carryForward: (boardId: number) => [...retroKeys.all, 'carryForward', boardId] as const,
  agreedPoints: (projectId: number) => [...retroKeys.all, 'agreedPoints', projectId] as const,
};
