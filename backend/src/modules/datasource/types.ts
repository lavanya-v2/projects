export type SemanticLane = 'todo' | 'in_progress' | 'blocked' | 'in_review' | 'qa' | 'uat' | 'done' | 'reopened';

export type DataSourceType = 'jira' | 'azure_devops' | 'excel' | 'custom-excel';

export type Fidelity = 'full' | 'approximate';
export type ExcelTemplate = 'scrum' | 'kanban' | 'custom';
export type ValidationMode = 'strict' | 'best_effort';

export interface NormalizedUser {
  extId: string;
  name: string;
  email?: string;
}

export interface NormalizedStatusChange {
  from: string;
  to: string;
  at: Date;
  byEmail?: string;
}

export interface NormalizedComment {
  at: Date;
  author: string;
  /**
   * Comment text is NOT carried. Bodies are stripped at the Jira fetch boundary
   * (see jira/services/jiraFields.ts) because they can contain customer personal
   * data. Only timestamp and author are retained, which is what the daily-activity
   * signal needs.
   */
  body?: never;
}

export interface NormalizedSprintRef {
  id: string;
  name: string;
  startDate?: Date;
  endDate?: Date;
  state?: 'active' | 'closed' | 'future';
}

export interface NormalizedIssue {
  extId: string;
  title: string;
  type: string;
  state: string;
  semanticLane?: SemanticLane;
  priority?: string;
  assignee?: NormalizedUser;
  parentExtId?: string;
  storyPoints?: number;
  sprintRef?: NormalizedSprintRef;
  createdAt: Date;
  updatedAt: Date;
  dueDate?: Date;
  labels?: string[];
  statusHistory: NormalizedStatusChange[];
  comments?: NormalizedComment[];
  fidelity: Fidelity;
}

export interface IssueQueryWindow {
  fromDate?: Date;
  toDate?: Date;
  sprintRef?: string | number;
}

export interface ConnectionTestResult {
  ok: boolean;
  message: string;
  discoveredStates?: string[];
}

export interface ExcelRowParsed {
  extId: string;
  title: string;
  type: string;
  status: string;
  priority?: string;
  assigneeEmail: string;
  storyPoints?: number;
  sprintName?: string;
  sprintStart?: Date;
  sprintEnd?: Date;
  createdAt: Date;
  updatedAt: Date;
  statusChangedOn?: Date;
  doneDate?: Date;
  parentExtId?: string;
  labels?: string[];
}

export interface ExcelHistoryRow {
  extId: string;
  fromStatus: string;
  toStatus: string;
  changedOn: Date;
  changedByEmail?: string;
}

export interface CoercionNote {
  row?: number;
  column?: string;
  original?: unknown;
  coerced?: unknown;
  reason: string;
}

export interface ValidationError {
  row: number;
  column?: string;
  reason: string;
}

/**
 * One row of the pre-upload preflight: what each internal field was mapped to, and whether that
 * header was actually found in the uploaded file. This is what turns a silently-blank column
 * (the "SP imports as 0" complaint) into a visible cause before any data is written.
 */
export interface MappingReportEntry {
  field: string;
  label: string;
  /** Header configured in the project's column mapping, when one is set. */
  mappedHeader?: string;
  /** Header that actually matched a column in the file. */
  usedHeader?: string;
  matched: boolean;
  /** 1-based column index in the sheet. */
  column?: number;
  source: 'mapping' | 'default' | 'none';
}

/**
 * How much of the file's sprint identity comes from the file itself.
 *
 * Measured on the file's own Sprint values, before the uploader's declared sprint is applied, so it
 * answers "does this upload still need a sprint typed on the form?". A file that names a sprint for
 * every row does not, and demanding one anyway makes a correctly-mapped export unimportable.
 */
export interface SprintCoverage {
  /** Data rows whose own Sprint cell is blank -- exactly the rows a declared sprint fills in. */
  rowsMissingSprint: number;
  /** Data rows that name their own sprint. */
  rowsWithSprint: number;
  /** Distinct sprints named by the file, most rows first. */
  sprintsInFile: { sprintName: string; rows: number }[];
  /** True when a sprint declared on the upload form was actually applied to at least one row. */
  declaredSprintApplied: boolean;
}

export interface ValidationResult {
  ok: boolean;
  mode: ValidationMode;
  template: ExcelTemplate;
  rows: ExcelRowParsed[];
  history: ExcelHistoryRow[];
  errors: ValidationError[];
  coercions: CoercionNote[];
  mappingReport: MappingReportEntry[];
  sprintCoverage: SprintCoverage;
}

export interface MappingFieldSpec {
  /** Column name on template_mappings (camelCase). */
  key: string;
  /** Human label, also the canonical header name. */
  label: string;
  /** Headers tried when the project has not mapped this field. */
  fallbacks: string[];
}

export interface ValidateOptions {
  /**
   * Sprint declared by the uploader, used for rows whose Sprint column is absent or blank.
   * Sprint identity is declared rather than synthesised so the same sprint can be uploaded again
   * and merge with what is already stored.
   */
  defaultSprintName?: string;
  /** Sprint-frequency projects cannot store rows without a sprint to tie them together. */
  requireSprint?: boolean;
}

export interface HeaderIndex {
  /** Header text exactly as written in the sheet (trimmed). */
  exact: Map<string, number>;
  /** Case- and punctuation-insensitive form, used only in best_effort. */
  loose: Map<string, number>;
}

export interface ColumnMatch {
  column?: number;
  /** The candidate header that matched. */
  header?: string;
  /** True when only the case/punctuation-insensitive form matched. */
  lenient: boolean;
}
