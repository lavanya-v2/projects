/* eslint-disable @typescript-eslint/no-explicit-any */
import { Router } from 'express';
import { reportController } from '../controllers/reportController';
import { portfolioPresentationController } from '../controllers/portfolioPresentationController';
import { actionItemController } from '../controllers/actionItemController';
import { accountActionItemController } from '../controllers/accountActionItemController';
import { programActionItemController } from '../controllers/programActionItemController';
import { dashboardController } from '../controllers/dashboardController';
import { customRangeReportController } from '../controllers/customRangeReportController';
import {
  blockLeadMiddleware,
  leadOrAboveMiddleware,
  teamPerfReadAccess,
  customRangeReportAccess,
  executiveReadAccess,
  requireAccountWriteAccess,
  requireAccountReadAccess,
  requireAccountAccessForPresentation,
  requirePortfolioPresentationAccess,
} from '../../../middleware/authMiddleware';
import { teamPerformanceController } from '../controllers/teamPerformanceController';
import { performanceSyncController } from '../controllers/performanceSyncController';
import { excelSprintBoardController } from '../controllers/excelSprintBoardController';
import { reconciliationController } from '../controllers/reconciliationController';
import { adminOrSuperuserMiddleware } from '../../users/controllers/userController';
import { programReportController } from '../controllers/programReportController';

const router = Router();

// Async Daily Report — Lead read-only: blocked from generation
router.post('/report/async', blockLeadMiddleware, (req, res) => reportController.generateAsyncReport(req, res));
// Sync Daily Report (Fetch Only) — allowed for all roles including Lead
router.post('/report', (req, res) => reportController.generateReport(req, res));
// Weekly report generation — Lead read-only: blocked
router.post('/report/weekly', blockLeadMiddleware, (req, res) => reportController.generateWeeklyReport(req, res));
// Account Action Items (static sub-path before /:accountId param routes)
router.get('/report/account/:accountId/action-items', requireAccountReadAccess as any, (req, res) =>
  accountActionItemController.listByAccount(req, res)
);
router.post('/report/account/:accountId/action-items', requireAccountWriteAccess as any, (req, res) =>
  accountActionItemController.createItem(req, res)
);

// Account Action Item CRUD by ID
router.get('/report/account-action-item/:id', requireAccountReadAccess as any, (req, res) =>
  accountActionItemController.getItem(req, res)
);
router.put('/report/account-action-item/:id', requireAccountWriteAccess as any, (req, res) =>
  accountActionItemController.updateItem(req, res)
);
router.post('/report/account-action-item/:id/transition', requireAccountWriteAccess as any, (req, res) =>
  accountActionItemController.transitionStatus(req, res)
);
router.delete('/report/account-action-item/:id', requireAccountWriteAccess as any, (req, res) =>
  accountActionItemController.deleteItem(req, res)
);
// Account Action Item Comments (static sub-path before /:id)
router.delete('/report/account-action-item/comment/:commentId', requireAccountReadAccess as any, (req, res) =>
  accountActionItemController.deleteComment(req, res)
);
router.put('/report/account-action-item/comment/:commentId', requireAccountReadAccess as any, (req, res) =>
  accountActionItemController.updateComment(req, res)
);
router.post('/report/account-action-item/:id/comments', requireAccountReadAccess as any, (req, res) =>
  accountActionItemController.addComment(req, res)
);

// Account Reports
router.post('/report/account/weekly', (req, res) => reportController.generateAccountWeeklyReport(req, res));
router.get('/report/account/download', (req, res) => reportController.downloadAccountReport(req, res));
router.get('/report/account/:accountId/weekly', (req, res) => reportController.listAccountWeeklyReports(req, res));
// Monthly Account Reports (static routes must come before /:accountId param routes)
router.post('/report/account/monthly', (req, res) => reportController.generateMonthlyAccountReport(req, res));
router.get('/report/account/monthly/download', (req, res) => reportController.downloadMonthlyAccountReport(req, res));
router.get('/report/account/:accountId/monthly', (req, res) => reportController.listMonthlyAccountReports(req, res));
// Program Reports (grouping of projects under an account; checkPermission honors program scoping)
// /queue variants enqueue a BullMQ job and return 202 immediately (non-blocking).
router.post('/report/program/:programId/daily/queue', blockLeadMiddleware, (req, res) =>
  programReportController.enqueueDaily(req, res)
);
router.post('/report/program/:programId/weekly/queue', blockLeadMiddleware, (req, res) =>
  programReportController.enqueueWeekly(req, res)
);
router.post('/report/program/:programId/monthly/queue', blockLeadMiddleware, (req, res) =>
  programReportController.enqueueMonthly(req, res)
);

router.post('/report/program/:programId/daily', blockLeadMiddleware, (req, res) =>
  programReportController.generateDaily(req, res)
);
router.get('/report/program/:programId/daily', (req, res) => programReportController.listDaily(req, res));
router.post('/report/program/:programId/weekly', blockLeadMiddleware, (req, res) =>
  programReportController.generateWeekly(req, res)
);
router.get('/report/program/:programId/weekly', (req, res) => programReportController.listWeekly(req, res));
router.post('/report/program/:programId/monthly', blockLeadMiddleware, (req, res) =>
  programReportController.generateMonthly(req, res)
);
router.get('/report/program/:programId/monthly', (req, res) => programReportController.listMonthly(req, res));

// PPT downloads. NOTE: like the sibling list routes above, these carry no explicit
// middleware and rely on the app-level authenticate/checkPermission chain.
router.get('/report/program/:programId/weekly/download', (req, res) =>
  programReportController.downloadWeekly(req, res)
);
router.get('/report/program/:programId/monthly/download', (req, res) =>
  programReportController.downloadMonthly(req, res)
);

// Program Action Items — list/create gated by checkPermission via :programId (program-owner access).
// Anyone who can view the program's reports may create/read/update; delete is creator/admin/superuser only.
router.get('/report/program/:programId/action-items', (req, res) =>
  programActionItemController.listByProgram(req, res)
);
router.post('/report/program/:programId/action-items', (req, res) => programActionItemController.createItem(req, res));

// Program Action Item Comments (static sub-path 'comment' must be before /:id)
router.delete('/report/program-action-item/comment/:commentId', (req, res) =>
  programActionItemController.deleteComment(req, res)
);
router.put('/report/program-action-item/comment/:commentId', (req, res) =>
  programActionItemController.updateComment(req, res)
);
router.post('/report/program-action-item/:id/comments', (req, res) => programActionItemController.addComment(req, res));

// Program Action Item CRUD by ID — gated in-controller via verifyProgramActionItemAccess
router.get('/report/program-action-item/:id', (req, res) => programActionItemController.getItem(req, res));
router.put('/report/program-action-item/:id', (req, res) => programActionItemController.updateItem(req, res));
router.post('/report/program-action-item/:id/transition', (req, res) =>
  programActionItemController.transitionStatus(req, res)
);
router.delete('/report/program-action-item/:id', (req, res) => programActionItemController.deleteItem(req, res));

// Project Reports — monthly generation blocked for Lead
router.post('/report/project/monthly', blockLeadMiddleware, (req, res) =>
  reportController.generateMonthlyProjectReport(req, res)
);
router.get('/report/project/:projectId/weekly', (req, res) => reportController.listProjectWeeklyReports(req, res));
router.get('/report/project/:projectId/monthly', (req, res) => reportController.listProjectMonthlyReports(req, res));
router.get('/report/project/:projectId/daily', (req, res) => reportController.listProjectDailyReports(req, res));
router.get('/report/project/download-text', (req, res) => reportController.downloadWeeklyReportText(req, res));
router.get('/report/project/download-csv', (req, res) => reportController.downloadWeeklyReportCSV(req, res));
router.get('/report/project/download-ppt', (req, res) => reportController.downloadWeeklyReportPPT(req, res));
router.post('/report/project/bulk-download', (req, res) => reportController.bulkDownloadWeeklyReports(req, res));
// Custom Range Report (lead+, assignment-scoped, max 15 days, built from Daily snapshots)
router.get('/report/custom-range/projects', customRangeReportAccess, (req, res) =>
  customRangeReportController.listProjects(req, res)
);
router.post('/report/custom-range', customRangeReportAccess, (req, res) =>
  customRangeReportController.generate(req, res)
);
router.get('/report/custom-range/download', customRangeReportAccess, (req, res) =>
  customRangeReportController.download(req, res)
);
// General Download
router.get('/report/download', (req, res) => reportController.downloadReport(req, res));
router.get('/report/download-text', (req, res) => reportController.downloadDailyReportText(req, res));
router.get('/report/download-csv', (req, res) => reportController.downloadDailyReportCSV(req, res));
router.get('/health', (req, res) => reportController.healthCheck(req, res));

// Dashboard overview
router.get('/report/dashboard-overview', (req, res) => dashboardController.getOverview(req, res));
router.get('/report/dashboard-project/:projectId', (req, res) => dashboardController.getProjectDetail(req, res));

// Manager Insights write operations
//
// Authorization rules:
//   - daily insights        → lead, manager, admin, superuser  (leads CAN add daily insights)
//   - weekly_project        → manager, admin, superuser        (leads cannot)
//   - weekly_account        → manager, admin, superuser        (also gated by full-account access in controller)
//   - monthly_project       → manager, admin, superuser
//   - monthly_account       → manager, admin, superuser        (also gated by full-account access in controller)
//
// Once an insight is saved, it is immutable for non-superusers (enforced at the
// service layer for daily + weekly_project — see reportService.saveDailyInsights /
// saveInsights).

const insightsRoleGate = (req: any, res: any, next: any) => {
  const roleName = req.user?.roleName;
  const isSuperuser = req.user?.role === 'SUPERUSER' || roleName === 'superuser';
  if (isSuperuser) return next();

  // Determine the report type. For /report/daily/:id/insights[/health] the
  // type is implicit ('daily'). For the generic preview/accept endpoints it
  // comes from req.params.reportType.
  const reportType: string = req.params.reportType || (req.path.startsWith('/report/daily/') ? 'daily' : '');

  if (reportType === 'daily') {
    if (['lead', 'manager', 'admin'].includes(roleName)) return next();
    return res.status(403).json({ error: 'Access denied: lead role or above required' });
  }

  // weekly_project / weekly_account / monthly_project / monthly_account → manager+
  if (['manager', 'admin'].includes(roleName)) return next();
  return res.status(403).json({ error: 'Access denied: manager role or above required' });
};

router.patch('/report/daily/:id/insights', insightsRoleGate, (req, res) =>
  reportController.saveDailyInsights(req, res)
);
router.patch('/report/daily/:id/insights/health', insightsRoleGate, (req, res) =>
  reportController.applyInsightsHealth(req, res)
);
router.post('/report/:reportType/:id/insights/preview', insightsRoleGate, (req, res) =>
  reportController.previewInsights(req, res)
);
router.patch('/report/:reportType/:id/insights/accept', insightsRoleGate, (req, res) =>
  reportController.saveInsights(req, res)
);
router.patch('/report/:reportType/:id/team-notes', (req, res) => reportController.addTeamNote(req, res));

// Team Performance — per-project reads: lead+ org-wide; members scoped to their own
// projects (teamPerfReadAccess). Writes/admin actions stay lead+ below.
router.get('/report/project/:projectId/team-performance/sprints', teamPerfReadAccess as any, (req, res) =>
  teamPerformanceController.listSprints(req, res)
);
router.post('/report/project/:projectId/team-performance', teamPerfReadAccess as any, (req, res) =>
  teamPerformanceController.generateReport(req, res)
);
router.get('/report/project/:projectId/member-delivery-matrix', teamPerfReadAccess as any, (req, res) =>
  teamPerformanceController.getMemberDeliveryMatrix(req, res)
);
router.post('/report/project/:projectId/team-dashboard', teamPerfReadAccess as any, (req, res) =>
  teamPerformanceController.getTeamDashboard(req, res)
);
// Excel Sprint Board — reduced per-sprint delivery scorecard for dataSourceType='excel'
// projects, aggregated directly from uploaded work items (separate from the Jira perf/* pipeline).
router.get('/report/project/:projectId/excel-board/sprints', teamPerfReadAccess as any, (req, res) =>
  excelSprintBoardController.listSprints(req, res)
);
router.get('/report/project/:projectId/excel-board/scorecard', teamPerfReadAccess as any, (req, res) =>
  excelSprintBoardController.getScorecard(req, res)
);

// Productivity Overview (cross-project, org-wide, not user-scoped) — lead and above
router.get('/report/productivity-overview', leadOrAboveMiddleware as any, (req, res) =>
  performanceSyncController.getProductivityOverview(req, res)
);

// Legacy (pre-Kanban-cutover) Sprint view for one project — opt-in, manual — lead and above
router.get('/report/productivity-overview/:projectId/legacy-sprint-view', leadOrAboveMiddleware as any, (req, res) =>
  performanceSyncController.getLegacySprintView(req, res)
);

// Quality Trends Overview (cross-project, org-wide, not user-scoped) — lead and above
router.get('/report/quality-trends-overview', leadOrAboveMiddleware as any, (req, res) =>
  performanceSyncController.getQualityTrendsOverview(req, res)
);

// Trends section download (HTML/Excel) — single project (projectId) or whole account — lead and above
router.get('/report/team-performance/trends/download', leadOrAboveMiddleware as any, (req, res) => performanceSyncController.downloadTrendsReport(req, res));

// Executive Dashboard — same quality/productivity trends but SCOPED to the caller's
// accessible projects within the account (customer-facing 'executive' role + lead above).
router.get('/report/executive/quality-trends-overview', executiveReadAccess as any, (req, res) =>
  performanceSyncController.getExecutiveQualityTrendsOverview(req, res)
);

// Per-sprint live reconciliation (E2E evidence endpoint) — admin/superuser only, hits Jira live
router.get('/report/reconciliation/sprint/:syncId', adminOrSuperuserMiddleware as any, (req, res) =>
  reconciliationController.reconcileSprint(req, res)
);

// Performance Scorecard (persistent sync) — per-project reads scoped by teamPerfReadAccess
// (lead+ org-wide, members own projects); sync/override/recompute/retry/delete stay lead+.
router.get('/report/project/:projectId/perf/syncs', teamPerfReadAccess as any, (req, res) =>
  performanceSyncController.getSyncHistory(req, res)
);
router.post('/report/project/:projectId/perf/sync/sprint', leadOrAboveMiddleware as any, (req, res) =>
  performanceSyncController.triggerSprintSync(req, res)
);
router.post('/report/project/:projectId/perf/sync/kanban', leadOrAboveMiddleware as any, (req, res) =>
  performanceSyncController.triggerKanbanSync(req, res)
);
// Kanban work-cycles (cadence-driven). Reads scoped by teamPerfReadAccess; mutations lead+.
router.get('/report/project/:projectId/perf/kanban/cycles', teamPerfReadAccess as any, (req, res) =>
  performanceSyncController.listKanbanCycles(req, res)
);
router.post('/report/project/:projectId/perf/sync/kanban-cycle', leadOrAboveMiddleware as any, (req, res) =>
  performanceSyncController.triggerKanbanCycleSync(req, res)
);
router.put(
  '/report/project/:projectId/perf/kanban/cycles/:cycleIndex/override',
  leadOrAboveMiddleware as any,
  (req, res) => performanceSyncController.overrideKanbanCycle(req, res)
);
router.delete(
  '/report/project/:projectId/perf/kanban/cycles/:cycleIndex/override',
  leadOrAboveMiddleware as any,
  (req, res) => performanceSyncController.clearKanbanCycleOverride(req, res)
);
router.get('/report/project/:projectId/perf/kanban/live-span', teamPerfReadAccess as any, (req, res) =>
  performanceSyncController.getLiveKanbanSpan(req, res)
);
router.get('/report/project/:projectId/perf/sync/:syncId/scorecard', teamPerfReadAccess as any, (req, res) =>
  performanceSyncController.getScorecard(req, res)
);
router.get('/report/project/:projectId/perf/sync/:syncId/tickets', teamPerfReadAccess as any, (req, res) =>
  performanceSyncController.getTicketFacts(req, res)
);
router.patch('/report/project/:projectId/perf/sync/:syncId/member/override', leadOrAboveMiddleware as any, (req, res) =>
  performanceSyncController.saveOverride(req, res)
);
router.delete(
  '/report/project/:projectId/perf/sync/:syncId/member/override',
  leadOrAboveMiddleware as any,
  (req, res) => performanceSyncController.clearOverride(req, res)
);
router.post('/report/project/:projectId/perf/sync/:syncId/recompute', leadOrAboveMiddleware as any, (req, res) =>
  performanceSyncController.recompute(req, res)
);
router.post('/report/project/:projectId/perf/sync/:syncId/retry', leadOrAboveMiddleware as any, (req, res) =>
  performanceSyncController.retry(req, res)
);
router.delete('/report/project/:projectId/perf/sync/:syncId', leadOrAboveMiddleware as any, (req, res) =>
  performanceSyncController.deleteSync(req, res)
);

// Portfolio Presentations — Superuser/Admin always allowed; Manager/Lead gated by
// per-project access. Account-scoped endpoints require ≥1 accessible project
// in the account; id-scoped endpoints require overlap with the presentation's
// selectedProjectIds. Delete is creator-only (plus Superuser/Admin bypass).
router.post(
  '/report/account/:accountId/portfolio-presentation/preview',
  requireAccountAccessForPresentation as any,
  (req, res) => portfolioPresentationController.previewPayload(req, res)
);
router.get(
  '/report/account/:accountId/portfolio-presentation',
  requireAccountAccessForPresentation as any,
  (req, res) => portfolioPresentationController.listByAccount(req, res)
);
router.post(
  '/report/account/:accountId/portfolio-presentation',
  requireAccountAccessForPresentation as any,
  (req, res) => portfolioPresentationController.createPresentation(req, res)
);
router.post(
  '/report/portfolio-presentation/:id/mom/generate',
  requirePortfolioPresentationAccess('write') as any,
  (req, res) => portfolioPresentationController.generateMOM(req, res)
);
router.post(
  '/report/portfolio-presentation/:id/mom/save',
  requirePortfolioPresentationAccess('write') as any,
  (req, res) => portfolioPresentationController.saveMOM(req, res)
);
router.post(
  '/report/portfolio-presentation/:id/mom/accept',
  requirePortfolioPresentationAccess('write') as any,
  (req, res) => portfolioPresentationController.acceptMOM(req, res)
);
router.post(
  '/report/portfolio-presentation/:id/refresh',
  requirePortfolioPresentationAccess('write') as any,
  (req, res) => portfolioPresentationController.refreshFromSystem(req, res)
);
router.post(
  '/report/portfolio-presentation/:id/duplicate',
  requirePortfolioPresentationAccess('write') as any,
  (req, res) => portfolioPresentationController.duplicatePresentation(req, res)
);
router.get('/report/portfolio-presentation/:id', requirePortfolioPresentationAccess('read') as any, (req, res) =>
  portfolioPresentationController.getPresentation(req, res)
);
router.put('/report/portfolio-presentation/:id', requirePortfolioPresentationAccess('write') as any, (req, res) =>
  portfolioPresentationController.updatePresentation(req, res)
);
router.delete('/report/portfolio-presentation/:id', requirePortfolioPresentationAccess('delete') as any, (req, res) =>
  portfolioPresentationController.deletePresentation(req, res)
);

// Aggregate "my items" — single-request lists across the user's accessible scope.
// Replaces the frontend's per-entity fan-out. Static paths, registered before
// the /:id wildcard routes.
router.get('/report/my/project-action-items', (req, res) => actionItemController.listMine(req, res));
router.get('/report/my/account-action-items', (req, res) => accountActionItemController.listMine(req, res));
router.get('/report/my/program-action-items', (req, res) => programActionItemController.listMine(req, res));

// Project Action Items — static routes before param routes
router.get('/report/project/:projectId/action-items', (req, res) => actionItemController.listByProject(req, res));
router.post('/report/project/:projectId/action-items', (req, res) => actionItemController.createItem(req, res));

// Action Item Comments (static sub-path 'comment' must be before /:id to avoid param conflict)
router.delete('/report/action-item/comment/:commentId', (req, res) => actionItemController.deleteComment(req, res));
router.put('/report/action-item/comment/:commentId', (req, res) => actionItemController.updateComment(req, res));
router.post('/report/action-item/:id/comments', (req, res) => actionItemController.addComment(req, res));

// Action Item CRUD by ID
router.get('/report/action-item/:id', (req, res) => actionItemController.getItem(req, res));
router.put('/report/action-item/:id', (req, res) => actionItemController.updateItem(req, res));
router.post('/report/action-item/:id/transition', (req, res) => actionItemController.transitionStatus(req, res));
router.delete('/report/action-item/:id', (req, res) => actionItemController.deleteItem(req, res));

export default router;
