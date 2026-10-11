import { Router } from 'express';
import { authenticate, leadOrAboveMiddleware, pilotMiddleware } from '../../../middleware/authMiddleware';
import { FEATURE_CLAUDE_USAGE } from '../../../models/FeaturePilot';
import { memberDashboardController } from '../controllers/memberDashboardController';
import {
    memberUsageController,
    teamUsageController,
} from '../../usageCollector/controllers/memberUsageController';

// Pilot gate for the Claude-usage feature (superuser/admin bypass inside).
const claudePilot = pilotMiddleware(FEATURE_CLAUDE_USAGE) as any;

const router = Router();

// Self-scoped: any authenticated user resolves to their own team-member data.
router.use(authenticate as any);

router.get('/dashboard', (req, res) => memberDashboardController.getDashboard(req, res));
router.get('/project/:projectId/tech-notes-gap', (req, res) => memberDashboardController.getTechNotesGap(req, res));
router.get('/project/:projectId/automation-labels', (req, res) => memberDashboardController.getAutomationLabels(req, res));

// --- Claude prompt-effectiveness (self-scoped to req.user) ---
// The access probe is intentionally NOT pilot-gated — the UI calls it to decide
// whether to show the feature at all.
router.get('/claude-usage-access', (req, res) => memberUsageController.getAccess(req, res));

// Everything else here IS pilot-gated (superuser/admin bypass inside the guard).
router.get('/prompt-report', claudePilot, (req, res) => memberUsageController.getMyReport(req, res));
router.get('/collector-meta', claudePilot, (req, res) => memberUsageController.getMeta(req, res));
router.get('/collector-download', claudePilot, (req, res) => memberUsageController.downloadCollector(req, res));
router.get('/collector-token', claudePilot, (req, res) => memberUsageController.getToken(req, res));
router.post('/collector-token', claudePilot, (req, res) => memberUsageController.generateToken(req, res));
router.get('/collector-consent', claudePilot, (req, res) => memberUsageController.getConsent(req, res));
router.post('/collector-consent', claudePilot, (req, res) => memberUsageController.recordConsent(req, res));
router.post('/collector-consent/revoke', claudePilot, (req, res) => memberUsageController.revokeConsent(req, res));
router.post('/collector/disable', claudePilot, (req, res) => memberUsageController.disable(req, res));
router.post('/collector/purge', claudePilot, (req, res) => memberUsageController.purge(req, res));
router.post('/collector/refresh-coaching', claudePilot, (req, res) => memberUsageController.refreshCoaching(req, res));

// --- Team view (lead / manager / admin / superuser). ADDENDUM 23: role alone is enough —
// deliberately NOT claudePilot-gated. getTeamReport never depends on the viewer's own
// pilot/collector/consent status (only on resolveVisibleUserIds' project/account access),
// so requiring the VIEWER's own pilot enrollment here only blocked leads who are otherwise
// entitled to see their (separately pilot-enrolled) team's data. Personal enrollment still
// gates every endpoint above this line — that's genuinely about the person's own data. ---
router.get('/team-prompt-report', leadOrAboveMiddleware as any, (req, res) =>
    teamUsageController.getTeamReport(req, res),
);
// One team member's detail (ADDENDUM 24) — same access tier as the roster
// above; the controller checks the target id is in resolveVisibleUserIds.
router.get('/team-prompt-report/:userId', leadOrAboveMiddleware as any, (req, res) =>
    teamUsageController.getMemberDetail(req, res),
);

export { router as memberRoutes };
