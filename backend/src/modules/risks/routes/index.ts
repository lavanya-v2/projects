import { Router } from 'express';
import { authenticate, leadOrAboveMiddleware } from '../../../middleware/authMiddleware';
import { riskController } from '../controllers/riskController';

const router = Router();

router.use(authenticate as any);
router.use(leadOrAboveMiddleware as any);

// Superusers list — MUST be before /:id to avoid Express treating 'superusers' as an id param
router.get('/superusers', (req, res) => riskController.getSuperusers(req, res));

// Risk CRUD
router.get('/', (req, res) => riskController.listBoardRisks(req, res));
router.post('/', (req, res) => riskController.createRisk(req, res));
router.get('/:id', (req, res) => riskController.getRiskById(req, res));
router.put('/:id', (req, res) => riskController.updateRisk(req, res));
router.delete('/:id', (req, res) => riskController.deleteRisk(req, res));

// Status transitions
router.put('/:id/status', (req, res) => riskController.transitionStatus(req, res));
router.put('/:id/done', (req, res) => riskController.markDone(req, res));

// Comments
router.get('/:id/comments', (req, res) => riskController.listComments(req, res));
router.post('/:id/comments', (req, res) => riskController.addComment(req, res));
router.put('/:id/comments/:commentId', (req, res) => riskController.updateComment(req, res));

// Mitigation Plans
router.post('/:id/mitigation-plans', (req, res) => riskController.addMitigationPlan(req, res));
router.put('/:id/mitigation-plans/:planId', (req, res) => riskController.updateMitigationPlan(req, res));
router.delete('/:id/mitigation-plans/:planId', (req, res) => riskController.deleteMitigationPlan(req, res));

// AI Summary
router.get('/:id/ai-summary', (req, res) => riskController.getAISummary(req, res));

export { router as riskRoutes };
