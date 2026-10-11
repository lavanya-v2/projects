// Demo payload used by the "Load Demo Presentation" button to seed a realistic
// portfolio-level deck. Because perProjectDrilldown and trendData are fully
// populated here, every chart renders without needing real Sprint rows seeded.

const DEMO_PROJECT_NAMES = ['LOT', 'LOWA', 'EXP'];

interface DemoPayloadArgs {
  /** The account id the presentation will belong to (required, from live account). */
  accountId: number;
  /** First 3 real projects from the active account, preserves FK integrity and
   *  gives predictable behavior in the presentation & PDF. */
  projectIds: number[];
}

/**
 * Builds a demo payload scoped to real accountId + projectIds so FK integrity
 * holds. If fewer than 3 projects exist, the demo trims itself to match.
 */
export function buildDemoPortfolioPayload({ accountId, projectIds }: DemoPayloadArgs): any {
  void accountId;
  const n = Math.min(projectIds.length, DEMO_PROJECT_NAMES.length);
  const pairs = projectIds.slice(0, n).map((id, idx) => ({ id, name: DEMO_PROJECT_NAMES[idx] }));

  const trendBase = (seedVelocity: number, seedDefect: number) => {
    return Array.from({ length: 5 }, (_, i) => {
      const planned = seedVelocity + (i % 2 === 0 ? 2 : -1) * (i + 1);
      const actual = Math.max(planned - (2 - (i % 3)), 10);
      const bugs = Math.max(seedDefect + ((i % 2 === 0) ? 2 : -1), 3);
      const storyPoints = actual + (i % 2) * 2;
      const bugDensityPct = storyPoints > 0 ? Math.round((bugs / storyPoints) * 1000) / 10 : 0;
      return {
        name: `Sprint ${40 + i}`,
        metrics: {
          capacity: planned + 10,
          planned,
          actual,
          reworkPct: 6 + (i % 3),
          carryoverPct: 8 + (i % 2),
        },
        qualityMetrics: {
          storyPoints,
          validBugs: bugs,
          bugDensityPct,
          bugsProd: Math.max(Math.floor(bugs / 6), 1),
          leakageRatePct: Math.round((Math.max(Math.floor(bugs / 6), 1) / bugs) * 1000) / 10,
        },
      };
    });
  };

  const perProjectDrilldown = pairs.map((p, idx) => {
    const velocity = 44 - idx * 6;
    const bugs = 10 + idx * 3;
    const storyPoints = velocity + 3;
    return {
      projectId: p.id,
      projectName: p.name,
      narrative: `${p.name} executed steadily through the period with a mix of planned delivery and selective scope adjustments. Carryover was contained and quality remained within target bounds.`,
      sprintName: `Sprint 44 (${p.name})`,
      sprintMetrics: {
        capacity: velocity + 12,
        planned: velocity + 4,
        actual: velocity,
        scopeChange: 2,
        reworkPct: 7,
        carryoverPct: 9,
      },
      qualityMetrics: {
        storyPoints,
        validBugs: bugs,
        bugDensityPct: Math.round((bugs / storyPoints) * 1000) / 10,
        bugsProd: 2,
        leakageRatePct: Math.round((2 / Math.max(bugs, 1)) * 1000) / 10,
        uiBugs: 3,
        apiBugs: 4,
        cssBugs: 1,
        dbBugs: 1,
        otherBugs: Math.max(bugs - 9, 0),
      },
      teamMembers: [
        { name: 'Rahul Kumar', role: 'Tech Lead', storyPoints: 12, execution: 92, quality: 90, overallRating: 91 },
        { name: 'Priya Nair', role: 'Senior Dev', storyPoints: 14, execution: 88, quality: 85, overallRating: 87 },
        { name: 'Anita Shah', role: 'QA', storyPoints: 0, execution: 90, quality: 92, overallRating: 91 },
      ],
      isVisible: true,
    };
  });

  const trendData: Record<string, any> = {};
  pairs.forEach((p, idx) => {
    trendData[String(p.id)] = {
      projectName: p.name,
      sprints: trendBase(42 - idx * 5, 9 + idx * 2),
    };
  });

  const selectedSprintMap: Record<string, number | null> = {};
  pairs.forEach(p => { selectedSprintMap[String(p.id)] = null; });

  const risks = [
    { projectName: pairs[0]?.name ?? 'LOT', title: 'Third-party payment gateway intermittent failures', description: 'Vendor API degraded; retries in place but SLA not yet met.', priority: 'HIGH', status: 'NEW', source: 'CLIENT' },
    { projectName: pairs[1]?.name ?? 'LOWA', title: 'Database performance on analytics queries', description: 'Slow queries on large joins; indexing WIP.', priority: 'MEDIUM', status: 'WORK_IN_PROGRESS', source: 'INTERNAL' },
    { projectName: pairs[2]?.name ?? 'EXP', title: 'Team capacity in April', description: 'Two members on planned leave overlap.', priority: 'MEDIUM', status: 'NEW', source: 'INTERNAL' },
  ].filter(r => !!r.projectName);

  const actionItemsSnapshot = [
    { projectName: pairs[0]?.name ?? 'LOT', title: 'Finalize payment gateway retry policy', owner: 'Rahul Kumar', status: 'In-Progress', dueDate: '2026-04-22', category: 'Technical', source: 'project' },
    { projectName: pairs[1]?.name ?? 'LOWA', title: 'Add covering indexes for reporting queries', owner: 'Priya Nair', status: 'Open', dueDate: '2026-04-25', category: 'Performance', source: 'project' },
    { projectName: pairs[2]?.name ?? 'EXP', title: 'Schedule UAT walkthrough for v3 release', owner: 'Anita Shah', status: 'Open', dueDate: '2026-04-28', category: 'Process', source: 'project' },
    { projectName: 'Account-wide', title: 'Align Q2 roadmap across projects', owner: 'Delivery Manager', status: 'Open', dueDate: '2026-04-30', category: 'Planning', source: 'account' },
  ].filter(i => !!i.projectName);

  return {
    title: 'Q1 2026 - Executive Delivery Review (Demo)',
    meetingDate: '2026-04-20',
    startDate: '2026-04-01',
    endDate: '2026-04-15',
    health: 'Amber',
    selectedProjectIds: pairs.map(p => p.id),
    selectedSprintMap,
    keyHighlights: {
      summary: `Delivery across the account covered ${perProjectDrilldown.reduce((s, d) => s + (d.sprintMetrics.actual || 0), 0)} story points across ${pairs.length} project(s) with stable quality. Payment gateway reliability remains the principal open risk. Team capacity is constrained in late April due to overlapping planned leaves.`,
      achievements: [
        'API performance improvements went live with measurable latency reduction.',
        'Reporting v2 passed UAT with zero critical defects.',
        'Two legacy endpoints migrated to new auth framework across two projects.',
      ],
      blockers: [
        `[${pairs[0]?.name ?? 'LOT'}] Payment gateway vendor SLA breach`,
        `[${pairs[1]?.name ?? 'LOWA'}] Reporting query latency under high concurrency`,
      ],
      capacityNotes: ['Team capacity reduced ~15% in late April due to planned leaves.'],
    },
    milestones: [
      { milestone: 'Payment Gateway Integration', status: 'At Risk', percentComplete: 60, eta: 'May 2026', projectName: pairs[0]?.name ?? 'LOT' },
      { milestone: 'Reporting v2 Go-Live', status: 'Completed', percentComplete: 100, eta: 'Apr 2026', projectName: pairs[1]?.name ?? 'LOWA' },
      { milestone: 'Legacy Auth Migration', status: 'In Progress', percentComplete: 75, eta: 'May 2026', projectName: pairs[2]?.name ?? 'EXP' },
    ],
    risks,
    actionItemsSnapshot,
    techRecommendations: [
      'Introduce a read-replica for analytics reporting to offload primary DB.',
      'Adopt contract testing between the top two projects to catch regression early.',
      'Standardize error telemetry across projects via OpenTelemetry for faster triage.',
    ],
    discussionPoints: [
      'Q2 2026 roadmap priorities and resourcing plan.',
      'Vendor escalation pathway for payment gateway SLA misses.',
      'Upgrade cadence for runtime and framework versions across projects.',
    ],
    perProjectDrilldown,
    trendData,
  };
}
