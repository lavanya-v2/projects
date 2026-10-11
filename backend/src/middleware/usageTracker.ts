/* eslint-disable @typescript-eslint/no-explicit-any */
import { Request, Response, NextFunction } from 'express';
import { usageTrackingService } from '../services/usageTrackingService';

interface TrackedRequest extends Request {
    user?: any;
    sessionId?: string | null;
}

export interface FeatureRoute {
    /** HTTP verbs this entry applies to. '*' matches any verb. */
    methods: string[];
    pattern: RegExp;
    feature: string;
}

/**
 * Allowlist of meaningful user actions. Deliberately not every endpoint —
 * polling/lookup calls would drown the signal. First match wins, so more
 * specific patterns must come before general ones.
 *
 * Adding coverage later is a one-line change here.
 */
export const FEATURE_ROUTES: FeatureRoute[] = [
    // --- Presentations (specific paths first) ---
    { methods: ['POST'], pattern: /^\/api\/report\/account\/[^/]+\/portfolio-presentation\/preview$/, feature: 'presentation.preview' },
    { methods: ['POST'], pattern: /^\/api\/report\/account\/[^/]+\/portfolio-presentation$/, feature: 'presentation.create' },
    { methods: ['GET'], pattern: /^\/api\/report\/account\/[^/]+\/portfolio-presentation$/, feature: 'presentation.view' },
    { methods: ['POST'], pattern: /^\/api\/report\/portfolio-presentation\/[^/]+\/(mom\/(generate|save|accept)|refresh|duplicate)$/, feature: 'presentation.edit' },
    { methods: ['GET'], pattern: /^\/api\/report\/portfolio-presentation\/[^/]+$/, feature: 'presentation.view' },
    { methods: ['PUT'], pattern: /^\/api\/report\/portfolio-presentation\/[^/]+$/, feature: 'presentation.edit' },
    { methods: ['DELETE'], pattern: /^\/api\/report\/portfolio-presentation\/[^/]+$/, feature: 'presentation.delete' },

    // --- Action items ---
    { methods: ['GET'], pattern: /^\/api\/report\/my\/(project|program|account)-action-items$/, feature: 'action_item.view' },
    { methods: ['GET'], pattern: /^\/api\/report\/(project|program|account)\/[^/]+\/action-items$/, feature: 'action_item.view' },
    { methods: ['POST'], pattern: /^\/api\/report\/(project|program|account)\/[^/]+\/action-items$/, feature: 'action_item.create' },
    { methods: ['POST'], pattern: /^\/api\/report\/(project|program|account)?-?action-item\/[^/]+\/comments$/, feature: 'action_item.comment' },
    { methods: ['POST'], pattern: /^\/api\/report\/([a-z]+-)?action-item\/[^/]+\/transition$/, feature: 'action_item.update' },
    { methods: ['PUT'], pattern: /^\/api\/report\/([a-z]+-)?action-item\/[^/]+$/, feature: 'action_item.update' },
    { methods: ['DELETE'], pattern: /^\/api\/report\/([a-z]+-)?action-item\/[^/]+$/, feature: 'action_item.delete' },

    // --- Insights / manager notes ---
    { methods: ['PATCH'], pattern: /^\/api\/report\/daily\/[^/]+\/insights/, feature: 'insight.edit' },
    { methods: ['PATCH'], pattern: /^\/api\/report\/[^/]+\/[^/]+\/insights\/accept$/, feature: 'insight.accept' },
    { methods: ['PATCH'], pattern: /^\/api\/report\/[^/]+\/[^/]+\/team-notes$/, feature: 'insight.edit' },
    { methods: ['POST'], pattern: /^\/api\/report\/[^/]+\/[^/]+\/insights\/preview$/, feature: 'insight.preview' },

    // --- Team performance / sync ---
    { methods: ['POST'], pattern: /^\/api\/report\/project\/[^/]+\/perf\/sync\//, feature: 'perf.sync' },
    { methods: ['GET', 'PATCH'], pattern: /^\/api\/report\/project\/[^/]+\/perf\//, feature: 'team_performance.view' },
    { methods: ['GET', 'POST'], pattern: /^\/api\/report\/project\/[^/]+\/(team-performance|team-dashboard|member-delivery-matrix)/, feature: 'team_performance.view' },
    { methods: ['GET'], pattern: /^\/api\/report\/reconciliation\//, feature: 'team_performance.view' },

    // --- Downloads / exports (before the generic view patterns) ---
    { methods: ['GET', 'POST'], pattern: /^\/api\/report\/.*(download|download-csv|download-text|download-ppt|bulk-download)/, feature: 'report.export' },

    // --- Report generation ---
    { methods: ['POST'], pattern: /^\/api\/report\/async$/, feature: 'report.generate' },
    { methods: ['POST'], pattern: /^\/api\/report$/, feature: 'report.generate' },
    { methods: ['POST'], pattern: /^\/api\/report\/(weekly|account\/weekly|account\/monthly|project\/monthly)$/, feature: 'report.generate' },
    { methods: ['POST'], pattern: /^\/api\/report\/program\/[^/]+\/(daily|weekly|monthly)(\/queue)?$/, feature: 'report.generate' },

    // --- Report viewing ---
    { methods: ['GET'], pattern: /^\/api\/report\/(project|program|account)\/[^/]+\/daily$/, feature: 'report.view_daily' },
    { methods: ['GET'], pattern: /^\/api\/report\/(project|program|account)\/[^/]+\/weekly$/, feature: 'report.view_weekly' },
    { methods: ['GET'], pattern: /^\/api\/report\/(project|program|account)\/[^/]+\/monthly$/, feature: 'report.view_monthly' },

    // --- Dashboards ---
    { methods: ['GET'], pattern: /^\/api\/report\/executive\//, feature: 'dashboard.executive' },
    { methods: ['GET'], pattern: /^\/api\/report\/dashboard-(overview|project)/, feature: 'dashboard.overview' },
    { methods: ['GET'], pattern: /^\/api\/report\/quality-trends-overview$/, feature: 'dashboard.quality_trends' },
    { methods: ['GET'], pattern: /^\/api\/report\/productivity-overview$/, feature: 'dashboard.productivity' },
    { methods: ['GET'], pattern: /^\/api\/member\/dashboard$/, feature: 'dashboard.member' },

    // --- Excel data source ---
    { methods: ['POST'], pattern: /^\/api\/datasource\/projects\/[^/]+\/[^/]+\/imports$/, feature: 'excel.upload' },
    { methods: ['POST'], pattern: /^\/api\/datasource\/[^/]+\/validate$/, feature: 'excel.validate' },
    { methods: ['GET'], pattern: /^\/api\/datasource\/excel\/template\//, feature: 'excel.template_download' },

    // --- Risks ---
    { methods: ['POST'], pattern: /^\/api\/risks$/, feature: 'risk.create' },
    { methods: ['PUT', 'PATCH', 'DELETE'], pattern: /^\/api\/risks\//, feature: 'risk.update' },
    { methods: ['GET'], pattern: /^\/api\/risks/, feature: 'risk.view' },

    // --- Programs ---
    { methods: ['POST', 'PUT', 'PATCH', 'DELETE'], pattern: /^\/api\/programs/, feature: 'program.manage' },

    // --- Administration ---
    // Only the summary endpoint is tracked: the dashboard fires four calls per
    // load and we do not want a single page view counted four times.
    { methods: ['GET'], pattern: /^\/api\/admin\/usage\/summary$/, feature: 'admin.usage_report' },
    { methods: ['GET', 'POST', 'PUT', 'DELETE'], pattern: /^\/api\/admin\/notifications/, feature: 'admin.notifications' },
    { methods: ['POST', 'PUT', 'DELETE'], pattern: /^\/api\/admin\/(accounts|projects|team-members)/, feature: 'admin.manage_entities' },
    { methods: ['POST', 'PUT', 'DELETE'], pattern: /^\/api\/users/, feature: 'admin.manage_users' },

    // --- Profile ---
    { methods: ['PUT', 'PATCH', 'POST'], pattern: /^\/api\/profile/, feature: 'profile.edit' },
];

function matchFeature(method: string, path: string): string | null {
    for (const route of FEATURE_ROUTES) {
        if (!route.methods.includes('*') && !route.methods.includes(method)) continue;
        if (route.pattern.test(path)) return route.feature;
    }
    return null;
}

/** Best-effort project id from the path, for drilldown. */
function extractProjectId(path: string): number | null {
    const match = path.match(/\/projects?\/(\d+)(\/|$)/);
    if (!match) return null;
    const id = parseInt(match[1], 10);
    return Number.isNaN(id) ? null : id;
}

/**
 * App-level usage tracking. Registered ONCE in app.ts before the route mounts.
 *
 * It defers all work to `res.on('finish')`, by which point whichever router
 * handled the request has already populated `req.user` — so a single
 * registration covers both the self-authenticating routers (`/api/users`,
 * `/api/admin`, …) and the app-level `authenticate` chain (`/api` + reports).
 */
export const usageTracker = (req: TrackedRequest, res: Response, next: NextFunction) => {
    const feature = matchFeature(req.method, req.path);
    if (!feature) return next();

    const startedAt = Date.now();

    res.on('finish', () => {
        // No authenticated user → unauthenticated or failed auth, nothing to attribute.
        if (!req.user?.id) return;

        // Skip failed reads (noise). Failed writes are kept: an attempted action
        // is still usage, and the status code makes it explicit.
        if (req.method === 'GET' && res.statusCode >= 400) return;

        void usageTrackingService.recordEvent({
            userId: req.user.id,
            sessionId: req.sessionId ?? null,
            roleName: req.user.roleName ?? null,
            eventType: 'feature',
            feature,
            method: req.method,
            path: req.path,
            statusCode: res.statusCode,
            durationMs: Date.now() - startedAt,
            projectId: extractProjectId(req.path),
        });
    });

    next();
};
