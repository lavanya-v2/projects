import { Router } from 'express';
import { authenticate, adminOrSuperuserMiddleware } from '../../../middleware/authMiddleware';
import { aiSpendController } from '../controllers/aiSpendController';

/**
 * Admin-only view of what this application spends on the Anthropic API.
 *
 * Read-only by design — there is nothing here to configure. The rate card that turns
 * tokens into dollars is managed separately under /api/admin/claude-pricing.
 */
const router = Router();
router.use(authenticate as any);
router.use(adminOrSuperuserMiddleware as any);

router.get('/summary', (req, res) => aiSpendController.summary(req, res));

export { router as aiSpendRoutes };
