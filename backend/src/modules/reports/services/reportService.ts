import { jiraService } from '../../jira';
import { aiService } from '../../ai/services/aiService';
import { excelGenerator, jsonGenerator, logger } from '../../../common/utils';
import { DailyBoardSnapshot } from '../../../models/DailyBoardSnapshot';
import { Project } from '../../../models/Project';
import { TeamMember } from '../../../models/TeamMember';
import { AccountTeamMember } from '../../../models/AccountTeamMember';
import { config } from '../../../config';
import { Op, Sequelize } from 'sequelize';
import { ProjectWeeklyReport } from '../../../models/ProjectWeeklyReport';
import { AccountWeeklyReport } from '../../../models/AccountWeeklyReport';
import { Account } from '../../../models/Account';
import { MonthlyProjectReport } from '../../../models/MonthlyProjectReport';
import { MonthlyAccountReport } from '../../../models/MonthlyAccountReport';
import {
  getLaneConfig,
  getStatusesForRole,
  getDevStatuses,
  getActiveMetricStatuses,
  getDoneStatuses,
  getWorkInProgressStatuses,
  formatLaneDefinitionsForPrompt,
  getOwnerFields,
  BUILTIN_ASSIGNEE,
  LaneConfig,
} from '../../../common/laneDefaults';
import { isSubBugIssueType } from './performanceSyncService';
import { isKanbanForDate } from './productivityMath';
import { makeEstimateReader } from './estimateExtraction';
import { getProjectIssueSource } from './issueSourceAdapter';
import { computeBugAxisScore } from './bugSeverityMath';
import { rollupHealth } from './healthMath';
import { normalizeWindow } from './reportWindow';
import { redactIssueTitles, resolveEnvironmentFieldId } from '../../jira/services/jiraFields';
import { PerfSprintSync } from '../../../models/PerfSprintSync';
import { PerfTicketFact } from '../../../models/PerfTicketFact';

/**
 * Monday of the calendar week containing `asOf` (report date, YYYY-MM-DD),
 * or today's week if `asOf` is omitted -- the anchor for Kanban old-vs-new
 * prod bug and spillover classification.
 *
 * Anchored on the report date rather than `new Date()` so a DSR regenerated
 * for a past date is deterministic: the scrum path already anchors on
 * activeSprint.startDate for the same reason, but the Kanban path previously
 * used "today" unconditionally, so regenerating an old Kanban DSR on two
 * different days could classify the same bugs differently each time.
 */
export function computeWeekMonday(asOf?: string): Date {
  const d = asOf ? new Date(asOf) : new Date();
  const day = d.getDay();
  const diff = d.getDate() - day + (day === 0 ? -6 : 1);
  d.setDate(diff);
  d.setHours(0, 0, 0, 0);
  return d;
}

export class ReportService {
  private getISTDate(): Date {
    const now = new Date();
    // constant offset for IST is +5.5 hours
    const utc = now.getTime() + now.getTimezoneOffset() * 60000;
    return new Date(utc + 330 * 60000);
  }

  private getCurrentDateIST(): string {
    return this.getISTDate().toISOString().split('T')[0];
  }

  async processBoard(projectName: string, dateOverride?: string): Promise<any> {
    const todayStr = this.getCurrentDateIST();
    const requestDate = dateOverride || todayStr;

    logger.info(`Fetching Report for Project ${projectName} on ${requestDate}`, 'ReportService');

    // Check for future date
    if (requestDate > todayStr) {
      throw new Error(`Cannot retrieve report for future date ${requestDate}.`);
    }

    // 1. Resolve Project
    const project = await Project.findOne({ where: { code: projectName } });
    if (!project) throw new Error(`Project ${projectName} not found.`);

    // 2. Check Database
    const snapshot = await DailyBoardSnapshot.findOne({
      where: {
        projectId: project.id,
        date: requestDate,
      },
    });

    if (snapshot) {
      logger.info('Found snapshot in DB. Returning stored data.', 'ReportService');
      const data = snapshot.toJSON();

      // Calculate Report Window on the fly (since not stored in DB)
      let startWindow = 'N/A';
      let endWindow = 'N/A';

      if (data.updatedAt) {
        endWindow = new Date(data.updatedAt).toLocaleString('en-IN', { timeZone: 'Asia/Kolkata' });
      } else if (snapshot.updatedAt) {
        endWindow = new Date(snapshot.updatedAt).toLocaleString('en-IN', { timeZone: 'Asia/Kolkata' });
      }

      // To find Start Window, look for previous snapshot
      const previousSnapshot = await DailyBoardSnapshot.findOne({
        where: {
          projectId: project.id,
          date: { [Op.lt]: requestDate },
        },
        order: [['date', 'DESC']],
      });

      if (previousSnapshot && previousSnapshot.updatedAt) {
        startWindow = new Date(previousSnapshot.updatedAt).toLocaleString('en-IN', { timeZone: 'Asia/Kolkata' });
      } else {
        // Fallback: Previous Day at the configured IST window start
        const currentReportDate = new Date(requestDate);
        const prevDay = new Date(currentReportDate);
        prevDay.setDate(prevDay.getDate() - 1);
        prevDay.setUTCHours(config.reports.windowStartHour - 5, config.reports.windowStartMinute - 30, 0, 0);
        startWindow = prevDay.toLocaleString('en-IN', { timeZone: 'Asia/Kolkata' }) + ' (Estimated)';
      }

      const reportWindow = {
        start: startWindow,
        end: endWindow,
      };

      return {
        boardName: data.boardName,
        projectName: data.projectName,
        data: {
          workSummary: data.workSummary,
          executiveSummary: data.executiveSummary,
          keyRisks: data.executiveRisks,
          executivePlan: data.executivePlan,
          health: data.overallHealth,
          risks: data.executiveRisks,
          planForTomorrow: data.executivePlan,
          notes: '',
          reportWindow: reportWindow,
          sprintBurndown: data.sprintBurndown ?? null,
          teamMembers: data.teamMembers ?? [],
          healthRationale: data.healthRationale ?? null,
          teamMemberAttribution: data.teamMemberAttribution ?? null,
          ticketDetails: data.ticketDetails ?? null,
          ticketKeys: data.ticketKeys ?? null,
          managerInsights: data.managerInsights ?? null,
          insightsHealth: data.insightsHealth ?? null,
          insightsHealthReason: data.insightsHealthReason ?? null,
          originalExecutiveSummary: data.originalExecutiveSummary ?? null,
          teamNotes: data.teamNotes ?? [],
        },
      };
    } else {
      logger.warn(`No daily report found in database for ${requestDate}.`, 'ReportService');
      return null;
    }
  }

  async generateBoardReport(projectName: string, dateOverride?: string, force: boolean = false): Promise<any> {
    const todayStr = this.getCurrentDateIST();
    const requestDate = dateOverride || todayStr;

    // Fail loudly on a malformed date. The future-date check below is a string
    // comparison, so junk like '2' slips past it and silently writes a snapshot
    // at a nonsense date (new Date('2') === 2001-02-01) that no UI filter can find.
    if (dateOverride && !/^\d{4}-\d{2}-\d{2}$/.test(dateOverride)) {
      throw new Error(`Invalid report date "${dateOverride}" - expected YYYY-MM-DD.`);
    }

    logger.info(`Processing Project ${projectName} for ${requestDate} (Today IST: ${todayStr})`, 'ReportService');

    // Check for future date logic
    if (requestDate > todayStr) {
      logger.warn(`Date ${requestDate} is in the future (Today IST: ${todayStr}). Blocking request.`, 'ReportService');
      throw new Error(`Cannot generate report for future date ${requestDate}. Current date (IST) is ${todayStr}.`);
    }

    // Logic for Past Date:
    // We now allow generating reports for past dates even if not in DB.
    // If in DB, we use it (fast path). If not, we generate it.

    // 1. Check Database for existing report
    // 1. Resolve Project to get ID
    const project = await Project.findOne({
      where: { code: projectName },
      include: [{ model: Account }],
    });

    if (!project) throw new Error(`Project ${projectName} not found.`);

    // Which delivery-model rules apply to THIS report's date -- not just "is
    // the project Kanban right now". A project that switched mid-history
    // (e.g. Scrum -> Kanban) must keep generating pre-cutover dates under the
    // old rules even after the live flag flips, or a backfill/force-regen of
    // an old date would silently reinterpret it under the new rules. See
    // isKanbanForDate's docstring. Normal cron runs (dateOverride undefined,
    // requestDate always "today") are a no-op once past the cutover.
    const isKanbanEffective = isKanbanForDate(project as any, requestDate);

    // Load project-specific team members separately to avoid leakage and lint issues
    const accountTeamMembers = await AccountTeamMember.findAll({
      where: {
        projectId: project.id,
        accountId: project.accountId,
      },
      include: [TeamMember],
    });

    logger.info(
      `Resolved ${accountTeamMembers.length} team members for project ${project.code} (ID: ${project.id})`,
      'ReportService'
    );
    accountTeamMembers.forEach(atm => {
      logger.debug(
        `  - Member: ${atm.teamMember.firstName} ${atm.teamMember.lastName} (${atm.teamMember.email})`,
        'ReportService'
      );
    });

    // Mock the structure expected by the rest of the service
    (project as any).teamMembers = accountTeamMembers;

    if (project.isSharedTeam) {
      logger.info(
        `Project ${projectName} is a shared team. Aggregating snapshots for ${requestDate}...`,
        'ReportService'
      );

      // 1. Get all team members for this project
      const sharedTeamMembers = accountTeamMembers.map(tm => tm.teamMember);
      const sharedTeamMemberNames = sharedTeamMembers.map(tm => `${tm.firstName} ${tm.lastName}`);

      if (sharedTeamMembers.length === 0) {
        logger.warn(`No team members found for shared team project ${projectName}.`, 'ReportService');
        return null;
      }

      // 2. Find all OTHER snapshots for the same date
      const snapshots = await DailyBoardSnapshot.findAll({
        where: {
          date: requestDate,
          projectId: { [Op.ne]: project.id },
        },
      });

      // 3. Filter snapshots where our shared team members are contributors
      const relevantSnapshots = snapshots.filter(s => {
        const snapshotMembers = s.teamMembers || [];
        return sharedTeamMembers.some(tm =>
          snapshotMembers.some(
            sm =>
              sm.toLowerCase().includes(tm.firstName.toLowerCase()) &&
              sm.toLowerCase().includes(tm.lastName.toLowerCase())
          )
        );
      });

      if (relevantSnapshots.length === 0) {
        logger.warn(`No relevant snapshots found for shared team members on ${requestDate}.`, 'ReportService');
        // Even if no relevant snapshots, we might want to return null or a placeholder
        return null;
      }

      logger.info(`Found ${relevantSnapshots.length} relevant snapshots for consolidated report.`, 'ReportService');

      // 4. Aggregate data for AI analysis
      const aggregatedContext = relevantSnapshots
        .map(
          s => `
Project: ${s.projectName}
Individual Project Work Summary:
${s.workSummary}
Individual Project Risks:
${s.executiveRisks}
Individual Project Plan:
${s.executivePlan}
`
        )
        .join('\n---\n');

      // 5. Generate Consolidated Analysis via AI
      const analysis = await aiService.consolidateSharedTeamReports(
        project.name,
        aggregatedContext,
        sharedTeamMemberNames
      );

      // 6. Save Snapshot
      const newSnapshot = {
        date: requestDate,
        // Snapshots are keyed (date, board_id). Excel projects have no Jira board, and
        // `|| 0` made every one of them collide on board_id = 0 -- so two Excel projects
        // reporting on the same date overwrote each other. Fall back to project.id, the
        // same stable placeholder used by the sprint snapshot path below.
        boardId: project.jiraBoardId ?? project.id,
        boardName: project.jiraName || project.name,
        projectId: project.id,
        projectName: project.name,
        accountId: project.accountId,
        workSummary: analysis.workSummary,
        executiveSummary: analysis.executiveSummary,
        executiveRisks: analysis.keyRisks,
        executivePlan: analysis.executivePlan,
        overallHealth: analysis.health,
        teamMembers: sharedTeamMemberNames,
        consideredJiraIds: [],
      };

      await this.saveSnapshot(newSnapshot);

      return {
        boardName: project.jiraName || project.name,
        projectName: project.name,
        data: {
          workSummary: analysis.workSummary,
          planForTomorrow: analysis.planForTomorrow,
          risks: analysis.risks,
          notes: analysis.notes,
          health: analysis.health,
          executiveSummary: analysis.executiveSummary,
          keyRisks: analysis.keyRisks,
          executivePlan: analysis.executivePlan,
          reportWindow: { start: 'N/A', end: 'N/A' },
        },
      };
    }

    const snapshot = await DailyBoardSnapshot.findOne({
      where: {
        projectId: project.id,
        date: requestDate,
      },
    });

    if (snapshot && !force) {
      logger.info('Found snapshot in DB. Returning stored data.', 'ReportService');
      const data = snapshot.toJSON();
      return {
        boardName: data.boardName,
        projectName: data.projectName,
        data: {
          workSummary: data.workSummary,
          // Provide available fields, fallback to safe defaults or nulls if strictly not stored
          executiveSummary: data.executiveSummary,
          keyRisks: data.executiveRisks,
          executivePlan: data.executivePlan,
          health: data.overallHealth,
          risks: data.executiveRisks, // Mapping executiveRisks to risks as general fallback
          planForTomorrow: data.executivePlan, // Mapping executivePlan as fallback
          notes: '', // Notes not typically stored in snapshot flat fields
          reportWindow: data.reportWindow, // Return stored window if available
          sprintBurndown: data.sprintBurndown ?? null,
        },
      };
    } else if (requestDate < todayStr) {
      logger.info(`No snapshot found for past date ${requestDate}. Generating new report...`, 'ReportService');
    }

    const teamMembers = (project as any).teamMembers.map((atm: any) => atm.teamMember);
    const teamMemberAccountIds = teamMembers.map((tm: any) => tm.jiraLoginId);

    logger.debug(`Found ${teamMembers.length} team members for ${projectName}`, 'ReportService');
    logger.debug(`Team Account IDs: ${teamMemberAccountIds.join(', ')}`, 'ReportService');

    // 2. Fetch issues from Jira
    // Determine start date for JQL: We need issues active around the report window.
    // To be safe, look back 1-2 days before the request Date.
    const reqDateObj = new Date(requestDate);
    const fromDate = new Date(reqDateObj);
    fromDate.setDate(fromDate.getDate() - 2); // Look back 2 days

    // Project-specific issue source: Jira service for Jira projects, Excel-backed wrapper for Excel projects.
    const projectJiraService: any = getProjectIssueSource(project);

    const { boardName, issues } = await projectJiraService.getIssuesForBoard(project.jiraBoardId, fromDate);
    logger.debug(
      `Fetched ${issues.length} total issues from ${boardName} (Board ID: ${project.jiraBoardId})`,
      'ReportService'
    );

    // Single ingestion choke point for the daily path: everything downstream —
    // snapshot summaries, blocked tickets, data-quality flags, the AI prompt —
    // reads these same objects, so redacting here covers all of them at once.
    redactIssueTitles(issues, project.piiRedactionEnabled !== false);

    // 3. Resolve field IDs dynamically
    // Collect EVERY id behind each name, not just the first. A Jira instance can carry
    // two fields with the same display name (one project-scoped, one global) and the
    // populated one is not reliably first — Thrive has two "QA Owner" fields where only
    // the global one holds data. Picking one would read an always-empty field and drop
    // every QA-owned ticket from the report.
    const resolveFieldIds = async (names: string[]): Promise<string[]> => {
      const ids = new Set<string>();
      for (const name of names) {
        for (const id of await projectJiraService.getFieldIdsByName(name)) ids.add(id);
      }
      return Array.from(ids);
    };

    // Which Jira fields carry each role is declared per project (see OwnerFieldsConfig).
    // Unconfigured projects resolve to the lists that used to be hardcoded here, so their
    // behaviour is unchanged. `assignee` is Jira's built-in field, not a custom field, so
    // it is filtered out of the id lookups and handled directly against fields.assignee.
    const ownerFields = getOwnerFields(project);
    const customNames = (names: string[]) => names.filter(n => n && n.toLowerCase() !== BUILTIN_ASSIGNEE);
    const usesBuiltinAssignee = (names: string[]) => names.some(n => n && n.toLowerCase() === BUILTIN_ASSIGNEE);

    const devFieldIds = await resolveFieldIds(customNames(ownerFields.developer));
    const qaFieldIds = await resolveFieldIds(customNames(ownerFields.qa));
    const uatFieldIds = await resolveFieldIds(customNames(ownerFields.uat));
    const devUsesAssignee = usesBuiltinAssignee(ownerFields.developer);
    const qaUsesAssignee = usesBuiltinAssignee(ownerFields.qa);
    const uatUsesAssignee = usesBuiltinAssignee(ownerFields.uat);
    const primaryUatFieldId = uatFieldIds[0] || 'customfield_10441';

    logger.debug(
      `Owner fields for ${projectName}: developer=[${ownerFields.developer.join(', ')}] -> ${devFieldIds.join(',') || (devUsesAssignee ? 'assignee' : 'UNRESOLVED')}; ` +
        `qa=[${ownerFields.qa.join(', ')}] -> ${qaFieldIds.join(',') || 'UNRESOLVED'}; ` +
        `uat=[${ownerFields.uat.join(', ')}] -> ${uatFieldIds.join(',') || 'UNRESOLVED'}; ` +
        `creditChangelogAuthor=${ownerFields.creditChangelogAuthor}`,
      'ReportService'
    );

    // Helper function to check if a user object is a team member
    const isTeamMember = (userObj: any): boolean => {
      if (!userObj) return false;

      // 1. Check Email Address with flexible matching
      if (userObj.emailAddress) {
        const userEmail = userObj.emailAddress.toLowerCase();

        // Try exact match first
        const exactMatch = teamMembers.find(
          (member: any) => member.jiraLoginId.toLowerCase() === userEmail || member.email.toLowerCase() === userEmail
        );
        if (exactMatch) return true;

        // Try pattern-based matching for variations like:
        // aditya.bhoir@myccmortgage.com vs Aditya.Bhoir_EXT@myccmortgage.com
        const matchedByPattern = teamMembers.find((member: any) => {
          const memberEmail = member.jiraLoginId.toLowerCase();
          const memberAltEmail = member.email.toLowerCase();

          // Extract base email parts (before @ and domain)
          const extractBase = (email: string) => {
            const [localPart, domain] = email.split('@');
            // Remove common suffixes like _ext, _int, etc.
            const cleanLocal = localPart.replace(/_(ext|int|contractor)$/i, '');
            return { local: cleanLocal, domain };
          };

          const userBase = extractBase(userEmail);
          const memberBase = extractBase(memberEmail);
          const memberAltBase = extractBase(memberAltEmail);

          // Match if base local parts match and domains are similar
          const sameDomain = (d1: string, d2: string) => {
            // Both myccmortgage.com or ccm.com are considered equivalent
            const normalize = (d: string) => d.replace(/^(myccmortgage\.com|ccm\.com)$/, 'ccm');
            return normalize(d1) === normalize(d2);
          };

          return (
            (userBase.local === memberBase.local && sameDomain(userBase.domain, memberBase.domain)) ||
            (userBase.local === memberAltBase.local && sameDomain(userBase.domain, memberAltBase.domain))
          );
        });
        if (matchedByPattern) return true;
      }

      // 2. Check Account ID (Standard Fallback)
      if (userObj.accountId && teamMemberAccountIds.includes(userObj.accountId)) {
        return true;
      }

      // 3. Check Name Match (Last resort Fallback - Strict)
      if (userObj.displayName) {
        const userName = userObj.displayName.toLowerCase();
        const matchedMember = teamMembers.find((member: any) => {
          const firstName = member.firstName.toLowerCase();
          const lastName = member.lastName.toLowerCase();

          // Use word boundaries to avoid partial matches like "Manasa" matching "Manoj"
          const firstNameRegex = new RegExp(`\\b${firstName}\\b`, 'i');
          const lastNameRegex = new RegExp(`\\b${lastName}\\b`, 'i');

          const result = firstNameRegex.test(userName) && lastNameRegex.test(userName);
          return result;
        });
        if (matchedMember) return true;
      }

      // 3b. Abbreviated surname fallback ("Charly V" -> Charly Varghese).
      // Some Jira tenants (Thrive) both hide emailAddress AND shorten the surname to an
      // initial, which defeats every tier above: tier 1 is skipped for want of an email,
      // tier 2 compares an accountId against jiraLoginId (an email, so never equal), and
      // tier 3's `&&` demands a surname that simply is not in the display name.
      // Deliberately narrow: only fires when the LAST token is a bare initial, so
      // "Charly Vincent" still has to match in full and cannot collide here.
      if (userObj.displayName) {
        const tokens = String(userObj.displayName).trim().toLowerCase().split(/\s+/);
        if (tokens.length >= 2) {
          const initialToken = tokens[tokens.length - 1].replace(/\.$/, '');
          if (/^[a-z]$/.test(initialToken)) {
            const leading = tokens.slice(0, -1);
            const matchedByInitial = teamMembers.find((member: { firstName: string; lastName: string }) => {
              const firstName = member.firstName.toLowerCase();
              const lastName = member.lastName.toLowerCase();
              if (!lastName) return false;
              return leading.includes(firstName) && lastName[0] === initialToken;
            });
            if (matchedByInitial) return true;
          }
        }
      }

      return false;
    };

    // 4. Filter Issues by Team Member (Enhanced to check UAT/QA assignees)
    logger.debug(
      `Filtering for ${teamMembers.length} team members: ${teamMemberAccountIds.join(', ')}`,
      'ReportService'
    );

    // Needed by the changelog-author channel below. Same object is reused for daily
    // activity further down, so this is hoisted rather than computed twice.
    const window = await this.getReportDateRange(requestDate, project.jiraBoardId);

    // Per-channel tallies so a zero-match run says WHICH signal was missing rather
    // than just "no team issues" — the difference between "nobody worked today" and
    // "the QA field name does not exist on this Jira instance".
    const matchCounts = { assignee: 0, developer: 0, uat: 0, qa: 0, actor: 0 };

    const mappedTeamIssues = issues
      .map((issue: any) => {
        const fields: any = issue.fields;
        const matchedMembers: any[] = [];

        // Check 1: Developer — whichever field(s) this project declares. Defaults to the
        // built-in assignee, which is what every project used before ownerFields existed.
        if (devUsesAssignee && isTeamMember(fields.assignee)) {
          matchedMembers.push(fields.assignee);
          matchCounts.assignee++;
        }
        for (const id of devFieldIds) {
          if (isTeamMember(fields[id])) {
            matchedMembers.push(fields[id]);
            matchCounts.developer++;
          }
        }

        // Check 2: UAT owner
        if (uatUsesAssignee && isTeamMember(fields.assignee)) {
          matchedMembers.push(fields.assignee);
          matchCounts.uat++;
        }
        for (const id of uatFieldIds) {
          if (isTeamMember(fields[id])) {
            matchedMembers.push(fields[id]);
            matchCounts.uat++;
          }
        }

        // Check 3: QA owner
        if (qaUsesAssignee && isTeamMember(fields.assignee)) {
          matchedMembers.push(fields.assignee);
          matchCounts.qa++;
        }
        for (const id of qaFieldIds) {
          if (isTeamMember(fields[id])) {
            matchedMembers.push(fields[id]);
            matchCounts.qa++;
          }
        }

        // Check 4: Changelog author — who actually MOVED the ticket in today's window.
        // The field checks above read assignee/QA/UAT as they stand at fetch time
        // (20:00 IST), which loses work where the ticket was handed on afterwards: a dev
        // fixes it, unassigns to pass it to QA, and by 20:00 it names someone else.
        // Opt-in per project because it broadens attribution beyond the declared owner
        // fields. Changelogs are already embedded on every issue (the agile board fetch
        // uses expand=changelog), so this costs no extra Jira calls.
        if (ownerFields.creditChangelogAuthor) {
          for (const h of issue.changelog?.histories || []) {
            const created = new Date(h.created);
            if (created < window.start || created > window.end) continue;
            if (!(h.items || []).some((it: { field?: string }) => it.field === 'status')) continue;
            if (isTeamMember(h.author)) {
              matchedMembers.push(h.author);
              matchCounts.actor++;
            }
          }
        }

        if (matchedMembers.length > 0) {
          issue.matchedTeamMembers = [...new Set(matchedMembers.map(m => m.displayName))];
          return issue;
        }

        return null;
      })
      .filter((issue: any) => issue !== null);

    // --- Sprint-Based Pre-Filtering (Requirement Feb 24 - SC Project) ---
    // If a ticket is Done/Closed, it must belong to the active sprint of the board.
    // This prevents old tickets from closed sprints (that were recently updated) from showing up.
    const sprintFieldId = await projectJiraService.getFieldIdByName('Sprint');
    const activeSprint = await projectJiraService.getActiveSprint(project.jiraBoardId);
    // Closed (completed) sprint ids — used by isSpilloverBug to detect genuine carry-over
    // (a bug moved INTO the active sprint FROM a now-closed sprint). Skipped for Kanban/no-sprint.
    // Must use projectJiraService, not the module-level singleton: the singleton is
    // built with empty credentials, so it 401s on every per-project-credentialed board
    // and silently degrades spillover detection to "no closed sprints".
    const closedSprintIds = activeSprint
      ? await projectJiraService.getClosedSprintIds(project.jiraBoardId)
      : new Set<number>();
    const reportDoneStatuses = getDoneStatuses(getLaneConfig(project)).map((s: string) => s.toLowerCase());

    // --- Sprint Rollover Bypass (Retroactive DSR Accuracy) ---
    // When regenerating DSRs for past dates (dateOverride), the active sprint may have changed.
    // If the current active sprint started AFTER the target date, it did not exist on that date.
    // In this case: skip sprint burndown + health scoring, and relax the done-ticket sprint filter
    // so tickets completed in the old (now-closed) sprint are not silently dropped.
    // NOTE: dateOverride is only set by batch jobs / manual API — the daily cron passes undefined,
    // so this guard is NEVER triggered for normal scheduled DSR generation.
    let sprintRolledOver = false;
    if (dateOverride && activeSprint?.startDate) {
      const targetDate = new Date(dateOverride);
      const sprintStart = new Date(activeSprint.startDate);
      if (sprintStart > targetDate) {
        sprintRolledOver = true;
        logger.warn(
          `[SprintRolloverBypass] ${projectName} | ${dateOverride} | ` +
            `Active sprint "${activeSprint.name}" started ${activeSprint.startDate}, ` +
            `which is after target DSR date ${dateOverride}. ` +
            `Done-ticket sprint filter relaxed for retroactive accuracy.`,
          'ReportService'
        );
      }
    }

    // --- Which sprint does the burndown score against? ---
    // For a normal run that is simply the active sprint. For a past date it is NOT: the board
    // may have rolled over since, and scoring a historical day against a sprint that began
    // afterwards is meaningless — which is why it used to be skipped entirely, leaving every
    // backfilled day with an empty progress bar.
    //
    // Resolve the sprint that was actually running on the target date instead. Null means no
    // sprint covered that date (a genuine gap between sprints), and the burndown stays unscored.
    //
    // Only reached when dateOverride is set — batch jobs and manual regeneration. The daily
    // cron passes undefined, so scheduled generation keeps using the active sprint unchanged.
    let burndownSprint = activeSprint;
    if (dateOverride && sprintRolledOver && !isKanbanEffective) {
      burndownSprint = await projectJiraService.getSprintForDate(project.jiraBoardId, dateOverride);
      logger.info(
        `[HistoricalSprint] ${projectName} | ${dateOverride} | burndown scored against ` +
          `"${burndownSprint?.name ?? 'NONE — no sprint covered this date'}" ` +
          `instead of the current active sprint "${activeSprint?.name}".`,
        'ReportService'
      );
    }

    // Sub-task issue types are child work items and must be excluded from all report
    // evaluations — they are not independent work units and should never appear in
    // prod bug detection, health scoring, AI context, or any report output.
    const SUBTASK_TYPES = ['Sub-task', 'Subtask'];

    const teamIssues = mappedTeamIssues.filter((issue: any) => {
      if (SUBTASK_TYPES.includes(issue.fields?.issuetype?.name || '')) {
        logger.debug(
          `[SubtaskFilter] Excluding ${issue.key} (issuetype=${issue.fields?.issuetype?.name})`,
          'ReportService'
        );
        return false;
      }

      const status = issue.fields.status.name.toLowerCase();
      // Requirement Feb 24 (SC): Exclude Done/Closed tickets not in active sprint
      const isDone = reportDoneStatuses.includes(status) || ['closed', 'resolved', 'done'].includes(status);

      // Kanban has no sprint semantics -- a ticket's stale Sprint field (e.g. from a
      // sibling Scrum board sharing the same Jira project) must not drop a Done
      // Kanban ticket just because that sprint isn't active.
      if (isDone && !isKanbanEffective && sprintFieldId && !sprintRolledOver) {
        const sprints = issue.fields[sprintFieldId];
        if (Array.isArray(sprints) && sprints.length > 0) {
          // Check if any associated sprint is active
          const hasActiveSprint = sprints.some(
            (s: any) => s.state === 'active' || (activeSprint && s.id === activeSprint.id)
          );
          if (!hasActiveSprint) {
            logger.debug(
              `[SprintFilter] Excluding DONE ticket ${issue.key} because it is not in the active sprint.`,
              'ReportService'
            );
            return false;
          }
        } else if (activeSprint) {
          // If the board HAS an active sprint but the ticket has NO sprint, exclude it if it's already Done
          // This catches tickets that might have been "left behind" or are context-less closures.
          logger.debug(
            `[SprintFilter] Excluding DONE ticket ${issue.key} because it has no sprint associated with the active board.`,
            'ReportService'
          );
          return false;
        }
      }
      return true;
    });

    logger.debug(`Filtered down to ${teamIssues.length} issues (team members + sprint focus).`, 'ReportService');

    // --- Historical status rewind (retroactive DSR accuracy) ---
    // A regenerated past-date report must reflect ticket status AS OF that date, not
    // today's live status. Every downstream consumer in this function (blocked-ticket
    // detection, UAT-ownership filtering, active/queued-ticket categorization feeding the
    // AI narrative, WIP count, stale-ticket detection, prod-bug scoring, and the persisted
    // statusCounts/ticketKeys) reads `issue.fields.status.name` off `teamIssues`, so the
    // rewind happens once here, upstream of all of them, rather than patched into each.
    // Uses changelog already embedded on every issue (expand=changelog on the board fetch,
    // same field isAddedToSprintToday already reads) — no extra Jira call.
    // NOTE: dateOverride is only set by batch jobs / manual API — the daily cron passes
    // undefined, so this never runs for normal scheduled DSR generation.
    if (dateOverride) {
      let rewound = 0;
      for (const issue of teamIssues) {
        const asOf = this.statusAsOfWindowEnd(issue, window.end);
        if (asOf !== issue.fields?.status?.name) {
          if (issue.fields?.status) {
            issue.fields.status.name = asOf;
          }
          rewound++;
        }
      }
      logger.info(
        `[HistoricalTicketStatus] ${projectName} | ${dateOverride} | window.end=${window.end.toISOString()} | ` +
          `${teamIssues.length} team ticket(s) considered, rewound ${rewound} to their status as of that date.`,
        'ReportService'
      );
    }

    if (teamIssues.length === 0) {
      logger.warn(
        `No team issues found for ${projectName}. Skipping (no snapshot will be written). ` +
          `Fetched ${issues.length} issue(s); matched by assignee=${matchCounts.assignee}, ` +
          `developer-field=${matchCounts.developer}, QA=${matchCounts.qa}, UAT=${matchCounts.uat}, ` +
          `changelog-author=${matchCounts.actor}; ` +
          `${mappedTeamIssues.length} survived team matching, 0 survived the sub-task/sprint filter. ` +
          `Team members: ${teamMemberAccountIds.join(', ') || 'NONE'}. ` +
          `Owner fields: developer=[${ownerFields.developer.join(', ')}] -> ${devFieldIds.join(',') || (devUsesAssignee ? 'assignee' : 'UNRESOLVED')}; ` +
          `qa=[${ownerFields.qa.join(', ')}] -> ${qaFieldIds.join(',') || 'UNRESOLVED'}; ` +
          `uat=[${ownerFields.uat.join(', ')}] -> ${uatFieldIds.join(',') || 'UNRESOLVED'}. ` +
          `If the team owns work through a field this project does not declare, that is the likely cause.`,
        'ReportService'
      );
      return null;
    }

    // 4. Get previous snapshot
    const previousSnapshot = await this.getLatestSnapshot(boardName);

    // 5. Extract Details (using project lane config)
    const laneConfig = getLaneConfig(project);

    // Resolve Development Field ID dynamically
    const devFieldId = await projectJiraService.getFieldIdByName('Development');

    const blockedStatuses = getStatusesForRole(laneConfig, 'blocked');
    const allBlockedTickets = projectJiraService.extractBlockedInfo(teamIssues, blockedStatuses);
    const staleTickets = this.identifyStaleTickets(teamIssues);

    // 6. Identify Daily Activity (Strict Filtering)
    // `window` is computed above (hoisted for the changelog-author match channel).

    // --- Board-scope filter for blocked tickets ---
    // DSR reflects daily work on the active board. A ticket sitting in backlog or a
    // future/closed sprint must not drive RAG health. One exception: if it was on the
    // active board at the start of today and got moved to backlog during the window,
    // it still counts (team touched it today). Backlog tickets whose status was flipped
    // to Blocked today are surfaced separately as a neutral FYI — not a health signal.
    const isKanban = isKanbanEffective;
    const windowStart = window.start;
    const isInBoardScope = (issue: any): boolean => {
      const status = (issue.fields?.status?.name || '').toLowerCase();
      const histories = issue.changelog?.histories || [];

      if (!isKanban && activeSprint) {
        const sprints = sprintFieldId ? issue.fields[sprintFieldId] : null;
        const inActiveNow =
          Array.isArray(sprints) && sprints.some((s: any) => s?.state === 'active' || s?.id === activeSprint.id);
        if (inActiveNow) return true;
        for (const h of histories) {
          if (new Date(h.created) < windowStart) continue;
          for (const item of h.items || []) {
            if (item.field !== 'Sprint') continue;
            const fromIds = String(item.from || '')
              .split(/[,\s]+/)
              .filter(Boolean);
            if (fromIds.includes(String(activeSprint.id))) return true;
          }
        }
        return false;
      }

      if (!status.includes('backlog')) return true;
      for (const h of histories) {
        if (new Date(h.created) < windowStart) continue;
        for (const item of h.items || []) {
          if (item.field !== 'status') continue;
          const to = String(item.toString || '').toLowerCase();
          const from = String(item.fromString || '').toLowerCase();
          if (to.includes('backlog') && !from.includes('backlog')) return true;
        }
      }
      return false;
    };

    const blockedTickets = allBlockedTickets.filter((t: any) => {
      const issue = teamIssues.find((i: any) => i.key === t.key);
      return issue ? isInBoardScope(issue) : false;
    });

    // Informational FYI: backlog tickets whose status flipped to Blocked during today's window.
    const newlyBlockedInBacklog: Array<{ key: string; summary: string; timestamp: string }> = [];
    const blockedStatusesLower = blockedStatuses.map((s: string) => s.toLowerCase());
    for (const issue of teamIssues) {
      if (isInBoardScope(issue)) continue;
      const status = (issue.fields?.status?.name || '').toLowerCase();
      if (!blockedStatusesLower.includes(status)) continue;
      const histories = issue.changelog?.histories || [];
      const transitionEntry = histories.find((h: any) => {
        if (new Date(h.created) < windowStart) return false;
        return (h.items || []).some(
          (it: any) => it.field === 'status' && blockedStatusesLower.includes(String(it.toString || '').toLowerCase())
        );
      });
      if (transitionEntry) {
        newlyBlockedInBacklog.push({
          key: issue.key,
          summary: issue.fields.summary,
          timestamp: transitionEntry.created,
        });
      }
    }

    logger.info(
      `[BlockedScope] ${projectName}: in-scope=${blockedTickets.length} dropped=${allBlockedTickets.length - blockedTickets.length} newlyBlockedInBacklog=${newlyBlockedInBacklog.length}`,
      'ReportService'
    );
    // Note: newlyAddedProdBugs is populated later during prod-bug filtering; log it alongside combined health at line ~1070.

    const devStatuses = getDevStatuses(laneConfig);
    const { teamActiveTickets, queuedWorkTickets, contextTickets, weekendActivityTickets } = this.identifyDailyActivity(
      teamIssues,
      window,
      isTeamMember,
      devStatuses,
      devFieldId,
      reportDoneStatuses,
      devFieldIds,
      devUsesAssignee
    );

    // Separate non-V2-UAT tickets from active context — pending customer/PO acceptance, not V2 work
    const isV2OwnedUat = (issue: any): boolean => {
      const status = (issue.fields?.status?.name || '').toLowerCase();
      if (!status.includes('uat')) return true;
      return uatFieldIds.some((id: string) => isTeamMember(issue.fields[id]));
    };
    const filteredActiveTickets = teamActiveTickets.filter(isV2OwnedUat);
    const nonV2UatActive = teamActiveTickets.filter((i: any) => !isV2OwnedUat(i));

    const activeTickets = filteredActiveTickets; // For summaries (non-V2-UAT excluded)
    const detailsTickets = [...new Set([...teamActiveTickets, ...queuedWorkTickets])]; // For teamMembers list
    // NOTE: `contextTickets`/`nonV2UatActive` (no activity today, or activity on a non-V2-owned
    // UAT ticket) are deliberately NOT fed into the AI narrative. A ticket with no activity today
    // must never be referenced in the report, regardless of how stale or "on the board" it is —
    // only `queuedWorkTickets` (moved to QA/UAT today — genuine same-day activity) goes to the AI
    // alongside `activeTickets`. See aiService.analyzeBoard's `queuedTickets` param.

    // 7. Two-Axis Deterministic Health Calculation (before AI call)
    const PROD_BUG_TYPES = ['Bug', 'Sub-bug'];

    // --- AXIS 1: Blocked % ---
    // Refinement (Feb 2026): Only count tickets blocked > 3 days as Risk
    const todayIST = new Date();
    const getDaysSinceBlocked = (issue: any): number => {
      if (!issue.changelog || !issue.changelog.histories) return 0;

      // Iterate reverse (newest first) to find last transition to 'Blocked'
      const histories = issue.changelog.histories;
      for (const history of histories) {
        for (const item of history.items) {
          // Check if field is status and new value (toString) is 'Blocked'
          if (item.field === 'status' && (item.toString || '').toLowerCase() === 'blocked') {
            const blockedDate = new Date(history.created);
            const diffTime = Math.abs(todayIST.getTime() - blockedDate.getTime());
            const diffDays = Math.ceil(diffTime / (1000 * 60 * 60 * 24));
            return diffDays;
          }
        }
      }
      // If no transition found (maybe created as blocked?), fallback to 0 (safe)
      return 0;
    };

    const longTermBlocked = blockedTickets.filter((t: any) => {
      const issue = teamIssues.find((i: any) => i.key === t.key);
      if (!issue) return false;
      const days = getDaysSinceBlocked(issue);
      return days > 3;
    });

    const amberThreshold = (project as any).account?.amberThresholdPercentage ?? 20;
    const wipStatuses = getWorkInProgressStatuses(laneConfig);
    const wipCount = teamIssues.filter((i: any) => {
      const status = i.fields.status.name.toLowerCase();
      const isPendingOrBacklog = ['pending deployment', 'backlog'].some(s => status.includes(s));
      if (isPendingOrBacklog) return false;

      // Once a ticket reaches UAT, V2 team's work is internally complete.
      // Exclude ALL UAT tickets from WIP count regardless of assignee.
      if (status.includes('uat')) {
        return false;
      }

      return wipStatuses.some(s => s.toLowerCase() === status);
    }).length;

    // Use logic filtered count for SCORE
    const riskBlockedCount = longTermBlocked.length;
    const blockedPct = wipCount > 0 ? (riskBlockedCount / wipCount) * 100 : 0;
    const blockedScore = blockedPct >= amberThreshold ? 1 : 0; // 0=Green, 1=Amber

        // Resolve Environment Field ID dynamically (use project-specific Jira instance)
        const targetEnvFieldId = await resolveEnvironmentFieldId(projectJiraService);

    // --- Axis 2: Prod Bug Score (issue type = 'Bug' AND Environment = Production) ---

    // Statuses that mean the bug is resolved — excluded from health scoring (#3)
    const doneStatuses = getDoneStatuses(laneConfig).map((s: string) => s.toLowerCase());
    const RESOLVED_STATUSES = [
      ...doneStatuses,
      'resolved',
      'closed',
      "won't fix",
      'duplicate',
      'pending deployment',
      'backlog',
    ];

    // --- Old vs New prod bug classification (prod bugs only — no other ticket affected) ---
    // A prod bug created long ago but just prioritised into the current sprint/board is
    // planned remediation work, NOT a new production incident.
    // Rule: bugs created more than 15 days before the sprint start date are planned tickets.
    // Scrum: cutoff = sprintStartDate - 15 days; Kanban: cutoff = current week Monday - 15 days.

    // Reference dates for age check
    const sprintStartDate = activeSprint?.startDate ? new Date(activeSprint.startDate) : null;
    const weekMonday = computeWeekMonday(dateOverride);

    /**
     * Returns true if a prod bug is "old" (planned remediation) — created before the
     * 15-day window relative to the sprint start (Scrum) or current week Monday (Kanban).
     * Old bugs are intentionally scheduled into the sprint and do NOT affect health score.
     */
    const isOldProdBug = (issue: any): boolean => {
      const createdDate = new Date(issue.fields.created);
      const isKanbanBug = isKanbanEffective;
      if (isKanbanBug) {
        const cutoff = new Date(weekMonday);
        cutoff.setDate(cutoff.getDate() - 15);
        return createdDate < cutoff;
      }
      if (!sprintStartDate) return false; // no sprint info = assume new (conservative)
      const cutoff = new Date(sprintStartDate);
      cutoff.setDate(cutoff.getDate() - 15);
      return createdDate < cutoff;
    };

    /**
     * Returns true if a prod bug is a Sub-bug filed against a currently active team ticket.
     * These represent re-opened stories (regression/rework) — mentioned in AI output as
     * "re-opened" but NOT counted against project health.
     */
    const activeTeamIssueKeys = new Set(teamIssues.map((i: any) => i.key));
    const isReopenedSubBug = (issue: any): boolean => {
      if (issue.fields.issuetype?.name !== 'Sub-bug') return false;
      const parentKey = issue.fields.parent?.key;
      return !!(parentKey && activeTeamIssueKeys.has(parentKey));
    };

    /**
     * Returns true if a prod bug is a genuine spillover — carried into the active sprint
     * from a now-CLOSED (completed) sprint.
     * Scrum: changelog shows a Sprint move whose destination includes the active sprint and
     *        whose source includes a closed sprint id. Moves from a backlog/refinement bucket
     *        (future sprint) or churn within the active sprint are NOT spillover.
     * Kanban / no active sprint: bug was created before the current week's Monday.
     */
    const isSpilloverBug = (issue: any): boolean => {
      // Kanban: treat as spillover if created before this week's Monday
      if (isKanbanEffective) {
        return new Date(issue.fields.created) < weekMonday;
      }
      // Scrum: without an active sprint reference, spillover semantics don't apply
      if (!activeSprint) {
        return false;
      }
      const histories: any[] = issue.changelog?.histories || [];
      for (const history of histories) {
        for (const item of history.items || []) {
          if (item.field !== 'Sprint') continue;
          const fromIds = String(item.from || '')
            .split(/[,\s]+/)
            .filter(Boolean)
            .map(Number);
          const toIds = String(item.to || '')
            .split(/[,\s]+/)
            .filter(Boolean)
            .map(Number);
          const movedIntoActive = toIds.includes(activeSprint.id);
          const cameFromClosed = fromIds.some((id: number) => closedSprintIds.has(id));
          if (movedIntoActive && cameFromClosed) {
            return true; // carried in from a closed sprint = genuine spillover
          }
        }
      }
      return false;
    };

    /**
     * Returns true if the bug is assigned exclusively to a sprint that has NOT yet started
     * (state = 'future' and not the active sprint). Such bugs are pre-planned work items —
     * the team pulled them off the backlog into a future sprint. They should appear in the
     * work summary (via teamIssues) but must NOT trigger a health alert for the current sprint.
     */
    const isFutureSprintBug = (issue: any): boolean => {
      if (!sprintFieldId || !activeSprint) return false;
      const sprintData = issue.fields?.[sprintFieldId];
      if (!sprintData) return false;
      const sprints: any[] = Array.isArray(sprintData) ? sprintData : [sprintData];
      const isInActiveSprint = sprints.some((s: any) => s.state === 'active' || s.id === activeSprint.id);
      if (isInActiveSprint) return false; // also in active sprint — treat normally
      return sprints.some((s: any) => s.state === 'future');
    };

    // Was the issue added to the active sprint during today's report window?
    // If yes, the team pulled it in mid-day — treat as informational for this report
    // only. Tomorrow's DSR will score it normally.
    const isAddedToSprintToday = (issue: any): boolean => {
      if (!activeSprint) return false;
      const histories = issue.changelog?.histories || [];
      for (const h of histories) {
        if (new Date(h.created) < windowStart) continue;
        for (const item of h.items || []) {
          if (item.field !== 'Sprint') continue;
          const toIds = String(item.to || '')
            .split(/[,\s]+/)
            .filter(Boolean);
          const fromIds = String(item.from || '')
            .split(/[,\s]+/)
            .filter(Boolean);
          if (toIds.includes(String(activeSprint.id)) && !fromIds.includes(String(activeSprint.id))) {
            return true;
          }
        }
      }
      return false;
    };

    /**
     * Returns true if the bug is already being actively addressed — dev is in
     * progress, or the fix is in QA / testing / code-review / UAT. Such bugs
     * contribute at most Amber to the health score (never Red).
     * In-progress coding counts as active response to a prod bug — the team has
     * engaged with it, it is not "unaddressed" sitting in the backlog.
     */
    const inRemediationStatuses = new Set(
      [
        ...(laneConfig.in_progress || []),
        ...(laneConfig.in_review || []),
        ...(laneConfig.qa || []),
        ...(laneConfig.uat || []),
      ].map((s: string) => s.toLowerCase())
    );

    const isInRemediationBug = (issue: any): boolean => {
      const status = (issue.fields?.status?.name || '').toLowerCase();
      return inRemediationStatuses.has(status);
    };

    const newlyAddedProdBugs: Array<{ key: string; summary: string; timestamp: string }> = [];

    const prodBugs = teamIssues.filter((i: any) => {
      // Must be issue type Bug
      const isBugType = PROD_BUG_TYPES.includes(i.fields?.issuetype?.name);
      if (!isBugType) return false;

      // Fix #3: Skip bugs that are already resolved/done — they are not active risks
      // User Update Feb 23: Explicitly ignore "Pending Deployment" and non-team UAT
      const currentStatus = (i.fields?.status?.name || '').toLowerCase();
      if (RESOLVED_STATUSES.some(s => currentStatus.includes(s))) {
        return false;
      }

      if (currentStatus.includes('uat')) {
        const hasTeamUatAssignee = uatFieldIds.some(id => isTeamMember(i.fields[id]));
        if (!hasTeamUatAssignee) return false;
      }

      // Skip bugs assigned only to a future sprint — they are pre-planned items
      // and must not affect the current sprint's health signal
      if (isFutureSprintBug(i)) return false;

      // Prod bugs pulled into the active sprint mid-day are the team's proactive
      // response — don't penalise the DSR on the day they engage. Record them as
      // informational; tomorrow's report scores them normally.
      if (isAddedToSprintToday(i)) {
        const histories = i.changelog?.histories || [];
        const entry = histories.find((h: any) => {
          if (new Date(h.created) < windowStart) return false;
          return (h.items || []).some(
            (it: any) =>
              it.field === 'Sprint' &&
              String(it.to || '')
                .split(/[,\s]+/)
                .includes(String(activeSprint.id))
          );
        });
        newlyAddedProdBugs.push({
          key: i.key,
          summary: i.fields.summary,
          timestamp: entry?.created || '',
        });
        return false;
      }

      // Strategy 1: Check Environment custom field (most reliable)
      let isProdEnv = false;
      const envField = i.fields?.[targetEnvFieldId];
      if (envField) {
        if (Array.isArray(envField)) {
          isProdEnv = envField.some((v: any) => v.value === 'Production' || v.value === 'Prod');
        } else {
          isProdEnv = envField.value === 'Production' || envField.value === 'Prod';
        }
      }
      if (isProdEnv) return true;

      // Strategy 2: Title keyword fallback — tightened to avoid false positives like
      // "product", "productivity", "production-ready" (#1 fix).
      // Matches: "prod bug", "[prod]", "prod -", "prod:", "(prod)", "production issue"
      // Does NOT match: "product", "productivity", "improve product listing"
      const summary = i.fields.summary || '';
      const PROD_TITLE_REGEX = /\bprod(uction)?\b/i;
      if (PROD_TITLE_REGEX.test(summary)) {
        return true;
      }

      return false;
    });
    const bugAxisDetail = computeBugAxisScore(
      prodBugs.map((b: any) => ({
        isOld: isOldProdBug(b),
        isReopenedSubBug: isReopenedSubBug(b),
        isInRemediation: isInRemediationBug(b),
        priorityName: b.fields?.priority?.name,
      })),
      project.bugPriorityMap
    );
    const bugScore = bugAxisDetail.score;

    // Spillover bugs (carried over from a previous sprint) force Axis 2 to at least Amber
    const spilloverBugs = prodBugs.filter((b: any) => !isOldProdBug(b) && !isReopenedSubBug(b) && isSpilloverBug(b));
    const finalBugScore = Math.max(bugScore, spilloverBugs.length > 0 ? 1 : 0);

    // --- AXIS 3: Sprint Burndown (Scrum projects only, skip Kanban) ---
    interface SprintBurndown {
      sprintName: string;
      startDate: string;
      endDate: string;
      // Days
      daysTotal: number;
      daysElapsed: number;
      daysPending: number;
      sprintElapsedPct: number;
      // Story counts (V2 only, decision metric)
      totalV2Tickets: number;
      completedV2Tickets: number;
      storiesPending: number;
      completionPct: number;
      completionPctSP: number;
      // Off-track assessment
      offTrackPct: number;
      // 'not-tracked' = project.sprintAssignmentModel is 'on_the_go' (team commits to
      // a total sprint SP and picks up tickets as they go, no stable per-person/
      // per-subteam scope to measure pace against). Genuinely neutral, not a "green" —
      // sprint pace is deliberately excluded from health scoring in this case.
      onTrackStatus: 'on-track' | 'at-risk' | 'critical' | 'not-tracked';
      // Story points (reference only, not used for decision)
      totalV2SP: number;
      completedV2SP: number;
      inProgressV2SP: number;
      usedSP: boolean;
      // Whole-sprint (unfiltered by V2 assignment) rollup — the team's real committed
      // scope, regardless of who's currently holding what. For 'planned' projects this
      // is purely additive/informational; for 'on_the_go' projects completionPct/
      // completionPctSP above are computed FROM these instead of the V2-only numbers.
      totalSprintSP: number;
      completedSprintSP: number;
      totalSprintTickets: number;
      completedSprintTickets: number;
      // V2's current slice, aliasing totalV2SP/completedV2SP — informational only for
      // 'on_the_go' projects ("what V2 currently has assigned"), never a target.
      v2CurrentWorkloadSP: number;
      v2CurrentCompletedSP: number;
      // Per-lane SP breakdown (for visual progress strip and AI context)
      todoSP: number;
      inProgressSP: number;
      inReviewSP: number;
      inQaSP: number;
      inUatSP: number;
      blockedSP: number;
      reopenedSP: number;
      // Per-lane V2 ticket counts. Parallel to the SP fields above so the
      // Delivery Presentation Live Status card can show "Lane | Tickets | SP"
      // with both numbers from the same V2-sprint scope.
      todoV2Tickets: number;
      inProgressV2Tickets: number;
      inReviewV2Tickets: number;
      inQaV2Tickets: number;
      inUatV2Tickets: number;
      blockedV2Tickets: number;
      reopenedV2Tickets: number;
      // Human-readable "what counts as Done" for this project's board — computed from
      // this project's own lane config, not hardcoded to any one project. Suggestive
      // text only, shown under the progress bar so the % isn't a black box.
      doneStatusLabels: string[];
    }

    let sprintBurndown: SprintBurndown | null = null;
    let sprintScore = 0;
    let qaTicketCount = 0; // Tracks QA-stage tickets for partial credit logging
    // V2-owned tickets currently sitting in dev/review or QA lanes (not yet Done) — used
    // as the deterministic Executive Summary fallback for 'on_the_go' projects when there
    // is no genuine same-day activity to report (see the on-the-go override after the AI
    // call, below). Populated inside the burndown block's per-V2-ticket loop, where the
    // lane classification already happens for the SP/ticket-count accumulators.
    const v2InProgressOrQaTickets: { key: string; summary: string; stage: 'dev' | 'qa' }[] = [];

    // `burndownSprint` is the active sprint for a normal run, and the sprint that was actually
    // running on the target date for a historical one. No longer gated on !sprintRolledOver:
    // a rolled-over board now resolves the right sprint rather than skipping the burndown.
    if (!isKanban && burndownSprint?.startDate && burndownSprint?.endDate) {
      // Resolve the estimate reader (story points, or hours for hours-based projects).
      const readEstimate = await makeEstimateReader(project as any, projectJiraService);

      // Burndown uses a dedicated sprint fetch (not teamIssues) so tickets quiet for
      // >2 days are still counted — the board-fetch 2-day window is intentional for
      // daily activity/blocked/stale/AI context, but distorts sprint totals.
      //
      // DEVELOPER FIELDS ONLY — never QA or UAT. Two reasons:
      //   1. Intent: this measures developer progress, so QA/UAT-matched tickets (a
      //      client-assigned ticket we merely test) must not inflate it.
      //   2. Safety: the default developer list is ['assignee'], which is exactly what
      //      this filter used before the setting existed, so every unconfigured project
      //      is unchanged. Folding in QA would move CCM immediately — "Assigned QA" is
      //      populated on 92% of tickets on the SC board.
      //
      // For a board where `assignee` is a work-queue pointer rather than ownership
      // (Thrive passes it Dev -> QA -> Dev), declaring the static Developer field here
      // is what stops the denominator shrinking every time work is handed on.
      let sprintAllIssues = await projectJiraService.getAllSprintIssues(burndownSprint.id);

      // --- Historical accuracy: rewind ticket status to the target date ---
      // Statuses on the fetched issues are CURRENT. For a past date that makes every day of
      // a finished sprint look ~90% complete, because the tickets are all closed by now —
      // a flat line that reads as real data and is worse than showing nothing.
      //
      // Rewind each ticket's status to what it was at the end of the report window, and drop
      // tickets that did not exist yet. Costs one changelog fetch per sprint ticket, batched
      // 10 at a time, so it is only done for historical runs.
      //
      // Runs over the FULL sprint (sprintAllIssues), not just the V2-filtered subset —
      // the whole-sprint rollup (totalSprintSP/completedSprintSP etc., used for
      // 'on_the_go' projects) needs every ticket historically accurate, not just the
      // ones V2 owns. sprintV2Issues below is filtered from this already-rewound set,
      // so both stay consistent with the same day's true state. (This was previously a
      // real bug: the rewind only ever touched the V2 subset, so the whole-sprint totals
      // silently used TODAY's live status for every other ticket, producing the same
      // "current reality" numbers on every historical day regardless of target date.)
      //
      // Known limit: the DENOMINATOR is still the sprint's final membership, so scope added
      // mid-sprint counts from day one. The numerator — what was actually finished by that
      // date — is now correct, which is what makes the curve meaningful.
      if (dateOverride) {
        type ChangeItem = { field?: string; fromString?: string };
        type ChangeHistory = { created: string; items?: ChangeItem[] };
        type SprintIssue = { key: string; fields?: { created?: string; status?: { name: string } } };

        const createdAfterWindow = (i: SprintIssue) => !!i.fields?.created && new Date(i.fields.created) > window.end;
        const notYetCreated = sprintAllIssues.filter(createdAfterWindow);
        sprintAllIssues = sprintAllIssues.filter((i: SprintIssue) => !createdAfterWindow(i));

        const changelogs = await projectJiraService.getChangelogsForKeys(
          sprintAllIssues.map((i: SprintIssue) => i.key)
        );
        let rewound = 0;
        for (const issue of sprintAllIssues as SprintIssue[]) {
          const histories: ChangeHistory[] = changelogs.get(issue.key) || [];
          // The `from` side of the EARLIEST status change made after the window is what
          // the ticket was showing when the window closed.
          const after = histories
            .filter(h => new Date(h.created) > window.end)
            .sort((a, b) => new Date(a.created).getTime() - new Date(b.created).getTime());
          for (const h of after) {
            const statusItem = (h.items || []).find(it => it.field === 'status');
            if (statusItem) {
              if (issue.fields?.status) issue.fields.status.name = statusItem.fromString ?? issue.fields.status.name;
              rewound++;
              break;
            }
          }
        }
        logger.info(
          `[HistoricalBurndown] ${projectName} | ${dateOverride} | window.end=${window.end.toISOString()} | ` +
            `${sprintAllIssues.length} sprint ticket(s), ${changelogs.size} changelog(s) fetched, ` +
            `rewound ${rewound}, excluded ${notYetCreated.length} not yet created. Sprint "${burndownSprint.name}".`,
          'ReportService'
        );

        // Rewinding nothing is legitimate near the end of a sprint (little changed after
        // that date) but is the exact signature of the rewind silently not running, which
        // yields a plausible-looking burndown built from TODAY's statuses. Say so loudly
        // when the sprint ended well before the window and still nothing moved.
        const sprintEndedLongBefore =
          burndownSprint.endDate &&
          new Date(burndownSprint.endDate).getTime() - window.end.getTime() > 3 * 24 * 3600 * 1000;
        if (rewound === 0 && sprintAllIssues.length > 0 && sprintEndedLongBefore) {
          logger.warn(
            `[HistoricalBurndown] ${projectName} | ${dateOverride} | rewound NOTHING across ` +
              `${sprintAllIssues.length} ticket(s) even though sprint "${burndownSprint.name}" ran until ` +
              `${burndownSprint.endDate}. The burndown for this date is therefore built from CURRENT ` +
              `ticket statuses and is probably wrong — check that changelogs are being returned.`,
            'ReportService'
          );
        }
      }

      // Derived from sprintAllIssues AFTER the historical rewind above, so a ticket's V2
      // membership check and its status are both evaluated on the same (correctly
      // historical, for a past date) snapshot of the ticket.
      const sprintV2Issues = sprintAllIssues.filter((issue: any) => {
        const issueType = (issue.fields?.issuetype?.name || '').toLowerCase();
        if (issueType === 'sub-task' || issueType === 'subtask') return false;
        if (devUsesAssignee && isTeamMember(issue.fields?.assignee)) return true;
        return devFieldIds.some((id: string) => isTeamMember(issue.fields?.[id]));
      });

      // Build per-lane status sets for pipeline breakdown
      const burndownLaneConfig = getLaneConfig(project);
      // Mirrors the isDone check below exactly (this project's configured `done` lane
      // plus the structural done-equivalents every project shares) — driven by this
      // project's own config, not hardcoded to any one project's status names.
      // Case-insensitive de-dupe: the hardcoded default itself lists both "DONE" and
      // "Done", which would otherwise show twice in the suggestive text.
      const doneStatusLabels: string[] = (() => {
        const seen = new Set<string>();
        const out: string[] = [];
        for (const s of [...(burndownLaneConfig.done ?? []), 'Resolved', 'Pending Deployment', 'UAT']) {
          const key = s.toLowerCase();
          if (!seen.has(key)) {
            seen.add(key);
            out.push(s);
          }
        }
        return out;
      })();
      const burndownBlockedStatuses = new Set((burndownLaneConfig.blocked ?? []).map((s: string) => s.toLowerCase()));
      const burndownUatStatuses = new Set((burndownLaneConfig.uat ?? []).map((s: string) => s.toLowerCase()));
      const burndownQaStatuses = new Set((burndownLaneConfig.qa ?? []).map((s: string) => s.toLowerCase()));
      const burndownInReviewStatuses = new Set(
        (burndownLaneConfig.in_review ?? []).map((s: string) => s.toLowerCase())
      );
      const burndownInProgressStatuses = new Set(
        (burndownLaneConfig.in_progress ?? []).map((s: string) => s.toLowerCase())
      );
      const burndownReopenedStatuses = new Set((burndownLaneConfig.reopened ?? []).map((s: string) => s.toLowerCase()));

      let totalV2SP = 0;
      let completedV2SP = 0;
      let inProgressV2SP = 0;
      let totalV2Tickets = 0;
      let completedV2Tickets = 0;
      let weightedCompleted = 0; // QA tickets count as 0.6 — late-stage partial credit
      let todoSP = 0,
        inProgressSP = 0,
        inReviewSP = 0,
        inQaSP = 0,
        inUatSP = 0,
        blockedSP = 0,
        reopenedSP = 0;
      // Per-lane V2 ticket counts. Parallel to the SP accumulators so the
      // Delivery Presentation Live Status card can show "Lane | Tickets | SP"
      // with both numbers sourced from the same V2-sprint scope.
      let todoV2Tickets = 0,
        inProgressV2Tickets = 0,
        inReviewV2Tickets = 0,
        inQaV2Tickets = 0,
        inUatV2Tickets = 0,
        blockedV2Tickets = 0,
        reopenedV2Tickets = 0;

      for (const issue of sprintV2Issues) {
        totalV2Tickets++;
        const sp = Number(readEstimate(issue.fields) ?? 0);
        totalV2SP += sp;

        const status = issue.fields.status.name.toLowerCase();
        const isDone =
          reportDoneStatuses.includes(status) ||
          ['done', 'closed', 'resolved'].includes(status) ||
          status.includes('pending deployment') ||
          status.includes('uat'); // UAT = V2 team done; customer acceptance is outside V2 scope

        if (isDone) {
          completedV2SP += sp;
          completedV2Tickets++;
          weightedCompleted += 1.0;
        } else {
          inProgressV2SP += sp;
          // Classify into lane bucket (priority: blocked → uat → qa → inReview → inProgress → reopened → todo)
          if (burndownBlockedStatuses.has(status)) {
            blockedSP += sp;
            blockedV2Tickets++;
          } else if (burndownUatStatuses.has(status)) {
            inUatSP += sp;
            inUatV2Tickets++;
          } else if (burndownQaStatuses.has(status)) {
            inQaSP += sp;
            inQaV2Tickets++;
            // QA = late-stage work (dev done, waiting for test sign-off). Count as 0.6 toward completion
            // to avoid penalizing healthy pipelines with substantial QA queues.
            weightedCompleted += 0.6;
            qaTicketCount++;
            v2InProgressOrQaTickets.push({ key: issue.key, summary: issue.fields.summary, stage: 'qa' });
          } else if (burndownInReviewStatuses.has(status)) {
            inReviewSP += sp;
            inReviewV2Tickets++;
            v2InProgressOrQaTickets.push({ key: issue.key, summary: issue.fields.summary, stage: 'dev' });
          } else if (burndownInProgressStatuses.has(status)) {
            inProgressSP += sp;
            inProgressV2Tickets++;
            v2InProgressOrQaTickets.push({ key: issue.key, summary: issue.fields.summary, stage: 'dev' });
          } else if (burndownReopenedStatuses.has(status)) {
            reopenedSP += sp;
            reopenedV2Tickets++;
          } else {
            todoSP += sp; // todo or unclassified
            todoV2Tickets++;
          }
        }
      }

      // Whole-sprint (unfiltered) rollup — the team's real committed scope,
      // regardless of who's currently holding what. Iterates sprintAllIssues
      // instead of sprintV2Issues, so it is NOT gated by isTeamMember/Developer
      // field. Uses the same reference objects as the loop above, so it already
      // reflects the historical status rewind (if dateOverride) applied there —
      // but that rewind also dropped not-yet-created tickets from sprintV2Issues
      // only, so the same "not yet created as of window.end" check is repeated
      // here against the full set.
      const isOnTheGo = (project as any).sprintAssignmentModel === 'on_the_go';
      let totalSprintTickets = 0,
        completedSprintTickets = 0,
        totalSprintSP = 0,
        completedSprintSP = 0;
      for (const issue of sprintAllIssues) {
        const issueType = (issue.fields?.issuetype?.name || '').toLowerCase();
        if (issueType === 'sub-task' || issueType === 'subtask') continue;
        if (dateOverride && issue.fields?.created && new Date(issue.fields.created) > window.end) continue;

        totalSprintTickets++;
        const sp = Number(readEstimate(issue.fields) ?? 0);
        totalSprintSP += sp;

        const status = issue.fields.status.name.toLowerCase();
        const isDone =
          reportDoneStatuses.includes(status) ||
          ['done', 'closed', 'resolved'].includes(status) ||
          status.includes('pending deployment') ||
          status.includes('uat');
        if (isDone) {
          completedSprintTickets++;
          completedSprintSP += sp;
        }
      }

      // Days elapsed/remaining (weekdays only — excludes weekends)
      const countWeekdays = (from: Date, to: Date): number => {
        let count = 0;
        const cur = new Date(from);
        cur.setHours(0, 0, 0, 0);
        const end = new Date(to);
        end.setHours(0, 0, 0, 0);
        while (cur <= end) {
          const d = cur.getDay();
          if (d !== 0 && d !== 6) count++;
          cur.setDate(cur.getDate() + 1);
        }
        return count;
      };
      const sprintStart = new Date(burndownSprint.startDate);
      const sprintEnd = new Date(burndownSprint.endDate);
      // Day count is anchored to requestDate (the report's target date), not wall-clock.
      // Otherwise regenerating a past DSR computes "days elapsed" as of today, which is
      // why earlier snapshots showed the same Day N/11 regardless of their date.
      const [ry, rm, rd] = String(requestDate).split('-').map(Number);
      const today = new Date(ry, (rm || 1) - 1, rd || 1);
      const daysTotal = countWeekdays(sprintStart, sprintEnd);
      const daysElapsed = today >= sprintEnd ? daysTotal : Math.min(daysTotal, countWeekdays(sprintStart, today));
      const daysPending = Math.max(0, daysTotal - daysElapsed);
      const sprintElapsedPct = daysTotal > 0 ? Math.round((daysElapsed / daysTotal) * 100) : 0;

      // Story-count based completion (decision metric — uses weighted count for health scoring)
      // weightedCompleted: done=1.0, QA=0.6, in-progress/todo=0. Avoids penalizing late-stage pipelines.
      //
      // For 'on_the_go' projects, completion is measured against the WHOLE sprint's scope
      // (totalSprintTickets/totalSprintSP) instead of the V2-only slice — V2's own
      // self-selected denominator has no stable relationship to the team's real committed
      // scope in this working model (see sprintAssignmentModel doc on the Project model).
      const storiesPending = totalV2Tickets - completedV2Tickets;
      const completionPct = isOnTheGo
        ? totalSprintTickets > 0
          ? Math.round((completedSprintTickets / totalSprintTickets) * 100)
          : 0
        : totalV2Tickets > 0
          ? Math.round((weightedCompleted / totalV2Tickets) * 100)
          : 0;
      const completionPctSP = isOnTheGo
        ? totalSprintSP > 0
          ? Math.round((completedSprintSP / totalSprintSP) * 100)
          : 0
        : totalV2SP > 0
          ? Math.round((completedV2SP / totalV2SP) * 100)
          : 0;

      // Is there anything to measure? A sprint can be fully populated yet contain no ticket
      // whose MAIN ASSIGNEE is a V2 member (e.g. a QA-only team, whose tickets carry a V2
      // member as QA/UAT owner but are assigned to client developers — deliberately excluded
      // above). completionPct is then pinned to 0 by the divide-by-zero guard, which reads as
      // "0% done" rather than "unknown" and would otherwise score the sprint as maximally
      // behind purely because time has passed.
      const hasSprintWork = totalV2Tickets > 0;

      // Off-track %: how far behind expected pace (based on days elapsed vs stories done)
      // offTrackPct > 0 means we're behind; e.g. 71% elapsed but only 40% done → 31% off-track
      // Computed for 'on_the_go' too (informational only — never drives health, see below).
      const offTrackPct = isOnTheGo || hasSprintWork ? Math.max(0, sprintElapsedPct - completionPct) : 0;

      // Severity thresholds — only meaningful after 20% of sprint elapsed
      let onTrackStatus: 'on-track' | 'at-risk' | 'critical' | 'not-tracked';
      if (isOnTheGo) {
        // No stable per-person/per-subteam scope to judge pace against, and V2 may be a
        // minority of the team with no control over the rest of the team's pace either
        // way — genuinely neutral, not a fake "on-track". Never contributes to health
        // (sprintScore stays 0 below) and must not be narrated as a risk signal.
        onTrackStatus = 'not-tracked';
      } else if (!hasSprintWork) {
        // Nothing assigned to this team in the sprint — not evaluable, so score neutral.
        // Same treatment as the other "cannot evaluate" cases (Kanban, no active sprint,
        // sprint rollover), which all resolve to a 0 score rather than a penalty.
        onTrackStatus = 'on-track';
      } else if (sprintElapsedPct < 20) {
        onTrackStatus = 'on-track'; // too early to evaluate
      } else if (offTrackPct > 50) {
        onTrackStatus = 'critical'; // Red
      } else if (offTrackPct >= 30) {
        onTrackStatus = 'at-risk'; // Amber
      } else {
        onTrackStatus = 'on-track'; // Green
      }

      // critical → Red (+2), at-risk → Amber (+1), on-track → no impact
      sprintScore = onTrackStatus === 'critical' ? 2 : onTrackStatus === 'at-risk' ? 1 : 0;

      const usedSP = totalV2SP > 0;
      sprintBurndown = {
        sprintName: burndownSprint.name,
        startDate: burndownSprint.startDate,
        endDate: burndownSprint.endDate,
        daysTotal,
        daysElapsed,
        daysPending,
        sprintElapsedPct,
        totalV2Tickets,
        completedV2Tickets,
        storiesPending,
        completionPct,
        completionPctSP,
        offTrackPct,
        onTrackStatus,
        totalV2SP,
        completedV2SP,
        inProgressV2SP,
        usedSP,
        totalSprintSP,
        completedSprintSP,
        totalSprintTickets,
        completedSprintTickets,
        v2CurrentWorkloadSP: totalV2SP,
        v2CurrentCompletedSP: completedV2SP,
        todoSP,
        inProgressSP,
        inReviewSP,
        inQaSP,
        inUatSP,
        blockedSP,
        reopenedSP,
        todoV2Tickets,
        inProgressV2Tickets,
        inReviewV2Tickets,
        inQaV2Tickets,
        inUatV2Tickets,
        blockedV2Tickets,
        reopenedV2Tickets,
        doneStatusLabels,
      };

      logger.info(
        `[SprintBurndown] ${projectName}: "${activeSprint.name}" — ` +
          `Day ${daysElapsed}/${daysTotal} (${sprintElapsedPct}% elapsed, ${daysPending}d pending) | ` +
          `Stories ${completedV2Tickets}/${totalV2Tickets} done (${storiesPending} pending, ${completionPct}% ticket, ${completionPctSP}% SP) | ` +
          `Off-track: ${offTrackPct}% → ${onTrackStatus}` +
          (hasSprintWork
            ? ''
            : ` | NO SPRINT WORK: no ticket in this sprint has a team member as MAIN ASSIGNEE, ` +
              `so sprint progress is not evaluated (scored neutral). Note QA/UAT-owned tickets ` +
              `are intentionally excluded from the burndown.`),
        'ReportService'
      );
    } else if (sprintRolledOver) {
      logger.info(
        `[SprintRolloverBypass] ${projectName} | ${dateOverride} | Sprint burndown and AXIS 3 health scoring skipped. sprintScore=0, sprintBurndown=null.`,
        'ReportService'
      );
    }

    // --- Combine: Amber(1) + Amber(1) = Red(2), single Amber stays Amber ---
    const scoreToLabel = (s: number) => (s === 0 ? 'Green' : s === 1 ? 'Amber' : 'Red');
    const combinedScore = blockedScore + finalBugScore + sprintScore;
    const calculatedHealth = combinedScore === 0 ? 'Green' : combinedScore >= 2 ? 'Red' : 'Amber';

    const freshActiveBugsCount = prodBugs.filter((b: any) => !isOldProdBug(b) && !isReopenedSubBug(b)).length;
    const oldProdBugsCount = prodBugs.filter((b: any) => isOldProdBug(b)).length;
    const reopenedBugKeys = prodBugs.filter((b: any) => !isOldProdBug(b) && isReopenedSubBug(b)).map((b: any) => b.key);
    const spilloverBugKeys = spilloverBugs.map((b: any) => b.key);
    const blockedLabel = scoreToLabel(blockedScore);
    const blockedPart =
      blockedTickets.length === 0
        ? `green|No blockers — the team is working freely`
        : blockedLabel === 'Red'
          ? `red|${blockedTickets.length} of ${wipCount} active tickets are blocked — immediate attention needed`
          : blockedLabel === 'Amber'
            ? `amber|${blockedTickets.length} ticket${blockedTickets.length !== 1 ? 's' : ''} blocked${riskBlockedCount > 0 ? `, ${riskBlockedCount} stuck for over 3 days` : ''} — needs attention`
            : `green|${blockedTickets.length} ticket${blockedTickets.length !== 1 ? 's' : ''} blocked but the team is not at risk`;

    // spilloverBugs are already included in freshActiveBugsCount — do not add them again
    const newBugsCount = freshActiveBugsCount + reopenedBugKeys.length;
    const inRemediationBugsCount = prodBugs.filter(
      (b: any) => !isOldProdBug(b) && !isReopenedSubBug(b) && isInRemediationBug(b)
    ).length;
    const unaddressedFreshBugsCount = freshActiveBugsCount - inRemediationBugsCount;
    const bugLabel = scoreToLabel(finalBugScore);

    // Split the "unaddressed" bucket into genuinely-not-started (Backlog/To-Do) vs Blocked.
    // A bug that has been worked and is now Blocked must NOT be called "unaddressed" — only
    // the wording differs here; the health score above is unchanged.
    const unaddressedBugs = prodBugs.filter(
      (b: any) => !isOldProdBug(b) && !isReopenedSubBug(b) && !isInRemediationBug(b)
    );
    const blockedStatusSet = new Set(blockedStatuses.map((s: string) => s.toLowerCase()));
    const blockedBugsCount = unaddressedBugs.filter((b: any) =>
      blockedStatusSet.has((b.fields?.status?.name || '').toLowerCase())
    ).length;
    const notStartedBugsCount = unaddressedBugs.length - blockedBugsCount;
    const sfx = (n: number) => (n !== 1 ? 's' : '');

    // Severity-weighted rationale suffix (Phase 1): explains WHY the bug axis scored the
    // way it did, not just what was counted. Also closes the old "single Low bug is
    // completely invisible" gap — it appends even when the score itself stays Green.
    // Log-only (see the [HealthCalc] line below) — kept out of the saved/user-facing
    // healthRationale, which stays clean end-user text.
    const TIER_LABELS: Record<string, string> = { critical: 'critical', high: 'high', medium: 'medium', low: 'low' };
    const severityMix = (['critical', 'high', 'medium', 'low'] as const)
      .filter(tier => bugAxisDetail.tierBreakdown[tier] > 0)
      .map(tier => `${bugAxisDetail.tierBreakdown[tier]} ${TIER_LABELS[tier]}`)
      .join(', ');
    const severitySuffix =
      bugAxisDetail.freshCount > 0 ? ` (severity: ${severityMix}, weight ${bugAxisDetail.totalWeight.toFixed(2)})` : '';

    const bugPart =
      bugLabel === 'Red'
        ? blockedBugsCount > 0 && notStartedBugsCount > 0
          ? `red|${unaddressedBugs.length} production bugs need attention (${blockedBugsCount} blocked, ${notStartedBugsCount} not started) — immediate attention needed`
          : blockedBugsCount > 0
            ? `red|${blockedBugsCount} blocked production bug${sfx(blockedBugsCount)} — needs unblocking`
            : `red|${notStartedBugsCount} unaddressed production bug${sfx(notStartedBugsCount)} — immediate attention needed`
        : bugLabel === 'Amber' && unaddressedFreshBugsCount > 0
          ? blockedBugsCount > 0 && notStartedBugsCount > 0
            ? `amber|${unaddressedBugs.length} production bugs need attention (${blockedBugsCount} blocked, ${notStartedBugsCount} not started)`
            : blockedBugsCount > 0
              ? `amber|${blockedBugsCount} blocked production bug${sfx(blockedBugsCount)} — needs unblocking`
              : `amber|${notStartedBugsCount} new production bug${sfx(notStartedBugsCount)} not yet in progress — needs attention`
          : bugLabel === 'Amber'
            ? `amber|${inRemediationBugsCount} production bug${inRemediationBugsCount !== 1 ? 's' : ''} in testing/review — being actively addressed`
            : newBugsCount === 0
              ? oldProdBugsCount > 0
                ? `green|${oldProdBugsCount} known bug${oldProdBugsCount !== 1 ? 's' : ''} in progress — nothing unexpected`
                : `green|No production bugs`
              : `green|Production bugs are under control`;

    const sprintPart = sprintBurndown
      ? // 'not-tracked' (on-the-go assignment model): state team-wide progress as a plain
        // fact, never as a risk/pace verdict — sprint pace is deliberately excluded from
        // health scoring for this project.
        sprintBurndown.onTrackStatus === 'not-tracked'
        ? `green|Sprint is ${sprintBurndown.completionPct}% complete team-wide (Day ${sprintBurndown.daysElapsed} of ${sprintBurndown.daysTotal}) — pace not scored for this team's working model`
        : // No ticket in the sprint is assigned to this team — report that plainly rather than
          // claiming the sprint is "on track", which would read as a healthy sprint.
          sprintBurndown.totalV2Tickets === 0
          ? `green|No sprint stories assigned to this team — sprint progress not evaluated`
          : sprintBurndown.onTrackStatus === 'critical'
            ? `red|Sprint is critically behind — only ${sprintBurndown.completedV2Tickets} of ${sprintBurndown.totalV2Tickets} stories done with ${sprintBurndown.daysPending} working day${sprintBurndown.daysPending !== 1 ? 's' : ''} left`
            : sprintBurndown.onTrackStatus === 'at-risk'
              ? `amber|Sprint is slightly behind — ${sprintBurndown.completedV2Tickets} of ${sprintBurndown.totalV2Tickets} stories done, ${sprintBurndown.daysPending} working day${sprintBurndown.daysPending !== 1 ? 's' : ''} remaining`
              : `green|Sprint is on track — ${sprintBurndown.completedV2Tickets} of ${sprintBurndown.totalV2Tickets} stories done, ${sprintBurndown.daysPending} working day${sprintBurndown.daysPending !== 1 ? 's' : ''} to go`
      : isKanban
        ? `green|This is a Kanban project — no sprint timeline`
        : `green|No active sprint found`;

    const healthRationale = `${blockedPart}` + ` | ${bugPart}` + ` | ${sprintPart}`;

    logger.info(`[HealthCalc] ${projectName}: ${healthRationale}${severitySuffix} → FINAL: ${calculatedHealth}`, 'ReportService');
    logger.info(
      `[BugScope] ${projectName}: prodBugs=${prodBugs.length} newlyAddedToSprint=${newlyAddedProdBugs.length}`,
      'ReportService'
    );

    // 8. AI Analysis (respects pre-calculated health)
    const recentTransitions = this.identifyRecentTransitions(teamIssues);
    const weekendActivity = weekendActivityTickets.length > 0 ? weekendActivityTickets : undefined;

    const laneDefinitions = formatLaneDefinitionsForPrompt(laneConfig);
    // Confirmed prod bug keys = fresh bugs (not old/planned, not re-opened sub-bugs).
    // Re-opened and spillover bugs are handled separately via their own AI prompt sections.
    const confirmedProdBugKeys = prodBugs
      .filter((b: any) => !isOldProdBug(b) && !isReopenedSubBug(b))
      .map((b: any) => b.key);

    // Per-ticket attribution: which V2 team member(s) put each ticket in scope.
    // `matchedTeamMembers` is attached per-issue at the team-filter step (~line 430).
    // Persisted so a manager can answer "why is this ticket in my DSR?" after the
    // Jira assignee may have changed since the snapshot was taken.
    const teamMemberAttribution: Record<string, string[]> = {};
    for (const i of teamIssues) {
      if (i.matchedTeamMembers?.length) teamMemberAttribution[i.key] = i.matchedTeamMembers;
    }

    // Build explicit non-prod-bug context: Bug/Sub-bug tickets that did NOT qualify as prod bugs.
    // Exclude re-opened sub-bugs and spillover bugs — they ARE prod bugs, just handled separately.
    // Passed to AI so it has per-ticket "do not call these production bugs" context.
    const nonQualifiedBugContext = teamIssues
      .filter((i: any) => {
        const issueName = i.fields?.issuetype?.name || '';
        if (!PROD_BUG_TYPES.includes(issueName)) return false;
        return (
          !confirmedProdBugKeys.includes(i.key) && !reopenedBugKeys.includes(i.key) && !spilloverBugKeys.includes(i.key)
        );
      })
      .map((i: any) => {
        const envField = i.fields?.[targetEnvFieldId];
        let env = 'Unknown';
        if (Array.isArray(envField)) env = envField.map((v: any) => v.value).join('/') || 'Unknown';
        else if (envField?.value) env = envField.value;
        return { key: i.key, issuetype: i.fields?.issuetype?.name || 'Bug', env };
      });

    const analysis = await aiService.analyzeBoard(
      `${projectName} (Board: ${boardName})`,
      activeTickets,
      queuedWorkTickets,
      blockedTickets,
      previousSnapshot,
      staleTickets,
      recentTransitions,
      weekendActivity,
      laneDefinitions,
      calculatedHealth,
      healthRationale,
      snapshot?.managerInsights || undefined,
      confirmedProdBugKeys,
      sprintBurndown,
      nonQualifiedBugContext,
      reopenedBugKeys,
      spilloverBugKeys
    );

    // On-the-go Executive Summary fallback: when there is no genuine same-day activity
    // (no active tickets, nothing lined up), replace the AI's plain "no activity" text
    // with a deterministic list of this team's tickets currently in progress or QA — not
    // AI-phrased, since prompt-only instructions have twice this session not reliably held
    // (see scrubBlockedTicketHallucinations / scrubSprintNumbersFromExecutiveSummary). If
    // this team has nothing in progress at all either, leave the AI's "no activity" text
    // as-is — there's genuinely nothing else to say.
    if (
      sprintBurndown?.onTrackStatus === 'not-tracked' &&
      activeTickets.length === 0 &&
      queuedWorkTickets.length === 0 &&
      v2InProgressOrQaTickets.length > 0
    ) {
      const lines = v2InProgressOrQaTickets.map(
        t => `- ${t.key}: ${t.summary} (${t.stage === 'qa' ? 'QA in progress' : 'in progress'})`
      );
      analysis.executiveSummary =
        `No Jira movement today. This team's current work:\n${lines.join('\n')}\n\n` +
        `*No Jira movement recorded on these tickets today — shown as still in progress as of this report.`;
    }

    // 7.5 [HealthGuard] Enforce deterministic health — AI cannot override calculated value.
    // Log discrepancy for observability but always use calculatedHealth.
    if (analysis.health && analysis.health !== calculatedHealth) {
      logger.warn(
        `[HealthGuard] AI tried to set health=${analysis.health} but calculatedHealth=${calculatedHealth}. ` +
          `Deterministic value enforced. Board: ${boardName}`,
        'ReportService'
      );
    }

    // 7.5 Validate AI output for temporal accuracy
    const { temporalValidator } = require('../../../common/utils');
    const validation = temporalValidator.validateTemporalClaims(JSON.stringify(analysis), `Daily-${projectName}`);

    if (!validation.isValid || validation.suspiciousClaims.length > 0) {
      logger.warn(
        `Temporal validation warnings for ${projectName} daily report: ${temporalValidator.generateValidationReport(validation)}`,
        'ReportService'
      );
    }

    // 8. Prepare Snapshot
    const statusCounts = this.countByStatus(teamIssues);
    const ticketKeys = this.extractTicketKeys(teamIssues);
    const consideredJiraIds = teamIssues.map((i: any) => i.key);

    // Two informational counts that ride along on the snapshot — used by
    // the DSR display ("X sub-bugs · Y tkts in reopened lane") and by the
    // Delivery Presentation Live Status section. NOT used in RAG.
    const subBugsLoggedCount = teamIssues.filter((i: any) =>
      isSubBugIssueType(i?.fields?.issuetype?.name ?? '')
    ).length;
    const reopenedLaneStatuses = new Set((getLaneConfig(project).reopened ?? []).map((s: string) => s.toLowerCase()));
    const reopenedTicketsCount = Object.entries(statusCounts)
      .filter(([status]) => reopenedLaneStatuses.has(status.toLowerCase()))
      .reduce((sum, [, n]) => sum + (Number(n) || 0), 0);

    // Ensure dateStr is available
    const dateStr = this.formatDate(new Date(requestDate));

    // Format window for response/storage
    const reportWindow = {
      start: window.start.toLocaleString('en-IN', { timeZone: 'Asia/Kolkata' }),
      end: window.end.toLocaleString('en-IN', { timeZone: 'Asia/Kolkata' }),
    };

    const newSnapshot: any = {
      date: dateStr,
      // For Excel-typed projects there's no Jira board, fall back to project.id
      // as a stable non-null placeholder. boardId is mainly used for display fallback.
      boardId: project.jiraBoardId ?? project.id,
      boardName: boardName,
      projectId: project.id,
      project_id: project.id, // Explicitly add snake_case for safety
      projectName: project.name, // Add project name
      accountId: project.accountId,
      account_id: project.accountId, // Explicitly add snake_case
      totalTickets: teamIssues.length,
      statusCounts: statusCounts,
      subBugsLoggedCount,
      reopenedTicketsCount,
      blockedTickets: blockedTickets,
      workSummary: analysis.workSummary || '',
      overallHealth: calculatedHealth, // Always deterministic — AI cannot override
      ticketKeys: ticketKeys,
      executiveSummary: analysis.executiveSummary || '',
      executiveRisks: analysis.keyRisks || '',
      executivePlan: analysis.executivePlan || '',
      // Persist the activity window itself so getReportDateRange can reuse it verbatim
      // on every future regeneration instead of re-deriving it from `updatedAt` (see
      // DailyBoardSnapshot.windowStart/windowEnd doc comment). Idempotent: once a row
      // has these set, getReportDateRange returns them unchanged, so `window` here
      // already equals the persisted values on every regeneration after the first.
      windowStart: window.start,
      windowEnd: window.end,
      consideredJiraIds: consideredJiraIds,
      teamMembers: [...new Set(detailsTickets.flatMap((i: any) => i.matchedTeamMembers || []))],
      // A historical run now scores against the sprint that was actually running on the
      // target date, so a rolled-over board is no longer reason enough to bypass. The
      // marker is written only when no sprint covered that date at all — a genuine gap.
      sprintBurndown:
        sprintRolledOver && !burndownSprint
          ? {
              bypassed: true,
              targetDate: dateOverride,
              activeSprintName: activeSprint?.name,
              activeSprintStartDate: activeSprint?.startDate,
            }
          : (sprintBurndown ?? null),
      confirmedProdBugKeys: confirmedProdBugKeys.length > 0 ? confirmedProdBugKeys : null,
      teamMemberAttribution: Object.keys(teamMemberAttribution).length > 0 ? teamMemberAttribution : null,
      dataQualityFlags: (() => {
        const flags: {
          healthOverridden?: boolean;
          aiHealth?: string;
          prodBugsScrubbed?: number;
          newlyBlockedInBacklog?: Array<{ key: string; summary: string; timestamp: string }>;
          newlyAddedProdBugs?: Array<{ key: string; summary: string; timestamp: string }>;
        } = {};
        if (analysis.health && analysis.health !== calculatedHealth) {
          flags.healthOverridden = true;
          flags.aiHealth = analysis.health;
        }
        if (analysis._scrubCount && analysis._scrubCount > 0) {
          flags.prodBugsScrubbed = analysis._scrubCount;
        }
        if (newlyBlockedInBacklog.length > 0) {
          flags.newlyBlockedInBacklog = newlyBlockedInBacklog;
        }
        if (newlyAddedProdBugs.length > 0) {
          flags.newlyAddedProdBugs = newlyAddedProdBugs;
        }
        return Object.keys(flags).length > 0 ? flags : null;
      })(),
      healthRationale: healthRationale || null,
      ticketDetails: analysis.ticketDetails || null,
      ticketDetailsStructured: this.extractTicketDetailsStructured(teamIssues, analysis.ticketDetails),
    };

    // Preserve manager-entered fields so regeneration does not wipe them
    if (snapshot) {
      if (snapshot.managerInsights) newSnapshot.managerInsights = snapshot.managerInsights;
      if (snapshot.insightsHealth) newSnapshot.insightsHealth = snapshot.insightsHealth;
      if (snapshot.insightsHealthReason) newSnapshot.insightsHealthReason = snapshot.insightsHealthReason;
      if (snapshot.originalExecutiveSummary) newSnapshot.originalExecutiveSummary = snapshot.originalExecutiveSummary;
    }

    // Digest only. This previously dumped the entire snapshot — including raw Jira
    // comment bodies and team member names — into the log file on every save.
    logger.debug(
      `Saving snapshot date=${newSnapshot.date} project=${newSnapshot.projectId} ` +
        `tickets=${newSnapshot.ticketKeys?.length ?? 0} blocked=${newSnapshot.blockedTickets?.length ?? 0} ` +
        `health=${newSnapshot.overallHealth}`,
      'ReportService'
    );

    // 9. Save
    await this.saveSnapshot(newSnapshot);

    return {
      boardName,
      projectName,
      data: {
        workSummary: analysis.workSummary,
        planForTomorrow: analysis.planForTomorrow,
        risks: analysis.risks,
        notes: analysis.notes,
        health: analysis.health,
        executiveSummary: analysis.executiveSummary,
        keyRisks: analysis.keyRisks,
        executivePlan: analysis.executivePlan,
        reportWindow: reportWindow,
        sprintBurndown: sprintBurndown ?? null,
      },
    };
  }

  async processSprint(sprintName: string, projectName: string | null = null): Promise<any> {
    const today = new Date();
    const dateStr = this.formatDate(today);

    logger.info(`Processing Sprint: ${sprintName} (${projectName || 'No Project'})`, 'ReportService');

    const { boardName, issues } = await jiraService.getIssuesBySprintName(sprintName);
    logger.debug(`Fetched ${issues.length} issues from ${boardName}`, 'ReportService');

    if (issues.length === 0) {
      logger.warn(`No issues found for sprint ${sprintName}. Skipping.`, 'ReportService');
      return null;
    }

    const boardId = this.hashSprintName(sprintName);
    const previousSnapshot = await this.getLatestSnapshot(boardName);
    const blockedTickets = jiraService.extractBlockedInfo(issues);
    const staleTickets = this.identifyStaleTickets(issues);
    // Note: Sprint processing might need update to support new AI signature if called, but keeping fallback to identifyMovedToDone equivalent
    // Actually, identifyMovedToDone was replaced by identifyRecentTransitions.
    // 6. Identify Daily Activity (Strict Filtering)
    // For Sprints, we usually process for "today"
    const targetDate = new Date();
    const targetDateStr = this.formatDate(targetDate);
    // For sprints, we might not have a clean "previous snapshot" mapped by boardId if it's dynamic
    // But we can try passing the hashed boardId if relevant, or just rely on default.
    // processSprint generates a hashed boardId at line 278.
    const window = await this.getReportDateRange(targetDateStr, boardId);
    // Fallback team member check for sprints (liberal)
    const isMember = () => true;
    const {
      teamActiveTickets: activeTickets,
      queuedWorkTickets,
      weekendActivityTickets,
    } = this.identifyDailyActivity(issues, window, isMember);

    const recentTransitions = this.identifyRecentTransitions(issues);

    const analysis = await aiService.analyzeBoard(
      boardName,
      activeTickets, // Summaries focused on direct team work
      queuedWorkTickets,
      blockedTickets,
      previousSnapshot,
      staleTickets,
      recentTransitions
    );

    const statusCounts = this.countByStatus(issues);
    const ticketKeys = this.extractTicketKeys(issues);

    const snapshot = {
      date: targetDateStr,
      boardId: boardId,
      boardName: boardName,
      totalTickets: issues.length,
      statusCounts: statusCounts,
      blockedTickets: blockedTickets,
      workSummary: analysis.workSummary || '',
      overallHealth: analysis.health || 'Unknown',
      ticketKeys: ticketKeys,
      projectName: projectName,
      executiveSummary: analysis.executiveSummary || '',
      executiveRisks: analysis.keyRisks || '',
      executivePlan: analysis.executivePlan || '',
    };

    await this.saveSnapshot(snapshot);

    return {
      boardName,
      data: {
        workSummary: analysis.workSummary,
        planForTomorrow: analysis.planForTomorrow,
        risks: analysis.risks,
        notes: analysis.notes,
        health: analysis.health,
        executiveSummary: analysis.executiveSummary,
        keyRisks: analysis.keyRisks,
        executivePlan: analysis.executivePlan,
      },
    };
  }

  async generateReports(boardReports: any[], projectName: string | null = null): Promise<void> {
    // Files are no longer generated on the file system.
    // Logic removed as per new requirements.
    return;
  }

  private async getLatestSnapshot(boardName: string): Promise<any | null> {
    const snapshot = await DailyBoardSnapshot.findOne({
      where: { boardName },
      order: [['date', 'DESC']],
    });

    return snapshot ? snapshot.toJSON() : null;
  }

  private async saveSnapshot(data: any): Promise<void> {
    const payload = {
      ...data,
      updatedAt: new Date(),
    };
    // Conflict key is the STABLE project identity (date, project_id), not
    // (date, board_id) -- board_id is Project.jiraBoardId, which changes
    // when a project moves to a new Jira board (e.g. a Scrum -> Kanban
    // migration). Keying on it meant a post-switch regeneration for an
    // already-snapshotted date couldn't match the old row (different
    // board_id) and silently inserted a duplicate instead of overwriting
    // it. See migration 20260921000001 for the matching DB index fix and
    // one-time cleanup of duplicates this already created.
    await DailyBoardSnapshot.upsert(payload, {
      conflictFields: ['date', 'project_id'],
    });
    logger.info(`Snapshot saved for ${data.boardName} on ${data.date}`, 'ReportService');
  }

  private countByStatus(issues: any[]): Record<string, number> {
    const counts: Record<string, number> = {};
    issues.forEach(issue => {
      const status = issue.fields.status.name;
      counts[status] = (counts[status] || 0) + 1;
    });
    return counts;
  }

  // Given a ticket and the end of a historical report window, returns the status it held at
  // that moment — the earliest changelog status change strictly after windowEnd tells us what
  // the status was immediately before that change, i.e. as of windowEnd. Falls back to the
  // issue's current status if no such change exists (nothing to rewind).
  private statusAsOfWindowEnd(issue: any, windowEnd: Date): string {
    const histories = issue.changelog?.histories || [];
    const after = histories
      .filter((h: any) => new Date(h.created) > windowEnd)
      .sort((a: any, b: any) => new Date(a.created).getTime() - new Date(b.created).getTime());
    for (const h of after) {
      const statusItem = (h.items || []).find((it: any) => it.field === 'status');
      if (statusItem) {
        return statusItem.fromString ?? issue.fields?.status?.name;
      }
    }
    return issue.fields?.status?.name;
  }

  private extractTicketKeys(issues: any[]): Record<string, string> {
    const keys: Record<string, string> = {};
    issues.forEach(issue => {
      keys[issue.key] = issue.fields.status.name;
    });
    return keys;
  }

  // Ticket-details chips must not depend on the AI reproducing an exact `[Type]` format —
  // that free-text contract silently breaks for any issue type outside a hardcoded frontend
  // allowlist (e.g. "Spike"). The ticket key is the one part of the AI's line that is already
  // reliable (same assumption extractTicketKeys makes), so only the key is trusted from the
  // AI's text; issue type and status are always pulled straight from Jira data.
  private extractTicketDetailsStructured(
    issues: any[],
    ticketDetailsText?: string | null
  ): Array<{ key: string; issueType: string; status: string; description: string }> | null {
    if (!ticketDetailsText) return null;

    const issueByKey = new Map<string, any>();
    issues.forEach((issue: any) => issueByKey.set(issue.key, issue));

    const keyLineRegex = /^[\s*\-•]*([A-Z]+-\d+)\s*:?\s*(?:\[[^\]]*\]\s*)?[-–]?\s*(.*)$/;
    const lines = ticketDetailsText
      .split('\n')
      .map(l => l.trim())
      .filter(Boolean);

    const result: Array<{ key: string; issueType: string; status: string; description: string }> = [];
    for (const line of lines) {
      const match = line.match(keyLineRegex);
      if (!match) continue;
      const key = match[1];
      const issue = issueByKey.get(key);
      // A key the AI mentioned that isn't one of this report's considered tickets is not
      // trusted — never fabricate issueType/status for a ticket we can't verify.
      if (!issue) continue;
      result.push({
        key,
        issueType: issue.fields?.issuetype?.name ?? '',
        status: issue.fields?.status?.name ?? '',
        description: (match[2] || '').trim(),
      });
    }
    return result.length > 0 ? result : null;
  }

  private identifyStaleTickets(issues: any[]): any[] {
    const threeDaysAgo = new Date();
    threeDaysAgo.setDate(threeDaysAgo.getDate() - 3);

    return issues.filter(issue => {
      const status = issue.fields.status.name.toLowerCase();
      const updated = new Date(issue.fields.updated);

      if (!status.includes('in progress')) {
        return false;
      }

      // If updated recently via Jira standard fields, it's not stale
      if (updated >= threeDaysAgo) {
        return false;
      }

      // New Check: If updated recently via active development (GitHub/PR) which isn't reflected in 'updated'
      // We need to check if we can find any recent dev activity date.
      // This is computationally more expensive but necessary to avoid false positives.
      const devDateStr = this.scanForDevStatus(issue);
      if (devDateStr) {
        const devDate = new Date(devDateStr);
        if (devDate >= threeDaysAgo) {
          // It has recent dev activity, so do NOT mark as stale.
          return false;
        }
      }

      return true;
    });
  }

  /** IST calendar date (YYYY-MM-DD) of an arbitrary UTC instant — same shift `getISTDate()` uses for "now". */
  private toISTDateStr(d: Date): string {
    const utc = d.getTime() + d.getTimezoneOffset() * 60000;
    return new Date(utc + 330 * 60000).toISOString().split('T')[0];
  }

  private async getReportDateRange(dateStr: string, boardId?: number): Promise<{ start: Date; end: Date }> {
    // dateStr is YYYY-MM-DD (Target Report Date)
    const targetDate = new Date(dateStr);
    const todayStr = this.getCurrentDateIST();
    const isToday = dateStr === todayStr;

    let windowEnd: Date;

    if (isToday) {
      // If report is for TODAY, end time is NOW (Absolute Time).
      // Sequelize with timezone: '+00:00' will handle the saving as UTC.
      windowEnd = new Date();
      logger.info(
        `Generating report for TODAY (${dateStr}). Window End set to NOW: ${windowEnd.toISOString()}`,
        'ReportService'
      );
    } else {
      // If report is for PAST date
      // Check if we have an existing snapshot to respect its original timing
      if (boardId) {
        const existingSnapshot = await DailyBoardSnapshot.findOne({
          where: {
            boardId: boardId,
            date: dateStr,
          },
        });

        // Persisted window wins outright — set once on first generation, never
        // overwritten by a later regeneration (see DailyBoardSnapshot.windowStart/
        // windowEnd doc comment). This is the fix for a real, confirmed corruption:
        // re-deriving "was this the original generation" from the mutable `updatedAt`
        // on every call let a later same-day resync's timestamp masquerade as another
        // date's "original" window, collapsing the effective window and silently
        // dropping real historical activity (e.g. a status change, a linked commit).
        if (existingSnapshot?.windowStart && existingSnapshot?.windowEnd) {
          const start = new Date(existingSnapshot.windowStart);
          const end = new Date(existingSnapshot.windowEnd);
          logger.info(
            `Found persisted window for ${dateStr}: [${start.toISOString()}, ${end.toISOString()}] — reusing verbatim, never re-derived.`,
            'ReportService'
          );
          return { start, end };
        }

        // No persisted window yet (row predates this column, or this is a genuinely
        // new generation) — fall back to the heuristic below ONE time; whatever it
        // computes gets persisted by the caller and is then immune to this heuristic
        // on every subsequent regeneration.
        const configuredWindowEnd = new Date(targetDate);
        configuredWindowEnd.setUTCHours(
          config.reports.windowStartHour - 5,
          config.reports.windowStartMinute - 30,
          0,
          0
        );
        // `createdAt` — NOT `updatedAt` — is the reliable signal here. saveSnapshot's
        // upsert payload never includes createdAt, so Postgres sets it once on the
        // row's first INSERT and every later regeneration (an UPDATE on conflict)
        // leaves it untouched — confirmed empirically: rows generated by the 8PM IST
        // cron carry createdAt stamped at exactly that cutoff, unmoved by any number
        // of subsequent resyncs. `updatedAt`, by contrast, IS the regeneration time on
        // every resync, which is what let a later same-day resync's timestamp
        // masquerade as another date's "original" window (the bug this whole block
        // exists to fix). IST calendar-date comparison (same day, or the next day to
        // cover a scheduler run slipping past midnight) rather than a blind ms delta,
        // so a resync run on any later calendar day can never pass this.
        const storedOriginal = existingSnapshot?.createdAt ? new Date(existingSnapshot.createdAt) : null;
        const storedLooksOriginal =
          storedOriginal &&
          (() => {
            const storedDateStr = this.toISTDateStr(storedOriginal);
            const nextDay = new Date(targetDate);
            nextDay.setDate(nextDay.getDate() + 1);
            const nextDayStr = this.formatDate(nextDay);
            return storedDateStr === dateStr || storedDateStr === nextDayStr;
          })();

        if (storedOriginal && storedLooksOriginal) {
          // Use the original generation time
          windowEnd = storedOriginal;
          logger.info(
            `Found existing snapshot for ${dateStr}. Using its createdAt as Window End: ${windowEnd.toISOString()}`,
            'ReportService'
          );
        } else if (storedOriginal) {
          windowEnd = configuredWindowEnd;
          logger.info(
            `Existing snapshot for ${dateStr} was first created at ${storedOriginal.toISOString()}, which is well after that day; ` +
              `using the configured IST window start instead so regeneration stays deterministic: ${windowEnd.toISOString()}`,
            'ReportService'
          );
        } else {
          // No snapshot (new generation for past date) -> Use configured IST window start
          windowEnd = new Date(targetDate);
          // `new Date("YYYY-MM-DD")` is UTC 00:00. Convert configured IST → UTC (IST = UTC + 5:30).
          windowEnd.setUTCHours(config.reports.windowStartHour - 5, config.reports.windowStartMinute - 30, 0, 0);
          logger.info(
            `Generating new report for PAST (${dateStr}). Window End set to configured IST window start: ${windowEnd.toISOString()}`,
            'ReportService'
          );
        }
      } else {
        // Fallback if no boardId — configured IST window start
        windowEnd = new Date(targetDate);
        windowEnd.setUTCHours(config.reports.windowStartHour - 5, config.reports.windowStartMinute - 30, 0, 0);
      }
    }

    // Default Start: End Time - 24 Hours
    const defaultStartDate = new Date(windowEnd);
    defaultStartDate.setDate(defaultStartDate.getDate() - 1);

    // Ensure start doesn't overlap with previous day's report
    if (!boardId) {
      return { start: defaultStartDate, end: windowEnd };
    }

    // Check for Previous Day's Snapshot
    const previousDay = new Date(targetDate);
    previousDay.setDate(previousDay.getDate() - 1);
    const previousDayStr = this.formatDate(previousDay);

    try {
      const previousSnapshot = await DailyBoardSnapshot.findOne({
        where: {
          boardId: boardId,
          date: previousDayStr,
        },
      });

      // Prefer the previous day's own PERSISTED window end (immutable, correct) over
      // its `updatedAt` (mutable — a resync of the previous day, at any later point,
      // would otherwise leak into today's start boundary). Falls back to `updatedAt`
      // only for a previous-day row that predates the windowStart/windowEnd columns.
      const previousBoundary = previousSnapshot?.windowEnd ?? previousSnapshot?.updatedAt ?? null;

      if (previousSnapshot && previousBoundary) {
        logger.info(
          `Found previous report for ${previousDayStr}. Boundary: ${new Date(previousBoundary).toISOString()}`,
          'ReportService'
        );

        // Logic check: If previous report was generated AFTER the current target window (e.g. backfilling),
        // or VERY RECENTLY (e.g. within 6 hours of window end), it might not represent a full day's gap.
        // Using its boundary as 'start' would create a negative or extremely short range.
        // In that case, we MUST fallback to the default start time (WindowEnd - 24h).
        const sixHoursInMs = 6 * 60 * 60 * 1000;
        const previousBoundaryDate = new Date(previousBoundary);
        if (previousBoundaryDate >= windowEnd || windowEnd.getTime() - previousBoundaryDate.getTime() < sixHoursInMs) {
          logger.warn(
            `Previous snapshot boundary (${previousBoundaryDate.toISOString()}) too close to or after current window end (${windowEnd.toISOString()}). Using default start time.`,
            'ReportService'
          );
          return { start: defaultStartDate, end: windowEnd };
        }

        return { start: previousBoundaryDate, end: windowEnd };
      } else {
        logger.info(
          `No previous report found for ${previousDayStr}. Checking for ANY previous snapshot to handle weekends...`,
          'ReportService'
        );
        // Fallback: Check for LATEST snapshot before target date (Handles Weekend Gap)
        const latestSnapshot = await DailyBoardSnapshot.findOne({
          where: {
            boardId: boardId,
            date: { [Op.lt]: dateStr }, // Find any report BEFORE target date
          },
          order: [['date', 'DESC']],
        });

        const latestBoundary = latestSnapshot?.windowEnd ?? latestSnapshot?.updatedAt ?? null;
        if (latestSnapshot && latestBoundary) {
          const latestBoundaryDate = new Date(latestBoundary);
          logger.info(
            `Found LATEST previous report for ${latestSnapshot.date}. Boundary: ${latestBoundaryDate.toISOString()}`,
            'ReportService'
          );
          if (latestBoundaryDate > windowEnd) {
            logger.warn(
              `Latest snapshot boundary (${latestBoundaryDate.toISOString()}) after current window end. Using default start.`,
              'ReportService'
            );
            return { start: defaultStartDate, end: windowEnd };
          }
          return { start: latestBoundaryDate, end: windowEnd };
        }

        logger.info(
          `No previous report found at all. Using default window start: ${defaultStartDate.toISOString()}`,
          'ReportService'
        );
      }
    } catch (error) {
      logger.warn(
        `Error checking previous snapshot for window calculation. Using default. Error: ${error}`,
        'ReportService'
      );
    }

    return { start: defaultStartDate, end: windowEnd };
  }

  private isDateInWindow(date: Date, window: { start: Date; end: Date }): boolean {
    // Verify if date (in local/IST or UTC? Jira returns UTC usually)
    // The window dates are constructed assuming the input `dateStr` was "Local Client Date".
    // HOWEVER, `getReportDateRange` constructs dates using system local time if we just new Date(dateStr).
    // Since we are running on a server (likely UTC) but responding to IST requests:
    // We need to be careful. The previous logic used `getCurrentDateIST`.
    // `getReportDateRange` should probably work with IST offsets to be safe if the server is UTC.
    // Actually, let's look at `getCurrentDateIST`. It returns a string.

    // Refined Logic (IST Aware):
    // 1. We have a target date string (e.g. "2025-02-11") which implies "Report for Feb 11th (IST)".
    // 2. We want range: Feb 10, 18:30 IST to Feb 11, 18:30 IST.
    // 3. To compare with Jira UTC dates, we should convert our Window limits to UTC or convert Jira dates to IST.
    // Previous logic successfully used IST string comparison.
    // Let's stick to converting Jira dates to IST Date objects and comparing against IST Window.

    // BUT, `new Date("2025-02-11")` in Node (UTC env) is 2025-02-11 00:00 UTC.
    // If we want 18:30 IST, that is 13:00 UTC.
    // CONST: IST Offset = +5.5 hours.

    // Let's build the window in "IST Time" conceptually, and when checking a Jira date:
    // Convert Jira Date (UTC) -> Jira Date (IST)
    // Compare Jira Date (IST) against Window Start (IST) and Window End (IST).

    return date >= window.start && date <= window.end;
  }

  private identifyDailyActivity(
    issues: any[],
    window: { start: Date; end: Date },
    isTeamMember: (userObj: any) => boolean,
    devStatusList?: string[],
    devFieldId?: string,
    doneStatuses: string[] = [],
    // For the dev-status credit check below — MUST match how V2 ownership is determined
    // everywhere else (sprintV2Issues membership), not the raw built-in `assignee`. Some
    // boards (Thrive) pass `assignee` as a Dev -> QA -> Dev work-queue pointer rather than
    // ownership, so crediting off `assignee` directly can silently miss or misattribute a
    // real developer's continued PR/build activity once a ticket is hand to QA.
    devFieldIds: string[] = [],
    devUsesAssignee: boolean = true
  ): { teamActiveTickets: any[]; queuedWorkTickets: any[]; contextTickets: any[]; weekendActivityTickets: any[] } {
    const teamActiveTickets: any[] = [];
    const queuedWorkTickets: any[] = [];
    const contextTickets: any[] = [];
    const weekendActivityTickets: any[] = [];

    logger.debug(
      `Identifying Activity for Window (UTC): ${window.start.toISOString()} to ${window.end.toISOString()}`,
      'ReportService'
    );

    issues.forEach(issue => {
      const activities: string[] = [];
      const weekendActivities: string[] = [];
      let isTeamActive = false;
      let isLinedUp = false;
      let hasWeekendActivity = false;

      // Helper to check for weekend (IST Based)
      const checkWeekend = (date: Date, activityDesc: string) => {
        const istDate = new Date(date.getTime() + 5.5 * 60 * 60 * 1000);
        const day = istDate.getUTCDay();

        if (day === 0 || day === 6) {
          hasWeekendActivity = true;
          const istString = istDate.toLocaleString('en-IN', {
            timeZone: 'Asia/Kolkata',
            weekday: 'short',
            month: 'short',
            day: 'numeric',
          });
          weekendActivities.push(`${activityDesc} on ${istString}`);
        }
      };

      // 1. Check Changelog (Status, Attachments, Link, Dev fields)
      const changelog = issue.changelog || { histories: [] };
      changelog.histories.forEach((history: any) => {
        const historyDateUTC = new Date(history.created);

        if (this.isDateInWindow(historyDateUTC, window)) {
          const isAuthorTeam = isTeamMember(history.author);

          history.items.forEach((item: any) => {
            // Work Lined Up Logic: Moved to QA/UAT
            if (item.field === 'status') {
              const newStatus = (item.toString || '').toLowerCase();
              if (newStatus.includes('qa') || newStatus.includes('uat') || newStatus.includes('testing')) {
                isLinedUp = true;
              }
              if (isAuthorTeam) {
                const fromStatus = (item.fromString || '').toLowerCase();
                const isFromHandover = fromStatus.includes('pending deployment') || fromStatus.includes('released');
                const isToDone = doneStatuses.includes(newStatus) || ['closed', 'resolved', 'done'].includes(newStatus);

                if (isFromHandover && isToDone) {
                  logger.debug(
                    `[HandoverFilter] Skipping activity for ${issue.key} because it moved from ${item.fromString} to ${item.toString} (Out of team scope).`,
                    'ReportService'
                  );
                } else {
                  isTeamActive = true;
                  const desc = `Moved to ${item.toString}`;
                  activities.push(desc);
                  checkWeekend(historyDateUTC, desc);
                }
              }
            } else if (item.field === 'Attachment') {
              if (isAuthorTeam) {
                isTeamActive = true;
                const desc = 'Attachment added';
                activities.push(desc);
                checkWeekend(historyDateUTC, desc);
              }
            } else if (
              item.field.toLowerCase().includes('deployment') ||
              item.field.toLowerCase().includes('branch') ||
              item.field.startsWith('customfield_')
            ) {
              if (isAuthorTeam) {
                isTeamActive = true;
                const desc = `Updated ${item.field}`;
                activities.push(desc);
                checkWeekend(historyDateUTC, desc);
              }
            }

            // Work Lined Up Logic: Assigned to Team Member in QA/UAT
            if (
              ['assignee', 'QA Assignee', 'UAT Assignee', 'customfield_10204', 'customfield_10441'].includes(item.field)
            ) {
              if (isTeamMember({ accountId: item.to, displayName: item.toString })) {
                const currentStatus = (issue.fields.status.name || '').toLowerCase();
                if (
                  currentStatus.includes('qa') ||
                  currentStatus.includes('uat') ||
                  currentStatus.includes('testing')
                ) {
                  isLinedUp = true;
                }
              }
            }
          });
        }
      });

      // 2. Check Comments
      if (issue.fields.comment && issue.fields.comment.comments) {
        issue.fields.comment.comments.forEach((comment: any) => {
          const commentDateUTC = new Date(comment.created);

          if (this.isDateInWindow(commentDateUTC, window)) {
            if (isTeamMember(comment.author)) {
              isTeamActive = true;
              const desc = 'Comment added';
              activities.push(desc);
              checkWeekend(commentDateUTC, desc);
            }
          }
        });
      }

      // 3. New Ticket Created Today
      const createdDateUTC = new Date(issue.fields.created);
      if (this.isDateInWindow(createdDateUTC, window)) {
        if (isTeamMember(issue.fields.creator) || isTeamMember(issue.fields.reporter)) {
          isTeamActive = true;
          const desc = 'Ticket Created';
          activities.push(desc);
          checkWeekend(createdDateUTC, desc);
        }
      }

      // 4. Last Resort: Scan active development
      const devStatuses = devStatusList || ['in progress', 'dev complete', 'code review', 'testing'];
      const hasDevStatus = devStatuses.some(status => issue.fields.status.name.toLowerCase().includes(status));

      if (!isTeamActive && hasDevStatus) {
        const lastUpdatedDateUTC = this.scanForDevStatusFull(issue, devFieldId);
        if (lastUpdatedDateUTC && this.isDateInWindow(lastUpdatedDateUTC, window)) {
          // Credit off the SAME field used to determine V2 ownership everywhere else
          // (sprintV2Issues membership) — not the raw built-in `assignee`, which some
          // boards (Thrive) use as a Dev -> QA -> Dev work-queue pointer rather than
          // ownership. See this function's devFieldIds/devUsesAssignee param doc.
          const isDevOwner = devUsesAssignee
            ? isTeamMember(issue.fields.assignee)
            : devFieldIds.some((id: string) => isTeamMember(issue.fields?.[id]));
          if (isDevOwner) {
            isTeamActive = true;
            const desc = 'Development Activity (PR/Commit)';
            activities.push(desc);
            checkWeekend(lastUpdatedDateUTC, desc);
          }
        }
      }

      if (isTeamActive) {
        issue.dailyActivity = [...new Set(activities)];
        teamActiveTickets.push(issue);
        if (hasWeekendActivity) {
          issue.weekendActivity = [...new Set(weekendActivities)];
          weekendActivityTickets.push(issue);
        }
      } else if (isLinedUp) {
        queuedWorkTickets.push(issue);
      } else {
        contextTickets.push(issue);
      }
    });

    logger.debug(
      `Activity Filter: ${teamActiveTickets.length} team-active, ${queuedWorkTickets.length} lined-up, ${contextTickets.length} context/idle.`,
      'ReportService'
    );
    return { teamActiveTickets, queuedWorkTickets, contextTickets, weekendActivityTickets };
  }

  private identifyRecentTransitions(issues: any[]): any[] {
    const today = new Date();
    today.setHours(0, 0, 0, 0);

    const recentTransitions: any[] = [];

    issues.forEach(issue => {
      const changelog = issue.changelog || { histories: [] };

      changelog.histories.forEach((history: any) => {
        const historyDate = new Date(history.created);
        historyDate.setHours(0, 0, 0, 0);

        if (historyDate.getTime() === today.getTime()) {
          history.items.forEach((item: any) => {
            if (item.field === 'status') {
              recentTransitions.push({
                key: issue.key,
                summary: issue.fields.summary,
                assignee: issue.fields.assignee ? issue.fields.assignee.displayName : 'Unassigned',
                from: item.fromString,
                to: item.toString,
                time: history.created,
              });
            }
          });
        }
      });
    });

    return recentTransitions;
  }

  private hashSprintName(sprintName: string): number {
    let hash = 0;
    for (let i = 0; i < sprintName.length; i++) {
      const char = sprintName.charCodeAt(i);
      hash = (hash << 5) - hash + char;
      hash = hash & hash;
    }
    return Math.abs(hash);
  }

  private formatDate(date: Date): string {
    const year = date.getFullYear();
    const month = String(date.getMonth() + 1).padStart(2, '0');
    const day = String(date.getDate()).padStart(2, '0');
    return `${year}-${month}-${day}`;
  }

  private scanForDevStatusFull(issue: any, devFieldId?: string): Date | null {
    // Iterate through all fields in properties (custom fields often live in .fields)
    const fields = issue.fields || {};

    // Priority Check: If we know the Development field ID, check it first!
    if (devFieldId && fields[devFieldId]) {
      const value = fields[devFieldId];
      if (typeof value === 'string' && value.includes('json=')) {
        const date = this.parseDevStatusDateFull(value);
        if (date) return date;
      }
    }

    const potentialKeys = Object.keys(fields);

    for (const key of potentialKeys) {
      const value = fields[key];
      if (typeof value === 'string') {
        // Broad check first to avoid expensive parsing
        // Check for pullrequest, repository (commits), OR build (CI) activity
        if (
          value.includes('json=') &&
          (value.includes('pullrequest') || value.includes('repository') || value.includes('build'))
        ) {
          // Try to parse this field
          const date = this.parseDevStatusDateFull(value);
          if (date) return date;
        }
      }
    }
    return null;
  }

  private scanForDevStatus(issue: any): string | null {
    const date = this.scanForDevStatusFull(issue);
    return date ? date.toISOString().split('T')[0] : null;
  }

  private parseDevStatusDateFull(devField: any): Date | null {
    if (typeof devField !== 'string') return null;

    const startIndex = devField.indexOf('json=');
    if (startIndex === -1) return null;

    const startJson = startIndex + 5;
    let braceCount = 0;
    let endIndex = -1;

    for (let i = startJson; i < devField.length; i++) {
      if (devField[i] === '{') braceCount++;
      if (devField[i] === '}') braceCount--;

      if (braceCount === 0 && i > startJson) {
        endIndex = i + 1;
        break;
      }
    }

    if (endIndex !== -1) {
      try {
        const jsonStr = devField.substring(startJson, endIndex);
        const devData = JSON.parse(jsonStr);

        // Check for pull request activity
        const prLastUpdated = devData.cachedValue?.summary?.pullrequest?.overall?.lastUpdated;

        // Check for repository/commit activity
        const repoLastUpdated = devData.cachedValue?.summary?.repository?.overall?.lastUpdated;

        // Check for CI build activity — a build is normally triggered by a same-day
        // commit/push, so it's a useful fallback signal on days where Jira's PR/repo
        // summary hasn't caught up yet (that cache is periodic, not live).
        const buildLastUpdated = devData.cachedValue?.summary?.build?.overall?.lastUpdated;

        // Return the most recent timestamp if any exists
        const dates: Date[] = [];
        if (prLastUpdated) dates.push(new Date(prLastUpdated));
        if (repoLastUpdated) dates.push(new Date(repoLastUpdated));
        if (buildLastUpdated) dates.push(new Date(buildLastUpdated));

        if (dates.length > 0) {
          // Return the most recent date
          return new Date(Math.max(...dates.map(d => d.getTime())));
        }
      } catch (e) {
        // Parsing failed
      }
    }
    return null;
  }

  private parseDevStatusDate(devField: any): string | null {
    const date = this.parseDevStatusDateFull(devField);
    return date ? date.toISOString().split('T')[0] : null;
  }

  private formatDateForFile(date: Date): string {
    const day = String(date.getDate()).padStart(2, '0');
    const month = String(date.getMonth() + 1).padStart(2, '0');
    const year = date.getFullYear();
    return `${day}_${month}_${year}`;
  }

  private formatDurationForReport(days: number): string {
    if (days === 1) return '1 day';
    if (days < 7) return `${days} days`;

    const weeks = Math.floor(days / 7);
    const remainingDays = days % 7;

    if (weeks === 1 && remainingDays === 0) return '1 week';
    if (weeks === 1) return `1 week, ${remainingDays} day${remainingDays > 1 ? 's' : ''}`;
    if (remainingDays === 0) return `${weeks} weeks`;
    return `${weeks} week${weeks > 1 ? 's' : ''}, ${remainingDays} day${remainingDays > 1 ? 's' : ''}`;
  }

  private getWeekNumber(d: Date): [number, number] {
    // Copy date so don't modify original
    d = new Date(Date.UTC(d.getFullYear(), d.getMonth(), d.getDate()));
    // Set to nearest Thursday: current date + 4 - current day number
    // Make Sunday's day number 7
    d.setUTCDate(d.getUTCDate() + 4 - (d.getUTCDay() || 7));
    // Get first day of year
    const yearStart = new Date(Date.UTC(d.getUTCFullYear(), 0, 1));
    // Calculate full weeks to nearest Thursday
    const weekNo = Math.ceil(((d.getTime() - yearStart.getTime()) / 86400000 + 1) / 7);
    return [d.getUTCFullYear(), weekNo];
  }

  /**
   * Real Kanban throughput for a report week: distinct tickets whose
   * PerfTicketFact.wasCompleted is true across every 'done' Kanban sync span
   * overlapping [weekStart, weekEnd]. Returns null when no synced span
   * overlaps the week, so the caller can fall back to the (weaker) snapshot
   * approximation rather than reporting a false zero.
   *
   * Deliberately NOT used for sprint projects -- see getWeeklyMetrics.
   */
  private async computeKanbanWeeklyThroughput(
    projectId: number,
    weekStart: string,
    weekEnd: string
  ): Promise<number | null> {
    const overlappingSyncs = await PerfSprintSync.findAll({
      where: {
        projectId,
        syncType: 'kanban',
        syncStatus: 'done',
        startDate: { [Op.lte]: weekEnd },
        endDate: { [Op.gte]: weekStart },
      },
      attributes: ['id'],
    });
    if (overlappingSyncs.length === 0) return null;

    const facts = await PerfTicketFact.findAll({
      where: { syncId: { [Op.in]: overlappingSyncs.map((s: any) => s.id) }, wasCompleted: true },
      attributes: ['jiraKey'],
    });
    // Dedup by key -- an overlapping manual re-sync alongside a cadence/continuous
    // span could otherwise double-count the same completed ticket.
    return new Set(facts.map((f: any) => f.jiraKey)).size;
  }

  private async getWeeklyMetrics(
    projectId: number,
    startDate: Date,
    endDate: Date,
    laneConfig?: LaneConfig,
    isKanban?: boolean
  ): Promise<any> {
    const snapshots = await DailyBoardSnapshot.findAll({
      where: {
        projectId: projectId,
        date: {
          [Op.gte]: this.formatDate(startDate),
          [Op.lte]: this.formatDate(endDate),
        },
      },
    });

    if (snapshots.length === 0) return null;

    // Resolve active and done status names from lane config
    const activeStatuses = laneConfig ? getActiveMetricStatuses(laneConfig) : ['In Progress', 'In Review'];
    const doneStatuses = laneConfig ? getDoneStatuses(laneConfig) : ['Done'];

    let totalActive = 0;
    let maxBlocked = 0;
    let doneCounts: number[] = [];
    const teamMembers = new Set<string>();

    snapshots.forEach(s => {
      const statusCounts = s.statusCounts || {};
      let active = 0;
      activeStatuses.forEach((st: string) => {
        active += statusCounts[st] || 0;
      });
      totalActive += active;

      const blocked = s.blockedTickets ? (Array.isArray(s.blockedTickets) ? s.blockedTickets.length : 0) : 0;
      maxBlocked = Math.max(maxBlocked, blocked);

      let doneCount = 0;
      doneStatuses.forEach((st: string) => {
        doneCount += statusCounts[st] || 0;
      });
      if (doneCount > 0) {
        doneCounts.push(doneCount);
      }

      if (s.teamMembers && Array.isArray(s.teamMembers)) {
        s.teamMembers.forEach(m => teamMembers.add(m));
      }
    });

    const avgActive = Math.round(totalActive / snapshots.length);

    // Throughput. Sprint projects keep the original snapshot approximation
    // unchanged (max-min doneCounts across the week's daily snapshots) --
    // this fix is scoped to Kanban only; sprint numbers must not move.
    //
    // Kanban prefers real completion events from synced PerfTicketFact rows
    // when a synced span overlaps the week -- the old approximation missed
    // anything finished and archived mid-week and could go negative when the
    // board was cleaned. Falls back to the same approximation when nothing
    // has been synced for this week yet, rather than reporting a false zero.
    let throughput = 0;
    if (isKanban) {
      const factThroughput = await this.computeKanbanWeeklyThroughput(
        projectId,
        this.formatDate(startDate),
        this.formatDate(endDate)
      );
      if (factThroughput !== null) {
        throughput = factThroughput;
      } else if (doneCounts.length > 1) {
        throughput = Math.max(...doneCounts) - Math.min(...doneCounts);
      }
    } else if (doneCounts.length > 1) {
      throughput = Math.max(...doneCounts) - Math.min(...doneCounts);
    }

    return {
      avgActiveTickets: avgActive,
      maxBlockedTickets: maxBlocked,
      throughput: throughput,
      teamMembers: Array.from(teamMembers),
      snapshotCount: snapshots.length,
    };
  }

  async generateWeeklyReport(
    projectName: string,
    startDate?: string,
    endDate?: string,
    forceRefresh: boolean = false
  ): Promise<any> {
    // Resolve Project first (moved ahead of window computation) so its account's configured
    // weekStartDay is known before the window is normalized -- previously the window was
    // computed with a hardcoded Friday assumption before the project/account were even
    // looked up.
    const project = await Project.findOne({ where: { code: projectName } });
    if (!project) throw new Error(`Project ${projectName} not found.`);

    const account = await Account.findByPk(project.accountId);
    const weekStartDay = account?.weekStartDay ?? 5;

    const providedDates = !!(startDate && endDate);
    const window = normalizeWindow(startDate, endDate, 'fri-thu-week', weekStartDay);
    const start = window.start;
    const end = window.end;
    startDate = window.startDate;
    endDate = window.endDate;

    if (!providedDates) {
      logger.debug(`Dates not provided. Defaulting to current week: ${startDate} to ${endDate}`, 'ReportService');
    }

    logger.info(`Generating Weekly Report for ${projectName} (${startDate} to ${endDate})`, 'ReportService');

    // 3. Calculate Week Number and Year (kept as a human-readable label for UI/PPT titles --
    // no longer the DB uniqueness key, which is now the real (project_id, start_date,
    // end_date), correct for any configured week-start day)
    const [isoYear, weekNumber] = this.getWeekNumber(end);
    logger.debug(`Calculated Week: ${weekNumber}, Year: ${isoYear} for date ${startDate}`, 'ReportService');

    // 4. Check Cache (DB)
    const { ProjectWeeklyReport } = require('../../../models/ProjectWeeklyReport');

    if (!forceRefresh) {
      const existingReport = await ProjectWeeklyReport.findOne({
        where: {
          projectId: project.id,
          startDate,
          endDate,
        },
      });

      if (existingReport) {
        logger.info('Returning cached weekly report from DB.', 'ReportService');
        return existingReport;
      } else {
        logger.warn(
          `No cached weekly report found for Project ${project.name} in week ${weekNumber}. forceRefresh is false. rejecting.`,
          'ReportService'
        );
        throw new Error(
          'No report data found. Please try "Queue your request" option to generate it, and check back after a minute.'
        );
      }
    }

    // 5. Fetch Daily Snapshots
    const snapshots = await DailyBoardSnapshot.findAll({
      where: {
        projectId: project.id,
        date: {
          [Op.between]: [startDate, endDate],
        },
      },
      order: [['date', 'ASC']],
    });

    if (snapshots.length === 0) {
      logger.warn(
        `No daily reports found for ${projectName} between ${startDate} and ${endDate}. Skipping report generation.`,
        'ReportService'
      );
      return null;
    }

    logger.debug(`Found ${snapshots.length} daily snapshots. Aggregating...`, 'ReportService');

    // 6. Aggregate Data for AI — scrub each DSR's text using its confirmed keys before passing to WSR AI.
    // This prevents hallucinated prod-bug text in old snapshots from propagating into WSR.
    const dailySummaries = snapshots.map(s => {
      const keys = (s.confirmedProdBugKeys as string[] | null) ?? [];
      return {
        date: s.date,
        summary: aiService.scrubText(s.workSummary || '', keys),
        risks: aiService.scrubText(s.executiveRisks || '', keys),
        health: s.overallHealth,
      };
    });

    // 6b. Aggregate confirmed prod bug keys from all snapshots this week (deduped).
    // These are the ONLY keys the WSR AI may call "production bugs".
    const weeklyConfirmedProdBugKeys: string[] = [
      ...new Set(snapshots.flatMap(s => (s.confirmedProdBugKeys as string[] | null) ?? [])),
    ];

    // 6a. Collate manager insights from daily snapshots
    const dailyInsightsRaw = snapshots
      .map(s => s.managerInsights)
      .filter((ins): ins is string => !!ins && ins.trim().length > 0);

    let collatedWeeklyInsights: string | undefined;
    if (dailyInsightsRaw.length > 0) {
      logger.debug(
        `Collating ${dailyInsightsRaw.length} daily manager insights for ${projectName} weekly report...`,
        'ReportService'
      );
      try {
        collatedWeeklyInsights = await aiService.collateWeeklyInsights(dailyInsightsRaw, project.name);
      } catch (e) {
        logger.warn(
          `Failed to collate weekly insights for ${projectName}: ${e instanceof Error ? e.message : 'Unknown error'}`,
          'ReportService'
        );
        collatedWeeklyInsights = dailyInsightsRaw.join(' | ');
      }
    }

    // 7. Calculate Metrics & Trends (Using Date objects)
    const weeklyLaneConfig = getLaneConfig(project);
    const currentMetrics = await this.getWeeklyMetrics(
      project.id,
      start,
      end,
      weeklyLaneConfig,
      isKanbanForDate(project as any, this.formatDate(start))
    );

    // Previous 1 Week
    const prev1Start = new Date(start);
    prev1Start.setDate(prev1Start.getDate() - 7);
    const prev1End = new Date(end);
    prev1End.setDate(prev1End.getDate() - 7);
    const prev1Metrics = await this.getWeeklyMetrics(
      project.id,
      prev1Start,
      prev1End,
      weeklyLaneConfig,
      isKanbanForDate(project as any, this.formatDate(prev1Start))
    );

    // Previous 2 Weeks
    const prev2Start = new Date(start);
    prev2Start.setDate(prev2Start.getDate() - 14);
    const prev2End = new Date(end);
    prev2End.setDate(prev2End.getDate() - 14);
    const prev2Metrics = await this.getWeeklyMetrics(
      project.id,
      prev2Start,
      prev2End,
      weeklyLaneConfig,
      isKanbanForDate(project as any, this.formatDate(prev2Start))
    );

    const trendContext = {
      current: currentMetrics,
      previousWeek: prev1Metrics,
      twoWeeksAgo: prev2Metrics,
    };

    // 8. Get Historical Reports
    const historyContextStart = new Date(start);
    historyContextStart.setDate(historyContextStart.getDate() - 14);

    const previousReports = await ProjectWeeklyReport.findAll({
      where: {
        projectId: project.id,
        startDate: {
          [Op.gte]: historyContextStart,
          [Op.lt]: start,
        },
      },
      order: [['startDate', 'ASC']],
    });

    const previousWeeksContext = previousReports.map((r: any) => ({
      weekStartDate: r.startDate,
      health: r.status,
      activeBugs: r.risks && r.risks.toLowerCase().includes('bug') ? 'Yes' : 'No',
    }));

    // 9. Analyze Blocked Tickets with actual duration
    const { blockedTicketAnalyzer } = require('../../../common/utils');
    const blockedTicketsWithDuration = await blockedTicketAnalyzer.getCurrentlyBlockedTickets(
      project.id,
      endDate,
      30 // Look back 30 days
    );

    // Format blocked ticket information with accurate durations
    const blockedTicketContext = blockedTicketsWithDuration.map((ticket: any) => ({
      key: ticket.key,
      summary: ticket.summary,
      blockedSince: ticket.firstBlockedDate,
      daysBlocked: ticket.consecutiveDaysBlocked,
      formattedDuration: this.formatDurationForReport(ticket.consecutiveDaysBlocked),
    }));

    // 9b. Authoritative end-of-week ticket statuses (last daily snapshot, ordered date ASC).
    // Lets the WSR AI drop tickets that reached Pending Deployment by week-end even if an
    // earlier daily report flagged them as awaiting QA/deployment.
    const lastSnapshotDetails = snapshots[snapshots.length - 1]?.ticketDetails || '';
    const endOfWeekTicketStatuses = lastSnapshotDetails
      ? aiService.scrubText(lastSnapshotDetails, weeklyConfirmedProdBugKeys)
      : undefined;

    // 10. Generate Summary via AI
    const weeklyLaneDefinitions = formatLaneDefinitionsForPrompt(weeklyLaneConfig);
    const aiResult = await aiService.generateWeeklySummary(
      dailySummaries,
      previousWeeksContext,
      trendContext,
      weeklyLaneDefinitions,
      blockedTicketContext, // Pass blocked ticket context with durations
      collatedWeeklyInsights, // Manager insights collated from daily snapshots
      weeklyConfirmedProdBugKeys, // Verified prod bug keys — the only ones WSR may call "production bugs"
      endOfWeekTicketStatuses // Authoritative per-ticket status as of week end (Pending Deployment exclusion)
    );

    // 10.5 Validate AI output for temporal accuracy
    const { temporalValidator: weeklyValidator } = require('../../../common/utils');
    const weeklyValidation = weeklyValidator.validateTemporalClaims(JSON.stringify(aiResult), `Weekly-${project.name}`);

    if (!weeklyValidation.isValid || weeklyValidation.suspiciousClaims.length > 0) {
      logger.warn(
        `Temporal validation warnings for ${project.name} weekly report: ${weeklyValidator.generateValidationReport(weeklyValidation)}`,
        'ReportService'
      );
    }

    // 11. Compute deterministic weekly status — proportional rollup (Phase 2 of the
    // RAG-reliability plan). AI status is advisory only and is never used to determine
    // the saved status.
    const totalDays = snapshots.length;
    const weeklyRollup = rollupHealth(snapshots.map(s => s.overallHealth as string));
    const weeklyStatus: string = weeklyRollup.health;

    // Human-readable rationale for display in UI — states the average and band so the
    // computation is auditable, not just the outcome.
    const weeklyHealthRationale =
      `Week status: ${weeklyStatus} (avg ${weeklyRollup.avg.toFixed(2)} across ${weeklyRollup.scorableCount} scored day${weeklyRollup.scorableCount !== 1 ? 's' : ''} of ${totalDays}). ` +
      `Daily: ${snapshots.map(s => s.date + '=' + (s.overallHealth || 'Unknown')).join(', ')}. ` +
      `Rule: avg < 0.35 → Green; avg < 1.2 → Amber; else Red; a strict majority of Red days forces Red regardless of average.`;

    if (aiResult.status && aiResult.status !== weeklyStatus) {
      logger.warn(
        `[WSRHealthGuard] AI suggested status=${aiResult.status}, deterministic status=${weeklyStatus}. Using deterministic.`,
        'ReportService'
      );
    }

    // 11. Save to DB
    const [savedReport] = await ProjectWeeklyReport.upsert(
      {
        projectId: project.id,
        startDate: start, // Date object
        endDate: end, // Date object
        weekNumber: weekNumber,
        year: isoYear,
        executiveSummary: aiResult.executive_summary, // NEW
        workSummary: aiResult.work_summary,
        achievements: aiResult.achievements,
        risks: aiResult.risks,
        status: weeklyStatus, // Deterministic — computed from daily health distribution (majority rule)
        weeklyHealthRationale,
        additionalNotes: aiResult.additional_notes,
        teamMembers: currentMetrics?.teamMembers || [],
        metrics: currentMetrics,
        managerInsights: collatedWeeklyInsights || null,
      },
      {
        conflictFields: ['project_id', 'start_date', 'end_date'],
      }
    );

    logger.info('Weekly report generated and saved.', 'ReportService');

    return {
      ...savedReport.toJSON(),
      trendAnalysis: aiResult.trendAnalysis,
      teamMembers: savedReport.teamMembers,
      executiveSummary: savedReport.executiveSummary, // NEW
    };
  }

  // ---------------------------------------------------------------------------
  // Manager Insights Methods
  // ---------------------------------------------------------------------------

  /**
   * Save raw manager insights for a daily report.
   * Preserves the original executive summary (audit trail) if not already saved.
   * Runs AI health analysis and returns a health escalation suggestion if warranted.
   */
  async saveDailyInsights(
    snapshotId: number,
    insights: string,
    userId?: number,
    userName?: string,
    isSuperuser?: boolean
  ): Promise<{
    healthSuggestion?: { suggestedHealth: string; reason: string };
    healthCleared?: boolean;
    clearedFrom?: string;
  }> {
    const snapshot = await DailyBoardSnapshot.findByPk(snapshotId);
    if (!snapshot) throw new Error(`Daily snapshot ${snapshotId} not found.`);

    // Immutability: once a non-empty insight has been saved, only superuser
    // can change it. This applies even to the original author — leads and
    // managers get exactly one insight per day per project.
    if (snapshot.managerInsights && snapshot.managerInsights.trim().length > 0 && !isSuperuser) {
      const err: any = new Error('Project Insights have already been saved for this report and cannot be changed.');
      err.statusCode = 403;
      throw err;
    }

    // Author locking (still kept for the superuser-override flow): if
    // already claimed by someone else, only superuser can override.
    if (snapshot.insightsAuthorId && userId && snapshot.insightsAuthorId !== userId && !isSuperuser) {
      const err: any = new Error('Project Insights are locked to the original author.');
      err.statusCode = 403;
      throw err;
    }

    const updateData: any = { managerInsights: insights };

    // Set author on first save (or preserve existing author)
    if (!snapshot.insightsAuthorId && userId) {
      updateData.insightsAuthorId = userId;
      updateData.insightsAuthorName = userName ?? null;
    }

    // Preserve original executive summary on first insights save
    if (!snapshot.originalExecutiveSummary && snapshot.executiveSummary) {
      updateData.originalExecutiveSummary = snapshot.executiveSummary;
    }

    await DailyBoardSnapshot.update(updateData, { where: { id: snapshotId } });

    // Run health analysis (non-blocking fail — doesn't throw on AI error)
    const healthSuggestion = await aiService.analyzeInsightsForHealth(
      insights,
      snapshot.overallHealth || 'Green',
      snapshot.projectName || ''
    );

    if (healthSuggestion) {
      return { healthSuggestion };
    }

    // If AI sees no risk but a health override was previously set, auto-clear it
    if (snapshot.insightsHealth) {
      const clearedFrom = snapshot.insightsHealth;
      await DailyBoardSnapshot.update(
        { insightsHealth: null, insightsHealthReason: null },
        { where: { id: snapshotId } }
      );
      return { healthCleared: true, clearedFrom };
    }

    return {};
  }

  /**
   * Preview a refreshed executive summary using stored report data + manager insights.
   * Returns old and proposed new summary WITHOUT saving.
   */
  async previewInsights(
    id: number,
    insights: string,
    reportType: 'daily' | 'weekly_project' | 'weekly_account' | 'monthly_project' | 'monthly_account'
  ): Promise<{ oldSummary: string; newSummary: string }> {
    let oldSummary = '';
    let workSummary = '';
    let health = '';
    let existingRisks = '';
    let projectName = '';

    if (reportType === 'daily') {
      const snapshot = await DailyBoardSnapshot.findByPk(id);
      if (!snapshot) throw new Error(`Daily snapshot ${id} not found.`);
      oldSummary = snapshot.executiveSummary || '';
      workSummary = snapshot.workSummary || '';
      health = snapshot.overallHealth || 'Green';
      existingRisks = snapshot.executiveRisks || '';
      projectName = snapshot.projectName || '';
    } else if (reportType === 'weekly_project') {
      const report = await ProjectWeeklyReport.findByPk(id, { include: [Project] });
      if (!report) throw new Error(`Project weekly report ${id} not found.`);
      oldSummary = report.executiveSummary || '';
      workSummary = report.workSummary || '';
      health = report.status || 'Green';
      existingRisks = report.risks || '';
      projectName = (report as any).project?.name || '';
    } else if (reportType === 'weekly_account') {
      const report = await AccountWeeklyReport.findByPk(id, { include: [Account] });
      if (!report) throw new Error(`Account weekly report ${id} not found.`);
      oldSummary = report.summary || '';
      workSummary = (report.risks as any)?.summary || '';
      health = report.health || 'Green';
      existingRisks = ((report.risks as any)?.items || []).join('; ');
      projectName = (report as any).account?.name || '';
    } else if (reportType === 'monthly_project') {
      const report = await MonthlyProjectReport.findByPk(id, { include: [Project] });
      if (!report) throw new Error(`Monthly project report ${id} not found.`);
      oldSummary = report.workSummary || '';
      workSummary = report.workSummary || '';
      health = report.status || 'Green';
      existingRisks = report.risks || '';
      projectName = (report as any).project?.name || '';
    } else {
      const report = await MonthlyAccountReport.findByPk(id, { include: [Account] });
      if (!report) throw new Error(`Monthly account report ${id} not found.`);
      oldSummary = report.summary || '';
      workSummary = (report.risks as any)?.summary || '';
      health = report.health || 'Green';
      existingRisks = ((report.risks as any)?.items || []).join('; ');
      projectName = (report as any).account?.name || '';
    }

    const newSummary = await aiService.refreshExecutiveSummary({
      reportType,
      projectName,
      workSummary,
      health,
      existingRisks,
      managerInsights: insights,
    });

    return { oldSummary, newSummary };
  }

  /**
   * Save accepted manager insights + new executive summary to the appropriate model.
   * Preserves the original executive summary (audit trail) if not already saved.
   */
  async saveInsights(
    id: number,
    insights: string,
    newSummary: string,
    reportType: 'daily' | 'weekly_project' | 'weekly_account' | 'monthly_project' | 'monthly_account',
    userId?: number,
    userName?: string,
    isSuperuser?: boolean
  ): Promise<void> {
    if (reportType === 'daily') {
      const snap = await DailyBoardSnapshot.findByPk(id, {
        attributes: ['executiveSummary', 'originalExecutiveSummary', 'insightsAuthorId', 'managerInsights'],
      });
      // Immutability: once non-empty insights are saved, only superuser can change them.
      if ((snap as any)?.managerInsights && (snap as any).managerInsights.trim().length > 0 && !isSuperuser) {
        const err: any = new Error('Project Insights have already been saved for this report and cannot be changed.');
        err.statusCode = 403;
        throw err;
      }
      if (snap?.insightsAuthorId && userId && snap.insightsAuthorId !== userId && !isSuperuser) {
        const err: any = new Error('Project Insights are locked to the original author.');
        err.statusCode = 403;
        throw err;
      }
      const updateData: any = { managerInsights: insights, executiveSummary: newSummary };
      if (snap && !snap.originalExecutiveSummary && snap.executiveSummary) {
        updateData.originalExecutiveSummary = snap.executiveSummary;
      }
      if (!(snap as any)?.insightsAuthorId && userId) {
        updateData.insightsAuthorId = userId;
        updateData.insightsAuthorName = userName ?? null;
      }
      await DailyBoardSnapshot.update(updateData, { where: { id } });
    } else if (reportType === 'weekly_project') {
      const report = await ProjectWeeklyReport.findByPk(id, {
        attributes: ['executiveSummary', 'originalExecutiveSummary', 'insightsAuthorId', 'managerInsights'],
      });
      // Immutability: once non-empty insights are saved, only superuser can change them.
      if ((report as any)?.managerInsights && (report as any).managerInsights.trim().length > 0 && !isSuperuser) {
        const err: any = new Error('Project Insights have already been saved for this report and cannot be changed.');
        err.statusCode = 403;
        throw err;
      }
      if ((report as any)?.insightsAuthorId && userId && (report as any).insightsAuthorId !== userId && !isSuperuser) {
        const err: any = new Error('Project Insights are locked to the original author.');
        err.statusCode = 403;
        throw err;
      }
      const updateData: any = { managerInsights: insights, executiveSummary: newSummary };
      if (report && !report.originalExecutiveSummary && report.executiveSummary) {
        updateData.originalExecutiveSummary = report.executiveSummary;
      }
      if (!(report as any)?.insightsAuthorId && userId) {
        updateData.insightsAuthorId = userId;
        updateData.insightsAuthorName = userName ?? null;
      }
      await ProjectWeeklyReport.update(updateData, { where: { id } });
    } else if (reportType === 'weekly_account') {
      const report = await AccountWeeklyReport.findByPk(id, {
        attributes: ['summary', 'originalExecutiveSummary', 'insightsAuthorId'],
      });
      if ((report as any)?.insightsAuthorId && userId && (report as any).insightsAuthorId !== userId && !isSuperuser) {
        const err: any = new Error('Project Insights are locked to the original author.');
        err.statusCode = 403;
        throw err;
      }
      const updateData: any = { managerInsights: insights, summary: newSummary };
      if (report && !report.originalExecutiveSummary && report.summary) {
        updateData.originalExecutiveSummary = report.summary;
      }
      if (!(report as any)?.insightsAuthorId && userId) {
        updateData.insightsAuthorId = userId;
        updateData.insightsAuthorName = userName ?? null;
      }
      await AccountWeeklyReport.update(updateData, { where: { id } });
    } else if (reportType === 'monthly_project') {
      const report = await MonthlyProjectReport.findByPk(id, {
        attributes: ['workSummary', 'originalExecutiveSummary', 'insightsAuthorId'],
      });
      if ((report as any)?.insightsAuthorId && userId && (report as any).insightsAuthorId !== userId && !isSuperuser) {
        const err: any = new Error('Project Insights are locked to the original author.');
        err.statusCode = 403;
        throw err;
      }
      const updateData: any = { managerInsights: insights, workSummary: newSummary };
      if (report && !report.originalExecutiveSummary && report.workSummary) {
        updateData.originalExecutiveSummary = report.workSummary;
      }
      if (!(report as any)?.insightsAuthorId && userId) {
        updateData.insightsAuthorId = userId;
        updateData.insightsAuthorName = userName ?? null;
      }
      await MonthlyProjectReport.update(updateData, { where: { id } });
    } else {
      const report = await MonthlyAccountReport.findByPk(id, {
        attributes: ['summary', 'originalExecutiveSummary', 'insightsAuthorId'],
      });
      if ((report as any)?.insightsAuthorId && userId && (report as any).insightsAuthorId !== userId && !isSuperuser) {
        const err: any = new Error('Project Insights are locked to the original author.');
        err.statusCode = 403;
        throw err;
      }
      const updateData: any = { managerInsights: insights, summary: newSummary };
      if (report && !report.originalExecutiveSummary && report.summary) {
        updateData.originalExecutiveSummary = report.summary;
      }
      if (!(report as any)?.insightsAuthorId && userId) {
        updateData.insightsAuthorId = userId;
        updateData.insightsAuthorName = userName ?? null;
      }
      await MonthlyAccountReport.update(updateData, { where: { id } });
    }
  }

  /**
   * Append a team note (read-only context, no AI side effects) to any report type.
   */
  async addTeamNote(
    id: number,
    reportType: 'daily' | 'weekly_project' | 'weekly_account' | 'monthly_project' | 'monthly_account',
    userId: number,
    userName: string,
    text: string
  ): Promise<void> {
    const entry = { userId, name: userName, text, timestamp: new Date().toISOString() };
    const appendExpr = {
      teamNotes: Sequelize.literal(`COALESCE(team_notes, '[]'::jsonb) || '${JSON.stringify([entry])}'::jsonb`),
    };

    if (reportType === 'daily') {
      await DailyBoardSnapshot.update(appendExpr as any, { where: { id } });
    } else if (reportType === 'weekly_project') {
      await ProjectWeeklyReport.update(appendExpr as any, { where: { id } });
    } else if (reportType === 'weekly_account') {
      await AccountWeeklyReport.update(appendExpr as any, { where: { id } });
    } else if (reportType === 'monthly_project') {
      await MonthlyProjectReport.update(appendExpr as any, { where: { id } });
    } else {
      await MonthlyAccountReport.update(appendExpr as any, { where: { id } });
    }
  }

  /**
   * Apply a manager-accepted health escalation from insights.
   * Saves insightsHealth + insightsHealthReason to the daily snapshot.
   * If a weekly report already exists covering that date, marks it stale.
   */
  async applyInsightsHealth(snapshotId: number, insightsHealth: string, reason: string): Promise<void> {
    const snapshot = await DailyBoardSnapshot.findByPk(snapshotId);
    if (!snapshot) throw new Error(`Daily snapshot ${snapshotId} not found.`);

    await DailyBoardSnapshot.update({ insightsHealth, insightsHealthReason: reason }, { where: { id: snapshotId } });

    // If a weekly report has already been generated covering this snapshot's date, mark it stale
    if (snapshot.projectId && snapshot.date) {
      const weeklyReport = await ProjectWeeklyReport.findOne({
        where: {
          projectId: snapshot.projectId,
          startDate: { [Op.lte]: snapshot.date },
          endDate: { [Op.gte]: snapshot.date },
        },
      });
      if (weeklyReport) {
        await ProjectWeeklyReport.update({ insightsStaleSince: new Date() }, { where: { id: weeklyReport.id } });
      }
    }
  }

  async generateAccountReport(accountCode: string, weekEndingDate?: string): Promise<any> {
    // Fetch Account
    const account = await Account.findOne({ where: { code: accountCode } });
    if (!account) throw new Error(`Account ${accountCode} not found.`);

    // Determine target week
    const targetDate = weekEndingDate ? new Date(weekEndingDate) : new Date();
    // Adjust to ensure we pick up the weekly reports generated for this period.
    // Assuming weekly reports are generated for week ending on `targetDate` approximately.
    // We will fetch the latest weekly report for each project.

    const projects = await Project.findAll({ where: { accountId: account.id } });
    const projectSummaries = [];

    // For each project, find the relevant weekly report
    // We look for a report with startDate close to our target week.
    // Let's assume we want the report where weekNumber matches the targetDate's week.
    const [targetWeekNum, targetYear] = this.getWeekNumber(targetDate);

    for (const project of projects) {
      const weeklyReport = await ProjectWeeklyReport.findOne({
        where: {
          projectId: project.id,
          weekNumber: targetWeekNum,
          year: targetYear,
        },
      });

      if (weeklyReport) {
        projectSummaries.push({
          projectName: project.name,
          summary: weeklyReport.workSummary,
          status: weeklyReport.status,
          risks: weeklyReport.risks,
          // Check for bugs in risks text as proxy
          hasHighSeverityBugs: weeklyReport.risks
            ? weeklyReport.risks.toLowerCase().includes('prod') ||
              weeklyReport.risks.toLowerCase().includes('critical') ||
              weeklyReport.risks.toLowerCase().includes('bug')
            : false,
        });
      } else {
        projectSummaries.push({
          projectName: project.name,
          summary: 'No report generated for this week.',
          status: 'Unknown',
          risks: '',
          hasHighSeverityBugs: false,
        });
      }
    }

    const analysis = await aiService.generateAccountSummary(projectSummaries, {
      accountId: account.id,
      redThresholdPercentage: account.redThresholdPercentage,
    });
    return {
      accountCode,
      weekEnding: this.formatDate(targetDate),
      data: {
        ...analysis,
        projects: projectSummaries,
      },
    };
  }
}

export const reportService = new ReportService();
