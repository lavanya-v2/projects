import { UserRole } from '../../../models/UserRole';
import { Role } from '../../../models/Role';
import { User } from '../../../models/User';
import { UserPermission } from '../../../models/UserPermission';
import { Project } from '../../../models/Project';
import { Op } from 'sequelize';

export interface RiskPermissions {
    canView: boolean;
    canEdit: boolean;
    canComment: boolean;
    canTransition: boolean;
    canMarkDone: boolean;
    canDelete: boolean;
}

const ROLE_RANK: Record<string, number> = {
    superuser: 4,
    admin: 3,
    manager: 2,
    lead: 1,
    member: 0,
};

const ALL_FALSE: RiskPermissions = {
    canView: false,
    canEdit: false,
    canComment: false,
    canTransition: false,
    canMarkDone: false,
    canDelete: false,
};

interface RequestingUser {
    id: number;
    roleName: string;
}

interface RiskContext {
    creatorId: number;
    creatorRoleName: string;
    projectId: number | null;
}

export function resolveRiskPermissions(
    requestingUser: RequestingUser,
    risk: RiskContext,
    permittedProjectIds: number[]
): RiskPermissions {
    const userRank = ROLE_RANK[requestingUser.roleName] ?? 0;
    const creatorRank = ROLE_RANK[risk.creatorRoleName] ?? 0;

    // Member: no access
    if (userRank === 0) return { ...ALL_FALSE };

    // Superuser: full access
    if (requestingUser.roleName === 'superuser') {
        return { canView: true, canEdit: true, canComment: true, canTransition: true, canMarkDone: true, canDelete: true };
    }

    // Visibility checks for admin, manager, lead
    // 1. Manager/lead cannot see risks created by admin or superuser
    if (userRank <= 2 && creatorRank >= 3) {
        return { ...ALL_FALSE };
    }

    // 2. Unlinked risks (no project): only admin+ can see
    if (risk.projectId === null && userRank < 3) {
        return { ...ALL_FALSE };
    }

    // 3. Risk must be on a permitted project
    if (risk.projectId !== null && !permittedProjectIds.includes(risk.projectId)) {
        return { ...ALL_FALSE };
    }

    // Visible — determine action permissions
    const isOwnRisk = requestingUser.id === risk.creatorId;

    // canEdit: same rank = own only, higher rank = yes, lower rank = no
    // Special: admin cannot edit superuser-created (already filtered above for manager/lead)
    let canEdit = false;
    if (isOwnRisk) {
        canEdit = true;
    } else if (userRank > creatorRank) {
        canEdit = true;
    }

    // canMarkDone: leads cannot close; others follow edit rules
    const canMarkDone = requestingUser.roleName !== 'lead' && canEdit;

    return {
        canView: true,
        canEdit,
        canComment: true,           // all visible roles can comment
        canTransition: true,         // all visible roles can move between active lanes
        canMarkDone,
        canDelete: canEdit,
    };
}

/**
 * Batch-resolve role names for a set of user IDs (avoids N+1 queries in list endpoint).
 *
 * IMPORTANT: The legacy `users.role` ENUM 'SUPERUSER' always wins over the
 * `user_roles` join. Some superuser accounts have a stale 'member' record in
 * user_roles from older seeders, and we must not treat them as members.
 */
export async function batchResolveUserRoles(userIds: number[]): Promise<Map<number, string>> {
    if (userIds.length === 0) return new Map();

    const map = new Map<number, string>();

    // 1. Mark legacy SUPERUSER users first.
    const users = await User.findAll({
        where: { id: { [Op.in]: userIds } },
        attributes: ['id', 'role'],
    });
    for (const u of users) {
        if ((u as any).role === 'SUPERUSER') {
            map.set(u.id, 'superuser');
        }
    }

    // 2. Fill in remaining users from user_roles (overrides only if not already set).
    const userRoles = await UserRole.findAll({
        where: { userId: { [Op.in]: userIds } },
        include: [{ model: Role, as: 'role' }],
    });
    for (const ur of userRoles) {
        if (!map.has(ur.userId)) {
            const roleName = (ur as any).role?.name || 'member';
            map.set(ur.userId, roleName);
        }
    }

    // 3. Default any still-missing users to member.
    for (const id of userIds) {
        if (!map.has(id)) map.set(id, 'member');
    }

    return map;
}

/**
 * Resolve a single user's role name.
 * Same precedence as batchResolveUserRoles: legacy SUPERUSER enum wins.
 */
export async function resolveCreatorRoleName(creatorId: number): Promise<string> {
    const user = await User.findByPk(creatorId, { attributes: ['id', 'role'] });
    if ((user as any)?.role === 'SUPERUSER') return 'superuser';

    const userRole = await UserRole.findOne({
        where: { userId: creatorId },
        include: [{ model: Role, as: 'role' }],
    });
    return (userRole as any)?.role?.name || 'member';
}

/**
 * Resolve permitted project IDs for a user from their UserPermission records.
 */
export async function resolvePermittedProjectIds(userId: number): Promise<number[]> {
    const permissions = await UserPermission.findAll({ where: { userId } });
    const projectIds: number[] = [];

    for (const p of permissions) {
        if (p.projectIds && p.projectIds.length > 0) {
            projectIds.push(...p.projectIds);
        } else if (p.accountId) {
            const accountProjects = await Project.findAll({
                where: { accountId: p.accountId },
                attributes: ['id'],
            });
            projectIds.push(...accountProjects.map(pr => pr.id));
        }
    }

    return [...new Set(projectIds)];
}
