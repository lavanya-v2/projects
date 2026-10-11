import { Router } from 'express';
import { authenticateIngestToken } from '../../../middleware/ingestTokenMiddleware';
import { ingestController } from '../controllers/ingestController';

const router = Router();

// Machine-to-server ingest. Auth is the per-user ingest token (NOT JWT),
// applied here inside the router. Consent is checked inside the middleware.
router.post('/claude-usage', authenticateIngestToken as any, (req, res) =>
    ingestController.ingest(req, res),
);

export { router as ingestRoutes };
