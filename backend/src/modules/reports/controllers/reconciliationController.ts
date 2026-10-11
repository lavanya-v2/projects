import { Request, Response } from 'express';
import { Op } from 'sequelize';
import { PerfSprintSync } from '../../../models/PerfSprintSync';
import { PerfTicketFact } from '../../../models/PerfTicketFact';
import { Project } from '../../../models/Project';
import { DailyBoardSnapshot } from '../../../models/DailyBoardSnapshot';
import { JiraService } from '../../jira/services/jiraService';
import { buildTicketFactsFromJiraData } from '../services/performanceSyncService';
import { getLaneConfig } from '../../../common/laneDefaults';
import {
    reconcileProject,
} from '../services/__reporting__/reconciliationReport';
import {
    reconcileProjectQuality,
} from '../services/__reporting__/qualityReconciliationReport';

/**
 * Live reconciliation endpoint used by the E2E evidence suite. Fetches the
 * given sync's stored facts plus live Jira data, rebuilds the facts, and
 * returns both the productivity reconciliation and the quality reconciliation.
 * Heavy (hits Jira live); superuser/admin only.
 */
class ReconciliationController {

    /** GET /report/reconciliation/sprint/:syncId */
    async reconcileSprint(req: Request, res: Response): Promise<void> {
        try {
            const syncId = parseInt(req.params.syncId as string);
            if (Number.isNaN(syncId)) {
                res.status(400).json({ error: 'syncId must be an integer' });
                return;
            }

            const sync = await PerfSprintSync.findByPk(syncId);
            if (!sync) { res.status(404).json({ error: 'Sync not found' }); return; }

            const project = await Project.findByPk(sync.projectId);
            if (!project) { res.status(404).json({ error: 'Project not found' }); return; }
            if (!project.jiraBoardId || !sync.jiraSprintId) {
                res.status(400).json({ error: 'Project missing jiraBoardId or sync missing jiraSprintId' });
                return;
            }

            const storedFacts = await PerfTicketFact.findAll({
                where: { syncId: sync.id },
                attributes: ['jiraKey', 'storyPoints', 'issueType', 'wasCompleted', 'wasPunted', 'isProductionBug', 'wasReopened', 'jiraCreatedAt'],
            });

            const jira = JiraService.forProject(project);

            const sprintMeta = (await (jira as any).client.get(`/rest/agile/1.0/sprint/${sync.jiraSprintId}`)).data;
            const ghReport = await jira.getSprintReport(project.jiraBoardId, sync.jiraSprintId);
            const jql = encodeURIComponent(`sprint = ${sync.jiraSprintId}`);
            const issuesUrl = `/rest/agile/1.0/board/${project.jiraBoardId}/issue?jql=${jql}&expand=changelog`;
            const agileIssues: any[] = await (jira as any).getAllIssuesFromUrl(issuesUrl);

            let spFieldId = 'story_points';
            try {
                const resolved = await jira.getFieldIdByName('Story Points');
                if (resolved) spFieldId = resolved;
            } catch { /* fallback */ }

            const sprintStartTs = sprintMeta.startDate ? new Date(sprintMeta.startDate) : new Date(0);
            const sprintEndTs: Date = sprintMeta.completeDate
                ? new Date(sprintMeta.completeDate)
                : (() => { const d = new Date(sprintMeta.endDate); d.setHours(23, 59, 59, 999); return d; })();

            const snapshots = await DailyBoardSnapshot.findAll({
                where: {
                    projectId: project.id,
                    date: { [Op.between]: [sync.startDate, sync.endDate] },
                    confirmedProdBugKeys: { [Op.ne]: null },
                },
                attributes: ['confirmedProdBugKeys'],
            });
            const snapshotProdBugKeys = new Set<string>();
            for (const s of snapshots) {
                for (const k of (s.confirmedProdBugKeys ?? [])) snapshotProdBugKeys.add(k);
            }

            const freshFacts = buildTicketFactsFromJiraData({
                issues: agileIssues,
                ghReport,
                laneConfig: getLaneConfig(project as any),
                spFieldId,
                prodBugKeys: snapshotProdBugKeys,
                sprintStartTs,
                sprintEndTs,
                jiraSprintId: sync.jiraSprintId,
                syncId: sync.id,
                projectId: project.id,
            });

            const productivity = reconcileProject({
                projectId: project.id,
                projectName: project.name,
                syncId: sync.id,
                sprintName: sync.sprintName ?? `Sprint ${sync.jiraSprintId}`,
                jiraSprintId: sync.jiraSprintId,
                jiraBoardId: project.jiraBoardId,
                ourFacts: storedFacts.map(f => ({
                    jiraKey: f.jiraKey,
                    storyPoints: f.storyPoints,
                    wasCompleted: f.wasCompleted,
                    wasPunted: f.wasPunted,
                })),
                greenhopperResponse: ghReport,
            });

            const quality = reconcileProjectQuality({
                projectId: project.id,
                projectName: project.name,
                syncId: sync.id,
                sprintName: sync.sprintName ?? `Sprint ${sync.jiraSprintId}`,
                jiraSprintId: sync.jiraSprintId,
                sprintStartDate: String(sync.startDate),
                sprintEndDate: String(sync.endDate),
                storedFacts: storedFacts.map(f => ({
                    jiraKey: f.jiraKey,
                    storyPoints: f.storyPoints,
                    issueType: f.issueType,
                    isProductionBug: f.isProductionBug,
                    wasReopened: f.wasReopened,
                    wasPunted: f.wasPunted,
                    jiraCreatedAt: f.jiraCreatedAt,
                })),
                freshFacts: freshFacts.map(f => ({
                    jiraKey: f.jiraKey!,
                    storyPoints: f.storyPoints ?? null,
                    issueType: f.issueType ?? null,
                    isProductionBug: f.isProductionBug ?? false,
                    wasReopened: f.wasReopened ?? false,
                    wasPunted: f.wasPunted ?? false,
                    jiraCreatedAt: f.jiraCreatedAt ?? null,
                })),
                snapshotProdBugKeys,
            });

            res.json({ success: true, data: { productivity, quality } });
        } catch (e: any) {
            res.status(500).json({ error: e.message });
        }
    }
}

export const reconciliationController = new ReconciliationController();
