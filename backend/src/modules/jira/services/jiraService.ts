import axios, { AxiosInstance } from 'axios';
import { config } from '../../../config';
// Imported directly rather than via the common/utils barrel: the barrel pulls in
// blockedTicketAnalyzer -> Sequelize models, which drags the whole ORM into any module that
// only wants a logger, and breaks unit tests that import this file. Same reasoning as
// jiraFields.ts, which documents the identical trap.
import { logger } from '../../../common/utils/logger';
import { buildIssueFieldList, sanitizeIssue, sanitizeIssues } from './jiraFields';
import type { LaneConfig } from '../../../common/laneDefaults';

/** A sprint as the Agile API returns it, narrowed to the fields we read. */
interface JiraSprintValue {
    id: number;
    name: string;
    state?: string;
    startDate?: string;
    endDate?: string;
    /** Set when a sprint was actually completed, which can differ from the planned endDate. */
    completeDate?: string;
    /**
     * The board the sprint was created on. A board's sprint list also contains sprints
     * belonging to OTHER boards whose issues it happens to show, so this is the only
     * reliable way to tell "our" sprint from a neighbouring team's.
     */
    originBoardId?: number;
}

/** The sprint that was running on a given date — see getSprintForDate. */
export interface HistoricalSprint {
    id: number;
    name: string;
    startDate?: string;
    endDate?: string;
}

export interface JiraSprint {
    id: number;
    name: string;
    state: 'active' | 'closed' | 'future';
    startDate?: string;
    endDate?: string;
    completeDate?: string;
}

interface JiraIssue {
    key: string;
    fields: {
        summary: string;
        status: { name: string };
        priority?: { name: string };
        assignee?: {
            displayName: string;
            accountId: string;
            emailAddress?: string;
        };
        updated: string;
        // Comment BODIES are stripped at the fetch boundary (see jiraFields.sanitizeIssue)
        // so customer text never enters the app. Only metadata survives, which is all
        // reportService.identifyDailyActivity needs for its "Comment added" signal.
        comment?: { comments: Array<{ created?: string; author?: any; updateAuthor?: any }> };
        issuelinks?: any[];
        created: string;
        creator?: any;
        parent?: any;
        customfield_10000?: any; // Development Information (swallow-json)
        customfield_10251?: any; // Environment(s) - Object with value property or string
    };
    changelog?: {
        histories: Array<{
            created: string;
            items: Array<{
                field: string;
                toString: string;
            }>;
        }>;
    };
}

interface BoardData {
    boardName: string;
    issues: JiraIssue[];
}

interface BlockedTicket {
    key: string;
    summary: string;
    status: string;
    movedToBlockedToday: boolean;
    assignee: string;
    /**
     * When the ticket last entered a blocked status, derived from the changelog.
     * Replaces the previous `lastComment`, which copied a raw Jira comment body
     * (potentially customer personal data) into the DB, the AI prompt and the UI.
     */
    blockedSince?: string;
}

export class JiraService {
    private client: AxiosInstance;

    /**
     * Display name of the project's hours custom field, if configured. Needed so
     * the field allowlist can resolve it — an hours+custom_field project whose
     * field is missing from the allowlist reads 0 hours for every ticket, silently.
     */
    private readonly hoursFieldName?: string | null;
    private readonly jiraLaneConfig?: LaneConfig | null;

    /** Build a client for a project, carrying the config the field policy needs. */
    static forProject(project: {
        jiraBaseUrl?: string;
        jiraEmail?: string;
        jiraApiToken?: string;
        hoursFieldName?: string | null;
        jiraLaneConfig?: LaneConfig | null;
    }): JiraService {
        return new JiraService(
            project.jiraBaseUrl,
            project.jiraEmail,
            project.jiraApiToken,
            project.hoursFieldName,
            project.jiraLaneConfig,
        );
    }

    constructor(
        baseUrl?: string,
        email?: string,
        apiToken?: string,
        hoursFieldName?: string | null,
        jiraLaneConfig?: LaneConfig | null,
    ) {
        // Use provided credentials or fall back to baseUrl from config
        // Note: email and apiToken must now be provided explicitly (project-specific)
        const jiraBaseUrl = baseUrl || config.jira.baseUrl;
        const jiraEmail = email || '';
        const jiraApiToken = apiToken || '';
        this.hoursFieldName = hoursFieldName ?? null;
        this.jiraLaneConfig = jiraLaneConfig ?? null;

        this.client = axios.create({
            baseURL: jiraBaseUrl,
            headers: {
                'Authorization': `Basic ${Buffer.from(`${jiraEmail}:${jiraApiToken}`).toString('base64')}`,
                'Accept': 'application/json',
                'Content-Type': 'application/json'
            }
        });
    }

    // ---- Field policy -----------------------------------------------------
    // Every issue fetch sends an explicit field allowlist instead of `*all`, so
    // ticket descriptions never cross the wire, and strips comment bodies from
    // the response before any caller sees them. See ./jiraFields.ts.

    private fieldListPromise: Promise<string[]> | null = null;

    private fieldList(): Promise<string[]> {
        if (!this.fieldListPromise) {
            this.fieldListPromise = buildIssueFieldList(this, {
                hoursFieldName: this.hoursFieldName,
                // Without the lane config here, a project's declared owner fields are never
                // requested from Jira and every read of them returns empty — which looks like
                // "nobody owns anything" rather than a configuration error.
                jiraLaneConfig: this.jiraLaneConfig,
            });
        }
        return this.fieldListPromise;
    }

    /** Replace any caller-supplied `fields=` parameter with the allowlist. */
    private async applyFieldPolicy(url: string): Promise<string> {
        const stripped = url
            .replace(/([?&])fields=[^&]*/g, '$1')
            .replace(/[?&]$/, '')
            .replace(/\?&/, '?')
            .replace(/&&+/g, '&');
        const separator = stripped.includes('?') ? '&' : '?';
        const fields = await this.fieldList();
        return `${stripped}${separator}fields=${encodeURIComponent(fields.join(','))}`;
    }

    async getBoardConfiguration(boardId: number): Promise<any> {
        try {
            const response = await this.client.get(`/rest/agile/1.0/board/${boardId}`);
            return response.data;
        } catch (error: any) {
            logger.error(`Error fetching board details for ${boardId}`, error, 'JiraService');
            if (error.response) {
                // Log the status and Jira's own error messages only — the raw response
                // body can echo issue payloads (titles, comments) into the log file.
                const jiraMsg = error.response.data?.errorMessages?.join('; ') || error.response.data?.message || '';
                logger.debug(`Jira responded ${error.response.status}${jiraMsg ? `: ${jiraMsg}` : ''}`, 'JiraService');
            }
            throw error;
        }
    }

    async getActiveSprint(boardId: number): Promise<any | null> {
        try {
            const response = await this.client.get(`/rest/agile/1.0/board/${boardId}/sprint?state=active`);
            const sprints: JiraSprintValue[] = response.data.values;
            if (!sprints?.length) return null;

            // A board's sprint list also contains sprints owned by OTHER boards whose issues it
            // displays, and Jira does not return them in any dependable order. Taking values[0]
            // meant Team Beta (board 307) was scored against Team Rho's sprint (originBoardId
            // 439) — every Sprint Progress bar read 0, because none of Beta's people appear in
            // Rho's sprint. Prefer a sprint created on THIS board.
            //
            // Checked against every active scrum project before changing: Beta is the only one
            // affected. Every other board has exactly one active sprint, its own.
            return sprints.find(s => s.originBoardId === boardId) ?? sprints[0];
        } catch (error) {
            return null;
        }
    }

    /**
     * Returns the set of CLOSED (completed) sprint ids for a board. Used to detect
     * genuine spillover — a bug carried into the active sprint from a previously
     * closed sprint. Paginates the Agile API; fails open to an empty set so a Jira
     * hiccup never falsely flags spillovers.
     */
    async getClosedSprintIds(boardId: number): Promise<Set<number>> {
        const ids = new Set<number>();
        try {
            let startAt = 0;
            for (;;) {
                const response = await this.client.get(
                    `/rest/agile/1.0/board/${boardId}/sprint?state=closed&startAt=${startAt}&maxResults=50`
                );
                const values: any[] = response.data?.values || [];
                for (const s of values) {
                    if (typeof s?.id === 'number') ids.add(s.id);
                }
                if (response.data?.isLast || values.length === 0) break;
                startAt += values.length;
            }
        } catch (error) {
            logger.warn(`Could not fetch closed sprints for board ${boardId}; treating as none.`, 'JiraService');
        }
        return ids;
    }

    /**
     * The sprint that was actually running on a given date — the one that started on or before it
     * and ended on or after it (an unfinished sprint counts as still running).
     *
     * Needed when reconstructing a past date: the board's CURRENT active sprint is the wrong thing
     * to score against, because it may not have existed then. Without this, regenerating a
     * completed sprint's days yields no burndown at all.
     *
     * Returns null when no sprint covers the date, which is a real answer (a gap between sprints)
     * and correctly leaves the burndown unscored.
     */
    /** All sprints on a board for the given state(s), following pagination. */
    async getSprints(boardId: number, state: string = 'active,closed'): Promise<JiraSprintValue[]> {
        const all: JiraSprintValue[] = [];
        let startAt = 0;
        for (;;) {
            const response = await this.client.get(
                `/rest/agile/1.0/board/${boardId}/sprint?state=${encodeURIComponent(state)}&startAt=${startAt}&maxResults=50`,
            );
            const values: JiraSprintValue[] = response.data?.values || [];
            all.push(...values);
            if (response.data?.isLast || values.length === 0) break;
            startAt += values.length;
        }
        return all;
    }

    async getSprintForDate(boardId: number, date: string | Date): Promise<HistoricalSprint | null> {
        const target = new Date(date);
        if (Number.isNaN(target.getTime())) return null;

        let best: JiraSprintValue | null = null;
        try {
            for (const s of await this.getSprints(boardId, 'active,closed')) {
                if (!s?.startDate) continue;
                const start = new Date(s.startDate);
                // A sprint with no completeDate/endDate is still open — treat it as ongoing.
                const closesAt = s.completeDate || s.endDate;
                const end = closesAt ? new Date(closesAt) : null;
                if (start > target) continue;
                if (end && end < target) continue;

                if (!best) { best = s; continue; }

                // Several sprints can cover one date, because a board's sprint list also
                // includes sprints owned by OTHER boards whose issues it displays. Team Beta's
                // board carries both "Beta - Nets" (originBoardId 307, its own) and
                // "Rho - Nets" (originBoardId 439, another team's) starting 70 minutes apart —
                // picking on start time alone chose the neighbour's sprint and scored 0.
                // A sprint created on THIS board always wins.
                const isOurs = (x: JiraSprintValue) => x.originBoardId === boardId;
                if (isOurs(s) !== isOurs(best)) { if (isOurs(s)) best = s; continue; }

                // Same provenance: the later-starting sprint is the one in progress.
                if (new Date(best.startDate as string) < start) best = s;
            }
        } catch {
            logger.warn(`Could not resolve the sprint covering ${new Date(date).toISOString().slice(0, 10)} on board ${boardId}; leaving burndown unscored.`, 'JiraService');
            return null;
        }
        return best
            ? { id: best.id, name: best.name, startDate: best.startDate, endDate: best.completeDate || best.endDate }
            : null;
    }

    async getUserAccountIdByEmail(email: string): Promise<string | null> {
        try {
            const response = await this.client.get(
                `/rest/api/3/user/search?query=${encodeURIComponent(email)}&maxResults=10`
            );
            const users: any[] = response.data ?? [];
            const normalise = (e: string) => e.toLowerCase().replace(/_(ext|int|contractor)$/i, '');
            const [localPart] = email.toLowerCase().split('@');
            const cleanLocal = normalise(localPart);
            // Prefer exact email match
            const exactMatch = users.find((u: any) => {
                const uEmail: string = u.emailAddress ?? '';
                const [uLocal] = uEmail.toLowerCase().split('@');
                return normalise(uLocal) === cleanLocal;
            });
            if (exactMatch) return exactMatch.accountId;
            // Jira Cloud hides email addresses when privacy is enabled (emailAddress returns "").
            // If the query returned exactly one user and their email is blank, that single result
            // is a reliable match — Jira's user search is specific enough for email queries.
            if (users.length === 1 && !users[0].emailAddress) return users[0].accountId;
            return null;
        } catch (error: any) {
            logger.error(`Error resolving Jira user for ${email}`, error, 'JiraService');
            return null;
        }
    }

    /**
     * Fetch the GreenHopper sprint report for a closed sprint.
     * Returns { completedIssues, notCompletedIssues } where each issue has:
     *   key, assigneeAccountId, assigneeName, storyPoints, statusName, done
     */
    async getSprintReport(boardId: number, sprintId: number): Promise<{
        completedIssues: any[];
        notCompletedIssues: any[];
        puntedIssues: any[];
        sums: {
            completedInitialEstimateSp: number | null;
            completedEstimateSp: number | null;
            notCompletedInitialEstimateSp: number | null;
            notCompletedEstimateSp: number | null;
            puntedInitialEstimateSp: number | null;
            puntedEstimateSp: number | null;
            completedInAnotherSprintEstimateSp: number | null;
        };
    }> {
        const response = await this.client.get(
            `/rest/greenhopper/1.0/rapid/charts/sprintreport?rapidViewId=${boardId}&sprintId=${sprintId}`
        );
        const contents = response.data?.contents ?? {};
        const mapIssue = (i: any) => ({
            key: i.key as string,
            assigneeAccountId: i.assigneeAccountId as string | null,
            assigneeName: (i.assigneeName ?? '') as string,
            storyPoints: (i.currentEstimateStatistic?.statFieldValue?.value ?? 0) as number,
            statusName: (i.statusName ?? '') as string,
            done: !!i.done,
            typeName: (i.typeName ?? '') as string,
        });
        const extractSum = (key: string): number | null => {
            const f = contents[key];
            if (!f || typeof f !== 'object') return null;
            const v = (f as any).value;
            return typeof v === 'number' ? v : null;
        };
        return {
            completedIssues: (contents.completedIssues ?? []).map(mapIssue),
            notCompletedIssues: (contents.issuesNotCompletedInCurrentSprint ?? []).map(mapIssue),
            puntedIssues: (contents.puntedIssues ?? []).map(mapIssue),
            sums: {
                completedInitialEstimateSp: extractSum('completedIssuesInitialEstimateSum'),
                completedEstimateSp: extractSum('completedIssuesEstimateSum'),
                notCompletedInitialEstimateSp: extractSum('issuesNotCompletedInitialEstimateSum'),
                notCompletedEstimateSp: extractSum('issuesNotCompletedEstimateSum'),
                puntedInitialEstimateSp: extractSum('puntedIssuesInitialEstimateSum'),
                puntedEstimateSp: extractSum('puntedIssuesEstimateSum'),
                completedInAnotherSprintEstimateSp: extractSum('issuesCompletedInAnotherSprintEstimateSum'),
            },
        };
    }

    async listBoardSprints(boardId: number, maxResults = 5): Promise<any[]> {
        try {
            // Paginate through all sprints — Jira returns oldest-first so we must collect all
            // before sorting to get truly recent ones
            const allSprints: any[] = [];
            let startAt = 0;
            const pageSize = 50;
            let isLast = false;

            while (!isLast) {
                let response: any;
                try {
                    response = await this.client.get(
                        `/rest/agile/1.0/board/${boardId}/sprint?state=closed,active&maxResults=${pageSize}&startAt=${startAt}`
                    );
                } catch (err: any) {
                    // Kanban boards return 400 "The board does not support sprints"
                    if (err?.response?.status === 400 || err?.response?.status === 404) {
                        return [];
                    }
                    throw err;
                }
                const data = response.data;
                const page: any[] = data.values ?? [];
                allSprints.push(...page);
                isLast = data.isLast ?? page.length < pageSize;
                startAt += page.length;
            }

            return allSprints
                .filter(s => s.startDate)
                // Drop sprints that originate from a different board. Jira's
                // `/board/:id/sprint` returns every sprint visible on the board,
                // including ones owned by sibling boards in the same Jira project
                // (when ticket scope overlaps). Persisting those creates rows
                // tagged with this project's id but bearing another project's
                // sprint name — they later pollute trend charts.
                .filter(s => s.originBoardId === boardId)
                .sort((a, b) => new Date(b.startDate).getTime() - new Date(a.startDate).getTime())
                .slice(0, maxResults);
        } catch (error: any) {
            logger.error(`Error fetching sprints for board ${boardId}`, error, 'JiraService');
            throw error;
        }
    }

    // Find the immediately-preceding sprint on a board. Used by scope-creep
    // detection to distinguish carry-in (rolled forward from the prev sprint)
    // from real mid-sprint additions. Goes through Jira directly so the lookup
    // works even when the predecessor was never imported into PerfSprintSync.
    async findPreviousSprintForBoard(
        boardId: number,
        currentSprintId: number,
        currentSprintStartDate: string,
        projectKeyPrefix?: string,
    ): Promise<{ id: number; name: string } | null> {
        if (!currentSprintStartDate) return null;
        const startTs = new Date(currentSprintStartDate).getTime();
        if (Number.isNaN(startTs)) return null;

        const all = await this.listBoardSprints(boardId, 100);
        const prefix = (projectKeyPrefix ?? '').toLowerCase();
        // Same prefix filter listJiraSprints uses: shared boards (e.g. board 328
        // hosts both LOT and EXP) would otherwise hand back the wrong predecessor.
        // If nothing matches the prefix, fall back to all sprints (board is dedicated).
        const prefixed = prefix
            ? all.filter(s => typeof s.name === 'string' && s.name.toLowerCase().startsWith(prefix))
            : all;
        const candidates = prefixed.length > 0 ? prefixed : all;

        let best: any = null;
        let bestEnd = -Infinity;
        for (const s of candidates) {
            if (s.id === currentSprintId) continue;
            const endRaw: string | undefined = s.endDate ?? s.completeDate;
            if (!endRaw) continue;
            const endTs = new Date(endRaw).getTime();
            if (Number.isNaN(endTs)) continue;
            // Use <= because sprints commonly transition same-day (prev.end === this.start).
            if (endTs <= startTs && endTs > bestEnd) {
                best = s;
                bestEnd = endTs;
            }
        }
        return best ? { id: best.id, name: best.name } : null;
    }

    async getIssuesBySprintName(sprintName: string): Promise<BoardData> {
        try {
            logger.debug(`Fetching issues for sprint: "${sprintName}"`, 'JiraService');
            const jql = `sprint = "${sprintName}"`;
            const issues = await this.getAllIssuesFromJql(jql);
            return { boardName: `Sprint: ${sprintName}`, issues };
        } catch (error: any) {
            logger.error(`Error fetching issues for sprint ${sprintName}`, error, 'JiraService');
            if (error.response) {
                // Log the status and Jira's own error messages only — the raw response
                // body can echo issue payloads (titles, comments) into the log file.
                const jiraMsg = error.response.data?.errorMessages?.join('; ') || error.response.data?.message || '';
                logger.debug(`Jira responded ${error.response.status}${jiraMsg ? `: ${jiraMsg}` : ''}`, 'JiraService');
            }
            throw error;
        }
    }

    async getAllIssuesFromJql(jql: string): Promise<JiraIssue[]> {
        let issues: JiraIssue[] = [];
        let nextPageToken: string | null = null;
        let isLast = false;

        while (!isLast) {
            const body: any = {
                jql: jql,
                maxResults: 100,
                fields: await this.fieldList()
            };
            if (nextPageToken) {
                body.nextPageToken = nextPageToken;
            }

            let response: any;
            try {
                response = await this.client.post('/rest/api/3/search/jql?expand=changelog', body);
            } catch (axiosErr: any) {
                const jiraMsg = axiosErr.response?.data?.errorMessages?.join('; ') || axiosErr.response?.data?.message || axiosErr.message;
                console.error('[JiraService] JQL search failed:', JSON.stringify({ jql: body.jql, status: axiosErr.response?.status, error: jiraMsg }));
                throw new Error(`Jira JQL error (${axiosErr.response?.status ?? 'network'}): ${jiraMsg}`);
            }
            const data = response.data;

            if (data.issues && data.issues.length > 0) {
                issues = issues.concat(data.issues);
            }

            if (data.nextPageToken) {
                nextPageToken = data.nextPageToken;
            } else {
                isLast = true;
            }

            if (data.isLast) {
                isLast = true;
            }
        }
        return sanitizeIssues(issues);
    }

    /**
     * Fetch ALL changelog histories for a single Jira issue via the dedicated
     * /rest/api/3/issue/{key}/changelog endpoint (handles pagination).
     *
     * NOTE: The POST /rest/api/3/search/jql?expand=changelog endpoint does NOT actually
     * embed changelogs in the response — the changelog key is absent entirely. Use this
     * method to get reliable changelog data per issue.
     */
    async getIssueChangelog(key: string): Promise<any[]> {
        const allHistories: any[] = [];
        let startAt = 0;
        const maxResults = 100;
        while (true) {
            const response = await this.client.get(
                `/rest/api/3/issue/${encodeURIComponent(key)}/changelog`,
                { params: { maxResults, startAt } }
            );
            const data = response.data;
            const values: any[] = data.values ?? [];
            allHistories.push(...values);
            if (allHistories.length >= (data.total ?? values.length) || values.length === 0) break;
            startAt += values.length;
        }
        return allHistories;
    }

    /**
     * Fetch changelogs for a batch of issue keys in parallel (10 at a time).
     * Returns a map of key → histories[].
     */
    async getChangelogsForKeys(keys: string[], batchSize = 10): Promise<Map<string, any[]>> {
        const map = new Map<string, any[]>();
        for (let i = 0; i < keys.length; i += batchSize) {
            const batch = keys.slice(i, i + batchSize);
            await Promise.all(batch.map(async (key) => {
                try {
                    const histories = await this.getIssueChangelog(key);
                    map.set(key, histories);
                } catch (e: any) {
                    logger.debug(`Could not fetch changelog for ${key}: ${e.message}`, 'JiraService');
                    map.set(key, []);
                }
            }));
        }
        return map;
    }

    /**
     * Same as getAllIssuesFromJql but uses the legacy GET /rest/api/3/search endpoint.
     * Use this when the JQL contains change-history operators (CHANGED, WAS, WAS NOT IN, etc.)
     * which are NOT supported by the newer POST /rest/api/3/search/jql endpoint.
     */
    async getAllIssuesFromJqlLegacy(jql: string): Promise<JiraIssue[]> {
        let issues: JiraIssue[] = [];
        let startAt = 0;
        const maxResults = 100;

        while (true) {
            let response: any;
            try {
                response = await this.client.get('/rest/api/3/search', {
                    params: { jql, maxResults, startAt, fields: (await this.fieldList()).join(','), expand: 'changelog' }
                });
            } catch (axiosErr: any) {
                const jiraMsg = axiosErr.response?.data?.errorMessages?.join('; ') || axiosErr.response?.data?.message || axiosErr.message;
                console.error('[JiraService] Legacy JQL search failed:', JSON.stringify({ jql, status: axiosErr.response?.status, error: jiraMsg }));
                throw new Error(`Jira JQL error (${axiosErr.response?.status ?? 'network'}): ${jiraMsg}`);
            }
            const data = response.data;
            if (data.issues && data.issues.length > 0) {
                issues = issues.concat(data.issues);
            }
            if (startAt + maxResults >= data.total) {
                break;
            }
            startAt += maxResults;
        }
        return sanitizeIssues(issues);
    }

    async getIssuesForBoard(boardId: number, fromDate?: Date): Promise<BoardData> {
        let issues: JiraIssue[] = [];
        let boardName = `Board ${boardId}`;

        try {
            const boardConfig = await this.getBoardConfiguration(boardId);
            boardName = boardConfig.name;

            const activeSprint = await this.getActiveSprint(boardId);

            // Scope clause: everything currently "in play" on this board — the active
            // sprint's tickets (scrum) or everything not yet Done (kanban) — regardless
            // of whether Jira itself has been touched recently. This is what makes a
            // mid-sprint ticket with no Jira-visible edits for several days still show
            // up for evaluation; without it, such a ticket is invisible to the whole
            // daily-report pipeline (activity bucketing never even sees it).
            const scopeClause = activeSprint ? `sprint = ${activeSprint.id}` : 'statusCategory != Done';

            if (fromDate) {
                // Recency clause: catches tickets outside the sprint/not-done scope that
                // were still touched recently (e.g. a backlog ticket updated yesterday, or
                // a ticket closed just before the window) — combined with scopeClause via
                // OR so neither narrows the other.
                logger.info(`Fetching data for Board ${boardName}: scope=[${scopeClause}] AND recency from ${fromDate.toISOString()}`, 'JiraService');
                const fromDateStr = fromDate.toISOString().split('T')[0];
                const jql = `${scopeClause} OR updated >= "${fromDateStr}"`;
                issues = await this.getAllIssuesFromUrl(`/rest/agile/1.0/board/${boardId}/issue?jql=${encodeURIComponent(jql)}&expand=changelog`);
            } else if (activeSprint) {
                logger.info(`Board ${boardName} has active sprint: ${activeSprint.name}. Fetching sprint issues AND recently updated issues.`, 'JiraService');
                // Fetch issues in active sprint OR updated within last 2 days (to be safe/inclusive for timezone diffs)
                // We use JQL instead of the sprint endpoint to be more inclusive
                const jql = `${scopeClause} OR updated >= -2d`;
                issues = await this.getAllIssuesFromUrl(`/rest/agile/1.0/board/${boardId}/issue?jql=${encodeURIComponent(jql)}&expand=changelog`);
            } else {
                logger.info(`Board ${boardName} has no active sprint (or is Kanban). Fetching all active issues.`, 'JiraService');
                const jql = `${scopeClause} OR updated >= -1d`;
                issues = await this.getAllIssuesFromUrl(`/rest/agile/1.0/board/${boardId}/issue?jql=${encodeURIComponent(jql)}&expand=changelog`);
            }

        } catch (error: any) {
            logger.error(`Error fetching issues for board ${boardId}`, error, 'JiraService');
            throw error;
        }

        return { boardName, issues };
    }

    /**
     * Count how many issues in a sprint have each of the given fields populated.
     *
     * Deliberately bypasses the standard field allowlist, which exists to stop us
     * over-fetching. That allowlist is the problem here: it only requests fields the
     * project already declares, so sampling through it would report 0% for exactly the
     * unconfigured field an admin is trying to discover — Thrive's "Developer" is filled
     * on 70% of tickets but would read as empty.
     *
     * Narrow by construction: requests only the caller's explicit field ids (all
     * person-type), never `*all`, and returns counts rather than values, so no ticket
     * content and no personal data leaves this method.
     */
    async sampleFieldPresence(sprintId: number, fieldIds: string[]): Promise<{ sampleSize: number; counts: Record<string, number> }> {
        const counts: Record<string, number> = {};
        if (!fieldIds.length) return { sampleSize: 0, counts };

        const wanted = ['issuetype', ...fieldIds].join(',');
        let startAt = 0;
        let sampleSize = 0;

        while (true) {
            const response = await this.client.get(
                `/rest/agile/1.0/sprint/${sprintId}/issue`,
                { params: { maxResults: 100, startAt, fields: wanted } },
            );
            const issues: any[] = response.data?.issues ?? [];
            for (const issue of issues) {
                if (/^sub-?task$/i.test(issue?.fields?.issuetype?.name || '')) continue;
                sampleSize++;
                for (const id of fieldIds) {
                    const v = issue?.fields?.[id];
                    if (Array.isArray(v) ? v.length > 0 : !!v) counts[id] = (counts[id] ?? 0) + 1;
                }
            }
            startAt += issues.length;
            if (!issues.length || startAt >= (response.data?.total ?? 0)) break;
        }

        return { sampleSize, counts };
    }

    async getAllSprintIssues(sprintId: number): Promise<JiraIssue[]> {
        return this.getAllIssuesFromJql(`sprint = ${sprintId}`);
    }

    async getIssue(issueKey: string): Promise<JiraIssue> {
        const url = await this.applyFieldPolicy(`/rest/api/2/issue/${issueKey}?expand=changelog,names`);
        const response = await this.client.get(url);
        return sanitizeIssue(response.data);
    }

    /**
     * Fetch the set of status NAMES that exist in a project's workflow(s),
     * across all issue types, lowercased. Used to decide whether a project uses
     * a dedicated "Reopened" status (so reopen detection can key off that status
     * instead of any dev-lane regression).
     */
    async getProjectStatuses(projectKeyOrId: string): Promise<Set<string>> {
        const response = await this.client.get(
            `/rest/api/2/project/${encodeURIComponent(projectKeyOrId)}/statuses`
        );
        const names = new Set<string>();
        for (const issueType of (response.data ?? []) as any[]) {
            for (const status of (issueType.statuses ?? []) as any[]) {
                if (status?.name) names.add(String(status.name).toLowerCase());
            }
        }
        return names;
    }

    async getAllIssuesFromUrl(url: string): Promise<JiraIssue[]> {
        let issues: JiraIssue[] = [];
        let startAt = 0;
        let maxResults = 100;
        let isLast = false;

        // Applies the field allowlist for every caller of this helper — including
        // performanceSyncService, reconciliationController and qualityReconciliationJob,
        // which build their own board URLs.
        const policedUrl = await this.applyFieldPolicy(url);
        const separator = policedUrl.includes('?') ? '&' : '?';

        while (!isLast) {
            const response = await this.client.get(`${policedUrl}${separator}startAt=${startAt}&maxResults=${maxResults}`);
            const data = response.data;

            if (!data.issues) {
                const dataType = typeof data;
                const detail = dataType === 'string'
                    ? `String response (likely HTML/rate-limit page): ${data.substring(0, 500)}`
                    : `Response keys: ${Object.keys(data).join(', ')}`;
                logger.error(`Expected 'issues' array in response from ${url}. ${detail}`, undefined, 'JiraService');
                // Previously this silently stopped pagination and returned whatever
                // had been fetched so far (often nothing, on page 1) -- callers had
                // no way to distinguish "genuinely zero issues" from "Jira call
                // failed/rate-limited mid-fetch", and a sync would still get marked
                // 'done' with silently incomplete or empty data (see LS Jul 20-31
                // Kanban resync producing 0 stored facts, Aug 2026). Throw instead so
                // the caller's sync fails loudly (syncStatus='error') and can be
                // retried, rather than lying with a false-complete result.
                throw new Error(`Jira returned an unexpected response (no 'issues' array) for ${url}: ${detail.slice(0, 300)}`);
            }

            issues = issues.concat(data.issues);
            startAt += data.issues.length;
            if (startAt >= (data.total || 0)) {
                isLast = true;
            }
        }

        // Deduplicate by issue key — Agile board API total may include sub-tasks
        // causing pagination to re-fetch the same page of parent issues
        const seen = new Set<string>();
        const deduped = issues.filter(issue => {
            if (seen.has(issue.key)) return false;
            seen.add(issue.key);
            return true;
        });
        return sanitizeIssues(deduped);
    }

    extractBlockedInfo(issues: JiraIssue[], blockedStatuses: string[] = ['blocked']): BlockedTicket[] {
        const today = new Date();
        today.setHours(0, 0, 0, 0);

        const blockedTickets: BlockedTicket[] = [];
        const blockedLower = blockedStatuses.map(s => s.toLowerCase());

        issues.forEach(issue => {
            const changelog = issue.changelog || { histories: [] };
            let movedToBlockedToday = false;
            let currentStatus = issue.fields.status.name;
            let blockedSince: string | undefined;

            changelog.histories.forEach(history => {
                const historyDate = new Date(history.created);
                historyDate.setHours(0, 0, 0, 0);

                history.items.forEach(item => {
                    if (item.field !== 'status') return;
                    if (!blockedLower.includes((item.toString || '').toLowerCase())) return;

                    if (historyDate.getTime() === today.getTime()) {
                        movedToBlockedToday = true;
                    }
                    // Most recent transition INTO a blocked status wins.
                    if (!blockedSince || new Date(history.created) > new Date(blockedSince)) {
                        blockedSince = history.created;
                    }
                });
            });

            if (blockedLower.includes(currentStatus.toLowerCase()) || movedToBlockedToday) {
                blockedTickets.push({
                    key: issue.key,
                    summary: issue.fields.summary,
                    status: currentStatus,
                    movedToBlockedToday: movedToBlockedToday,
                    assignee: issue.fields.assignee ? issue.fields.assignee.displayName : 'Unassigned',
                    blockedSince
                });
            }
        });
        return blockedTickets;
    }
    private static fieldCache: { [key: string]: any[] } = {};

    async getFields(): Promise<any[]> {
        const cacheKey = this.client.defaults.baseURL || 'default';
        if (JiraService.fieldCache[cacheKey]) {
            return JiraService.fieldCache[cacheKey];
        }

        try {
            const response = await this.client.get('/rest/api/3/field');
            JiraService.fieldCache[cacheKey] = response.data;
            return response.data;
        } catch (error) {
            console.error('Failed to fetch fields:', error);
            return [];
        }
    }

    async getFieldIdByName(fieldName: string): Promise<string | undefined> {
        const fields = await this.getFields();
        const field = fields.find(f => f.name.toLowerCase() === fieldName.toLowerCase());
        return field ? field.id : undefined;
    }

    /**
     * Every field id sharing a display name. Jira allows duplicates — typically a
     * project-scoped field alongside a global one with the same name — and the
     * populated one is not reliably first. Callers that read a value from an issue
     * must try all of them; getFieldIdByName's single-id contract silently picks
     * the wrong duplicate. (Thrive has two "QA Owner" fields; only the global one
     * carries data on the PHX board.)
     */
    async getFieldIdsByName(fieldName: string): Promise<string[]> {
        const fields = await this.getFields();
        return fields
            .filter(f => f?.name && String(f.name).toLowerCase() === fieldName.toLowerCase() && f.id)
            .map(f => String(f.id));
    }

    async getBoardSprints(boardId: number): Promise<JiraSprint[]> {
        const sprints: JiraSprint[] = [];
        let startAt = 0;
        let isLast = false;
        while (!isLast) {
            let response: any;
            try {
                response = await this.client.get(`/rest/agile/1.0/board/${boardId}/sprint`, {
                    params: { state: 'active,closed', startAt, maxResults: 50 },
                });
            } catch (err: any) {
                // Kanban boards return 400 "The board does not support sprints"
                if (err?.response?.status === 400 || err?.response?.status === 404) {
                    return [];
                }
                throw err;
            }
            const data = response.data;
            sprints.push(...(data.values ?? []));
            startAt += data.values?.length ?? 0;
            isLast = data.isLast ?? startAt >= (data.total ?? 0);
        }
        return sprints.sort((a, b) =>
            new Date(b.startDate ?? 0).getTime() - new Date(a.startDate ?? 0).getTime()
        );
    }

    async getSprintById(sprintId: number): Promise<JiraSprint> {
        const response = await this.client.get(`/rest/agile/1.0/sprint/${sprintId}`);
        return response.data;
    }
}

export const jiraService = new JiraService();
