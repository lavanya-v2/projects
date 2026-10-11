/**
 * Jira workflow lane configuration helpers. Pure — no React, no I/O.
 * Shared between ProjectFormDialog here and ProjectsAdmin.
 */

export type LaneKey =
  | 'todo'
  | 'in_progress'
  | 'blocked'
  | 'in_review'
  | 'qa'
  | 'uat'
  | 'done'
  | 'reopened';

/** Roles a Jira field can carry. Order drives the editor's field order. */
export type OwnerRole = 'developer' | 'qa' | 'uat';

export const OWNER_ROLE_KEYS: OwnerRole[] = ['developer', 'qa', 'uat'];

export const OWNER_ROLE_LABELS: Record<OwnerRole, string> = {
  developer: 'Developer',
  qa: 'QA Owner',
  uat: 'UAT Owner',
};

/**
 * What each role falls back to when the project declares nothing. Mirrors
 * DEFAULT_OWNER_FIELDS in backend/src/common/laneDefaults.ts — shown as
 * placeholder text so an unconfigured project visibly states what it is doing.
 */
export const OWNER_ROLE_DEFAULTS: Record<OwnerRole, string> = {
  developer: 'assignee',
  qa: 'QA Assignee, Assigned QA, QA Owner, QA',
  uat: 'UAT Assignee, Assigned UAT, UAT Owner, UAT',
};

export const OWNER_ROLE_HELP: Record<OwnerRole, string> = {
  developer:
    'Who BUILT the ticket. Also the sole basis for the Sprint Progress denominator. Use "assignee" only where the assignee really is the developer and does not move to QA.',
  qa: 'Who TESTS the ticket. Counts towards daily attribution only.',
  uat: 'Who signs the ticket off. Counts towards daily attribution only. Leave blank if this board has no UAT field.',
};

export interface LaneFormConfig {
  assigneeMode: 'separate' | 'shared';
  /** Comma-separated Jira field display names per role. '' means "use the default". */
  ownerFields: Record<OwnerRole, string>;
  /** Credit a team member who moved the ticket, even when no owner field names them. */
  creditChangelogAuthor: boolean;
  todo: string;
  in_progress: string;
  blocked: string;
  in_review: string;
  qa: string;
  uat: string;
  done: string;
  reopened: string;
}

export const LANE_DEFAULTS: Record<LaneKey, string> = {
  todo:        'TODO, To Do, Backlog',
  in_progress: 'In Progress, In Development',
  blocked:     'Blocked, Impediment',
  in_review:   'DEV COMPLETE, PR REVIEW, Code Review',
  qa:          'QA, Testing, In QA',
  uat:         'PO REVIEW, UAT, Acceptance Testing',
  done:        'DONE, Done, Closed',
  reopened:    'REOPENED, Reopened, Issues Found',
};

export const LANE_LABELS: Record<LaneKey, string> = {
  todo:        'To Do',
  in_progress: 'In Progress',
  blocked:     'Blocked',
  in_review:   'In Review',
  qa:          'QA / Testing',
  uat:         'UAT / Acceptance',
  done:        'Done',
  reopened:    'Reopened',
};

export const LANE_KEYS = Object.keys(LANE_LABELS) as LaneKey[];

export const emptyLaneConfig = (): LaneFormConfig => ({
  assigneeMode: 'separate',
  ownerFields: { developer: '', qa: '', uat: '' },
  creditChangelogAuthor: false,
  todo: '',
  in_progress: '',
  blocked: '',
  in_review: '',
  qa: '',
  uat: '',
  done: '',
  reopened: '',
});

/** Deserialize the project's jiraLaneConfig JSON into form-friendly strings. */
export function laneConfigFromProject(jiraLaneConfig: any): LaneFormConfig {
  if (!jiraLaneConfig) return emptyLaneConfig();
  const toStr = (v: any) => (Array.isArray(v) ? v.join(', ') : v || '');
  const of = jiraLaneConfig.ownerFields ?? {};
  return {
    assigneeMode: jiraLaneConfig.assigneeMode === 'shared' ? 'shared' : 'separate',
    ownerFields: {
      developer: toStr(of.developer),
      qa: toStr(of.qa),
      uat: toStr(of.uat),
    },
    creditChangelogAuthor: of.creditChangelogAuthor === true,
    todo:        toStr(jiraLaneConfig.todo),
    in_progress: toStr(jiraLaneConfig.in_progress),
    blocked:     toStr(jiraLaneConfig.blocked),
    in_review:   toStr(jiraLaneConfig.in_review),
    qa:          toStr(jiraLaneConfig.qa),
    uat:         toStr(jiraLaneConfig.uat),
    done:        toStr(jiraLaneConfig.done),
    reopened:    toStr(jiraLaneConfig.reopened),
  };
}

/** Serialize form state back into the API payload shape (or null if empty). */
export function laneConfigToPayload(lc: LaneFormConfig): Record<string, any> | null {
  const result: Record<string, any> = {};
  if (lc.assigneeMode === 'shared') result.assigneeMode = 'shared';
  LANE_KEYS.forEach(key => {
    const vals = lc[key].split(',').map(s => s.trim()).filter(Boolean);
    if (vals.length > 0) result[key] = vals;
  });

  // Owner fields live in the same JSON blob. They must be re-serialized here or
  // saving the form would silently wipe a project's field mapping — this function
  // builds a fresh object rather than merging into the stored one.
  // Blank means "use the default", so the key is omitted and the backend falls back
  // per role. Leaving UAT blank on a board with no UAT field is harmless: the default
  // names resolve to no field ids on that instance, so nothing is read.
  const ownerFields: Record<string, any> = {};
  OWNER_ROLE_KEYS.forEach(role => {
    const vals = (lc.ownerFields[role] ?? '').split(',').map(s => s.trim()).filter(Boolean);
    if (vals.length > 0) ownerFields[role] = vals;
  });
  if (lc.creditChangelogAuthor) ownerFields.creditChangelogAuthor = true;
  if (Object.keys(ownerFields).length > 0) result.ownerFields = ownerFields;

  return Object.keys(result).length > 0 ? result : null;
}

/** True if the project has any custom lane mapping vs. the defaults. */
export function isCustomLaneConfig(lc: LaneFormConfig): boolean {
  return (
    lc.assigneeMode === 'shared' ||
    LANE_KEYS.some(k => !!lc[k]) ||
    OWNER_ROLE_KEYS.some(r => !!lc.ownerFields[r]) ||
    lc.creditChangelogAuthor
  );
}
