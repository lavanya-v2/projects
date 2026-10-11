import express, { Express } from 'express';
import cors from 'cors';
import { reportRoutes } from './modules/reports';
import { teamRoutes } from './modules/team';
import { projectRoutes } from './modules/projects';
import { accountRoutes } from './modules/accounts';
import { authRoutes } from './routes/authRoutes';
import userRoutes from './routes/userRoutes';
import profileRoutes from './routes/profileRoutes';
import { riskRoutes } from './modules/risks/routes';
import { retroRoutes } from './modules/retro/routes';
import performanceReviewRoutes from './modules/performanceReview/routes';
import { memberRoutes } from './modules/member';
import { ingestRoutes, pricingRoutes, monitoredOrgRoutes, integrityRoutes, ingestRateLimitRoutes, claudeIngestAuditLogRoutes, collectorInstallsRoutes, collectorVersionPolicyRoutes, installRoutes } from './modules/usageCollector';
import { aiSpendRoutes } from './modules/ai';
import { programRoutes } from './modules/programs/routes';
import { adminRoutes } from './modules/admin/routes';
import { notificationRoutes } from './modules/notifications/routes';
import { dataSourceRoutes } from './modules/datasource/routes';
// Import queue to ensure worker is registered on startup
import './modules/notifications/queues/notificationQueue';
import './modules/usageCollector/queues/coachingQueue';
import { authenticate, checkPermission } from './middleware/authMiddleware';
import { usageTracker } from './middleware/usageTracker';

export function createApp(): Express {
    const app = express();

    // Middleware
    app.use(cors());
    app.use(express.json({ limit: '25mb' }));
    app.use(express.urlencoded({ extended: true, limit: '25mb' }));

    // Request logging
    app.use((req, res, next) => {
        console.log(`${req.method} ${req.path}`);
        next();
    });

    // Usage tracking — records allowlisted feature usage on response finish,
    // by which time req.user is populated regardless of which router authenticated.
    app.use(usageTracker);

    // Routes
    app.use('/api', authRoutes);

    // Superuser routes (includes own auth and role check)
    app.use('/api/users', userRoutes);

    // Profile routes — any authenticated user can view/edit their own profile
    app.use('/api/profile', profileRoutes);

    // Risk management routes (includes own auth and superuser check)
    app.use('/api/risks', riskRoutes);

    // Retro boards (self-guarded: authenticate at router level, then per-route
    // requireBoardAccess resolves the board and checks project-team membership).
    // Deliberately NOT under the '/api' checkPermission block — that middleware
    // cannot see :boardId from there and would fall through to next().
    app.use('/api/retro', retroRoutes);

    // Performance review (self-guarded: authenticate at router level, per-route
    // role guards below it). Like retro, deliberately NOT under the '/api'
    // checkPermission block — that middleware cannot see :projectId/:cycleId
    // from there and would fall through to next(), leaving routes un-scoped.
    app.use('/api/performance-review', performanceReviewRoutes);

    // Member self-service dashboard (includes own auth; self-scoped, no checkPermission)
    app.use('/api/member', memberRoutes);

    // PUBLIC collector installer content (curl|bash / iwr|iex). No auth, no secrets.
    app.use('/api/collector', installRoutes);

    // Claude usage collector ingest — machine-to-server. Auth is the per-user
    // ingest token (inside the router), NOT JWT; consent is enforced there too.
    app.use('/api/ingest', ingestRoutes);

    // Admin: versioned Claude cost model (own auth + admin/superuser check inside).
    app.use('/api/admin/claude-pricing', pricingRoutes);

    // Admin: what this app itself spends on the Anthropic API (distinct from the
    // collector's Claude Code telemetry above). Read-only.
    app.use('/api/admin/ai-spend', aiSpendRoutes);

    // Admin: allowlist of monitored customer Claude orgs (multi-customer scoping).
    app.use('/api/admin/monitored-orgs', monitoredOrgRoutes);

    // Admin: Data Quality — rows flagged by the collector integrity heuristics.
    app.use('/api/admin/claude-integrity', integrityRoutes);

    // Admin: ingest rate limit — global default + per-token override (ADDENDUM 11 Phase 1).
    app.use('/api/admin/ingest-rate-limit', ingestRateLimitRoutes);
    app.use('/api/admin/collector-version-policy', collectorVersionPolicyRoutes);

    // Admin: Claude ingest audit log — superuser-only, project-scoped even for
    // superusers (ADDENDUM 11 Phase 3).
    app.use('/api/admin/claude-ingest-audit', claudeIngestAuditLogRoutes);

    // Admin: who has installed the collector + last sync (ADDENDUM 19) — superuser-only.
    app.use('/api/admin/collector-installs', collectorInstallsRoutes);

    // Program management routes (programs = grouping of projects under an account)
    app.use('/api/programs', programRoutes);

    // Admin routes (includes own auth and superuser check)
    app.use('/api/admin', adminRoutes);

    // Notifications admin (superuser only; own auth and role check)
    app.use('/api/admin/notifications', notificationRoutes);

    // Data source — Excel import + template download (own auth)
    app.use('/api/datasource', dataSourceRoutes);

    // Protected Routes (with authentication and strict permission checks)
    app.use('/api', authenticate, checkPermission, reportRoutes);
    app.use('/api', authenticate, checkPermission, teamRoutes);
    app.use('/api', authenticate, checkPermission, projectRoutes);
    app.use('/api', authenticate, checkPermission, accountRoutes);

    // Error handling
    // eslint-disable-next-line @typescript-eslint/no-unused-vars
    app.use((err: unknown, req: express.Request, res: express.Response, next: express.NextFunction) => {
        console.error('Unhandled error:', err);
        const message = err instanceof Error ? err.message : 'Unknown error';
        res.status(500).json({
            error: 'Internal Server Error',
            message
        });
    });

    return app;
}
