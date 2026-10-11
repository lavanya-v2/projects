/**
 * Builds the quality-metrics reconciliation artifact.
 *
 * Strategy: we compare OUR STORED facts for the latest sync (the data the UI
 * renders) against FRESH facts built by running `buildTicketFactsFromJiraData`
 * on live Jira data. Any drift means one of: stale sync, Jira data changed
 * since the last sync, or a bug in the sync/data-selection pipeline.
 *
 * Defect-leakage has no Jira ground-truth (isProductionBug is internal). For
 * that metric we additionally reconcile our stored facts against the current
 * `confirmedProdBugKeys` in DailyBoardSnapshot — catches drift between the
 * snapshots and the facts table.
 */

import {
    computeDefectDensity,
    computeDefectLeakage,
    computeReopenRatio,
    QualityFact,
} from '../qualityMath';

export interface QualityProjectReconciliation {
    projectId: number;
    projectName: string;
    syncId: number;
    sprintName: string;
    jiraSprintId: number;

    defectDensity: {
        ours: { bugCount: number; totalSp: number; density: number };
        jira: { bugCount: number; totalSp: number; density: number };
        match: boolean;
    };

    defectLeakage: {
        oursProdBugCount: number;
        freshProdBugCount: number;
        snapshotProdBugKeyCount: number;
        snapshotProdBugKeys: string[];
        ourProdBugKeys: string[];
        missingFromFacts: string[];
        missingFromSnapshot: string[];
        match: boolean;
    };

    reopenRatio: {
        ours: { reopenedStoryCount: number; totalStoryCount: number; reopenRatio: number };
        jira: { reopenedStoryCount: number; totalStoryCount: number; reopenRatio: number };
        reopenDiffKeys: Array<{ jiraKey: string; ours: boolean; jira: boolean }>;
        match: boolean;
    };

    overallMatch: boolean;
}

export interface QualityReconciliationReport {
    generatedAt: string;
    projects: QualityProjectReconciliation[];
}

export function reconcileProjectQuality(args: {
    projectId: number;
    projectName: string;
    syncId: number;
    sprintName: string;
    jiraSprintId: number;
    /** Sprint window (YYYY-MM-DD). Required so defect density matches the
     *  production metric, which only counts bugs created inside the window. */
    sprintStartDate: string;
    sprintEndDate: string;
    /** Facts stored in PerfTicketFact for this sync (the data currently driving the UI). */
    storedFacts: Array<{
        jiraKey: string;
        storyPoints: number | null;
        issueType: string | null;
        isProductionBug: boolean;
        wasReopened: boolean;
        wasPunted: boolean;
        jiraCreatedAt: Date | string | null;
    }>;
    /**
     * Facts produced by running buildTicketFactsFromJiraData on live Jira data
     * right now — i.e. what a fresh sync would store if run today.
     */
    freshFacts: Array<{
        jiraKey: string;
        storyPoints: number | null;
        issueType: string | null;
        isProductionBug: boolean;
        wasReopened: boolean;
        wasPunted: boolean;
        jiraCreatedAt: Date | string | null;
    }>;
    /**
     * Current confirmed production bug keys from DailyBoardSnapshot for the
     * sprint's date range. Used as the "truth" side for defect-leakage.
     */
    snapshotProdBugKeys: Set<string>;
}): QualityProjectReconciliation {
    const ours: QualityFact[] = args.storedFacts.map(f => ({
        storyPoints: f.storyPoints,
        issueType: f.issueType,
        isProductionBug: f.isProductionBug,
        wasReopened: f.wasReopened,
        wasPunted: f.wasPunted,
        jiraCreatedAt: f.jiraCreatedAt,
    }));
    const fresh: QualityFact[] = args.freshFacts.map(f => ({
        storyPoints: f.storyPoints,
        issueType: f.issueType,
        isProductionBug: f.isProductionBug,
        wasReopened: f.wasReopened,
        wasPunted: f.wasPunted,
        jiraCreatedAt: f.jiraCreatedAt,
    }));

    const sprintWindow = { startDate: args.sprintStartDate, endDate: args.sprintEndDate };
    // ─── Defect Density ──────────────────────────────────────────────────────
    const oursDensity = computeDefectDensity(ours, sprintWindow);
    const jiraDensity = computeDefectDensity(fresh, sprintWindow);
    const densityMatch =
        oursDensity.bugCount === jiraDensity.bugCount &&
        oursDensity.totalSp === jiraDensity.totalSp &&
        oursDensity.density === jiraDensity.density;

    // ─── Defect Leakage ──────────────────────────────────────────────────────
    const ourLeakage = computeDefectLeakage(ours);
    const freshLeakage = computeDefectLeakage(fresh);
    const ourProdBugKeys = args.storedFacts
        .filter(f => f.isProductionBug && !f.wasPunted)
        .map(f => f.jiraKey)
        .sort();
    const snapshotKeys = Array.from(args.snapshotProdBugKeys).sort();
    const ourSet = new Set(ourProdBugKeys);
    const snapSet = new Set(snapshotKeys);
    const missingFromFacts = snapshotKeys.filter(k => !ourSet.has(k));
    const missingFromSnapshot = ourProdBugKeys.filter(k => !snapSet.has(k));
    const leakageMatch =
        ourLeakage.prodBugCount === freshLeakage.prodBugCount &&
        missingFromFacts.length === 0 &&
        missingFromSnapshot.length === 0;

    // ─── Reopen Ratio ────────────────────────────────────────────────────────
    const oursReopen = computeReopenRatio(ours);
    const jiraReopen = computeReopenRatio(fresh);

    // Per-ticket reopen diff (only for non-bug, non-punted facts)
    const isNonBug = (t: string | null) => !(t ?? '').toLowerCase().includes('bug');
    const storedMap = new Map<string, boolean>();
    for (const f of args.storedFacts) {
        if (!f.wasPunted && isNonBug(f.issueType)) storedMap.set(f.jiraKey, f.wasReopened);
    }
    const freshMap = new Map<string, boolean>();
    for (const f of args.freshFacts) {
        if (!f.wasPunted && isNonBug(f.issueType)) freshMap.set(f.jiraKey, f.wasReopened);
    }
    const allReopenKeys = new Set<string>([...storedMap.keys(), ...freshMap.keys()]);
    const reopenDiffKeys: Array<{ jiraKey: string; ours: boolean; jira: boolean }> = [];
    for (const k of Array.from(allReopenKeys).sort()) {
        const o = storedMap.get(k) ?? false;
        const j = freshMap.get(k) ?? false;
        if (o !== j) reopenDiffKeys.push({ jiraKey: k, ours: o, jira: j });
    }
    const reopenMatch =
        oursReopen.reopenedStoryCount === jiraReopen.reopenedStoryCount &&
        oursReopen.totalStoryCount === jiraReopen.totalStoryCount &&
        oursReopen.reopenRatio === jiraReopen.reopenRatio &&
        reopenDiffKeys.length === 0;

    return {
        projectId: args.projectId,
        projectName: args.projectName,
        syncId: args.syncId,
        sprintName: args.sprintName,
        jiraSprintId: args.jiraSprintId,
        defectDensity: {
            ours: oursDensity,
            jira: jiraDensity,
            match: densityMatch,
        },
        defectLeakage: {
            oursProdBugCount: ourLeakage.prodBugCount,
            freshProdBugCount: freshLeakage.prodBugCount,
            snapshotProdBugKeyCount: snapshotKeys.length,
            snapshotProdBugKeys: snapshotKeys,
            ourProdBugKeys,
            missingFromFacts,
            missingFromSnapshot,
            match: leakageMatch,
        },
        reopenRatio: {
            ours: oursReopen,
            jira: jiraReopen,
            reopenDiffKeys,
            match: reopenMatch,
        },
        overallMatch: densityMatch && leakageMatch && reopenMatch,
    };
}

export function buildQualityMarkdownReport(report: QualityReconciliationReport): string {
    const total = report.projects.length;
    const passed = report.projects.filter(p => p.overallMatch).length;
    const verdict = passed === total ? 'PASS' : 'FAIL';

    const lines: string[] = [];
    lines.push(`# Quality Trends Reconciliation — ${report.generatedAt}`);
    lines.push('');
    lines.push(`**Verdict:** ${verdict} (${passed}/${total} projects reconciled)`);
    lines.push('');
    lines.push('**Metrics:**');
    lines.push('- **Defect Density** = round2(bugCount / totalSp) — bugs are facts with issueType containing "bug"');
    lines.push('- **Defect Leakage** = count(facts where isProductionBug) — cross-checked vs DailyBoardSnapshot confirmedProdBugKeys');
    lines.push('- **Reopen Ratio** = round1(reopenedStoryCount / totalStoryCount × 100) — non-bug, non-punted facts with wasReopened');
    lines.push('');
    lines.push('**Comparison:** Stored facts (what the UI shows today) vs Freshly-rebuilt facts from live Jira data (what a re-sync would produce right now).');
    lines.push('');

    // ─── Summary tables ──────────────────────────────────────────────────────
    lines.push('## Summary — Defect Density');
    lines.push('');
    lines.push('| Project | Sprint | Our Bugs | Jira Bugs | Our SP | Jira SP | Our Density | Jira Density | Match |');
    lines.push('| ------- | ------ | -------- | --------- | ------ | ------- | ----------- | ------------ | ----- |');
    for (const p of report.projects) {
        const d = p.defectDensity;
        lines.push(
            `| ${p.projectName} | ${p.sprintName} | ${d.ours.bugCount} | ${d.jira.bugCount} | ${d.ours.totalSp} | ${d.jira.totalSp} | ${d.ours.density} | ${d.jira.density} | ${d.match ? '✓' : '✗'} |`,
        );
    }
    lines.push('');

    lines.push('## Summary — Defect Leakage');
    lines.push('');
    lines.push('| Project | Sprint | Our Prod Bugs (facts) | Fresh Prod Bugs (rebuilt) | DailyBoardSnapshot Keys | Missing from Facts | Missing from Snapshot | Match |');
    lines.push('| ------- | ------ | --------------------- | ------------------------- | ----------------------- | ------------------ | --------------------- | ----- |');
    for (const p of report.projects) {
        const l = p.defectLeakage;
        lines.push(
            `| ${p.projectName} | ${p.sprintName} | ${l.oursProdBugCount} | ${l.freshProdBugCount} | ${l.snapshotProdBugKeyCount} | ${l.missingFromFacts.length} | ${l.missingFromSnapshot.length} | ${l.match ? '✓' : '✗'} |`,
        );
    }
    lines.push('');

    lines.push('## Summary — Reopen Ratio');
    lines.push('');
    lines.push('| Project | Sprint | Our Reopened | Jira Reopened | Our Stories | Jira Stories | Our % | Jira % | Per-ticket Diffs | Match |');
    lines.push('| ------- | ------ | ------------ | ------------- | ----------- | ------------ | ----- | ------ | ---------------- | ----- |');
    for (const p of report.projects) {
        const r = p.reopenRatio;
        lines.push(
            `| ${p.projectName} | ${p.sprintName} | ${r.ours.reopenedStoryCount} | ${r.jira.reopenedStoryCount} | ${r.ours.totalStoryCount} | ${r.jira.totalStoryCount} | ${r.ours.reopenRatio} | ${r.jira.reopenRatio} | ${r.reopenDiffKeys.length} | ${r.match ? '✓' : '✗'} |`,
        );
    }
    lines.push('');

    // ─── Per-project drift detail ────────────────────────────────────────────
    lines.push('## Per-project drift detail');
    lines.push('');
    for (const p of report.projects) {
        if (p.overallMatch) continue;
        lines.push(`### ${p.projectName} — ${p.sprintName}`);
        lines.push('');
        const l = p.defectLeakage;
        if (!l.match) {
            lines.push('**Defect Leakage drift:**');
            if (l.missingFromFacts.length > 0) {
                lines.push(`- Keys in DailyBoardSnapshot but NOT marked isProductionBug in facts (${l.missingFromFacts.length}): ${l.missingFromFacts.join(', ')}`);
            }
            if (l.missingFromSnapshot.length > 0) {
                lines.push(`- Keys marked isProductionBug in facts but NOT in DailyBoardSnapshot (${l.missingFromSnapshot.length}): ${l.missingFromSnapshot.join(', ')}`);
            }
            if (l.oursProdBugCount !== l.freshProdBugCount) {
                lines.push(`- Stored prodBugCount (${l.oursProdBugCount}) ≠ fresh-rebuild prodBugCount (${l.freshProdBugCount})`);
            }
            lines.push('');
        }
        if (!p.reopenRatio.match && p.reopenRatio.reopenDiffKeys.length > 0) {
            lines.push('**Reopen Ratio per-ticket drift:**');
            lines.push('');
            lines.push('| jiraKey | ours | jira (freshly computed) |');
            lines.push('| ------- | ---- | ----------------------- |');
            for (const d of p.reopenRatio.reopenDiffKeys) {
                lines.push(`| ${d.jiraKey} | ${d.ours} | ${d.jira} |`);
            }
            lines.push('');
        }
    }

    return lines.join('\n');
}

export function buildQualityRawJson(report: QualityReconciliationReport): string {
    return JSON.stringify(report, null, 2);
}
