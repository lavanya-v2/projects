import { Op } from 'sequelize';
import { PerfSprintSync } from '../../../models/PerfSprintSync';
import { Project } from '../../../models/Project';

/** How many cadence periods of silence before a project reads as "not getting regular data". */
const STALE_AFTER_PERIODS = 2;
const CADENCE_MONTHS: Record<'monthly' | 'quarterly', number> = { monthly: 1, quarterly: 3 };

export interface ProjectDataHealth {
    projectId: number;
    isSharedTeam: boolean;
    lastSyncEndDate: string | null;
    hasRecentSync: boolean;
    /** True when neither flag applies — nothing to warn about. */
    healthy: boolean;
    /** Human-readable reasons, empty when healthy. Never a hard block — informational only. */
    reasons: string[];
}

/**
 * Flags a project as worth a second look before adding it to review scope —
 * never a block. Matches every other gate in this module (Phase 8's partial
 * identity rollout): inform, don't hide. A superuser can still deliberately
 * add a flagged project; this only stops it from silently looking identical
 * to a healthy one.
 *
 * Two independent reasons, either is enough to flag:
 *   - `isSharedTeam` — the project's own team-sharing flag, already used
 *     elsewhere in the app for the same "this isn't a clean one-team signal"
 *     concept.
 *   - No successful sync in the last `STALE_AFTER_PERIODS` cadence periods —
 *     derived from `PerfSprintSync`, not a stored column, since there's no
 *     "last sync" field on `Project` itself.
 */
export async function getProjectDataHealth(
    projectId: number,
    cadence: 'monthly' | 'quarterly' = 'monthly',
): Promise<ProjectDataHealth> {
    const project = await Project.findByPk(projectId, { attributes: ['id', 'isSharedTeam'] });
    if (!project) {
        return { projectId, isSharedTeam: false, lastSyncEndDate: null, hasRecentSync: false, healthy: false, reasons: ['Project not found'] };
    }

    const lastSync = await PerfSprintSync.findOne({
        where: { projectId, syncStatus: 'done' },
        order: [['endDate', 'DESC']],
        attributes: ['endDate'],
    });

    const staleAfterDays = CADENCE_MONTHS[cadence] * STALE_AFTER_PERIODS * 31;
    const cutoff = new Date();
    cutoff.setDate(cutoff.getDate() - staleAfterDays);

    const lastSyncEndDate = lastSync ? (lastSync as any).endDate as string : null;
    const hasRecentSync = !!lastSyncEndDate && new Date(lastSyncEndDate) >= cutoff;

    const reasons: string[] = [];
    if ((project as any).isSharedTeam) {
        reasons.push('Marked as a shared-team project — delivery data may not cleanly attribute to one team.');
    }
    if (!hasRecentSync) {
        reasons.push(
            lastSyncEndDate
                ? `No successful sync since ${lastSyncEndDate} — more than ${STALE_AFTER_PERIODS} ${cadence} period(s) of silence.`
                : 'No successful sync has ever completed for this project.',
        );
    }

    return {
        projectId,
        isSharedTeam: !!(project as any).isSharedTeam,
        lastSyncEndDate,
        hasRecentSync,
        healthy: reasons.length === 0,
        reasons,
    };
}

/** Batched version for a project picker/rollout list — one query per table, not per project. */
export async function getProjectDataHealthBatch(
    projectIds: number[],
    cadence: 'monthly' | 'quarterly' = 'monthly',
): Promise<Map<number, ProjectDataHealth>> {
    if (projectIds.length === 0) return new Map();

    const [projects, syncs] = await Promise.all([
        Project.findAll({ where: { id: { [Op.in]: projectIds } }, attributes: ['id', 'isSharedTeam'] }),
        PerfSprintSync.findAll({
            where: { projectId: { [Op.in]: projectIds }, syncStatus: 'done' },
            attributes: ['projectId', 'endDate'],
            order: [['endDate', 'DESC']],
        }),
    ]);

    const lastSyncByProject = new Map<number, string>();
    for (const s of syncs) {
        const pid = (s as any).projectId as number;
        if (!lastSyncByProject.has(pid)) lastSyncByProject.set(pid, (s as any).endDate as string);
    }

    const staleAfterDays = CADENCE_MONTHS[cadence] * STALE_AFTER_PERIODS * 31;
    const cutoff = new Date();
    cutoff.setDate(cutoff.getDate() - staleAfterDays);

    const result = new Map<number, ProjectDataHealth>();
    for (const project of projects) {
        const projectId = project.id;
        const lastSyncEndDate = lastSyncByProject.get(projectId) ?? null;
        const hasRecentSync = !!lastSyncEndDate && new Date(lastSyncEndDate) >= cutoff;
        const reasons: string[] = [];
        if ((project as any).isSharedTeam) {
            reasons.push('Marked as a shared-team project — delivery data may not cleanly attribute to one team.');
        }
        if (!hasRecentSync) {
            reasons.push(
                lastSyncEndDate
                    ? `No successful sync since ${lastSyncEndDate} — more than ${STALE_AFTER_PERIODS} ${cadence} period(s) of silence.`
                    : 'No successful sync has ever completed for this project.',
            );
        }
        result.set(projectId, {
            projectId,
            isSharedTeam: !!(project as any).isSharedTeam,
            lastSyncEndDate,
            hasRecentSync,
            healthy: reasons.length === 0,
            reasons,
        });
    }
    return result;
}
