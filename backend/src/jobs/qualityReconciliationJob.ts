/**
 * Quality Trends Reconciliation Job (Layer-3 evidence generator)
 *
 * For every sprint-based, non-shared project with a completed PerfSprintSync,
 * reconciles three quality metrics — Defect Density, Defect Leakage, Reopen
 * Ratio — against live Jira + DailyBoardSnapshot state.
 *
 * Strategy: rebuild the sprint's ticket facts from live Jira data using
 * buildTicketFactsFromJiraData, then compare stored vs fresh per metric.
 * This simultaneously validates the formula AND the data-selection pipeline.
 *
 * Usage (from backend/ directory):
 *   npm run report:quality-reconciliation
 *
 * Exit codes:
 *   0 — every reconciled project matched on all three metrics
 *   1 — at least one project drifted (artifact still written)
 *   2 — infra failure (DB / Jira / filesystem)
 */

import 'reflect-metadata';
import * as fs from 'fs';
import * as path from 'path';
import { Op } from 'sequelize';

import '../config/connection';
import { Project } from '../models/Project';
import { PerfSprintSync } from '../models/PerfSprintSync';
import { PerfTicketFact } from '../models/PerfTicketFact';
import { DailyBoardSnapshot } from '../models/DailyBoardSnapshot';
import { JiraService } from '../modules/jira/services/jiraService';
import { buildTicketFactsFromJiraData, deriveJiraProjectKey, projectUsesReopenedStatus } from '../modules/reports/services/performanceSyncService';
import { getLaneConfig } from '../common/laneDefaults';
import {
    reconcileProjectQuality,
    buildQualityMarkdownReport,
    buildQualityRawJson,
    QualityReconciliationReport,
} from '../modules/reports/services/__reporting__/qualityReconciliationReport';

async function loadProdBugKeys(projectId: number, startDate: string, endDate: string): Promise<Set<string>> {
    const snapshots = await DailyBoardSnapshot.findAll({
        where: {
            projectId,
            date: { [Op.between]: [startDate, endDate] },
            confirmedProdBugKeys: { [Op.ne]: null },
        },
        attributes: ['confirmedProdBugKeys'],
    });
    const keys = new Set<string>();
    for (const s of snapshots) {
        for (const k of (s.confirmedProdBugKeys ?? [])) keys.add(k);
    }
    return keys;
}

async function main(): Promise<number> {
    const projects = await Project.findAll({
        where: { isKanbanProject: false, isSharedTeam: false },
    });

    const reconciliations: QualityReconciliationReport['projects'] = [];
    const skipped: string[] = [];

    for (const project of projects) {
        const sync = await PerfSprintSync.findOne({
            where: { projectId: project.id, syncType: 'sprint', syncStatus: 'done' },
            order: [['start_date', 'DESC']],
        });
        if (!sync) { skipped.push(`${project.name}: no completed sprint sync`); continue; }
        if (!project.jiraBoardId || !sync.jiraSprintId) {
            skipped.push(`${project.name}: missing jiraBoardId or jiraSprintId`);
            continue;
        }

        const storedFacts = await PerfTicketFact.findAll({
            where: { syncId: sync.id },
            attributes: ['jiraKey', 'storyPoints', 'issueType', 'isProductionBug', 'wasReopened', 'wasPunted', 'jiraCreatedAt'],
        });

        const jira = JiraService.forProject(project);
        let ghReport;
        let agileIssues: any[];
        let spFieldId = 'story_points';
        let sprintMeta: any;

        try {
            sprintMeta = (await (jira as any).client.get(`/rest/agile/1.0/sprint/${sync.jiraSprintId}`)).data;
            ghReport = await jira.getSprintReport(project.jiraBoardId, sync.jiraSprintId);
            const jql = encodeURIComponent(`sprint = ${sync.jiraSprintId}`);
            const issuesUrl = `/rest/agile/1.0/board/${project.jiraBoardId}/issue?jql=${jql}&expand=changelog`;
            agileIssues = await (jira as any).getAllIssuesFromUrl(issuesUrl);
            try {
                const resolved = await jira.getFieldIdByName('Story Points');
                if (resolved) spFieldId = resolved;
            } catch { /* fallback */ }
        } catch (err: any) {
            skipped.push(`${project.name}: Jira error — ${err.message}`);
            continue;
        }

        const sprintStartTs = sprintMeta.startDate ? new Date(sprintMeta.startDate) : new Date(0);
        const sprintEndTs: Date = sprintMeta.completeDate
            ? new Date(sprintMeta.completeDate)
            : (() => { const d = new Date(sprintMeta.endDate); d.setHours(23, 59, 59, 999); return d; })();

        const startDate: string = sync.startDate;
        const endDate: string = sync.endDate;
        const snapshotProdBugKeys = await loadProdBugKeys(project.id, startDate, endDate);

        const laneConfig = getLaneConfig(project as any);
        const reopenStatusOnly = await projectUsesReopenedStatus(
            jira, deriveJiraProjectKey(agileIssues, project as any), laneConfig,
        );

        const freshFacts = buildTicketFactsFromJiraData({
            issues: agileIssues,
            ghReport,
            laneConfig,
            spFieldId,
            prodBugKeys: snapshotProdBugKeys,
            sprintStartTs,
            sprintEndTs,
            jiraSprintId: sync.jiraSprintId,
            syncId: sync.id,
            projectId: project.id,
            reopenStatusOnly,
        });

        reconciliations.push(
            reconcileProjectQuality({
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
            }),
        );
    }

    const report: QualityReconciliationReport = {
        generatedAt: new Date().toISOString(),
        projects: reconciliations,
    };

    const outDir = path.resolve(__dirname, '../../test-reports');
    fs.mkdirSync(outDir, { recursive: true });
    const ts = report.generatedAt.replace(/[:.]/g, '-');
    const mdPath = path.join(outDir, `quality-reconciliation-${ts}.md`);
    const jsonPath = path.join(outDir, `quality-reconciliation-${ts}-raw.json`);
    fs.writeFileSync(mdPath, buildQualityMarkdownReport(report), 'utf8');
    fs.writeFileSync(jsonPath, buildQualityRawJson(report), 'utf8');

    const total = reconciliations.length;
    const passed = reconciliations.filter(r => r.overallMatch).length;
    const drifted = reconciliations.filter(r => !r.overallMatch);

    console.log(`\nReconciled ${total} project(s)${skipped.length ? `, skipped ${skipped.length}` : ''}.`);
    if (skipped.length) {
        console.log('Skipped:');
        for (const s of skipped) console.log(`  - ${s}`);
    }
    console.log('');
    console.log(`Report:      ${mdPath}`);
    console.log(`Raw payload: ${jsonPath}`);
    console.log('');

    if (total === 0) {
        console.error('No projects had a completed sprint sync to reconcile.');
        return 2;
    }
    if (drifted.length > 0) {
        console.error(`FAIL: ${drifted.length}/${total} project(s) drifted:`);
        for (const d of drifted) {
            const parts: string[] = [];
            if (!d.defectDensity.match) parts.push('density');
            if (!d.defectLeakage.match) parts.push('leakage');
            if (!d.reopenRatio.match) parts.push('reopen');
            console.error(`  - ${d.projectName} / ${d.sprintName}: ${parts.join(', ')}`);
        }
        return 1;
    }
    console.log(`PASS: ${passed}/${total} project(s) reconciled on all three metrics.`);
    return 0;
}

main()
    .then(code => process.exit(code))
    .catch(err => {
        console.error('Reconciliation job crashed:', err);
        process.exit(2);
    });
