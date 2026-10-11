/**
 * Builds the Layer-3 Markdown report and raw JSON artifact from reconciliation
 * results. Pure — no file I/O, no Jira calls; the live test calls this to turn
 * an in-memory result array into two strings to write to disk.
 */

export interface ProjectReconciliation {
    projectId: number;
    projectName: string;
    syncId: number;
    sprintName: string;
    jiraSprintId: number;
    jiraBoardId: number | null;
    greenhopperResponse: {
        completedIssues: any[];
        notCompletedIssues: any[];
        puntedIssues: any[];
    };
    ourFacts: Array<{
        jiraKey: string;
        storyPoints: number;
        wasCompleted: boolean;
        wasPunted: boolean;
    }>;
    computed: {
        ourSpDone: number;
        jiraSpDone: number;
        ourSpPlanned: number;
        jiraSpPlanned: number;
        ourProductivity: number;
        jiraProductivity: number;
        match: boolean;
    };
    ticketDiff: Array<{
        jiraKey: string;
        ourSP: number | null;
        jiraSP: number | null;
        ourCompleted: boolean | null;
        jiraCompleted: boolean | null;
        status: 'ok' | 'mismatch' | 'missing-ours' | 'missing-jira';
    }>;
}

export interface ReconciliationReport {
    generatedAt: string;
    projects: ProjectReconciliation[];
}

export function buildMarkdownReport(report: ReconciliationReport): string {
    const total = report.projects.length;
    const passed = report.projects.filter(p => p.computed.match).length;
    const verdict = passed === total ? 'PASS' : 'FAIL';

    const lines: string[] = [];
    lines.push(`# Productivity Reconciliation — ${report.generatedAt}`);
    lines.push('');
    lines.push(`**Verdict:** ${verdict} (${passed}/${total} projects reconciled)`);
    lines.push('**Source of truth:** Jira GreenHopper sprint report (fetched live during test run)');
    lines.push('**Formula:** Productivity % = round1(spDone / spPlanned × 100), non-bug subtasks excluded, punted tickets excluded');
    lines.push('');

    lines.push('## Summary');
    lines.push('');
    lines.push('| Project | Sprint | Our SP Done | Jira SP Done | Our SP Planned | Jira SP Planned | Our % | Jira % | Match |');
    lines.push('| ------- | ------ | ----------- | ------------ | -------------- | --------------- | ----- | ------ | ----- |');
    for (const p of report.projects) {
        const c = p.computed;
        lines.push(
            `| ${p.projectName} | ${p.sprintName} | ${c.ourSpDone} | ${c.jiraSpDone} | ${c.ourSpPlanned} | ${c.jiraSpPlanned} | ${c.ourProductivity} | ${c.jiraProductivity} | ${c.match ? '✓' : '✗'} |`,
        );
    }
    lines.push('');

    lines.push('## Per-project ticket diff');
    lines.push('');
    for (const p of report.projects) {
        lines.push(`### ${p.projectName} — ${p.sprintName}`);
        lines.push('');
        lines.push('| jiraKey | ourSP | jiraSP | ourCompleted | jiraCompleted | status |');
        lines.push('| ------- | ----- | ------ | ------------ | ------------- | ------ |');
        for (const d of p.ticketDiff) {
            const marker = d.status === 'ok' ? 'ok' : `✗ ${d.status}`;
            lines.push(
                `| ${d.jiraKey} | ${fmtNum(d.ourSP)} | ${fmtNum(d.jiraSP)} | ${fmtBool(d.ourCompleted)} | ${fmtBool(d.jiraCompleted)} | ${marker} |`,
            );
        }
        lines.push('');
    }

    return lines.join('\n');
}

export function buildRawJson(report: ReconciliationReport): string {
    return JSON.stringify(report, null, 2);
}

function fmtNum(n: number | null): string {
    return n == null ? '—' : String(n);
}

function fmtBool(b: boolean | null): string {
    return b == null ? '—' : b ? 'true' : 'false';
}

/**
 * Reconcile our stored facts against Jira's GreenHopper response.
 * Applies the same selection rules our sync applies (non-bug subtasks excluded
 * via typeName sniffing) and returns a project-level reconciliation record.
 */
export function reconcileProject(args: {
    projectId: number;
    projectName: string;
    syncId: number;
    sprintName: string;
    jiraSprintId: number;
    jiraBoardId: number | null;
    ourFacts: Array<{ jiraKey: string; storyPoints: number | null; wasCompleted: boolean; wasPunted: boolean }>;
    greenhopperResponse: {
        completedIssues: Array<{ key: string; storyPoints: number; typeName: string }>;
        notCompletedIssues: Array<{ key: string; storyPoints: number; typeName: string }>;
        puntedIssues: Array<{ key: string; storyPoints: number; typeName: string }>;
    };
}): ProjectReconciliation {
    const round1 = (n: number) => Math.round(n * 10) / 10;
    const isNonBugSubtask = (typeName: string) => {
        const t = (typeName ?? '').toLowerCase();
        return (t === 'sub-task' || t === 'subtask') && !t.includes('bug');
    };

    // Our side: non-punted facts only (matches getProductivityOverview's server-side filter).
    const nonPunted = args.ourFacts.filter(f => !f.wasPunted);
    const ourSpDone = nonPunted.filter(f => f.wasCompleted).reduce((s, f) => s + (f.storyPoints ?? 0), 0);
    const ourSpPlanned = nonPunted.reduce((s, f) => s + (f.storyPoints ?? 0), 0);
    const ourProductivity = ourSpPlanned > 0 ? round1((ourSpDone / ourSpPlanned) * 100) : 0;

    // Jira side: completedIssues + notCompletedIssues, non-bug subtasks excluded.
    const gh = args.greenhopperResponse;
    const jiraCompleted = gh.completedIssues.filter(i => !isNonBugSubtask(i.typeName));
    const jiraNotCompleted = gh.notCompletedIssues.filter(i => !isNonBugSubtask(i.typeName));
    const jiraSpDone = jiraCompleted.reduce((s, i) => s + (i.storyPoints ?? 0), 0);
    const jiraSpPlanned = jiraSpDone + jiraNotCompleted.reduce((s, i) => s + (i.storyPoints ?? 0), 0);
    const jiraProductivity = jiraSpPlanned > 0 ? round1((jiraSpDone / jiraSpPlanned) * 100) : 0;

    // Ticket-level diff
    const jiraByKey = new Map<string, { sp: number; completed: boolean }>();
    for (const i of jiraCompleted) jiraByKey.set(i.key, { sp: i.storyPoints ?? 0, completed: true });
    for (const i of jiraNotCompleted) jiraByKey.set(i.key, { sp: i.storyPoints ?? 0, completed: false });

    const ourByKey = new Map<string, { sp: number; completed: boolean }>();
    for (const f of nonPunted) ourByKey.set(f.jiraKey, { sp: f.storyPoints ?? 0, completed: f.wasCompleted });

    const allKeys = new Set<string>([...ourByKey.keys(), ...jiraByKey.keys()]);
    const ticketDiff: ProjectReconciliation['ticketDiff'] = [];
    for (const key of Array.from(allKeys).sort()) {
        const ours = ourByKey.get(key);
        const jira = jiraByKey.get(key);
        let status: ProjectReconciliation['ticketDiff'][number]['status'];
        if (!ours) status = 'missing-ours';
        else if (!jira) status = 'missing-jira';
        else if (ours.sp !== jira.sp || ours.completed !== jira.completed) status = 'mismatch';
        else status = 'ok';
        ticketDiff.push({
            jiraKey: key,
            ourSP: ours?.sp ?? null,
            jiraSP: jira?.sp ?? null,
            ourCompleted: ours?.completed ?? null,
            jiraCompleted: jira?.completed ?? null,
            status,
        });
    }

    const match =
        ourSpDone === jiraSpDone &&
        ourSpPlanned === jiraSpPlanned &&
        ourProductivity === jiraProductivity &&
        ticketDiff.every(d => d.status === 'ok');

    return {
        projectId: args.projectId,
        projectName: args.projectName,
        syncId: args.syncId,
        sprintName: args.sprintName,
        jiraSprintId: args.jiraSprintId,
        jiraBoardId: args.jiraBoardId,
        greenhopperResponse: args.greenhopperResponse,
        ourFacts: args.ourFacts.map(f => ({
            jiraKey: f.jiraKey,
            storyPoints: f.storyPoints ?? 0,
            wasCompleted: f.wasCompleted,
            wasPunted: f.wasPunted,
        })),
        computed: {
            ourSpDone, jiraSpDone,
            ourSpPlanned, jiraSpPlanned,
            ourProductivity, jiraProductivity,
            match,
        },
        ticketDiff,
    };
}
