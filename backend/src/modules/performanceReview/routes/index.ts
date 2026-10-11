import { Router } from 'express';
import { authenticate, superuserOnlyMiddleware, leadOrAboveMiddleware } from '../../../middleware/authMiddleware';
import { identityLinkController } from '../controllers/identityLinkController';
import { reviewConfigController } from '../controllers/reviewConfigController';
import { reviewCycleController } from '../controllers/reviewCycleController';
import { leadReviewController } from '../controllers/leadReviewController';
import { memberReviewController } from '../controllers/memberReviewController';
import { templateController } from '../controllers/templateController';
import { teamMemberHistoryController } from '../controllers/teamMemberHistoryController';

/**
 * Performance review routes.
 *
 * Mounted at /api/performance-review, deliberately OUTSIDE the '/api'
 * checkPermission block in app.ts. checkPermission cannot see :projectId or
 * :cycleId from there and falls through to next() when it can infer no
 * resource — mounting inside that block would leave every route un-scoped.
 * Guards are therefore applied per route, as in the risks and retro modules.
 *
 * authenticate is applied router-wide, but no role guard is: later phases add
 * member-facing (/me/reviews) and executive-facing (/me/feedback-requests)
 * routes that a blanket leadOrAbove would wrongly block.
 */
const router = Router();

router.use(authenticate as any);

// ── Identity resolution (superuser only) ────────────────────────────────────
// The foundation the rest of the module depends on: nothing may attribute
// delivery data to a person through a link a human has not confirmed.
router.get('/identity/project/:projectId', superuserOnlyMiddleware as any, (req, res) =>
    identityLinkController.listUnresolved(req, res),
);
router.get('/identity/project/:projectId/coverage', superuserOnlyMiddleware as any, (req, res) =>
    identityLinkController.getCoverage(req, res),
);
router.post('/identity/project/:projectId/seed', superuserOnlyMiddleware as any, (req, res) =>
    identityLinkController.seed(req, res),
);
router.post('/identity/project/:projectId/bulk-confirm', superuserOnlyMiddleware as any, (req, res) =>
    identityLinkController.bulkConfirm(req, res),
);
router.post('/identity/reject', superuserOnlyMiddleware as any, (req, res) =>
    identityLinkController.reject(req, res),
);
router.post('/identity/project/:projectId/backfill', superuserOnlyMiddleware as any, (req, res) =>
    identityLinkController.backfill(req, res),
);
router.post('/identity/links', superuserOnlyMiddleware as any, (req, res) =>
    identityLinkController.createManual(req, res),
);
router.patch('/identity/links/:id', superuserOnlyMiddleware as any, (req, res) =>
    identityLinkController.decide(req, res),
);

// ── Configuration and rollout (superuser only) ──────────────────────────────
// Configuration decides how everyone in an account is measured, so it stays
// superuser-only even for managers.
router.get('/config/account/:accountId', superuserOnlyMiddleware as any, (req, res) =>
    reviewConfigController.get(req, res),
);
router.put('/config/account/:accountId', superuserOnlyMiddleware as any, (req, res) =>
    reviewConfigController.upsert(req, res),
);
router.get('/config/account/:accountId/preview-cycles', superuserOnlyMiddleware as any, (req, res) =>
    reviewConfigController.preview(req, res),
);
router.post('/cycles/generate', superuserOnlyMiddleware as any, (req, res) =>
    reviewConfigController.generate(req, res),
);
router.post('/cycles/catch-up', superuserOnlyMiddleware as any, (req, res) =>
    reviewConfigController.generateCatchUp(req, res),
);
router.get('/project-settings/:projectId', superuserOnlyMiddleware as any, (req, res) =>
    reviewConfigController.getProjectSettings(req, res),
);
router.put('/project-settings/:projectId', superuserOnlyMiddleware as any, (req, res) =>
    reviewConfigController.updateProjectSettings(req, res),
);

// ── Cycles ──────────────────────────────────────────────────────────────────
// leadOrAbove is the coarse gate; each handler then resolves per-cycle
// permissions by project overlap, which is what actually scopes access.
router.get('/cycles', leadOrAboveMiddleware as any, (req, res) =>
    reviewCycleController.list(req, res),
);
router.get('/cycles/:cycleId', leadOrAboveMiddleware as any, (req, res) =>
    reviewCycleController.get(req, res),
);
router.post('/cycles/:cycleId/transition', leadOrAboveMiddleware as any, (req, res) =>
    reviewCycleController.transition(req, res),
);
router.post('/cycles/:cycleId/recompute', leadOrAboveMiddleware as any, (req, res) =>
    reviewCycleController.recompute(req, res),
);
router.get('/cycles/:cycleId/sources', leadOrAboveMiddleware as any, (req, res) =>
    reviewCycleController.listSources(req, res),
);
router.patch('/cycles/:cycleId/sources/:sourceId', leadOrAboveMiddleware as any, (req, res) =>
    reviewCycleController.updateSource(req, res),
);
router.get('/cycles/:cycleId/participants', leadOrAboveMiddleware as any, (req, res) =>
    reviewCycleController.listParticipants(req, res),
);
router.get('/cycles/:cycleId/eligible-reviewers', leadOrAboveMiddleware as any, (req, res) =>
    reviewCycleController.eligibleReviewers(req, res),
);
router.patch('/participants/:participantId', leadOrAboveMiddleware as any, (req, res) =>
    reviewCycleController.updateParticipant(req, res),
);
router.get('/cycles/:cycleId/scores', leadOrAboveMiddleware as any, (req, res) =>
    reviewCycleController.scores(req, res),
);

// ── Competency templates (superuser only) ───────────────────────────────────
// A template defines how everyone in the account is assessed, so authoring it is
// superuser-only. Leads answer templates; they do not write them.
router.get('/templates/competency', superuserOnlyMiddleware as any, (req, res) =>
    templateController.list(req, res),
);
router.post('/templates/competency', superuserOnlyMiddleware as any, (req, res) =>
    templateController.create(req, res),
);
router.get('/templates/competency/:id', superuserOnlyMiddleware as any, (req, res) =>
    templateController.get(req, res),
);
router.put('/templates/competency/:id', superuserOnlyMiddleware as any, (req, res) =>
    templateController.update(req, res),
);
router.post('/templates/competency/:id/version', superuserOnlyMiddleware as any, (req, res) =>
    templateController.version(req, res),
);
router.post('/templates/competency/:id/status', superuserOnlyMiddleware as any, (req, res) =>
    templateController.setStatus(req, res),
);

// ── Team member history ──────────────────────────────────────────────────────
// leadOrAbove is the coarse gate; teamMemberHistoryService then checks the caller
// is currently the assigned reviewer for this person (or outranks that check
// entirely) and redacts anything authored by a different lead.
router.get('/team-members/:teamMemberId/history', leadOrAboveMiddleware as any, (req, res) =>
    teamMemberHistoryController.get(req, res),
);

// ── Lead reviews ────────────────────────────────────────────────────────────
// leadOrAbove is the coarse gate; each handler then checks that the caller is the
// ASSIGNED reviewer, which is what keeps a lead's drafts private from other leads.
router.get('/cycles/:cycleId/lead-reviews', leadOrAboveMiddleware as any, (req, res) =>
    leadReviewController.listForCycle(req, res),
);
router.post('/cycles/:cycleId/lead-reviews/:teamMemberId/open', leadOrAboveMiddleware as any, (req, res) =>
    leadReviewController.open(req, res),
);
router.get('/lead-reviews/:reviewId', leadOrAboveMiddleware as any, (req, res) =>
    leadReviewController.get(req, res),
);
router.put('/lead-reviews/:reviewId', leadOrAboveMiddleware as any, (req, res) =>
    leadReviewController.save(req, res),
);
router.get('/lead-reviews/:reviewId/validate', leadOrAboveMiddleware as any, (req, res) =>
    leadReviewController.validate(req, res),
);
router.post('/lead-reviews/:reviewId/submit', leadOrAboveMiddleware as any, (req, res) =>
    leadReviewController.submit(req, res),
);
router.post('/lead-reviews/:reviewId/publish', leadOrAboveMiddleware as any, (req, res) =>
    leadReviewController.publish(req, res),
);
router.post('/lead-reviews/:reviewId/revise', leadOrAboveMiddleware as any, (req, res) =>
    leadReviewController.revise(req, res),
);
router.get('/lead-reviews/:reviewId/history', leadOrAboveMiddleware as any, (req, res) =>
    leadReviewController.history(req, res),
);

// ── Member self-service ─────────────────────────────────────────────────────
// Deliberately NOT behind leadOrAbove: these are the routes a member uses, and
// every handler scopes to the caller's own team member record and to published
// reviews only.
router.get('/me/pending-status', (req, res) => memberReviewController.pendingStatus(req, res));
router.get('/me/reviews', (req, res) => memberReviewController.listMine(req, res));
router.get('/me/reviews/:cycleId', (req, res) => memberReviewController.getMine(req, res));
router.post('/me/reviews/:reviewId/acknowledge', (req, res) =>
    memberReviewController.acknowledge(req, res),
);

export default router;
