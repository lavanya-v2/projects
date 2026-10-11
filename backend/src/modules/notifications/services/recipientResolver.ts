import { Op } from 'sequelize';
import { User } from '../../../models/User';
import { UserRole } from '../../../models/UserRole';
import { Role } from '../../../models/Role';
import { UserPermission } from '../../../models/UserPermission';
import { RecipientsConfig, CcConfig } from '../../../models/NotificationRule';

export interface ResolvedRecipients {
    to: string[];
    cc: string[];
    skippedUserIds: number[];
}

/**
 * Resolve recipient email list based on rule config and event payload scope.
 *
 * Input expectations:
 *   recipientsConfig: { roles: ['manager', 'lead'], scope?: 'project' | 'account' | 'global' }
 *   ccConfig:         { emails: ['x@y.com'] }
 *   scope: { projectId?, accountId? } from event payload
 */
export async function resolveRecipients(
    recipientsConfig: RecipientsConfig | null,
    ccConfig: CcConfig | null,
    scope: { projectId?: number | null; accountId?: number | null }
): Promise<ResolvedRecipients> {
    const to: string[] = [];
    const skipped: number[] = [];
    const seen = new Set<string>();

    const roles = recipientsConfig?.roles ?? [];

    if (roles.length > 0) {
        // Load matching roles by name
        const roleRows = await Role.findAll({ where: { name: { [Op.in]: roles } } });
        const roleIds = roleRows.map(r => r.id);
        if (roleIds.length > 0) {
            const userRoleRows = await UserRole.findAll({
                where: { roleId: { [Op.in]: roleIds } },
                include: [{ model: User, attributes: ['id', 'email', 'userId'] }],
            });

            // Candidate users from role assignment.
            // Fallback: when users.email is null but users.userId looks like an email, use that.
            const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
            const candidateIds = new Set<number>();
            const emailByUserId = new Map<number, string | null>();
            for (const ur of userRoleRows) {
                const u: any = (ur as any).user;
                if (!u) continue;
                candidateIds.add(u.id);
                let email: string | null = u.email ?? null;
                if (!email && typeof u.userId === 'string' && EMAIL_RE.test(u.userId)) {
                    email = u.userId;
                }
                emailByUserId.set(u.id, email);
            }

            // Intersect with project/account permission when scope is set
            const projectId = scope.projectId ?? null;
            const accountId = scope.accountId ?? null;

            let permittedUserIds = candidateIds;

            if (projectId || accountId) {
                const perms = await UserPermission.findAll({
                    where: { userId: { [Op.in]: Array.from(candidateIds) } },
                });
                const allowed = new Set<number>();
                for (const p of perms) {
                    const pids: number[] = (p as any).projectIds ?? [];
                    // Explicit project access
                    if (projectId && pids.includes(projectId)) { allowed.add(p.userId); continue; }
                    // Account-level access with empty projectIds means "all projects in this account"
                    if (accountId && p.accountId === accountId && (!pids || pids.length === 0)) {
                        allowed.add(p.userId);
                    }
                }
                permittedUserIds = allowed;
            }

            for (const uid of permittedUserIds) {
                const email = emailByUserId.get(uid);
                if (!email) { skipped.push(uid); continue; }
                const norm = email.toLowerCase();
                if (seen.has(norm)) continue;
                seen.add(norm);
                to.push(email);
            }
        }
    }

    const ccEmails = (ccConfig?.emails ?? []).filter(Boolean);
    const ccSeen = new Set<string>();
    const cc: string[] = [];
    for (const e of ccEmails) {
        const norm = e.toLowerCase();
        if (seen.has(norm) || ccSeen.has(norm)) continue;
        ccSeen.add(norm);
        cc.push(e);
    }

    return { to, cc, skippedUserIds: skipped };
}
