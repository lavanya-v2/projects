/**
 * Productivity Reconciliation Job (Layer-3 evidence generator)
 *
 * For every sprint-based, non-shared project with at least one completed
 * PerfSprintSync, fetches the latest sync's stored ticket facts, queries Jira's
 * GreenHopper sprint report live, and reconciles the two sides. Writes a
 * presentable Markdown report plus a raw-payload JSON to backend/test-reports/.
 *
 * Usage (from backend/ directory):
 *   npm run report:productivity-reconciliation
 *
 * Exit codes:
 *   0 — every reconciled project matched
 *   1 — one or more projects mismatched (artifact still written; see it for details)
 *   2 — infra failure (DB / Jira / filesystem)
 *
 * This script is the Layer-3 evidence step for the productivity-trends accuracy
 * suite. Layers 1 and 2 (offline unit tests) run via `npm test` as usual.
 */

import 'reflect-metadata';
import * as fs from 'fs';
import * as path from 'path';

import '../config/connection';
import { Project } from '../models/Project';
import { PerfSprintSync } from '../models/PerfSprintSync';
import { PerfTicketFact } from '../models/PerfTicketFact';
import { JiraService } from '../modules/jira/services/jiraService';
import {
    reconcileProject,
    buildMarkdownReport,
    buildRawJson,
    ReconciliationReport,
} from '../modules/reports/services/__reporting__/reconciliationReport';

async function main(): Promise<number> {
    const projects = await Project.findAll({
        where: { isKanbanProject: false, isSharedTeam: false },
    });

    const reconciliations: ReconciliationReport['projects'] = [];
    const skipped: string[] = [];

    for (const project of projects) {
        const sync = await PerfSprintSync.findOne({
            where: { projectId: project.id, syncType: 'sprint', syncStatus: 'done' },
            order: [['start_date', 'DESC']],
        });
        if (!sync) {
            skipped.push(`${project.name}: no completed sprint sync`);
            continue;
        }
        if (!project.jiraBoardId || !sync.jiraSprintId) {
            skipped.push(`${project.name}: missing jiraBoardId or jiraSprintId`);
            continue;
        }

        const facts = await PerfTicketFact.findAll({
            where: { syncId: sync.id },
            attributes: ['jiraKey', 'storyPoints', 'wasCompleted', 'wasPunted'],
        });

        const jira = JiraService.forProject(project);

        let ghReport;
        try {
            ghReport = await jira.getSprintReport(project.jiraBoardId, sync.jiraSprintId);
        } catch (err: any) {
            skipped.push(`${project.name}: Jira error — ${err.message}`);
            continue;
        }

        reconciliations.push(
            reconcileProject({
                projectId: project.id,
                projectName: project.name,
                syncId: sync.id,
                sprintName: sync.sprintName ?? `Sprint ${sync.jiraSprintId}`,
                jiraSprintId: sync.jiraSprintId,
                jiraBoardId: project.jiraBoardId,
                ourFacts: facts.map(f => ({
                    jiraKey: f.jiraKey,
                    storyPoints: f.storyPoints,
                    wasCompleted: f.wasCompleted,
                    wasPunted: f.wasPunted,
                })),
                greenhopperResponse: ghReport,
            }),
        );
    }

    const report: ReconciliationReport = {
        generatedAt: new Date().toISOString(),
        projects: reconciliations,
    };

    const outDir = path.resolve(__dirname, '../../test-reports');
    fs.mkdirSync(outDir, { recursive: true });
    const ts = report.generatedAt.replace(/[:.]/g, '-');
    const mdPath = path.join(outDir, `productivity-reconciliation-${ts}.md`);
    const jsonPath = path.join(outDir, `productivity-reconciliation-${ts}-raw.json`);
    fs.writeFileSync(mdPath, buildMarkdownReport(report), 'utf8');
    fs.writeFileSync(jsonPath, buildRawJson(report), 'utf8');

    const total = reconciliations.length;
    const passed = reconciliations.filter(r => r.computed.match).length;
    const mismatches = reconciliations.filter(r => !r.computed.match);

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
    if (mismatches.length > 0) {
        console.error(`FAIL: ${mismatches.length}/${total} project(s) mismatched:`);
        for (const m of mismatches) {
            console.error(`  - ${m.projectName} / ${m.sprintName}: ours=${m.computed.ourProductivity}% jira=${m.computed.jiraProductivity}%`);
        }
        return 1;
    }
    console.log(`PASS: ${passed}/${total} project(s) reconciled.`);
    return 0;
}

main()
    .then(code => process.exit(code))
    .catch(err => {
        console.error('Reconciliation job crashed:', err);
        process.exit(2);
    });
