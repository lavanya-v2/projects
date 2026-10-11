/**
 * Pure data-shaping functions that turn an array of fetched scorecards into
 * the developer-card payloads consumed by the Trends views. Extracted from
 * the original inline `useEffect` blocks so the logic is unit-testable in
 * isolation and the React layer only owns fetching/loading state.
 */

interface RawScorecard {
  sync: any;
  scores: any[];
}

/**
 * Build sprint-trend developer cards from a chronologically-sorted list of
 * "done" scorecards. The newest scorecard becomes each member's
 * `currentSprint`; earlier ones populate `completedSprints`.
 */
export function buildSprintTrends(scorecards: RawScorecard[]): any[] {
  const memberMap = new Map<string, any>();

  for (const { sync, scores } of scorecards) {
    for (const score of scores) {
      if (score.memberCategory === 'qa') continue;
      if (!memberMap.has(score.jiraLoginId)) {
        memberMap.set(score.jiraLoginId, {
          jiraLoginId: score.jiraLoginId,
          displayName: score.displayName,
          completedSprints: [],
          currentSprint: null,
        });
      }
      memberMap.get(score.jiraLoginId)!.completedSprints.push({
        sprintId: sync.id,
        sprintName: sync.sprintName || sync.periodLabel,
        startDate: sync.startDate,
        endDate: sync.endDate,
        spPlanned: score.spPlanned ?? 0,
        spDone: score.spDone ?? 0,
        deliveryPct: Math.round(Number(score.deliveryPct ?? 0)),
        spilloverCount: score.spilloverCount ?? 0,
        spilloverSp: score.spilloverSp ?? 0,
      });
    }
  }

  return Array.from(memberMap.values())
    .map((m: any) => ({
      ...m,
      averages: {
        deliveryPct:
          m.completedSprints.length > 0
            ? Math.round(
                m.completedSprints.reduce(
                  (s: number, c: any) => s + c.deliveryPct,
                  0,
                ) / m.completedSprints.length,
              )
            : 0,
      },
    }))
    .sort((a: any, b: any) => a.displayName.localeCompare(b.displayName));
}

const avg1 = (arr: any[], pick: (p: any) => number): number =>
  arr.length > 0
    ? Math.round((arr.reduce((a: number, p: any) => a + pick(p), 0) / arr.length) * 10) / 10
    : 0;

export interface KanbanTrends {
  developers: any[];
  qa: any[];
}

/**
 * Build kanban-trend cards from scorecards covering a window of synced periods.
 * Returns developer cards (delivery + re-opens per period) and QA cards
 * (bugs raised + tickets tested per period). Each `periods` array carries one
 * entry per scorecard, sorted oldest-first.
 */
export function buildKanbanTrends(scorecards: RawScorecard[]): KanbanTrends {
  const devMap = new Map<string, any>();
  const qaMap = new Map<string, any>();

  for (const { sync, scores } of scorecards) {
    const label =
      sync.periodLabel || sync.sprintName || `${sync.startDate} to ${sync.endDate}`;
    for (const score of scores) {
      if (score.memberCategory === 'qa') {
        if (!qaMap.has(score.jiraLoginId)) {
          qaMap.set(score.jiraLoginId, {
            jiraLoginId: score.jiraLoginId,
            displayName: score.displayName,
            periods: [],
          });
        }
        qaMap.get(score.jiraLoginId)!.periods.push({
          label,
          startDate: sync.startDate,
          endDate: sync.endDate,
          bugsRaised: (score.bugsRaisedCount ?? 0) + (score.offboardBugsRaisedCount ?? 0),
          ticketsTested: score.ticketsTestedCount ?? 0,
        });
        continue;
      }
      if (!devMap.has(score.jiraLoginId)) {
        devMap.set(score.jiraLoginId, {
          jiraLoginId: score.jiraLoginId,
          displayName: score.displayName,
          periods: [],
          // Deliberately always zero: the one function that could have filled these
          // (generateKanbanTeamHistory, a separate live-Jira open-ticket query) had
          // zero UI callers and was deleted rather than wired up here -- see the
          // Kanban delivery-models design doc. KanbanDeveloperCard's "No open
          // tickets currently assigned" message is therefore always accurate, not
          // a bug to fix by filling this in.
          currentBreakdown: {
            todo: 0, inProgress: 0, inReview: 0, inQa: 0, inUat: 0, blocked: 0, done: 0,
          },
          totalOpenTickets: 0,
        });
      }
      devMap.get(score.jiraLoginId)!.periods.push({
        label,
        startDate: sync.startDate,
        endDate: sync.endDate,
        storiesDelivered: score.deliveredCount ?? 0,
        spDelivered: score.spDone ?? 0,
        reopenedCount: score.reopenedCount ?? 0,
      });
    }
  }

  const developers = Array.from(devMap.values())
    .map((m: any) => ({
      ...m,
      avgStoriesPerPeriod: avg1(m.periods, (p) => p.storiesDelivered),
      avgSpPerPeriod: avg1(m.periods, (p) => p.spDelivered),
      avgReopensPerPeriod: avg1(m.periods, (p) => p.reopenedCount),
    }))
    .sort((a: any, b: any) => a.displayName.localeCompare(b.displayName));

  const qa = Array.from(qaMap.values())
    .map((m: any) => ({
      ...m,
      avgBugsPerPeriod: avg1(m.periods, (p) => p.bugsRaised),
      avgTestedPerPeriod: avg1(m.periods, (p) => p.ticketsTested),
    }))
    .sort((a: any, b: any) => a.displayName.localeCompare(b.displayName));

  return { developers, qa };
}
