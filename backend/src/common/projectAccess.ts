import { Op } from 'sequelize';
import { UserPermission } from '../models/UserPermission';
import { Project } from '../models/Project';

/**
 * Returns the set of project IDs the given user can reach across all
 * UserPermission rows. Replicates the canonical pattern used elsewhere
 * (projectController, dashboardController). Superuser/admin bypass is the
 * caller's responsibility — this helper is purely about expanding
 * UserPermission rows into a project-ID set.
 *
 * Expansion rules:
 *   - explicit projectIds      → add as-is
 *   - account-wide (no programId, empty projectIds) → all Projects under that account
 *   - program-scoped (programId set) → all Projects with matching programId
 */
export async function getAccessibleProjectIds(userId: number): Promise<Set<number>> {
    const perms = await UserPermission.findAll({ where: { userId } });
    if (perms.length === 0) return new Set();

    const ids = new Set<number>();
    const accountIdsForFullAccess: number[] = [];
    const programIds: number[] = [];

    for (const p of perms) {
        if (p.accountId == null) continue;
        if (p.programId) {
            programIds.push(p.programId);
            continue;
        }
        if (p.projectIds && p.projectIds.length > 0) {
            for (const id of p.projectIds) ids.add(id);
        } else {
            accountIdsForFullAccess.push(p.accountId);
        }
    }

    if (accountIdsForFullAccess.length > 0 || programIds.length > 0) {
        const where: any = { [Op.or]: [] };
        if (accountIdsForFullAccess.length > 0) {
            where[Op.or].push({ accountId: { [Op.in]: accountIdsForFullAccess } });
        }
        if (programIds.length > 0) {
            where[Op.or].push({ programId: { [Op.in]: programIds } });
        }
        const projects = await Project.findAll({ where, attributes: ['id'] });
        for (const p of projects) ids.add(p.id);
    }

    return ids;
}

/**
 * Returns true if the user has access to at least one of the given project IDs.
 * Convenience wrapper around getAccessibleProjectIds for overlap checks.
 */
export async function hasAnyProjectAccess(userId: number, projectIds: number[]): Promise<boolean> {
    if (!projectIds || projectIds.length === 0) return false;
    const accessible = await getAccessibleProjectIds(userId);
    return projectIds.some(id => accessible.has(id));
}

/**
 * Returns the subset of an account's projects the user can reach.
 * Useful for "does user have any project in this account?" checks.
 */
export async function getAccessibleProjectIdsInAccount(userId: number, accountId: number): Promise<number[]> {
    const accessible = await getAccessibleProjectIds(userId);
    if (accessible.size === 0) return [];
    const projects = await Project.findAll({
        where: { accountId, id: { [Op.in]: Array.from(accessible) } },
        attributes: ['id'],
    });
    return projects.map(p => p.id);
}

/**
 * The reverse of getAccessibleProjectIds: for a set of projects, which users can
 * reach each one, and via which of the projects in the input list.
 *
 * Mirrors getAccessibleProjectIds's expansion rules exactly, evaluated in the
 * other direction — a naive `projectIds @> [id]` / `&& [ids]` check (as several
 * call sites used to do directly) misses full-account grants (empty projectIds,
 * no programId) and program-scoped grants entirely, silently excluding anyone
 * who was given broad rather than per-project access. This is what caused a
 * Thrive manager with account-wide access to never show up as an eligible
 * reviewer for one of Thrive's projects.
 */
export async function getUsersWithAccessToProjects(
    projectIds: number[],
): Promise<Map<number, Set<number>>> {
    const result = new Map<number, Set<number>>();
    if (projectIds.length === 0) return result;

    const projects = await Project.findAll({
        where: { id: { [Op.in]: projectIds } },
        attributes: ['id', 'accountId', 'programId'],
    });
    if (projects.length === 0) return result;

    const accountIds = [...new Set(projects.map(p => (p as any).accountId))];
    const programIds = [...new Set(projects.map(p => (p as any).programId).filter((x): x is number => !!x))];

    const or: any[] = [
        { projectIds: { [Op.overlap]: projectIds } },
        {
            programId: null,
            accountId: { [Op.in]: accountIds },
            [Op.or]: [{ projectIds: null }, { projectIds: [] }],
        },
    ];
    if (programIds.length > 0) or.push({ programId: { [Op.in]: programIds } });

    const perms = await UserPermission.findAll({ where: { [Op.or]: or } });

    for (const perm of perms) {
        for (const project of projects) {
            const pid = (project as any).id as number;
            const explicit = (perm.projectIds ?? []).includes(pid);
            const fullAccount =
                !perm.programId &&
                perm.accountId === (project as any).accountId &&
                (!perm.projectIds || perm.projectIds.length === 0);
            const programMatch = !!perm.programId && perm.programId === (project as any).programId;
            if (explicit || fullAccount || programMatch) {
                const set = result.get(perm.userId) ?? new Set<number>();
                set.add(pid);
                result.set(perm.userId, set);
            }
        }
    }
    return result;
}

/**
 * Narrows a list of account-scoped project rows down to the ones the given user
 * can access. Superuser/admin bypass and see everything unfiltered; everyone else
 * is intersected against their UserPermission scope via getAccessibleProjectIdsInAccount.
 * Reused by the Team Performance Trends overview/download endpoints.
 */
export async function scopeToAccessibleProjects<T extends { projectId: number }>(
    user: { id: number; role?: string; roleName?: string } | undefined,
    accountId: number,
    projects: T[],
): Promise<T[]> {
    if (!user) return [];
    const privileged = user.role === 'SUPERUSER' || user.roleName === 'admin';
    if (privileged) return projects;
    const accessible = new Set(await getAccessibleProjectIdsInAccount(user.id, accountId));
    return projects.filter(p => accessible.has(p.projectId));
}
