import { Router } from 'express';
import { authenticate, adminOrSuperuserMiddleware, superuserOnlyMiddleware } from '../../../middleware/authMiddleware';
import { pricingController } from '../controllers/pricingController';
import { monitoredOrgController } from '../controllers/monitoredOrgController';
import { integrityController } from '../controllers/integrityController';
import { ingestRateLimitController } from '../controllers/ingestRateLimitController';
import { collectorVersionPolicyController } from '../controllers/collectorVersionPolicyController';
import { ingestAuditLogController } from '../controllers/ingestAuditLogController';
import { collectorInstallsController } from '../controllers/collectorInstallsController';

// Admin-only management of the versioned Claude cost model. Editing = create a new
// version; old versions are immutable so historical cost stays frozen.
const router = Router();
router.use(authenticate as any);
router.use(adminOrSuperuserMiddleware as any);

router.get('/', (req, res) => pricingController.list(req, res));
router.get('/active', (req, res) => pricingController.active(req, res));
router.post('/', (req, res) => pricingController.create(req, res));

export { router as pricingRoutes };

// Admin-only allowlist of customer Claude orgs we may monitor (multi-customer).
const orgRouter = Router();
orgRouter.use(authenticate as any);
orgRouter.use(adminOrSuperuserMiddleware as any);
orgRouter.get('/', (req, res) => monitoredOrgController.list(req, res));
orgRouter.post('/set', (req, res) => monitoredOrgController.setEnabled(req, res));
orgRouter.post('/license', (req, res) => monitoredOrgController.setLicense(req, res));

export { orgRouter as monitoredOrgRoutes };

// Admin-only Data Quality — rows flagged by the integrity heuristics (ADDENDUM 5).
const integrityRouter = Router();
integrityRouter.use(authenticate as any);
integrityRouter.use(adminOrSuperuserMiddleware as any);
integrityRouter.get('/', (req, res) => integrityController.list(req, res));
integrityRouter.post('/acknowledge', (req, res) => integrityController.acknowledge(req, res));

export { integrityRouter as integrityRoutes };

// Admin-only ingest rate limit — global default + per-token override (ADDENDUM 11 Phase 1).
const rateLimitRouter = Router();
rateLimitRouter.use(authenticate as any);
rateLimitRouter.use(adminOrSuperuserMiddleware as any);
rateLimitRouter.get('/', (req, res) => ingestRateLimitController.get(req, res));
rateLimitRouter.post('/global', (req, res) => ingestRateLimitController.setGlobal(req, res));
rateLimitRouter.post('/token-override', (req, res) => ingestRateLimitController.setTokenOverride(req, res));

export { rateLimitRouter as ingestRateLimitRoutes };

// Admin-only fleet-wide minimum collector version, enforced at ingest (ADDENDUM 22).
// Same tier as the rate limit above — a single ingest-gate policy row.
const versionPolicyRouter = Router();
versionPolicyRouter.use(authenticate as any);
versionPolicyRouter.use(adminOrSuperuserMiddleware as any);
versionPolicyRouter.get('/', (req, res) => collectorVersionPolicyController.get(req, res));
versionPolicyRouter.post('/', (req, res) => collectorVersionPolicyController.set(req, res));

export { versionPolicyRouter as collectorVersionPolicyRoutes };

// Superuser-ONLY ingest audit log (ADDENDUM 11 Phase 3) — stricter than the other
// routes here (excludes plain `admin` roleName); rows are further project-scoped
// to the caller inside ingestAuditLogService.list, even for a superuser.
const auditLogRouter = Router();
auditLogRouter.use(authenticate as any);
auditLogRouter.use(superuserOnlyMiddleware as any);
auditLogRouter.get('/', (req, res) => ingestAuditLogController.list(req, res));

export { auditLogRouter as claudeIngestAuditLogRoutes };

// Superuser-ONLY collector installs list (ADDENDUM 19) — who has ever installed the
// collector and when they last synced. Same visibility level as the audit log
// (not project-scoped like the audit log itself — installs are just identity + a
// timestamp, no usage content, so no extra scoping is applied here).
const installsRouter = Router();
installsRouter.use(authenticate as any);
installsRouter.use(superuserOnlyMiddleware as any);
installsRouter.get('/', (req, res) => collectorInstallsController.list(req, res));

export { installsRouter as collectorInstallsRoutes };
