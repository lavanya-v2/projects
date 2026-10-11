/* eslint-disable @typescript-eslint/no-explicit-any */
import { Request, Response, NextFunction } from 'express';
import jwt from 'jsonwebtoken';
import { UserPermission } from '../models/UserPermission';
import { UserRole } from '../models/UserRole';
import { Role } from '../models/Role';
import { User } from '../models/User';
import { PortfolioPresentation } from '../models/PortfolioPresentation';
import { tokenBlacklistService } from '../services/tokenBlacklistService';
import { usageTrackingService } from '../services/usageTrackingService';
import { getAccessibleProjectIds, getAccessibleProjectIdsInAccount } from '../common/projectAccess';

interface AuthRequest extends Request {
  user?: any;
  sessionId?: string | null;
  portfolioPresentation?: PortfolioPresentation;
}

export const authenticate = async (req: AuthRequest, res: Response, next: NextFunction) => {
  const authHeader = req.headers.authorization;

  if (!authHeader) {
    return res.status(401).json({ error: 'No token provided' });
  }

  const token = authHeader.split(' ')[1]; // Bearer <token>

  try {
    // Check blacklist
    const isBlacklisted = await tokenBlacklistService.isBlacklisted(token);
    if (isBlacklisted) {
      return res.status(401).json({ error: 'Token is invalidated' });
    }

    const decoded: any = jwt.verify(token, process.env.JWT_SECRET || 'default_secret_key');

    // Fetch fresh user data to ensure they are still active.
    //
    // Statically imported: User is already in this module's graph transitively
    // (UserRole imports it), so the lazy require this replaced guarded against no
    // real cycle — and it threw outright under ESM, where `require` is undefined.
    // Because the catch below maps any throw to "Invalid token", that surfaced as
    // a bogus 401 rather than an error anyone could diagnose.
    const user = await User.findByPk(decoded.id);

    if (!user) {
      return res.status(403).json({ error: 'User not found' });
    }

    // Resolve primary role from user_roles table
    const userRoleRecord = await UserRole.findOne({
      where: { userId: user.id },
      include: [{ model: Role, as: 'role' }],
    });
    const primaryRoleName = (userRoleRecord as any)?.role?.name || null;

    // Map to legacy ENUM value for backward compat; users.role ENUM is the source of truth
    // Only upgrade to SUPERUSER via user_roles if user.role isn't already SUPERUSER
    const legacyRole = user.role === 'SUPERUSER' ? 'SUPERUSER' : primaryRoleName === 'superuser' ? 'SUPERUSER' : 'USER';

    if (!user.isActive && legacyRole !== 'SUPERUSER') {
      return res.status(403).json({ error: 'User is inactive' });
    }

    req.user = {
      ...user.toJSON(),
      role: legacyRole, // keeps all existing req.user.role === 'SUPERUSER' checks working
      roleName: primaryRoleName, // new fine-grained role name (e.g. 'superuser', 'manager', 'lead', 'member')
    };
    // Session id from the JWT `sid` claim; absent on tokens minted before usage
    // tracking shipped, in which case all tracking calls no-op.
    req.sessionId = decoded.sid || null;

    // Fire-and-forget heartbeat — Redis-throttled to one DB write per session
    // per 2 min. Never awaited, never allowed to fail the request.
    void usageTrackingService.touchSession(req.sessionId);

    next();
  } catch (error: any) {
    if (error.name === 'TokenExpiredError') {
      // jwt.decode still works on an expired token, so we can attribute the
      // natural 24h session end to the right session.
      try {
        const expired: any = jwt.decode(token);
        void usageTrackingService.endSession(expired?.sid, 'expired');
      } catch {
        // ignore — tracking must never affect the auth response
      }
      return res.status(401).json({ error: 'Token expired' });
    }
    return res.status(401).json({ error: 'Invalid token' });
  }
};

export const adminOrSuperuserMiddleware = (req: AuthRequest, res: Response, next: NextFunction) => {
  const role = req.user?.role;
  const roleName = req.user?.roleName;
  if (role === 'SUPERUSER' || roleName === 'admin') return next();
  return res.status(403).json({ error: 'Access denied: superuser or admin role required' });
};

// Stricter than adminOrSuperuserMiddleware — excludes plain `admin` roleName.
// Used for the Claude ingest audit log (ADDENDUM 11 Phase 3), which surfaces raw
// per-attempt ingest data (IP, payload) and was explicitly scoped superuser-only.
export const superuserOnlyMiddleware = (req: AuthRequest, res: Response, next: NextFunction) => {
  const role = req.user?.role;
  const roleName = req.user?.roleName;
  if (role === 'SUPERUSER' || roleName === 'superuser') return next();
  return res.status(403).json({ error: 'Access denied: superuser role required' });
};

// Blocks the 'lead' role from report write/generate operations.
// Leads have read-only access to daily/weekly/monthly reports and
// full CRUD access only to sprint data.
export const leadOrAboveMiddleware = (req: AuthRequest, res: Response, next: NextFunction) => {
  const role = req.user?.role;
  const roleName = req.user?.roleName;
  if (role === 'SUPERUSER' || roleName === 'admin' || roleName === 'lead' || roleName === 'manager') {
    return next();
  }
  return res.status(403).json({ error: 'Access denied: lead role or above required' });
};

/**
 * Read access to a project's team-performance / scorecard data.
 *
 * NOTE: the global `checkPermission` cannot scope these routes because it runs at
 * the `/api` mount point where `req.params.projectId` is not yet populated, so it
 * treats them as un-scoped and allows them. This route-level guard does the real
 * project scoping:
 *   - superuser / admin / manager / lead → org-wide read access (unchanged behaviour)
 *   - everyone else (e.g. members)        → only projects within their own access scope
 */
export const teamPerfReadAccess = async (req: AuthRequest, res: Response, next: NextFunction) => {
  try {
    const role = req.user?.role;
    const roleName = req.user?.roleName;
    if (role === 'SUPERUSER' || roleName === 'admin' || roleName === 'lead' || roleName === 'manager') {
      return next();
    }
    // projectId may arrive as a route param (per-project routes) or a query param (/team-members).
    const projectId = Number(req.params.projectId ?? req.query.projectId);
    if (!projectId) return res.status(403).json({ error: 'Access denied' });
    const accessible = await getAccessibleProjectIds(req.user!.id);
    if (accessible.has(projectId)) return next();
    return res.status(403).json({ error: 'Access denied: project not in your scope' });
  } catch (err) {
    console.error('teamPerfReadAccess error:', err);
    return res.status(500).json({ error: 'Permission check failed' });
  }
};

/**
 * Custom Range Report access: lead, manager, admin and superuser only, and for a specific
 * project only when it is within the caller's assignment (UserPermission). Unlike
 * teamPerfReadAccess this does NOT treat lead/manager as org-wide. Superuser/admin see all.
 * Routes without a projectId (the project list) pass after the role check; the controller
 * then scopes the list itself.
 */
export const customRangeReportAccess = async (req: AuthRequest, res: Response, next: NextFunction) => {
  try {
    const role = req.user?.role;
    const roleName = req.user?.roleName;
    const privileged = role === 'SUPERUSER' || roleName === 'superuser' || roleName === 'admin';
    if (!privileged && roleName !== 'lead' && roleName !== 'manager') {
      return res.status(403).json({ error: 'Access denied: lead role or above required' });
    }
    if (privileged) return next();
    const raw = req.body?.projectId ?? req.query?.projectId;
    if (raw === undefined || raw === null || raw === '') return next();
    const projectId = Number(raw);
    if (!projectId) return res.status(400).json({ error: 'projectId must be a number' });
    const accessible = await getAccessibleProjectIds(req.user!.id);
    if (accessible.has(projectId)) return next();
    return res.status(403).json({ error: 'Access denied: project not in your scope' });
  } catch (err) {
    console.error('customRangeReportAccess error:', err);
    return res.status(500).json({ error: 'Permission check failed' });
  }
};

/**
 * Gate a route to the PILOT allowlist for a feature. Superuser/admin always pass
 * (so they can administer/preview); everyone else must have a non-revoked
 * feature_pilot row. Mirrors the async guard shape of teamPerfReadAccess.
 */
export const pilotMiddleware =
  (feature: string) => async (req: AuthRequest, res: Response, next: NextFunction) => {
    try {
      const role = req.user?.role;
      const roleName = req.user?.roleName;
      if (role === 'SUPERUSER' || roleName === 'admin') return next();
      // eslint-disable-next-line @typescript-eslint/no-require-imports
      const { pilotService } = require('../modules/usageCollector/services/pilotService');
      if (req.user?.id && (await pilotService.isEnabled(req.user.id, feature))) return next();
      return res.status(403).json({ error: 'Access denied: not in the pilot for this feature' });
    } catch (err) {
      console.error('pilotMiddleware error:', err);
      return res.status(500).json({ error: 'Permission check failed' });
    }
  };

export const blockLeadMiddleware = (req: AuthRequest, res: Response, next: NextFunction) => {
  if (req.user?.roleName === 'lead') {
    return res.status(403).json({ error: 'Access denied: leads have read-only access to reports' });
  }
  return next();
};

// Read access to the customer Executive Dashboard endpoints. Admits the
// 'executive' role in addition to lead+ (so internal roles can preview the view).
// Project-level scoping for executives is enforced in the controller by
// intersecting with getAccessibleProjectIdsInAccount.
export const executiveReadAccess = (req: AuthRequest, res: Response, next: NextFunction) => {
  const role = req.user?.role;
  const roleName = req.user?.roleName;
  if (
    role === 'SUPERUSER' ||
    roleName === 'admin' ||
    roleName === 'lead' ||
    roleName === 'manager' ||
    roleName === 'executive'
  ) {
    return next();
  }
  return res.status(403).json({ error: 'Access denied: executive access required' });
};

// A manager has FULL account access when they hold an account-scoped permission row
// (programId IS NULL) with an empty/null projectIds list. Program-owner rows also live
// under this accountId with empty projectIds, so we pin to programId: null to exclude them.
export const hasFullAccountAccess = async (userId: number, accountId: number): Promise<boolean> => {
  // findAll, not findOne: with no unique constraint on (userId, accountId,
  // programId), a stale duplicate row can sit next to the real, current one,
  // and findOne's unordered pick could return either. Fail closed: every
  // matching row must agree access is unrestricted (empty projectIds) — a
  // single scoped row narrows access even if a stale empty-projectIds row is
  // still sitting next to it, so `some()` here would be the over-grant this
  // exists to prevent, not a fix for it.
  const perms = await UserPermission.findAll({ where: { userId, accountId, programId: null } });
  return perms.length > 0 && perms.every(perm => !perm.projectIds || (perm.projectIds as number[]).length === 0);
};

export const requireAccountWriteAccess = async (req: AuthRequest, res: Response, next: NextFunction) => {
  try {
    const role = req.user?.role;
    const roleName = req.user?.roleName;

    if (role === 'SUPERUSER' || roleName === 'admin') return next();
    if (roleName === 'lead' || roleName === 'member') {
      return res.status(403).json({ error: 'Access denied' });
    }

    // Manager: must have full account access (UserPermission with empty/null projectIds)
    const accountId = Number(req.params.accountId || req.body.accountId);
    if (!accountId) return res.status(400).json({ error: 'Account ID required' });

    if (await hasFullAccountAccess(req.user!.id, accountId)) return next();

    return res.status(403).json({ error: 'Access denied: full account permission required' });
  } catch (err) {
    console.error('requireAccountWriteAccess error:', err);
    res.status(500).json({ error: 'Permission check failed' });
  }
};

/**
 * Read-access guard for ACCOUNT-LEVEL action items. Account items may carry
 * strategic/sensitive content, so reads (list, detail, comments) are restricted
 * to superuser, admin, and managers with FULL account access. Leads and members
 * are always denied. Resolves the target accountId from the route shape:
 *   - :accountId param            -> use directly
 *   - :id param (account item id) -> AccountActionItem.accountId
 *   - :commentId param            -> ActionItemComment.accountActionItemId -> AccountActionItem.accountId
 */
export const requireAccountReadAccess = async (req: AuthRequest, res: Response, next: NextFunction) => {
  try {
    const role = req.user?.role;
    const roleName = req.user?.roleName;

    if (role === 'SUPERUSER' || roleName === 'admin') return next();
    if (roleName === 'lead' || roleName === 'member') {
      return res.status(403).json({ error: 'Access denied' });
    }

    // eslint-disable-next-line @typescript-eslint/no-require-imports
    const { AccountActionItem } = require('../models/AccountActionItem');
    let accountId: number | null = null;

    if (req.params.accountId) {
      accountId = Number(req.params.accountId);
    } else if (req.params.id) {
      const item = await AccountActionItem.findByPk(Number(req.params.id));
      if (!item) return res.status(404).json({ error: 'Account action item not found' });
      accountId = (item as any).accountId;
    } else if (req.params.commentId) {
      // eslint-disable-next-line @typescript-eslint/no-require-imports
      const { ActionItemComment } = require('../models/ActionItemComment');
      const comment = await ActionItemComment.findByPk(Number(req.params.commentId));
      if (!comment || !(comment as any).accountActionItemId) {
        return res.status(404).json({ error: 'Account action item comment not found' });
      }
      const item = await AccountActionItem.findByPk((comment as any).accountActionItemId);
      if (!item) return res.status(404).json({ error: 'Account action item not found' });
      accountId = (item as any).accountId;
    }

    if (!accountId) return res.status(400).json({ error: 'Account ID required' });

    if (await hasFullAccountAccess(req.user!.id, accountId)) return next();

    return res.status(403).json({ error: 'Access denied: full account permission required' });
  } catch (err) {
    console.error('requireAccountReadAccess error:', err);
    res.status(500).json({ error: 'Permission check failed' });
  }
};

export const checkPermission = async (req: AuthRequest, res: Response, next: NextFunction) => {
  try {
    const userId = req.user?.id;
    const userRole = req.user?.role;

    if (!userId) {
      return res.status(401).json({ error: 'User not authenticated' });
    }

    // SUPERUSER / admin bypass - has access to everything
    if (userRole === 'SUPERUSER' || (req.user as any)?.roleName === 'admin') {
      return next();
    }

    // Determine if the request is for an account, program, or a project.
    // Most-specific wins: project > program > account.
    let resourceId: { type: 'PROJECT' | 'PROGRAM' | 'ACCOUNT'; id: number } | null = null;

    // 1. Get Resource ID from Params
    if (req.params.accountId) resourceId = { type: 'ACCOUNT', id: Number(req.params.accountId) };
    if (req.params.programId) resourceId = { type: 'PROGRAM', id: Number(req.params.programId) };
    if (req.params.projectId) resourceId = { type: 'PROJECT', id: Number(req.params.projectId) };

    // 2. Get Resource ID from Body (if not found in params)
    if (!resourceId) {
      if (req.body.accountId) resourceId = { type: 'ACCOUNT', id: Number(req.body.accountId) };
      if (req.body.programId) resourceId = { type: 'PROGRAM', id: Number(req.body.programId) };
      if (req.body.projectId) resourceId = { type: 'PROJECT', id: Number(req.body.projectId) };
    }

    // 3. Get Resource ID from Query (if not found in params or body)
    if (!resourceId) {
      if (req.query.accountId) resourceId = { type: 'ACCOUNT', id: Number(String(req.query.accountId)) };
      if (req.query.programId) resourceId = { type: 'PROGRAM', id: Number(String(req.query.programId)) };
      if (req.query.projectId) resourceId = { type: 'PROJECT', id: Number(String(req.query.projectId)) };
    }

    // 4. Handle projectName (used by report endpoints) - resolve to projectId
    if (!resourceId) {
      const projectName = req.body.projectName || req.query.projectName;
      if (projectName) {
        // eslint-disable-next-line @typescript-eslint/no-require-imports
        const { Project } = require('../models/Project');
        const project = await Project.findOne({ where: { code: projectName } });
        if (project) {
          resourceId = { type: 'PROJECT', id: project.id };
        }
      }
    }

    console.log('--- Auth Debug ---');
    console.log('Params:', req.params);
    console.log('Body:', req.body);
    console.log('Query:', req.query);
    console.log('ResourceId:', resourceId);

    if (!resourceId) {
      console.log('No resource ID found, allowing access.');
      // If neither project nor account is specified, allow access (e.g. general list endpoints)
      return next();
    }

    // 4. Check Permissions
    const permissions = await UserPermission.findAll({ where: { userId } });
    console.log(`Found ${permissions.length} permissions for user ${userId}`);

    // Special case: Generating an account-wide report requires FULL access to that account.
    // We only enforce full access for POST, PUT, DELETE (generation/regeneration)
    const isAccountReportAction = req.path.includes('/report/account');
    const requiresFullAccountAccess = isAccountReportAction && ['POST', 'PUT', 'DELETE'].includes(req.method);

    // Extract permission checks
    let hasAccess = false;

    // Resolve PROGRAM lookup once outside the loop if needed
    let programForResource: any = null;
    if (resourceId?.type === 'PROGRAM') {
      // eslint-disable-next-line @typescript-eslint/no-require-imports
      const { Program } = require('../models/Program');
      programForResource = await Program.findByPk(resourceId.id);
      if (!programForResource) {
        return res.status(404).json({ error: 'Program not found' });
      }
    }

    // Resolve PROJECT lookup once outside the loop if needed
    let projectForResource: any = null;
    if (resourceId?.type === 'PROJECT') {
      // eslint-disable-next-line @typescript-eslint/no-require-imports
      const { Project } = require('../models/Project');
      projectForResource = await Project.findByPk(resourceId.id);
    }

    for (const p of permissions) {
      if (resourceId?.type === 'ACCOUNT') {
        if (p.accountId === resourceId.id) {
          if (requiresFullAccountAccess) {
            // Must have an empty/null projectIds array to signify "All Projects"
            // OR they must explicitly have every project ID for that account
            if (!p.programId && (!p.projectIds || p.projectIds.length === 0)) {
              hasAccess = true;
              break;
            } else if (!p.programId && p.projectIds && p.projectIds.length > 0) {
              // eslint-disable-next-line @typescript-eslint/no-require-imports
              const { Project } = require('../models/Project');
              const totalProjectsCount = await Project.count({ where: { accountId: p.accountId } });
              if (p.projectIds.length >= totalProjectsCount) {
                hasAccess = true;
                break;
              }
            }
          } else {
            // A program-scoped permission row alone does NOT grant generic account access for non-write reads;
            // require either full account access or an explicit per-project entry.
            if (!p.programId) {
              hasAccess = true;
              break;
            }
          }
        }
      } else if (resourceId?.type === 'PROGRAM') {
        // Program reports are restricted to designated owners only.
        // Superuser / admin already short-circuit at the top of this middleware.
        // Account-wide access intentionally does NOT grant access here — see Phase 6.
        if (programForResource && p.accountId === programForResource.accountId && p.programId === resourceId.id) {
          hasAccess = true;
          break;
        }
      } else if (resourceId?.type === 'PROJECT') {
        // 1. Explicit project access
        if (p.projectIds && p.projectIds.length > 0) {
          if (p.projectIds.includes(resourceId.id)) {
            hasAccess = true;
            break;
          }
        }

        // 2. Full account access (no program scope, no project filter)
        if (!p.programId && (!p.projectIds || p.projectIds.length === 0)) {
          if (projectForResource && projectForResource.accountId === p.accountId) {
            hasAccess = true;
            break;
          }
        }

        // 3. Program-scoped access — allow if the project belongs to that program
        if (p.programId && projectForResource && projectForResource.programId === p.programId) {
          hasAccess = true;
          break;
        }
      }
    }

    console.log(
      `[AUTH] Strict Access for user ${userId} (Role: ${userRole}) to ${resourceId ? `${resourceId.type} ${resourceId.id}` : 'General'}:`,
      hasAccess
    );

    if (hasAccess) return next();

    return res.status(403).json({ error: 'Access denied: Full account permission required for this action' });
  } catch (error) {
    console.error('Permission check error:', error);
    res.status(500).json({ error: 'An error occurred' });
  }
};

/**
 * Project-scoped guard for an existing Portfolio Presentation by :id.
 *
 *   - Superuser / admin              → always allowed
 *   - 'delete' mode                  → allowed only if user is the creator
 *   - 'read' / 'write' mode          → allowed if user has access to ≥1 of
 *                                       the presentation's selectedProjectIds
 *
 * Loads the row once and attaches it to req.portfolioPresentation so the
 * controller doesn't need to re-fetch.
 */
export const requirePortfolioPresentationAccess =
  (mode: 'read' | 'write' | 'delete') => async (req: AuthRequest, res: Response, next: NextFunction) => {
    try {
      const userId = req.user?.id;
      const role = req.user?.role;
      const roleName = req.user?.roleName;
      if (!userId) return res.status(401).json({ error: 'User not authenticated' });

      const id = parseInt(req.params.id as string);
      if (!id) return res.status(400).json({ error: 'Presentation ID required' });

      const presentation = await PortfolioPresentation.findByPk(id);
      if (!presentation) return res.status(404).json({ error: 'Presentation not found' });

      // Cache the loaded row on req so controllers can reuse it
      req.portfolioPresentation = presentation;

      // Delete is restricted to SUPERUSER only — not the creator, not admins,
      // not project-scoped members. Checked before the generic superuser/admin
      // shortcut so an admin can't fall through to a delete.
      if (mode === 'delete') {
        if (role === 'SUPERUSER' || roleName === 'superuser') return next();
        return res.status(403).json({ error: 'Only a superuser can delete a presentation' });
      }

      if (role === 'SUPERUSER' || roleName === 'admin') return next();

      const ids = Array.isArray(presentation.selectedProjectIds) ? presentation.selectedProjectIds : [];
      if (ids.length === 0) {
        return res.status(403).json({ error: 'Access denied' });
      }
      const accessible = await getAccessibleProjectIds(userId);
      const overlap = ids.some(pid => accessible.has(pid));
      if (overlap) return next();

      return res.status(403).json({ error: 'Access denied: no included project is in your scope' });
    } catch (err) {
      console.error('requirePortfolioPresentationAccess error:', err);
      res.status(500).json({ error: 'Permission check failed' });
    }
  };

/**
 * Account-level read/preview/create guard for Portfolio Presentations.
 *
 *   - Superuser / admin           → always allowed
 *   - Manager / Lead              → allowed if they have access to ≥1 project
 *                                    in the account
 *   - Member / anyone else        → denied
 *
 * Note: this only gates the account route layer. For create, the controller
 * also validates that the caller has access to ≥1 of the selectedProjectIds
 * in the request body.
 */
export const requireAccountAccessForPresentation = async (req: AuthRequest, res: Response, next: NextFunction) => {
  try {
    const userId = req.user?.id;
    const role = req.user?.role;
    const roleName = req.user?.roleName;
    if (!userId) return res.status(401).json({ error: 'User not authenticated' });

    if (role === 'SUPERUSER' || roleName === 'admin') return next();
    if (roleName !== 'manager' && roleName !== 'lead') {
      return res.status(403).json({ error: 'Access denied' });
    }

    const accountId = Number(req.params.accountId || req.body.accountId);
    if (!accountId) return res.status(400).json({ error: 'Account ID required' });

    const accessibleInAccount = await getAccessibleProjectIdsInAccount(userId, accountId);
    if (accessibleInAccount.length > 0) return next();

    return res.status(403).json({ error: 'Access denied: no project in this account is in your scope' });
  } catch (err) {
    console.error('requireAccountAccessForPresentation error:', err);
    res.status(500).json({ error: 'Permission check failed' });
  }
};
